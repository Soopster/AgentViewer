import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-selection-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'selection fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
let sessions = 0
const turns: Array<{ provider: string; sessionId: string; body: Record<string, unknown>; release: () => void }> = []
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  readViewSessionInfo: async () => ({ provider: 'codex', cwd }),
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [] }),
  createNewViewSession: async ({ provider }: { provider: string }) => ({ provider, sessionId: `selected-${++sessions}`, isPending: false }),
  streamViewSessionTurn: async ({ provider, sessionId, body }: { provider: string; sessionId: string; body: Record<string, unknown> }) => new Promise<Response>(resolve => turns.push({ provider, sessionId, body, release: () => resolve(new Response('')) })),
}))
let catalogAvailable = true
let catalogReads = 0
mock.module(fileURLToPath(new URL('../lib/adapters/registry.ts', import.meta.url)), () => ({
  unsupported: () => { throw new Error('unsupported fixture operation') },
  getSessionAdapter: async (provider: string) => provider === 'pi' ? { provider } : ({ provider, readProviderModels: async () => {
    catalogReads++
    if (!catalogAvailable) throw new Error('fixture unavailable')
    return ['fixture-model', 'web-model', 'tui-model'].map(value => ({ value, displayName: value, description: 'fixture', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }))
  } }),
}))
const coord = await import('../lib/agentCoordination')
const service = await import('../lib/tui/service')
const { executeExternalCoordinatorAction } = await import('../lib/agentCoordinationExternal')
const { COORD_TOOL_SPECS } = await import('../lib/coordinatorToolContract.mjs')
const spec = COORD_TOOL_SPECS.find(item => item.name === 'coord_delegate')!
const until = async (count: number) => { for (let i = 0; i < 100; i++) { if (turns.length >= count) return; await new Promise(resolve => setTimeout(resolve, 10)) } assert.fail('provider dispatch did not start') }
try {
  await coord.configureInteractiveCoordinator({ sessionId: 'chat', provider: 'codex', cwd, maxAgents: 4, useWorktrees: false })
  const identity = await coord.sessionCoordinatorIdentity('chat', 'codex')
  const args = { name: 'researcher', title: 'Investigate', detail: 'Investigate the API', requested_provider: 'claude', requested_model: 'fixture-model', requested_effort: 'high', request_id: 'selection-sdk' }
  const call = (input: Record<string, unknown>) => executeExternalCoordinatorAction({ action: spec.action, ...identity, ...spec.mapArgs(input) }) as Promise<{ task: { id: string; requestedModel?: string; requestedEffort?: string; requestedProvider?: string } }>
  const first = await call(args)
  await until(1)
  assert.equal(first.task.requestedModel, 'fixture-model')
  assert.equal(first.task.requestedEffort, 'high')
  assert.equal(turns[0]!.provider, 'claude')
  assert.equal(turns[0]!.body.model, 'fixture-model')
  assert.equal(turns[0]!.body.effort, 'high')
  catalogAvailable = false
  const replay = await call({ ...args, requested_model: 'changed-after-lost-response' })
  assert.equal(replay.task.id, first.task.id)
  assert.equal(replay.task.requestedModel, 'fixture-model', 'retry recovers the original task selection')
  assert.equal(sessions, 1)
  assert.equal(turns.length, 1)
  assert.equal(catalogReads, 2, 'retry must recover without reading a now-unavailable catalog')
  catalogAvailable = true
  const before = await coord.readSessionCoordinator('chat', 'codex')
  await assert.rejects(call({ ...args, name: 'invalid', requested_model: 'not-advertised', request_id: 'invalid-selection' }), /not advertised/)
  await assert.rejects(call({ ...args, name: 'invalid', requested_effort: 'ultra-unadvertised', request_id: 'invalid-effort' }), /not advertised/)
  catalogAvailable = false
  await assert.rejects(call({ ...args, name: 'unavailable', request_id: 'unavailable-selection' }), /catalog is unavailable/)
  catalogAvailable = true
  const after = await coord.readSessionCoordinator('chat', 'codex')
  assert.equal(after!.tasks.length, before!.tasks.length)
  assert.equal(after!.agents.length, before!.agents.length, 'invalid selection must not create a teammate')
  assert.equal(sessions, 1)
  const capabilities = await executeExternalCoordinatorAction({ ...identity, action: 'capabilities', provider: 'codex' }) as { status: string; models: unknown[] }
  assert.equal(capabilities.status, 'available')
  assert.equal(capabilities.models.length, 3)
  const { readCoordinatorCapabilities } = await import('../lib/coordinatorCapabilities')
  const beforeReads = catalogReads
  const concurrent = await Promise.all([readCoordinatorCapabilities('codex', cwd), readCoordinatorCapabilities('codex', cwd)])
  assert.equal(catalogReads, beforeReads + 1, 'concurrent discovery must share one read')
  assert.strictEqual(concurrent[0], concurrent[1])
  assert.equal((await readCoordinatorCapabilities('pi', cwd)).status, 'unsupported')
  const { POST, GET } = await import('../app/api/sessions/[sessionId]/coordination/route')
  const catalogResponse = await GET(new Request('http://localhost/api/sessions/chat/coordination?provider=codex&inspect=capabilities&targetProvider=claude'), { params: Promise.resolve({ sessionId: 'chat' }) })
  assert.equal(catalogResponse.status, 200)
  assert.equal((await catalogResponse.json()).models.length, 3)
  const post = (body: unknown) => POST(new Request('http://localhost/api/sessions/chat/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ sessionId: 'chat' }) })
  assert.equal((await post({ provider: 'codex', action: 'delegate', requestId: 'bad-model', detail: 'Invalid', requestedModel: ' ' })).status, 400)
  const response = await post({ provider: 'codex', action: 'delegate', requestId: 'selection-web', detail: 'Review separately', teammateName: 'reviewer', teammateProvider: 'codex', requestedModel: 'web-model', requestedEffort: 'medium' })
  assert.equal(response.status, 200, await response.clone().text())
  await until(2)
  assert.equal(turns[1]!.body.model, 'web-model')
  assert.equal(turns[1]!.body.effort, 'medium')
  await service.sendTuiSessionCoordination('chat', 'codex', { action: 'delegate', requestId: 'selection-tui', cwd, detail: 'Test separately', teammateName: 'tester', teammateProvider: 'codex', requestedModel: 'tui-model', requestedEffort: 'low' })
  await until(3)
  assert.equal(turns[2]!.body.model, 'tui-model')
  assert.equal(turns[2]!.body.effort, 'low')
  assert.equal(sessions, 3)
  console.log('Delegation selection passed: shared tool contract, mixed provider dispatch, task model/effort reaching provider transport, catalog refresh and validation before teammate creation, web validation, TUI service, and exact retry without extra tasks/sessions/turns.')
} finally { await coord.stopProtocolRun((await coord.readSessionCoordinator('chat', 'codex'))!.run.id); for (const turn of turns) turn.release() }
process.exit(0)
