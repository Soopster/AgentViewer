import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import type { WorkspaceContextValue } from '../../workspaceContext'
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useRef } from 'react'
import { useStableEvent } from '../../useStableEvent'
import { type RunningSessionRef } from '../../../../lib/types'
import { type QueuedComposerSend, type SteeredComposerSend } from '../types'
import { useLiveTurnState } from '../state/liveTurnState'
import { useQuestionPickerState } from '../state/questionPickerState'

export type UseReattachedRunningKeyRefGroupContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
  workspaceContext: WorkspaceContextValue
}

export function useReattachedRunningKeyRefGroup(ctx: UseReattachedRunningKeyRefGroupContext) {
  const {
    composerSessions, composerOwnerKey, workspaceContext,
  } = ctx

  // Session key the registry poll currently reports as running-but-unowned.
  // The detail poll consults this to keep refreshing a session whose leftover
  // live baseline would otherwise pause background polls (the dead-stream case).
  const reattachedRunningKeyRef = composerSessions.ref<string | null>(composerOwnerKey, 'reattachedRunningKeyRef', null)
  // Sidebar running marks added by the registry poll (as opposed to the send
  // loop's own mark), so the poll only clears marks it added itself.
  const reattachMarksRef = useRef(new Map<string, RunningSessionRef>())
  // Session key of the turn the local send stream currently owns; the registry
  // poll never treats that session as reattached.
  const ownedTurnKeyRef = composerSessions.ref<string | null>(composerOwnerKey, 'ownedTurnKeyRef', null)
  const {
    questionFocusIndex, setQuestionFocusIndex, questionOptionIndex, setQuestionOptionIndex,
    questionSelections, setQuestionSelections, questionFreeformAnswers, setQuestionFreeformAnswers,
    questionFreeformEditing, setQuestionFreeformEditing, questionPermissionIdRef,
    composerWaitingSeed, setComposerWaitingSeed, composerError, setComposerError, composerLiveText,
    setComposerLiveText, composerLiveReasoning, setComposerLiveReasoning, composerThinkingTokens,
    setComposerThinkingTokens, liveTranscriptMessages, setLiveTranscriptMessages,
    localCommandOutputs, setLocalCommandOutputs, queuedComposerSends, setQueuedComposerSends,
    queuedComposerSendsRef, composerQueueDurable, setComposerQueueDurable, runningRegistryReady,
    setRunningRegistryReady,
  } = useQuestionPickerState({
    composerSessions, composerOwnerKey, workspaceContext,
  })
  // Follow-up queue mutations must be crash-safe before the next render. Keep
  // the transient ref and atomic queue file in lockstep in the originating
  // interaction; relying only on effects leaves immediate-exit windows where
  // the newest enqueue/cancel state can be lost or replayed.
  const commitQueuedComposerSends = useStableEvent((next: QueuedComposerSend[]) => {
    queuedComposerSendsRef.current = next
    setQueuedComposerSends(next)
    try { workspaceContext.controller.flush(); setComposerQueueDurable(true) } catch { setComposerQueueDurable(false) }
  })
  const activeComposerTurnRequestIdRef = composerSessions.ref<string | null>(composerOwnerKey, 'activeComposerTurnRequestIdRef', null)
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredSendNotice, setSteeredSendNotice] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'steeredSendNotice', null)
  const steeredEchoCounterRef = useRef(0)
  const steeredComposerSendsRef = composerSessions.ref<SteeredComposerSend[]>(composerOwnerKey, 'steeredComposerSendsRef', [])
  const {
    livePromptSuggestion, setLivePromptSuggestion, liveStatus, setLiveStatus, liveSubagentText,
    setLiveSubagentText, liveOutputTokens, setLiveOutputTokens, liveToolActivities,
    setLiveToolActivities, taskBudgetTokens, composerEnableWorkflow, setComposerEnableWorkflow,
    tuiEffort, setTuiEffort, tuiPermissionModeByKey, setTuiPermissionModeByKey,
    tuiPermissionModeByKeyRef, tuiCodexApprovalByKey, setTuiCodexApprovalByKey, tuiAddedDirsByKey,
    setTuiAddedDirsByKey, tuiAddedDirsByKeyRef,
  } = useLiveTurnState({
    composerSessions, composerOwnerKey,
  })

  return {
    reattachedRunningKeyRef, reattachMarksRef, ownedTurnKeyRef, questionFocusIndex,
    setQuestionFocusIndex, questionOptionIndex, setQuestionOptionIndex, questionSelections,
    setQuestionSelections, questionFreeformAnswers, setQuestionFreeformAnswers,
    questionFreeformEditing, setQuestionFreeformEditing, questionPermissionIdRef,
    composerWaitingSeed, setComposerWaitingSeed, composerError, setComposerError, composerLiveText,
    setComposerLiveText, composerLiveReasoning, setComposerLiveReasoning, composerThinkingTokens,
    setComposerThinkingTokens, liveTranscriptMessages, setLiveTranscriptMessages,
    localCommandOutputs, setLocalCommandOutputs, queuedComposerSends, setQueuedComposerSends,
    queuedComposerSendsRef, composerQueueDurable, runningRegistryReady, setRunningRegistryReady,
    commitQueuedComposerSends, activeComposerTurnRequestIdRef, steeredSendNotice,
    setSteeredSendNotice, steeredEchoCounterRef, steeredComposerSendsRef, livePromptSuggestion,
    setLivePromptSuggestion, liveStatus, setLiveStatus, liveSubagentText, setLiveSubagentText,
    liveOutputTokens, setLiveOutputTokens, liveToolActivities, setLiveToolActivities,
    taskBudgetTokens, composerEnableWorkflow, setComposerEnableWorkflow, tuiEffort, setTuiEffort,
    tuiPermissionModeByKey, setTuiPermissionModeByKey, tuiPermissionModeByKeyRef,
    tuiCodexApprovalByKey, setTuiCodexApprovalByKey, tuiAddedDirsByKey, setTuiAddedDirsByKey,
    tuiAddedDirsByKeyRef,
  }
}
