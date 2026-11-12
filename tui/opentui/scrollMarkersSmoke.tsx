/** @jsxImportSource @opentui/react */
// The transcript scrollbar draws the viewport on the WHOLE transcript, not on the mounted card window
// the scrollbox holds: its thumb must not move when the window slides under an unchanged view, it is
// sized against every card, markers cover unmounted cards, and they sit beside the track, not on it.
import React from 'react'
import assert from 'node:assert/strict'
import type { ScrollBoxRenderable } from '@opentui/core'
import { testRender, act } from './testRender'
import { TranscriptScrollbar, scrollMarkerRows, scrollMarkerTargets, trackThumb, trackOffsetAt, type TranscriptTrack } from './app/ScrollMarkers'
import { RowHeightIndex } from './rowHeightIndex'
import { DARK_THEME } from '../theme'
import type { TuiTranscriptCard } from '../format'

const card = (key: string, extra: Partial<TuiTranscriptCard> & { tone?: string } = {}) => ({
  key, role: 'assistant', category: 'technical',
  lines: [{ text: 'x', tone: extra.tone ?? 'muted' }],
  ...extra,
}) as unknown as TuiTranscriptCard

// Pure mapping: markers by height on the transcript's scale.
const small = [
  card('p', { role: 'user' as never }),
  card('a'), card('b', { tone: 'result_error' }), card('c'),
  card('d', { fileEdits: [{ path: 'f.ts', added: 1, removed: 0 }] as never }),
  card('e', { role: 'user' as never, tone: 'result_error' }),
]
const trackOf = (heights: number[], top = 0, viewport = 5): TranscriptTrack => ({ lead: 0, cards: new RowHeightIndex(heights), trail: 0, top, viewport })
const uneven = trackOf([1, 1, 12, 1, 1, 4])
assert.deepEqual([...scrollMarkerRows(small, uneven, 20)], [[0, 'prompt'], [8, 'error'], [15, 'edit'], [18, 'error']])
assert.deepEqual([...scrollMarkerRows(small, uneven, 2)], [[0, 'error'], [1, 'error']], 'the most urgent kind wins a shared row')
assert.equal(scrollMarkerTargets(small, uneven, 2).get(0)?.key, 'b', 'a collision clicks through to the displayed card')
assert.equal(scrollMarkerRows(small, null, 10).size, 0)
// Thumb: sized by viewport / whole transcript, placed by position over the scrollable range.
assert.deepEqual(trackThumb(trackOf(Array(100).fill(2), 0, 20), 20), { top: 0, size: 2 })
assert.deepEqual(trackThumb(trackOf(Array(100).fill(2), 180, 20), 20), { top: 18, size: 2 })
assert.deepEqual(trackThumb(trackOf(Array(100).fill(2), 90, 20), 20), { top: 9, size: 2 })
assert.equal(trackOffsetAt(trackOf(Array(100).fill(2), 0, 20), 20, 18, 0), 180, 'the last row reaches the end')

// The real thing: 100 cards of two rows, of which the scrollbox mounts a 20-card window.
const TOTAL = 100
const cards = Array.from({ length: TOTAL }, (_, i) => card(`c${i}`, i === 90 ? { tone: 'result_error' } : i % 10 === 0 ? { role: 'user' as never } : {}))
const heightsRef = { current: { rows: new RowHeightIndex(Array(TOTAL).fill(2)) } }
let setWindow: (start: number) => void = () => {}
const seeks: Array<[number, number]> = []
const scrollRef: { current: ScrollBoxRenderable | null } = { current: null }
const Harness = () => {
  const [start, setStart] = React.useState(20)
  setWindow = setStart
  return (
    <box width={14} height={20} paddingX={1}>
      <scrollbox ref={scrollRef} style={{ height: 20 }} scrollY scrollbarOptions={{ trackOptions: { foregroundColor: DARK_THEME.surface2, backgroundColor: DARK_THEME.surface2 } }}>
        {cards.slice(start, start + 20).map((c) => <box key={c.key} id={`card:${c.key}`} height={2}><text>{c.key}</text></box>)}
      </scrollbox>
      <TranscriptScrollbar scrollRef={scrollRef} heightsRef={heightsRef} cards={cards} rows={20} theme={DARK_THEME} focused markers onSeek={(index, offset) => { seeks.push([index, offset]) }} />
    </box>
  )
}
const setup = await testRender(<Harness />, { width: 14, height: 20 })
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 20)) }) }
const thumb = () => {
  const node = setup.renderer.root.findDescendantById('transcript-scrollbar-thumb')
  assert.ok(node, 'the thumb is drawn')
  return { top: node.y, size: node.height }
}
await settle()
// Card 30 at the top of a window starting at card 20: 60 of 180 scrollable rows.
await act(async () => { scrollRef.current!.scrollTo(20) })
await settle()
const before = thumb()
assert.deepEqual(before, { top: 6, size: 2 }, 'the thumb is the viewport on all 100 cards, not on the 20 mounted')
// The window slides to start at card 25 and the view is held on card 30, as the reader's fixup does.
await act(async () => { setWindow(25) })
await act(async () => { scrollRef.current!.scrollTo(10) })
await settle()
assert.deepEqual(thumb(), before, 'a window slide under an unchanged view does not move the thumb')

const frame = setup.captureCharFrame().split('\n')
const markerColumn = 13 // right={0} inside the 14-wide box: beside the track at column 12
const column = frame.map((line) => line[markerColumn])
assert.equal(column[0], '·', 'the first prompt marks the top')
assert.equal(column[18], '▪', 'an error on an unmounted card (90) is marked at its place')
assert.equal(frame.map((line) => line[12]).filter((ch) => ch === '▪' || ch === '·').length, 0, 'no marker is drawn on the track itself')

// Pressing the track's last row seeks to the end; a press on the thumb keeps its grab point.
const bar = setup.renderer.root.findDescendantById('transcript-scrollbar')!
await act(async () => { await setup.mockMouse.click(bar.x, bar.y + 19) })
assert.deepEqual(seeks.at(-1), [TOTAL - 10, 0], 'the bottom of the track is the last viewport')
await act(async () => { setup.renderer.destroy() })
console.log('Transcript scrollbar smoke passed (whole-transcript thumb, stable across slides, markers beside the track)')
process.exit(0)
