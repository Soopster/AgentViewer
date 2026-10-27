/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Timeout } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React, { useCallback, useMemo, useRef } from 'react'
import { type FloatingRect } from '../../windowTabs'
import { isSurfaceWindowKey, orderWindows } from '../../windowOrder'
import { type SelectedLineRange } from '@pierre/diffs'
import { selectComposerQueueTarget } from '../../../../lib/composerAttachments'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { type ProviderSelection, type RunningSessionRef, type Session } from '../../../../lib/types'
import { resolveComposerTargetSession } from '../../splitPaneState'
import { type QueuedComposerSend } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type TranscriptDiffNoteDraft, type TranscriptDiffNote, transcriptDiffCardNamespace, transcriptDiffSelectionKey, transcriptDiffSelectionLineLabel } from '../transcriptDiffSelection'

export type UseTranscriptDiffHoverScrollTopRefGroupContext = {
  transcriptDiffHoverTimeoutRef: React.RefObject<NodeJS.Timeout | null>
  setHoveredTranscriptDiffAnchor: React.Dispatch<React.SetStateAction<string | null>>
  transcriptDiffNotes: Map<string, TranscriptDiffNote>
  setTranscriptDiffDraft: React.Dispatch<React.SetStateAction<TranscriptDiffNoteDraft | null>>
  setTranscriptDiffNotes: React.Dispatch<React.SetStateAction<Map<string, TranscriptDiffNote>>>
  setTranscriptDiffSelectionAnchorByCardKey: React.Dispatch<React.SetStateAction<Record<string, number>>>
  setTranscriptDiffRowCursorByCardKey: React.Dispatch<React.SetStateAction<Record<string, number>>>
  selectedSession: Session | null
  selectedSessionIdentity: string | null
  sessionDetail: TuiSessionDetail | null
  runningSessions: RunningSessionRef[]
  provider: ProviderSelection
  splitFocusIndex: number | null
  windowOrder: string[]
  splitPinnedKeys: string[]
  splitPaneCount: number
  windowSurfaces: string[]
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  openTabSessions: Session[]
  composerPaneTargetKey: string | null
  composerPreferredTargetKey: string | null
  sessions: Session[]
  queuedComposerSends: QueuedComposerSend[]
}

