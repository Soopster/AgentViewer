import type { Session } from '../../../lib/types'
import type { SidebarSubagentEntry } from '../app/types'
import { buildSidebarEntries, groupSidebarDates, isCollapsedByDefaultProject, mergeCoordinatorGroups, sessionActivityMs, sessionKey } from '../app/sessionList'

export type EngineeringSidebarRow =
  | { type: 'group'; key: string; label: string; count: number; collapsed: boolean; dateGroup: boolean }
  | { type: 'session'; key: string; session: Session; indent: number }

/** Use the same project names, ordering, child adjacency and calendar groups as the standard rail. */
export const ENGINEERING_RUNNING_GROUP = 'engineering:running'

export const ENGINEERING_INPUT_GROUP = 'engineering:needs-input'
export const ENGINEERING_PINNED_GROUP = 'engineering:pinned'

export function engineeringSidebarRows(sessions: Session[], collapsed: readonly string[], now = new Date(), runningKeys: ReadonlySet<string> = new Set(), needsInput: ReadonlySet<string> = new Set(), pinned: ReadonlySet<string> = new Set(), expandedOlder: readonly string[] = []) {
  const groups = [
    { key: ENGINEERING_RUNNING_GROUP, label: 'RUNNING', sessions: [] as Session[] },
    { key: ENGINEERING_INPUT_GROUP, label: 'NEEDS INPUT', sessions: [] as Session[] },
    { key: ENGINEERING_PINNED_GROUP, label: 'PINNED', sessions: [] as Session[] },
  ]
  const resting: Session[] = []
  for (const session of sessions) {
    const key = sessionKey(session)
    const group = needsInput.has(key) ? groups[1] : runningKeys.has(key) ? groups[0] : pinned.has(key) ? groups[2] : null
    if (group) group.sessions.push(session)
    else resting.push(session)
  }
  const children = new Map<string, SidebarSubagentEntry[]>()
  for (const session of resting) {
    if (!session.parentSessionId) continue
    const key = sessionKey({ sessionId: session.parentSessionId, provider: session.provider, providerInstanceId: session.providerInstanceId })
    const entries = children.get(key) ?? []
    entries.push({ kind: 'session', session })
    children.set(key, entries)
  }
  const projects = mergeCoordinatorGroups(buildSidebarEntries(resting, 'project', children))
  const projectBySession = new Map<string, string>()
  let projectKey = ''
  for (const entry of projects) {
    if (entry.type === 'project') projectKey = entry.key
    else if (entry.type === 'session') projectBySession.set(sessionKey(entry.session), projectKey)
    else if (entry.entry.kind === 'session') projectBySession.set(sessionKey(entry.entry.session), projectKey)
  }
  const rows: EngineeringSidebarRow[] = []
  for (const group of groups) {
    if (!group.sessions.length) continue
    group.sessions.sort((a, b) => sessionActivityMs(b) - sessionActivityMs(a) || sessionKey(a).localeCompare(sessionKey(b)))
    const folded = collapsed.includes(group.key)
    rows.push({ type: 'group', key: group.key, label: group.label, count: group.sessions.length, collapsed: folded, dateGroup: false })
    for (const session of group.sessions) {
      const key = sessionKey(session)
      projectBySession.set(key, group.key)
      if (!folded) rows.push({ type: 'session', key: `${group.key}:${key}`, session, indent: 0 })
    }
  }
  // Let the shared builder preserve child adjacency, then fold dates locally so
  // Older defaults and saved expansion cannot affect any other transcript view.
  const projectToggles = new Set(collapsed.filter(key => !key.includes(':date:')))
  let dateIndented = false, dateHidden = false, owner = ''
  for (const entry of groupSidebarDates(projects, projectToggles, now, { includeSingleOlder: true })) {
    if (entry.type === 'project') {
      dateIndented = Boolean(entry.dateGroup)
      dateHidden = dateIndented && (collapsed.includes(entry.key) || entry.projectName === 'Older' && !expandedOlder.includes(entry.key))
      owner = entry.key
      rows.push({ type: 'group', key: entry.key, label: entry.projectName, count: entry.count, collapsed: dateIndented ? dateHidden : Boolean(entry.collapsed), dateGroup: dateIndented })
    } else {
      const session = entry.type === 'session' ? entry.session : entry.entry.kind === 'session' ? entry.entry.session : null
      if (!session) continue
      projectBySession.set(sessionKey(session), owner)
      if (dateHidden) continue
      rows.push({ type: 'session', key: entry.key, session, indent: entry.type === 'session' ? entry.indented ? 2 : 0 : Math.min(6, entry.depth * 2 + (dateIndented ? 2 : 0)) })
    }
  }
  return { rows, projectBySession }
}

export function engineeringProjectCollapsed(key: string, collapsed: readonly string[], expandedOlder: readonly string[] = []): boolean {
  if (key.endsWith(':date:Older')) return collapsed.includes(key) || !expandedOlder.includes(key)
  if (key.includes(':date:')) return collapsed.includes(key)
  return collapsed.includes(key) !== isCollapsedByDefaultProject(key.replace(/^project:/, ''))
}
