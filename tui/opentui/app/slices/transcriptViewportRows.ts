/** @jsxImportSource @opentui/react */
import type { TeamAttention } from '../../teamAttentionStore'
import { tabStripWidth } from '../../tabStrip'
import { useMemo } from 'react'
import { type SurfaceMeta } from '../../popoverWindows'
import { type AgentProvider, type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { runTabOptions } from '../derived/tabs'

export type UseTranscriptViewportRowsGroupContext = {
  estimatedTranscriptViewportRows: number
  selectedSessionKey: string | null
  visibleTabSessions: Session[]
  sidebarSessionActivity: Map<string, 'waiting' | 'needs-input' | 'running'>
  attentionDone: { key: string; sessionId: string; provider: AgentProvider; sessionKey: string; title: string; createdAt: number; }[]
  recentlyWrittenKeys: ReadonlySet<string>
  verticalTabsWidth: number
  readerAreaWidth: number
  popoverTabs: string[]
  splitPinnedKeys: string[]
  splitPaneCount: number
  teamAttention: TeamAttention
  coordinatorBadges: Map<string, string>
  isPreviewMode: boolean
  windowSurfaceMeta: Record<string, SurfaceMeta>
  openTabByKey: Map<string, Session>
  sessions: Session[]
}

export function useTranscriptViewportRowsGroup(ctx: UseTranscriptViewportRowsGroupContext) {
  const {
    estimatedTranscriptViewportRows, selectedSessionKey, visibleTabSessions,
    sidebarSessionActivity, attentionDone, recentlyWrittenKeys, verticalTabsWidth, readerAreaWidth,
    popoverTabs, splitPinnedKeys, splitPaneCount, teamAttention, coordinatorBadges, isPreviewMode,
    windowSurfaceMeta, openTabByKey, sessions,
  } = ctx

  // Keep the scrollbox's explicit row budget inside its actual content area.
  // Window chrome (search results, notices, composer) can use more rows than
  // the estimate, especially in a small or floating window.
  const transcriptViewportRows = estimatedTranscriptViewportRows

  const activeTabIndex = useMemo(() => {
    if (!selectedSessionKey) return -1
    return visibleTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
  }, [selectedSessionKey, visibleTabSessions])

  // Which visible tabs have a turn in flight. `running` alone: a tab that is
  // blocked on an answer is not working, and spinning at the user while it
  // waits for them is the opposite of what the spinner says.
  const runningTabKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const s of visibleTabSessions) {
      if (sidebarSessionActivity.get(sessionKey(s)) === 'running') keys.add(sessionKey(s))
    }
    return keys
  }, [visibleTabSessions, sidebarSessionActivity])

  // The sidebar's state glyphs, on the tabs: whether each open conversation is
  // waiting on you, finished unread, or being written by a CLI elsewhere. A turn
  // in flight is not here — the spinner below paints that one.
  const tabStateGlyphs = useMemo(() => {
    const doneKeys = new Set(attentionDone.map((done) => done.sessionKey))
    const glyphs = new Map<string, string>()
    for (const s of visibleTabSessions) {
      const key = sessionKey(s)
      const activity = sidebarSessionActivity.get(key)
      const glyph = activity === 'needs-input' ? '⚠'
        : activity === 'waiting' ? '◌'
        : activity === 'running' ? null
        : recentlyWrittenKeys.has(key) ? '●'
        : doneKeys.has(key) ? '✓'
        : null
      if (glyph) glyphs.set(key, glyph)
    }
    return glyphs
  }, [attentionDone, recentlyWrittenKeys, sidebarSessionActivity, visibleTabSessions])

  const tabWidth = useMemo(() => {
    if (verticalTabsWidth > 0) return verticalTabsWidth + 8
    if (visibleTabSessions.length === 0) return 16
    // Fill available width proportionally so tabs look natural at any count,
    // capped to avoid very wide tabs when only a few sessions are open.
    // The strip spans the reader area (reader box plus any split panes), so
    // tabs get the full width instead of being squeezed into the reader column.
    const available = tabStripWidth(readerAreaWidth)
    const fill = Math.floor(available / Math.max(1, visibleTabSessions.length + popoverTabs.length))
    return Math.max(10, Math.min(fill, 40))
  }, [readerAreaWidth, visibleTabSessions.length, popoverTabs.length, verticalTabsWidth])
  const tabOptions = useMemo(() => runTabOptions({
    visibleTabSessions, splitPinnedKeys, splitPaneCount, teamAttention, coordinatorBadges,
    tabStateGlyphs, isPreviewMode, selectedSessionKey, tabWidth, popoverTabs, windowSurfaceMeta,
    openTabByKey, sessions,
  }), [isPreviewMode, selectedSessionKey, visibleTabSessions, splitPinnedKeys, splitPaneCount, tabStateGlyphs, teamAttention, coordinatorBadges, tabWidth, popoverTabs, windowSurfaceMeta])

  return {
    transcriptViewportRows, activeTabIndex, runningTabKeys, tabWidth, tabOptions,
  }
}
