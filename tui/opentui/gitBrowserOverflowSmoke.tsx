/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import type { ScrollBoxRenderable } from '@opentui/core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../lib/git/command'
import { GitPopover, type GitKeyEvent } from '../../plugins/git/tui/GitPopover'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'
const cwd = await mkdtemp(join(tmpdir(), 'git-overflow-'))
let key: (event: GitKeyEvent) => boolean | void = () => false
try {
  await git(cwd, ['init', '-q', '-b', 'main']); await git(cwd, ['config', 'user.name', 'Overflow Fixture']); await git(cwd, ['config', 'user.email', 'overflow@example.invalid'])
  await writeFile(join(cwd, 'file.txt'), 'baseline\n'); await git(cwd, ['add', '.']); await git(cwd, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'BASELINE'])
  const tree = (await git(cwd, ['rev-parse', 'HEAD^{tree}'])).trim()
  let parent = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  for (let i = 0; i < 35; i++) parent = (await git(cwd, ['commit-tree', tree, '-p', parent, '-m', `HISTORY_${String(i).padStart(2, '0')}`])).trim()
  await git(cwd, ['update-ref', 'refs/heads/main', parent])
  await git(cwd, ['update-ref', '--stdin'], Array.from({ length: 70 }, (_, i) => `create refs/heads/agent-viewer/coord/very-long-branch-name-${i} ${parent}\n`).join(''))
  for (const [width, height] of [[150, 50], [220, 60]] as const) {
    const setup = await testRender(<GitPopover cwd={cwd} docked width={width} height={height} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={handler => { key = handler }} />, { width, height })
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); await setup.flush() }); await setup.flush() }
    const press = async (name: string, ctrl = false) => { await act(async () => { key({ name, sequence: name, ctrl, shift: false }) }); await settle() }
    try {
      for (let i = 0; i < 20 && !setup.captureCharFrame().includes('Branches (71)'); i++) await settle()
      const branchRow = setup.captureCharFrame().split('\n').findIndex(line => line.includes('▶ Branches'))
      assert(branchRow >= 0); await act(async () => { await setup.mockMouse.click(5, branchRow) }); await settle()
      await press('n', true); await press('home'); await press('down'); await press('return')
      for (let i = 0; i < 20 && !setup.captureCharFrame().includes('HISTORY_34'); i++) await settle()
      const lines = setup.captureCharFrame().split('\n'), header = lines.findIndex(line => line.includes('subject / author'))
      assert(header >= 0, 'history header visible')
      assert(!lines[header]!.includes('HISTORY_'), `History rows must not overwrite header:\n${setup.captureCharFrame()}`)
      assert(lines[header + 1]!.includes('HISTORY_34'), `first commit starts below header:\n${setup.captureCharFrame()}`)
      const nav = setup.renderer.root.findDescendantById('git-navigation')!
      assert.equal(nav.width, 26, 'long branches must not shrink or expand navigation')
      const navScroll = setup.renderer.root.findDescendantById('git-navigation-scroll') as ScrollBoxRenderable
      const historyScroll = setup.renderer.root.findDescendantById('git-history-scroll') as ScrollBoxRenderable
      assert.equal(navScroll.scrollLeft, 0); assert.equal(historyScroll.scrollLeft, 0)
      assert(historyScroll.x + historyScroll.width <= width, `history stays inside the host: x=${historyScroll.x} width=${historyScroll.width} host=${width}\n${setup.captureCharFrame()}`)
      assert(setup.captureCharFrame().includes('Ctrl+N navigation'), 'footer remains visible')
    } finally { act(() => setup.renderer.destroy()) }
  }
  console.log('Git overflow passed: 71 long branch names, 36 history rows, separate header, fixed sidebar, bounded history and visible footer at 150x50 and 220x60.')
} finally { await rm(cwd, { recursive: true, force: true }) }
