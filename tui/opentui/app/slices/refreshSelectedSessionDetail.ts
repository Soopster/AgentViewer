/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { MutableRefObject } from 'react'
import type { TranscriptSessionLoader } from '../../transcriptSessionLoader'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { TranscriptIndexLookup } from '../transcriptIndex'
import React, { useCallback } from 'react'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { type TuiTranscriptCard } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiDensity, type TuiThemeMode, type TuiTranscriptView } from '../../../theme'
import { readTuiProviderInstances, writeTuiTheme, writeTuiThemeFollow, type TuiSessionDetail, type TuiProviderInstanceChoice } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { sessionTranscriptUpdatedAt } from '../../sessionRefreshPolicy'
import { warmTranscriptAsync } from '../../sessionDetailWorkerClient'
import { type ContextUsage, type ProviderSelection, type RunningSessionRef, type Session } from '../../../../lib/types'
import { type SidebarEntry } from '../types'
import { VELOCITY_SCROLL_RESET_MS, VELOCITY_SCROLL_RAMP_MS, VELOCITY_SCROLL_MAX_STEP } from '../layoutConstants'
import { clamp } from '../util'
import { type ThemeMenuGroup, THEMES, isLightThemeMode, OMZ_MODES } from '../themes'
import { sessionKey, sidebarEntrySession, sidebarEntrySessionKey } from '../sessionList'
import { providerOptionIndex, providerSelectOptions } from '../pickers'
import { runRefreshSelectedSessionDetail } from '../actions/sessionData'
import { runToggleExpansion, runMoveAgentToolCursor } from '../actions/interaction'

