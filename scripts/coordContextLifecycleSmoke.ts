import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

if (['--recover', '--verify-pending', '--upgrade'].includes(process.argv[2]!)) {
  process.chdir(process.argv[3]!)
  const fixture = JSON.parse(readFileSync('.agent-viewer-data/lifecycle-fixture.json', 'utf8'))
  const coord = await import('../lib/agentCoordination')
  const runtime = await import('../lib/sessionRuntime')
  const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
  if (process.argv[2] === '--upgrade') {
    assert.equal((await coord.readExternalProtocolRun(fixture.lead)).run.id, fixture.lead.runId)
    process.exit(0)
  }
  const artifact = await execute({ ...fixture.lead, action: 'read_handoff', handoffId: fixture.handoff.id })
  assert.deepEqual(artifact, fixture.handoff, 'portable artifact survives process restart')
  assert.equal(runtime.listWaitingSessions().length, 0, 'new process has no provider observation')
  await assert.rejects(coord.completeExternalProtocolTask(fixture.worker, { taskId: fixture.taskId, summary: 'Premature after restart' }), /previously observed nested/)
  if (process.argv[2] === '--verify-pending') process.exit(0)
  runtime.setWaitingSession({ sessionId: fixture.sessionId, provider: 'codex', backgroundTasks: [], sessionCrons: [] })
  assert.equal((await coord.completeExternalProtocolTask(fixture.worker, { taskId: fixture.taskId, summary: 'Provider reports settled' })).accepted, true)
  process.exit(0)
}

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-context-lifecycle-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
writeFileSync('README.md', 'portable handoff fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const runtime = await import('../lib/sessionRuntime')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const protocol = await import('../lib/agentProtocol')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Portable task recovery', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
try {
  // Reconstruct a v24 ledger before any checkpoints exist, then reopen in a
  // second process. Existing runs survive and both new columns must appear.
  mkdirSync('.agent-viewer-data', { recursive: true })
  writeFileSync('.agent-viewer-data/lifecycle-fixture.json', JSON.stringify({ lead }))
  const { Database } = await (0, eval)('import("bun:sqlite")')
  const migration = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
  migration.exec('ALTER TABLE protocol_tasks DROP COLUMN context_handoff_json')
  migration.exec('ALTER TABLE protocol_agents DROP COLUMN pending_background_json')
  migration.exec('DROP TABLE protocol_context_handoffs')
  migration.prepare("UPDATE meta SET value = '24' WHERE key = 'schema_version'").run()
  migration.close()
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--upgrade', cwd], { cwd, stdio: 'pipe' })
  const upgraded = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
  assert.equal(upgraded.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '25')
  assert.ok(upgraded.prepare('PRAGMA table_info(protocol_tasks)').all().some((column: { name: string }) => column.name === 'context_handoff_json'))
  assert.ok(upgraded.prepare('PRAGMA table_info(protocol_agents)').all().some((column: { name: string }) => column.name === 'pending_background_json'))
  upgraded.close()
  const source = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'claude', cwd, participantName: 'source' })).participant
  const task = (await coord.createExternalProtocolTask(lead, { assignTo: source.agentId, title: 'Inspect parser', detail: 'Inspect parser boundaries', paths: [] })).task!
  const args = { ...source, action: 'handoff_task', taskId: task.id, summary: 'Parser inspected', detail: 'Resume by checking the delimiter boundary; no files edited.', failureClass: 'context_exhausted', requestId: 'portable-checkpoint' }
  const first = await execute(args) as { task: typeof task }
  assert.equal(JSON.stringify(await execute(args)), JSON.stringify(first), 'handoff retry has one immutable artifact')
  const handoff = first.task.contextHandoff!
  assert.ok(handoff.id)
  assert.equal(handoff.source.provider, 'claude')
  assert.equal(handoff.source.claimGeneration, 1)
  assert.match(handoff.source.checkoutRevision!, /^[a-f0-9]{64}$/)
  assert.equal(handoff.taskPrompt, task.prompt)
  const { id, digest, ...content } = handoff
  assert.equal(digest, createHash('sha256').update(JSON.stringify(content)).digest('hex'))
  assert.deepEqual(await execute({ ...lead, action: 'read_handoff', handoffId: id }), handoff)
  const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'target' })).participant
  const native = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'claude', cwd, participantName: 'native' })).participant
  const claimed = await coord.claimExternalProtocolTask(worker, task.id)
  assert.deepEqual(claimed.task!.contextHandoff, handoff, 'cross-provider claim carries checkpoint without replacing task identity')
  const snapshot = await coord.readExternalProtocolRun(lead)
  const consumed = snapshot.events.find(event => event.type === 'task.claimed' && event.agentId === worker.agentId && event.payload?.contextHandoffId === handoff.id)
  assert.equal(consumed?.payload?.targetProvider, 'codex')
  const agent = snapshot.agents.find(entry => entry.id === worker.agentId)!
  const prompt = protocol.buildTeammateTurnPreamble({ runId: lead.runId, agent, cwd, roster: snapshot.agents, task: claimed.task!, allTasks: snapshot.tasks, inbox: [], agentsById: new Map(snapshot.agents.map(entry => [entry.id, entry])), requirePlanApproval: false, useWorktrees: false })
  assert.ok(prompt.includes(handoff.id) && prompt.includes(handoff.detail!), 'text-protocol dispatch includes the portable checkpoint')
  const second = await coord.handoffExternalProtocolTask(worker, { taskId: task.id, summary: 'Second portable checkpoint', detail: 'Boundary tests remain', failureClass: 'provider_failure' })
  assert.notEqual(second.task!.contextHandoff!.id, handoff.id)
  assert.equal(second.task!.contextHandoff!.source.claimGeneration, 2)
  assert.deepEqual(await coord.readExternalContextHandoff(lead, handoff.id), handoff, 'a later checkpoint cannot overwrite history')
  assert.equal((await coord.claimExternalProtocolTask(worker, task.id)).task!.contextHandoff!.id, second.task!.contextHandoff!.id)
  const foreign = (await coord.createExternalProtocolRun({ prompt: 'Other run', provider: 'codex', baseCwd: cwd, participantName: 'other' })).participant
  await assert.rejects(execute({ ...foreign, action: 'read_handoff', handoffId: id }), /not found in this run/)
  await coord.stopProtocolRun(foreign.runId)
  runtime.setWaitingSession({ sessionId: agent.sessionId, provider: 'codex', backgroundTasks: [{ id: 'nested-review', type: 'agent', status: 'running', description: 'Nested reviewer' }], sessionCrons: [] })
  await assert.rejects(coord.completeExternalProtocolTask(worker, { taskId: task.id, summary: 'Premature parent completion' }), /waits for nested/)
  runtime.clearWaitingSession(agent.sessionId)
  await assert.rejects(coord.completeExternalProtocolTask(worker, { taskId: task.id, summary: 'Marker cleared' }), /waits for nested/, 'clearing a UI marker does not settle background work')
  mkdirSync('.agent-viewer-data', { recursive: true })
  writeFileSync('.agent-viewer-data/lifecycle-fixture.json', JSON.stringify({ lead, worker, taskId: task.id, sessionId: agent.sessionId, handoff }))
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--recover', cwd], { cwd, stdio: 'pipe' })
  assert.equal((await coord.readExternalProtocolRun(lead)).tasks.find(entry => entry.id === task.id)!.status, 'completed')
  const shellTask = (await coord.createExternalProtocolTask(lead, { assignTo: worker.agentId, title: 'Shell is not a child', detail: 'Do not wait for a dev server forever', paths: [] })).task!
  runtime.setWaitingSession({ sessionId: agent.sessionId, provider: 'codex', backgroundTasks: [{ id: 'server', type: 'shell', status: 'running', description: 'Dev server' }], sessionCrons: [] })
  assert.equal((await coord.completeExternalProtocolTask(worker, { taskId: shellTask.id, summary: 'Ready' })).accepted, true)
  const nativeTask = (await coord.createExternalProtocolTask(lead, { assignTo: native.agentId, title: 'Native children', detail: 'Wait for both children', paths: [] })).task!
  const nativeAgent = (await coord.readExternalProtocolRun(lead)).agents.find(entry => entry.id === native.agentId)!
  const { createClaudeViewerQueryExtensions } = await import('../lib/claudeViewerIntegration')
  const extensions = createClaudeViewerQueryExtensions({ getSessionId: () => nativeAgent.sessionId, getCwd: () => cwd })
  const hook = async (event: 'SubagentStart' | 'SubagentStop', id: string) => {
    const callback = extensions.hooks[event]![0]!.hooks[1]!
    await callback({ hook_event_name: event, session_id: nativeAgent.sessionId, agent_id: id, agent_type: 'reviewer', cwd, transcript_path: '/fixture', stop_hook_active: false, agent_transcript_path: '/fixture' } as never, undefined, { signal: new AbortController().signal })
  }
  await hook('SubagentStart', 'child-a')
  await hook('SubagentStart', 'child-b')
  await hook('SubagentStart', 'child-b')
  writeFileSync('.agent-viewer-data/lifecycle-fixture.json', JSON.stringify({ lead, worker: native, taskId: nativeTask.id, sessionId: nativeAgent.sessionId, handoff }))
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--verify-pending', cwd], { cwd, stdio: 'pipe' })
  await assert.rejects(coord.completeExternalProtocolTask(native, { taskId: nativeTask.id, summary: 'Premature' }), /2 tasks/)
  await hook('SubagentStop', 'child-a')
  await assert.rejects(coord.completeExternalProtocolTask(native, { taskId: nativeTask.id, summary: 'One remains' }), /1 tasks/)
  await hook('SubagentStop', 'child-b')
  const stop = extensions.hooks.Stop![0]!.hooks[1]!
  const stopInput = { hook_event_name: 'Stop', session_id: nativeAgent.sessionId, cwd, transcript_path: '/fixture', stop_hook_active: true, background_tasks: [] }
  await stop({ ...stopInput, session_crons: [{ id: 'wake', schedule: '* * * * *', recurring: false, prompt: 'Review after background result' }] } as never, undefined, { signal: new AbortController().signal })
  await assert.rejects(coord.completeExternalProtocolTask(native, { taskId: nativeTask.id, summary: 'Wakeup still scheduled' }), /1 scheduled wakeups/)
  await stop({ ...stopInput, session_crons: [] } as never, undefined, { signal: new AbortController().signal })
  assert.equal((await coord.completeExternalProtocolTask(native, { taskId: nativeTask.id, summary: 'Both settled' })).accepted, true)
  await coord.finalizeExternalProtocolRun(lead, 'All work and nested children settled')
  console.log('Context/lifecycle passed: v24 upgrade, immutable checkpoint, exact retry, cross-provider claim, prompt delivery, scoped inspection, process restart before any completion attempt, native hook siblings, durable nested-work gate, fresh settled observation, and shell exclusion.')
} finally { await coord.stopProtocolRun(lead.runId) }
process.exit(0)
