import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
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

process.env.AGENT_VIEWER_COORD_SESSION_INTERRUPT_TIMEOUT_MS = '150'
process.env.AGENT_VIEWER_COORD_IDEMPOTENCY_WINDOW = '8'
process.env.AGENT_VIEWER_COORD_LIVE_NOISE_WINDOW = '8'
process.env.AGENT_VIEWER_COORD_RETENTION_DAYS = '1'
process.env.AGENT_VIEWER_COORD_PRUNE_INTERVAL_MS = '100'
process.env.AGENT_VIEWER_COORD_DB_BUSY_TIMEOUT_MS = '1000'
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
assert.match(leadResult.instructions, /You are the lead: decompose the objective/)
assert.doesNotMatch(leadResult.instructions, /claim one unblocked teammate task/)

// Another Agent Viewer process can briefly hold the WAL writer lock. Normal
// multi-process contention must wait for that writer instead of immediately
// failing the Coordinator mutation with SQLITE_BUSY.
const lockHolder = spawn(process.execPath, ['-e', `
  import { Database } from 'bun:sqlite'
  const db = new Database(process.argv[1])
  db.exec('BEGIN IMMEDIATE')
  process.stdout.write('locked\\n')
  setTimeout(() => {
    db.exec('COMMIT')
    db.close()
    process.exit(0)
  }, 150)
`, path.join(coordinationDir, 'coordination.sqlite')], { stdio: ['ignore', 'pipe', 'pipe'] })
const [lockedChunk] = await once(lockHolder.stdout, 'data')
assert.match(String(lockedChunk), /locked/)
const contendedMutation = coordination.reportExternalProtocolProgress(lead, {
  status: 'heartbeat',
  summary: 'Waiting safely for a concurrent Coordinator writer.',
})
await contendedMutation
const [lockExitCode] = await once(lockHolder, 'exit')
assert.equal(lockExitCode, 0)

// A long-running supervisor gets a bounded idempotency retry window and does
// not persist empty heartbeat noise forever.
for (let index = 0; index < 12; index += 1) {
  await coordination.runExternalProtocolIdempotent(
    lead,
    'retention-smoke',
    `retention-${index}`,
    async () => ({ index }),
  )
}
const retentionDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
assert.equal(Number(retentionDb.prepare(`
  SELECT COUNT(*) AS n FROM protocol_idempotency
  WHERE run_id = ? AND agent_id = ?
`).get(lead.runId, lead.agentId)?.n), 8)
const heartbeatRowsBefore = Number(retentionDb.prepare(`
  SELECT COUNT(*) AS n FROM protocol_events
  WHERE run_id = ? AND agent_id = ? AND type = 'agent.heartbeat'
`).get(lead.runId, lead.agentId)?.n)
retentionDb.close()
await coordination.reportExternalProtocolProgress(lead, { status: 'heartbeat' })
await coordination.reportExternalProtocolProgress(lead, { status: 'heartbeat' })
const heartbeatDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
assert.equal(Number(heartbeatDb.prepare(`
  SELECT COUNT(*) AS n FROM protocol_events
  WHERE run_id = ? AND agent_id = ? AND type = 'agent.heartbeat'
`).get(lead.runId, lead.agentId)?.n), heartbeatRowsBefore)
heartbeatDb.close()

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

// A supervisor that exits before claiming work must retire immediately and
// free capacity for a replacement. Historical roster evidence remains, while
// stopped participants no longer consume the live participant limit or block
// reuse of the operator-facing name.
const replacementRun = await coordination.createExternalProtocolRun({
  prompt: 'Replace a pre-claim failed worker',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Replacement lead',
  maxAgents: 2,
})
const retiringWorker = (await coordination.joinExternalProtocolRun({
  runId: replacementRun.participant.runId,
  provider: 'pi',
  cwd: testCwd,
  participantName: 'Replaceable worker',
})).participant
await coordination.leaveExternalProtocolRun(retiringWorker, 'Provider authentication failed before claim')
assert.equal(
  (await coordination.readExternalProtocolRun(replacementRun.participant)).agents
    .find((agent) => agent.id === retiringWorker.agentId)?.status,
  'stopped',
)
const replacementWorker = (await coordination.joinExternalProtocolRun({
  runId: replacementRun.participant.runId,
  provider: 'copilot',
  cwd: testCwd,
  participantName: 'Replaceable worker',
})).participant
assert.notEqual(replacementWorker.agentId, retiringWorker.agentId)
await coordination.sendExternalProtocolMessage(replacementRun.participant, {
  to: 'Replaceable worker',
  body: 'This must reach the active replacement, not retired history.',
})
assert.ok((await coordination.readExternalProtocolInbox(replacementWorker)).messages
  .some((message) => message.body.includes('active replacement')))
