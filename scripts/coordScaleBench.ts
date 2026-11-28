// How the Coordinator's hot reads and writes behave on a long, wide run.
//   bun run scripts/coordScaleBench.ts            (TASKS=300 EVENTS=6000 by default)
// Reports ms per call, so a read that grows with run size shows as a number.
import { mkdtempSync } from 'node:fs'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TASKS = Number(process.env.TASKS) || 300
const EVENTS = Number(process.env.EVENTS) || 6000
const root = mkdtempSync(path.join(tmpdir(), 'coord-scale-'))
process.chdir(root)
process.env.AGENT_VIEWER_COORD_MAX_OPEN_TASKS = String(TASKS + 50) // the board cap is a guard, not what is being measured
const coord = await import('../lib/agentCoordination')
const { AGENT_PROTOCOL_VERSION } = await import('../lib/agentProtocol')

const time = async <T,>(label: string, fn: () => Promise<T>, runs = 5): Promise<T> => {
  let last!: T
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now()
    last = await fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  console.log(`${label.padEnd(44)} median ${samples[Math.floor(samples.length / 2)]!.toFixed(1)}ms  worst ${samples.at(-1)!.toFixed(1)}ms`)
  return last
}

const lead = (await coord.createExternalProtocolRun({ prompt: 'scale', provider: 'codex', baseCwd: root, participantName: 'lead', maxAgents: 8 })).participant
const workers = await Promise.all(['a', 'b', 'c', 'd'].map(async (name) => (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: name })).participant))

let start = performance.now()
const ids: string[] = []
for (let i = 0; i < TASKS; i += 1) {
  const created = await coord.createExternalProtocolTask(lead, { title: `task ${i}`, detail: `detail ${i}`, paths: [`src/m${i % 40}/f${i}.ts`], ...(i > 3 ? { dependsOn: [ids[i - 4]!] } : {}) })
  ids.push(created.task!.id)
}
console.log(`create ${TASKS} tasks: ${((performance.now() - start) / TASKS).toFixed(2)}ms each`)

// Half the board finished, with receipts and usage, the way a long run looks.
start = performance.now()
for (let i = 0; i < TASKS / 2; i += 1) {
  const worker = workers[i % workers.length]!
  await coord.claimExternalProtocolTask(worker, ids[i]!)
  await coord.completeExternalProtocolTask(worker, { taskId: ids[i]!, summary: `done ${i}`, filesChanged: [`src/m${i % 40}/f${i}.ts`], usage: { totalTokens: 1000, costUsd: 0.01 } }).catch(() => {})
}
console.log(`complete ${TASKS / 2} tasks: ${((performance.now() - start) / (TASKS / 2)).toFixed(2)}ms each`)

const archivedSummary = 'sentinel evidence for an early run decision'
await coord.appendProtocolEvent({
  version: AGENT_PROTOCOL_VERSION, runId: lead.runId, agentId: workers[0]!.agentId,
  type: 'finding', summary: archivedSummary, detail: 'Retained evidence',
})
const earlyFinding = (await coord.queryExternalProtocolContext(lead, { query: archivedSummary, limit: 1 })).results[0]
assert.ok(earlyFinding?.eventId)

start = performance.now()
for (let i = 0; i < EVENTS; i += 1) {
  await coord.appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION, runId: lead.runId, agentId: workers[i % workers.length]!.agentId,
    type: i % 3 === 0 ? 'usage.observed' : 'finding', taskId: ids[i % TASKS], summary: `event ${i}`,
    payload: { delta: { totalTokens: 500, costUsd: 0.002 } },
  })
}
console.log(`append ${EVENTS} events: ${((performance.now() - start) / EVENTS).toFixed(2)}ms each`)

console.log('--- reads ---')
await time('readProtocolRun (the TUI/web poll)', () => coord.readProtocolRun(lead.runId))
await time('readExternalProtocolStatus (lead, coord_status)', () => coord.readExternalProtocolStatus(lead))
const actionable = await time('readExternalProtocolActionableStatus (lead)', () => coord.readExternalProtocolActionableStatus(lead))
await time('readExternalProtocolStatus (worker)', () => coord.readExternalProtocolStatus(workers[0]!))
await time('listProtocolRuns', () => coord.listProtocolRuns(20))
await time('createExternalProtocolTask (one more)', () => coord.createExternalProtocolTask(lead, { title: 'late', detail: 'late', paths: ['x.ts'] }), 3)
await time('readSessionCoordinator-style attention', () => coord.readProtocolRun(lead.runId), 3)
const snap = (await coord.readProtocolRun(lead.runId))!
console.log(`snapshot json: ${(JSON.stringify(snap).length / 1024).toFixed(0)}KB  tasks ${snap.tasks.length}/${TASKS}  events ${snap.events.length}`)
const status = await coord.readExternalProtocolStatus(lead)
console.log(`coord_status (what an LLM lead reads): ${(JSON.stringify(status).length / 1024).toFixed(0)}KB, ${status.snapshot.tasks.length} tasks`)
console.log(`coord_status actionable: ${JSON.stringify(actionable).length} characters`)
const exact = await time('read prior evidence by event ID', () => coord.queryExternalProtocolContext(lead, { eventId: earlyFinding.eventId }))
assert.deepEqual(exact.results[0], { ...earlyFinding, score: 1 })
if (Math.floor(EVENTS * 2 / 3) >= 500) {
  const search = await coord.queryExternalProtocolContext(lead, { query: archivedSummary, limit: 1 })
  assert.equal(search.results.length, 0, 'the sentinel aged out of lexical search')
}

const wideLead = (await coord.createExternalProtocolRun({ prompt: 'Wide runnable queue', provider: 'codex', baseCwd: root, participantName: 'wide-lead' })).participant
const laneCount = Math.min(100, TASKS + 20)
const legacyQueue = []
for (let i = 0; i < laneCount; i++) {
  const { task } = await coord.createExternalProtocolTask(wideLead, {
    title: `Lane ${i}: ${'independent implementation and verification scope '.repeat(4)}`.slice(0, 160),
    detail: 'This lane is immediately runnable and independent.',
    targetRole: 'any',
  })
  legacyQueue.push({ id: task!.id, title: task!.title, targetRole: task!.targetRole })
}
const wide = await time('read actionable wide runnable queue', () => coord.readExternalProtocolActionableStatus(wideLead))
assert.equal(wide.actionable.claimableTaskCount, laneCount)
assert.deepEqual(wide.actionable.claimableTasks.map(task => task.id), legacyQueue.slice(0, 12).map(task => task.id))
assert.ok(wide.actionable.claimableTasks.every(task => task.title.length <= 120))
console.log(`Claimable queue characters (${laneCount} runnable lanes): unbounded=${JSON.stringify(legacyQueue).length}, preview=${JSON.stringify(wide.actionable.claimableTasks).length}`)
assert.equal((await coord.claimExternalProtocolTask(wideLead, legacyQueue.at(-1)!.id)).task.id, legacyQueue.at(-1)!.id)
process.exit(0)
