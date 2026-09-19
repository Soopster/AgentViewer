// A dispatch queue in front of a serial worker, where a newer request for the
// same key replaces a pending older one instead of queueing behind it. Ported
// from opencode's `createLatestWorkerQueue`
// (`packages/session-ui/src/components/markdown-worker-queue.ts`).
//
// The shape this exists for: a surface that re-asks the same question on every
// keystroke. Without superseding, a slow answer makes the queue grow while the
// user types, and every answer but the last is computed and thrown away — the
// worker spends its time on questions nobody is waiting for any more, which is
// precisely when the one the user *is* waiting for arrives late.
//
// Superseding is only sound for an idempotent read, where the newer request
// asks the same question of newer state: the superseded caller is handed the
// newer answer, which is at least as fresh as the one it asked for. A request
// with a side effect must not go through here.

export type LatestWorkerQueueJob<T> = {
  /** Requests sharing a key supersede one another while still pending. */
  readonly key: string
  readonly request: T
}

export type LatestWorkerQueue<T> = {
  /** Enqueues a request, replacing any pending request with the same key. */
  push: (job: LatestWorkerQueueJob<T>) => void
  /** Pending (not yet dispatched) request count — the test seam. */
  readonly size: number
}

export function createLatestWorkerQueue<T>(options: {
  /** Dispatches one request. The queue waits for this before dispatching the next. */
  run: (request: T) => Promise<void>
  /**
   * Called with a request that was replaced before it was ever dispatched.
   *
   * Required, because superseding *drops* a request: whatever the owner
   * promised for it will never be settled by a dispatch. An owner whose
   * requests carry a promise must settle it here — usually by chaining it to
   * the replacement, which answers the same question. Omitting this is not a
   * missing optimization, it is a hung caller, and the failure mode is a UI
   * that waits forever with no error. Pass an explicit no-op for a queue whose
   * requests are pure side effects and have nobody waiting on them.
   */
  supersede: (superseded: T, replacement: T) => void
  /**
   * Reports a `run` that rejected. `run` is expected to settle its own callers,
   * so a rejection here is a defect rather than a failed read — but it must not
   * escape as an unhandled rejection (fatal under Bun) and must not stop the
   * drain, or one failure silences the surface for the rest of the session.
   */
  onError?: (error: unknown, request: T) => void
  /**
   * Called when the queue has dispatched everything and nothing is running.
   * An owner that keeps one queue per key uses this to drop the instance —
   * otherwise the map grows with every key ever seen.
   */
  onIdle?: () => void
}): LatestWorkerQueue<T> {
  type Slot = { key: string; request: T | undefined }

  // `order` preserves submission order across keys; `slots` finds the pending
  // entry for one key in constant time. A dispatched slot keeps its place in
  // `order` with an undefined request so draining stays a single forward walk.
  const order: Slot[] = []
  const slots = new Map<string, Slot>()
  let running = false

  const drain = () => {
    if (running) return
    running = true
    void (async () => {
      try {
        while (order.length > 0) {
          const slot = order.shift()!
          if (slots.get(slot.key) === slot) slots.delete(slot.key)
          const request = slot.request
          // Clearing before the await is what makes the dispatch irrevocable:
          // a request arriving during `run` must start a new slot rather than
          // supersede one that is already on its way to the worker.
          slot.request = undefined
          if (request === undefined) continue
          try {
            await options.run(request)
          } catch (error) {
            options.onError?.(error, request)
          }
        }
      } finally {
        running = false
        // A push during the final await lands after `order.length` was read.
        if (order.length > 0) drain()
        else options.onIdle?.()
      }
    })()
  }

  return {
    push({ key, request }) {
      const existing = slots.get(key)
      if (existing?.request !== undefined) {
        options.supersede(existing.request, request)
        existing.request = request
        return
      }
      const slot: Slot = { key, request }
      slots.set(key, slot)
      order.push(slot)
      drain()
    },
    get size() {
      return order.reduce((total, slot) => total + (slot.request === undefined ? 0 : 1), 0)
    },
  }
}

/**
 * One `createLatestWorkerQueue` per key, so different keys run concurrently
 * while requests sharing a key serialize and supersede.
 *
 * This is the shape opencode's `SessionRunCoordinator` has
 * (`packages/core/src/session/run-coordinator.ts`): serialize execution for
 * each key, allow different keys to run concurrently. A single global queue
 * would be the wrong trade here — two sessions' reads have no shared state to
 * race over, and serializing them would give up the overlap of their disk I/O
 * for nothing.
 *
 * Instances are dropped as they go idle, so the map holds only keys with work
 * in flight rather than every key the process has ever seen.
 */
export function createKeyedWorkerQueue<T>(options: {
  run: (request: T) => Promise<void>
  /** Required for the same reason as on `createLatestWorkerQueue`. */
  supersede: (superseded: T, replacement: T) => void
  onError?: (error: unknown, request: T) => void
}): { push: (job: LatestWorkerQueueJob<T>) => void; readonly activeKeys: number } {
  const queues = new Map<string, LatestWorkerQueue<T>>()

  return {
    push(job) {
      const existing = queues.get(job.key)
      if (existing) {
        existing.push(job)
        return
      }
      const queue = createLatestWorkerQueue<T>({
        run: options.run,
        supersede: options.supersede,
        onError: options.onError,
        // Only drop the instance if it is still the one registered: an idle
        // callback firing after a replacement was installed must not evict it.
        onIdle: () => {
          if (queues.get(job.key) === queue) queues.delete(job.key)
        },
      })
      queues.set(job.key, queue)
      queue.push(job)
    },
    get activeKeys() {
      return queues.size
    },
  }
}
