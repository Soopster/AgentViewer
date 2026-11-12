import type { AgentProvider } from './types'

export type AddressableSession = {
  sessionId: string
  /** Qualified delivery address; old servers may supply only the native id. */
  address?: string
  providerInstanceId?: string
  provider: AgentProvider
  name: string
  cwd?: string
  title?: string
  running: boolean
}

export type SendCrossSessionMessageResult = {
  delivered: boolean
  mode: 'steered' | 'queued' | 'not_found' | 'error' | 'throttled'
  targetSessionId?: string
  targetProvider?: AgentProvider
  targetProviderInstanceId?: string
  targetName?: string
  error?: string
}


/** Prefer the server's qualified identity; preserve compatibility with old endpoints. */
export function addressableSessionKey(session: AddressableSession): string {
  return session.address ?? session.sessionId
}

export type SendCrossSessionMessageParams = {
  fromSessionId?: string
  fromAddress?: string
  fromName: string
  toName: string
  text: string
}

function uniqueMatch(sessions: AddressableSession[], predicate: (session: AddressableSession) => boolean): AddressableSession | undefined {
  const matches = sessions.filter(predicate)
  return matches.length === 1 ? matches[0] : undefined
}

/** Exact names/ids always win; fuzzy input is accepted only when unambiguous. */
export function resolveAddressableSession(sessions: AddressableSession[], query: string): AddressableSession | undefined {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return undefined
  const addressed = uniqueMatch(sessions, session => session.address === query)
  if (addressed) return addressed
  if (sessions.some(session => session.sessionId === query)) return uniqueMatch(sessions, session => session.sessionId === query)
  return uniqueMatch(sessions, (session) => session.name.toLowerCase() === normalized)
    ?? uniqueMatch(sessions, (session) => session.name.toLowerCase().startsWith(normalized))
    ?? uniqueMatch(sessions, (session) => session.title?.toLowerCase().includes(normalized) === true)
}

