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
import { buildPierreDiffView } from './pierreDiffView'
import { applyDiffContext, expandDiffContext, readDiffBaseLines } from './gitDiffContext'

const cwd = await mkdtemp(join(tmpdir(), 'git-diff-context-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const original = Array.from({ length: 200 }, (_, index) => `original-line-${index + 1}`)
// Deliberately retain blank lines and trailing spaces in the source blob.
original[27] = ''
original[28] = 'trailing spaces   '
let key: ((event: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => void) | null = null
let composed = ''
try {
  git('init', '-q')
  await writeFile(join(cwd, 'context.ts'), original.join('\n') + '\n')
  git('add', '.')
  git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base')
  const changed = [...original]
  changed[49] = 'changed-line-50'
  changed[159] = 'changed-line-160'
  changed.splice(100, 0, 'inserted-one', 'inserted-two')
  await writeFile(join(cwd, 'context.ts'), changed.join('\n') + '\n')
  const patch = git('diff', 'HEAD')
  const base = buildPierreDiffView(patch, 'context', null, 'dark', false, true)!
  const gaps = base.rows.flatMap(row => row.contextGap ? [row.contextGap] : [])
  assert.equal(gaps.length, 4, 'leading, two middle, and trailing gaps')
  const source = await readDiffBaseLines(cwd, gaps[0]!.baseOid)
  assert.deepEqual(source, original, 'blob reader preserves blank lines and trailing whitespace')
  const expansion = expandDiffContext(gaps[0]!, source, 0)
  assert.equal(expansion.count, 20)
  const expanded = applyDiffContext(base, new Map([[gaps[0]!.id, expansion]]))
  const first = expanded.rows.filter(row => row.expandedGapId)
  assert.equal(first[0]?.oldLine, 27)
  assert.equal(first[0]?.newLine, 27)
  assert.equal(first.at(-1)?.oldLine, 46)
  assert.equal(first[1]?.text, '')
  assert.equal(first[2]?.text, 'trailing spaces   ')
  const offsetGap = gaps[2]!
  const offsetView = applyDiffContext(base, new Map([[offsetGap.id, expandDiffContext(offsetGap, source, 0)]]))
  for (const row of offsetView.rows.filter(row => row.expandedGapId)) {
    assert.equal(row.newLine, row.oldLine! + 2, 'middle gap accounts for preceding insertions')
    assert.equal(row.text, original[row.oldLine! - 1])
  }
  const trailing = expandDiffContext(gaps[3]!, source, 0)
  assert.equal(trailing.total, 37)
  assert.equal(trailing.lines[0], 'original-line-164')
  assert.equal(expandDiffContext(gaps[3]!, source, trailing.count).count, 37)
  await assert.rejects(readDiffBaseLines(cwd, '--help'), 'invalid object IDs are rejected')

  const setup = await testRender(<GitPopover cwd={cwd} theme={DARK_THEME} width={140} height={45}
    onClose={() => {}} onKeyHandlerReady={(handler) => { key = handler }}
    onSendDiffNoteToComposer={text => { composed = text }} />, { width: 140, height: 45 })
  const flush = async () => {
    await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 100)) })
    await setup.flush()
  }
  const until = async (predicate: () => boolean, label: string) => {
    for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await flush()
    assert(predicate(), `${label}:\n${setup.captureCharFrame()}`)
  }
  const press = async (sequence: string) => {
    await act(async () => { key?.({ name: sequence, sequence, ctrl: false, shift: false }) })
    await flush()
  }
  try {
    await until(() => setup.captureCharFrame().includes('Show 20 preceding'), 'initial context affordance')
    const scroll = setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable
    const initialHeight = base.rows.length
    // Change the worktree after loading. Expansion must still use the displayed patch's base blob.
    await act(async () => { await writeFile(join(cwd, 'context.ts'), 'unrelated-live-file\n') })
    const gapY = setup.captureCharFrame().split('\n').findIndex(line => line.includes('Show 20 preceding'))
    await act(async () => { await setup.mockMouse.click(scroll.x + 10, gapY) })
    await until(() => setup.captureCharFrame().includes('original-line-27'), 'mouse expansion reveals pinned source')
    assert.equal(scroll.scrollHeight, initialHeight + 20)
    assert(!setup.captureCharFrame().includes('unrelated-live-file'))
    await press('e')
    await until(() => setup.captureCharFrame().includes('original-line-7'), 'keyboard expands another 20 lines')
    assert.equal(scroll.scrollHeight, initialHeight + 40)
    await press('c')
    await until(() => scroll.scrollHeight === Math.max(initialHeight, scroll.viewport.height), 'collapse restores original geometry')
    await press('e')
    await until(() => setup.captureCharFrame().includes('original-line-27'), 're-expand after collapse')
    await press('s')
    assert(setup.captureCharFrame().includes('original-line-27'), 'context survives layout toggle')
    await press('j'); await press('a'); await press('N'); await press('return'); await press('A')
    assert(composed.includes('File: context.ts') && composed.includes('Range: L27'), composed)
    assert(composed.includes('original-line-27'), 'expanded context reaches composer')
    await press('c')
    assert(!setup.captureCharFrame().includes('Note'), 'collapsed context hides its anchored note')
    await press('e')
    await until(() => setup.captureCharFrame().includes('Note'), 'note returns with expanded source line')
    assert(scroll.getChildren().length < 160, 'context remains viewport-windowed')
  } finally { act(() => setup.renderer.destroy()) }
  console.log('Git context smoke passed: pinned blobs, before/between/after ranges, line numbers, mouse/keyboard expansion, collapse, split notes')
} finally { await rm(cwd, { recursive: true, force: true }) }
