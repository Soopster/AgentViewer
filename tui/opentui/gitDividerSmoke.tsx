/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { git } from '../../lib/git/command'
import { GitPopover, type GitKeyEvent } from '../../plugins/git/tui/GitPopover'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'
let key: (event: GitKeyEvent) => boolean | void = () => false
const cwd = await mkdtemp(join(tmpdir(), 'git-divider-'))
try {
  await git(cwd, ['init', '-q']); await writeFile(join(cwd, 'file.txt'), 'before\n'); await git(cwd, ['add', '.']); await git(cwd, ['-c', 'user.name=Divider Fixture', '-c', 'user.email=divider@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Divider baseline']); await writeFile(join(cwd, 'file.txt'), 'after\n')
  const setup = await testRender(<box width={160} height={50} flexDirection="column"><box height={3} flexShrink={0} /><box height={44} flexDirection="row"><box width={10} flexShrink={0} /><GitPopover cwd={cwd} docked width={150} height={44} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={handler => { key = handler }} /></box></box>, { width: 160, height: 50 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); await setup.flush() }); await setup.flush() }
  const wait = async (id: string) => { for (let i = 0; i < 25 && !setup.renderer.root.findDescendantById(id); i++) await settle(); const node = setup.renderer.root.findDescendantById(id); assert(node, `Missing ${id}\n${setup.captureCharFrame()}`); return node }
  const drag = async (id: string, dx: number, dy: number) => { const divider = await wait(id), x = divider.x, y = divider.y; await act(async () => { await setup.mockMouse.pressDown(x, y) }); await settle(); await act(async () => { await setup.mockMouse.moveTo(x + dx, y + dy) }); await settle(); await act(async () => { await setup.mockMouse.release(x + dx, y + dy) }); await settle(); return { x, y } }
  const tab = async (name: string) => { const lines = setup.captureCharFrame().split('\n'), y = lines.findIndex(line => line.includes('Commit') && line.includes('File Tree')); assert(y >= 0); const x = lines[y]!.indexOf(name); await act(async () => { await setup.mockMouse.click(x + 1, y) }); await settle() }
  try {
    await wait('git-sidebar-divider')
    const sidebar = await drag('git-sidebar-divider', 10, 0)
    assert.equal((await wait('git-sidebar-divider')).x, sidebar.x + 10, 'sidebar divider drags in an offset window')
    await act(async () => { key({ name: 'h', sequence: 'h', ctrl: true, shift: false }) }); await settle()
    const history = await drag('git-history-divider', 0, 5)
    assert.equal((await wait('git-history-divider')).y, history.y + 5, 'history divider increases history height')
    const review = await drag('git-review-divider', 8, 0)
    assert.equal((await wait('git-review-divider')).x, review.x + 8, 'changed-file divider grows the file tree')
    await tab('File Tree')
    const tree = await drag('git-tree-divider', 7, 0)
    assert.equal((await wait('git-tree-divider')).x, tree.x + 7, 'revision tree divider grows the file list')
    await tab('Changes')
    await act(async () => { key({ name: 'g', sequence: 'g', ctrl: false, shift: false }) }); await settle()
    const staged = await drag('git-staging-divider', 8, 0)
    assert.equal((await wait('git-staging-divider')).x, staged.x + 8, 'staging divider grows the file list')
    await drag('git-sidebar-divider', 100, 0)
    assert((await wait('git-sidebar-divider')).x < 85, 'sidebar resize clamps to preserve detail space')
    await drag('git-history-divider', 0, 80)
    assert((await wait('git-history-divider')).y < 40, 'history resize preserves detail rows')
    console.log('Git divider mouse smoke passed: sidebar, history, review, revision tree and staging resize in offset windows, with size bounds.')
  } finally { act(() => setup.renderer.destroy()) }
} finally { await rm(cwd, { recursive: true, force: true }) }