const failedOverWorker = await coordination.resumeExternalProtocolParticipant(replacementWorker, {
  provider: 'opencode',
  client: { name: 'worker-supervisor', protocolVersion: 2 },
  capabilities: { unattended: true },
})
assert.equal(failedOverWorker.participant.provider, 'opencode')
for (let index = 0; index < 25; index += 1) {
  await coordination.publishExternalProtocolFinding(replacementRun.participant, {
    kind: 'finding',
    summary: `Complete audit evidence ${index}`,
  })
}
assert.equal(
  (await coordination.readExternalProtocolStatus(replacementRun.participant)).snapshot.events
    .filter((event) => event.type === 'finding').length,
  25,
)
await coordination.appendProtocolEvent({
  version: '1.0',
  runId: replacementWorker.runId,
  agentId: replacementWorker.agentId,
  type: 'shutdown.requested',
  summary: 'Replacement supervisor intentionally stopped',
})
assert.equal(
  (await coordination.readExternalProtocolRun(replacementRun.participant)).agents
    .find((agent) => agent.id === replacementWorker.agentId)?.status,
  'stopped',
)
await coordination.stopProtocolRun(replacementRun.participant.runId)

const departedLeadRun = await coordination.createExternalProtocolRun({
  prompt: 'Fail explicitly when the lead exits',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Departing lead',
  maxAgents: 2,
})
const departedLeadTeammate = (await coordination.joinExternalProtocolRun({
  runId: departedLeadRun.participant.runId,
  provider: 'opencode',
  cwd: testCwd,
  participantName: 'Leadless teammate',
})).participant
const departedLead = await coordination.leaveExternalProtocolRun(
  departedLeadRun.participant,
  'Lead provider failed before synthesis',
)
assert.equal(departedLead.runStatus, 'failed')
const departedLeadSnapshot = await coordination.readExternalProtocolRun(departedLeadTeammate)
assert.equal(departedLeadSnapshot.run.status, 'failed')
assert.equal(departedLeadSnapshot.agents.find((agent) => agent.id === departedLeadTeammate.agentId)?.status, 'stopped')

