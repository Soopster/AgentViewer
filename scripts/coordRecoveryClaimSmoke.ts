import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const phase = process.argv[2]
if (!phase) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'coord-recovery-claim-'))
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(path.join(cwd, 'README.md'), 'fixture\n')
  execFileSync('git', ['-C', cwd, 'add', '.'])
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
  for (const step of ['crash', 'recover', 'reopen']) execFileSync(process.execPath, [fileURLToPath(import.meta.url), step, cwd], { timeout: 20000, stdio: 'inherit' })
  console.log('Recovery claims passed: stale execution cannot reclaim released work; healthy handoff, old-version stranded assignment acknowledgement, relinquished stream acknowledgement and restart persistence retain task IDs without replay.')
} else {
  process.chdir(process.argv[3]!)
  const { mock } = await (0, eval)('import("bun:test")')
  let starts = 0
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async () => ({ provider: 'codex', sessionId: `native-${starts + 1}`, isPending: false }),
    readViewSessionInfo: async (sessionId: string) => ({ sessionId, provider: 'codex', cwd: process.cwd() }),
    readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async () => { starts++; return new Promise<Response>(() => {}) },
  }))
  const coord = await import('../lib/agentCoordination')
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
    assert.fail('fixture did not settle')
  }
  if (phase === 'crash') {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
    const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    const completed = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Old work', detail: 'Persist completion before the stream settles', paths: ['old.ts'] })
    await until(() => starts === 1)
    const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
    const first = controller.sdkIdentities.get(completed.delegation!.agentId)!
    await coord.reportExternalProtocolProgress(first, { status: 'working', taskId: completed.task!.id })
    assert.equal((await coord.completeExternalProtocolTask(first, { taskId: completed.task!.id, summary: 'Verified old result' })).accepted, true)
    // A live tool caller may take another task within the same turn. The
    // recovery guard must distinguish that from a dead scheduler reservation.
    const second = await coord.createExternalProtocolTask(lead, { title: 'Saved editor work', detail: 'Do not duplicate this task', paths: ['editor.ts'] })
    assert.equal((await coord.claimExternalProtocolTask(first, second.task!.id)).task!.id, second.task!.id)
    writeFileSync('ids.json', JSON.stringify({ runId: lead.runId, firstId: first.agentId, oldTask: completed.task!.id, secondTask: second.task!.id }))
    process.exit(0)
  }
  const ids = JSON.parse(readFileSync('ids.json', 'utf8'))
  await coord.runProtocolMaintenanceSweep()
  const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
  const snapshot = async () => (await coord.readExternalProtocolStatus(lead)).snapshot
  if (phase === 'reopen') {
    assert.equal(starts, 0)
    assert.deepEqual(await coord.readSettledInteractiveExecutions(ids.runId), [])
    assert.equal((await snapshot()).tasks.find(task => task.id === ids.secondTask)!.status, 'pending')
    process.exit(0)
  }
  assert.equal(starts, 0, 'restart must not replay the crashed stream')
  // This is the legacy latest-run state: current work claimed behind the
  // completed prior-task marker. Acknowledgement must retire only that marker.
  assert.deepEqual(await coord.readSettledInteractiveExecutions(ids.runId), [ids.firstId])
  const before = (await snapshot()).tasks.find(task => task.id === ids.secondTask)!
  await coord.reconcileSettledInteractiveExecution(lead, ids.firstId)
  assert.deepEqual((await snapshot()).tasks.find(task => task.id === ids.secondTask), before)
  assert.equal(starts, 0, 'acknowledgement does not submit the current task')
  await coord.runProtocolMaintenanceSweep()
  await until(() => starts === 1)
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(ids.runId)!
  const first = controller.sdkIdentities.get(ids.firstId)!
  // Simulate native execution disappearing while its durable marker remains.
  controller.turnInFlight.delete(ids.firstId)
  await coord.releaseExternalProtocolTask(lead, { taskId: ids.secondTask, reason: 'Hand saved work to an available teammate' })
  await coord.runProtocolMaintenanceSweep()
  assert.equal((await snapshot()).tasks.find(task => task.id === ids.secondTask)!.ownerAgentId, undefined, 'dead worker must not reclaim released work')
  await assert.rejects(coord.claimExternalProtocolTask(first, ids.secondTask), /previous execution awaiting inspection/)
  assert.deepEqual((await coord.readExternalProtocolStatus(first)).actionable.claimableTasks, [], 'actionable digest must not advertise work this session cannot claim')
  assert.equal(starts, 1)
  assert.deepEqual(await coord.readSettledInteractiveExecutions(ids.runId), [ids.firstId])
  assert.deepEqual(await coord.readInteractiveRecoveries(ids.runId), [], 'released work requires acknowledgement, not impossible resume')
  const healthy = await coord.spawnAdditionalTeammate(lead, { provider: 'codex', name: 'healthy', reserveForDelegation: true })
  const healthyIdentity = controller.sdkIdentities.get(healthy.agentId)!
  await coord.claimExternalProtocolTask(healthyIdentity, ids.secondTask)
  assert.equal((await snapshot()).tasks.find(task => task.id === ids.secondTask)!.ownerAgentId, healthy.agentId)
  const handedOff = (await snapshot()).tasks.find(task => task.id === ids.secondTask)!
  await coord.reconcileSettledInteractiveExecution(lead, ids.firstId)
  assert.deepEqual((await snapshot()).tasks.find(task => task.id === ids.secondTask), handedOff, 'retiring old stream cannot change healthy ownership, locks or claim generation')
  assert.equal(starts, 1)
  // A currently owned unfinished dispatch still cannot be acknowledged.
  const { Database } = await (0, eval)('import("bun:sqlite")')
  const db = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
  db.query('INSERT INTO protocol_interactive_dispatches (run_id, agent_id, task_id, created_at) VALUES (?, ?, ?, ?)').run(ids.runId, healthy.agentId, ids.secondTask, new Date().toISOString())
  controller.turnInFlight.delete(healthy.agentId)
  await assert.rejects(coord.reconcileSettledInteractiveExecution(lead, healthy.agentId), /only completed or relinquished/)
  await coord.releaseExternalProtocolTask(lead, { taskId: ids.secondTask })
  await coord.reconcileSettledInteractiveExecution(lead, healthy.agentId)
  assert.equal(starts, 1, 'all acknowledgements retain one provider submission')
  db.close()
  process.exit(0)
}
