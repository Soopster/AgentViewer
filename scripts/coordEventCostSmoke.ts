// An event's cost must not grow with the run, and skipping the artifact rebuild
// for telemetry must not leave the run artifacts stale.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'coord-event-cost-'))
process.chdir(root)
process.env.AGENT_VIEWER_COORD_MAX_OPEN_TASKS = '300' // room for the 220-task board this measures against
const coord = await import('../lib/agentCoordination')
const { AGENT_PROTOCOL_VERSION } = await import('../lib/agentProtocol')
const lead = (await coord.createExternalProtocolRun({ prompt: 'cost', provider: 'codex', baseCwd: root, participantName: 'lead', maxAgents: 3 })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: 'w' })).participant
const task = (await coord.createExternalProtocolTask(lead, { title: 'one', detail: 'one' })).task!
await coord.claimExternalProtocolTask(worker, task.id)

const event = (type: string, extra: Record<string, unknown> = {}) => ({
  version: AGENT_PROTOCOL_VERSION, runId: lead.runId, agentId: worker.agentId, type, taskId: task.id, summary: `${type} event`, ...extra,
}) as Parameters<typeof coord.recordProtocolEvent>[0]
const capsule = async () => {
  const { createdAt: _ignored, ...rest } = (await coord.readProtocolRun(lead.runId))!.run.resumeCapsule!
  return JSON.stringify(rest)
}

// A rebuild is a no-op for every telemetry type: the artifacts after a neutral event equal what a rebuild would produce.
await coord.recordProtocolEvent(event('agent.ready'))
const rebuilt = await capsule()
for (const type of ['finding', 'learning', 'usage.observed', 'agent.attempt', 'checkpoint.created', 'agent.heartbeat']) {
  await coord.recordProtocolEvent(event(type, { payload: { delta: { totalTokens: 1 }, reason: 'retry', ordinal: 2, provider: 'codex' } }))
  assert.equal(await capsule(), rebuilt, `${type} left the artifacts as a rebuild would`)
}
// …and a type that does change them still rebuilds.
await coord.recordProtocolEvent(event('task.failed'))
assert.notEqual(await capsule(), rebuilt, 'a task event still refreshes the capsule')

// recordProtocolEvent and appendProtocolEvent write the same thing; only one reads the snapshot back.
const before = (await coord.readProtocolRun(lead.runId))!.eventCursor
assert.equal(await coord.recordProtocolEvent(event('finding')), undefined)
const snapshot = await coord.appendProtocolEvent(event('finding'))
assert.ok(snapshot && Number(snapshot.eventCursor) === Number(before) + 2, 'both appended, and the append returns the snapshot after them')

// The per-event cost is flat in the number of tasks: 10x the board must not make an event 10x dearer.
const costAt = async (tasks: number) => {
  for (let i = 0; i < tasks; i += 1) await coord.createExternalProtocolTask(lead, { title: `bulk ${i}`, detail: 'bulk', paths: [`p/${i}.ts`] })
  const start = performance.now()
  for (let i = 0; i < 40; i += 1) await coord.recordProtocolEvent(event('finding'))
  return (performance.now() - start) / 40
}
const small = await costAt(20)
const large = await costAt(200)
console.log(`per finding event: ${small.toFixed(2)}ms at ~20 tasks, ${large.toFixed(2)}ms at ~220`)
assert.ok(large < Math.max(small * 4, 6), `event cost grew with the board: ${small.toFixed(2)}ms -> ${large.toFixed(2)}ms`)
const typeCost = async (type: string) => {
  const start = performance.now()
  for (let i = 0; i < 40; i += 1) await coord.recordProtocolEvent(event(type, { payload: { delta: { totalTokens: 10, costUsd: 0.001 } } }))
  return (performance.now() - start) / 40
}
for (const type of ['usage.observed', 'agent.heartbeat', 'task.child.progress', 'agent.ready']) console.log(`  ${type.padEnd(22)} ${(await typeCost(type)).toFixed(2)}ms at ~220 tasks`)

// A runaway lead cannot grow the board without bound, and finished work does not count against it.
await assert.rejects(async () => { for (let i = 0; i < coord.MAX_OPEN_TASKS + 5; i += 1) await coord.createExternalProtocolTask(lead, { title: `flood ${i}`, detail: 'flood' }) }, /open tasks \(limit \d+\)/)
console.log('coord event cost smoke: ok')
process.exit(0)
