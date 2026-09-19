import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(import.meta.url)
const phase = process.argv[2]
async function until(check: () => boolean) {
  const deadline = Date.now() + 10000
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(check(), 'fixture did not settle')
}
if (!phase) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'coord-hosts-'))
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(path.join(cwd, 'README.md'), 'fixture\n')
  execFileSync('git', ['-C', cwd, 'add', '.'])
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
  const owner = spawn(process.execPath, [script, 'owner', cwd], { stdio: 'ignore' })
  const exited = new Promise(resolve => owner.once('exit', resolve))
  try {
    await until(() => existsSync(path.join(cwd, 'ready.json')))
    execFileSync(process.execPath, [script, 'observer', cwd], { timeout: 20000, stdio: 'pipe' })
    owner.kill('SIGTERM'); await exited
    execFileSync(process.execPath, [script, 'takeover', cwd], { timeout: 20000, stdio: 'pipe' })
  } finally { owner.kill('SIGTERM'); await exited }

  // A process that only runs the maintenance sweep — the AHP sidecar that
  // `agent-viewer web` spawns — must never take ownership. It did: a team is
  // enabled from the TUI, the TUI exits, and the always-running sidecar's sweep
  // resolved the lead identity, which claims the dead owner's team. The
  // restarted TUI then found a live owner and showed "Running in another host".
  const sidecarCwd = mkdtempSync(path.join(tmpdir(), 'coord-sidecar-'))
  execFileSync('git', ['init', '-q', sidecarCwd])
  writeFileSync(path.join(sidecarCwd, 'README.md'), 'fixture\n')
  execFileSync('git', ['-C', sidecarCwd, 'add', '.'])
  execFileSync('git', ['-C', sidecarCwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
  execFileSync(process.execPath, [script, 'enable', sidecarCwd], { timeout: 20000, stdio: 'pipe' })
  const sidecar = spawn(process.execPath, [script, 'sidecar', sidecarCwd], { stdio: 'ignore' })
  const sidecarExited = new Promise(resolve => sidecar.once('exit', resolve))
  try {
    await until(() => existsSync(path.join(sidecarCwd, 'swept.json')))
    execFileSync(process.execPath, [script, 'ui', sidecarCwd], { timeout: 20000, stdio: 'pipe' })
  } finally { sidecar.kill('SIGTERM'); await sidecarExited }
  console.log('Two live hosts: credentials preserved, duplicate dispatch/recovery/stop blocked, dead-owner takeover retains task and session; a sweeping sidecar never claims, a UI read adopts only a dead owner')
} else {
  process.chdir(process.argv[3]!)
  const { mock } = await (0, eval)('import("bun:test")')
  let starts = 0
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async () => {
      assert.equal(phase, 'owner')
      return { provider: 'codex', sessionId: 'worker-session', isPending: false }
    },
    readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async () => { starts++; return new Promise<Response>(() => {}) },
  }))
  const coord = await import('../lib/agentCoordination')
  const hostOwner = async () => {
    const { getDatabase } = coord as unknown as { getDatabase?: never }
    void getDatabase
    const { DatabaseSync } = await (0, eval)('import("node:sqlite")')
    const files = execFileSync('find', ['.agent-viewer-data', '-name', 'coordination.sqlite'], { encoding: 'utf8' }).trim().split('\n')
    const db = new DatabaseSync(files[0], { readOnly: true })
    try { return db.prepare('SELECT owner_pid FROM protocol_interactive_hosts').all() as Array<{ owner_pid: number }> } finally { db.close() }
  }
  if (phase === 'enable') {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
    assert.equal((await hostOwner())[0]?.owner_pid, process.pid, 'enabling from a UI claims the team')
    process.exit(0)
  }
  if (phase === 'sidecar') {
    const enabledBy = (await hostOwner())[0]?.owner_pid
    for (let i = 0; i < 3; i++) await coord.runProtocolMaintenanceSweep()
    assert.equal((await hostOwner())[0]?.owner_pid, enabledBy, 'a maintenance sweep never takes over a team, even from an exited owner')
    writeFileSync('swept.json', JSON.stringify({ pid: process.pid }))
    setInterval(() => { void coord.runProtocolMaintenanceSweep() }, 200)
    await new Promise(() => {})
  }
  if (phase === 'ui') {
    assert.equal((await coord.readInteractiveCoordinator('lead-chat')).executionElsewhere, false, 'an exited owner is not "another host"')
    await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
    assert.equal((await hostOwner())[0]?.owner_pid, process.pid, 'the restarted UI adopts the team while the sidecar is still sweeping')
    await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    process.exit(0)
  }
  if (phase === 'owner') {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
    const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    const task = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Inspect fixture', detail: 'Read-only review' })
    await until(() => starts === 1)
    const worker = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!.sdkIdentities.get('agent-1')!
    writeFileSync('ready.json', JSON.stringify({ lead, worker, taskId: task.task!.id }), { mode: 0o600 })
    setInterval(() => {}, 1000)
  } else {
    const { lead, worker, taskId } = JSON.parse(readFileSync('ready.json', 'utf8'))
    await coord.runProtocolMaintenanceSweep()
    assert.equal(starts, 0, 'observer cannot redispatch reserved work')
    if (phase === 'observer') {
      assert.equal((await coord.readInteractiveCoordinator('lead-chat')).executionElsewhere, true)
      await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
      assert.notEqual((await hostOwner())[0]?.owner_pid, process.pid, 'a UI read never displaces a live owner')
      await assert.rejects(coord.sessionCoordinatorIdentity('lead-chat', 'codex'), /another local Agent Viewer host/)
      await assert.rejects(coord.stopProtocolRun(lead.runId), /another local Agent Viewer host/)
      await assert.rejects(coord.resumeInteractiveAgent(lead, 'agent-1'))
      assert.deepEqual(await coord.readInteractiveRecoveries(lead.runId), [], 'live owner is not a recovery case')
      await coord.reportExternalProtocolProgress(worker, { taskId, status: 'working', summary: 'Original worker credential remains valid' })
      await coord.sendExternalProtocolMessage(lead, { to: 'agent-1', body: 'Original lead credential remains valid', kind: 'status' })
      assert.equal(starts, 0)
    } else {
      assert.deepEqual(await coord.readInteractiveRecoveries(lead.runId), ['agent-1'])
      assert.equal((await coord.readInteractiveCoordinator('lead-chat')).executionElsewhere, false)
      // A UI read adopts the dead owner's team without any user mutation.
      await coord.adoptOrphanedInteractiveHost('lead-chat', 'codex')
      assert.equal((await hostOwner())[0]?.owner_pid, process.pid, 'a UI read adopts a team whose owner exited')
      const restored = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
      await coord.resumeInteractiveAgent(restored, 'agent-1')
      await until(() => starts === 1)
      const snapshot = (await coord.readSessionCoordinator('lead-chat', 'codex'))!
      assert.equal(snapshot.tasks[0].id, taskId)
      assert.equal(snapshot.agents.find(agent => agent.id === 'agent-1')?.sessionId, 'worker-session')
    }
    process.exit(0)
  }
}
