import assert from 'node:assert/strict'
import { normalizeProjectPath, pathBasename } from '../lib/projectPaths'
import { parseStoredSessionTags } from '../lib/sessionTags'
import type { Session } from '../lib/types'
import { createSessionListIndexer, indexSession, groupByProject, matchesIndexedSessionSearch, buildSessionTimeEntries, type IndexedSession } from '../lib/sessionListModel'

function baselineIndexSession(session: Session): IndexedSession {
  const tags = parseStoredSessionTags(session.tag)
  const title = (session.customTitle ?? session.summary ?? '')
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

function sessionActivityMs(session: Session): number {
    const value = session.lastModified ?? session.createdAt
    if (value == null) return 0
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? 0 : ms
}

function baselineTimeEntries(sessions: IndexedSession[]) {
    const sorted = sessions.toSorted(
      (a, b) => sessionActivityMs(b.session) - sessionActivityMs(a.session),
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

function measure(operation: () => unknown) {
  for (let i = 0; i < 5; i++) operation()
  const samples = []
  for (let i = 0; i < 30; i++) {
    const started = performance.now()
    operation()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return { p50Ms: samples[15], p95Ms: samples[28] }
}

for (const size of [100, 1_000, 10_000]) {
  const sessions: Session[] = Array.from({ length: size }, (_, i) => ({
    sessionId: `session-${i}`,
    provider: i % 2 ? 'codex' : 'opencode',
    summary: `Session ${i}`,
    firstPrompt: `Investigate project ${i % 20}: ${'long initial prompt '.repeat(100)}`,
    cwd: i % 4 ? `/src/project-${i % 20}` : `C:\\src\\project-${i % 20}`,
    tag: i % 3 ? 'work, review' : 'bug',
    createdAt: i % 13 ? new Date(1_700_000_000_000 + ((i * 7919) % size) * 1000).toISOString() : 'invalid',
    lastModified: i % 7 ? undefined : 1_700_000_000_000 + ((i * 3571) % size) * 1000,
    parentSessionId: i % 5 === 1 ? `session-${i - 1}` : undefined,
  }))
  const index = createSessionListIndexer()
  const indexed = index(sessions)
  assert.deepEqual(indexed, sessions.map(indexSession))
  assert.deepEqual(buildSessionTimeEntries(indexed), baselineTimeEntries(indexed), 'time ordering, ties, project runs and keys must remain identical')
  const updated = [...sessions]
  updated[0] = { ...updated[0], customTitle: 'New title', tag: 'changed', cwd: '/new/path', lastModified: 1_900_000_000_000 }
  const next = index(updated)
  assert.notEqual(next[0], indexed[0])
  for (let i = 1; i < size; i++) assert.equal(next[i], indexed[i], 'unchanged poll rows must reuse their metadata')
  assert.deepEqual(next, updated.map(indexSession), 'all changed search and time fields must refresh')
  for (const [query, tag] of [['', null], ['project 2', null], ['', 'WORK'], ['new title', 'changed']] as const) {
    const actual = next.filter(s => matchesIndexedSessionSearch(s, query, tag))
    const expected = updated.map(indexSession).filter(s => matchesIndexedSessionSearch(s, query, tag))
    assert.deepEqual(groupByProject(actual), groupByProject(expected))
    assert.deepEqual(buildSessionTimeEntries(actual), baselineTimeEntries(expected))
  }
  const changes = Array.from({ length: 70 }, (_, i) => ({ ...updated[0], customTitle: `Poll title ${i}` }))
  let tick = 0
  const poll = (indexer: (sessions: Session[]) => IndexedSession[]) => {
    updated[0] = changes[tick++ % changes.length]
    return indexer(updated)
  }
  console.log(JSON.stringify({ workload: 'sidebar-poll-index', sessions: size,
    before: measure(() => poll(rows => rows.map(baselineIndexSession))), after: measure(() => poll(index)) }))
  console.log(JSON.stringify({ workload: 'sidebar-time-order', sessions: size,
    before: measure(() => baselineTimeEntries(indexed)), after: measure(() => buildSessionTimeEntries(indexed)) }))
  console.log(JSON.stringify({ workload: 'sidebar-cold-index-and-time', sessions: size,
    before: measure(() => baselineTimeEntries(sessions.map(baselineIndexSession))),
    after: measure(() => buildSessionTimeEntries(createSessionListIndexer()(sessions))) }))
  console.log(JSON.stringify({ workload: 'sidebar-cold-index-project-mode', sessions: size,
    before: measure(() => sessions.map(baselineIndexSession)),
    after: measure(() => createSessionListIndexer()(sessions)) }))
}
assert.deepEqual(buildSessionTimeEntries([]), [])
console.log('Session sidebar cache invalidation, filtering, grouping and time-order parity passed')
