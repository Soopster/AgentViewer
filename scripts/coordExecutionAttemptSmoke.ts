import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executionCooldown, providerRetryAt } from '../lib/coordinatorExecutionAttempts'

const phase = process.argv[2]
if (!phase) {
  const now = Date.parse('2026-10-13T00:00:00Z')
  assert.equal(providerRetryAt('60', now), '2026-10-13T00:01:00.000Z')
  assert.equal(providerRetryAt('Tue, 13 Oct 2026 00:02:00 GMT', now), '2026-10-13T00:02:00.000Z')
  for (const value of [null, '', '-1', 'tomorrow', '99999999999999999999']) assert.equal(providerRetryAt(value, now), undefined)
  const cwd = mkdtempSync(path.join(tmpdir(), 'coord-attempts-'))
  execFileSync('git', ['init', '-q', cwd])
  writeFileSync(path.join(cwd, 'README.md'), 'attempt fixture\n')
  execFileSync('git', ['-C', cwd, 'add', '.'])
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
  for (const step of ['reject', 'reopen']) execFileSync(process.execPath, [fileURLToPath(import.meta.url), step, cwd], { timeout: 20000, stdio: 'inherit' })
  console.log('Execution attempts passed: provider rejection, explicit cooldown gate, immutable session/instance/claim bindings, restart persistence, no replay, role gate and unknown reset evidence.')
} else {
  process.chdir(process.argv[3]!)
  const { mock } = await (0, eval)('import("bun:test")')
  let starts = 0
  mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
    createNewViewSession: async ({ cwd }: { cwd: string }) => {
      writeFileSync('native.json', JSON.stringify({ sessionId: 'native-worker', provider: 'codex', cwd }))
      return { sessionId: 'native-worker', provider: 'codex', isPending: false }
    },
    readViewSessionInfo: async () => JSON.parse(readFileSync('native.json', 'utf8')),
    readViewSessionRunning: () => ({ running: false, pendingPermissions: [], pendingPrompts: [] }),
    streamViewSessionTurn: async () => { starts++; return new Response('', { status: 429, headers: { 'retry-after': '3600' } }) },
  }))
  const coord = await import('../lib/agentCoordination')
  if (phase === 'reject') await coord.configureInteractiveCoordinator({ sessionId: 'lead-chat', provider: 'codex', cwd: process.cwd() })
  const lead = await coord.sessionCoordinatorIdentity('lead-chat', 'codex')
  let agentId: string
  if (phase === 'reject') {
    const created = await coord.createExternalProtocolTask(lead, { assignTo: 'auto', title: 'Keep this assignment', detail: 'Reject with provider cooldown', paths: ['lane.ts'] })
    agentId = created.delegation!.agentId
    writeFileSync('ids.json', JSON.stringify({ agentId }))
    for (let i = 0; i < 500; i++) {
      const status = await coord.readExternalProtocolStatus(lead)
      if (status.snapshot.tasks.find(task => task.id === created.task!.id)?.status === 'blocked') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  } else agentId = JSON.parse(readFileSync('ids.json', 'utf8')).agentId
  const inspection = await coord.inspectExternalProtocolRecovery(lead, agentId)
  const execution = inspection.executions[0]!
  const attempt = execution.attempts[0]!
  assert.equal(execution.attempts.length, 1)
  assert.equal(attempt.state, 'rejected')
  assert.equal(attempt.failureClass, 'rate_limited')
  assert.equal(attempt.sessionId, execution.sessionId)
  assert.equal(attempt.providerInstanceId, 'codex')
  assert.equal(attempt.claimGeneration, execution.recoveryClaim!.claimGeneration)
  assert.equal(attempt.taskId, execution.taskId)
  assert.equal(execution.cooldown!.active, true)
  assert.equal(executionCooldown([attempt], { sessionId: attempt.sessionId, provider: attempt.provider, providerInstanceId: 'other-account', taskId: attempt.taskId }), null)
  assert.equal(executionCooldown([{ ...attempt, retryAt: null }], { sessionId: attempt.sessionId, provider: attempt.provider, taskId: attempt.taskId })!.resetKnown, false)
  await assert.rejects(coord.resumeInteractiveAgent(lead, agentId, false, execution.recoveryClaim!), /cooldown remains active/)
  if (phase === 'reject') {
    const worker = globalThis.__agentViewerCoordinatorControllers!.get(lead.runId)!.sdkIdentities.get(agentId)!
    await assert.rejects(coord.inspectExternalProtocolRecovery(worker), /Only the Coordinator lead/)
  }
  assert.equal(starts, phase === 'reject' ? 1 : 0, 'recovery inspection and cooldown refusal never replay')
  process.exit(0)
}
