/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type TuiDensity } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { attachedTranscriptCardsForVariant, formatTranscriptCardsAsync, getTranscriptCardsSync } from '../../sessionDetailWorkerClient'
import { type Session } from '../../../../lib/types'
import { type RefObject, type MutableRefObject } from 'react'
import { liveMessageSessionKey } from '../../liveTranscriptState'
import { type ThreadedMessage } from '../../../../lib/threading'
import { AWAITING_PERSISTED_TURN_TIMEOUT_MS } from '../timing'
import { keepFiltered } from '../collections'
import { visibleComposerMessages } from '../../../../lib/composerTranscript'
import { summarizeDurableSessionMessages } from '../../messageFingerprint'
import { hasLiveAssistantMessage, persistedTurnSettled, hasPersistedAssistantAfterBaseline, hasPersistedUserAfterBaseline } from '../liveStream'
import { sessionKey } from '../sessionList'

export type TranscriptCardsSyncEffectContext = {
  sessionDetail: TuiSessionDetail | null
  transcriptSession: Session | null
  density: TuiDensity
  showToolCalls: boolean
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setWorkerCardCacheVersion: React.Dispatch<React.SetStateAction<number>>
}

export function runTranscriptCardsSyncEffect(ctx: TranscriptCardsSyncEffectContext) {
  const {
    sessionDetail, transcriptSession, density, showToolCalls, setError, setWorkerCardCacheVersion,
  } = ctx
  if (!sessionDetail || !transcriptSession) return
  const attachedCardsMatch = attachedTranscriptCardsForVariant(sessionDetail, density, showToolCalls) !== null
  const cachedSync = getTranscriptCardsSync(
    transcriptSession,
    sessionDetail.threadedMessages,
    density,
    showToolCalls,
  )
  if (attachedCardsMatch || cachedSync) {
    setError((current) => current?.startsWith('Failed to format transcript') ? null : current)
    return
  }
  let cancelled = false
  setError((current) => current?.startsWith('Failed to format transcript') ? null : current)
  void formatTranscriptCardsAsync(
    transcriptSession,
    sessionDetail.threadedMessages,
    density,
    showToolCalls,
  ).then(() => {
    // Re-render so baseTranscriptCards picks the cards up from the sync
    // cache — required for over-SYNC_FORMAT_CARD_LIMIT sessions, which
    // render empty until this format lands.
    if (!cancelled) setWorkerCardCacheVersion((version) => version + 1)
  }).catch((cause) => {
    if (!cancelled) {
      setError(cause instanceof Error
        ? `Failed to format transcript: ${cause.message}`
        : 'Failed to format transcript')
    }
  })
  return () => {
    cancelled = true
  }
}

export type LiveOverlayTimeoutEffectContext = {
  awaitingPersistedTurn: boolean
  composerActivitySessionKey: string | null
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  liveToolIndexesRef: React.MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: React.MutableRefObject<Map<number, string>>
  setComposerLiveText: React.Dispatch<React.SetStateAction<string>>
  setAwaitingPersistedTurn: React.Dispatch<React.SetStateAction<boolean>>
}

export function runLiveOverlayTimeoutEffect(ctx: LiveOverlayTimeoutEffectContext) {
  const {
    awaitingPersistedTurn, composerActivitySessionKey, liveTranscriptBaselineRef,
    setLiveTranscriptMessages, liveToolIndexesRef, liveToolInputJsonRef, setComposerLiveText,
    setAwaitingPersistedTurn,
  } = ctx
  if (!awaitingPersistedTurn) return
  const timer = setTimeout(() => {
    const key = composerActivitySessionKey
    if (key) {
      liveTranscriptBaselineRef.current.delete(key)
      setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== key))
    }
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    setComposerLiveText('')
    setAwaitingPersistedTurn(false)
  }, AWAITING_PERSISTED_TURN_TIMEOUT_MS)
  return () => clearTimeout(timer)
}

export type LiveTranscriptOverlayEffectContext = {
  selectedSessionTarget: Session | null
  sessionDetail: TuiSessionDetail | null
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  composerLiveText: string
  liveTranscriptMessages: ThreadedMessage[]
  liveTranscriptMessagesForSession: ThreadedMessage[]
  awaitingPersistedTurn: boolean
  ownsComposerStream: (key: string) => boolean
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  persistedComposerMessages: { ids: Set<string>; recentUsers: ThreadedMessage[]; }
  liveToolIndexesRef: React.MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: React.MutableRefObject<Map<number, string>>
  setComposerLiveText: React.Dispatch<React.SetStateAction<string>>
  setAwaitingPersistedTurn: React.Dispatch<React.SetStateAction<boolean>>
}

export function runLiveTranscriptOverlayEffect(ctx: LiveTranscriptOverlayEffectContext) {
  const {
    selectedSessionTarget, sessionDetail, liveTranscriptBaselineRef, composerLiveText,
    liveTranscriptMessages, liveTranscriptMessagesForSession, awaitingPersistedTurn, ownsComposerStream,
    setLiveTranscriptMessages, persistedComposerMessages, liveToolIndexesRef, liveToolInputJsonRef,
    setComposerLiveText, setAwaitingPersistedTurn,
  } = ctx
  if (!selectedSessionTarget || !sessionDetail) return
  const key = sessionKey(selectedSessionTarget)
  const baseline = liveTranscriptBaselineRef.current.get(key)
  if (!baseline) return
  const durableSummary = summarizeDurableSessionMessages(sessionDetail.rawMessages)
  const persistedTurnArrived =
    durableSummary.count > baseline.count
    || durableSummary.lastFingerprint !== baseline.lastFingerprint
    || durableSummary.sequenceFingerprint !== baseline.sequenceFingerprint
  if (!persistedTurnArrived) return
  const liveAssistantVisible = Boolean(composerLiveText.trim())
    || hasLiveAssistantMessage(liveTranscriptMessagesForSession, key)
  const turnLanded = awaitingPersistedTurn
    ? persistedTurnSettled(sessionDetail.rawMessages, baseline.count)
    : hasPersistedAssistantAfterBaseline(sessionDetail.rawMessages, baseline.count)
  // See refreshSelectedSessionDetail: never finalize under a live stream.
  const streamStillOwned = ownsComposerStream(key)
  if (streamStillOwned || (liveAssistantVisible && !turnLanded)) {
    // The assistant is still streaming. Swap the live user echo for the real
    // persisted row ONLY once that row has actually landed as a durable
    // message — `persistedTurnArrived` is a coarse change signal (count OR
    // fingerprint OR sequence), so removing the echo on any change can drop
    // the user's message before its persisted card exists, leaving a
    // poll-timed gap until the assistant finishes. Keep the echo until the
    // persisted user message is genuinely present (which also avoids a
    // duplicate, since echo and persisted row have different uuids).
    // Guard before dispatching from a layout effect. A no-op updater can still
    // participate in nested React commits when other effects update state.
    // Check the unfiltered overlay: the visible snapshot already hides echoes.
    if (hasPersistedUserAfterBaseline(sessionDetail.rawMessages, baseline.count)
      && visibleComposerMessages(liveTranscriptMessages, persistedComposerMessages).length < liveTranscriptMessages.length) {
      setLiveTranscriptMessages((prev) => {
        const next = visibleComposerMessages(prev, persistedComposerMessages)
        return next.length === prev.length ? prev : next
      })
    }
    return
  }

  liveTranscriptBaselineRef.current.delete(key)
  setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== key))
  liveToolIndexesRef.current.clear()
  liveToolInputJsonRef.current.clear()
  setComposerLiveText('')
  setAwaitingPersistedTurn(false)
}
