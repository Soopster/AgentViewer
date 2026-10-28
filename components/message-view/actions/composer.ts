import type { RefObject } from 'react'
import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { type ContextComposerHandle } from '../../ContextComposer'
import { readComposerContext, restoreContextAttachments } from '@/lib/composerContext'
import { type SendState, type SendAttachment } from '@/lib/types'
import { type SlashCommandSuggestion } from '@/lib/slashCommands'
import { ArrowUp } from 'lucide-react'
import { mergeComposerAttachments } from '@/lib/composerAttachments'
import { type MentionResult } from '../types'
import { readOptionalJsonResponse } from '@/lib/httpResponse'
import { type ThreadedMessage } from '@/lib/threading'
import { clearComposerQueueTarget, restoreComposerDraftPayload, selectComposerQueueTarget } from '@/lib/composerAttachments'
import { type QueuedWebSend, type PendingMessageBaseline, type SteeredSendEntry, type LiveToolActivity } from '../types'

export type HandleKeyDownContext = {
  isComposingRef: RefObject<boolean>
  session: Session | null
  sendState: SendState
  reattachedRunning: boolean
  backgroundClaudeTasks: () => Promise<void>
  mentionQuery: { start: number; query: string; } | null
  mentionResults: MentionResult[]
  setMentionActiveIndex: Dispatch<SetStateAction<number>>
  mentionActiveIndex: number
  insertMention: (entry: MentionResult) => void
  setMentionQuery: Dispatch<SetStateAction<{ start: number; query: string; } | null>>
  slashOpen: boolean
  slashCommands: SlashCommandSuggestion[]
  setSlashActiveIndex: Dispatch<SetStateAction<number>>
  slashActiveIndex: number
  insertSlashCommand: (command: string) => void
  setSlashOpen: Dispatch<SetStateAction<boolean>>
  sendMessage: (retryOverride?: { text: string; attachments: SendAttachment[]; turnRequestId?: string; }) => Promise<void>
  sentHistory: string[]
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  inputTextRef: MutableRefObject<string>
  historyIndex: number
  draftBeforeHistoryRef: RefObject<{ text: string; cursorPos: number; }>
  setHistoryIndex: Dispatch<SetStateAction<number>>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  setInputText: Dispatch<SetStateAction<string>>
  resizeComposer: () => void
}

export function runHandleKeyDown(ctx: HandleKeyDownContext, e: React.KeyboardEvent<HTMLDivElement>) {
  const {
    isComposingRef, session, sendState, reattachedRunning, backgroundClaudeTasks, mentionQuery,
    mentionResults, setMentionActiveIndex, mentionActiveIndex, insertMention, setMentionQuery,
    slashOpen, slashCommands, setSlashActiveIndex, slashActiveIndex, insertSlashCommand,
    setSlashOpen, sendMessage, sentHistory, textareaRef, inputTextRef, historyIndex,
    draftBeforeHistoryRef, setHistoryIndex, setAttachments, setInputText, resizeComposer,
  } = ctx
  if (e.nativeEvent.isComposing || isComposingRef.current) return
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b'
    && session?.provider === 'claude' && (sendState === 'sending' || reattachedRunning)) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.repeat) void backgroundClaudeTasks()
    return
  }
  if (mentionQuery && mentionResults.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionActiveIndex((i) => Math.min(i + 1, mentionResults.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const entry = mentionResults[mentionActiveIndex]
      if (entry) {
        e.preventDefault()
        insertMention(entry)
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMentionQuery(null)
      return
    }
  }
  if (slashOpen && slashCommands.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSlashActiveIndex((i) => Math.min(i + 1, slashCommands.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSlashActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      const entry = slashCommands[slashActiveIndex]
      if (entry) {
        e.preventDefault()
        insertSlashCommand(entry.command)
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setSlashOpen(false)
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !e.altKey)) {
    e.preventDefault()
    sendMessage()
    return
  }
  if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && sentHistory.length > 0) {
    const textarea = textareaRef.current
    const draftValue = textarea?.value ?? inputTextRef.current
    const cursorAtStart = textarea ? textarea.selectionStart === 0 && textarea.selectionEnd === 0 : true
    if (historyIndex === -1) {
      if (draftValue.length > 0 && !cursorAtStart) return
      draftBeforeHistoryRef.current = {
        text: draftValue,
        cursorPos: textarea?.selectionStart ?? draftValue.length,
      }
      const nextIndex = sentHistory.length - 1
      setHistoryIndex(nextIndex)
      const restoredContext = readComposerContext(sentHistory[nextIndex] ?? '')
      const replacement = restoredContext.text
      setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
      setInputText(replacement)
      inputTextRef.current = replacement
      e.preventDefault()
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.setSelectionRange(replacement.length, replacement.length)
        resizeComposer()
      })
      return
    }
    const nextIndex = Math.max(historyIndex - 1, 0)
    if (nextIndex === historyIndex) {
      e.preventDefault()
      return
    }
    setHistoryIndex(nextIndex)
    const restoredContext = readComposerContext(sentHistory[nextIndex] ?? '')
    const replacement = restoredContext.text
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(replacement)
    inputTextRef.current = replacement
    e.preventDefault()
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.setSelectionRange(replacement.length, replacement.length)
      resizeComposer()
    })
    return
  }
  if (e.key === 'ArrowDown' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && historyIndex !== -1) {
    const nextIndex = historyIndex + 1
    if (nextIndex >= sentHistory.length) {
      setHistoryIndex(-1)
      const { text: restored, cursorPos } = draftBeforeHistoryRef.current
      setInputText(restored)
      inputTextRef.current = restored
      e.preventDefault()
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.setSelectionRange(cursorPos, cursorPos)
        resizeComposer()
      })
      return
    }
    setHistoryIndex(nextIndex)
    const restoredContext = readComposerContext(sentHistory[nextIndex] ?? '')
    const replacement = restoredContext.text
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(replacement)
    inputTextRef.current = replacement
    e.preventDefault()
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.setSelectionRange(replacement.length, replacement.length)
      resizeComposer()
    })
    return
  }
}

