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
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
  readViewSessionInfo: async () => ({ provider: 'codex', cwd }),
  createNewViewSession: async ({ provider }: { provider: string }) => ({ provider, sessionId: `teammate-${++created}`, isPending: false }),
  streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => new Promise<Response>(resolve => {
    assert.notEqual(sessionId, 'primary-chat', 'the supervisor must never run the user conversation')
    turns.set(sessionId, () => resolve(new Response('')))
  }),
}))
const coord = await import('../lib/agentCoordination')
const { coordinatorAttention } = await import('../lib/coordinatorAttention')
const { coordinatorStalledAgentIds } = await import('../lib/coordinatorInteractiveState')
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
  // A provider that has not produced anything yet is still a start in
  // progress, however slow: the stall window must measure only undispatched
  // work. These turns are held open, so check the real ledger an hour on.
  for (const ask of asks) await until(() => turns.has(ask.result.delegation.sessionId))
  const starting = await (await GET(new Request('http://localhost/coordination?provider=codex'), context)).json()
  assert.deepEqual(coordinatorStalledAgentIds(starting, Date.now() + 3_600_000), [], 'a dispatched turn awaiting its provider is not a stalled start')
  // The route reports background work from the runtime's waiting registry, so
  // both clients can show a teammate as working after its turn has ended.
  // Interrupting a managed teammate stops its live turn here, rather than
  // setting the cancel flag only an external worker's supervisor would poll.
  const { setRunningSession, clearRunningSession, setWaitingSession, clearWaitingSession } = await import('../lib/sessionRuntime')
  const leadIdentity = await coord.sessionCoordinatorIdentity('primary-chat', 'codex')
  const interruptTarget = asks[0].result.delegation
  await assert.rejects(coord.interruptInteractiveAgent(leadIdentity, interruptTarget.agentId), /no turn running here/,
    'with no live turn in this process there is nothing to interrupt')
  let interrupted = 0
  setRunningSession(interruptTarget.sessionId, { provider: 'codex', interrupt: async () => { interrupted += 1 } })
  await coord.interruptInteractiveAgent(leadIdentity, interruptTarget.agentId)
  assert.equal(interrupted, 1, 'a managed teammate is interrupted through its live session')
  const afterInterrupt = (await coord.readSessionCoordinator('primary-chat', 'codex'))!
  assert.equal(afterInterrupt.tasks.find(task => task.id === asks[0].result.task.id)?.ownerAgentId, interruptTarget.agentId,
    'interrupting a turn does not take the task away')
  await assert.rejects(coord.interruptInteractiveAgent({ ...leadIdentity, agentId: interruptTarget.agentId }, interruptTarget.agentId),
    /lead can interrupt|capability|not found|your own turn/, 'a teammate credential cannot interrupt anyone')
  clearRunningSession(interruptTarget.sessionId)

  const backgroundAsk = asks[0].result.delegation
  setWaitingSession({ sessionId: backgroundAsk.sessionId, provider: 'codex', backgroundTasks: [{ id: 'b1', type: 'subagent', status: 'running', description: 'search' }, { id: 'b2', type: 'shell', status: 'running', description: 'dev server' }], sessionCrons: [] })
  const waiting = await (await GET(new Request('http://localhost/coordination?provider=codex'), context)).json()
  assert.deepEqual(waiting.backgroundAgents, [{ agentId: backgroundAsk.agentId, tasks: 1, wakeups: 0 }], 'the route counts background subagents and ignores shells')
  clearWaitingSession(backgroundAsk.sessionId)
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
  for (const status of ['completed', 'failed', 'stopped']) {
    const ended = structuredClone(attentionFixture)
    ended.run.status = status
    assert.deepEqual(coordinatorAttention(ended), [], 'ended rooms must not ask for plans, decisions or replies that cannot be submitted')
    const results = structuredClone(after)
    results.run.status = status
    assert.equal(coordinatorAttention(results).filter(item => item.kind === 'result').length, 2, 'ending a room preserves task results for review')
  }
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
  // A chat may staff teammates from another provider; an existing teammate
  // keeps its own, and the choice is durable so a restart can still fail over.
  {
    const identity = await coord.sessionCoordinatorIdentity('primary-chat', 'codex')
    const mixed = await post({ action: 'delegate', requestId: 'mixed-1', detail: 'Review with a different provider', teammateProvider: 'claude' })
    const mixedAgent = mixed.snapshot.agents.find((agent: { id: string }) => agent.id === mixed.result.delegation.agentId)
    assert.equal(mixedAgent.provider, 'claude', 'the requested provider staffs the new teammate')
    const { DatabaseSync } = await (0, eval)('import("node:sqlite")')
    const db = new DatabaseSync(path.join(cwd, '.agent-viewer-data/agent-coordination/coordination.sqlite'), { readOnly: true })
    const stored = (db.prepare('SELECT teammate_providers FROM protocol_interactive_sessions WHERE session_id = ?').get('primary-chat') as { teammate_providers: string | null }).teammate_providers
    db.close()
    assert.deepEqual(JSON.parse(stored ?? '[]'), ['codex', 'claude'], 'the choice is persisted with the lead provider')
    // A settled teammate keeps its own provider: asking for another one is
    // refused rather than running the work somewhere the user did not choose.
    await assert.rejects(coord.createExternalProtocolTask(identity, { assignTo: asks[1].result.delegation.agentId, title: 'x', detail: 'y', requestedProvider: 'claude' }),
      /is a codex teammate|only applies to a new teammate/, 'an existing teammate is not re-provisioned by a provider request')
    void identity
  }

  // A run that has ended cannot be resumed, so it must not ask to be: an
  // interrupted teammate in a stopped room reads Stopped, not "needs recovery".
  {
    const { runId } = await coord.sessionCoordinatorIdentity('primary-chat', 'codex')
    const live = await coord.readInteractiveRecoveries(runId)
    await coord.stopProtocolRun(runId)
    assert.deepEqual(await coord.readInteractiveRecoveries(runId), [], 'an ended run offers no recovery it would refuse')
    void live
  }

  console.log('Chat setup/replay, concurrent asks, attention, mail delivery, persistent follow-up, and external automatic startup passed')
} finally {
  for (const runId of runs) await coord.stopProtocolRun(runId)
  for (const release of turns.values()) release()
  mock.restore()
}
