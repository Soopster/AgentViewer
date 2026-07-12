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

function sampledItems(items: StreamHistoryItem[], activeIndex: number): StreamHistoryItem[] {
  if (items.length <= MAX_VISIBLE_TICKS) return items
  const stride = Math.ceil(items.length / MAX_VISIBLE_TICKS)
  return items.filter((item) => item.role === 'user' || item.index === activeIndex || item.index % stride === 0 || item.index === items.length - 1)
}

function focusedItemIndex(items: StreamHistoryItem[], scrollTop: number, viewportHeight: number, scrollHeight: number): number {
  if (items.length === 0) return -1
  if (scrollTop + viewportHeight >= scrollHeight - 2) return items.length - 1

  // A stable reading line near the upper third matches where people naturally
  // track the start of a turn, while still handling very short viewports.
  const focusY = scrollTop + Math.max(72, Math.min(viewportHeight * 0.3, 240))
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

const StreamHistoryRail = memo(function StreamHistoryRail({ items, scrollRef, onSelect }: {
  items: StreamHistoryItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  onSelect: (messageId: string) => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const [hovered, setHovered] = useState<HoveredItem | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const visibleItems = useMemo(() => sampledItems(items, activeIndex), [activeIndex, items])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    let frame: number | null = null
    const update = () => {
      frame = null
      const next = focusedItemIndex(items, node.scrollTop, node.clientHeight, node.scrollHeight)
      setActiveIndex((current) => current === next ? current : next)
    }
    const schedule = () => {
      if (frame == null) frame = window.requestAnimationFrame(update)
    }
    update()
    node.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(node)
    return () => {
      node.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame != null) window.cancelAnimationFrame(frame)
    }
  }, [items, scrollRef])

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
            onClick={() => onSelect(item.messageId)}
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
