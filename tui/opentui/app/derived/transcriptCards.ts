/** @jsxImportSource @opentui/react */
import { logCardRecompute } from '../../metricsLogger'
import { buildTaskActiveForms, formatTranscriptCard, type TuiTranscriptCard } from '../../../format'
import { stripToolCallBlocks, type ThreadedMessage } from '../../../../lib/threading'
import { buildTaskRegistry } from '../../../../lib/taskRegistry'
import { type TuiDensity } from '../../../theme'
import { CARD_PROFILE } from '../perf'
import { isLiveAssistantTextMessage } from '../liveStream'
import { computeTurnDurationsMs } from '../../../../lib/threading'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { attachedTranscriptCardsForVariant, getTranscriptCardsSync } from '../../sessionDetailWorkerClient'
import { type Session } from '../../../../lib/types'
import { SYNC_FORMAT_CARD_LIMIT } from '../timing'

export type TranscriptCardsContext = {
  liveTranscriptMessagesForSession: ThreadedMessage[]
  baseAndBridgeTranscriptCards: TuiTranscriptCard[]
  showToolCalls: boolean
  liveTurnStartedAt: number | undefined
  latestBaseAndBridgeTimestamp: number
  density: TuiDensity
  baseTaskContext: { activeForms: ReturnType<typeof buildTaskActiveForms>; taskRegistry: ReturnType<typeof buildTaskRegistry>; }
}

export function runTranscriptCards(ctx: TranscriptCardsContext) {
  const {
    liveTranscriptMessagesForSession, baseAndBridgeTranscriptCards, showToolCalls,
    liveTurnStartedAt, latestBaseAndBridgeTimestamp, density, baseTaskContext,
  } = ctx
  const profileStart = CARD_PROFILE ? performance.now() : 0
  // No live overlay (the common case while browsing/scrubbing): return the
  // stable persisted/bridge array as-is. Skipping the copy + sort keeps array
  // identity stable so every downstream per-card WeakMap cache keeps hitting.
  if (liveTranscriptMessagesForSession.length === 0) {
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'transcriptCards',
        totalCards: baseAndBridgeTranscriptCards.length,
        recomputed: 0,
        liveCards: 0,
        durationMs: performance.now() - profileStart,
      })
    }
    return baseAndBridgeTranscriptCards
  }
  const liveMessages = showToolCalls
    ? liveTranscriptMessagesForSession
    : stripToolCallBlocks(liveTranscriptMessagesForSession)
  const liveTimestampBase = liveTurnStartedAt ?? latestBaseAndBridgeTimestamp + 1
  const liveCards = liveMessages.map((message, index) => {
    const timestampedMessage = message.timestamp
      ? message
      : { ...message, timestamp: new Date(liveTimestampBase + index).toISOString() }
    const formatted = formatTranscriptCard(
      timestampedMessage,
      density,
      baseTaskContext.activeForms,
      baseTaskContext.taskRegistry,
    )
    return {
      ...formatted,
      // Live prose changes every few milliseconds. Render its already-
      // formatted text lines synchronously while it grows; the markdown
      // renderer is intentionally restored when the durable card replaces
      // this overlay, avoiding a blank async-markdown frame per new block.
      markdownContent: isLiveAssistantTextMessage(message) ? undefined : formatted.markdownContent,
      key: `live:${message.uuid}`,
    }
  })

  // Live turns normally follow every persisted/bridge card. Preserve the
  // existing append order without scanning and sorting the live suffix on
  // every streamed token; the provider's live sequence is already ordered.
  const sortedCards = [...baseAndBridgeTranscriptCards, ...liveCards]

  if (CARD_PROFILE) {
    logCardRecompute({
      scope: 'transcriptCards',
      totalCards: sortedCards.length,
      recomputed: liveCards.length,
      liveCards: liveCards.length,
      durationMs: performance.now() - profileStart,
    })
  }
  return sortedCards
}

export type BaseTranscriptCardsContext = {
  transcriptSession: Session | null
  sessionDetail: TuiSessionDetail | null
  density: TuiDensity
  showToolCalls: boolean
}

export function runBaseTranscriptCards(ctx: BaseTranscriptCardsContext) {
  const {
    transcriptSession, sessionDetail, density, showToolCalls,
  } = ctx
  const profileStart = CARD_PROFILE ? performance.now() : 0
  if (!transcriptSession || !sessionDetail) return []
  let cards: TuiTranscriptCard[]
  let recomputed = 0
  const attachedCards = attachedTranscriptCardsForVariant(sessionDetail, density, showToolCalls)
  const cachedSync = attachedCards ?? getTranscriptCardsSync(
    transcriptSession,
    sessionDetail.threadedMessages,
    density,
    showToolCalls,
  )
  if (cachedSync) {
    cards = cachedSync
  } else if (sessionDetail.threadedMessages.length > SYNC_FORMAT_CARD_LIMIT) {
    // Too large to format on the render thread (this path is a multi-second
    // freeze on big sessions). The warm-cache effect below formats in the
    // worker and bumps workerCardCacheVersion when the cards are ready.
    cards = []
  } else {
    const filtered = showToolCalls
      ? sessionDetail.threadedMessages
      : stripToolCallBlocks(sessionDetail.threadedMessages)
    const activeForms = buildTaskActiveForms(filtered)
    const taskRegistry = buildTaskRegistry(filtered)
    const durations = computeTurnDurationsMs(filtered)
    cards = filtered.map((msg) => formatTranscriptCard(msg, density, activeForms, taskRegistry, durations.get(msg.uuid)))
    recomputed = cards.length
  }
  if (CARD_PROFILE) {
    logCardRecompute({
      scope: 'transcriptCards',
      totalCards: cards.length,
      recomputed,
      liveCards: 0,
      durationMs: performance.now() - profileStart,
    })
  }
  return cards
}
