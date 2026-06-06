import {
  SessionManager,
  type SessionInfo as PiSessionInfo,
  type SessionEntry,
  createAgentSession,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

// Cache session ID → file path mappings (populated on list, refreshed on miss)
const sessionPathCache = new Map<string, string>()

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
    const sessions = cwd
      ? await SessionManager.list(cwd, process.env.PI_SESSION_DIR)
      : await SessionManager.listAll()
    for (const session of sessions) {
      sessionPathCache.set(session.id, session.path)
    }
    return sessions
  } catch (error) {
    throw wrapPiError(error)
  }
}

export function openPiSessionManager(sessionId: string): SessionManager {
  const sessionPath = sessionPathCache.get(sessionId)
  if (!sessionPath) {
    throw new Error(`Pi session not found: ${sessionId}. Try refreshing the session list.`)
  }
  try {
    return SessionManager.open(sessionPath, process.env.PI_SESSION_DIR)
  } catch (error) {
    throw wrapPiError(error)
  }
}

export function getPiSessionMessages(sessionId: string): AgentMessage[] {
  const sm = openPiSessionManager(sessionId)
  const entries = sm.getBranch()
  const messages: AgentMessage[] = []
  for (const entry of entries) {
    if (entry.type === 'message') {
      messages.push((entry as Extract<SessionEntry, { type: 'message' }>).message)
    }
  }
  return messages
}

export function getPiSessionEntries(sessionId: string): SessionEntry[] {
  const sm = openPiSessionManager(sessionId)
  return sm.getBranch()
}

export async function createPiAgentSession(cwd: string, options: { id?: string } = {}): Promise<AgentSession> {
  try {
    const sessionManager = options.id
      ? SessionManager.create(cwd, process.env.PI_SESSION_DIR, { id: options.id })
      : undefined
    const result = await createAgentSession(sessionManager ? { sessionManager } : { cwd })
    const id = result.session.sessionId
    const file = result.session.sessionFile
    if (file) {
      sessionPathCache.set(id, file)
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
    return result.session
  } catch (error) {
    throw wrapPiError(error)
  }
}

// Pool of warm Pi AgentSessions so back-to-back sends don't pay the full
// createAgentSession cost on every turn. The native Pi CLI keeps the session
// process alive between prompts — this pool mirrors that. Entries are evicted
// after `PI_SESSION_TTL_MS` of inactivity to bound memory.
const PI_SESSION_TTL_MS = 5 * 60 * 1000
type PiPoolEntry = { session: AgentSession; lastUsed: number; timer: ReturnType<typeof setTimeout> }
const piSessionPool = new Map<string, PiPoolEntry>()

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
  const sm = openPiSessionManager(sessionId)
  try {
    const result = await createAgentSession({ sessionManager: sm })
    const entry: PiPoolEntry = {
      session: result.session,
      lastUsed: Date.now(),
      timer: setTimeout(() => {}, 0),
    }
    piSessionPool.set(sessionId, entry)
    schedulePiEviction(sessionId)
    return result.session
  } catch (error) {
    throw wrapPiError(error)
  }
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
  const sessions = cwd
    ? await SessionManager.list(cwd, process.env.PI_SESSION_DIR)
    : await SessionManager.listAll()
  for (const session of sessions) {
    sessionPathCache.set(session.id, session.path)
  }
}

export function forkPiSession(sessionId: string, entryId: string): string | undefined {
  const sm = openPiSessionManager(sessionId)
  sm.branch(entryId)
  const leafId = sm.getLeafId()
  if (!leafId) return undefined
  const newPath = sm.createBranchedSession(leafId)
  if (!newPath) return undefined
  const newId = sessionIdFromPath(newPath)
  sessionPathCache.set(newId, newPath)
  return newId
}
