import type { Todo as OpenCodeTodo } from '@opencode-ai/sdk'
import type { CodexPlanStep } from '@/lib/taskRegistry'
import type { AgentProvider, Session, SessionMessage } from '@/lib/types'

export const MESSAGE_POLL_BACKFILL = 20
export const MESSAGE_STREAM_LIMIT = 200 + MESSAGE_POLL_BACKFILL
const POLL_FALLBACK_MS = 2000
const RETRY_INITIAL_MS = 2000
const RETRY_MAX_MS = 30000

export type SessionPlan = {
  plan: CodexPlanStep[]
  explanation: string | null
}

export type MessageStreamPayload = {
  sessionId?: string
  provider?: AgentProvider
  offset?: number
  total?: number
  messages?: SessionMessage[]
  replace?: boolean
  externalWriter?: boolean
}

function messageEventsPath(session: Session, offset: number): string {
  const params = new URLSearchParams()
  params.set('offset', String(offset))
  params.set('limit', String(MESSAGE_STREAM_LIMIT))
  params.set('backfill', String(MESSAGE_POLL_BACKFILL))
  if (session.provider) params.set('provider', session.provider)
  if (session.providerInstanceId) params.set('providerInstanceId', session.providerInstanceId)
  return `/api/sessions/${encodeURIComponent(session.sessionId)}/messages/events?${params.toString()}`
}

type MessageStreamOptions = {
  session: Session
  getOffset: () => number
  onMessages: (payload: MessageStreamPayload, session: Session) => void
  onTodos: (todos: OpenCodeTodo[]) => void
  onPlan: (plan: SessionPlan) => void
  poll: (session: Session, signal: AbortSignal) => Promise<void>
}

/** Owns one connection and its fallback/retry timers. Disposal also fences
 * queued events from a closed source so they cannot update a replacement tab. */
export function connectSessionMessageStream({
  session, getOffset, onMessages, onTodos, onPlan, poll,
}: MessageStreamOptions): () => void {
  const abort = new AbortController()
  let disposed = false
  let source: EventSource | null = null
  let fallbackInterval: number | null = null
  let retryTimeout: number | null = null
  let retryDelay = RETRY_INITIAL_MS
  let polling = false

  const stopFallback = () => {
    if (fallbackInterval === null) return
    window.clearInterval(fallbackInterval)
    fallbackInterval = null
  }
  const pollOnce = async () => {
    if (disposed || polling) return
    polling = true
    try { await poll(session, abort.signal) } catch { /* retry on the next fallback tick */ }
    finally { polling = false }
  }
  const startFallback = () => {
    if (fallbackInterval !== null) return
    void pollOnce()
    fallbackInterval = window.setInterval(() => { void pollOnce() }, POLL_FALLBACK_MS)
  }
  const connect = () => {
    if (disposed) return
    if (typeof EventSource === 'undefined') {
      startFallback()
      return
    }
    const current = new EventSource(messageEventsPath(session, getOffset()))
    source = current
    const active = () => !disposed && source === current
    current.onopen = () => {
      if (!active()) return
      retryDelay = RETRY_INITIAL_MS
      stopFallback()
    }
    current.addEventListener('messages', event => {
      if (!active()) return
      try {
        onMessages(JSON.parse((event as MessageEvent<string>).data) as MessageStreamPayload, session)
      } catch { /* ignore malformed stream payloads */ }
    })
    current.addEventListener('todos', event => {
      if (!active()) return
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { sessionId?: string; todos?: OpenCodeTodo[] }
        if (payload.sessionId !== session.sessionId) return
        onTodos(Array.isArray(payload.todos) ? payload.todos : [])
      } catch { /* ignore malformed stream payloads */ }
    })
    current.addEventListener('plan', event => {
      if (!active()) return
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as Partial<SessionPlan> & { sessionId?: string }
        if (payload.sessionId !== session.sessionId) return
        onPlan({
          plan: Array.isArray(payload.plan) ? payload.plan : [],
          explanation: typeof payload.explanation === 'string' ? payload.explanation : null,
        })
      } catch { /* ignore malformed stream payloads */ }
    })
    current.onerror = () => {
      if (!active()) return
      current.close()
      source = null
      startFallback()
      if (retryTimeout !== null) return
      retryTimeout = window.setTimeout(() => {
        retryTimeout = null
        connect()
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    }
  }
  connect()
  return () => {
    disposed = true
    abort.abort()
    source?.close()
    source = null
    stopFallback()
    if (retryTimeout !== null) window.clearTimeout(retryTimeout)
  }
}
