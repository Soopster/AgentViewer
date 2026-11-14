import { compactStableFingerprint } from '@/lib/compactFingerprint'
import { sessionIdentityKey } from '@/lib/sessionIdentity'
import type { Session } from '@/lib/types'

// Session metadata is immutable. Compare the full wire shape so new provider
// fields, inbox changes, and capability changes cannot bypass a narrow field list.
const signatures = new WeakMap<Session, string>()
function signature(session: Session): string {
  const cached = signatures.get(session)
  if (cached !== undefined) return cached
  const result = compactStableFingerprint(session)
  signatures.set(session, result)
  return result
}

export function stabilizeSessionIdentities(previous: Session[], incoming: Session[]): Session[] {
  const byKey = new Map(previous.map(session => [sessionIdentityKey(session), session]))
  let unchanged = previous.length === incoming.length
  const next = incoming.map((session, index) => {
    const prior = byKey.get(sessionIdentityKey(session))
    const stable = prior && signature(prior) === signature(session) ? prior : session
    if (previous[index] !== stable) unchanged = false
    return stable
  })
  return unchanged ? previous : next
}

/** Preserve tab order and tabs absent from the current provider/scope query. */
export function refreshOpenSessionMetadata(tabs: Session[], sessions: Session[]): Session[] {
  const byKey = new Map(sessions.map(session => [sessionIdentityKey(session), session]))
  let changed = false
  const next = tabs.map(tab => {
    const updated = byKey.get(sessionIdentityKey(tab)) ?? tab
    if (updated !== tab) changed = true
    return updated
  })
  return changed ? next : tabs
}
