/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'
import type { ScrollBoxRenderable } from '@opentui/core'
import { GitPopover } from './GitPopover'
import { DARK_THEME } from '../theme'
import { fetchGitReviewStream } from './gitReviewStream'
import { fetchGitData } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import { buildPierreDiffView } from './pierreDiffView'

const cwd = await mkdtemp(join(tmpdir(), 'git-review-stream-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd })
const content = (name: string) => Array.from({ length: 80 }, (_, index) => `${name}-${index}`).join('\n') + '\n'
let key: ((event: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => void) | null = null
let composed = ''
try {
  git('init', '-q')
  await writeFile(join(cwd, 'a.ts'), content('alpha-old'))
  await writeFile(join(cwd, 'b.ts'), content('bravo-old'))
  await writeFile(join(cwd, 'deleted.ts'), 'deleted-content\n')
  await writeFile(join(cwd, 'rename-before.ts'), 'rename-content\n')
  git('add', '.')
  git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base')
  await writeFile(join(cwd, 'a.ts'), content('alpha-new'))
  git('add', 'a.ts')
  await writeFile(join(cwd, 'b.ts'), content('bravo-new'))
  await writeFile(join(cwd, 'c.ts'), 'charlie-untracked\n')
  git('rm', '-q', 'deleted.ts')
  git('mv', 'rename-before.ts', 'rename-after.ts')
  const data = await fetchGitData(cwd, runGitCommand)
  const patch = await fetchGitReviewStream(cwd, runGitCommand, { kind: 'working' }, data.status)
  const view = buildPierreDiffView(patch, 'stream', null, 'dark', false)!
  assert.deepEqual(view.rows.filter(row => row.tone === 'file').map(row => row.filePath),
    ['a.ts', 'b.ts', 'c.ts', 'deleted.ts', 'rename-after.ts'])
  assert(view.rows.some(row => row.filePath === 'c.ts' && row.text.includes('charlie-untracked')))
  assert(view.rows.some(row => row.filePath === 'deleted.ts' && row.tone === 'deletion'))
  assert(!view.rows.some(row => row.tone === 'tree'), 'stream has no duplicate file-tree summary')

  const setup = await testRender(<GitPopover cwd={cwd} theme={DARK_THEME} width={120} height={40}
    onClose={() => {}} onKeyHandlerReady={(handler) => { key = handler }}
    onSendDiffNoteToComposer={(text) => { composed = text }} />, { width: 120, height: 40 })
  const flush = async () => {
    await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 260)) })
    await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 30)) })
    await setup.flush()
  }
  const until = async (predicate: () => boolean, message: string) => {
    for (let attempt = 0; attempt < 20 && !predicate(); attempt++) await flush()
    assert(predicate(), `${message}:\n${setup.captureCharFrame()}`)
  }
  const press = async (sequence: string) => {
    await act(async () => { key?.({ name: sequence, sequence, ctrl: false, shift: false }) })
    await flush()
  }
  const select = async (name: string) => {
    const y = setup.captureCharFrame().split('\n').findIndex(line => line.includes(name))
    assert(y >= 0, `${name} is in the file tree`)
    await act(async () => { await setup.mockMouse.click(10, y) })
    await flush()
  }
  try {
    await flush(); await flush()
    const scroll = setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable
    await until(() => scroll.scrollHeight > 320, 'all changed files share one scroll extent')
    const extent = scroll.scrollHeight
    assert(scroll.getChildren().length < 160, 'multi-file stream is windowed')
    await writeFile(join(cwd, 'b.ts'), content('bravo-later'))
    await select('b.ts')
    assert(scroll.scrollTop > 150, 'file-tree selection jumps into stream')
    assert.equal(scroll.scrollHeight, extent, 'file selection does not replace stream')
    const fileTop = scroll.scrollTop
    await act(async () => { scroll.scrollTo(scroll.scrollTop + 85) })
    await flush()
    assert(setup.captureCharFrame().includes('bravo-new'), 'tree navigation uses loaded comparison')
    assert(!setup.captureCharFrame().includes('bravo-later'), 'navigation does not silently reload content')
    await select('b.ts')
    assert.equal(scroll.scrollTop, fileTop, 'clicking the selected file jumps back to its header')
    await act(async () => { scroll.scrollTo(scroll.scrollTop + 85) })
    await flush()
    await press('r'); await flush()
    await until(() => setup.captureCharFrame().includes('bravo-later'), 'refresh updates comparison without losing position')
    await select('a.ts'); await select('b.ts')
    await press('tab'); await press('}'); await press('j')
    await press('a'); await press('B'); await press('return')
    assert(setup.captureCharFrame().includes('Note'), 'keyboard note attaches in second file')
    await press('A')
    assert(composed.includes('File: b.ts'), composed)
    assert(composed.includes('bravo-later') && !composed.includes('alpha-new'), 'composer receives only the annotated file context')
    await press('s')
    assert(setup.captureCharFrame().includes('Note'), 'old-side note survives split layout')
    await press('s')
    await select('a.ts')
    await press('tab'); await press('}'); await press('j')
    await press('a'); await press('A'); await press('return')
    await press('A')
    assert(composed.includes('File: a.ts') && composed.includes('\nA\n'), 'same line in first file has an independent note')
    await select('b.ts')
    await press('tab'); await press('}'); await press('j'); await press('A')
    assert(composed.includes('File: b.ts') && composed.includes('\nB\n'), 'second-file note was not overwritten')
    await press('}')
    assert(setup.captureCharFrame().includes('charlie-untracked'), 'next hunk crosses file boundary')
    await press('t'); await press('j'); await press('return'); await flush()
    await select('b.ts'); await press('tab'); await press('}'); await press('j')
    composed = ''
    await press('A')
    assert.equal(composed, '', 'notes do not leak into a different comparison source')
    await press('t'); await press('k'); await press('return'); await flush()
    await select('b.ts'); await press('tab'); await press('}'); await press('j'); await press('A')
    assert(composed.includes('File: b.ts') && composed.includes('\nB\n'), 'returning to working comparison restores notes')
    await act(async () => { scroll.scrollTo(0) })
    await flush()
    assert(setup.captureCharFrame().includes('alpha-old'), 'earlier files remain in the review stream')
  } finally { act(() => setup.renderer.destroy()) }
  console.log('Git review stream smoke passed: all file types, tree jumps, cached navigation, refresh, cross-file hunks, scoped notes/composer')
} finally { await rm(cwd, { recursive: true, force: true }) }
