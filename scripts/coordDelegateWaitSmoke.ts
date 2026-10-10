// coord_delegate with wait_ms — herdr's `agent prompt reviewer "…" --wait`.
// Every outcome here is one a lead acts on differently, and two are traps:
// an idle teammate that has not started must read as `stalled`, never as done
// (herdr's activity gate), and a stall must leave the already-queued work alone.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'coord-delegate-wait-'))
process.chdir(root)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction } = await import('../lib/agentCoordinationExternal')
const { COORDINATOR_START_STALL_MS } = await import('../lib/coordinatorInteractiveState')

const created = await coord.createExternalProtocolRun({ prompt: 'Delegate-wait fixture', provider: 'codex', baseCwd: root, participantName: 'lead', maxAgents: 8 })
const lead = created.participant
const join = async (name: string) => (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: name })).participant
const workers = { nova: await join('nova'), orion: await join('orion'), lyra: await join('lyra'), vega: await join('vega') }
const delegateAndWait = (to: string, title: string, waitMs: number) => executeExternalCoordinatorAction({
  action: 'create_task', ...lead, assignTo: to, title, detail: `${title} in detail`, waitMs, requestId: `wait-${title}`,
} as never) as Promise<{ task: { id: string }; settled?: { outcome: string; taskStatus: string; summary?: string } }>
const later = (ms: number, work: () => Promise<unknown>) => setTimeout(() => { void work() }, ms)
const taskOf = async (name: keyof typeof workers) => (await coord.readExternalProtocolRun(lead)).tasks.find(task => task.ownerAgentId === workers[name].agentId)!

// Completed: the teammate starts, finishes, and the call returns its result.
later(300, async () => {
  const task = await taskOf('nova')
  await coord.reportExternalProtocolProgress(workers.nova, { status: 'working', taskId: task.id, summary: 'On it' })
  await coord.completeExternalProtocolTask(workers.nova, { taskId: task.id, summary: 'PARSNIP' })
})
const done = await delegateAndWait(workers.nova.agentId, 'Report the word', 10_000)
assert.equal(done.settled?.outcome, 'completed')
assert.equal(done.settled?.summary, 'PARSNIP', 'the result travels back with the wait')

// Blocked: work that stops on the lead returns, rather than waiting it out.
later(300, async () => {
  const task = await taskOf('orion')
  await coord.reportExternalProtocolProgress(workers.orion, { status: 'working', taskId: task.id, summary: 'Reading' })
  await coord.reportExternalProtocolProgress(workers.orion, { status: 'blocked', taskId: task.id, summary: 'Which branch?' })
})
assert.equal((await delegateAndWait(workers.orion.agentId, 'Needs a decision', 10_000)).settled?.outcome, 'blocked')

// Reply-required mail ends the wait even while the task is still running.
later(300, async () => {
  const task = await taskOf('lyra')
  await coord.reportExternalProtocolProgress(workers.lyra, { status: 'working', taskId: task.id, summary: 'Working' })
  await coord.sendExternalProtocolMessage(workers.lyra, { to: 'lead', body: 'Quick question', replyRequired: true })
})
assert.equal((await delegateAndWait(workers.lyra.agentId, 'Asks mid-task', 10_000)).settled?.outcome, 'needs_reply')

// Stalled: nobody picks the work up. Herdr's gate — an idle teammate that
// never started is not "done" — and the queued task is left exactly as it was.
const t0 = Date.now()
const stalled = await delegateAndWait(workers.vega.agentId, 'Never started', COORDINATOR_START_STALL_MS + 20_000)
assert.equal(stalled.settled?.outcome, 'stalled', 'no observed activity is a stall, not a completion')
assert.ok(Date.now() - t0 >= COORDINATOR_START_STALL_MS - 500 && Date.now() - t0 < COORDINATOR_START_STALL_MS + 5_000,
  `the gate is the start window, not the caller's timeout: ${Date.now() - t0}ms`)
assert.equal(stalled.settled?.taskStatus, 'claimed', 'a stall leaves the queued task alone for inspection')

// Timeout: activity was seen, but the work did not settle in time.
{
  const orion2 = await join('rhea')
  later(200, async () => {
    const task = (await coord.readExternalProtocolRun(lead)).tasks.find(entry => entry.ownerAgentId === orion2.agentId)!
    await coord.reportExternalProtocolProgress(orion2, { status: 'working', taskId: task.id, summary: 'Long job' })
  })
  assert.equal((await delegateAndWait(orion2.agentId, 'Long job', 1_500)).settled?.outcome, 'timeout')
}

// Without wait_ms nothing changes: the call returns queued work at once.
const quick = await executeExternalCoordinatorAction({ action: 'create_task', ...lead, assignTo: (await join('iris')).agentId, title: 'Plain', detail: 'Plain delegation', requestId: 'plain' } as never) as { settled?: unknown }
assert.equal(quick.settled, undefined, 'a delegation without wait_ms does not wait')

console.log('Delegate and wait: completed with result, blocked, needs_reply, stalled at the start window with work untouched, timeout, and no wait by default')
process.exit(0)
