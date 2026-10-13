export const TUI_TARGET_FPS = 120
export const TUI_FRAME_BUDGET_MS = 1000 / TUI_TARGET_FPS

export function formatTuiFrameBudgetMs(): string {
  return TUI_FRAME_BUDGET_MS.toFixed(2)
}

export type FrameTimeSummary = { count: number; over: number; p50: number; p95: number; worst: number }

/** Nearest-rank percentiles: a p95 that interpolates hides the one slow frame. */
export function summarizeFrameTimes(durationsMs: readonly number[], budgetMs = TUI_FRAME_BUDGET_MS): FrameTimeSummary {
  if (durationsMs.length === 0) return { count: 0, over: 0, p50: 0, p95: 0, worst: 0 }
  const sorted = [...durationsMs].sort((a, b) => a - b)
  const rank = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]
  return {
    count: sorted.length,
    over: sorted.filter((duration) => duration > budgetMs).length,
    p50: rank(0.5),
    p95: rank(0.95),
    worst: sorted[sorted.length - 1],
  }
}
