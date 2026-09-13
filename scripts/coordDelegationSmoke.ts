import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-delegation-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'baseline\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: act } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Interactive delegation', baseCwd: cwd, provider: 'codex', participantName: 'lead', maxAgents: 3 })).participant
const reviewer = (await coord.joinExternalProtocolRun({ runId: lead.runId, cwd, provider: 'codex', participantName: 'reviewer' })).participant
const other = (await coord.joinExternalProtocolRun({ runId: lead.runId, cwd, provider: 'codex', participantName: 'other' })).participant
const status = () => coord.readExternalProtocolStatus(lead)

try {
  writeFileSync('README.md', 'pre-existing user edit\n')
  const request = { ...lead, action: 'create_task', title: 'Review change', detail: 'Read and report findings without editing.', assignTo: 'reviewer', paths: ['README.md'], requestId: 'review-first' }
  const first = await act(request) as any
  assert.equal(first.task.ownerAgentId, reviewer.agentId)
  assert.equal(first.delegation.delivery, 'queued')
  assert.equal(JSON.stringify(await act(request)), JSON.stringify(first), 'same-key replay must not repeat assignment or mailbox delivery')
  const inbox = await coord.readExternalProtocolInbox(reviewer, { acknowledge: false })
  assert.equal(inbox.messages.filter(message => message.body.includes(`Delegated ${first.task.id}:`)).length, 1)
  await assert.rejects(act({ ...lead, action: 'create_task', title: 'Busy', detail: 'Must not create a task', assignTo: 'reviewer' }), /busy or unavailable/)
  await assert.rejects(act({ ...lead, action: 'create_task', title: 'Conflicting', detail: 'Must roll back', assignTo: 'other', paths: ['README.md'] }), /lock|path|conflict/i)
  await assert.rejects(act({ ...other, action: 'create_task', title: 'Unauthorized', detail: 'Must not delegate', assignTo: 'reviewer' }), /Only the Coordinator lead/)
  assert.equal((await status()).snapshot.tasks.length, 1, 'rejected assignments must not leave orphan tasks')
  await coord.reportExternalProtocolProgress(reviewer, { status: 'working', taskId: first.task.id })
  const completed = await coord.completeExternalProtocolTask(reviewer, { taskId: first.task.id, summary: 'Reviewed; no edit required.' })
  assert.equal(completed.accepted, true, 'delegation baseline must preserve pre-existing dirty work')
  const followup = await act({ ...lead, action: 'create_task', title: 'Review revision', detail: `Follow up on ${first.task.id}; reuse your findings.`, assignTo: reviewer.agentId }) as any
  assert.equal(followup.task.ownerAgentId, reviewer.agentId)
  assert.notEqual(followup.task.id, first.task.id)
  assert.equal((await status()).snapshot.agents.length, 3, 'follow-up must reuse the existing teammate')
  await coord.reportExternalProtocolProgress(reviewer, { status: 'working', taskId: followup.task.id })
  assert.equal((await coord.completeExternalProtocolTask(reviewer, { taskId: followup.task.id, summary: 'Revision reviewed.' })).accepted, true)
  await coord.finalizeExternalProtocolRun(lead, 'Both reviews completed by the same teammate.')
  assert.equal((await status()).snapshot.run.status, 'completed')
  console.log('Coordinator delegation, rollback, replay, baseline, follow-up, and finalization smoke passed')
} finally {
  await coord.stopProtocolRun(lead.runId)
}
