import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// "Cancel task" is the lead taking work away: unlike an interrupt it ends the task, frees the teammate, and fails what waited on it.
const root = mkdtempSync(path.join(tmpdir(), 'coord-cancel-'))
process.chdir(root)
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'cancel', provider: 'codex', baseCwd: root, participantName: 'lead', maxAgents: 3 })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: 'worker' })).participant

const first = await coord.createExternalProtocolTask(lead, { title: 'first', detail: 'first' })
const firstId = first.task!.id
const second = await coord.createExternalProtocolTask(lead, { title: 'second', detail: 'second', dependsOn: [firstId] })
const secondId = second.task!.id
await coord.claimExternalProtocolTask(worker, firstId)

// Only the lead cancels.
await assert.rejects(coord.cancelInteractiveTask(worker, firstId), /Only the Coordinator lead/)
await assert.rejects(coord.cancelInteractiveTask(lead, 'task-nope'), /not found/)

const inspected = await execute({ ...lead, action: 'read_task', taskId: firstId }) as Awaited<ReturnType<typeof coord.readExternalProtocolTask>>
assert.equal(inspected.cancellationImpact.dependentTaskCount, 1)
const cancellation = { ...lead, action: 'cancel_task', taskId: firstId, expectedRevision: inspected.revision, reason: 'wrong approach', requestId: 'cancel-obsolete' }
await assert.rejects(execute({ ...cancellation, ...worker }), /Only the Coordinator lead/)
const third = await coord.createExternalProtocolTask(lead, { title: 'third', detail: 'another dependency', dependsOn: [secondId] })
await assert.rejects(execute(cancellation), /dependent work changed/)
await assert.rejects(coord.cancelProtocolTask(lead.runId, firstId, 'stale atomic guard', inspected.revision), /dependent work changed/)
assert.equal((await coord.readExternalProtocolTask(lead, firstId)).task.status, 'claimed', 'atomic stale-pin rejection does not cancel work')
const current = await coord.readExternalProtocolTask(lead, firstId)
assert.equal(current.cancellationImpact.dependentTaskCount, 2)
const acceptedRequest = { ...cancellation, expectedRevision: current.revision }
const cancelled = await execute(acceptedRequest) as { cancelled: true }
assert.equal(JSON.stringify(await execute(acceptedRequest)), JSON.stringify(cancelled), 'same-key cancellation returns the original receipt')
assert.equal((await coord.readExternalProtocolTask(lead, third.task!.id)).task.status, 'failed', 'transitive blocked work is failed')
assert.equal(cancelled.cancelled, true)
const snapshot = (await coord.readProtocolRun(lead.runId))!
assert.equal(snapshot.tasks.find((task) => task.id === firstId)?.status, 'cancelled')
assert.equal(snapshot.tasks.find((task) => task.id === secondId)?.status, 'failed', 'work that depended on it can no longer run')
assert.equal(snapshot.agents.find((agent) => agent.id === worker.agentId)?.taskId, undefined, 'the teammate is freed')
assert.ok(snapshot.events.some((event) => event.type === 'task.cancelled' && event.taskId === firstId && event.summary === 'wrong approach' && event.agentId === lead.agentId), 'the reason is recorded')

// It is not repeatable: a cancelled task is already over.
await assert.rejects(coord.cancelInteractiveTask(lead, firstId), /already cancelled/)
console.log('coord cancel task smoke: ok')
process.exit(0)
