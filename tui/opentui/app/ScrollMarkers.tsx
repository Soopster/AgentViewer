/** @jsxImportSource @opentui/react */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { BoxRenderable, MouseEvent, Renderable, ScrollBoxRenderable } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import type { TuiTranscriptCard } from '../../format'
import type { TuiThemePalette } from '../../theme'
import type { RowHeightIndex } from '../rowHeightIndex'
import { cardHasEdit, cardHasError } from './cardJumpPredicates'
import { readerRowKey } from './readerRows'

export type ScrollMarkerKind = 'error' | 'edit' | 'prompt'
const PRIORITY: Record<ScrollMarkerKind, number> = { prompt: 0, edit: 1, error: 2 }

/**
 * The whole transcript as the scrollbar draws it. The scrollbox holds only the mounted card window,
 * so its own scrollbar measured that window: the thumb was sized and placed against a few hundred
 * cards and jumped whenever the window slid. This is the transcript's scale instead — every card's
 * height (measured once mounted, estimated until then) — with the viewport placed on it.
 */
export type TranscriptTrack = {
  /** Rows of content above the first card (the "earlier messages" hint). */
  lead: number
  /** Every card's height, in transcript order. */
  cards: Pick<RowHeightIndex, 'length' | 'total' | 'offset' | 'height'>
  /** Rows of content after the last card. */
  trail: number
  /** Where the viewport's top sits on that scale. */
  top: number
  viewport: number
}

export const trackTotal = (track: TranscriptTrack) => track.lead + track.cards.total + track.trail

/** The thumb's first row and length on a track of `rows` rows. */
export function trackThumb(track: TranscriptTrack, rows: number): { top: number; size: number } {
  const total = trackTotal(track)
  if (rows < 1 || total <= track.viewport) return { top: 0, size: rows }
  const size = Math.max(1, Math.min(rows, Math.round((track.viewport / total) * rows)))
  const range = total - track.viewport
  const top = Math.round((Math.max(0, Math.min(track.top, range)) / range) * (rows - size))
  return { top, size }
}

/** The track offset a press on row `row` asks for, keeping the thumb's grab point under the pointer. */
export function trackOffsetAt(track: TranscriptTrack, rows: number, row: number, grab: number): number {
  const { size } = trackThumb(track, rows)
  const range = trackTotal(track) - track.viewport
  if (rows <= size || range <= 0) return 0
  return Math.max(0, Math.min(range, ((row - grab) / (rows - size)) * range))
}

/** One marker per track row, most urgent kind winning a shared row, each at its card's midpoint on
 * the transcript's scale — the scale the thumb uses, so a marker sits beside the thumb when its card
 * is on screen. Every card is placed, mounted or not. */
export function scrollMarkerTargets(cards: readonly TuiTranscriptCard[], track: TranscriptTrack | null, rows: number): Map<number, { kind: ScrollMarkerKind; key: string }> {
  const markers = new Map<number, { kind: ScrollMarkerKind; key: string }>()
  if (!track || rows < 2) return markers
  const total = trackTotal(track)
  if (total <= 0) return markers
  const count = Math.min(cards.length, track.cards.length)
  for (let index = 0; index < count; index++) {
    const card = cards[index]!
    const kind: ScrollMarkerKind | null = cardHasError(card) ? 'error' : cardHasEdit(card) ? 'edit' : card.role === 'user' ? 'prompt' : null
    if (!kind) continue
    const middle = track.lead + track.cards.offset(index) + track.cards.height(index) / 2
    const row = Math.max(0, Math.min(Math.floor((middle / total) * rows), rows - 1))
    const existing = markers.get(row)
    if (!existing || PRIORITY[kind] > PRIORITY[existing.kind]) markers.set(row, { kind, key: card.key })
  }
  return markers
}

export function scrollMarkerRows(cards: readonly TuiTranscriptCard[], track: TranscriptTrack | null, rows: number): Map<number, ScrollMarkerKind> {
  return new Map([...scrollMarkerTargets(cards, track, rows)].map(([row, target]) => [row, target.kind]))
}

/** Place the scrollbox's viewport on the transcript's scale, from the card row at its top: only that
 * card's local offset comes from layout, everything above it from the height index. */
