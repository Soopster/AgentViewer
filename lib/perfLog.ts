// Server-side performance instrumentation. Opt-in via AGENT_VIEWER_PERF_LOG=1
// (shares the AGENT_VIEWER_MEM_LOG dump cadence in lib/memoryLogger.ts). When
// disabled, timeAsync/timeSync call straight through with no measurement, so
// production runs pay nothing.
//
// Wrap a backend op:  return timeAsync('listViewSessions', () => impl(params))
// Read the rollup:    getServerPerfStats()  (called by the memory logger)

import { PerfStats, type PerfRow } from './perfStats'

const PERF_ENABLED = process.env.AGENT_VIEWER_PERF_LOG === '1'
// Per-call lines for anything slower than this (0 disables per-call logging and
// relies solely on the periodic rollup). Override with AGENT_VIEWER_PERF_SLOW_MS.
const SLOW_MS = Number.parseInt(process.env.AGENT_VIEWER_PERF_SLOW_MS ?? '', 10) || 500

// globalThis-backed so the periodic logger (started from instrumentation.ts,
// which Next.js may load as a SEPARATE module instance) and the route handlers
// that call timeAsync share ONE stats object. Without this the logger reads an
// empty copy. Same rationale as claudePool's globalThis.__claudePool.
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPerfStats: PerfStats | undefined
}
const stats: PerfStats = globalThis.__agentViewerPerfStats ?? (globalThis.__agentViewerPerfStats = new PerfStats())

export function serverPerfEnabled(): boolean {
  return PERF_ENABLED
}

function record(label: string, ms: number): void {
  stats.record(label, ms)
  if (SLOW_MS > 0 && ms >= SLOW_MS) {
    console.log(`[perf] SLOW ${label} ${ms.toFixed(0)}ms`)
  }
}

export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!PERF_ENABLED) return fn()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    record(label, performance.now() - start)
  }
}

export function timeSync<T>(label: string, fn: () => T): T {
  if (!PERF_ENABLED) return fn()
  const start = performance.now()
  try {
    return fn()
  } finally {
    record(label, performance.now() - start)
  }
}

export function getServerPerfStats(): PerfRow[] {
  return stats.snapshot()
}

export function resetServerPerfStats(): void {
  stats.reset()
}