const claimInvariantRun = await coordination.createExternalProtocolRun({
  prompt: 'Enforce single ownership and atomic path locks',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Claim invariant lead',
  maxAgents: 2,
})
const claimInvariantTeammate = (await coordination.joinExternalProtocolRun({
  runId: claimInvariantRun.participant.runId,
  provider: 'opencode',
  cwd: testCwd,
  participantName: 'Claim invariant teammate',
})).participant
const firstOwnedTask = (await coordination.createExternalProtocolTask(claimInvariantRun.participant, {
  title: 'Own the shared path first', detail: 'Hold the declared path.', paths: ['shared-lock.txt'], targetRole: 'any',
})).task!
const conflictingTask = (await coordination.createExternalProtocolTask(claimInvariantRun.participant, {
  title: 'Conflicting task', detail: 'Must not claim without its declared lock.', paths: ['shared-lock.txt'], targetRole: 'any',
})).task!
await coordination.claimExternalProtocolTask(claimInvariantRun.participant, firstOwnedTask.id)
await assert.rejects(
  coordination.claimExternalProtocolTask(claimInvariantRun.participant, conflictingTask.id),
  new RegExp(`already owns ${firstOwnedTask.id}`),
)
await assert.rejects(
  coordination.claimExternalProtocolTask(claimInvariantTeammate, conflictingTask.id),
  /requires a path locked by/,
)
assert.equal(
  (await coordination.readExternalProtocolRun(claimInvariantRun.participant)).tasks.find((entry) => entry.id === conflictingTask.id)?.status,
  'pending',
)
await coordination.stopProtocolRun(claimInvariantRun.participant.runId)
await assert.rejects(
  coordination.claimExternalProtocolTask(claimInvariantTeammate, conflictingTask.id),
  /Coordinator run is stopped/,
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
assert.match(teammateResult.instructions, /You are a teammate: claim one unblocked teammate task/)

for (let index = 0; index < 12; index += 1) {
  await coordination.sendExternalProtocolMessage(lead, {
    to: teammate.agentId,
    body: `Retention status ${index}`,
    kind: 'status',
    priority: 'status',
    correlationId: 'retention-status',
  })
}
await coordination.readExternalProtocolInbox(teammate)
// Any following event performs the post-ack status-row sweep.
await coordination.reportExternalProtocolProgress(teammate, { status: 'heartbeat' })
const liveNoiseDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
assert.equal(Number(liveNoiseDb.prepare(`
  SELECT COUNT(*) AS n FROM protocol_messages
  WHERE run_id = ? AND delivered_at IS NOT NULL AND (kind = 'status' OR priority = 'status')
`).get(lead.runId)?.n), 8)
assert.equal(Number(liveNoiseDb.prepare(`
  SELECT COUNT(*) AS n FROM protocol_events
  WHERE run_id = ? AND type = 'message' AND payload_json LIKE '%"priority":"status"%'
`).get(lead.runId)?.n), 8)
liveNoiseDb.close()
assert.doesNotMatch(teammateResult.instructions, /You are the lead: decompose the objective/)
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
// A fresh unattended teammate is an active executor. Reserve teammate work for
// it instead of letting a fast lead absorb the task before its first poll.
assert.equal(createResult.actionable.claimableTasks.some((entry) => entry.id === task.id), false)
assert.ok((await coordination.readExternalProtocolStatus(teammate)).actionable.claimableTasks
  .some((entry) => entry.id === task.id && entry.targetRole === 'teammate'))
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
const correlatedResponse = responseInbox.messages.find((message) => message.kind === 'response')
assert.equal(correlatedResponse?.inReplyTo, inbox.messages[0].id)
assert.equal(correlatedResponse?.correlationId, 'plan-approval')

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
await coordination.runProtocolMaintenanceSweep()
const supervisionInbox = await coordination.readExternalProtocolInbox(lead)
assert.ok(supervisionInbox.messages.some((message) => (
  message.kind === 'review_request'
  && message.body.startsWith('Supervision checkpoint:')
  && message.body.includes(teammate.name)
  && message.body.includes(task.id)
)))

// Lock results are explicit: the holder re-requests and is granted. A
// taskless participant cannot reserve or perpetually renew arbitrary paths.
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
await assert.rejects(
  coordination.requestExternalProtocolLocks(lead, ['owned.txt']),
  /without owning a Coordinator task/,
)

writeFileSync(path.join(testCwd, 'owned.txt'), 'participant change\n')

// Any participant may add discovered work while the run is live — and the
// new claimable task wakes waiting participants with the event and digest.
const leadCursor = (await coordination.waitForExternalProtocolChange(lead, { timeoutMs: 0 })).cursor
const discovery = await coordination.createExternalProtocolTask(teammate, {
  title: 'Follow-up discovered by teammate',
  detail: 'Write second.txt with the follow-up change.',
  paths: ['second.txt'],
  targetRole: 'any',
})
const followUp = discovery.task!
assert.equal(followUp.id, 'task-2')
const leadWake = await coordination.waitForExternalProtocolChange(lead, {
  cursor: leadCursor ?? undefined,
  timeoutMs: 1_000,
})
assert.equal(leadWake.changed, true)
assert.ok(leadWake.events.some((event) => event.type === 'task.created'))
assert.ok(leadWake.actionable.claimableTasks.some((entry) => entry.id === followUp.id && entry.targetRole === 'any'))
assert.ok(discovery.actionable.claimableTasks.some((entry) => entry.id === followUp.id && entry.targetRole === 'any'))

// A different owned task may request an overlapping path, but the existing
// task-scoped lock must deny it. Repeated denials exercise bounded lock history.
const leadClaim = await coordination.claimExternalProtocolTask(lead, followUp.id)
assert.equal(leadClaim.task.ownerAgentId, lead.agentId)
const conflictedLocks = await coordination.requestExternalProtocolLocks(lead, ['owned.txt'])
assert.equal(conflictedLocks.granted.length, 0)
assert.equal(conflictedLocks.denied.length, 1)
assert.match(conflictedLocks.denied[0].reason, new RegExp(teammate.agentId))
for (let index = 0; index < 205; index += 1) {
  await coordination.requestExternalProtocolLocks(lead, ['owned.txt'])
}
const boundedLockSnapshot = await coordination.readExternalProtocolRun(lead)
assert.equal(boundedLockSnapshot.locks.filter((lock) => lock.status !== 'active').length, 200)
const released = await coordination.releaseExternalProtocolTask(lead, {
  taskId: followUp.id,
  reason: 'Handing back to the implementation teammate',
})
assert.equal(released.task.status, 'pending')
assert.equal(released.task.ownerAgentId, undefined)

// The retried completion re-runs the gates instead of replaying the cached
// rejection, and the still-open follow-up task keeps the run out of synthesis.
const completed = await coordination.runExternalProtocolIdempotent(
  teammate,
  'complete_task',
  'complete-task-1',
  () => coordination.completeExternalProtocolTask(teammate, {
    taskId: task.id,
    summary: 'Implemented and verified the shared change.',
    detail: 'owned.txt contains the verified participant change.',
  }),
)
assert.equal(completed.accepted, true)
assert.equal(completed.runStatus, 'running')
const completedStatus = await coordination.readExternalProtocolStatus(lead)
const completedTask = completedStatus.snapshot.tasks.find((entry) => entry.id === task.id)
assert.equal(completedTask?.resultSummary, 'Implemented and verified the shared change.')
assert.equal(completedTask?.resultDetail, 'owned.txt contains the verified participant change.')
const resultInbox = await coordination.readExternalProtocolInbox(lead)
assert.ok(resultInbox.messages.some((message) => (
  message.kind === 'handoff'
  && message.body.includes(`${task.id} completed`)
  && message.body.includes('owned.txt contains the verified participant change.')
)))

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

// Internal A2A lead events use appendProtocolEvent rather than the external
// task helper. A follow-up task emitted after an earlier terminal event raced
// synthesis in a real run; it must reopen the board instead of being completed
// underneath its owner.
const preInternalTaskIds = (await coordination.readExternalProtocolStatus(lead)).snapshot.tasks.map((entry) => entry.id)
await assert.rejects(
  coordination.appendProtocolEvent({
    version: '1.0',
    runId: lead.runId,
    agentId: lead.agentId,
    type: 'task.created',
    title: 'Invalid internal dependency',
    detail: 'This event must not mutate the board.',
    dependsOn: ['task-404'],
  }),
  /Invalid dependency.*task-404/,
)
await assert.rejects(
  coordination.appendProtocolEvent({
    version: '1.0',
    runId: lead.runId,
    agentId: lead.agentId,
    type: 'task.planned',
    title: 'Invalid internally planned dependency',
    detail: 'The plan-created task path must enforce the same invariant.',
    dependsOn: ['task-3'],
  }),
  /Invalid dependency.*task-3/,
)
assert.deepEqual(
  (await coordination.readExternalProtocolStatus(lead)).snapshot.tasks.map((entry) => entry.id),
  preInternalTaskIds,
)
await coordination.appendProtocolEvent({
  version: '1.0',
  runId: lead.runId,
  agentId: lead.agentId,
  type: 'task.created',
  taskId: 'task-3',
  title: 'Internal synthesis follow-up',
  detail: 'Exercise the internal A2A task-created reopening path.',
})
const internallyReopened = await coordination.readExternalProtocolStatus(lead)
assert.equal(internallyReopened.actionable.runStatus, 'running')
assert.equal(internallyReopened.snapshot.tasks.find((entry) => entry.id === 'task-3')?.status, 'pending')
await coordination.claimExternalProtocolTask(lead, 'task-3')
await coordination.failExternalProtocolTask(lead, {
  taskId: 'task-3',
  summary: 'Internal reopening regression covered',
})
assert.equal((await coordination.readExternalProtocolStatus(lead)).actionable.runStatus, 'synthesizing')

// Agent Operations reruns blocked/failed work by emitting task.released. The
// requeue must reopen synthesis and make the task claimable again.
await coordination.appendProtocolEvent({
  version: '1.0',
  runId: lead.runId,
  agentId: lead.agentId,
  type: 'task.released',
  taskId: 'task-3',
  summary: 'Retry task-3 from Agent Operations',
})
const retriedTaskStatus = await coordination.readExternalProtocolStatus(lead)
assert.equal(retriedTaskStatus.actionable.runStatus, 'running')
assert.equal(retriedTaskStatus.snapshot.tasks.find((entry) => entry.id === 'task-3')?.status, 'pending')
await coordination.claimExternalProtocolTask(lead, 'task-3')
await coordination.failExternalProtocolTask(lead, {
  taskId: 'task-3',
  summary: 'Task rerun reopening regression covered',
})
assert.equal((await coordination.readExternalProtocolStatus(lead)).actionable.runStatus, 'synthesizing')

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

const { parseRunPlaybook, interpolatePlaybookText, makeA2AStreamResponse } = await import('../../lib/agentProtocol')
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
        { key: 'fix', role: 'lead', title: 'Fix findings', detail: 'Apply fixes for {{args.target}}.', paths: ['third.txt'] },
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
assert.equal(seeded[0].targetRole, 'teammate')
assert.equal(seeded[1].phase, 'Fix')
assert.equal(seeded[1].targetRole, 'lead')
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
assert.equal(reloaded.phases[1].tasks[0].dependsOn, undefined)
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

// A joined/ready roster entry is not evidence that a teammate executor ever
// started participating. It must not suppress the lead's single-agent fallback
// and strand an otherwise runnable teammate lane.
const rosterOnlyRun = await coordination.createExternalProtocolRun({
  prompt: 'Do not let roster-only presence strand the board',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Roster-only fallback lead',
})
await coordination.joinExternalProtocolRun({
  runId: rosterOnlyRun.participant.runId,
  provider: 'claude',
  cwd: testCwd,
  participantName: 'Joined but inactive teammate',
})
const rosterOnlyTask = (await coordination.createExternalProtocolTask(rosterOnlyRun.participant, {
  title: 'Fallback teammate lane',
  detail: 'The lead must be able to absorb this lane.',
  paths: [],
})).task!
assert.equal(
  (await coordination.claimExternalProtocolTask(rosterOnlyRun.participant, rosterOnlyTask.id)).task.ownerAgentId,
  rosterOnlyRun.participant.agentId,
)
await coordination.failExternalProtocolTask(rosterOnlyRun.participant, {
  taskId: rosterOnlyTask.id,
  summary: 'Roster-only fallback covered',
})
await coordination.finalizeExternalProtocolRun(rosterOnlyRun.participant, 'Roster fallback smoke complete.')

// A fresh unattended supervisor is stronger evidence than a passive roster
// entry: while it is connected and ready, teammate lanes stay delegated so the
// lead cannot race it during startup.
const liveWorkerRun = await coordination.createExternalProtocolRun({
  prompt: 'Keep fresh unattended lanes delegated',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Live-worker lead',
})
await coordination.joinExternalProtocolRun({
  runId: liveWorkerRun.participant.runId,
  provider: 'opencode',
  cwd: testCwd,
  participantName: 'Fresh unattended worker',
  capabilities: { unattended: true },
})
const liveWorkerTask = (await coordination.createExternalProtocolTask(liveWorkerRun.participant, {
  title: 'Delegated unattended lane', detail: 'Only the live teammate should claim this.', paths: [],
})).task!
await assert.rejects(
  coordination.claimExternalProtocolTask(liveWorkerRun.participant, liveWorkerTask.id),
  /targets the teammate role/,
)
await coordination.stopProtocolRun(liveWorkerRun.participant.runId)

// The shared SQL prefilter must admit the shorter unattended timeout before
// applying each participant's own threshold. Otherwise a five-minute worker is
// not reaped until the twenty-minute interactive cutoff.
const staleClassRun = await coordination.createExternalProtocolRun({
  prompt: 'Apply distinct stale thresholds',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Stale-class lead',
  maxAgents: 3,
})
const staleUnattended = (await coordination.joinExternalProtocolRun({
  runId: staleClassRun.participant.runId,
  provider: 'opencode',
  cwd: testCwd,
  participantName: 'Stale unattended',
  capabilities: { unattended: true },
})).participant
const quietInteractive = (await coordination.joinExternalProtocolRun({
  runId: staleClassRun.participant.runId,
  provider: 'copilot',
  cwd: testCwd,
  participantName: 'Quiet interactive',
})).participant
const staleClassDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString()
staleClassDb.prepare('UPDATE protocol_agents SET last_seen_at = ?, updated_at = ? WHERE run_id = ? AND id IN (?, ?)')
  .run(tenMinutesAgo, tenMinutesAgo, staleClassRun.participant.runId, staleUnattended.agentId, quietInteractive.agentId)
staleClassDb.close()
await coordination.waitForExternalProtocolChange(staleClassRun.participant, { timeoutMs: 0 })
const staleClassSnapshot = await coordination.readExternalProtocolRun(staleClassRun.participant)
assert.equal(staleClassSnapshot.agents.find((agent) => agent.id === staleUnattended.agentId)?.status, 'stopped')
assert.equal(staleClassSnapshot.agents.find((agent) => agent.id === quietInteractive.agentId)?.status, 'ready')
await coordination.stopProtocolRun(staleClassRun.participant.runId)

// A stale lead is not an ordinary lost worker: nobody else can synthesize or
// finalize its lead-only lanes. Fail explicitly instead of leaving a live
// board without a coordinator.
const staleLeadRun = await coordination.createExternalProtocolRun({
  prompt: 'Fail when the unattended lead disappears',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Stale lead',
  maxAgents: 2,
  capabilities: { unattended: true },
})
const staleLeadObserver = (await coordination.joinExternalProtocolRun({
  runId: staleLeadRun.participant.runId,
  provider: 'opencode',
  cwd: testCwd,
  participantName: 'Stale lead observer',
  capabilities: { unattended: true },
})).participant
const staleLeadDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
staleLeadDb.prepare('UPDATE protocol_agents SET last_seen_at = ?, updated_at = ? WHERE run_id = ? AND id = ?')
  .run(tenMinutesAgo, tenMinutesAgo, staleLeadRun.participant.runId, staleLeadRun.participant.agentId)
staleLeadDb.close()
await coordination.waitForExternalProtocolChange(staleLeadObserver, { timeoutMs: 0 })
const staleLeadSnapshot = await coordination.readExternalProtocolRun(staleLeadObserver)
assert.equal(staleLeadSnapshot.run.status, 'failed')
assert.equal(staleLeadSnapshot.agents.find((agent) => agent.id === staleLeadRun.participant.agentId)?.status, 'stopped')

// A failed prerequisite cannot leave an invisible, permanently unclaimable
// dependency chain behind. Downstream work fails atomically and the board can
// enter synthesis immediately; failed tasks remain releasable for repair.
const dependencyFailureRun = await coordination.createExternalProtocolRun({
  prompt: 'Resolve terminal dependency chains deterministically',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Dependency failure lead',
})
const dependencyRoot = (await coordination.createExternalProtocolTask(dependencyFailureRun.participant, {
  title: 'Root prerequisite',
  detail: 'Fail this task to exercise downstream propagation.',
  paths: [],
  targetRole: 'any',
})).task!
const dependencyChild = (await coordination.createExternalProtocolTask(dependencyFailureRun.participant, {
  title: 'Direct dependent',
  detail: 'Must not remain pending after its prerequisite fails.',
  paths: [],
  dependsOn: [dependencyRoot.id],
  targetRole: 'any',
})).task!
const dependencyGrandchild = (await coordination.createExternalProtocolTask(dependencyFailureRun.participant, {
  title: 'Transitive dependent',
  detail: 'Must fail transitively in the same ledger transaction.',
  paths: [],
  dependsOn: [dependencyChild.id],
  targetRole: 'any',
})).task!
await coordination.claimExternalProtocolTask(dependencyFailureRun.participant, dependencyRoot.id)
await coordination.failExternalProtocolTask(dependencyFailureRun.participant, {
  taskId: dependencyRoot.id,
  summary: 'Deliberate prerequisite failure',
})
const failedDependencyStatus = await coordination.readExternalProtocolStatus(dependencyFailureRun.participant)
assert.equal(failedDependencyStatus.actionable.runStatus, 'synthesizing')
assert.equal(failedDependencyStatus.snapshot.tasks.find((task) => task.id === dependencyChild.id)?.status, 'failed')
assert.equal(failedDependencyStatus.snapshot.tasks.find((task) => task.id === dependencyGrandchild.id)?.status, 'failed')
assert.equal(failedDependencyStatus.actionable.allTasksTerminal, true)
assert.ok(failedDependencyStatus.snapshot.events.some((event) => (
  event.taskId === dependencyGrandchild.id && event.type === 'task.failed' && event.payload?.cascaded === true
)))
await coordination.finalizeExternalProtocolRun(dependencyFailureRun.participant, 'Dependency cascade smoke complete.')

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

// A user can open an internal Coordinator lead session and send a follow-up
// from the normal web/TUI composer. Its provider stream must still feed the
// in-band protocol parser; otherwise the lead visibly emits a message block
// that never enters the ledger or reaches the teammate.
const manualRunId = 'manual-session-run'
const manualLeadSessionId = 'manual-lead-session'
const manualTeammateSessionId = 'manual-teammate-session'
const manualTs = new Date().toISOString()
const manualDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
manualDb.exec(`
  INSERT INTO protocol_runs (
    id, prompt, status, provider, base_cwd, max_agents, lead_agent_id,
    use_worktrees, created_at, updated_at
  ) VALUES (
    '${manualRunId}', 'Manual lead follow-up', 'running', 'codex', '${testCwd}',
    2, 'manual-lead', 0, '${manualTs}', '${manualTs}'
  );
  INSERT INTO protocol_agents (
    id, run_id, name, role, provider, session_id, worktree_path, worktree_branch,
    task_id, status, last_seen_at, created_at, updated_at
  ) VALUES
    ('manual-lead', '${manualRunId}', 'Manual lead', 'lead', 'codex', '${manualLeadSessionId}', '${testCwd}', '', NULL, 'working', NULL, '${manualTs}', '${manualTs}'),
    ('manual-agent', '${manualRunId}', 'Manual teammate', 'teammate', 'codex', '${manualTeammateSessionId}', '${testCwd}', '', NULL, 'working', NULL, '${manualTs}', '${manualTs}');
`)
manualDb.close()

const manualSteers: string[] = []
sessionRuntime.setRunningSession(manualTeammateSessionId, {
  provider: 'codex',
  interrupt: async () => {},
  steer: async (text) => { manualSteers.push(text) },
})
const manualEvent = {
  version: '1.0' as const,
  runId: manualRunId,
  agentId: 'manual-lead',
  type: 'message' as const,
  to: 'Manual teammate',
  summary: 'Change priority now and keep working.',
}
const manualWire = `data: ${JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'agent_message',
    text: `\`\`\`a2a\n${JSON.stringify(makeA2AStreamResponse(manualEvent))}\n\`\`\``,
  },
})}\n\n`
const observedResponse = await coordination.observeCoordinatorSessionTurn(
  manualLeadSessionId,
  new Response(manualWire, { headers: { 'Content-Type': 'text/event-stream' } }),
)
assert.equal(await observedResponse.text(), manualWire)
const manualDeliveryDeadline = Date.now() + 2_000
while (manualSteers.length === 0 && Date.now() < manualDeliveryDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 20))
}
sessionRuntime.clearRunningSession(manualTeammateSessionId)
assert.equal(manualSteers.length, 1)
assert.match(manualSteers[0]!, /Change priority now and keep working/)
const manualDeliveryDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
const manualDelivery = manualDeliveryDb.prepare(`
  SELECT delivered_at FROM protocol_messages
  WHERE run_id = ? AND from_agent_id = 'manual-lead' AND to_agent_id = 'manual-agent'
