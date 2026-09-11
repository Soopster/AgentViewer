import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const cwd = mkdtempSync(path.join(tmpdir(), 'coord-conversation-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
let created = 0
const turns = new Map<string, () => void>()
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  readViewSessionInfo: async () => ({ provider: 'codex', cwd }),
  createNewViewSession: async () => ({ provider: 'codex', sessionId: `teammate-${++created}`, isPending: false }),
  streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => new Promise<Response>(resolve => {
    assert.notEqual(sessionId, 'primary-chat', 'the supervisor must never run the user conversation')
    turns.set(sessionId, () => resolve(new Response('')))
  }),
}))
const coord = await import('../lib/agentCoordination')
const { coordinatorAttention } = await import('../lib/coordinatorAttention')
const { POST, GET } = await import('../app/api/sessions/[sessionId]/coordination/route')
const context = { params: Promise.resolve({ sessionId: 'primary-chat' }) }
async function post(body: Record<string, unknown>) {
  const response = await POST(new Request('http://localhost/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'codex', ...body }) }), context)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'dispatch did not settle')
}
const runs: string[] = []
try {
  const asks = await Promise.all([1, 2].map(n => post({ action: 'delegate', requestId: `ask-${n}`, detail: `Review ${n}` })))
  const snapshot = asks[1].snapshot
  runs.push(snapshot.run.id)
  assert.equal(asks[0].snapshot.run.id, snapshot.run.id, 'concurrent chat asks share one durable run')
  assert.equal(created, 2)
  const replay = await post({ action: 'delegate', requestId: 'ask-1', detail: 'Review 1' })
  assert.equal(replay.result.task.id, asks[0].result.task.id)
  assert.equal(created, 2)
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(snapshot.run.id)!
  for (const ask of asks) {
    const { agentId, sessionId } = ask.result.delegation
    await until(() => turns.has(sessionId))
    const identity = controller.sdkIdentities.get(agentId)!
    await coord.reportExternalProtocolProgress(identity, { status: 'working', taskId: ask.result.task.id })
    await coord.completeExternalProtocolTask(identity, { taskId: ask.result.task.id, summary: `Result for ${agentId}` })
    turns.get(sessionId)!()
    await until(() => !controller.turnInFlight.has(agentId))
  }
  const after = (await (await GET(new Request('http://localhost/coordination?provider=codex'), context)).json()).snapshot
  assert.equal(after.tasks.length, 2)
  assert.ok(!['completed', 'failed', 'stopped'].includes(after.run.status), 'interactive room stays open between asks')
  assert.equal(coordinatorAttention(after).filter(item => item.kind === 'result').length, 2)
  const mail = await coord.drainCooperativeInbox('primary-chat')
  assert.match(mail, /finished|Result/)
  assert.equal(await coord.drainCooperativeInbox('primary-chat'), '', 'model mail is delivered once')
  const attentionFixture = structuredClone(after)
  attentionFixture.tasks[0].status = 'planned'
  attentionFixture.tasks[1].status = 'blocked'
  attentionFixture.tasks[1].receipt.needsDecision = [{ id: 'choice', question: 'Which approach?', options: [], impactIfWrong: 'Wrong result', status: 'open' }]
  attentionFixture.events.push({ version: 2, runId: after.run.id, agentId: after.tasks[0].ownerAgentId, taskId: after.tasks[0].id, type: 'plan.completed', detail: 'Inspect README only' })
  const attention = coordinatorAttention(attentionFixture)
  assert.deepEqual(attention.map(item => item.kind).sort(), ['blocker', 'decision', 'plan'])
  assert.equal(attention.find(item => item.kind === 'plan')!.detail, 'Inspect README only')
  // Simulate server restart after all provider streams have settled. Durable
  // sessions should be rebound, without replaying completed provider turns.
  globalThis.__agentViewerCoordinatorControllers!.delete(snapshot.run.id)
  const original = asks[0].result.delegation
  const followup = await post({ action: 'delegate', requestId: 'followup', to: original.agentId, detail: 'Review the revision' })
  assert.equal(followup.result.delegation.sessionId, original.sessionId)
  assert.equal(created, 2)
  // The same automatic startup works when the authenticated lead is external.
  const external = (await coord.createExternalProtocolRun({ prompt: 'External interactive run', baseCwd: cwd, provider: 'codex', participantName: 'external-lead', maxAgents: 2 })).participant
  runs.push(external.runId)
  const task = await coord.createExternalProtocolTask(external, { assignTo: 'auto', title: 'External review', detail: 'Report findings' })
  assert.ok(task.delegation?.sessionId)
  assert.equal(created, 3)
  console.log('Chat setup/replay, concurrent asks, attention, mail delivery, persistent follow-up, and external automatic startup passed')
} finally {
  for (const runId of runs) await coord.stopProtocolRun(runId)
  for (const release of turns.values()) release()
  mock.restore()
}