export type UseRefreshSelectedSessionDetailGroupContext = {
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  reattachedRunningKeyRef: React.MutableRefObject<string | null>
  runningSessionsRef: React.RefObject<RunningSessionRef[]>
  loadingDetailRef: React.RefObject<boolean>
  backgroundRefreshInFlightRef: React.RefObject<Set<string>>
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  awaitingPersistedTurnRef: React.MutableRefObject<boolean>
  sessionDetailMtimeRef: React.RefObject<Map<string, number>>
  foregroundLoadInFlightRef: React.RefObject<boolean>
  pendingForegroundLoadRef: React.RefObject<Session | null>
  loader: TranscriptSessionLoader
  densityRef: React.RefObject<TuiDensity>
  showToolCallsRef: React.RefObject<boolean>
  sessionDetailCacheRef: React.RefObject<TranscriptDetailCache>
  navDetailSetAtRef: React.RefObject<{ key: string; at: number; } | null>
  setSessionDetail: React.Dispatch<React.SetStateAction<TuiSessionDetail | null>>
  setLoadingDetail: React.Dispatch<React.SetStateAction<boolean>>
  selectedSessionKeyRef: React.RefObject<string | null>
  setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage | null>>
  setContextUsageStatus: React.Dispatch<React.SetStateAction<'idle' | 'loading' | 'unavailable' | 'ready'>>
  refreshSessionMetadata: (session: Session, foreground?: boolean, detailSnapshot?: TuiSessionDetail, cachedDetailSnapshot?: TuiSessionDetail | null, includeContextUsage?: boolean) => void
  setError: React.Dispatch<React.SetStateAction<string | null>>
  detailRequestRef: React.RefObject<number>
  openTabSessionsRef: React.RefObject<Session[]>
  sessionContextUsageCacheRef: React.RefObject<Map<string, ContextUsage | null>>
  sessionMetadataFetchedAtRef: React.RefObject<Map<string, number>>
  pendingLiveTextRef: React.MutableRefObject<string>
  liveTranscriptMessagesRef: React.RefObject<ThreadedMessage[]>
  ownsComposerStream: (key: string) => boolean
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  liveToolIndexesRef: React.MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: React.MutableRefObject<Map<number, string>>
  setComposerLiveText: React.Dispatch<React.SetStateAction<string>>
  setAwaitingPersistedTurn: React.Dispatch<React.SetStateAction<boolean>>
  sessionDetailRef: React.RefObject<TuiSessionDetail | null>
  visibleTranscriptCards: TuiTranscriptCard[]
  jumpToTranscriptIndex: (index: number) => void
  setFollowTail: React.Dispatch<React.SetStateAction<boolean>>
  setPendingNewCount: React.Dispatch<React.SetStateAction<number>>
  setUnreadBoundaryKey: React.Dispatch<React.SetStateAction<string | null>>
  unreadBoundaryIndex: number
  resumeMarkerKey: string | null
  transcriptIndexByKey: TranscriptIndexLookup
  setSidebarSubagentCursor: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setComposerPaneTargetKey: React.Dispatch<React.SetStateAction<string | null>>
  sidebarEntries: SidebarEntry[]
  sidebarSubagentCursor: string | null
  selectedSession: Session | null
  readCursorIndex: () => number
  setTranscriptCursorKey: (action: string | null | ((previous: string | null) => string | null)) => void
  groupedToolView: boolean
  resolvedExpandedKeys: Set<string>
  agentToolCursorByGroupKey: Record<string, string>
  setAgentToolCursorByGroupKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  velocityScrollEnabled: boolean
  velocityScrollStateRef: React.RefObject<{ direction: -1 | 1; streakStart: number; lastEventTime: number; } | null>
  height: number
  focusMode: boolean
  searchMatches: number[]
  searchMatchIndex: number
  setSearchMatchIndex: React.Dispatch<React.SetStateAction<number>>
  transcriptView: TuiTranscriptView
  isChatLikeView: boolean
  expandedCardKeys: Set<string>
  collapsedCardKeys: Set<string>
  setCollapsedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setExpandedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setProviderMenuIndex: React.Dispatch<React.SetStateAction<number>>
  providerInstances: TuiProviderInstanceChoice[]
  provider: ProviderSelection
  providerInstanceId: string | null
  setProviderMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  setProviderInstances: React.Dispatch<React.SetStateAction<TuiProviderInstanceChoice[]>>
  themeMenuOriginRef: React.RefObject<TuiThemeMode | null>
  themeMode: TuiThemeMode
  setThemeMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setThemeMenuGroup: React.Dispatch<React.SetStateAction<ThemeMenuGroup>>
  setThemeMenuQuery: React.Dispatch<React.SetStateAction<string>>
  setThemeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  setThemeMode: React.Dispatch<React.SetStateAction<TuiThemeMode>>
  themeSlotsRef: React.RefObject<{ light: TuiThemeMode; dark: TuiThemeMode; }>
  themeFollowsTerminalRef: React.RefObject<boolean>
  setThemeFollowsTerminal: React.Dispatch<React.SetStateAction<boolean>>
}

