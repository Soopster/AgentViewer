/** @jsxImportSource @opentui/react */
import React from 'react'
import { useKeyboard } from '@opentui/react'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../lib/git/command'
import { GitPopover, type GitKeyEvent, type GitPopoverProps } from '../../plugins/git/tui/GitPopover'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'
let handler: (event: GitKeyEvent) => boolean | void = () => false
function Routed(props: GitPopoverProps) {
  useKeyboard(event => { if (handler(event) !== false) { event.preventDefault(); event.stopPropagation() } })
  return <GitPopover {...props} />
}
const cwd = await mkdtemp(join(tmpdir(), 'git-sidebar-'))
try {
  await git(cwd, ['init', '-q', '-b', 'main']); await git(cwd, ['config', 'user.name', 'Sidebar Fixture']); await git(cwd, ['config', 'user.email', 'sidebar@example.invalid'])
  await writeFile(join(cwd, 'file.txt'), 'baseline\n'); await git(cwd, ['add', '.']); await git(cwd, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'Sidebar baseline'])
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  await git(cwd, ['update-ref', '--stdin'], Array.from({ length: 70 }, (_, i) => `create refs/heads/agent-viewer/coord/branch-${i} ${head}\n`).join(''))
  await git(cwd, ['remote', 'add', 'origin', cwd]); await git(cwd, ['update-ref', 'refs/remotes/origin/main', head]); await git(cwd, ['tag', 'v1.0'])
  await writeFile(join(cwd, 'file.txt'), 'stash contents\n'); await git(cwd, ['stash', 'push', '-qm', 'Sidebar stash'])
  await git(cwd, ['update-index', '--add', '--cacheinfo', `160000,${head},module`])
  const setup = await testRender(<Routed cwd={cwd} docked width={140} height={40} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} />, { width: 140, height: 40 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); await setup.flush() }); await setup.flush() }
  const wait = async (text: string) => { for (let i = 0; i < 30 && !setup.captureCharFrame().includes(text); i++) await settle(); assert(setup.captureCharFrame().includes(text), `Missing ${text}\n${setup.captureCharFrame()}`) }
  const press = async (name: string, ctrl = false) => { await act(async () => { handler({ name, sequence: name, ctrl, shift: false }) }); await settle() }
  const click = async (text: string) => { const y = setup.captureCharFrame().split('\n').findIndex(line => line.includes(text)); assert(y >= 0, `Missing row ${text}`); await act(async () => { await setup.mockMouse.click(5, y) }); await settle() }
  try {
    await wait('Submodules (1)'); await wait('Stashes (1)')
    for (const text of ['Local Changes (1)', 'All Commits', '/ Filter', '▶ Worktrees', '▶ Branches (71)', '▶ Remotes (1)', '▶ Tags (1)', '▶ Stashes (1)', '▶ Submodules (1)']) await wait(text)
    assert(!setup.captureCharFrame().includes('agent-viewer/coord/bran'), 'Branches start collapsed')
    const collapse = setup.renderer.root.findDescendantById('git-sidebar-collapse')!
    await act(async () => { await setup.mockMouse.click(collapse.x, collapse.y) }); await settle()
    assert(!setup.renderer.root.findDescendantById('git-navigation'), 'collapsed sidebar releases its width')
    await wait('[▶ Sidebar]')
    const restore = setup.renderer.root.findDescendantById('git-sidebar-toggle')!
    await act(async () => { await setup.mockMouse.click(restore.x + 1, restore.y) }); await settle()
    assert.equal(setup.renderer.root.findDescendantById('git-navigation')?.width, 26, 'restoring sidebar retains its width')
    await wait('▶ Branches (71)')
    await click('▶ Branches'); await wait('agent-viewer/coord/')
    await press('end'); assert(setup.captureCharFrame().includes('Local Changes (1)'), 'Pinned navigation stays visible while groups scroll')
    const filter = setup.renderer.root.findDescendantById('git-sidebar-filter')!
    await act(async () => { await setup.mockMouse.click(filter.x + 1, filter.y) }); await settle()
    await act(async () => { setup.mockInput.typeText('branch-69') }); await settle(); await wait('branch-69')
    assert(!setup.captureCharFrame().includes('branch-68'), 'Filter narrows groups')
    await press('escape'); await click('▼ Branches'); await click('▶ Tags'); await click('v1.0'); await wait('Sidebar baseline')
    await click('▶ Remotes'); await click('▶ origin'); await wait('    main')
    await click('▶ Submodules'); await click('  module'); await wait('Submodule is not initialized.')
    console.log('Git sidebar passed: pinned navigation/counts, collapsed groups, native filter, scrolling, tag navigation, grouped remotes and submodule state.')
  } finally { act(() => setup.renderer.destroy()) }
} finally { await rm(cwd, { recursive: true, force: true }) }
