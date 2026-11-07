/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import type { Session } from '../../lib/types'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { sessionKey } from './app/sessionList'
import { EngineeringRail, type EngineeringKeyHandler } from './engineering/EngineeringFrame'
import { ENGINEERING_RUNNING_GROUP, ENGINEERING_INPUT_GROUP, ENGINEERING_PINNED_GROUP, engineeringSidebarRows } from './engineering/sidebar'
import { ENGINEERING_DEFAULTS, engineeringRailFilters, type EngineeringPreferences } from './engineering/model'

const now = new Date()
const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
const sessions: Session[] = [
  { sessionId: 'parent', provider: 'claude', providerInstanceId: 'one', cwd: '/work/alpha', summary: 'Alpha today', lastModified: midnight + 2000 },
  { sessionId: 'child', parentSessionId: 'parent', provider: 'claude', providerInstanceId: 'one', cwd: '/work/alpha', summary: 'Alpha child', lastModified: midnight + 1000 },
  { sessionId: 'yesterday', provider: 'claude', cwd: '/work/alpha', summary: 'Alpha yesterday', lastModified: midnight - 1000 },
  { sessionId: 'older', provider: 'claude', cwd: '/work/alpha', summary: 'Alpha older', lastModified: midnight - 3 * 86400000 },
  { sessionId: 'child', provider: 'claude', providerInstanceId: 'two', cwd: '/work/beta', summary: 'Beta active', lastModified: midnight + 500 },
]
const grouped = engineeringSidebarRows(sessions, [], now).rows
assert.deepEqual(grouped.flatMap(row => row.type === 'group' && !row.dateGroup ? [row.label] : []), ['ALPHA', 'BETA'])
assert.deepEqual(grouped.flatMap(row => row.type === 'group' && row.dateGroup ? [row.label] : []), ['Today', 'Yesterday', 'Older'])
assert.equal(grouped.filter(row => row.type === 'session').length, 4, 'Child sessions and separate provider instances remain addressable')
const folded = engineeringSidebarRows(sessions, ['project:ALPHA'], now).rows
assert.deepEqual(folded.flatMap(row => row.type === 'session' ? [row.session.summary] : []), ['Beta active'])
const dateFolded = engineeringSidebarRows(sessions, ['project:ALPHA:date:Today'], now).rows
assert.deepEqual(dateFolded.flatMap(row => row.type === 'session' ? [row.session.summary] : []), ['Alpha yesterday', 'Beta active'])
const runningKeys = new Set([sessionKey(sessions[4]!)])
const withRunning = engineeringSidebarRows(sessions, [], now, runningKeys).rows
assert.equal(withRunning[0]?.type === 'group' && withRunning[0].label, 'RUNNING', 'Running remains above the repo groups')
assert.equal(withRunning.filter(row => row.type === 'session' && sessionKey(row.session) === sessionKey(sessions[4]!)).length, 1, 'A running session is not duplicated under its repo')
assert.ok(withRunning.some(row => row.type === 'group' && row.label === 'ALPHA'))
const runningFolded = engineeringSidebarRows(sessions, [ENGINEERING_RUNNING_GROUP], now, runningKeys).rows
assert.ok(!runningFolded.some(row => row.type === 'session' && row.session.summary === 'Beta active'))
assert.ok(runningFolded.some(row => row.type === 'session' && row.session.summary === 'Alpha today'), 'Collapsing Running leaves repo groups intact')

const ids = (rows: ReturnType<typeof engineeringSidebarRows>['rows']) => rows.flatMap(row => row.type === 'session' ? [sessionKey(row.session)] : [])
const overlap = engineeringSidebarRows(sessions, [], now, new Set([sessionKey(sessions[0]!), sessionKey(sessions[4]!)]), new Set([sessionKey(sessions[0]!)]), new Set([sessionKey(sessions[0]!), sessionKey(sessions[2]!)]))
assert.deepEqual(overlap.rows.filter(row => row.type === 'group').slice(0, 3).map(row => row.key), [ENGINEERING_RUNNING_GROUP, ENGINEERING_INPUT_GROUP, ENGINEERING_PINNED_GROUP])
assert.equal(overlap.projectBySession.get(sessionKey(sessions[0]!)), ENGINEERING_INPUT_GROUP, 'Needs input wins overlaps')
assert.equal(new Set(ids(overlap.rows)).size, ids(overlap.rows).length, 'Priority sessions are never duplicated')
assert.ok(!ids(grouped).includes(sessionKey(sessions[3]!)), 'Older defaults closed')
const expandedOlder = ['project:ALPHA:date:Older']
assert.ok(ids(engineeringSidebarRows(sessions, [], now, new Set(), new Set(), new Set(), expandedOlder).rows).includes(sessionKey(sessions[3]!)))
const olderOnly = engineeringSidebarRows([sessions[3]!], [], now).rows
assert.ok(olderOnly.some(row => row.type === 'group' && row.label === 'Older' && row.collapsed), 'Older-only projects remain expandable')
assert.equal(ids(olderOnly).length, 0)
for (const filter of ['repo', 'all', 'running', 'attention', 'pinned'] as const) {
  assert.deepEqual(engineeringRailFilters({ ...ENGINEERING_DEFAULTS, filter }), { scope: filter === 'repo' ? 'repo' : 'all', activity: filter === 'repo' || filter === 'all' ? null : filter })
}
assert.deepEqual(engineeringRailFilters({ ...ENGINEERING_DEFAULTS, filter: 'running', scope: 'repo', activity: null }), { scope: 'repo', activity: null }, 'Explicit controls supersede legacy preferences')

