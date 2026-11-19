import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import type { WorkspaceContextValue } from '../../workspaceContext'
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useRef, useState } from 'react'
import { useWorkspaceState } from '../../workspaceContext'
import { readComposerQueue } from '../../../../lib/tuiComposerState'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type QueuedComposerSend } from '../types'
import { isQueuedComposerSend } from '../composerInput'

export type UseQuestionPickerStateContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
  workspaceContext: WorkspaceContextValue
}

export function useQuestionPickerState(ctx: UseQuestionPickerStateContext) {
  const {
    composerSessions, composerOwnerKey, workspaceContext,
  } = ctx

  // AskUserQuestion picker state (keyed off the active pending permission's id).
  const [questionFocusIndex, setQuestionFocusIndex] = useState(0)
  const [questionOptionIndex, setQuestionOptionIndex] = useState(0)
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({})
  const [questionFreeformAnswers, setQuestionFreeformAnswers] = useState<Record<number, string>>({})
  const [questionFreeformEditing, setQuestionFreeformEditing] = useState(false)
  const questionPermissionIdRef = useRef<string | null>(null)
  const [composerWaitingSeed, setComposerWaitingSeed] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerWaitingSeed', '')
  const [composerError, setComposerError] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'composerError', null)
  const [composerLiveText, setComposerLiveText] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerLiveText', '')
  // Reasoning streams on its own dim channel (see liveReasoning render below).
  const [composerLiveReasoning, setComposerLiveReasoning] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerLiveReasoning', '')
  // Live thinking-token estimate (SDK `thinking_tokens` messages); shown on the
  // THINKING preview header, reset each turn.
  const [composerThinkingTokens, setComposerThinkingTokens] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerThinkingTokens', 0)
  const [liveTranscriptMessages, setLiveTranscriptMessages] = useState<ThreadedMessage[]>([])
  // Output of a Claude local slash command (/context, /usage, …). The CLI
  // persists it as a system row the SDK returns without content, so the
  // transcript re-read can never show it; it is held here — apart from the live
  // overlay the reconcile clears — until that session's next send.
  const [localCommandOutputs, setLocalCommandOutputs] = useState<ThreadedMessage[]>([])
  // Queued prompts waiting for the active turn to finish (CLI-style FIFO —
  // a single slot here used to silently overwrite the first queued message).
  const [queuedComposerSends, setQueuedComposerSends] = useWorkspaceState<QueuedComposerSend[]>('queuedComposerSends', () =>
    workspaceContext.runtime.values.get('legacyInitialWorkspace') === true ? readComposerQueue(isQueuedComposerSend) : [])
  const queuedComposerSendsRef = useRef<QueuedComposerSend[]>(queuedComposerSends)
  const [composerQueueDurable, setComposerQueueDurable] = useState(true)
  const [runningRegistryReady, setRunningRegistryReady] = useState(false)

  return {
    questionFocusIndex, setQuestionFocusIndex, questionOptionIndex, setQuestionOptionIndex,
    questionSelections, setQuestionSelections, questionFreeformAnswers, setQuestionFreeformAnswers,
    questionFreeformEditing, setQuestionFreeformEditing, questionPermissionIdRef,
    composerWaitingSeed, setComposerWaitingSeed, composerError, setComposerError, composerLiveText,
    setComposerLiveText, composerLiveReasoning, setComposerLiveReasoning, composerThinkingTokens,
    setComposerThinkingTokens, liveTranscriptMessages, setLiveTranscriptMessages,
    localCommandOutputs, setLocalCommandOutputs, queuedComposerSends, setQueuedComposerSends,
    queuedComposerSendsRef, composerQueueDurable, setComposerQueueDurable, runningRegistryReady,
    setRunningRegistryReady,
  }
}
