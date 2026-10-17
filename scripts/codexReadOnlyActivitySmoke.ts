import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'codex-read-only-activity-')))
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const thread = {
  id: 'read-only-activity', name: 'Activity smoke', preview: 'Activity smoke',
  cwd: process.cwd(), createdAt: 1_700_000_000, updatedAt: 1_700_000_600,
  recencyAt: 1_700_000_100, status: { type: 'notLoaded' },
  model: null as string | null,
  source: 'cli', path: '/tmp/activity-smoke.jsonl', turns: [],
}
const calls: string[] = []
mock.module('../lib/codexClient', () => ({ getCodexClient: () => ({
  request: async (method: string) => {
    calls.push(method)
    if (method === 'thread/read') return { thread }
    if (method === 'model/list') return { data: [], nextCursor: null }
    // Mimic the provider-side damage that a passive resume would cause.
    if (method === 'thread/resume') {
      thread.updatedAt += 60
      return { thread, model: 'gpt-test' }
    }
    throw new Error(`Unexpected request: ${method}`)
  },
}) }))
const { readCodexThreadModel, markCodexThreadResumed } = await import('../lib/codexThreads')
const { codexAdapter } = await import('../lib/adapters/codex')
const { prewarmViewSession } = await import('../lib/sessionBackend')

assert.deepEqual(await readCodexThreadModel(thread.id, thread.recencyAt), { model: null, unknown: true })
await codexAdapter.readModels!(thread.id)
const info = await codexAdapter.readSessionInfo!(thread.id)
await prewarmViewSession({ sessionId: thread.id, provider: 'codex' })
assert.equal(calls.includes('thread/resume'), false, 'browsing/model reads/composer focus must not resume')
assert.equal(thread.updatedAt, 1_700_000_600, 'passive reads must preserve native activity')
assert.equal(info?.lastModified, 1_700_000_600_000, 'activity must include work after turn start')
thread.model = 'gpt-native-persisted'
assert.equal((await codexAdapter.readSessionInfo!(thread.id))?.currentModel, 'gpt-native-persisted')
assert.equal((await codexAdapter.readModels!(thread.id))?.currentModel, 'gpt-native-persisted')
assert.equal(calls.includes('thread/resume'), false, 'native persisted model metadata must remain read-only')

markCodexThreadResumed(thread.id, 'gpt-test')
assert.deepEqual(await readCodexThreadModel(thread.id, thread.recencyAt), { model: 'gpt-test' }, 'real turns still supply the current model')
console.log('Codex read-only activity smoke passed')
process.exit(0)
