// What an ACP agent says it can do, and a short-lived connection to ask it.
//
// `lib/acpClientPool.ts` sends `initialize` and throws the response away, so
// until now nothing in Agent Viewer knew what the agents underneath support —
// and `lib/adapters/acp.ts` was written on the assumption that the answer was
// "nothing": no listing, no load, no delete, sessions transient and in-memory.
//
// That assumption is out of date. Measured against the installed agents:
//
//   claude-agent-acp 0.70.0  loadSession, sessionCapabilities {list, resume,
//                            fork, delete, close, additionalDirectories}
//   codex-acp 1.6.2          loadSession, sessionCapabilities {list, resume,
//                            delete, close, additionalDirectories}
//
// The protocol gates each of these on the agent advertising it, so the right
// shape is not "ACP can do X" but "this agent, right now, says it can do X".
// Every caller here asks first and degrades to the old transient behaviour when
// the answer is no — which is also what keeps an older agent working.
//
// Listing is agent-scoped rather than session-scoped, so it cannot ride the
// session pool: answering it means spawning an agent, initializing, asking, and
// closing. That costs a subprocess spawn (~1-3s), and the sidebar polls every
// 5s — so the result is cached and single-flighted, and a stale answer is served
// immediately while a refresh runs behind it. Without that this would spawn an
// agent every five seconds, forever.
import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type ClientContext,
  type SessionInfo as AcpSessionInfo,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { resolveAcpAgentCommand, type AcpAgentKind } from './acpAgentSpawn'
import type { AcpBufferedMessage } from './acpClientPool'

// Long enough that the 5s sessions poll reuses the answer rather than spawning,
// short enough that a session created in another client shows up promptly. A
// stale entry is still served while the refresh runs, so this is the staleness
// ceiling, not a latency floor.
const CAPABILITY_TTL_MS = 5 * 60 * 1000
const SESSION_LIST_TTL_MS = 30 * 1000
// A probe that cannot answer in this long is treated as "cannot answer". The
// agent may be mid-auth or missing; either way the caller falls back.
const PROBE_TIMEOUT_MS = 20 * 1000

export type AcpAgentSupport = {
  /** `session/load` — replay a persisted session's history. */
  loadSession: boolean
  /** `session/list` — enumerate persisted sessions. */
  listSessions: boolean
  /** `session/resume` — continue a persisted session without replaying it. */
  resumeSession: boolean
  /** `session/delete` */
  deleteSession: boolean
  /** `session/fork` */
  forkSession: boolean
}

const NO_SUPPORT: AcpAgentSupport = {
  loadSession: false,
  listSessions: false,
  resumeSession: false,
  deleteSession: false,
  forkSession: false,
}

/**
 * Read an agent's advertisement into the flags this codebase acts on.
 *
 * The session capabilities are `{}`-means-yes / absent-or-null-means-no in the
 * schema, so presence is the signal and the value carries nothing. Treating a
 * `null` as support would make every op fail at the first call instead of
 * quietly staying unavailable.
 */
export function readAcpAgentSupport(capabilities: AgentCapabilities | undefined | null): AcpAgentSupport {
  if (!capabilities) return NO_SUPPORT
  const session = capabilities.sessionCapabilities
  const has = (value: unknown) => value !== undefined && value !== null
  return {
    loadSession: capabilities.loadSession === true,
    listSessions: has(session?.list),
    resumeSession: has((session as { resume?: unknown } | undefined)?.resume),
    deleteSession: has(session?.delete),
    forkSession: has((session as { fork?: unknown } | undefined)?.fork),
  }
}

type Probe = {
  ctx: ClientContext
  child: ChildProcess
  capabilities: AgentCapabilities | undefined
  /**
   * Every `session/update` this connection has received, in arrival order.
   *
   * `session/load` replays a session's history as ordinary notifications while
   * the request is still in flight, so they cannot be collected from the
   * response — the handler has to be registered BEFORE the connection is made,
   * which is why this lives on the probe rather than at the call site.
   */
  updates: SessionNotification[]
  close: () => void
}

/**
 * Spawn an agent, initialize, and hand the connection to `use`. The subprocess
 * is always killed afterwards — this is explicitly NOT a pool, because the
 * session pool already owns long-lived agents and a second one holding an idle
 * subprocess per agent kind would double that cost for a sidebar read.
 */
