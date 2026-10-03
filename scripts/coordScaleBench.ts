// How the Coordinator's hot reads and writes behave on a long, wide run.
//   bun run scripts/coordScaleBench.ts            (TASKS=300 EVENTS=6000 by default)
// Reports ms per call, so a read that grows with run size shows as a number.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TASKS = Number(process.env.TASKS) || 300
const EVENTS = Number(process.env.EVENTS) || 6000
const root = mkdtempSync(path.join(tmpdir(), 'coord-scale-'))
process.chdir(root)
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
await time('readExternalProtocolStatus (worker)', () => coord.readExternalProtocolStatus(workers[0]!))
await time('listProtocolRuns', () => coord.listProtocolRuns(20))
await time('createExternalProtocolTask (one more)', () => coord.createExternalProtocolTask(lead, { title: 'late', detail: 'late', paths: ['x.ts'] }), 3)
await time('readSessionCoordinator-style attention', () => coord.readProtocolRun(lead.runId), 3)
const snap = (await coord.readProtocolRun(lead.runId))!
console.log(`snapshot json: ${(JSON.stringify(snap).length / 1024).toFixed(0)}KB  tasks ${snap.tasks.length}/${TASKS}  events ${snap.events.length}`)
process.exit(0)
