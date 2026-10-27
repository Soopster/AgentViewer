/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { MutableRefObject } from 'react'
import type { TranscriptSessionLoader } from '../../transcriptSessionLoader'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { liveMessageSessionKey } from '../../liveTranscriptState'
import React, { startTransition } from 'react'
import { noteTuiNavLatency } from '../../metricsLogger'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiDensity } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { sessionTranscriptUpdatedAt } from '../../sessionRefreshPolicy'
import { type ContextUsage, type RunningSessionRef, type Session } from '../../../../lib/types'
import { sessionMessageFingerprint, sessionMessageSequenceFingerprint, summarizeDurableSessionMessages } from '../../messageFingerprint'
import { hasLiveAssistantMessage, persistedTurnSettled, hasPersistedAssistantAfterBaseline, hasPersistedUserAfterBaseline } from '../liveStream'
import { sessionKey, sessionDetailOwnerKeys } from '../sessionList'
import { keepFiltered, touchMapEntry, pruneSessionCaches } from '../collections'
import { readTuiSessionMetadataAsync } from '../../metadataWorkerClient'
import { resolve } from 'node:path'
import { CLAUDE_METADATA_REFRESH_MS, DEFAULT_METADATA_REFRESH_MS, CLAUDE_BACKGROUND_METADATA_REFRESH_MS, DEFAULT_BACKGROUND_METADATA_REFRESH_MS, METADATA_REQUEST_TIMEOUT_MS } from '../timing'
import { readTuiSessionsAsync } from '../../sessionDetailWorkerClient'
import { type ProviderSelection } from '../../../../lib/types'
import { type PendingInboxEdit } from '../types'
import { withPendingInboxEdits, sessionsShallowEqual } from '../sessionList'
import { keepEmpty } from '../collections'
import { extractPendingPermissions, type PendingPermission } from '../../../../lib/permissions'
import { join } from 'node:path'
import { type RunningRegistryEntry } from '../types'
import { type Timeout } from '@opentui/core'
import { workspaceStorageKey } from '../../workspaceContext'
import { type TuiTranscriptCard } from '../../../format'
import { writeTuiSessionReaderState } from '../../../../lib/tui/service'
import { type TuiSessionReaderState } from '../../../../lib/tuiState'
import { formatProviderLabel } from '../../../format'
import { createTuiSession, type TuiProviderInstanceChoice } from '../../../../lib/tui/service'
import { type AgentProvider } from '../../../../lib/types'
import { type NoticeTone } from '../types'

export type RefreshSelectedSessionDetailContext = {
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
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
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
}

