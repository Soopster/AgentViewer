import { NextRequest } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { listViewSessionMessageWindow, readViewSessionInfo } from '@/lib/sessionBackend'
import { subscribeToOpenCodeEvents } from '@/lib/opencodeHarness'
import { subscribeToCodexEvents } from '@/lib/codexHarness'
import { subscribeToClaudeEvents } from '@/lib/claudeHarness'
import { subscribeToLiveSessionEvents } from '@/lib/liveSessionHarness'
import type { AgentProvider, SessionMessage } from '@/lib/types'
import type { ErrorNotification, TurnPlanUpdatedNotification } from '@/lib/codex-schema/v2'

// Vercel-only knob (no-op on the self-hosted Node server) — generous so a
// long-running turn's live event stream isn't truncated on that platform.
export const maxDuration = 3600

const DEFAULT_STREAM_LIMIT = 220
const MAX_STREAM_LIMIT = 500
const DEFAULT_BACKFILL = 20
const MAX_BACKFILL = 100
const MESSAGE_STREAM_POLL_MS = 1500
const HEARTBEAT_MS = 20_000
const GENERIC_REFETCH_DEBOUNCE_MS = 80

// OpenCode opens a persistent event subscription via the harness, so we
// drive message refreshes off the live event stream instead of timed
// polling. The fallback ms backstop catches anything the SDK might miss.
const OPENCODE_FALLBACK_POLL_MS = 2_000
// Coalesce bursts of message.part.updated into one refetch per ~80ms so a
// fast-streaming reply doesn't trigger one DB read per token. This matches
// the cadence at which opencode-web batches its store updates.
const OPENCODE_REFETCH_DEBOUNCE_MS = 80
// Streaming chunk events are noisy — the send stream already forwards the
// raw OpenCode part updates/deltas for live text. Refetch the persisted log
// at most once a second as a safety net so missed stream events still surface,
// without flooding the SDK.
const OPENCODE_STREAMING_REFETCH_DEBOUNCE_MS = 1000

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseOffset(value: string | null): number {
  const parsed = parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

// SessionMessage objects are immutable across reads: the mapped-message LRU
// cache returns the same array (same object refs) on an unchanged transcript,
// and any change rebuilds a fresh array of fresh objects. So a given reference
// always yields the same signature — cache by identity to avoid re-serializing
// every unchanged window message on idle/heartbeat refetch ticks. The WeakMap
// self-collects when an evicted cache array drops its objects.
const messageSigCache = new WeakMap<SessionMessage, string>()
function messageSignature(message: SessionMessage): string {
  const cached = messageSigCache.get(message)
  if (cached !== undefined) return cached
  let payload = ''
  try {
    payload = JSON.stringify(message.message)
  } catch {
    payload = String(message.message)
  }
  const signature = [
    message.uuid,
    message.type,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    message.parent_tool_use_id ?? '',
    hashString(payload),
  ].join(':')
  messageSigCache.set(message, signature)
  return signature
}

function messageWindowSignature(offset: number, messages: SessionMessage[]): string {
  if (messages.length === 0) return `${offset}:0:`
  return `${offset}:${messages.length}:${messages.map(messageSignature).join('|')}`
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function messageWindowPayload(
  sessionId: string,
  provider: AgentProvider | undefined,
  window: Awaited<ReturnType<typeof listViewSessionMessageWindow>>,
  replace = false,
) {
  return {
    sessionId,
    provider,
    ...window,
    ...(replace ? { replace: true } : {}),
  }
}

async function readReplacementWindow(sessionId: string, provider: AgentProvider | undefined, limit: number) {
  const window = await listViewSessionMessageWindow(sessionId, { offset: 0, limit, tail: true }, provider)
  return messageWindowPayload(sessionId, provider, window, true)
}

async function getEventsResponse(
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

      if (provider === 'codex') {
        void pumpCodex({
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

      if (provider === 'claude') {
        void pumpClaude({
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

      void pumpGenericLiveSession({
        sessionId,
        provider,
        limit,
        backfill,
        offset,
        enqueue,
        close,
        signal: request.signal,
      })
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

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const rawProvider = new URL(request.url).searchParams.get('provider')
  const provider = isAgentProvider(rawProvider) ? rawProvider : undefined
  return withProviderRequest(request, provider, undefined, () => getEventsResponse(request, context))
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

type GenericPumpInput = Omit<OpenCodePumpInput, 'provider'> & {
  provider: AgentProvider | undefined
}

async function pumpGenericLiveSession({ sessionId, provider, limit, backfill, offset, enqueue, close, signal }: GenericPumpInput): Promise<void> {
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
      const window = await listViewSessionMessageWindow(
        sessionId,
        { offset: cursorOffset, limit, tail: false },
        provider,
      )
      if (window.messages.length === 0 && window.total < cursorOffset) {
        const replacement = await readReplacementWindow(sessionId, provider, limit)
        enqueue('messages', replacement)
        lastSignature = messageWindowSignature(replacement.offset, replacement.messages)
        cursorOffset = Math.max(0, replacement.offset + replacement.messages.length - backfill)
        return
      }
      const signature = messageWindowSignature(window.offset, window.messages)
      if (window.messages.length > 0 && signature !== lastSignature) {
        enqueue('messages', messageWindowPayload(sessionId, provider, window))
        lastSignature = signature
        cursorOffset = Math.max(0, window.offset + window.messages.length - backfill)
        if (window.offset + window.messages.length < window.total) {
          pending = true
        }
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
    }, GENERIC_REFETCH_DEBOUNCE_MS)
  }

  const scheduleFallback = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer)
    fallbackTimer = setTimeout(() => {
      if (signal.aborted) return
      void refetch()
      scheduleFallback()
    }, MESSAGE_STREAM_POLL_MS)
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

  const subscription = subscribeToLiveSessionEvents({ sessionId, provider })
  let consumeAborted = false
  const consume = (async () => {
    for await (const event of subscription.events) {
      if (consumeAborted) break
      switch (event.type) {
        case 'activity':
        case 'turn-start':
        case 'turn-end':
        case 'recycled':
          scheduleRefetch()
          break
        case 'connected':
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

  await refetch()
  scheduleFallback()
  scheduleHeartbeat()

  await consume.catch(() => {})
  if (!signal.aborted) {
    onAbort()
  }
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
      const window = await listViewSessionMessageWindow(
        sessionId,
        { offset: cursorOffset, limit, tail: false },
        provider,
      )
      if (window.messages.length === 0 && window.total < cursorOffset) {
        const replacement = await readReplacementWindow(sessionId, provider, limit)
        enqueue('messages', replacement)
        lastSignature = messageWindowSignature(replacement.offset, replacement.messages)
        cursorOffset = Math.max(0, replacement.offset + replacement.messages.length - backfill)
        return
      }
      const signature = messageWindowSignature(window.offset, window.messages)
      if (window.messages.length > 0 && signature !== lastSignature) {
        enqueue('messages', messageWindowPayload(sessionId, provider, window))
        lastSignature = signature
        cursorOffset = Math.max(0, window.offset + window.messages.length - backfill)
        if (window.offset + window.messages.length < window.total) {
          pending = true
        }
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

  const scheduleRefetch = (debounceMs: number = OPENCODE_REFETCH_DEBOUNCE_MS) => {
    if (signal.aborted) return
    if (refetchTimer) return
    refetchTimer = setTimeout(() => {
      refetchTimer = undefined
      void refetch()
    }, debounceMs)
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

  // opencode ≥1.17 delivers session events only on the directory-scoped bus,
  // so the subscription needs the session's working directory.
  const sessionDirectory = await readViewSessionInfo(sessionId, provider)
    .then((info) => info?.cwd ?? undefined)
    .catch(() => undefined)
  const subscription = subscribeToOpenCodeEvents({ sessionId, directory: sessionDirectory })
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
        // Lifecycle events — refetch quickly so message boundaries
        // settle into the persisted timeline.
        case 'message.updated':
        case 'message.removed':
        case 'message.part.removed':
        case 'session.compacted':
        case 'session.idle':
          scheduleRefetch()
          break
        // Streaming chunk — the live text in MessageView is driven by the
        // send-stream's raw OpenCode part updates/deltas, but we also want a
        // periodic safety-net refresh of the persisted timeline so any missed
        // stream event still surfaces. Throttle aggressively so a fast reply
        // doesn't trigger dozens of SDK reads.
        case 'message.part.updated':
          scheduleRefetch(OPENCODE_STREAMING_REFETCH_DEBOUNCE_MS)
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

// Claude shares the harness/refetch pattern with codex/opencode. The claudePool
// fans every message of a session's live Query out through the Claude harness,
// so we refetch the canonical persisted window on each broadcast instead of the
// fixed 1500ms poll the generic pump used. This makes the transcript update in
// real time for *any* observer (a second tab, a page reloaded mid-turn), not
// just the tab that started the turn over the POST send stream.
const CLAUDE_REFETCH_DEBOUNCE_MS = 80
// Slower than codex/opencode's 30s: the pool isn't the only writer to a Claude
// session — the user can run the `claude` CLI against the same session id out
// of band — so a moderate safety-net poll still surfaces external writes
// promptly without the chattiness of the old 1500ms loop.
const CLAUDE_FALLBACK_POLL_MS = 4000

async function pumpClaude({ sessionId, provider, limit, backfill, offset, enqueue, close, signal }: OpenCodePumpInput): Promise<void> {
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
      const window = await listViewSessionMessageWindow(
        sessionId,
        { offset: cursorOffset, limit, tail: false },
        provider,
      )
      if (window.messages.length === 0 && window.total < cursorOffset) {
        const replacement = await readReplacementWindow(sessionId, provider, limit)
        enqueue('messages', replacement)
        lastSignature = messageWindowSignature(replacement.offset, replacement.messages)
        cursorOffset = Math.max(0, replacement.offset + replacement.messages.length - backfill)
        return
      }
      const signature = messageWindowSignature(window.offset, window.messages)
      if (window.messages.length > 0 && signature !== lastSignature) {
        enqueue('messages', messageWindowPayload(sessionId, provider, window))
        lastSignature = signature
        cursorOffset = Math.max(0, window.offset + window.messages.length - backfill)
        if (window.offset + window.messages.length < window.total) {
          pending = true
        }
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
    }, CLAUDE_REFETCH_DEBOUNCE_MS)
  }

  const scheduleFallback = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer)
    fallbackTimer = setTimeout(() => {
      if (signal.aborted) return
      void refetch()
      scheduleFallback()
    }, CLAUDE_FALLBACK_POLL_MS)
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

  const subscription = subscribeToClaudeEvents({ sessionId })

  let consumeAborted = false
  const consume = (async () => {
    for await (const event of subscription.events) {
      if (consumeAborted) break
      switch (event.type) {
        // Live activity on the session's Query, a turn boundary, or the pool
        // entry dying — in every case the persisted window may have changed,
        // so refetch (debounced) and let the signature bail-out drop no-ops.
        case 'message':
        case 'turn-start':
        case 'turn-end':
        case 'recycled':
          scheduleRefetch()
          break
        case 'connected':
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

// Codex shares the harness/refetch pattern with opencode. Mirrors
// pumpOpenCode but consumes codex JSON-RPC notifications.
const CODEX_FALLBACK_POLL_MS = 30_000
const CODEX_REFETCH_DEBOUNCE_MS = 80

async function pumpCodex({ sessionId, provider, limit, backfill, offset, enqueue, close, signal }: OpenCodePumpInput): Promise<void> {
  let lastSignature = ''
  // Tracked separately from lastSignature: another Codex client grabbing or
  // releasing the rollout writer lock can flip this while the (stale-cached)
  // transcript signature stays byte-identical, so the signature check alone
  // would silently drop the flag flip and the client's sync banner would
  // never appear or clear.
  let lastExternalWriter = false
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
      const window = await listViewSessionMessageWindow(
        sessionId,
        { offset: cursorOffset, limit, tail: false },
        provider,
      )
      if (window.messages.length === 0 && window.total < cursorOffset) {
        const replacement = await readReplacementWindow(sessionId, provider, limit)
        enqueue('messages', replacement)
        lastSignature = messageWindowSignature(replacement.offset, replacement.messages)
        lastExternalWriter = replacement.externalWriter === true
        cursorOffset = Math.max(0, replacement.offset + replacement.messages.length - backfill)
        return
      }
      const signature = messageWindowSignature(window.offset, window.messages)
      const externalWriter = window.externalWriter === true
      const externalWriterChanged = externalWriter !== lastExternalWriter
      if (window.messages.length > 0 && (signature !== lastSignature || externalWriterChanged)) {
        enqueue('messages', messageWindowPayload(sessionId, provider, window))
        lastSignature = signature
        lastExternalWriter = externalWriter
        cursorOffset = Math.max(0, window.offset + window.messages.length - backfill)
        if (window.offset + window.messages.length < window.total) {
          pending = true
        }
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
    }, CODEX_REFETCH_DEBOUNCE_MS)
  }

  const scheduleFallback = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer)
    fallbackTimer = setTimeout(() => {
      if (signal.aborted) return
      void refetch()
      scheduleFallback()
    }, CODEX_FALLBACK_POLL_MS)
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

  const subscription = subscribeToCodexEvents({ threadId: sessionId })
  // Replay the cached structured plan so a late subscriber sees the panel
  // populated without having to wait for the next update_plan call.
  const cached = subscription.snapshot
  if (cached?.plan && cached.plan.plan.length > 0) {
    enqueue('plan', { sessionId, plan: cached.plan.plan, explanation: cached.plan.explanation })
  }
  let consumeAborted = false
  const consume = (async () => {
    for await (const event of subscription.events) {
      if (consumeAborted) break
      if (event.type !== 'notification') continue
      const method = event.notification.method
      // Refetch on lifecycle events that mutate the persisted thread log.
      if (
        method === 'item/started'
        || method === 'item/completed'
        || method === 'turn/started'
        || method === 'turn/completed'
        || method === 'thread/closed'
        || method === 'thread/archived'
        || method === 'thread/name/updated'
        || method === 'thread/goal/updated'
      ) {
        scheduleRefetch()
        continue
      }
      if (method === 'turn/plan/updated') {
        const params = event.notification.params as TurnPlanUpdatedNotification
        // params.plan is Array<TurnPlanStep> with step:string, status enum;
        // still guard the field shape because the wire payload is untyped.
        const steps = params.plan
          .map((entry) => ({
            step: entry.step,
            status: entry.status,
          }))
          .filter((s) => s.step.length > 0)
        enqueue('plan', {
          sessionId,
          plan: steps,
          explanation: params.explanation,
        })
        continue
      }
      if (method === 'error') {
        // ErrorNotification carries a TurnError on `.error`, not a flat message.
        const params = event.notification.params as ErrorNotification
        enqueue('error', { error: params.error?.message ?? 'Codex error' })
        close()
        return
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

  await refetch()
  scheduleFallback()
  scheduleHeartbeat()

  await consume.catch(() => {})
  if (!signal.aborted) {
    onAbort()
  }
}
