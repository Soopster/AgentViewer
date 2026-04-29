import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isAgentProvider } from './provider'
import { normalizeProjectPath, pathBasename, sameProjectPath } from './projectPaths'
import type { AgentProvider, ApiMessage, ContentBlock, Session, SessionMessage, SystemMessagePayload } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INDEX_DIR = path.join(DATA_DIR, 'session-index')
const MESSAGE_DIR = path.join(INDEX_DIR, 'messages')
const SESSIONS_FILE = path.join(INDEX_DIR, 'sessions.json')
const DB_FILE = path.join(INDEX_DIR, 'index.sqlite')
const STORE_VERSION = 1
const SCHEMA_VERSION = 1
const MAX_INDEX_TEXT_CHARS = 32_000
const MAX_FIELD_TEXT_CHARS = 2_000
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
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
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

type SqliteDatabase = DatabaseSync
type Row = Record<string, unknown>

let database: SqliteDatabase | null = null
let databaseOpenPromise: Promise<SqliteDatabase> | null = null
let persistenceWriteQueue: Promise<void> = Promise.resolve()
const messageSignatureCache = new Map<string, string>()

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
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
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
      cache_write_tokens INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS messages_session_key_idx ON messages(session_key);
    CREATE INDEX IF NOT EXISTS messages_type_idx ON messages(type);
    CREATE INDEX IF NOT EXISTS messages_timestamp_ms_idx ON messages(timestamp_ms);

    CREATE TABLE IF NOT EXISTS message_tools (
      message_key TEXT NOT NULL REFERENCES messages(key) ON DELETE CASCADE,
      session_key TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (message_key, name)
    );

    CREATE INDEX IF NOT EXISTS message_tools_session_name_idx ON message_tools(session_key, name);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      text,
      content='messages',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
      INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `)
  setMeta(db, 'schema_version', String(SCHEMA_VERSION))
}

async function openDatabase(): Promise<SqliteDatabase> {
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
  if (database) return database
  if (!databaseOpenPromise) {
    databaseOpenPromise = openDatabase()
      .then((db) => {
        database = db
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
    inputTokens: toFiniteNumber(record.inputTokens),
    outputTokens: toFiniteNumber(record.outputTokens),
    cacheReadTokens: toFiniteNumber(record.cacheReadTokens),
    cacheWriteTokens: toFiniteNumber(record.cacheWriteTokens),
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
    if (store.signature) messageSignatureCache.set(store.sessionKey, store.signature)
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

function collectBlockText(blocks: ContentBlock[], toolNames: Set<string>): string[] {
  const parts: string[] = []
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
      if (typeof block.content === 'string') parts.push(block.content)
      else if (Array.isArray(block.content)) parts.push(...collectBlockText(block.content, toolNames))
      continue
    }
    if (block.type === 'tool_use') {
      if (typeof block.name === 'string' && block.name) {
        toolNames.add(block.name)
        parts.push(block.name)
      }
      parts.push(...collectToolInputText(block.input))
      continue
    }
    if (block.type !== 'image') {
      parts.push(...collectToolInputText(block))
    }
  }
  return parts
}

function extractMessageText(message: SessionMessage): { text: string; toolNames: string[] } {
  const toolNames = new Set<string>()
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
      parts.push(...collectBlockText(api.content, toolNames))
    }
  }

  return {
    text: truncateText(parts.filter(Boolean).join('\n'), MAX_INDEX_TEXT_CHARS),
    toolNames: [...toolNames].sort((a, b) => a.localeCompare(b)),
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

function mapPersistedMessages(provider: AgentProvider, sessionId: string, messages: SessionMessage[]): PersistedMessageRecord[] {
  const sessionKey = persistedSessionKey(provider, sessionId)
  const usedKeys = new Map<string, number>()
  return messages.map((message) => {
    const extracted = extractMessageText(message)
    const usage = usageFromMessage(message)
    const uuid = message.uuid || `${message.type}:${message.timestamp ?? ''}`
    const baseKey = `${sessionKey}:${uuid}`
    const used = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, used + 1)
    const key = used === 0 ? baseKey : `${baseKey}:${used + 1}`
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
      text: extracted.text,
      toolNames: extracted.toolNames,
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

function replaceMessagesForSession(db: SqliteDatabase, sessionKey: string, messages: PersistedMessageRecord[]): void {
  db.prepare('DELETE FROM messages WHERE session_key = ?').run(sessionKey)
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
      cache_write_tokens
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTool = db.prepare(`
    INSERT OR IGNORE INTO message_tools(message_key, session_key, name)
    VALUES (?, ?, ?)
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
    )
    for (const toolName of message.toolNames) {
      insertTool.run(message.key, message.sessionKey, toolName)
    }
  }
}

