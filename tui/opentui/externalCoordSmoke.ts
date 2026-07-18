import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const testCwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-external-coord-'))
process.chdir(testCwd)
execFileSync('git', ['init', '-q'], { cwd: testCwd })
execFileSync('git', ['config', 'user.email', 'coord-smoke@example.test'], { cwd: testCwd })
execFileSync('git', ['config', 'user.name', 'Coordinator Smoke'], { cwd: testCwd })
writeFileSync(path.join(testCwd, 'README.md'), 'baseline\n')
writeFileSync(path.join(testCwd, '.gitignore'), '.agent-viewer-data/\n')
execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: testCwd })
execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: testCwd })
writeFileSync(path.join(testCwd, 'README.md'), 'pre-existing dirty change\n')

const coordination = await import('../../lib/agentCoordination')

const leadResult = await coordination.createExternalProtocolRun({
  prompt: 'Let two external CLIs collaborate over MCP',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Codex lead',
  maxAgents: 2,
  requirePlanApproval: true,
})
const lead = leadResult.participant
assert.equal(lead.role, 'lead')
assert.equal(lead.provider, 'codex')
assert.ok(lead.token.length >= 32)

const teammateResult = await coordination.joinExternalProtocolRun({
  runId: lead.runId,
  provider: 'claude',
  cwd: testCwd,
  participantName: 'Claude teammate',
})
const teammate = teammateResult.participant
assert.equal(teammate.role, 'teammate')
assert.equal(teammate.provider, 'claude')
assert.notEqual(teammate.token, lead.token)

await assert.rejects(
  coordination.joinExternalProtocolRun({
    runId: lead.runId,
    provider: 'copilot',
    cwd: testCwd,
    participantName: 'Extra participant',
  }),
  /participant limit/,
)

await assert.rejects(
  coordination.readExternalProtocolRun({ ...teammate, token: 'invalid-token' }),
  /Invalid Coordinator participant capability/,
)

const taskSnapshot = await coordination.createExternalProtocolTask(lead, {
  title: 'Implement the shared change',
  detail: 'Claim the task, publish a plan, and complete it.',
  paths: ['owned.txt'],
})
const task = taskSnapshot.tasks.at(-1)
assert.ok(task)

const claim = await coordination.claimExternalProtocolTask(teammate, task.id)
assert.equal(claim.task.ownerAgentId, teammate.agentId)

// Claim failures explain themselves.
await assert.rejects(
  coordination.claimExternalProtocolTask(lead, task.id),
  /already owned/,
)

const initialWait = await coordination.waitForExternalProtocolChange(teammate, { timeoutMs: 0 })
assert.ok(initialWait.cursor)

const sendPlanRequest = () => coordination.sendExternalProtocolMessage(lead, {
  to: teammate.agentId,
  body: 'Please send a plan before completing the task.',
})
await coordination.runExternalProtocolIdempotent(lead, 'send_message', 'plan-request-1', sendPlanRequest)
await coordination.runExternalProtocolIdempotent(lead, 'send_message', 'plan-request-1', sendPlanRequest)
const changedWait = await coordination.waitForExternalProtocolChange(teammate, {
  cursor: initialWait.cursor ?? undefined,
  timeoutMs: 100,
})
assert.equal(changedWait.changed, true)
assert.equal(changedWait.inbox.messages.length, 1)
assert.equal(changedWait.actionable.inboxCount, 1)
// Direct-message bodies ride the inbox, not the shared event feed, so a
// message-only wake can legitimately return no events.
assert.ok(Array.isArray(changedWait.events))
const inbox = await coordination.readExternalProtocolInbox(teammate)
assert.equal(inbox.messages.length, 1)
assert.match(inbox.messages[0].body, /send a plan/)
assert.equal((await coordination.readExternalProtocolInbox(teammate)).messages.length, 0)

// A participant's own writes never wake its own wait.
const idleWait = await coordination.waitForExternalProtocolChange(teammate, { timeoutMs: 0 })
await coordination.reportExternalProtocolProgress(teammate, {
  status: 'working',
  taskId: task.id,
  summary: 'Starting on the claimed task',
})
const selfWait = await coordination.waitForExternalProtocolChange(teammate, {
  cursor: idleWait.cursor ?? undefined,
  timeoutMs: 150,
})
assert.equal(selfWait.changed, false)
assert.equal(selfWait.actionable.myTask?.id, task.id)

// Rejected completions are not replayed from the idempotency cache.
const rejected = await coordination.runExternalProtocolIdempotent(
  teammate,
  'complete_task',
  'complete-task-1',
  () => coordination.completeExternalProtocolTask(teammate, {
    taskId: task.id,
    summary: 'Premature completion',
  }),
)
assert.equal(rejected.accepted, false)
assert.match(rejected.reason ?? '', /plan approval/)

await coordination.submitExternalProtocolPlan(teammate, {
  taskId: task.id,
  summary: 'Make the change and verify it.',
})
await coordination.reviewExternalProtocolPlan(lead, {
  taskId: task.id,
  approved: true,
  summary: 'Plan approved',
})
await coordination.reportExternalProtocolProgress(teammate, {
  status: 'working',
  taskId: task.id,
  summary: 'Implementing the approved plan',
})

