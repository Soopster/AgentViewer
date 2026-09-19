import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const phase = process.argv[2]
if (!phase) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'coord-restart-'))
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(path.join(cwd, 'README.md'), 'fixture\n')
  execFileSync('git', ['-C', cwd, 'add', '.'])
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
  for (const childPhase of ['crash', 'recover']) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), childPhase, cwd], { timeout: 15_000, stdio: 'pipe' })
  }
  console.log('Real process restart: unfinished provider submission is not replayed; explicit recovery reuses the same teammate and task')
} else {
  process.chdir(process.argv[3]!)
  const { mock } = await (0, eval)('import("bun:test")')
  let starts = 0
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async () => {
      assert.equal(phase, 'crash', 'recovery must not create a second session')
      return { provider: 'codex', sessionId: 'persistent-reviewer', isPending: false }
    },
    readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => {
      assert.equal(sessionId, 'persistent-reviewer')
      starts++
      return new Promise<Response>(() => {})
    },
  }))
  const coord = await import('../lib/agentCoordination')
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 5000
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(predicate())
  }
  if (phase === 'crash') {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
    const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    const delegated = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Inspect fixture', detail: 'Read-only review' })
    await until(() => starts === 1)
    const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
    await coord.reportExternalProtocolProgress(controller.sdkIdentities.get(delegated.delegation!.agentId)!, { taskId: delegated.task!.id, status: 'working' })
    // Deliberately exit without stopping or settling the provider stream.
    process.exit(0)
  }
  await coord.runProtocolMaintenanceSweep()
  const snapshot = (await coord.readSessionCoordinator('lead-chat', 'codex'))!
  assert.equal(starts, 0)
  assert.equal(snapshot.tasks.length, 1)
  assert.deepEqual(await coord.readInteractiveRecoveries(snapshot.run.id), ['agent-1'])
  await coord.runProtocolMaintenanceSweep()
  assert.equal(starts, 0, 'repeated maintenance must leave uncertain execution alone')
  const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
  await coord.resumeInteractiveAgent(lead, 'agent-1')
  await until(() => starts === 1)
  assert.equal((await coord.readSessionCoordinator('lead-chat', 'codex'))!.tasks[0].id, snapshot.tasks[0].id)
  process.exit(0)
}
