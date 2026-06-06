// Opt-in server memory logger. Enable with AGENT_VIEWER_MEM_LOG=1 (interval in
// seconds via AGENT_VIEWER_MEM_LOG_INTERVAL, default 30). Logs process RSS/heap
// plus the live sizes of the per-session caches and warm provider pools, so a
// growing RSS can be attributed to a specific structure rather than guessed at.
//
// Pure diagnostics: no effect on request handling, gated behind an env var, and
// the interval is unref()'d so it never keeps the process alive on its own.

let started = false

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function startMemoryLogger(): void {
  if (started) return
  if (process.env.AGENT_VIEWER_MEM_LOG !== '1') return
  started = true

  const intervalSec = Math.max(
    5,
    Number.parseInt(process.env.AGENT_VIEWER_MEM_LOG_INTERVAL ?? '', 10) || 30,
  )
  const startedAt = Date.now()

  const tick = async () => {
    const m = process.memoryUsage()
    const uptimeMin = ((Date.now() - startedAt) / 60000).toFixed(1)
    let diag = ''
    try {
      // Collect from the globalThis registry rather than importing sessionBackend
      // directly: route handlers register their cache reporters there, so we read
      // the instance whose caches actually grow even when this logger runs in a
      // separate module instance. See lib/runtimeDiagnostics.ts.
      const { collectRuntimeDiagnostics } = await import('./runtimeDiagnostics')
      const sizes = collectRuntimeDiagnostics()
      const entries = Object.entries(sizes).filter(([, v]) => v > 0)
      if (entries.length > 0) {
        diag = ' | ' + entries.map(([k, v]) => `${k}=${v}`).join(' ')
      }
    } catch {
      /* diagnostics unavailable (e.g. module init race) — RSS line is still useful */
    }
    console.log(
      `[mem] +${uptimeMin}m rss=${mb(m.rss)} heapUsed=${mb(m.heapUsed)} `
      + `heapTotal=${mb(m.heapTotal)} external=${mb(m.external)} `
      + `arrayBuffers=${mb(m.arrayBuffers)}${diag}`,
    )

    // Perf rollup (only populated when AGENT_VIEWER_PERF_LOG=1). Top entries by
    // cumulative time, so the dominant server cost surfaces alongside memory.
    try {
      const { getServerPerfStats } = await import('./perfLog')
      const { formatPerfRow } = await import('./perfStats')
      const rows = getServerPerfStats()
      for (const row of rows.slice(0, 8)) {
        console.log(`[perf] ${formatPerfRow(row)}`)
      }
    } catch {
      /* perf module unavailable — memory line already emitted */
    }
  }

  void tick()
  const handle = setInterval(() => { void tick() }, intervalSec * 1000)
  if (typeof handle === 'object' && handle && 'unref' in handle) {
    (handle as { unref: () => void }).unref()
  }
  console.log(`[mem] logger enabled — sampling every ${intervalSec}s`)
}
