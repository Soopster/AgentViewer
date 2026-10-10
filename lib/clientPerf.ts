// Client-side performance instrumentation. Opt-in (no overhead otherwise):
//   - localStorage 'agentviewer:perf' === '1', or
//   - a `?perf=1` query param (also persists it to localStorage), or
//   - NEXT_PUBLIC_PERF === '1' at build time.
//
// Provides measure helpers for hot client computations (threading, timeline
// layout), a long-task PerformanceObserver (main-thread jank > 50ms), fetch
// timing, and a periodic console rollup. All guarded for SSR.

import { PerfStats, formatPerfRow } from './perfStats'

let enabled: boolean | null = null
let started = false
const stats = new PerfStats()

export function clientPerfEnabled(): boolean {
  if (enabled !== null) return enabled
  if (typeof window === 'undefined') return false
  try {
    if (process.env.NEXT_PUBLIC_PERF === '1') { enabled = true; return true }
    const params = new URLSearchParams(window.location.search)
    if (params.get('perf') === '1') {
      window.localStorage.setItem('agentviewer:perf', '1')
      enabled = true
      return true
    }
    enabled = window.localStorage.getItem('agentviewer:perf') === '1'
  } catch {
    enabled = false
  }
  return enabled
}

export function recordClientPerf(label: string, ms: number): void {
  if (!clientPerfEnabled()) return
  stats.record(label, ms)
}

/** Time a synchronous computation. Straight passthrough when perf is disabled. */
export function measureSync<T>(label: string, fn: () => T): T {
  if (!clientPerfEnabled()) return fn()
  const start = performance.now()
  try {
    return fn()
  } finally {
    stats.record(label, performance.now() - start)
  }
}

/** Time an async computation (e.g. a poll fetch). */
export async function measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!clientPerfEnabled()) return fn()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    stats.record(label, performance.now() - start)
  }
}

export function getClientPerfStats() {
  return stats.snapshot()
}

// Start the long-task observer + periodic rollup. Idempotent; safe to call from
// a top-level effect. No-op when perf is disabled or in SSR.
export function startClientPerf(intervalMs = 30_000): (() => void) | void {
  if (started || !clientPerfEnabled() || typeof window === 'undefined') return
  started = true

  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) {
          stats.record('longtask', entry.duration)
          // eslint-disable-next-line no-console
          console.warn(`[perf] long task ${entry.duration.toFixed(0)}ms`)
        }
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    /* longtask not supported in this browser — measurements still work */
  }

  const handle = window.setInterval(() => {
    const rows = getClientPerfStats()
    // Chrome-only JS heap sampling — surfaces tab memory growth over time.
    const mem = (performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
    }).memory
    const memLine = mem
      ? `jsHeap used=${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB total=${(mem.totalJSHeapSize / 1048576).toFixed(1)}MB`
      : ''
    if (rows.length === 0 && !memLine) return
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[perf] client rollup${memLine ? ` — ${memLine}` : ''} (${rows.length} labels)`)
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(formatPerfRow(row))
    }
    // eslint-disable-next-line no-console
    console.groupEnd()
  }, intervalMs)

  // eslint-disable-next-line no-console
  console.log(`[perf] client monitor enabled — rollup every ${Math.round(intervalMs / 1000)}s`)

  return () => {
    started = false
    observer?.disconnect()
    window.clearInterval(handle)
  }
}