export async function syncPersistedSessionMessages(
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
      messageSignatureCache.set(sessionKey, signature)
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
      replaceMessagesForSession(db, sessionKey, persistedMessages)
    })
    messageSignatureCache.set(sessionKey, signature)
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

function scoreText(text: string, normalizedQuery: string, terms: string[]): number {
  const lower = text.toLowerCase()
  const phraseIndex = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (phraseIndex >= 0) return 1000 - Math.min(phraseIndex, 500)
  const usefulTerms = meaningfulTerms(terms)
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
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const lower = collapsed.toLowerCase()
  let index = normalizedQuery ? lower.indexOf(normalizedQuery) : -1
  if (index < 0) {
    index = terms
      .map((term) => lower.indexOf(term))
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0] ?? 0
  }
  const start = Math.max(0, index - Math.floor(MAX_SNIPPET_CHARS / 3))
  const end = Math.min(collapsed.length, start + MAX_SNIPPET_CHARS)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < collapsed.length ? '...' : ''
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
    inputTokens: toFiniteNumber(row.input_tokens),
    outputTokens: toFiniteNumber(row.output_tokens),
    cacheReadTokens: toFiniteNumber(row.cache_read_tokens),
    cacheWriteTokens: toFiniteNumber(row.cache_write_tokens),
  }
}

function escapeFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

function ftsQueryForTerms(terms: string[]): string | null {
  const uniqueTerms = [...new Set(terms)].filter(Boolean)
  if (uniqueTerms.length === 0) return null
  return uniqueTerms.map(escapeFtsTerm).join(' OR ')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function selectMessageCandidates(
  db: SqliteDatabase,
  sessionKeys: string[],
  normalizedQuery: string,
  terms: string[],
  role?: SessionMessage['type'],
): PersistedMessageRecord[] {
  if (sessionKeys.length === 0) return []
  const candidates: PersistedMessageRecord[] = []
  const ftsQuery = ftsQueryForTerms(terms)
  const chunks = chunkArray(sessionKeys, 500)

  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(', ')
    const roleClause = role ? 'AND m.type = ?' : ''
    const roleParams = role ? [role] : []
    let rows: Row[] = []
    if (ftsQuery) {
      rows = db.prepare(`
        SELECT m.*
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        WHERE messages_fts MATCH ?
          AND m.session_key IN (${placeholders})
          ${roleClause}
      `).all(ftsQuery, ...chunk, ...roleParams) as Row[]
    } else if (normalizedQuery) {
      rows = db.prepare(`
        SELECT m.*
        FROM messages m
        WHERE m.session_key IN (${placeholders})
          ${roleClause}
          AND lower(m.text) LIKE ? ESCAPE '\\'
      `).all(...chunk, ...roleParams, `%${escapeLike(normalizedQuery)}%`) as Row[]
    }
    for (const row of rows) {
      const message = rowToMessageRecord(row)
      if (message) candidates.push(message)
    }
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

export async function searchPersistedSessions(params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  if (persistenceDisabled()) return { query: params.query, total: 0, results: [] }
  const query = params.query.trim()
  if (!query) return { query, total: 0, results: [] }

  const limit = Math.max(1, Math.min(params.limit ?? 25, 100))
  const normalizedQuery = query.toLowerCase()
  const terms = tokenizeQuery(query)
  const db = await getDatabase()
  const sessions = selectAllSessions(db).filter((session) => matchesFilters(session, params))
  const sessionByKey = new Map(sessions.map((session) => [session.key, session]))
  const messagesOnly = params.messagesOnly === true
  const resultsBySession = new Map<string, PersistedSearchResult>()

  if (!messagesOnly) {
    for (const session of sessions) {
      const score = scoreText(metadataText(session), normalizedQuery, terms)
      if (score >= 0) resultsBySession.set(session.key, { session, score, matches: [] })
    }
  }

  for (const message of selectMessageCandidates(db, sessions.map((session) => session.key), normalizedQuery, terms, params.role)) {
    const session = sessionByKey.get(message.sessionKey)
    if (!session) continue
    const messageScore = scoreText(message.text, normalizedQuery, terms)
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

export async function readPersistedIndexStats(filters: PersistedIndexFilters = {}): Promise<PersistedIndexStats> {
  if (persistenceDisabled()) return emptyStats()
  const db = await getDatabase()
  const sessions = selectAllSessions(db).filter((session) => matchesFilters(session, filters))
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