export function readTranscriptTrack(sb: ScrollBoxRenderable, heights: RowHeightIndex | undefined, keyIndex: ReadonlyMap<string, number>): TranscriptTrack | null {
  const viewport = sb.viewport.height
  const scrollTop = sb.scrollTop
  const scrollHeight = sb.scrollHeight
  const children = sb.content.getChildren() as Renderable[]
  const contentY = sb.content.y
  const indexOf = (row: Renderable) => { const key = readerRowKey(row); return key == null ? undefined : keyIndex.get(key) }
  let first = 0
  while (first < children.length && indexOf(children[first]!) === undefined) first++
  let last = children.length - 1
  while (last > first && indexOf(children[last]!) === undefined) last--
  // No card rows, or no index for them: the scrollbox's own geometry is all there is.
  if (!heights || first >= children.length || heights.length === 0) {
    return { lead: 0, cards: { length: 0, total: 0, offset: () => 0, height: () => 0 }, trail: scrollHeight, top: scrollTop, viewport }
  }
  const firstIndex = indexOf(children[first]!)!
  const lastIndex = indexOf(children[last]!)!
  const firstTop = children[first]!.y - contentY
  // Rows above the first card belong to the transcript only when it is the transcript's first card;
  // otherwise they are the window's own chrome and the unmounted cards stand in for them.
  const lead = firstIndex === 0 ? Math.max(0, firstTop) : 0
  const lastRow = children[last]!
  const trail = lastIndex === heights.length - 1 ? Math.max(0, scrollHeight - (lastRow.y - contentY + lastRow.height)) : 0
  // The card row at the viewport's top: the last whose top is at or above scrollTop.
  let low = first
  let high = last
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (children[mid]!.y - contentY <= scrollTop) low = mid
    else high = mid - 1
  }
  let anchor = low
  while (anchor > first && indexOf(children[anchor]!) === undefined) anchor--
  const anchorTop = children[anchor]!.y - contentY
  const top = scrollTop < firstTop
    ? (firstIndex === 0 ? scrollTop : heights.offset(firstIndex) - (firstTop - scrollTop))
    : lead + heights.offset(indexOf(children[anchor]!)!) + (scrollTop - anchorTop)
  const track: TranscriptTrack = { lead, cards: heights, trail, top, viewport }
  // The ends are exact: the window holding the transcript's first or last card at its own edge.
  if (firstIndex === 0 && scrollTop <= 0) track.top = 0
  else if (lastIndex === heights.length - 1 && scrollTop >= scrollHeight - viewport) track.top = trackTotal(track) - viewport
  return track
}

type TrackState = { thumb: { top: number; size: number }; markers: Map<number, { kind: ScrollMarkerKind; key: string }>; track: TranscriptTrack }
const sameMarkers = (a: TrackState['markers'], b: TrackState['markers']) => a.size === b.size && [...a].every(([row, m]) => b.get(row)?.key === m.key && b.get(row)?.kind === m.kind)

/**
 * The transcript's scrollbar, drawn over the scrollbox's own track (whose thumb is painted in the
 * track's colour, so only the gutter remains). The thumb is the viewport on the whole transcript;
 * markers sit in the column beside the track, never on it, so the thumb reads as one piece.
 * Re-read on each painted frame, and set only when what is drawn changed.
 */
