import { getOpenCodeClient, getOpenCodeV2Client } from './opencodeClient'
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
import type { QuestionRequest as OpenCodeQuestionRequest } from '@opencode-ai/sdk/v2'

// Mirror of packages/app/src/context/server-sdk.tsx — opencode's app owns
// one global event subscription per server connection and multiplexes the
// stream to every consumer. Doing the same here means:
//   1. The SDK doesn't open a new SSE connection per send turn.
//   2. We can coalesce `message.part.updated` events the same way opencode
//      does (16ms frame budget per part), so streaming text stays smooth
//      under high token throughput.
//   3. Session state (status, todos, permissions, diffs) is cached and
//      replayed to new subscribers — late-joining tabs see the same state
//      opencode would have shown them.
//   4. The SDK keeps the transport open across server heartbeats, while a
//      bounded reconnect loop restores it after a real disconnect.

const FLUSH_FRAME_MS = 16
const STREAM_YIELD_MS = 8
const RECONNECT_DELAY_MS = 250

// Current opencode servers expose /global/event envelopes with a directory and
// payload. Older external servers may not; the harness falls back to their
// directory-scoped /event endpoint after an unsupported initial global stream.
const GLOBAL_CONNECTION_KEY = '\0global'

type HarnessConnection = {
  directoryKey: string
  directory: string | undefined
  started: boolean
  connected: boolean
  attemptController?: AbortController
  streamErrorLogged: boolean
}

export type HarnessEvent =
  | { type: 'event'; event: OpenCodeEvent; sessionId?: string }
  | { type: 'snapshot'; sessionId: string; snapshot: SessionSnapshot }
  | { type: 'disconnected' }
  | { type: 'connected' }

export type SessionSnapshot = {
  status?: OpenCodeSessionStatus
  todos?: OpenCodeTodo[]
  permissions: OpenCodePermission[]
  questions: OpenCodeQuestionRequest[]
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
  directoryKey: string
  push(event: HarnessEvent): void
  done(): void
}

export type OpenCodeHarnessQueuedEvent = { event: OpenCodeEvent; directoryKey: string; key?: string }

/** Normalize current OpenCode permission events to the compatibility shape
 * consumed by Agent Viewer's shared permission UI. */
export function normalizeOpenCodeHarnessEvent(event: OpenCodeEvent): OpenCodeEvent {
  const record = event as unknown as { type: string; properties?: Record<string, unknown> }
  const properties = record.properties
  if (record.type === 'permission.asked' && properties) {
    const id = properties.id
    const sessionID = properties.sessionID
    const permission = properties.permission
    if (typeof id === 'string' && typeof sessionID === 'string' && typeof permission === 'string') {
      const tool = properties.tool && typeof properties.tool === 'object'
        ? properties.tool as Record<string, unknown>
        : undefined
      return {
        type: 'permission.updated',
        properties: {
          id,
          type: permission,
          pattern: Array.isArray(properties.patterns) ? properties.patterns : undefined,
          sessionID,
          messageID: typeof tool?.messageID === 'string' ? tool.messageID : '',
          callID: typeof tool?.callID === 'string' ? tool.callID : undefined,
          title: `Permission: ${permission}`,
          metadata: properties.metadata && typeof properties.metadata === 'object'
            ? properties.metadata as Record<string, unknown>
            : {},
          time: { created: Date.now() },
        },
      }
    }
  }
  if (record.type === 'permission.replied' && properties
    && typeof properties.requestID === 'string'
    && typeof properties.sessionID === 'string') {
    return {
      type: 'permission.replied',
      properties: {
        sessionID: properties.sessionID,
        permissionID: properties.requestID,
        response: typeof properties.reply === 'string' ? properties.reply : '',
      },
    }
  }
  return event
}

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

function coalesceKey(event: OpenCodeEvent, directoryKey: string): string | undefined {
  const record = event as unknown as { type: string; properties?: Record<string, unknown> }
  if (record.type === 'message.part.delta' && record.properties) {
    const messageID = record.properties.messageID
    const partID = record.properties.partID
    const field = record.properties.field
    if (typeof messageID === 'string' && typeof partID === 'string' && typeof field === 'string') {
      return `message.part.delta:${directoryKey}:${messageID}:${partID}:${field}`
    }
  }

  switch (event.type) {
    case 'lsp.updated':
      return `lsp.updated:${directoryKey}`
    case 'message.part.updated': {
      // `part.text` is cumulative — the SDK always emits the full current
      // state of the part. Coalescing per-partID keeps the wire chatty-
      // free during fast streaming while clients still see every visible
      // text change at 60fps.
      const part = event.properties.part
      return `message.part.updated:${directoryKey}:${part.messageID}:${part.id}`
    }
    default:
      return undefined
  }
}

