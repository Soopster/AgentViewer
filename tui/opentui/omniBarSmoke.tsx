/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
// The layout is saved under the working directory; keep the smoke out of the real one.
process.chdir(mkdtempSync(path.join(tmpdir(), 'omni-bar-smoke-')))
import { useState } from 'react'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { OmniActions, OmniBar } from '../../plugins/omni-bar/tui'
import type { TuiPluginKeyHandler } from './shell/pluginTypes'
import { availableActions, overviewSegments } from '../../plugins/omni-bar/model'
import { DEFAULT_OMNI_LAYOUT, moveLayoutItem, normalizeLayout, toggleLayoutItem } from '../../plugins/omni-bar/layout'
import { omniLayoutStore } from '../../plugins/omni-bar/tui/storage'
import type { PluginShellOverview, ShellOverviewAction } from '../../lib/plugins/shellOverview'
import type { GitSummary } from '../../lib/gitProvider'

let update: (cwd: string, width: number, visible?: boolean) => void
let setMenu: (open: boolean) => void
let menuKey: TuiPluginKeyHandler | null = null
const actions: ShellOverviewAction[] = []
const reads: string[] = []
const commands: string[] = []
let resolveOld: (summary: GitSummary) => void
const oldRead = new Promise<GitSummary>(resolve => { resolveOld = resolve })
const readGit = async (cwd: string) => {
  reads.push(cwd)
  return cwd === '/old-project' ? oldRead : cwd === '/no-git' ? null : { branch: 'fresh-branch', modified: 2, untracked: 1, stashes: 0 }
}
function Harness() {
  const [state, setState] = useState({ cwd: '/old-project', width: 160, visible: true })
  const [menu, updateMenu] = useState(false)
  setMenu = updateMenu
  update = (cwd, width, visible = true) => setState({ cwd, width, visible })
  const overview: PluginShellOverview = {
    snapshot: { cwd: state.cwd, sessionKey: 'codex:instance:session', sessionTitle: 'Test', provider: 'codex', activity: 'Editing reader', running: true, startedAt: Date.now() - 124_000, runningCount: 3, attentionCount: 1 },
    readGit, run: action => actions.push(action),
    commands: { ids: ['files', 'processes', 'index-search', 'editor', 'github', 'analytics', 'omni-bar-settings'], run: id => commands.push(id) },
  }
  return <box flexDirection="column">
    {state.visible ? <OmniBar slot="top-bar" theme={DARK_THEME} width={state.width} height={1} services={{ 'shell-overview': overview }} /> : null}
    <text>Existing pinned prompt</text>
    {menu ? <OmniActions pluginId="omni-bar" surfaceId="omni-bar-actions" instanceId="test" placement="overlay"
      target={{ sessionKey: overview.snapshot.sessionKey, cwd: state.cwd }} services={{ 'shell-overview': overview }}
      theme={DARK_THEME} accent={DARK_THEME.cyan} syntaxStyle={null} width={state.width} height={8} focused zIndex={100}
      useState={() => { throw new Error('Unexpected persistent state request') }} onDispose={() => () => {}} setCapture={() => {}} runCommand={() => false}
      registerKeys={handler => { menuKey = handler }} close={() => updateMenu(false)} /> : null}
  </box>
}
const setup = await testRender(<Harness />, { width: 220, height: 8 })
const settle = async (ms = 80) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); await setup.flush() }) }
const screen = () => setup.captureCharFrame()
try {
  await settle()
  assert(screen().includes('Editing reader') && screen().includes('3 running') && screen().includes('1 needs input'))
  await act(async () => { update('/new-project', 160) })
  await settle()
  assert(screen().includes('fresh-branch') && screen().includes('3 changed'))
  await act(async () => { resolveOld({ branch: 'stale-branch', modified: 99, untracked: 0, stashes: 0 }) })
  await settle()
  assert(!screen().includes('stale-branch'), 'a late result from the previous repository replaced the current context')
  assert(!screen().includes('Editor'), 'an opt-in shortcut was shown by default')
  await act(async () => { omniLayoutStore.set(DEFAULT_OMNI_LAYOUT.map(item => ['editor', 'github', 'analytics', 'pull-requests', 'checkpoints'].includes(item.id) ? { ...item, enabled: true } : item)) })
  await act(async () => { update('/new-project', 220) })
  await settle()
  assert(screen().includes('codex · Test') && screen().includes('+ New') && screen().includes('Terminal') && screen().includes('Search'))
  for (const id of ['files', 'processes', 'index-search']) {
    const node = setup.renderer.root.findDescendantById(`omni-bar:${id}`)!
    await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
    await settle()
    assert.equal(commands.at(-1), id)
  }
  for (const [id, text] of [['editor', 'Editor'], ['github', 'GitHub'], ['analytics', 'Analytics']] as const) {
    assert(screen().includes(text), `${text} shortcut missing`)
    const node = setup.renderer.root.findDescendantById(`omni-bar:${id}`)!
    await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
    assert.equal(commands.at(-1), id)
  }
  assert(!screen().includes('PRs') && !screen().includes('Checkpoints'), 'a shortcut for a disabled plugin was shown')
  assert(screen().includes('⎇') && screen().includes('✎ Editor') && screen().includes('⌘ Commands'), 'glyphs missing from the bar')
  const editorNode = setup.renderer.root.findDescendantById('omni-bar:editor')!
  await act(async () => { await setup.mockMouse.pressDown(editorNode.x + 2, editorNode.y, 2 as never) })
  await act(async () => { await setup.mockMouse.release(editorNode.x + 2, editorNode.y, 2 as never) })
  assert.equal(commands.at(-1), 'omni-bar-settings', 'right click did not open customization')
  await act(async () => { await setup.mockMouse.moveTo(editorNode.x + 2, editorNode.y) })
  await settle()
  const lit = setup.captureSpans().lines[editorNode.y]!.spans.find(span => span.text.includes('Editor'))!
  const idle = setup.captureSpans().lines[editorNode.y]!.spans.find(span => span.text.includes('Files'))!
  assert.notDeepEqual(lit.bg, idle.bg, 'hovering a bar item did not highlight it')
  const newSession = setup.renderer.root.findDescendantById('omni-bar:new-session')!
  await act(async () => { await setup.mockMouse.click(newSession.x + 1, newSession.y) })
  assert.equal(actions.at(-1), 'new-session')
  const snapshot = { cwd: '/repo', sessionKey: null, sessionTitle: null, activity: 'Idle', running: false, startedAt: null, runningCount: 0, attentionCount: 0 }
  assert(!availableActions({ snapshot, readGit, run: () => {} }).some(action => ['files', 'processes', 'index-search', 'editor', 'github', 'session'].includes(action.id)), 'unavailable actions were offered')
  const clean = overviewSegments(snapshot, { branch: 'main', modified: 0, untracked: 0, stashes: 2 }, 220, Date.now())
  assert(clean[0]!.text.includes('clean · 2 stashed'))
  for (const action of ['repository', 'session', 'attention', 'commands'] as const) {
    const node = setup.renderer.root.findDescendantById(`omni-bar:${action}`)!
    await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
    await settle()
    assert.equal(actions.at(-1), action)
  }
  for (const width of [80, 38, 12]) {
    await act(async () => { update('/new-project', width) })
    await settle()
    const bar = setup.renderer.root.findDescendantById('omni-bar')!
    assert.equal(bar.height, 1)
    assert.equal(bar.width, width)
    assert(screen().includes(width < 40 ? 'Cmds' : 'Commands…'))
    const commands = setup.renderer.root.findDescendantById('omni-bar:commands')!
    assert(commands.x + commands.width <= width, 'narrow layout pushed command access outside its row')
    assert.equal(screen().split('\n').findIndex(row => row.includes('Existing pinned prompt')), 1)
  }
  await act(async () => { update('/no-git', 160) })
  await settle()
  assert(screen().includes('no-git') && !screen().includes('fresh-branch'), 'non-Git workspace retained another repository status')
  await act(async () => { update('/no-git', 160, false) })
  await settle()
  const count = reads.length
  await settle(5_100)
  assert.equal(reads.length, count, 'unmount left Git polling running')
  assert.equal(screen().split('\n').findIndex(row => row.includes('Existing pinned prompt')), 0)
  await act(async () => { setMenu(true) })
  await settle()
  assert(screen().includes('Open Git status'))
  // The menu is taller than this terminal: wrap to the last action and reveal it.
  await act(async () => { menuKey?.({ name: 'up', sequence: '', ctrl: false, shift: false }) })
  await settle()
  assert(screen().includes('Customize omni bar'))
  await act(async () => { menuKey?.({ name: 'return', sequence: '', ctrl: false, shift: false }) })
  assert.equal(commands.at(-1), 'omni-bar-settings')
  await act(async () => { setMenu(true) })
  await settle()
  for (let index = 0; index < 7; index++) {
    await act(async () => { menuKey?.({ name: 'up', sequence: '', ctrl: false, shift: false }) })
    await settle()
  }
  await act(async () => { menuKey?.({ name: 'return', sequence: '', ctrl: false, shift: false }) })
  assert.equal(commands.at(-1), 'files', 'keyboard action did not dispatch the selected plugin command')
  // Layout: normalise, reorder, disable; the bar follows, and Commands stays last.
  const reordered = moveLayoutItem(toggleLayoutItem(DEFAULT_OMNI_LAYOUT, DEFAULT_OMNI_LAYOUT.findIndex(item => item.id === 'files')), 2, -2)
  assert.equal(reordered[0]!.id, 'new-session')
  const ids = (layout: typeof reordered) => overviewSegments(snapshot, null, 220, 0, ['files', 'editor'], layout).map(segment => segment.action)
  assert.deepEqual(ids(reordered), ['new-session', 'repository', 'session', 'attention', 'commands'], 'disabled or reordered items did not follow the layout')
  assert.deepEqual(normalizeLayout([{ id: 'editor' }, { id: 'nope' }, { id: 'editor' }]).slice(0, 2).map(item => item.id), ['editor', 'repository'])
  assert.equal(normalizeLayout('garbage').length, DEFAULT_OMNI_LAYOUT.length)
  omniLayoutStore.set(reordered)
  assert.equal(omniLayoutStore.get()[0]!.id, 'new-session')
  console.log('Omni bar: one row, narrow widths, mouse actions, stale Git isolation, non-Git context and polling cleanup passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
