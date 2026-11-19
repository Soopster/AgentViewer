// Targeted coord_wait — herdr's `agent wait <name> --until <state>`. An
// unfiltered wait wakes on every heartbeat and mailbox write in the run, so a
// lead waiting on one teammate spent a turn per unrelated change. Each rule
// here fails silently in one direction: a filter that swallows mail deadlocks a
// teammate waiting on the lead; one that ignores the current state sits out the
// whole timeout for something already true.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'coord-wait-'))
process.chdir(root)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')

const created = await coord.createExternalProtocolRun({ prompt: 'Targeted wait fixture', provider: 'codex', baseCwd: root, participantName: 'lead' })
const lead = created.participant
const nova = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: 'nova' })).participant
const orion = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: root, participantName: 'orion' })).participant
const task = await coord.createExternalProtocolTask(lead, { title: 'Work', detail: 'Do the work', assignTo: nova.agentId })
const start = (await coord.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor ?? undefined
const elapsed = async <T>(work: Promise<T>) => { const t0 = Date.now(); const value = await work; return { value, ms: Date.now() - t0 } }

// Already in the named state: returns at once rather than sitting out the timeout.
{
  const ready = await elapsed(coord.waitForExternalProtocolChange(lead, { cursor: start, timeoutMs: 5_000, agent: 'orion', until: ['ready', 'idle'] }))
  assert.equal(ready.value.changed, true)
  assert.ok(ready.ms < 1_500, `a state that already holds must not wait: ${ready.ms}ms`)
}

// Unrelated activity does not wake a targeted wait; the named state does.
{
  await coord.reportExternalProtocolProgress(nova, { status: 'working', taskId: task.task!.id, summary: 'Starting' })
  const cursor = (await coord.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor ?? undefined
  const waiting = elapsed(coord.waitForExternalProtocolChange(lead, { cursor, timeoutMs: 8_000, agent: 'nova', until: ['blocked'] }))
  // Noise the unfiltered wait would have woken on: another teammate's
  // heartbeats and nova's own progress while it is still working.
  for (let index = 0; index < 3; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 300))
    await coord.reportExternalProtocolProgress(orion, { status: 'heartbeat', summary: `orion tick ${index}` })
    await coord.reportExternalProtocolProgress(nova, { status: 'heartbeat', taskId: task.task!.id, summary: `nova tick ${index}` })
  }
  await coord.reportExternalProtocolProgress(nova, { status: 'blocked', taskId: task.task!.id, summary: 'Need a decision' })
  const outcome = await waiting
  assert.equal(outcome.value.changed, true, 'the named state wakes the wait')
  assert.ok(outcome.ms >= 900, `heartbeats and progress must not wake a targeted wait: returned after ${outcome.ms}ms`)
  assert.equal(outcome.value.snapshot.agents.find(agent => agent.id === nova.agentId)?.status, 'blocked')
}

// Mail that needs the waiter's reply is never swallowed by the filter.
{
  const cursor = (await coord.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor ?? undefined
  const waiting = elapsed(coord.waitForExternalProtocolChange(lead, { cursor, timeoutMs: 8_000, agent: 'orion', until: ['done'] }))
  await new Promise(resolve => setTimeout(resolve, 300))
  await coord.sendExternalProtocolMessage(orion, { to: 'lead', body: 'Which parser?', replyRequired: true })
  const outcome = await waiting
  assert.equal(outcome.value.changed, true, 'a reply-required message wakes a targeted wait')
  assert.ok(outcome.ms < 4_000, `mail must not wait for the target state: ${outcome.ms}ms`)
}

// A question that was ALREADY waiting is the caller's to handle. Counting it
// turned every later filtered wait into a busy loop: any heartbeat woke it.
{
  const cursor = (await coord.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor ?? undefined
  const waiting = elapsed(coord.waitForExternalProtocolChange(lead, { cursor, timeoutMs: 1_500, agent: 'nova', until: ['done'] }))
  await new Promise(resolve => setTimeout(resolve, 200))
  // A real event (heartbeats are not changes at all): mail between two teammates.
  await coord.sendExternalProtocolMessage(orion, { to: 'nova', body: 'noise while an old question is open' })
  const outcome = await waiting
  assert.equal(outcome.value.changed, false, 'an old unanswered question must not wake a filtered wait on unrelated noise')
}

// Bad requests are refused rather than waited out.
await assert.rejects(coord.waitForExternalProtocolChange(lead, { agent: 'ghost', timeoutMs: 100 }), /not found/)
await assert.rejects(coord.waitForExternalProtocolChange(lead, { agent: 'nova', until: ['sleeping'], timeoutMs: 100 }), /Unknown teammate state/)
await assert.rejects(coord.waitForExternalProtocolChange(lead, { agent: 'lead', timeoutMs: 100 }), /cannot wait on itself/)

// The unfiltered wait is unchanged: any change wakes it.
{
  const cursor = (await coord.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor ?? undefined
  const waiting = elapsed(coord.waitForExternalProtocolChange(lead, { cursor, timeoutMs: 8_000 }))
  await new Promise(resolve => setTimeout(resolve, 200))
  await coord.reportExternalProtocolProgress(orion, { status: 'heartbeat', summary: 'plain change' })
  const outcome = await waiting
  assert.ok(outcome.ms < 4_000, `an unfiltered wait still wakes on any change: ${outcome.ms}ms`)
}

console.log('Targeted coord_wait: current state returns at once, noise ignored, named state wakes, reply mail wakes, bad targets refused, unfiltered wait unchanged')
process.exit(0)
