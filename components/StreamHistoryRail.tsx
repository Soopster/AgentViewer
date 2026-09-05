'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { FileCode2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StreamHistoryItem = {
  key: string
  messageId: string
  index: number
  top: number
  height: number
  role: 'user' | 'assistant' | 'system'
  title: string
  detail: string
  meta: string
}

type HoveredItem = { item: StreamHistoryItem; top: number }

/** The timeline list is not the scroll container's content box: the container
 * carries vertical padding and may render a diagnostics panel, a search banner
 * or a sticky follow bar around the list. `offset` is the measured distance
 * from the container's scroll origin to the list's first row, so a row's
 * layout-space `top` can be compared with `scrollTop` and mapped onto the same
 * document the scrollbar describes. Measuring beats deriving it from the
 * padding constants — the blocks above the list appear and disappear.
 */
type RailMetrics = { offset: number; scrollHeight: number }

const EMPTY_METRICS: RailMetrics = { offset: 0, scrollHeight: 1 }

const MAX_VISIBLE_TICKS = 120
const CLICK_SELECTION_HOLD_MS = 450

function measureMetrics(node: HTMLElement, content: HTMLElement | null): RailMetrics {
  const scrollHeight = Math.max(node.scrollHeight, 1)
  if (!content) return { offset: 0, scrollHeight }
  const offset = content.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop
  return { offset, scrollHeight }
}

function sameMetrics(a: RailMetrics, b: RailMetrics): boolean {
  return Math.abs(a.offset - b.offset) < 1 && Math.abs(a.scrollHeight - b.scrollHeight) < 1
}

function sampledItems(items: StreamHistoryItem[], activeIndex: number): StreamHistoryItem[] {
  if (items.length <= MAX_VISIBLE_TICKS) return items
  const stride = Math.ceil(items.length / MAX_VISIBLE_TICKS)
  return items.filter((item) => item.role === 'user' || item.index === activeIndex || item.index % stride === 0 || item.index === items.length - 1)
}

function tickPosition(item: StreamHistoryItem, metrics: RailMetrics): number {
  const center = metrics.offset + item.top + item.height / 2
  return Math.max(0, Math.min(center / metrics.scrollHeight, 1))
}

function focusedItemIndex(items: StreamHistoryItem[], scrollTop: number, viewportHeight: number, scrollHeight: number, anchorOffset: number, offset: number): number {
  if (items.length === 0) return -1

  // Transcript jumps place the selected row at this same inset, so away from
  // the ends the reading line is fixed there: a click cannot immediately
  // activate the next short row on a tall viewport.
  const anchor = Math.min(anchorOffset, viewportHeight / 2)
  const maxScrollTop = Math.max(scrollHeight - viewportHeight, 0)

  // Over the last screenful the anchor ramps down to the foot of the viewport.
  // scrollTop is clamped there, so every remaining row shares one scroll
  // position and no row past the anchor could ever be reached — the rail used
  // to give up and snap to the final message the moment the container hit
  // bottom, marking the end of the transcript while the reader was still on a
  // message a screen above it. Sliding the line instead keeps the marker on
  // the row actually being read, and still lands on the last one at the foot.
  const span = Math.min(Math.max(viewportHeight - anchor, 0), maxScrollTop)
  const remaining = Math.max(0, Math.min(maxScrollTop - scrollTop, span))
  const focusY = scrollTop + anchor + (span - remaining) - offset
  let low = 0
  let high = items.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (items[mid].top <= focusY) low = mid + 1
    else high = mid
  }
  let index = Math.max(0, low - 1)
  while (index < items.length - 1 && items[index].top + items[index].height <= focusY) index += 1
  return index
}