export async function runRefreshSelectedSessionDetail(ctx: RefreshSelectedSessionDetailContext, session: Session, foreground?: boolean | undefined) {
  const {
    sessionsByKeyRef, reattachedRunningKeyRef, runningSessionsRef, loadingDetailRef,
    backgroundRefreshInFlightRef, liveTranscriptBaselineRef, awaitingPersistedTurnRef,
    sessionDetailMtimeRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, loader, densityRef,
    showToolCallsRef, sessionDetailCacheRef, navDetailSetAtRef, setSessionDetail, setLoadingDetail,
    selectedSessionKeyRef, setContextUsage, setContextUsageStatus, refreshSessionMetadata,
    setError, refreshSelectedSessionDetail, detailRequestRef, openTabSessionsRef,
    sessionContextUsageCacheRef, sessionMetadataFetchedAtRef, pendingLiveTextRef,
    liveTranscriptMessagesRef, ownsComposerStream, setLiveTranscriptMessages, liveToolIndexesRef,
    liveToolInputJsonRef, setComposerLiveText, setAwaitingPersistedTurn, sessionDetailRef,
  } = ctx
  if (foreground === undefined) foreground = true
  const cacheKeyForGuards = sessionKey(session)
  // Callers pass identity-stable skeleton sessions; pull transcript update time from
  // the latest sessions list (see sessionsByKeyRef) or the guards below
  // never fire and every poll/settle re-reads the full session file.
  const sessionLastModified = sessionTranscriptUpdatedAt(session, sessionsByKeyRef.current.get(cacheKeyForGuards))
  const sessionIsRunning = reattachedRunningKeyRef.current === cacheKeyForGuards
    || runningSessionsRef.current.some(running => sessionKey(running) === cacheKeyForGuards)
  if (!foreground && (loadingDetailRef.current || backgroundRefreshInFlightRef.current.has(cacheKeyForGuards))) return
  // A live baseline normally means an owned stream is rendering the turn, so
  // background polls pause. Reattached turns have no stream — the poll is the
  // only way their progress lands, so keep polling those.
  if (
    !foreground
    && liveTranscriptBaselineRef.current.has(cacheKeyForGuards)
    && !awaitingPersistedTurnRef.current
    && reattachedRunningKeyRef.current !== cacheKeyForGuards
  ) return

  // Skip idle background polls when the provider hasn't changed since the
  // cached detail was populated — avoids re-reading and re-threading the
  // full message file every interval for idle sessions. Worst case the
  // sidebar's update time is stale and we skip one poll; the next sidebar
  // refresh catches us up.
  if (!foreground && !sessionIsRunning && !awaitingPersistedTurnRef.current && typeof sessionLastModified === 'number') {
    const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
    if (recordedMtime != null && recordedMtime >= sessionLastModified) return
  }
  // Cache-first for foreground loads — show the last-known detail immediately
  // rather than flashing a spinner while disk IO / JSON parsing runs. A
  // background refresh still fires below so the UI catches up.
  if (foreground) {
    // Coalesce FIRST, before touching the display: if a foreground load is
    // already running, the user is still scrubbing — just remember the latest
    // target and bail without rendering this fly-by session. The in-flight
    // load's finally runs the latest pending target when the worker frees, so
    // neither the worker queue nor the transcript view churns mid-scrub.
    if (foregroundLoadInFlightRef.current) {
      pendingForegroundLoadRef.current = session
      return
    }
    foregroundLoadInFlightRef.current = true

    // Worker idle → this is a settled open. Show the last-known detail
    // immediately (cache hit) rather than flashing a spinner while the
    // background refresh below runs.
    const shared = loader.peek(session, densityRef.current, showToolCallsRef.current)
    if (shared) {
      sessionDetailOwnerKeys.set(shared.detail, cacheKeyForGuards)
      touchMapEntry(sessionDetailCacheRef.current, cacheKeyForGuards, shared.detail)
      if (shared.revision !== undefined) sessionDetailMtimeRef.current.set(cacheKeyForGuards, shared.revision)
      else sessionDetailMtimeRef.current.delete(cacheKeyForGuards)
    }
    const cached = sessionDetailCacheRef.current.get(cacheKeyForGuards)
    if (cached) {
      navDetailSetAtRef.current = { key: cacheKeyForGuards, at: performance.now() }
      setSessionDetail(cached)
      setLoadingDetail(false)
      // A window that read this session first leaves its usage here too.
      if (cached.contextUsage && cacheKeyForGuards === selectedSessionKeyRef.current) {
        setContextUsage(cached.contextUsage)
        setContextUsageStatus('ready')
      }
      if (!cached.info?.currentModel) {
        setTimeout(() => {
          refreshSessionMetadata(session, false, cached, cached, false)
        }, 0)
      }
      // Session file unchanged since the cached detail was read → the worker
      // re-read would return identical content. Skip it entirely so settling
      // on a recently-visited session costs nothing (the same guard the
      // background poll uses; the next sessions-list refresh catches a stale
      // lastModified). Never skip while a live turn is in flight.
      const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
      if (
        typeof sessionLastModified === 'number'
        && recordedMtime != null
        && recordedMtime >= sessionLastModified
        && !awaitingPersistedTurnRef.current
        && !liveTranscriptBaselineRef.current.has(cacheKeyForGuards)
        && !sessionIsRunning
      ) {
        setError((current) => current?.startsWith('Failed to load session detail') ? null : current)
        foregroundLoadInFlightRef.current = false
        const next = pendingForegroundLoadRef.current
        if (next) {
          pendingForegroundLoadRef.current = null
          void refreshSelectedSessionDetail(next, true)
        }
        return
      }
    } else {
      setLoadingDetail(true)
    }
  }
  // Take the request id only once this call is actually going to read.
  // Taking it before the coalesce branch above meant every DEFERRED call
  // (each scrub settle while a load was running) bumped the counter and
  // invalidated the in-flight read — whose completed result was then thrown
  // away wholesale, cache fill included. Scrubbing through big sessions
  // degenerated into a chain of full reads that never displayed and never
  // cached, which read as the TUI getting progressively slower.
  const requestId = ++detailRequestRef.current
  if (!foreground) backgroundRefreshInFlightRef.current.add(cacheKeyForGuards)
  setError((current) => current?.startsWith('Failed to load session detail') ? null : current)

  try {
    const readStartedAt = performance.now()
    const detail = await loader.read(session, densityRef.current, showToolCallsRef.current, sessionLastModified)
    if (foreground) noteTuiNavLatency('open-to-detail', performance.now() - readStartedAt)
    // Cache the completed read BEFORE the staleness gate. A newer request
    // superseding this one only makes the result too old to display — the
    // read itself is still the freshest snapshot of this session, and
    // discarding it forced the next visit to pay the full read again.
    if (typeof sessionLastModified === 'number') {
      sessionDetailMtimeRef.current.set(cacheKeyForGuards, sessionLastModified)
    }
    const cacheKey = sessionKey(session)
    sessionDetailOwnerKeys.set(detail, cacheKey)
    const pinnedKeys = new Set([
      ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
      selectedSessionKeyRef.current,
    ].filter((key): key is string => Boolean(key)))
    touchMapEntry(sessionDetailCacheRef.current, cacheKey, detail)
    if (detail.contextUsage) {
      touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, detail.contextUsage)
    }
    pruneSessionCaches(
      sessionDetailCacheRef.current,
      sessionContextUsageCacheRef.current,
      sessionMetadataFetchedAtRef.current,
      pinnedKeys,
    )
    // Still scrubbing — a newer settle queued while this read ran. Cache
    // only (above); the chained call in `finally` opens the latest target,
    // so fly-by sessions never pay a transcript mount.
    if (foreground && pendingForegroundLoadRef.current) return
    if (requestId !== detailRequestRef.current) return
    const liveBaseline = liveTranscriptBaselineRef.current.get(cacheKeyForGuards)
    let reconcileLiveOverlay: (() => void) | null = null
    if (liveBaseline) {
      const durableSummary = summarizeDurableSessionMessages(detail.rawMessages)
      const persistedTurnArrived =
        durableSummary.count > liveBaseline.count
        || durableSummary.lastFingerprint !== liveBaseline.lastFingerprint
        || durableSummary.sequenceFingerprint !== liveBaseline.sequenceFingerprint
      if (persistedTurnArrived) {
        const liveAssistantVisible = Boolean(pendingLiveTextRef.current.trim())
          || hasLiveAssistantMessage(liveTranscriptMessagesRef.current, cacheKeyForGuards)
        // Applied inside the transition below, with the detail that replaces
        // it: dropping the live overlay as an urgent update committed a frame
        // before the persisted rows, and the reply blinked out between them.
        const turnLanded = awaitingPersistedTurnRef.current
          ? persistedTurnSettled(detail.rawMessages, liveBaseline.count)
          : hasPersistedAssistantAfterBaseline(detail.rawMessages, liveBaseline.count)
        // While this client still streams the turn, a read can only ever be
        // ahead of the prompt, never past the reply: Codex persists the user
        // row at turn start, and finalizing on it dropped the baseline and
        // the live overlay mid-turn — so the stream's end had nothing left
        // to reconcile and sat in Syncing until the escape hatch.
        const streamStillOwned = ownsComposerStream(cacheKeyForGuards)
        reconcileLiveOverlay = streamStillOwned || (liveAssistantVisible && !turnLanded)
          ? () => {
              if (!hasPersistedUserAfterBaseline(detail.rawMessages, liveBaseline.count)) return
              setLiveTranscriptMessages((prev) => {
                const next = prev.filter((message) => !(liveMessageSessionKey(message) === cacheKeyForGuards && message.role === 'user'))
                return next.length === prev.length ? prev : next
              })
            }
          : () => {
              liveTranscriptBaselineRef.current.delete(cacheKeyForGuards)
              setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== cacheKeyForGuards))
              liveToolIndexesRef.current.clear()
              liveToolInputJsonRef.current.clear()
              setComposerLiveText('')
              setAwaitingPersistedTurn(false)
            }
      }
    }
    startTransition(() => {
      reconcileLiveOverlay?.()
      const displayedDetail = sessionDetailRef.current
      // Identity first: a fork's transcript is message-for-message its
      // parent's, so content alone called the fork "unchanged" and left the
      // parent on screen. An untagged detail (a local edit of one) re-sets
      // once, which is the safe direction.
      const unchanged = displayedDetail !== null
        && sessionDetailOwnerKeys.get(displayedDetail) === cacheKey
        && displayedDetail.rawMessages.length === detail.rawMessages.length
        && sessionMessageFingerprint(displayedDetail.rawMessages.at(-1)) === sessionMessageFingerprint(detail.rawMessages.at(-1))
        && sessionMessageSequenceFingerprint(displayedDetail.rawMessages) === sessionMessageSequenceFingerprint(detail.rawMessages)
        && displayedDetail.info?.currentModel === detail.info?.currentModel
        && displayedDetail.info?.customTitle === detail.info?.customTitle
      navDetailSetAtRef.current = { key: cacheKeyForGuards, at: performance.now() }
      if (unchanged) {
        // Keep the displayed and cached identities aligned so cache-first
        // revisits do not trigger a full transcript reformat on idle polls.
        touchMapEntry(sessionDetailCacheRef.current, cacheKey, displayedDetail)
      } else {
        setSessionDetail(detail)
      }
      if (detail.contextUsage && cacheKey === selectedSessionKeyRef.current) {
        setContextUsage(detail.contextUsage)
        setContextUsageStatus('ready')
      }
    })

    // Session detail is the transcript-critical path. If it could not report
    // a model, fill only that composer metadata in the background; context
    // usage remains disabled for open tabs.
    if (!detail.info?.currentModel) {
      setTimeout(() => {
        refreshSessionMetadata(session, false, detail, null, false)
      }, 0)
    }
  } catch (err) {
    if (requestId !== detailRequestRef.current) return
    // Only clear the view if we have nothing cached to fall back on — keeps
    // the last-known good detail visible during transient read failures.
    if (!sessionDetailCacheRef.current.has(cacheKeyForGuards)) setSessionDetail(null)
    setError(err instanceof Error ? `Failed to load session detail: ${err.message}` : 'Failed to load session detail')
  } finally {
    if (requestId === detailRequestRef.current && foreground) setLoadingDetail(false)
    if (!foreground) backgroundRefreshInFlightRef.current.delete(cacheKeyForGuards)
    if (foreground) {
      foregroundLoadInFlightRef.current = false
      // Run only the most-recent target requested while we were busy — every
      // session scrubbed past in between is skipped, so the worker never sees
      // a backlog.
      const next = pendingForegroundLoadRef.current
      if (next) {
        pendingForegroundLoadRef.current = null
        void refreshSelectedSessionDetail(next, true)
      }
    }
  }
}

