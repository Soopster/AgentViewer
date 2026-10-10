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
import { copyDiffCellSelection, copyDiffRows, diffMatchRanges, findDiffTextMatches, highlightDiffMatches, sourceIndexAtCell } from './gitDiffReviewActions'
import type { ReviewActionKey } from './useGitDiffReviewActions'

assert.deepEqual(diffMatchRanges('a.b A.B axb', 'a.b'), [{start:0,end:3},{start:4,end:7}], 'literal case-insensitive matches')
assert.deepEqual(diffMatchRanges('界𐐀x', '𐐨'), [{start:1,end:3}], 'Unicode indices remain source offsets')
const highlighted = highlightDiffMatches('foobar', [{text:'foo',fg:'red'},{text:'bar',fg:'blue'}], 'ob', 'black', 'yellow')!
assert.equal(highlighted.map(span => span.text).join(''), 'foobar')
assert.equal(highlighted.filter(span => span.bg === 'yellow').map(span => span.text).join(''), 'ob')
assert.equal(highlighted[0]?.fg, 'red'); assert.equal(highlighted.at(-1)?.fg, 'blue')
assert.equal(sourceIndexAtCell('a\tb界', 4, 4), 2, 'terminal cell maps after tab expansion')
assert.equal(sourceIndexAtCell('a\tb界', 5, 4), 3, 'wide grapheme maps to source boundary')
const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-old\t界\n+new\t界\n context\n'
const view = buildPierreDiffView(patch, 'copy', null)!
const splitStart = view.splitRows.findIndex(row => row.left?.text === 'old\t界')
assert.equal(copyDiffRows(view.splitRows, splitStart, splitStart + 1), 'new\t界\ncontext')
assert.equal(copyDiffRows(view.splitRows, splitStart, splitStart + 1, 'old'), 'old\t界\ncontext')
assert.equal(findDiffTextMatches(view.splitRows, 'context').length, 1, 'split context is not counted twice')
assert.equal(findDiffTextMatches(view.splitRows, 'old')[0]?.side, 'old')
assert.equal(copyDiffCellSelection(view.splitRows, { startRow: splitStart, startColumn: 3, endRow: splitStart, endColumn: 8, side: 'old' }, 4), '\t界', 'cell copy preserves source tabs and wide characters')
const cwd = await mkdtemp(join(tmpdir(), 'git-diff-actions-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding:'utf8' })
let key: ((event: ReviewActionKey) => void) | null = null
let copied = '', closed = false, failCopy = false
try {
  git('init', '-q'); await writeFile(join(cwd, 'alpha.ts'), 'original\n'); await writeFile(join(cwd, 'beta.ts'), 'old-beta\n')
  git('add', '.'); git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base')
  const lines = Array.from({length:400}, (_, i) => `row-${i}`)
  lines[0] = 'mouse\t界 tail'; lines[10] = `needle\t界 ${'x'.repeat(130)} TAIL`; lines[350] = 'NEEDLE second'
  await writeFile(join(cwd, 'alpha.ts'), lines.join('\n')+'\n'); await writeFile(join(cwd, 'beta.ts'), 'needle beta\n')
  const setup = await testRender(<GitPopover cwd={cwd} theme={DARK_THEME} width={140} height={42}
    onClose={() => {closed = true}} onKeyHandlerReady={handler => {key = handler}}
    onClipboardWrite={async text => { if (failCopy) throw new Error('fixture clipboard failure'); copied = text }} />, {width:140,height:42})
  const frame = () => setup.captureCharFrame()
  const flush = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 40)) }); await setup.flush() }
  const press = async (sequence: string, ctrl=false, shift=false) => { await act(async () => {key?.({name:sequence,sequence,ctrl,shift})}); await flush() }
  const until = async (check: () => boolean, label: string) => {for (let i=0;i<100&&!check();i++) await flush(); assert(check(), `${label}\n${frame()}`)}
  try {
    await until(() => frame().includes('mouse'), 'initial review')
    const scroll = setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable
    const mouseLine = frame().split('\n').find(line => line.includes('mouse'))!
    const mouseY = frame().split('\n').findIndex(line => line.includes('mouse'))
    const mouseX = mouseLine.indexOf('mouse')
    await act(async () => { await setup.mockMouse.drag(mouseX + 6, mouseY, mouseX + 10, mouseY) })
    await press('y'); assert.equal(copied, '\t界', 'mouse cell selection copies exact source cells')
    await press('f',true); for (const char of 'needle') await press(char); await press('return')
    assert(frame().includes('1/3'), 'content search counts all files')
    await press('y'); assert.equal(copied,lines[10], 'copy keeps tabs, Unicode, and clipped tail')
    await press('j',false,true); await press('y'); assert.equal(copied,lines[10]+'\nrow-11', 'range copy')
    await press('g',true); await until(() => frame().includes('NEEDLE second'), 'next match scrolls beyond viewport')
    await press('y'); assert.equal(copied, 'NEEDLE second', 'search navigation clears previous range')
    await press('g',true); await until(() => frame().includes('needle beta'), 'next match crosses files')
    await press('y'); assert.equal(copied, 'needle beta')
    await press('g',true); assert(frame().includes('1/3'), 'next wraps')
    await press('r',true); assert(frame().includes('3/3'), 'previous wraps')
    await press('s'); await press('Y'); assert.equal(copied, 'old-beta', 'old-side copy in split layout')
    await press('y'); assert.equal(copied, 'needle beta', 'new-side copy in split layout')
    await press('z'); await press('r',true); await press('r',true); await press('y'); assert.equal(copied,lines[10], 'wrapped split copy is original source')
    failCopy = true; await press('y'); assert(frame().includes('Copy failed'), 'clipboard failure is visible')
    await press('escape'); assert(!closed, 'escape clears search before closing')
    await press('f',true); for (const char of 'missing') await press(char); assert(frame().includes('0/0'))
    await press('escape'); assert(!closed)
    assert(scroll.getChildren().length < 180, 'search keeps rendered rows bounded')
  } finally { act(() => setup.renderer.destroy()) }
  console.log('Git review actions smoke passed: literal/Unicode search, cross-file navigation, wrapping, range/old/new copy, clipboard failure')
} finally {await rm(cwd,{recursive:true,force:true})}
