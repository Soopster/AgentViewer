/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { useState } from 'react'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { OmniActions, OmniBar } from '../../plugins/omni-bar/tui'
import type { TuiPluginKeyHandler } from './shell/pluginTypes'
import { availableActions, overviewSegments } from '../../plugins/omni-bar/model'
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
    commands: { ids: ['files', 'processes', 'index-search'], run: id => commands.push(id) },
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
  await act(async () => { update('/new-project', 220) })
  await settle()
  assert(screen().includes('codex · Test') && screen().includes('+ New') && screen().includes('Terminal') && screen().includes('Search'))
  for (const id of ['files', 'processes', 'index-search']) {
    const node = setup.renderer.root.findDescendantById(`omni-bar:${id}`)!
    await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
    await settle()
    assert.equal(commands.at(-1), id)
  }
  const newSession = setup.renderer.root.findDescendantById('omni-bar:new-session')!
  await act(async () => { await setup.mockMouse.click(newSession.x + 1, newSession.y) })
  assert.equal(actions.at(-1), 'new-session')
  const snapshot = { cwd: '/repo', sessionKey: null, sessionTitle: null, activity: 'Idle', running: false, startedAt: null, runningCount: 0, attentionCount: 0 }
  assert(!availableActions({ snapshot, readGit, run: () => {} }).some(action => ['files', 'processes', 'index-search', 'session'].includes(action.id)), 'unavailable actions were offered')
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
  assert(screen().includes('Search session history'))
  await act(async () => { menuKey?.({ name: 'return', sequence: '', ctrl: false, shift: false }) })
  assert.equal(commands.at(-1), 'index-search')
  await act(async () => { setMenu(true) })
  await settle()
  for (let index = 0; index < 3; index++) {
    await act(async () => { menuKey?.({ name: 'up', sequence: '', ctrl: false, shift: false }) })
    await settle()
  }
  await act(async () => { menuKey?.({ name: 'return', sequence: '', ctrl: false, shift: false }) })
  assert.equal(commands.at(-1), 'files', 'keyboard action did not dispatch the selected plugin command')
  console.log('Omni bar: one row, narrow widths, mouse actions, stale Git isolation, non-Git context and polling cleanup passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
