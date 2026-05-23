import {
  query,
  type PermissionMode,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ReasoningEffortLevel } from './types'

// Phase 1 of the claudeSessionPool migration. Mirrors lib/codexHarness.ts in
// shape: a process-wide singleton (kept on globalThis to survive Next.js HMR)
// that owns one long-lived `Query` per active session. Each composer send
// becomes "push a user message into the persistent input stream and drain the
// shared output cursor until the turn boundary" instead of "spawn a fresh CLI
// subprocess via query() and tear it down".
//
// Phase 1 scope:
//   - Single consumer per session per turn (mutex-serialized).
//   - Pending (brand-new) sessions still take the cold path; the SSE adapter
//     pre-warms a pool entry once the real session_id arrives, so turn 2 is
//     hot.
//   - Live setModel / setPermissionMode where the SDK supports it; everything
//     else (effort, cwd, taskBudget, resumeSessionAt, forkSession) recycles
//     the entry on change.
//   - Idle eviction + LRU cap; process death → recycle + signal subscriber.
//   - No multi-tab fan-out yet (one subscriber slot).

const IDLE_TTL_MS = 10 * 60 * 1000
const MAX_POOL_SIZE = 8
const SWEEP_INTERVAL_MS = 60_000
// After we see SDKResultMessage we keep draining briefly to catch tail
// messages that arrive after `result` — notably `prompt_suggestion`, which
// the SDK explicitly documents as "arrives after the result message".
// Reset on every received message; close the turn when nothing new arrives
// inside the window.
const TURN_TAIL_DRAIN_MS = 500
// Hard ceiling so a stuck SDK can't strand the mutex forever.
const TURN_HARD_TIMEOUT_MS = 10 * 60 * 1000

export type ClaudePoolAcquireOptions = {
  /** Real session id. Callers must NOT pool pending sessions in phase 1. */
  sessionId: string
  /** Working directory. Recycles the entry on change. */
  cwd?: string
  /** Live-settable via setModel; recycle only if the SDK call fails. */
  model?: string
  /** Live-settable via setPermissionMode. */
  permissionMode?: PermissionMode
  /** Reasoning effort. Mapped to `effort` + `thinking` on the Query. Recycles on change. */
  effort?: ReasoningEffortLevel
  /** Resume the conversation up to (and including) this message id. Always recycles. */
  resumeSessionAt?: string
  /** Fork instead of resume. Always recycles into a fresh entry. */
  forkSession?: boolean
  /** Task budget in total tokens. Recycles on change. */
  taskBudgetTokens?: number
}

export type ClaudePoolEntry = {
  sessionId: string
  /** Push a user message onto the persistent input stream. */
  pushUserMessage(message: SDKUserMessage): void
  /** The underlying Query — exposed so the SSE adapter can call interrupt(). */
  query: Query
  /** Attach for one turn, drain until the turn boundary, detach. */
  run(message: SDKUserMessage, options: ClaudePoolRunOptions): Promise<void>
  /** True until the entry is recycled. */
  isAlive(): boolean
  /**
   * Apply a model change live on the warm Query and remember it in the
   * entry state so the next `acquire()` doesn't redundantly re-set it.
   * Safe to call between or during turns — the SDK's setModel is a control
   * RPC, not part of the message stream.
   */
  setModel(model: string): Promise<void>
  /** Apply a permission-mode change live. Same semantics as setModel. */
  setPermissionMode(mode: PermissionMode): Promise<void>
}

export type ClaudePoolRunOptions = {
  signal: AbortSignal
  onMessage(message: SDKMessage): void
  /** Called once if the underlying CLI dies mid-turn. */
  onError?(error: Error): void
}

type Subscriber = {
  push(message: SDKMessage | null): void
}

type EntryState = {
  cwd: string | undefined
  model: string | undefined
  permissionMode: PermissionMode | undefined
  effort: ReasoningEffortLevel | undefined
  resumeSessionAt: string | undefined
  forkSession: boolean | undefined
  taskBudgetTokens: number | undefined
}

type InternalEntry = {
  sessionId: string
  query: Query
  state: EntryState
  /** Buffer of messages received while no subscriber is attached. Capped. */
  buffer: SDKMessage[]
  subscriber: Subscriber | null
  pushUserMessage(message: SDKUserMessage): void
  /** Close the input async iterable — used when recycling. */
  endInput(): void
  /** FIFO mutex tail. Each turn appends to this chain. */
  turnTail: Promise<void>
  lastActivityAt: number
  alive: boolean
}