export function useTranscriptDiffHoverScrollTopRefGroup(ctx: UseTranscriptDiffHoverScrollTopRefGroupContext) {
  const {
    transcriptDiffHoverTimeoutRef, setHoveredTranscriptDiffAnchor, transcriptDiffNotes,
    setTranscriptDiffDraft, setTranscriptDiffNotes, setTranscriptDiffSelectionAnchorByCardKey,
    setTranscriptDiffRowCursorByCardKey, selectedSession, selectedSessionIdentity, sessionDetail,
    runningSessions, provider, splitFocusIndex, windowOrder, splitPinnedKeys, splitPaneCount,
    windowSurfaces, floatingWindow, openTabSessions, composerPaneTargetKey,
    composerPreferredTargetKey, sessions, queuedComposerSends,
  } = ctx

  // A hover caused by the transcript scrolling under a still pointer is not a
  // hover. The anchor is root state and an input to every mounted card, so
  // each diff row that passed beneath the pointer during a wheel scroll
  // re-rendered the root: 35 root commits of 8-15ms in one sustained scroll.
  // A hover is taken only at the scroll position the previous one was offered
  // at, which is true of a pointer moving over content that is standing still.
  const transcriptDiffHoverScrollTopRef = useRef(new Map<string, number | null>())
  const activateTranscriptDiffHover = useCallback((anchor: string, position?: { namespace: string; scrollTop: number | null }) => {
    const scrollTop = position ? position.scrollTop : null
    const namespace = position?.namespace ?? 'active'
    const offeredAt = transcriptDiffHoverScrollTopRef.current.get(namespace) ?? null
    transcriptDiffHoverScrollTopRef.current.set(namespace, scrollTop)
    if (offeredAt !== null && scrollTop !== offeredAt) return
    if (transcriptDiffHoverTimeoutRef.current) clearTimeout(transcriptDiffHoverTimeoutRef.current)
    setHoveredTranscriptDiffAnchor(anchor)
    transcriptDiffHoverTimeoutRef.current = setTimeout(() => {
      setHoveredTranscriptDiffAnchor(null)
      transcriptDiffHoverTimeoutRef.current = null
    }, 2000)
  }, [])
  // Sidebar selection changes on every scrub keypress. Read the latest note
  // state when invoked without invalidating all mounted card variants just
  // because the sidebar moved; this handler is passed to every transcript card.
  const openScopedTranscriptDiffNote = useStableEvent((namespace: string, selection: SelectedLineRange, cardKey?: string) => {
    const key = transcriptDiffSelectionKey(cardKey ? transcriptDiffCardNamespace(namespace, cardKey) : namespace, selection)
    const legacyKey = transcriptDiffSelectionKey(namespace, selection)
    const legacyAnchor = !transcriptDiffNotes.has(key) && transcriptDiffNotes.has(legacyKey) ? legacyKey : undefined
    setTranscriptDiffDraft({
      anchor: key, legacyAnchor,
      range: selection,
      lineLabel: transcriptDiffSelectionLineLabel(selection),
      text: (transcriptDiffNotes.get(key) ?? transcriptDiffNotes.get(legacyKey))?.text ?? '',
    })
  })
  const openTranscriptDiffNote = useStableEvent((selection: SelectedLineRange, cardKey?: string) => {
    openScopedTranscriptDiffNote(committedSessionKey ?? 'no-session', selection, cardKey)
  })
  const deleteTranscriptDiffNote = useCallback((selectionKey: string) => {
    setTranscriptDiffNotes((prev) => {
      const next = new Map(prev)
      next.delete(selectionKey)
      return next
    })
    setTranscriptDiffDraft((draft) => (draft?.anchor === selectionKey ? null : draft))
  }, [])
  const toggleTranscriptDiffCardSet = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, cardKey: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(cardKey)) next.delete(cardKey)
      else next.add(cardKey)
      return next
    })
  }, [])
  const clearTranscriptDiffSelectionForCard = useCallback((cardKey: string) => {
    setTranscriptDiffSelectionAnchorByCardKey((prev) => {
      if (!(cardKey in prev)) return prev
      const next = { ...prev }
      delete next[cardKey]
      return next
    })
  }, [])
  const setTranscriptDiffSelectionAnchorForCard = useCallback((cardKey: string, rowIndex: number) => {
    setTranscriptDiffSelectionAnchorByCardKey((prev) => ({ ...prev, [cardKey]: Math.max(0, rowIndex) }))
  }, [])
  const setTranscriptDiffRowCursorForCard = useCallback((cardKey: string, rowIndex: number, preserveSelection = false) => {
    setTranscriptDiffRowCursorByCardKey((prev) => ({ ...prev, [cardKey]: Math.max(0, rowIndex) }))
    if (!preserveSelection) clearTranscriptDiffSelectionForCard(cardKey)
  }, [clearTranscriptDiffSelectionForCard])
  const selectedSessionTarget = useMemo<Session | null>(() => (
    selectedSession
      ? {
          sessionId: selectedSession.sessionId,
          provider: selectedSession.provider,
        }
      : null
  ), [selectedSessionIdentity])
  // The session that the currently-loaded `sessionDetail` actually belongs to.
  // Memoized on `info` alone so its identity is stable as long as the detail is
  // — this is what keeps the transcript card cache from being busted mid-scrub.
  const detailSession = useMemo<Session | null>(() => {
    const info = sessionDetail?.info
    if (!info) return null
    return { sessionId: info.sessionId, provider: info.provider }
  }, [sessionDetail?.info])
  // Key the transcript off the session the detail belongs to, not the live
  // selection. While scrubbing quickly, `selectedSessionTarget` races ahead of
  // the debounced `sessionDetail` load; using it here would mismatch
  // `threadedMessages` and force a full uncached reformat of the (large) visible
  // transcript on every step. Falling back to `detailSession` keeps a stable
  // identity (cache hit) until the load we land on commits.
  const transcriptSession = useMemo<Session | null>(() => {
    if (!detailSession) return selectedSessionTarget
    if (
      selectedSessionTarget
      && selectedSessionTarget.sessionId === detailSession.sessionId
      && (selectedSessionTarget.provider ?? 'claude') === (detailSession.provider ?? 'claude')
    ) {
      return selectedSessionTarget
    }
    return detailSession
  }, [detailSession, selectedSessionTarget])
  // Key of the session whose transcript is actually on screen. Lags the live
  // `selectedSessionKey` by the open-debounce: while scrubbing it stays pinned
  // to the displayed session, so per-session effects (reader-state reset,
  // cursor reconcile, bookmark load) that would otherwise reset/rebuild the
  // transcript on every step simply don't fire until you settle. This is the
  // load-bearing guard against scrub jank on large sessions.
  const committedSessionKey = useMemo(
    () => (transcriptSession ? sessionKey(transcriptSession) : null),
    [transcriptSession],
  )
  const providerRunningSessions = useMemo(() => (
    runningSessions.filter((running) => provider === 'all' || running.provider === provider)
  ), [provider, runningSessions])
  // The session behind the focused pane, resolved from the pins rather than the
  // rendered pane list (which the layout computes much later). Session-scoped
  // features read this so they follow the pane you are looking at.
  const focusedSplitPaneSession = useMemo<Session | null>(() => {
    if (splitFocusIndex === null) return null
    const keys = orderWindows(windowOrder, splitPinnedKeys.slice(0, splitPaneCount), windowSurfaces)
    const key = splitFocusIndex === FLOATING_PANE_INDEX ? floatingWindow?.key : keys[splitFocusIndex]
    return key && !isSurfaceWindowKey(key) ? openTabSessions.find(tab => sessionKey(tab) === key) ?? null : null
  }, [splitFocusIndex, splitPinnedKeys, openTabSessions, windowOrder, splitPaneCount, windowSurfaces, floatingWindow])

  const composerTargetSession = useMemo<Session | null>(() => resolveComposerTargetSession({
    paneTargetKey: composerPaneTargetKey,
    preferredTargetKey: composerPreferredTargetKey,
    selectedSession,
    runningSessions: providerRunningSessions,
    sessions,
    openTabSessions,
    keyOf: sessionKey,
  }), [composerPaneTargetKey, composerPreferredTargetKey, openTabSessions, providerRunningSessions, selectedSession, sessions])
  const composerTargetSessionIdentity = composerTargetSession
    ? sessionKey(composerTargetSession)
    : null
  const activeQueuedComposerSends = useMemo(
    () => selectComposerQueueTarget(queuedComposerSends, composerTargetSessionIdentity),
    [composerTargetSessionIdentity, queuedComposerSends],
  )
  const composerTargetTurnKnownRunning = Boolean(
    composerTargetSessionIdentity
    && providerRunningSessions.some((running) => sessionKey(running) === composerTargetSessionIdentity),
  )
  const composerTargetSessionRef = useRef<Session | null>(null)

  return {
    activateTranscriptDiffHover, openScopedTranscriptDiffNote, openTranscriptDiffNote,
    deleteTranscriptDiffNote, toggleTranscriptDiffCardSet, clearTranscriptDiffSelectionForCard,
    setTranscriptDiffSelectionAnchorForCard, setTranscriptDiffRowCursorForCard,
    selectedSessionTarget, transcriptSession, committedSessionKey, focusedSplitPaneSession,
    composerTargetSession, composerTargetSessionIdentity, activeQueuedComposerSends,
    composerTargetTurnKnownRunning, composerTargetSessionRef,
  }
}
