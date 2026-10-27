/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import { tabStripActivity } from '../../tabStrip'
import React from 'react'
import { type TabSelectOption, type TabSelectRenderable } from '@opentui/core'
import { TAB_SPINNER_FRAMES, TAB_SPINNER_INTERVAL_MS } from '../chrome'
import { type Dispatch, type SetStateAction } from 'react'
import { type TranscriptIndexLookup } from '../transcriptIndex'
import { type OpenCodeTodo } from '../../../../lib/taskRegistry'
import { type TuiTranscriptCard } from '../../../format'
import { type TuiSessionReaderState } from '../../../../lib/tuiState'
import { sessionKey } from '../sessionList'
import { keepEmpty } from '../collections'
import { type MutableRefObject } from 'react'
import { type TranscriptWindowPosition } from '../../transcriptWindowState'
import { workspaceStorageKey } from '../../workspaceContext'
import { readTuiSessionReaderState } from '../../../../lib/tui/service'
import { sameKeys } from '../collections'
import { type Session } from '../../../../lib/types'
import { CLAUDE_BACKGROUND_METADATA_REFRESH_MS } from '../timing'
import { DETAIL_REFRESH_MS } from '../timing'
import { NEIGHBOR_PREFETCH_RADIUS, NEIGHBOR_PREFETCH_DELAY_MS } from '../timing'
import { type TranscriptSessionLoader } from '../../transcriptSessionLoader'
import { noteTuiNavLatency } from '../../metricsLogger'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { type TuiDensity } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { sessionTranscriptUpdatedAt } from '../../sessionRefreshPolicy'
import { DETAIL_OPEN_DELAY_MS, DETAIL_OPEN_CACHED_DELAY_MS } from '../timing'
import { type WaitingSession } from '../../../../lib/sessionRuntime'
import { type ViewerAttentionNote } from '../../../../lib/viewerAttention'
import { readTuiRuntimeActivity } from '../../../../lib/tui/service'
import { type AgentProvider, type RunningSessionRef } from '../../../../lib/types'
import { extractPendingPermissions, type PendingPermission } from '../../../../lib/permissions'
import { join } from 'node:path'
import { type RunningRegistryEntry } from '../types'
import { REATTACH_POLL_MS } from '../timing'
import { sameJson } from '../perf'

export type OptionsEffectContext = {
  tabSelectRef: React.RefObject<TabSelectRenderable | null>
  runningTabKeys: Set<string>
  tabOptions: TabSelectOption[]
  tabWidth: number
}

export function runOptionsEffect(ctx: OptionsEffectContext) {
  const {
    tabSelectRef, runningTabKeys, tabOptions, tabWidth,
  } = ctx
  const instance = tabSelectRef.current
  if (!instance) return undefined
  if (runningTabKeys.size === 0) {
    // Nothing is running: hand back exactly what React rendered, or the last
    // frame drawn stays frozen on a tab that has finished.
    instance.setOptions(tabOptions)
    return undefined
  }
  let frame = 0
  const paint = () => {
    const target = tabSelectRef.current
    if (!target) return
    target.setOptions(tabOptions.map((option) => (
      option.value != null && runningTabKeys.has(option.value as string)
        ? { ...option, name: tabStripActivity(option.name, tabWidth, TAB_SPINNER_FRAMES[frame % TAB_SPINNER_FRAMES.length]) }
        : option
    )))
  }
  paint()
  const id = setInterval(() => {
    frame += 1
    paint()
  }, TAB_SPINNER_INTERVAL_MS)
  return () => clearInterval(id)
}

export type TranscriptScrollSyncEffectContext = {
  transcriptCards: TuiTranscriptCard[]
  previousTranscriptRef: React.RefObject<{ sessionKey: string | null; length: number; lastKey: string | null; }>
  committedSessionKey: string | null
  setTranscriptCursorKey: (action: string | null | ((previous: string | null) => string | null)) => void
  setPendingNewCount: React.Dispatch<React.SetStateAction<number>>
  setUnreadBoundaryKey: React.Dispatch<React.SetStateAction<string | null>>
  restoredReaderState: { sessionKey: string | null; loaded: boolean; state: TuiSessionReaderState | null; }
  transcriptIndexByKey: TranscriptIndexLookup
  visibleTranscriptCards: TuiTranscriptCard[]
  setFollowTail: React.Dispatch<React.SetStateAction<boolean>>
  setResumeMarkerKey: React.Dispatch<React.SetStateAction<string | null>>
  setComposerLiveTodos: React.Dispatch<React.SetStateAction<OpenCodeTodo[]>>
  followTail: boolean
  readCursorIndex: () => number
}

