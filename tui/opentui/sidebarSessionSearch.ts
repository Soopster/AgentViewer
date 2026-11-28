import type { Session } from '../../lib/types'
import { formatSessionProject, formatSessionTitle } from '../format'

// One index per immutable session list. Build lazily so opening the sidebar
// without searching has no formatting or allocation cost.
export function createSidebarSessionSearch(sessions: Session[]): (query: string) => Session[] {
  let index: Array<{ session: Session; title: string; project: string; id: string }> | undefined
  return (query) => {
    if (!query) return sessions
    index ??= sessions.map((session) => ({
      session,
      title: formatSessionTitle(session).toLowerCase(),
      project: formatSessionProject(session).toLowerCase(),
      id: (session.sessionId ?? '').toLowerCase(),
    }))
    const matches: Session[] = []
    for (const entry of index) {
      if (entry.title.includes(query) || entry.project.includes(query) || entry.id.includes(query)) matches.push(entry.session)
    }
    return matches
  }
}