async function withProbe<T>(agentKind: AcpAgentKind, use: (probe: Probe) => Promise<T>): Promise<T> {
  const command = resolveAcpAgentCommand(agentKind)
  // detached for the same reason the session pool spawns detached: codex-acp
  // starts its own sandboxed helpers, and only signalling the group reaches
  // them. A probe that leaked helpers on every sidebar poll would be worse than
  // no probe at all.
  const child = spawn(command, [], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  // Nothing reads the agent's stderr here, and a pipe nobody drains fills and
  // blocks the child once it has written enough.
  child.stderr?.resume()
  // Teardown noise, not failure. Killing the agent while its stdout is still
  // flowing makes the web-stream adapter enqueue into a closed controller
  // ("Invalid state: Controller is already closed"), which surfaced as a
  // successful load returning null. The probe's result is already settled by
  // then, so these are swallowed rather than allowed to reject it.
  child.stdout?.on('error', () => {})
  child.stdin?.on('error', () => {})
  child.on('error', () => {})
  const kill = () => {
    // End stdin first: the agent sees EOF and stops writing, which is what lets
    // the read side finish cleanly instead of being cut mid-chunk.
    try { child.stdin?.end() } catch { /* already closed */ }
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The group may already be gone, or the platform may not have one.
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
  }
  let settled = false
  const timer = setTimeout(() => { if (!settled) kill() }, PROBE_TIMEOUT_MS)
  try {
    const stream = ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream)
    let capabilities: AgentCapabilities | undefined
    let result!: T
    const updates: SessionNotification[] = []
    await client({ name: 'agent-viewer' })
      // Registered before connecting: a `session/load` replay arrives as
      // notifications while its own request is still pending, so a handler
      // attached afterwards would miss the whole history.
      .onNotification('session/update', async (note) => { updates.push(note.params as SessionNotification) })
      .connectWith(stream, async (ctx) => {
      const initialized = await ctx.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        clientInfo: { name: 'agent-viewer', title: 'Agent Viewer', version: '0.1.0' },
      }) as { agentCapabilities?: AgentCapabilities }
      capabilities = initialized?.agentCapabilities
      result = await use({ ctx, child, capabilities, updates, close: kill })
    })
    return result
  } finally {
    settled = true
    clearTimeout(timer)
    kill()
  }
}

type Cached<T> = { value: T; at: number; inFlight: Promise<T> | null }

const supportCache = new Map<AcpAgentKind, Cached<AcpAgentSupport>>()
const capabilityErrors = new Map<AcpAgentKind, string>()
// Whether this agent's advertised `loadSession` actually works. See
// verifyAcpHistoryReadable.
const historyReadable = new Map<AcpAgentKind, Cached<boolean>>()
const listCache = new Map<AcpAgentKind, Cached<AcpSessionInfo[]>>()

/**
 * Serve `cache` if fresh, refresh behind it if stale, and single-flight the
 * refresh. A stale answer beats a subprocess spawn on a 5s poll, and two
 * concurrent readers must not spawn two agents.
 */
function cachedRead<T>(
  cache: Map<AcpAgentKind, Cached<T>>,
  agentKind: AcpAgentKind,
  ttlMs: number,
  fallback: T,
  read: () => Promise<T>,
): Promise<T> {
  const entry = cache.get(agentKind)
  const fresh = entry && Date.now() - entry.at < ttlMs
  if (entry && fresh) return Promise.resolve(entry.value)
  if (entry?.inFlight) return entry.inFlight
  const inFlight = read()
    .then((value) => {
      capabilityErrors.delete(agentKind)
      cache.set(agentKind, { value, at: Date.now(), inFlight: null })
      return value
    })
    .catch((error: unknown) => {
      // A failed probe must not be cached as a negative answer forever, but it
      // must also not make the next poll retry immediately — an agent that is
      // missing or failing to start would then be respawned every 5 seconds.
      // Caching the fallback with a normal timestamp gives it the same backoff
      // a successful read gets.
      //
      // The reason is RECORDED rather than dropped. Swallowing is right for a
      // sidebar read, which must not fail because an agent is missing, but a
      // swallowed error is indistinguishable from "this agent supports nothing"
      // — and during development that hid a plain programming mistake (passing
      // a provider id where an agent kind was expected) as a capability answer.
      // `acpCapabilityError` surfaces it in diagnostics instead.
      capabilityErrors.set(agentKind, error instanceof Error ? error.message : String(error))
      const value = entry?.value ?? fallback
      cache.set(agentKind, { value, at: Date.now(), inFlight: null })
      return value
    })
  cache.set(agentKind, { value: entry?.value ?? fallback, at: entry?.at ?? 0, inFlight })
  // With no previous answer there is nothing to serve stale, so the first
  // caller waits. Later ones get the cached value while refreshes run behind.
  return entry ? Promise.resolve(entry.value) : inFlight
}

/** What this agent advertises. Cached; never throws. */
export function readAcpAgentCapabilities(agentKind: AcpAgentKind): Promise<AcpAgentSupport> {
  return cachedRead(supportCache, agentKind, CAPABILITY_TTL_MS, NO_SUPPORT, async () => (
    withProbe(agentKind, async (probe) => readAcpAgentSupport(probe.capabilities))
  ))
}