export type RefreshSessionMetadataContext = {
  selectedSessionKeyRef: React.RefObject<string | null>
  runningSessionsRef: React.RefObject<RunningSessionRef[]>
  tabsEnabledRef: React.RefObject<boolean>
  openTabSessionsRef: React.RefObject<Session[]>
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

export function runRefreshSessionMetadata(ctx: RefreshSessionMetadataContext, session: Session, foreground?: boolean | undefined, detailSnapshot?: TuiSessionDetail, cachedDetailSnapshot?: TuiSessionDetail | null, includeContextUsage?: boolean) {
  const {
    selectedSessionKeyRef, runningSessionsRef, tabsEnabledRef, openTabSessionsRef,
    composerTargetSessionRef, sessionContextUsageCacheRef, sessionMetadataFetchedAtRef,
    sessionDetailCacheRef, sessionMetadataInFlightRef, setContextUsageStatus,
    setTuiReportedModelByKey, setContextUsage, setSessionDetail,
  } = ctx
  if (foreground === undefined) foreground = false
  if (includeContextUsage === undefined) includeContextUsage = true
  const cacheKey = sessionKey(session)
  const isSelectedTab = cacheKey === selectedSessionKeyRef.current
  const isRunningSession = runningSessionsRef.current.some((running) =>
    running.sessionId === session.sessionId && running.provider === (session.provider ?? 'claude'),
  )

  if (session.provider === 'claude') {
    const isPreviewingSession = tabsEnabledRef.current
      && !openTabSessionsRef.current.some((openSession) => sessionKey(openSession) === cacheKey)
    const activeComposerTarget = composerTargetSessionRef.current
    const isComposerTarget = Boolean(activeComposerTarget && sessionKey(activeComposerTarget) === cacheKey)
    if (isPreviewingSession && !isComposerTarget) return

    if (
      includeContextUsage
      && !isRunningSession
      && sessionContextUsageCacheRef.current.get(cacheKey)
    ) return
  }

  const metadataTtl = isSelectedTab
    ? (session.provider === 'claude' ? CLAUDE_METADATA_REFRESH_MS : DEFAULT_METADATA_REFRESH_MS)
    : (session.provider === 'claude' ? CLAUDE_BACKGROUND_METADATA_REFRESH_MS : DEFAULT_BACKGROUND_METADATA_REFRESH_MS)
  const lastMetadataFetch = sessionMetadataFetchedAtRef.current.get(cacheKey) ?? 0
  const hasCachedModel = Boolean(
    cachedDetailSnapshot?.info?.currentModel
    || detailSnapshot?.info?.currentModel
    || sessionDetailCacheRef.current.get(cacheKey)?.info?.currentModel
  )
  const hasCachedMetadata = hasCachedModel || (
    includeContextUsage && Boolean(sessionContextUsageCacheRef.current.get(cacheKey))
  )
  const metadataIsFresh = lastMetadataFetch > 0 && Date.now() - lastMetadataFetch < metadataTtl
  const shouldFetchMetadata = !sessionMetadataInFlightRef.current.has(cacheKey) && (
    !hasCachedMetadata && !metadataIsFresh
    || hasCachedMetadata && Date.now() - lastMetadataFetch >= metadataTtl
  )
  if (!shouldFetchMetadata) return

  sessionMetadataInFlightRef.current.add(cacheKey)
  if (includeContextUsage && foreground && isSelectedTab) {
    setContextUsageStatus('loading')
  }
  void Promise.race([
    readTuiSessionMetadataAsync(session),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), METADATA_REQUEST_TIMEOUT_MS)
    }),
  ])
    .then((metadata) => {
      // Metadata reads are session-scoped and may legitimately overlap (the
      // reader can show one session while the composer targets another pane).
      // A single global request id made the newer request discard the older
      // session's valid result, leaving that composer's chip on "loading".
      const isStillSelectedTab = cacheKey === selectedSessionKeyRef.current
      const pinnedKeys = new Set([
        ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
        selectedSessionKeyRef.current,
      ].filter((key): key is string => Boolean(key)))
      touchMapEntry(sessionMetadataFetchedAtRef.current, cacheKey, Date.now())
      const reportedModel = metadata?.currentModel ?? null
      setTuiReportedModelByKey((prev) => (
        Object.prototype.hasOwnProperty.call(prev, cacheKey) && prev[cacheKey] === reportedModel
          ? prev
          : { ...prev, [cacheKey]: reportedModel }
      ))
      if (!metadata) {
        pruneSessionCaches(
          sessionDetailCacheRef.current,
          sessionContextUsageCacheRef.current,
          sessionMetadataFetchedAtRef.current,
          pinnedKeys,
        )
        if (includeContextUsage && foreground && isStillSelectedTab) {
          startTransition(() => setContextUsageStatus('unavailable'))
        }
        return
      }
      startTransition(() => {
        if (includeContextUsage && metadata.contextUsage) {
          touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, metadata.contextUsage)
          if (isStillSelectedTab) {
            setContextUsage(metadata.contextUsage)
            setContextUsageStatus('ready')
          }
        }
        const currentModel = metadata.currentModel
        if (currentModel) {
          setSessionDetail((prev) => {
            if (!prev) return prev
            if (
              prev.info?.sessionId
              && prev.info.sessionId !== session.sessionId
            ) {
              return prev
            }
            if (!prev.info) return prev
            if (prev.info.currentModel === currentModel) return prev
            return {
              ...prev,
              info: {
                ...prev.info,
                currentModel,
              },
            }
          })
          const cached = sessionDetailCacheRef.current.get(cacheKey)
          if (cached?.info) {
            touchMapEntry(sessionDetailCacheRef.current, cacheKey, {
              ...cached,
              info: {
                ...cached.info,
                currentModel,
              },
            })
          }
        }
        pruneSessionCaches(
          sessionDetailCacheRef.current,
          sessionContextUsageCacheRef.current,
          sessionMetadataFetchedAtRef.current,
          pinnedKeys,
        )
        if (includeContextUsage && !metadata.contextUsage && isStillSelectedTab) {
          setContextUsageStatus('unavailable')
        }
      })
    })
    .catch(() => {
      setTuiReportedModelByKey((prev) => (
        Object.prototype.hasOwnProperty.call(prev, cacheKey) && prev[cacheKey] === null
          ? prev
          : { ...prev, [cacheKey]: null }
      ))
      if (includeContextUsage && foreground && cacheKey === selectedSessionKeyRef.current) {
        startTransition(() => setContextUsageStatus('unavailable'))
      }
    })
    .finally(() => {
      sessionMetadataInFlightRef.current.delete(cacheKey)
    })
}

