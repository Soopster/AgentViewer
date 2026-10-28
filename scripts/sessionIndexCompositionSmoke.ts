import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeSchema, applySchemaMigrations, getMeta, setMeta, withTransaction, SCHEMA_VERSION } from '../lib/session-index/schema'
import type { SqliteDatabase } from '../lib/session-index/types'
import type { SessionMessage } from '../lib/types'

// Never open the user's index; exercise the public facade in a disposable cwd.
const originalCwd = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'session-index-composition-'))
process.chdir(scratch)
process.env.AGENT_VIEWER_DISABLE_SQLITE_WORKER = '1'
delete process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
const index = await import('../lib/sessionPersistence')
try {
  const sessionId = 'composition-smoke'
  const messages: SessionMessage[] = [
    { type: 'user', uuid: 'prompt', session_id: sessionId, parent_tool_use_id: null, timestamp: '2026-10-28T00:00:00Z', message: { role: 'user', content: 'Refactor the quasar function' } },
    { type: 'assistant', uuid: 'reply', session_id: sessionId, parent_tool_use_id: null, timestamp: '2026-10-28T00:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: '/workspace/quasar.ts', old_string: 'old', new_string: 'new' } }], usage: { input_tokens: 100, output_tokens: 20 } } },
  ]
  await index.syncPersistedSessions([{ sessionId, provider: 'claude', cwd: '/workspace', summary: 'Composition fixture' }])
  await index.syncPersistedSessionMessages('claude', sessionId, messages)
  await index.syncPersistedSessionMessages('claude', sessionId, messages)
  assert.equal((await index.readPersistedIndexStats()).messages, 2, 'repeated indexing must be idempotent')
  const search = await index.searchPersistedSessions({ query: 'quasar', messagesOnly: true })
  assert.equal(search.results[0]?.session.sessionId, sessionId)
  const analytics = await index.readCrossSessionAnalytics({ provider: 'claude' })
  assert.equal(analytics.totals.messages, 2)
  assert.equal(analytics.totals.inputTokens, 100)
  assert.equal(analytics.totals.outputTokens, 20)
  assert.equal(analytics.providers[0]?.provider, 'claude')
  assert.equal((await index.readCrossSessionAnalytics({ provider: 'codex' })).totals.messages, 0)
  assert.equal((await index.readFileEditsForSession('claude', sessionId)).length, 1)
  await index.removePersistedSession('claude', sessionId)
  assert.equal((await index.readPersistedIndexStats()).messages, 0)
  assert.equal((await index.readFileEditsForSession('claude', sessionId)).length, 0)
  await index.clearPersistedSessionIndex()
  await index.syncPersistedSessions([{ sessionId: 'reopened', provider: 'claude' }])
  assert.equal((await index.readPersistedIndexStats()).sessions, 1, 'clear must allow a fresh connection')
} finally {
  await index.clearPersistedSessionIndex()
  process.chdir(originalCwd)
  await rm(scratch, { recursive: true, force: true })
}

const db: SqliteDatabase = process.versions.bun
  ? new (await (0, eval)('import("bun:sqlite")')).Database(':memory:')
  : new (await (0, eval)('import("node:sqlite")')).DatabaseSync(':memory:')
try {
  let invalidations = 0
  initializeSchema(db, () => invalidations++)
  assert.equal(getMeta(db, 'schema_version'), String(SCHEMA_VERSION))
  db.prepare("INSERT INTO sessions (key, provider, session_id, title, indexed_at, message_signature) VALUES (?, ?, ?, ?, ?, ?)").run('claude:migration', 'claude', 'migration', 'migration', 0, 'cached')
  db.exec('ALTER TABLE messages DROP COLUMN is_prompt')
  setMeta(db, 'schema_version', '2')
  invalidations = 0
  applySchemaMigrations(db, () => invalidations++)
  assert.ok(invalidations > 0)
  assert.ok(db.prepare("PRAGMA table_info('messages')").all().some(row => row.name === 'is_prompt'))
  assert.equal(db.prepare('SELECT message_signature FROM sessions').get()?.message_signature, null)
  assert.throws(() => withTransaction(db, () => {
    setMeta(db, 'rollback', 'should not persist')
    throw new Error('rollback fixture')
  }), /rollback fixture/)
  assert.equal(getMeta(db, 'rollback'), null)
} finally {
  db.close()
}
console.log('Session index facade, analytics, provenance, migration, rollback and reopen passed')
