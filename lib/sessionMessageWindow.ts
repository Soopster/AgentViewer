import { compactStableFingerprint } from './compactFingerprint'
import type { SessionMessage } from './types'

const signatureCache = new WeakMap<SessionMessage, string>()

export function sessionMessageWindowKey(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}

export function sessionMessageWindowSignature(message: SessionMessage): string {
  const cached = signatureCache.get(message)
  if (cached !== undefined) return cached
  const signature = [
    message.type,
    message.timestamp ?? '',
    message.origin?.kind ?? '',
    message.turnId ?? '',
    compactStableFingerprint(message.message),
  ].join('|')
  signatureCache.set(message, signature)
  return signature
}

/**
 * Apply a server message window by absolute transcript position.
 *
 * Provider archives (especially Codex) have an authoritative turn/item order
 * that cannot be reconstructed from timestamps: several items may only have a
 * turn-level timestamp while a user item has a later UUID-derived timestamp.
 * Treating a backfill poll as timestamp-sorted additions can therefore move the
 * user prompt behind the reply. Absolute window offsets preserve provider order
 * and let an already-mounted transcript repair a previously misordered tail.
 */
export function mergeOrderedSessionMessageWindow(
  existing: SessionMessage[],
  incoming: SessionMessage[],
  options: {
    offset: number
    previousTotal: number
  },
): SessionMessage[] | null {
  if (incoming.length === 0) return existing

  const existingStart = Math.max(0, options.previousTotal - existing.length)
  const existingEnd = existingStart + existing.length
  const incomingStart = options.offset
  const incomingEnd = incomingStart + incoming.length

  // A gap means one of the windows is stale or incomplete. Let the caller use
  // its key/timestamp fallback rather than inventing missing absolute slots.
  if (incomingEnd < existingStart || incomingStart > existingEnd) return null

  const start = Math.min(existingStart, incomingStart)
  const end = Math.max(existingEnd, incomingEnd)
  const merged: Array<SessionMessage | undefined> = new Array(end - start)
  const existingByKey = new Map(existing.map((message) => [sessionMessageWindowKey(message), message]))

  for (let index = 0; index < existing.length; index += 1) {
    merged[existingStart - start + index] = existing[index]
  }
  for (let index = 0; index < incoming.length; index += 1) {
    const message = incoming[index]
    const prior = existingByKey.get(sessionMessageWindowKey(message))
    merged[incomingStart - start + index] = prior
      && sessionMessageWindowSignature(prior) === sessionMessageWindowSignature(message)
      ? prior
      : message
  }

  if (merged.some((message) => message === undefined)) return null
  const complete = merged as SessionMessage[]
  if (complete.length === existing.length && complete.every((message, index) => message === existing[index])) {
    return existing
  }
  return complete
}
