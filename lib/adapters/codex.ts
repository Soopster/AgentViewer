// Codex, driven through the `codex app-server` JSON-RPC protocol
// (lib/codexClient.ts). Two Codex quirks shape almost everything here:
//
//  - A thread must be *resumed* before its metadata is readable, and resume
//    materializes the rollout server-side. lib/codexThreads.ts caches that so
//    the cost is paid once per app-server lifetime, not once per read.
//  - Only one client may hold a thread's rollout writer lock. When another
//    Codex client (the CLI, an editor extension) holds it, a fresh read is
//    impossible — so the transcript falls back to the last mapped snapshot and
//    flags itself `externalWriter` for the UI to say so, rather than
//    pretending the session is empty.
//
// Codex cannot delete threads, so deleteSession is absent and
// CODEX_CAPABILITIES.deleteSession is false; registry.ts asserts that pair.

import { compactStableFingerprint } from '../compactFingerprint'
import { getCodexClient } from '../codexClient'
import { getCodexProjectDiagnostics } from '../codexHarness'
import { withTimeout } from '../withTimeout'
import {
  currentCodexModelValue,
  mapCodexDiagnosticsToSections,
  mapCodexModelsToSessionModels,
  mapCodexThreadToMessages,
  mapCodexThreadToSession,
  mapCodexThreadToSessionInfo,
} from '../codexMapper'
import { getCodexStoredTag, getCodexStoredTagsForSessions, setCodexStoredTag } from '../codexTags'
import {
  ensureCodexThreadResumed,
  isCodexActiveWriterError,
  isCodexMissingRolloutError,
  pendingCodexSessionInfo,
  readCodexThread,
  readCodexThreadWithFullTurns,
} from '../codexThreads'
import { readLatestMappedMessagesCache, readMappedMessagesCache, writeMappedMessagesCache } from '../mappedMessagesCache'
import { CODEX_PERMISSION_MODE_OPTIONS } from './shared'
import type { ThreadSourceKind, Thread as CodexThread } from '../codex-schema/v2'
import type { SessionAdapter } from './types'

const SESSION_LIST_SOURCE_KINDS: ThreadSourceKind[] = [
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgentThreadSpawn',
  'unknown',
]

export const codexAdapter: SessionAdapter = {
  provider: 'codex',

  async listSessions({ limit, offset, dir }) {
    const client = getCodexClient()
    const response = await client.request('thread/list', {
      limit: limit + offset,
      cwd: dir || undefined,
      sourceKinds: SESSION_LIST_SOURCE_KINDS,
    })
    const page = response.data.slice(offset, offset + limit)
    const tags = await getCodexStoredTagsForSessions(page.map((thread) => thread.id))
    return page.map((thread) => mapCodexThreadToSession(thread, tags[thread.id] ?? null))
  },

  async readSessionInfo(sessionId) {
    const tag = await getCodexStoredTag(sessionId)
    let thread: CodexThread | null = null
    let resume: { model: string | null } | null = null
    // A thread that isn't materialized yet, or one another client is writing,
    // is a normal state during a first turn — surface the pending placeholder
    // rather than failing the whole session view.
    try {
      thread = await readCodexThread(sessionId, false)
    } catch (err) {
      if (!isCodexMissingRolloutError(err) && !isCodexActiveWriterError(err)) throw err
    }
    try {
      resume = await ensureCodexThreadResumed(sessionId)
    } catch (err) {
      if (!isCodexMissingRolloutError(err) && !isCodexActiveWriterError(err)) throw err
    }
    if (!thread) return pendingCodexSessionInfo(sessionId, tag)
    return mapCodexThreadToSessionInfo(thread, tag, resume?.model ?? null)
  },

  async setTitle(sessionId, title) {
    await getCodexClient().request('thread/name/set', { threadId: sessionId, name: title ?? '' })
  },

  async setTag(sessionId, tag) {
    await setCodexStoredTag(sessionId, tag)
  },

  async readAllMessages(sessionId) {
    let thread: CodexThread
    try {
      thread = await readCodexThreadWithFullTurns(sessionId)
    } catch (err) {
      if (isCodexMissingRolloutError(err)) return { messages: [], externalWriter: false }
      if (isCodexActiveWriterError(err)) {
        return { messages: readLatestMappedMessagesCache(`codex:${sessionId}`) ?? [], externalWriter: true }
      }
      throw err
    }
    const turns = thread.turns
    // ThreadStatus is a discriminated union; TurnError is an object — both
    // need flat keys for cache fingerprinting or they'd stringify to "[object
    // Object]" and miss invalidations.
    const threadStatusKey = thread.status.type === 'active'
      ? `active:${thread.status.activeFlags.join(',')}`
      : thread.status.type
    // Codex may update an earlier assistant item after a tool-heavy turn has
    // already appended later tool/result items. Fingerprint the whole turn
    // sequence so those in-place item updates invalidate the mapped transcript.
    const turnsSignature = compactStableFingerprint(turns)
    const signature = [
      thread.updatedAt,
      threadStatusKey,
      turns.length,
      turnsSignature,
    ].join(':')
    const cached = readMappedMessagesCache(`codex:${sessionId}`, signature)
    if (cached) return { messages: cached, externalWriter: false }
    // thread/turns/list(sortDirection: 'asc') plus each Turn.items array is the
    // Codex archive's authoritative order. Do not timestamp-sort it: many items
    // only have the turn-level fallback timestamp while user items can have a
    // later UUID-derived timestamp, which moved the prompt behind its reply.
    const messages = mapCodexThreadToMessages(thread)
    return { messages: writeMappedMessagesCache(`codex:${sessionId}`, signature, messages), externalWriter: false }
  },

  async readModels(sessionId) {
    const client = getCodexClient()
    // Custom model providers (proxied base URLs, non-default profiles) can
    // leave the app-server slow to answer model/list on a cold connection —
    // without a timeout the composer's model picker hangs indefinitely
    // instead of falling back to an empty list the UI can recover from.
    const [modelsResponse, resume] = await Promise.all([
      withTimeout(client.request('model/list', {}), 8000, 'Codex model list')
        .catch(() => ({ data: [] as Parameters<typeof mapCodexModelsToSessionModels>[0] })),
      withTimeout(ensureCodexThreadResumed(sessionId), 8000, 'Codex thread resume').catch(() => null),
    ])
    return {
      models: mapCodexModelsToSessionModels(modelsResponse.data),
      currentModel: currentCodexModelValue(modelsResponse.data, resume?.model),
      contextUsage: null,
    }
  },

  async readComposerOptions() {
    return {
      permissionModes: CODEX_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: 'auto',
    }
  },

  async readDiagnostics(sessionId) {
    // Per-thread reads stay direct (they're specific to this sessionId),
    // but the four project-wide reads go through the harness cache so
    // repeated opens of the diagnostics panel share one HTTP round-trip.
    const [thread, resume, project] = await Promise.all([
      readCodexThread(sessionId, false),
      ensureCodexThreadResumed(sessionId).catch((error) => {
        if (isCodexActiveWriterError(error)) return { model: null }
        throw error
      }),
      getCodexProjectDiagnostics(),
    ])

    return {
      sections: mapCodexDiagnosticsToSections({
        thread,
        currentModel: resume.model,
        mcpServers: project.mcpServers,
        features: project.features,
        skills: project.skills,
        apps: project.apps,
      }),
      currentModel: resume.model,
    }
  },
}
