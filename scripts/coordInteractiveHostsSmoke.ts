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
    console.log('Two live hosts: credentials preserved, duplicate dispatch/recovery/stop blocked, dead-owner takeover retains task and session')
  } finally { owner.kill('SIGTERM'); await exited }
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
