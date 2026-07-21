import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// Seed the two tables changed by schema v8 in their v7 shape. Opening the
// Coordinator must migrate real pre-existing rows, not only pass on a fresh DB.
const coordinationDir = path.join(testCwd, '.agent-viewer-data', 'agent-coordination')
mkdirSync(coordinationDir, { recursive: true })
const { Database } = await (0, eval)('import("bun:sqlite")') as {
  Database: new (file: string) => {
    exec(sql: string): void
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | null
      run(...params: unknown[]): unknown
    }
    close(): void
  }
}
const legacyDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
legacyDb.exec(`
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta (key, value) VALUES ('schema_version', '7');
  CREATE TABLE protocol_runs (
    id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
    base_cwd TEXT NOT NULL, max_agents INTEGER NOT NULL, lead_agent_id TEXT, summary TEXT,
    gate_command TEXT, require_plan_approval INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE protocol_agents (
    id TEXT NOT NULL, run_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'teammate',
    provider TEXT NOT NULL, session_id TEXT NOT NULL, worktree_path TEXT NOT NULL, worktree_branch TEXT NOT NULL,
    task_id TEXT, status TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, id)
  );
  CREATE TABLE protocol_messages (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, from_agent_id TEXT NOT NULL, to_agent_id TEXT NOT NULL,
    body TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT
  );
`)
legacyDb.close()

const coordination = await import('../../lib/agentCoordination')
const sessionRuntime = await import('../../lib/sessionRuntime')

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
assert.equal(lead.serverProtocolVersion, 2)
assert.equal(lead.negotiatedProtocolVersion, 1)
assert.deepEqual(lead.capabilities, {})

await assert.rejects(
  coordination.createExternalProtocolRun({
    prompt: 'Reject a client newer than the server',
    provider: 'codex',
    baseCwd: testCwd,
    participantName: 'Future client',
    client: { name: 'future-cli', protocolVersion: 3 },
  }),
  /newer than server protocol 2/,
)

const teammateResult = await coordination.joinExternalProtocolRun({
  runId: lead.runId,
  provider: 'claude',
  cwd: testCwd,
  participantName: 'Claude teammate',
  client: { name: 'claude-mcp', version: '1.3.0', protocolVersion: 2 },
  capabilities: { unattended: true, filesystemWrite: true, tools: ['coord_*', 'coord_*'] },
})
const teammate = teammateResult.participant
assert.equal(teammate.role, 'teammate')
assert.equal(teammate.provider, 'claude')
assert.notEqual(teammate.token, lead.token)
assert.equal(teammate.negotiatedProtocolVersion, 2)
assert.deepEqual(teammate.capabilities.tools, ['coord_*'])
const resumedTeammate = await coordination.resumeExternalProtocolParticipant(teammate, {
  client: { name: 'claude-mcp', version: '1.3.1', protocolVersion: 2 },
  capabilities: { unattended: true, sessionResume: true, tools: ['coord_*'] },
})
assert.equal(resumedTeammate.participant.negotiatedProtocolVersion, 2)
assert.equal(resumedTeammate.snapshot.agents.find((agent) => agent.id === teammate.agentId)?.client?.version, '1.3.1')

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

const createResult = await coordination.createExternalProtocolTask(lead, {
  title: 'Implement the shared change',
  detail: 'Claim the task, publish a plan, and complete it.',
  paths: ['owned.txt'],
})
const task = createResult.task
assert.ok(task)
// Mutations return the compact result, not the board.
assert.equal(createResult.runStatus, 'running')
assert.ok(createResult.actionable.claimableTasks.some((entry) => entry.id === task.id))
assert.ok(!('snapshot' in createResult))

const claim = await coordination.claimExternalProtocolTask(teammate, task.id)
assert.equal(claim.task.ownerAgentId, teammate.agentId)

// Claim failures explain themselves.
await assert.rejects(
  coordination.claimExternalProtocolTask(lead, task.id),
  /already owned/,
)

