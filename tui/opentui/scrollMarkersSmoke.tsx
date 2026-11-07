/** @jsxImportSource @opentui/react */
// The track marks where prompts, edits and errors sit — by laid-out height, the
// scale the scrollbar thumb uses, not by message order. Pure mapping first, then
// a real scrollbox of uneven cards, measured and painted.
import React from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { ScrollMarkers, scrollMarkerRows, scrollMarkerTargets, useScrollLayout, type ScrollLayout } from './app/ScrollMarkers'
import { DARK_THEME } from '../theme'
import type { TuiTranscriptCard } from '../format'

const card = (key: string, extra: Partial<TuiTranscriptCard> & { tone?: string } = {}) => ({
  key, role: 'assistant', category: 'technical',
  lines: [{ text: 'x', tone: extra.tone ?? 'muted' }],
  ...extra,
}) as unknown as TuiTranscriptCard

const cards = [
  card('p', { role: 'user' as never }),
  card('a'), card('b', { tone: 'result_error' }), card('c'),
  card('d', { fileEdits: [{ path: 'f.ts', added: 1, removed: 0 }] as never }),
  card('e', { role: 'user' as never, tone: 'result_error' }),
]

const layoutOf = (heights: Record<string, number>): ScrollLayout => {
  let top = 0
  const placed = new Map<string, { top: number; height: number }>()
  for (const [key, height] of Object.entries(heights)) { placed.set(key, { top, height }); top += height }
  return { contentHeight: top, cards: placed }
}

// Uneven cards: the error card ('b') is the tall one, so it owns the middle of the
// track; by message order alone it would sit a fifth of the way down.
const uneven = layoutOf({ p: 1, a: 1, b: 12, c: 1, d: 1, e: 4 })
const rows = scrollMarkerRows(cards, uneven, 20)
assert.deepEqual([...rows].map(([row, kind]) => [row, kind]), [[0, 'prompt'], [8, 'error'], [15, 'edit'], [18, 'error']])
// Squeezed into two rows the most urgent kind in each row wins.
assert.deepEqual([...scrollMarkerRows(cards, uneven, 2)], [[0, 'error'], [1, 'error']])
// A card with no layout (outside the mounted window) gets no marker; no layout, no markers.
assert.deepEqual([...scrollMarkerRows(cards, layoutOf({ b: 5, c: 5 }), 10)], [[2, 'error']])
assert.equal(scrollMarkerRows(cards, null, 10).size, 0)
assert.equal(scrollMarkerTargets(cards, uneven, 2).get(0)?.key, 'b', 'Collision clicks target the displayed highest-priority card')

// The real thing: a scrollbox of boxes with those heights, measured by the hook.
const heights: Record<string, number> = { p: 1, a: 1, b: 12, c: 1, d: 1, e: 4 }
let jumped: string | null = null
const Harness = () => {
  const ref = React.useRef<import('@opentui/core').ScrollBoxRenderable | null>(null)
  const layout = useScrollLayout(ref, true)
  return (
    <box width={12} height={10}>
      <scrollbox ref={ref} style={{ height: 10 }} scrollY>
        {cards.map((c) => <box key={c.key} id={`card:${c.key}`} height={heights[c.key]!}><text>{c.key}</text></box>)}
      </scrollbox>
      <ScrollMarkers cards={cards} layout={layout} rows={10} theme={DARK_THEME} onJump={key => { jumped = key }} />
    </box>
  )
}
const setup = await testRender(<Harness />, { width: 12, height: 10 })
for (let i = 0; i < 20; i++) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 30)) })
const frame = setup.captureCharFrame().split('\n')
const errorMarker = setup.renderer.root.findDescendantById('scroll-marker:error:4')!
assert.ok(errorMarker)
await act(async () => { await setup.mockMouse.click(errorMarker.x, errorMarker.y) })
assert.equal(jumped, 'b', 'Clicking the error marker jumps to its card')
await act(async () => { setup.renderer.destroy() })
const col = 10 // right={1} inside a 12-wide box
const markers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => frame[r]![col]!)
assert.equal(markers[0], '·', 'the prompt is at the top')
assert.equal(markers.indexOf('▪') > 1, true, 'the tall error card marks the middle of the track, not row 1')
assert.equal(markers.filter((ch) => ch === '▪').length >= 2, true, 'edit and trailing error are marked too')
console.log('Scroll markers smoke passed (laid-out height, unmounted cards, measured scrollbox)')
process.exit(0)