function mergeAdjacentOpenCodeEvents(previous: OpenCodeEvent, next: OpenCodeEvent): OpenCodeEvent {
  const prior = previous as unknown as { type: string; properties?: Record<string, unknown> }
  const current = next as unknown as { type: string; properties?: Record<string, unknown> }
  if (prior.type !== 'message.part.delta' || current.type !== 'message.part.delta') return next
  const priorDelta = prior.properties?.delta
  const currentDelta = current.properties?.delta
  if (typeof priorDelta !== 'string' || typeof currentDelta !== 'string' || !current.properties) return next
  return {
    ...current,
    properties: {
      ...current.properties,
      delta: priorDelta + currentDelta,
    },
  } as unknown as OpenCodeEvent
}

// A merged message.part.delta run has no natural boundary of its own (unlike
// tool/status events, which change key and stop coalescing on their own) —
// without a cap, one long uninterrupted stream would coalesce into a single
// ever-growing queue entry. Spill past this length so a very long reply
// still flushes periodically, matching the Codex/Pi delta buffering.
const OPENCODE_DELTA_SPILL_CHARS = 4000

function deltaLength(event: OpenCodeEvent): number {
  const record = event as unknown as { type: string; properties?: Record<string, unknown> }
  if (record.type !== 'message.part.delta') return 0
  const delta = record.properties?.delta
  return typeof delta === 'string' ? delta.length : 0
}

/**
 * Queue one upstream event without crossing semantic barriers. OpenCode's
 * part snapshots are cumulative, so only directly adjacent updates for the
 * same part can replace one another safely. In particular, status edges and
 * remove/re-add sequences must remain observable and ordered.
 *
 * Exported for the focused provider smoke; consumers should subscribe through
 * subscribeToOpenCodeEvents instead.
 */
export function enqueueOpenCodeHarnessEvent(
  queue: OpenCodeHarnessQueuedEvent[],
  event: OpenCodeEvent,
  directoryKey = '',
): boolean {
  const key = coalesceKey(event, directoryKey)
  const previous = queue[queue.length - 1]
  if (key && previous?.key === key) {
    if (deltaLength(previous.event) + deltaLength(event) >= OPENCODE_DELTA_SPILL_CHARS) {
      queue.push({ event, directoryKey, key })
      return true
    }
    queue[queue.length - 1] = {
      event: mergeAdjacentOpenCodeEvents(previous.event, event),
      directoryKey,
      key,
    }
    return false
  }
  queue.push({ event, directoryKey, key })
  return true
}

class OpenCodeHarness {
  private subscribers = new Set<Subscriber>()
  private snapshots = new Map<string, SessionSnapshot>()
  private queue: OpenCodeHarnessQueuedEvent[] = []
  private buffer: OpenCodeHarnessQueuedEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private lastFlushAt = 0
  private connections = new Map<string, HarnessConnection>()
  private transportMode: 'global' | 'directory' = 'global'
  private diagnosticsCache = new Map<string, DiagnosticsCacheEntry>()
  private diagnosticsInflight = new Map<string, Promise<ProjectDiagnostics>>()
  private snapshotVersions = new Map<string, number>()
  private snapshotInflight = new Map<string, Promise<void>>()
  private transcriptVersions = new Map<string, number>()
  private transportEpoch = 0
  private sessionDirectories = new Map<string, string>()