const BUFFER_CAP = 256

function effortToSdk(effort: ReasoningEffortLevel | undefined):
  | { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; thinking?: { type: 'disabled' } | { type: 'adaptive' } }
  | Record<string, never> {
  if (!effort) return {}
  if (effort === 'off') return { thinking: { type: 'disabled' } }
  if (effort === 'minimal') return { thinking: { type: 'adaptive' } }
  return { effort, thinking: { type: 'adaptive' } }
}

class ClaudePool {
  private entries = new Map<string, InternalEntry>()
  private sweepHandle: ReturnType<typeof setInterval> | null = null

  acquire(opts: ClaudePoolAcquireOptions): ClaudePoolEntry {
    const existing = this.entries.get(opts.sessionId)
    if (existing && existing.alive && this.compatible(existing.state, opts)) {
      void this.applyLiveChanges(existing, opts)
      existing.lastActivityAt = Date.now()
      this.ensureSweep()
      return this.toPublic(existing)
    }
    if (existing) this.recycleInternal(existing, 'options-changed')
    this.ensureCapacity()
    const entry = this.spawn(opts)
    this.entries.set(opts.sessionId, entry)
    this.ensureSweep()
    return this.toPublic(entry)
  }

  recycle(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (entry) this.recycleInternal(entry, 'explicit')
  }

  private spawn(opts: ClaudePoolAcquireOptions): InternalEntry {
    const { pushUserMessage, endInput, iterable } = createInputStream()

    const effortOptions = effortToSdk(opts.effort)
    const q = query({
      prompt: iterable,
      options: {
        ...(opts.forkSession ? {} : { resume: opts.sessionId }),
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        ...effortOptions,
        enableFileCheckpointing: true,
        resumeSessionAt: opts.resumeSessionAt,
        forkSession: opts.forkSession,
        includePartialMessages: true,
        agentProgressSummaries: true,
        includeHookEvents: true,
        promptSuggestions: true,
        forwardSubagentText: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
        taskBudget: opts.taskBudgetTokens ? { total: opts.taskBudgetTokens } : undefined,
      },
    })

    const entry: InternalEntry = {
      sessionId: opts.sessionId,
      query: q,
      state: {
        cwd: opts.cwd,
        model: opts.model,
        permissionMode: opts.permissionMode,
        effort: opts.effort,
        resumeSessionAt: opts.resumeSessionAt,
        forkSession: opts.forkSession,
        taskBudgetTokens: opts.taskBudgetTokens,
      },
      buffer: [],
      subscriber: null,
      pushUserMessage,
      endInput,
      turnTail: Promise.resolve(),
      lastActivityAt: Date.now(),
      alive: true,
    }

    void this.pumpQueryToSubscriber(entry)
    return entry
  }

  private async pumpQueryToSubscriber(entry: InternalEntry): Promise<void> {
    try {
      for await (const message of entry.query) {
        if (!entry.alive) break
        const sub = entry.subscriber
        if (sub) {
          sub.push(message)
        } else if (entry.buffer.length < BUFFER_CAP) {
          entry.buffer.push(message)
        }
      }
    } catch (err) {
      const sub = entry.subscriber
      if (sub) sub.push(null)
      // fall through to recycle
      void err
    } finally {
      if (entry.alive) this.recycleInternal(entry, 'iterator-end')
    }
  }

  private compatible(state: EntryState, opts: ClaudePoolAcquireOptions): boolean {
    if (state.cwd !== opts.cwd) return false
    if (state.effort !== opts.effort) return false
    if (state.taskBudgetTokens !== opts.taskBudgetTokens) return false
    // resumeSessionAt / forkSession affect the conversation root; never reuse.
    if (opts.resumeSessionAt) return false
    if (opts.forkSession) return false
    if (state.resumeSessionAt || state.forkSession) return false
    return true
  }

  private async applyLiveChanges(entry: InternalEntry, opts: ClaudePoolAcquireOptions): Promise<void> {
    if (opts.model && opts.model !== entry.state.model) {
      try {
        await entry.query.setModel(opts.model)
        entry.state.model = opts.model
      } catch {
        // Fall through; if setModel is rejected by the SDK we keep the old model.
        // Caller may force a recycle by triggering an incompatible-option path next time.
      }
    }
    if (opts.permissionMode && opts.permissionMode !== entry.state.permissionMode) {
      try {
        await entry.query.setPermissionMode(opts.permissionMode)
        entry.state.permissionMode = opts.permissionMode
      } catch {
        /* see above */
      }
    }
  }