// Reporting blocked is sufficient to wake the lead even if the model omits a
// separate message event. The lead's guidance then wakes the blocked teammate,
// which can resume its owned task without waiting for an idle sweep.
const leadBeforeBlock = await coordination.waitForExternalProtocolChange(lead, { timeoutMs: 0 })
await coordination.reportExternalProtocolProgress(teammate, {
  status: 'blocked',
  taskId: task.id,
  summary: 'Need the lead to choose the safe implementation direction.',
})
const leadBlockWake = await coordination.waitForExternalProtocolChange(lead, {
  cursor: leadBeforeBlock.cursor ?? undefined,
  timeoutMs: 100,
})
assert.equal(leadBlockWake.changed, true)
assert.equal(leadBlockWake.actionable.inboxCount, 1)
assert.equal(leadBlockWake.actionable.urgentCount, 1)
const blockerInbox = await coordination.readExternalProtocolInbox(lead)
assert.equal(blockerInbox.messages.length, 1)
assert.match(blockerInbox.messages[0].body, /task-1 is blocked/)
assert.match(blockerInbox.messages[0].body, /safe implementation direction/)
const teammateBeforeGuidance = await coordination.waitForExternalProtocolChange(teammate, { timeoutMs: 0 })
await coordination.sendExternalProtocolMessage(lead, {
  to: teammate.agentId,
  body: 'Use the narrow implementation path and continue.',
  kind: 'response',
  priority: 'urgent',
})
const teammateGuidanceWake = await coordination.waitForExternalProtocolChange(teammate, {
  cursor: teammateBeforeGuidance.cursor ?? undefined,
  timeoutMs: 100,
})
assert.equal(teammateGuidanceWake.changed, true)
assert.equal(teammateGuidanceWake.actionable.myTask?.status, 'blocked')
assert.equal(teammateGuidanceWake.actionable.inboxCount, 1)
const guidanceInbox = await coordination.readExternalProtocolInbox(teammate)
assert.match(guidanceInbox.messages[0].body, /narrow implementation path/)
await coordination.reportExternalProtocolProgress(teammate, {
  status: 'working',
  taskId: task.id,
  summary: 'Unblocked by lead guidance; resuming work.',
})
assert.equal((await coordination.readExternalProtocolStatus(teammate)).actionable.myTask?.status, 'in_progress')

const initialWait = await coordination.waitForExternalProtocolChange(teammate, { timeoutMs: 0 })
assert.ok(initialWait.cursor)

const sendPlanRequest = () => coordination.sendExternalProtocolMessage(lead, {
  to: teammate.agentId,
  body: 'Please send a plan before completing the task.',
  kind: 'request',
  priority: 'urgent',
  replyRequired: true,
  correlationId: 'plan-approval',
})
await Promise.all([
  coordination.runExternalProtocolIdempotent(lead, 'send_message', 'plan-request-1', sendPlanRequest),
  coordination.runExternalProtocolIdempotent(lead, 'send_message', 'plan-request-1', sendPlanRequest),
])
const changedWait = await coordination.waitForExternalProtocolChange(teammate, {
  cursor: initialWait.cursor ?? undefined,
  timeoutMs: 100,
})
assert.equal(changedWait.changed, true)
assert.equal(changedWait.inbox.messages.length, 1)
assert.equal(changedWait.actionable.inboxCount, 1)
assert.equal(changedWait.actionable.urgentCount, 1)
assert.equal(changedWait.actionable.replyRequiredCount, 1)
// Direct-message bodies ride the inbox, not the shared event feed, so a
// message-only wake can legitimately return no events.
assert.ok(Array.isArray(changedWait.events))
const inbox = await coordination.readExternalProtocolInbox(teammate)
assert.equal(inbox.messages.length, 1)
assert.match(inbox.messages[0].body, /send a plan/)
assert.equal(inbox.messages[0].kind, 'request')
assert.equal(inbox.messages[0].priority, 'urgent')
assert.equal(inbox.messages[0].replyRequired, true)
assert.equal(inbox.messages[0].correlationId, 'plan-approval')
assert.equal((await coordination.readExternalProtocolInbox(teammate)).messages.length, 0)
await coordination.sendExternalProtocolMessage(teammate, {
  to: lead.agentId,
  body: 'Plan acknowledged.',
  kind: 'response',
  inReplyTo: inbox.messages[0].id,
})
assert.equal((await coordination.readExternalProtocolStatus(teammate)).actionable.replyRequiredCount, 0)
const responseInbox = await coordination.readExternalProtocolInbox(lead)
assert.equal(responseInbox.messages[0].kind, 'response')
assert.equal(responseInbox.messages[0].inReplyTo, inbox.messages[0].id)
assert.equal(responseInbox.messages[0].correlationId, 'plan-approval')

