import { sessionIdentityKey, type SessionIdentity } from '@/lib/sessionIdentity'
import type { Session } from '@/lib/types'

export type SessionMetadataPatch = Partial<Pick<Session, 'customTitle' | 'summary' | 'tag'>>
export type SessionMetadataCallbacks = {
  onRename: (target: SessionIdentity, title: string) => void
  onTag: (target: SessionIdentity, tag: string | null) => void
}
export type SessionDeleteCallback = (target: SessionIdentity) => void

export function createSessionMetadataCallbacks(
  apply: (target: SessionIdentity, patch: SessionMetadataPatch) => void,
): SessionMetadataCallbacks {
  return {
    onRename: (target, title) => apply(target, { customTitle: title, summary: title }),
    onTag: (target, tag) => apply(target, { tag }),
  }
}

export function patchSessionMetadata(session: Session, target: SessionIdentity, patch: SessionMetadataPatch): Session {
  if (sessionIdentityKey(session) !== sessionIdentityKey(target)) return session
  if (Object.entries(patch).every(([field, value]) => session[field] === value)) return session
  return { ...session, ...patch }
}

export function patchSessionList(sessions: Session[], target: SessionIdentity, patch: SessionMetadataPatch): Session[] {
  let changed = false
  const next = sessions.map(session => {
    const updated = patchSessionMetadata(session, target, patch)
    if (updated !== session) changed = true
    return updated
  })
  return changed ? next : sessions
}

export function removeSessionFromList(sessions: Session[], target: SessionIdentity): Session[] {
  const key = sessionIdentityKey(target)
  const next = sessions.filter(session => sessionIdentityKey(session) !== key)
  return next.length === sessions.length ? sessions : next
}

/** Resolve active navigation when a deletion completes, not when it starts. */
export function createSessionDeleteCallback({ remove, isActive, clearActive }: {
  remove: (target: SessionIdentity) => void
  isActive: (target: SessionIdentity) => boolean
  clearActive: () => void
}): SessionDeleteCallback {
  return target => {
    const wasActive = isActive(target)
    remove(target)
    if (wasActive) clearActive()
  }
}
