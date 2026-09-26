// GitHub Copilot, via @github/copilot-sdk over a pooled per-session RPC
// connection (lib/copilotClient.ts).
//
// Copilot persists a turn only once it completes, so a transcript read has to
// merge persisted events with whatever the live stream has buffered
// (lib/liveTranscripts.ts) — otherwise an in-flight turn renders as an empty
// session on every poll. The merge deliberately filters live events that have
// since landed in history rather than deduplicating afterwards, so a message
// can't briefly appear twice as a turn settles.
//
// Copilot also cannot rename or tag its own sessions, so title and tag are
// local overrides in lib/copilotMetadata.ts.

import {
  acquireCopilotSession,
  copilotIntegrationDiagnostics,
  evictCopilotSession,
  getCopilotClient,
  peekCopilotSession,
} from '../copilotClient'
import {
  deriveCopilotState,
  mapCopilotDiagnosticsToSections,
  mapCopilotEventsToSessionMessages,
  mapCopilotModelsToSessionModels,
  mapCopilotSessionToInfo,
  mapCopilotSessionToSession,
} from '../copilotMapper'
import {
  getCopilotStoredMetadata,
  getCopilotStoredMetadataForSessions,
  setCopilotStoredTag,
  setCopilotStoredTitle,
} from '../copilotMetadata'
import {
  copilotLiveTranscriptSignature,
  filterCopilotLiveEvents,
  getCopilotLiveTranscriptEvents,
  markLiveSessionMessages,
  mergeCopilotSessionEvents,
  sessionMessageIdentity,
} from '../liveTranscripts'
import { readMappedMessagesCache, writeMappedMessagesCache } from '../mappedMessagesCache'
import { normalizeProjectPath, sameProjectPath } from '../projectPaths'
import { COPILOT_COMPOSER_MODES, parseCopilotContextTier, parseCopilotModeResponse } from '../copilotComposer'
import { COPILOT_PERMISSION_MODE_OPTIONS, copilotPermissionModeFromSdk, sortMessagesChronologically } from './shared'
import type {
  GetAuthStatusResponse as CopilotGetAuthStatusResponse,
  GetStatusResponse as CopilotGetStatusResponse,
  SessionEvent as CopilotSessionEvent,
  SessionMetadata as CopilotSessionMetadata,
} from '@github/copilot-sdk'
import type { SessionAdapter } from './types'

/** Copilot's metadata endpoint doesn't know about every session the list
 *  endpoint returns; fall back to the listing so a session opened elsewhere
 *  still resolves. */
async function findSessionMetadata(sessionId: string): Promise<CopilotSessionMetadata | null> {
  const client = await getCopilotClient()
  const metadata = await client.getSessionMetadata(sessionId).catch(() => undefined)
  if (metadata) return metadata
  const sessions = await client.listSessions()
  return sessions.find((session) => session.sessionId === sessionId) ?? null
}

// Copilot SDK 1.0.13 can read a session's durable event journal without
// creating, resuming, or activating it. That matters more than it sounds:
// activation spawns the session's runtime and replays it, which measured
// 1.4-7.8s per session against 1-7ms for the journal read, and it appends a
// synthetic `session.resume` event to what the read hands back — so merely
// opening a session to look at it changed the events it was made of. Verified
// across five local sessions: every mapped message identical, and the only
// event the old path had was the resume it caused itself.
const PERSISTED_EVENT_PAGE_MAX = 1000
// Ceiling on pagination, not on history: 200k events is far past any real
// session, and a cursor that stops advancing must not spin forever.
const PERSISTED_EVENT_PAGE_LIMIT = 200

type CopilotPersistedEventPage = {
  events: CopilotSessionEvent[]
  cursor: string
  hasMore: boolean
  cursorStatus?: string
}

type CopilotPersistedEventReader = {
  sessions?: {
    readPersistedEvents?: (params: {
      sessionId: string
      cursor?: string
      max?: number
    }) => Promise<CopilotPersistedEventPage>
  }
}

/** Null when the runtime predates the RPC, or when history moved under the
 *  read — both mean "ask the activating reader instead", never "no events". */
async function readPersistedSessionEvents(sessionId: string): Promise<CopilotSessionEvent[] | null> {
  const client = await getCopilotClient()
  const read = (client.rpc as CopilotPersistedEventReader)?.sessions?.readPersistedEvents
  if (typeof read !== 'function') return null

  const events: CopilotSessionEvent[] = []
  let cursor: string | undefined
  for (let page = 0; page < PERSISTED_EVENT_PAGE_LIMIT; page += 1) {
    const batch = await read({ sessionId, max: PERSISTED_EVENT_PAGE_MAX, ...(cursor ? { cursor } : {}) })
    // An expired cursor is answered with a fresh boundary snapshot rather than
    // a continuation, so the pages we already hold may overlap it and paging
    // on could revisit them forever. Rare enough to hand off rather than
    // reconcile.
    if (batch.cursorStatus === 'expired' && page > 0) return null
    events.push(...batch.events)
    // hasMore with an empty page means the cursor is not advancing.
    if (!batch.hasMore || batch.events.length === 0) return events
    cursor = batch.cursor
  }
  return events
}

