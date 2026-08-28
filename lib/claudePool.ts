import {
  query,
  type CanUseTool,
  type ElicitationRequest,
  type ElicitationResult,
  type OnUserDialog,
  type PermissionMode,
  type Query,
  type SDKMessage,
  type SDKSessionStateChangedMessage,
  type SDKUserMessage,
  type SDKWorkerShuttingDownMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { getCoordinatorMcpServers } from './agentCoordinationSdkTools'

/**
 * Coordinator-owned Claude sessions must not inherit the user's ordinary MCP
 * configuration. A separately configured agent-viewer bridge exposes the same
 * coord_* names but has no participant identity, so Claude can select it on a
 * later turn and receive the misleading "Join, create, or resume" error even
 * though the run-bound in-process server is still healthy.
 */
export function coordinatorClaudeMcpOptions(sessionId: string): {
  mcpServers?: ReturnType<typeof getCoordinatorMcpServers>
  strictMcpConfig?: true
} {
  const mcpServers = getCoordinatorMcpServers(sessionId)
  return mcpServers ? { mcpServers, strictMcpConfig: true } : {}
}

// Per-turn MCP elicitation handler. Mirrors the canUseTool bridge: the warm
// Query's onElicitation delegates to this so the long-lived subprocess can route
// each turn's elicitation requests through the current turn's SSE controller.
export type ClaudeElicitationHandler = (
  request: ElicitationRequest,
  options: { signal: AbortSignal },
) => Promise<ElicitationResult>

// Mutable per-turn bridge box shared between the cold-path query and the pooled
// entry (so an adopted cold Query keeps routing through it). `fn` handles tool
// permissions; `elicit` handles MCP elicitation; `dialog` handles native SDK
// dialogs. All three are swapped per turn.
export type ClaudeBridgeBox = {
  fn: CanUseTool | null
  elicit: ClaudeElicitationHandler | null
  dialog: OnUserDialog | null
}

/**
 * Interrupt a Claude query, cancelling queued async user messages when the
 * current CLI advertises the v1 cancellation control request. Older SDK/CLI
 * combinations expose only Query.interrupt(), so retain that fallback.
 */
export async function interruptClaudeQuery(query: Query, cancelQueued = false): Promise<unknown> {
  if (!cancelQueued) return query.interrupt()
  const controlQuery = query as Query & {
    request?: (request: { subtype: 'interrupt'; cancel_queued?: boolean }) => Promise<{
      response?: { still_queued?: unknown; cancelled?: unknown }
    }>
  }
  if (typeof controlQuery.request === 'function') {
    try {
      const response = await controlQuery.request({ subtype: 'interrupt', cancel_queued: true })
      return response.response ?? response
    } catch {
      // The public method is the compatibility path for older runtimes.
    }
  }
  return query.interrupt()
}

/**
 * Claude 0.3.243+ reports how many queued user sends remain after each result.
 * A result with pending turns is not a pool turn boundary: detaching the
 * subscriber there drops the queued turns' output before the next result.
 */
export function claudeResultHasQueuedTurns(message: SDKMessage): boolean {
  if (message.type !== 'result') return false
  const queuedTurnCount = (message as SDKMessage & { queued_turn_count?: unknown }).queued_turn_count
  return typeof queuedTurnCount === 'number'
    && Number.isFinite(queuedTurnCount)
    && queuedTurnCount > 0
}
import type { ReasoningEffortLevel } from './types'
import {
  broadcastClaudeMessage,
  broadcastClaudeRecycled,
  broadcastClaudeTurnEnd,
  broadcastClaudeTurnStart,
} from './claudeHarness'
import { noteClaudeCommandsChanged } from './claudeCommandsStore'
import { createClaudeViewerQueryExtensions } from './claudeViewerIntegration'
import {
  claudeAgentPolicyKey,
  claudeAgentPolicyOptions,
  claudeQueryBudgetOptions,
  type ClaudeAgentPolicy,
} from './claudeRuntimePolicy'
import { claudeSessionPersistenceQueryOptions } from './claudeSessionStore'
import { claudeProcessSpawnOptions } from './claudeProcessSpawner'
import { getClaudeDynamicMcpServers } from './claudeDynamicMcp'
import { createMessagingMcpServer } from './claudeMessagingMcp'
import { currentProviderEnvironment, currentProviderExecutable, currentProviderInstanceId } from './providerInstances'
import { providerStartupTimeoutMs } from './providerWarmup'
import { withTimeout } from './withTimeout'

export function claudeIntegratedMcpServers(context: {
  getSessionId(): string
  getCwd(): string | undefined
}, sessionId: string) {
  const viewer = createClaudeViewerQueryExtensions(context)
  const coordinator = coordinatorClaudeMcpOptions(sessionId)
  return {
    ...(viewer.mcpServers ?? {}),
    ...(coordinator.mcpServers ?? {}),
    'agent-viewer-messaging': createMessagingMcpServer(sessionId),
    ...getClaudeDynamicMcpServers(sessionId),
  }
}

/** Keep Agent Viewer's SDK MCP tools and run-bound Coordinator tools together. */
export function claudeIntegratedQueryExtensions(context: {
  getSessionId(): string
  getCwd(): string | undefined
}, sessionId: string) {
  const viewer = createClaudeViewerQueryExtensions(context)
  const coordinator = coordinatorClaudeMcpOptions(sessionId)
  return {
    ...viewer,
    ...coordinator,
    mcpServers: claudeIntegratedMcpServers(context, sessionId),
  }
}

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
//   - Live setModel / setPermissionMode / effortLevel (the last via
//     applyFlagSettings) where the SDK supports it; everything else (cwd,
//     taskBudget, thinking on/off, resumeSessionAt, forkSession) recycles the
//     entry on change.
//   - Idle eviction + LRU cap; process death → recycle + signal subscriber.
//   - worker_shutting_down marks the entry doomed so it is never handed out
//     for a new turn, instead of being adopted and stalling.
//   - No multi-tab fan-out yet (one subscriber slot).

const IDLE_TTL_MS = 10 * 60 * 1000
const MAX_POOL_SIZE = 8
const SWEEP_INTERVAL_MS = 60_000
// After we see SDKResultMessage we keep draining briefly to catch tail
// messages that arrive after `result` — notably `prompt_suggestion`, which
// the SDK explicitly documents as "arrives after the result message".
// Reset on every received message; close the turn when nothing new arrives
// inside the window. Keep this short so the composer does not look finished
// half a second after Claude has already emitted its result.
const TURN_TAIL_DRAIN_MS = 150
// Hard ceiling so a stuck SDK can't strand the mutex forever.
const TURN_HARD_TIMEOUT_MS = 10 * 60 * 1000
// Grace after an interrupt request before we assume the SDK interrupt was a
// no-op and recycle the entry. A genuine interrupt emits a result well within
// this; if it doesn't, recycling frees the FIFO mutex instead of holding it
// until the 10-min hard timeout while the user stares at a dead spinner.
const INTERRUPT_FALLBACK_MS = 4000

// Environment for the Claude CLI subprocess. Passing `env` to query() REPLACES
// the subprocess environment, so the process.env spread is mandatory. We enable
// the SDK's built-in response-body stall watchdog (off by default) so a stalled
// model stream is caught at the idle timeout instead of hanging to the per-turn
// hard timeout — complements our own stream-level watchdog. CLAUDE_CODE_MAX_RETRIES
// (default 10) and API_TIMEOUT_MS (default 600000) are left at their defaults;
// the SDK already retries transient API errors, which our client-side retry sits
// on top of. CLAUDE_STREAM_IDLE_TIMEOUT_MS has a 300000ms (5 min) floor.
// Tool search is on by default in the SDK (auto-activates at 10% of the
// context window), but the coordinator MCP alone can register 40+ tools, so
// we lower the threshold to activate deferral sooner rather than relying on
// the default budget.
export const CLAUDE_QUERY_ENV: Record<string, string | undefined> = {
  ...process.env,
  CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
  CLAUDE_STREAM_IDLE_TIMEOUT_MS: '300000',
  ENABLE_TOOL_SEARCH: 'auto:5',
}

// Surface the Claude CLI subprocess's stderr (otherwise dropped) so a genuinely
// stuck or erroring subprocess is debuggable. Rate-limited per session so a
// chatty process can't flood server logs.
// LRU-capped: a session that logs stderr once and never again would otherwise
// leave a stale window entry resident forever, so the map grows one entry per
// distinct session over a long-running server. The cap is well above any
// realistic count of concurrently-chatty subprocesses.
const CLAUDE_STDERR_WINDOWS_MAX = 64
const claudeStderrWindows = new Map<string, { count: number; windowStart: number }>()
export function logClaudeSubprocessStderr(sessionId: string, data: string): void {
  const text = data.trim()
  if (!text) return
  const now = Date.now()
  const win = claudeStderrWindows.get(sessionId)
  if (!win || now - win.windowStart > 10_000) {
    if (win) claudeStderrWindows.delete(sessionId)
    claudeStderrWindows.set(sessionId, { count: 1, windowStart: now })
    while (claudeStderrWindows.size > CLAUDE_STDERR_WINDOWS_MAX) {
      const oldest = claudeStderrWindows.keys().next().value
      if (oldest === undefined) break
      claudeStderrWindows.delete(oldest)
    }
  } else {
    win.count += 1
    if (win.count === 21) console.warn(`[claude ${sessionId}] stderr rate-limited (>20 lines/10s)`)
    if (win.count >= 21) return
  }
  console.warn(`[claude ${sessionId}] stderr: ${text.length > 500 ? `${text.slice(0, 500)}…` : text}`)
}

export type ClaudePoolAcquireOptions = {
  /**
   * Session id. For an ordinary send this is a real, already-resumable id
   * (passed as `resume`). For a brand-new conversation's prewarm/first-turn,
   * pass `isPendingSession: true` alongside the client's pending UUID — the
   * SDK's `sessionId` create-time option forces the CLI to adopt exactly this
   * id as its own, so there is no separate "realized id" to hand off.
   */
  sessionId: string
  /** Working directory. Recycles the entry on change. */
  cwd?: string
  /** Live-settable via setModel; recycle only if the SDK call fails. */
  model?: string
  /** Comma-separated ordered fallback model chain. */
  fallbackModel?: string
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
  /** Hard SDK-native cost ceiling for this query. Recycles on change. */
  maxBudgetUsd?: number
  /** Opt this session into the Workflow tool (settings.enableWorkflows). Recycles on change. */
  enableWorkflow?: boolean
  /** Immutable role-scoped SDK policy. Recycles on change. */
  agentPolicy?: ClaudeAgentPolicy
  /**
   * Brand-new conversation: spawn with `sessionId: opts.sessionId` (forcing
   * the CLI to adopt this exact id) instead of `resume: opts.sessionId`.
   * Only meaningful at spawn time — irrelevant once an entry exists, so it
   * does not participate in `compatible()`.
   */
  isPendingSession?: boolean
}

export type ClaudePoolEntry = {
  sessionId: string
  /**
   * True when acquire() returned an existing warm entry (reused subprocess)
   * rather than a fresh spawn. Callers use this to gate a liveness backstop:
   * only a reused subprocess can have silently died since the prior turn, so
   * only a reused entry is worth probing + respawning. A fresh spawn is the
   * already-reliable path and may simply be slow to answer during init.
   */
  reused?: boolean
  /** Push a user message onto the persistent input stream. */
  pushUserMessage(message: SDKUserMessage): void
  /** The underlying Query — exposed so the SSE adapter can call interrupt(). */
  query: Query
  /** Attach for one turn, drain until the turn boundary, detach. */
  run(message: SDKUserMessage, options: ClaudePoolRunOptions): Promise<void>
  /** True until the entry is recycled. */
  isAlive(): boolean
  /** True once the CLI has answered its initialize control request. */
  isInitialized(): boolean
  /**
   * Resolve when startup initialization finishes. A selection-time prewarm can
   * hand the entry to a send before this settles; callers use this distinction
   * to avoid treating a legitimately slow custom-model boot as a dead warm
   * subprocess.
   */
  whenInitialized(): Promise<void>
  /** Resolve after model/permission/effort changes queued by acquire(). */
  whenConfigured(): Promise<void>
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
  /**
   * Called the instant the user message reaches the subprocess input stream —
   * after the FIFO mutex and after any buffered messages from the previous
   * turn have been replayed. Callers that time the subprocess's response to
   * *this* turn must start their clock here: a replayed frame says nothing
   * about whether the subprocess is still answering.
   */
  onSubmitted?(): void
  /**
   * Per-turn canUseTool implementation. Installed into the entry's bridgeBox
   * before the turn starts and cleared when the turn ends. Used to route
   * interactive permission requests through the current turn's SSE stream
   * without recycling the warm Query between turns.
   */
  bridge?: CanUseTool
  /** Per-turn MCP elicitation handler, installed/cleared alongside `bridge`. */
  elicit?: ClaudeElicitationHandler
  /** Per-turn native Claude dialog handler. */
  dialog?: OnUserDialog
}

type Subscriber = {
  push(message: SDKMessage | null): void
}

/**
 * Testable ordering primitive for a pool settings change. A change waits for
 * earlier settings, the turn that was active when it was selected, and Query
 * initialization — in that order — before touching the SDK control channel.
 */
export function sequenceClaudePoolConfiguration(options: {
  previousSettings: Promise<unknown>
  previousTurn: Promise<unknown>
  initialization: Promise<unknown>
  isAlive: () => boolean
  apply: () => Promise<void>
}): Promise<void> {
  return Promise.all([
    options.previousSettings.catch(() => {}),
    options.previousTurn.catch(() => {}),
  ]).then(async () => {
    if (!options.isAlive()) throw new Error('Claude pool entry was recycled before configuration completed')
    await options.initialization
    await options.apply()
  })
}

type EntryState = {
  cwd: string | undefined
  model: string | undefined
  fallbackModel: string | undefined
  permissionMode: PermissionMode | undefined
  effort: ReasoningEffortLevel | undefined
  resumeSessionAt: string | undefined
  forkSession: boolean | undefined
  taskBudgetTokens: number | undefined
  maxBudgetUsd: number | undefined
  enableWorkflow: boolean | undefined
  agentPolicyKey: string
}

type InternalEntry = {
  sessionId: string
  poolKey: string
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
  /** The CLI's one-shot initialization result, tracked without polling. */
  initialization: Promise<void>
  initialized: boolean
  /**
   * Serializes live settings RPCs. runTurn() waits for the tail captured by
   * acquire() before it submits the prompt, so a slow setModel cannot race the
   * message onto the previous model.
   */
  settingsTail: Promise<void>
  desiredModel: string | undefined
  desiredPermissionMode: PermissionMode | undefined
  desiredEffort: ReasoningEffortLevel | undefined
  lastActivityAt: number
  /**
   * True while a run() turn holds this entry. LRU eviction and the idle sweep
   * must never recycle an in-turn entry — that kills a live turn out from
   * under its SSE stream ("recycled mid-turn").
   */
  inTurn: boolean
  alive: boolean
  /**
   * Set when applyLiveChanges wants to recycle this entry (a live setModel/
   * setPermissionMode failed) but it's mid-turn. Applied the moment inTurn
   * flips back to false instead of recycling immediately — see the comment
   * on applyLiveChanges' recycle call for why immediate recycling is unsafe.
   */
  pendingRecycleReason: string | null
  /**
   * Mutable per-turn bridge. The query's canUseTool / onElicitation delegate to
   * this so the warm subprocess can be reused across turns while routing each
   * turn's permission + elicitation requests through the correct SSE controller.
   */
  bridgeBox: ClaudeBridgeBox
}

// Init/state messages emitted between session spawn and the first subscriber
// attaching. The legitimate burst is on the order of a dozen, so 64 leaves
// generous headroom while halving the worst-case detached-session footprint.
const BUFFER_CAP = 64

export function effortToSdk(effort: ReasoningEffortLevel | undefined):
  | { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; thinking?: { type: 'disabled' } | { type: 'adaptive' } }
  | Record<string, never> {
  if (!effort) return {}
  if (effort === 'off') return { thinking: { type: 'disabled' } }
  if (effort === 'minimal') return { thinking: { type: 'adaptive' } }
  return { effort, thinking: { type: 'adaptive' } }
}

class ClaudePool {
  private entries = new Map<string, InternalEntry>()
  private pendingReadSeeds = new Map<string, Map<string, number>>()
  private sweepHandle: ReturnType<typeof setInterval> | null = null

  /** Live entry count, for memory diagnostics. */
  get size(): number {
    return this.entries.size
  }

  acquire(opts: ClaudePoolAcquireOptions): ClaudePoolEntry {
    const poolKey = `${currentProviderInstanceId('claude')}:${opts.sessionId}`
    const existing = this.entries.get(poolKey)
    // A doomed entry (worker_shutting_down seen, or a failed live-settings
    // apply) must not be handed out for a NEW turn — that adopts a subprocess
    // that is about to be torn down. But it must still be reused while its own
    // turn is in flight: recycling here would kill that live turn out from
    // under its SSE stream. The deferred recycle fires at turn end, so the
    // next acquire after that spawns fresh.
    const doomed = Boolean(existing?.pendingRecycleReason) && existing?.inTurn === false
    if (existing && existing.alive && !doomed && this.compatible(existing.state, opts)) {
      // Queue live settings immediately. The public acquire stays synchronous,
      // but runTurn waits this entry's settings tail before delivering the
      // prompt. That preserves the hot path when nothing changed and closes a
      // correctness race for slow custom-model setModel RPCs.
      const needsConfiguration = this.hasLiveChanges(existing, opts)
      if (needsConfiguration) this.noteDesiredChanges(existing, opts)
      const configuration = needsConfiguration
        ? this.queueConfiguration(existing, () => this.applyLiveChanges(existing, opts))
        : existing.settingsTail
      if (needsConfiguration) {
        void configuration.catch((err) => {
          console.error(`[claude pool ${opts.sessionId}] applyLiveChanges failed unexpectedly:`, err)
        })
      }
      existing.lastActivityAt = Date.now()
      this.ensureSweep()
      return { ...this.toPublic(existing, configuration), reused: true }
    }
    if (existing) this.recycleInternal(existing, existing.pendingRecycleReason ?? 'options-changed')
    this.ensureCapacity()
    const entry = this.spawn(opts)
    entry.poolKey = poolKey
    this.entries.set(poolKey, entry)
    this.ensureSweep()
    return { ...this.toPublic(entry, entry.settingsTail), reused: false }
  }

  recycle(sessionId: string): void {
    const entry = this.entries.get(`${currentProviderInstanceId('claude')}:${sessionId}`)
    if (entry) this.recycleInternal(entry, 'explicit')
  }

  private spawn(opts: ClaudePoolAcquireOptions): InternalEntry {
    const { pushUserMessage, endInput, iterable } = createInputStream()

    // Mutable per-turn bridge. The canUseTool delegation below routes through
    // this so permission requests reach the correct SSE stream controller for
    // each turn while the underlying subprocess stays warm.
    const bridgeBox: ClaudeBridgeBox = { fn: null, elicit: null, dialog: null }
    const viewerContext = {
      getSessionId: () => opts.sessionId,
      getCwd: () => opts.cwd,
    }

    const effortOptions = effortToSdk(opts.effort)
    const q = query({
      prompt: iterable,
      options: {
        env: { ...CLAUDE_QUERY_ENV, ...currentProviderEnvironment() },
        ...(currentProviderExecutable('') ? { pathToClaudeCodeExecutable: currentProviderExecutable('') } : {}),
        stderr: (data) => logClaudeSubprocessStderr(opts.sessionId, data),
        ...(opts.isPendingSession
          ? { sessionId: opts.sessionId }
          : opts.forkSession ? {} : { resume: opts.sessionId }),
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.fallbackModel ? { fallbackModel: opts.fallbackModel } : {}),
        ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
        // bypassPermissions is a no-op (and the SDK rejects the option) unless we
        // also opt into the dangerous skip. Mirror `claude --dangerously-skip-permissions`.
        ...(opts.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
        canUseTool: (toolName, input, toolOpts) =>
          bridgeBox.fn
            ? bridgeBox.fn(toolName, input, toolOpts)
            : Promise.resolve({ behavior: 'allow' as const, updatedInput: input }),
        onElicitation: (request, elicitOpts) =>
          bridgeBox.elicit
            ? bridgeBox.elicit(request, elicitOpts)
            : Promise.resolve({ action: 'decline' as const }),
        onUserDialog: (request, dialogOpts) => bridgeBox.dialog
          ? bridgeBox.dialog(request, dialogOpts)
          : Promise.resolve({ behavior: 'cancelled' as const }),
        supportedDialogKinds: ['refusal_fallback_prompt'],
        ...claudeIntegratedQueryExtensions(viewerContext, opts.sessionId),
        ...claudeAgentPolicyOptions(opts.agentPolicy),
        ...effortOptions,
        ...claudeSessionPersistenceQueryOptions(),
        ...claudeProcessSpawnOptions(),
        resumeSessionAt: opts.resumeSessionAt,
        forkSession: opts.forkSession,
        includePartialMessages: true,
        // Keep background agents/workflows alive when the user interrupts the
        // foreground turn. They remain visible and independently stoppable via
        // Query.backgroundTasks(); cancelQueued still controls queued sends.
        perTaskStopAffordance: true,
        agentProgressSummaries: true,
        includeHookEvents: true,
        promptSuggestions: true,
        forwardSubagentText: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
        ...claudeQueryBudgetOptions(opts.taskBudgetTokens, opts.maxBudgetUsd),
        ...(opts.enableWorkflow ? { settings: { enableWorkflows: true } } : {}),
        // Coordinator-owned sessions get their coord_* tools bound in-process at
        // spawn time (see lib/agentCoordinationSdkTools.ts) — immutable for the
        // session's lifetime, so this needs no entry in compatible()/EntryState;
        // a pool entry only ever exists for a session id that was already
        // spawned with this same lookup.
      },
    })

    let initialized = false
    const initialization = q.initializationResult().then(() => {
      initialized = true
    })
    // The pool pump owns lifecycle failure. This handler prevents a startup
    // rejection from becoming process-wide merely because no prewarm caller
    // happened to await it yet; whenInitialized() still receives the original
    // rejected promise.
    void initialization.catch(() => {})

    const entry: InternalEntry = {
      sessionId: opts.sessionId,
      poolKey: `${currentProviderInstanceId('claude')}:${opts.sessionId}`,
      query: q,
      state: {
        cwd: opts.cwd,
        model: opts.model,
        fallbackModel: opts.fallbackModel,
        permissionMode: opts.permissionMode,
        effort: opts.effort,
        resumeSessionAt: opts.resumeSessionAt,
        forkSession: opts.forkSession,
        taskBudgetTokens: opts.taskBudgetTokens,
        maxBudgetUsd: opts.maxBudgetUsd,
        enableWorkflow: opts.enableWorkflow,
        agentPolicyKey: claudeAgentPolicyKey(opts.agentPolicy),
      },
      buffer: [],
      subscriber: null,
      pushUserMessage,
      endInput,
      turnTail: Promise.resolve(),
      initialization,
      get initialized() { return initialized },
      lastActivityAt: Date.now(),
      settingsTail: Promise.resolve(),
      desiredModel: opts.model,
      desiredPermissionMode: opts.permissionMode,
      desiredEffort: opts.effort,
      inTurn: false,
      pendingRecycleReason: null,
      alive: true,
      bridgeBox,
    }

    // Same unhandled-rejection backstop as applyLiveChanges above:
    // pumpQueryToSubscriber already wraps its whole body in try/finally, so
    // this should never reject in practice — but if it ever did, an
    // unhandled rejection here would crash the process rather than just
    // this session's entry.
    this.pumpQueryToSubscriber(entry).catch((err) => {
      console.error(`[claude pool ${entry.sessionId}] pumpQueryToSubscriber failed unexpectedly:`, err)
    })
    return entry
  }

  queueReadSeeds(sessionId: string, seeds: Array<{ path: string; mtime: number }>): void {
    if (seeds.length === 0) return
    const key = `${currentProviderInstanceId('claude')}:${sessionId}`
    const queued = this.pendingReadSeeds.get(key) ?? new Map<string, number>()
    for (const seed of seeds) queued.set(seed.path, seed.mtime)
    while (queued.size > 200) {
      const oldest = queued.keys().next().value
      if (oldest === undefined) break
      queued.delete(oldest)
    }
    this.pendingReadSeeds.delete(key)
    this.pendingReadSeeds.set(key, queued)
    while (this.pendingReadSeeds.size > 64) {
      const oldest = this.pendingReadSeeds.keys().next().value
      if (oldest === undefined) break
      this.pendingReadSeeds.delete(oldest)
    }
  }

  private async applyReadSeeds(entry: InternalEntry): Promise<void> {
    const queued = this.pendingReadSeeds.get(entry.poolKey)
    if (!queued || queued.size === 0) return
    await entry.query.initializationResult().catch(() => null)
    for (const [path, mtime] of [...queued]) {
      try {
        await entry.query.seedReadState(path, mtime)
        queued.delete(path)
      } catch {
        // Keep failed seeds for the next reconnect; a turn must never fail just
        // because this safety-cache repair could not be delivered.
      }
    }
    if (queued.size === 0) this.pendingReadSeeds.delete(entry.poolKey)
  }

  private async pumpQueryToSubscriber(entry: InternalEntry): Promise<void> {
    try {
      for await (const message of entry.query) {
        if (!entry.alive) break
        // A streaming query is active by definition — keep the LRU/idle-sweep
        // ordering honest even when no run() subscriber is attached (e.g. a
        // steered follow-up turn the CLI started after the stream detached).
        entry.lastActivityAt = Date.now()
        // Fan messages out to harness observers (second tabs, a page reloaded
        // mid-turn) so the events SSE can refetch the canonical window in real
        // time — independent of the single turn subscriber. Skip `stream_event`
        // partial-message deltas: they don't add rows to the persisted JSONL,
        // so refetching on them would just re-read the file and signature-bail.
        // Completed assistant/user/result/system messages are what move the log.
        if (message.type !== 'stream_event') {
          try { broadcastClaudeMessage(entry.sessionId, message.type) } catch { /* never let a subscriber stall the pump */ }
          try { noteClaudeCommandsChanged(entry.sessionId, message) } catch { /* commands-cache bookkeeping must never kill a healthy live turn */ }
        }
        // The CLI announces its own worker teardown (host exit, remote control
        // disabled, ...) before the iterator ends. Without this we only learn
        // the subprocess is doomed when a later acquire adopts it and stalls
        // until the liveness probe or the 10-minute hard timeout notices —
        // the exact silent-dead-entry hang the warm-entry backstop was added
        // for. Mark it here so the entry is never handed out again, and let
        // the in-flight turn finish streaming rather than killing it mid-turn.
        if (
          message.type === 'system'
          && 'subtype' in message
          && (message as SDKWorkerShuttingDownMessage).subtype === 'worker_shutting_down'
        ) {
          const why = (message as SDKWorkerShuttingDownMessage).reason || 'unknown'
          if (entry.inTurn) entry.pendingRecycleReason = `worker-shutting-down:${why}`
          else {
            const sub = entry.subscriber
            if (sub) sub.push(message)
            this.recycleInternal(entry, `worker-shutting-down:${why}`)
            break
          }
        }
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
    if (state.fallbackModel !== opts.fallbackModel) return false
    // Effort only forces a respawn when it can't be applied live. A move
    // between two named levels is just an effortLevel change on an unchanged
    // adaptive-thinking config, which applyLiveChanges pushes through
    // applyFlagSettings — recycling for that cost a full cold spawn (seconds
    // to first token) for something the CLI can change in place. 'off' and
    // 'minimal' instead map to a `thinking` config, and thinking has no live
    // control method, so those transitions still need a fresh subprocess.
    if (state.effort !== opts.effort && !(effortToSdk(state.effort).effort && effortToSdk(opts.effort).effort)) return false
    if (state.taskBudgetTokens !== opts.taskBudgetTokens) return false
    if (state.maxBudgetUsd !== opts.maxBudgetUsd) return false
    if (Boolean(state.enableWorkflow) !== Boolean(opts.enableWorkflow)) return false
    if (state.agentPolicyKey !== claudeAgentPolicyKey(opts.agentPolicy)) return false
    // resumeSessionAt / forkSession affect the conversation root; never reuse.
    if (opts.resumeSessionAt) return false
    if (opts.forkSession) return false
    if (state.resumeSessionAt || state.forkSession) return false
    return true
  }

  private async applyLiveChanges(entry: InternalEntry, opts: ClaudePoolAcquireOptions): Promise<void> {
    // If a live setModel / setPermissionMode is rejected by the SDK we
    // recycle the entry rather than silently keeping the old value. The
    // recycled entry is replaced on the next acquire() with a fresh spawn
    // that bakes the requested options in at construction time — that
    // either succeeds (giving the caller what they asked for) or surfaces a
    // real error to the caller. Swallowing leaves the snapshot stale and
    // the UX confused.
    // Apply model + permission changes concurrently rather than as two serial
    // round-trips on the settings path. We keep the dedicated setModel /
    // setPermissionMode methods (rather than batching via applyFlagSettings):
    // permissionMode is security-sensitive and the SDK's typed
    // applyFlagSettings surface routes it through `permissions.defaultMode`,
    // whose equivalence to setPermissionMode isn't guaranteed — a silent
    // mismatch there wouldn't trip the recycle-on-failure guard. effortLevel
    // has no dedicated control method, but it IS in the typed Settings surface
    // and applyFlagSettings special-cases it (it alone also accepts 'max',
    // session-scoped), so it goes through the flag layer here instead of
    // forcing a cold respawn via compatible(). Concurrency gets the latency
    // win safely.
    const modelChange = opts.model && opts.model !== entry.state.model
      ? withTimeout(
        entry.query.setModel(opts.model),
        providerStartupTimeoutMs(opts.model),
        'Claude model switch',
      ).then(
        () => { entry.state.model = opts.model; return null },
        () => 'set-model-failed' as const,
      )
      : Promise.resolve(null)
    const permissionChange = opts.permissionMode && opts.permissionMode !== entry.state.permissionMode
      ? entry.query.setPermissionMode(opts.permissionMode).then(
        () => { entry.state.permissionMode = opts.permissionMode; return null },
        () => 'set-permission-mode-failed' as const,
      )
      : Promise.resolve(null)
    // 'off' / 'minimal' map to a thinking config rather than an effort level,
    // and thinking has no live control method — those still need a respawn, so
    // they are left to bake in at construction time on the next acquire.
    const nextEffort = effortToSdk(opts.effort).effort
    const effortChange = opts.effort !== entry.state.effort && nextEffort
      ? entry.query.applyFlagSettings({ effortLevel: nextEffort }).then(
        () => { entry.state.effort = opts.effort; return null },
        () => 'apply-effort-failed' as const,
      )
      : Promise.resolve(null)
    const [modelResult, permissionResult, effortResult] = await Promise.all([modelChange, permissionChange, effortChange])
    const failure = modelResult ?? permissionResult ?? effortResult
    if (!failure) return
    // acquire() fires this without awaiting it, so by the time a live
    // setModel/setPermissionMode rejects, the caller may already be mid-turn
    // on this exact entry (runTurn() started right after acquire() returned).
    // Recycling unconditionally here — as this used to — pushes null to the
    // turn's subscriber and kills that live turn out from under its SSE
    // stream, surfacing as "Lost connection to Claude mid-turn" even though
    // the turn itself was healthy. Defer to the same inTurn=false transition
    // ensureCapacity/sweep already respect; the entry's stale model/
    // permission state just gets retried on the next acquire() in the
    // meantime, same as when compatible() rejects it for other reasons.
    if (entry.inTurn) {
      entry.pendingRecycleReason = failure
      return
    }
    this.recycleInternal(entry, failure)
  }

  private hasLiveChanges(entry: InternalEntry, opts: ClaudePoolAcquireOptions): boolean {
    if (opts.model && opts.model !== entry.desiredModel) return true
    if (opts.permissionMode && opts.permissionMode !== entry.desiredPermissionMode) return true
    const nextEffort = effortToSdk(opts.effort).effort
    return Boolean(opts.effort !== entry.desiredEffort && nextEffort)
  }

  private noteDesiredChanges(entry: InternalEntry, opts: ClaudePoolAcquireOptions): void {
    if (opts.model) entry.desiredModel = opts.model
    if (opts.permissionMode) entry.desiredPermissionMode = opts.permissionMode
    if (effortToSdk(opts.effort).effort) entry.desiredEffort = opts.effort
  }

  private queueConfiguration(entry: InternalEntry, apply: () => Promise<void>): Promise<void> {
    // Recover the chain for a later retry, but keep `next` rejected for the
    // current run so it cannot submit on stale settings after an unexpected
    // control-plane failure.
    // A settings change selected while a turn is active belongs to the next
    // turn. Waiting the current turn tail prevents setModel from mutating the
    // model underneath an already-submitted response.
    const previousSettings = entry.settingsTail.catch(() => {})
    const previousTurn = entry.turnTail.catch(() => {})
    const next = sequenceClaudePoolConfiguration({
      previousSettings,
      previousTurn,
      initialization: entry.initialization,
      isAlive: () => entry.alive,
      // The SDK begins initialize as the Query is constructed. Custom-model
      // control requests must follow that handshake; issuing setModel beside
      // initialize relies on transport ordering and can race on slow workers.
      apply,
    })
    entry.settingsTail = next
    // Every caller normally awaits or attaches its own error handler. Retain a
    // final backstop because this promise is also stored process-wide.
    void next.catch(() => {})
    return next
  }

  private recycleInternal(entry: InternalEntry, _reason: string): void {
    if (!entry.alive) return
    entry.alive = false
    try { entry.endInput() } catch { /* idempotent */ }
    try { entry.query.close() } catch { /* idempotent */ }
    if (entry.subscriber) {
      try { entry.subscriber.push(null) } catch { /* swallow */ }
    }
    if (this.entries.get(entry.poolKey) === entry) {
      this.entries.delete(entry.poolKey)
    }
    // Nudge harness observers to do a final refetch so any tail messages
    // persisted right before the entry died still surface.
    try { broadcastClaudeRecycled(entry.sessionId) } catch { /* swallow */ }
  }

  private ensureCapacity(): void {
    if (this.entries.size < MAX_POOL_SIZE) return
    // Only idle entries are eviction candidates. An in-turn entry's
    // lastActivityAt can look ancient mid-turn, but recycling it would kill a
    // live turn; if every entry is mid-turn, temporarily exceed the cap.
    let oldest: InternalEntry | null = null
    for (const entry of this.entries.values()) {
      if (entry.inTurn) continue
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
      if (entry.inTurn) continue
      if (now - entry.lastActivityAt > IDLE_TTL_MS) {
        this.recycleInternal(entry, 'idle-evict')
      }
    }
    if (this.entries.size === 0 && this.sweepHandle) {
      clearInterval(this.sweepHandle)
      this.sweepHandle = null
    }
  }

  private toPublic(entry: InternalEntry, configuration = entry.settingsTail): ClaudePoolEntry {
    return {
      sessionId: entry.sessionId,
      query: entry.query,
      pushUserMessage: (msg) => entry.pushUserMessage(msg),
      isAlive: () => entry.alive,
      isInitialized: () => entry.initialized,
      whenInitialized: () => entry.initialization,
      whenConfigured: async () => {
        await configuration
        if (!entry.alive) throw new Error('Claude pool entry was recycled while applying configuration')
      },
      run: (message, options) => this.runTurn(entry, configuration, message, options),
      setModel: async (model: string) => {
        entry.desiredModel = model
        await this.queueConfiguration(entry, async () => {
          try {
            await withTimeout(
              entry.query.setModel(model),
              providerStartupTimeoutMs(model),
              'Claude model switch',
            )
            entry.state.model = model
            entry.lastActivityAt = Date.now()
          } catch (err) {
            if (entry.inTurn) entry.pendingRecycleReason = 'set-model-failed'
            else this.recycleInternal(entry, 'set-model-failed')
            throw err
          }
        })
      },
      setPermissionMode: async (mode: PermissionMode) => {
        entry.desiredPermissionMode = mode
        await this.queueConfiguration(entry, async () => {
          try {
            await withTimeout(entry.query.setPermissionMode(mode), 30_000, 'Claude permission-mode switch')
            entry.state.permissionMode = mode
            entry.lastActivityAt = Date.now()
          } catch (err) {
            if (entry.inTurn) entry.pendingRecycleReason = 'set-permission-mode-failed'
            else this.recycleInternal(entry, 'set-permission-mode-failed')
            throw err
          }
        })
      },
    }
  }

  peek(sessionId: string): ClaudePoolEntry | null {
    const entry = this.entries.get(`${currentProviderInstanceId('claude')}:${sessionId}`)
    // A doomed idle entry must not be handed to a prewarm/context probe — it
    // would warm a subprocess that is about to be torn down. An in-turn one is
    // still the live handle callers need (interrupt, context usage).
    if (!entry || !entry.alive || (entry.pendingRecycleReason && !entry.inTurn)) return null
    return this.toPublic(entry)
  }

  /**
   * Adopt a Query/input-stream pair that was already constructed outside the
   * pool (specifically: by createClaudeStreamCold for turn 1 of a brand-new
   * or freshly-resumed/forked/rewound session). The cold path already drained
   * the turn-1 messages; the pool's pump loop takes over for the tail and
   * future turns.
   *
   * Caller responsibilities:
   *   • Stop reading from `query` before calling this — the pump loop owns
   *     the iterator from here.
   *   • Detach any AbortController that would tear `query` down (the cold
   *     path's request-signal abort listener) before adopting.
   *   • Pass the *realized* session id from the SDK (which differs from the
   *     pending UUID we generated).
   *   • Pass `state.resumeSessionAt` / `state.forkSession` as undefined —
   *     those options are one-shot and don't apply to subsequent turns; the
   *     next acquire's compatibility check would otherwise force a recycle.
   *
   * If an entry already exists for `sessionId`, the old one is recycled
   * first so we don't leak its subprocess.
   */
  adopt(args: {
    sessionId: string
    query: Query
    pushUserMessage: (msg: SDKUserMessage) => void
    endInput: () => void
    options: ClaudePoolAcquireOptions
    /**
     * The bridgeBox from the cold-path query. Passing this ensures the
     * delegation closure already baked into the Query still routes to the
     * correct per-turn bridge when future pool turns run.
     */
    bridgeBox?: ClaudeBridgeBox
  }): void {
    const { sessionId, query: q, pushUserMessage, endInput, options } = args
    const poolKey = `${currentProviderInstanceId('claude')}:${sessionId}`
    const existing = this.entries.get(poolKey)
    if (existing) this.recycleInternal(existing, 'pre-adopt-replace')
    this.ensureCapacity()

    const entry: InternalEntry = {
      sessionId,
      poolKey,
      query: q,
      state: {
        cwd: options.cwd,
        model: options.model,
        fallbackModel: options.fallbackModel,
        permissionMode: options.permissionMode,
        effort: options.effort,
        // The one-shot options below don't apply to future turns of the
        // adopted session — the Query has already moved past them. Storing
        // them as undefined keeps compatible() happy on the next acquire.
        resumeSessionAt: undefined,
        forkSession: undefined,
        taskBudgetTokens: options.taskBudgetTokens,
        maxBudgetUsd: options.maxBudgetUsd,
        enableWorkflow: options.enableWorkflow,
        agentPolicyKey: claudeAgentPolicyKey(options.agentPolicy),
      },
      buffer: [],
      subscriber: null,
      pushUserMessage,
      endInput,
      turnTail: Promise.resolve(),
      initialization: Promise.resolve(),
      initialized: true,
      settingsTail: Promise.resolve(),
      desiredModel: options.model,
      desiredPermissionMode: options.permissionMode,
      desiredEffort: options.effort,
      lastActivityAt: Date.now(),
      inTurn: false,
      pendingRecycleReason: null,
      alive: true,
      // Reuse the bridgeBox from the cold-path spawn so its delegation closure
      // (already frozen into the Query) routes through the same object.
      bridgeBox: args.bridgeBox ?? { fn: null, elicit: null, dialog: null },
    }

    this.entries.set(poolKey, entry)
    this.ensureSweep()
    void this.pumpQueryToSubscriber(entry)
  }

  private async runTurn(
    entry: InternalEntry,
    configuration: Promise<void>,
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

    // acquire() synchronously queued any live model/permission/effort changes
    // before run() was called. Wait for those control RPCs before submitting
    // the prompt; otherwise a slow custom-model switch can lose a race and the
    // previous model receives the turn. The no-change hot path is one already-
    // resolved promise.
    try {
      await configuration
    } catch (err) {
      releaseMutex()
      throw err instanceof Error ? err : new Error(String(err))
    }

    if (!entry.alive) {
      releaseMutex()
      throw new Error('Claude pool entry was recycled before turn could start')
    }

    // From here until the finally below, this entry must be immune to LRU
    // eviction and the idle sweep.
    entry.inTurn = true

    let resolveTurn!: () => void
    let rejectTurn!: (err: Error) => void
    const turnDone = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve
      rejectTurn = reject
    })

    let resultSeen = false
    let queuedTurnsPending = false
    let tailTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleTailDrain = () => {
      if (tailTimer) clearTimeout(tailTimer)
      tailTimer = setTimeout(() => {
        tailTimer = null
        resolveTurn()
      }, TURN_TAIL_DRAIN_MS)
    }

    // Inactivity watchdog, not an absolute turn-duration cap: a healthy turn
    // that keeps producing messages (partial deltas, tool progress, etc.) can
    // legitimately run far longer than TURN_HARD_TIMEOUT_MS — a large test
    // run or multi-step refactor easily exceeds 10 minutes of wall clock
    // while still making progress every few seconds. What must never happen
    // is the mutex getting stranded on a subprocess that has gone silent, so
    // the timer resets on every message received and only fires after the
    // session produces nothing at all for the full window.
    let hardTimer = setTimeout(() => {
      rejectTurn(new Error('Claude turn exceeded hard timeout'))
    }, TURN_HARD_TIMEOUT_MS)
    const resetHardTimer = () => {
      clearTimeout(hardTimer)
      hardTimer = setTimeout(() => {
        rejectTurn(new Error('Claude turn exceeded hard timeout'))
      }, TURN_HARD_TIMEOUT_MS)
    }

    const subscriber: Subscriber = {
      push: (msg) => {
        if (msg === null) {
          if (tailTimer) clearTimeout(tailTimer)
          rejectTurn(new Error('Claude pool entry was recycled mid-turn'))
          return
        }
        resetHardTimer()
        try { options.onMessage(msg) } catch { /* don't let consumer errors strand the mutex */ }
        if (msg.type === 'result') {
          queuedTurnsPending = claudeResultHasQueuedTurns(msg)
          if (queuedTurnsPending) {
            resultSeen = false
            if (tailTimer) {
              clearTimeout(tailTimer)
              tailTimer = null
            }
            return
          }
          resultSeen = true
          scheduleTailDrain()
          return
        }
        if (
          msg.type === 'system'
          && 'subtype' in msg
          && (msg as SDKSessionStateChangedMessage).subtype === 'session_state_changed'
          && (msg as SDKSessionStateChangedMessage).state === 'idle'
          && !queuedTurnsPending
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
      entry.inTurn = false
      entry.subscriber = null
      clearTimeout(hardTimer)
      releaseMutex()
      throw new Error('Claude pool entry was recycled before turn could start')
    }

    let interruptFallbackTimer: ReturnType<typeof setTimeout> | null = null
    const abortHandler = () => {
      void entry.query.interrupt().catch(() => {})
      // If the SDK interrupt is silently a no-op, the turn keeps streaming and
      // holds this entry's FIFO mutex until the 10-min hard timeout, blocking
      // every subsequent send to the session. Recycle after a short grace so
      // the turn rejects, the mutex frees, and the next send reconnects fresh.
      if (interruptFallbackTimer) clearTimeout(interruptFallbackTimer)
      interruptFallbackTimer = setTimeout(() => {
        interruptFallbackTimer = null
        if (entry.alive) this.recycleInternal(entry, 'interrupt-fallback')
      }, INTERRUPT_FALLBACK_MS)
    }
    if (options.signal.aborted) abortHandler()
    else options.signal.addEventListener('abort', abortHandler, { once: true })

    entry.lastActivityAt = Date.now()
    // Install the per-turn bridge (if any) before pushing the message so the
    // delegation is live by the time any tool call arrives.
    entry.bridgeBox.fn = options.bridge ?? null
    entry.bridgeBox.elicit = options.elicit ?? null
    entry.bridgeBox.dialog = options.dialog ?? null
    try {
      // Read-state seeding is a safety/cache repair, not part of prompt
      // delivery. Let it use the already-warm Query in the background so a
      // queued file-read seed cannot delay the user's turn.
      void this.applyReadSeeds(entry).catch(() => {})
      entry.pushUserMessage(message)
      try { options.onSubmitted?.() } catch { /* a caller hook must never strand the mutex */ }
      try { broadcastClaudeTurnStart(entry.sessionId) } catch { /* swallow */ }
    } catch (err) {
      entry.bridgeBox.fn = null
      entry.bridgeBox.elicit = null
      entry.bridgeBox.dialog = null
      entry.subscriber = null
      entry.inTurn = false
      if (interruptFallbackTimer) clearTimeout(interruptFallbackTimer)
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
      // Clear the bridge before releasing the mutex so the next turn starts
      // with a clean slate even if the current turn's onError never fired.
      entry.bridgeBox.fn = null
      entry.bridgeBox.elicit = null
      entry.bridgeBox.dialog = null
      if (tailTimer) clearTimeout(tailTimer)
      if (interruptFallbackTimer) clearTimeout(interruptFallbackTimer)
      clearTimeout(hardTimer)
      options.signal.removeEventListener('abort', abortHandler)
      entry.subscriber = null
      entry.inTurn = false
      entry.lastActivityAt = Date.now()
      try { broadcastClaudeTurnEnd(entry.sessionId) } catch { /* swallow */ }
      releaseMutex()
      // Apply a live-settings failure deferred during this turn (see
      // applyLiveChanges) now that it's safe — the turn is fully done and the
      // mutex is free for whatever comes next.
      if (entry.pendingRecycleReason) {
        const reason = entry.pendingRecycleReason
        entry.pendingRecycleReason = null
        this.recycleInternal(entry, reason)
      }
    }
  }
}

/**
 * Shared by the pool and createClaudeStreamCold (so the cold-path Query can
 * later be adopted into the pool without rebuilding its input plumbing).
 */
export function createInputStream(): {
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
 * Queue mtime-guarded read-state seeds after a file rewind or checkpoint
 * restore. They are delivered to the persistent Query immediately before its
 * next prompt, so the seed survives control-query teardown and cannot race the
 * next Edit.
 */
export async function queueClaudeReadStateSeeds(sessionId: string, cwd: string, paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))]
  const seeds = (await Promise.all(unique.map(async (filePath) => {
    const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
    try {
      const info = await stat(absolute)
      return info.isFile() ? { path: absolute, mtime: Math.floor(info.mtimeMs) } : null
    } catch {
      return null
    }
  }))).filter((seed): seed is { path: string; mtime: number } => seed !== null)
  getPool().queueReadSeeds(sessionId, seeds)
  return seeds.length
}

/** Number of warm Claude subprocesses currently pooled. Diagnostics only. */
export function claudePoolSize(): number {
  return getPool().size
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
 * Adopt a Query/input-stream pair built outside the pool — see
 * `ClaudePool.adopt` for caller responsibilities.
 */
export function adoptClaudeSession(args: {
  sessionId: string
  query: Query
  pushUserMessage: (msg: SDKUserMessage) => void
  endInput: () => void
  options: ClaudePoolAcquireOptions
  bridgeBox?: ClaudeBridgeBox
}): void {
  return getPool().adopt(args)
}

/**
 * Build the wire-format SDKUserMessage from either a plain text prompt or a
 * pre-shaped one (e.g. text + image blocks). Used by the SSE adapter to
 * normalise whatever buildClaudePrompt produced.
 */
function toSdkUserMessage(prompt: string | { message: SDKUserMessage['message'] }): SDKUserMessage {
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