export type RefreshSessionsContext = {
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
}

export async function runRefreshSessions(ctx: RefreshSessionsContext, nextProvider: ProviderSelection, preserveSelection?: boolean | undefined, foreground?: boolean) {
  const {
    sessionRequestRef, setLoadingSessions, setRefreshingSessions, providerSwitchRef, setError,
    providerInstanceIdRef, pendingInboxEditsRef, selectedSessionKeyRef, sessionsRef, setSessions,
    setSelectedSessionKey, openTabSessionsRef,
  } = ctx
  if (preserveSelection === undefined) preserveSelection = true
  if (foreground === undefined) foreground = true
  const requestId = ++sessionRequestRef.current
  let refreshingIndicatorTimer: ReturnType<typeof setTimeout> | null = null
  if (foreground) {
    setLoadingSessions(true)
    setRefreshingSessions(false)
  } else {
    // Most background refreshes are cache-hot and resolve within a frame.
    // Rendering the status label on and immediately off made that harmless
    // five-second poll contend with input and split-pane commits. Preserve
    // feedback for a genuinely slow refresh without making the fast path a
    // guaranteed pair of root renders.
    refreshingIndicatorTimer = setTimeout(() => {
      if (requestId === sessionRequestRef.current) setRefreshingSessions(true)
    }, 150)
  }
  if (!providerSwitchRef.current) setError(null)

  try {
    const nextSessions = withPendingInboxEdits(
      await readTuiSessionsAsync(nextProvider, providerInstanceIdRef.current ?? undefined),
      pendingInboxEditsRef.current,
    )
    if (requestId !== sessionRequestRef.current) return
    // Avoid scheduling a transition at all when a background poll returns
    // the same list and the current selection is still valid. React will
    // usually bail out from the state setters below, but the transition
    // itself still walks the root and can collide with a held sidebar key.
    const currentSelectedKey = selectedSessionKeyRef.current
    const selectionStillValid = currentSelectedKey === null
      ? nextSessions.length === 0
      : nextSessions.some((session) => sessionKey(session) === currentSelectedKey)
    if (!foreground && sessionsShallowEqual(sessionsRef.current, nextSessions) && selectionStillValid) return
    startTransition(() => {
      setSessions((prev) => sessionsShallowEqual(prev, nextSessions) ? prev : nextSessions)
      setSelectedSessionKey((current) => {
        // Draft sessions (pending provider sessions after N, or any session that's
        // been opened as a tab but not yet materialised server-side) live
        // in openTabSessions, not `sessions`. If we clobber a draft
        // selection here, pressing N silently lands the user on the first
        // server session instead of the new welcome tab.
        const isDraftTab = (key: string | null) => Boolean(
          key && openTabSessionsRef.current.some((tab) => sessionKey(tab) === key)
        )
        if (nextSessions.length === 0) {
          return isDraftTab(current) ? current : null
        }
        if (preserveSelection && current) {
          const matched = nextSessions.find((session) => sessionKey(session) === current)
          if (matched) return sessionKey(matched)
          if (isDraftTab(current)) return current
        }
        return sessionKey(nextSessions[0])
      })
    })
  } catch (err) {
    if (requestId !== sessionRequestRef.current) return
    setError(err instanceof Error ? err.message : 'Failed to load sessions')
    setSessions(keepEmpty)
    setSelectedSessionKey(null)
  } finally {
    if (refreshingIndicatorTimer) clearTimeout(refreshingIndicatorTimer)
    if (requestId === sessionRequestRef.current) {
      setLoadingSessions(false)
      setRefreshingSessions(false)
    }
  }
}

