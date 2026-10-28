import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { extractPendingPermissions, type PendingPermission } from '@/lib/permissions'
import { REATTACH_POLL_MS } from '../constants'
import { type ThreadedMessage } from '@/lib/threading'
import { type PendingMessageBaseline, type SteeredSendEntry, type LiveToolActivity } from '../types'
import { AWAITING_PERSISTED_TURN_TIMEOUT_MS } from '../constants'
import { type SessionMessage } from '../../../lib/types'
import { isDurableSessionMessage, sessionMessageFingerprint, messagesChangedSinceBaseline } from '../threadedCompare'
import { type RefObject } from 'react'
import { type SendState, type ContextUsage, type SessionComposerOptions, type SessionDiagnosticSection, type SendAttachment, type ReasoningEffortLevel } from '@/lib/types'
import { type IncrementalThreadingCache } from '@/lib/threading'
import { type TimelineScrollAnchor } from '@/lib/timelineVirtualizer'
import { type TimelineEstimateBucket, type TimelineEstimateCalibration, type FailedSend, type RewindPreview, type RollbackPreview, type TimelineEstimateSample } from '../types'
import { readJsonResponse } from '@/lib/httpResponse'
import { type GitSummary } from '@/lib/gitProvider'
import { COMPOSER_GIT_SUMMARY_POLL_MS } from '../constants'
import { gitSummariesMatch } from '../composerUi'

export type ReattachRunningEffectContext = {
  session: Session | null
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; } | undefined
  setReattachedRunning: Dispatch<SetStateAction<boolean>>
  setRunningProbeReadyKey: Dispatch<SetStateAction<string | null>>
  sendInFlightRef: MutableRefObject<boolean>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  reattachedRunningRef: MutableRefObject<boolean>
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
}

