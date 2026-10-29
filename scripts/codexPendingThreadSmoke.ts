import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Turn } from '../lib/codex-schema/v2'

process.chdir(mkdtempSync(path.join(tmpdir(), 'codex-pending-thread-')))
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const sessionId = '01a186fb-2ad5-7112-b485-471d11611559'
const notLoaded = new Error(`Get thread not loaded: ${sessionId}`)
let metadataError: Error | null = notLoaded
let turnsError: Error | null = null
let includeTurnsError: Error | null = null
const calls: string[] = []
const thread = {
  id: sessionId, name: null, preview: '', cwd: process.cwd(),
  createdAt: 1_700_000_000, updatedAt: 1_700_000_000,
  status: { type: 'notLoaded' }, model: null, source: 'appServer', turns: [] as Turn[],
}
mock.module('../lib/codexClient', () => ({ getCodexClient: () => ({
  request: async (method: string, params: { includeTurns?: boolean }) => {
    calls.push(method)
    if (method === 'thread/read') {
      if (params.includeTurns && includeTurnsError) throw includeTurnsError
      if (metadataError) throw metadataError
      return { thread }
    }
    if (method === 'thread/turns/list') {
      if (turnsError) throw turnsError
      return { data: thread.turns, nextCursor: null }
    }
    throw new Error(`Unexpected request: ${method}`)
  },
}) }))
const { codexAdapter } = await import('../lib/adapters/codex')
const { readCodexThreadWithFullTurns } = await import('../lib/codexThreads')
const { isCodexMissingRolloutError } = await import('../lib/codexErrors')

assert.equal(isCodexMissingRolloutError(notLoaded), true)
assert.equal(isCodexMissingRolloutError(`thread not loaded: ${sessionId}`), true)
const info = await codexAdapter.readSessionInfo!(sessionId)
assert.equal(info?.sessionId, sessionId)
assert.equal(info?.summary, 'New session', 'worker reads must keep the pending session open')
assert.deepEqual(await codexAdapter.readAllMessages!(sessionId), { messages: [], externalWriter: false })

metadataError = null
turnsError = notLoaded
assert.deepEqual((await readCodexThreadWithFullTurns(sessionId)).turns, [])

// Older servers use includeTurns when the paginated API is unavailable.
turnsError = new Error('Method not found: thread/turns/list')
includeTurnsError = notLoaded
assert.deepEqual(await codexAdapter.readAllMessages!(sessionId), { messages: [], externalWriter: false })

// The next poll must read the thread again after its first turn is persisted.
turnsError = null
includeTurnsError = null
thread.turns.push({
  id: 'first-turn', rootTurnId: null, itemsView: 'full', status: 'completed',
  error: null, startedAt: 1_700_000_001, completedAt: 1_700_000_002, durationMs: 1000,
  items: [{ type: 'userMessage', id: 'first-message', clientId: null,
    content: [{ type: 'text', text: 'Hello from the first turn', text_elements: [] }] }],
})
assert.deepEqual(await readCodexThreadWithFullTurns(sessionId), thread)
const loaded = await codexAdapter.readAllMessages!(sessionId)
assert.ok(JSON.stringify(loaded.messages).includes('Hello from the first turn'), 'pending reads must not cache an empty transcript')
assert.equal(calls.includes('thread/resume'), false, 'pending reads must stay passive')

metadataError = new Error('Connection lost')
await assert.rejects(() => codexAdapter.readSessionInfo!(sessionId), /Connection lost/)
await assert.rejects(() => codexAdapter.readAllMessages!(sessionId), /Connection lost/)
console.log('Codex pending thread smoke passed')
process.exit(0)
