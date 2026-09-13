export const TUI_TARGET_FPS = 120
export const TUI_FRAME_BUDGET_MS = 1000 / TUI_TARGET_FPS

export function formatTuiFrameBudgetMs(): string {
  return TUI_FRAME_BUDGET_MS.toFixed(2)
}
