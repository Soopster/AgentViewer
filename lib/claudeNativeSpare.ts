import { performance } from 'node:perf_hooks'

export type NativeSpareHandle = {
  close(): void
  exited: Promise<void>
}

/** One parked process, including an initialization still in flight. No prompt lives here. */
export class ClaudeNativeSpare<T extends NativeSpareHandle> {
  private slot: { key: string; value?: T; controller: AbortController; ready: Promise<void>; timer?: ReturnType<typeof setTimeout> } | null = null
  private startTail: Promise<void> = Promise.resolve()
  private counters = { prepared: 0, hits: 0, misses: 0, failures: 0, expired: 0, initializationMs: 0, claimMs: 0 }

  constructor(private readonly ttlMs = 120_000) {}

  async prepare(key: string, start: (controller: AbortController) => Promise<T>): Promise<void> {
    if (this.slot?.key === key) return this.slot.ready
    this.discard()
    const slot = { key, controller: new AbortController(), ready: Promise.resolve() } as NonNullable<typeof this.slot>
    this.slot = slot
    const started = performance.now()
    slot.timer = setTimeout(() => {
      if (this.slot !== slot) return
      this.counters.expired++
      this.discard()
    }, this.ttlMs)
    slot.timer.unref?.()
    slot.ready = this.startTail.then(async () => {
      if (this.slot !== slot) return
      const value = await start(slot.controller)
      if (this.slot !== slot) { value.close(); return }
      slot.value = value
      this.counters.prepared++
      this.counters.initializationMs = performance.now() - started
      void value.exited.then(() => {
        if (this.slot === slot) this.discard()
      }, () => {
        if (this.slot === slot) this.discard()
      })
    }).catch(() => {
      this.counters.failures++
      if (this.slot === slot) this.discard()
    })
    this.startTail = slot.ready
    return slot.ready
  }

  /** Never wait for initialization on send. A late initializer disposes itself. */
  take(key: string): T | null {
    const slot = this.slot
    if (!slot || slot.key !== key || !slot.value) {
      this.counters.misses++
      this.discard()
      return null
    }
    this.slot = null
    clearTimeout(slot.timer)
    this.counters.hits++
    return slot.value
  }

  discard(): void {
    const slot = this.slot
    this.slot = null
    if (slot) { clearTimeout(slot.timer); slot.controller.abort(); slot.value?.close() }
  }

  noteClaim(ms: number, failed: boolean): void {
    this.counters.claimMs = ms
    if (failed) this.counters.failures++
  }

  diagnostics() {
    return { ...this.counters, state: this.slot ? this.slot.value ? 'ready' : 'initializing' : 'empty' }
  }
}