export type ReconcileSelectedRunningRegistryContext = {
  selectedSessionKeyRef: React.RefObject<string | null>
  ownsComposerStream: (key: string) => boolean
  awaitingPersistedTurnRef: React.MutableRefObject<boolean>
  reattachedRunningKeyRef: React.MutableRefObject<string | null>
  setReattachedRunning: React.Dispatch<React.SetStateAction<boolean>>
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
}

export function runReconcileSelectedRunningRegistry(ctx: ReconcileSelectedRunningRegistryContext, runningByKey: Map<string, RunningRegistryEntry>, ownedKey: string | null) {
  const {
    selectedSessionKeyRef, ownsComposerStream, awaitingPersistedTurnRef, reattachedRunningKeyRef,
    setReattachedRunning, setPendingPermissions, sessionsByKeyRef,
  } = ctx
  const selectedKey = selectedSessionKeyRef.current
  const selectedEntry = selectedKey ? runningByKey.get(selectedKey) : undefined
  const reattached = Boolean(selectedEntry) && !ownsComposerStream(selectedKey!) && !awaitingPersistedTurnRef.current
  reattachedRunningKeyRef.current = reattached && selectedKey ? selectedKey : null
  setReattachedRunning((prev) => (prev === reattached ? prev : reattached))

  if (!selectedKey || ownsComposerStream(selectedKey)) return
  if (selectedEntry) {
    // While idle for this session, the registry is authoritative for every
    // provider's still-answerable approvals/questions, not only Claude's.
    const permissionPayloads = selectedEntry.pendingPermissions.length > 0
      ? selectedEntry.pendingPermissions
      : selectedEntry.pendingPrompts.map((data) => ({
          type: 'claude_permission',
          event: { type: 'permission.requested', data },
        }))
    const prompts = extractPendingPermissions(permissionPayloads, selectedEntry)
    setPendingPermissions((prev) => {
      const others = prev.filter((p) => !(p.provider === selectedEntry.provider && p.sessionId === selectedEntry.sessionId))
      const next = [...others, ...prompts]
      return next.map((p) => p.id).join('|') === prev.map((p) => p.id).join('|') ? prev : next
    })
  } else if (!selectedEntry) {
    // No turn running for the selected session — drop any reattached prompt
    // left behind by a turn that ended or timed out unanswered.
    const selectedSessionForKey = sessionsByKeyRef.current.get(selectedKey)
    if (selectedSessionForKey) {
      setPendingPermissions((prev) => {
        const selectedProvider = selectedSessionForKey.provider ?? 'claude'
        const next = prev.filter((p) => !(p.provider === selectedProvider && p.sessionId === selectedSessionForKey.sessionId))
        return next.length === prev.length ? prev : next
      })
    }
  }
}

