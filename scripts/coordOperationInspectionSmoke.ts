import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-operation-inspection-'))
process.chdir(cwd)
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Lost response lookup', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant
const inspect = (key: string, participant = lead, toolName = 'coord_create_task') => execute({ ...participant, action: 'inspect_operation', toolName, operationRequestId: key }) as ReturnType<typeof coord.inspectExternalProtocolOperation>
const request = { ...lead, action: 'create_task', title: 'Durable effect', detail: 'Saved task from a lost response', requestId: 'created-once' }
const created = await execute(request) as { task: { id: string } }
const completed = await inspect('created-once')
assert.equal(completed.state, 'completed')
assert.equal(completed.hasCachedResult, true)
assert.equal(completed.returnedTaskId, created.task.id)
assert.equal((await inspect('created-once', lead, 'coord_delegate')).returnedTaskId, created.task.id, 'delegate alias maps to create_task storage')
assert.equal((await inspect('created-once', worker)).state, 'not_found', 'another participant cannot inspect the lead operation')
assert.equal(JSON.stringify(completed).includes(lead.token), false)
assert.equal(JSON.stringify(completed).includes(request.detail), false, 'inspection does not return cached board/task bodies')
await assert.rejects(inspect('created-once', { ...lead, token: 'wrong' }), /Invalid Coordinator participant/)
await assert.rejects(inspect('created-once', lead, 'not-a-tool'), /Coordinator tool_name/)
await assert.rejects(execute({ ...lead, action: 'inspect_operation', toolName: 'coord_create_task', operationRequestId: '' }), /operation_request_id/)
await assert.rejects(coord.runExternalProtocolIdempotent(lead, 'create_task', 'partial-failure', async () => {
  await coord.createExternalProtocolTask(lead, { title: 'Written before failure', detail: 'Inspect instead of replaying' })
  throw new Error('Failed after task creation')
}), /Failed after task creation/)
assert.equal((await inspect('partial-failure')).state, 'failed')
await assert.rejects(coord.runExternalProtocolIdempotent(lead, 'create_task', 'partial-failure', async () => ({ replayed: true })), /COORDINATOR_OPERATION_UNCERTAIN/)
let enter!: () => void
let settle!: () => void
const entered = new Promise<void>(resolve => { enter = resolve })
const canSettle = new Promise<void>(resolve => { settle = resolve })
const running = coord.runExternalProtocolIdempotent(lead, 'create_task', 'in-flight', async () => {
  enter(); await canSettle
  return { taskId: 'fixture-only-reference' }
})
await entered
const runningInspection = await inspect('in-flight')
assert.equal(runningInspection.state, 'running')
assert.equal(runningInspection.hasCachedResult, false)
assert.match(runningInspection.guidance, /not proof of a live process/)
settle(); await running
assert.equal((await inspect('in-flight')).state, 'completed')
const { Database } = await (0, eval)('import("bun:sqlite")')
const db = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
db.query('DELETE FROM protocol_idempotency WHERE run_id = ? AND agent_id = ? AND action = ? AND request_id = ?').run(lead.runId, lead.agentId, 'create_task', 'created-once')
const expired = await inspect('created-once')
assert.equal(expired.state, 'completed')
assert.equal(expired.hasCachedResult, false)
assert.match(expired.guidance, /cached receipt expired/)
await assert.rejects(execute(request), /COORDINATOR_OPERATION_UNCERTAIN/)
db.close()
assert.equal((await inspect('unknown-key')).state, 'not_found')
console.log('Operation inspection passed: alias mapping, participant privacy, in-flight/partial/completed states, expired receipts and retained replay fences.')
process.exit(0)
