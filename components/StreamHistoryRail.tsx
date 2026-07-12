'use client'

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { FileCode2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StreamHistoryItem = {
  key: string
  messageId: string
  index: number
  position: number
  top: number
  height: number
  role: 'user' | 'assistant' | 'system'
  title: string
  detail: string
  meta: string
}

type HoveredItem = { item: StreamHistoryItem; top: number }

const MAX_VISIBLE_TICKS = 120
const CLICK_SELECTION_HOLD_MS = 450

function sampledItems(items: StreamHistoryItem[], activeIndex: number): StreamHistoryItem[] {
  if (items.length <= MAX_VISIBLE_TICKS) return items
  const stride = Math.ceil(items.length / MAX_VISIBLE_TICKS)
  return items.filter((item) => item.role === 'user' || item.index === activeIndex || item.index % stride === 0 || item.index === items.length - 1)
}

function focusedItemIndex(items: StreamHistoryItem[], scrollTop: number, viewportHeight: number, scrollHeight: number, anchorOffset: number): number {
  if (items.length === 0) return -1
  if (scrollTop + viewportHeight >= scrollHeight - 2) return items.length - 1

  // Transcript jumps place the selected row at this same inset. Keeping the
  // reading line fixed prevents a click from immediately activating the next
  // short row on tall viewports.
  const focusY = scrollTop + Math.min(anchorOffset, viewportHeight / 2)
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

const StreamHistoryRail = memo(function StreamHistoryRail({ items, scrollRef, anchorOffset, onSelect }: {
  items: StreamHistoryItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  anchorOffset: number
  onSelect: (messageId: string) => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const itemsRef = useRef(items)
  const anchorOffsetRef = useRef(anchorOffset)
  const selectionHoldRef = useRef<number | null>(null)
  const selectionTimerRef = useRef<number | null>(null)
  const [hovered, setHovered] = useState<HoveredItem | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const visibleItems = useMemo(() => sampledItems(items, activeIndex), [activeIndex, items])
  itemsRef.current = items
  anchorOffsetRef.current = anchorOffset

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    let frame: number | null = null
    const update = () => {
      frame = null
      if (selectionHoldRef.current != null) return
      const currentItems = itemsRef.current
      const next = focusedItemIndex(currentItems, node.scrollTop, node.clientHeight, node.scrollHeight, anchorOffsetRef.current)
      const nextItemIndex = currentItems[next]?.index ?? -1
      setActiveIndex((current) => current === nextItemIndex ? current : nextItemIndex)
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
  }, [scrollRef])

  useEffect(() => {
    if (selectionHoldRef.current != null) return
    const node = scrollRef.current
    if (!node) return
    const next = focusedItemIndex(items, node.scrollTop, node.clientHeight, node.scrollHeight, anchorOffset)
    const nextItemIndex = items[next]?.index ?? -1
    setActiveIndex((current) => current === nextItemIndex ? current : nextItemIndex)
  }, [anchorOffset, items, scrollRef])

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
      const next = focusedItemIndex(currentItems, node.scrollTop, node.clientHeight, node.scrollHeight, anchorOffsetRef.current)
      const selectedItem = currentItems.find((candidate) => candidate.index === item.index) ?? item
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 2
      const selectedStillVisible = selectedItem.top + selectedItem.height > node.scrollTop
        && selectedItem.top < node.scrollTop + node.clientHeight
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
            className={cn('av-stream-history-tick', `av-stream-history-tick--${item.role}`, active && 'av-active')}
            style={{ top: `${item.position * 100}%` }}
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
