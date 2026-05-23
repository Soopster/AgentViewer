import { getOpenCodeClient } from './opencodeClient'
import type {
  Agent as OpenCodeAgent,
  Command as OpenCodeCommand,
  ConfigProvidersResponse as OpenCodeConfigProvidersResponse,
  Event as OpenCodeEvent,
  FormatterStatus as OpenCodeFormatterStatus,
  LspStatus as OpenCodeLspStatus,
  McpStatus as OpenCodeMcpStatus,
  Permission as OpenCodePermission,
  SessionStatus as OpenCodeSessionStatus,
  Todo as OpenCodeTodo,
} from '@opencode-ai/sdk'

// Mirror of packages/app/src/context/global-sdk.tsx — opencode's web app
// owns one event subscription per server connection and multiplexes the
// stream to every consumer. Doing the same here means:
//   1. The SDK doesn't open a new SSE connection per send turn.
//   2. We can coalesce `message.part.updated` events the same way opencode
//      does (16ms frame budget per part), so streaming text stays smooth
//      under high token throughput.
//   3. Session state (status, todos, permissions, diffs) is cached and
//      replayed to new subscribers — late-joining tabs see the same state
//      opencode would have shown them.
//   4. A heartbeat + reconnect keeps the channel healthy across server
//      restarts, the same way opencode-web does.

const FLUSH_FRAME_MS = 16
const STREAM_YIELD_MS = 8
const RECONNECT_DELAY_MS = 250
const HEARTBEAT_TIMEOUT_MS = 15_000

export type HarnessEvent =
  | { type: 'event'; event: OpenCodeEvent; sessionId?: string }
  | { type: 'delta'; sessionId: string; messageId: string; partId: string; partType: string; field: string; delta: string }
  | { type: 'snapshot'; sessionId: string; snapshot: SessionSnapshot }
  | { type: 'disconnected' }
  | { type: 'connected' }

export type SessionSnapshot = {
  status?: OpenCodeSessionStatus
  todos?: OpenCodeTodo[]
  permissions: OpenCodePermission[]
}

export type ProjectDiagnostics = {
  providers: OpenCodeConfigProvidersResponse
  commands: OpenCodeCommand[]
  agents: OpenCodeAgent[]
  lsp: OpenCodeLspStatus[]
  formatters: OpenCodeFormatterStatus[]
  mcp: Record<string, OpenCodeMcpStatus>
}

type DiagnosticsCacheEntry = {
  value: ProjectDiagnostics
  fetchedAt: number
  stale: boolean
}

// Project-level diagnostics rarely change — providers, agents, commands,
// formatters, MCP servers are configured once and stay put. We refresh
// only when an event signals a relevant change, or after a TTL backstop.
const DIAGNOSTICS_TTL_MS = 30_000

type Subscriber = {
  sessionId?: string
  push(event: HarnessEvent): void
  done(): void
}

type Queued = { event: OpenCodeEvent; key?: string }

function eventSessionId(event: OpenCodeEvent): string | undefined {
  switch (event.type) {
    case 'message.updated':
      return event.properties.info.sessionID
    case 'message.removed':
      return event.properties.sessionID
    case 'message.part.updated':
      return event.properties.part.sessionID
    case 'message.part.removed':
      return event.properties.sessionID
    case 'permission.updated':
      return event.properties.sessionID
    case 'permission.replied':
      return event.properties.sessionID
    case 'session.status':
      return event.properties.sessionID
    case 'session.idle':
      return event.properties.sessionID
    case 'session.compacted':
      return event.properties.sessionID
    case 'todo.updated':
      return event.properties.sessionID
    case 'command.executed':
      return event.properties.sessionID
    case 'session.created':
      return event.properties.info.id
    case 'session.updated':
      return event.properties.info.id
    case 'session.deleted':
      return event.properties.info.id
    case 'session.diff':
      return event.properties.sessionID
    case 'session.error':
      return event.properties.sessionID
    default: {
      const props = (event as { properties?: unknown }).properties
      if (!props || typeof props !== 'object') return undefined
      const value = (props as Record<string, unknown>).sessionID
      return typeof value === 'string' ? value : undefined
    }
  }
}