/** Activating fallback: spawns the session runtime, so only for a runtime whose
 *  journal cannot be read directly. */
async function readActiveSessionEvents(sessionId: string): Promise<CopilotSessionEvent[]> {
  const session = await acquireCopilotSession(sessionId)
  const historyReader = session as typeof session & {
    getEvents?: () => Promise<CopilotSessionEvent[]>
    getMessages?: () => Promise<CopilotSessionEvent[]>
  }
  if (typeof historyReader.getEvents === 'function') return historyReader.getEvents()
  if (typeof historyReader.getMessages === 'function') return historyReader.getMessages()
  throw new Error('Copilot session does not expose a history reader')
}

async function readSessionEvents(sessionId: string): Promise<CopilotSessionEvent[]> {
  const persisted = await readPersistedSessionEvents(sessionId).catch(() => null)
  return persisted ?? readActiveSessionEvents(sessionId)
}

export const copilotAdapter: SessionAdapter = {
  provider: 'copilot',

  async listSessions({ limit, offset, dir, includeWorktrees }) {
    const client = await getCopilotClient()
    const response = dir && !includeWorktrees
      ? await client.listSessions({ workingDirectory: dir })
      : await client.listSessions()

    const filtered = dir
      ? response.filter((session) => {
          const cwd = session.context?.workingDirectory
          if (!cwd) return false
          return includeWorktrees ? sameProjectPath(dir, cwd) : normalizeProjectPath(cwd) === normalizeProjectPath(dir)
        })
      : response

    const sorted = filtered.toSorted((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
    const page = sorted.slice(offset, offset + limit)
    const stored = await getCopilotStoredMetadataForSessions(page.map((session) => session.sessionId))
    return page.map((session) => mapCopilotSessionToSession(session, stored[session.sessionId] ?? { title: null, tag: null }))
  },

  async readSessionInfo(sessionId) {
    // Selecting a session in the sidebar lands here, so it must not be what
    // starts the session's runtime. The journal read gives the same events,
    // and the model badge is derived from the `session.model_change` and
    // `session.start` events that record it — the live RPC is asked only when
    // a runtime is already up for some other reason.
    const [metadata, stored, events] = await Promise.all([
      findSessionMetadata(sessionId),
      getCopilotStoredMetadata(sessionId),
      readSessionEvents(sessionId),
    ])

    const warm = peekCopilotSession(sessionId)
    const currentModel = warm
      ? await warm.rpc.model.getCurrent().then((model) => model.modelId).catch(() => undefined)
      : undefined

    return mapCopilotSessionToInfo(sessionId, events, stored, metadata, currentModel)
  },

  async setTitle(sessionId, title) {
    await setCopilotStoredTitle(sessionId, title)
  },

  async setTag(sessionId, tag) {
    await setCopilotStoredTag(sessionId, tag)
  },

  async deleteSession(sessionId) {
    // Drop any warm session for this id before the SDK deletes it so the next
    // resume reconnects against the new state.
    await evictCopilotSession(sessionId).catch(() => {})
    const client = await getCopilotClient()
    await client.deleteSession(sessionId)
  },

  async readAllMessages(sessionId) {
    const persistedEvents = await readSessionEvents(sessionId)
    const liveEvents = getCopilotLiveTranscriptEvents(sessionId)
    const filteredLiveEvents = filterCopilotLiveEvents(persistedEvents, liveEvents)
    const events = mergeCopilotSessionEvents(persistedEvents, filteredLiveEvents)
    const last = events.at(-1) as { id?: string; type?: string } | undefined
    const liveKeys = new Set(mapCopilotEventsToSessionMessages(sessionId, filteredLiveEvents).map(sessionMessageIdentity))
    const signature = `${events.length}:${last?.id ?? ''}:${last?.type ?? ''}:${copilotLiveTranscriptSignature(filteredLiveEvents)}`
    const cached = readMappedMessagesCache(`copilot:${sessionId}`, signature)
    if (cached) return { messages: cached }
    const messages = markLiveSessionMessages(
      sortMessagesChronologically(mapCopilotEventsToSessionMessages(sessionId, events)),
      liveKeys,
    )
    return { messages: writeMappedMessagesCache(`copilot:${sessionId}`, signature, messages) }
  },

  async readModels(sessionId) {
    // Same rule as readSessionInfo: the TUI reads this when a session is
    // merely selected, so a cold session answers from its journal rather than
    // paying a resume for a model badge. The catalogue itself is client-level
    // and never needed a session at all.
    const client = await getCopilotClient()
    const warm = peekCopilotSession(sessionId)
    const [models, current] = await Promise.all([
      client.listModels(),
      warm
        ? warm.rpc.model.getCurrent().catch(() => ({ modelId: undefined, contextTier: undefined }))
        : readSessionEvents(sessionId)
          .then((events) => ({
            modelId: deriveCopilotState(events).currentModel,
            // The context tier is session runtime state, not something the
            // event journal records; a cold read reports none rather than
            // guessing one.
            contextTier: undefined,
          }))
          .catch(() => ({ modelId: undefined, contextTier: undefined })),
    ])
    return {
      models: mapCopilotModelsToSessionModels(models),
      currentModel: current.modelId ?? null,
      currentContextTier: parseCopilotContextTier(current.contextTier) ?? null,
      contextUsage: null,
    }
  },

  async readComposerOptions(sessionId) {
    const session = await acquireCopilotSession(sessionId)
    const [currentMode, currentPermissionMode] = await Promise.all([
      session.rpc.mode.get().catch(() => 'interactive'),
      session.rpc.permissions.getMode().catch(() => ({ mode: 'manual' as const })),
    ])
    return {
      modes: COPILOT_COMPOSER_MODES,
      currentMode: parseCopilotModeResponse(currentMode) ?? 'interactive',
      permissionModes: COPILOT_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: copilotPermissionModeFromSdk(currentPermissionMode.mode) ?? 'off',
    }
  },

  async readSlashCommands(sessionId) {
    try {
      const session = await acquireCopilotSession(sessionId)
      // commands.list is newer than the SDK version floor this app supports,
      // so probe for it rather than assuming it exists.
      const commandsRpc = (session.rpc as typeof session.rpc & {
        commands?: {
          list?: (params?: {
            includeBuiltins?: boolean
            includeSkills?: boolean
            includeClientCommands?: boolean
          }) => Promise<{
            commands: Array<{
              name: string
              description?: string
              input?: { hint?: string }
            }>
          }>
        }
      }).commands
      if (!commandsRpc?.list) return []
      const response = await commandsRpc.list({
        includeBuiltins: true,
        includeSkills: true,
        includeClientCommands: true,
      })
      return response.commands.map((command) => ({
        command: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? '',
        argumentHint: command.input?.hint && command.input.hint.trim() ? command.input.hint.trim() : undefined,
      }))
    } catch {
      return []
    }
  },

  async readDiagnostics(sessionId) {
    const client = await getCopilotClient()
    const [metadata, session, status, auth] = await Promise.all([
      findSessionMetadata(sessionId),
      acquireCopilotSession(sessionId),
      client.getStatus().catch(() => ({ version: 'unknown', protocolVersion: 0 }) as CopilotGetStatusResponse),
      client.getAuthStatus().catch(() => ({
        isAuthenticated: false,
        statusMessage: 'Authentication status unavailable',
      }) as CopilotGetAuthStatusResponse),
    ])

    const [events, currentModel, mode, tools, currentTools, quota] = await Promise.all([
      session.getEvents(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
      session.rpc.mode.get().catch(() => ({ mode: undefined })),
      client.rpc.tools.list({ model: undefined }).catch(() => ({ tools: [] as Array<{ name: string; description?: string }> })),
      session.rpc.tools.getCurrentMetadata().catch(() => ({ tools: null })),
      client.rpc.account.getQuota({}).catch(() => ({ quotaSnapshots: {} as Record<string, {
        entitlementRequests: number
        usedRequests: number
        remainingPercentage: number
        overage: number
        overageAllowedWithExhaustedQuota: boolean
        resetDate?: string
      }> })),
    ])

    const quotaItems = Object.entries(quota.quotaSnapshots).flatMap(([name, snapshot]) => {
      if (!snapshot) return []
      const remaining = Math.round(snapshot.remainingPercentage * 100)
      const reset = snapshot.resetDate ? ` · resets ${snapshot.resetDate}` : ''
      return [`${name} · ${snapshot.usedRequests}/${snapshot.entitlementRequests} used · ${remaining}% remaining${reset}`]
    })

    return {
      currentModel: currentModel.modelId ?? deriveCopilotState(events, metadata).currentModel ?? null,
      sections: mapCopilotDiagnosticsToSections({
        sessionId,
        status,
        auth,
        currentModel: currentModel.modelId ?? null,
        mode: typeof mode === 'string' ? mode : mode.mode ?? null,
        tools: tools.tools,
        currentTools: currentTools.tools ?? [],
        quotaItems,
        integrationItems: copilotIntegrationDiagnostics(sessionId),
        metadata,
        events,
        workspacePath: session.workspacePath,
      }),
    }
  },
}
