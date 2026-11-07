/** @jsxImportSource @opentui/react */
import React, { useEffect, useMemo, useState, type RefObject } from 'react'
import type { Renderable, ScrollBoxRenderable } from '@opentui/core'
import type { TuiTranscriptCard } from '../../format'
import type { TuiThemePalette } from '../../theme'
import { cardHasEdit, cardHasError } from './cardJumpPredicates'
import { readerRowCard, readerRowKey } from './readerRows'

export type ScrollMarkerKind = 'error' | 'edit' | 'prompt'
const PRIORITY: Record<ScrollMarkerKind, number> = { prompt: 0, edit: 1, error: 2 }

/** Where each mounted card sits in the scrollbox content, as laid out. */
export type ScrollLayout = { contentHeight: number; cards: ReadonlyMap<string, { top: number; height: number }> }

/** One marker per track row, most urgent kind winning a shared row. Rows are the card's laid-out
 * midpoint over the content height, which is the scale the scrollbar's thumb uses — so a marker
 * sits where the thumb is when that card is on screen. Cards outside the mounted window have no
 * layout, and the track does not represent them either, so they get no marker. */
export function scrollMarkerTargets(cards: readonly TuiTranscriptCard[], layout: ScrollLayout | null, rows: number): Map<number, { kind: ScrollMarkerKind; key: string }> {
  const markers = new Map<number, { kind: ScrollMarkerKind; key: string }>()
  if (!layout || rows < 2 || layout.contentHeight <= 0) return markers
  for (const card of cards) {
    const placed = layout.cards.get(card.key)
    if (!placed) continue
    const kind: ScrollMarkerKind | null = cardHasError(card) ? 'error' : cardHasEdit(card) ? 'edit' : card.role === 'user' ? 'prompt' : null
    if (!kind) continue
    const row = Math.max(0, Math.min(Math.floor(((placed.top + placed.height / 2) / layout.contentHeight) * rows), rows - 1))
    const existing = markers.get(row)
    if (!existing || PRIORITY[kind] > PRIORITY[existing.kind]) markers.set(row, { kind, key: card.key })
  }
  return markers
}

export function scrollMarkerRows(cards: readonly TuiTranscriptCard[], layout: ScrollLayout | null, rows: number): Map<number, ScrollMarkerKind> {
  return new Map([...scrollMarkerTargets(cards, layout, rows)].map(([row, target]) => [row, target.kind]))
}

function measure(sb: ScrollBoxRenderable): ScrollLayout {
  const contentTop = sb.content.y
  const cards = new Map<string, { top: number; height: number }>()
  for (const child of sb.content.getChildren() as Renderable[]) {
    const key = readerRowKey(child)
    if (!key) continue
    const box = readerRowCard(child) ?? child
    cards.set(key, { top: child.y - contentTop, height: Math.max(box.height, 1) })
  }
  return { contentHeight: sb.scrollHeight, cards }
}

/** The scrollbox's card layout, re-read only when its geometry changed — a layout read per card
 * every tick is what the sticky header's poll had to stop doing. */
export function useScrollLayout(scrollRef: RefObject<ScrollBoxRenderable | null>, enabled: boolean): ScrollLayout | null {
  const [layout, setLayout] = useState<ScrollLayout | null>(null)
  useEffect(() => {
    if (!enabled) { setLayout(null); return }
    let last = ''
    const read = () => {
      const sb = scrollRef.current
      if (!sb) return
      const children = sb.content.getChildren()
      const signature = `${sb.scrollHeight}:${sb.viewport.height}:${children.length}:${children[0]?.id ?? ''}:${children[children.length - 1]?.id ?? ''}`
      if (signature === last) return
      last = signature
      setLayout(measure(sb))
    }
    read()
    const interval = setInterval(read, 250)
    return () => clearInterval(interval)
  }, [scrollRef, enabled])
  return layout
}

export const ScrollMarkers = React.memo(function ScrollMarkers({ cards, layout, rows, theme, onJump }: { cards: readonly TuiTranscriptCard[]; layout: ScrollLayout | null; rows: number; theme: TuiThemePalette; onJump?: (key: string) => void }) {
  const markers = useMemo(() => scrollMarkerTargets(cards, layout, rows), [cards, layout, rows])
  const color = { error: theme.red, edit: theme.green, prompt: theme.cyan }
  return (
    <>
      {[...markers].map(([row, { kind, key }]) => (
        <box key={row} id={`scroll-marker:${kind}:${row}`} position="absolute" top={row} right={1} width={1} height={1} zIndex={2} onMouseDown={event => { if (onJump && event.button === 0) { event.stopPropagation(); onJump(key) } }}>
          <text fg={color[kind]} wrapMode="none" selectable={false}>{kind === 'prompt' ? '·' : '▪'}</text>
        </box>
      ))}
    </>
  )
})
