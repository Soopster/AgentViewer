import type { Session } from './types'

export type SessionIdentity = Pick<Session, 'provider' | 'providerInstanceId' | 'sessionId'>

/** Default connections keep their persisted window/draft keys. Configured
 * instances occupy a separate namespace; native IDs may contain delimiters. */
export function sessionIdentityKey(session: SessionIdentity): string {
  const provider = session.provider ?? 'claude'
  const instance = session.providerInstanceId
  return instance && instance !== provider
    ? `${provider}@${encodeURIComponent(instance)}:${session.sessionId}`
    : `${provider}:${session.sessionId}`
}

/** Internal delivery variants are tuples, never prefixes of persisted IDs. */
export const sessionVariantKey = (owner: string, variant: string): string => JSON.stringify([owner, variant])
export const sessionVariantParts = (key: string): [owner: string, variant: string] => JSON.parse(key)
