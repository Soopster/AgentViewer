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
import { COPILOT_PERMISSION_MODE_OPTIONS, sortMessagesChronologically } from './shared'
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

async function readSessionEvents(sessionId: string): Promise<CopilotSessionEvent[]> {
  const session = await acquireCopilotSession(sessionId)
  const historyReader = session as typeof session & {
    getEvents?: () => Promise<CopilotSessionEvent[]>
    getMessages?: () => Promise<CopilotSessionEvent[]>
  }
  if (typeof historyReader.getEvents === 'function') return historyReader.getEvents()
  if (typeof historyReader.getMessages === 'function') return historyReader.getMessages()
  throw new Error('Copilot session does not expose a history reader')
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
    const [metadata, stored, session] = await Promise.all([
      findSessionMetadata(sessionId),
      getCopilotStoredMetadata(sessionId),
      acquireCopilotSession(sessionId),
    ])

    const [events, currentModel] = await Promise.all([
      session.getEvents(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
    ])

    return mapCopilotSessionToInfo(sessionId, events, stored, metadata, currentModel.modelId)
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
    const client = await getCopilotClient()
    const session = await acquireCopilotSession(sessionId)
    const [models, currentModel] = await Promise.all([
      client.listModels(),
      session.rpc.model.getCurrent().catch(() => ({ modelId: undefined, contextTier: undefined })),
    ])
    return {
      models: mapCopilotModelsToSessionModels(models),
      currentModel: currentModel.modelId ?? null,
      currentContextTier: parseCopilotContextTier(currentModel.contextTier) ?? null,
      contextUsage: null,
    }
  },

  async readComposerOptions(sessionId) {
    const session = await acquireCopilotSession(sessionId)
    const [currentMode, currentPermissionMode] = await Promise.all([
      session.rpc.mode.get().catch(() => 'interactive'),
      session.rpc.permissions.getAllowAll().catch(() => ({ enabled: false, mode: 'off' as const })),
    ])
    return {
      modes: COPILOT_COMPOSER_MODES,
      currentMode: parseCopilotModeResponse(currentMode) ?? 'interactive',
      permissionModes: COPILOT_PERMISSION_MODE_OPTIONS,
      currentPermissionMode: currentPermissionMode.mode ?? (currentPermissionMode.enabled ? 'on' : 'off'),
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
