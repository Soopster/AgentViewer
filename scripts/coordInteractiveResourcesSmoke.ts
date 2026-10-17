import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coordinatorAgentActivity, coordinatorStalledAgentIds } from '../lib/coordinatorInteractiveState'
import { resourceLimits, resourceSummary } from '../lib/coordinatorResources'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-resource-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
let sessions = 0
const turns: Array<{ sessionId: string; body: { taskBudgetTokens?: number }; release: () => void }> = []
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  readViewSessionInfo: async () => ({ provider: 'codex', cwd }),
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [] }),
  createNewViewSession: async ({ provider }: { provider: string }) => ({ provider, sessionId: `worker-${++sessions}`, isPending: false }),
  streamViewSessionTurn: async ({ sessionId, body }: { sessionId: string; body: { taskBudgetTokens?: number } }) => new Promise<Response>(resolve => turns.push({ sessionId, body, release: () => resolve(new Response('')) })),
}))
const coord = await import('../lib/agentCoordination')
const service = await import('../lib/tui/service')
const until = async (check: () => boolean) => { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) } assert.fail('fixture did not settle') }
try {
  await coord.configureInteractiveCoordinator({ sessionId: 'chat', provider: 'codex', cwd, maxAgents: 2, useWorktrees: false, budget: { maxTokens: 10 } })
  const identity = await coord.sessionCoordinatorIdentity('chat', 'codex')
  const { POST } = await import('../app/api/sessions/[sessionId]/coordination/route')
  const post = (body: unknown) => POST(new Request('http://localhost/api/sessions/chat/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ sessionId: 'chat' }) })
  assert.equal((await post({ action: 'settings', provider: 'codex', requestId: 'invalid-limit', detail: 'Invalid', maxAgents: 1 })).status, 400)
  const saved = await post({ action: 'settings', provider: 'codex', requestId: 'http-resource-limit', detail: 'Same limit', cwd, maxAgents: 2, budget: { maxTokens: 10 } })
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.equal((await saved.json()).interactive.resources.maxAgents, 2)
  const before = await coord.readInteractiveCoordinator('chat')
  assert.equal(before.resources!.usage.totalTokens, undefined)
  assert.equal(before.resources!.usage.costUsd, undefined)
  assert.match(resourceSummary(before.resources!).join('\n'), /cost: unavailable/)
  assert.doesNotMatch(resourceSummary(before.resources!).join('\n'), /\$0\.0000/)
  const requests = [{ title: 'A', detail: 'Work A', assignTo: 'auto' }, { title: 'B', detail: 'Work B', assignTo: 'auto' }]
  const competing = await Promise.allSettled(requests.map(request => coord.createExternalProtocolTask(identity, request)))
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(sessions, 1, 'capacity includes lead and allocates only one worker')
  await assert.rejects(coord.spawnAdditionalTeammate(identity), /slots are busy/)
  await until(() => turns.length === 1)
  const snapshot = (await coord.readExternalProtocolStatus(identity)).snapshot
  const task = snapshot.tasks[0]!
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(identity.runId)!
  await coord.recordProtocolEvent({ version: '1.0', runId: identity.runId, agentId: task.ownerAgentId!, taskId: task.id, type: 'usage.observed', payload: { delta: { totalTokens: 11 }, source: 'fixture' } })
  turns[0]!.release()
  await until(() => controller.turnInFlight.size === 0)
  const paused = await coord.readInteractiveCoordinator('chat')
  assert.match(paused.resources!.pausedReason!, /token budget exhausted/)
  const coordPath = fileURLToPath(new URL('../lib/agentCoordination.ts', import.meta.url))
  const restored = JSON.parse(execFileSync(process.execPath, ['-e', `const c = await import(${JSON.stringify(coordPath)}); console.log(JSON.stringify((await c.readInteractiveCoordinator('chat')).resources)); process.exit(0)`], { cwd, encoding: 'utf8' }))
  assert.match(restored.pausedReason, /token budget exhausted/, 'fresh process reads the same durable pause')
  assert.equal(restored.usage.costUsd, undefined)
  await assert.rejects(coord.spawnAdditionalTeammate(identity), /token budget exhausted/)
  const pausedBoard = (await coord.readExternalProtocolStatus(identity)).snapshot
  const pausedState = { snapshot: pausedBoard, interactive: paused, runningAgentIds: [], recoveries: [], permissions: [] }
  assert.deepEqual(coordinatorStalledAgentIds(pausedState, Date.now() + 100_000), [], 'budget pause is not a false stall')
  assert.match(coordinatorAgentActivity(pausedBoard.agents.find(agent => agent.id === task.ownerAgentId)!, pausedState), /Paused/)
  const owned = pausedBoard.tasks[0]!
  assert.equal(owned.ownerAgentId, task.ownerAgentId)
  assert.equal(owned.status, task.status, 'budget pause preserves owned task instead of failing or completing it')
  assert.equal((await coord.readExternalProtocolStatus(identity)).snapshot.run.status, 'running')
  await assert.rejects(coord.createExternalProtocolTask(identity, { title: 'Rejected', detail: 'No spend', assignTo: 'auto' }), /token budget exhausted/)
  assert.equal(sessions, 1)
  const limits = resourceLimits({ capacity: '2', tokens: '100', cost: '', minutes: '' })
  const request = { action: 'settings' as const, requestId: 'raise-limit', detail: 'Raise limit', cwd, ...limits }
  await service.sendTuiSessionCoordination('chat', 'codex', request)
  await until(() => turns.length === 2)
  assert.equal(turns[1]!.body.taskBudgetTokens, 89, 'resumed provider turn receives the remaining budget')
  await service.sendTuiSessionCoordination('chat', 'codex', request)
  assert.equal(turns.length, 2, 'keyed limit retry resumes the owned task once')
  assert.equal(sessions, 1)
  assert.equal((await coord.readInteractiveCoordinator('chat')).resources!.pausedReason, null)
  await assert.rejects(coord.configureInteractiveCoordinator({ sessionId: 'chat', provider: 'codex', cwd, maxAgents: 1 }), /Capacity/)
  await assert.rejects(coord.configureInteractiveCoordinator({ sessionId: 'chat', provider: 'codex', cwd, budget: { maxCostUsd: Infinity } }), /finite/)
  assert.equal((await coord.readInteractiveCoordinator('chat')).resources!.budget!.maxTokens, 100)
  const worker = controller.sdkIdentities.get(task.ownerAgentId!)!
  await coord.reportExternalProtocolProgress(worker, { status: 'blocked', taskId: task.id, summary: 'Waiting for a human answer' })
  turns[1]!.release()
  await until(() => controller.turnInFlight.size === 0)
  await coord.recordProtocolEvent({ version: '1.0', runId: identity.runId, agentId: 'coordinator', type: 'run.status', payload: { budgetPaused: true, reason: 'Provider budget limit reached' } })
  await coord.configureInteractiveCoordinator({ sessionId: 'chat', provider: 'codex', cwd, maxAgents: 3 })
  assert.match((await coord.readInteractiveCoordinator('chat')).resources!.pausedReason!, /Provider budget/, 'a capacity change cannot silently clear a provider budget pause')
  await service.sendTuiSessionCoordination('chat', 'codex', { action: 'settings', requestId: 'raise-again', detail: 'Raise budget', cwd, budget: { maxTokens: 200 } })
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(turns.length, 2, 'changing limits does not answer a human blocker or restart blocked work')
  assert.equal((await coord.readInteractiveCoordinator('chat')).resources!.pausedReason, null)

  console.log('Interactive resources smoke passed: missing usage labels, competing capacity, retained ownership on pause, pre-allocation budget rejection, explicit limit resume and exact-key replay.')
} finally {
  for (const controller of globalThis.__agentViewerCoordinatorControllers!.values()) controller.stopped = true
}
process.exit(0)
