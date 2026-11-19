// Pi (@mariozechner/pi-coding-agent), driven through a pooled in-process
// AgentSession (lib/piClient.ts).
//
// Pi's on-disk history is an append-only *branch graph* of SessionEntries, not
// a flat list, and its AgentMessages carry no entry ids. That is why the
// transcript fingerprint hashes the leaf message rather than just counting:
// switching branches natively replaces the active leaf with another message of
// the same role and depth, which length-plus-role cannot see. Getting this
// wrong shows up as a transcript that stops updating after a branch switch.
//
// Model and thinking level are read backwards out of the entry log because Pi
// records them as changes, not as session-level state.

import {
  getPiSessionEntries,
  getPiSessionMessages,
  deletePiSession,
  listPiSessions,
  openPiAgentSession,
  setPiSessionName,
} from '../piClient'
import {
  currentPiModelValue,
  mapPiDiagnosticsToSections,
  mapPiEntriesToSessionMessages,
  mapPiMessagesToSessionMessages,
  mapPiModelsToSessionModels,
  mapPiSessionToInfo,
  mapPiSessionToSession,
  piAgentMessageFingerprint,
} from '../piMapper'
import {
  getPiStoredMetadata,
  getPiStoredMetadataForSessions,
  setPiStoredTag,
  setPiStoredTitle,
} from '../piMetadata'
import {
  getPiLiveTranscriptMessages,
  markLiveSessionMessages,
  piLiveTranscriptSignature,
  sessionMessageIdentity,
} from '../liveTranscripts'
import { readMappedMessagesCache, writeMappedMessagesCache } from '../mappedMessagesCache'
import { PI_SLASH_COMMANDS } from '../piComposer'
import { sortMessagesChronologically } from './shared'
import type { SessionAdapter } from './types'

export const piAdapter: SessionAdapter = {
  provider: 'pi',

  async listSessions({ limit, offset, dir }) {
    const sessions = await listPiSessions(dir || undefined)
    const sorted = sessions.toSorted((a, b) => b.modified.getTime() - a.modified.getTime())
    const page = sorted.slice(offset, offset + limit)
    const stored = await getPiStoredMetadataForSessions(page.map((s) => s.id))
    return page.map((s) => mapPiSessionToSession(s, stored[s.id] ?? { title: null, tag: null }))
  },

  async readSessionInfo(sessionId) {
    const [sessions, stored] = await Promise.all([
      listPiSessions(),
      getPiStoredMetadata(sessionId),
    ])
    const info = sessions.find((s) => s.id === sessionId)
    if (!info) return null
    const messages = await getPiSessionMessages(sessionId)
    return mapPiSessionToInfo(info, stored, messages)
  },

  async setTitle(sessionId, title) {
    // Pi owns a session name of its own, so set both: the native name keeps
    // `pi` CLI listings in sync, the stored override survives a name Pi
    // regenerates for itself.
    await setPiSessionName(sessionId, title ?? '')
    await setPiStoredTitle(sessionId, title)
  },

  async setTag(sessionId, tag) {
    await setPiStoredTag(sessionId, tag)
  },

  async deleteSession(sessionId) {
    await deletePiSession(sessionId)
  },

  async readAllMessages(sessionId) {
    const entries = await getPiSessionEntries(sessionId)
    const persistedEntries = entries.filter((entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message')
    const raw = persistedEntries.map((entry) => entry.message)
    const live = getPiLiveTranscriptMessages(sessionId, raw)
    // Pi AgentMessages do not carry SessionEntry ids. Length + role therefore
    // misses a native branch switch that replaces the active leaf with another
    // message of the same role and depth. Fingerprint the leaf so the mapped
    // transcript cache follows Pi's append-only branch graph correctly.
    const last = persistedEntries.at(-1)
    const signature = `${raw.length}:${last?.id ?? ''}:${last ? piAgentMessageFingerprint(last.message) : ''}:${piLiveTranscriptSignature(live)}`
    const cached = readMappedMessagesCache(`pi:${sessionId}`, signature)
    if (cached) return { messages: cached }
    const persistedMessages = mapPiEntriesToSessionMessages(sessionId, entries)
    const mappedLiveMessages = mapPiMessagesToSessionMessages(sessionId, live)
    const liveKeys = new Set(mappedLiveMessages.map(sessionMessageIdentity))
    const messages = sortMessagesChronologically([...persistedMessages, ...mappedLiveMessages])
    const markedMessages = markLiveSessionMessages(messages, liveKeys)
    return { messages: writeMappedMessagesCache(`pi:${sessionId}`, signature, markedMessages) }
  },

  async readModels(sessionId) {
    const messages = await getPiSessionMessages(sessionId)
    let currentModel: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { role: string; model?: string }
      if (msg.role === 'assistant' && msg.model) {
        currentModel = msg.model
        break
      }
    }
    const agentSession = await openPiAgentSession(sessionId)
    const availableModels = await agentSession.modelRuntime.getAvailable()
    const currentModelValue = currentPiModelValue(agentSession.model, currentModel)
    const piContextUsage = agentSession.getContextUsage()
    return {
      models: mapPiModelsToSessionModels(availableModels, currentModelValue ?? currentModel),
      currentModel: currentModelValue ?? currentModel ?? null,
      contextUsage: piContextUsage
        ? {
            totalTokens: piContextUsage.tokens ?? 0,
            maxTokens: piContextUsage.contextWindow,
            percentage: piContextUsage.percent ?? 0,
            model: agentSession.model?.id ?? currentModel ?? 'unknown',
            categories: [
              { name: 'Context', tokens: piContextUsage.tokens ?? 0, color: 'var(--cyan)' },
            ],
          }
        : null,
    }
  },

  async readSlashCommands() {
    // Pi's SDK catalog includes interactive-only commands such as /settings,
    // /resume, and /quit. AgentViewer has no matching modal/terminal lifecycle
    // for those, so advertise only commands this composer executes natively.
    return PI_SLASH_COMMANDS.map((command) => ({ ...command }))
  },

  async readDiagnostics(sessionId) {
    const entries = await getPiSessionEntries(sessionId)
    let currentModel: string | undefined
    let thinkingLevel: string | undefined
    // Pi records model and thinking level as *changes*, so the current value is
    // whichever change is nearest the end of the log.
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.type === 'thinking_level_change') {
        thinkingLevel ??= (entry as { thinkingLevel: string }).thinkingLevel
      }
      if (entry.type === 'message') {
        const msg = (entry as { message: { role: string; model?: string; thinking?: boolean } }).message
        if (msg.role === 'assistant') {
          currentModel ??= msg.model
          if (thinkingLevel === undefined && msg.thinking !== undefined) {
            thinkingLevel = msg.thinking ? 'enabled' : 'off'
          }
        }
      }
      if (currentModel && thinkingLevel !== undefined) break
    }

    const agentSession = await openPiAgentSession(sessionId)
    const sessionFile = agentSession.sessionManager.getSessionFile()
    const cwd = agentSession.sessionManager.getCwd()
    const stats = agentSession.getSessionStats()

    return {
      currentModel: currentModel ?? null,
      sections: mapPiDiagnosticsToSections({
        sessionId,
        cwd,
        currentModel,
        thinkingLevel: agentSession.thinkingLevel ?? thinkingLevel,
        toolNames: agentSession.getActiveToolNames(),
        sessionFile,
        stats,
      }),
    }
  },
}
