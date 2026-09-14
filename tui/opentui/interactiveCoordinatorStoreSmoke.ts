import assert from 'node:assert/strict'
const { mock } = await (0, eval)('import("bun:test")')
import type { CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'

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
const store = await import('./interactiveCoordinatorStore')
const first = { sessionId: 'first', provider: 'codex' as const, cwd: '/tmp', title: 'first' }
const second = { ...first, sessionId: 'second', title: 'second' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
try {
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
  assert.match(store.getInteractiveCoordinatorState().error!, /Uncertain/)
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
  assert.equal(store.getInteractiveCoordinatorState().data?.interactive.enabled, true, 'read outage retains last observation')
  store.closeInteractiveCoordinator()
  read = deferred(); changed()
  read.resolve({ ...data(true), recoveries: ['worker-1'] }); await tick()
  assert.match(store.getInteractiveCoordinatorAttention(), /need attention/, 'closed panel must receive new attention')
  assert.equal(store.getInteractiveCoordinatorState().open, false)
  store.openInteractiveCoordinatorAttention()
  assert.equal(store.getInteractiveCoordinatorState().open, true)
  console.log('Interactive TUI store: close/reopen, session switches, exact retry, stale polls, busy discard, and read outage passed')
} finally { store.resetInteractiveCoordinatorStore(); mock.restore() }
