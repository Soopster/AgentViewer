// Persistent ACP (Agent Client Protocol) subprocess pool for the main
// session backend — the viewer-facing counterpart to lib/claudePool.ts.
//
// Unlike bin/agent-viewer-acp-client.mjs (one fresh `session/new` per
// coordinator tick, auto-approved, torn down immediately after), sessions
// here are long-lived: one subprocess + one ACP session survives across the
// web/TUI's repeated polling requests, and permission/elicitation requests
// are queued for a real UI round-trip instead of auto-approved.
//
// ACP's session/update is push-based (ActiveSession.nextUpdate() yields
// notifications as they arrive), while sessionBackend.ts's message-window
// API is poll+offset based. This pool bridges the two: a background loop
// drains nextUpdate() into a per-session append-only, monotonically
// indexed buffer that listViewSessionMessageWindow can slice by offset.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ActiveSessionMessage,
  type ClientContext,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import { resolveAcpAgentCommand, type AcpAgentKind } from './acpAgentSpawn'

// Buffered updates the poll+offset window can never realistically approach
// in one session's lifetime; caps memory for an abandoned/runaway session.
const BUFFER_CAP = 5000
// No activity (no prompt in flight, no update received) for this long ->
// the subprocess is considered abandoned and reaped.
const IDLE_TTL_MS = 15 * 60 * 1000
// A prompt is in flight but no session/update has arrived for this long ->
// treat the subprocess as hung, kill it, and let the next acquire respawn.
const STALL_TTL_MS = 5 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

export type AcpBufferedMessage = {
  index: number
  receivedAt: number
  message: ActiveSessionMessage
}

export type AcpPendingRequest = {
  id: string
  sessionId: string
  method: 'session/request_permission' | 'elicitation/create'
  params: RequestPermissionRequest | CreateElicitationRequest
  createdAt: number
}

type PendingResolver =
  | { method: 'session/request_permission'; resolve: (v: RequestPermissionResponse) => void; reject: (e: unknown) => void }
  | { method: 'elicitation/create'; resolve: (v: CreateElicitationResponse) => void; reject: (e: unknown) => void }

type AcpPoolEntry = {
  sessionId: string
  agentKind: AcpAgentKind
  cwd: string
  child: ChildProcess
  ctx: ClientContext
  session: ActiveSession
  buffer: AcpBufferedMessage[]
  nextIndex: number
  pendingRequests: Map<string, AcpPendingRequest>
  pendingResolvers: Map<string, PendingResolver>
  alive: boolean
  inTurn: boolean
  lastActivityAt: number
  closedDeferred: { promise: Promise<void>; resolve: () => void }
  lastError: string | null
}

