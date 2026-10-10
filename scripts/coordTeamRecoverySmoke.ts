import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const phase = process.argv[2]
const until = async (check: () => boolean) => { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) } assert.fail('fixture did not settle') }
if (!phase) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'coord-team-recovery-'))
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(path.join(cwd, 'README.md'), 'fixture\n')
  execFileSync('git', ['-C', cwd, 'add', '.'])
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
  const owner = spawn(process.execPath, [script, 'owner', cwd], { stdio: 'pipe' })
  let errors = ''; owner.stderr.on('data', chunk => { errors += chunk })
  const exited = new Promise(resolve => owner.once('exit', resolve))
  try {
    await until(() => existsSync(path.join(cwd, 'ready.json')) || owner.exitCode !== null)
    assert.ok(existsSync(path.join(cwd, 'ready.json')), errors)
    owner.kill('SIGKILL'); await exited
    assert.equal(owner.signalCode, 'SIGKILL', 'the execution host was actually killed')
    execFileSync(process.execPath, [script, 'restarted', cwd], { timeout: 20000, stdio: 'pipe' })
    execFileSync(process.execPath, [script, 'reopened', cwd], { timeout: 20000, stdio: 'pipe' })
    console.log('Team recovery passed: killed execution host around pending submission and persisted completion, refreshed/reopened observation without replay, unavailable directory/native session retained, explicit keyed resume, terminal acknowledgement without a turn, and all tasks/results retained.')
  } finally { owner.kill('SIGKILL'); await exited }
} else {
  process.chdir(process.argv[3]!)
  const { mock } = await (0, eval)('import("bun:test")')
  let created = 0; let starts = 0; let unavailable = false; let mismatch = false; let alias: string | null = null
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async ({ cwd }: { cwd: string }) => {
      assert.equal(phase, 'owner', 'restoring must not create a replacement session')
      const sessionId = `native-${++created}`
      writeFileSync(`${sessionId}.json`, JSON.stringify({ sessionId, provider: 'codex', cwd }))
      return { provider: 'codex', sessionId, isPending: false }
    },
    readViewSessionInfo: async (sessionId: string) => {
      if (unavailable) return null
      if (mismatch) return { sessionId: 'different-native-session', provider: 'codex', cwd: process.cwd() }
      const info = sessionId === 'lead-chat' ? { sessionId, provider: 'codex', cwd: process.cwd() } : JSON.parse(readFileSync(`${sessionId}.json`, 'utf8'))
      return alias && sessionId === 'native-2' ? { ...info, cwd: alias } : info
    },
    readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async () => { starts++; return new Promise<Response>(() => {}) },
  }))
  const coord = await import('../lib/agentCoordination')
  const { inspectCoordinatorRecovery } = await import('../lib/coordinatorRecoveryServer')
  const { recoveryOverview } = await import('../lib/coordinatorRecovery')
  const service = await import('../lib/tui/service')
  if (phase === 'owner') {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
    const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    const completed = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Completed review', detail: 'Read-only review' })
    await until(() => starts === 1)
    const controller = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!
    const worker = controller.sdkIdentities.get(completed.delegation!.agentId)!
    await coord.reportExternalProtocolProgress(worker, { status: 'working', taskId: completed.task!.id })
    assert.equal((await coord.completeExternalProtocolTask(worker, { taskId: completed.task!.id, summary: 'Persisted result before host death' })).accepted, true)
    const pending = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Unfinished review', detail: 'Retain this work' })
    await until(() => starts === 2)
    await coord.reportExternalProtocolProgress(controller.sdkIdentities.get(pending.delegation!.agentId)!, { status: 'working', taskId: pending.task!.id })
    writeFileSync('ready.json', JSON.stringify({ completedAgent: completed.delegation!.agentId, pendingAgent: pending.delegation!.agentId, pendingTask: pending.task!.id, completedTask: completed.task!.id }))
    setInterval(() => {}, 1000)
    await new Promise(() => {})
  }
  const ids = JSON.parse(readFileSync('ready.json', 'utf8'))
  await coord.runProtocolMaintenanceSweep()
  let state = await service.readTuiSessionCoordinator('lead-chat', 'codex')
  assert.equal(starts, 0, 'observation and maintenance never resend')
  assert.equal(state.snapshot!.tasks.length, 2)
  assert.equal(state.snapshot!.tasks.find(task => task.id === ids.completedTask)!.resultSummary, 'Persisted result before host death')
  if (phase === 'reopened') {
    assert.equal(state.settledExecutions!.includes(ids.completedAgent), false, 'acknowledgement persists after another process reopen')
    assert.ok(state.recoveries.includes(ids.pendingAgent), 'unfinished recovered stream remains explicit after the client exits')
    assert.equal(starts, 0)
    process.exit(0)
  }
  assert.ok(state.settledExecutions!.includes(ids.completedAgent))
  const { GET, POST } = await import('../app/api/sessions/[sessionId]/coordination/route')
  const inspectedRoute = await GET(new Request('http://localhost/api/sessions/lead-chat/coordination?provider=codex&inspect=recovery'), { params: Promise.resolve({ sessionId: 'lead-chat' }) })
  assert.equal(inspectedRoute.status, 200)
  assert.equal((await inspectedRoute.json()).inspection.runId, state.snapshot!.run.id)
  assert.equal(starts, 0, 'web recovery inspection never launches work')
  const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
  let inspection = await inspectCoordinatorRecovery(state.snapshot!)
  let rows = recoveryOverview(state, inspection)
  assert.equal(rows.find(row => row.agentId === ids.completedAgent)!.canResume, false)
  assert.equal(rows.find(row => row.agentId === ids.completedAgent)!.canReconcile, true)
  const agent = state.snapshot!.agents.find(agent => agent.id === ids.pendingAgent)!
  alias = path.join(process.cwd(), 'native-directory-alias')
  symlinkSync(agent.worktreePath, alias, 'dir')
  assert.equal((await inspectCoordinatorRecovery(state.snapshot!)).evidence.find(item => item.agentId === agent.id)!.conversation.available, true, 'a symlink spelling of the same directory is valid')
  unlinkSync(alias); alias = null
  const missingPath = `${agent.worktreePath}-temporarily-missing`
  renameSync(agent.worktreePath, missingPath)
  try {
    inspection = await inspectCoordinatorRecovery(state.snapshot!)
    assert.equal(recoveryOverview(state, inspection).find(row => row.agentId === ids.pendingAgent)!.canResume, false)
    await assert.rejects(coord.resumeInteractiveAgent(lead, ids.pendingAgent), /directory is unavailable/)
    assert.ok((await coord.readInteractiveRecoveries(lead.runId)).includes(ids.pendingAgent))
    assert.equal(starts, 0)
  } finally { renameSync(missingPath, agent.worktreePath) }
  unavailable = true
  await assert.rejects(coord.resumeInteractiveAgent(lead, ids.pendingAgent), /native conversation is unavailable/)
  assert.ok((await coord.readInteractiveRecoveries(lead.runId)).includes(ids.pendingAgent))
  unavailable = false
  mismatch = true
  await assert.rejects(coord.resumeInteractiveAgent(lead, ids.pendingAgent), /different conversation identity/)
  mismatch = false
  assert.equal(starts, 0, 'a changed native identity never receives the old task')
  const acknowledge = { action: 'reconcile-agent' as const, requestId: 'ack-completed', to: ids.completedAgent, detail: 'Inspected persisted terminal result' }
  const acknowledgedRoute = await POST(new Request('http://localhost/api/sessions/lead-chat/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', ...acknowledge }) }), { params: Promise.resolve({ sessionId: 'lead-chat' }) })
  assert.equal(acknowledgedRoute.status, 200, await acknowledgedRoute.clone().text())
  await service.sendTuiSessionCoordination('lead-chat', 'codex', acknowledge)
  assert.equal(starts, 0, 'acknowledging settled execution never starts a provider turn')
  const request = { action: 'resume-agent' as const, requestId: 'resume-once', to: ids.pendingAgent, detail: 'Inspected saved transcript and owned work' }
  await service.sendTuiSessionCoordination('lead-chat', 'codex', request)
  await until(() => starts === 1)
  await service.sendTuiSessionCoordination('lead-chat', 'codex', request)
  assert.equal(starts, 1)
  assert.equal(created, 0)
  state = await service.readTuiSessionCoordinator('lead-chat', 'codex')
  assert.equal(state.snapshot!.agents.find(entry => entry.id === agent.id)!.sessionId, agent.sessionId)
  assert.equal(state.snapshot!.tasks.find(task => task.id === ids.pendingTask)!.ownerAgentId, agent.id)
  assert.equal(state.snapshot!.tasks.length, 2)
  assert.equal(state.snapshot!.tasks.find(task => task.id === ids.completedTask)!.status, 'completed')
  process.exit(0)
}
