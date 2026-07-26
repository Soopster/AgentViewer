import type {
  SessionManager,
  SessionInfo as PiSessionInfo,
  SessionEntry,
  AgentSession,
} from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

// The Pi SDK is ~86MB resident once loaded (measured) — by far the heaviest
// provider SDK. Import it lazily and cache the module so a Claude/Codex/etc.
// session never pays for Pi just because sessionBackend imports this module.
// All runtime SDK access goes through loadPiSdk(); the imports above are
// type-only (erased at compile time, zero runtime cost).
type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type PiPoolEntry = { session: AgentSession; lastUsed: number; timer: ReturnType<typeof setTimeout> }

declare global {
  // Pi sessions own SDK subscriptions, retry loops, and eviction timers. Keep
  // the SDK load, path index, single-flight opens, and warm pool together across
  // Next.js development reloads so a reload cannot orphan or duplicate them.
  // eslint-disable-next-line no-var
  var __agentViewerPiSdkPromise: Promise<PiSdk> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionPathCache: Map<string, string> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionInflight: Map<string, Promise<AgentSession>> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionPool: Map<string, PiPoolEntry> | undefined
}

function loadPiSdk(): Promise<PiSdk> {
  if (!globalThis.__agentViewerPiSdkPromise) {
    const sdk = import('@earendil-works/pi-coding-agent').catch((error) => {
      if (globalThis.__agentViewerPiSdkPromise === sdk) {
        globalThis.__agentViewerPiSdkPromise = undefined
      }
      throw error
    })
    globalThis.__agentViewerPiSdkPromise = sdk
  }
  return globalThis.__agentViewerPiSdkPromise
}

// Cache session ID → file path mappings (populated on list, refreshed on miss).
// SessionManager.listAll() can return every Pi session on the machine, so keep
// only a recent working set instead of retaining one path string per session
// for the lifetime of the AgentViewer server.
const PI_SESSION_PATH_CACHE_MAX = 1024
const sessionPathCache = globalThis.__agentViewerPiSessionPathCache
  ?? (globalThis.__agentViewerPiSessionPathCache = new Map<string, string>())

function rememberPiSessionPath(sessionId: string, sessionPath: string): void {
  // Map insertion order doubles as LRU order. Refresh hits so the entry a user
  // just opened survives the next bulk session-list refresh.
  sessionPathCache.delete(sessionId)
  sessionPathCache.set(sessionId, sessionPath)
  while (sessionPathCache.size > PI_SESSION_PATH_CACHE_MAX) {
    const oldest = sessionPathCache.keys().next().value
    if (typeof oldest !== 'string') break
    sessionPathCache.delete(oldest)
  }
}

function rememberPiSessions(sessions: readonly PiSessionInfo[]): void {
  // Pi returns newest first. Insert the bounded slice oldest-to-newest so the
  // most recently modified sessions finish at the hot end of the LRU map.
  for (const session of sessions.slice(0, PI_SESSION_PATH_CACHE_MAX).toReversed()) {
    rememberPiSessionPath(session.id, session.path)
  }
}

/** Number of cached id-to-path strings. Diagnostics only. */
export function piSessionPathCacheSize(): number {
  return sessionPathCache.size
}

function sessionIdFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/\.jsonl$/, '')
}

function wrapPiError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : 'Unknown Pi error'
  if (/ENOENT|not found|no.*session/i.test(detail)) {
    return new Error(
      `Failed to access Pi sessions. Options:\n` +
      `  • Set PI_SESSION_DIR to point to your Pi sessions directory\n` +
      `  • Ensure Pi has been used in this project directory\n` +
      `Original error: ${detail}`,
    )
  }
  return new Error(`Pi provider error. ${detail}`)
}

export type PiSessionListEntry = PiSessionInfo

export async function listPiSessions(cwd?: string): Promise<PiSessionListEntry[]> {
  try {
    const { SessionManager } = await loadPiSdk()
    const sessions = cwd
      ? await SessionManager.list(cwd, process.env.PI_SESSION_DIR)
      : await SessionManager.listAll()
    rememberPiSessions(sessions)
    return sessions
  } catch (error) {
    throw wrapPiError(error)
  }
}

export async function openPiSessionManager(sessionId: string): Promise<SessionManager> {
  let sessionPath = sessionPathCache.get(sessionId)
  if (sessionPath) rememberPiSessionPath(sessionId, sessionPath)
  if (!sessionPath) {
    // The path cache is process-local and empties on every server restart.
    // Resolve from disk before giving up — sending to a session by id must
    // work without a prior session-list fetch, like `pi --resume` does.
    const sessions = await listPiSessions().catch(() => [])
    sessionPath = sessions.find((session) => session.id === sessionId)?.path
    if (sessionPath) rememberPiSessionPath(sessionId, sessionPath)
  }
  if (!sessionPath) {
    throw new Error(`Pi session not found: ${sessionId}. Try refreshing the session list.`)
  }
  try {
    const { SessionManager } = await loadPiSdk()
    return SessionManager.open(sessionPath, process.env.PI_SESSION_DIR)
  } catch (error) {
    throw wrapPiError(error)
  }
}