export function useRefreshSelectedSessionDetailGroup(ctx: UseRefreshSelectedSessionDetailGroupContext) {
  const {
    sessionsByKeyRef, reattachedRunningKeyRef, runningSessionsRef, loadingDetailRef,
    backgroundRefreshInFlightRef, liveTranscriptBaselineRef, awaitingPersistedTurnRef,
    sessionDetailMtimeRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, loader, densityRef,
    showToolCallsRef, sessionDetailCacheRef, navDetailSetAtRef, setSessionDetail, setLoadingDetail,
    selectedSessionKeyRef, setContextUsage, setContextUsageStatus, refreshSessionMetadata,
    setError, detailRequestRef, openTabSessionsRef, sessionContextUsageCacheRef,
    sessionMetadataFetchedAtRef, pendingLiveTextRef, liveTranscriptMessagesRef, ownsComposerStream,
    setLiveTranscriptMessages, liveToolIndexesRef, liveToolInputJsonRef, setComposerLiveText,
    setAwaitingPersistedTurn, sessionDetailRef, visibleTranscriptCards, jumpToTranscriptIndex,
    setFollowTail, setPendingNewCount, setUnreadBoundaryKey, unreadBoundaryIndex, resumeMarkerKey,
    transcriptIndexByKey, setSidebarSubagentCursor, setSelectedSessionKey,
    setComposerPaneTargetKey, sidebarEntries, sidebarSubagentCursor, selectedSession,
    readCursorIndex, setTranscriptCursorKey, groupedToolView, resolvedExpandedKeys,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, velocityScrollEnabled,
    velocityScrollStateRef, height, focusMode, searchMatches, searchMatchIndex,
    setSearchMatchIndex, transcriptView, isChatLikeView, expandedCardKeys, collapsedCardKeys,
    setCollapsedCardKeys, setExpandedCardKeys, setProviderMenuIndex, providerInstances, provider,
    providerInstanceId, setProviderMenuOpen, setProviderInstances, themeMenuOriginRef, themeMode,
    setThemeMenuIndex, setThemeMenuGroup, setThemeMenuQuery, setThemeMenuOpen, setThemeMode,
    themeSlotsRef, themeFollowsTerminalRef, setThemeFollowsTerminal,
  } = ctx

  const refreshSelectedSessionDetail = useCallback(async (session: Session, foreground = true) => runRefreshSelectedSessionDetail({
    sessionsByKeyRef, reattachedRunningKeyRef, runningSessionsRef, loadingDetailRef,
    backgroundRefreshInFlightRef, liveTranscriptBaselineRef, awaitingPersistedTurnRef,
    sessionDetailMtimeRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, loader, densityRef,
    showToolCallsRef, sessionDetailCacheRef, navDetailSetAtRef, setSessionDetail, setLoadingDetail,
    selectedSessionKeyRef, setContextUsage, setContextUsageStatus, refreshSessionMetadata,
    setError, refreshSelectedSessionDetail, detailRequestRef, openTabSessionsRef,
    sessionContextUsageCacheRef, sessionMetadataFetchedAtRef, pendingLiveTextRef,
    liveTranscriptMessagesRef, ownsComposerStream, setLiveTranscriptMessages, liveToolIndexesRef,
    liveToolInputJsonRef, setComposerLiveText, setAwaitingPersistedTurn, sessionDetailRef,
  }, session, foreground), [refreshSessionMetadata, loader])

  // Worker-only warm for a sidebar neighbour. Never touches display state,
  // detailRequestRef, or loading/error flags — and, critically, never asks for
  // the transcript back. The threading worker reads, threads and formats the
  // session into its own caches; the payload stays there.
  //
  // Returning the transcript (as this used to) made a prefetch round several
  // times more expensive *in the worker*, which is the resource a real open
  // needs: delivering 8 first-visit sessions costs ~311ms of worker time
  // against ~47ms to warm the same eight. Since the worker is serial, every
  // one of those milliseconds is time a genuine open can spend queued behind a
  // prefetch — and the App cache the payload filled only ever paid off if the
  // user actually visited that neighbour.
  const prefetchSessionDetail = useCallback(async (session: Session): Promise<void> => {
    const key = sessionKey(session)
    if (backgroundRefreshInFlightRef.current.has(key)) return
    if (liveTranscriptBaselineRef.current.has(key)) return
    // Already displayable from the App's own cache and known fresh — the open
    // takes the cached fast path, so there is nothing for the worker to warm.
    const lastModified = sessionTranscriptUpdatedAt(session, sessionsByKeyRef.current.get(key))
    if (sessionDetailCacheRef.current.has(key) && typeof lastModified === 'number') {
      const recorded = sessionDetailMtimeRef.current.get(key)
      if (recorded != null && recorded >= lastModified) return
    }
    backgroundRefreshInFlightRef.current.add(key)
    try {
      await warmTranscriptAsync(session, densityRef.current, showToolCallsRef.current)
    } catch {
      // Best-effort: a failed warm just means the eventual open pays the
      // normal read (which surfaces its own error if it also fails).
    } finally {
      backgroundRefreshInFlightRef.current.delete(key)
    }
  }, [])

  const jumpToTranscriptTail = useStableEvent(() => {
    if (visibleTranscriptCards.length === 0) return
    const lastIndex = visibleTranscriptCards.length - 1
    jumpToTranscriptIndex(lastIndex)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  })

  const jumpToUnreadBoundary = useStableEvent(() => {
    if (unreadBoundaryIndex >= 0) {
      jumpToTranscriptIndex(unreadBoundaryIndex)
      return
    }
    jumpToTranscriptTail()
  })

  const jumpToResumeMarker = useStableEvent(() => {
    const index = resumeMarkerKey ? (transcriptIndexByKey.get(resumeMarkerKey) ?? -1) : -1
    if (index >= 0) jumpToTranscriptIndex(index)
  })

  const focusSidebarEntry = useStableEvent((entry: SidebarEntry | undefined) => {
    if (!entry) return
    if (entry.type === 'subagent' && entry.entry.kind === 'summary') setSidebarSubagentCursor(entry.key)
    else {
      setSidebarSubagentCursor(null)
      const session = sidebarEntrySession(entry)
      if (session) { const key = sessionKey(session); setSelectedSessionKey(key); setComposerPaneTargetKey(key) }
    }
    setError(null)
  })
  const moveSelection = useStableEvent((delta: number) => {
    const rows = sidebarEntries.filter(entry => entry.type === 'session' || entry.type === 'subagent')
    if (!rows.length) return
    const current = sidebarSubagentCursor ?? (selectedSession ? sessionKey(selectedSession) : null)
    const at = rows.findIndex(entry => sidebarEntrySessionKey(entry) === current)
    const next = rows[clamp((at >= 0 ? at : 0) + delta, 0, rows.length - 1)]!
    focusSidebarEntry(next)
  })

  const moveCursor = useStableEvent((delta: number) => {
    if (visibleTranscriptCards.length === 0) return
    const cursorIndex = readCursorIndex()
    const nextIndex = clamp((cursorIndex >= 0 ? cursorIndex : 0) + delta, 0, visibleTranscriptCards.length - 1)
    setTranscriptCursorKey(visibleTranscriptCards[nextIndex].key)
    const atTail = nextIndex === visibleTranscriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  })


  const moveAgentToolCursor = useStableEvent((delta: -1 | 1) => runMoveAgentToolCursor({
    groupedToolView, readCursorIndex, visibleTranscriptCards, resolvedExpandedKeys,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey,
  }, delta))

  // Returns the number of cards to move for one j/k/↑/↓ tick. With velocity
  // scroll off (or on a fresh tap) this is just 1; while the same direction
  // keeps repeating, the step eases from 1 up to VELOCITY_SCROLL_MAX_STEP over
  // VELOCITY_SCROLL_RAMP_MS — a quadratic ease-in so the ramp feels gradual
  // rather than snapping straight to top speed.
  const velocityScrollStep = useStableEvent((direction: -1 | 1): number => {
    if (!velocityScrollEnabled) return 1
    const now = performance.now()
    const state = velocityScrollStateRef.current
    if (!state || state.direction !== direction || now - state.lastEventTime > VELOCITY_SCROLL_RESET_MS) {
      velocityScrollStateRef.current = { direction, streakStart: now, lastEventTime: now }
      return 1
    }
    state.lastEventTime = now
    const t = clamp((now - state.streakStart) / VELOCITY_SCROLL_RAMP_MS, 0, 1)
    const eased = t * t
    return Math.max(1, Math.round(1 + (VELOCITY_SCROLL_MAX_STEP - 1) * eased))
  })

  const moveViewport = useStableEvent((direction: -1 | 1) => {
    const step = Math.max(Math.floor((height - (focusMode ? 5 : 7)) / 3), 1)
    moveCursor(direction * step)
  })

  const jumpToMatchingCard = useStableEvent((direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => {
    if (visibleTranscriptCards.length === 0) return
    const cursorIndex = readCursorIndex()
    let index = cursorIndex >= 0 ? cursorIndex + direction : direction > 0 ? 0 : visibleTranscriptCards.length - 1
    while (index >= 0 && index < visibleTranscriptCards.length) {
      if (predicate(visibleTranscriptCards[index])) {
        jumpToTranscriptIndex(index)
        return
      }
      index += direction
    }
  })

  const jumpToSearchMatch = useStableEvent((matchOffset: number) => {
    if (searchMatches.length === 0) return
    const nextMatchIndex = (searchMatchIndex + matchOffset + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(nextMatchIndex)
    jumpToTranscriptIndex(searchMatches[nextMatchIndex] ?? 0)
  })

  const toggleExpansion = useStableEvent((scope: 'selected' | 'parent' = 'selected') => runToggleExpansion({
    readCursorIndex, visibleTranscriptCards, groupedToolView, resolvedExpandedKeys,
    agentToolCursorByGroupKey, transcriptView, isChatLikeView, expandedCardKeys, collapsedCardKeys,
    setAgentToolCursorByGroupKey, setCollapsedCardKeys, setExpandedCardKeys,
  }, scope))

  // The instance list is re-read on open: one added to provider-instances.json
  // while the TUI runs is offered without a restart.
  const openProviderMenu = useStableEvent(() => {
    setProviderMenuIndex(providerOptionIndex(providerSelectOptions(providerInstances), provider, providerInstanceId))
    setProviderMenuOpen(true)
    void readTuiProviderInstances().then(({ choices }) => {
      setProviderInstances((current) => (JSON.stringify(current) === JSON.stringify(choices) ? current : choices))
      setProviderMenuIndex(providerOptionIndex(providerSelectOptions(choices), provider, providerInstanceId))
    }).catch(() => {})
  })

  const closeProviderMenu = useCallback(() => {
    setProviderMenuOpen(false)
  }, [])

  const openThemeMenu = useStableEvent(() => {
    themeMenuOriginRef.current = themeMode
    setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    setThemeMenuGroup(
      isLightThemeMode(themeMode) ? 'light' : OMZ_MODES.includes(themeMode) ? 'omz' : 'dark',
    )
    setThemeMenuQuery('')
    setThemeMenuOpen(true)
  })

  const closeThemeMenu = useStableEvent(() => {
    const originTheme = themeMenuOriginRef.current
    setThemeMenuOpen(false)
    setThemeMenuQuery('')
    if (originTheme) {
      setThemeMode(originTheme)
      setThemeMenuIndex(Math.max(THEMES.indexOf(originTheme), 0))
    } else {
      setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    }
    themeMenuOriginRef.current = null
  })

  const chooseTheme = useCallback((nextTheme: TuiThemeMode) => {
    setThemeMode(nextTheme)
    setThemeMenuIndex(Math.max(THEMES.indexOf(nextTheme), 0))
    themeMenuOriginRef.current = null
    // A theme picked by name is the choice; it is also what following the
    // terminal will switch to on that side once it is turned back on.
    const side = isLightThemeMode(nextTheme) ? 'light' : 'dark'
    themeSlotsRef.current = { ...themeSlotsRef.current, [side]: nextTheme }
    themeFollowsTerminalRef.current = false
    setThemeFollowsTerminal(false)
    void Promise.all([
      writeTuiTheme(nextTheme),
      writeTuiThemeFollow({ follow: false, [side]: nextTheme }),
    ]).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    })
    setThemeMenuOpen(false)
  }, [])

  // The terminal reports its background as light or dark, and reports again
  // when the OS appearance flips. A terminal that never answers leaves the
  // theme where it was.
  const applyTerminalThemeMode = useStableEvent((mode: 'light' | 'dark' | null) => {
    if (!mode || !themeFollowsTerminalRef.current) return
    const target = themeSlotsRef.current[mode]
    // Mid-preview, closing the menu restores its origin: move that too.
    if (themeMenuOriginRef.current) themeMenuOriginRef.current = target
    setThemeMode(target)
    setThemeMenuIndex(Math.max(THEMES.indexOf(target), 0))
  })

  return {
    refreshSelectedSessionDetail, prefetchSessionDetail, jumpToTranscriptTail,
    jumpToUnreadBoundary, jumpToResumeMarker, focusSidebarEntry, moveSelection, moveCursor,
    moveAgentToolCursor, velocityScrollStep, moveViewport, jumpToMatchingCard, jumpToSearchMatch,
    toggleExpansion, openProviderMenu, closeProviderMenu, openThemeMenu, closeThemeMenu,
    chooseTheme, applyTerminalThemeMode,
  }
}
