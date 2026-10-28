/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import React, { useMemo, useState } from 'react'
import { buildTaskActiveForms, formatTranscriptCard, type TuiTranscriptCard } from '../../../format'
import { stripToolCallBlocks, type ThreadedMessage } from '../../../../lib/threading'
import { buildTaskRegistry } from '../../../../lib/taskRegistry'
import { type TuiDensity, type TuiTranscriptView } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type Session } from '../../../../lib/types'
import { isLiveAssistantTextMessage } from '../liveStream'
import { sessionKey } from '../sessionList'
import { visibleCardsForTranscriptView } from '../transcriptRows'
import { runTranscriptCards, runBaseTranscriptCards } from '../derived/transcriptCards'

export type UseTaskPanelMessagesGroupContext = {
  sessionDetail: TuiSessionDetail | null
  liveTranscriptMessagesForSession: ThreadedMessage[]
  transcriptSession: Session | null
  density: TuiDensity
  showToolCalls: boolean
  bridgeTranscriptEntries: { kind: 'sent' | 'reply'; text: string; timestamp: string; }[]
  selectedSessionTarget: Session | null
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  transcriptView: TuiTranscriptView
  isChatLikeView: boolean
}

export function useTaskPanelMessagesGroup(ctx: UseTaskPanelMessagesGroupContext) {
  const {
    sessionDetail, liveTranscriptMessagesForSession, transcriptSession, density, showToolCalls,
    bridgeTranscriptEntries, selectedSessionTarget, liveTranscriptBaselineRef, transcriptView,
    isChatLikeView,
  } = ctx

  const taskPanelMessages = useMemo(() => {
    const persisted = sessionDetail?.threadedMessages ?? []
    const live = liveTranscriptMessagesForSession
    if (live.length === 0) return persisted
    const seen = new Set(live.map((m) => m.uuid))
    return [...live, ...persisted.filter((m) => !seen.has(m.uuid))]
  }, [sessionDetail?.threadedMessages, liveTranscriptMessagesForSession])
  const liveAssistantTextCardVisible = useMemo(
    () => liveTranscriptMessagesForSession.some(isLiveAssistantTextMessage),
    [liveTranscriptMessagesForSession],
  )

  // Card formatting runs in the threading worker. The worker client keeps only
  // the most recent card variant; if it has been evicted, this render path can
  // still format synchronously from the already-threaded messages.
  // ── Base card computation — NOT dependent on live messages ────────────────
  // Separating base from the live overlay is the key perf fix: streaming deltas
  // change only liveTranscriptMessagesForSession, so this memo is stable for
  // the entire duration of a streaming turn. Before the split, every delta
  // triggered a full O(N_base) rebuild: buildTaskActiveForms/buildTaskRegistry
  // over all base messages + formatTranscriptCard × N_base on the main thread
  // (60–800ms per delta for a 63–136 card session). Now that work runs only
  // when sessionDetail/density/showToolCalls actually change.
  // Bumped when the warm-cache effect finishes an off-thread format, so the
  // memo below re-runs its (now-hitting) sync cache lookup. Only relevant for
  // sessions above SYNC_FORMAT_CARD_LIMIT, where the main-thread fallback is
  // skipped.
  const [workerCardCacheVersion, setWorkerCardCacheVersion] = useState(0)
  const baseTranscriptCards = useMemo(() => runBaseTranscriptCards({
    transcriptSession, sessionDetail, density, showToolCalls,
  }), [density, sessionDetail, transcriptSession, showToolCalls, workerCardCacheVersion])

  // ── Task context for live cards — stable across streaming deltas ───────────
  // buildTaskActiveForms and buildTaskRegistry scan the full base transcript.
  // Memoizing them separately ensures the O(N_base) scan runs at most once per
  // sessionDetail update (2s poll cadence), never per streamed token.
  // Live messages occasionally contain TaskCreate/TaskUpdate calls; their task
  // events appear in the persisted transcript (and therefore here) on the next
  // poll, which is the correct behaviour — the live overlay is ephemeral.
  // Only the live/bridge overlay cards consume this context (base cards are
  // formatted in the worker), so skip the two O(N_base) scans entirely when no
  // overlay exists — i.e. on every settled scrub/open of an idle session.
  const hasTranscriptOverlay = liveTranscriptMessagesForSession.length > 0 || bridgeTranscriptEntries.length > 0
  const baseTaskContext = useMemo(() => {
    if (!sessionDetail || !hasTranscriptOverlay) return { activeForms: new Map() as ReturnType<typeof buildTaskActiveForms>, taskRegistry: new Map() as ReturnType<typeof buildTaskRegistry> }
    const filtered = showToolCalls
      ? sessionDetail.threadedMessages
      : stripToolCallBlocks(sessionDetail.threadedMessages)
    return {
      activeForms: buildTaskActiveForms(filtered),
      taskRegistry: buildTaskRegistry(filtered),
    }
  }, [sessionDetail, hasTranscriptOverlay, showToolCalls])
  const liveTurnStartedAt = selectedSessionTarget
    ? liveTranscriptBaselineRef.current.get(sessionKey(selectedSessionTarget))?.startedAt
    : undefined

  // Bridge entries change rarely compared with streamed assistant deltas.
  // Format and interleave them with the persisted transcript separately so a
  // token update does not rebuild bridge cards or sort all N persisted cards.
  const baseAndBridgeTranscriptCards = useMemo<TuiTranscriptCard[]>(() => {
    if (bridgeTranscriptEntries.length === 0) return baseTranscriptCards
    const bridgeCards: TuiTranscriptCard[] = bridgeTranscriptEntries.map((entry, i) => {
      const bridgeMessage: ThreadedMessage = {
        role: entry.kind === 'sent' ? 'user' : 'assistant',
        uuid: `bridge-${i}`,
        timestamp: entry.timestamp,
        origin: { kind: 'bridge' },
        blocks: [{ type: 'text', text: entry.text }],
      }
      return {
        ...formatTranscriptCard(bridgeMessage, density, baseTaskContext.activeForms, baseTaskContext.taskRegistry),
        key: `bridge:${i}`,
      }
    })
    return [...baseTranscriptCards, ...bridgeCards]
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
  }, [baseTaskContext, baseTranscriptCards, bridgeTranscriptEntries, density])

  const latestBaseAndBridgeTimestamp = useMemo(
    () => baseAndBridgeTranscriptCards.reduce(
      (latest, card) => Math.max(latest, card.timestampMs ?? 0),
      0,
    ),
    [baseAndBridgeTranscriptCards],
  )

  // ── Live overlay — O(N_live) per delta, base cards always cache-hit ────────
  const transcriptCards = useMemo(() => runTranscriptCards({
    liveTranscriptMessagesForSession, baseAndBridgeTranscriptCards, showToolCalls,
    liveTurnStartedAt, latestBaseAndBridgeTimestamp, density, baseTaskContext,
  }), [baseAndBridgeTranscriptCards, baseTaskContext, density, latestBaseAndBridgeTimestamp, liveTranscriptMessagesForSession, liveTurnStartedAt, showToolCalls])

  // Continue is prose-only. Stream mirrors native agent CLIs: conversation plus
  // compact operational rows, while low-level system bookkeeping stays hidden.
  const groupedToolView = transcriptView === 'agents' || isChatLikeView
  const visibleTranscriptCards = useMemo(
    () => visibleCardsForTranscriptView(transcriptCards, transcriptView),
    [transcriptCards, transcriptView],
  )

  return {
    taskPanelMessages, liveAssistantTextCardVisible, setWorkerCardCacheVersion,
    baseAndBridgeTranscriptCards, transcriptCards, groupedToolView, visibleTranscriptCards,
  }
}
