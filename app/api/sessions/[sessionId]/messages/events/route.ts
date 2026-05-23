import { NextRequest } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { listViewSessionMessages } from '@/lib/sessionBackend'
import { subscribeToOpenCodeEvents } from '@/lib/opencodeHarness'
import type { AgentProvider, SessionMessage } from '@/lib/types'

export const maxDuration = 300

const DEFAULT_STREAM_LIMIT = 220
const MAX_STREAM_LIMIT = 500
const DEFAULT_BACKFILL = 20
const MAX_BACKFILL = 100
const MESSAGE_STREAM_POLL_MS = 1500
const HEARTBEAT_MS = 20_000

// OpenCode opens a persistent event subscription via the harness, so we
// drive message refreshes off the live event stream instead of timed
// polling. The fallback ms backstop catches anything the SDK might miss.
const OPENCODE_FALLBACK_POLL_MS = 30_000
// Coalesce bursts of message.part.updated into one refetch per ~80ms so a
// fast-streaming reply doesn't trigger one DB read per token. This matches
// the cadence at which opencode-web batches its store updates.
const OPENCODE_REFETCH_DEBOUNCE_MS = 80

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseOffset(value: string | null): number {
  const parsed = parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function messageWindowSignature(offset: number, messages: SessionMessage[]): string {
  if (messages.length === 0) return `${offset}:0:`
  const tail = messages[messages.length - 1]
  return `${offset}:${messages.length}:${tail.uuid}:${tail.type}:${tail.timestamp ?? ''}:${tail.turnId ?? ''}:${tail.origin?.kind ?? ''}`
}

function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const providerParam = searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined
  const limit = parsePositiveInt(searchParams.get('limit'), DEFAULT_STREAM_LIMIT, MAX_STREAM_LIMIT)
  const backfill = parsePositiveInt(searchParams.get('backfill'), DEFAULT_BACKFILL, MAX_BACKFILL)
  let offset = parseOffset(searchParams.get('offset'))

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* stream was already closed by the runtime */
        }
      }

      if (provider === 'opencode') {
        void pumpOpenCode({
          sessionId,
          provider,
          limit,
          backfill,
          offset,
          enqueue,
          close,
          signal: request.signal,
        })
        return
      }

      const pump = async () => {
        let lastSignature = ''
        let lastHeartbeat = Date.now()

        while (!closed && !request.signal.aborted) {
          try {
            const messages = await listViewSessionMessages(
              sessionId,
              { offset, limit, tail: false },
              provider,
            )
            const signature = messageWindowSignature(offset, messages)
            if (messages.length > 0 && signature !== lastSignature) {
              enqueue('messages', { offset, messages })
              lastSignature = signature
              offset = Math.max(0, offset + messages.length - backfill)
            }

            const now = Date.now()
            if (now - lastHeartbeat >= HEARTBEAT_MS) {
              enqueue('heartbeat', { ts: now })
              lastHeartbeat = now
            }

            const shouldContinue = await wait(MESSAGE_STREAM_POLL_MS, request.signal)
            if (!shouldContinue) break
          } catch (err) {
            enqueue('error', { error: err instanceof Error ? err.message : 'Unknown error' })
            break
          }
        }

        close()
      }

      void pump()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

type OpenCodePumpInput = {
  sessionId: string
  provider: AgentProvider
  limit: number
  backfill: number
  offset: number
  enqueue: (event: string, data: unknown) => void
  close: () => void
  signal: AbortSignal
}

async function pumpOpenCode({ sessionId, provider, limit, backfill, offset, enqueue, close, signal }: OpenCodePumpInput): Promise<void> {
  // Drive message refreshes off the live event stream. The opencode SDK
  // emits message.updated / message.part.updated / message.removed
  // whenever the persisted log changes — we just need to refetch and
  // re-emit the canonical window.
  let lastSignature = ''
  let cursorOffset = offset
  let lastHeartbeat = Date.now()
  let inFlight = false
  let pending = false
  let refetchTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined

  const refetch = async () => {
    if (inFlight) {
      pending = true
      return
    }
    inFlight = true
    try {
      const messages = await listViewSessionMessages(
        sessionId,
        { offset: cursorOffset, limit, tail: false },
        provider,
      )
      const signature = messageWindowSignature(cursorOffset, messages)
      if (messages.length > 0 && signature !== lastSignature) {
        enqueue('messages', { offset: cursorOffset, messages })
        lastSignature = signature
        cursorOffset = Math.max(0, cursorOffset + messages.length - backfill)
      }
    } catch (err) {
      enqueue('error', { error: err instanceof Error ? err.message : 'Unknown error' })
      close()
      return
    } finally {
      inFlight = false
    }
    if (pending && !signal.aborted) {
      pending = false
      void refetch()
    }
  }

  const scheduleRefetch = () => {
    if (signal.aborted) return
    if (refetchTimer) return
    refetchTimer = setTimeout(() => {
      refetchTimer = undefined
      void refetch()
    }, OPENCODE_REFETCH_DEBOUNCE_MS)
  }

  const scheduleFallback = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer)
    fallbackTimer = setTimeout(() => {
      if (signal.aborted) return
      void refetch()
      scheduleFallback()
    }, OPENCODE_FALLBACK_POLL_MS)
  }

  const scheduleHeartbeat = () => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer)
    heartbeatTimer = setTimeout(() => {
      if (signal.aborted) return
      const now = Date.now()
      if (now - lastHeartbeat >= HEARTBEAT_MS) {
        enqueue('heartbeat', { ts: now })
        lastHeartbeat = now
      }
      scheduleHeartbeat()
    }, HEARTBEAT_MS)
  }

  const subscription = subscribeToOpenCodeEvents({ sessionId })
  const cached = subscription.snapshot
  if (cached?.todos) {
    enqueue('todos', { sessionId, todos: cached.todos })
  }

  let consumeAborted = false
  const consume = (async () => {
    for await (const item of subscription.events) {
      if (consumeAborted) break
      if (item.type !== 'event') continue
      const event = item.event
      switch (event.type) {
        case 'message.updated':
        case 'message.removed':
        case 'message.part.updated':
        case 'message.part.removed':
        case 'session.compacted':
        case 'session.idle':
          scheduleRefetch()
          break
        case 'todo.updated':
          enqueue('todos', { sessionId, todos: event.properties.todos })
          break
        case 'session.error':
          enqueue('error', { error: errorMessage(event.properties.error) })
          close()
          return
        case 'session.deleted':
          if (event.properties.info.id === sessionId) {
            close()
            return
          }
          break
        default:
          break
      }
    }
  })()

  const onAbort = () => {
    consumeAborted = true
    subscription.close()
    if (refetchTimer) clearTimeout(refetchTimer)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    if (heartbeatTimer) clearTimeout(heartbeatTimer)
    close()
  }
  if (signal.aborted) {
    onAbort()
    return
  }
  signal.addEventListener('abort', onAbort, { once: true })

  // Prime the connection with the current message window and start the
  // periodic fallback tick.
  await refetch()
  scheduleFallback()
  scheduleHeartbeat()

  await consume.catch(() => {})
  if (!signal.aborted) {
    onAbort()
  }
}

function errorMessage(error: unknown): string {
  if (!error) return 'Unknown OpenCode session error'
  if (typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data
    if (data && typeof data === 'object' && 'message' in data) {
      const message = (data as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return 'Unknown OpenCode session error'
}
