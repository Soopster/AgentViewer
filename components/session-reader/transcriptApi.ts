import { readJsonResponse } from '@/lib/httpResponse'
import type { ProviderSelection, Session, SessionMessage } from '@/lib/types'
import { MESSAGE_STREAM_LIMIT, type MessageStreamPayload } from './messageStream'
import { numericOffset } from './sessionTranscriptWindow'

export function withProviderQuery(path: string, provider?: ProviderSelection, providerInstanceId?: string): string {
  if (!provider && !providerInstanceId) return path
  const params = new URLSearchParams()
  if (provider) params.set('provider', provider)
  if (providerInstanceId && provider !== 'all') params.set('providerInstanceId', providerInstanceId)
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`
}

export async function fetchSessionTranscript(session: Session, targetMessageId: string | undefined, signal: AbortSignal) {
  const query = targetMessageId ? 'limit=100000&all=1' : 'limit=2000&tail=1'
  const response = await fetch(withProviderQuery(
    `/api/sessions/${encodeURIComponent(session.sessionId)}/messages?${query}`,
    session.provider, session.providerInstanceId,
  ), { signal })
  const data = await readJsonResponse(response)
  if (data.error) throw new Error(data.error)
  return {
    offset: numericOffset(data.offset),
    messages: (data.messages ?? []) as SessionMessage[],
    externalWriter: data.externalWriter === true,
  }
}

export async function pollSessionTranscript(session: Session, offset: number, expectUuid: string | undefined, signal: AbortSignal) {
  const response = await fetch(withProviderQuery(
    `/api/sessions/${encodeURIComponent(session.sessionId)}/messages?offset=${offset}&limit=${MESSAGE_STREAM_LIMIT}`
      + (expectUuid ? `&expectUuid=${encodeURIComponent(expectUuid)}` : ''),
    session.provider, session.providerInstanceId,
  ), { signal })
  const data = await readJsonResponse(response)
  if (data.error) throw new Error(data.error)
  return data as MessageStreamPayload
}

export type ProjectTranscriptQuery = {
  dir: string
  provider: ProviderSelection
  providerInstanceId: string
  includeWorktrees: boolean
}
export type ProjectMessageBatch = {
  key: string
  offset: number
  messages: SessionMessage[]
}

export async function fetchProjectTranscript(query: ProjectTranscriptQuery, offsets: Record<string, number>, signal: AbortSignal) {
  const { providerInstanceId, ...fields } = query
  const response = await fetch('/api/sessions/project/messages', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields,
      ...(query.provider !== 'all' ? { providerInstanceId } : {}),
      offsets, initialLimit: 300, incrementalLimit: 200,
    }),
  })
  const data = await readJsonResponse(response)
  if (data.error) throw new Error(data.error)
  return { sessions: (data.sessions ?? []) as Session[], batches: (data.batches ?? []) as ProjectMessageBatch[] }
}
