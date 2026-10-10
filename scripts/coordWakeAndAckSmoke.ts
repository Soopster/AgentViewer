// Two autonomy defects a teammate or lead hits without any visible error:
// coord_read_inbox results must say what they acknowledged, so a lost response
// is reconcilable; and an unfiltered coord_wait woke on per-turn usage telemetry
// that moved no work, burning a turn per wake.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-wake-ack-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Wake and ack', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
try {
  const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant
  const readInbox = (extra: Record<string, unknown> = {}) => execute({ ...worker, action: 'read_inbox', ...extra }) as Promise<{ messages: unknown[] }>

  // A read acknowledges what it returns and reports the ids, so a response lost
  // in transit can be reconciled; a read that does not acknowledge leaves mail unread.
  await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: 'Use the strict parser' })
  const first = await readInbox() as { messages: Array<{ id: string }>; acknowledged: string[] }
  assert.equal(first.messages.length, 1, 'first read returns the mail')
  assert.deepEqual(first.acknowledged, [first.messages[0]!.id], 'the result reports the acknowledged id')
  assert.equal((await readInbox()).messages.length, 0, 'acknowledged mail is not redelivered')
  await coord.sendExternalProtocolMessage(lead, { to: 'worker', body: 'Also the parser tests' })
  assert.equal((await readInbox({ acknowledge: false })).messages.length, 1, 'a non-acknowledging read returns the mail')
  assert.equal((await readInbox({ acknowledge: false })).messages.length, 1, 'a non-acknowledging read keeps the mail unread')
  assert.equal((await readInbox()).messages.length, 1, 'the later acknowledging read still returns it')

  // Per-turn usage telemetry is not work: it must not wake an unfiltered wait.
  const cursor = (await coord.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor ?? undefined
  // Production wait timers are deliberately unref'd. This standalone fixture
  // owns its process lifetime until the assertion settles, including failures.
  const keepAlive = setInterval(() => {}, 1_000)
  try {
    const waiting = coord.waitForExternalProtocolChange(lead, { cursor, timeoutMs: 1_500 })
    await new Promise(resolve => setTimeout(resolve, 200))
    await coord.recordProtocolEvent({
      version: '1.0', runId: lead.runId, agentId: worker.agentId, type: 'usage.observed',
      summary: 'Claude SDK usage observed: 10 tokens, $0.0001', payload: {},
    })
    const outcome = await waiting
    assert.equal(outcome.changed, false, 'usage telemetry alone does not wake an unfiltered wait')
    assert.equal(outcome.timedOut, true)
  } finally {
    clearInterval(keepAlive)
  }
  console.log('Wake and ack: unacknowledged reads keep mail, acknowledged reads consume it, usage telemetry does not wake an unfiltered wait')
} finally {
  await coord.stopProtocolRun(lead.runId)
}