function coalesceKey(event: OpenCodeEvent): string | undefined {
  switch (event.type) {
    case 'session.status':
      return `session.status:${event.properties.sessionID}`
    case 'session.idle':
      return `session.idle:${event.properties.sessionID}`
    case 'lsp.updated':
      return `lsp.updated`
    case 'message.part.updated': {
      const part = event.properties.part
      // `delta` fragments carry incremental text; coalescing them would lose
      // characters. Only coalesce full part-state updates, keyed by partID.
      if (event.properties.delta) return undefined
      return `message.part.updated:${part.messageID}:${part.id}`
    }
    default:
      return undefined
  }
}

class OpenCodeHarness {
  private subscribers = new Set<Subscriber>()
  private snapshots = new Map<string, SessionSnapshot>()
  private queue: Queued[] = []
  private buffer: Queued[] = []
  private coalesced = new Map<string, number>()
  private staleDeltas = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private lastFlushAt = 0
  private streamErrorLogged = false
  private lastEventAt = Date.now()
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  private attemptController: AbortController | undefined
  private runPromise: Promise<void> | undefined
  private started = false
  private connected = false
  private diagnosticsCache = new Map<string, DiagnosticsCacheEntry>()
  private diagnosticsInflight = new Map<string, Promise<ProjectDiagnostics>>()

