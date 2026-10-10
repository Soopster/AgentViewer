import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const restarting = ['--restart', '--upgrade'].includes(process.argv[2]!)
const cwd = restarting ? process.argv[3]! : mkdtempSync(path.join(tmpdir(), 'coord-instances-'))
process.chdir(cwd)
if (!restarting) {
  execFileSync('git', ['init', '-q'])
  writeFileSync('README.md', 'provider instance fixture\n')
  execFileSync('git', ['add', '.'])
  execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
}
const instances = await import('../lib/providerInstances')
const { mock } = await (0, eval)('import("bun:test")')
const creations: string[] = []
const turns: Array<{ instance: string; release: () => void }> = []
let collide = false
let failNext = false
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  readViewSessionInfo: async (sessionId: string, provider: string) => ({ sessionId, provider, providerInstanceId: instances.currentProviderInstanceId(), cwd }),
  readViewSessionRunning: () => ({ running: false, pendingPermissions: [] }),
  createNewViewSession: async ({ provider }: { provider: string }) => {
    const instance = instances.currentProviderInstanceId(provider as 'claude')
    creations.push(instance)
    return { provider, sessionId: collide ? 'instance-session-1' : `instance-session-${creations.length}`, isPending: false }
  },
  streamViewSessionTurn: async () => {
    const instance = instances.currentProviderInstanceId()
    if (failNext) { failNext = false; turns.push({ instance, release: () => {} }); return new Response('event: error\ndata: {"error":"authentication denied"}\n\n') }
    return new Promise<Response>(resolve => turns.push({ instance, release: () => resolve(new Response('')) }))
  },
}))
const catalogs: string[] = []
mock.module(fileURLToPath(new URL('../lib/adapters/registry.ts', import.meta.url)), () => ({
  unsupported: () => { throw new Error('unsupported fixture operation') },
  getSessionAdapter: async () => ({ readProviderModels: async () => {
    const instance = instances.currentProviderInstanceId()
    catalogs.push(instance)
    await new Promise(resolve => setTimeout(resolve, 5))
    return [{ value: `${instance}-model`, displayName: instance, description: 'fixture', supportsEffort: false }]
  } }),
}))
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const { inspectRecoveryAgent } = await import('../lib/coordinatorRecoveryServer')
const { Database } = await (0, eval)('import("bun:sqlite")')
const until = async (predicate: () => boolean | Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) } assert.fail('Coordinator did not settle') }
if (restarting) {
  const fixture = JSON.parse(readFileSync('.agent-viewer-data/instance-fixture.json', 'utf8'))
  const snapshot = (await coord.readExternalProtocolStatus(fixture.identity)).snapshot
  if (process.argv[2] === '--upgrade') {
    assert.ok(snapshot.agents.every(agent => agent.providerInstanceId === agent.provider))
    assert.ok(snapshot.tasks.every(task => !task.requestedProviderInstanceId))
    const db = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '26')
    assert.ok(db.prepare('PRAGMA table_info(protocol_agents)').all().some((column: { name: string }) => column.name === 'provider_instance_id'))
    assert.ok(db.prepare('PRAGMA table_info(protocol_tasks)').all().some((column: { name: string }) => column.name === 'requested_provider_instance_id'))
    db.close()
    process.exit(0)
  }
  const worker = snapshot.agents.find(agent => agent.name === 'primary')!
  assert.equal(worker.providerInstanceId, 'claude-work')
  assert.equal(snapshot.tasks.find(task => task.ownerAgentId === worker.id)!.requestedProviderInstanceId, 'claude-work')
  assert.equal((await inspectRecoveryAgent(worker)).conversation.available, true)
  const db = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '26')
  db.close()
  // Resume requires prior execution reconciliation, but capability reads and
  // recovery inspection must already use the durable account in a fresh host.
  const catalog = await coord.readExternalCoordinatorCapabilities(fixture.identity)
  assert.equal(catalog.providerInstanceId, 'codex-work')
  process.exit(0)
}
await instances.writeProviderInstancesFile({ version: 1, instances: [
  { id: 'claude-work', provider: 'claude', displayName: 'Work', environment: { FIXTURE_SECRET: 'never-public' } },
  { id: 'claude-lab', provider: 'claude', displayName: 'Lab' },
  { id: 'codex-work', provider: 'codex', displayName: 'Codex work' },
] })
let runId = ''
try {
  await instances.withProviderInstance('codex-work', 'codex', () => coord.configureInteractiveCoordinator({ sessionId: 'chat', provider: 'codex', cwd, maxAgents: 8, useWorktrees: false }))
  const identity = await coord.sessionCoordinatorIdentity('chat', 'codex')
  runId = identity.runId
  const { POST, GET } = await import('../app/api/sessions/[sessionId]/coordination/route')
  const settings = await POST(new Request('http://localhost/api/sessions/chat/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', providerInstanceId: 'codex-work', action: 'settings', detail: 'Keep account', requestId: 'instance-settings' }) }), { params: Promise.resolve({ sessionId: 'chat' }) })
  assert.equal(settings.status, 200, await settings.clone().text())
  const webCatalog = await GET(new Request('http://localhost/api/sessions/chat/coordination?provider=codex&providerInstanceId=codex-work&inspect=capabilities&targetProvider=claude&targetProviderInstanceId=claude-lab'), { params: Promise.resolve({ sessionId: 'chat' }) })
  assert.equal((await webCatalog.json()).providerInstanceId, 'claude-lab')
  await (await import('../lib/tui/service')).sendTuiSessionCoordination('chat', 'codex', { providerInstanceId: 'codex-work', action: 'settings', detail: 'Keep account', requestId: 'instance-settings-tui', cwd })
  catalogs.length = 0
  const { readCoordinatorCapabilities } = await import('../lib/coordinatorCapabilities')
  const concurrent = await Promise.all([readCoordinatorCapabilities('claude', cwd, 'claude-work'), readCoordinatorCapabilities('claude', cwd, 'claude-lab'), readCoordinatorCapabilities('claude', cwd, 'claude-work')])
  assert.strictEqual(concurrent[0], concurrent[2])
  assert.equal(concurrent[0]!.models[0]!.value, 'claude-work-model')
  assert.equal(concurrent[1]!.models[0]!.value, 'claude-lab-model')
  assert.deepEqual(catalogs, ['claude-work', 'claude-lab'])
  const publicCatalog = await coord.readExternalCoordinatorCapabilities(identity)
  assert.equal(publicCatalog.providerInstanceId, 'codex-work')
  assert.equal((await coord.readExternalCoordinatorCapabilities(identity, undefined, 'claude-work')).provider, 'claude')
  assert.ok(publicCatalog.instances.some(instance => instance.id === 'claude-work'))
  assert.ok(!JSON.stringify(publicCatalog).includes('never-public'))
  assert.ok(publicCatalog.instances.every(instance => !('environment' in instance) && !('executable' in instance)))
  const delegate = (instance: string | undefined, name: string, requestId = name) => execute({ ...identity, action: 'create_task', assignTo: 'auto', teammateName: name, title: name, detail: `Work for ${name}`, requestedProvider: instance ? undefined : 'codex', requestedProviderInstanceId: instance, requestedModel: `${instance ?? 'codex-work'}-model`, requestId })
  const first = await delegate('claude-work', 'primary') as { task: { id: string; requestedProviderInstanceId: string } }
  await delegate('claude-lab', 'secondary')
  await delegate(undefined, 'inherited')
  await until(() => turns.length === 3)
  assert.deepEqual(creations, ['claude-work', 'claude-lab', 'codex-work'])
  assert.deepEqual(turns.map(turn => turn.instance), creations)
  assert.equal(first.task.requestedProviderInstanceId, 'claude-work')
  await assert.rejects(delegate('missing-account', 'missing'), /Unknown or disabled/)
  await assert.rejects(execute({ ...identity, action: 'create_task', assignTo: 'auto', title: 'Wrong kind', detail: 'Wrong kind', requestedProvider: 'codex', requestedProviderInstanceId: 'claude-work', requestId: 'wrong-kind' }), /uses claude/)
  await assert.rejects(execute({ ...identity, action: 'create_task', assignTo: 'primary', title: 'Wrong instance', detail: 'Wrong instance', requestedProviderInstanceId: 'claude-lab', requestId: 'wrong-account' }), /uses provider instance/)
  assert.equal(creations.length, 3)
  collide = true
  await assert.rejects(delegate('claude-lab', 'collision'), /ambiguous runtime binding/)
  collide = false
  assert.equal((await coord.readExternalProtocolStatus(identity)).snapshot.agents.length, 4, 'collision must not bind another participant')
  failNext = true
  await delegate('claude-lab', 'pinned-failure')
  await until(async () => (await coord.readExternalProtocolStatus(identity)).snapshot.agents.some(agent => agent.name === 'pinned-failure' && agent.status === 'blocked'))
  assert.equal(creations.length, 5, 'pinned failure must not create a cross-provider replacement')
  await instances.withProviderInstance('claude-lab', 'claude', () => coord.joinSessionToCoordinatorRun({ runId, sessionId: 'cooperative-custom', provider: 'claude', cwd, name: 'cooperative' }))
  assert.equal((await coord.readExternalProtocolStatus(identity)).snapshot.agents.find(agent => agent.name === 'cooperative')!.providerInstanceId, 'claude-lab')
  await assert.rejects(instances.withProviderInstance('claude-lab', 'claude', () => coord.joinSessionToCoordinatorRun({ runId, sessionId: 'instance-session-1', provider: 'claude', cwd, name: 'wrong-cooperative' })), /ambiguous runtime binding/)
  writeFileSync('.agent-viewer-data/instance-fixture.json', JSON.stringify({ identity }))
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--restart', cwd], { cwd, stdio: 'pipe' })
  // Migrate a v25 copy with both columns absent; preserve the original run.
  const legacy = mkdtempSync(path.join(tmpdir(), 'coord-instance-upgrade-'))
  mkdirSync(path.join(legacy, '.agent-viewer-data/agent-coordination'), { recursive: true })
  writeFileSync(path.join(legacy, '.agent-viewer-data/instance-fixture.json'), JSON.stringify({ identity }))
  const db = new Database('.agent-viewer-data/agent-coordination/coordination.sqlite')
  const legacyFile = path.join(legacy, '.agent-viewer-data/agent-coordination/coordination.sqlite')
  db.prepare('VACUUM INTO ?').run(legacyFile)
  db.close()
  const old = new Database(legacyFile)
  old.exec('ALTER TABLE protocol_agents DROP COLUMN provider_instance_id')
  old.exec('ALTER TABLE protocol_tasks DROP COLUMN requested_provider_instance_id')
  old.prepare("UPDATE meta SET value = '25' WHERE key = 'schema_version'").run()
  old.close()
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--upgrade', legacy], { cwd: legacy, stdio: 'pipe' })
  // Disabled accounts still recover the exact idempotent receipt, without
  // rediscovery or a newly created agent/session.
  await instances.writeProviderInstancesFile({ version: 1, instances: [{ id: 'claude-work', provider: 'claude', enabled: false }] })
  const replay = await delegate('claude-work', 'primary') as typeof first
  assert.equal(replay.task.id, first.task.id)
  assert.equal(creations.length, 5)
  assert.equal((await inspectRecoveryAgent((await coord.readExternalProtocolStatus(identity)).snapshot.agents.find(agent => agent.name === 'primary')!)).conversation.available, false)
  console.log('Provider instance smoke passed: separate catalogs, scoped create/dispatch, inherited lead account, public metadata only, wrong/disabled instance rejection, collision guard, pinned failure, durable restart, and exact retry.')
} finally {
  if (runId) await coord.stopProtocolRun(runId)
  for (const turn of turns) turn.release()
}
process.exit(0)
