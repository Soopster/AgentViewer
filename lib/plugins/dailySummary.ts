import type { DailySummary, DailySummaryRange } from '../dailySummary'

/**
 * Reads what every agent did over a range. The host decides what is waiting on
 * the user (its attention inbox) at the moment of the read; a plugin never
 * assembles that itself.
 */
export type PluginDailySummaryService = {
  readonly read: (range: DailySummaryRange, signal?: AbortSignal) => Promise<DailySummary>
}
