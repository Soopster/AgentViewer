import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExternalProtocolIdentity } from '../lib/agentProtocol'
import type { TuiSessionCoordinationRequest } from '../lib/tui/service'

const phase = process.argv[2]
if (!phase) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'coord-tui-restart-'))
  try {
    execFileSync('git', ['init', '-q', fixture])
    writeFileSync(path.join(fixture, 'README.md'), 'fixture\n')
    execFileSync('git', ['-C', fixture, 'add', '.'])
    execFileSync('git', ['-C', fixture, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
    for (const step of ['accepted', 'recover', 'settled']) {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), step, fixture], { timeout: 15_000, stdio: 'pipe' })
    }
    console.log('TUI process restart: accepted request survives lost response, explicit retry creates one ledger task, confirmed request clears; scope and journal failures isolated')
  } finally { rmSync(fixture, { recursive: true, force: true }) }
} else {
  process.chdir(process.argv[3]!)
  delete process.env.AGENT_VIEWER_ATTACH
  const coord = await import('../lib/agentCoordination')
  const identity: ExternalProtocolIdentity = phase === 'accepted'
    ? (await coord.createExternalProtocolRun({ baseCwd: process.cwd(), provider: 'codex', prompt: 'Request recovery fixture', participantName: 'lead' })).participant
    : JSON.parse(readFileSync('identity.json', 'utf8'))
  if (phase === 'accepted') writeFileSync('identity.json', JSON.stringify(identity), { mode: 0o600 })
  const data = { snapshot: null, interactive: { enabled: true, autoContinue: false, remainingTurns: 4, delivery: null }, recoveries: [], permissions: [], runningAgentIds: [] }
  const { mock } = await (0, eval)('import("bun:test")')
  let sends = 0
  mock.module(fileURLToPath(new URL('../lib/tui/service.ts', import.meta.url)), () => ({
    readTuiSessionCoordinator: async () => data,
    subscribeTuiProtocolRunChanges: () => () => {},
    sendTuiSessionCoordination: async (_sessionId: string, _provider: string, request: TuiSessionCoordinationRequest) => {
      sends++
      await coord.runExternalProtocolIdempotent(identity, 'tui_recovery_test', request.requestId, () => coord.createExternalProtocolTask(identity, {
        title: request.detail, detail: request.detail,
      }))
      if (phase === 'accepted') {
        writeFileSync('request.json', JSON.stringify(request), { mode: 0o600 })
        // Exit after the server committed the effect, before its response reaches the TUI.
        process.exit(0)
      }
      assert.deepEqual(request, JSON.parse(readFileSync('request.json', 'utf8')))
      return data
    },
  }))
  const store = await import('../tui/opentui/interactiveCoordinatorStore')
  const journal = await import('../lib/tui/coordinatorRequests')
  const session = { sessionId: 'lead-chat', provider: 'codex' as const, title: 'Restart fixture', cwd: process.cwd() }
  store.openInteractiveCoordinator(session)
  await new Promise(resolve => setTimeout(resolve, 0))
  const scope = journal.coordinatorRequestScope(session.provider, session.sessionId)
  if (phase === 'accepted') {
    await store.runInteractiveCoordinatorAction({ action: 'delegate', detail: 'Exactly one durable task', to: 'auto' })
    assert.fail('fixture should exit after committed effect')
  }
  assert.equal(sends, 0, 'restoring the panel must not replay a request automatically')
  assert.equal((await coord.readExternalProtocolStatus(identity)).snapshot.tasks.length, 1)
  if (phase === 'recover') {
    const original = JSON.parse(readFileSync('request.json', 'utf8'))
    assert.deepEqual(store.getInteractiveCoordinatorState().pending, original)
    assert.match(store.getInteractiveCoordinatorState().error!, /unconfirmed/)
    assert.equal(store.getInteractiveCoordinatorState().busy, false)
    assert.equal(await store.runInteractiveCoordinatorAction({ action: 'delegate', detail: 'A different task' }), false)
    assert.equal(sends, 0, 'a new action cannot silently retry the restored request')
    const directory = path.join(process.cwd(), '.agent-viewer-data', 'coordinator-requests-v1')
    const recordDir = path.join(directory, readdirSync(directory)[0]!)
    assert.equal(statSync(path.join(recordDir, readdirSync(recordDir)[0]!)).mode & 0o777, 0o600)
    process.env.AGENT_VIEWER_ATTACH = 'http://127.0.0.1:9999'
    assert.equal(journal.readPendingCoordinatorRequest(journal.coordinatorRequestScope('codex', session.sessionId)), null, 'remote host must not inherit a local request')
    delete process.env.AGENT_VIEWER_ATTACH
    assert.equal(journal.readPendingCoordinatorRequest(journal.coordinatorRequestScope('claude', session.sessionId)), null, 'provider identities are distinct')
    assert.equal(await store.retryInteractiveCoordinatorAction(), true)
    assert.equal(sends, 1)
    assert.equal((await coord.readExternalProtocolStatus(identity)).snapshot.tasks.length, 1, 'retry must use real ledger idempotency')
  }
  assert.equal(store.getInteractiveCoordinatorState().pending, null)
  assert.equal(journal.readPendingCoordinatorRequest(scope), null)
  if (phase === 'settled') {
    const pending = { action: 'message' as const, detail: 'Saved for inspection', requestId: 'held-request', to: 'lead' }
    journal.reserveCoordinatorRequest(scope, pending)
    assert.throws(() => journal.reserveCoordinatorRequest(scope, { ...pending, requestId: 'different' }), journal.PendingCoordinatorRequestError)
    store.closeInteractiveCoordinator(); store.openInteractiveCoordinator(session)
    assert.deepEqual(store.getInteractiveCoordinatorState().pending, pending)
    store.discardInteractiveCoordinatorAction()
    assert.equal(journal.readPendingCoordinatorRequest(scope), null)
    journal.reserveCoordinatorRequest(scope, pending)
    const root = path.join(process.cwd(), '.agent-viewer-data', 'coordinator-requests-v1')
    const directory = path.join(root, readdirSync(root)[0]!)
    const file = path.join(directory, readdirSync(directory).find(file => file.endsWith('.json'))!)
    writeFileSync(file, '{invalid')
    assert.throws(() => journal.readPendingCoordinatorRequest(scope))
    assert.equal(await store.runInteractiveCoordinatorAction({ action: 'delegate', detail: 'Must not reach server' }), false)
    assert.equal(sends, 0, 'a corrupt journal must not permit a new submission')
    store.resetInteractiveCoordinatorStore()
    rmSync(root, { recursive: true, force: true })
    writeFileSync(root, 'not a directory')
    store.openInteractiveCoordinator(session)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.match(store.getInteractiveCoordinatorState().error!, /Could not read unconfirmed/)
    assert.equal(await store.runInteractiveCoordinatorAction({ action: 'delegate', detail: 'Cannot save this request' }), false)
    assert.equal(sends, 0, 'failed persistence must prevent submission')
  }
  store.resetInteractiveCoordinatorStore()
  mock.restore()
  process.exit(0)
}