export function runReattachRunningEffect(ctx: ReattachRunningEffectContext) {
  const {
    session, projectView, setReattachedRunning, setRunningProbeReadyKey, sendInFlightRef,
    awaitingPersistedTurnRef, reattachedRunningRef, setPendingPermissions,
  } = ctx
  if (!session || projectView) {
    setReattachedRunning(false)
    setRunningProbeReadyKey(null)
    return
  }
  const sessionId = session.sessionId
  const sessionProvider = session.provider ?? 'claude'
  const probeKey = `${sessionProvider}:${sessionId}`
  setRunningProbeReadyKey(null)
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const poll = async () => {
    if (cancelled) return
    // We own a live turn already — the stream renders it; don't double-track.
    if (sendInFlightRef.current || awaitingPersistedTurnRef.current) {
      if (reattachedRunningRef.current) setReattachedRunning(false)
      timer = setTimeout(poll, REATTACH_POLL_MS)
      return
    }
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/running`, { cache: 'no-store' })
      if (!cancelled && res.ok) {
        const info = (await res.json().catch(() => null)) as
          | {
              running?: boolean
              pendingPrompts?: Record<string, unknown>[]
              pendingPermissions?: Record<string, unknown>[]
            }
          | null
        if (cancelled) return
        const running = info?.running === true
        setReattachedRunning((prev) => (prev === running ? prev : running))
        setRunningProbeReadyKey(probeKey)
        // Re-surface any provider-native approval/question the turn is
        // blocked on. The original SSE may be gone after reload/navigation,
        // but the process-local resolver remains answerable by id.
        const permissionPayloads = Array.isArray(info?.pendingPermissions)
          ? info.pendingPermissions
          : (Array.isArray(info?.pendingPrompts) ? info.pendingPrompts : []).map((data) => ({
              type: 'claude_permission',
              event: { type: 'permission.requested', data },
            }))
        const reattached = extractPendingPermissions(permissionPayloads, {
          sessionId,
          provider: sessionProvider,
        })
        setPendingPermissions((prev) => {
          const others = prev.filter((p) => !(p.provider === sessionProvider && p.sessionId === sessionId))
          const nextIds = [...others, ...reattached].map((p) => p.id).join('|')
          const prevIds = prev.map((p) => p.id).join('|')
          return nextIds === prevIds ? prev : [...others, ...reattached]
        })
      }
    } catch {
      // best-effort; a failed probe just leaves the prior state
    }
    if (!cancelled) timer = setTimeout(poll, REATTACH_POLL_MS)
  }
  void poll()
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}

export type OptimisticTextTimeoutEffectContext = {
  awaitingPersistedTurn: boolean
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  clearLiveSubagentText: () => void
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
}

export function runOptimisticTextTimeoutEffect(ctx: OptimisticTextTimeoutEffectContext) {
  const {
    awaitingPersistedTurn, setOptimisticUserText, setSteeredUserTexts, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    awaitingPersistedTurnRef, setAwaitingPersistedTurn, pendingMessageBaselineRef,
    liveToolIndexesRef, liveToolInputJsonRef,
  } = ctx
  if (!awaitingPersistedTurn) return
  const timer = window.setTimeout(() => {
    setOptimisticUserText(null)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    clearLiveSubagentText()
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
  }, AWAITING_PERSISTED_TURN_TIMEOUT_MS)
  return () => window.clearTimeout(timer)
}

export type OptimisticTextEffectContext = {
  awaitingPersistedTurn: boolean
  session: Session | null
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  messages: SessionMessage[]
  liveAssistantTextRef: MutableRefObject<string>
  liveThreadedMessages: ThreadedMessage[]
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  clearLiveSubagentText: () => void
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
  autoFollow: boolean
  scrollTimelineToBottom: (behavior?: ScrollBehavior) => void
}

export function runOptimisticTextEffect(ctx: OptimisticTextEffectContext) {
  const {
    awaitingPersistedTurn, session, pendingMessageBaselineRef, messages, liveAssistantTextRef,
    liveThreadedMessages, setOptimisticUserText, setSteeredUserTexts, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    awaitingPersistedTurnRef, setAwaitingPersistedTurn, liveToolIndexesRef, liveToolInputJsonRef,
    autoFollow, scrollTimelineToBottom,
  } = ctx
  if (!awaitingPersistedTurn || !session) return

  const baseline = pendingMessageBaselineRef.current
  if (!baseline || baseline.sessionId !== session.sessionId) return

  const durableMessages = messages.filter(isDurableSessionMessage)
  const currentLastMessage = durableMessages.at(-1)
  const currentLastUuid = currentLastMessage?.uuid ?? null
  const currentLastFingerprint = sessionMessageFingerprint(currentLastMessage)
  const changedMessages = messagesChangedSinceBaseline(durableMessages, baseline)
  const persistedTurnArrived =
    changedMessages.length > 0
    || durableMessages.length !== baseline.count
    || currentLastUuid !== baseline.lastUuid
    || currentLastFingerprint !== baseline.lastFingerprint
  const persistedAssistantArrived = changedMessages.some((message) => message.type === 'assistant')
  const liveAssistantVisible = liveAssistantTextRef.current.trim().length > 0 || liveThreadedMessages.length > 0

  if (persistedTurnArrived && (persistedAssistantArrived || !liveAssistantVisible)) {
    setOptimisticUserText(null)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    clearLiveSubagentText()
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    if (autoFollow) {
      window.requestAnimationFrame(() => scrollTimelineToBottom())
    }
  }
}

export type SessionResetEffectContext = {
  liveTurnSessionHandoffRef: MutableRefObject<string | null>
  session: Session | null
  sendInFlightRef: MutableRefObject<boolean>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setContextUsage: Dispatch<SetStateAction<ContextUsage | null>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  setResumeFromMessageId: Dispatch<SetStateAction<string | null>>
  setRewindPreview: Dispatch<SetStateAction<RewindPreview | null>>
  setRollbackPreview: Dispatch<SetStateAction<RollbackPreview | null>>
  setShowDiagnostics: Dispatch<SetStateAction<boolean>>
  setDiagnosticSections: Dispatch<SetStateAction<SessionDiagnosticSection[]>>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  setAttachmentPath: Dispatch<SetStateAction<string>>
  setSelectedEffort: Dispatch<SetStateAction<ReasoningEffortLevel | 'auto'>>
  setSelectedAgent: Dispatch<SetStateAction<string>>
  setSelectedCopilotMode: Dispatch<SetStateAction<string>>
  setComposerOptions: Dispatch<SetStateAction<SessionComposerOptions>>
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  clearLiveSubagentText: () => void
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  setSendState: Dispatch<SetStateAction<SendState>>
  setSendError: Dispatch<SetStateAction<string | null>>
  setFailedSend: Dispatch<SetStateAction<FailedSend | null>>
  setAutoFollow: Dispatch<SetStateAction<boolean>>
  commitTimelineScrollTop: (value: number) => void
  setTimelineViewportHeight: Dispatch<SetStateAction<number>>
  rowHeightsRef: { current: Map<string, number>; }
  timelineEstimateCalibrationRef: { current: Map<TimelineEstimateBucket | 'all', TimelineEstimateCalibration>; }
  timelineEstimateSamplesRef: { current: Map<string, TimelineEstimateSample>; }
  timelineEstimateCalibrationFrozenRef: RefObject<boolean>
  threadedCacheRef: { current: Map<string, ThreadedMessage>; }
  prevThreadingRef: RefObject<IncrementalThreadingCache | null>
  pendingRowMeasurementsRef: { current: Map<string, number>; }
  pendingTimelineScrollCompensationRef: RefObject<number>
  pendingMountedAnchorCaptureRef: RefObject<boolean>
  measurementFrameRef: RefObject<number | null>
  timelineHeightOverrideRef: RefObject<number | null>
  wheelScrollCompensationUntilRef: RefObject<number>
  activeTimelineScrollAnchorRef: RefObject<TimelineScrollAnchor | null>
  pendingTimelineAnchorRestoreRef: RefObject<boolean>
  setTimelineHeightOverride: Dispatch<SetStateAction<number | null>>
  setRowMeasurementVersion: Dispatch<SetStateAction<number>>
  setPersistedMeasurementVersion: Dispatch<SetStateAction<number>>
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
  initialScrollDoneRef: RefObject<boolean>
}

export function runSessionResetEffect(ctx: SessionResetEffectContext) {
  const {
    liveTurnSessionHandoffRef, session, sendInFlightRef, awaitingPersistedTurnRef, setContextUsage,
    setSessionActionError, setSessionActionNotice, setResumeFromMessageId, setRewindPreview,
    setRollbackPreview, setShowDiagnostics, setDiagnosticSections, setAttachments,
    setAttachmentPath, setSelectedEffort, setSelectedAgent, setSelectedCopilotMode,
    setComposerOptions, setPendingPermissions, setOptimisticUserText, setSteeredUserTexts,
    clearLiveAssistantText, setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    setAwaitingPersistedTurn, setSendState, setSendError, setFailedSend, setAutoFollow,
    commitTimelineScrollTop, setTimelineViewportHeight, rowHeightsRef,
    timelineEstimateCalibrationRef, timelineEstimateSamplesRef,
    timelineEstimateCalibrationFrozenRef, threadedCacheRef, prevThreadingRef,
    pendingRowMeasurementsRef, pendingTimelineScrollCompensationRef,
    pendingMountedAnchorCaptureRef, measurementFrameRef, timelineHeightOverrideRef,
    wheelScrollCompensationUntilRef, activeTimelineScrollAnchorRef,
    pendingTimelineAnchorRestoreRef, setTimelineHeightOverride, setRowMeasurementVersion,
    setPersistedMeasurementVersion, pendingMessageBaselineRef, liveToolIndexesRef,
    liveToolInputJsonRef, initialScrollDoneRef,
  } = ctx
  const handoffSessionId = liveTurnSessionHandoffRef.current
  if (
    handoffSessionId
    && session?.sessionId === handoffSessionId
    && (sendInFlightRef.current || awaitingPersistedTurnRef.current)
  ) {
    liveTurnSessionHandoffRef.current = null
    return
  }
  liveTurnSessionHandoffRef.current = null
  if (!sendInFlightRef.current && !awaitingPersistedTurnRef.current) {
    setContextUsage(null)
    setSessionActionError(null)
    setSessionActionNotice(null)
    setResumeFromMessageId(null)
    setRewindPreview(null)
    setRollbackPreview(null)
    setShowDiagnostics(false)
    setDiagnosticSections([])
    setAttachments([])
    setAttachmentPath('')
    setSelectedEffort('auto')
    setSelectedAgent('')
    setSelectedCopilotMode('interactive')
    setComposerOptions({})
    setPendingPermissions([])
    setOptimisticUserText(null)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    clearLiveSubagentText()
    setAwaitingPersistedTurn(false)
    setSendState('idle')
    setSendError(null)
    setFailedSend(null)
  }
  setAutoFollow(false)
  commitTimelineScrollTop(0)
  setTimelineViewportHeight(0)
  rowHeightsRef.current.clear()
  timelineEstimateCalibrationRef.current.clear()
  timelineEstimateSamplesRef.current.clear()
  timelineEstimateCalibrationFrozenRef.current = false
  threadedCacheRef.current.clear()
  prevThreadingRef.current = null
  pendingRowMeasurementsRef.current.clear()
  pendingTimelineScrollCompensationRef.current = 0
  pendingMountedAnchorCaptureRef.current = false
  if (measurementFrameRef.current != null) {
    window.cancelAnimationFrame(measurementFrameRef.current)
    measurementFrameRef.current = null
  }
  timelineHeightOverrideRef.current = null
  wheelScrollCompensationUntilRef.current = 0
  activeTimelineScrollAnchorRef.current = null
  pendingTimelineAnchorRestoreRef.current = false
  setTimelineHeightOverride(null)
  setRowMeasurementVersion(0)
  setPersistedMeasurementVersion(0)
  if (!sendInFlightRef.current && !awaitingPersistedTurnRef.current) {
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
  }
  initialScrollDoneRef.current = false
}

export type GitSummaryEffectContext = {
  composerWorkingDirectory: string | null
  setComposerGitSummary: Dispatch<SetStateAction<GitSummary | null>>
}

export function runGitSummaryEffect(ctx: GitSummaryEffectContext) {
  const {
    composerWorkingDirectory, setComposerGitSummary,
  } = ctx
  if (!composerWorkingDirectory) {
    setComposerGitSummary(null)
    return
  }

  let cancelled = false
  let timer: number | null = null
  const controller = new AbortController()
  setComposerGitSummary(null)

  const refresh = async () => {
    try {
      const response = await fetch(`/api/git?action=summary&cwd=${encodeURIComponent(composerWorkingDirectory)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await readJsonResponse(response) as { summary?: GitSummary | null }
      if (!cancelled) {
        const next = data.summary ?? null
        setComposerGitSummary((current) => gitSummariesMatch(current, next) ? current : next)
      }
    } catch {
      // Best-effort: session metadata remains the branch fallback.
    } finally {
      if (!cancelled) timer = window.setTimeout(() => { void refresh() }, COMPOSER_GIT_SUMMARY_POLL_MS)
    }
  }

  void refresh()
  return () => {
    cancelled = true
    controller.abort()
    if (timer !== null) window.clearTimeout(timer)
  }
}
