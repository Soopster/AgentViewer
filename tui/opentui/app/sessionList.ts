import type { TuiSessionDetail } from '../../../lib/tui/service'
import type { TuiSidebarSort } from '../../../lib/tuiState'
import type { Session } from '../../../lib/types'
import { formatSessionProject } from '../../format'
import { RECENT_SESSION_ACTIVITY_MS } from './timing'
import type { PendingInboxEdit, SidebarEntry, SidebarSubagentEntry } from './types'
import { sessionIdentityKey } from '../sessionIdentity'

export function sessionActivityMs(session: Session): number {
  const value = session.lastModified ?? session.createdAt
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? 0 : ms
  }
  return 0
}
export function isSessionRecentlyTouched(session: Session, now = Date.now()): boolean {
  const activityMs = sessionActivityMs(session)
  return activityMs > 0 && activityMs >= now - RECENT_SESSION_ACTIVITY_MS
}
function compareSessionsByActivityDesc(a: Session, b: Session): number {
  const byActivity = sessionActivityMs(b) - sessionActivityMs(a)
  if (byActivity !== 0) return byActivity
  return sessionKey(a).localeCompare(sessionKey(b))
}
// Which session (sessionId + provider) a read detail belongs to. The detail
// itself carries no identity, and two sessions can hold identical transcripts.
export const sessionDetailOwnerKeys = new WeakMap<TuiSessionDetail, string>()
export const sessionKey = sessionIdentityKey
export const PENDING_INBOX_EDIT_MS = 15000
export function withPendingInboxEdits(sessions: Session[], pending: Map<string, PendingInboxEdit>): Session[] {
  if (pending.size === 0) return sessions
  const now = Date.now()
  for (const [key, edit] of pending) if (edit.until <= now) pending.delete(key)
  if (pending.size === 0) return sessions
  return sessions.map((session) => {
    const edit = pending.get(sessionKey(session))
    if (!edit || session.inbox?.settledAt === edit.settledAt || Boolean(session.inbox?.settledAt) === Boolean(edit.settledAt)) return session
    const inbox = { ...session.inbox, settledAt: edit.settledAt }
    if (edit.settledAt === undefined) delete inbox.settledAt
    return { ...session, inbox }
  })
}
export function sessionsShallowEqual(a: Session[], b: Session[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const prev = a[i]
    const next = b[i]
    if (prev.sessionId !== next.sessionId
      || prev.provider !== next.provider
      || prev.lastModified !== next.lastModified
      || prev.transcriptUpdatedAt !== next.transcriptUpdatedAt
      || prev.customTitle !== next.customTitle
      || prev.summary !== next.summary
      || prev.cwd !== next.cwd
      || prev.tag !== next.tag
      || prev.parentSessionId !== next.parentSessionId
      // Settling, pinning and snoozing change only the inbox; ignoring it kept a
      // session settled on the web (or here, by an earlier poll) as it was.
      || prev.inbox?.settledAt !== next.inbox?.settledAt
      || prev.inbox?.pinnedAt !== next.inbox?.pinnedAt
      || prev.inbox?.snoozedUntil !== next.inbox?.snoozedUntil) return false
  }
  return true
}
export function sidebarEntrySession(entry: SidebarEntry): Session | null {
  if (entry.type === 'session') return entry.session
  if (entry.type === 'subagent' && entry.entry.kind === 'session') return entry.entry.session
  return null
}
// Keep only the current list. Selection moves copy its element array and
// rebuild the old/new highlights without walking or allocating keys for every
// row. Multiple rows may represent the same session (including nested rows).