export async function getPiSessionMessages(sessionId: string): Promise<AgentMessage[]> {
  const sm = await openPiSessionManager(sessionId)
  const entries = sm.getBranch()
  const messages: AgentMessage[] = []
  for (const entry of entries) {
    if (entry.type === 'message') {
      messages.push((entry as Extract<SessionEntry, { type: 'message' }>).message)
    }
  }
  return messages
}

export async function getPiSessionEntries(sessionId: string): Promise<SessionEntry[]> {
  const sm = await openPiSessionManager(sessionId)
  return sm.getBranch()
}

// Cold AgentSession construction is slow (resourceLoader.reload + package
// resolution — tens of seconds on a cold dev server). Concurrent calls for the
// same id must share one construction: without dedup, a retry racing the first
// send builds a second AgentSession for the same session and orphans one (the
// pool keeps only the last), leaking its subscriptions and drifting ids.
const piSessionInflight = globalThis.__agentViewerPiSessionInflight
  ?? (globalThis.__agentViewerPiSessionInflight = new Map<string, Promise<AgentSession>>())

export async function createPiAgentSession(cwd: string, options: { id?: string } = {}): Promise<AgentSession> {
  // Idempotent for a requested id: a prewarm (composer focus) and the first
  // real send both call this for the same pending session. Reuse the pooled
  // session instead of paying createAgentSession twice.
  if (options.id) {
    const cached = piSessionPool.get(options.id)
    if (cached) {
      cached.lastUsed = Date.now()
      schedulePiEviction(options.id)
      return cached.session
    }
    const inflight = piSessionInflight.get(options.id)
    if (inflight) return inflight
  }
  const build = (async () => {
    try {
      const { SessionManager, createAgentSession } = await loadPiSdk()
      const sessionManager = options.id
        ? SessionManager.create(cwd, process.env.PI_SESSION_DIR, { id: options.id })
        : undefined
      const result = await createAgentSession(sessionManager ? { sessionManager } : { cwd })
      const id = result.session.sessionId
      const file = result.session.sessionFile
      if (file) {
        rememberPiSessionPath(id, file)
      }
      // Seed the pool so openPiAgentSession hits the cache on the 2nd message instead of
      // calling createAgentSession again (which would re-run resourceLoader.reload() and
      // package resolution, causing spurious npm install output on every new session).
      const entry: PiPoolEntry = {
        session: result.session,
        lastUsed: Date.now(),
        timer: setTimeout(() => {}, 0),
      }
      piSessionPool.set(id, entry)
      schedulePiEviction(id)
      enforcePiPoolLimit(id)
      return result.session
    } catch (error) {
      throw wrapPiError(error)
    }
  })()
  if (options.id) {
    piSessionInflight.set(options.id, build)
    build.finally(() => piSessionInflight.delete(options.id!)).catch(() => {})
  }
  return build
}

// Pool of warm Pi AgentSessions so back-to-back sends don't pay the full
// createAgentSession cost on every turn. The native Pi CLI keeps the session
// process alive between prompts — this pool mirrors that. Entries are evicted
// after `PI_SESSION_TTL_MS` of inactivity to bound memory.
const PI_SESSION_TTL_MS = 5 * 60 * 1000
const PI_SESSION_POOL_MAX = 3
const piSessionPool = globalThis.__agentViewerPiSessionPool
  ?? (globalThis.__agentViewerPiSessionPool = new Map<string, PiPoolEntry>())

type PiPoolSnapshotEntry = { sessionId: string; lastUsed: number; isStreaming: boolean }

/**
 * Select the least-recently-used idle sessions that can be removed to reach
 * the warm-pool cap. Streaming sessions deliberately make this a soft cap:
 * they remain alive until a later insertion or the existing TTL can evict
 * them safely.
 *
 * Exported so the memory policy can be regression-tested without importing
 * the heavyweight Pi SDK or constructing real AgentSessions.
 */
