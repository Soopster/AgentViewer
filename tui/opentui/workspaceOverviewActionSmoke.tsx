/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'
import { SpacesController } from './spacesStore'
import { WorkspaceOverview } from './WorkspaceOverview'
import type { OverviewNode } from './workspaceOverviewData'

const cwd = mkdtempSync(path.join(tmpdir(), 'av-overview-actions-'))
let handleKey: ((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => boolean) | null = null
const applied: { current: { action: string; nodes: OverviewNode[] } | null } = { current: null }
const readApplied = () => (applied as { current: { action: string; nodes: OverviewNode[] } | null }).current
let closed = false
const shelved: { current: OverviewNode | null } = { current: null }
const controller = new SpacesController(cwd)
const workspace = controller.activeWorkspace()!
const runtime = controller.runtime(workspace)
const set = (key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
const sessions = [
  { sessionId: 'overview-a', provider: 'claude', cwd, summary: 'Alpha' },
  { sessionId: 'overview-b', provider: 'claude', cwd, summary: 'Beta' },
]
set('openTabSessions', sessions)
set('splitPinnedKeys', ['claude:overview-a', 'claude:overview-b'])
set('splitPaneCount', 2)
set('windowOrder', ['claude:overview-a', 'claude:overview-b'])

const setup = await testRender(<WorkspaceOverview controller={controller} theme={DARK_THEME} width={100} height={30}
  onPick={() => {}} onClose={() => { closed = true }}
  onShelf={node => { shelved.current = node }}
  onBatchAction={(action, nodes) => { applied.current = { action, nodes } }}
  onKeyHandlerReady={handler => { handleKey = handler }} />, { width: 100, height: 30 })
const key = async (name: string, sequence = '') => {
  await act(async () => { handleKey?.({ name, sequence, ctrl: false, shift: false }) })
  await setup.flush()
}
try {
  await setup.flush()
  await key('down'); await key('down') // first window
  await key('s', 's')
  assert.equal(shelved.current?.target, 'claude:overview-a', 'S runs the shelf shortcut while list focus is active')
  assert.ok(setup.captureCharFrame().includes('Press / to search'), 'shortcut characters do not enter the search field')
  await key('space', ' ')
  await key('down'); await key('space', ' ')
  await key('a')
  assert.ok(setup.captureCharFrame().includes('Window actions · preview'), 'action menu opens for the selected set')
  await key('return')
  assert.equal(readApplied(), null, 'choosing an action only opens its preview')
  assert.ok(setup.captureCharFrame().includes('Preview: 2 windows · tab'), 'preview names the action and number of windows')
  await key('return')
  assert.equal(readApplied()?.action, 'tab', 'confirmation applies the chosen batch action')
  assert.equal(readApplied()?.nodes.length, 2)
  assert.equal(closed, true, 'the overview closes after confirmation')
  await key('/', '/')
  assert.ok(setup.captureCharFrame().includes('Search:'), 'slash explicitly activates search typing')
  await key('s', 's')
  assert.ok(setup.captureCharFrame().includes('Search: s'), 'printable keys update the active query')
  assert.equal(shelved.current?.target, 'claude:overview-a', 'search input does not trigger list shortcuts')
  console.log('Workspace overview multi-select preview smoke: PASS')
} finally {
  act(() => setup.renderer.destroy())
  rmSync(cwd, { recursive: true, force: true })
}
process.exit(0)
