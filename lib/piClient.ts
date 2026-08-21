import type {
  SessionManager,
  SessionInfo as PiSessionInfo,
  SessionEntry,
  AgentSession,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getCoordinatorPiTools } from './agentCoordinationSdkTools'

// The Pi SDK is ~86MB resident once loaded (measured) — by far the heaviest
// provider SDK. Import it lazily and cache the module so a Claude/Codex/etc.
// session never pays for Pi just because sessionBackend imports this module.
// All runtime SDK access goes through loadPiSdk(); the imports above are
// type-only (erased at compile time, zero runtime cost).
type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type PiPoolEntry = { session: AgentSession; lastUsed: number; timer: ReturnType<typeof setTimeout> }
type PiSessionListCacheEntry = { sessions: PiSessionInfo[]; expiresAt: number }
type PiSessionOperation = 'turn' | 'compact' | 'fork' | 'delete'
type PiSessionOperationEntry = { operation: PiSessionOperation; token: symbol }
type PiSessionEntryCacheEntry = {
  path: string
  size: number
  mtimeMs: number
  entries: SessionEntry[]
}

declare global {
  // Pi sessions own SDK subscriptions, retry loops, and eviction timers. Keep
  // the SDK load, path index, single-flight opens, and warm pool together across
  // Next.js development reloads so a reload cannot orphan or duplicate them.
  // eslint-disable-next-line no-var
  var __agentViewerPiSdkPromise: Promise<PiSdk> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionPathCache: Map<string, string> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionListCache: Map<string, PiSessionListCacheEntry> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionListInflight: Map<string, Promise<PiSessionInfo[]>> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionListGeneration: number | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionOperations: Map<string, PiSessionOperationEntry> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerPiSessionEntryCache: Map<string, PiSessionEntryCacheEntry> | undefined
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

/**
 * Pi <=0.84.2 implicitly writes model/thinking selections to global settings.
 * Current Pi makes those changes session-scoped unless the caller explicitly
 * asks to persist. AgentViewer never requests global-default mutation, so use
 * Pi's public settingsManager injection seam to suppress only the two legacy
 * implicit writes while retaining every read and all other settings behavior.
 */
export function piSessionScopedSettings(settingsManager: SettingsManager): SettingsManager {
  return new Proxy(settingsManager, {
    get(target, property) {
      if (property === 'setDefaultModelAndProvider' || property === 'setDefaultThinkingLevel') {
        return () => {}
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

// Cache session ID → file path mappings (populated on list, refreshed on miss).
// SessionManager.listAll() can return every Pi session on the machine, so keep
// only a recent working set instead of retaining one path string per session
// for the lifetime of the AgentViewer server.
const PI_SESSION_PATH_CACHE_MAX = 1024
const sessionPathCache = globalThis.__agentViewerPiSessionPathCache
  ?? (globalThis.__agentViewerPiSessionPathCache = new Map<string, string>())
const PI_SESSION_LIST_CACHE_TTL_MS = 1000
const PI_SESSION_LIST_CACHE_MAX = 16
const sessionListCache = globalThis.__agentViewerPiSessionListCache
  ?? (globalThis.__agentViewerPiSessionListCache = new Map<string, PiSessionListCacheEntry>())
const sessionListInflight = globalThis.__agentViewerPiSessionListInflight
  ?? (globalThis.__agentViewerPiSessionListInflight = new Map<string, Promise<PiSessionInfo[]>>())
const piSessionOperations = globalThis.__agentViewerPiSessionOperations
  ?? (globalThis.__agentViewerPiSessionOperations = new Map<string, PiSessionOperationEntry>())
const PI_SESSION_ENTRY_CACHE_MAX = 8
const PI_SESSION_ENTRY_CACHE_MAX_ENTRIES = 20_000
const piSessionEntryCache = globalThis.__agentViewerPiSessionEntryCache
  ?? (globalThis.__agentViewerPiSessionEntryCache = new Map<string, PiSessionEntryCacheEntry>())

/**
 * Reserve one mutation/turn lane before any asynchronous session setup. This
 * closes the window where a send and fork/delete could both observe an idle
 * session and then race the same JSONL file.
 */
export function beginPiSessionOperation(sessionId: string, operation: PiSessionOperation): () => void {
  const active = piSessionOperations.get(sessionId)
  if (active) {
    throw new Error(`Cannot ${operation} Pi session while ${active.operation} is active.`)
  }
  const token = Symbol(operation)
  piSessionOperations.set(sessionId, { operation, token })
  let released = false
  return () => {
    if (released) return
    released = true
    if (piSessionOperations.get(sessionId)?.token === token) piSessionOperations.delete(sessionId)
  }
}

/** Number of Pi turn/mutation reservations. Diagnostics only. */
export function piSessionOperationCount(): number {
  return piSessionOperations.size
}

function assertPiSessionOpenAllowed(sessionId: string): void {
  const active = piSessionOperations.get(sessionId)?.operation
  if (active === 'fork' || active === 'delete') {
    throw new Error(`Cannot open Pi session while ${active} is active.`)
  }
}

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

function piSessionListKey(cwd?: string): string {
  return `${process.env.PI_SESSION_DIR ?? ''}\0${cwd ?? ''}`
}

function clearPiSessionListCache(): void {
  sessionListCache.clear()
  sessionListInflight.clear()
  globalThis.__agentViewerPiSessionListGeneration = (globalThis.__agentViewerPiSessionListGeneration ?? 0) + 1
}

function invalidatePiSessionResolution(sessionId: string): void {
  sessionPathCache.delete(sessionId)
  piSessionEntryCache.delete(sessionId)
  clearPiSessionListCache()
}

function cachePiSessionList(key: string, sessions: PiSessionInfo[]): void {
  sessionListCache.delete(key)
  sessionListCache.set(key, { sessions, expiresAt: Date.now() + PI_SESSION_LIST_CACHE_TTL_MS })
  while (sessionListCache.size > PI_SESSION_LIST_CACHE_MAX) {
    const oldest = sessionListCache.keys().next().value
    if (typeof oldest !== 'string') break
    sessionListCache.delete(oldest)
  }
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

function isMissingPiSessionError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error)
  return /ENOENT|not found|no.*session/i.test(detail)
}

export type PiSessionListEntry = PiSessionInfo

export async function listPiSessions(cwd?: string): Promise<PiSessionListEntry[]> {
  const key = piSessionListKey(cwd)
  const cached = sessionListCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    sessionListCache.delete(key)
    sessionListCache.set(key, cached)
    return cached.sessions
  }
  sessionListCache.delete(key)
  const inflight = sessionListInflight.get(key)
  if (inflight) return inflight
  const generation = globalThis.__agentViewerPiSessionListGeneration ?? 0
  const request = (async () => {
    try {
      const { SessionManager } = await loadPiSdk()
      const sessions = cwd
        ? await SessionManager.list(cwd, process.env.PI_SESSION_DIR)
        : await SessionManager.listAll(process.env.PI_SESSION_DIR)
      rememberPiSessions(sessions)
      if ((globalThis.__agentViewerPiSessionListGeneration ?? 0) === generation) {
        cachePiSessionList(key, sessions)
      }
      return sessions
    } catch (error) {
      throw wrapPiError(error)
    }
  })()
  sessionListInflight.set(key, request)
  request.finally(() => {
    if (sessionListInflight.get(key) === request) sessionListInflight.delete(key)
  }).catch(() => {})
  return request
}

async function resolvePiSessionPath(sessionId: string): Promise<string> {
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
  return sessionPath
}

export async function openPiSessionManager(sessionId: string): Promise<SessionManager> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sessionPath = await resolvePiSessionPath(sessionId)
    try {
      const { SessionManager } = await loadPiSdk()
      return SessionManager.open(sessionPath, process.env.PI_SESSION_DIR)
    } catch (error) {
      if (attempt === 0 && isMissingPiSessionError(error)) {
        // The session may have been moved/deleted by a native Pi process after
        // we populated the id-to-path index. Drop every dependent cache and do
        // one authoritative rescan rather than pinning an ENOENT forever.
        invalidatePiSessionResolution(sessionId)
        continue
      }
      throw wrapPiError(error)
    }
  }
  throw new Error(`Pi session not found: ${sessionId}`)
}

function cachePiSessionEntries(sessionId: string, entry: PiSessionEntryCacheEntry): void {
  piSessionEntryCache.delete(sessionId)
  piSessionEntryCache.set(sessionId, entry)
  let retainedEntries = Array.from(piSessionEntryCache.values())
    .reduce((total, cached) => total + cached.entries.length, 0)
  while (
    piSessionEntryCache.size > PI_SESSION_ENTRY_CACHE_MAX
    || retainedEntries > PI_SESSION_ENTRY_CACHE_MAX_ENTRIES
  ) {
    const oldest = piSessionEntryCache.keys().next().value
    if (typeof oldest !== 'string') break
    retainedEntries -= piSessionEntryCache.get(oldest)?.entries.length ?? 0
    piSessionEntryCache.delete(oldest)
  }
}

/** Number of cached parsed Pi transcripts and entries. Diagnostics only. */
export function piSessionEntryCacheDiagnostics(): { sessions: number; entries: number } {
  return {
    sessions: piSessionEntryCache.size,
    entries: Array.from(piSessionEntryCache.values())
      .reduce((total, cached) => total + cached.entries.length, 0),
  }
}

async function readPiSessionEntriesAtPath(sessionId: string, sessionPath: string): Promise<SessionEntry[]> {
  const { stat } = await import('node:fs/promises')
  const before = await stat(sessionPath)
  const cached = piSessionEntryCache.get(sessionId)
  if (cached && cached.path === sessionPath && cached.size === before.size && cached.mtimeMs === before.mtimeMs) {
    piSessionEntryCache.delete(sessionId)
    piSessionEntryCache.set(sessionId, cached)
    return cached.entries
  }

  const { SessionManager } = await loadPiSdk()
  let snapshot = before
  let entries: SessionEntry[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    entries = SessionManager.open(sessionPath, process.env.PI_SESSION_DIR).getBranch()
    const after = await stat(sessionPath)
    if (snapshot.size === after.size && snapshot.mtimeMs === after.mtimeMs) {
      cachePiSessionEntries(sessionId, {
        path: sessionPath,
        size: after.size,
        mtimeMs: after.mtimeMs,
        entries,
      })
      return entries
    }
    // An external Pi process appended while we parsed. Read once more so the
    // cache never publishes a partial snapshot under the newer stat signature.
    snapshot = after
  }
  // The file remained hot across both reads. Return the newest complete parse
  // but leave it uncached so the next poll revalidates rather than pinning an
  // uncertain snapshot to a newer file signature.
  return entries
}

async function readPiSessionEntries(sessionId: string): Promise<SessionEntry[]> {
  const pooled = piSessionPool.get(sessionId)
  if (pooled) {
    pooled.lastUsed = Date.now()
    schedulePiEviction(sessionId)
    return pooled.session.sessionManager.getBranch()
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sessionPath = await resolvePiSessionPath(sessionId)
    try {
      return await readPiSessionEntriesAtPath(sessionId, sessionPath)
    } catch (error) {
      if (attempt === 0 && isMissingPiSessionError(error)) {
        invalidatePiSessionResolution(sessionId)
        continue
      }
      throw wrapPiError(error)
    }
  }
  throw new Error(`Pi session not found: ${sessionId}`)
}

export async function getPiSessionMessages(sessionId: string): Promise<AgentMessage[]> {
  const entries = await readPiSessionEntries(sessionId)
  const messages: AgentMessage[] = []
  for (const entry of entries) {
    if (entry.type === 'message') {
      messages.push((entry as Extract<SessionEntry, { type: 'message' }>).message)
    }
  }
  return messages
}

export async function getPiSessionEntries(sessionId: string): Promise<SessionEntry[]> {
  return readPiSessionEntries(sessionId)
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
    assertPiSessionOpenAllowed(options.id)
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
      const { SessionManager, SettingsManager, createAgentSession } = await loadPiSdk()
      const sessionManager = options.id
        ? SessionManager.create(cwd, process.env.PI_SESSION_DIR, { id: options.id })
        : undefined
      const settingsManager = piSessionScopedSettings(SettingsManager.create(cwd))
      const customTools = options.id ? getCoordinatorPiTools(options.id) : undefined
      const result = await createAgentSession(
        sessionManager
          ? { sessionManager, settingsManager, ...(customTools ? { customTools } : {}) }
          : { cwd, settingsManager, ...(customTools ? { customTools } : {}) },
      )
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
      piSessionEntryCache.delete(id)
      clearPiSessionListCache()
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
  assertPiSessionOpenAllowed(sessionId)
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
      const { SettingsManager, createAgentSession } = await loadPiSdk()
      const customTools = getCoordinatorPiTools(sessionId)
      const settingsManager = piSessionScopedSettings(SettingsManager.create(sm.getCwd()))
      const result = await createAgentSession({
        sessionManager: sm,
        settingsManager,
        ...(customTools ? { customTools } : {}),
      })
      const entry: PiPoolEntry = {
        session: result.session,
        lastUsed: Date.now(),
        timer: setTimeout(() => {}, 0),
      }
      piSessionPool.set(sessionId, entry)
      piSessionEntryCache.delete(sessionId)
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
  piSessionEntryCache.delete(sessionId)
  // Explicit eviction (e.g. after a fork rewrote the on-disk state) means this
  // session is stale and must be torn down so its background loops/listeners
  // don't leak — dispose even though it aborts any in-flight work.
  disposePiEntry(entry)
}

/** Persist the display name in Pi's native session graph, not only Viewer metadata. */
export async function setPiSessionName(sessionId: string, name: string): Promise<void> {
  assertPiSessionOpenAllowed(sessionId)
  await piSessionInflight.get(sessionId)?.catch(() => {})
  assertPiSessionOpenAllowed(sessionId)
  const pooled = piSessionPool.get(sessionId)
  if (pooled) {
    pooled.session.setSessionName(name)
    pooled.lastUsed = Date.now()
    schedulePiEviction(sessionId)
  } else {
    const sessionManager = await openPiSessionManager(sessionId)
    sessionManager.appendSessionInfo(name)
  }
  piSessionEntryCache.delete(sessionId)
  clearPiSessionListCache()
}

export async function compactPiSession(sessionId: string, instructions?: string): Promise<void> {
  const release = beginPiSessionOperation(sessionId, 'compact')
  try {
    await piSessionInflight.get(sessionId)?.catch(() => {})
    const session = await openPiAgentSession(sessionId)
    if (session.isStreaming) throw new Error('Cannot compact Pi session while turn is active.')
    await session.compact(instructions)
  } finally {
    release()
  }
}

export async function refreshPiSessionCache(cwd?: string): Promise<void> {
  clearPiSessionListCache()
  const generation = globalThis.__agentViewerPiSessionListGeneration ?? 0
  const { SessionManager } = await loadPiSdk()
  const sessions = cwd
    ? await SessionManager.list(cwd, process.env.PI_SESSION_DIR)
    : await SessionManager.listAll(process.env.PI_SESSION_DIR)
  rememberPiSessions(sessions)
  if ((globalThis.__agentViewerPiSessionListGeneration ?? 0) === generation) {
    cachePiSessionList(piSessionListKey(cwd), sessions)
  }
}

export async function forkPiSession(sessionId: string, entryId?: string): Promise<string | undefined> {
  const release = beginPiSessionOperation(sessionId, 'fork')
  try {
    await piSessionInflight.get(sessionId)?.catch(() => {})
    if (piSessionPool.get(sessionId)?.session.isStreaming) {
      throw new Error('Cannot fork Pi session while turn is active.')
    }
    const sm = await openPiSessionManager(sessionId)
    if (entryId) sm.branch(entryId)
    const leafId = sm.getLeafId()
    if (!leafId) return undefined
    const newPath = sm.createBranchedSession(leafId)
    if (!newPath) return undefined
    // Current Pi filenames include a timestamp prefix. The SessionManager/header
    // is authoritative for the actual session id.
    const newId = sm.getSessionId()
    rememberPiSessionPath(newId, newPath)
    clearPiSessionListCache()
    return newId
  } finally {
    release()
  }
}

/** Remove a Pi session file and all process-local references to it. */
export async function deletePiSession(sessionId: string): Promise<void> {
  const release = beginPiSessionOperation(sessionId, 'delete')
  try {
    // If a prewarm/open is still constructing, let it settle before resolution
    // and disposal so it cannot repopulate the pool after deletion.
    await piSessionInflight.get(sessionId)?.catch(() => {})
    if (piSessionPool.get(sessionId)?.session.isStreaming) {
      throw new Error('Cannot delete Pi session while turn is active.')
    }
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
    piSessionEntryCache.delete(sessionId)
    clearPiSessionListCache()
  } finally {
    release()
  }
}
