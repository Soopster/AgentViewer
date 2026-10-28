import type { ComposerSessions } from '../../../lib/composerSessions'
import { useState, useRef, useCallback } from 'react'
import { type ThreadedMessage } from '@/lib/threading'
import { type PendingPermission } from '@/lib/permissions'
import { useComposerSessionState } from '@/lib/composerSessions'
import { type LiveToolActivity } from '../types'
import { TIMELINE_SCROLL_COMMIT_PX, readPersistedSentHistory } from '../constants'

export type UseLiveAssistantTextGroupContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function useLiveAssistantTextGroup(ctx: UseLiveAssistantTextGroupContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  const [liveAssistantText, setLiveAssistantText] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveAssistantText', '')
  // Reasoning/thinking streams on its own channel so it renders as a distinct
  // dim block above the answer (like the native CLIs) instead of being folded
  // into the reply text.
  const [liveReasoningText, setLiveReasoningText] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveReasoningText', '')
  // Live estimate of thinking tokens for the current turn, streamed by the SDK
  // as `thinking_tokens` system messages. Surfaced on the THINKING preview only.
  const [liveThinkingTokens, setLiveThinkingTokens] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveThinkingTokens', 0)
  const [liveToolActivities, setLiveToolActivities] = useComposerSessionState<LiveToolActivity[]>(composerSessions, composerOwnerKey, 'liveToolActivities', [])
  const [liveThreadedMessages, setLiveThreadedMessages] = useComposerSessionState<ThreadedMessage[]>(composerSessions, composerOwnerKey, 'liveThreadedMessages', [])
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useComposerSessionState(composerSessions, composerOwnerKey, 'awaitingPersistedTurn', false)
  const [autoFollow, setAutoFollow] = useState(false)
  // Approximate: may trail the live node.scrollTop by up to
  // TIMELINE_SCROLL_COMMIT_PX during user scrolls (see
  // commitTimelineScrollTopIfDrifted). Consumers needing the exact position
  // must read timelineRef.current.scrollTop.
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  // Last scrollTop actually committed to state. All commits flow through
  // commitTimelineScrollTop so quantized paths (RAF scroll handler, streaming
  // pin) can measure their drift against it. See TIMELINE_SCROLL_COMMIT_PX.
  const committedScrollTopRef = useRef(0)
  const commitTimelineScrollTop = useCallback((value: number) => {
    committedScrollTopRef.current = value
    setTimelineScrollTop(value)
  }, [])
  // Quantized commit for high-frequency paths (RAF scroll handler, streaming
  // pin): only re-render when the position has drifted far enough to matter
  // for the virtual window, which overscans well beyond the threshold.
  const commitTimelineScrollTopIfDrifted = useCallback((value: number) => {
    if (Math.abs(value - committedScrollTopRef.current) >= TIMELINE_SCROLL_COMMIT_PX) {
      commitTimelineScrollTop(value)
    }
  }, [commitTimelineScrollTop])
  // Fast-scroll mode: while the gesture outruns FAST_SCROLL_ENTER_PX_PER_S,
  // rows entering the window render as placeholders. See the constant's doc.
  const [fastScrolling, setFastScrolling] = useState(false)
  const fastScrollingRef = useRef(false)
  const scrollVelocitySampleRef = useRef<{ top: number; time: number } | null>(null)
  const setFastScrollingMode = useCallback((value: boolean) => {
    if (fastScrollingRef.current === value) return
    fastScrollingRef.current = value
    setFastScrolling(value)
  }, [])
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0)
  const [timelineHeightOverride, setTimelineHeightOverride] = useState<number | null>(null)
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  // Bumps only when a PERSISTED row's measured height changes (or rows reset),
  // never on live-row height growth. Keys the persisted base layout so a
  // streaming turn doesn't rebuild the whole transcript layout each frame.
  const [persistedMeasurementVersion, setPersistedMeasurementVersion] = useState(0)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<string[]>(readPersistedSentHistory)
  const sentHistoryRef = useRef(sentHistory)

  return {
    liveAssistantText, setLiveAssistantText, liveReasoningText, setLiveReasoningText,
    liveThinkingTokens, setLiveThinkingTokens, liveToolActivities, setLiveToolActivities,
    liveThreadedMessages, setLiveThreadedMessages, pendingPermissions, setPendingPermissions,
    awaitingPersistedTurn, setAwaitingPersistedTurn, autoFollow, setAutoFollow, timelineScrollTop,
    commitTimelineScrollTop, commitTimelineScrollTopIfDrifted, fastScrolling,
    scrollVelocitySampleRef, setFastScrollingMode, timelineViewportHeight,
    setTimelineViewportHeight, timelineHeightOverride, setTimelineHeightOverride,
    rowMeasurementVersion, setRowMeasurementVersion, persistedMeasurementVersion,
    setPersistedMeasurementVersion, highlightedMessageId, setHighlightedMessageId, sentHistory,
    setSentHistory, sentHistoryRef,
  }
}
