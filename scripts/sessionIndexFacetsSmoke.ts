// Search facets: date range, has-error and touched-file narrow the sessions a
// query searches, alone and together, and a facet never widens a result.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ApiMessage, SessionMessage } from '../lib/types'

const scratch = await mkdtemp(path.join(tmpdir(), 'session-index-facets-'))
process.chdir(scratch)
process.env.AGENT_VIEWER_DISABLE_SQLITE_WORKER = '1'
delete process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
const index = await import('../lib/sessionPersistence')
const day = 86_400_000
const start = Date.parse('2026-10-20T00:00:00Z')
const message = (sessionId: string, uuid: string, at: number, payload: ApiMessage): SessionMessage => ({
  type: payload.role, uuid, session_id: sessionId, parent_tool_use_id: null, timestamp: new Date(at).toISOString(), message: payload,
})
// A failed edit is not an edit, so the failure is a separate Bash call.
const session = (id: string, at: number, file: string, failed: boolean): SessionMessage[] => [
  message(id, 'p', at, { role: 'user', content: 'zephyr task' }),
  message(id, 'e', at + 1000, { role: 'assistant', content: [{ type: 'tool_use', id: `t-${id}`, name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }] }),
  message(id, 'r', at + 2000, { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${id}`, content: 'zephyr result' }] }),
  ...(failed ? [
    message(id, 'b', at + 3000, { role: 'assistant', content: [{ type: 'tool_use', id: `b-${id}`, name: 'Bash', input: { command: 'bun test' } }] }),
    message(id, 'br', at + 4000, { role: 'user', content: [{ type: 'tool_result', tool_use_id: `b-${id}`, content: 'zephyr failure', is_error: true }] }),
  ] : []),
]
try {
  await index.syncPersistedSessions([
    { provider: 'claude', sessionId: 'old', cwd: '/w', summary: 'old' },
    { provider: 'claude', sessionId: 'mid', cwd: '/w', summary: 'mid' },
    { provider: 'codex', sessionId: 'new', cwd: '/w', summary: 'new' },
  ])
  await index.syncPersistedSessionMessages('claude', 'old', session('old', start, '/w/src/alpha.ts', false))
  await index.syncPersistedSessionMessages('claude', 'mid', session('mid', start + 5 * day, '/w/src/Beta.ts', true))
  await index.syncPersistedSessionMessages('codex', 'new', session('new', start + 10 * day, '/w/src/gamma.ts', true))
  const ids = async (extra: Record<string, unknown>) =>
    (await index.searchPersistedSessions({ query: 'zephyr', messagesOnly: true, ...extra })).results.map((result) => result.session.sessionId).sort()

  assert.deepEqual(await ids({}), ['mid', 'new', 'old'])
  assert.deepEqual(await ids({ sinceMs: start + 4 * day }), ['mid', 'new'], 'since')
  assert.deepEqual(await ids({ untilMs: start + 6 * day }), ['mid', 'old'], 'until')
  assert.deepEqual(await ids({ sinceMs: start + 4 * day, untilMs: start + 6 * day }), ['mid'], 'range')
  assert.deepEqual(await ids({ hasError: true }), ['mid', 'new'], 'has-error')
  assert.deepEqual(await ids({ touchedFile: 'beta' }), ['mid'], 'touched file is case-insensitive')
  assert.deepEqual(await ids({ touchedFile: 'src/' }), ['mid', 'new', 'old'])
  assert.deepEqual(await ids({ touchedFile: 'nothing.ts' }), [])
  assert.deepEqual(await ids({ hasError: true, provider: 'codex' }), ['new'], 'facets compose with provider')
  assert.deepEqual(await ids({ hasError: true, touchedFile: 'alpha' }), [], 'and with each other')
  console.log('Session index facets smoke passed (date, has-error, touched-file, composition)')
} finally {
  await index.clearPersistedSessionIndex()
  process.chdir('/')
  await rm(scratch, { recursive: true, force: true })
}
process.exit(0)
