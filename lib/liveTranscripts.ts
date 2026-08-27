// Live-transcript buffers for Copilot and Pi: the seam between the send path
// (which records streaming events as a turn runs) and the read path (which
// merges them over persisted history so a transcript being written right now
// still renders completely).
//
// Both providers need this for the same reason: their SDK persists a turn only
// after it finishes, so between first token and turn end the only record of
// what the agent said lives in the stream we are consuming. Dropping it would
// make an active turn look empty on every poll.
//
// The maps are process-global (survive HMR) and doubly bounded — a TTL sweep
// plus a hard entry cap — because a turn that dies mid-stream never runs its
// own cleanup, and this holds whole message arrays.

import type { SessionEvent as CopilotSessionEvent } from '@github/copilot-sdk'
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core'
import { piAgentMessageDuplicateKey, piAgentMessageFingerprint } from './piMapper'
import type { SessionMessage } from './types'

export type CopilotAssistantMessageEvent = Extract<CopilotSessionEvent, { type: 'assistant.message' }>
export type CopilotAssistantMessageDeltaEvent = Extract<CopilotSessionEvent, { type: 'assistant.message_delta' }>
export type CopilotAssistantMessageStartEvent = Extract<CopilotSessionEvent, { type: 'assistant.message_start' }>

export type CopilotLiveDraft = {
  agentId?: string
  content: string
  messageId: string
  parentId: string | null
  phase?: string
  timestamp: string
  turnId?: string
}

export type CopilotLiveTranscriptEntry = {
  currentTurnId?: string
  drafts: Map<string, CopilotLiveDraft>
  events: Map<string, CopilotSessionEvent>
  timer?: ReturnType<typeof setTimeout>
  updatedAt: number
}

export const COPILOT_LIVE_TRANSCRIPT_TTL_MS = 5 * 60 * 1000
// Size backstop on top of the TTL cleanup: if cleanup scheduling is ever
// missed (e.g. a turn dies mid-stream), the map still cannot grow past the
// realistic concurrent-live-session count.
export const LIVE_TRANSCRIPT_MAX_ENTRIES = 32
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCopilotLiveTranscripts: Map<string, CopilotLiveTranscriptEntry> | undefined
}
export const copilotLiveTranscripts = globalThis.__agentViewerCopilotLiveTranscripts
  ?? (globalThis.__agentViewerCopilotLiveTranscripts = new Map<string, CopilotLiveTranscriptEntry>())

export function getCopilotLiveTranscriptEntry(sessionId: string): CopilotLiveTranscriptEntry {
  let entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) {
    entry = {
      drafts: new Map(),
      events: new Map(),
      updatedAt: Date.now(),
    }
    copilotLiveTranscripts.set(sessionId, entry)
    while (copilotLiveTranscripts.size > LIVE_TRANSCRIPT_MAX_ENTRIES) {
      const oldestKey = copilotLiveTranscripts.keys().next().value
      if (oldestKey === undefined) break
      const oldest = copilotLiveTranscripts.get(oldestKey)
      if (oldest?.timer) clearTimeout(oldest.timer)
      copilotLiveTranscripts.delete(oldestKey)
    }
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = undefined
  }
  entry.updatedAt = Date.now()
  return entry
}

export function scheduleCopilotLiveTranscriptCleanup(sessionId: string): void {
  const entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    copilotLiveTranscripts.delete(sessionId)
  }, COPILOT_LIVE_TRANSCRIPT_TTL_MS)
  if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) {
    (entry.timer as { unref: () => void }).unref()
  }
}

export function copilotLiveEventKey(event: CopilotSessionEvent): string {
  if (event.type === 'assistant.message') return `assistant.message:${event.data.messageId}`
  return `${event.type}:${event.id}`
}

export function makeCopilotLiveAssistantMessageEvent(draft: CopilotLiveDraft): CopilotAssistantMessageEvent {
  return {
    agentId: draft.agentId,
    data: {
      content: draft.content,
      messageId: draft.messageId,
      phase: draft.phase,
      turnId: draft.turnId,
    },
    ephemeral: true,
    id: `agent-viewer-live:${draft.messageId}`,
    parentId: draft.parentId,
    timestamp: draft.timestamp,
    type: 'assistant.message',
  } as CopilotAssistantMessageEvent
}

export function recordCopilotLiveDraftStart(sessionId: string, event: CopilotAssistantMessageStartEvent): void {
  const entry = getCopilotLiveTranscriptEntry(sessionId)
  const existing = entry.drafts.get(event.data.messageId)
  entry.drafts.set(event.data.messageId, {
    agentId: event.agentId,
    content: existing?.content ?? '',
    messageId: event.data.messageId,
    parentId: event.parentId,
    phase: event.data.phase,
    timestamp: existing?.timestamp ?? event.timestamp,
    turnId: entry.currentTurnId,
  })
}

