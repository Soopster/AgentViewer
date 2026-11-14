import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-model-inheritance-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'model inheritance fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const instances = await import('../lib/providerInstances')
await instances.writeProviderInstancesFile({ version: 1, instances: [{ id: 'codex-source', provider: 'codex' }, { id: 'codex-other', provider: 'codex' }] })
const { mock } = await (0, eval)('import("bun:test")')
let created = 0
let beforeReplacement: (() => Promise<void>) | undefined
const turns: Array<{ sessionId: string; instanceId: string; body: Record<string, unknown>; release: (response?: Response) => void }> = []
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async ({ provider }: { provider: string }) => {
    const sessionId = `model-session-${++created}`
    if (provider === 'claude' && beforeReplacement) { const hook = beforeReplacement; beforeReplacement = undefined; await hook() }
    return { provider, sessionId, cwd, isPending: false }
  },
  streamViewSessionTurn: async ({ sessionId, body }: { sessionId: string; body: Record<string, unknown> }) => new Promise<Response>(resolve => turns.push({ sessionId, instanceId: instances.currentProviderInstanceId(), body, release: (response = new Response('')) => resolve(response) })),
}))
mock.module(fileURLToPath(new URL('../lib/adapters/registry.ts', import.meta.url)), () => ({
  unsupported: () => { throw new Error('unsupported fixture operation') },
  getSessionAdapter: async () => ({ readProviderModels: async () => ['source-model', 'changed-model'].map(value => ({ value, displayName: value, description: '', supportsEffort: true, supportedEffortLevels: ['low', 'high'] })) }),
}))
const coord = await import('../lib/agentCoordination')
const until = async (predicate: () => boolean | Promise<boolean>) => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) } assert.fail('Coordinator dispatch did not settle') }
const start = await instances.withProviderInstance('codex-source', 'codex', () => coord.startProtocolRun({ provider: 'codex', teammateProviders: ['claude', 'codex'], prompt: 'Verify account-specific model defaults', baseCwd: cwd, maxAgents: 6, model: 'source-model', effort: 'high', useWorktrees: false }))
const identity = await instances.withProviderInstance('codex-source', 'codex', () => coord.sessionCoordinatorIdentity(start.sessions[0]!.sessionId, 'codex'))
const create = (name: string, selection: { requestedProvider?: 'codex' | 'claude'; requestedProviderInstanceId?: string; requestedModel?: string; requestedEffort?: string } = {}) => coord.createExternalProtocolTask(identity, { assignTo: 'auto', teammateName: name, title: name, detail: `Work for ${name}`, ...selection })
const workerTurn = async (name: string) => {
  try { await until(async () => { const agent = (await coord.readExternalProtocolStatus(identity)).snapshot.agents.find(agent => agent.name === name); return Boolean(agent && turns.some(turn => turn.sessionId === agent.sessionId)) }) } catch (error) {
    const snapshot = (await coord.readExternalProtocolStatus(identity)).snapshot
    throw new Error(`Missing ${name} dispatch: ${JSON.stringify({ agents: snapshot.agents.map(agent => ({ name: agent.name, status: agent.status, taskId: agent.taskId })), events: snapshot.events.slice(-4).map(event => ({ summary: event.summary, detail: event.detail })) })}`, { cause: error })
  }
  const agent = (await coord.readExternalProtocolStatus(identity)).snapshot.agents.find(agent => agent.name === name)!
  return turns.find(turn => turn.sessionId === agent.sessionId)!
}
try {
  await until(() => turns.length === 1)
  assert.equal(turns[0]!.body.model, 'source-model')
  assert.equal(turns[0]!.body.effort, 'high')
  await create('inherited')
  const inherited = await workerTurn('inherited')
  assert.equal(inherited.instanceId, 'codex-source')
  assert.equal(inherited.body.model, 'source-model')
  assert.equal(inherited.body.effort, 'high')
  await create('other-account', { requestedProviderInstanceId: 'codex-other' })
  const other = await workerTurn('other-account')
  assert.equal(other.instanceId, 'codex-other')
  assert.equal(other.body.model, undefined)
  assert.equal(other.body.effort, undefined)
  await create('other-driver', { requestedProvider: 'claude' })
  const otherDriver = await workerTurn('other-driver')
  assert.equal(otherDriver.body.model, undefined)
  assert.equal(otherDriver.body.effort, undefined)
  await create('changed-model', { requestedProvider: 'codex', requestedModel: 'changed-model' })
  const changed = await workerTurn('changed-model')
  assert.equal(changed.body.model, 'changed-model')
  assert.equal(changed.body.effort, undefined, 'changed model must not inherit another model\'s effort setting')
  const nativeFailure = () => new Response('event: error\ndata: {"error":"authentication failed"}\n\n')
  const sdk = await import('../lib/agentCoordinationSdkTools')
  const oldIdentity = sdk.getCoordinatorCodexIdentity(inherited.sessionId, 'codex-source')!
  inherited.release(nativeFailure())
  await until(async () => (await coord.readExternalProtocolStatus(identity)).snapshot.agents.some(agent => agent.name === 'inherited' && agent.provider === 'claude'))
  const replacement = await workerTurn('inherited')
  assert.notEqual(replacement.sessionId, inherited.sessionId)
  const recoveredAgent = (await coord.readExternalProtocolStatus(identity)).snapshot.agents.find(agent => agent.name === 'inherited')!
  const newIdentity = globalThis.__agentViewerCoordinatorControllers!.get(identity.runId)!.sdkIdentities.get(recoveredAgent.id)!
  assert.notEqual(newIdentity.token, oldIdentity.token)
  await assert.rejects(coord.readExternalProtocolStatus(oldIdentity), /token|credential|participant/i)
  assert.equal((await coord.readExternalProtocolStatus(newIdentity)).snapshot.run.id, identity.runId)
  assert.equal(sdk.getCoordinatorCodexIdentity(inherited.sessionId, 'codex-source'), undefined)
  assert.ok(sdk.getCoordinatorMcpServers(replacement.sessionId, 'claude'))
  assert.equal(replacement.body.model, undefined)
  assert.equal(replacement.body.effort, undefined)
  await create('same-model-after-recovery', { requestedProvider: 'codex', requestedModel: 'source-model' })
  const healthy = await workerTurn('same-model-after-recovery')
  assert.equal(healthy.body.model, 'source-model')
  assert.equal(healthy.body.effort, 'high', 'another teammate\'s recovery must not erase healthy source-account defaults')
  const beforePinnedFailure = created
  changed.release(nativeFailure())
  await until(async () => (await coord.readExternalProtocolStatus(identity)).snapshot.agents.some(agent => agent.name === 'changed-model' && agent.status === 'blocked'))
  assert.equal(created, beforePinnedFailure, 'explicit selection must not start work on an unrequested replacement provider')

} finally {
  await coord.stopProtocolRun(identity.runId)
  for (const turn of turns) turn.release()
}
// Inject a credential-write failure to prove that a failed recovery cannot
// commit a new provider/session or revoke the old working credential.
const recovery = await instances.withProviderInstance('codex-source', 'codex', () => coord.startProtocolRun({ provider: 'codex', teammateProviders: ['claude', 'codex'], prompt: 'Atomic SDK recovery', baseCwd: cwd, maxAgents: 2, useWorktrees: false }))
const recoveryIdentity = await instances.withProviderInstance('codex-source', 'codex', () => coord.sessionCoordinatorIdentity(recovery.sessions[0]!.sessionId, 'codex'))
const { Database } = await (0, eval)('import("bun:sqlite")')
const database = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
try {
  await coord.createExternalProtocolTask(recoveryIdentity, { assignTo: 'auto', teammateName: 'rollback', title: 'Rollback', detail: 'Preserve identity when credential write fails' })
  const worker = (await coord.readExternalProtocolStatus(recoveryIdentity)).snapshot.agents.find(agent => agent.name === 'rollback')!
  await until(() => turns.some(turn => turn.sessionId === worker.sessionId))
  const turn = turns.find(turn => turn.sessionId === worker.sessionId)!
  const sdk = await import('../lib/agentCoordinationSdkTools')
  const oldIdentity = sdk.getCoordinatorCodexIdentity(worker.sessionId, 'codex-source')!
  database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('fixture_recovery_run', ?)").run(recoveryIdentity.runId)
  database.exec(`CREATE TRIGGER reject_fixture_recovery_token BEFORE INSERT ON protocol_participant_tokens
    WHEN NEW.agent_id = 'agent-1' AND NEW.run_id = (SELECT value FROM meta WHERE key = 'fixture_recovery_run')
    BEGIN SELECT RAISE(ABORT, 'fixture credential rejection'); END`)
  turn.release(new Response('event: error\ndata: {"error":"authentication failed"}\n\n'))
  await until(async () => (await coord.readExternalProtocolStatus(recoveryIdentity)).snapshot.agents.some(agent => agent.name === 'rollback' && agent.status === 'blocked'))
  const after = (await coord.readExternalProtocolStatus(recoveryIdentity)).snapshot
  const unchanged = after.agents.find(agent => agent.name === 'rollback')!
  assert.equal(unchanged.provider, 'codex')
  assert.equal(unchanged.providerInstanceId, 'codex-source')
  assert.equal(unchanged.sessionId, worker.sessionId)
  assert.ok(!after.events.some(event => event.payload?.reason === 'provider_recovery'), 'failed transaction must not retain a recovery attempt')
  assert.ok(after.events.some(event => event.detail?.includes('fixture credential rejection')))
  assert.equal((await coord.readExternalProtocolStatus(oldIdentity)).snapshot.run.id, recoveryIdentity.runId)
  assert.strictEqual(sdk.getCoordinatorCodexIdentity(worker.sessionId, 'codex-source'), oldIdentity)
  assert.equal(globalThis.__agentViewerCoordinatorControllers!.get(recoveryIdentity.runId)!.sessionIds.get(worker.id), worker.sessionId)
  assert.equal(sdk.getCoordinatorMcpServers(`model-session-${created}`, 'claude'), undefined)
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM protocol_participant_tokens WHERE run_id = ? AND agent_id = ?').get(recoveryIdentity.runId, worker.id).n, 1)
  console.log('Model inheritance/recovery passed: managed transport defaults by account, changed-model effort reset, successful token rotation, healthy defaults preserved, explicit selection blocked on failure, and fault-injected atomic rollback preserving the original session/tools/token.')
} finally {
  database.exec('DROP TRIGGER IF EXISTS reject_fixture_recovery_token')
  database.close()
  await coord.stopProtocolRun(recoveryIdentity.runId)
  for (const turn of turns) turn.release()
}
// A stop racing provider creation remains authoritative at the atomic commit.
const stopped = await instances.withProviderInstance('codex-source', 'codex', () => coord.startProtocolRun({ provider: 'codex', teammateProviders: ['claude', 'codex'], prompt: 'Stop while recovery is creating a session', baseCwd: cwd, maxAgents: 2, useWorktrees: false }))
const stoppedIdentity = await instances.withProviderInstance('codex-source', 'codex', () => coord.sessionCoordinatorIdentity(stopped.sessions[0]!.sessionId, 'codex'))
try {
  await coord.createExternalProtocolTask(stoppedIdentity, { assignTo: 'auto', teammateName: 'stop-race', title: 'Stop race', detail: 'Keep the human stop authoritative' })
  const worker = (await coord.readExternalProtocolStatus(stoppedIdentity)).snapshot.agents.find(agent => agent.name === 'stop-race')!
  await until(() => turns.some(turn => turn.sessionId === worker.sessionId))
  let replacementReturned = false
  beforeReplacement = async () => { await coord.stopProtocolRun(stoppedIdentity.runId); replacementReturned = true }
  turns.find(turn => turn.sessionId === worker.sessionId)!.release(new Response('event: error\ndata: {"error":"authentication failed"}\n\n'))
  await until(() => replacementReturned)
  await until(() => !globalThis.__agentViewerCoordinatorControllers!.has(stoppedIdentity.runId))
  // Allow the replacement promise continuation and transaction to finish.
  await new Promise(resolve => setTimeout(resolve, 30))
  const after = (await coord.readExternalProtocolStatus(stoppedIdentity)).snapshot
  assert.equal(after.run.status, 'stopped')
  const unchanged = after.agents.find(agent => agent.name === 'stop-race')!
  assert.equal(unchanged.status, 'stopped')
  assert.equal(unchanged.provider, 'codex')
  assert.equal(unchanged.sessionId, worker.sessionId)
  assert.ok(!after.events.some(event => event.payload?.reason === 'provider_recovery'))
  const sdk = await import('../lib/agentCoordinationSdkTools')
  assert.equal(sdk.getCoordinatorMcpServers(`model-session-${created}`, 'claude'), undefined)
  console.log('Recovery stop race passed: stopped run/agent remain stopped, original native identity retained, no recovery attempt or replacement tool binding committed.')
} finally {
  beforeReplacement = undefined
  await coord.stopProtocolRun(stoppedIdentity.runId)
  for (const turn of turns) turn.release()
}
process.exit(0)
