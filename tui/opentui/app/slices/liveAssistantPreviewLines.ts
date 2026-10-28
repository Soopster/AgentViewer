/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import { type Session } from '../../../../lib/types'
import { wrapLivePreviewTail, LIVE_PREVIEW_BODY_LINES } from '../inlineText'
import { sessionKey } from '../sessionList'

export type UseLiveAssistantPreviewLinesGroupContext = {
  composerLiveText: string
  livePreviewContentWidth: number
  composerLiveReasoning: string
  selectedSessionKey: string | null
  laidOutWindowKeys: Set<string>
  openTabSessions: Session[]
  selectedSession: Session | null
  fullscreenMode: boolean
  tabsEnabled: boolean
  popoverTabs: string[]
  verticalTabsWidth: number
}

export function useLiveAssistantPreviewLinesGroup(ctx: UseLiveAssistantPreviewLinesGroupContext) {
  const {
    composerLiveText, livePreviewContentWidth, composerLiveReasoning, selectedSessionKey,
    laidOutWindowKeys, openTabSessions, selectedSession, fullscreenMode, tabsEnabled, popoverTabs,
    verticalTabsWidth,
  } = ctx

  const liveAssistantPreviewLines = useMemo(
    () => wrapLivePreviewTail(composerLiveText, livePreviewContentWidth, LIVE_PREVIEW_BODY_LINES),
    [composerLiveText, livePreviewContentWidth],
  )
  const liveReasoningPreviewLines = useMemo(
    () => wrapLivePreviewTail(composerLiveReasoning, livePreviewContentWidth, LIVE_PREVIEW_BODY_LINES),
    [composerLiveReasoning, livePreviewContentWidth],
  )

  const isPreviewMode = !!selectedSessionKey && laidOutWindowKeys.has(selectedSessionKey) && !openTabSessions.some((s) => sessionKey(s) === selectedSessionKey)
  const visibleTabSessions = useMemo(() => (
    isPreviewMode && selectedSession
      ? [...openTabSessions, selectedSession]
      : openTabSessions
  ), [isPreviewMode, openTabSessions, selectedSession])
  const showTabs = !fullscreenMode && tabsEnabled && (visibleTabSessions.length > 0 || popoverTabs.length > 0)

  const showHorizontalTabs = showTabs && verticalTabsWidth === 0

  return {
    liveAssistantPreviewLines, liveReasoningPreviewLines, isPreviewMode, visibleTabSessions,
    showTabs, showHorizontalTabs,
  }
}