export function recordCopilotLiveDraftDelta(sessionId: string, event: CopilotAssistantMessageDeltaEvent): void {
  const entry = getCopilotLiveTranscriptEntry(sessionId)
  const existing = entry.drafts.get(event.data.messageId)
  entry.drafts.set(event.data.messageId, {
    agentId: event.agentId ?? existing?.agentId,
    content: `${existing?.content ?? ''}${event.data.deltaContent}`,
    messageId: event.data.messageId,
    parentId: existing?.parentId ?? event.parentId,
    phase: existing?.phase,
    timestamp: event.timestamp,
    turnId: existing?.turnId ?? entry.currentTurnId,
  })
}

export function recordCopilotLiveTranscriptEvent(sessionId: string, event: CopilotSessionEvent): void {
  const entry = getCopilotLiveTranscriptEntry(sessionId)

  if (event.type === 'assistant.turn_start') {
    entry.currentTurnId = event.data.turnId
  } else if (event.type === 'assistant.turn_end' && entry.currentTurnId === event.data.turnId) {
    entry.currentTurnId = undefined
    scheduleCopilotLiveTranscriptCleanup(sessionId)
  }

  if (event.type === 'assistant.message_start') {
    recordCopilotLiveDraftStart(sessionId, event)
    return
  }
  if (event.type === 'assistant.message_delta') {
    recordCopilotLiveDraftDelta(sessionId, event)
    return
  }
  if (event.type === 'assistant.message') {
    entry.drafts.delete(event.data.messageId)
  }

  entry.events.set(copilotLiveEventKey(event), event)
}

export function getCopilotLiveTranscriptEvents(sessionId: string): CopilotSessionEvent[] {
  const entry = copilotLiveTranscripts.get(sessionId)
  if (!entry) return []
  const events = Array.from(entry.events.values())
  for (const draft of entry.drafts.values()) {
    if (!draft.content) continue
    events.push(makeCopilotLiveAssistantMessageEvent(draft))
  }
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export function copilotLiveTranscriptSignature(events: CopilotSessionEvent[]): string {
  if (events.length === 0) return ''
  return events.map((event) => {
    if (event.type === 'assistant.message') {
      return `${event.type}:${event.data.messageId}:${event.data.content.length}:${event.data.content.slice(-64)}`
    }
    return `${event.type}:${event.id}`
  }).join('|')
}

export function mergeCopilotSessionEvents(persisted: CopilotSessionEvent[], live: CopilotSessionEvent[]): CopilotSessionEvent[] {
  if (live.length === 0) return persisted
  return [...persisted, ...filterCopilotLiveEvents(persisted, live)].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export function filterCopilotLiveEvents(persisted: CopilotSessionEvent[], live: CopilotSessionEvent[]): CopilotSessionEvent[] {
  const persistedIds = new Set(persisted.map((event) => event.id))
  const persistedAssistantIds = new Set(
    persisted
      .filter((event): event is CopilotAssistantMessageEvent => event.type === 'assistant.message')
      .map((event) => event.data.messageId),
  )
  const filtered: CopilotSessionEvent[] = []
  for (const event of live) {
    if (persistedIds.has(event.id)) continue
    if (event.type === 'assistant.message' && persistedAssistantIds.has(event.data.messageId)) continue
    filtered.push(event)
  }
  return filtered
}

export function sessionMessageIdentity(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}

export function markLiveSessionMessages(messages: SessionMessage[], liveKeys: Set<string>): SessionMessage[] {
  if (liveKeys.size === 0) return messages
  return messages.map((message) => liveKeys.has(sessionMessageIdentity(message))
    ? { ...message, ephemeral: true }
    : message
  )
}

export type PiLiveTranscriptEntry = {
  activeAssistantKey?: string
  messages: Map<string, PiAgentMessage>
  timer?: ReturnType<typeof setTimeout>
  updatedAt: number
}

export const PI_LIVE_TRANSCRIPT_TTL_MS = 5 * 60 * 1000
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPiLiveTranscripts: Map<string, PiLiveTranscriptEntry> | undefined
}
export const piLiveTranscripts = globalThis.__agentViewerPiLiveTranscripts
  ?? (globalThis.__agentViewerPiLiveTranscripts = new Map<string, PiLiveTranscriptEntry>())

export function getPiLiveTranscriptEntry(sessionId: string): PiLiveTranscriptEntry {
  let entry = piLiveTranscripts.get(sessionId)
  if (!entry) {
    entry = {
      messages: new Map(),
      updatedAt: Date.now(),
    }
    piLiveTranscripts.set(sessionId, entry)
    while (piLiveTranscripts.size > LIVE_TRANSCRIPT_MAX_ENTRIES) {
      const oldestKey = piLiveTranscripts.keys().next().value
      if (oldestKey === undefined) break
      const oldest = piLiveTranscripts.get(oldestKey)
      if (oldest?.timer) clearTimeout(oldest.timer)
      piLiveTranscripts.delete(oldestKey)
    }
  }
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = undefined
  }
  entry.updatedAt = Date.now()
  return entry
}

