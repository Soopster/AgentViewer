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
import { buildPierreDiffView, loadDiffHighlights } from './pierreDiffView'

const cwd = await mkdtemp(join(tmpdir(), 'git-diff-viewport-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd })
let key: ((event: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => void) | null = null
const lines = (value: string) => Array.from({ length: 2400 }, (_, i) => `const row${String(i).padStart(4, '0')} = "${value}";`).join('\n') + '\n'
try {
  git('init', '-q')
  await writeFile(join(cwd, 'large.ts'), lines('before'))
  git('add', '.')
  git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base')
  await writeFile(join(cwd, 'large.ts'), lines('after!'))
  const setup = await testRender(<GitPopover cwd={cwd} theme={DARK_THEME} width={120} height={40}
    onClose={() => {}} onKeyHandlerReady={(handler) => { key = handler }} />, { width: 120, height: 40 })
  const flush = async () => {
    await act(async () => { await setup.flush(); await new Promise(r => setTimeout(r, 300)) })
    await act(async () => { await setup.flush(); await new Promise(r => setTimeout(r, 30)) })
    await setup.flush()
  }
  const press = async (sequence: string) => { await act(async () => { key?.({ name: sequence, sequence, ctrl: false, shift: false }) }); await flush() }
  try {
    await flush()
    await flush()
    const scroll = setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable
    assert(scroll)
    assert(scroll.scrollHeight > 4800, `full diff extent: ${scroll.scrollHeight}`)
    assert(scroll.getChildren().length < 160, `bounded children: ${scroll.getChildren().length}`)
    await act(async () => { scroll.scrollTo(4300) })
    await flush()
    let frame = setup.captureCharFrame()
    assert(frame.includes('row189'), `tail beyond old cap is visible:\n${frame}`)
    const beforeTop = scroll.scrollTop
    await press('r')
    assert.equal(scroll.scrollTop, beforeTop, 'refresh preserves offset')
    await press('s')
    frame = setup.captureCharFrame()
    assert(frame.includes('row189'), `split preserves source line:\n${frame}`)
    assert(scroll.scrollTop < beforeTop, 'split uses new geometry')
    await press('s')
    assert.equal(scroll.scrollTop, beforeTop, 'unified restores original source line')
    await act(async () => { scroll.scrollTo(1700) })
    await flush()
    const oldSideTop = scroll.scrollTop
    await press('s')
    await press('s')
    assert.equal(scroll.scrollTop, oldSideTop, 'deleted-side anchor survives split round trip')
    await press('m')
    assert.equal(scroll.scrollTop, oldSideTop - 1, 'hidden header preserves source row')
    await press('m')
    assert.equal(scroll.scrollTop, oldSideTop, 'restored header preserves source row')
    await act(async () => { scroll.scrollTo(1e9) })
    await flush()
    assert(setup.captureCharFrame().includes('row2399'), 'last line reachable')
    assert(scroll.getChildren().length < 160, 'tail remains windowed')
    const fullHeight = scroll.scrollHeight
    await act(async () => { await setup.mockMouse.click(scroll.x + 28, scroll.y + 10) })
    await flush()
    await press('a')
    assert(setup.captureCharFrame().includes('Draft note'), 'note draft mounts at clicked source row')
    assert.equal(scroll.scrollHeight, fullHeight + 6, 'draft geometry matches rendered height')
    await press('Z')
    await press('return')
    assert.equal(scroll.scrollHeight, fullHeight + 4, 'saved note geometry matches rendered height')
    assert(setup.captureCharFrame().includes('Note'), 'saved note remains visible')
    await act(async () => { scroll.scrollTo(0) })
    await flush()
    await act(async () => { scroll.scrollTo(1e9) })
    await flush()
    assert(setup.captureCharFrame().includes('Note'), 'note survives viewport unmount/remount')
    await press('x')
    assert.equal(scroll.scrollHeight, fullHeight, 'note deletion restores extent')
    await press('v')
    await act(async () => { scroll.scrollTo(1e9) })
    await flush()
    assert(setup.captureCharFrame().includes('row2399'), 'plain diff is also untruncated')
  } finally { act(() => setup.renderer.destroy()) }

  const patch = (word: string) => `diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-const value = "before";\n+const value = "${word}";\n`
  const first = await loadDiffHighlights(patch('after1'), 'example.ts', 'dark')
  const second = await loadDiffHighlights(patch('after2'), 'example.ts', 'dark')
  assert.notEqual(first, second, 'same-length edits have distinct highlight results')
  const view = buildPierreDiffView(patch('after2'), 'example.ts', second, 'dark')!
  assert(view.rows.some(row => row.spans?.some(span => span.bg)), 'unified changed words carry backgrounds')
  assert(view.splitRows.some(row => row.right?.spans?.some(span => span.bg)), 'split changed words carry backgrounds')
  console.log('Git diff viewport smoke passed: full extent, bounded rows, refresh/layout anchors, cache identity, word emphasis')
} finally { await rm(cwd, { recursive: true, force: true }) }