export const TranscriptScrollbar = React.memo(function TranscriptScrollbar({ scrollRef, heightsRef, cards, rows, theme, focused, markers, onJump, onSeek }: {
  scrollRef: RefObject<ScrollBoxRenderable | null>
  /** Reads the transcript's height index (the window gauge's), which is mutated in place as cards are measured. */
  heightsRef: RefObject<{ rows?: RowHeightIndex }>
  cards: readonly TuiTranscriptCard[]
  rows: number
  theme: TuiThemePalette
  focused: boolean
  markers: boolean
  onJump?: (key: string) => void
  /** Scroll to a card index, `offset` rows into it. */
  onSeek?: (index: number, offset: number) => void
}) {
  const renderer = useRenderer()
  const [state, setState] = useState<TrackState | null>(null)
  const keyIndex = useMemo(() => new Map(cards.map((card, index) => [card.key, index])), [cards])
  const stateRef = useRef(state)
  useLayoutEffect(() => { stateRef.current = state }, [state])
  const markerSignatureRef = useRef('')
  useEffect(() => {
    let lastSignature = ''
    const read = () => {
      const sb = scrollRef.current
      if (!sb || sb.isDestroyed) return
      if (!sb.verticalScrollBar.visible) {
        if (stateRef.current) setState(null)
        lastSignature = ''
        return
      }
      const heights = heightsRef.current?.rows
      const children = sb.content.getChildren()
      // Skip the layout reads when nothing that places the viewport moved.
      const signature = `${sb.scrollTop}:${sb.scrollHeight}:${sb.viewport.height}:${children.length}:${children[0]?.id ?? ''}:${heights?.total ?? -1}:${heights?.length ?? -1}:${rows}`
      if (signature === lastSignature) return
      lastSignature = signature
      const track = readTranscriptTrack(sb, heights, keyIndex)
      if (!track) return
      const thumb = trackThumb(track, rows)
      const total = trackTotal(track)
      const markerSignature = markers ? `${total}:${track.lead}:${heights?.length ?? 0}:${rows}` : ''
      const previous = stateRef.current
      const nextMarkers = !markers ? new Map() : previous && markerSignature === markerSignatureRef.current ? previous.markers : scrollMarkerTargets(cards, track, rows)
      markerSignatureRef.current = markerSignature
      if (previous && previous.thumb.top === thumb.top && previous.thumb.size === thumb.size && sameMarkers(previous.markers, nextMarkers)) {
        previous.track = track
        return
      }
      setState({ thumb, markers: nextMarkers, track })
    }
    read()
    renderer.on('frame', read)
    return () => { renderer.off('frame', read) }
  }, [renderer, scrollRef, heightsRef, keyIndex, cards, rows, markers])

  const grabRef = useRef<number | null>(null)
  const barRef = useRef<BoxRenderable | null>(null)
  const seekTo = (event: MouseEvent) => {
    const track = stateRef.current?.track
    const heights = heightsRef.current?.rows
    if (!onSeek || !track || !heights || heights.length === 0) return
    const offset = trackOffsetAt(track, rows, event.y - (barRef.current?.y ?? 0), grabRef.current ?? 0) - track.lead
    const index = Math.min(heights.length - 1, heights.at(Math.max(0, offset)))
    onSeek(index, Math.max(0, Math.round(offset - heights.offset(index))))
  }
  if (!state) return null
  const { thumb } = state
  const thumbColor = focused ? theme.cyan : theme.border
  const color = { error: theme.red, edit: theme.green, prompt: theme.cyan }
  return (
    <>
      <box ref={barRef} id="transcript-scrollbar" position="absolute" top={0} right={1} width={1} height={rows} zIndex={2}
        onMouseDown={(event) => {
          if (event.button !== 0 || !onSeek) return
          event.stopPropagation()
          const row = event.y - (barRef.current?.y ?? 0)
          // A press on the thumb keeps its grab point; on the track, the thumb centres on the pointer.
          grabRef.current = row >= thumb.top && row < thumb.top + thumb.size ? row - thumb.top : Math.floor(thumb.size / 2)
          seekTo(event)
        }}
        onMouseDrag={(event) => {
          if (grabRef.current === null) return
          event.stopPropagation()
          seekTo(event)
        }}
        onMouseUp={() => { grabRef.current = null }}
      >
        <box id="transcript-scrollbar-thumb" position="absolute" top={thumb.top} left={0} width={1} height={thumb.size} backgroundColor={thumbColor} />
      </box>
      {[...state.markers].map(([row, { kind, key }]) => (
        <box key={row} id={`scroll-marker:${kind}:${row}`} position="absolute" top={row} right={0} width={1} height={1} zIndex={2} onMouseDown={event => { if (onJump && event.button === 0) { event.stopPropagation(); onJump(key) } }}>
          <text fg={color[kind]} wrapMode="none" selectable={false}>{kind === 'prompt' ? '·' : '▪'}</text>
        </box>
      ))}
    </>
  )
})
