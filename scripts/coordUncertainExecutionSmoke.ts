import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (!mode) {
  for (const test of ['worker-stream', 'worker-submit', 'lead-stream', 'lead-submit', 'worker-completed', 'lead-planning']) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), test], { timeout: 20000, stdio: 'inherit' })
  }
  console.log('Uncertain execution passed: accepted-stream and submission failures retain teammate/lead sessions; no failover or replay, native-live and stale-pin rejection, explicit keyed recovery and history retained.')
} else {
  process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-uncertain-')))
  execFileSync('git', ['init', '-q'])
  execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '--allow-empty', '-qm', 'fixture'])
  const { mock } = await (0, eval)('import("bun:test")')
  let creates = 0
  let starts = 0
  let nativeRunning = false
  const sessions = new Map<string, object>()
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async ({ cwd, provider }: { cwd: string; provider: string }) => {
      const sessionId = `native-${++creates}`
      const result = { sessionId, provider, cwd, isPending: false }
      sessions.set(sessionId, result)
      return result
    },
    readViewSessionInfo: async (sessionId: string) => sessions.get(sessionId),
    readViewSessionRunning: () => ({ running: nativeRunning, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async ({ body }: { body: { model?: string; effort?: string } }) => {
      starts++
      if (starts === 2 && mode.startsWith('lead')) {
        assert.equal(body.model, 'pinned-model', 'the resumed send retains its selected model')
        assert.equal(body.effort, 'high', 'the resumed send retains its selected effort')
      }
      if (starts === 1) {
        if (mode.endsWith('submit')) throw new Error('connection reset after submission')
        const controller = [...globalThis.__agentViewerCoordinatorControllers!.values()][0]!
        const agentId = mode.startsWith('lead') ? 'lead' : 'agent-1'
        if (mode === 'worker-completed') {
          const coord = await import('../lib/agentCoordination')
          const worker = controller.sdkIdentities.get(agentId)!
          const taskId = (await coord.readExternalProtocolStatus(worker)).actionable.myTask!.id
          await coord.reportExternalProtocolProgress(worker, { status: 'working', taskId })
          assert.equal((await coord.completeExternalProtocolTask(worker, { taskId, summary: 'Verified before stream disconnect' })).accepted, true)
        }
        const { AGENT_PROTOCOL_VERSION } = await import('../lib/agentProtocol')
        if (mode === 'lead-planning') {
          const coord = await import('../lib/agentCoordination')
          await coord.createExternalProtocolTask(controller.sdkIdentities.get('lead')!, { title: 'Retained plan lane', detail: 'Keep the lane from before observation failed', paths: ['lane.ts'] })
        }
        const finding = '```a2a\n' + JSON.stringify({ version: AGENT_PROTOCOL_VERSION, runId: controller.runId, agentId, type: 'finding', summary: 'Applied work exists' }) + '\n```\n'
        return new Response(finding + 'event: error\ndata: {"error":"connection reset after a tool executed"}\n\n')
      }
      if (starts === 2 && mode === 'lead-planning') {
        const coord = await import('../lib/agentCoordination')
        const controller = [...globalThis.__agentViewerCoordinatorControllers!.values()][0]!
        assert.ok((await coord.readExternalProtocolStatus(controller.sdkIdentities.get('lead')!)).snapshot.tasks.some(task => task.title === 'Retained plan lane'))
        return new Response('')
      }
      return new Response(new ReadableStream<Uint8Array>({ start() {} }))
    },
  }))
  const coord = await import('../lib/agentCoordination')
  const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
    assert.fail('fixture did not settle')
  }
  let identity: import('../lib/agentProtocol').ExternalProtocolIdentity
  let agentId: string
  if (mode.startsWith('lead')) {
    const run = await coord.startProtocolRun({ prompt: 'Retain the whole objective', provider: 'codex', baseCwd: process.cwd(), teammateProviders: ['codex', 'claude'], model: 'pinned-model', effort: 'high', useWorktrees: false })
    identity = globalThis.__agentViewerCoordinatorControllers!.get(run.snapshot.run.id)!.sdkIdentities.get('lead')!
    agentId = 'lead'
  } else {
    await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd(), useWorktrees: false })
    identity = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
    const assigned = await coord.createExternalProtocolTask(identity, { assignTo: 'auto', title: 'Retain applied work', detail: 'Do not replay', paths: ['lane.ts'] })
    agentId = assigned.delegation!.agentId
    globalThis.__agentViewerCoordinatorControllers!.get(identity.runId)!.teammateProviders = ['codex', 'claude']
  }
  const controller = globalThis.__agentViewerCoordinatorControllers!.get(identity.runId)!
  await until(() => starts === 1 && !controller.turnInFlight.has(agentId))
  const inspection = await coord.inspectExternalProtocolRecovery(identity, agentId)
  const execution = inspection.executions[0]!
  assert.equal(execution.needsRecovery, mode !== 'worker-completed')
  assert.equal(execution.attempts[0]!.state, 'uncertain')
  assert.equal(creates, 1, 'a possibly applied execution must not create a failover session')
  await coord.runProtocolMaintenanceSweep()
  assert.equal(starts, 1, 'maintenance must not replay uncertain work')
  if (mode === 'worker-completed') {
    assert.equal(execution.canAcknowledge, true)
    const snapshot = (await coord.readExternalProtocolStatus(identity)).snapshot
    assert.equal(snapshot.tasks[0]!.status, 'completed', 'an observation failure must not reopen completed work')
    await coord.reconcileSettledInteractiveExecution(identity, agentId, execution.reservation!)
    assert.equal(starts, 1, 'acknowledging a completed result does not submit another turn')
    process.exit(0)
  }
  await assert.rejects(coord.resumeInteractiveAgent(identity, agentId, true, execution.recoveryClaim!), /automatic resume is not permitted/)
  nativeRunning = true
  await assert.rejects(coord.resumeInteractiveAgent(identity, agentId, false, execution.recoveryClaim!), /still running/)
  nativeRunning = false
  if (mode.startsWith('lead')) globalThis.__agentViewerCoordinatorControllers!.delete(identity.runId)
  const pins = execution.recoveryClaim!
  const args = { ...identity, action: 'resume_agent', targetAgentId: agentId, expectedTaskId: pins.taskId, expectedSessionId: pins.sessionId, expectedClaimGeneration: pins.claimGeneration, expectedAttemptId: pins.attemptId, requestId: 'explicit-recovery' }
  if (!pins.taskId) await assert.rejects(execute({ ...args, expectedAttemptId: 'stale-attempt', requestId: 'stale-pin' }), /exact recoveryClaim attemptId/)
  const resumed = await execute(args)
  if (mode.startsWith('lead')) {
    const restored = globalThis.__agentViewerCoordinatorControllers!.get(identity.runId)!
    assert.deepEqual(restored.teammateProviders, ['codex', 'claude'], 'recovery preserves the selected provider pool')
    assert.equal(restored.model, 'pinned-model')
    assert.equal(restored.effort, 'high')
    assert.deepEqual(restored.modelSource, { provider: 'codex', providerInstanceId: 'codex' })
  }
  if (mode === 'lead-planning') {
    await until(() => starts >= 3)
    const status = await coord.readExternalProtocolStatus(identity)
    assert.equal(status.snapshot.run.status, 'running')
    assert.ok(status.snapshot.tasks.some(task => task.title === 'Retained plan lane' && task.ownerAgentId?.startsWith('agent-')), 'restored planning must staff and assign its task graph')
    process.exit(0)
  }
  await until(() => starts === 2)
  assert.deepEqual(await execute(args), resumed, 'keyed replay retrieves recovery receipt without dispatching')
  assert.equal(starts, 2)
  const after = await coord.inspectExternalProtocolRecovery(identity, agentId)
  assert.equal(after.executions[0]!.attempts.find(attempt => attempt.id === execution.attempts[0]!.id)!.state, 'reconciled')
  assert.equal(creates, 1, 'explicit recovery preserves the native conversation')
  if (mode.startsWith('lead')) assert.equal(globalThis.__agentViewerCoordinatorControllers!.get(identity.runId)!.interactiveLeadId, undefined, 'restoring a managed lead must retain its execution ownership')
  process.exit(0)
}
