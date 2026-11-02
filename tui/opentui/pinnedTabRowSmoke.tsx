/** @jsxImportSource @opentui/react */
// Pinned tabs on their own row: chips share the width, the selected one is lit, a
// narrow row says how many it left out, and there is no close button to hit by mistake.
import React from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { PinnedTabRow, pinnedChipLayout } from './PinnedTabRow'
import { DARK_THEME } from '../theme'
import type { Session } from '../../lib/types'

assert.deepEqual(pinnedChipLayout(0, 80), { chipWidth: 0, shown: 0 })
assert.deepEqual(pinnedChipLayout(2, 80), { chipWidth: 26, shown: 2 }, 'a few chips stop at the maximum width')
const crowded = pinnedChipLayout(12, 60)
assert.ok(crowded.shown < 12 && crowded.shown >= 1, 'a crowded row shows what fits')
assert.ok(crowded.shown * (crowded.chipWidth + 1) <= 60, 'and what it shows fits the width')

const session = (id: string, summary: string): Session => ({ sessionId: id, provider: 'claude', summary, lastModified: 1 })
const sessions = [session('a', 'Alpha task'), session('b', 'Bravo task'), session('c', 'Charlie task')]
const clicked: string[] = []
const setup = await testRender(
  <PinnedTabRow
    sessions={sessions} selectedKey="claude:b" running={new Set(['claude:c'])} theme={DARK_THEME} width={60}
    onSelect={(s) => clicked.push(s.sessionId)} onMenu={() => {}} onMove={() => {}} onRelease={() => {}}
    onPress={(_s, _e, click) => click()}
  />,
  { width: 62, height: 2 },
)
for (let i = 0; i < 10; i++) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 20)) })
const row = setup.captureCharFrame().split('\n')[0]!
assert.match(row, /◆ Alpha task/)
assert.match(row, /◆ Bravo task/)
assert.match(row, /◆ ● Charlie task/, 'a running pinned tab is marked')
assert.ok(!row.includes('×'), 'no close button on a pinned chip')
await act(async () => { await setup.mockMouse.click(row.indexOf('Bravo') + 1, 0) })
assert.deepEqual(clicked, ['b'], 'a click selects that chip')
setup.renderer.destroy()
console.log('Pinned tab row smoke passed (layout, chips, running mark, no ×, click)')
process.exit(0)