`).get(manualRunId)
manualDeliveryDb.close()
assert.ok(manualDelivery?.delivered_at)

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

// Shared-checkout completion gate must not deadlock. Two teammates editing
// DISJOINT files out of one checkout used to block each other forever: the gate
// blamed every dirty file on whoever completed first, so each lane's work was
// reported as the other's "changes outside granted paths" and neither could
// ever finish without destroying the other's files.
const deadlockRun = await coordination.createExternalProtocolRun({
  prompt: 'Two lanes editing disjoint files in one shared checkout',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Deadlock lead',
  maxAgents: 3,
})
const deadlockLead = deadlockRun.participant
const laneA = (await coordination.joinExternalProtocolRun({
  runId: deadlockLead.runId,
  provider: 'codex',
  cwd: testCwd,
  participantName: 'Lane A',
  capabilities: { unattended: true },
})).participant
const laneB = (await coordination.joinExternalProtocolRun({
  runId: deadlockLead.runId,
  provider: 'claude',
  cwd: testCwd,
  participantName: 'Lane B',
  capabilities: { unattended: true },
})).participant

const taskA = (await coordination.createExternalProtocolTask(deadlockLead, {
  title: 'Lane A edits its own file',
  detail: 'Write lane-a.txt only.',
  paths: ['lane-a.txt'],
})).task
const taskB = (await coordination.createExternalProtocolTask(deadlockLead, {
  title: 'Lane B edits its own file',
  detail: 'Write lane-b.txt only.',
  paths: ['lane-b.txt'],
})).task
assert.ok(taskA && taskB, 'expected both deadlock-regression tasks to be created')

await coordination.claimExternalProtocolTask(laneA, taskA.id)
await coordination.claimExternalProtocolTask(laneB, taskB.id)
// Both lanes go dirty BEFORE either completes — the exact interleaving that
// used to wedge the board.
writeFileSync(path.join(testCwd, 'lane-a.txt'), 'lane A work\n')
writeFileSync(path.join(testCwd, 'lane-b.txt'), 'lane B work\n')

const laneAResult = await coordination.completeExternalProtocolTask(laneA, {
  taskId: taskA.id,
  summary: 'Lane A finished its own file.',
})
assert.equal(
  laneAResult.accepted,
  true,
  `Lane A blocked by lane B's disjoint edits: ${laneAResult.reason ?? ''}`,
)
const laneBResult = await coordination.completeExternalProtocolTask(laneB, {
  taskId: taskB.id,
  summary: 'Lane B finished its own file.',
})
assert.equal(
  laneBResult.accepted,
  true,
  `Lane B blocked by lane A's edits: ${laneBResult.reason ?? ''}`,
)