export function selectPiPoolEvictions(
  entries: readonly PiPoolSnapshotEntry[],
  maxEntries = PI_SESSION_POOL_MAX,
  protectedSessionId?: string,
): string[] {
  const excess = entries.length - Math.max(0, maxEntries)
  if (excess <= 0) return []
  return entries
    .filter((entry) => !entry.isStreaming && entry.sessionId !== protectedSessionId)
    .toSorted((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, excess)
    .map((entry) => entry.sessionId)
}

/** Number of warm Pi AgentSessions currently pooled. Diagnostics only. */
export function piPoolSize(): number {
  return piSessionPool.size
}

// Tear down a pooled AgentSession's background work (retry/compaction loops,
// branch summary, bash) and its agent event subscription. Without this an
// evicted session leaks those listeners + timers. dispose() aborts in-flight
// work, so callers must only invoke this on a session that is not mid-turn.
function disposePiEntry(entry: PiPoolEntry): void {
  try {
    entry.session.dispose()
  } catch {
    // Dispose must not throw out of an eviction/teardown path.
  }
}

function enforcePiPoolLimit(protectedSessionId: string): void {
  const evictions = selectPiPoolEvictions(
    Array.from(piSessionPool, ([sessionId, entry]) => ({
      sessionId,
      lastUsed: entry.lastUsed,
      isStreaming: entry.session.isStreaming,
    })),
    PI_SESSION_POOL_MAX,
    protectedSessionId,
  )
  for (const sessionId of evictions) {
    const entry = piSessionPool.get(sessionId)
    if (!entry || entry.session.isStreaming) continue
    clearTimeout(entry.timer)
    piSessionPool.delete(sessionId)
    disposePiEntry(entry)
  }
}

function schedulePiEviction(sessionId: string): void {
  const entry = piSessionPool.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    const current = piSessionPool.get(sessionId)
    if (!current || Date.now() - current.lastUsed < PI_SESSION_TTL_MS) return
    // A detached turn can outlive the idle TTL. Never dispose mid-turn (it would
    // abort the live turn) — defer eviction until the session goes idle.
    if (current.session.isStreaming) {
      schedulePiEviction(sessionId)
      return
    }
    piSessionPool.delete(sessionId)
    disposePiEntry(current)
  }, PI_SESSION_TTL_MS)
  // Don't keep the event loop alive solely for eviction.
  if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) {
    (entry.timer as { unref: () => void }).unref()
  }
}

export async function openPiAgentSession(sessionId: string): Promise<AgentSession> {
  const cached = piSessionPool.get(sessionId)
  if (cached) {
    cached.lastUsed = Date.now()
    schedulePiEviction(sessionId)
    return cached.session
  }
  // Same single-flight rule as createPiAgentSession: concurrent opens of one
  // session must not each construct (and orphan) an AgentSession.
  const inflight = piSessionInflight.get(sessionId)
  if (inflight) return inflight
  const build = (async () => {
    const sm = await openPiSessionManager(sessionId)
    try {
      const { createAgentSession } = await loadPiSdk()
      const result = await createAgentSession({ sessionManager: sm })
      const entry: PiPoolEntry = {
        session: result.session,
        lastUsed: Date.now(),
        timer: setTimeout(() => {}, 0),
      }
      piSessionPool.set(sessionId, entry)
      schedulePiEviction(sessionId)
      enforcePiPoolLimit(sessionId)
      return result.session
    } catch (error) {
      throw wrapPiError(error)
    }
  })()
  piSessionInflight.set(sessionId, build)
  build.finally(() => piSessionInflight.delete(sessionId)).catch(() => {})
  return build
}

export function evictPiAgentSession(sessionId: string): void {
  const entry = piSessionPool.get(sessionId)
  if (!entry) return
  clearTimeout(entry.timer)
  piSessionPool.delete(sessionId)
  // Explicit eviction (e.g. after a fork rewrote the on-disk state) means this
  // session is stale and must be torn down so its background loops/listeners
  // don't leak — dispose even though it aborts any in-flight work.
  disposePiEntry(entry)
}

export async function refreshPiSessionCache(cwd?: string): Promise<void> {
  const { SessionManager } = await loadPiSdk()
  const sessions = cwd
    ? await SessionManager.list(cwd, process.env.PI_SESSION_DIR)
    : await SessionManager.listAll()
  rememberPiSessions(sessions)
}

export async function forkPiSession(sessionId: string, entryId: string): Promise<string | undefined> {
  const sm = await openPiSessionManager(sessionId)
  sm.branch(entryId)
  const leafId = sm.getLeafId()
  if (!leafId) return undefined
  const newPath = sm.createBranchedSession(leafId)
  if (!newPath) return undefined
  const newId = sessionIdFromPath(newPath)
  rememberPiSessionPath(newId, newPath)
  return newId
}

/** Remove a Pi session file and all process-local references to it. */
export async function deletePiSession(sessionId: string): Promise<void> {
  // If a prewarm/open is still constructing, let it settle before resolution
  // and disposal so it cannot repopulate the pool after deletion.
  await piSessionInflight.get(sessionId)?.catch(() => {})
  const sessions = sessionPathCache.has(sessionId)
    ? null
    : await listPiSessions().catch(() => [])
  const sessionPath = sessionPathCache.get(sessionId)
    ?? sessions?.find((session) => session.id === sessionId)?.path
  if (!sessionPath) throw new Error(`Pi session not found: ${sessionId}`)

  evictPiAgentSession(sessionId)
  const { unlink } = await import('node:fs/promises')
  await unlink(sessionPath)
  sessionPathCache.delete(sessionId)
}
