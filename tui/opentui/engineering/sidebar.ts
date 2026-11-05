import type { Session } from '../../../lib/types'
import type { SidebarSubagentEntry } from '../app/types'
import { buildSidebarEntries, groupSidebarDates, isCollapsedByDefaultProject, mergeCoordinatorGroups, sessionActivityMs, sessionKey } from '../app/sessionList'

export type EngineeringSidebarRow =
  | { type: 'group'; key: string; label: string; count: number; collapsed: boolean; dateGroup: boolean }
  | { type: 'session'; key: string; session: Session; indent: number }

/** Use the same project names, ordering, child adjacency and calendar groups as the standard rail. */
export const ENGINEERING_RUNNING_GROUP = 'engineering:running'

export function engineeringSidebarRows(sessions: Session[], collapsed: readonly string[], now = new Date(), runningKeys: ReadonlySet<string> = new Set()) {
  const running = sessions.filter(session => runningKeys.has(sessionKey(session)))
    .sort((a, b) => sessionActivityMs(b) - sessionActivityMs(a) || sessionKey(a).localeCompare(sessionKey(b)))
  const resting = sessions.filter(session => !runningKeys.has(sessionKey(session)))
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
  if (running.length) {
    const folded = collapsed.includes(ENGINEERING_RUNNING_GROUP)
    rows.push({ type: 'group', key: ENGINEERING_RUNNING_GROUP, label: 'RUNNING', count: running.length, collapsed: folded, dateGroup: false })
    for (const session of running) {
      const key = sessionKey(session)
      projectBySession.set(key, ENGINEERING_RUNNING_GROUP)
      if (!folded) rows.push({ type: 'session', key: `running:${key}`, session, indent: 0 })
    }
  }
  let dateIndented = false
  for (const entry of groupSidebarDates(projects, new Set(collapsed), now)) {
    if (entry.type === 'project') {
      dateIndented = Boolean(entry.dateGroup)
      rows.push({ type: 'group', key: entry.key, label: entry.projectName, count: entry.count, collapsed: Boolean(entry.collapsed), dateGroup: dateIndented })
    } else if (entry.type === 'session') {
      rows.push({ type: 'session', key: entry.key, session: entry.session, indent: entry.indented ? 2 : 0 })
    } else if (entry.entry.kind === 'session') {
      rows.push({ type: 'session', key: entry.key, session: entry.entry.session, indent: Math.min(6, entry.depth * 2 + (dateIndented ? 2 : 0)) })
    }
  }
  return { rows, projectBySession }
}

export function engineeringProjectCollapsed(key: string, collapsed: readonly string[]): boolean {
  return collapsed.includes(key) !== isCollapsedByDefaultProject(key.replace(/^project:/, ''))
}
