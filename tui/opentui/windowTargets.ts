import { sessionIdentityKey } from './sessionIdentity'
import type { Session } from '../../lib/types'
import { formatSessionTitle } from '../format'

export type WindowTarget = {
  key: string
  title: string
  detail: string
  hidden: boolean
  session?: Session
  /** A surface window's id: its kind, or `kind#n` for a further one. */
  surface?: string
}

export function windowSessionKey(session: Session): string {
  return sessionIdentityKey(session)
}

export function windowSessionTarget(session: Session, hidden: boolean): WindowTarget {
  return {
    key: windowSessionKey(session), title: formatSessionTitle(session), hidden, session,
    detail: `${session.providerDisplayName ?? session.provider ?? 'claude'} · ${session.cwd ?? 'no project'}${hidden ? ' · hidden' : ''}`,
  }
}

export function filterWindowTargets(targets: readonly WindowTarget[], query: string): WindowTarget[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return targets.filter((target) => {
    const haystack = `${target.title} ${target.detail} ${target.session?.sessionId ?? ''} ${target.session?.provider ?? ''} ${target.session?.providerInstanceId ?? ''}`.toLocaleLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export function snapshotBroadcastTargets(targets: readonly WindowTarget[], selected: ReadonlySet<string>): Session[] {
  const seen = new Set<string>()
  return targets.flatMap((target) => {
    if (!selected.has(target.key) || !target.session || target.session.isPending || seen.has(target.key)) return []
    seen.add(target.key)
    return [{ ...target.session, provider: target.session.provider ?? 'claude' }]
  })
}