/** Recursively lists live descendant pids of `pid` via pgrep (macOS/Linux only). */
function collectDescendantPids(pid: number): number[] {
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (!out) return []
    const children = out.split('\n').map(Number).filter(Number.isFinite)
    return children.flatMap((childPid) => [childPid, ...collectDescendantPids(childPid)])
  } catch {
    return []
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

let requestCounter = 0
function nextRequestId(): string {
  requestCounter += 1
  return `acp-req-${Date.now()}-${requestCounter}`
}

class AcpClientPool {
  private entries = new Map<string, AcpPoolEntry>()
  private sweepHandle: ReturnType<typeof setInterval> | null = null

  get size(): number {
    return this.entries.size
  }

  private ensureSweep(): void {
    if (this.sweepHandle) return
    this.sweepHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    this.sweepHandle.unref?.()
  }

  private sweep(): void {
    const now = Date.now()
    for (const entry of this.entries.values()) {
      if (!entry.alive) continue
      const idleFor = now - entry.lastActivityAt
      if (entry.inTurn && idleFor > STALL_TTL_MS) {
        this.terminate(entry, 'stall-evict')
      } else if (!entry.inTurn && idleFor > IDLE_TTL_MS) {
        this.terminate(entry, 'idle-evict')
      }
    }
  }

  /** Returns the existing live entry for sessionId, if any (no spawn). */
  peek(sessionId: string): AcpPoolEntry | null {
    const entry = this.entries.get(sessionId)
    return entry && entry.alive ? entry : null
  }

  /** Spawn-or-reuse a persistent ACP subprocess+session for sessionId. */
  async acquire(sessionId: string, agentKind: AcpAgentKind, cwd: string): Promise<AcpPoolEntry> {
    const existing = this.entries.get(sessionId)
    if (existing && existing.alive) return existing
    return this.spawnEntry(sessionId, agentKind, cwd)
  }

  private async spawnEntry(sessionId: string, agentKind: AcpAgentKind, cwd: string): Promise<AcpPoolEntry> {
    this.ensureSweep()
    const command = resolveAcpAgentCommand(agentKind)
    // detached so the agent (codex-acp in particular) gets its own process
    // group — its own sandboxed exec helpers are then reachable by signaling
    // the group, not just the direct child, on close/reap.
    const child = spawn(command, [], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })

    let spawnErrored: Error | null = null
    child.once('error', (err) => {
      spawnErrored = err instanceof Error ? err : new Error(String(err))
    })

    const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream)
    const closedDeferred = deferred()
    const pendingRequests = new Map<string, AcpPendingRequest>()
    const pendingResolvers = new Map<string, PendingResolver>()

    const entryRef: { current: AcpPoolEntry | null } = { current: null }

    function queueClientRequest<Method extends AcpPendingRequest['method']>(
      method: Method,
      params: AcpPendingRequest['params'],
    ): Promise<Method extends 'session/request_permission' ? RequestPermissionResponse : CreateElicitationResponse> {
      const id = nextRequestId()
      pendingRequests.set(id, { id, sessionId, method, params, createdAt: Date.now() })
      return new Promise((resolve, reject) => {
        pendingResolvers.set(id, { method, resolve, reject } as PendingResolver)
      }) as never
    }

    const clientApp = client({ name: 'agent-viewer' })
      .onRequest('session/request_permission', async (reqCtx) => queueClientRequest('session/request_permission', reqCtx.params))
      .onRequest('elicitation/create', async (reqCtx) => queueClientRequest('elicitation/create', reqCtx.params))
      .onRequest('fs/read_text_file', async () => {
        throw new Error('agent-viewer does not expose client-side filesystem access over ACP')
      })
      .onRequest('fs/write_text_file', async () => {
        throw new Error('agent-viewer does not expose client-side filesystem access over ACP')
      })

    const connectPromise = clientApp.connectWith(stream, async (ctx) => {
      await ctx.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: 'agent-viewer', title: 'Agent Viewer', version: '0.1.0' },
      })
      const session = await ctx.buildSession(cwd).start()

      const entry: AcpPoolEntry = {
        sessionId,
        agentKind,
        cwd,
        child,
        ctx,
        session,
        buffer: [],
        nextIndex: 0,
        pendingRequests,
        pendingResolvers,
        alive: true,
        inTurn: false,
        lastActivityAt: Date.now(),
        closedDeferred,
        lastError: null,
      }
      entryRef.current = entry
      this.entries.set(sessionId, entry)

      void this.pumpUpdates(entry)

      await closedDeferred.promise
    })

    connectPromise.catch((err) => {
      const entry = entryRef.current
      if (entry) {
        entry.alive = false
        entry.lastError = err instanceof Error ? err.message : String(err)
      }
    }).finally(() => {
      this.cleanupChild(child)
      const entry = entryRef.current
      if (entry && this.entries.get(sessionId) === entry) this.entries.delete(sessionId)
    })

    // Wait for either the session to come up or the subprocess to fail fast.
    const started = await Promise.race([
      new Promise<AcpPoolEntry>((resolve, reject) => {
        const check = () => {
          if (spawnErrored) return reject(spawnErrored)
          if (entryRef.current) return resolve(entryRef.current)
          setTimeout(check, 20)
        }
        check()
      }),
      connectPromise.then(() => {
        throw new Error(`ACP agent process for ${agentKind} exited before session/new completed`)
      }),
    ])
    return started
  }

  private async pumpUpdates(entry: AcpPoolEntry): Promise<void> {
    try {
      for (;;) {
        if (!entry.alive) return
        const message = await entry.session.nextUpdate()
        entry.lastActivityAt = Date.now()
        const index = entry.nextIndex
        entry.nextIndex += 1
        entry.buffer.push({ index, receivedAt: Date.now(), message })
        if (entry.buffer.length > BUFFER_CAP) entry.buffer.splice(0, entry.buffer.length - BUFFER_CAP)
        if (message.kind === 'stop') entry.inTurn = false
      }
    } catch (err) {
      entry.alive = false
      entry.lastError = err instanceof Error ? err.message : String(err)
      entry.closedDeferred.resolve()
    }
  }

  private cleanupChild(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) return
    const pid = child.pid
    if (typeof pid !== 'number') {
      try { child.kill('SIGTERM') } catch { /* already exited */ }
      return
    }
    // Both agents spawn their real worker in its own session, escaping this
    // process's group (the actual `claude` CLI for claude-agent-acp; codex
    // app-server's sandboxed exec helper for codex-acp) — a plain group
    // signal (even with detached: true) never reaches it, so walk the live
    // tree via pgrep and signal every descendant directly. codex-acp's
    // sandbox worker can also appear *after* the initial signal (spawned in
    // reaction to session/cancel or its own shutdown sequence), so this
    // polls and re-kills newly discovered descendants across the whole
    // escalation window instead of a single snapshot-then-kill.
    const killTree = (sig: NodeJS.Signals) => {
      for (const descendantPid of collectDescendantPids(pid)) {
        try { process.kill(descendantPid, sig) } catch { /* already exited */ }
      }
      try { process.kill(-pid, sig) } catch { /* already exited */ }
      try { child.kill(sig) } catch { /* already exited */ }
    }
    killTree('SIGTERM')
    let ticks = 0
    const interval = setInterval(() => {
      ticks += 1
      killTree(ticks >= 6 ? 'SIGKILL' : 'SIGTERM')
      if (ticks >= 6) clearInterval(interval)
    }, 500)
    interval.unref?.()
  }

  private terminate(entry: AcpPoolEntry, _reason: string): void {
    entry.alive = false
    for (const [id, resolver] of entry.pendingResolvers) {
      resolver.reject(new Error('ACP session closed'))
      entry.pendingResolvers.delete(id)
      entry.pendingRequests.delete(id)
    }
    // Resolving closedDeferred unblocks the spawnEntry connectPromise's
    // .finally(), which owns the actual subprocess-group kill — don't
    // duplicate it here (a second signal after the group's pid is reaped
    // can hit a since-recycled pid and throw EPERM/ESRCH).
    entry.closedDeferred.resolve()
    this.entries.delete(entry.sessionId)
  }

  /** Sends a prompt; resolves once queued (not once the turn completes). */
  sendPrompt(sessionId: string, text: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry || !entry.alive) throw new Error(`No live ACP session: ${sessionId}`)
    entry.inTurn = true
    entry.lastActivityAt = Date.now()
    entry.session.prompt(text).catch((err) => {
      entry.lastError = err instanceof Error ? err.message : String(err)
    }).finally(() => {
      entry.inTurn = false
    })
  }

  async interrupt(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId)
    if (!entry || !entry.alive) return
    await entry.ctx.notify('session/cancel', { sessionId: entry.session.sessionId })
  }

  close(sessionId: string): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    this.terminate(entry, 'closed')
  }

  /** Buffered messages strictly after `offset` (offset = last-seen index, -1 for none seen). */
  readSince(sessionId: string, offset: number): { messages: AcpBufferedMessage[]; latestIndex: number } {
    const entry = this.entries.get(sessionId)
    if (!entry) return { messages: [], latestIndex: -1 }
    const messages = entry.buffer.filter((m) => m.index > offset)
    const latestIndex = entry.nextIndex - 1
    return { messages, latestIndex }
  }

  pendingRequestsFor(sessionId: string): AcpPendingRequest[] {
    const entry = this.entries.get(sessionId)
    if (!entry) return []
    return [...entry.pendingRequests.values()]
  }

  resolvePermission(sessionId: string, requestId: string, response: RequestPermissionResponse): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    const resolver = entry.pendingResolvers.get(requestId)
    if (!resolver || resolver.method !== 'session/request_permission') return
    entry.pendingResolvers.delete(requestId)
    entry.pendingRequests.delete(requestId)
    resolver.resolve(response)
  }

  resolveElicitation(sessionId: string, requestId: string, response: CreateElicitationResponse): void {
    const entry = this.entries.get(sessionId)
    if (!entry) return
    const resolver = entry.pendingResolvers.get(requestId)
    if (!resolver || resolver.method !== 'elicitation/create') return
    entry.pendingResolvers.delete(requestId)
    entry.pendingRequests.delete(requestId)
    resolver.resolve(response)
  }

  /**
   * Translates the shared cross-provider 'once'|'always'|'reject' vocabulary
   * (lib/permissions.ts's PermissionResponse) into the ACP outcome for this
   * specific request, by matching against the option kinds the agent
   * actually offered in its session/request_permission call — mirrors
   * lib/acpAgent.ts's resolvePermission, direction reversed (there,
   * agentViewer issues the request; here, it answers one).
   */
  respondPermissionDecision(sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject'): void {
    const entry = this.entries.get(sessionId)
    const pending = entry?.pendingRequests.get(requestId)
    if (!entry || !pending || pending.method !== 'session/request_permission') return
    const request = pending.params as RequestPermissionRequest
    const wantKind = decision === 'always' ? 'allow_always' : decision === 'once' ? 'allow_once' : 'reject_once'
    const fallbackKind = decision === 'reject' ? 'reject_always' : 'allow_once'
    const option = request.options.find((o) => o.kind === wantKind) ?? request.options.find((o) => o.kind === fallbackKind)
    const outcome: RequestPermissionResponse['outcome'] = option
      ? { outcome: 'selected', optionId: option.optionId }
      : { outcome: 'cancelled' }
    this.resolvePermission(sessionId, requestId, { outcome })
  }

  /** Declines an elicitation — used for questions/elicitations, which this
   * transport surfaces but doesn't yet answer with structured content (see
   * lib/acpAgent.ts's declineQuestion for the equivalent reverse-direction
   * fallback). */
  declineElicitation(sessionId: string, requestId: string): void {
    this.resolveElicitation(sessionId, requestId, { action: 'decline' })
  }

  isAlive(sessionId: string): boolean {
    return this.entries.get(sessionId)?.alive ?? false
  }
}

