import { readSessionSearchStream, sessionSearchQuery } from '../../lib/session-index/searchStream'
import type { PluginSessionInsightsService } from '../../lib/plugins/sessionInsights'

// The Web's session-insights service: the session provenance route (with its
// recorded edits) and the session-index search route.
export function createWebSessionInsightsService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginSessionInsightsService {
  const json = async (url: string, signal?: AbortSignal) => {
    const response = await fetcher(url, { signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) throw new Error(body.error || `Request failed (${response.status})`)
    return body
  }
  return {
    async provenance(session, signal) {
      const body = await json(`/api/sessions/${encodeURIComponent(session.sessionId)}/provenance?${new URLSearchParams({ provider: session.provider, edits: '1' })}`, signal)
      const { edits, ...summary } = body
      return { summary, edits: Array.isArray(edits) ? edits : [] }
    },
    async search(params, signal, onPartial) {
      const query = sessionSearchQuery(params)
      if (!onPartial) return json(`/api/session-index/search?${query}`, signal)
      query.set('stream', '1')
      return readSessionSearchStream(await fetcher(`/api/session-index/search?${query}`, { signal }), onPartial)
    },
  }
}

export const webSessionInsights = createWebSessionInsightsService()