let keys: EngineeringKeyHandler | null = null
let selected = sessionKey(sessions[0]!)
function Fixture({ running = false }: { running?: boolean }) {
  const [preferences, setPreferences] = useState<EngineeringPreferences>({ ...ENGINEERING_DEFAULTS, filter: 'all' })
  const [selection, setSelection] = useState(selected)
  return <EngineeringRail sessions={sessions} attention={[]} running={running ? [{ sessionId: 'child', provider: 'claude', providerInstanceId: 'two' }] : []} recent={new Set()}
    selected={selection} width={48} height={24} theme={DARK_THEME} enabled preferences={preferences}
    onPreferences={setPreferences} onFocus={() => {}} onSelect={() => {}}
    onNavigate={session => { selected = sessionKey(session); setSelection(selected) }}
    registerKeys={handler => { keys = handler }} />
}
const setup = await testRender(<Fixture />, { width: 48, height: 24 })
const settle = async () => { await act(async () => { await setup.flush() }) }
const clickGroup = async (key: string) => {
  const node = setup.renderer.root.findDescendantById(`engineering-group:${key}`)!
  assert.ok(node, `Missing group ${key}`)
  await act(async () => { await setup.mockMouse.click(node.x + 2, node.y) })
  await settle()
}
try {
  await settle()
  assert.match(setup.captureCharFrame(), /ALPHA.*\/ 3/)
  assert.match(setup.captureCharFrame(), /BETA.*\/ 1/)
  await clickGroup('project:ALPHA')
  assert.doesNotMatch(setup.captureCharFrame(), /Alpha today|Alpha child|Alpha yesterday/)
  assert.match(setup.captureCharFrame(), /Beta active/)
  await clickGroup('project:ALPHA')
  assert.match(setup.captureCharFrame(), /Alpha child/)
  await clickGroup('project:ALPHA:date:Today')
  await act(async () => { keys?.({ name: 'j', sequence: 'j', ctrl: false, shift: false }) })
  assert.equal(selected, sessionKey(sessions[2]!), 'Keyboard navigation follows the visible grouped rows')
  await act(async () => { keys?.({ name: 'e', sequence: 'e', ctrl: false, shift: false }) })
  await settle()
  assert.doesNotMatch(setup.captureCharFrame(), /Alpha yesterday/)
  await act(async () => { keys?.({ name: 'right', sequence: '', ctrl: false, shift: false }) })
  await settle()
  assert.match(setup.captureCharFrame(), /Alpha yesterday/)
  console.log('Engineering repo/date grouping, collapse, child identity and keyboard navigation smoke passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
const active = await testRender(<Fixture running />, { width: 48, height: 24 })
try {
  await act(async () => { await active.flush() })
  const frame = active.captureCharFrame()
  assert.ok(frame.indexOf('RUNNING') < frame.indexOf('ALPHA'), 'Running appears above repo headers')
  assert.equal(frame.split('Beta active').length - 1, 1, 'The running session is displayed once')
  const group = active.renderer.root.findDescendantById(`engineering-group:${ENGINEERING_RUNNING_GROUP}`)!
  await act(async () => { await active.mockMouse.click(group.x + 2, group.y) })
  await act(async () => { await active.flush() })
  assert.doesNotMatch(active.captureCharFrame(), /Beta active/)
  assert.match(active.captureCharFrame(), /ALPHA/)
} finally { await act(async () => { active.renderer.destroy() }) }
process.exit(0)
