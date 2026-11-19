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
let finish: (() => void) | undefined
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async () => ({ provider: 'codex', sessionId: 'worker-session', isPending: false }),
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
  streamViewSessionTurn: async () => {
    starts++
    return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      finish = () => { finish = undefined; stream.close() }
    } }))
  },
}))
const coord = await import('../lib/agentCoordination')
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'managed dispatch did not settle')
}
await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd })
const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
try {
  const assigned = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Inspect fixture', detail: 'Read-only review' })
  const agentId = assigned.delegation!.agentId
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
  const worker = controller.sdkIdentities.get(agentId)!
  await until(() => starts === 1 && !!finish)
  // Wait for provider acceptance bookkeeping to settle while the turn is open.
  await coord.readExternalProtocolStatus(lead)
  const inbox = await coord.readExternalProtocolInbox(worker, { acknowledge: false })
  assert.ok(inbox.messages.some(message => message.body.includes(`Delegated ${assigned.task!.id}:`)),
    'SDK tick prompts must leave their unembedded assignment mail available to coord_read_inbox')
  await coord.readExternalProtocolInbox(worker)
  await coord.reportExternalProtocolProgress(worker, { status: 'blocked', taskId: assigned.task!.id, summary: 'Waiting for fixture input' })
  finish!()
  await until(() => !controller.turnInFlight.has(agentId))
  assert.equal(starts, 1, 'an explicitly blocked task must not spend an automatic continuation turn')
  assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.tasks[0].status, 'blocked')
  assert.equal(controller.nudges.size, 0, 'waiting for input is not a stalled turn')
  await coord.sendExternalProtocolMessage(lead, { to: agentId, body: 'Fixture input is ready', kind: 'request', replyRequired: true })
  await until(() => starts === 2)
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
  console.log('SDK dispatch preserves pull-based inbox; blocked turns pause until new advice and then complete')
} finally {
  await coord.stopProtocolRun(lead.runId)
  finish?.()
  mock.restore()
}
