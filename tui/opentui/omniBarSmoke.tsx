/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { useState } from 'react'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { OmniBar } from '../../plugins/omni-bar/tui'
import type { PluginShellOverview, ShellOverviewAction } from '../../lib/plugins/shellOverview'
import type { GitSummary } from '../../lib/gitProvider'

let update: (cwd: string, width: number, visible?: boolean) => void
const actions: ShellOverviewAction[] = []
const reads: string[] = []
let resolveOld: (summary: GitSummary) => void
const oldRead = new Promise<GitSummary>(resolve => { resolveOld = resolve })
const readGit = async (cwd: string) => {
  reads.push(cwd)
  return cwd === '/old-project' ? oldRead : cwd === '/no-git' ? null : { branch: 'fresh-branch', modified: 2, untracked: 1, stashes: 0 }
}
function Harness() {
  const [state, setState] = useState({ cwd: '/old-project', width: 160, visible: true })
  update = (cwd, width, visible = true) => setState({ cwd, width, visible })
  const overview: PluginShellOverview = {
    snapshot: { cwd: state.cwd, sessionKey: 'codex:instance:session', sessionTitle: 'Test', activity: 'Editing reader', running: true, startedAt: Date.now() - 124_000, runningCount: 3, attentionCount: 1 },
    readGit, run: action => actions.push(action),
  }
  return <box flexDirection="column">
    {state.visible ? <OmniBar slot="top-bar" theme={DARK_THEME} width={state.width} height={1} services={{ 'shell-overview': overview }} /> : null}
    <text>Existing pinned prompt</text>
  </box>
}
const setup = await testRender(<Harness />, { width: 160, height: 8 })
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
  console.log('Omni bar: one row, narrow widths, mouse actions, stale Git isolation, non-Git context and polling cleanup passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
