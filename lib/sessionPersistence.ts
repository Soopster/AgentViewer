import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { priceForModel } from './analytics'
import { timeAsync } from './perfLog'
import { runReadRows } from './sqliteWorkerClient'
import { extractFileEditsFromMessage, plainUserPromptText, type FileEditKind } from './provenanceExtract'
import { isAgentProvider } from './provider'
import { normalizeProjectPath, pathBasename, sameProjectPath } from './projectPaths'
import type { AgentProvider, ApiMessage, ContentBlock, Session, SessionMessage, SystemMessagePayload } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INDEX_DIR = path.join(DATA_DIR, 'session-index')
const MESSAGE_DIR = path.join(INDEX_DIR, 'messages')
const SESSIONS_FILE = path.join(INDEX_DIR, 'sessions.json')
const DB_FILE = path.join(INDEX_DIR, 'index.sqlite')
const STORE_VERSION = 1
const SCHEMA_VERSION = 4
const MAX_INDEX_TEXT_CHARS = 32_000
const MAX_FIELD_TEXT_CHARS = 2_000
const MAX_EDIT_PROMPT_CHARS = 300
const MAX_SNIPPET_CHARS = 260
const SHORT_QUERY_TERM_WINDOW = 180
const LONG_QUERY_TERM_WINDOW = 500
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'with',
  'you',
])

export type PersistedSessionRecord = {
  key: string
  provider: AgentProvider
  sessionId: string
  title: string
  summary?: string
  customTitle?: string
  firstPrompt?: string
  cwd?: string
  tag?: string | null
  createdAt?: string | number
  lastModified?: number
  messageCount: number
  userMessages: number
  assistantMessages: number
  systemMessages: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  firstMessageAt: number | null
  lastMessageAt: number | null
  indexedAt: number
}

export type PersistedMessageRecord = {
  key: string
  sessionKey: string
  provider: AgentProvider
  sessionId: string
  uuid: string
  type: SessionMessage['type']
  timestamp?: string
  timestampMs: number | null
  turnId?: string
  originKind?: string
  text: string
  toolNames: string[]
  errorTools: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  model?: string | null
  fileEdits: PersistedFileEdit[]
}

// One file-modifying tool call, as stored on the message that issued it.
// `prompt` is the user prompt that started the turn — captured at index time
// because reconstructing it later can't distinguish prompts from tool results.
export type PersistedFileEdit = {
  tool: string
  kind: FileEditKind
  filePath: string
  addedLines: string[]
  prompt: string | null
}

// A file_edits row joined with its owning session, ready for attribution.
export type PersistedFileEditRecord = {
  id: number
  sessionKey: string
  provider: AgentProvider
  sessionId: string
  messageUuid: string
  timestampMs: number | null
  tool: string
  kind: FileEditKind
  filePath: string
  addedLines: string[]
  prompt: string | null
  model: string | null
  sessionTitle: string | null
  sessionCwd: string | null
}

export type PersistedSearchMatch = {
  messageKey: string
  uuid: string
  type: SessionMessage['type']
  timestamp?: string
  timestampMs: number | null
  snippet: string
  toolNames: string[]
  score: number
}

export type PersistedSearchResult = {
  session: PersistedSessionRecord
  score: number
  matches: PersistedSearchMatch[]
}

export type PersistedSearchResponse = {
  query: string
  total: number
  results: PersistedSearchResult[]
}

export type PersistedIndexStats = {
  sessions: number
  messages: number
  firstMessageAt: number | null
  lastMessageAt: number | null
  lastIndexedAt: number | null
  roles: Record<SessionMessage['type'], number>
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  providers: Array<{ provider: AgentProvider; sessions: number; messages: number }>
  projects: Array<{ cwd: string; name: string; sessions: number; messages: number }>
  topTools: Array<{ name: string; count: number }>
}

export type PersistedIndexFilters = {
  provider?: AgentProvider | 'all'
  dir?: string
  includeWorktrees?: boolean
}

export type PersistedSearchParams = PersistedIndexFilters & {
  query: string
  limit?: number
  role?: SessionMessage['type']
  messagesOnly?: boolean
  toolName?: string
}

type SessionStore = {
  version: number
  sessions: Record<string, PersistedSessionRecord>
}

type MessageStore = {
  version: number
  sessionKey: string
  provider: AgentProvider
  sessionId: string
  signature: string
  indexedAt: number
  messages: PersistedMessageRecord[]
}

type MessageAggregate = Pick<
  PersistedSessionRecord,
  | 'messageCount'
  | 'userMessages'
  | 'assistantMessages'
  | 'systemMessages'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'firstMessageAt'
  | 'lastMessageAt'
  | 'indexedAt'
>

type SqliteDatabase = any // DatabaseSync from 'node:sqlite' — imported inside openDatabase() to avoid loading on TUI
type Row = Record<string, unknown>

let database: SqliteDatabase | null = null
let databaseOpenPromise: Promise<SqliteDatabase> | null = null
let persistenceWriteQueue: Promise<void> = Promise.resolve()
let migrationsApplied = false
// LRU-capped: the signature is just a short hash but the map otherwise grows
// once per distinct session ever indexed, which on a long-running server can
// reach tens of thousands of entries across providers.
const MESSAGE_SIGNATURE_CACHE_MAX = 256
const messageSignatureCache = new Map<string, string>()

function rememberSignature(sessionKey: string, signature: string): void {
  if (messageSignatureCache.has(sessionKey)) messageSignatureCache.delete(sessionKey)
  messageSignatureCache.set(sessionKey, signature)
  while (messageSignatureCache.size > MESSAGE_SIGNATURE_CACHE_MAX) {
    const oldest = messageSignatureCache.keys().next().value
    if (oldest === undefined) break
    messageSignatureCache.delete(oldest)
  }
}

function persistenceDisabled(): boolean {
  return process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX === '1'
}

export function persistedSessionKey(provider: AgentProvider | undefined, sessionId: string): string {
  return `${provider ?? 'claude'}:${sessionId}`
}

async function ensureIndexDirs(): Promise<void> {
  await mkdir(INDEX_DIR, { recursive: true })
}

function configureDatabase(db: SqliteDatabase): void {
  // Memory budget: 8 MiB page cache (was 64 MiB) is more than enough for our
  // paginated reads; mmap disabled because mapping the whole index file just
  // turns disk pages into resident RSS we don't get to reclaim. The OS page
  // cache still serves hot reads efficiently without counting against this
  // process. Total resident SQLite footprint drops by ~80 MiB on warm runs.
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -8192;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 0;
  `)
}

function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      custom_title TEXT,
      first_prompt TEXT,
      cwd TEXT,
      tag_json TEXT,
      created_at_json TEXT,
      last_modified REAL,
      message_count INTEGER NOT NULL DEFAULT 0,
      user_messages INTEGER NOT NULL DEFAULT 0,
      assistant_messages INTEGER NOT NULL DEFAULT 0,
      system_messages INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      first_message_at REAL,
      last_message_at REAL,
      indexed_at REAL NOT NULL DEFAULT 0,
      message_signature TEXT
    );

    CREATE INDEX IF NOT EXISTS sessions_provider_idx ON sessions(provider);
    CREATE INDEX IF NOT EXISTS sessions_cwd_idx ON sessions(cwd);
    CREATE INDEX IF NOT EXISTS sessions_last_message_at_idx ON sessions(last_message_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      key TEXT PRIMARY KEY,
      session_key TEXT NOT NULL REFERENCES sessions(key) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      uuid TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT,
      timestamp_ms REAL,
      turn_id TEXT,
      origin_kind TEXT,
      text TEXT NOT NULL,
      tool_names_json TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT
    );

    CREATE INDEX IF NOT EXISTS messages_session_key_idx ON messages(session_key);
    CREATE INDEX IF NOT EXISTS messages_type_idx ON messages(type);
    CREATE INDEX IF NOT EXISTS messages_timestamp_ms_idx ON messages(timestamp_ms);
    CREATE INDEX IF NOT EXISTS messages_model_idx ON messages(model);

    CREATE TABLE IF NOT EXISTS message_tools (
      message_key TEXT NOT NULL REFERENCES messages(key) ON DELETE CASCADE,
      session_key TEXT NOT NULL,
      name TEXT NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (message_key, name)
    );

    CREATE INDEX IF NOT EXISTS message_tools_session_name_idx ON message_tools(session_key, name);

    CREATE TABLE IF NOT EXISTS file_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_key TEXT NOT NULL REFERENCES messages(key) ON DELETE CASCADE,
      session_key TEXT NOT NULL,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      message_uuid TEXT NOT NULL,
      timestamp_ms REAL,
      tool TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      added_lines_json TEXT NOT NULL,
      prompt TEXT,
      model TEXT
    );

    CREATE INDEX IF NOT EXISTS file_edits_session_idx ON file_edits(session_key);
    CREATE INDEX IF NOT EXISTS file_edits_path_idx ON file_edits(file_path);
  `)
  applySchemaMigrations(db)
  setMeta(db, 'schema_version', String(SCHEMA_VERSION))
}

function applySchemaMigrations(db: SqliteDatabase): void {
  const current = Number(getMeta(db, 'schema_version') ?? '1')
  if (current < 2) {
    const cols = db.prepare("PRAGMA table_info('messages')").all() as Row[]
    const hasModel = cols.some((c) => c.name === 'model')
    if (!hasModel) {
      db.exec("ALTER TABLE messages ADD COLUMN model TEXT")
    }
    db.exec("CREATE INDEX IF NOT EXISTS messages_model_idx ON messages(model)")
    // Force re-sync so assistant rows pick up the new model column on next visit.
    messageSignatureCache.clear()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  }
  // is_error column on message_tools — version-3 migration. Column-presence-checked
  // so it self-heals if schema_version was bumped without the ALTER applying (e.g. a
  // dev-server hot-reload race where the meta write outran the schema change).
  const toolCols = db.prepare("PRAGMA table_info('message_tools')").all() as Row[]
  if (!toolCols.some((c) => c.name === 'is_error')) {
    db.exec("ALTER TABLE message_tools ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0")
    messageSignatureCache.clear()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  } else if (current < 3) {
    // First time at version 3 with the column already present — still force a re-sync
    // so existing rows backfill is_error from the message payloads.
    messageSignatureCache.clear()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  }
  // file_edits provenance table — version-4 migration. Table-presence-checked for
  // the same hot-reload self-healing reason as is_error above.
  const hasFileEdits = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'file_edits'")
    .get() as Row | undefined
  if (!hasFileEdits) {
    db.exec(`
      CREATE TABLE file_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_key TEXT NOT NULL REFERENCES messages(key) ON DELETE CASCADE,
        session_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        message_uuid TEXT NOT NULL,
        timestamp_ms REAL,
        tool TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_path TEXT NOT NULL,
        added_lines_json TEXT NOT NULL,
        prompt TEXT,
        model TEXT
      );
      CREATE INDEX IF NOT EXISTS file_edits_session_idx ON file_edits(session_key);
      CREATE INDEX IF NOT EXISTS file_edits_path_idx ON file_edits(file_path);
    `)
    messageSignatureCache.clear()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  } else if (current < 4) {
    // Table already present but version lagging — force the provenance backfill.
    messageSignatureCache.clear()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  }
}