export type CancelSendContext = {
  session: Session | null
  activeTurnRequestIdRef: MutableRefObject<string | null>
  steeredUserTextsRef: MutableRefObject<SteeredSendEntry[]>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  inputTextRef: MutableRefObject<string>
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  setInputText: Dispatch<SetStateAction<string>>
  resizeComposer: () => void
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  transientRetryTimerRef: MutableRefObject<NodeJS.Timeout | null>
  transientRetryCountRef: MutableRefObject<number>
  abortControllerRef: MutableRefObject<AbortController | null>
  sendInFlightRef: MutableRefObject<boolean>
  setSendError: Dispatch<SetStateAction<string | null>>
  setSendState: Dispatch<SetStateAction<SendState>>
  queuedSendsRef: RefObject<QueuedWebSend[]>
  composerQueueTargetKey: string | null
  commitQueuedSends: (next: QueuedWebSend[]) => void
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  setInterrupting: Dispatch<SetStateAction<boolean>>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  setReattachedRunning: Dispatch<SetStateAction<boolean>>
  optimisticUserText: string | null
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  clearLiveSubagentText: () => void
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
}

export function runCancelSend(ctx: CancelSendContext) {
  const {
    session, activeTurnRequestIdRef, steeredUserTextsRef, setSteeredUserTexts, inputTextRef,
    textareaRef, setInputText, resizeComposer, setSessionActionNotice, transientRetryTimerRef,
    transientRetryCountRef, abortControllerRef, sendInFlightRef, setSendError, setSendState,
    queuedSendsRef, composerQueueTargetKey, commitQueuedSends, setAttachments,
    pendingMessageBaselineRef, setInterrupting, awaitingPersistedTurnRef, setAwaitingPersistedTurn,
    setReattachedRunning, optimisticUserText, setOptimisticUserText, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText, liveToolIndexesRef,
    liveToolInputJsonRef,
  } = ctx
  if (session) {
    fetch(`/api/sessions/${session.sessionId}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: session.provider,
        providerInstanceId: session.providerInstanceId,
        turnRequestId: activeTurnRequestIdRef.current ?? undefined,
        cancelQueued: true,
      }),
    }).then(async (res) => {
      // interrupt_receipt_v1: uuids of queued async messages that survive
      // the interrupt and WILL still run. Warn instead of letting the next
      // turn look like a ghost send.
      const json = await readOptionalJsonResponse<{ stillQueued?: unknown } | null>(res, null)
      const stillQueuedUuids = Array.isArray(json?.stillQueued)
        ? json.stillQueued.filter((uuid): uuid is string => typeof uuid === 'string')
        : null
      if (stillQueuedUuids) {
        const stillQueued = new Set(stillQueuedUuids)
        // A queued lifecycle frame says the message had not started. If its
        // uuid is absent from the interrupt receipt, the interrupt removed it
        // and its draft is safe to restore. Receipt members remain queued in
        // Claude and must not also be copied into the composer.
        const restoreEntries = steeredUserTextsRef.current
          .filter((entry) => entry.state === 'queued' && entry.messageUuid && !stillQueued.has(entry.messageUuid))
        const restoreTexts = restoreEntries.map((entry) => entry.text)
        if (restoreTexts.length > 0) {
          const restoredUuids = new Set(restoreEntries.map((entry) => entry.messageUuid))
          const nextSteeredEntries = steeredUserTextsRef.current
            .filter((entry) => !restoredUuids.has(entry.messageUuid))
          steeredUserTextsRef.current = nextSteeredEntries
          setSteeredUserTexts(nextSteeredEntries)
          const restored = [inputTextRef.current.trim(), ...restoreTexts].filter(Boolean).join('\n\n')
          inputTextRef.current = restored
          if (textareaRef.current) textareaRef.current.value = restored
          setInputText(restored)
          window.requestAnimationFrame(resizeComposer)
        }
        if (stillQueuedUuids.length > 0) {
          setSessionActionNotice(`Interrupted · ${stillQueuedUuids.length} queued message${stillQueuedUuids.length === 1 ? '' : 's'} will still run`)
        } else if (restoreTexts.length > 0) {
          setSessionActionNotice(`Interrupted · restored ${restoreTexts.length} cancelled queued message${restoreTexts.length === 1 ? '' : 's'} to the composer`)
        }
      }
    }).catch(() => {})
  }
  // Cancel any pending transient auto-retry so it can't fire after the user
  // explicitly stopped the turn.
  if (transientRetryTimerRef.current) {
    clearTimeout(transientRetryTimerRef.current)
    transientRetryTimerRef.current = null
  }
  transientRetryCountRef.current = 0
  abortControllerRef.current?.abort()
  abortControllerRef.current = null
  activeTurnRequestIdRef.current = null
  sendInFlightRef.current = false
  setSendError(null)
  setSendState('idle')
  // The user interrupted to change course — auto-firing queued follow-ups
  // would be a surprise-send. Pop their text back into the composer instead
  // so they can edit and re-send.
  const interruptQueue = selectComposerQueueTarget(queuedSendsRef.current, composerQueueTargetKey)
  if (interruptQueue.length > 0) {
    commitQueuedSends(clearComposerQueueTarget(queuedSendsRef.current, composerQueueTargetKey))
    const restored = restoreComposerDraftPayload(
      { text: inputTextRef.current, attachments: [] },
      interruptQueue,
    ).text
    inputTextRef.current = restored
    if (textareaRef.current) textareaRef.current.value = restored
    setInputText(restored)
    setAttachments((current) => restoreComposerDraftPayload(
      { text: '', attachments: current },
      interruptQueue,
    ).attachments)
    window.requestAnimationFrame(resizeComposer)
  }
  if (pendingMessageBaselineRef.current) {
    // The turn had started: keep whatever the agent produced visible and
    // transition into the 'Interrupting…' / syncing state so the interrupted
    // turn's partial output reconciles smoothly instead of vanishing and then
    // reappearing on the next poll. The awaitingPersistedTurn timeout is the
    // escape hatch if the interrupt is a no-op and nothing ever persists.
    setInterrupting(true)
    awaitingPersistedTurnRef.current = true
    setAwaitingPersistedTurn(true)
  } else {
    // Nothing started yet — restore the draft and clear cleanly, as if unsent.
    // (Also the reattach path: we don't own a stream, so stop just fires the
    // server interrupt and drops back to idle; the /running poll reconciles.)
    setReattachedRunning(false)
    if (optimisticUserText) setInputText((prev) => prev || optimisticUserText)
    setInterrupting(false)
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    setOptimisticUserText(null)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    clearLiveSubagentText()
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
  }
  textareaRef.current?.focus()
}
