import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A snapshot's eventCursor is the boundary: what commits afterwards is exactly
// what readProtocolEventsAfter returns, in order, with nothing repeated.
const root = await mkdtemp(path.join(tmpdir(), 'coord-cursor-'))
process.chdir(root)
const coordination = await import('../lib/agentCoordination')
const identity = (await coordination.createExternalProtocolRun({
  prompt: 'Verify the event cursor', provider: 'codex', baseCwd: root,
  participantName: 'cursor-smoke', maxAgents: 2,
})).participant

const before = await coordination.readProtocolRun(identity.runId)
assert.ok(before?.eventCursor && /^\d+$/.test(before.eventCursor), 'snapshot carries a numeric cursor')
assert.deepEqual((await coordination.readProtocolEventsAfter(identity.runId, before.eventCursor)).events, [], 'nothing after a fresh snapshot')

await coordination.createExternalProtocolTask(identity, { title: 'First after snapshot', detail: 'one' })
await coordination.createExternalProtocolTask(identity, { title: 'Second after snapshot', detail: 'two' })

const page = await coordination.readProtocolEventsAfter(identity.runId, before.eventCursor, 1)
assert.equal(page.events.length, 1)
assert.equal(page.hasMore, true, 'a short page says more follows')
const rest = await coordination.readProtocolEventsAfter(identity.runId, page.cursor)
const created = [...page.events, ...rest.events].filter((event) => event.type === 'task.created').map((event) => event.detail)
assert.deepEqual(created, ['one', 'two'], 'paging neither skips nor repeats')
assert.equal(rest.hasMore, false)

const after = await coordination.readProtocolRun(identity.runId)
assert.equal(after?.eventCursor, rest.cursor, 'the next snapshot lands exactly where the stream ended')
await assert.rejects(coordination.readProtocolEventsAfter(identity.runId, 'abc'), /cursor/)

// Re-attempts are durable events, listed per task and visible through the cursor.
const task = (await coordination.createExternalProtocolTask(identity, { title: 'Flaky', detail: 'three' })) as { task?: { id: string }; taskId?: string }
const taskId = task.task?.id ?? task.taskId
assert.ok(taskId)
const mark = (await coordination.readProtocolRun(identity.runId))!.eventCursor!
await coordination.appendProtocolEvent({
  version: (await import('../lib/agentProtocol')).AGENT_PROTOCOL_VERSION, runId: identity.runId, agentId: identity.agentId,
  type: 'agent.attempt', taskId, summary: 'retry', payload: { reason: 'retry', ordinal: 2, provider: 'codex', failureClass: 'rate_limit' },
})
const attempts = await coordination.listProtocolAttempts(identity.runId, taskId)
assert.equal(attempts.length, 1)
assert.deepEqual([attempts[0]!.reason, attempts[0]!.ordinal, attempts[0]!.provider], ['retry', 2, 'codex'])
assert.equal((await coordination.readProtocolEventsAfter(identity.runId, mark)).events.at(-1)?.type, 'agent.attempt')
console.log('coord event cursor smoke: ok')
process.exit(0)
