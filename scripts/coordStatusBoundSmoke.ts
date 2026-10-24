// What a model reads from the board must not scale with how much evidence a run
// has published. A finding carries up to 32,000 characters and a hundred stay
// in view, so every status call once repeated all of it; the size of a tool
// result has no other observable than counting it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-status-bound-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const { coordinatorModelResult } = await import('../lib/coordinatorModelResult.mjs')
const { buildCoordinatorPiTools } = await import('../lib/agentCoordinationSdkTools')

const lead = (await coord.createExternalProtocolRun({ prompt: 'Audit', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker', capabilities: { tools: ['coord_status', 'coord_claim_task'] } })).participant
{
  // A roster row says how many tools a participant advertised, never the list.
  const row = (await coord.readExternalProtocolStatus(lead)).snapshot.agents.find((agent) => agent.id === worker.agentId)!
  assert.equal(row.capabilities?.tools, undefined, 'status must not repeat each participant\'s tool list')
  assert.equal(row.capabilities?.toolCount, 2)
}
{
  // A running turn reads as working to agents, whatever was last reported.
  const runtime = await import('../lib/sessionRuntime')
  const workerRow = (await coord.readExternalProtocolStatus(lead)).snapshot.agents.find((agent) => agent.id === worker.agentId)!
  runtime.setRunningSession(workerRow.sessionId, { provider: 'codex', interrupt: async () => {} })
  const live = (await coord.readExternalProtocolStatus(lead)).snapshot.agents.find((agent) => agent.id === worker.agentId)!
  runtime.clearRunningSession(workerRow.sessionId)
  assert.equal(live.turnActive, true)
  assert.equal(live.status, 'working', 'a teammate mid-turn must not read as idle')
  assert.equal(live.reportedStatus, workerRow.status)
}
// A miss names what would have worked, so the agent corrects it in one step.
{
  const typo = lead.runId.slice(0, 10) + (lead.runId[10] === 'a' ? 'b' : 'a') + lead.runId.slice(11)
  await assert.rejects(coord.joinExternalProtocolRun({ runId: typo, provider: 'codex', cwd, participantName: 'typo' }), new RegExp(`Did you mean ${lead.runId}`))
}
await assert.rejects(coord.sendExternalProtocolMessage(worker, { to: 'nobody', body: 'hi' }), /recipient not found: nobody\. Active participants: lead;/)
await assert.rejects(coord.sendExternalProtocolMessage(worker, { to: 'worker', body: 'hi' }), /worker is you/)
await assert.rejects(coord.readExternalProtocolTask(worker, 'task-99'), /task not found: task-99\..*coord_list_tasks/)

const EVIDENCE = 32_000
const FINDINGS = 30
const before = (await execute({ ...lead, action: 'status' }) as { cursor: string }).cursor
for (let index = 0; index < FINDINGS; index += 1) {
  await execute({
    ...worker, action: 'finding', requestId: `finding-${index}`, kind: 'finding',
    summary: `Unvalidated input in handler${index}quartz`, detail: `${'e'.repeat(EVIDENCE - 4)}${String(index).padStart(4, '0')}`,
  })
}

const status = await execute({ ...lead, action: 'status' }) as { snapshot: { events: Array<{ type: string; detail?: string }> } }
const actionable = await execute({ ...lead, action: 'status', view: 'actionable' }) as Awaited<ReturnType<typeof coord.readExternalProtocolActionableStatus>>
const fullStatus = await coord.readExternalProtocolStatus(lead)
assert.deepEqual(actionable.actionable, fullStatus.actionable, 'cheap reads preserve every next action and waiting-policy field')
assert.deepEqual(actionable.phases, fullStatus.phases)
assert.equal(actionable.cursor, fullStatus.cursor)
assert.equal('snapshot' in actionable, false, 'routine reads do not echo board/history')
assert.ok(JSON.stringify(actionable).length < JSON.stringify(status).length * 0.1, 'the actionable fixture cuts more than 90% of response characters')
await assert.rejects(execute({ ...lead, action: 'status', view: 'invented' }), /Status view/)
const statusTool = buildCoordinatorPiTools(lead).find(tool => tool.name === 'coord_status')!
const sdkStatus = await (statusTool.execute as unknown as (id: string, args: object) => Promise<{ content: Array<{ text?: string }> }>)('compact-status', { view: 'actionable' })
assert.deepEqual(JSON.parse(sdkStatus.content[0].text!), JSON.parse(JSON.stringify(actionable)), 'SDK path forwards the view and keeps the same digest')
const assignment = await coord.createExternalProtocolTask(lead, { title: 'Large assignment', detail: 'Specific context. '.repeat(1000), targetRole: 'teammate' })
const projected = coordinatorModelResult('create_task', assignment) as typeof assignment
assert.equal(projected.task!.prompt, undefined, 'the model does not get its authored prompt echoed back')
{
  const created = (await coord.readExternalProtocolStatus(lead)).snapshot.events.find((event) => event.type === 'task.created' && event.taskId === assignment.task!.id)
  assert.ok(created, 'the task.created event is in view')
  assert.equal((created!.payload as Record<string, unknown> | undefined)?.claudeAgentPolicy, undefined, 'status events must not carry the dispatch policy')
}
assert.equal(assignment.task!.prompt.length > 10_000, true, 'supervisor/backend data stays complete')
assert.equal((await coord.readExternalProtocolTask(lead, assignment.task!.id)).task.prompt, assignment.task!.prompt)
assert.equal(coordinatorModelResult('claim_task', assignment), assignment, 'claimer context remains whole')
const createTool = buildCoordinatorPiTools(lead).find(tool => tool.name === 'coord_create_task')!
const sdkAssignment = await (createTool.execute as unknown as (id: string, args: object) => Promise<{ content: Array<{ text?: string }> }>)('compact-assignment', { title: 'SDK-authored assignment', detail: 'Caller supplied context. '.repeat(500), role: 'teammate', request_id: 'sdk-compact-assignment' })
const sdkAssignmentResult = JSON.parse(sdkAssignment.content[0].text!)
assert.equal(sdkAssignmentResult.task.prompt, undefined)
assert.equal(sdkAssignmentResult.taskDetailTool, 'coord_read_task')
assert.ok((await coord.readExternalProtocolTask(lead, sdkAssignmentResult.task.id)).task.prompt.startsWith('Caller supplied context.'))

console.log(`Assignment response characters: backend=${JSON.stringify(assignment).length}, model=${JSON.stringify(projected).length}`)

console.log(`Status response characters: full=${JSON.stringify(status).length}, actionable=${JSON.stringify(actionable).length}; reduction=${(100 * (1 - JSON.stringify(actionable).length / JSON.stringify(status).length)).toFixed(1)}%`)

const findings = status.snapshot.events.filter((event) => event.type === 'finding')
assert.equal(findings.length, FINDINGS, 'every finding is still listed')
assert.ok(JSON.stringify(status).length < 60_000, `status stayed small (${JSON.stringify(status).length} chars for ${FINDINGS * EVIDENCE} of evidence)`)
for (const finding of findings) {
  assert.ok((finding.detail?.length ?? 0) < 800, 'a listed finding carries an excerpt, not its evidence')
  assert.match(finding.detail ?? '', /coord_query_context returns the full text/, 'and says where the rest is')
}

// The excerpt is only acceptable because the whole text is still reachable.
const found = await execute({ ...lead, action: 'query_context', query: 'handler7quartz', limit: 5 }) as { results: Array<{ summary: string; detail?: string }> }
assert.equal(found.results[0]?.summary, 'Unvalidated input in handler7quartz')
assert.ok(found.results[0].detail?.length === EVIDENCE && found.results[0].detail.endsWith('0007'), 'the full evidence is retrievable')
// A broad query matches every finding; it must not return all of them whole.
const broad = await execute({ ...lead, action: 'query_context', query: 'unvalidated input', limit: 20 }) as { results: Array<{ detail?: string }> }
assert.equal(broad.results.length, 20)
assert.equal(broad.results[0].detail?.length, EVIDENCE, 'the best match is whole')
assert.ok(JSON.stringify(broad).length < 90_000, `a broad query stays bounded (${JSON.stringify(broad).length})`)

const waited = await execute({ ...lead, action: 'wait', cursor: before, timeoutMs: 0 }) as { events: Array<{ type: string; detail?: string }>; snapshot?: unknown }
assert.ok(waited.events.some((event) => event.type === 'finding'), 'a wait reports the new findings')
assert.ok(waited.events.every((event) => (event.detail?.length ?? 0) < 2_200), 'at reading length, not in full')
assert.ok(waited.snapshot, 'the supervisor still gets the board from a wait')

// An in-app session reads the tool result itself, so the board must not ride along.
const waitTool = buildCoordinatorPiTools(lead).find((tool) => tool.name === 'coord_wait')!
const execution = await (waitTool.execute as unknown as (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>)('call', { cursor: before, timeout_ms: 0 })
const toolResult = JSON.parse(execution.content[0].text ?? '{}')
assert.equal(toolResult.snapshot, undefined, 'an in-app coord_wait does not carry the whole board')
assert.ok(Array.isArray(toolResult.events) && toolResult.actionable, 'it keeps the events and the digest')

{
  // A claim says which paths it already locked, so the claimer does not ask again.
  const claimLead = (await coord.createExternalProtocolRun({ prompt: 'Claim', provider: 'codex', baseCwd: cwd, participantName: 'claim-lead' })).participant
  const claimer = (await coord.joinExternalProtocolRun({ runId: claimLead.runId, provider: 'codex', cwd, participantName: 'claimer' })).participant
  const lane = await coord.createExternalProtocolTask(claimLead, { title: 'Lane', detail: 'Edit the lane file.', paths: ['lane.md'], targetRole: 'teammate' })
  const claimed = await coord.claimExternalProtocolTask(claimer, lane.task!.id)
  assert.deepEqual(claimed.grantedPaths, ['lane.md'], 'the claim result must list the paths it locked')
  // A model that forgets the summary can still finish; the lead is told it was not given.
  const done = await coord.completeExternalProtocolTask(claimer, { taskId: lane.task!.id })
  assert.equal(done.accepted, true, 'a completion without a summary must be accepted')
  assert.match((await coord.readExternalProtocolTask(claimLead, lane.task!.id)).task.resultSummary ?? '', /no summary given/)
}
console.log(`Status bound: ${FINDINGS} findings of ${EVIDENCE} characters cost ${JSON.stringify(status).length} characters of status, full text via a specific query, a broad query bounded, in-app wait without the board`)
process.exit(0)
