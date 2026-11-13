import type { Session, SessionMessage, SubagentSummary } from '../../lib/types'

// The Web's subagent-transcript service: a session's captured subagents, and
// one's conversation, from the routes the agent cards already use.
export type WebSubagentTranscriptService = {
  readonly list: (session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>, signal?: AbortSignal) => Promise<SubagentSummary[]>
  readonly load: (session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>, agentId: string, signal?: AbortSignal) => Promise<SessionMessage[]>
}

export function createWebSubagentTranscriptService(fetcher: typeof fetch = (...args) => fetch(...args)): WebSubagentTranscriptService {
  const query = (session: Pick<Session, 'provider' | 'providerInstanceId'>) => new URLSearchParams({ ...(session.provider ? { provider: session.provider } : {}), ...(session.providerInstanceId ? { providerInstanceId: session.providerInstanceId } : {}) })
  const json = async (url: string, signal?: AbortSignal) => {
    const response = await fetcher(url, { signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) throw new Error(body.error || `Request failed (${response.status})`)
    return body
  }
  return {
    list: async (session, signal) => (await json(`/api/sessions/${encodeURIComponent(session.sessionId)}/subagents?${query(session)}`, signal)).subagents ?? [],
    load: async (session, agentId, signal) => (await json(`/api/sessions/${encodeURIComponent(session.sessionId)}/subagents/${encodeURIComponent(agentId)}/messages?${query(session)}`, signal)).messages ?? [],
  }
}

export const webSubagentTranscripts = createWebSubagentTranscriptService()
