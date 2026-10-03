import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

const STORE_MODE_ENV = 'AGENT_VIEWER_CLAUDE_SESSION_STORE'
const STORE_PATH_ENV = 'AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH'
const DEFAULT_STORE_PATH = '.agent-viewer-data/claude-session-store/index.sqlite'

type RunResult = { changes: number | bigint }
type Statement = {
  run(...values: unknown[]): RunResult
  all(...values: unknown[]): unknown[]
}
type Database = {
  exec(sql: string): void
  prepare(sql: string): Statement
}
type DatabaseConstructor = new (path: string) => Database

function normalizeSubpath(subpath: string | undefined): string {
  return subpath ?? ''
}

function assertKey(key: SessionKey): void {
  if (!key.projectKey || !key.sessionId) {
    throw new Error('Claude session-store keys require projectKey and sessionId')
  }
  if (key.subpath === '') throw new Error('Claude session-store subpath must be omitted instead of empty')
}

/**
 * Durable Agent Viewer implementation of the Agent SDK's alpha SessionStore.
 *
 * Transcript blobs are deliberately opaque. Stable UUIDs are unique within a
 * transcript, making SDK retries/import replays idempotent; UUID-less metadata
 * remains append-only as required by the SDK contract.
 */
export class ClaudeSqliteSessionStore implements SessionStore {
  private databasePromise: Promise<Database> | null = null

  constructor(readonly path: string) {}

  private database(): Promise<Database> {
    if (!this.databasePromise) {
      this.databasePromise = (async () => {
        await mkdir(dirname(this.path), { recursive: true })
        // Keep node:sqlite behind the same bundler-safe indirection as the
        // persistent search index. A static import is rewritten by Next.
        const sqlite = await (0, eval)('import("node:sqlite")') as {
          DatabaseSync: DatabaseConstructor
        }
        const db = new sqlite.DatabaseSync(this.path)
        db.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA busy_timeout = 5000;
          CREATE TABLE IF NOT EXISTS claude_session_entries (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            project_key TEXT NOT NULL,
            session_id TEXT NOT NULL,
            subpath TEXT NOT NULL DEFAULT '',
            entry_uuid TEXT,
            payload TEXT NOT NULL,
            written_at INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS claude_session_entry_uuid
            ON claude_session_entries(project_key, session_id, subpath, entry_uuid)
            WHERE entry_uuid IS NOT NULL;
          CREATE INDEX IF NOT EXISTS claude_session_entry_lookup
            ON claude_session_entries(project_key, session_id, subpath, sequence);
          CREATE TABLE IF NOT EXISTS claude_sessions (
            project_key TEXT NOT NULL,
            session_id TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            PRIMARY KEY(project_key, session_id)
          );
          CREATE INDEX IF NOT EXISTS claude_sessions_recent
            ON claude_sessions(project_key, mtime DESC);
        `)
        return db
      })()
    }
    return this.databasePromise
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    assertKey(key)
    if (entries.length === 0) return
    const encoded = entries.map((entry) => ({
      uuid: typeof entry.uuid === 'string' && entry.uuid ? entry.uuid : null,
      payload: JSON.stringify(entry),
    }))
    const db = await this.database()
    const insert = db.prepare(`
      INSERT OR IGNORE INTO claude_session_entries
        (project_key, session_id, subpath, entry_uuid, payload, written_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const touch = db.prepare(`
      INSERT INTO claude_sessions(project_key, session_id, mtime)
      VALUES (?, ?, ?)
      ON CONFLICT(project_key, session_id) DO UPDATE SET mtime = excluded.mtime
    `)
    const now = Date.now()
    let inserted = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const entry of encoded) {
        const result = insert.run(
          key.projectKey,
          key.sessionId,
          normalizeSubpath(key.subpath),
          entry.uuid,
          entry.payload,
          now,
        )
        inserted += Number(result.changes)
      }
      if (inserted > 0) touch.run(key.projectKey, key.sessionId, now)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    assertKey(key)
    const db = await this.database()
    const rows = db.prepare(`
      SELECT payload FROM claude_session_entries
      WHERE project_key = ? AND session_id = ? AND subpath = ?
      ORDER BY sequence ASC
    `).all(key.projectKey, key.sessionId, normalizeSubpath(key.subpath)) as Array<{ payload: string }>
    if (rows.length === 0) return null
    return rows.map(({ payload }) => JSON.parse(payload) as SessionStoreEntry)
  }

  async listSessions(projectKey: string): Promise<Array<{ sessionId: string; mtime: number }>> {
    if (!projectKey) throw new Error('Claude session-store projectKey is required')
    const db = await this.database()
    return db.prepare(`
      SELECT session_id AS sessionId, mtime
      FROM claude_sessions
      WHERE project_key = ?
      ORDER BY mtime DESC, session_id ASC
    `).all(projectKey) as Array<{ sessionId: string; mtime: number }>
  }

  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    assertKey(key)
    const db = await this.database()
    const rows = db.prepare(`
      SELECT DISTINCT subpath FROM claude_session_entries
      WHERE project_key = ? AND session_id = ? AND subpath <> ''
      ORDER BY subpath ASC
    `).all(key.projectKey, key.sessionId) as Array<{ subpath: string }>
    return rows.map(({ subpath }) => subpath)
  }

  async delete(key: SessionKey): Promise<void> {
    assertKey(key)
    const db = await this.database()
    db.exec('BEGIN IMMEDIATE')
    try {
      if (key.subpath) {
        db.prepare(`
          DELETE FROM claude_session_entries
          WHERE project_key = ? AND session_id = ? AND subpath = ?
        `).run(key.projectKey, key.sessionId, key.subpath)
      } else {
        db.prepare(`
          DELETE FROM claude_session_entries
          WHERE project_key = ? AND session_id = ?
        `).run(key.projectKey, key.sessionId)
        db.prepare(`
          DELETE FROM claude_sessions
          WHERE project_key = ? AND session_id = ?
        `).run(key.projectKey, key.sessionId)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

const stores = new Map<string, ClaudeSqliteSessionStore>()

export function configuredClaudeSessionStore(): SessionStore | undefined {
  if (process.env[STORE_MODE_ENV]?.trim().toLowerCase() !== 'sqlite') return undefined
  const configuredPath = process.env[STORE_PATH_ENV]?.trim() || DEFAULT_STORE_PATH
  const path = isAbsolute(configuredPath) ? configuredPath : resolve(process.cwd(), configuredPath)
  let store = stores.get(path)
  if (!store) {
    store = new ClaudeSqliteSessionStore(path)
    stores.set(path, store)
  }
  return store
}

/** Options shared by query(), resume reads, listing, and mutations. */
export function claudeSessionStoreOptions(): { sessionStore?: SessionStore } {
  const sessionStore = configuredClaudeSessionStore()
  return sessionStore ? { sessionStore } : {}
}

/**
 * File checkpoint blobs are not mirrored by the current Agent SDK. It rejects
 * enableFileCheckpointing + sessionStore, so store-backed sessions explicitly
 * fall back to transcript-only rewind while local sessions keep checkpoints.
 */
export function claudeSessionPersistenceQueryOptions(): {
  sessionStore?: SessionStore
  sessionStoreFlush?: 'batched'
  enableFileCheckpointing: boolean
} {
  const sessionStore = configuredClaudeSessionStore()
  return sessionStore
    ? { sessionStore, sessionStoreFlush: 'batched', enableFileCheckpointing: false }
    : { enableFileCheckpointing: true }
}
