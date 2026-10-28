/** @jsxImportSource @opentui/react */
import type { SpacesState } from '../../spacesStore'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React, { useCallback, useMemo } from 'react'
import { type SelectedLineRange } from '@pierre/diffs'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { formatProviderLabel, type TuiTranscriptCard } from '../../../format'
import { getProviderAccent, type TuiThemeMode } from '../../../theme'
import { type TuiSessionDetail, type TuiProviderInstanceChoice } from '../../../../lib/tui/service'
import { type ContextUsage, type ProviderSelection, type RunningSessionRef, type Session } from '../../../../lib/types'
import { fitText, joinMeta } from '../../textLayout'
import { coordinatorSidebarHeaderText } from '../../CoordinatorSidebar'
import { type CoordinatorPickerFilter } from '../../../../lib/coordinatorSignals'
import { type PendingInboxEdit } from '../types'
import { type TranscriptDiffNoteDraft, type TranscriptDiffNote } from '../transcriptDiffSelection'
import { type TranscriptDiffControls } from '../SplitTranscriptPane'
import { runRefreshSessionMetadata, runRefreshSessions } from '../actions/sessionData'

export type UseActiveStripIndexGroupContext = {
  shownPopoverTab: string | null
  visibleTabSessions: Session[]
  popoverTabs: string[]
  activeTabIndex: number
  mainContentHeight: number
  effectiveSurfacePanelRows: number
  composerStatusBlockHeight: number
  composerPopoverHeight: number
  embeddedComposer: boolean
  composerDockHeight: number
  fullscreenMode: boolean
  rightSidePanelVisible: boolean
  workspacesEnabled: boolean
  spacesState: SpacesState
  sidebarWidth: number
  provider: ProviderSelection
  sessions: Session[]
  normalizedSessionQuery: string
  scratchFilter: { sessions: Session[]; hidden: number; }
  settledFilter: { sessions: Session[]; hidden: number; }
  filteredSessionsForSidebar: Session[]
  spaceSessions: Session[]
  providerInstances: TuiProviderInstanceChoice[]
  providerInstanceId: string | null
  sidebarSortLabel: 'PROJECT' | 'TIME'
  sessionSearchQuery: string
  coordinatorHeaderCounts: string
  themeMode: TuiThemeMode
  transcriptDiffNotes: Map<string, TranscriptDiffNote>
  transcriptDiffDraft: TranscriptDiffNoteDraft | null
  hoveredTranscriptDiffAnchor: string | null
  activateTranscriptDiffHover: (anchor: string, position?: { namespace: string; scrollTop: number | null; }) => void
  openScopedTranscriptDiffNote: (namespace: string, selection: SelectedLineRange, cardKey?: string) => void
  sendScopedTranscriptDiffNote: (namespace: string, card: TuiTranscriptCard, note: TranscriptDiffNote, label: string, diffText: string | null) => void
  transcriptDiffPlainCardKeys: Set<string>
  transcriptDiffHiddenLineNumberCardKeys: Set<string>
  transcriptDiffHiddenHunkHeaderCardKeys: Set<string>
  transcriptDiffRowCursorByCardKey: Record<string, number>
  transcriptDiffSelectionAnchorByCardKey: Record<string, number>
  setTranscriptDiffRowCursorForCard: (cardKey: string, rowIndex: number, preserveSelection?: boolean) => void
  setTranscriptDiffSelectionAnchorForCard: (cardKey: string, rowIndex: number) => void
  setAgentToolCursorByGroupKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  sessionRequestRef: React.RefObject<number>
  setLoadingSessions: React.Dispatch<React.SetStateAction<boolean>>
  setRefreshingSessions: React.Dispatch<React.SetStateAction<boolean>>
  providerSwitchRef: React.RefObject<boolean>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  providerInstanceIdRef: React.RefObject<string | null>
  pendingInboxEditsRef: React.RefObject<Map<string, PendingInboxEdit>>
  selectedSessionKeyRef: React.RefObject<string | null>
  sessionsRef: React.RefObject<Session[]>
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  openTabSessionsRef: React.RefObject<Session[]>
  setRunningSessions: React.Dispatch<React.SetStateAction<RunningSessionRef[]>>
  runningSessionsRef: React.RefObject<RunningSessionRef[]>
  tabsEnabledRef: React.RefObject<boolean>
  composerTargetSessionRef: React.RefObject<Session | null>
  sessionContextUsageCacheRef: React.RefObject<Map<string, ContextUsage | null>>
  sessionMetadataFetchedAtRef: React.RefObject<Map<string, number>>
  sessionDetailCacheRef: React.RefObject<TranscriptDetailCache>
  sessionMetadataInFlightRef: React.RefObject<Set<string>>
  setContextUsageStatus: React.Dispatch<React.SetStateAction<'idle' | 'loading' | 'unavailable' | 'ready'>>
  setTuiReportedModelByKey: React.Dispatch<React.SetStateAction<Record<string, string | null>>>
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage | null>>
  setSessionDetail: React.Dispatch<React.SetStateAction<TuiSessionDetail | null>>
}

