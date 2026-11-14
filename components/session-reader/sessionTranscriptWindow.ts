import { mergeOrderedSessionMessageWindow } from '@/lib/sessionMessageWindow'
import type { Session, SessionMessage } from '@/lib/types'
import { MESSAGE_POLL_BACKFILL, type MessageStreamPayload } from './messageStream'
import { mergeMessages } from './messageMerge'

export function numericOffset(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

// Live tails stay bounded; deep links retain their full anchored history.
const SINGLE_SESSION_MESSAGE_MEMORY_LIMIT = 3000
export type SessionTranscriptWindow = {
  messages: SessionMessage[]
  count: number
  cursorUuid?: string
  fullTranscript: boolean
  externalWriter: boolean
}
export function emptySessionTranscript(): SessionTranscriptWindow {
  return { messages: [], count: 0, fullTranscript: false, externalWriter: false }
}

export function applySessionTranscriptWindow(
  previous: SessionTranscriptWindow, payload: MessageStreamPayload, session: Session,
): SessionTranscriptWindow {
  if (payload.sessionId && payload.sessionId !== session.sessionId) return previous
  if (payload.provider && payload.provider !== (session.provider ?? 'claude')) return previous
  const incoming = Array.isArray(payload.messages)
    ? payload.messages.map(message => message.providerInstanceId ? message : { ...message, providerInstanceId: session.providerInstanceId })
    : []
  const offset = numericOffset(payload.offset, Math.max(0, previous.count - incoming.length))
  const nextOffset = offset + incoming.length
  const total = numericOffset(payload.total, nextOffset)
  const replace = payload.replace === true || total < previous.count
  const externalWriter = session.provider === 'codex' ? payload.externalWriter === true : previous.externalWriter
  let next: SessionTranscriptWindow
  if (!incoming.length) {
    next = replace
      ? { messages: [], count: total, fullTranscript: false, externalWriter }
      : { ...previous, externalWriter }
  } else {
    const count = replace ? nextOffset : Math.max(previous.count, nextOffset)
    const fullTranscript = !replace && previous.fullTranscript
    const cursorIndex = incoming.length - MESSAGE_POLL_BACKFILL
    const cursorUuid = count === nextOffset && cursorIndex >= 0 ? incoming[cursorIndex]?.uuid : undefined
    let messages = replace ? incoming
      : mergeOrderedSessionMessageWindow(previous.messages, incoming, { offset, previousTotal: previous.count })
        ?? mergeMessages(previous.messages, incoming)
    if (!fullTranscript && messages.length > SINGLE_SESSION_MESSAGE_MEMORY_LIMIT) {
      messages = messages.slice(-SINGLE_SESSION_MESSAGE_MEMORY_LIMIT)
    }
    next = { messages, count, cursorUuid, fullTranscript, externalWriter }
  }
  return next.messages === previous.messages && next.count === previous.count
    && next.cursorUuid === previous.cursorUuid && next.fullTranscript === previous.fullTranscript
    && next.externalWriter === previous.externalWriter ? previous : next
}
