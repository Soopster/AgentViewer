/** @jsxImportSource @opentui/react */
import React, { act, useState } from 'react'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'
import type { ScrollBoxRenderable } from '@opentui/core'
import { GitPopover } from './GitPopover'
import { DARK_THEME } from '../theme'

const cwd = await mkdtemp(join(tmpdir(), 'git-diff-controls-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
let key: ((event: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => void) | null = null
let resize: (width: number) => void = () => {}
let closed = false
function Harness() {
  const [width, setWidth] = useState(120); resize = setWidth
  return <GitPopover cwd={cwd} theme={DARK_THEME} width={width} height={40} onClose={() => { closed = true }} onKeyHandlerReady={handler => { key = handler }} />
}
try {
  git('init', '-q')
  await writeFile(join(cwd, 'alpha.ts'), 'old\n'); await writeFile(join(cwd, 'beta.ts'), 'old\n')
  git('add', '.'); git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base')
  await writeFile(join(cwd, 'alpha.ts'), Array.from({length:180}, (_, i) => `alpha-${i} ${'x'.repeat(110)} TAIL`).join('\n') + '\n')
  await writeFile(join(cwd, 'beta.ts'), 'beta-needle\t界\n')
  const setup = await testRender(<Harness />, {width:180, height:40})
  const frame = () => setup.captureCharFrame()
  const flush = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 40)) }); await setup.flush() }
  const until = async (predicate: () => boolean, label: string) => {
    for (let i=0; i<100 && !predicate(); i++) await flush()
    assert(predicate(), `${label}\n${frame()}`)
  }
  const press = async (sequence: string) => { await act(async () => { key?.({name:sequence, sequence, ctrl:false, shift:false}) }); await flush() }
  try {
    await until(() => frame().includes('alpha-0'), 'initial diff')
    const scroll = setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable
    assert(frame().includes('auto:unified'))
    const initial = scroll.scrollHeight
    await press('z'); assert(scroll.scrollHeight > initial * 1.5, 'wrapping expands measured rows')
    assert(frame().includes('TAIL'), 'wrapped tail paints on continuation row')
    await press('z'); assert.equal(scroll.scrollHeight, initial)
    await press('tab')
    for (let i=0;i<10;i++) await press('l')
    assert(frame().includes('TAIL'), 'horizontal panning reveals clipped tail')
    await press('T'); assert(frame().includes('tabs:8'))
    await act(async () => { scroll.scrollTo(95) }); await flush()
    const saved = scroll.scrollTop
    await press('/'); for (const char of 'beta') await press(char); await press('return')
    await until(() => frame().includes('beta-needle'), 'filter shows matching file')
    assert(!frame().includes('alpha-'), 'filter removes other file rows')
    await press('escape'); await until(() => scroll.scrollTop === saved, 'clearing filter restores review position')
    assert(!closed)
    await press('/'); for (const char of 'absent') await press(char); await press('return')
    assert(frame().includes('No files match'))
    await press('escape')
    await act(async () => { resize(180) }); await flush()
    assert(frame().includes('auto:split'), 'auto responds to pane width')
    await press('s'); assert(frame().includes('unified'), 'manual unified override')
    await act(async () => { resize(120) }); await flush()
    await act(async () => { resize(180) }); await flush()
    assert(!frame().includes('auto:split'), 'explicit mode survives resize')
    await press('S'); assert(frame().includes('auto:split'), 'automatic mode can be restored')
    assert(scroll.getChildren().length < 150, 'wrapped/filter controls preserve viewport bounds')
  } finally { act(() => setup.renderer.destroy()) }
  console.log('Git controls smoke passed: auto/explicit resize, wrapping, horizontal pan, tab width, filter and position restoration')
} finally { await rm(cwd, {recursive:true, force:true}) }
