import type { DailySummary } from '../../lib/dailySummary'
import type { PluginDailySummaryService } from '../../lib/plugins/dailySummary'

export function createWebDailySummaryService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginDailySummaryService {
  return {
    async read(range, signal) {
      const response = await fetcher(`/api/daily-summary?range=${encodeURIComponent(range)}`, { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.error) throw new Error(body.error || `Could not read the summary (${response.status})`)
      return body as DailySummary
    },
  }
}

export const webDailySummary = createWebDailySummaryService()