// Stopping a run is an observable terminal transition. Long-polling external
// supervisors must wake immediately instead of discovering it only after their
// 55-second timeout expires.
const stopWakeRun = await coordination.createExternalProtocolRun({
  prompt: 'Wake an external supervisor when the run stops',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Stop-wake lead',
  maxAgents: 1,
})
const stopWakeLead = stopWakeRun.participant
const beforeStop = await coordination.waitForExternalProtocolChange(stopWakeLead, { timeoutMs: 0 })
const stoppedWait = coordination.waitForExternalProtocolChange(stopWakeLead, {
  cursor: beforeStop.cursor ?? undefined,
  timeoutMs: 2_000,
})
sessionRuntime.setRunningSession(`external:${stopWakeLead.agentId}`, {
  provider: 'codex',
  interrupt: () => new Promise(() => {}),
  steer: async () => {},
})
const stopStartedAt = Date.now()
const stopPromise = coordination.stopProtocolRun(stopWakeLead.runId)
const afterStop = await Promise.race([
  stoppedWait,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stop event was blocked by a stalled provider interrupt')), 500)),
])
assert.ok(Date.now() - stopStartedAt < 500, 'durable stop should wake waiters before provider interruption settles')
assert.equal(afterStop.changed, true)
assert.equal(afterStop.actionable.runStatus, 'stopped')
assert.ok(afterStop.events.some((event) => (
  event.type === 'run.status' && event.payload?.status === 'stopped'
)))
// A supervisor commonly polls once more after seeing the terminal event. That
// final wait must not make the stopped participant look live again.
await coordination.waitForExternalProtocolChange(stopWakeLead, { timeoutMs: 0 })
assert.equal(
  (await coordination.readExternalProtocolRun(stopWakeLead)).agents.find((agent) => agent.id === stopWakeLead.agentId)?.status,
  'stopped',
)
await stopPromise
sessionRuntime.clearRunningSession(`external:${stopWakeLead.agentId}`)