export type PersistReaderStateContext = {
  readerStateWriteTimeoutRef: React.RefObject<NodeJS.Timeout | null>
  selectedSessionKey: string | null
  restoredReaderState: { sessionKey: string | null; loaded: boolean; state: TuiSessionReaderState | null; }
  readTranscriptCursorKey: () => string | null
  followTail: boolean
  expandedKeysRevisionRef: React.RefObject<number>
  collapsedKeysRevisionRef: React.RefObject<number>
  readerStatePersistSignatureRef: React.RefObject<string | null>
  transcriptCards: TuiTranscriptCard[]
  expandedCardKeys: Set<string>
  collapsedCardKeys: Set<string>
  workspaceId: string
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function runPersistReaderState(ctx: PersistReaderStateContext) {
  const {
    readerStateWriteTimeoutRef, selectedSessionKey, restoredReaderState, readTranscriptCursorKey,
    followTail, expandedKeysRevisionRef, collapsedKeysRevisionRef, readerStatePersistSignatureRef,
    transcriptCards, expandedCardKeys, collapsedCardKeys, workspaceId, setError,
  } = ctx
  if (readerStateWriteTimeoutRef.current) {
    clearTimeout(readerStateWriteTimeoutRef.current)
    readerStateWriteTimeoutRef.current = null
  }
  if (!selectedSessionKey || !restoredReaderState.loaded || restoredReaderState.sessionKey !== selectedSessionKey) {
    return
  }
  const transcriptCursorKey = readTranscriptCursorKey()

  const persistSignature = [
    selectedSessionKey,
    followTail ? 'follow' : 'free',
    transcriptCursorKey ?? '',
    expandedKeysRevisionRef.current,
    collapsedKeysRevisionRef.current,
  ].join('|')
  if (readerStatePersistSignatureRef.current === persistSignature) return

  // Build the persist payload inside the debounce timer so the O(n) work
  // over transcriptCards + expanded/collapsed keys only runs once per pause
  // — not on every j/k keystroke. This was a visible hitch on large
  // sessions when rapidly navigating the cursor on Windows.
  readerStateWriteTimeoutRef.current = setTimeout(() => {
    const validKeys = new Set(transcriptCards.map((card) => card.key))
    const persistState: TuiSessionReaderState = {
      followTail,
      cursorKey: followTail ? null : (transcriptCursorKey && validKeys.has(transcriptCursorKey) ? transcriptCursorKey : null),
      topKey: null,
      expandedKeys: [...expandedCardKeys].filter((key) => validKeys.has(key)),
      collapsedKeys: [...collapsedCardKeys].filter((key) => validKeys.has(key)),
    }
    readerStatePersistSignatureRef.current = persistSignature
    void writeTuiSessionReaderState(workspaceStorageKey(workspaceId, selectedSessionKey), persistState).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store reader position')
    })
  }, 150)
}

