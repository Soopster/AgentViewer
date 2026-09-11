import assert from 'node:assert/strict'

import { createLatestWorkerQueue } from './latestWorkerQueue'

const defer = () => {
  let release!: () => void
  return { promise: new Promise<void>((resolve) => { release = resolve }), release }
}

// ── superseding ────────────────────────────────────────────────────────────
// The point of the queue: while one request is in flight, later requests for
// the same key collapse into one. Without this, typing faster than the worker
// answers queues a job per character and the answer the user is waiting on
// arrives behind every answer they have already typed past.
{
  const ran: string[] = []
  const superseded: Array<[string, string]> = []
  const first = defer()
  let gate: Promise<void> = first.promise

  const queue = createLatestWorkerQueue<string>({
    run: async (request) => {
      ran.push(request)
      await gate
    },
    supersede: (dropped, replacement) => { superseded.push([dropped, replacement]) },
  })

  queue.push({ key: 'a', request: 'a1' })
  // 'a1' is already dispatched, so these three queue behind it and collapse.
  queue.push({ key: 'a', request: 'a2' })
  queue.push({ key: 'a', request: 'a3' })
  queue.push({ key: 'a', request: 'a4' })

  assert.deepEqual(ran, ['a1'], 'Only one request is in flight at a time')
  assert.equal(queue.size, 1, 'Three queued requests for one key collapse to one pending slot')
  assert.deepEqual(superseded, [['a2', 'a3'], ['a3', 'a4']],
    'Each replaced request is reported once, with the request that replaced it')

  gate = Promise.resolve()
  first.release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ran, ['a1', 'a4'],
    'The intermediate requests are never dispatched — only the newest survives')
}

// ── a dispatched request is not superseded ─────────────────────────────────
// Once a request is on its way to the worker it cannot be taken back, so a
// request arriving during `run` must start a new slot rather than mutate one
// whose payload has already been sent.
{
  const ran: string[] = []
  const gate = defer()
  const queue = createLatestWorkerQueue<string>({
    run: async (request) => {
      ran.push(request)
      if (request === 'b1') await gate.promise
    },
  })
  queue.push({ key: 'b', request: 'b1' })
  queue.push({ key: 'b', request: 'b2' })
  gate.release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ran, ['b1', 'b2'], 'The in-flight request still completes; the next one follows it')
}

// ── keys are independent, and order is preserved across them ───────────────
{
  const ran: string[] = []
  const queue = createLatestWorkerQueue<string>({ run: async (request) => { ran.push(request) } })
  queue.push({ key: 'x', request: 'x1' })
  queue.push({ key: 'y', request: 'y1' })
  queue.push({ key: 'z', request: 'z1' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ran, ['x1', 'y1', 'z1'],
    'Different keys never supersede each other and keep submission order')
}

// ── a failing request does not wedge the queue ─────────────────────────────
// `run` owns its own error reporting; a rejection here must not leave `running`
// stuck true, or one failed read silences the surface for the rest of the session.
{
  const ran: string[] = []
  const reported: string[] = []
  const queue = createLatestWorkerQueue<string>({
    run: async (request) => {
      ran.push(request)
      if (request === 'boom') throw new Error('worker died')
    },
    onError: (error) => { reported.push(error instanceof Error ? error.message : String(error)) },
  })
  queue.push({ key: 'k', request: 'boom' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  queue.push({ key: 'k', request: 'after' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(ran, ['boom', 'after'], 'A rejected dispatch must not wedge the queue')
  assert.deepEqual(reported, ['worker died'],
    'The rejection is reported rather than escaping as an unhandled rejection, which is fatal under Bun')
}

console.log('Latest-wins worker queue smoke passed (supersede, in-flight safety, key independence, failure recovery)')
