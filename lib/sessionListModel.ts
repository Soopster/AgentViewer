import type { Session } from './types'
import { normalizeProjectPath, pathBasename, pickCanonicalProjectPath } from './projectPaths'
import { parseStoredSessionTags } from './sessionTags'

type ProjectGroupEntry = {
  projectDir: string
  projectName: string
  sessions: Session[]
}

export type IndexedSession = {
  session: Session
  tags: string[]
  lowerTags: string[]
  searchText: string
  normalizedProjectDir: string
  projectName: string
}

export function indexSession(session: Session): IndexedSession {
  const tags = parseStoredSessionTags(session.tag)
  const title = session.customTitle ?? session.summary ?? ''
  const normalizedDir = normalizeProjectPath(session.cwd) || '—'
  return {
    session,
    tags,
    lowerTags: tags.map((tag) => tag.toLowerCase()),
    searchText: [
      title,
      tags.join(' '),
      session.cwd ?? '',
      session.firstPrompt ?? '',
    ].join('\n').toLowerCase(),
    normalizedProjectDir: normalizedDir,
    projectName: pathBasename(normalizedDir) || '—',
  }
}

/** Session list polling stabilizes immutable session objects before rendering.
 * Reuse their search/tag/path metadata when another session changes. Weak keys
 * avoid retaining closed provider lists and replaced sessions.
 */
export function createSessionListIndexer() {
  let initial: IndexedSession[] | null = null
  let cache: WeakMap<Session, IndexedSession> | null = null
  return (sessions: readonly Session[]): IndexedSession[] => {
    // The cold path only indexes; defer building the reuse lookup until an
    // update actually needs it. Release that initial snapshot once indexed.
    if (!initial && !cache) {
      initial = sessions.map(indexSession)
      return initial
    }
    if (!cache) {
      cache = new WeakMap(initial!.map(indexed => [indexed.session, indexed]))
      initial = null
    }
    const lookup = cache
    return sessions.map(session => {
      let indexed = lookup.get(session)
      if (!indexed) {
        indexed = indexSession(session)
        lookup.set(session, indexed)
      }
      return indexed
    })
  }
}

export function matchesIndexedSessionSearch(session: IndexedSession, search: string, activeTag: string | null): boolean {
  if (activeTag && !session.lowerTags.includes(activeTag.toLowerCase())) return false
  if (!search) return true
  return session.searchText.includes(search)
}

/**
 * Sessions with a known `parentSessionId` (today: OpenCode subagent child
 * sessions — Claude subagents aren't real sessions at all, see
 * getClaudeSubagentSummaries) are pulled out of the flat/grouped list and
 * returned separately so the sidebar can nest them under their parent row
 * instead of showing them as unrelated top-level sessions.
 */
export function groupByProject(sessions: IndexedSession[]): { groups: ProjectGroupEntry[]; childrenByParentId: Map<string, Session[]> } {
  const groups: ProjectGroupEntry[] = []
  const groupsByPath = new Map<string, ProjectGroupEntry>()
  const groupsByBaseName = new Map<string, ProjectGroupEntry>()
  const childrenByParentId = new Map<string, Session[]>()
  // Only nest a child under its parent if the parent is actually present in
  // this list — otherwise (parent filtered out by search/tags, or deleted)
  // fall through to the flat "↪ child of …" badge so the row isn't hidden.
  const presentIds = new Set(sessions.map((s) => s.session.sessionId))

  for (const indexed of sessions) {
    const { session, normalizedProjectDir, projectName } = indexed
    if (session.parentSessionId && presentIds.has(session.parentSessionId)) {
      const siblings = childrenByParentId.get(session.parentSessionId)
      if (siblings) siblings.push(session)
      else childrenByParentId.set(session.parentSessionId, [session])
      continue
    }

    const byPath = groupsByPath.get(normalizedProjectDir)
    if (byPath) {
      byPath.sessions.push(session)
      continue
    }

    const byBaseName = groupsByBaseName.get(projectName)
    if (byBaseName) {
      byBaseName.projectDir = pickCanonicalProjectPath(byBaseName.projectDir, normalizedProjectDir) || byBaseName.projectDir
      byBaseName.projectName = pathBasename(byBaseName.projectDir) || '—'
      byBaseName.sessions.push(session)
      groupsByPath.set(normalizedProjectDir, byBaseName)
      groupsByBaseName.set(byBaseName.projectName, byBaseName)
      continue
    }

    const group = {
      projectDir: normalizedProjectDir,
      projectName,
      sessions: [session],
    }
    groups.push(group)
    groupsByPath.set(normalizedProjectDir, group)
    groupsByBaseName.set(projectName, group)
  }

  return { groups, childrenByParentId }
}

function sessionActivityMs(session: Session): number {
  const value = session.lastModified ?? session.createdAt
  if (value == null) return 0
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function buildSessionTimeEntries(sessions: IndexedSession[]) {
  // Parse once per row only when time mode is requested. Doing this during
  // search indexing adds work to the default project-mode cold load.
  const activity = new Map<IndexedSession, number>()
  for (const indexed of sessions) activity.set(indexed, sessionActivityMs(indexed.session))
  const sorted = sessions.toSorted(
    (a, b) => activity.get(b)! - activity.get(a)!,
  )
  const projectSessionsByDir = new Map<string, Session[]>()
  for (const indexed of sorted) {
    const list = projectSessionsByDir.get(indexed.normalizedProjectDir)
    if (list) list.push(indexed.session)
    else projectSessionsByDir.set(indexed.normalizedProjectDir, [indexed.session])
  }
  const entries: Array<
    | { type: 'header'; key: string; projectDir: string; projectName: string; count: number; projectSessions: Session[] }
    | { type: 'session'; key: string; session: Session }
  > = []
  for (let i = 0; i < sorted.length; i++) {
    const indexed = sorted[i]
    const prev = i > 0 ? sorted[i - 1] : null
    if (!prev || prev.normalizedProjectDir !== indexed.normalizedProjectDir) {
      let run = 1
      while (
        i + run < sorted.length
        && sorted[i + run].normalizedProjectDir === indexed.normalizedProjectDir
      ) run++
      entries.push({
        type: 'header',
        key: `project:${indexed.normalizedProjectDir}:${i}`,
        projectDir: indexed.normalizedProjectDir,
        projectName: indexed.projectName,
        count: run,
        projectSessions: projectSessionsByDir.get(indexed.normalizedProjectDir) ?? [],
      })
    }
    entries.push({
      type: 'session',
      key: `${indexed.session.providerInstanceId ?? indexed.session.provider ?? 'claude'}:${indexed.session.sessionId}:${i}`,
      session: indexed.session,
    })
  }
  return entries
}