export function runTranscriptScrollSyncEffect(ctx: TranscriptScrollSyncEffectContext) {
  const {
    transcriptCards, previousTranscriptRef, committedSessionKey, setTranscriptCursorKey,
    setPendingNewCount, setUnreadBoundaryKey, restoredReaderState, transcriptIndexByKey,
    visibleTranscriptCards, setFollowTail, setResumeMarkerKey, setComposerLiveTodos, followTail,
    readCursorIndex,
  } = ctx
  const currentLength = transcriptCards.length
  const currentLastKey = transcriptCards.at(-1)?.key ?? null
  const previous = previousTranscriptRef.current
  const sameSession = previous.sessionKey === committedSessionKey

  if (currentLength === 0) {
    setTranscriptCursorKey(null)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: 0, lastKey: null }
    return
  }

  if (!sameSession) {
    if (restoredReaderState.sessionKey !== committedSessionKey || !restoredReaderState.loaded) return
    const restoredState = restoredReaderState.state
    if (restoredState?.followTail === false) {
      const restoredIndex = restoredState.cursorKey ? (transcriptIndexByKey.get(restoredState.cursorKey) ?? -1) : -1
      const targetIndex = restoredIndex >= 0 ? restoredIndex : 0
      setTranscriptCursorKey(visibleTranscriptCards[targetIndex]?.key ?? visibleTranscriptCards[0].key)
      setFollowTail(false)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      setResumeMarkerKey(restoredState.cursorKey)
    } else {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
  setComposerLiveTodos(keepEmpty)
  setFollowTail(true)
  setPendingNewCount(0)
  setUnreadBoundaryKey(null)
      setResumeMarkerKey(null)
    }
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
    return
  }

  if (followTail) {
    setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
    return
  }

  // Detached readers need append accounting, but do not allocate a second
  // full key array. The scan is limited to this paused-reader path; the
  // common tail-following live stream above remains O(1).
  const previousLastIndex = previous.lastKey
    ? transcriptCards.findIndex((card) => card.key === previous.lastKey)
    : -1
  const appendedCount = previousLastIndex >= 0
    ? currentLength - previousLastIndex - 1
    : 0

  if (appendedCount > 0) {
    setPendingNewCount(appendedCount)
    setUnreadBoundaryKey((current) => {
      if (current && transcriptCards.some((card) => card.key === current)) return current
      return transcriptCards[previousLastIndex + 1]?.key ?? null
    })
  }

  setTranscriptCursorKey((current) => {
    if (current && transcriptCards.some((card) => card.key === current)) return current
    return visibleTranscriptCards[Math.max(readCursorIndex(), 0)]?.key ?? visibleTranscriptCards[0].key
  })
  previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
  // cursorIndex is intentionally omitted from deps: the effect reconciles
  // cursor/pending state when transcriptCards changes, and the cursorIndex
  // fallback only fires when the current cursor key is missing from the new
  // card list. Re-running on every j/k keystroke would do O(n) indexOf +
  // includes work over the full transcript for a no-op setter result.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}

