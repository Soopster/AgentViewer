'use client'
import { memo, useRef, useEffect } from 'react'
import { observeTimelineRowResize, readResizeObserverHeight } from './heightEstimate'
import { TimelineMessageRow } from './TimelineMessageRow'
import type { TimelineRow } from './types'

export const VirtualTimelineRow = memo(function VirtualTimelineRow({
  row, top, isLast, highlighted, forking, resumeTarget, bookmarked, streamMode, placeholder, placeholderHeight, onMeasure, onLastRowRef, onForkFromMessage, onToggleResume, onToggleBookmark, onReusePrompt, onQuoteMessage, onReplyMessage, onEditFromMessage,
}: {
  row: TimelineRow
  top: number
  isLast: boolean
  highlighted: boolean
  forking: boolean
  resumeTarget: boolean
  bookmarked: boolean
  streamMode: boolean
  // Fast-scroll placeholder: render a cheap skeleton at the layout height
  // instead of the full message card, and skip measurement so the skeleton
  // can't poison the measured-height cache. placeholderHeight is 0 (stable)
  // when placeholder is false.
  placeholder: boolean
  placeholderHeight: number
  onMeasure: (key: string, height: number) => void
  onLastRowRef: (node: HTMLDivElement | null) => void
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
  onToggleBookmark: (messageId: string) => void
  onReusePrompt: (text: string) => void
  onQuoteMessage: (text: string) => void
  onReplyMessage: (text: string) => void
  onEditFromMessage: (messageId: string, text: string) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (placeholder) return
    const node = rowRef.current
    if (!node) return

    onMeasure(row.key, node.getBoundingClientRect().height)

    return observeTimelineRowResize(node, (entry) => {
      onMeasure(row.key, readResizeObserverHeight(entry, node))
    })
  }, [onMeasure, placeholder, row.key])

  useEffect(() => {
    if (!isLast) return
    onLastRowRef(rowRef.current)
    return () => onLastRowRef(null)
  }, [isLast, onLastRowRef, row.key])

  return (
    <div
      className="timeline-row"
      ref={rowRef}
      data-message-id={row.message.uuid}
      data-timeline-key={row.key}
      style={{
        position: 'absolute',
        top: 0,
        transform: `translateY(${top}px)`,
        left: 0,
        right: 0,
      }}
    >
      {placeholder ? (
        // Explicit height matches the layout's height for this row exactly, so
        // swapping placeholder ↔ full card never shifts surrounding rows.
        <div style={{ height: placeholderHeight, padding: '6px 0', boxSizing: 'border-box' }}>
          <div
            style={{
              height: '100%',
              borderRadius: 8,
              border: '1px solid rgba(128,128,128,0.10)',
              background: 'rgba(128,128,128,0.05)',
            }} />
        </div>
      ) : (
        <TimelineMessageRow
          row={row}
          highlighted={highlighted}
          forking={forking}
          resumeTarget={resumeTarget}
          bookmarked={bookmarked}
          streamMode={streamMode}
          onForkFromMessage={onForkFromMessage}
          onToggleResume={onToggleResume}
          onToggleBookmark={onToggleBookmark}
          onReusePrompt={onReusePrompt}
          onQuoteMessage={onQuoteMessage}
          onReplyMessage={onReplyMessage}
          onEditFromMessage={onEditFromMessage} />
      )}
    </div>
  )
})
