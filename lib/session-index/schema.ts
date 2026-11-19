import type { SqliteDatabase, Row } from './types'
export const SCHEMA_VERSION = 5

export function configureDatabase(db: SqliteDatabase): void {
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

export function initializeSchema(db: SqliteDatabase, invalidateSignatures: () => void): void {
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
      model TEXT,
      is_prompt INTEGER NOT NULL DEFAULT 0
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
  applySchemaMigrations(db, invalidateSignatures)
  setMeta(db, 'schema_version', String(SCHEMA_VERSION))
}

export function applySchemaMigrations(db: SqliteDatabase, invalidateSignatures: () => void): void {
  const current = Number(getMeta(db, 'schema_version') ?? '1')
  if (current < 2) {
    const cols = db.prepare("PRAGMA table_info('messages')").all() as Row[]
    const hasModel = cols.some((c) => c.name === 'model')
    if (!hasModel) {
      db.exec("ALTER TABLE messages ADD COLUMN model TEXT")
    }
    db.exec("CREATE INDEX IF NOT EXISTS messages_model_idx ON messages(model)")
    // Force re-sync so assistant rows pick up the new model column on next visit.
    invalidateSignatures()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  }
  // is_error column on message_tools — version-3 migration. Column-presence-checked
  // so it self-heals if schema_version was bumped without the ALTER applying (e.g. a
  // dev-server hot-reload race where the meta write outran the schema change).
  const toolCols = db.prepare("PRAGMA table_info('message_tools')").all() as Row[]
  if (!toolCols.some((c) => c.name === 'is_error')) {
    db.exec("ALTER TABLE message_tools ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0")
    invalidateSignatures()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  } else if (current < 3) {
    // First time at version 3 with the column already present — still force a re-sync
    // so existing rows backfill is_error from the message payloads.
    invalidateSignatures()
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
    invalidateSignatures()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  } else if (current < 4) {
    // Table already present but version lagging — force the provenance backfill.
    invalidateSignatures()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  }
  // is_prompt on messages — version 5. A user row is a prompt or a tool result,
  // and only the message payload can tell them apart, so it is decided at index
  // time; sessions pick it up as they are re-synced.
  const messageCols = db.prepare("PRAGMA table_info('messages')").all() as Row[]
  if (!messageCols.some((c) => c.name === 'is_prompt')) {
    db.exec("ALTER TABLE messages ADD COLUMN is_prompt INTEGER NOT NULL DEFAULT 0")
    invalidateSignatures()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  } else if (current < 5) {
    invalidateSignatures()
    db.prepare("UPDATE sessions SET message_signature = NULL").run()
  }
}

export function getMeta(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined
  return typeof row?.value === 'string' ? row.value : null
}

export function setMeta(db: SqliteDatabase, key: string, value: string): void {
  db.prepare(`
    INSERT INTO meta(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function withTransaction<T>(db: SqliteDatabase, fn: () => T): T {
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
