import { computeAnalytics, type Analytics, type AnalyticsInput } from '../../lib/analytics'

type AnalyticsRequest = { id: number; detail: AnalyticsInput | null }
type AnalyticsResponse =
  | { id: number; ok: true; analytics: Analytics }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<AnalyticsRequest>) => void) | null
  postMessage: (message: AnalyticsResponse) => void
}

self.onmessage = async (event) => {
  const { id, detail } = event.data
  try {
    const analytics = computeAnalytics(detail)
    self.postMessage({ id, ok: true, analytics })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
