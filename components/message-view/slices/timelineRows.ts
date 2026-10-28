import type { SessionMessage } from '../../../lib/types'
import { useMemo } from 'react'
import { type WebViewMode } from '../../MessageItem'
import { streamMessageHasContent } from '../../messageItemShared'
import { type MessageVisualizerRow } from '../../MessageSessionVisualizer'
import { type TimelineRow, type ActiveTranscriptFilter } from '../types'
import { timelineRowMatchesTranscriptFilters, timelineRowSearchText, groupAgentsToolRows, decorateStreamTurnLandmarks, resolveTimelineTargetMessageId } from '../timelineRows'

export type UseTimelineRowsGroupContext = {
  persistedTimelineRows: TimelineRow[]
  liveTimelineRows: TimelineRow[]
  deferredTranscriptSearch: string
  maximized: boolean
  transcriptFilters: ActiveTranscriptFilter[]
  bookmarksOnly: boolean
  bookmarkIds: Set<string>
  viewMode: WebViewMode
  showLiveTimelineOverlay: boolean
  transcriptSearch: string
  showVisualizer: boolean
  targetMessageId: string | null | undefined
  messages: SessionMessage[]
}

export function useTimelineRowsGroup(ctx: UseTimelineRowsGroupContext) {
  const {
    persistedTimelineRows, liveTimelineRows, deferredTranscriptSearch, maximized,
    transcriptFilters, bookmarksOnly, bookmarkIds, viewMode, showLiveTimelineOverlay,
    transcriptSearch, showVisualizer, targetMessageId, messages,
  } = ctx

  const timelineRows = useMemo<TimelineRow[]>(() => {
    if (persistedTimelineRows.length === 0) return liveTimelineRows
    if (liveTimelineRows.length === 0) return persistedTimelineRows
    return [...persistedTimelineRows, ...liveTimelineRows]
  }, [liveTimelineRows, persistedTimelineRows])
  const normalizedTranscriptSearch = deferredTranscriptSearch.trim().toLowerCase()
  const transcriptTimelineRows = useMemo<TimelineRow[]>(() => {
    if (maximized) return timelineRows
    // Preserve referential identity with timelineRows when nothing is focused —
    // the scroll-anchor logic below relies on this equality.
    if (transcriptFilters.length === 0 && normalizedTranscriptSearch === '' && !bookmarksOnly) return timelineRows
    return timelineRows.filter((row) => {
      if (bookmarksOnly && !bookmarkIds.has(row.message.uuid)) return false
      if (!timelineRowMatchesTranscriptFilters(row, transcriptFilters)) return false
      if (!normalizedTranscriptSearch) return true
      return timelineRowSearchText(row).includes(normalizedTranscriptSearch)
    })
  }, [normalizedTranscriptSearch, timelineRows, transcriptFilters, bookmarksOnly, bookmarkIds, maximized])
  const renderedTimelineRows = useMemo<TimelineRow[]>(() => {
    if (viewMode === 'agents') return groupAgentsToolRows(transcriptTimelineRows)
    if (viewMode === 'stream') {
      // Rows whose message renders nothing in Stream view (no prose, no tool
      // calls) must be dropped, not just render null: the row wrapper's stream
      // padding and the virtual row's minimum height would otherwise paint
      // empty selectable ghost rows.
      const streamRows = decorateStreamTurnLandmarks(transcriptTimelineRows, !showLiveTimelineOverlay)
      return groupAgentsToolRows(streamRows).filter((row) => streamMessageHasContent(row.message))
    }
    return transcriptTimelineRows
  }, [showLiveTimelineOverlay, transcriptTimelineRows, viewMode])
  const hasTranscriptFocus = transcriptFilters.length > 0 || transcriptSearch.trim().length > 0 || bookmarksOnly
  const visualizerRows = useMemo<MessageVisualizerRow[]>(
    () => showVisualizer
      ? timelineRows.map((row) => ({
          key: row.key,
          message: row.message,
          dimmed: row.dimmed,
          previewBadge: row.previewBadge,
          showSession: row.showSession,
        }))
      : [],
    [showVisualizer, timelineRows],
  )
  const timelineTargetMessageId = useMemo(
    () => resolveTimelineTargetMessageId(targetMessageId, messages, timelineRows),
    [messages, targetMessageId, timelineRows],
  )
  const hasLiveTimeline = timelineRows.length > 0
  const hasTranscriptTimeline = renderedTimelineRows.length > 0

  return {
    timelineRows, renderedTimelineRows, hasTranscriptFocus, visualizerRows,
    timelineTargetMessageId, hasLiveTimeline, hasTranscriptTimeline,
  }
}