  private recycleInternal(entry: InternalEntry, _reason: string): void {
    if (!entry.alive) return
    entry.alive = false
    try { entry.endInput() } catch { /* idempotent */ }
    try { entry.query.close() } catch { /* idempotent */ }
    if (entry.subscriber) {
      try { entry.subscriber.push(null) } catch { /* swallow */ }
    }
    if (this.entries.get(entry.sessionId) === entry) {
      this.entries.delete(entry.sessionId)
    }
  }

  private ensureCapacity(): void {
    if (this.entries.size < MAX_POOL_SIZE) return
    let oldest: InternalEntry | null = null
    for (const entry of this.entries.values()) {
      if (!oldest || entry.lastActivityAt < oldest.lastActivityAt) oldest = entry
    }
    if (oldest) this.recycleInternal(oldest, 'lru-evict')
  }

  private ensureSweep(): void {
    if (this.sweepHandle) return
    this.sweepHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    // Don't keep the Node process alive solely for the sweep timer.
    if (typeof this.sweepHandle === 'object' && this.sweepHandle && 'unref' in this.sweepHandle) {
      ;(this.sweepHandle as { unref?: () => void }).unref?.()
    }
  }

  private sweep(): void {
    const now = Date.now()
    for (const entry of [...this.entries.values()]) {
      if (now - entry.lastActivityAt > IDLE_TTL_MS) {
        this.recycleInternal(entry, 'idle-evict')
      }
    }
    if (this.entries.size === 0 && this.sweepHandle) {
      clearInterval(this.sweepHandle)
      this.sweepHandle = null
    }
  }

  private toPublic(entry: InternalEntry): ClaudePoolEntry {
    return {
      sessionId: entry.sessionId,
      query: entry.query,
      pushUserMessage: (msg) => entry.pushUserMessage(msg),
      isAlive: () => entry.alive,
      run: (message, options) => this.runTurn(entry, message, options),
      setModel: async (model: string) => {
        if (!entry.alive) throw new Error('Claude pool entry was recycled')
        await entry.query.setModel(model)
        entry.state.model = model
        entry.lastActivityAt = Date.now()
      },
      setPermissionMode: async (mode: PermissionMode) => {
        if (!entry.alive) throw new Error('Claude pool entry was recycled')
        await entry.query.setPermissionMode(mode)
        entry.state.permissionMode = mode
        entry.lastActivityAt = Date.now()
      },
    }
  }

  peek(sessionId: string): ClaudePoolEntry | null {
    const entry = this.entries.get(sessionId)
    if (!entry || !entry.alive) return null
    return this.toPublic(entry)
  }

  private async runTurn(
    entry: InternalEntry,
    message: SDKUserMessage,
    options: ClaudePoolRunOptions,
  ): Promise<void> {
    // FIFO mutex — wait for previous turn on the same entry to finish.
    const prev = entry.turnTail
    let releaseMutex!: () => void
    entry.turnTail = new Promise<void>((resolve) => { releaseMutex = resolve })

    try {
      await prev
    } catch {
      // Prior turn rejected; we still get the mutex slot.
    }

    if (!entry.alive) {
      releaseMutex()
      throw new Error('Claude pool entry was recycled before turn could start')
    }

    let resolveTurn!: () => void
    let rejectTurn!: (err: Error) => void
    const turnDone = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve
      rejectTurn = reject
    })

    let resultSeen = false
    let tailTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleTailDrain = () => {
      if (tailTimer) clearTimeout(tailTimer)
      tailTimer = setTimeout(() => {
        tailTimer = null
        resolveTurn()
      }, TURN_TAIL_DRAIN_MS)
    }

    const hardTimer = setTimeout(() => {
      rejectTurn(new Error('Claude turn exceeded hard timeout'))
    }, TURN_HARD_TIMEOUT_MS)

    const subscriber: Subscriber = {
      push: (msg) => {
        if (msg === null) {
          if (tailTimer) clearTimeout(tailTimer)
          rejectTurn(new Error('Claude pool entry was recycled mid-turn'))
          return
        }
        try { options.onMessage(msg) } catch { /* don't let consumer errors strand the mutex */ }
        if (msg.type === 'result') {
          resultSeen = true
          scheduleTailDrain()
          return
        }
        if (
          msg.type === 'system'
          && (msg as { subtype?: string }).subtype === 'session_state_changed'
          && (msg as { state?: string }).state === 'idle'
        ) {
          // Authoritative turn-over signal — short-circuit the tail drain.
          if (tailTimer) clearTimeout(tailTimer)
          resolveTurn()
          return
        }
        if (resultSeen) scheduleTailDrain()
      },
    }

    // Replay buffered messages first (init / state events emitted between
    // entry spawn and this subscribe).
    const replay = entry.buffer.splice(0)
    entry.subscriber = subscriber
    for (const buffered of replay) subscriber.push(buffered)
    if (!entry.alive) {
      entry.subscriber = null
      clearTimeout(hardTimer)
      releaseMutex()
      throw new Error('Claude pool entry was recycled before turn could start')
    }

    const abortHandler = () => {
      void entry.query.interrupt().catch(() => {})
    }
    if (options.signal.aborted) abortHandler()
    else options.signal.addEventListener('abort', abortHandler, { once: true })

    entry.lastActivityAt = Date.now()
    try {
      entry.pushUserMessage(message)
    } catch (err) {
      entry.subscriber = null
      clearTimeout(hardTimer)
      options.signal.removeEventListener('abort', abortHandler)
      releaseMutex()
      throw err instanceof Error ? err : new Error(String(err))
    }

    try {
      await turnDone
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      options.onError?.(error)
      throw error
    } finally {
      if (tailTimer) clearTimeout(tailTimer)
      clearTimeout(hardTimer)
      options.signal.removeEventListener('abort', abortHandler)
      entry.subscriber = null
      entry.lastActivityAt = Date.now()
      releaseMutex()
    }
  }
}

