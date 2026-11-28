import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-dispatch-continuation-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
let starts = 0
const prompts: string[] = []
let finish: (() => void) | undefined
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async () => ({ provider: 'codex', sessionId: 'worker-session', isPending: false }),
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
  streamViewSessionTurn: async ({ body }: { body: { message: string } }) => {
    starts++
    prompts.push(body.message)
    return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      finish = () => { finish = undefined; stream.close() }
    } }))
  },
}))
const coord = await import('../lib/agentCoordination')
async function until(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000
  while (!(await predicate()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(await predicate(), 'managed dispatch did not settle')
}
await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd })
const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
try {
  const standby = await coord.spawnAdditionalTeammate(lead)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(starts, 0, 'an unassigned standby teammate spends no model turn')
  const assigned = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Inspect fixture', detail: 'Read-only review' })
  const agentId = assigned.delegation!.agentId
  assert.equal(agentId, standby.agentId, 'the first assignment reuses the standby session')
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
  const worker = controller.sdkIdentities.get(agentId)!
  await until(() => starts === 1 && !!finish)
  // Wait for provider acceptance bookkeeping to settle while the turn is open.
  await coord.readExternalProtocolStatus(lead)
  const inbox = await coord.readExternalProtocolInbox(worker, { acknowledge: false })
  assert.ok(inbox.messages.some(message => message.body.includes(`Delegated ${assigned.task!.id}:`)),
    'assignment mail remains available until the dispatch settles')
  assert.match(prompts[0]!, /You already own it\. Skip routine coord_status and coord_claim_task/)
  assert.match(prompts[0]!, /no unread mail requiring a separate initial inbox read/)
  assert.match(prompts[0]!, /"detail":"Read-only review"/)
  if (process.env.COORD_SMOKE_REQUIRE_BOUND_CLIENT === '1') {
    assert.match(prompts[0]!, /Host-supplied session client, for when coord_\* tools are absent or unbound:/)
  }
  await coord.reportExternalProtocolProgress(worker, { status: 'blocked', taskId: assigned.task!.id, summary: 'Waiting for fixture input' })
  finish!()
  await until(() => !controller.turnInFlight.has(agentId))
  assert.deepEqual((await coord.readExternalProtocolInbox(worker, { acknowledge: false })).messages, [],
    'a settled dispatch acknowledges only the embedded assignment notice')
  assert.equal(starts, 1, 'an explicitly blocked task must not spend an automatic continuation turn')
  assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.tasks[0].status, 'blocked')
  assert.equal(controller.nudges.size, 0, 'waiting for input is not a stalled turn')
  await coord.sendExternalProtocolMessage(lead, { to: agentId, body: 'Fixture input is ready', kind: 'request', replyRequired: true })
  await until(() => starts === 2)
  assert.match(prompts[1]!, /answer required replies before starting/)
  assert.match(prompts[1]!, /Read unread mail/)
  assert.doesNotMatch(prompts[1]!, /coord_read_inbox\(unresolved=true\)/, 'new reply-required mail needs one inbox read')
  assert.doesNotMatch(prompts[1]!, /"detail":"Read-only review"/, 'a resumed turn avoids repeating the brief')
  const advice = await coord.readExternalProtocolInbox(worker)
  assert.ok(advice.messages.some(message => message.body === 'Fixture input is ready' && message.replyRequired),
    'new advice must wake the blocked worker and remain readable after provider acceptance')
  const question = advice.messages.find(message => message.body === 'Fixture input is ready')!
  await coord.sendExternalProtocolMessage(worker, { to: 'lead', body: 'Input received; continuing review', kind: 'response', inReplyTo: question.id })
  await coord.reportExternalProtocolProgress(worker, { status: 'working', taskId: assigned.task!.id })
  assert.equal((await coord.completeExternalProtocolTask(worker, { taskId: assigned.task!.id, summary: 'Fixture reviewed' })).accepted, true)
  finish!()
  await until(() => !controller.turnInFlight.has(agentId))
  assert.equal(starts, 2)
  await until(async () => (await coord.readExternalProtocolStatus(lead)).snapshot.agents
    .some(agent => agent.id === agentId && agent.status === 'done'))
  const paused = await coord.createExternalProtocolTask(lead, { title: 'After review', detail: 'Keep this lane pending during the gate' })
  controller.interactiveLeadId = undefined
  controller.forcedInterventionsUsed = 99
  const { Database } = await (0, eval)('import("bun:sqlite")')
  const fixtureDb = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
  try {
    fixtureDb.query("UPDATE protocol_runs SET status = 'blocked' WHERE id = ?").run(lead.runId)
    assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.run.status, 'blocked')
    await coord.runProtocolMaintenanceSweep()
    assert.equal((await coord.readExternalProtocolTask(lead, paused.task!.id)).task.status, 'pending',
      'an exhausted stall allowance cannot fail work paused at a run gate')
    assert.equal(starts, 2, 'maintenance cannot spend a turn at the gate')
    fixtureDb.query("UPDATE protocol_runs SET status = 'running' WHERE id = ?").run(lead.runId)
  } finally { fixtureDb.close() }
  await coord.runProtocolMaintenanceSweep()
  await until(() => starts === 3)
  assert.equal((await coord.readExternalProtocolTask(lead, paused.task!.id)).task.ownerAgentId, agentId)
  console.log('SDK dispatch preserves pull-based inbox; blocked turns pause until new advice and then complete')
} finally {
  await coord.stopProtocolRun(lead.runId)
  finish?.()
  mock.restore()
}
