/** @jsxImportSource @opentui/react */
import { usePinnedTabs, usePinnedTabsRow } from '../../tabPinsStore'
import { orderTabs } from '../../tabOrder'
import { useDisabledPlugins } from '../../../../lib/plugins/useDisabledPlugins'
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
  // The Tab manager plugin keeps pinned tabs at the front.
  const pinnedTabs = usePinnedTabs()
  const tabManagerOn = !useDisabledPlugins().has('tab-manager')
  const visibleTabSessions = useMemo(() => {
    const tabs = isPreviewMode && selectedSession ? [...openTabSessions, selectedSession] : openTabSessions
    return tabManagerOn ? orderTabs(tabs, sessionKey, pinnedTabs) : tabs
  }, [isPreviewMode, openTabSessions, selectedSession, pinnedTabs, tabManagerOn])
  const showTabs = !fullscreenMode && tabsEnabled && (visibleTabSessions.length > 0 || popoverTabs.length > 0)

  const showHorizontalTabs = showTabs && verticalTabsWidth === 0
  // Pinned tabs lead visibleTabSessions; with the row option they are drawn above the strip instead of in it.
  const pinnedRowOption = usePinnedTabsRow()
  const pinnedRowCount = showHorizontalTabs && tabManagerOn && pinnedRowOption
    ? visibleTabSessions.filter((session) => pinnedTabs.has(sessionKey(session))).length
    : 0

  return {
    liveAssistantPreviewLines, liveReasoningPreviewLines, isPreviewMode, visibleTabSessions,
    showTabs, showHorizontalTabs, pinnedRowCount,
  }
}