const StreamHistoryRail = memo(function StreamHistoryRail({ items, scrollRef, contentRef, anchorOffset, onSelect }: {
  items: StreamHistoryItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  anchorOffset: number
  onSelect: (messageId: string) => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const itemsRef = useRef(items)
  const anchorOffsetRef = useRef(anchorOffset)
  const metricsRef = useRef<RailMetrics>(EMPTY_METRICS)
  const selectionHoldRef = useRef<number | null>(null)
  const selectionTimerRef = useRef<number | null>(null)
  const [hovered, setHovered] = useState<HoveredItem | null>(null)
  const [metrics, setMetrics] = useState<RailMetrics>(EMPTY_METRICS)
  const [activeIndex, setActiveIndex] = useState(0)
  const visibleItems = useMemo(() => sampledItems(items, activeIndex), [activeIndex, items])

  useEffect(() => {
    itemsRef.current = items
    anchorOffsetRef.current = anchorOffset
  }, [anchorOffset, items])

  // Re-measures the document mapping, then resolves the reading position
  // against it. The mapping is refreshed even while a click selection is held,
  // so a layout change during the hold cannot leave the ticks placed against a
  // scroll height that no longer exists.
  const sync = useCallback((respectHold: boolean) => {
    const node = scrollRef.current
    if (!node) return
    const next = measureMetrics(node, contentRef.current)
    if (!sameMetrics(metricsRef.current, next)) {
      metricsRef.current = next
      setMetrics(next)
    }
    if (respectHold && selectionHoldRef.current != null) return
    const currentItems = itemsRef.current
    const focused = focusedItemIndex(currentItems, node.scrollTop, node.clientHeight, node.scrollHeight, anchorOffsetRef.current, metricsRef.current.offset)
    const nextItemIndex = currentItems[focused]?.index ?? -1
    setActiveIndex((current) => current === nextItemIndex ? current : nextItemIndex)
  }, [contentRef, scrollRef])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    let frame: number | null = null
    const update = () => {
      frame = null
      sync(true)
    }
    const schedule = () => {
      if (frame == null) frame = window.requestAnimationFrame(update)
    }
    update()
    node.addEventListener('scroll', schedule, { passive: true })
    const releaseSelection = () => {
      selectionHoldRef.current = null
      if (selectionTimerRef.current != null) {
        window.clearTimeout(selectionTimerRef.current)
        selectionTimerRef.current = null
      }
      schedule()
    }
    node.addEventListener('wheel', releaseSelection, { passive: true })
    node.addEventListener('pointerdown', releaseSelection, { passive: true })
    node.addEventListener('touchstart', releaseSelection, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(node)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => {
      node.removeEventListener('scroll', schedule)
      node.removeEventListener('wheel', releaseSelection)
      node.removeEventListener('pointerdown', releaseSelection)
      node.removeEventListener('touchstart', releaseSelection)
      observer.disconnect()
      if (frame != null) window.cancelAnimationFrame(frame)
      if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current)
      selectionHoldRef.current = null
    }
  }, [contentRef, scrollRef, sync])

  // Row heights settle after measurement, which moves every tick below them.
  useEffect(() => { sync(true) }, [anchorOffset, items, sync])

  const selectItem = (item: StreamHistoryItem) => {
    selectionHoldRef.current = item.index
    setActiveIndex(item.index)
    setHovered(null)
    onSelect(item.messageId)
    if (selectionTimerRef.current != null) window.clearTimeout(selectionTimerRef.current)
    selectionTimerRef.current = window.setTimeout(() => {
      selectionHoldRef.current = null
      selectionTimerRef.current = null
      const node = scrollRef.current
      if (!node) return
      const currentItems = itemsRef.current
      const nextMetrics = measureMetrics(node, contentRef.current)
      if (!sameMetrics(metricsRef.current, nextMetrics)) {
        metricsRef.current = nextMetrics
        setMetrics(nextMetrics)
      }
      const next = focusedItemIndex(currentItems, node.scrollTop, node.clientHeight, node.scrollHeight, anchorOffsetRef.current, nextMetrics.offset)
      const selectedItem = currentItems.find((candidate) => candidate.index === item.index) ?? item
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 2
      const selectedTop = nextMetrics.offset + selectedItem.top
      const selectedStillVisible = selectedTop + selectedItem.height > node.scrollTop
        && selectedTop < node.scrollTop + node.clientHeight
      // Near the end of a transcript the browser cannot place every selected
      // row at the reading anchor because scrollTop is clamped. Preserve the
      // exact clicked row while it remains visible instead of always snapping
      // the marker to the final message.
      const nextItemIndex = atBottom && selectedStillVisible
        ? selectedItem.index
        : currentItems[next]?.index ?? -1
      setActiveIndex((current) => current === nextItemIndex ? current : nextItemIndex)
    }, CLICK_SELECTION_HOLD_MS)
  }

  const showPreview = (item: StreamHistoryItem, target: HTMLElement) => {
    const rootRect = rootRef.current?.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    if (!rootRect) return
    setHovered({ item, top: Math.max(106, Math.min(targetRect.top + targetRect.height / 2 - rootRect.top, rootRect.height - 106)) })
  }

  return (
    <nav ref={rootRef} className="av-stream-history" aria-label="Conversation history">
      <div className="av-stream-history-track" aria-hidden="true" />
      {visibleItems.map((item) => {
        const active = item.index === activeIndex
        return (
          <button
            key={item.key}
            type="button"
            className={cn('av-hover-control av-stream-history-tick', `av-stream-history-tick--${item.role}`, active && 'av-active')}
            style={{ top: `${tickPosition(item, metrics) * 100}%` }}
            aria-label={`${item.role}: ${item.title}`}
            aria-current={active ? 'step' : undefined}
            onClick={() => selectItem(item)}
            onPointerEnter={(event) => showPreview(item, event.currentTarget)}
            onPointerLeave={() => setHovered(null)}
            onFocus={(event) => showPreview(item, event.currentTarget)}
            onBlur={() => setHovered(null)}
          />
        )
      })}
      {hovered ? (
        <div className="av-stream-history-preview" style={{ top: hovered.top }}>
          <div className="av-stream-history-preview-title">{hovered.item.title}</div>
          {hovered.item.detail ? <div className="av-stream-history-preview-detail">{hovered.item.detail}</div> : null}
          <div className="av-stream-history-preview-meta">
            <FileCode2 aria-hidden="true" />
            <span>{hovered.item.meta}</span>
          </div>
        </div>
      ) : null}
    </nav>
  )
})

export default StreamHistoryRail
