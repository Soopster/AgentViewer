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
   * Called with a request that was replaced before it was ever dispatched. The
   * caller settles whatever it promised for that request — usually by chaining
   * it to the replacement, which answers the same question.
   */
  supersede?: (superseded: T, replacement: T) => void
  /**
   * Reports a `run` that rejected. `run` is expected to settle its own callers,
   * so a rejection here is a defect rather than a failed read — but it must not
   * escape as an unhandled rejection (fatal under Bun) and must not stop the
   * drain, or one failure silences the surface for the rest of the session.
   */
  onError?: (error: unknown, request: T) => void
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
      }
    })()
  }

  return {
    push({ key, request }) {
      const existing = slots.get(key)
      if (existing?.request !== undefined) {
        options.supersede?.(existing.request, request)
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
