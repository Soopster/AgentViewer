import { mapPersistedMessages, aggregateMessages, messageSignature } from './session-index/messages'
import { persistedSessionKey } from './session-index/identity'
export { persistedSessionKey } from './session-index/identity'
import { rowToSessionRecord } from './session-index/sessionRecords'
import { selectFilteredSessions } from './session-index/sessionQueries'
import { queryPersistedSessions } from './session-index/search'
import { emptyStats, queryIndexStats } from './session-index/stats'
import { queryFileEditsForFile, queryFileEditsForSession } from './session-index/provenance'
import { queryPersistedActivity } from './session-index/activity'
import type { IndexReader, PersistedActivity } from './session-index/types'
export type { PersistedActivityPrompt, PersistedActivityEdit, PersistedActivity } from './session-index/types'
import { toFiniteNumber, optionalString, toNullableTimestamp, messageType, timestampMs } from './session-index/rows'
import { emptyCrossSessionAnalytics, queryCrossSessionAnalytics, type PersistedAnalyticsFilters, type CrossSessionAnalytics } from './session-index/analytics'
export type { PersistedAnalyticsFilters, CrossSessionAnalytics } from './session-index/analytics'
import { configureDatabase, initializeSchema, applySchemaMigrations, getMeta, setMeta, withTransaction, SCHEMA_VERSION } from './session-index/schema'
import type {
  PersistedSessionRecord, PersistedMessageRecord, PersistedFileEditRecord, PersistedSearchResponse,
  PersistedIndexStats, PersistedIndexFilters, PersistedSearchParams, SqliteDatabase, Row,
} from './session-index/types'
export type {
  PersistedSessionRecord, PersistedMessageRecord, PersistedFileEdit, PersistedFileEditRecord,
  PersistedSearchMatch, PersistedSearchResult, PersistedSearchResponse, PersistedIndexStats,
  PersistedIndexFilters, PersistedSearchParams,
} from './session-index/types'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { timeAsync } from './perfLog'
import { runReadRows } from './sqliteWorkerClient'
import { isAgentProvider } from './provider'
import { normalizeProjectPath } from './projectPaths'
import type { AgentProvider, Session, SessionMessage } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const INDEX_DIR = path.join(DATA_DIR, 'session-index')
const MESSAGE_DIR = path.join(INDEX_DIR, 'messages')
const SESSIONS_FILE = path.join(INDEX_DIR, 'sessions.json')
const DB_FILE = path.join(INDEX_DIR, 'index.sqlite')
const STORE_VERSION = 1

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

// node:sqlite DatabaseSync and bun:sqlite Database share the synchronous
// prepare/all/get/run/exec surface used below; both stay dynamically imported.

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

async function ensureIndexDirs(): Promise<void> {
  await mkdir(INDEX_DIR, { recursive: true })
}

