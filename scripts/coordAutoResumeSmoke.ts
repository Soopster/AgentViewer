// A team whose host process died is picked back up when a client adopts it:
// the same teammate, the same task, started once. Three real processes — one
// that exits mid-turn, one that adopts with auto-resume on, and (in a second
// fixture) one that adopts with it turned off.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const phase = process.argv[2]
if (!phase) {
  for (const recover of ['adopt', 'adopt-off', 'adopt-setting-off', 'adopt-capped']) {
    const cwd = mkdtempSync(path.join(tmpdir(), 'coord-auto-resume-'))
    execFileSync('git', ['init', '-q', cwd])
    writeFileSync(path.join(cwd, 'README.md'), 'fixture\n')
    execFileSync('git', ['-C', cwd, 'add', '.'])
    execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
    for (const childPhase of ['crash', recover]) {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), childPhase, cwd], {
        timeout: 20_000,
        stdio: ['ignore', 'pipe', 'inherit'],
        env: { ...process.env, AGENT_VIEWER_COORD_AUTO_RESUME: childPhase === 'adopt-off' ? '0' : '1' },
      })
    }
  }
  console.log('Coordinator auto-resume smoke passed (adopting a dead host resumes its teammate once, on the same task; the sweep, the env switch, the conversation setting and a task past its cap do not; r resets the count)')
} else {
  process.chdir(process.argv[3]!)
  const { mock } = await (0, eval)('import("bun:test")')
  let starts = 0
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async (params: { cwd: string }) => {
      writeFileSync('native.json', JSON.stringify({ sessionId: 'persistent-reviewer', provider: 'codex', cwd: params.cwd }))
      assert.equal(phase, 'crash', 'recovery must not create a second session')
      return { provider: 'codex', sessionId: 'persistent-reviewer', isPending: false }
    },
    readViewSessionInfo: async (sessionId: string) => sessionId === 'persistent-reviewer' ? JSON.parse(readFileSync('native.json', 'utf8')) : { sessionId, provider: 'codex', cwd: process.cwd() },
    readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => {
      assert.equal(sessionId, 'persistent-reviewer')
      starts++
      return new Promise<Response>(() => {})
    },
  }))
  const coord = await import('../lib/agentCoordination')
  const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const ledgerPath = () => execFileSync('find', ['.agent-viewer-data', '-name', 'coordination.sqlite'], { encoding: 'utf8' }).trim().split('\n')[0]!
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 5000
    while (!predicate() && Date.now() < deadline) await settle(10)
    assert.ok(predicate(), 'the teammate was not started')
  }
  if (phase === 'crash') {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
    const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    const delegated = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Inspect fixture', detail: 'Read-only review' })
    await until(() => starts === 1)
    const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
    await coord.reportExternalProtocolProgress(controller.sdkIdentities.get(delegated.delegation!.agentId)!, { taskId: delegated.task!.id, status: 'working' })
    // Exit mid-turn: the provider stream is neither stopped nor settled.
    process.exit(0)
  }
  // The maintenance sweep alone never replays uncertain work, in either mode.
  await coord.runProtocolMaintenanceSweep()
  await settle(300)
  assert.equal(starts, 0, 'the sweep resumed a teammate nobody adopted')
  const before = (await coord.readSessionCoordinator('lead-chat', 'codex'))!
  assert.deepEqual(await coord.readInteractiveRecoveries(before.run.id), ['agent-1'])

  if (phase === 'adopt-setting-off' || phase === 'adopt-capped') {
    // Stored state decides here, not the environment: the conversation's own
    // switch, and the task's count of automatic tries.
    const { Database } = await (0, eval)('import("bun:sqlite")')
    const db = new Database(ledgerPath())
    if (phase === 'adopt-setting-off') {
      assert.equal((await coord.readInteractiveCoordinator('lead-chat')).autoResume, true, 'auto-resume is not on by default')
      await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd(), autoResume: false })
      assert.equal((await coord.readInteractiveCoordinator('lead-chat')).autoResume, false, 'the setting did not persist')
      // Configuring claimed the run for this process; put the dead owner back so the read below adopts.
      db.prepare("UPDATE protocol_interactive_hosts SET owner_id = 'gone', owner_pid = 2147483646").run()
    } else {
      db.prepare('UPDATE protocol_tasks SET auto_resume_count = ?').run(coord.INTERACTIVE_AUTO_RESUME_CAP)
    }
    db.close()
    await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
    await settle(600)
    assert.equal(starts, 0, phase === 'adopt-capped' ? 'a task past its cap was resumed automatically again' : 'auto-resume ran with the conversation setting off')
    assert.deepEqual(await coord.readInteractiveRecoveries(before.run.id), ['agent-1'])
    if (phase === 'adopt-capped') {
      assert.deepEqual((await coord.readInteractiveCoordinator('lead-chat')).autoResumeExhausted, ['agent-1'], 'the panel is not told which teammate ran out of tries')
      // A person resuming it is a fresh start for the count.
      await coord.resumeInteractiveAgent(await coord.sessionCoordinatorIdentity('lead-chat', 'codex'), 'agent-1')
      await until(() => starts === 1)
      assert.deepEqual((await coord.readInteractiveCoordinator('lead-chat')).autoResumeExhausted, [], 'a manual resume did not reset the count')
    }
    process.exit(0)
  }
  await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
  if (phase === 'adopt-off') {
    await settle(600)
    assert.equal(starts, 0, 'auto-resume ran with AGENT_VIEWER_COORD_AUTO_RESUME=0')
    assert.deepEqual(await coord.readInteractiveRecoveries(before.run.id), ['agent-1'], 'the teammate is no longer offered for manual recovery')
    process.exit(0)
  }
  await until(() => starts === 1)
  const after = (await coord.readSessionCoordinator('lead-chat', 'codex'))!
  assert.equal(after.tasks.length, 1, 'resuming created a second task')
  assert.equal(after.tasks[0]!.id, before.tasks[0]!.id)
  assert.equal(after.agents.filter(agent => agent.role === 'teammate').length, 1, 'resuming staffed a second teammate')
  // Reading again (every poll adopts) must not start it a second time.
  await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
  await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
  await settle(500)
  assert.equal(starts, 1, 'a later read resumed the same teammate again')
  const { Database } = await (0, eval)('import("bun:sqlite")')
  const db = new Database(ledgerPath(), { readonly: true })
  assert.equal((db.prepare('SELECT auto_resume_count AS tries FROM protocol_tasks').get() as { tries: number }).tries, 1, 'the automatic try was not counted on the task')
  db.close()
  process.exit(0)
}
