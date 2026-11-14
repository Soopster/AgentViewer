import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-auto-delegate-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
let sessionsCreated = 0
const turns = new Map<string, () => void>()
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async () => ({ provider: 'codex', sessionId: `fixture-session-${++sessionsCreated}`, isPending: false }),
  streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => new Promise<Response>(resolve => {
    turns.set(sessionId, () => resolve(new Response('')))
  }),
}))
const coord = await import('../lib/agentCoordination')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Interactive session', baseCwd: cwd, provider: 'codex', participantName: 'lead', maxAgents: 3 })).participant
const controller = {
  runId: lead.runId, prompt: 'Interactive session', provider: 'codex' as const, teammateProviders: ['codex' as const], baseCwd: cwd,
  maxAgents: 3, requirePlanApproval: false, autonomy: 'medium' as const, requireReview: false, acceptanceContract: {}, useWorktrees: false,
  stopped: false, synthesisStarted: false, synthesisFindingFloorRowid: 0, interventionsUsed: 0, forcedInterventionsUsed: 0,
  turnInFlight: new Set(['lead', lead.agentId]), sessionIds: new Map(), pendingSessions: new Set<string>(), nudges: new Map(), dispatchNotes: new Map(),
  failedProviders: new Map(), sdkIdentities: new Map([['lead', lead]]), executionStarted: true, sameProviderRetries: new Map(), claudeUsageCumulative: new Map(),
}
globalThis.__agentViewerCoordinatorControllers!.set(lead.runId, controller as any)
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'managed dispatch did not settle')
}
try {
  const requests = [1, 2].map(n => ({ detail: `Review part ${n}`, requestId: `auto-${n}` }))
  const results = await Promise.all(requests.map(request => coord.delegateProtocolTaskAdmin(lead.runId, request)))
  assert.equal(sessionsCreated, 2, 'concurrent asks must allocate distinct sessions')
  assert.notEqual(results[0]!.delegation!.agentId, results[1]!.delegation!.agentId)
  assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.tasks.length, 2)
  assert.equal(JSON.stringify(await coord.delegateProtocolTaskAdmin(lead.runId, requests[0]!)), JSON.stringify(results[0]))
  const { POST } = await import('../app/api/agent-protocol/runs/[runId]/delegate/route')
  const post = (body: unknown) => POST(new Request('http://localhost/api/agent-protocol/runs/fixture/delegate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ runId: lead.runId }) })
  assert.equal((await post({ detail: 'Missing retry key' })).status, 400)
  const replayResponse = await post(requests[0])
  assert.equal(replayResponse.status, 200)
  assert.equal(JSON.stringify(await replayResponse.json()), JSON.stringify(results[0]))
  assert.equal(sessionsCreated, 2, 'HTTP replay must preserve the original assignment')
  await assert.rejects(coord.delegateProtocolTaskAdmin(lead.runId, { detail: 'Over capacity', requestId: 'capacity' }), /slots are busy/)
  assert.equal(sessionsCreated, 2)
  const first = results[0]!
  const agentId = first.delegation!.agentId
  const sessionId = first.delegation!.sessionId!
  await until(() => turns.has(sessionId))
  const worker = controller.sdkIdentities.get(agentId)!
  await coord.reportExternalProtocolProgress(worker, { status: 'working', taskId: first.task!.id })
  assert.equal((await coord.completeExternalProtocolTask(worker, { taskId: first.task!.id, summary: 'Review complete: first finding.' })).accepted, true)
  turns.get(sessionId)!()
  await until(() => !controller.turnInFlight.has(agentId))
  const done = (await coord.readExternalProtocolStatus(lead)).snapshot.agents.find(agent => agent.id === agentId)!
  assert.equal(done.status, 'done')
  const followup = await coord.delegateProtocolTaskAdmin(lead.runId, { detail: 'Review the revision', to: agentId, requestId: 'followup' })
  assert.equal(followup.delegation!.sessionId, sessionId, 'follow-up must retain the original conversation')
  assert.equal(sessionsCreated, 2)
  assert.equal(followup.task!.ownerAgentId, agentId)
  await coord.stopProtocolRun(lead.runId)
  assert.equal((await post({ detail: 'Too late', requestId: 'stopped' })).status, 409)
  assert.equal(sessionsCreated, 2, 'stopped runs must not allocate another session')
  console.log('Automatic delegation, concurrent spawn, replay, capacity, managed completion, and session reuse passed')
} finally {
  await coord.stopProtocolRun(lead.runId)
  for (const release of turns.values()) release()
  mock.restore()
}