async function openDatabase(): Promise<SqliteDatabase> {
  const runningInBun = Boolean((process.versions as Record<string, string | undefined>).bun)
  // Hide the dynamic import behind eval so Next.js 16's Turbopack can't
  // statically analyze it. A bare `await import('node:sqlite')` gets
  // externalized via a require() shim that is undefined inside ESM route
  // handlers ("Failed to load external module node:sqlite: ReferenceError:
  // require is not defined"). eval bypasses bundler analysis and the import
  // goes straight to Node's runtime ESM loader, which knows node:sqlite.
  await ensureIndexDirs()
  // The primary OpenTUI runs under Bun, whose SQLite API intentionally mirrors
  // node:sqlite's synchronous prepare/all/get/run surface. Selecting the native
  // module here keeps the persistent index (and the in-process viewer MCP
  // search tool) available in both runtimes without a sidecar server.
  const db = runningInBun
    ? new (await (0, eval)('import("bun:sqlite")')).Database(DB_FILE, { create: true })
    : new (await (0, eval)('import("node:sqlite")') as typeof import('node:sqlite')).DatabaseSync(DB_FILE)
  try {
    configureDatabase(db)
    initializeSchema(db, () => messageSignatureCache.clear())
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
      applySchemaMigrations(database, () => messageSignatureCache.clear())
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

function encodeJsonField(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
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
  const key = persistedSessionKey(provider, session.sessionId, session.providerInstanceId)
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
        const key = persistedSessionKey(provider, session.sessionId, session.providerInstanceId)
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

export async function removePersistedSession(provider: AgentProvider, sessionId: string, providerInstanceId?: string): Promise<void> {
  if (persistenceDisabled()) return
  const sessionKey = persistedSessionKey(provider, sessionId, providerInstanceId)
  await runPersistenceWrite((db) => {
    withTransaction(db, () => {
      messageSignatureCache.delete(sessionKey)
      db.prepare('DELETE FROM sessions WHERE key = ?').run(sessionKey)
    })
  })
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
      model,
      is_prompt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      message.isPrompt ? 1 : 0,
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
  const sessionKey = persistedSessionKey(provider, sessionId, messages[0]?.providerInstanceId)
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

export function searchPersistedSessions(params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  return timeAsync('sqlite.searchPersistedSessions', () => searchPersistedSessionsImpl(params))
}

export function readPersistedIndexStats(filters: PersistedIndexFilters = {}): Promise<PersistedIndexStats> {
  return timeAsync('sqlite.readPersistedIndexStats', () => readPersistedIndexStatsImpl(filters))
}

export function readCrossSessionAnalytics(
  filters: PersistedAnalyticsFilters = {},
): Promise<CrossSessionAnalytics> {
  return timeAsync('sqlite.readCrossSessionAnalytics', () => readCrossSessionAnalyticsImpl(filters))
}

async function readCrossSessionAnalyticsImpl(filters: PersistedAnalyticsFilters): Promise<CrossSessionAnalytics> {
  if (persistenceDisabled()) return emptyCrossSessionAnalytics()
  const db = await getDatabase()
  return queryCrossSessionAnalytics(db, await selectFilteredSessions(createIndexReader(db), filters), filters)
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

async function searchPersistedSessionsImpl(params: PersistedSearchParams): Promise<PersistedSearchResponse> {
  if (persistenceDisabled()) return { query: params.query, total: 0, results: [] }
  if (!params.query.trim()) return { query: '', total: 0, results: [] }
  return queryPersistedSessions(createIndexReader(await getDatabase()), params)
}

async function readPersistedIndexStatsImpl(filters: PersistedIndexFilters): Promise<PersistedIndexStats> {
  if (persistenceDisabled()) return emptyStats()
  const db = await getDatabase()
  return queryIndexStats(db, await selectFilteredSessions(createIndexReader(db), filters))
}

export async function readFileEditsForFile(absolutePath: string, relativePath?: string | null): Promise<PersistedFileEditRecord[]> {
  if (persistenceDisabled()) return []
  return queryFileEditsForFile(createIndexReader(await getDatabase()), absolutePath, relativePath)
}

export async function readFileEditsForSession(provider: AgentProvider, sessionId: string): Promise<PersistedFileEditRecord[]> {
  if (persistenceDisabled()) return []
  return queryFileEditsForSession(createIndexReader(await getDatabase()), persistedSessionKey(provider, sessionId))
}

/**
 * What every indexed session did between two instants. A session counts when
 * its last message or its store's mtime lands in the range; prompts and edits
 * come from the message rows, so a session whose transcript has not been
 * indexed since it ran contributes its metadata and nothing else.
 */
export async function readPersistedActivity(fromMs: number, toMs: number): Promise<PersistedActivity> {
  if (persistenceDisabled()) return { sessions: [], prompts: [], edits: [] }
  return queryPersistedActivity(createIndexReader(await getDatabase()), fromMs, toMs)
}

function createIndexReader(db: SqliteDatabase): IndexReader {
  return (sql, params) => runReadRows(DB_FILE, sql, params, () => db.prepare(sql).all(...params))
}