// Deletion follows the same terminal-first contract: the board disappears
// before a stalled provider interrupt reaches its bounded timeout.
const deleteWakeRun = await coordination.createExternalProtocolRun({
  prompt: 'Delete promptly despite a stalled provider interrupt',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Delete-wake lead',
  maxAgents: 1,
})
const deleteWakeLead = deleteWakeRun.participant
sessionRuntime.setRunningSession(`external:${deleteWakeLead.agentId}`, {
  provider: 'codex',
  interrupt: () => new Promise(() => {}),
  steer: async () => {},
})
const deletePromise = coordination.deleteProtocolRun(deleteWakeLead.runId)
await new Promise((resolve) => setTimeout(resolve, 25))
await assert.rejects(
  coordination.readExternalProtocolStatus(deleteWakeLead),
  /Invalid Coordinator participant capability|not found|no longer exists/i,
  'deleted run stayed visible behind a stalled provider interrupt',
)
assert.equal((await deletePromise).deleted, true)
sessionRuntime.clearRunningSession(`external:${deleteWakeLead.agentId}`)

// Retention maintenance repeats inside a long-lived process; it is not tied to
// the one-time database open. Age a terminal run, cross the smoke sweep
// interval, and use an unrelated write to trigger pruning.
const expiredRun = await coordination.createExternalProtocolRun({
  prompt: 'Expire this terminal run during live maintenance',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Expired-run lead',
})
await coordination.stopProtocolRun(expiredRun.participant.runId)
const expiryDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
expiryDb.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?')
  .run(new Date(Date.now() - 2 * 86_400_000).toISOString(), expiredRun.participant.runId)
expiryDb.close()
await new Promise((resolve) => setTimeout(resolve, 120))
const pruneTrigger = await coordination.createExternalProtocolRun({
  prompt: 'Trigger periodic retention maintenance',
  provider: 'codex',
  baseCwd: testCwd,
  participantName: 'Prune-trigger lead',
})
const prunedDb = new Database(path.join(coordinationDir, 'coordination.sqlite'))
assert.equal(Number(prunedDb.prepare('SELECT COUNT(*) AS n FROM protocol_runs WHERE id = ?')
  .get(expiredRun.participant.runId)?.n ?? 0), 0)
prunedDb.close()
await coordination.stopProtocolRun(pruneTrigger.participant.runId)

console.log('External Coordinator smoke passed')