export type ExpansionResetEffectContext = {
  transcriptCards: TuiTranscriptCard[]
  setExpandedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setCollapsedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function runExpansionResetEffect(ctx: ExpansionResetEffectContext) {
  const {
    transcriptCards, setExpandedCardKeys, setCollapsedCardKeys,
  } = ctx
  // Skip building the `allowed` Set when both sets are empty — the common
  // case on a freshly loaded session — otherwise every poll rebuilds an
  // O(n) Set from the transcript for nothing. We also build the allowed
  // Set at most once and share it between both state updates.
  const allowed = new Set(transcriptCards.map((card) => card.key))
  setExpandedCardKeys((current) => {
    if (current.size === 0) return current
    let changed = false
    const next = new Set<string>()
    for (const key of current) {
      if (allowed.has(key)) next.add(key)
      else changed = true
    }
    return changed ? next : current
  })
  setCollapsedCardKeys((current) => {
    if (current.size === 0) return current
    let changed = false
    const next = new Set<string>()
    for (const key of current) {
      if (allowed.has(key)) next.add(key)
      else changed = true
    }
    return changed ? next : current
  })
}

export type TranscriptCursorEffectContext = {
  committedSessionKey: string | null
  tabReaderPositionsRef: React.MutableRefObject<Map<string, TranscriptWindowPosition>>
  setTranscriptCursorKey: (action: string | null | ((previous: string | null) => string | null)) => void
  setExpandedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setCollapsedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setFollowTail: React.Dispatch<React.SetStateAction<boolean>>
  setPendingNewCount: React.Dispatch<React.SetStateAction<number>>
  setUnreadBoundaryKey: React.Dispatch<React.SetStateAction<string | null>>
  setResumeMarkerKey: React.Dispatch<React.SetStateAction<string | null>>
  setSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  setScrollbackExpanded: React.Dispatch<React.SetStateAction<boolean>>
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
  setSearchMatchIndex: React.Dispatch<React.SetStateAction<number>>
  setRestoredReaderState: React.Dispatch<React.SetStateAction<{ sessionKey: string | null; loaded: boolean; state: TuiSessionReaderState | null; }>>
  workspaceId: string
}

export function runTranscriptCursorEffect(ctx: TranscriptCursorEffectContext) {
  const {
    committedSessionKey, tabReaderPositionsRef, setTranscriptCursorKey, setExpandedCardKeys,
    setCollapsedCardKeys, setFollowTail, setPendingNewCount, setUnreadBoundaryKey,
    setResumeMarkerKey, setSearchMode, setScrollbackExpanded, setSearchQuery, setSearchMatchIndex,
    setRestoredReaderState, workspaceId,
  } = ctx
  let cancelled = false
  const saved = committedSessionKey ? tabReaderPositionsRef.current.get(committedSessionKey) : undefined

  setTranscriptCursorKey(saved?.state.cursorKey ?? null)
  setExpandedCardKeys((current) => sameKeys(current, saved?.state.expandedKeys) ? current : new Set(saved?.state.expandedKeys))
  setCollapsedCardKeys((current) => sameKeys(current, saved?.state.collapsedKeys) ? current : new Set(saved?.state.collapsedKeys))
  setFollowTail(saved?.state.followTail ?? true)
  setPendingNewCount(0)
  setUnreadBoundaryKey(null)
  setResumeMarkerKey(null)
  setSearchMode(false)
  setScrollbackExpanded(saved?.scrollbackExpanded ?? false)
  setSearchQuery(saved?.searchQuery ?? '')
  setSearchMatchIndex(saved?.searchMatchIndex ?? 0)
  setRestoredReaderState({
    sessionKey: committedSessionKey,
    loaded: saved !== undefined || committedSessionKey == null,
    state: saved?.state ?? null,
  })

  if (saved) {
    return () => { cancelled = true }
  }

  if (!committedSessionKey) {
    return () => {
      cancelled = true
    }
  }

  void (async () => {
    try {
      const state = await readTuiSessionReaderState(workspaceStorageKey(workspaceId, committedSessionKey))
      if (cancelled) return
      setRestoredReaderState({
        sessionKey: committedSessionKey,
        loaded: true,
        state,
      })
      if (state) {
        setExpandedCardKeys((current) => sameKeys(current, state.expandedKeys) ? current : new Set(state.expandedKeys))
        setCollapsedCardKeys((current) => sameKeys(current, state.collapsedKeys) ? current : new Set(state.collapsedKeys))
        if (state.followTail === false) {
          setTranscriptCursorKey(state.cursorKey)
          setFollowTail(false)
          setResumeMarkerKey(state.cursorKey)
        }
      }
    } catch {
      if (cancelled) return
      setRestoredReaderState({
        sessionKey: committedSessionKey,
        loaded: true,
        state: null,
      })
    }
  })()

  return () => {
    cancelled = true
  }
}

export type SessionPollIntervalEffectContext = {
  bootstrapped: boolean
  tabsEnabled: boolean
  openTabSessions: Session[]
  providerSwitchRef: React.RefObject<boolean>
  selectedSessionKeyRef: React.RefObject<string | null>
  openTabSessionsRef: React.RefObject<Session[]>
  backgroundMetadataCursorRef: React.RefObject<number>
}

export function runSessionPollIntervalEffect(ctx: SessionPollIntervalEffectContext) {
  const {
    bootstrapped, tabsEnabled, openTabSessions, providerSwitchRef, selectedSessionKeyRef,
    openTabSessionsRef, backgroundMetadataCursorRef,
  } = ctx
  if (!bootstrapped || !tabsEnabled || openTabSessions.length === 0) return undefined
  let active = true
  const interval = setInterval(() => {
    if (!active || providerSwitchRef.current) return
    const selectedKey = selectedSessionKeyRef.current
    const backgroundTabs = openTabSessionsRef.current.filter((tab) => sessionKey(tab) !== selectedKey)
    if (backgroundTabs.length === 0) return
    const cursor = backgroundMetadataCursorRef.current % backgroundTabs.length
    backgroundMetadataCursorRef.current = (backgroundMetadataCursorRef.current + 1) % backgroundTabs.length
    const target = backgroundTabs[cursor]
    if (!target) return
    // Context usage metadata is disabled for open tabs.
    // void refreshSessionMetadata(target, false)
  }, CLAUDE_BACKGROUND_METADATA_REFRESH_MS)
  return () => {
    active = false
    clearInterval(interval)
  }
}

export type DetailRefreshIntervalEffectContext = {
  bootstrapped: boolean
  selectedSessionTarget: Session | null
  selectedSession: Session | null
  providerSwitchRef: React.RefObject<boolean>
  composerActiveRef: React.RefObject<boolean>
  composerDraftRef: React.RefObject<string>
  searchModeRef: React.RefObject<boolean>
  sessionSearchModeRef: React.RefObject<boolean>
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
}

export function runDetailRefreshIntervalEffect(ctx: DetailRefreshIntervalEffectContext) {
  const {
    bootstrapped, selectedSessionTarget, selectedSession, providerSwitchRef, composerActiveRef,
    composerDraftRef, searchModeRef, sessionSearchModeRef, refreshSelectedSessionDetail,
  } = ctx
  if (!bootstrapped || !selectedSessionTarget || selectedSession?.isPending) return undefined
  let active = true
  const interval = setInterval(() => {
    if (!active || providerSwitchRef.current) return
    // Skip background polls during active typing/searching — the poll's
    // startTransition can interleave with input handling and cause stutter.
    // The next tick after the user stops typing picks up any new content
    // (and a focused refresh on entering search-mode already fires).
    if (composerActiveRef.current && composerDraftRef.current.length > 0) return
    if (searchModeRef.current || sessionSearchModeRef.current) return
    void refreshSelectedSessionDetail(selectedSessionTarget, false)
  }, DETAIL_REFRESH_MS)
  return () => {
    active = false
    clearInterval(interval)
  }
}

export type OverlaySettleEffectContext = {
  bootstrapped: boolean
  committedSessionKey: string | null
  sidebarSessionEntriesRef: React.RefObject<Session[]>
  foregroundLoadInFlightRef: React.RefObject<boolean>
  pendingForegroundLoadRef: React.RefObject<Session | null>
  selectedSessionKeyRef: React.RefObject<string | null>
  prefetchSessionDetail: (session: Session) => Promise<void>
}

export function runOverlaySettleEffect(ctx: OverlaySettleEffectContext) {
  const {
    bootstrapped, committedSessionKey, sidebarSessionEntriesRef, foregroundLoadInFlightRef,
    pendingForegroundLoadRef, selectedSessionKeyRef, prefetchSessionDetail,
  } = ctx
  if (!bootstrapped || !committedSessionKey) return undefined
  let cancelled = false
  const run = async () => {
    const sessionEntries = sidebarSessionEntriesRef.current
    const idx = sessionEntries.findIndex((session) => sessionKey(session) === committedSessionKey)
    if (idx < 0) return
    const neighbors: Session[] = []
    for (let distance = 1; distance <= NEIGHBOR_PREFETCH_RADIUS; distance++) {
      const below = sessionEntries[idx + distance]
      if (below && !below.isPending) neighbors.push(below)
      const above = sessionEntries[idx - distance]
      if (above && !above.isPending) neighbors.push(above)
    }
    for (const neighbor of neighbors) {
      if (cancelled) return
      // Yield to real work: an open in flight (or queued), or the user has
      // already scrubbed off the settled session.
      if (foregroundLoadInFlightRef.current || pendingForegroundLoadRef.current) return
      if (selectedSessionKeyRef.current !== committedSessionKey) return
      await prefetchSessionDetail(neighbor)
    }
  }
  const timer = setTimeout(() => { void run() }, NEIGHBOR_PREFETCH_DELAY_MS)
  return () => {
    cancelled = true
    clearTimeout(timer)
  }
}

export type SessionDetailLoadEffectContext = {
  bootstrapped: boolean
  selectedSessionTarget: Session | null
  selectedSession: Session | null
  setSessionDetail: React.Dispatch<React.SetStateAction<TuiSessionDetail | null>>
  setLoadingDetail: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  navSelectStartRef: React.RefObject<{ key: string; at: number; } | null>
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  loader: TranscriptSessionLoader
  densityRef: React.RefObject<TuiDensity>
  showToolCallsRef: React.RefObject<boolean>
  sessionDetailMtimeRef: React.RefObject<Map<string, number>>
  sessionDetailCacheRef: React.RefObject<TranscriptDetailCache>
  awaitingPersistedTurnRef: React.MutableRefObject<boolean>
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
}

export function runSessionDetailLoadEffect(ctx: SessionDetailLoadEffectContext) {
  const {
    bootstrapped, selectedSessionTarget, selectedSession, setSessionDetail, setLoadingDetail,
    setError, navSelectStartRef, sessionsByKeyRef, loader, densityRef, showToolCallsRef,
    sessionDetailMtimeRef, sessionDetailCacheRef, awaitingPersistedTurnRef,
    liveTranscriptBaselineRef, refreshSelectedSessionDetail,
  } = ctx
  if (!bootstrapped) return
  if (!selectedSessionTarget || selectedSession?.isPending) {
    setSessionDetail(null)
    setLoadingDetail(false)
    setError((current) => current?.startsWith('Failed to load session detail') ? null : current)
    return
  }

  // Debounce the actual open so rapid scrubbing through the sidebar doesn't
  // load + reformat a transcript for every session passed through. The
  // cleanup clears the pending timer when the selection changes again, so
  // only the session we land on (and hold for the delay chosen below) renders.
  // The previously-shown transcript stays visible during the wait — no flash.
  const target = selectedSessionTarget
  const navStartedAt = performance.now()
  const targetKey = sessionKey(target)
  navSelectStartRef.current = { key: targetKey, at: navStartedAt }
  const targetLastModified = sessionTranscriptUpdatedAt(target, sessionsByKeyRef.current.get(targetKey))
  const shared = loader.peek(target, densityRef.current, showToolCallsRef.current)
  const recordedMtime = shared?.revision ?? sessionDetailMtimeRef.current.get(targetKey)
  // Mirrors refreshSelectedSessionDetail's cached-and-unchanged fast path: if
  // that branch will fire, this open does no work and deserves no wait.
  const opensFromCache = (Boolean(shared) || sessionDetailCacheRef.current.has(targetKey))
    && typeof targetLastModified === 'number'
    && recordedMtime != null
    && recordedMtime >= targetLastModified
    && !awaitingPersistedTurnRef.current
    && !liveTranscriptBaselineRef.current.has(targetKey)
  const timer = setTimeout(() => {
    noteTuiNavLatency('select-to-open', performance.now() - navStartedAt)
    // Display is owned by refreshSelectedSessionDetail's cache-first branch,
    // which is single-flight-gated: if a load is already running (still
    // scrubbing) it defers without rendering this session, so intermediates
    // never open. The previously-shown transcript stays put until we settle.
    void refreshSelectedSessionDetail(target, true)
  }, opensFromCache ? DETAIL_OPEN_CACHED_DELAY_MS : DETAIL_OPEN_DELAY_MS)
  return () => clearTimeout(timer)
}

export type RunningRegistryEffectContext = {
  registryPollInFlightRef: React.RefObject<boolean>
  setRunningRegistryReady: React.Dispatch<React.SetStateAction<boolean>>
  setWaitingSessions: React.Dispatch<React.SetStateAction<WaitingSession[]>>
  setViewerAttentionNotes: React.Dispatch<React.SetStateAction<ViewerAttentionNote[]>>
  runningRegistryByKeyRef: React.RefObject<Map<string, { sessionId: string; provider: AgentProvider; providerInstanceId?: string; pendingPrompts: Record<string, unknown>[]; pendingPermissions: Record<string, unknown>[]; }>>
  composerAbortRef: React.MutableRefObject<AbortController | null>
  ownedTurnKeyRef: React.MutableRefObject<string | null>
  ownsComposerStream: (key: string) => boolean
  reattachMarksRef: React.RefObject<Map<string, RunningSessionRef>>
  markSessionRunning: (ref: RunningSessionRef) => void
  clearSessionRunning: (ref: RunningSessionRef) => void
  selectedSessionKeyRef: React.RefObject<string | null>
  recordAttentionTurnDone: (ref: RunningSessionRef) => void
  setBackgroundPrompts: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  attentionNotifiedRef: React.RefObject<Set<string>>
  notifyAttention: (title: string, sessionId: string, sessionProvider: AgentProvider) => void
  reconcileSelectedRunningRegistry: (runningByKey: Map<string, RunningRegistryEntry>, ownedKey: string | null) => void
}

export function runRunningRegistryEffect(ctx: RunningRegistryEffectContext) {
  const {
    registryPollInFlightRef, setRunningRegistryReady, setWaitingSessions, setViewerAttentionNotes,
    runningRegistryByKeyRef, composerAbortRef, ownedTurnKeyRef, ownsComposerStream,
    reattachMarksRef, markSessionRunning, clearSessionRunning, selectedSessionKeyRef,
    recordAttentionTurnDone, setBackgroundPrompts, attentionNotifiedRef, notifyAttention,
    reconcileSelectedRunningRegistry,
  } = ctx
  const poll = async () => {
    if (registryPollInFlightRef.current) return
    registryPollInFlightRef.current = true
    let activity: Awaited<ReturnType<typeof readTuiRuntimeActivity>>
    try {
      activity = await readTuiRuntimeActivity()
    } catch {
      return // registry probe is best-effort
    } finally {
      registryPollInFlightRef.current = false
    }
    const entries = activity.running
    setRunningRegistryReady(true)
    // Every poll reads fresh arrays, and storing one re-renders the whole
    // root — every ~1.5s for as long as the app is open, whether or not
    // anything changed. They are small; keep the previous array when equal.
    setWaitingSessions((prev) => (sameJson(prev, activity.waiting) ? prev : activity.waiting))
    setViewerAttentionNotes((prev) => (sameJson(prev, activity.attention) ? prev : activity.attention))
    const runningByKey = new Map(entries.map((entry) => [
      sessionKey(entry),
      entry,
    ]))
    runningRegistryByKeyRef.current = runningByKey
    const ownedKey = composerAbortRef.current ? ownedTurnKeyRef.current : null
    const waitingKeys = new Set(activity.waiting.map((entry) => sessionKey(entry)))

    // Sidebar liveness for turns nobody owns (started before a session
    // switch, or surviving a dead stream).
    for (const [key, entry] of runningByKey) {
      if (ownsComposerStream(key) || reattachMarksRef.current.has(key)) continue
      const ref: RunningSessionRef = { sessionId: entry.sessionId, provider: entry.provider, providerInstanceId: entry.providerInstanceId }
      reattachMarksRef.current.set(key, ref)
      markSessionRunning(ref)
    }
    for (const [key, ref] of reattachMarksRef.current) {
      if (runningByKey.has(key)) continue
      reattachMarksRef.current.delete(key)
      clearSessionRunning(ref)
      // An unowned turn just finished — surface it in the attention inbox
      // unless the user is already looking at that session.
      if (key !== selectedSessionKeyRef.current && !waitingKeys.has(key)) recordAttentionTurnDone(ref)
    }

    const selectedKey = selectedSessionKeyRef.current

    // Prompts blocking running turns on OTHER sessions feed the attention
    // inbox (the selected session's prompts reconcile into
    // pendingPermissions below). Notify once per prompt — these are exactly
    // the "an agent is waiting on you and you can't see it" moments.
    const background: PendingPermission[] = []
    for (const [key, entry] of runningByKey) {
      if (ownsComposerStream(key) || key === selectedKey) continue
      const permissionPayloads = entry.pendingPermissions.length > 0
        ? entry.pendingPermissions
        : entry.pendingPrompts.map((data) => ({
            type: 'claude_permission',
            event: { type: 'permission.requested', data },
          }))
      background.push(...extractPendingPermissions(permissionPayloads, entry))
    }
    setBackgroundPrompts((prev) => {
      const nextIds = background.map((p) => p.id).join('|')
      return nextIds === prev.map((p) => p.id).join('|') ? prev : background
    })
    const liveIds = new Set(background.map((p) => p.id))
    for (const id of attentionNotifiedRef.current) {
      if (!liveIds.has(id)) attentionNotifiedRef.current.delete(id)
    }
    for (const prompt of background) {
      if (attentionNotifiedRef.current.has(prompt.id)) continue
      attentionNotifiedRef.current.add(prompt.id)
      notifyAttention(prompt.title, prompt.sessionId ?? '', prompt.provider ?? 'claude')
    }

    reconcileSelectedRunningRegistry(runningByKey, ownedKey)
  }
  void poll()
  const timer = setInterval(() => { void poll() }, REATTACH_POLL_MS)
  return () => clearInterval(timer)
}
