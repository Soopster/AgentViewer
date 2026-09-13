import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-interactive-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
const runtime = await import('../lib/sessionRuntime')
let autoTurns = 0
let releaseAuto: (() => void) | null = null
const nativePermissions = new Map<string, Record<string, unknown>[]>()
mock.module(fileURLToPath(new URL('../lib/sessionBackend.ts', import.meta.url)), () => ({
  createNewViewSession: async () => { throw new Error('unexpected managed spawn') },
  readViewSessionInfo: async () => ({ provider: 'codex', cwd }),
  readViewSessionRunning: (sessionId: string) => ({ ...runtime.getRunningSessionInfo(sessionId), pendingPermissions: nativePermissions.get(sessionId) ?? [], pendingPrompts: [] }),
  streamViewSessionTurn: async ({ sessionId }: { sessionId: string }) => {
    assert.equal(sessionId, 'primary-chat', 'only the opted-in lead should resume in this fixture')
    autoTurns++
    runtime.setRunningSession(sessionId, { provider: 'codex', interrupt: async () => releaseAuto?.() })
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      releaseAuto = () => {
        controller.enqueue(new TextEncoder().encode('data: {"type":"assistant","text":"Reviewed teammate results"}\n\n'))
        controller.close(); runtime.clearRunningSession(sessionId)
      }
    } }))
  },
}))
const coord = await import('../lib/agentCoordination')
const { POST, GET } = await import('../app/api/sessions/[sessionId]/coordination/route')
const context = { params: Promise.resolve({ sessionId: 'primary-chat' }) }
async function post(body: Record<string, unknown>) {
  const response = await POST(new Request('http://localhost/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'codex', ...body }) }), context)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}
async function until(predicate: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('condition did not settle')
}
const clean = () => new Response('data: {"type":"assistant","text":"received"}\n\n')
const state = () => coord.readInteractiveCoordinator('primary-chat')
let runId = ''
try {
  const enabled = await post({ action: 'enable', requestId: 'enable', detail: 'Enable coordinator' })
  runId = enabled.snapshot.run.id
  assert.equal(enabled.interactive.enabled, true)
  assert.equal(enabled.snapshot.tasks.length, 0, 'enabling does not require first delegating through a panel')
  const lead = await coord.sessionCoordinatorIdentity('primary-chat', 'codex')
  const worker = (await coord.joinExternalProtocolRun({ runId, participantName: 'reviewer', provider: 'codex', cwd })).participant
  async function mail(text: string) { await coord.sendExternalProtocolMessage(worker, { to: 'lead', body: text, kind: 'response' }) }
  await mail('Result A')
  const rejected = await coord.withCooperativeInbox('primary-chat', { message: 'Review it' }, async () => Response.json({ error: 'rejected' }, { status: 503 }))
  assert.equal(rejected.status, 503)
  assert.equal((await state()).delivery, null)
  assert.ok((await coord.readExternalProtocolInbox(lead, { acknowledge: false })).messages.some(m => m.body.includes('Result A')), 'HTTP rejection preserves mail')

  const uncertain = await coord.withCooperativeInbox('primary-chat', { message: 'Review it' }, async () => { throw new Error('connection lost after submission') })
  assert.equal(uncertain.status, 409)
  const uncertainBatch = (await state()).delivery!
  assert.equal(uncertainBatch.state, 'uncertain')
  let duplicateCalls = 0
  const duplicate = await coord.withCooperativeInbox('primary-chat', { message: 'retry' }, async () => { duplicateCalls++; return clean() })
  assert.equal(duplicate.status, 409); assert.equal(duplicateCalls, 0)
  assert.equal((await coord.readExternalProtocolInbox(lead, { acknowledge: false })).messages.length, 0, 'reserved mail cannot be read twice by tools')
  await coord.reconcileInteractiveDelivery('primary-chat', uncertainBatch.batchId, false)

  let finish!: () => void
  const response = await coord.withCooperativeInbox('primary-chat', { message: 'Review it' }, async outgoing => {
    assert.match(String(outgoing.message), /coord_delegate/)
    assert.match(String(outgoing.message), /Result A/)
    return new Response(new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode('data: {"type":"assistant","text":"received"}')); controller.close() } } }))
  })
  const concurrent = await coord.withCooperativeInbox('primary-chat', { message: 'race' }, async () => { duplicateCalls++; return clean() })
  assert.equal(concurrent.status, 409); assert.equal(duplicateCalls, 0)
  await mail('Result B arrived during the first stream')
  finish(); await response.text()
  await until(async () => !(await state()).delivery)
  const pending = await coord.readExternalProtocolInbox(lead, { acknowledge: false })
  assert.ok(!pending.messages.some(m => m.body.includes('Result A')))
  assert.ok(pending.messages.some(m => m.body.includes('Result B')), 'acknowledgement only consumes the exact reserved batch')

  // HTTP 200 with an error SSE must not masquerade as successful delivery.
  const failed = await coord.withCooperativeInbox('primary-chat', { message: 'Review B' }, async () => new Response('event: session\ndata: {"sessionId":"primary-chat"}\n\nevent: error\ndata: {"error":"provider disconnected"}\n\n'))
  await failed.text()
  await until(async () => (await state()).delivery?.active === false)
  assert.equal((await state()).delivery?.state, 'uncertain')
  await coord.reconcileInteractiveDelivery('primary-chat', (await state()).delivery!.batchId, false)

  await coord.runProtocolMaintenanceSweep()
  assert.equal(autoTurns, 0, 'automatic continuation is opt-in')
  await post({ action: 'settings', requestId: 'auto-on', detail: 'Enable continuation', autoContinue: true })
  runtime.setRunningSession('primary-chat', { provider: 'codex', interrupt: async () => {} })
  await coord.runProtocolMaintenanceSweep()
  assert.equal(autoTurns, 0, 'do not race a user-driven provider turn')
  runtime.clearRunningSession('primary-chat')
  nativePermissions.set('primary-chat', [{ type: 'codex_approval', requestId: 'permission', params: {} }])
  await coord.runProtocolMaintenanceSweep()
  assert.equal(autoTurns, 0, 'do not automatically answer a native approval')
  nativePermissions.clear()
  await Promise.all([coord.runProtocolMaintenanceSweep(), coord.runProtocolMaintenanceSweep()])
  assert.equal(autoTurns, 1, 'concurrent sweeps submit one lead continuation')
  releaseAuto!()
  await until(async () => !(await state()).delivery)
  await coord.runProtocolMaintenanceSweep()
  assert.equal(autoTurns, 1, 'unchanged state spends no extra turn')

  // Reload/controller loss restores bindings, without replaying received mail.
  globalThis.__agentViewerCoordinatorControllers!.delete(runId)
  await coord.runProtocolMaintenanceSweep()
  assert.ok(globalThis.__agentViewerCoordinatorControllers!.has(runId))
  assert.equal(autoTurns, 1)
  const task = await coord.createExternalProtocolTask(await coord.sessionCoordinatorIdentity('primary-chat', 'codex'), { assignTo: 'reviewer', title: 'Final task', detail: 'Report the final result' })
  await coord.reportExternalProtocolProgress(worker, { taskId: task.task!.id, status: 'working', summary: 'Started final work' })
  await coord.runProtocolMaintenanceSweep()
  assert.equal(autoTurns, 1, 'task starts and descriptive heartbeats must not wake the lead')
  await coord.completeExternalProtocolTask(worker, { taskId: task.task!.id, summary: 'The final result is ready' })
  await coord.runProtocolMaintenanceSweep()
  assert.equal(autoTurns, 2, 'the last completed task must deliver its result even with no unfinished tasks')
  releaseAuto!()
  await until(async () => !(await state()).delivery)
  await post({ action: 'settings', requestId: 'auto-off', detail: 'Pause continuation', autoContinue: false })
  await post({ action: 'settings', requestId: 'auto-on', detail: 'Enable continuation', autoContinue: true })
  assert.equal((await state()).autoContinue, false, 'replaying an old settings request cannot overwrite a newer preference')
  const current = await GET(new Request('http://localhost/coordination?provider=codex'), context)
  assert.equal(current.status, 200)
  let leadInterrupted = false
  let workerInterrupted = false
  const workerSessionId = (await coord.readSessionCoordinator('primary-chat', 'codex'))!.agents.find(agent => agent.id === worker.agentId)!.sessionId
  runtime.setRunningSession('primary-chat', { provider: 'codex', interrupt: async () => { leadInterrupted = true } })
  runtime.setRunningSession(workerSessionId, { provider: 'codex', interrupt: async () => { workerInterrupted = true } })
  const off = await post({ action: 'disable', requestId: 'turn-off', detail: 'Turn off coordinator' })
  assert.equal(leadInterrupted, false, 'turning off preserves the primary chat turn')
  assert.equal(workerInterrupted, true, 'turning off interrupts teammate work')
  runtime.clearRunningSession(workerSessionId)
  runtime.clearRunningSession('primary-chat')
  assert.equal(off.interactive.enabled, false)
  assert.equal(off.snapshot.run.status, 'stopped')
  assert.ok(off.snapshot.tasks.length, 'history survives turning off')
  await post({ action: 'disable', requestId: 'turn-off', detail: 'Turn off coordinator' })
  await coord.runProtocolMaintenanceSweep()
  const plain = { message: 'Ordinary chat after turning off' }
  await coord.withCooperativeInbox('primary-chat', plain, async body => { assert.deepEqual(body, plain); return clean() })
  assert.equal(autoTurns, 2, 'off cannot automatically continue')
  console.log('Interactive enablement, exact-batch delivery, startup/SSE failure recovery, send races, native approval gating, opt-in continuation, restart binding and settings replay passed')
} finally {
  runtime.clearRunningSession('primary-chat')
  if (runId) await coord.stopProtocolRun(runId)
  mock.restore()
}
