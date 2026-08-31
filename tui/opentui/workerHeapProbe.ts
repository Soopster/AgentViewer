// Opt-in per-VM heap reporting for the TUI's isolates.
//
// A Bun Worker is its own JS VM inside this process, so process RSS is the sum
// of every VM's heap plus its parsed module code, and tells you nothing about
// which isolate is holding what. heapStats() is per-VM, so calling this from
// inside one attributes its share.
//
// Off unless AGENT_VIEWER_TUI_MEM=1. A fullscreen TUI cannot write to
// stdout/stderr without corrupting the render, so output goes to the file named
// by AGENT_VIEWER_TUI_MEM_LOG when that is set, and to stderr otherwise (which
// suits the test-renderer harnesses).
const enabled = process.env.AGENT_VIEWER_TUI_MEM === '1'
const logPath = process.env.AGENT_VIEWER_TUI_MEM_LOG
const INTERVAL_MS = 1000

let last = 0

export function reportWorkerHeap(label: string, force = false): void {
  if (!enabled) return
  const now = Date.now()
  if (!force && now - last < INTERVAL_MS) return
  last = now
  void (async () => {
    try {
      // bun:jsc has no ambient types here; this probe only runs under Bun.
      // @ts-expect-error -- Bun-only module
      const { heapStats } = await import('bun:jsc')
      // Collect first: an un-collected reading swings by 100MB+ on the
      // transcript worker purely from formatting garbage, which says nothing
      // about what it is holding on to.
      const gc = (globalThis as { Bun?: { gc?: (sync: boolean) => void } }).Bun?.gc
      gc?.(true)
      const stats = heapStats() as { heapSize: number; objectCount: number }
      const line = `[tui-mem] ${label} heap=${(stats.heapSize / 1024 / 1024).toFixed(1)}MB`
        + ` objects=${stats.objectCount} rss=${(process.memoryUsage.rss() / 1024 / 1024).toFixed(1)}MB\n`
      if (logPath) {
        const { appendFileSync } = await import('node:fs')
        appendFileSync(logPath, line)
      } else {
        process.stderr.write(line)
      }
    } catch {
      // Best-effort instrumentation; never let it affect the app.
    }
  })()
}

/**
 * Per-VM heap sampled WITHOUT collecting first, on a timer. The companion to
 * reportWorkerHeap, and the opposite question: that one collects, so it reports
 * what an isolate is *holding*; this one does not, so it reports what an
 * isolate is *producing*. Churn is what sets the allocator's high-water mark —
 * arenas stay mapped long after their garbage is collected — so a retention
 * probe can look perfectly flat while the resident size climbs all night.
 *
 * Reading it: a rising `objs` between samples is the allocation rate, and a
 * sawtooth is normal (the drop is a collection). A repeating step of the same
 * size is one periodic job; that is how the list cache's expiry was caught
 * re-deriving a 45MB page on a timer.
 *
 * On behind AGENT_VIEWER_TUI_MEM_RAW=1, writing to AGENT_VIEWER_TUI_MEM_LOG.
 */
export function startRawHeapSampler(label: string): void {
  if (process.env.AGENT_VIEWER_TUI_MEM_RAW !== '1') return
  const path = process.env.AGENT_VIEWER_TUI_MEM_LOG
  setInterval(() => {
    void (async () => {
      try {
        // @ts-expect-error -- Bun-only module
        const { heapStats } = await import('bun:jsc')
        const stats = heapStats() as { heapSize: number; objectCount: number }
        const line = `[raw] ${label} heap=${(stats.heapSize / 1048576).toFixed(1)}MB objs=${stats.objectCount} rss=${(process.memoryUsage.rss() / 1048576).toFixed(0)}MB\n`
        if (path) { const { appendFileSync } = await import('node:fs'); appendFileSync(path, line) }
      } catch {}
    })()
  }, 5000).unref?.()
}