/**
 * Whether this agent can actually replay history, as opposed to claiming it can.
 *
 * An advertised capability is a claim, not a guarantee, and the two genuinely
 * disagree here: codex-acp 1.6.2 advertises `loadSession: true` and then fails
 * every `session/load` with
 * `Internal error … thread <id> already has an active writer` — measured across
 * six of its most recent threads, on fresh connections that had issued no other
 * request. The lock is not connection-scoped, so nothing this client does can
 * release it.
 *
 * That matters because listing is only worth doing if the listed sessions can be
 * opened. Gating on the advertisement alone would have put 250 codex sessions in
 * the sidebar that every one of which opens empty — strictly worse than the
 * transient behaviour it replaced. So the claim is checked once per agent by
 * loading the newest listed session, and the answer is cached with the
 * capability TTL.
 *
 * The check needs its OWN connection: `session/list` itself takes the writer, so
 * a load issued after a list on the same connection fails even against an agent
 * that works.
 *
 * This is self-correcting in both directions — an agent that starts working
 * begins listing on its own, and one that regresses stops.
 */
function verifyAcpHistoryReadable(agentKind: AcpAgentKind, candidate: AcpSessionInfo | undefined): Promise<boolean> {
  if (!candidate) return Promise.resolve(false)
  return cachedRead(historyReadable, agentKind, CAPABILITY_TTL_MS, false, async () => {
    const history = await loadAcpSessionHistory(agentKind, String(candidate.sessionId), candidate.cwd)
    return history !== null
  })
}

/**
 * Persisted sessions this agent knows about, or an empty list when it does not
 * advertise `session/list` — or advertises it but cannot replay what it lists.
 * Cached; never throws — a sidebar read must not fail because an agent is
 * missing.
 */
export function listAcpAgentSessions(agentKind: AcpAgentKind, cwd?: string): Promise<AcpSessionInfo[]> {
  return cachedRead(listCache, agentKind, SESSION_LIST_TTL_MS, [], async () => (
    withProbe(agentKind, async (probe) => {
      if (!readAcpAgentSupport(probe.capabilities).listSessions) return []
      const sessions: AcpSessionInfo[] = []
      let cursor: string | null | undefined
      // Paginate, but bounded: a cursor loop driven by the agent's own response
      // is not something to trust unbounded on a polled read path.
      for (let page = 0; page < 10; page += 1) {
        const response = await probe.ctx.request('session/list', {
          ...(cwd ? { cwd } : {}),
          ...(cursor ? { cursor } : {}),
        }) as { sessions?: AcpSessionInfo[]; nextCursor?: string | null }
        for (const entry of response?.sessions ?? []) sessions.push(entry)
        cursor = response?.nextCursor
        if (!cursor) break
      }
      if (sessions.length === 0) return []
      // Newest first, so the readability check uses the thread most likely to
      // be healthy and the caller gets the useful ordering for free.
      sessions.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      return await verifyAcpHistoryReadable(agentKind, sessions[0]) ? sessions : []
    })
  ))
}

/**
 * Why the last probe of this agent failed, or null. Diagnostics reads it so a
 * missing or broken agent reads as a problem rather than as an agent that
 * happens to support nothing.
 */
export function acpCapabilityError(agentKind: AcpAgentKind): string | null {
  return capabilityErrors.get(agentKind) ?? null
}

/** Test seam: drop every cached answer so the next read re-probes. */
export function clearAcpCapabilityCaches(): void {
  supportCache.clear()
  listCache.clear()
  capabilityErrors.clear()
}

/**
 * Replay a persisted session's history via `session/load`.
 *
 * Returns the `session/update` notifications the agent emitted for it, shaped
 * as the pool's buffered messages so `mapAcpBufferedMessages` can map them with
 * no second code path — a transcript read and a live turn must produce the same
 * cards or the same session would look different depending on how it was opened.
 *
 * Deliberately NOT cached. It costs a subprocess spawn, but it runs when the
 * user opens a session rather than on a poll, and a cached transcript is exactly
 * the thing that goes stale while a turn is running. The mapped-message cache
 * upstream already dedupes repeat reads of an unchanged session.
 *
 * Returns null when the agent cannot load — the caller then falls back to the
 * live pool buffer, which is what a session created in this process has.
 */
export async function loadAcpSessionHistory(
  agentKind: AcpAgentKind,
  sessionId: string,
  cwd: string,
): Promise<AcpBufferedMessage[] | null> {
  try {
    return await withProbe(agentKind, async (probe) => {
      if (!readAcpAgentSupport(probe.capabilities).loadSession) return null
      await probe.ctx.request('session/load', { sessionId, cwd, mcpServers: [] })
      // Only this session's updates: one connection can in principle carry
      // several, and attributing another session's history to this one would be
      // silent and wrong.
      return probe.updates
        .filter((note) => !note.sessionId || note.sessionId === sessionId)
        .map((notification, index) => ({
          index,
          receivedAt: Date.now(),
          message: { kind: 'session_update' as const, notification, update: notification.update },
        }))
    })
  } catch (error) {
    capabilityErrors.set(agentKind, error instanceof Error ? error.message : String(error))
    return null
  }
}