export function createSidebarRowElements<Entry extends { key: string} , Element>(
  getSessionKey: (entry: Entry) => string | null
) {
  let previousEntries: readonly Entry[] | null = null
  let previousBuild: ((entry: Entry, selected: boolean) => Element) | null = null
  let previousSelection: string | null = null
  let rows: Element[] = []
  let sessionKeys: Array<string | null> = []
  const indicesBySession = new Map<string, number | number[]>()
  const cache = new Map<string, { entry: Entry; selected: boolean; element: Element; generation: number} >()
  let generation = 0
  return (entries: readonly Entry[], selectedKey: string | null, build: (entry: Entry, selected: boolean) => Element): Element[] => {
    // Polls/filters can replace the array without changing any row. Preserve
    // the index and cached elements for this case instead of rebuilding Maps.
    if (entries !== previousEntries && build === previousBuild && previousEntries?.length === entries.length
      && entries.every((entry, index) => entry === previousEntries![index])) previousEntries = entries
    if (entries === previousEntries && build === previousBuild) {
      if (selectedKey === previousSelection) return rows
      const next = rows.slice()
      for (const [key, selected] of [[previousSelection, false], [selectedKey, true]] as const) {
        if (key === null) continue
        const indices = indicesBySession.get(key)
        if (indices === undefined) continue
        for (const index of typeof indices === 'number' ? [indices] : indices) {
          const entry = entries[index]
          const element = build(entry, selected)
          next[index] = element
          cache.set(entry.key, { entry, selected, element, generation })
        }
      }
      previousSelection = selectedKey
      rows = next
      return rows
    }
    generation++
    let indexChanged = sessionKeys.length !== entries.length
    const nextSessionKeys = new Array<string | null>(entries.length)
    rows = entries.map((entry, index) => {
      const key = getSessionKey(entry)
      nextSessionKeys[index] = key
      if (key !== sessionKeys[index]) indexChanged = true
      const selected = key !== null && key === selectedKey
      const previous = cache.get(entry.key)
      const reusable = build === previousBuild && previous?.entry === entry && previous.selected === selected
      const element = reusable ? previous.element : build(entry, selected)
      if (reusable) previous.generation = generation
      else cache.set(entry.key, { entry, selected, element, generation })
      return element
    })
    if (indexChanged) {
      indicesBySession.clear()
      for (let index = 0; index < nextSessionKeys.length; index++) {
        const key = nextSessionKeys[index]
        if (key === null) continue
        const indices = indicesBySession.get(key)
        if (typeof indices === 'number') indicesBySession.set(key, [indices, index])
        else if (indices) indices.push(index)
        else indicesBySession.set(key, index)
      }
    }
    sessionKeys = nextSessionKeys
    for (const [key, cached] of cache) if (cached.generation !== generation) cache.delete(key)
    previousEntries = entries
    previousBuild = build
    previousSelection = selectedKey
    return rows
  }
}
export function sidebarEntrySessionKey(entry: SidebarEntry): string | null {
  const session = sidebarEntrySession(entry)
  return session ? sessionKey(session) : entry.type === 'subagent' ? entry.key : null
}
export function buildSidebarEntries(
  sessions: Session[],
  sort: TuiSidebarSort,
  childrenByParentId?: Map<string, SidebarSubagentEntry[]>,
  collapsedSubagents: ReadonlySet<string> = new Set()): SidebarEntry[] {
  const entries: SidebarEntry[] = []
  // Real child sessions are nested under their parent instead of
  // appearing as unrelated top-level rows — but only when the parent is
  // actually present in this list (search/filter can exclude it).
  const presentIds = new Set(sessions.map(sessionKey))
  const isNestedChild = (session: Session) => !!session.parentSessionId
    && presentIds.has(sessionKey({ sessionId: session.parentSessionId, provider: session.provider, providerInstanceId: session.providerInstanceId }))
  const pushSubagents = (
    parentSession: Session,
    parentKey: string,
    depth = 1,
    lineage = new Set<string>()
  ) => {
    const parentIdentity = sessionKey(parentSession)
    if (lineage.has(parentIdentity) || collapsedSubagents.has(parentIdentity)) return
    const nextLineage = new Set(lineage).add(parentIdentity)
    const children = childrenByParentId?.get(parentIdentity)
    if (!children || children.length === 0) return
    for (const child of children) {
      const key = child.kind === 'session'
        ? `subagent:${parentKey}:${sessionKey(child.session)}`
        : `subagent:${parentKey}:${child.summary.agentId}`
      entries.push({ type: 'subagent', key, parentSession, entry: child, depth })
      if (child.kind === 'session') pushSubagents(child.session, key, depth + 1, nextLineage)
    }
  }

  const visibleSessions = sessions.filter((session) => !isNestedChild(session))
  const orderedSessions = visibleSessions
    .map((session) => ({ session, absoluteIndex: sessions.indexOf(session) }))
    .sort((a, b) => compareSessionsByActivityDesc(a.session, b.session))

  if (sort === 'time') {
    // Sessions stay in global time-sort order. A project header is injected before
    // each run of consecutive sessions that share a project name.
    let prevProject = ''
    for (let i = 0; i < orderedSessions.length; i++) {
      const { session, absoluteIndex } = orderedSessions[i]
      const projectName = formatSessionProject(session).toUpperCase()
      if (projectName !== prevProject) {
        // Measure the length of this consecutive run so the header can show a count.
        let run = 1
        while (i + run < orderedSessions.length
          && formatSessionProject(orderedSessions[i + run].session).toUpperCase() === projectName) run++
        // Key includes the absolute index so the same project appearing multiple
        // times in time-order gets distinct keys (required by the reconciler).
        entries.push({ type: 'project', key: `project:${projectName}:${i}`, projectName, count: run })
        prevProject = projectName
      }
      const sessionEntryKey = `session:${sessionKey(session)}`
      entries.push({
        type: 'session',
        key: sessionEntryKey,
        session,
        absoluteIndex,
      })
      pushSubagents(session, sessionEntryKey)
    }
    return entries
  }

  // 'project' mode: group sessions by project, preserving time-sort order within each
  // group. Groups are ordered by the most-recently modified session they contain.
  const groupOrder: string[] = []
  const groups = new Map<string, Array<{ session: Session; absoluteIndex: number} >>()
  orderedSessions.forEach(({ session, absoluteIndex }) => {
    const projectName = formatSessionProject(session).toUpperCase()
    if (!groups.has(projectName)) {
      groups.set(projectName, [])
      groupOrder.push(projectName)
    }
    groups.get(projectName)!.push({ session, absoluteIndex })
  })

  for (const projectName of groupOrder) {
    const members = groups.get(projectName)!
    entries.push({ type: 'project', key: `project:${projectName}`, projectName, count: members.length })
    for (const { session, absoluteIndex } of members) {
      const sessionEntryKey = `session:${sessionKey(session)}`
      entries.push({
        type: 'session',
        key: sessionEntryKey,
        session,
        absoluteIndex,
      })
      pushSubagents(session, sessionEntryKey)
    }
  }
  return entries
}
