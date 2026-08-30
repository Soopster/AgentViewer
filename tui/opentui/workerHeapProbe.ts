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
