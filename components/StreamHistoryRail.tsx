'use client'

import { memo, useMemo, useRef, useState } from 'react'
import { FileCode2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StreamHistoryItem = {
  key: string
  messageId: string
  index: number
  position: number
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

const StreamHistoryRail = memo(function StreamHistoryRail({ items, activeIndex, onSelect }: {
  items: StreamHistoryItem[]
  activeIndex: number
  onSelect: (messageId: string) => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const [hovered, setHovered] = useState<HoveredItem | null>(null)
  const visibleItems = useMemo(() => sampledItems(items, activeIndex), [activeIndex, items])

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