// Lock results are explicit: the holder re-requests and is granted; a
// conflicting participant is denied with the holder named.
const ownLocks = await coordination.requestExternalProtocolLocks(teammate, ['owned.txt'])
assert.equal(ownLocks.granted.length, 1)
assert.equal(ownLocks.denied.length, 0)
const conflictedLocks = await coordination.requestExternalProtocolLocks(lead, ['owned.txt'])
assert.equal(conflictedLocks.granted.length, 0)
assert.equal(conflictedLocks.denied.length, 1)
assert.match(conflictedLocks.denied[0].reason, new RegExp(teammate.agentId))

writeFileSync(path.join(testCwd, 'owned.txt'), 'participant change\n')

// Any participant may add discovered work while the run is live — and the
// new claimable task wakes waiting participants with the event and digest.
const leadCursor = (await coordination.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor
const discovery = await coordination.createExternalProtocolTask(teammate, {
  title: 'Follow-up discovered by teammate',
  detail: 'Write second.txt with the follow-up change.',
  paths: ['second.txt'],
})
assert.equal(discovery.tasks.length, 2)
const followUp = discovery.tasks.at(-1)!
const leadWake = await coordination.waitForExternalProtocolChange(lead, {
  cursor: leadCursor ?? undefined,
  timeoutMs: 1_000,
})
assert.equal(leadWake.changed, true)
assert.ok(leadWake.events.some((event) => event.type === 'task.created'))
assert.ok(leadWake.actionable.claimableTasks.some((entry) => entry.id === followUp.id))

// The retried completion re-runs the gates instead of replaying the cached
// rejection, and the still-open follow-up task keeps the run out of synthesis.
const completed = await coordination.runExternalProtocolIdempotent(
  teammate,
  'complete_task',
  'complete-task-1',
  () => coordination.completeExternalProtocolTask(teammate, {
    taskId: task.id,
    summary: 'Implemented and verified the shared change.',
  }),
)
assert.equal(completed.accepted, true)
assert.equal(completed.snapshot.run.status, 'running')

// Claimed work can be handed back: the task requeues and its locks release.
const leadClaim = await coordination.claimExternalProtocolTask(lead, followUp.id)
assert.equal(leadClaim.task.ownerAgentId, lead.agentId)
const released = await coordination.releaseExternalProtocolTask(lead, {
  taskId: followUp.id,
  reason: 'Handing back to the implementation teammate',
})
assert.equal(released.task.status, 'pending')
assert.equal(released.task.ownerAgentId, undefined)

const reclaimed = await coordination.claimExternalProtocolTask(teammate, followUp.id)
assert.equal(reclaimed.task.ownerAgentId, teammate.agentId)
await coordination.submitExternalProtocolPlan(teammate, {
  taskId: followUp.id,
  summary: 'Write second.txt.',
})
await coordination.reviewExternalProtocolPlan(lead, { taskId: followUp.id, approved: true })
writeFileSync(path.join(testCwd, 'second.txt'), 'follow-up change\n')
const followUpDone = await coordination.completeExternalProtocolTask(teammate, {
  taskId: followUp.id,
  summary: 'Follow-up implemented.',
})
assert.equal(followUpDone.accepted, true)
assert.equal(followUpDone.snapshot.run.status, 'synthesizing')

const leadInbox = await coordination.readExternalProtocolInbox(lead)
assert.match(leadInbox.messages.at(-1)?.body ?? '', /coord_finalize_run/)

// The lead reopens a synthesizing run by adding post-review work.
const reopened = await coordination.createExternalProtocolTask(lead, {
  title: 'Post-review fix',
  detail: 'Follow-up identified during synthesis review.',
})
assert.equal(reopened.run.status, 'running')
const reopenedTask = reopened.tasks.at(-1)!

// A failed task frees its locks and leaves an external participant available.
await coordination.claimExternalProtocolTask(lead, reopenedTask.id)
await coordination.failExternalProtocolTask(lead, {
  taskId: reopenedTask.id,
  summary: 'Not needed after review',
})
const leadStatus = await coordination.readExternalProtocolStatus(lead)
const leadAgent = leadStatus.snapshot.agents.find((agent) => agent.id === lead.agentId)
assert.equal(leadAgent?.status, 'idle')
assert.equal(leadAgent?.taskId, undefined)
assert.equal(leadStatus.actionable.runStatus, 'synthesizing')
assert.equal(leadStatus.actionable.allTasksTerminal, true)
assert.ok(leadStatus.actionable.inboxCount >= 1)

const finalSnapshot = await coordination.finalizeExternalProtocolRun(
  lead,
  'Codex and Claude completed the task through the external MCP protocol.',
)
assert.equal(finalSnapshot.run.status, 'completed')
assert.match(finalSnapshot.run.summary ?? '', /external MCP protocol/)
assert.ok(finalSnapshot.events.some((event) => event.type === 'run.status'))

console.log('External Coordinator smoke passed')