export function useActiveStripIndexGroup(ctx: UseActiveStripIndexGroupContext) {
  const {
    shownPopoverTab, visibleTabSessions, popoverTabs, activeTabIndex, mainContentHeight,
    effectiveSurfacePanelRows, composerStatusBlockHeight, composerPopoverHeight, embeddedComposer,
    composerDockHeight, fullscreenMode, rightSidePanelVisible, workspacesEnabled, spacesState,
    sidebarWidth, provider, sessions, normalizedSessionQuery, scratchFilter, settledFilter,
    filteredSessionsForSidebar, spaceSessions, providerInstances, providerInstanceId,
    sidebarSortLabel, sessionSearchQuery, coordinatorHeaderCounts, themeMode, transcriptDiffNotes,
    transcriptDiffDraft, hoveredTranscriptDiffAnchor, activateTranscriptDiffHover,
    openScopedTranscriptDiffNote, sendScopedTranscriptDiffNote, transcriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, transcriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, transcriptDiffSelectionAnchorByCardKey,
    setTranscriptDiffRowCursorForCard, setTranscriptDiffSelectionAnchorForCard,
    setAgentToolCursorByGroupKey, sessionRequestRef, setLoadingSessions, setRefreshingSessions,
    providerSwitchRef, setError, providerInstanceIdRef, pendingInboxEditsRef,
    selectedSessionKeyRef, sessionsRef, setSessions, setSelectedSessionKey, openTabSessionsRef,
    setRunningSessions, runningSessionsRef, tabsEnabledRef, composerTargetSessionRef,
    sessionContextUsageCacheRef, sessionMetadataFetchedAtRef, sessionDetailCacheRef,
    sessionMetadataInFlightRef, setContextUsageStatus, setTuiReportedModelByKey, setContextUsage,
    setSessionDetail,
  } = ctx

  // Index in the strip: session tabs, then popover tabs.
  const activeStripIndex = shownPopoverTab ? visibleTabSessions.length + popoverTabs.indexOf(shownPopoverTab) : activeTabIndex
  const tabStripLength = visibleTabSessions.length + popoverTabs.length

  // The right-hand panels share the full vertical column with the reader and
  // composer. Add back the rows the main content budget reserves for the
  // status block, composer popovers, and dock so the panel stays beside the
  // composer instead of leaving a blank block below itself.
  const surfacePanelHeight = Math.max(
    8,
    mainContentHeight + effectiveSurfacePanelRows + composerStatusBlockHeight + composerPopoverHeight
      + (embeddedComposer ? 0 : composerDockHeight) + (fullscreenMode ? 0 : 2),
  )

  // With a right-hand panel open the composer docks under the reader column
  // only, so the rail runs down beside it like the panel does — otherwise the
  // dock's rows under the rail are left empty.
  // A panel docked under the reader leaves the rail running down beside it too.
  const sidebarExtraRows = rightSidePanelVisible ? Math.max(surfacePanelHeight - mainContentHeight, 0) : effectiveSurfacePanelRows
  // Extended, the rail outgrows its row, so nothing clips the list to the
  // frame any more: budget the list to the frame's inside.
  const sidebarRowBudget = Math.max((sidebarExtraRows > 0 ? mainContentHeight + sidebarExtraRows - 2 : mainContentHeight) - (workspacesEnabled ? Math.min(4, spacesState.spaces.length) + 3 : 0), 4)
  const sidebarInnerWidth = Math.max(sidebarWidth - 5, 17)
  // A provider listed across several instances (ACP agents, accounts) is
  // several stores' sessions, and a row has to say whose it is.
  const showProviderInSessionRows = provider === 'all'
    || new Set(sessions.map((session) => session.providerInstanceId ?? session.provider)).size > 1
  const sidebarSessionCountLabel = normalizedSessionQuery || scratchFilter.hidden > 0 || settledFilter.hidden > 0
    ? `SESSIONS ${filteredSessionsForSidebar.length}/${spaceSessions.length}`
    : `SESSIONS ${spaceSessions.length}`
  const sidebarProviderLabel = provider === 'all'
    ? 'ALL'
    : providerInstances.find((instance) => instance.providerInstanceId === providerInstanceId)?.label.toUpperCase() ?? formatProviderLabel(provider)
  const sidebarHeaderWidth = Math.max(sidebarInnerWidth, 12)
  const sidebarProviderBadgeText = ` ${fitText(sidebarProviderLabel, Math.max(sidebarHeaderWidth - 11, 3)).trimEnd()} `
  const sidebarHeaderPrefix = `${sidebarSessionCountLabel} · `
  const sidebarHeaderPrefixWidth = Math.min(
    sidebarHeaderPrefix.length,
    Math.max(sidebarHeaderWidth - sidebarProviderBadgeText.length - 1, 8),
  )
  const sidebarHeaderSuffix = ` · ${joinMeta([
    `sort ${sidebarSortLabel}`,
    scratchFilter.hidden > 0 ? `${scratchFilter.hidden} scratch hidden` : null,
    settledFilter.hidden > 0 ? `${settledFilter.hidden} settled` : null,
    normalizedSessionQuery ? `/${sessionSearchQuery}` : '/ search',
    'a agents',
  ])}`
  const sidebarHeaderSuffixWidth = Math.max(
    sidebarHeaderWidth - sidebarHeaderPrefixWidth - sidebarProviderBadgeText.length,
    0,
  )
  const sidebarHeaderBaseText = `${fitText(sidebarHeaderPrefix, sidebarHeaderPrefixWidth)}${sidebarProviderBadgeText}${
    sidebarHeaderSuffixWidth >= sidebarHeaderSuffix.length ? sidebarHeaderSuffix : ''
  }`
  const sidebarProviderAccent = getProviderAccent(provider)
  const coordinatorSidebarHeader = useMemo(
    () => {
      const [agents, runs, filter, blocked, done, total] = coordinatorHeaderCounts.split('/')
      return fitText(
        coordinatorSidebarHeaderText(Number(agents) || 0, Number(runs) || 0, filter as CoordinatorPickerFilter, {
          blocked: Number(blocked) || 0,
          done: Number(done) || 0,
          total: Number(total) || 0,
        }),
        Math.max(sidebarInnerWidth - 2, 12),
      )
    },
    [sidebarInnerWidth, coordinatorHeaderCounts],
  )
  const imessageStyle = themeMode === 'imessage'
  const transcriptDiffControls = useMemo<TranscriptDiffControls>(() => ({
    diffNotes: transcriptDiffNotes, diffDraft: transcriptDiffDraft, hoveredDiffAnchor: hoveredTranscriptDiffAnchor,
    activateDiffHover: activateTranscriptDiffHover, openDiffNote: openScopedTranscriptDiffNote,
    sendDiffNoteToComposer: sendScopedTranscriptDiffNote,
    diffPlainCardKeys: transcriptDiffPlainCardKeys, diffHiddenLineNumberCardKeys: transcriptDiffHiddenLineNumberCardKeys,
    diffHiddenHunkHeaderCardKeys: transcriptDiffHiddenHunkHeaderCardKeys, diffRowCursorByCardKey: transcriptDiffRowCursorByCardKey,
    diffSelectionAnchorByCardKey: transcriptDiffSelectionAnchorByCardKey,
    setDiffRowCursor: setTranscriptDiffRowCursorForCard, setDiffSelectionAnchor: setTranscriptDiffSelectionAnchorForCard,
  }), [transcriptDiffNotes, transcriptDiffDraft, hoveredTranscriptDiffAnchor, activateTranscriptDiffHover,
    openScopedTranscriptDiffNote, sendScopedTranscriptDiffNote, transcriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, transcriptDiffHiddenHunkHeaderCardKeys, transcriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffRowCursorForCard, setTranscriptDiffSelectionAnchorForCard])
  const selectAgentTool = useCallback((groupKey: string, toolKey: string) => {
    setAgentToolCursorByGroupKey((current) => current[groupKey] === toolKey ? current : { ...current, [groupKey]: toolKey })
  }, [])
  const refreshSessions = useCallback(async (nextProvider: ProviderSelection, preserveSelection = true, foreground = true) => runRefreshSessions({
    sessionRequestRef, setLoadingSessions, setRefreshingSessions, providerSwitchRef, setError,
    providerInstanceIdRef, pendingInboxEditsRef, selectedSessionKeyRef, sessionsRef, setSessions,
    setSelectedSessionKey, openTabSessionsRef,
  }, nextProvider, preserveSelection, foreground), [])

  const markSessionRunning = useCallback((ref: RunningSessionRef) => {
    setRunningSessions((prev) => {
      if (prev.some((entry) => entry.sessionId === ref.sessionId && entry.provider === ref.provider)) return prev
      return [...prev, ref]
    })
  }, [])

  const clearSessionRunning = useCallback((ref: RunningSessionRef) => {
    setRunningSessions((prev) => {
      const next = prev.filter((entry) => !(entry.sessionId === ref.sessionId && entry.provider === ref.provider))
      return next.length === prev.length ? prev : next
    })
  }, [])

  const refreshSessionMetadata = useCallback((session: Session, foreground = false, detailSnapshot?: TuiSessionDetail, cachedDetailSnapshot?: TuiSessionDetail | null, includeContextUsage = true) => runRefreshSessionMetadata({
    selectedSessionKeyRef, runningSessionsRef, tabsEnabledRef, openTabSessionsRef,
    composerTargetSessionRef, sessionContextUsageCacheRef, sessionMetadataFetchedAtRef,
    sessionDetailCacheRef, sessionMetadataInFlightRef, setContextUsageStatus,
    setTuiReportedModelByKey, setContextUsage, setSessionDetail,
  }, session, foreground, detailSnapshot, cachedDetailSnapshot, includeContextUsage), [])

  return {
    activeStripIndex, tabStripLength, surfacePanelHeight, sidebarExtraRows, sidebarRowBudget,
    sidebarInnerWidth, showProviderInSessionRows, sidebarProviderBadgeText,
    sidebarHeaderPrefixWidth, sidebarHeaderBaseText, sidebarProviderAccent,
    coordinatorSidebarHeader, imessageStyle, transcriptDiffControls, selectAgentTool,
    refreshSessions, markSessionRunning, clearSessionRunning, refreshSessionMetadata,
  }
}