let pool: AcpClientPool | null = null
function getPool(): AcpClientPool {
  if (!pool) pool = new AcpClientPool()
  return pool
}

export function acquireAcpSession(sessionId: string, agentKind: AcpAgentKind, cwd: string): Promise<AcpPoolEntry> {
  return getPool().acquire(sessionId, agentKind, cwd)
}

export function peekAcpSession(sessionId: string): AcpPoolEntry | null {
  return getPool().peek(sessionId)
}

export function sendAcpPrompt(sessionId: string, text: string): void {
  getPool().sendPrompt(sessionId, text)
}

export function interruptAcpSession(sessionId: string): Promise<void> {
  return getPool().interrupt(sessionId)
}

export function closeAcpSession(sessionId: string): void {
  getPool().close(sessionId)
}

export function readAcpMessagesSince(sessionId: string, offset: number): { messages: AcpBufferedMessage[]; latestIndex: number } {
  return getPool().readSince(sessionId, offset)
}

export function acpPendingRequests(sessionId: string): AcpPendingRequest[] {
  return getPool().pendingRequestsFor(sessionId)
}

export function resolveAcpPermission(sessionId: string, requestId: string, response: RequestPermissionResponse): void {
  getPool().resolvePermission(sessionId, requestId, response)
}

export function respondAcpPermissionDecision(sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject'): void {
  getPool().respondPermissionDecision(sessionId, requestId, decision)
}

export function declineAcpElicitation(sessionId: string, requestId: string): void {
  getPool().declineElicitation(sessionId, requestId)
}

export function resolveAcpElicitation(sessionId: string, requestId: string, response: CreateElicitationResponse): void {
  getPool().resolveElicitation(sessionId, requestId, response)
}

export function isAcpSessionAlive(sessionId: string): boolean {
  return getPool().isAlive(sessionId)
}

export function acpPoolSize(): number {
  return getPool().size
}
