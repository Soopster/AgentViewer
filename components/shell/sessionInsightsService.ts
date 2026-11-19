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
    search(params, signal) {
      const query = new URLSearchParams({ q: params.query, messagesOnly: '0' })
      if (params.limit) query.set('limit', String(params.limit))
      if (params.provider && params.provider !== 'all') query.set('provider', params.provider)
      if (params.dir) query.set('dir', params.dir)
      if (params.sinceMs != null) query.set('sinceMs', String(params.sinceMs))
      if (params.untilMs != null) query.set('untilMs', String(params.untilMs))
      if (params.hasError) query.set('hasError', '1')
      if (params.touchedFile) query.set('touchedFile', params.touchedFile)
      return json(`/api/session-index/search?${query}`, signal)
    },
  }
}

export const webSessionInsights = createWebSessionInsightsService()