export type StartFreshSessionContext = {
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setWorkspaceLaunched: React.Dispatch<React.SetStateAction<boolean>>
  newSessionBusy: boolean
  setNewSessionBusy: React.Dispatch<React.SetStateAction<boolean>>
  selectedSession: Session | null
  provider: ProviderSelection
  providerInstances: TuiProviderInstanceChoice[]
  providerInstanceId: string | null
  openCreatedSession: (draft: Session) => Promise<void>
  setNewSessionModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export async function runStartFreshSession(ctx: StartFreshSessionContext, targetProvider: AgentProvider, cwd: string) {
  const {
    setWorkspaceHasSession, setWorkspaceLaunched, newSessionBusy, setNewSessionBusy,
    selectedSession, provider, providerInstances, providerInstanceId, openCreatedSession,
    setNewSessionModalOpen, showNotice, setError,
  } = ctx
  setWorkspaceHasSession(true); setWorkspaceLaunched(true)
  if (newSessionBusy) return
  setNewSessionBusy(true)
  {
    try {
      // A new chat goes to the instance the list is narrowed to, else to the
      // one the selected session belongs to.
      const fromAgent = selectedSession?.provider === targetProvider ? selectedSession : null
      const pickedInstance = targetProvider === provider ? providerInstances.find((instance) => instance.providerInstanceId === providerInstanceId) : undefined
      const result = await createTuiSession({ provider: targetProvider, cwd, providerInstanceId: pickedInstance?.providerInstanceId ?? fromAgent?.providerInstanceId })
      await openCreatedSession({
        sessionId: result.sessionId,
        provider: result.provider,
        ...(result.providerInstanceId ? { providerInstanceId: result.providerInstanceId } : {}),
        ...(pickedInstance?.providerInstanceId === result.providerInstanceId ? { providerDisplayName: pickedInstance?.label } : fromAgent && fromAgent.providerInstanceId === result.providerInstanceId ? { providerDisplayName: fromAgent.providerDisplayName } : {}),
        cwd: result.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: 'New session',
        isPending: result.isPending,
      })
      setNewSessionModalOpen(false)
      showNotice('info', result.isPending
        ? `New ${formatProviderLabel(result.provider)} session ready — first message will create it.`
        : 'New session created.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setNewSessionBusy(false)
    }
  }
}
