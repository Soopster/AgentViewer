import { appendFile } from 'node:fs'
import { join } from 'node:path'
import { tuiMetricsEnabled, cardProfileEnabled } from '../metricsLogger'
import { TUI_FRAME_BUDGET_MS } from '../performanceBudget'

// ── Optional render-frame timing (set AGENT_VIEWER_PERF=1) ───────────────────
// A fullscreen TUI can't log to stdout/stderr without corrupting the render, so
// frame timings are appended to a file. Each render stamps the start time in the
// component body; a post-commit effect measures the render→commit duration and,
// once per second, appends a summary line: commits observed, how many blew the
// 120fps (8.33ms) budget, and the slowest. Zero runtime cost unless enabled.
export const PERF_LOG = process.env.AGENT_VIEWER_PERF === '1'
export const PERF_LOG_PATH = process.env.AGENT_VIEWER_PERF_LOG
  ?? join(process.cwd(), '.agent-viewer-data', 'tui-perf.log')
// Either sink wants a render-start stamp; check both so enabling just
// AGENT_VIEWER_TUI_METRICS (without AGENT_VIEWER_PERF) still times frames.
export const FRAME_TIMING_NEEDED = PERF_LOG || tuiMetricsEnabled()
// Targeted live-streaming render profiling — see metricsLogger.ts. Read once
// at module scope (matches PERF_LOG) so the hot-path memos below pay nothing
// but a boolean check when disabled.
export const CARD_PROFILE = cardProfileEnabled()
const perfWindow = { frames: 0, slow: 0, maxDur: 0, startedAt: 0 }
export function recordFramePerf(durationMs: number): void {
  const now = performance.now()
  if (perfWindow.startedAt === 0) perfWindow.startedAt = now
  perfWindow.frames++
  if (durationMs > TUI_FRAME_BUDGET_MS) perfWindow.slow++
  if (durationMs > perfWindow.maxDur) perfWindow.maxDur = durationMs
  if (now - perfWindow.startedAt >= 1000) {
    const line = `${new Date().toISOString()} commits=${perfWindow.frames} over-budget=${perfWindow.slow} max=${perfWindow.maxDur.toFixed(2)}ms\n`
    // Keep the canary out of the frame it measures. A synchronous append here
    // created its own once-per-second outlier, especially on slower disks and
    // Windows antivirus-scanned worktrees.
    appendFile(PERF_LOG_PATH, line, () => { })
    perfWindow.frames = 0
    perfWindow.slow = 0
    perfWindow.maxDur = 0
    perfWindow.startedAt = now
  }
}
// Root render counter. The root is one very large component, so "did this
// state change re-render the whole app?" is the question every surface moved
// out of it has to answer — and a Profiler cannot answer it, because a commit
// caused by a memoized child still fires the Profiler wrapping the root. An
// increment here is the only thing that distinguishes the two. It costs one
// integer add per render.
let rootRenderCount = 0
/** Called once per root render. */
export function noteRootRender(): void {
  rootRenderCount += 1
}
export function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
export function readRootRenderCount(): number {
  return rootRenderCount
}
