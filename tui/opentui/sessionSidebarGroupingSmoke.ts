import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import type { SidebarEntry, SidebarSubagentEntry } from './app/types'
import { buildSidebarEntries, groupSidebarDates, liftNeedsInput, liftSidebarGroup, mergeCoordinatorGroups, NEEDS_YOU_KEY, PINNED_SESSIONS_KEY, RUNNING_SESSIONS_KEY, sessionKey, sidebarEntrySession } from './app/sessionList'
import { migrateSessionSidebarPreferences } from './app/state/sessionSidebarState'

const midnight = new Date().setHours(0, 0, 0, 0)
const sessions: Session[] = [
  { sessionId: 'parent', provider: 'claude', providerInstanceId: 'one', cwd: '/work/alpha', summary: 'Alpha today', lastModified: midnight + 2000 },
  { sessionId: 'child', parentSessionId: 'parent', provider: 'claude', providerInstanceId: 'one', cwd: '/work/alpha', summary: 'Alpha child', lastModified: midnight + 1000 },
  { sessionId: 'yesterday', provider: 'claude', cwd: '/work/alpha', summary: 'Alpha yesterday', lastModified: midnight - 1000 },
  { sessionId: 'older', provider: 'claude', cwd: '/work/alpha', summary: 'Alpha older', lastModified: midnight - 3 * 86400000 },
  { sessionId: 'child', provider: 'claude', providerInstanceId: 'two', cwd: '/work/beta', summary: 'Beta active', lastModified: midnight + 500 },
]
const children = new Map<string, SidebarSubagentEntry[]>([[sessionKey(sessions[0]!), [{ kind: 'session', session: sessions[1]! }]]])
const ids = (entries: SidebarEntry[]) => entries.flatMap(entry => { const session = sidebarEntrySession(entry); return session ? [sessionKey(session)] : [] })
const built = mergeCoordinatorGroups(buildSidebarEntries(sessions, 'project', children))
const grouped = groupSidebarDates(built, new Set())
assert.deepEqual(grouped.flatMap(entry => entry.type === 'project' && !entry.dateGroup ? [entry.projectName] : []), ['ALPHA', 'BETA'])
assert.deepEqual(grouped.flatMap(entry => entry.type === 'project' && entry.dateGroup ? [entry.projectName] : []), ['Today', 'Yesterday', 'Older'])
assert.equal(ids(grouped).length, sessions.length, 'Real children and separate provider instances remain addressable')
assert.deepEqual(ids(groupSidebarDates(built, new Set(['project:ALPHA']))), [sessionKey(sessions[4]!)])
assert.ok(!ids(groupSidebarDates(built, new Set(['project:ALPHA:date:Today']))).includes(sessionKey(sessions[0]!)))
const pins = new Set([sessionKey(sessions[0]!), sessionKey(sessions[2]!), sessionKey(sessions[4]!)])
const running = new Set([sessionKey(sessions[0]!), sessionKey(sessions[4]!)])
const pinned = liftSidebarGroup(built, session => pins.has(sessionKey(session)), PINNED_SESSIONS_KEY, 'PINNED')
const active = liftSidebarGroup(pinned, session => running.has(sessionKey(session)), RUNNING_SESSIONS_KEY, 'RUNNING')
const attention = liftNeedsInput(active, session => sessionKey(session) === sessionKey(sessions[0]!))
assert.equal(new Set(ids(attention)).size, sessions.length, 'Activity and pinned groups do not duplicate session rows')
const headers = attention.flatMap(entry => entry.type === 'project' ? [entry.key] : [])
assert.deepEqual(headers.slice(0, 3), [NEEDS_YOU_KEY, RUNNING_SESSIONS_KEY, PINNED_SESSIONS_KEY])
assert.equal(attention[2]?.type, 'subagent', 'Moving the parent retains child adjacency')
const noDates = groupSidebarDates(attention, new Set())
assert.ok(noDates.every(entry => entry.type !== 'project' || !entry.dateGroup || ![NEEDS_YOU_KEY, RUNNING_SESSIONS_KEY, PINNED_SESSIONS_KEY].some(key => entry.key.startsWith(key + ':date:'))))
const foldedRunning = groupSidebarDates(attention, new Set([RUNNING_SESSIONS_KEY]))
assert.ok(!ids(foldedRunning).includes(sessionKey(sessions[4]!)), 'Shared running group is collapsible')
assert.deepEqual(migrateSessionSidebarPreferences({ pinned: [...pins], filter: 'running' }), { pinned: [...pins], activity: 'running' })
assert.equal(migrateSessionSidebarPreferences({ activity: 'running' }, null).activity, null, 'Existing shared filter selection takes priority')
assert.equal(migrateSessionSidebarPreferences({ activity: 'settled' }).activity, 'settled')
console.log('Shared sidebar repo/date grouping, parent/child identity, running/attention/pinned precedence, collapse and saved-state migration passed')