async function openDatabase(): Promise<SqliteDatabase> {
  // Hide the dynamic import behind eval so Next.js 16's Turbopack can't
  // statically analyze it. A bare `await import('node:sqlite')` gets
  // externalized via a require() shim that is undefined inside ESM route
  // handlers ("Failed to load external module node:sqlite: ReferenceError:
  // require is not defined"). eval bypasses bundler analysis and the import
  // goes straight to Node's runtime ESM loader, which knows node:sqlite.
  const sqliteMod = await (0, eval)('import("node:sqlite")') as typeof import('node:sqlite')
  const { DatabaseSync } = sqliteMod
  await ensureIndexDirs()
  const db = new DatabaseSync(DB_FILE)
  try {
    configureDatabase(db)
    initializeSchema(db)
    await migrateLegacyJsonIfNeeded(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

async function getDatabase(): Promise<SqliteDatabase> {
  if (database) {
    if (!migrationsApplied) {
      applySchemaMigrations(database)
      setMeta(database, 'schema_version', String(SCHEMA_VERSION))
      migrationsApplied = true
    }
    return database
  }
  if (!databaseOpenPromise) {
    databaseOpenPromise = openDatabase()
      .then((db) => {
        database = db
        migrationsApplied = true
        return db
      })
      .catch((err) => {
        databaseOpenPromise = null
        throw err
      })
  }
  return databaseOpenPromise
}

async function closeDatabase(): Promise<void> {
  if (databaseOpenPromise) {
    await databaseOpenPromise.catch(() => null)
  }
  if (database) {
    database.close()
  }
  database = null
  databaseOpenPromise = null
}

async function runPersistenceWrite(fn: (db: SqliteDatabase) => void): Promise<void> {
  const run = persistenceWriteQueue.then(async () => {
    const db = await getDatabase()
    fn(db)
  })
  persistenceWriteQueue = run.catch(() => {})
  await run
}

function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function getMeta(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined
  return typeof row?.value === 'string' ? row.value : null
}

function setMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare(`
    INSERT INTO meta(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function encodeJsonField(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function decodeCreatedAt(value: unknown): string | number | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'string' || typeof parsed === 'number' ? parsed : undefined
  } catch {
    return undefined
  }
}

function decodeTag(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'string' ? parsed : parsed === null ? null : undefined
  } catch {
    return undefined
  }
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toNullableTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function timestampMs(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function messageType(value: unknown): SessionMessage['type'] | null {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : null
}

function sessionTitle(session: Session): string {
  return (
    session.customTitle ??
    session.summary ??
    (typeof session.firstPrompt === 'string' ? session.firstPrompt.slice(0, 120) : undefined) ??
    session.sessionId
  )
}

function normalizeStoredSession(value: unknown): PersistedSessionRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const provider = isAgentProvider(record.provider) ? record.provider : null
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null
  const key = typeof record.key === 'string' ? record.key : provider && sessionId ? persistedSessionKey(provider, sessionId) : null
  if (!provider || !sessionId || !key) return null
  return {
    key,
    provider,
    sessionId,
    title: typeof record.title === 'string' ? record.title : sessionId,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    customTitle: typeof record.customTitle === 'string' ? record.customTitle : undefined,
    firstPrompt: typeof record.firstPrompt === 'string' ? record.firstPrompt : undefined,
    cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
    tag: typeof record.tag === 'string' ? record.tag : record.tag === null ? null : undefined,
    createdAt: typeof record.createdAt === 'string' || typeof record.createdAt === 'number' ? record.createdAt : undefined,
    lastModified: typeof record.lastModified === 'number' ? record.lastModified : undefined,
    messageCount: toFiniteNumber(record.messageCount),
    userMessages: toFiniteNumber(record.userMessages),
    assistantMessages: toFiniteNumber(record.assistantMessages),
    systemMessages: toFiniteNumber(record.systemMessages),
    inputTokens: toFiniteNumber(record.inputTokens),
    outputTokens: toFiniteNumber(record.outputTokens),
    cacheReadTokens: toFiniteNumber(record.cacheReadTokens),
    cacheWriteTokens: toFiniteNumber(record.cacheWriteTokens),
    firstMessageAt: toNullableTimestamp(record.firstMessageAt),
    lastMessageAt: toNullableTimestamp(record.lastMessageAt),
    indexedAt: toFiniteNumber(record.indexedAt),
  }
}

function normalizeSession(session: Session, existing?: PersistedSessionRecord): PersistedSessionRecord {
  const provider = session.provider ?? 'claude'
  const key = persistedSessionKey(provider, session.sessionId)
  return {
    key,
    provider,
    sessionId: session.sessionId,
    title: sessionTitle(session),
    summary: typeof session.summary === 'string' ? session.summary : undefined,
    customTitle: typeof session.customTitle === 'string' ? session.customTitle : undefined,
    firstPrompt: typeof session.firstPrompt === 'string' ? session.firstPrompt : undefined,
    cwd: typeof session.cwd === 'string' ? normalizeProjectPath(session.cwd) : undefined,
    tag: typeof session.tag === 'string' ? session.tag : session.tag === null ? null : undefined,
    createdAt: typeof session.createdAt === 'string' || typeof session.createdAt === 'number' ? session.createdAt : undefined,
    lastModified: typeof session.lastModified === 'number' ? session.lastModified : undefined,
    messageCount: existing?.messageCount ?? 0,
    userMessages: existing?.userMessages ?? 0,
    assistantMessages: existing?.assistantMessages ?? 0,
    systemMessages: existing?.systemMessages ?? 0,
    inputTokens: existing?.inputTokens ?? 0,
    outputTokens: existing?.outputTokens ?? 0,
    cacheReadTokens: existing?.cacheReadTokens ?? 0,
    cacheWriteTokens: existing?.cacheWriteTokens ?? 0,
    firstMessageAt: existing?.firstMessageAt ?? null,
    lastMessageAt: existing?.lastMessageAt ?? null,
    indexedAt: existing?.indexedAt ?? Date.now(),
  }
}

function rowToSessionRecord(row: Row | undefined): PersistedSessionRecord | null {
  if (!row) return null
  const provider = isAgentProvider(row.provider) ? row.provider : null
  const sessionId = optionalString(row.session_id)
  const key = optionalString(row.key)
  if (!provider || !sessionId || !key) return null
  return {
    key,
    provider,
    sessionId,
    title: optionalString(row.title) ?? sessionId,
    summary: optionalString(row.summary),
    customTitle: optionalString(row.custom_title),
    firstPrompt: optionalString(row.first_prompt),
    cwd: optionalString(row.cwd),
    tag: decodeTag(row.tag_json),
    createdAt: decodeCreatedAt(row.created_at_json),
    lastModified: typeof row.last_modified === 'number' ? row.last_modified : undefined,
    messageCount: toFiniteNumber(row.message_count),
    userMessages: toFiniteNumber(row.user_messages),
    assistantMessages: toFiniteNumber(row.assistant_messages),
    systemMessages: toFiniteNumber(row.system_messages),
    inputTokens: toFiniteNumber(row.input_tokens),
    outputTokens: toFiniteNumber(row.output_tokens),
    cacheReadTokens: toFiniteNumber(row.cache_read_tokens),
    cacheWriteTokens: toFiniteNumber(row.cache_write_tokens),
    firstMessageAt: toNullableTimestamp(row.first_message_at),
    lastMessageAt: toNullableTimestamp(row.last_message_at),
    indexedAt: toFiniteNumber(row.indexed_at),
  }
}

function selectSessionByKey(db: SqliteDatabase, key: string): PersistedSessionRecord | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE key = ?').get(key) as Row | undefined
  return rowToSessionRecord(row) ?? undefined
}

function selectAllSessions(db: SqliteDatabase): PersistedSessionRecord[] {
  const rows = db.prepare('SELECT * FROM sessions').all() as Row[]
  return rows.flatMap((row) => {
    const session = rowToSessionRecord(row)
    return session ? [session] : []
  })
}

// Pre-narrows the sessions table in SQL using indexed columns when possible,
// then re-applies matchesFilters() in JS for cases SQL can't express
// (sameProjectPath's basename-suffix branch when includeWorktrees=true).
async function selectFilteredSessions(db: SqliteDatabase, filters: PersistedIndexFilters): Promise<PersistedSessionRecord[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.provider && filters.provider !== 'all') {
    where.push('provider = ?')
    params.push(filters.provider)
  }
  const dir = normalizeProjectPath(filters.dir)
  if (dir && filters.includeWorktrees === false) {
    where.push('cwd = ?')
    params.push(dir)
  }
  const sql = where.length === 0
    ? 'SELECT * FROM sessions'
    : `SELECT * FROM sessions WHERE ${where.join(' AND ')}`
  const rows = await runReadRows(DB_FILE, sql, params, () => db.prepare(sql).all(...params) as Row[]) as Row[]
  const records: PersistedSessionRecord[] = []
  for (const row of rows) {
    const session = rowToSessionRecord(row)
    if (session) records.push(session)
  }
  // Re-check via matchesFilters for the worktree/basename case which is
  // expensive to express purely in SQL.
  return records.filter((session) => matchesFilters(session, filters))
}

function readSessionSignature(db: SqliteDatabase, sessionKey: string): string | null {
  const row = db.prepare('SELECT message_signature FROM sessions WHERE key = ?').get(sessionKey) as Row | undefined
  return typeof row?.message_signature === 'string' ? row.message_signature : null
}

function upsertSessionRecord(db: SqliteDatabase, record: PersistedSessionRecord, messageSignature: string | null = null): void {
  db.prepare(`
    INSERT INTO sessions(
      key,
      provider,
      session_id,
      title,
      summary,
      custom_title,
      first_prompt,
      cwd,
      tag_json,
      created_at_json,
      last_modified,
      message_count,
      user_messages,
      assistant_messages,
      system_messages,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
      first_message_at,
      last_message_at,
      indexed_at,
      message_signature
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      provider = excluded.provider,
      session_id = excluded.session_id,
      title = excluded.title,
      summary = excluded.summary,
      custom_title = excluded.custom_title,
      first_prompt = excluded.first_prompt,
      cwd = excluded.cwd,
      tag_json = excluded.tag_json,
      created_at_json = excluded.created_at_json,
      last_modified = excluded.last_modified,
      message_count = excluded.message_count,
      user_messages = excluded.user_messages,
      assistant_messages = excluded.assistant_messages,
      system_messages = excluded.system_messages,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      first_message_at = excluded.first_message_at,
      last_message_at = excluded.last_message_at,
      indexed_at = excluded.indexed_at,
      message_signature = COALESCE(excluded.message_signature, sessions.message_signature)
  `).run(
    record.key,
    record.provider,
    record.sessionId,
    record.title,
    record.summary ?? null,
    record.customTitle ?? null,
    record.firstPrompt ?? null,
    record.cwd ?? null,
    encodeJsonField(record.tag),
    encodeJsonField(record.createdAt),
    record.lastModified ?? null,
    record.messageCount,
    record.userMessages,
    record.assistantMessages,
    record.systemMessages,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens,
    record.cacheWriteTokens,
    record.firstMessageAt,
    record.lastMessageAt,
    record.indexedAt,
    messageSignature,
  )
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readLegacySessionStore(): Promise<SessionStore> {
  try {
    const raw = await readFile(SESSIONS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SessionStore>
    if (parsed.version !== STORE_VERSION || !parsed.sessions || typeof parsed.sessions !== 'object') {
      return { version: STORE_VERSION, sessions: {} }
    }
    const sessions: Record<string, PersistedSessionRecord> = {}
    for (const [key, value] of Object.entries(parsed.sessions)) {
      const record = normalizeStoredSession(value)
      if (record) sessions[key] = record
    }
    return { version: STORE_VERSION, sessions }
  } catch {
    return { version: STORE_VERSION, sessions: {} }
  }
}

async function cleanupLegacyJsonIndex(): Promise<void> {
  await Promise.all([
    rm(SESSIONS_FILE, { force: true }).catch(() => {}),
    rm(MESSAGE_DIR, { recursive: true, force: true }).catch(() => {}),
  ])
}

function normalizeStoredMessage(value: unknown, fallback: { sessionKey: string; provider: AgentProvider; sessionId: string }): PersistedMessageRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const type = messageType(record.type)
  const uuid = optionalString(record.uuid)
  if (!type || !uuid) return null
  const timestamp = optionalString(record.timestamp)
  const toolNames = Array.isArray(record.toolNames)
    ? [...new Set(record.toolNames.filter((name): name is string => typeof name === 'string' && name.length > 0))]
      .sort((a, b) => a.localeCompare(b))
    : []
  const sessionKey = optionalString(record.sessionKey) ?? fallback.sessionKey
  return {
    key: optionalString(record.key) ?? `${sessionKey}:${uuid}`,
    sessionKey,
    provider: isAgentProvider(record.provider) ? record.provider : fallback.provider,
    sessionId: optionalString(record.sessionId) ?? fallback.sessionId,
    uuid,
    type,
    timestamp,
    timestampMs: toNullableTimestamp(record.timestampMs) ?? timestampMs(timestamp),
    turnId: optionalString(record.turnId),
    originKind: optionalString(record.originKind),
    text: optionalString(record.text) ?? '',
    toolNames,
    errorTools: Array.isArray(record.errorTools)
      ? [...new Set(record.errorTools.filter((name): name is string => typeof name === 'string' && name.length > 0))]
        .sort((a, b) => a.localeCompare(b))
      : [],
    inputTokens: toFiniteNumber(record.inputTokens),
    outputTokens: toFiniteNumber(record.outputTokens),
    cacheReadTokens: toFiniteNumber(record.cacheReadTokens),
    cacheWriteTokens: toFiniteNumber(record.cacheWriteTokens),
    // Legacy JSON stores predate provenance; the forced re-sync backfills them.
    fileEdits: [],
  }
}

async function readLegacyMessageStore(filePath: string): Promise<MessageStore | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<MessageStore>
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.messages)) return null
    if (!parsed.sessionKey || !isAgentProvider(parsed.provider) || !parsed.sessionId) return null
    const fallback = { sessionKey: parsed.sessionKey, provider: parsed.provider, sessionId: parsed.sessionId }
    return {
      version: STORE_VERSION,
      sessionKey: parsed.sessionKey,
      provider: parsed.provider,
      sessionId: parsed.sessionId,
      signature: typeof parsed.signature === 'string' ? parsed.signature : '',
      indexedAt: toFiniteNumber(parsed.indexedAt) || Date.now(),
      messages: parsed.messages.flatMap((message) => {
        const normalized = normalizeStoredMessage(message, fallback)
        return normalized ? [normalized] : []
      }),
    }
  } catch {
    return null
  }
}

async function migrateLegacyJsonIfNeeded(db: SqliteDatabase): Promise<void> {
  if (getMeta(db, 'legacy_json_migrated') === '1') {
    await cleanupLegacyJsonIndex()
    return
  }

  const legacySessions = await readLegacySessionStore()
  withTransaction(db, () => {
    for (const session of Object.values(legacySessions.sessions)) {
      upsertSessionRecord(db, session)
    }
  })

  let files: string[] = []
  try {
    files = await readdir(MESSAGE_DIR)
  } catch {
    files = []
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const store = await readLegacyMessageStore(path.join(MESSAGE_DIR, file))
    if (!store) continue
    const aggregate = aggregateMessages(store.messages, store.indexedAt)
    withTransaction(db, () => {
      const existing = selectSessionByKey(db, store.sessionKey)
      const session: PersistedSessionRecord = {
        key: store.sessionKey,
        provider: store.provider,
        sessionId: store.sessionId,
        title: existing?.title ?? store.sessionId,
        summary: existing?.summary,
        customTitle: existing?.customTitle,
        firstPrompt: existing?.firstPrompt,
        cwd: existing?.cwd,
        tag: existing?.tag,
        createdAt: existing?.createdAt,
        lastModified: existing?.lastModified,
        ...aggregate,
      }
      upsertSessionRecord(db, session, store.signature)
      replaceMessagesForSession(db, store.sessionKey, store.messages)
    })
    if (store.signature) rememberSignature(store.sessionKey, store.signature)
  }

  withTransaction(db, () => {
    setMeta(db, 'legacy_json_migrated', '1')
  })
  await cleanupLegacyJsonIndex()
}

export async function syncPersistedSessions(sessions: Session[]): Promise<void> {
  if (persistenceDisabled() || sessions.length === 0) return
  await runPersistenceWrite((db) => {
    withTransaction(db, () => {
      for (const session of sessions) {
        const provider = session.provider ?? 'claude'
        const key = persistedSessionKey(provider, session.sessionId)
        const next = normalizeSession(session, selectSessionByKey(db, key))
        if (!recordsEqual(selectSessionByKey(db, key), next)) {
          next.indexedAt = Date.now()
          upsertSessionRecord(db, next)
        }
      }
    })
  })
}

export async function clearPersistedSessionIndex(): Promise<void> {
  if (persistenceDisabled()) return
  const run = persistenceWriteQueue.then(async () => {
    messageSignatureCache.clear()
    await closeDatabase()
    await rm(INDEX_DIR, { recursive: true, force: true })
  })
  persistenceWriteQueue = run.catch(() => {})
  await run
}

export async function removePersistedSession(provider: AgentProvider, sessionId: string): Promise<void> {
  if (persistenceDisabled()) return
  const sessionKey = persistedSessionKey(provider, sessionId)
  await runPersistenceWrite((db) => {
    withTransaction(db, () => {
      messageSignatureCache.delete(sessionKey)
      db.prepare('DELETE FROM sessions WHERE key = ?').run(sessionKey)
    })
  })
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function looksLikeLargeEncodedBlob(value: string): boolean {
  if (value.length < 512) return false
  return /^[A-Za-z0-9+/=_-]+$/.test(value) && value.length % 4 === 0
}

function collectToolInputText(input: unknown, depth = 0): string[] {
  if (depth > 2 || input == null) return []
  if (typeof input === 'string') {
    if (looksLikeLargeEncodedBlob(input)) return []
    return [truncateText(input, MAX_FIELD_TEXT_CHARS)]
  }
  if (typeof input === 'number' || typeof input === 'boolean') return [String(input)]
  if (Array.isArray(input)) return input.flatMap((item) => collectToolInputText(item, depth + 1))
  if (typeof input !== 'object') return []

  const parts: string[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes('base64') || lowerKey.includes('image') || lowerKey === 'data') continue
    const child = collectToolInputText(value, depth + 1)
    if (child.length > 0) parts.push(`${key}: ${child.join(' ')}`)
  }
  return parts
}

type MessageDetails = {
  text: string
  toolNames: string[]
  // Per-message: tool_use_id -> name (only tool_use blocks emitted in this message).
  toolUseIds: Map<string, string>
  // Per-message: tool_use_id -> is_error (from tool_result blocks emitted in this message).
  toolResultErrors: Map<string, boolean>
}

function collectBlockDetails(
  blocks: ContentBlock[],
  parts: string[],
  toolNames: Set<string>,
  toolUseIds: Map<string, string>,
  toolResultErrors: Map<string, boolean>,
): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(block.thinking)
      continue
    }
    if (block.type === 'tool_result') {
      const id = (block as { tool_use_id?: unknown }).tool_use_id
      if (typeof id === 'string' && id) {
        const isError = (block as { is_error?: unknown }).is_error === true
        const existing = toolResultErrors.get(id) === true
        toolResultErrors.set(id, isError || existing)
      }
      if (typeof block.content === 'string') parts.push(block.content)
      else if (Array.isArray(block.content)) {
        collectBlockDetails(block.content, parts, toolNames, toolUseIds, toolResultErrors)
      }
      continue
    }
    if (block.type === 'tool_use') {
      if (typeof block.name === 'string' && block.name) {
        toolNames.add(block.name)
        parts.push(block.name)
        if (typeof block.id === 'string' && block.id) toolUseIds.set(block.id, block.name)
      }
      parts.push(...collectToolInputText(block.input))
      continue
    }
    if (block.type !== 'image') {
      parts.push(...collectToolInputText(block))
    }
  }
}

function extractMessageDetails(message: SessionMessage): MessageDetails {
  const toolNames = new Set<string>()
  const toolUseIds = new Map<string, string>()
  const toolResultErrors = new Map<string, boolean>()
  const payload = message.message
  const parts: string[] = []

  if ((payload as SystemMessagePayload).type === 'system') {
    const system = payload as SystemMessagePayload
    parts.push(system.subtype)
    if (typeof system.content === 'string') parts.push(system.content)
  } else {
    const api = payload as ApiMessage
    if (typeof api.content === 'string') {
      parts.push(api.content)
    } else if (Array.isArray(api.content)) {
      collectBlockDetails(api.content, parts, toolNames, toolUseIds, toolResultErrors)
    }
  }

  return {
    text: truncateText(parts.filter(Boolean).join('\n'), MAX_INDEX_TEXT_CHARS),
    toolNames: [...toolNames].sort((a, b) => a.localeCompare(b)),
    toolUseIds,
    toolResultErrors,
  }
}

function usageFromMessage(message: SessionMessage): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
} {
  const payload = message.message as Partial<ApiMessage>
  const usage = payload.usage
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  }
}

function messageSignature(provider: AgentProvider, messages: SessionMessage[]): string {
  const last = messages.at(-1)
  if (!last) return `${provider}:0`
  return [
    provider,
    messages.length,
    last.uuid,
    last.type,
    last.timestamp ?? '',
    last.turnId ?? '',
  ].join(':')
}

function modelFromMessage(message: SessionMessage): string | null {
  if (message.type !== 'assistant') return null
  const payload = message.message as Partial<ApiMessage> & { model?: unknown }
  return typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : null
}

function mapPersistedMessages(provider: AgentProvider, sessionId: string, messages: SessionMessage[]): PersistedMessageRecord[] {
  const sessionKey = persistedSessionKey(provider, sessionId)
  const usedKeys = new Map<string, number>()
  const details = messages.map((message) => extractMessageDetails(message))

  // Tool_result blocks usually arrive in a later (user) message than the originating tool_use.
  // Build a session-wide tool_use_id -> isError map so we can attribute errors back to the
  // assistant message that issued the tool call.
  const errorById = new Map<string, boolean>()
  for (const d of details) {
    for (const [id, isError] of d.toolResultErrors) {
      if (isError || errorById.get(id) === true) errorById.set(id, true)
      else if (!errorById.has(id)) errorById.set(id, false)
    }
  }

  // The prompt that started the current turn, threaded onto every file edit
  // recorded for it ("what was the agent asked when it wrote this line").
  let lastPrompt: string | null = null

  return messages.map((message, i) => {
    const d = details[i]
    const usage = usageFromMessage(message)
    const uuid = message.uuid || `${message.type}:${message.timestamp ?? ''}`
    const baseKey = `${sessionKey}:${uuid}`
    const used = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, used + 1)
    const key = used === 0 ? baseKey : `${baseKey}:${used + 1}`

    const errorTools = new Set<string>()
    for (const [id, name] of d.toolUseIds) {
      if (errorById.get(id) === true) errorTools.add(name)
    }

    const promptText = plainUserPromptText(message)
    if (promptText) lastPrompt = truncateText(promptText, MAX_EDIT_PROMPT_CHARS)

    // Edits whose tool_result reported an error never landed on disk — skip
    // them so failed patches don't claim lines they didn't write.
    const fileEdits: PersistedFileEdit[] = extractFileEditsFromMessage(message)
      .filter((edit) => !(edit.toolUseId && errorById.get(edit.toolUseId) === true))
      .map((edit) => ({
        tool: edit.tool,
        kind: edit.kind,
        filePath: edit.filePath,
        addedLines: edit.addedLines,
        prompt: lastPrompt,
      }))

    return {
      key,
      sessionKey,
      provider,
      sessionId,
      uuid,
      type: message.type,
      timestamp: message.timestamp,
      timestampMs: timestampMs(message.timestamp),
      turnId: message.turnId,
      originKind: message.origin?.kind,
      text: d.text,
      toolNames: d.toolNames,
      errorTools: [...errorTools].sort((a, b) => a.localeCompare(b)),
      model: modelFromMessage(message),
      fileEdits,
      ...usage,
    }
  })
}

function aggregateMessages(messages: PersistedMessageRecord[], indexedAt: number): MessageAggregate {
  let firstMessageAt: number | null = null
  let lastMessageAt: number | null = null
  const aggregate: MessageAggregate = {
    messageCount: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    firstMessageAt,
    lastMessageAt,
    indexedAt,
  }

  for (const message of messages) {
    if (message.type === 'user') aggregate.userMessages += 1
    else if (message.type === 'assistant') aggregate.assistantMessages += 1
    else aggregate.systemMessages += 1

    aggregate.inputTokens += message.inputTokens
    aggregate.outputTokens += message.outputTokens
    aggregate.cacheReadTokens += message.cacheReadTokens
    aggregate.cacheWriteTokens += message.cacheWriteTokens

    if (message.timestampMs !== null) {
      firstMessageAt = firstMessageAt === null ? message.timestampMs : Math.min(firstMessageAt, message.timestampMs)
      lastMessageAt = lastMessageAt === null ? message.timestampMs : Math.max(lastMessageAt, message.timestampMs)
    }
  }

  aggregate.firstMessageAt = firstMessageAt
  aggregate.lastMessageAt = lastMessageAt
  return aggregate
}

function insertMessages(db: SqliteDatabase, messages: PersistedMessageRecord[]): void {
  if (messages.length === 0) return
  const insertMessage = db.prepare(`
    INSERT INTO messages(
      key,
      session_key,
      provider,
      session_id,
      uuid,
      type,
      timestamp,
      timestamp_ms,
      turn_id,
      origin_kind,
      text,
      tool_names_json,
      input_tokens,
      output_tokens,
      cache_read_tokens,
      cache_write_tokens,
      model
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTool = db.prepare(`
    INSERT OR IGNORE INTO message_tools(message_key, session_key, name, is_error)
    VALUES (?, ?, ?, ?)
  `)
  const insertFileEdit = db.prepare(`
    INSERT INTO file_edits(
      message_key,
      session_key,
      provider,
      session_id,
      message_uuid,
      timestamp_ms,
      tool,
      kind,
      file_path,
      added_lines_json,
      prompt,
      model
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const message of messages) {
    insertMessage.run(
      message.key,
      message.sessionKey,
      message.provider,
      message.sessionId,
      message.uuid,
      message.type,
      message.timestamp ?? null,
      message.timestampMs,
      message.turnId ?? null,
      message.originKind ?? null,
      message.text,
      JSON.stringify(message.toolNames),
      message.inputTokens,
      message.outputTokens,
      message.cacheReadTokens,
      message.cacheWriteTokens,
      message.model ?? null,
    )
    const errorSet = new Set(message.errorTools ?? [])
    for (const toolName of message.toolNames) {
      insertTool.run(message.key, message.sessionKey, toolName, errorSet.has(toolName) ? 1 : 0)
    }
    for (const edit of message.fileEdits) {
      insertFileEdit.run(
        message.key,
        message.sessionKey,
        message.provider,
        message.sessionId,
        message.uuid,
        message.timestampMs,
        edit.tool,
        edit.kind,
        edit.filePath,
        JSON.stringify(edit.addedLines),
        edit.prompt,
        message.model ?? null,
      )
    }
  }
}

function replaceMessagesForSession(db: SqliteDatabase, sessionKey: string, messages: PersistedMessageRecord[]): void {
  db.prepare('DELETE FROM messages WHERE session_key = ?').run(sessionKey)
  insertMessages(db, messages)
}

// Returns true if the persisted message rows are an exact prefix of `next`,
// allowing us to append only the new tail instead of rewriting the whole set.
function tryAppendMessagesForSession(
  db: SqliteDatabase,
  sessionKey: string,
  next: PersistedMessageRecord[],
): boolean {
  const countRow = db
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE session_key = ?')
    .get(sessionKey) as { c?: number } | undefined
  const existingCount = typeof countRow?.c === 'number' ? countRow.c : 0
  if (existingCount === 0 || existingCount >= next.length) return false

  const lastRow = db
    .prepare('SELECT key FROM messages WHERE session_key = ? ORDER BY rowid DESC LIMIT 1')
    .get(sessionKey) as { key?: string } | undefined
  const existingLastKey = typeof lastRow?.key === 'string' ? lastRow.key : null
  const expectedLastKey = next[existingCount - 1]?.key
  if (!existingLastKey || !expectedLastKey || existingLastKey !== expectedLastKey) return false

  insertMessages(db, next.slice(existingCount))
  return true
}

export function syncPersistedSessionMessages(
  provider: AgentProvider,
  sessionId: string,
  messages: SessionMessage[],
): Promise<void> {
  return timeAsync('sqlite.syncPersistedSessionMessages', () => syncPersistedSessionMessagesImpl(provider, sessionId, messages))
}

async function syncPersistedSessionMessagesImpl(
  provider: AgentProvider,
  sessionId: string,
  messages: SessionMessage[],
): Promise<void> {
  if (persistenceDisabled()) return
  const sessionKey = persistedSessionKey(provider, sessionId)
  const signature = messageSignature(provider, messages)
  if (messageSignatureCache.get(sessionKey) === signature) return

  await runPersistenceWrite((db) => {
    const existingSignature = readSessionSignature(db, sessionKey)
    if (existingSignature === signature) {
      rememberSignature(sessionKey, signature)
      return
    }

    const indexedAt = Date.now()
    const persistedMessages = mapPersistedMessages(provider, sessionId, messages)
    const aggregate = aggregateMessages(persistedMessages, indexedAt)
    withTransaction(db, () => {
      const existing = selectSessionByKey(db, sessionKey)
      const next: PersistedSessionRecord = {
        key: sessionKey,
        provider,
        sessionId,
        title: existing?.title ?? sessionId,
        summary: existing?.summary,
        customTitle: existing?.customTitle,
        firstPrompt: existing?.firstPrompt,
        cwd: existing?.cwd,
        tag: existing?.tag,
        createdAt: existing?.createdAt,
        lastModified: existing?.lastModified,
        ...aggregate,
      }
      upsertSessionRecord(db, next, signature)
      if (!tryAppendMessagesForSession(db, sessionKey, persistedMessages)) {
        replaceMessagesForSession(db, sessionKey, persistedMessages)
      }
    })
    rememberSignature(sessionKey, signature)
  })
}

function matchesFilters(session: PersistedSessionRecord, filters: PersistedIndexFilters): boolean {
  if (filters.provider && filters.provider !== 'all' && session.provider !== filters.provider) return false
  const dir = normalizeProjectPath(filters.dir)
  if (!dir) return true
  const cwd = normalizeProjectPath(session.cwd)
  if (!cwd) return false
  return filters.includeWorktrees === false ? cwd === dir : sameProjectPath(dir, cwd)
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function meaningfulTerms(terms: string[]): string[] {
  const out: string[] = []
  for (const term of terms) {
    if (term.length <= 2) continue
    if (SEARCH_STOP_WORDS.has(term)) continue
    if (!out.includes(term)) out.push(term)
  }
  return out
}

function termPositions(text: string, term: string): number[] {
  const positions: number[] = []
  let cursor = 0
  while (positions.length < 30) {
    const index = text.indexOf(term, cursor)
    if (index < 0) break
    positions.push(index)
    cursor = index + term.length
  }
  return positions
}

function compactTermWindow(text: string, terms: string[]): number | null {
  const positionsByTerm = terms.map((term) => termPositions(text, term))
  if (positionsByTerm.some((positions) => positions.length === 0)) return null

  let best: number | null = null
  for (const starts of positionsByTerm) {
    for (const start of starts) {
      let end = start
      let valid = true
      for (const positions of positionsByTerm) {
        const next = positions.find((position) => position >= start)
        if (next === undefined) {
          valid = false
          break
        }
        end = Math.max(end, next)
      }
      if (!valid) continue
      const span = end - start
      best = best === null ? span : Math.min(best, span)
    }
  }
  return best
}

function metadataText(session: PersistedSessionRecord): string {
  return [
    session.title,
    session.summary,
    session.customTitle,
    session.firstPrompt,
    session.cwd,
    session.tag,
    session.provider,
    session.sessionId,
  ].filter(Boolean).join('\n')
}

function scoreText(text: string, normalizedQuery: string, terms: string[], usefulTerms: string[]): number {
  const lower = text.toLowerCase()
  const phraseIndex = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (phraseIndex >= 0) return 1000 - Math.min(phraseIndex, 500)
  if (usefulTerms.length >= 2) {
    const maxWindow = terms.length >= 5 ? LONG_QUERY_TERM_WINDOW : SHORT_QUERY_TERM_WINDOW
    const span = compactTermWindow(lower, usefulTerms)
    if (span === null || span > maxWindow) return -1
    return 760 - Math.min(span, maxWindow)
  }
  if (terms.length >= 5) {
    const span = compactTermWindow(lower, terms)
    if (span === null || span > LONG_QUERY_TERM_WINDOW) return -1
    return 760 - Math.min(span, LONG_QUERY_TERM_WINDOW)
  }
  if (terms.length > 1 && terms.every((term) => lower.includes(term))) return 600
  const matchedTerms = terms.filter((term) => lower.includes(term)).length
  return matchedTerms > 0 ? 120 * matchedTerms : -1
}

function snippetForText(text: string, normalizedQuery: string, terms: string[]): string {
  // Find the match index in the raw text first so we don't pay to collapse
  // whitespace across the entire (possibly very large) message body. Then
  // slice a generous window around it and only collapse within that window.
  const lowerRaw = text.toLowerCase()
  let index = normalizedQuery ? lowerRaw.indexOf(normalizedQuery) : -1
  if (index < 0) {
    index = terms
      .map((term) => lowerRaw.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  }
  // Generous raw window — collapsing whitespace below may shorten this further.
  const rawWindowChars = MAX_SNIPPET_CHARS * 4
  const rawStart = Math.max(0, index - Math.floor(rawWindowChars / 3))
  const rawEnd = Math.min(text.length, rawStart + rawWindowChars)
  const window = text.slice(rawStart, rawEnd)
  const collapsed = window.replace(/\s+/g, ' ').trim()
  const lower = collapsed.toLowerCase()
  let snippetIndex = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (snippetIndex < 0) {
    snippetIndex = terms
      .map((term) => lower.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  }
  const start = Math.max(0, snippetIndex - Math.floor(MAX_SNIPPET_CHARS / 3))
  const end = Math.min(collapsed.length, start + MAX_SNIPPET_CHARS)
  const prefix = rawStart > 0 || start > 0 ? '...' : ''
  const suffix = rawEnd < text.length || end < collapsed.length ? '...' : ''
  return `${prefix}${collapsed.slice(start, end)}${suffix}`
}

function rowToMessageRecord(row: Row): PersistedMessageRecord | null {
  const provider = isAgentProvider(row.provider) ? row.provider : null
  const type = messageType(row.type)
  const key = optionalString(row.key)
  const sessionKey = optionalString(row.session_key)
  const sessionId = optionalString(row.session_id)
  const uuid = optionalString(row.uuid)
  if (!provider || !type || !key || !sessionKey || !sessionId || !uuid) return null
  let toolNames: string[] = []
  if (typeof row.tool_names_json === 'string') {
    try {
      const parsed = JSON.parse(row.tool_names_json) as unknown
      if (Array.isArray(parsed)) toolNames = parsed.filter((name): name is string => typeof name === 'string')
    } catch {
      toolNames = []
    }
  }
  return {
    key,
    sessionKey,
    provider,
    sessionId,
    uuid,
    type,
    timestamp: optionalString(row.timestamp),
    timestampMs: toNullableTimestamp(row.timestamp_ms),
    turnId: optionalString(row.turn_id),
    originKind: optionalString(row.origin_kind),
    text: optionalString(row.text) ?? '',
    toolNames,
    errorTools: [],
    inputTokens: toFiniteNumber(row.input_tokens),
    outputTokens: toFiniteNumber(row.output_tokens),
    cacheReadTokens: toFiniteNumber(row.cache_read_tokens),
    cacheWriteTokens: toFiniteNumber(row.cache_write_tokens),
    model: optionalString(row.model) ?? null,
    // Read-side rows never round-trip back into insertMessages; edits live in
    // their own table and are queried via readFileEditsFor*.
    fileEdits: [],
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Hard cap on candidate rows pulled from SQL across all chunks. The final
// response only keeps a handful per session, but the score+snippet pass walks
// every row, so a runaway LIKE on common terms shouldn't pull megabytes.
const MESSAGE_CANDIDATE_GLOBAL_LIMIT = 4000

// Fetches specific session rows by primary key — used by the messagesOnly
// fast path so we only hydrate sessions referenced by matched messages.
async function selectSessionsByKeys(db: SqliteDatabase, keys: string[]): Promise<PersistedSessionRecord[]> {
  if (keys.length === 0) return []
  const records: PersistedSessionRecord[] = []
  for (const chunk of chunkArray(keys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const sql = `SELECT * FROM sessions WHERE key IN (${placeholders})`
    const rows = await runReadRows(DB_FILE, sql, chunk, () => db.prepare(sql).all(...chunk) as Row[]) as Row[]
    for (const row of rows) {
      const session = rowToSessionRecord(row)
      if (session) records.push(session)
    }
  }
  return records
}

// Variant of selectMessageCandidates that doesn't constrain to a session list.
// Used when messagesOnly is set and no session filter narrows the search,
// avoiding a hydrate-every-session-then-IN round trip.
async function selectMessageCandidatesGlobal(
  db: SqliteDatabase,
  normalizedQuery: string,
  role?: SessionMessage['type'],
  toolName?: string,
): Promise<PersistedMessageRecord[]> {
  if (!normalizedQuery) return []
  const clauses: string[] = []
  const queryParams: unknown[] = []
  if (role) {
    clauses.push('m.type = ?')
    queryParams.push(role)
  }
  if (toolName) {
    clauses.push('EXISTS (SELECT 1 FROM message_tools mt WHERE mt.message_key = m.key AND mt.name = ?)')
    queryParams.push(toolName)
  }
  clauses.push("m.text LIKE ? ESCAPE '\\' COLLATE NOCASE")
  queryParams.push(`%${escapeLike(normalizedQuery)}%`)
  queryParams.push(MESSAGE_CANDIDATE_GLOBAL_LIMIT)
  const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
  const sql = `
    SELECT m.*
    FROM messages m
    ${where}
    ORDER BY m.timestamp_ms DESC
    LIMIT ?
  `
  const rows = await runReadRows(DB_FILE, sql, queryParams, () => db.prepare(sql).all(...queryParams) as Row[]) as Row[]
  const records: PersistedMessageRecord[] = []
  for (const row of rows) {
    const message = rowToMessageRecord(row)
    if (message) records.push(message)
  }
  return records
}

async function selectMessageCandidates(
  db: SqliteDatabase,
  sessionKeys: string[],
  normalizedQuery: string,
  _terms: string[],
  role?: SessionMessage['type'],
  toolName?: string,
): Promise<PersistedMessageRecord[]> {
  if (sessionKeys.length === 0 || !normalizedQuery) return []
  const candidates: PersistedMessageRecord[] = []
  const chunks = chunkArray(sessionKeys, 500)
  let remaining = MESSAGE_CANDIDATE_GLOBAL_LIMIT

  for (const chunk of chunks) {
    if (remaining <= 0) break
    const placeholders = chunk.map(() => '?').join(', ')
    const clauses: string[] = [`m.session_key IN (${placeholders})`]
    const queryParams: unknown[] = [...chunk]
    if (role) {
      clauses.push('m.type = ?')
      queryParams.push(role)
    }
    if (toolName) {
      clauses.push('EXISTS (SELECT 1 FROM message_tools mt WHERE mt.message_key = m.key AND mt.name = ?)')
      queryParams.push(toolName)
    }
    clauses.push("m.text LIKE ? ESCAPE '\\' COLLATE NOCASE")
    queryParams.push(`%${escapeLike(normalizedQuery)}%`)
    queryParams.push(remaining)
    const sql = `
      SELECT m.*
      FROM messages m
      WHERE ${clauses.join(' AND ')}
      ORDER BY m.timestamp_ms DESC
      LIMIT ?
    `
    const rows = await runReadRows(DB_FILE, sql, queryParams, () => db.prepare(sql).all(...queryParams) as Row[]) as Row[]

    for (const row of rows) {
      const message = rowToMessageRecord(row)
      if (message) candidates.push(message)
    }
    remaining -= rows.length
  }

  return candidates
}

function emptyStats(): PersistedIndexStats {
  return {
    sessions: 0,
    messages: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    lastIndexedAt: null,
    roles: { user: 0, assistant: 0, system: 0 },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    providers: [],
    projects: [],
    topTools: [],
  }
}

export function searchPersistedSessions(params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  return timeAsync('sqlite.searchPersistedSessions', () => searchPersistedSessionsImpl(params))
}

async function searchPersistedSessionsImpl(params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  if (persistenceDisabled()) return { query: params.query, total: 0, results: [] }
  const query = params.query.trim()
  if (!query) return { query, total: 0, results: [] }

  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const normalizedQuery = query.toLowerCase()
  const terms = tokenizeQuery(query)
  const usefulTerms = meaningfulTerms(terms)
  const db = await getDatabase()
  const messagesOnly = params.messagesOnly === true
  const hasSessionFilter = (params.provider && params.provider !== 'all') || Boolean(normalizeProjectPath(params.dir))

  // Fast path: messagesOnly with no session-narrowing filter — query messages
  // directly, then hydrate only the sessions referenced by matched candidates.
  // Skips loading every session row up front.
  let sessions: PersistedSessionRecord[]
  let candidates: PersistedMessageRecord[]
  if (messagesOnly && !hasSessionFilter) {
    candidates = await selectMessageCandidatesGlobal(db, normalizedQuery, params.role, params.toolName)
    const candidateSessionKeys = [...new Set(candidates.map((message) => message.sessionKey))]
    sessions = await selectSessionsByKeys(db, candidateSessionKeys)
  } else {
    sessions = await selectFilteredSessions(db, params)
    candidates = await selectMessageCandidates(db, sessions.map((session) => session.key), normalizedQuery, terms, params.role, params.toolName)
  }
  const sessionByKey = new Map(sessions.map((session) => [session.key, session]))
  const resultsBySession = new Map<string, PersistedSearchResult>()

  if (!messagesOnly) {
    for (const session of sessions) {
      const score = scoreText(metadataText(session), normalizedQuery, terms, usefulTerms)
      if (score >= 0) resultsBySession.set(session.key, { session, score, matches: [] })
    }
  }

  for (const message of candidates) {
    const session = sessionByKey.get(message.sessionKey)
    if (!session) continue
    const messageScore = scoreText(message.text, normalizedQuery, terms, usefulTerms)
    if (messageScore < 0) continue
    const existing = resultsBySession.get(session.key) ?? { session, score: -1, matches: [] }
    existing.score = Math.max(existing.score, messageScore)
    existing.matches.push({
      messageKey: message.key,
      uuid: message.uuid,
      type: message.type,
      timestamp: message.timestamp,
      timestampMs: message.timestampMs,
      snippet: snippetForText(message.text, normalizedQuery, terms),
      toolNames: message.toolNames,
      score: messageScore,
    })
    resultsBySession.set(session.key, existing)
  }

  const sorted = [...resultsBySession.values()]
    .filter((result) => {
      if (messagesOnly) return result.matches.length > 0
      return result.score >= 0 || result.matches.length > 0
    })
    .map((result) => ({
      ...result,
      score: Math.max(result.score, 0) + result.matches.length * 15,
      matches: result.matches
        .sort((a, b) => b.score - a.score || (b.timestampMs ?? 0) - (a.timestampMs ?? 0))
        .slice(0, 5),
    }))
    .sort((a, b) => b.score - a.score || (b.session.lastMessageAt ?? 0) - (a.session.lastMessageAt ?? 0))

  return {
    query,
    total: sorted.length,
    results: sorted.slice(0, limit),
  }
}

export function readPersistedIndexStats(filters: PersistedIndexFilters = {}): Promise<PersistedIndexStats> {
  return timeAsync('sqlite.readPersistedIndexStats', () => readPersistedIndexStatsImpl(filters))
}

async function readPersistedIndexStatsImpl(filters: PersistedIndexFilters = {}): Promise<PersistedIndexStats> {
  if (persistenceDisabled()) return emptyStats()
  const db = await getDatabase()
  const sessions = await selectFilteredSessions(db, filters)
  if (sessions.length === 0) return emptyStats()

  const stats = emptyStats()
  stats.sessions = sessions.length
  const providerCounts = new Map<AgentProvider, { provider: AgentProvider; sessions: number; messages: number }>()
  const projectCounts = new Map<string, { cwd: string; name: string; sessions: number; messages: number }>()
  const toolCounts = new Map<string, number>()

  for (const session of sessions) {
    const providerBucket = providerCounts.get(session.provider) ?? { provider: session.provider, sessions: 0, messages: 0 }
    providerBucket.sessions += 1
    providerBucket.messages += session.messageCount
    providerCounts.set(session.provider, providerBucket)

    const cwd = normalizeProjectPath(session.cwd) || '(unknown)'
    const projectBucket = projectCounts.get(cwd) ?? { cwd, name: pathBasename(cwd) || cwd, sessions: 0, messages: 0 }
    projectBucket.sessions += 1
    projectBucket.messages += session.messageCount
    projectCounts.set(cwd, projectBucket)

    stats.messages += session.messageCount
    stats.roles.user += session.userMessages
    stats.roles.assistant += session.assistantMessages
    stats.roles.system += session.systemMessages
    stats.tokens.input += session.inputTokens
    stats.tokens.output += session.outputTokens
    stats.tokens.cacheRead += session.cacheReadTokens
    stats.tokens.cacheWrite += session.cacheWriteTokens
    if (session.firstMessageAt !== null) {
      stats.firstMessageAt = stats.firstMessageAt === null ? session.firstMessageAt : Math.min(stats.firstMessageAt, session.firstMessageAt)
    }
    if (session.lastMessageAt !== null) {
      stats.lastMessageAt = stats.lastMessageAt === null ? session.lastMessageAt : Math.max(stats.lastMessageAt, session.lastMessageAt)
    }
    stats.lastIndexedAt = stats.lastIndexedAt === null ? session.indexedAt : Math.max(stats.lastIndexedAt, session.indexedAt)
  }

  for (const chunk of chunkArray(sessions.map((session) => session.key), 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT name, COUNT(*) AS count
      FROM message_tools
      WHERE session_key IN (${placeholders})
      GROUP BY name
    `).all(...chunk) as Row[]
    for (const row of rows) {
      const name = optionalString(row.name)
      if (!name) continue
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + toFiniteNumber(row.count))
    }
  }

  stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite
  stats.providers = [...providerCounts.values()].sort((a, b) => b.messages - a.messages || b.sessions - a.sessions)
  stats.projects = [...projectCounts.values()].sort((a, b) => b.messages - a.messages || b.sessions - a.sessions).slice(0, 25)
  stats.topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20)

  return stats
}

export type PersistedAnalyticsFilters = PersistedIndexFilters & {
  from?: number
  to?: number
}

export type CrossSessionAnalytics = {
  range: { from: number | null; to: number | null }
  totals: {
    sessions: number
    messages: number
    activeDays: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    totalTokens: number
    estCost: number
    cacheHitRate: number
    cacheSavings: number
    avgMessagesPerSession: number
    avgTokensPerSession: number
    avgCostPerSession: number
  }
  daily: Array<{
    day: string
    messages: number
    tokens: number
    cost: number
    cumulativeCost: number
    cacheHitRate: number
    costPerMessage: number
  }>
  sessionsPerDay: Array<{ day: string; sessions: number }>
  hourHeatmap: Array<{ dow: number; hour: number; messages: number }>
  providers: Array<{ provider: AgentProvider; sessions: number; messages: number; tokens: number; cost: number }>
  projects: Array<{ cwd: string; name: string; sessions: number; messages: number; tokens: number; cost: number }>
  tools: Array<{ name: string; count: number }>
  toolErrors: Array<{ name: string; total: number; errors: number; rate: number }>
  models: Array<{ model: string; messages: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number }>
  modelKeys: string[]
  dailyByModel: Array<Record<string, string | number> & { day: string }>
  latency: Array<{ day: string; samples: number; p50: number; p95: number }>
  origins: Array<{ kind: string; count: number }>
  roleMix: { user: number; assistant: number; system: number }
  durationBuckets: Array<{ bucket: string; sessions: number }>
  streak: { current: number; longest: number }
  topSessions: Array<{
    key: string
    provider: AgentProvider
    sessionId: string
    title: string
    cwd: string | null
    messages: number
    tokens: number
    cost: number
    lastMessageAt: number | null
  }>
}

function emptyCrossSessionAnalytics(): CrossSessionAnalytics {
  return {
    range: { from: null, to: null },
    totals: {
      sessions: 0,
      messages: 0,
      activeDays: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      estCost: 0,
      cacheHitRate: 0,
      cacheSavings: 0,
      avgMessagesPerSession: 0,
      avgTokensPerSession: 0,
      avgCostPerSession: 0,
    },
    daily: [],
    sessionsPerDay: [],
    hourHeatmap: [],
    providers: [],
    projects: [],
    tools: [],
    toolErrors: [],
    models: [],
    modelKeys: [],
    dailyByModel: [],
    latency: [],
    origins: [],
    roleMix: { user: 0, assistant: 0, system: 0 },
    durationBuckets: [],
    streak: { current: 0, longest: 0 },
    topSessions: [],
  }
}

function costFor(model: string | null, i: number, o: number, cr: number, cw: number): number {
  const p = priceForModel(model)
  return (i * p.in + o * p.out + cr * (p.cacheRead ?? p.in) + cw * (p.cacheWrite ?? p.in)) / 1_000_000
}

export function readCrossSessionAnalytics(
  filters: PersistedAnalyticsFilters = {},
): Promise<CrossSessionAnalytics> {
  return timeAsync('sqlite.readCrossSessionAnalytics', () => readCrossSessionAnalyticsImpl(filters))
}

async function readCrossSessionAnalyticsImpl(
  filters: PersistedAnalyticsFilters = {},
): Promise<CrossSessionAnalytics> {
  if (persistenceDisabled()) return emptyCrossSessionAnalytics()
  const db = await getDatabase()
  const sessions = await selectFilteredSessions(db, filters)
  if (sessions.length === 0) {
    const empty = emptyCrossSessionAnalytics()
    empty.range = { from: filters.from ?? null, to: filters.to ?? null }
    return empty
  }

  const sessionKeys = sessions.map((s) => s.key)
  const sessionByKey = new Map<string, PersistedSessionRecord>()
  for (const s of sessions) sessionByKey.set(s.key, s)

  const fromMs = typeof filters.from === 'number' && Number.isFinite(filters.from) ? filters.from : 0
  const toMs = typeof filters.to === 'number' && Number.isFinite(filters.to) ? filters.to : Number.MAX_SAFE_INTEGER

  type Row = Record<string, unknown>

  // Aggregate messages by (day, model, provider, cwd) in a single pass.
  type AggRow = {
    day: string
    model: string | null
    provider: AgentProvider
    cwd: string
    messages: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  const aggregateRows: AggRow[] = []
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d', m.timestamp_ms/1000.0, 'unixepoch') AS day,
        m.model AS model,
        s.provider AS provider,
        s.cwd AS cwd,
        COUNT(*) AS messages,
        SUM(m.input_tokens) AS i,
        SUM(m.output_tokens) AS o,
        SUM(m.cache_read_tokens) AS cr,
        SUM(m.cache_write_tokens) AS cw
      FROM messages m
      JOIN sessions s ON s.key = m.session_key
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY day, m.model, s.provider, s.cwd
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const day = optionalString(row.day)
      if (!day) continue
      const provider = isAgentProvider(row.provider) ? row.provider : null
      if (!provider) continue
      aggregateRows.push({
        day,
        model: optionalString(row.model) ?? null,
        provider,
        cwd: normalizeProjectPath(optionalString(row.cwd)) || '(unknown)',
        messages: toFiniteNumber(row.messages),
        inputTokens: toFiniteNumber(row.i),
        outputTokens: toFiniteNumber(row.o),
        cacheReadTokens: toFiniteNumber(row.cr),
        cacheWriteTokens: toFiniteNumber(row.cw),
      })
    }
  }

  const dailyMap = new Map<string, {
    messages: number
    tokens: number
    cost: number
    inputTokens: number
    cacheReadTokens: number
  }>()
  const dailyByModelMap = new Map<string, Map<string, number>>()
  const providerMap = new Map<AgentProvider, { provider: AgentProvider; sessions: number; messages: number; tokens: number; cost: number }>()
  const projectMap = new Map<string, { cwd: string; name: string; sessions: number; messages: number; tokens: number; cost: number }>()
  const modelMap = new Map<string, CrossSessionAnalytics['models'][number]>()

  let totalMessages = 0
  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheWrite = 0
  let totalCost = 0

  for (const row of aggregateRows) {
    const tokens = row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
    const cost = costFor(row.model, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens)

    totalMessages += row.messages
    totalInput += row.inputTokens
    totalOutput += row.outputTokens
    totalCacheRead += row.cacheReadTokens
    totalCacheWrite += row.cacheWriteTokens
    totalCost += cost

    const dayBucket = dailyMap.get(row.day) ?? {
      messages: 0,
      tokens: 0,
      cost: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
    }
    dayBucket.messages += row.messages
    dayBucket.tokens += tokens
    dayBucket.cost += cost
    dayBucket.inputTokens += row.inputTokens
    dayBucket.cacheReadTokens += row.cacheReadTokens
    dailyMap.set(row.day, dayBucket)

    const modelLabel = row.model ?? '(unknown)'
    let perModel = dailyByModelMap.get(row.day)
    if (!perModel) {
      perModel = new Map<string, number>()
      dailyByModelMap.set(row.day, perModel)
    }
    perModel.set(modelLabel, (perModel.get(modelLabel) ?? 0) + tokens)

    const providerBucket = providerMap.get(row.provider) ?? { provider: row.provider, sessions: 0, messages: 0, tokens: 0, cost: 0 }
    providerBucket.messages += row.messages
    providerBucket.tokens += tokens
    providerBucket.cost += cost
    providerMap.set(row.provider, providerBucket)

    const projectBucket = projectMap.get(row.cwd) ?? { cwd: row.cwd, name: pathBasename(row.cwd) || row.cwd, sessions: 0, messages: 0, tokens: 0, cost: 0 }
    projectBucket.messages += row.messages
    projectBucket.tokens += tokens
    projectBucket.cost += cost
    projectMap.set(row.cwd, projectBucket)

    const modelKey = row.model ?? '(unknown)'
    const modelBucket = modelMap.get(modelKey) ?? {
      model: modelKey,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    }
    modelBucket.messages += row.messages
    modelBucket.inputTokens += row.inputTokens
    modelBucket.outputTokens += row.outputTokens
    modelBucket.cacheReadTokens += row.cacheReadTokens
    modelBucket.cacheWriteTokens += row.cacheWriteTokens
    modelBucket.cost += cost
    modelMap.set(modelKey, modelBucket)
  }

  // Session counts per provider / cwd come from the filtered session list,
  // not the message aggregate (a session with zero messages in range still counts).
  for (const session of sessions) {
    const providerBucket = providerMap.get(session.provider)
    if (providerBucket) providerBucket.sessions += 1
    const cwd = normalizeProjectPath(session.cwd) || '(unknown)'
    const projectBucket = projectMap.get(cwd)
    if (projectBucket) projectBucket.sessions += 1
  }

  // Hour-of-day x day-of-week heatmap.
  const heatmap: Array<{ dow: number; hour: number; messages: number }> = []
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT
        CAST(strftime('%w', m.timestamp_ms/1000.0, 'unixepoch') AS INTEGER) AS dow,
        CAST(strftime('%H', m.timestamp_ms/1000.0, 'unixepoch') AS INTEGER) AS hour,
        COUNT(*) AS messages
      FROM messages m
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY dow, hour
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const dow = toFiniteNumber(row.dow)
      const hour = toFiniteNumber(row.hour)
      heatmap.push({ dow, hour, messages: toFiniteNumber(row.messages) })
    }
  }
  // Fold duplicate (dow, hour) entries that come from chunked queries.
  const heatmapFold = new Map<string, number>()
  for (const cell of heatmap) {
    const k = `${cell.dow}:${cell.hour}`
    heatmapFold.set(k, (heatmapFold.get(k) ?? 0) + cell.messages)
  }
  const hourHeatmap = [...heatmapFold.entries()].map(([k, messages]) => {
    const [dow, hour] = k.split(':').map(Number)
    return { dow, hour, messages }
  })

  // Tool usage + error counts within date range.
  const toolMap = new Map<string, { count: number; errors: number }>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT mt.name AS name, COUNT(*) AS count, SUM(mt.is_error) AS errors
      FROM message_tools mt
      JOIN messages m ON m.key = mt.message_key
      WHERE mt.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY mt.name
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const name = optionalString(row.name)
      if (!name) continue
      const bucket = toolMap.get(name) ?? { count: 0, errors: 0 }
      bucket.count += toFiniteNumber(row.count)
      bucket.errors += toFiniteNumber(row.errors)
      toolMap.set(name, bucket)
    }
  }

  // Origin breakdown (origin_kind on messages — e.g. 'user', 'slash_command', 'system').
  const originMap = new Map<string, number>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT m.origin_kind AS kind, COUNT(*) AS count
      FROM messages m
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY m.origin_kind
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const kind = optionalString(row.kind) ?? '(none)'
      originMap.set(kind, (originMap.get(kind) ?? 0) + toFiniteNumber(row.count))
    }
  }

  // Assistant response latency: gap from preceding user-message timestamp within the same session.
  // Cap at 10 minutes — anything longer is almost certainly an idle/abandoned conversation.
  const LATENCY_CAP_MS = 10 * 60 * 1000
  const latencyByDay = new Map<string, number[]>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT day, latency_ms FROM (
        SELECT
          strftime('%Y-%m-%d', m.timestamp_ms/1000.0, 'unixepoch') AS day,
          m.type AS type,
          LAG(m.type) OVER (PARTITION BY m.session_key ORDER BY m.timestamp_ms) AS prev_type,
          m.timestamp_ms - LAG(m.timestamp_ms) OVER (PARTITION BY m.session_key ORDER BY m.timestamp_ms) AS latency_ms
        FROM messages m
        WHERE m.session_key IN (${placeholders})
          AND m.timestamp_ms IS NOT NULL
          AND m.timestamp_ms BETWEEN ? AND ?
      )
      WHERE type = 'assistant' AND prev_type = 'user' AND latency_ms IS NOT NULL AND latency_ms > 0 AND latency_ms <= ?
    `).all(...chunk, fromMs, toMs, LATENCY_CAP_MS) as Row[]
    for (const row of rows) {
      const day = optionalString(row.day)
      const ms = toFiniteNumber(row.latency_ms)
      if (!day || ms <= 0) continue
      const list = latencyByDay.get(day)
      if (list) list.push(ms)
      else latencyByDay.set(day, [ms])
    }
  }
  const latency: CrossSessionAnalytics['latency'] = [...latencyByDay.entries()]
    .map(([day, samples]) => {
      const sorted = samples.slice().sort((a, b) => a - b)
      const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0
      const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0
      return { day, samples: sorted.length, p50, p95 }
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  const cacheHitRate = totalInput + totalCacheRead > 0
    ? totalCacheRead / (totalInput + totalCacheRead)
    : 0

  // Cache savings: what cache reads would have cost at full input price minus the cache-read price.
  let cacheSavings = 0
  for (const m of modelMap.values()) {
    const p = priceForModel(m.model === '(unknown)' ? null : m.model)
    const cacheRate = p.cacheRead ?? p.in
    cacheSavings += (m.cacheReadTokens * (p.in - cacheRate)) / 1_000_000
  }

  // Sessions started per day (derived from session.firstMessageAt).
  const sessionsPerDayMap = new Map<string, number>()
  for (const s of sessions) {
    if (s.firstMessageAt === null) continue
    if (s.firstMessageAt < fromMs || s.firstMessageAt > toMs) continue
    const day = new Date(s.firstMessageAt).toISOString().slice(0, 10)
    sessionsPerDayMap.set(day, (sessionsPerDayMap.get(day) ?? 0) + 1)
  }

  // Top sessions by cost within the date range (per-session token rollup joined with model for pricing).
  type SessionAgg = { tokens: number; cost: number; messages: number }
  const sessionAgg = new Map<string, SessionAgg>()
  for (const chunk of chunkArray(sessionKeys, 500)) {
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT
        m.session_key AS session_key,
        m.model AS model,
        COUNT(*) AS messages,
        SUM(m.input_tokens) AS i,
        SUM(m.output_tokens) AS o,
        SUM(m.cache_read_tokens) AS cr,
        SUM(m.cache_write_tokens) AS cw
      FROM messages m
      WHERE m.session_key IN (${placeholders})
        AND m.timestamp_ms IS NOT NULL
        AND m.timestamp_ms BETWEEN ? AND ?
      GROUP BY m.session_key, m.model
    `).all(...chunk, fromMs, toMs) as Row[]
    for (const row of rows) {
      const key = optionalString(row.session_key)
      if (!key) continue
      const i = toFiniteNumber(row.i)
      const o = toFiniteNumber(row.o)
      const cr = toFiniteNumber(row.cr)
      const cw = toFiniteNumber(row.cw)
      const messages = toFiniteNumber(row.messages)
      const cost = costFor(optionalString(row.model) ?? null, i, o, cr, cw)
      const agg = sessionAgg.get(key) ?? { tokens: 0, cost: 0, messages: 0 }
      agg.tokens += i + o + cr + cw
      agg.cost += cost
      agg.messages += messages
      sessionAgg.set(key, agg)
    }
  }

  const topSessions = [...sessionAgg.entries()]
    .map(([key, agg]) => {
      const session = sessionByKey.get(key)
      if (!session) return null
      return {
        key,
        provider: session.provider,
        sessionId: session.sessionId,
        title: session.title,
        cwd: session.cwd ?? null,
        messages: agg.messages,
        tokens: agg.tokens,
        cost: agg.cost,
        lastMessageAt: session.lastMessageAt,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, 15)

  // Build daily array with running cumulative cost, per-day cache hit rate, and cost-per-message.
  const dailySorted = [...dailyMap.entries()]
    .map(([day, bucket]) => ({ day, ...bucket }))
    .sort((a, b) => a.day.localeCompare(b.day))
  let running = 0
  const daily = dailySorted.map((d) => {
    running += d.cost
    const cacheBase = d.inputTokens + d.cacheReadTokens
    const cacheHitRate = cacheBase > 0 ? d.cacheReadTokens / cacheBase : 0
    const costPerMessage = d.messages > 0 ? d.cost / d.messages : 0
    return {
      day: d.day,
      messages: d.messages,
      tokens: d.tokens,
      cost: d.cost,
      cumulativeCost: running,
      cacheHitRate,
      costPerMessage,
    }
  })

  // Pivot per-(day, model) tokens into a wide row format for stacked area charts.
  const modelKeys = [...new Set([...dailyByModelMap.values()].flatMap((m) => [...m.keys()]))]
    .sort((a, b) => a.localeCompare(b))
  const dailyByModel = [...dailyByModelMap.entries()]
    .map(([day, perModel]) => {
      const row: Record<string, string | number> & { day: string } = { day }
      for (const key of modelKeys) row[key] = perModel.get(key) ?? 0
      return row
    })
    .sort((a, b) => a.day.localeCompare(b.day))

  // Role mix: sum the per-session aggregates from the filtered session list.
  const roleMix = sessions.reduce(
    (acc, s) => {
      acc.user += s.userMessages
      acc.assistant += s.assistantMessages
      acc.system += s.systemMessages
      return acc
    },
    { user: 0, assistant: 0, system: 0 },
  )

  // Session duration buckets (last_message_at - first_message_at).
  const durationBucketDefs: Array<{ bucket: string; max: number }> = [
    { bucket: '<1m', max: 60_000 },
    { bucket: '1-5m', max: 5 * 60_000 },
    { bucket: '5-15m', max: 15 * 60_000 },
    { bucket: '15-60m', max: 60 * 60_000 },
    { bucket: '1-3h', max: 3 * 60 * 60_000 },
    { bucket: '3-12h', max: 12 * 60 * 60_000 },
    { bucket: '>12h', max: Number.POSITIVE_INFINITY },
  ]
  const durationCounts = new Map<string, number>(durationBucketDefs.map((d) => [d.bucket, 0]))
  for (const s of sessions) {
    if (s.firstMessageAt === null || s.lastMessageAt === null) continue
    const duration = Math.max(0, s.lastMessageAt - s.firstMessageAt)
    const def = durationBucketDefs.find((d) => duration < d.max) ?? durationBucketDefs[durationBucketDefs.length - 1]
    durationCounts.set(def.bucket, (durationCounts.get(def.bucket) ?? 0) + 1)
  }
  const durationBuckets = durationBucketDefs.map((d) => ({ bucket: d.bucket, sessions: durationCounts.get(d.bucket) ?? 0 }))

  // Streaks computed over UTC-day strings (matches dailyMap key format).
  const activeDaysSorted = [...dailyMap.keys()].sort()
  let longestStreak = 0
  let currentRun = 0
  let prevDate: Date | null = null
  for (const dayStr of activeDaysSorted) {
    const d = new Date(`${dayStr}T00:00:00Z`)
    if (prevDate && d.getTime() - prevDate.getTime() === 86_400_000) currentRun += 1
    else currentRun = 1
    if (currentRun > longestStreak) longestStreak = currentRun
    prevDate = d
  }
  // Current streak: run ending on today (UTC) or yesterday (still counts).
  let endingStreak = 0
  if (activeDaysSorted.length > 0) {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const yesterdayStr = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10)
    let cursor = activeDaysSorted[activeDaysSorted.length - 1]
    if (cursor === todayStr || cursor === yesterdayStr) {
      endingStreak = 1
      for (let i = activeDaysSorted.length - 2; i >= 0; i -= 1) {
        const prev = new Date(`${activeDaysSorted[i]}T00:00:00Z`)
        const next = new Date(`${cursor}T00:00:00Z`)
        if (next.getTime() - prev.getTime() === 86_400_000) {
          endingStreak += 1
          cursor = activeDaysSorted[i]
        } else break
      }
    }
  }
  const streak = { current: endingStreak, longest: longestStreak }

  const toolErrors: CrossSessionAnalytics['toolErrors'] = [...toolMap.entries()]
    .filter(([, v]) => v.errors > 0)
    .map(([name, v]) => ({ name, total: v.count, errors: v.errors, rate: v.count > 0 ? v.errors / v.count : 0 }))
    .sort((a, b) => b.errors - a.errors || b.rate - a.rate)
    .slice(0, 25)

  const sessionCount = sessions.length
  const avgMessagesPerSession = sessionCount > 0 ? totalMessages / sessionCount : 0
  const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite
  const avgTokensPerSession = sessionCount > 0 ? totalTokens / sessionCount : 0
  const avgCostPerSession = sessionCount > 0 ? totalCost / sessionCount : 0

  return {
    range: { from: filters.from ?? null, to: filters.to ?? null },
    totals: {
      sessions: sessionCount,
      messages: totalMessages,
      activeDays: dailyMap.size,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
      totalTokens,
      estCost: totalCost,
      cacheHitRate,
      cacheSavings,
      avgMessagesPerSession,
      avgTokensPerSession,
      avgCostPerSession,
    },
    daily,
    sessionsPerDay: [...sessionsPerDayMap.entries()]
      .map(([day, sessions]) => ({ day, sessions }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    hourHeatmap,
    providers: [...providerMap.values()].sort((a, b) => b.messages - a.messages),
    projects: [...projectMap.values()].sort((a, b) => b.messages - a.messages).slice(0, 25),
    tools: [...toolMap.entries()]
      .map(([name, v]) => ({ name, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 25),
    toolErrors,
    models: [...modelMap.values()].sort((a, b) => b.cost - a.cost || b.messages - a.messages),
    modelKeys,
    dailyByModel,
    latency,
    origins: [...originMap.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    roleMix,
    durationBuckets,
    streak,
    topSessions,
  }
}

// ---------------------------------------------------------------------------
// Provenance reads: file_edits rows joined with their owning sessions, feeding
// the line-attribution engine in lib/provenance.ts.

function rowToFileEditRecord(row: Row): PersistedFileEditRecord | null {
  const filePath = typeof row.file_path === 'string' ? row.file_path : null
  const provider = typeof row.provider === 'string' && isAgentProvider(row.provider) ? row.provider : null
  if (!filePath || !provider) return null
  let addedLines: string[] = []
  try {
    const parsed = JSON.parse(typeof row.added_lines_json === 'string' ? row.added_lines_json : '[]')
    if (Array.isArray(parsed)) addedLines = parsed.filter((line): line is string => typeof line === 'string')
  } catch {
    addedLines = []
  }
  const kindRaw = typeof row.kind === 'string' ? row.kind : 'touch'
  const kind: FileEditKind = kindRaw === 'edit' || kindRaw === 'write' || kindRaw === 'patch' ? kindRaw : 'touch'
  return {
    id: typeof row.id === 'number' ? row.id : Number(row.id ?? 0),
    sessionKey: typeof row.session_key === 'string' ? row.session_key : '',
    provider,
    sessionId: typeof row.session_id === 'string' ? row.session_id : '',
    messageUuid: typeof row.message_uuid === 'string' ? row.message_uuid : '',
    timestampMs: typeof row.timestamp_ms === 'number' ? row.timestamp_ms : null,
    tool: typeof row.tool === 'string' ? row.tool : 'unknown',
    kind,
    filePath,
    addedLines,
    prompt: typeof row.prompt === 'string' ? row.prompt : null,
    model: typeof row.model === 'string' ? row.model : null,
    sessionTitle:
      typeof row.session_custom_title === 'string' && row.session_custom_title
        ? row.session_custom_title
        : typeof row.session_title === 'string'
          ? row.session_title
          : null,
    sessionCwd: typeof row.session_cwd === 'string' ? row.session_cwd : null,
  }
}

const FILE_EDIT_SELECT = `
  SELECT
    fe.*,
    s.title AS session_title,
    s.custom_title AS session_custom_title,
    s.cwd AS session_cwd
  FROM file_edits fe
  LEFT JOIN sessions s ON s.key = fe.session_key
`

/**
 * All recorded edits that plausibly target the given file, oldest first.
 * Matches on the exact absolute path, the exact repo-relative path, or a
 * '/'-anchored suffix (edits recorded from other checkouts/worktrees of the
 * same repo still resolve). SQL pre-narrows; the suffix check is re-verified
 * in JS because LIKE treats '_' as a wildcard.
 */
export async function readFileEditsForFile(
  absolutePath: string,
  relativePath?: string | null,
): Promise<PersistedFileEditRecord[]> {
  if (persistenceDisabled()) return []
  const db = await getDatabase()
  const where: string[] = ['fe.file_path = ?']
  const params: unknown[] = [absolutePath]
  if (relativePath) {
    where.push('fe.file_path = ?', 'fe.file_path LIKE ?')
    params.push(relativePath, `%/${relativePath}`)
  }
  const sql = `${FILE_EDIT_SELECT} WHERE ${where.join(' OR ')} ORDER BY COALESCE(fe.timestamp_ms, 0) ASC, fe.id ASC`
  const rows = await runReadRows(DB_FILE, sql, params, () => db.prepare(sql).all(...params) as Row[]) as Row[]
  const records: PersistedFileEditRecord[] = []
  for (const row of rows) {
    const record = rowToFileEditRecord(row)
    if (!record) continue
    const matches =
      record.filePath === absolutePath ||
      (relativePath != null && (record.filePath === relativePath || record.filePath.endsWith(`/${relativePath}`)))
    if (matches) records.push(record)
  }
  return records
}

/** Every recorded edit made by one session, oldest first. */
export async function readFileEditsForSession(
  provider: AgentProvider,
  sessionId: string,
): Promise<PersistedFileEditRecord[]> {
  if (persistenceDisabled()) return []
  const db = await getDatabase()
  const sql = `${FILE_EDIT_SELECT} WHERE fe.session_key = ? ORDER BY COALESCE(fe.timestamp_ms, 0) ASC, fe.id ASC`
  const params = [persistedSessionKey(provider, sessionId)]
  const rows = await runReadRows(DB_FILE, sql, params, () => db.prepare(sql).all(...params) as Row[]) as Row[]
  const records: PersistedFileEditRecord[] = []
  for (const row of rows) {
    const record = rowToFileEditRecord(row)
    if (record) records.push(record)
  }
  return records
}

/** Indexed session metadata (cwd, title) without touching the provider backend. */
export async function readPersistedSessionRecord(
  provider: AgentProvider,
  sessionId: string,
): Promise<PersistedSessionRecord | null> {
  if (persistenceDisabled()) return null
  const db = await getDatabase()
  return selectSessionByKey(db, persistedSessionKey(provider, sessionId)) ?? null
}