for (let index = 1; index <= 3; index += 1) {
  await coordination.sendExternalProtocolMessage(lead, {
    to: teammate.agentId,
    body: `Progress ${index}/3`,
    kind: 'status',
    priority: 'status',
    correlationId: 'progress-batch',
  })
}
const batchedStatus = await coordination.readExternalProtocolStatus(teammate)
assert.equal(batchedStatus.actionable.statusCount, 3)
assert.equal(batchedStatus.actionable.inboxCount, 1)
const statusInbox = await coordination.readExternalProtocolInbox(teammate)
assert.equal(statusInbox.messages.length, 1)
assert.equal(statusInbox.messages[0].kind, 'status_summary')
assert.equal(statusInbox.messages[0].batchedMessageIds?.length, 3)
assert.match(statusInbox.messages[0].body, /3 status updates/)

// A burst larger than the 100-event wait page must be drained over multiple
// calls without advancing the first response cursor past unseen events.
const burstStart = await coordination.waitForExternalProtocolChange(teammate, { timeoutMs: 0 })
for (let index = 0; index < 105; index += 1) {
  await coordination.reportExternalProtocolProgress(lead, {
    status: 'ready',
    summary: `burst event ${index}`,
  })
}
const burstPageOne = await coordination.waitForExternalProtocolChange(teammate, {
  cursor: burstStart.cursor ?? undefined,
  timeoutMs: 0,
})
assert.equal(burstPageOne.events.length, 100)
const burstPageTwo = await coordination.waitForExternalProtocolChange(teammate, {
  cursor: burstPageOne.cursor ?? undefined,
  timeoutMs: 0,
})
assert.equal(burstPageTwo.changed, true)
assert.equal(burstPageTwo.events.length, 5)

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
const lockEventCursor = (await coordination.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor
const renewedOwnLocks = await coordination.requestExternalProtocolLocks(teammate, ['owned.txt'])
assert.equal(renewedOwnLocks.granted[0]?.lockId, ownLocks.granted[0]?.lockId)
const lockSnapshot = await coordination.readExternalProtocolRun(teammate)
assert.equal(lockSnapshot.locks.filter((lock) => lock.agentId === teammate.agentId
  && lock.taskId === task.id
  && lock.path === 'owned.txt'
  && lock.status === 'active').length, 1)
const renewalWake = await coordination.waitForExternalProtocolChange(lead, {
  cursor: lockEventCursor ?? undefined,
  timeoutMs: 0,
})
assert.equal(renewalWake.changed, false)
const conflictedLocks = await coordination.requestExternalProtocolLocks(lead, ['owned.txt'])
assert.equal(conflictedLocks.granted.length, 0)
assert.equal(conflictedLocks.denied.length, 1)
assert.match(conflictedLocks.denied[0].reason, new RegExp(teammate.agentId))
for (let index = 0; index < 205; index += 1) {
  await coordination.requestExternalProtocolLocks(lead, ['owned.txt'])
}
const boundedLockSnapshot = await coordination.readExternalProtocolRun(lead)
assert.equal(boundedLockSnapshot.locks.filter((lock) => lock.status !== 'active').length, 200)

writeFileSync(path.join(testCwd, 'owned.txt'), 'participant change\n')

// Any participant may add discovered work while the run is live — and the
// new claimable task wakes waiting participants with the event and digest.
const leadCursor = (await coordination.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor
const discovery = await coordination.createExternalProtocolTask(teammate, {
  title: 'Follow-up discovered by teammate',
  detail: 'Write second.txt with the follow-up change.',
  paths: ['second.txt'],
})
const followUp = discovery.task!
assert.equal(followUp.id, 'task-2')
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
assert.equal(completed.runStatus, 'running')

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
assert.equal(followUpDone.runStatus, 'synthesizing')

const leadInbox = await coordination.readExternalProtocolInbox(lead)
assert.match(leadInbox.messages.at(-1)?.body ?? '', /coord_finalize_run/)

// The lead reopens a synthesizing run by adding post-review work.
const reopened = await coordination.createExternalProtocolTask(lead, {
  title: 'Post-review fix',
  detail: 'Follow-up identified during synthesis review.',
  phase: 'Fix',
})
assert.equal(reopened.runStatus, 'running')
const reopenedTask = reopened.task!
assert.equal(reopenedTask.phase, 'Fix')

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

// Run discovery: with every run terminal, an id-less join fails clearly…
await assert.rejects(
  coordination.joinExternalProtocolRun({
    provider: 'claude',
    cwd: testCwd,
    participantName: 'Discovering teammate',
  }),
  /No joinable Coordinator run/,
)

// …and once a live run exists for this checkout, it is auto-joined.
const secondRun = await coordination.createExternalProtocolRun({
  prompt: 'Second run for join discovery',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Second lead',
  maxAgents: 2,
})
const discovered = await coordination.joinExternalProtocolRun({
  provider: 'claude',
  cwd: testCwd,
  participantName: 'Discovering teammate',
})
assert.equal(discovered.participant.runId, secondRun.participant.runId)
assert.equal(discovered.participant.role, 'teammate')

// A classified provider failure checkpoints and atomically hands owned work
// back: task pending, locks released, worker blocked, lead urgently notified.
const handoffTask = (await coordination.createExternalProtocolTask(secondRun.participant, {
  title: 'Provider failure handoff',
  detail: 'This work should survive a failed CLI.',
  paths: ['handoff.txt'],
})).task!
await coordination.claimExternalProtocolTask(discovered.participant, handoffTask.id)
await coordination.requestExternalProtocolLocks(discovered.participant, ['handoff.txt'])
const handedOff = await coordination.handoffExternalProtocolTask(discovered.participant, {
  taskId: handoffTask.id,
  summary: 'Checkpoint before quota handoff',
  detail: 'No file changes were made; resume from task start.',
  failureClass: 'rate_limited',
})
assert.equal(handedOff.task.status, 'pending')
assert.equal(handedOff.task.ownerAgentId, undefined)
const handoffSnapshot = await coordination.readExternalProtocolRun(secondRun.participant)
assert.equal(handoffSnapshot.agents.find((agent) => agent.id === discovered.participant.agentId)?.status, 'blocked')
assert.equal(handoffSnapshot.locks.some((lock) => lock.taskId === handoffTask.id && lock.status === 'active'), false)
assert.ok(handoffSnapshot.events.some((event) => event.type === 'handoff'
  && event.taskId === handoffTask.id
  && event.payload?.failureClass === 'rate_limited'))
const handoffInbox = await coordination.readExternalProtocolInbox(secondRun.participant)
assert.equal(handoffInbox.messages.at(-1)?.kind, 'handoff')
assert.equal(handoffInbox.messages.at(-1)?.priority, 'urgent')

// --- Playbooks: workflow-style runs where the artifact holds the plan ------

const { parseRunPlaybook, interpolatePlaybookText } = await import('../../lib/agentProtocol')
assert.equal(
  interpolatePlaybookText('Audit {{args.dir}} then {{ args }}', { dir: 'src/routes' }),
  'Audit src/routes then {"dir":"src/routes"}',
)

const playbook = parseRunPlaybook({
  name: 'smoke-audit',
  description: 'Two-phase smoke playbook',
  argsHint: 'target file name',
  maxAgents: 3,
  phases: [
    {
      title: 'Survey',
      tasks: [
        { key: 'survey', title: 'Survey {{args.target}}', detail: 'Survey the checkout for {{args.target}}.' },
      ],
    },
    {
      title: 'Fix',
      tasks: [
        { key: 'fix', title: 'Fix findings', detail: 'Apply fixes for {{args.target}}.', paths: ['third.txt'] },
      ],
    },
  ],
})

const playbookRun = await coordination.createExternalProtocolRun({
  prompt: 'Playbook-seeded run',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Playbook lead',
  playbook,
  playbookArgs: { target: 'third.txt' },
})
const playbookLead = playbookRun.participant
const seeded = playbookRun.snapshot.tasks
assert.equal(seeded.length, 2)
assert.equal(seeded[0].title, 'Survey third.txt')
assert.equal(seeded[0].phase, 'Survey')
assert.equal(seeded[1].phase, 'Fix')
// Phase barrier: the Fix task depends on the Survey task.
assert.deepEqual(seeded[1].blockedBy, [seeded[0].id])
assert.equal(playbookRun.snapshot.run.maxAgents, 3)

// Barrier is enforced at claim time, and phases roll up in status.
await assert.rejects(
  coordination.claimExternalProtocolTask(playbookLead, seeded[1].id),
  /blocked by incomplete dependencies/,
)
const playbookStatus = await coordination.readExternalProtocolStatus(playbookLead)
assert.deepEqual(
  playbookStatus.phases.map((phase) => `${phase.title}:${phase.total}`),
  ['Survey:1', 'Fix:1'],
)

// Complete both phases, then save the board as a reusable playbook.
await coordination.claimExternalProtocolTask(playbookLead, seeded[0].id)
await coordination.completeExternalProtocolTask(playbookLead, { taskId: seeded[0].id, summary: 'Surveyed.' })
await coordination.claimExternalProtocolTask(playbookLead, seeded[1].id)
writeFileSync(path.join(testCwd, 'third.txt'), 'fixed\n')
const playbookDone = await coordination.completeExternalProtocolTask(playbookLead, { taskId: seeded[1].id, summary: 'Fixed.' })
assert.equal(playbookDone.accepted, true)

const saved = await coordination.saveExternalProtocolPlaybook(playbookLead, {
  name: 'smoke-audit-saved',
  description: 'Saved from the smoke run',
})
assert.ok(saved.path.endsWith('smoke-audit-saved.json'))
const listed = await coordination.listRunPlaybooks(testCwd)
assert.ok(listed.playbooks.some((entry) => entry.name === 'smoke-audit-saved' && entry.taskCount === 2))
assert.equal(listed.invalid.length, 0)

// The saved playbook reloads and reseeds an identical phased board.
const reloaded = await coordination.loadRunPlaybook(testCwd, 'smoke-audit-saved')
assert.equal(reloaded.phases.length, 2)
await coordination.finalizeExternalProtocolRun(playbookLead, 'Playbook smoke complete.')
const replay = await coordination.createExternalProtocolRun({
  prompt: 'Replay from saved playbook',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Replay lead',
  playbook: reloaded,
})
assert.equal(replay.snapshot.tasks.length, 2)
assert.equal(replay.snapshot.tasks[1].blockedBy.length, 1)
await coordination.finalizeExternalProtocolRun(replay.participant, 'x').catch(() => {})

// Later-phase dependencies are rejected at parse time — with the barrier they
// can never complete first, so seeding them would deadlock the board.
assert.throws(() => parseRunPlaybook({
  name: 'fwd-bad',
  phases: [
    { title: 'P1', tasks: [{ key: 'a', title: 'A', detail: 'a', dependsOn: ['b'] }] },
    { title: 'P2', tasks: [{ key: 'b', title: 'B', detail: 'b' }] },
  ],
}), /later phase/)

// A playbook whose text expects {{args}} refuses to seed without args.
await assert.rejects(
  coordination.createExternalProtocolRun({
    prompt: 'missing args',
    provider: 'codex',
    baseCwd: testCwd,
    participantName: 'No-args lead',
    playbook,
  }),
  /expects args/,
)

// Same-phase forward references resolve to real task ids via pre-assignment.
const fwd = await coordination.createExternalProtocolRun({
  prompt: 'Same-phase forward reference',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Fwd lead',
  playbook: parseRunPlaybook({
    name: 'fwd-ok',
    phases: [{
      title: 'P1',
      tasks: [
        { key: 'first', title: 'First', detail: 'x', dependsOn: ['second'] },
        { key: 'second', title: 'Second', detail: 'y' },
      ],
    }],
  }),
})
assert.deepEqual(fwd.snapshot.tasks[0].blockedBy, ['task-2'])

// Live mailbox delivery must use the boolean inside steerRunningSession's
// result. Treating `{ delivered: false }` itself as truthy acknowledged and
// deleted messages that never reached a running subagent.
const deliveryLead = await coordination.createExternalProtocolRun({
  prompt: 'Exercise live message delivery',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Delivery lead',
  maxAgents: 3,
})
const deliveryDbPath = path.join(coordinationDir, 'coordination.sqlite')
const deliveryDb = new Database(deliveryDbPath)
const deliveryTs = new Date().toISOString()
deliveryDb.exec(`
  INSERT INTO protocol_agents (
    id, run_id, name, role, provider, session_id, worktree_path, worktree_branch,
    task_id, status, last_seen_at, created_at, updated_at
  ) VALUES
    ('live-agent', '${deliveryLead.participant.runId}', 'live-agent', 'teammate', 'codex', 'live-session', '${testCwd}', '', NULL, 'working', NULL, '${deliveryTs}', '${deliveryTs}'),
    ('queued-agent', '${deliveryLead.participant.runId}', 'queued-agent', 'teammate', 'codex', 'missing-session', '${testCwd}', '', NULL, 'working', NULL, '${deliveryTs}', '${deliveryTs}')
`)
deliveryDb.close()

const steeredMessages: string[] = []
sessionRuntime.setRunningSession('live-session', {
  provider: 'codex',
  interrupt: async () => {},
  // Stay unresolved across a mailbox-sweep interval. The initial delivery and
  // sweep must not steer this same durable message twice while delivered_at is
  // still unset.
  steer: async (text) => {
    steeredMessages.push(text)
    await new Promise((resolve) => setTimeout(resolve, 5_500))
  },
})
await coordination.sendExternalProtocolMessage(deliveryLead.participant, {
  to: 'live-agent',
  body: 'priority changed while you were working',
})
await new Promise((resolve) => setTimeout(resolve, 6_000))
sessionRuntime.clearRunningSession('live-session')
assert.equal(steeredMessages.length, 1)
assert.match(steeredMessages[0]!, /^\[team message [^ ]+ from Delivery lead\] priority changed while you were working$/)
const deliveredDb = new Database(deliveryDbPath)
const deliveredRow = deliveredDb.prepare(`
  SELECT delivered_at FROM protocol_messages
  WHERE run_id = ? AND to_agent_id = 'live-agent' AND body = ?
`).get(deliveryLead.participant.runId, 'priority changed while you were working')
deliveredDb.close()
assert.ok(deliveredRow?.delivered_at)

await coordination.sendExternalProtocolMessage(deliveryLead.participant, {
  to: 'queued-agent',
  body: 'retain this until steering becomes available',
})
await new Promise((resolve) => setTimeout(resolve, 100))
const queuedDb = new Database(deliveryDbPath)
const queuedRow = queuedDb.prepare(`
  SELECT delivered_at FROM protocol_messages
  WHERE run_id = ? AND to_agent_id = 'queued-agent' AND body = ?
`).get(deliveryLead.participant.runId, 'retain this until steering becomes available')
queuedDb.close()
assert.equal(queuedRow?.delivered_at, null)

// Escalation creates one urgent wake-up, not a new reply-required message that
// can recursively escalate and amplify mailbox traffic on a large team.
await coordination.sendExternalProtocolMessage(deliveryLead.participant, {
  to: 'queued-agent',
  body: 'Please acknowledge this stale request.',
  kind: 'request',
  priority: 'urgent',
  replyRequired: true,
})
const staleInboxDb = new Database(deliveryDbPath)
staleInboxDb.prepare(`
  UPDATE protocol_messages SET delivered_at = ?, created_at = ?
  WHERE run_id = ? AND to_agent_id = 'queued-agent' AND body = ?
`).run(
  new Date(Date.now() - 4 * 60_000).toISOString(),
  new Date(Date.now() - 4 * 60_000).toISOString(),
  deliveryLead.participant.runId,
  'Please acknowledge this stale request.',
)
staleInboxDb.close()
await new Promise((resolve) => setTimeout(resolve, 5_500))
const escalationDb = new Database(deliveryDbPath)
const reminderRow = escalationDb.prepare(`
  SELECT reply_required, priority FROM protocol_messages
  WHERE run_id = ? AND to_agent_id = 'queued-agent' AND body LIKE 'Reminder:%'
`).get(deliveryLead.participant.runId)
escalationDb.close()
assert.equal(reminderRow?.reply_required, 0)
assert.equal(reminderRow?.priority, 'urgent')

// Maximum-size external roster: fan-out reaches every participant, and a
// blocked teammate can actively ask a peer for help while the automatic block
// notification wakes the lead in parallel.
const scaleLead = await coordination.createExternalProtocolRun({
  prompt: 'Exercise sixteen-agent messaging and peer unblocking',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Scale lead',
  maxAgents: 16,
})
const scaleTeammates = []
for (let index = 1; index < 16; index += 1) {
  scaleTeammates.push((await coordination.joinExternalProtocolRun({
    runId: scaleLead.participant.runId,
    provider: 'codex',
    cwd: testCwd,
    participantName: `Scale teammate ${index}`,
  })).participant)
}
assert.equal((await coordination.readExternalProtocolRun(scaleLead.participant)).agents.length, 16)
const scaleTask = (await coordination.createExternalProtocolTask(scaleLead.participant, {
  title: 'Peer-assisted task',
  detail: 'Ask another teammate for the missing context, then resume.',
  paths: [],
})).task!
const blockedTeammate = scaleTeammates[0]!
const helperTeammate = scaleTeammates[1]!
await coordination.claimExternalProtocolTask(blockedTeammate, scaleTask.id)
const scaleLeadCursor = (await coordination.waitForExternalProtocolChange(scaleLead.participant, { timeoutMs: 0 })).cursor
const helperCursor = (await coordination.waitForExternalProtocolChange(helperTeammate, { timeoutMs: 0 })).cursor
await coordination.reportExternalProtocolProgress(blockedTeammate, {
  status: 'blocked',
  taskId: scaleTask.id,
  summary: 'Need the helper teammate to identify the safe API boundary.',
})
await coordination.sendExternalProtocolMessage(blockedTeammate, {
  to: helperTeammate.agentId,
  body: 'Which API boundary should this task use?',
  kind: 'request',
  priority: 'urgent',
  replyRequired: true,
  correlationId: 'peer-unblock',
})
const [scaleLeadWake, helperWake] = await Promise.all([
  coordination.waitForExternalProtocolChange(scaleLead.participant, {
    cursor: scaleLeadCursor ?? undefined,
    timeoutMs: 100,
  }),
  coordination.waitForExternalProtocolChange(helperTeammate, {
    cursor: helperCursor ?? undefined,
    timeoutMs: 100,
  }),
])
assert.equal(scaleLeadWake.actionable.urgentCount, 1)
assert.equal(helperWake.actionable.urgentCount, 1)
const scaleBlockInbox = await coordination.readExternalProtocolInbox(scaleLead.participant)
assert.match(scaleBlockInbox.messages[0].body, /safe API boundary/)
const peerRequestInbox = await coordination.readExternalProtocolInbox(helperTeammate)
assert.equal(peerRequestInbox.messages[0].replyRequired, true)
const blockedCursor = (await coordination.waitForExternalProtocolChange(blockedTeammate, { timeoutMs: 0 })).cursor
await coordination.sendExternalProtocolMessage(helperTeammate, {
  to: blockedTeammate.agentId,
  body: 'Use the sessionBackend boundary; it preserves provider isolation.',
  kind: 'response',
  priority: 'urgent',
  inReplyTo: peerRequestInbox.messages[0].id,
})
const peerResponseWake = await coordination.waitForExternalProtocolChange(blockedTeammate, {
  cursor: blockedCursor ?? undefined,
  timeoutMs: 100,
})
assert.equal(peerResponseWake.actionable.inboxCount, 1)
const peerResponseInbox = await coordination.readExternalProtocolInbox(blockedTeammate)
assert.match(peerResponseInbox.messages[0].body, /sessionBackend boundary/)
await coordination.reportExternalProtocolProgress(blockedTeammate, {
  status: 'working',
  taskId: scaleTask.id,
  summary: 'Peer guidance cleared the blocker.',
})
await coordination.sendExternalProtocolMessage(scaleLead.participant, {
  to: 'all',
  body: 'Scale fan-out check',
  kind: 'request',
  priority: 'urgent',
})
for (const teammateEntry of scaleTeammates) {
  const status = await coordination.readExternalProtocolStatus(teammateEntry)
  assert.equal(status.actionable.inboxCount, 1)
  const fanoutInbox = await coordination.readExternalProtocolInbox(teammateEntry)
  assert.match(fanoutInbox.messages[0].body, /Scale fan-out check/)
}
await coordination.completeExternalProtocolTask(blockedTeammate, {
  taskId: scaleTask.id,
  summary: 'Peer-assisted task resumed and completed.',
})
await coordination.finalizeExternalProtocolRun(scaleLead.participant, 'Sixteen-agent fan-out and peer unblocking passed.')

// Whole-team-idle recovery: two teammates each finish their own task while a
// third task sits unclaimed. Nobody messages the lead about it (that's model
// discretion, not guaranteed) — the background mailbox sweep must notice the
// team went idle with unfinished work and ping the lead itself so its next
// coord_wait sees inboxCount > 0 instead of hanging forever.
const idleLead = await coordination.createExternalProtocolRun({
  prompt: 'Two teammates finish, a third task is left over',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Idle-sweep lead',
  maxAgents: 3,
})
const idleTeammateA = (await coordination.joinExternalProtocolRun({
  runId: idleLead.participant.runId,
  provider: 'claude',
  cwd: testCwd,
  participantName: 'Idle-sweep A',
})).participant
const idleTeammateB = (await coordination.joinExternalProtocolRun({
  runId: idleLead.participant.runId,
  provider: 'codex',
  cwd: testCwd,
  participantName: 'Idle-sweep B',
})).participant
const idleTaskA = (await coordination.createExternalProtocolTask(idleLead.participant, {
  title: 'Task for A', detail: 'a', paths: ['idle-a.txt'],
})).task!
const idleTaskB = (await coordination.createExternalProtocolTask(idleLead.participant, {
  title: 'Task for B', detail: 'b', paths: ['idle-b.txt'],
})).task!
await coordination.createExternalProtocolTask(idleLead.participant, {
  title: 'Leftover task nobody claims', detail: 'c', paths: ['idle-c.txt'],
})
await coordination.claimExternalProtocolTask(idleTeammateA, idleTaskA.id)
await coordination.claimExternalProtocolTask(idleTeammateB, idleTaskB.id)
await coordination.completeExternalProtocolTask(idleTeammateA, { taskId: idleTaskA.id, summary: 'A done.' })
await coordination.completeExternalProtocolTask(idleTeammateB, { taskId: idleTaskB.id, summary: 'B done.' })

await new Promise((resolve) => setTimeout(resolve, 6_500))
const idleLeadInbox = await coordination.readExternalProtocolInbox(idleLead.participant)
assert.ok(
  idleLeadInbox.messages.some((message) => /Team idle:/.test(message.body) && message.body.includes('Leftover task nobody claims')),
  `Expected the mailbox sweep to ping the lead about the leftover task, got: ${JSON.stringify(idleLeadInbox.messages)}`,
)

console.log('External Coordinator smoke passed')
