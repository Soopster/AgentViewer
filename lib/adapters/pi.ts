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
  peekPiAgentSession,
  openPiSubagentSessionManager,
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
import { piSubagentRows, readPiSubagentProgress } from '../piSubagents'
import { readSessionCompaction } from '../sessionCompaction'
import { readPiMcpStatus } from '../piMcpDiagnostics'
import { PI_SLASH_COMMANDS } from '../piComposer'
import { sortMessagesChronologically } from './shared'
import type { SessionAdapter } from './types'

async function piChildren(sessionId: string) {
  const entries = await getPiSessionEntries(sessionId)
  const rows = new Map(readPiSubagentProgress(sessionId).map(row => [row.agentId, row]))
  for (const entry of entries.slice(-500)) {
    if (entry.type !== 'message') continue
    const message = entry.message as { role: string; toolName?: string; toolCallId?: string; customType?: string; details?: unknown; isError?: boolean }
    const result = message.role === 'toolResult' && message.toolName === 'subagent'
    if (!result && !(message.role === 'custom' && message.customType === 'subagent-notify')) continue
    for (const row of piSubagentRows(message.toolCallId ?? entry.id, message.details, result && message.isError ? 'failed' : undefined)) {
      const previous = rows.get(row.agentId)
      rows.set(row.agentId, { ...row, childSessionId: row.childSessionId ?? previous?.childSessionId, sessionFile: row.sessionFile ?? previous?.sessionFile })
    }
  }
  const recent = [...rows.values()].slice(-50)
  const catalog = recent.some(row => row.childSessionId || row.sessionFile) ? await listPiSessions().catch(() => []) : []
  const knownIds = new Set(catalog.map(row => row.id))
  const knownPaths = new Map(catalog.map(row => [row.path, row.id]))
  const projected = await Promise.all(recent.map(async ({ childSessionId, sessionFile, ...row }) => {
    const listed = sessionFile ? knownPaths.get(sessionFile) : childSessionId && knownIds.has(childSessionId) ? childSessionId : undefined
    const manager = !listed && sessionFile ? await openPiSubagentSessionManager(sessionId, sessionFile) : undefined
    const linked = listed ?? manager?.getSessionId()
    const transcriptAvailable = !!linked && linked !== sessionId && (!childSessionId || childSessionId === linked)
    const agentId = transcriptAvailable ? linked : row.agentId
    const summary = { ...row, agentId, transcriptAvailable }
    return { summary, manager: transcriptAvailable ? manager : undefined }
  }))
  return [...new Map(projected.map(child => [child.summary.agentId, child])).values()]
}

export const piAdapter: SessionAdapter = {
  provider: 'pi',

  async readSubagentSummaries(sessionId) {
    return (await piChildren(sessionId)).map(child => child.summary)
  },

  async readSubagentMessages(sessionId, agentId) {
    const child = (await piChildren(sessionId)).find(row => row.summary.agentId === agentId && row.summary.transcriptAvailable)
    if (!child) return []
    const entries = child.manager ? child.manager.getBranch() : await getPiSessionEntries(agentId)
    return mapPiEntriesToSessionMessages(agentId, entries)
  },

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

    const agentSession = peekPiAgentSession(sessionId)
    const sessionFile = agentSession?.sessionManager.getSessionFile()
    const cwd = agentSession?.sessionManager.getCwd()
    const stats = agentSession?.getSessionStats()
    const context = stats?.contextUsage
    const compaction = readSessionCompaction('pi', sessionId)
    const tools = agentSession?.getAllTools() ?? []
    const mcp = agentSession ? readPiMcpStatus(agentSession) : undefined
    const mcpTools = tools.filter(tool => tool.name === 'mcp' || tool.name.startsWith('mcp__')).map(tool => tool.name)
    const contextItems = context?.tokens != null
      ? [`${context.tokens.toLocaleString()}${context.contextWindow ? ` / ${context.contextWindow.toLocaleString()}` : ''} tokens`]
      : ['Context usage unavailable']
    if (!compaction.status && entries.some(entry => entry.type === 'compaction')) contextItems.push('Earlier compaction recorded')

    return {
      currentModel: currentModel ?? null,
      sections: [
        { id: 'context', title: 'CONTEXT', items: contextItems, compaction },
        { id: 'mcp', title: 'MCP', items: mcp ?? (mcpTools.length ? ['Server status unavailable', ...mcpTools] : ['MCP inventory unavailable']) },
        ...mapPiDiagnosticsToSections({
          sessionId,
          cwd,
          currentModel,
          thinkingLevel: agentSession?.thinkingLevel ?? thinkingLevel,
          toolNames: agentSession?.getActiveToolNames() ?? [],
          sessionFile,
          stats,
        }),
      ],
    }
  },
}
