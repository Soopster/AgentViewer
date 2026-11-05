import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ApiMessage, SessionMessage } from '../lib/types'
import { queryPersistedSessions } from '../lib/session-index/search'

const originalCwd = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'session-index-queries-'))
process.chdir(scratch)
process.env.AGENT_VIEWER_DISABLE_SQLITE_WORKER = '1'
delete process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
const index = await import('../lib/sessionPersistence')
const start = Date.parse('2026-10-28T00:00:00Z')
const message = (sessionId: string, uuid: string, seconds: number, payload: ApiMessage): SessionMessage => ({
  type: payload.role, uuid, session_id: sessionId, parent_tool_use_id: null,
  timestamp: new Date(start + seconds * 1000).toISOString(), message: payload,
})
try {
  await index.syncPersistedSessions([
    { provider: 'claude', sessionId: 'a', cwd: '/work/repo', summary: 'First session' },
    { provider: 'codex', sessionId: 'b', cwd: '/other/repo', summary: 'Second session' },
    { provider: 'claude', sessionId: 'c', cwd: '/work/else', summary: 'metadataonly' },
  ])
  const a: SessionMessage[] = [
    message('a', 'prompt', 0, { role: 'user', content: 'Literal 100% quasar_name' }),
    message('a', 'edit', 1, { role: 'assistant', content: [{ type: 'tool_use', id: 'edit-a', name: 'Edit', input: { file_path: '/work/repo/src/quasar_name.ts', old_string: 'old', new_string: 'new' } }] }),
    message('a', 'result', 2, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'edit-a', content: 'quasar tool output' }] }),
    { ...message('a', 'delegated', 3, { role: 'user', content: 'delegated quasar' }), origin: { kind: 'subagent' } },
  ]
  const b: SessionMessage[] = [
    message('b', 'prompt', 4, { role: 'user', content: 'quasar_name answer' }),
    message('b', 'edit', 5, { role: 'assistant', content: [{ type: 'tool_use', id: 'edit-b', name: 'Edit', input: { file_path: '/other/repo/src/quasarXname.ts', old_string: 'old', new_string: 'new' } }] }),
  ]
  await index.syncPersistedSessionMessages('claude', 'a', a)
  await index.syncPersistedSessionMessages('codex', 'b', b)
  const keys = (response: Awaited<ReturnType<typeof index.searchPersistedSessions>>) => response.results.map(result => result.session.key).sort()
  assert.deepEqual(keys(await index.searchPersistedSessions({ query: 'quasar_name', messagesOnly: true })), ['claude:a', 'codex:b'])
  assert.deepEqual(keys(await index.searchPersistedSessions({ query: 'quasar_name', provider: 'claude', messagesOnly: true })), ['claude:a'])
  assert.deepEqual(keys(await index.searchPersistedSessions({ query: 'quasar_name', dir: '/work/repo', includeWorktrees: false, messagesOnly: true })), ['claude:a'])
  assert.deepEqual(keys(await index.searchPersistedSessions({ query: 'quasar_name', dir: '/work/repo', includeWorktrees: true, messagesOnly: true })), ['claude:a', 'codex:b'])
  assert.deepEqual(keys(await index.searchPersistedSessions({ query: 'metadataonly' })), ['claude:c'])
  assert.equal((await index.searchPersistedSessions({ query: 'metadataonly', messagesOnly: true })).total, 0)
  const literal = await index.searchPersistedSessions({ query: '100%', messagesOnly: true })
  assert.deepEqual(keys(literal), ['claude:a'])
  assert.match(literal.results[0].matches[0].snippet, /100%/)
  const assistant = await index.searchPersistedSessions({ query: 'quasar', role: 'assistant', toolName: 'Edit', messagesOnly: true })
  assert.equal(assistant.total, 2)
  assert.ok(assistant.results.every(result => result.matches.every(match => match.type === 'assistant' && match.toolNames.includes('Edit'))))
  const limited = await index.searchPersistedSessions({ query: 'quasar', messagesOnly: true, limit: 1 })
  assert.equal(limited.total, 2)
  assert.equal(limited.results.length, 1)
  assert.deepEqual(await queryPersistedSessions(async () => { throw new Error('blank query must not read') }, { query: '  ' }), { query: '', total: 0, results: [] })
  const stats = await index.readPersistedIndexStats({ dir: '/work/repo', includeWorktrees: false })
  assert.equal(stats.sessions, 1)
  assert.equal(stats.messages, 4)
  assert.deepEqual(stats.topTools, [{ name: 'Edit', count: 1 }])
  assert.equal((await index.readPersistedIndexStats({ dir: '/work/repo', includeWorktrees: true })).messages, 6)
  const edits = await index.readFileEditsForFile('/unrelated/src/quasar_name.ts', 'src/quasar_name.ts')
  assert.equal(edits.length, 1, 'underscore LIKE wildcard must be rechecked as a literal suffix')
  assert.equal(edits[0].sessionId, 'a')
  assert.equal(edits[0].prompt, 'Literal 100% quasar_name')
  assert.equal((await index.readFileEditsForFile('/work/repo/src/quasar_name.ts')).length, 1)
  assert.equal((await index.readPersistedSessionRecord('claude', 'a'))?.cwd, '/work/repo')
  const activity = await index.readPersistedActivity(start, start + 5000)
  assert.deepEqual(activity.sessions.map(session => session.sessionId), ['b', 'a'])
  assert.deepEqual(activity.prompts.map(prompt => prompt.text), ['Literal 100% quasar_name', 'quasar_name answer'], 'tool results and delegated briefs are not user prompts')
  assert.equal(activity.edits.length, 2)
  assert.deepEqual((await index.readPersistedActivity(start + 4000, start + 5000)).prompts.map(prompt => prompt.text), ['quasar_name answer'])
  assert.deepEqual(await index.readPersistedActivity(start + 10000, start + 20000), { sessions: [], prompts: [], edits: [] })
  process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX = '1'
  assert.equal((await index.searchPersistedSessions({ query: 'quasar' })).total, 0)
  assert.equal((await index.readPersistedIndexStats()).sessions, 0)
  assert.deepEqual(await index.readFileEditsForSession('claude', 'a'), [])
  assert.deepEqual(await index.readPersistedActivity(start, start + 5000), { sessions: [], prompts: [], edits: [] })
  delete process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
  assert.equal((await index.readPersistedIndexStats()).messages, 6)
} finally {
  delete process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
  await index.clearPersistedSessionIndex()
  process.chdir(originalCwd)
  await rm(scratch, { recursive: true, force: true })
}
console.log('Index queries: filtered search, literal matching, stats, provenance, activity and disabled facade passed')
