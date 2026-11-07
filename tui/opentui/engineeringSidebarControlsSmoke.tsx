/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import type { Session } from '../../lib/types'
import { DARK_THEME } from '../theme'
import { act, testRender } from './testRender'
import { sessionKey } from './app/sessionList'
import { EngineeringRail, type EngineeringKeyHandler } from './engineering/EngineeringFrame'
import { ENGINEERING_DEFAULTS, type EngineeringPreferences } from './engineering/model'

const longTitle = '界面 é session title with enough detail to wrap into two lines and require a full title popover'
const sessions: Session[] = [
  { sessionId: 'local', provider: 'claude', cwd: '/work/repo', summary: longTitle, lastModified: Date.now() },
  { sessionId: 'remote', provider: 'claude', cwd: '/elsewhere', summary: 'Remote running', lastModified: Date.now() },
  { sessionId: 'done', provider: 'claude', cwd: '/work/repo', summary: 'Completed notification', lastModified: Date.now() },
]
let preferences: EngineeringPreferences
let update: React.Dispatch<React.SetStateAction<EngineeringPreferences>>
let setEnabled: (value: boolean) => void
let keys: EngineeringKeyHandler | null
let selected = sessionKey(sessions[0]!)
function Fixture() {
  const [prefs, setPrefs] = useState<EngineeringPreferences>({ ...ENGINEERING_DEFAULTS, pinned: [sessionKey(sessions[0]!)] })
  const [selection, setSelection] = useState(selected)
  const [enabled, enable] = useState(true)
  preferences = prefs; update = setPrefs; setEnabled = enable
  return <EngineeringRail sessions={sessions} root="/work/repo" width={28} height={28} theme={DARK_THEME}
    preferences={prefs} onPreferences={setPrefs} selected={selection} enabled={enabled} onFocus={() => {}}
    onNavigate={session => { selected = sessionKey(session); setSelection(selected) }} onSelect={session => { selected = sessionKey(session); setSelection(selected) }}
    running={[{ sessionId: 'remote', provider: 'claude' }]} recent={new Set()}
    attention={[{ key: 'done', kind: 'turn-done', provider: 'claude', sessionId: 'done', sessionKey: sessionKey(sessions[2]!), sessionTitle: 'Done', title: 'Done', createdAt: 0 }]}
    registerKeys={handler => { keys = handler }} />
}
const setup = await testRender(<Fixture />, { width: 28, height: 28 })
const settle = async () => { await act(async () => { await setup.flush() }) }
const click = async (id: string) => {
  const node = setup.renderer.root.findDescendantById(id)
  assert.ok(node, `Missing ${id}`)
  await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
  await settle()
}
try {
  await settle()
  let frame = setup.captureCharFrame()
  for (const label of ['This repo', 'All repos', 'Running', 'Needs input', 'Pinned']) assert.ok(frame.includes(label), `Full label ${label} at narrow width`)
  assert.equal(setup.renderer.root.findDescendantById(`engineering-session:${selected}`)?.height, 2, 'Selected Unicode title occupies two rows')
  assert.ok(setup.renderer.root.findDescendantById('engineering-title-detail'), 'Keyboard focus reveals full title')
  await act(async () => { keys?.({ name: 'escape', sequence: '', ctrl: false, shift: false }) })
  await settle()
  assert.ok(!setup.renderer.root.findDescendantById('engineering-title-detail'), 'Escape dismisses full title')
  await click('engineering-activity:running')
  assert.equal(preferences!.scope, 'repo')
  assert.equal(preferences!.activity, 'running')
  assert.match(setup.captureCharFrame(), /No running sessions/)
  await click('engineering-scope:all')
  assert.equal(preferences!.activity, 'running', 'Scope preserves activity')
  assert.match(setup.captureCharFrame(), /Remote running/)
  await click('engineering-activity:running')
  assert.equal(preferences!.activity, null, 'Clicking active filter clears it')
  await click('engineering-activity:attention')
  assert.match(setup.captureCharFrame(), /No sessions needing input/, 'Completion notices do not need input')
  await click('engineering-activity:pinned')
  assert.equal(preferences!.activity, 'pinned')
  assert.equal(preferences!.scope, 'all', 'Activity preserves scope')
  await act(async () => { update!(p => ({ ...p, query: 'missing' })) })
  await settle()
  assert.match(setup.captureCharFrame(), /matching search/)
  await act(async () => { update!(p => ({ ...p, query: '' })); setEnabled!(false) })
  await settle()
  assert.ok(!setup.renderer.root.findDescendantById('engineering-title-detail'), 'Sidebar blur dismisses detail')
  const node = setup.renderer.root.findDescendantById(`engineering-session:${selected}`)!
  await act(async () => { setEnabled!(true); await setup.mockMouse.moveTo(node.x + 2, node.y) })
  await settle()
  assert.ok(setup.renderer.root.findDescendantById('engineering-title-detail'), 'Hover reveals complete title')
  console.log('Engineering scope/activity controls, migration semantics, narrow labels and title detail smoke passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