  subscribe(options: { sessionId?: string; directory?: string } = {}): {
    snapshot: SessionSnapshot | undefined
    events: AsyncGenerator<HarnessEvent>
    close: () => void
  } {
    const connection = this.start(options.directory)
    const directoryKey = options.directory ?? ''

    const queue: HarnessEvent[] = []
    const waiters: Array<(value: IteratorResult<HarnessEvent>) => void> = []
    let closed = false

    const subscriber: Subscriber = {
      sessionId: options.sessionId,
      directoryKey,
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
    if (options.sessionId) {
      if (options.directory) this.sessionDirectories.set(options.sessionId, options.directory)
      void this.hydrateSessionSnapshot(options.sessionId, options.directory).catch(() => {
        // The transport loop reports startup/connectivity failures and retries.
        // Snapshot hydration is best-effort and must never become an unhandled
        // rejection while that recovery is in progress.
      })
    }

    // Replay current connection state so the new consumer knows whether
    // upstream is healthy — matches opencode-web's behavior of immediately
    // reflecting connection state.
    if (connection.connected) {
      subscriber.push({ type: 'connected' })
    }

    const snapshot = options.sessionId ? this.snapshots.get(options.sessionId) : undefined

    const subscribers = this.subscribers
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
        subscribers.delete(subscriber)
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
    this.handleEvent(normalizeOpenCodeHarnessEvent(event))
  }

  getSnapshot(sessionId: string): SessionSnapshot | undefined {
    return this.snapshots.get(sessionId)
  }

  getTranscriptCacheVersion(sessionId: string): string | null {
    const globalConnected = this.connections.get(GLOBAL_CONNECTION_KEY)?.connected === true
    const directory = this.sessionDirectories.get(sessionId)
    const connected = globalConnected || (directory !== undefined && this.connections.get(directory)?.connected === true)
    if (!connected) return null
    return `${this.transportEpoch}:${this.transcriptVersions.get(sessionId) ?? 0}`
  }

  ensureStarted(directory?: string): void {
    this.start(directory)
  }

  private start(directory?: string): HarnessConnection {
    if (this.transportMode === 'global') {
      let global = this.connections.get(GLOBAL_CONNECTION_KEY)
      if (!global) {
        global = {
          directoryKey: GLOBAL_CONNECTION_KEY,
          directory: undefined,
          started: false,
          connected: false,
          streamErrorLogged: false,
        }
        this.connections.set(GLOBAL_CONNECTION_KEY, global)
      }
      if (!global.started) {
        global.started = true
        void this.run(global)
      }
      return global
    }

    const directoryKey = directory ?? ''
    let connection = this.connections.get(directoryKey)
    if (!connection) {
      connection = {
        directoryKey,
        directory,
        started: false,
        connected: false,
        streamErrorLogged: false,
      }
      this.connections.set(directoryKey, connection)
    }
    if (!connection.started) {
      connection.started = true
      void this.run(connection)
    }
    return connection
  }

  private async run(connection: HarnessConnection): Promise<void> {
    // Reconnect with backoff that grows on consecutive failures — the
    // opencode server may be slow to start or temporarily unreachable.
    let failures = 0

    while (connection.started) {
      connection.attemptController = new AbortController()
      let receivedAny = false
      let lastStreamError: unknown
      try {
        const client = await getOpenCodeClient()
        const global = connection.directoryKey === GLOBAL_CONNECTION_KEY
        const eventOptions = {
          responseStyle: 'data' as const,
          throwOnError: true as const,
          signal: connection.attemptController.signal,
          // The generated SDK otherwise retries forever inside the iterator,
          // hiding disconnects and preventing our bounded backoff / legacy
          // endpoint fallback from ever running.
          sseMaxRetryAttempts: 1,
          onSseError: (error: unknown) => {
            if (this.isAbortError(error)) return
            lastStreamError = error
            if (global && this.isUnsupportedGlobalStreamError(error)) return
            if (connection.streamErrorLogged) return
            connection.streamErrorLogged = true
            console.error('[opencode-harness] event stream error', error)
          },
        }
        const events = global
          ? await client.global.event(eventOptions)
          : await client.event.subscribe({
              ...eventOptions,
              ...(connection.directory ? { query: { directory: connection.directory } } : {}),
            })

        let yielded = Date.now()
        for await (const incoming of events.stream) {
          if (!receivedAny) this.markConnected(connection)
          receivedAny = true
          connection.streamErrorLogged = false
          if (global) {
            const envelope = incoming as { directory?: string; payload?: OpenCodeEvent }
            if (!envelope.payload) continue
            this.enqueueEvent(envelope.payload, envelope.directory ?? '')
          } else {
            this.enqueueEvent(incoming as OpenCodeEvent, connection.directoryKey)
          }

          if (Date.now() - yielded < STREAM_YIELD_MS) continue
          yielded = Date.now()
          await this.wait(0)
        }
        if (global && !receivedAny && this.isUnsupportedGlobalStreamError(lastStreamError)) {
          this.fallbackToDirectoryStreams(connection)
          return
        }
      } catch (error) {
        const unsupportedGlobal = connection.directoryKey === GLOBAL_CONNECTION_KEY
          && !receivedAny
          && this.isUnsupportedGlobalStreamError(error)
        if (unsupportedGlobal) {
          this.fallbackToDirectoryStreams(connection)
        }
        if (!unsupportedGlobal && !this.isAbortError(error) && !connection.streamErrorLogged) {
          connection.streamErrorLogged = true
          console.error('[opencode-harness] event stream failed', error)
        }
      } finally {
        connection.attemptController = undefined
        this.markDisconnected(connection)
      }

      if (!connection.started) return

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

  private fallbackToDirectoryStreams(global: HarnessConnection): void {
    if (this.transportMode === 'directory') return
    this.transportMode = 'directory'
    global.started = false
    global.attemptController?.abort()
    this.connections.delete(GLOBAL_CONNECTION_KEY)
    const directories = new Set(Array.from(this.subscribers, (subscriber) => subscriber.directoryKey))
    for (const directoryKey of directories) this.start(directoryKey || undefined)
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private isAbortError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError'
  }

  private isUnsupportedGlobalStreamError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '')
    return /SSE failed: (?:404|405|501)\b/.test(message)
  }

  private enqueueEvent(event: OpenCodeEvent, directoryKey = ''): void {
    const normalized = normalizeOpenCodeHarnessEvent(event)
    if (enqueueOpenCodeHarnessEvent(this.queue, normalized, directoryKey)) this.scheduleFlush()
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
    this.queue = this.buffer
    this.buffer = events
    this.queue.length = 0
    this.lastFlushAt = Date.now()

    for (const item of events) {
      this.handleEvent(item.event, item.directoryKey)
    }
    this.buffer.length = 0
  }

  private handleEvent(event: OpenCodeEvent, directoryKey = ''): void {
    const sessionId = eventSessionId(event)
    if (sessionId && directoryKey && directoryKey !== 'global') {
      this.sessionDirectories.set(sessionId, directoryKey)
    }
    this.bumpSnapshotVersion(event)
    this.bumpTranscriptVersion(event)
    this.applyToSnapshot(event)
    this.invalidateProjectStateFromEvent(event)
    this.broadcast(event, directoryKey)
  }

  private bumpTranscriptVersion(event: OpenCodeEvent): void {
    const record = event as unknown as { type: string }
    if (![
      'message.updated',
      'message.removed',
      'message.part.updated',
      'message.part.delta',
      'message.part.removed',
      'session.compacted',
      'session.updated',
      'session.deleted',
    ].includes(record.type)) return
    const sessionId = eventSessionId(event)
    if (!sessionId) return
    this.transcriptVersions.set(sessionId, (this.transcriptVersions.get(sessionId) ?? 0) + 1)
  }

  private bumpSnapshotVersion(event: OpenCodeEvent): void {
    const record = event as unknown as { type: string }
    if (![
      'session.status',
      'session.idle',
      'todo.updated',
      'permission.updated',
      'permission.replied',
      'question.asked',
      'question.replied',
      'question.rejected',
      'session.deleted',
    ].includes(record.type)) return
    const sessionId = eventSessionId(event)
    if (!sessionId) return
    this.snapshotVersions.set(sessionId, (this.snapshotVersions.get(sessionId) ?? 0) + 1)
  }

  private async hydrateSessionSnapshot(sessionId: string, directory: string | undefined): Promise<void> {
    const key = `${directory ?? ''}\0${sessionId}`
    const existingInflight = this.snapshotInflight.get(key)
    if (existingInflight) return existingInflight

    const hydrate = (async () => {
      const version = this.snapshotVersions.get(sessionId) ?? 0
      const [client, clientV2] = await Promise.all([getOpenCodeClient(), getOpenCodeV2Client()])
      const query = directory ? { directory } : undefined
      const [statusesResult, todosResult, permissionsResult, questionsResult] = await Promise.all([
        client.session.status({ responseStyle: 'data', throwOnError: true, query }).catch(() => null),
        client.session.todo({
          responseStyle: 'data',
          throwOnError: true,
          path: { id: sessionId },
          query,
        }).catch(() => null),
        clientV2.permission.list(directory ? { directory } : undefined, {
          responseStyle: 'data',
          throwOnError: true,
        }).catch(() => null),
        clientV2.question.list(directory ? { directory } : undefined, {
          responseStyle: 'data',
          throwOnError: true,
        }).catch(() => null),
      ])

      // A live state event won the race; it is newer than every bootstrap
      // response and has already updated the snapshot.
      if ((this.snapshotVersions.get(sessionId) ?? 0) !== version) return

      const current = this.snapshots.get(sessionId) ?? { permissions: [], questions: [] }
      const statuses = this.responseData<Record<string, OpenCodeSessionStatus>>(statusesResult)
      const todos = this.responseData<OpenCodeTodo[]>(todosResult)
      const rawPermissions = this.responseData<Array<Record<string, unknown>>>(permissionsResult)
      const questions = this.responseData<OpenCodeQuestionRequest[]>(questionsResult)
      const permissions = rawPermissions?.flatMap((permission) => {
        if (permission.sessionID !== sessionId) return []
        const normalized = normalizeOpenCodeHarnessEvent({
          type: 'permission.asked',
          properties: permission,
        } as unknown as OpenCodeEvent)
        return normalized.type === 'permission.updated' ? [normalized.properties] : []
      })
      const snapshot: SessionSnapshot = {
        status: statuses ? statuses[sessionId] ?? { type: 'idle' } : current.status,
        todos: todos ?? current.todos,
        permissions: permissions ?? current.permissions,
        questions: questions?.filter((question) => question.sessionID === sessionId) ?? current.questions,
      }
      this.snapshots.set(sessionId, snapshot)
      for (const subscriber of this.subscribers) {
        if (subscriber.sessionId !== sessionId) continue
        if (directory && subscriber.directoryKey !== directory) continue
        subscriber.push({ type: 'snapshot', sessionId, snapshot })
      }
    })()

    this.snapshotInflight.set(key, hydrate)
    try {
      await hydrate
    } finally {
      this.snapshotInflight.delete(key)
    }
  }

  private responseData<T>(response: unknown): T | null {
    if (response === null || response === undefined) return null
    if (typeof response === 'object' && 'data' in response) {
      return (response as { data: T }).data
    }
    return response as T
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
    const existing = this.snapshots.get(sessionId) ?? { permissions: [], questions: [] }
    const eventRecord = event as unknown as { type: string; properties?: Record<string, unknown> }
    const properties = eventRecord.properties

    if (eventRecord.type === 'question.asked' && properties) {
      const id = typeof properties.id === 'string' ? properties.id : undefined
      const questionSessionId = typeof properties.sessionID === 'string' ? properties.sessionID : undefined
      if (id && questionSessionId && Array.isArray(properties.questions)) {
        existing.questions = (existing.questions ?? []).filter((question) => question.id !== id)
        existing.questions.push(properties as unknown as OpenCodeQuestionRequest)
      }
    } else if ((eventRecord.type === 'question.replied' || eventRecord.type === 'question.rejected') && properties) {
      const requestId = typeof properties.requestID === 'string' ? properties.requestID : undefined
      if (requestId) existing.questions = (existing.questions ?? []).filter((question) => question.id !== requestId)
    }

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

  private broadcast(event: OpenCodeEvent, directoryKey: string): void {
    const sessionId = eventSessionId(event)
    const dropFor = (subscriber: Subscriber): boolean =>
      (!!subscriber.sessionId && !!sessionId && subscriber.sessionId !== sessionId)
      || (!!directoryKey && directoryKey !== 'global' && subscriber.directoryKey !== directoryKey)

    for (const subscriber of this.subscribers) {
      if (dropFor(subscriber)) continue
      subscriber.push({ type: 'event', event, sessionId })
    }
  }

  private markConnected(connection: HarnessConnection): void {
    if (connection.connected) return
    connection.connected = true
    // A reconnect may bridge an event gap. Advancing the epoch invalidates
    // every optimistic transcript cache entry before reads can use it again.
    this.transportEpoch += 1
    for (const subscriber of this.subscribers) {
      if (connection.directoryKey !== GLOBAL_CONNECTION_KEY && subscriber.directoryKey !== connection.directoryKey) continue
      subscriber.push({ type: 'connected' })
    }
  }

  private markDisconnected(connection: HarnessConnection): void {
    if (!connection.connected) return
    connection.connected = false
    for (const subscriber of this.subscribers) {
      if (connection.directoryKey !== GLOBAL_CONNECTION_KEY && subscriber.directoryKey !== connection.directoryKey) continue
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

export function subscribeToOpenCodeEvents(options: { sessionId?: string; directory?: string } = {}) {
  return getHarness().subscribe(options)
}

export function getOpenCodeSessionSnapshot(sessionId: string): SessionSnapshot | undefined {
  return globalThis.__openCodeHarness?.getSnapshot(sessionId)
}

export function ensureOpenCodeEventsStarted(): void {
  getHarness().ensureStarted()
}

export function getOpenCodeTranscriptCacheVersion(sessionId: string): string | null {
  return globalThis.__openCodeHarness?.getTranscriptCacheVersion(sessionId) ?? null
}

export function getOpenCodeProjectDiagnostics(directory: string | undefined): Promise<ProjectDiagnostics> {
  // Start the persistent event subscription so cache invalidation can
  // flow in as servers/agents/lsp/mcp change. Without this, stale entries
  // only refresh after the TTL backstop elapses.
  const harness = getHarness()
  harness.ensureStarted(directory)
  return harness.getProjectDiagnostics(directory)
}
