import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const { mock } = await (0, eval)('import("bun:test")')
import { coordinatorAgentActivity, type CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const data = (enabled: boolean): CoordinatorInteractiveState => ({ snapshot: null,
  interactive: { enabled, autoContinue: false, remainingTurns: 4, delivery: null },
  recoveries: [], permissions: [], runningAgentIds: [] })
let read = deferred<CoordinatorInteractiveState>()
let send = deferred<CoordinatorInteractiveState>()
const changeListeners = new Set<() => void>()
const changed = () => { for (const listener of changeListeners) listener() }
const calls: Array<{ sessionId: string; request: unknown }> = []
mock.module('../../lib/tui/service', () => ({
  readTuiSessionCoordinator: () => read.promise,
  sendTuiSessionCoordination: (sessionId: string, _provider: string, request: unknown) => {
    calls.push({ sessionId, request }); return send.promise
  },
  subscribeTuiProtocolRunChanges: (listener: () => void) => { changeListeners.add(listener); return () => { changeListeners.delete(listener) } },
}))
const originalCwd = process.cwd()
const fixture = mkdtempSync(path.join(tmpdir(), 'coord-store-'))
process.chdir(fixture)
const store = await import('./interactiveCoordinatorStore')
const agent = { id: 'worker-1', runId: 'run', name: 'reviewer', role: 'teammate' as const,
  provider: 'codex' as const, sessionId: 'worker-chat', worktreePath: '/tmp', worktreeBranch: '', status: 'working' as const, createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z' }
const active = { ...data(true), runningAgentIds: [agent.id] }
assert.equal(coordinatorAgentActivity(agent, active), 'Working · live turn')
assert.equal(coordinatorAgentActivity(agent, active, true), 'Unknown · last observation unavailable', 'cached live activity is not current evidence during an outage')
assert.equal(coordinatorAgentActivity(agent, { ...active, interactive: { ...active.interactive, executionElsewhere: true } }),
  'Managed by another host · inspect there', 'local runtime observations cannot describe another host')

const first = { sessionId: 'first', provider: 'codex' as const, cwd: '/tmp', title: 'first' }
const second = { ...first, sessionId: 'second', title: 'second' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = () => new Promise(resolve => setTimeout(resolve, 1_100))
try {
  // A chat-originated team must surface attention without ever opening its panel.
  const stopWatching = store.observeInteractiveCoordinator(first)
  read.resolve({ ...data(true), recoveries: ['worker-1'] }); await tick()
  assert.equal(store.getInteractiveCoordinatorState().open, false)
  assert.equal(store.getInteractiveCoordinatorState().session, null, 'observation cannot replace panel focus')
  assert.match(store.getInteractiveCoordinatorAttention(), /need attention/)
  stopWatching()
  assert.equal(changeListeners.size, 1, 'an active team stays observed after navigating away')
  store.openInteractiveCoordinatorAttention()
  assert.equal(store.getInteractiveCoordinatorState().session?.sessionId, first.sessionId)
  store.resetInteractiveCoordinatorStore()

  // Ordinary chats do not accumulate a poller for every reader selection.
  read = deferred()
  const stopEmpty = store.observeInteractiveCoordinator(second)
  const stopEmptyAgain = store.observeInteractiveCoordinator(second)
  assert.equal(changeListeners.size, 1, 'observers share a single feed')
  stopEmpty()
  assert.equal(changeListeners.size, 1, 'one remaining observer retains the feed')
  stopEmptyAgain()
  read.resolve(data(false)); await tick()
  assert.equal(changeListeners.size, 0, 'leaving a chat releases its feed after the initial read')
  assert.equal(calls.length, 0, 'background discovery is read-only')
  store.resetInteractiveCoordinatorStore()
  read = deferred()
  store.openInteractiveCoordinator(first)
  read.resolve(data(false)); await tick()
  const action = store.runInteractiveCoordinatorAction({ action: 'enable', detail: 'Enable' })
  const request = store.getInteractiveCoordinatorState().pending
  store.closeInteractiveCoordinator()
  store.openInteractiveCoordinator(first)
  assert.equal(store.getInteractiveCoordinatorState().busy, true, 'close/reopen cannot unlock an in-flight mutation')
  assert.deepEqual(store.getInteractiveCoordinatorState().pending, request)
  assert.equal(await store.runInteractiveCoordinatorAction({ action: 'disable', detail: 'Off' }), false)
  store.discardInteractiveCoordinatorAction()
  assert.deepEqual(store.getInteractiveCoordinatorState().pending, request, 'cannot discard while submitting')
  read = deferred(); store.openInteractiveCoordinator(second)
  read.resolve(data(false)); await tick()
  send.reject(new Error('Uncertain outcome')); await action
  assert.equal(store.getInteractiveCoordinatorState().pending, null, 'old submission cannot contaminate another chat')
  store.openInteractiveCoordinator(first)
  assert.deepEqual(store.getInteractiveCoordinatorState().pending, request, 'switching back retains exact request')
  assert.match(store.getInteractiveCoordinatorState().error!, /unconfirmed/i)
  send = deferred()
  const retry = store.retryInteractiveCoordinatorAction()
  assert.deepEqual(calls[1], calls[0], 'retry sends identical session and request key')
  send.resolve(data(true)); assert.equal(await retry, true)

  // A read begun before the mutation must not roll its result back afterward.
  read = deferred(); changed!()
  send = deferred()
  const off = store.runInteractiveCoordinatorAction({ action: 'disable', detail: 'Off' })
  send.resolve(data(false)); await off
  read.resolve(data(true)); await tick()
  assert.equal(store.getInteractiveCoordinatorState().data?.interactive.enabled, false)

  // Even a successful old-session response must stay with its own session.
  send = deferred()
  const oldAction = store.runInteractiveCoordinatorAction({ action: 'enable', detail: 'Enable again' })
  read = deferred(); store.openInteractiveCoordinator(second)
  read.resolve(data(false)); await tick()
  send.resolve(data(true)); await oldAction
  assert.equal(store.getInteractiveCoordinatorState().data?.interactive.enabled, false)
  read = deferred()
  store.openInteractiveCoordinator(first)
  assert.equal(store.getInteractiveCoordinatorState().data?.interactive.enabled, true)
  read.resolve(data(true)); await tick()
  read = deferred(); changed!(); read.reject(new Error('offline')); await tick()
  assert.match(store.getInteractiveCoordinatorState().error!, /Could not refresh/)
  assert.equal(store.getInteractiveCoordinatorState().observationUnavailable, true)
  assert.equal(store.getInteractiveCoordinatorState().data?.interactive.enabled, true, 'read outage retains last observation')
  store.closeInteractiveCoordinator()
  read = deferred(); changed()
  read.resolve({ ...data(true), recoveries: ['worker-1'] }); await tick()
  assert.equal(store.getInteractiveCoordinatorState().observationUnavailable, false, 'successful background refresh restores observation')
  assert.match(store.getInteractiveCoordinatorAttention(), /need attention/, 'closed panel must receive new attention')
  assert.equal(store.getInteractiveCoordinatorState().open, false)
  store.openInteractiveCoordinatorAttention()
  assert.equal(store.getInteractiveCoordinatorState().open, true)
  // Herdr-style transition notifications: the first read is a baseline, a new
  // question on a background conversation notifies, and a re-read is silent.
  store.resetInteractiveCoordinatorStore()
  const events: Array<{ id: string; viewing: boolean; session: string }> = []
  const stopEvents = store.subscribeInteractiveCoordinatorNotifications(event => events.push({ id: event.signal.id, viewing: event.viewing, session: event.session.sessionId }))
  const snapshotWith = (messages: unknown[], taskStatus = 'in_progress', updatedAt = '2026-09-17T00:00:00Z') => ({ ...data(true), snapshot: {
    run: { id: 'run', status: 'running', leadAgentId: 'lead', requireReview: false, review: { status: 'none' } },
    agents: [agent], tasks: [{ id: 'T1', title: 'Review', status: taskStatus, ownerAgentId: agent.id, updatedAt }],
    locks: [], messages, events: [],
  } } as unknown as CoordinatorInteractiveState)
  const question = { id: 'q1', fromAgentId: agent.id, toAgentId: 'lead', replyRequired: true, body: 'Which branch?' }
  read = deferred()
  const stopBackground = store.observeInteractiveCoordinator(second)
  read.resolve(snapshotWith([question])); await tick()
  assert.deepEqual(events, [], 'a question already held at first read is a baseline, not a notification')
  read = deferred(); changed(); read.resolve(snapshotWith([question, { ...question, id: 'q2' }])); await tick()
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(events, [], 'delivery is held for the notification delay, as herdr holds its toasts')
  await settle()
  assert.deepEqual(events, [{ id: 'message:q2', viewing: false, session: 'second' }], 'a new question on a background conversation notifies')
  read = deferred(); changed(); read.resolve(snapshotWith([question, { ...question, id: 'q2' }])); await tick(); await settle()
  assert.equal(events.length, 1, 'a re-read of unchanged state is silent')
  // Herdr's delayed_background_waiting_cancels_when_agent_resumes_working.
  read = deferred(); changed(); read.resolve(snapshotWith([question, { ...question, id: 'q2' }, { ...question, id: 'q3' }])); await tick()
  read = deferred(); changed(); read.resolve(snapshotWith([question, { ...question, id: 'q2' }])); await tick(); await settle()
  assert.equal(events.length, 1, 'a question resolved within the delay never notifies')
  read = deferred(); store.openInteractiveCoordinator(second)
  read.resolve(snapshotWith([question, { ...question, id: 'q2' }], 'completed')); await tick(); await settle()
  assert.deepEqual(events.at(-1), { id: 'result:T1:2026-09-17T00:00:00Z', viewing: true, session: 'second' }, 'the listener is told the user is looking, so it can apply the focus rule')

  assert.equal(store.getInteractiveCoordinatorAttention(), '! Teammates: 2 need attention · 1 finished', 'a finished result is reported apart from what is waiting on the user')
  // Reviewed markers are durable: a restart must not re-flag every result.
  store.reviewInteractiveCoordinatorResult('result:T1:2026-09-17T00:00:00Z')
  stopEvents(); stopBackground()
  store.resetInteractiveCoordinatorStore()
  read = deferred(); store.openInteractiveCoordinator(second)
  assert.deepEqual(store.getInteractiveCoordinatorState().reviewed, ['result:T1:2026-09-17T00:00:00Z'], 'reviewed results survive a client restart')
  read.resolve(snapshotWith([], 'completed')); await tick()
  assert.equal(store.getInteractiveCoordinatorAttention(), '', 'a reviewed result is no longer announced')
  read = deferred(); changed(); read.resolve(snapshotWith([], 'failed', '2026-09-17T00:05:00Z')); await tick()
  assert.match(store.getInteractiveCoordinatorAttention(), /^✓ Teammates: 1 finished$/, 'results alone never read as urgent')

  // Herdr's attention priority: jump to what is waiting on the user before a
  // result that can wait, whatever order the conversations were observed in.
  store.resetInteractiveCoordinatorStore()
  read = deferred(); const stopFinished = store.observeInteractiveCoordinator(first)
  read.resolve(snapshotWith([], 'completed', '2026-09-17T01:00:00Z')); await tick()
  read = deferred(); const stopAsking = store.observeInteractiveCoordinator(second)
  read.resolve(snapshotWith([question])); await tick()
  store.openInteractiveCoordinatorAttention()
  assert.equal(store.getInteractiveCoordinatorState().session?.sessionId, 'second', 'a blocked teammate outranks a finished one')
  stopFinished(); stopAsking()
  console.log('Interactive TUI store: close/reopen, session switches, exact retry, stale polls, busy discard, read outage, delayed/cancellable transition notifications, attention priority, and durable review markers passed')
} finally { store.resetInteractiveCoordinatorStore(); mock.restore(); process.chdir(originalCwd); rmSync(fixture, { recursive: true, force: true }) }