  subscribe(options: { sessionId?: string } = {}): {
    snapshot: SessionSnapshot | undefined
    events: AsyncGenerator<HarnessEvent>
    close: () => void
  } {
    this.start()

    const queue: HarnessEvent[] = []
    const waiters: Array<(value: IteratorResult<HarnessEvent>) => void> = []
    let closed = false

    const subscriber: Subscriber = {
      sessionId: options.sessionId,
      push: (event) => {
        if (closed) return
        const waiter = waiters.shift()
        if (waiter) waiter({ value: event, done: false })
        else queue.push(event)
      },
      done: () => {
        if (closed) return
        closed = true
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as unknown as HarnessEvent, done: true })
        }
      },
    }

    this.subscribers.add(subscriber)

    // Replay current connection state so the new consumer knows whether
    // upstream is healthy — matches opencode-web's behavior of immediately
    // reflecting connection state.
    if (this.connected) {
      subscriber.push({ type: 'connected' })
    }

    const snapshot = options.sessionId ? this.snapshots.get(options.sessionId) : undefined

    const generator = (async function* (): AsyncGenerator<HarnessEvent> {
      try {
        while (true) {
          if (closed && queue.length === 0) return
          const next = queue.shift()
          if (next) {
            yield next
            continue
          }
          const result = await new Promise<IteratorResult<HarnessEvent>>((resolve) => {
            waiters.push(resolve)
          })
          if (result.done) return
          yield result.value
        }
      } finally {
        closed = true
      }
    })()

    return {
      snapshot,
      events: generator,
      close: () => {
        if (closed) return
        closed = true
        this.subscribers.delete(subscriber)
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as unknown as HarnessEvent, done: true })
        }
      },
    }
  }

  /**
   * Forwards a one-off opencode event into the harness (e.g. when the
   * caller already has a live event from somewhere else). Used in tests.
   */
  ingest(event: OpenCodeEvent): void {
    this.handleEvent(event)
  }

  getSnapshot(sessionId: string): SessionSnapshot | undefined {
    return this.snapshots.get(sessionId)
  }

  ensureStarted(): void {
    this.start()
  }

  private start(): void {
    if (this.started) return
    this.started = true
    this.runPromise = this.run().finally(() => {
      this.runPromise = undefined
    })
  }

  private async run(): Promise<void> {
    // Reconnect with backoff that grows on consecutive failures — the
    // opencode server may be slow to start or temporarily unreachable.
    let failures = 0

    while (this.started) {
      this.attemptController = new AbortController()
      this.lastEventAt = Date.now()
      let receivedAny = false
      try {
        const client = await getOpenCodeClient()
        const events = await client.event.subscribe({
          responseStyle: 'data',
          throwOnError: true,
          signal: this.attemptController.signal,
          onSseError: (error) => {
            if (this.isAbortError(error)) return
            if (this.streamErrorLogged) return
            this.streamErrorLogged = true
            console.error('[opencode-harness] event stream error', error)
          },
        })

        this.markConnected()
        this.resetHeartbeat()
        let yielded = Date.now()
        for await (const event of events.stream) {
          receivedAny = true
          this.resetHeartbeat()
          this.streamErrorLogged = false
          this.enqueueEvent(event as OpenCodeEvent)

          if (Date.now() - yielded < STREAM_YIELD_MS) continue
          yielded = Date.now()
          await this.wait(0)
        }
      } catch (error) {
        if (!this.isAbortError(error) && !this.streamErrorLogged) {
          this.streamErrorLogged = true
          console.error('[opencode-harness] event stream failed', error)
        }
      } finally {
        this.clearHeartbeat()
        this.attemptController = undefined
        this.markDisconnected()
      }

      if (!this.started) return

      // Reset failure backoff once we've successfully received any event —
      // long-lived sessions shouldn't be punished for a transient drop.
      if (receivedAny) failures = 0
      else failures = Math.min(failures + 1, 6)

      const backoff = receivedAny
        ? RECONNECT_DELAY_MS
        : Math.min(RECONNECT_DELAY_MS * 2 ** failures, 30_000)
      await this.wait(backoff)
    }
  }

  private resetHeartbeat(): void {
    this.lastEventAt = Date.now()
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = setTimeout(() => {
      // Pull the rug on the current attempt — the outer loop reconnects.
      this.attemptController?.abort()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private isAbortError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError'
  }

  private enqueueEvent(event: OpenCodeEvent): void {
    // Delta-bearing `message.part.updated` events drive live text
    // streaming. There's nothing to coalesce (the SDK already throttles
    // them), so pushing them through the 16ms flush window just adds
    // round-trip latency that makes the composer feel laggy. Send them
    // straight to subscribers and let the queue keep batching full
    // snapshots.
    if (event.type === 'message.part.updated' && event.properties.delta) {
      this.handleEvent(event)
      return
    }

    const key = coalesceKey(event)
    if (key) {
      const existing = this.coalesced.get(key)
      if (existing !== undefined) {
        this.queue[existing] = { event, key }
        if (event.type === 'message.part.updated') {
          const part = event.properties.part
          // A full re-publish supersedes any in-flight deltas for the same
          // part — skip them when flushing so the client sees the canonical
          // state, not a torn intermediate.
          this.staleDeltas.add(`${part.messageID}:${part.id}`)
        }
        return
      }
      this.coalesced.set(key, this.queue.length)
    }
    this.queue.push({ event, key })
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    const elapsed = Date.now() - this.lastFlushAt
    this.flushTimer = setTimeout(() => this.flush(), Math.max(0, FLUSH_FRAME_MS - elapsed))
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.queue.length === 0) return

    const events = this.queue
    const stale = this.staleDeltas.size > 0 ? new Set(this.staleDeltas) : undefined
    this.queue = this.buffer
    this.buffer = events
    this.queue.length = 0
    this.coalesced.clear()
    this.staleDeltas.clear()
    this.lastFlushAt = Date.now()

    for (const item of events) {
      const event = item.event
      if (stale && event.type === 'message.part.updated' && event.properties.delta) {
        const part = event.properties.part
        if (stale.has(`${part.messageID}:${part.id}`)) continue
      }
      this.handleEvent(event)
    }
    this.buffer.length = 0
  }

  private handleEvent(event: OpenCodeEvent): void {
    this.applyToSnapshot(event)
    this.invalidateProjectStateFromEvent(event)
    this.broadcast(event)
  }

  private invalidateProjectStateFromEvent(event: OpenCodeEvent): void {
    // Mark cached project diagnostics stale when an event hints that
    // their value may have changed. The next getProjectDiagnostics call
    // will refresh; subsequent ones share that refresh.
    switch (event.type) {
      case 'lsp.updated':
      case 'lsp.client.diagnostics':
      case 'file.watcher.updated':
      case 'session.created':
      case 'session.updated':
      case 'session.deleted':
      case 'installation.updated':
        this.markDiagnosticsStale()
        break
      default:
        break
    }
  }

  private applyToSnapshot(event: OpenCodeEvent): void {
    const sessionId = eventSessionId(event)
    if (!sessionId) return
    const existing = this.snapshots.get(sessionId) ?? { permissions: [] }

    switch (event.type) {
      case 'session.status': {
        existing.status = event.properties.status
        break
      }
      case 'session.idle': {
        existing.status = { type: 'idle' }
        break
      }
      case 'todo.updated': {
        existing.todos = event.properties.todos
        break
      }
      case 'permission.updated': {
        const next = existing.permissions.filter((p) => p.id !== event.properties.id)
        next.push(event.properties)
        existing.permissions = next
        break
      }
      case 'permission.replied': {
        existing.permissions = existing.permissions.filter((p) => p.id !== event.properties.permissionID)
        break
      }
      case 'session.deleted': {
        this.snapshots.delete(sessionId)
        return
      }
      default:
        break
    }
    this.snapshots.set(sessionId, existing)
  }

  private markDiagnosticsStale(): void {
    for (const entry of this.diagnosticsCache.values()) {
      entry.stale = true
    }
  }

  async getProjectDiagnostics(directory: string | undefined): Promise<ProjectDiagnostics> {
    const key = directory ?? ''
    const cached = this.diagnosticsCache.get(key)
    const now = Date.now()
    if (cached && !cached.stale && now - cached.fetchedAt < DIAGNOSTICS_TTL_MS) {
      return cached.value
    }

    const existing = this.diagnosticsInflight.get(key)
    if (existing) return existing

    const fetch = (async () => {
      const client = await getOpenCodeClient()
      const query = directory ? { directory } : undefined
      const opts = { responseStyle: 'data' as const, throwOnError: true as const, query }
      // Single fan-out call. Subsequent requests within the TTL window
      // share this Promise via diagnosticsInflight — no thundering herd.
      const [providers, commands, agents, lsp, formatters, mcp] = await Promise.all([
        client.config.providers(opts),
        client.command.list(opts),
        client.app.agents(opts),
        client.lsp.status(opts),
        client.formatter.status(opts),
        client.mcp.status(opts),
      ])
      const next: ProjectDiagnostics = {
        providers: providers as unknown as OpenCodeConfigProvidersResponse,
        commands: commands as unknown as OpenCodeCommand[],
        agents: agents as unknown as OpenCodeAgent[],
        lsp: lsp as unknown as OpenCodeLspStatus[],
        formatters: formatters as unknown as OpenCodeFormatterStatus[],
        mcp: mcp as unknown as Record<string, OpenCodeMcpStatus>,
      }
      this.diagnosticsCache.set(key, { value: next, fetchedAt: Date.now(), stale: false })
      return next
    })()

    this.diagnosticsInflight.set(key, fetch)
    try {
      return await fetch
    } finally {
      this.diagnosticsInflight.delete(key)
    }
  }

  private broadcast(event: OpenCodeEvent): void {
    const sessionId = eventSessionId(event)
    const dropFor = (subscriber: Subscriber): boolean =>
      !!subscriber.sessionId && !!sessionId && subscriber.sessionId !== sessionId

    // Synthesize a delta-shaped payload alongside the raw event so clients
    // can render streaming text incrementally without diffing the full
    // part text against the previous tick — the same trick opencode-web
    // uses internally to drive smooth output.
    let delta: HarnessEvent | undefined
    if (event.type === 'message.part.updated' && event.properties.delta) {
      const part = event.properties.part
      if (part.type === 'text' || part.type === 'reasoning') {
        delta = {
          type: 'delta',
          sessionId: part.sessionID,
          messageId: part.messageID,
          partId: part.id,
          partType: part.type,
          field: 'text',
          delta: event.properties.delta,
        }
      }
    }

    for (const subscriber of this.subscribers) {
      if (dropFor(subscriber)) continue
      subscriber.push({ type: 'event', event, sessionId })
      if (delta) subscriber.push(delta)
    }
  }

  private markConnected(): void {
    if (this.connected) return
    this.connected = true
    for (const subscriber of this.subscribers) {
      subscriber.push({ type: 'connected' })
    }
  }

  private markDisconnected(): void {
    if (!this.connected) return
    this.connected = false
    for (const subscriber of this.subscribers) {
      subscriber.push({ type: 'disconnected' })
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __openCodeHarness: OpenCodeHarness | undefined
}

function getHarness(): OpenCodeHarness {
  // Survive Next.js dev hot-reloads — same trick the persistence layer uses.
  if (!globalThis.__openCodeHarness) {
    globalThis.__openCodeHarness = new OpenCodeHarness()
  }
  return globalThis.__openCodeHarness
}

export function subscribeToOpenCodeEvents(options: { sessionId?: string } = {}) {
  return getHarness().subscribe(options)
}

export function getOpenCodeSessionSnapshot(sessionId: string): SessionSnapshot | undefined {
  return globalThis.__openCodeHarness?.getSnapshot(sessionId)
}

export function getOpenCodeProjectDiagnostics(directory: string | undefined): Promise<ProjectDiagnostics> {
  // Start the persistent event subscription so cache invalidation can
  // flow in as servers/agents/lsp/mcp change. Without this, stale entries
  // only refresh after the TTL backstop elapses.
  const harness = getHarness()
  harness.ensureStarted()
  return harness.getProjectDiagnostics(directory)
}