function createInputStream(): {
  pushUserMessage: (msg: SDKUserMessage) => void
  endInput: () => void
  iterable: AsyncIterable<SDKUserMessage>
} {
  const queue: SDKUserMessage[] = []
  let pendingResolve: ((value: IteratorResult<SDKUserMessage>) => void) | null = null
  let closed = false

  const settle = (value: IteratorResult<SDKUserMessage>): void => {
    const waiter = pendingResolve
    pendingResolve = null
    waiter?.(value)
  }

  const pushUserMessage = (msg: SDKUserMessage): void => {
    if (closed) return
    if (pendingResolve) {
      settle({ value: msg, done: false })
      return
    }
    queue.push(msg)
  }

  const endInput = (): void => {
    if (closed) return
    closed = true
    settle({ value: undefined as unknown as SDKUserMessage, done: true })
  }

  const iterable: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        async next(): Promise<IteratorResult<SDKUserMessage>> {
          const buffered = queue.shift()
          if (buffered) return { value: buffered, done: false }
          if (closed) return { value: undefined as unknown as SDKUserMessage, done: true }
          return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
            pendingResolve = resolve
          })
        },
        async return(): Promise<IteratorResult<SDKUserMessage>> {
          closed = true
          return { value: undefined as unknown as SDKUserMessage, done: true }
        },
      }
    },
  }

  return { pushUserMessage, endInput, iterable }
}

declare global {
  // eslint-disable-next-line no-var
  var __claudePool: ClaudePool | undefined
}

function getPool(): ClaudePool {
  if (!globalThis.__claudePool) {
    globalThis.__claudePool = new ClaudePool()
  }
  return globalThis.__claudePool
}

export function acquireClaudeSession(opts: ClaudePoolAcquireOptions): ClaudePoolEntry {
  return getPool().acquire(opts)
}

export function recycleClaudeSession(sessionId: string): void {
  getPool().recycle(sessionId)
}

/**
 * Look up the warm pool entry for `sessionId` without creating one. Returns
 * null if the session isn't currently pooled. Used by control routes (model
 * swap, permission swap, getContextUsage) that want to fast-path through the
 * warm Query when available without spinning a new subprocess.
 */
export function peekClaudeSession(sessionId: string): ClaudePoolEntry | null {
  return getPool().peek(sessionId)
}

/**
 * Build the wire-format SDKUserMessage from either a plain text prompt or a
 * pre-shaped one (e.g. text + image blocks). Used by the SSE adapter to
 * normalise whatever buildClaudePrompt produced.
 */
export function toSdkUserMessage(prompt: string | { message: SDKUserMessage['message'] }): SDKUserMessage {
  if (typeof prompt === 'string') {
    return {
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    }
  }
  return {
    type: 'user',
    message: prompt.message,
    parent_tool_use_id: null,
  }
}