export function schedulePiLiveTranscriptCleanup(sessionId: string): void {
  const entry = piLiveTranscripts.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    piLiveTranscripts.delete(sessionId)
  }, PI_LIVE_TRANSCRIPT_TTL_MS)
  if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) {
    (entry.timer as { unref: () => void }).unref()
  }
}

export function piLiveMessageKey(message: PiAgentMessage, fallback: string): string {
  const record = message as unknown as Record<string, unknown>
  const role = typeof record.role === 'string' ? record.role : 'message'
  if (role === 'assistant') {
    const responseId = typeof record.responseId === 'string' && record.responseId ? record.responseId : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    const model = typeof record.model === 'string' ? record.model : ''
    return `assistant:${responseId || timestamp || model || fallback}`
  }
  if (role === 'toolResult') {
    const toolCallId = typeof record.toolCallId === 'string' && record.toolCallId ? record.toolCallId : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `toolResult:${toolCallId || timestamp || fallback}`
  }
  if (role === 'bashExecution') {
    const command = typeof record.command === 'string' && record.command ? record.command : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `bashExecution:${command || timestamp || fallback}`
  }
  if (role === 'user') {
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `user:${timestamp || fallback}`
  }
  const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
  return `${role}:${timestamp || fallback}`
}

export function recordPiLiveMessage(sessionId: string, message: PiAgentMessage, fallback: string): void {
  const entry = getPiLiveTranscriptEntry(sessionId)
  let key = piLiveMessageKey(message, fallback)
  if ((message as { role?: unknown }).role === 'assistant') {
    if (entry.activeAssistantKey && entry.activeAssistantKey !== key) {
      entry.messages.delete(entry.activeAssistantKey)
    }
    entry.activeAssistantKey = key
  }
  entry.messages.set(key, message)
}

export function recordPiLiveBashMessage(
  sessionId: string,
  params: {
    command: string
    output: string
    excludeFromContext: boolean
    exitCode?: number
    cancelled?: boolean
    truncated?: boolean
    fullOutputPath?: string
  },
): void {
  recordPiLiveMessage(sessionId, {
    role: 'bashExecution',
    command: params.command,
    output: params.output,
    exitCode: params.exitCode,
    cancelled: params.cancelled ?? false,
    truncated: params.truncated ?? false,
    fullOutputPath: params.fullOutputPath,
    timestamp: Date.now(),
    excludeFromContext: params.excludeFromContext,
  } as unknown as PiAgentMessage, `bash:${params.command}`)
}

export function recordPiLiveTranscriptEvent(sessionId: string, event: PiAgentEvent): void {
  switch (event.type) {
    case 'message_start':
    case 'message_update':
    case 'message_end':
      recordPiLiveMessage(sessionId, event.message, event.type)
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const entry = getPiLiveTranscriptEntry(sessionId)
        entry.activeAssistantKey = undefined
      }
      break
    case 'turn_end':
      recordPiLiveMessage(sessionId, event.message, 'turn_end')
      for (const result of event.toolResults) {
        recordPiLiveMessage(sessionId, result, `turn_end:${result.toolCallId}`)
      }
      break
    default:
      break
  }
}

export function getPiLiveTranscriptMessages(sessionId: string, persisted: PiAgentMessage[]): PiAgentMessage[] {
  const entry = piLiveTranscripts.get(sessionId)
  if (!entry) return []
  const persistedFingerprints = new Set(persisted.map(piAgentMessageFingerprint))
  const persistedDuplicateKeys = new Set(persisted.map(piAgentMessageDuplicateKey))
  const liveMessages: PiAgentMessage[] = []
  for (const message of entry.messages.values()) {
    if (persistedFingerprints.has(piAgentMessageFingerprint(message))) continue
    if (persistedDuplicateKeys.has(piAgentMessageDuplicateKey(message))) continue
    liveMessages.push(message)
  }
  return liveMessages.sort((a, b) => {
    const at = typeof (a as { timestamp?: unknown }).timestamp === 'number' ? (a as { timestamp: number }).timestamp : 0
    const bt = typeof (b as { timestamp?: unknown }).timestamp === 'number' ? (b as { timestamp: number }).timestamp : 0
    return at - bt
  })
}

export function piLiveTranscriptSignature(messages: PiAgentMessage[]): string {
  if (messages.length === 0) return ''
  return messages.map((message) => {
    const record = message as unknown as Record<string, unknown>
    const role = typeof record.role === 'string' ? record.role : ''
    const timestamp = typeof record.timestamp === 'number' ? record.timestamp : ''
    return `${role}:${timestamp}:${piAgentMessageFingerprint(message)}`
  }).join('|')
}
