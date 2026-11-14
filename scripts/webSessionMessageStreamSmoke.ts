import assert from 'node:assert/strict'
import { connectSessionMessageStream } from '../components/session-reader/messageStream'
import type { Session } from '../lib/types'

// Deterministic transport checks: no real provider, network, or wall-clock waits.
const intervals = new Map<number, () => void>()
const timeouts = new Map<number, { run: () => void; delay: number }>()
let nextTimer = 0
class FakeSource {
  static instances: FakeSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  handlers = new Map<string, (event: { data: string }) => void>()
  closed = false
  constructor(readonly url: string) { FakeSource.instances.push(this) }
  addEventListener(type: string, listener: (event: { data: string }) => void) { this.handlers.set(type, listener) }
  close() { this.closed = true }
  emit(type: string, payload: unknown) { this.handlers.get(type)?.({ data: JSON.stringify(payload) }) }
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const previousSource = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  setInterval: (run: () => void) => { intervals.set(++nextTimer, run); return nextTimer },
  clearInterval: (id: number) => intervals.delete(id),
  setTimeout: (run: () => void, delay: number) => { timeouts.set(++nextTimer, { run, delay }); return nextTimer },
  clearTimeout: (id: number) => timeouts.delete(id),
} })
Object.defineProperty(globalThis, 'EventSource', { configurable: true, writable: true, value: FakeSource })
const latest = () => FakeSource.instances.at(-1)!
const retry = () => {
  const [id, timer] = timeouts.entries().next().value!
  timeouts.delete(id)
  timer.run()
  return timer.delay
}
try {
  const session: Session = { sessionId: 'shared/id', provider: 'codex', providerInstanceId: 'work' }
  const delivered: unknown[] = []
  let offset = 80
  let pollCount = 0
  let pendingPoll: (() => void) | undefined
  let pollSignal: AbortSignal | undefined
  const stop = connectSessionMessageStream({
    session, getOffset: () => offset,
    onMessages: payload => delivered.push(payload),
    onTodos: todos => delivered.push(todos), onPlan: plan => delivered.push(plan),
    poll: async (_session, signal) => {
      pollCount++
      pollSignal = signal
      await new Promise<void>(resolve => { pendingPoll = resolve })
    },
  })
  const first = latest()
  assert.ok(first.url.startsWith('/api/sessions/shared%2Fid/messages/events?'))
  const params = new URL(first.url, 'http://localhost').searchParams
  assert.equal(params.get('providerInstanceId'), 'work')
  assert.equal(params.get('offset'), '80')
  assert.equal(params.get('limit'), '220')
  assert.equal(params.get('backfill'), '20')
  first.emit('todos', { sessionId: 'other', todos: [1] })
  first.emit('plan', { sessionId: session.sessionId, plan: [], explanation: 42 })
  assert.deepEqual(delivered, [{ plan: [], explanation: null }])
  first.handlers.get('messages')?.({ data: 'malformed json' })
  first.emit('messages', { sessionId: session.sessionId, messages: [] })
  assert.equal(delivered.length, 2)
  first.onerror?.()
  assert.equal(first.closed, true)
  assert.equal(pollCount, 1)
  intervals.forEach(run => run())
  assert.equal(pollCount, 1, 'fallback polls cannot overlap')
  first.emit('todos', { sessionId: session.sessionId, todos: [1] })
  assert.equal(delivered.length, 2, 'closed sources cannot deliver queued events')
  offset = 120
  assert.equal(retry(), 2000)
  assert.equal(new URL(latest().url, 'http://localhost').searchParams.get('offset'), '120')
  latest().onerror?.()
  assert.equal(retry(), 4000)
  for (const delay of [8000, 16000, 30000, 30000]) {
    latest().onerror?.()
    assert.equal(retry(), delay, 'reconnect backoff is capped')
  }
  latest().onopen?.()
  assert.equal(intervals.size, 0, 'healthy SSE stops fallback polling')
  latest().onerror?.()
  assert.equal([...timeouts.values()][0]!.delay, 2000, 'a healthy connection resets backoff')
  stop()
  assert.equal(pollSignal?.aborted, true)
  assert.equal(intervals.size, 0)
  assert.equal(timeouts.size, 0)
  const count = delivered.length
  latest().emit('plan', { sessionId: session.sessionId, plan: [1] })
  latest().onerror?.()
  assert.equal(delivered.length, count)
  assert.equal(timeouts.size, 0)
  pendingPoll?.()
  await Promise.resolve()

  // Browsers without SSE still poll, and stopping them releases the timer.
  Object.defineProperty(globalThis, 'EventSource', { value: undefined })
  let fallbackCount = 0
  const stopFallback = connectSessionMessageStream({
    session, getOffset: () => 0, onMessages: () => {}, onTodos: () => {}, onPlan: () => {},
    poll: async () => { fallbackCount++ },
  })
  assert.equal(fallbackCount, 1)
  assert.equal(intervals.size, 1)
  stopFallback()
  assert.equal(intervals.size, 0)
  console.log('Web session message stream: delivery, retry, fallback, cancellation, and cleanup passed')
} finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (previousSource) Object.defineProperty(globalThis, 'EventSource', previousSource)
  else Reflect.deleteProperty(globalThis, 'EventSource')
}
