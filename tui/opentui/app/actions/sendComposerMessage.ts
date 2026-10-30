import { createLiveTextBatch } from '../../liveTextBatch'
import { prepareComposerTurnRequest } from '../../../../lib/composerSubmission'
import { acknowledgeComposerMessage } from '../../../../lib/composerTranscript'
import { planComposerRetry } from '../../../../lib/composerRetry'
import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import type { Dispatch } from 'react'
import type { Timeout } from '@opentui/core'
import type { OpenCodeTodo } from '../../../../lib/taskRegistry'
import type { CliRenderer } from '@opentui/core'
import { liveMessageSessionKey, upsertThreadedMessage } from '../../liveTranscriptState'
import React from 'react'
import { readBridgeConfigFromEnv } from '../../../../lib/channelBridge'
import { createChannelBridgeMessageId, sendDurableChannelMessage } from '../../../../lib/channelBridgeOutbox'
import { readIdeBridgeConfigFromEnv, sendIdeAtMention } from '../../../../lib/ideBridge'
import { toBmpSafe } from '../../bmp'
import { channelBridgeFileOutboxStorage } from '../../../../lib/bridgeMessages'
import { appendComposerSentHistory } from '../../../../lib/tuiComposerState'
import { noteTuiComposerLatency } from '../../metricsLogger'
import { type TextareaRenderable } from '@opentui/core'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { formatSessionTitle } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { clearComposerQueueTarget, createComposerQueueItemId, rekeyComposerQueueTarget, removeComposerQueueItem, restoreComposerDraftPayload, selectComposerQueueTarget } from '../../../../lib/composerAttachments'
import { runTuiSessionAction, streamTuiSessionTurn, sendTuiCrossSessionMessage, listTuiRunningSessions, listTuiAddressableSessions, type TuiSessionDetail } from '../../../../lib/tui/service'
import { extractClaudeStreamToolInputDelta, extractClaudeStreamToolResults, extractClaudeStreamToolUse, normalizeClaudeStreamThreadedMessage, parseClaudeStreamToolInput } from '../../../../lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '../../../../lib/codexMapper'
import { type ContextUsage, type ProviderSelection, type RunningSessionRef, type SendAttachment, type SendState, type Session } from '../../../../lib/types'
import { commandResultExpectsTranscript, isNativeComposerCommandText } from '../../../../lib/composerCommands'
import { deliverComposerSteer } from '../../../../lib/composerSteering'
import { parseClaudeCommandLifecycle } from '../../../../lib/claudeCommandLifecycle'
import { TransientAwareSendError, type UsageLimitKind } from '../../../../lib/transientError'
import { normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { parseCrossSessionComposerCommand } from '../../../../lib/crossSessionCommands'
import { extractPendingPermission, extractPermissionReply, type PendingPermission } from '../../../../lib/permissions'
import { summarizeDurableSessionMessages } from '../../messageFingerprint'
import { join, resolve } from 'node:path'
import { isComposerTargetReady } from '../../splitPaneState'
import { type ComposerPromptPart, type QueuedComposerSend, type ComposerDraftSnapshot, type SseFrame, type TuiLiveToolActivity, type TuiEffort, type TuiMentionResult, type SteeredComposerSend, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier, type ComposerSubmission, type NoticeTone } from '../types'
import { NATIVE_OSC_ENABLED, LIVE_TEXT_FLUSH_MS, STREAM_STALL_SENTINEL, CLAUDE_STREAM_STALL_MS, NOTIFY_AFTER_MS, NOTIFY_PREVIEW_CHARS } from '../timing'
import { isLiveAssistantTextMessage, makeLiveUserMessage, codexQuestionLiveMessage, streamEventIndex, updateLiveToolThreadInput, applyLiveToolResult, extractOpenCodeLiveToolThread, extractOpenCodeLiveSubagent, extractCodexLiveToolActivity, applyLiveToolActivity, appendCodexLiveToolOutput, extractCopilotFinalAssistantMessage, extractStreamingAssistantText, extractStreamingReasoningText, shouldReplaceLiveAssistantText, makeLiveAssistantTextMessage, extractCodexVisibleAssistantText, shouldReplaceCodexVisibleAssistantText, liveAssistantTextKey, extractSseFrames } from '../liveStream'
import { sessionKey } from '../sessionList'
import { keepEmpty, keepFiltered, touchMapEntry } from '../collections'
import { CODEX_LIVE_ASSISTANT_UUID, CLAUDE_LIVE_ASSISTANT_UUID_PREFIX } from '../composerConstants'

export type SendComposerMessageContext = {
  composerTargetSessionRef: React.RefObject<Session | null>
  composerTargetSession: Session | null
  composerSessions: ComposerSessions
  composerViewActions: { setComposerDraft: (action: React.SetStateAction<string>) => void; setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>; setComposerPromptParts: React.Dispatch<React.SetStateAction<ComposerPromptPart[]>>; setComposerMention: React.Dispatch<React.SetStateAction<{ start: number; query: string; } | null>>; setComposerMentionResults: React.Dispatch<React.SetStateAction<TuiMentionResult[]>>; setComposerMentionDismissedStart: React.Dispatch<React.SetStateAction<number | null>>; setComposerSlashIndex: React.Dispatch<React.SetStateAction<number>>; setComposerSlashDismissed: React.Dispatch<React.SetStateAction<boolean>>; setComposerHistoryIndex: React.Dispatch<React.SetStateAction<number>>; setComposerHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>; setDraftBeforeHistory: React.Dispatch<React.SetStateAction<ComposerDraftSnapshot>>; setFollowTail: React.Dispatch<React.SetStateAction<boolean>>; setPendingNewCount: React.Dispatch<React.SetStateAction<number>>; setUnreadBoundaryKey: React.Dispatch<React.SetStateAction<string | null>>; setHistoryIndex: React.Dispatch<React.SetStateAction<number>>; setPermissionOptionIndex: React.Dispatch<React.SetStateAction<number>>; setContextUsage: React.Dispatch<React.SetStateAction<ContextUsage | null>>; setSessionDetail: React.Dispatch<React.SetStateAction<TuiSessionDetail | null>>; setTuiCopilotMode: React.Dispatch<React.SetStateAction<'interactive' | 'plan' | 'autopilot' | 'shell'>>; }
  composerViewRefs: { textarea: React.RefObject<TextareaRenderable | null>; storage: React.RefObject<string | null>; attachments: React.RefObject<SendAttachment[]>; parts: React.RefObject<ComposerPromptPart[]>; }
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  composerDraft: string
  prepareComposerSubmission: (visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]) => ComposerSubmission
  composerMentionAttachments: SendAttachment[]
  composerPromptParts: ComposerPromptPart[]
  composerPaneTargetKey: string | null
  composerPreparingTargetKeyRef: React.RefObject<string | null>
  composerSendState: SendState
  reattachedRunningRef: React.MutableRefObject<boolean>
  commitQueuedComposerSends: (next: QueuedComposerSend[]) => void
  queuedComposerSendsRef: React.RefObject<QueuedComposerSend[]>
  sendComposerMessage: (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) => Promise<void>
  runTuiLocalCommand: (target: Session, text: string) => boolean
  canUseChannelBridge: boolean
  selectedSessionTarget: Session | null
  routeComposerToBridgeRef: React.RefObject<boolean>
  lastBridgeChatIdRef: React.RefObject<string | undefined>
  setBridgeTranscriptEntries: React.Dispatch<React.SetStateAction<{ kind: 'sent' | 'reply'; text: string; timestamp: string; }[]>>
  canUseIdeBridge: boolean
  routeComposerToIdeRef: React.RefObject<boolean>
  composerAbortRef: React.MutableRefObject<AbortController | null>
  composerRetryTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  activeComposerTurnRequestIdRef: React.MutableRefObject<string | null>
  setSteeredSendNotice: React.Dispatch<React.SetStateAction<string | null>>
  steeredEchoCounterRef: React.RefObject<number>
  steeredComposerSendsRef: React.MutableRefObject<SteeredComposerSend[]>
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  composerRetryCountRef: React.MutableRefObject<number>
  composerTurnProducedOutputRef: React.MutableRefObject<boolean>
  writeWorkspaceDraft: (key: string, text: string) => void
  activeComposerSendCleanupRef: React.MutableRefObject<Promise<void> | null>
  setComposerSendState: React.Dispatch<React.SetStateAction<SendState>>
  setComposerSendStartedAt: React.Dispatch<React.SetStateAction<number | null>>
  setComposerWaitingSeed: React.Dispatch<React.SetStateAction<string>>
  setComposerError: React.Dispatch<React.SetStateAction<string | null>>
  flushLiveText: () => void
  pendingLiveTextRef: React.MutableRefObject<string>
  pendingLiveReasoningRef: React.MutableRefObject<string>
  liveTextTargetSessionRef: React.MutableRefObject<Session | null>
  liveTextFlushTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  setComposerLiveText: React.Dispatch<React.SetStateAction<string>>
  setComposerLiveReasoning: React.Dispatch<React.SetStateAction<string>>
  setComposerThinkingTokens: React.Dispatch<React.SetStateAction<number>>
  setLivePromptSuggestion: React.Dispatch<React.SetStateAction<string | null>>
  setLiveStatus: React.Dispatch<React.SetStateAction<'requesting' | 'compacting' | 'retrying' | null>>
  setLiveSubagentText: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setLiveOutputTokens: React.Dispatch<React.SetStateAction<number>>
  setLiveToolActivities: React.Dispatch<React.SetStateAction<TuiLiveToolActivity[]>>
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  markSessionRunning: (ref: RunningSessionRef) => void
  ownedTurnKeyRef: React.MutableRefObject<string | null>
  setComposerActivitySessionKey: React.Dispatch<React.SetStateAction<string | null>>
  selectedSessionKeyRef: React.RefObject<string | null>
  sessionDetail: TuiSessionDetail | null
  sessionDetailCacheRef: React.RefObject<TranscriptDetailCache>
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  liveToolIndexesRef: React.MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: React.MutableRefObject<Map<number, string>>
  setLocalCommandOutputs: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  tuiModelOverride: Record<string, string>
  taskBudgetTokens: number | null
  composerEnableWorkflow: boolean
  tuiOpenCodeAgent: string
  tuiEffort: TuiEffort
  tuiCopilotMode: 'interactive' | 'plan' | 'autopilot' | 'shell'
  composerCopilotContextTier: TuiCopilotContextTier
  composerPermissionMode: 'plan' | 'auto' | 'default' | 'acceptEdits' | 'bypassPermissions'
  composerCopilotPermissionMode: TuiCopilotPermissionMode
  tuiAddedDirsByKeyRef: React.RefObject<Record<string, string[]>>
  tuiCodexModeByKeyRef: React.RefObject<Record<string, 'plan' | 'default'>>
  composerCodexApproval: TuiCodexApproval
  sessionContextUsageCacheRef: React.RefObject<Map<string, ContextUsage | null>>
  tuiPermissionModeByKeyRef: React.RefObject<Record<string, 'plan' | 'auto' | 'default' | 'acceptEdits' | 'bypassPermissions'>>
  setTuiPermissionModeByKey: React.Dispatch<React.SetStateAction<Record<string, 'plan' | 'auto' | 'default' | 'acceptEdits' | 'bypassPermissions'>>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setComposerPaneTargetKey: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setComposerLiveTodos: React.Dispatch<React.SetStateAction<OpenCodeTodo[]>>
  openModelPicker: () => Promise<void>
  setTuiModelOverride: React.Dispatch<React.SetStateAction<Record<string, string>>>
  openCreatedSession: (draft: Session) => Promise<void>
  setComposerLiveSlashCommands: React.Dispatch<React.SetStateAction<SlashCommandSuggestion[]>>
  reattachedRunningKeyRef: React.MutableRefObject<string | null>
  setReattachedRunning: React.Dispatch<React.SetStateAction<boolean>>
  setSentHistory: React.Dispatch<React.SetStateAction<ComposerDraftSnapshot[]>>
  setInterruptPressActive: React.Dispatch<React.SetStateAction<boolean>>
  interruptPressTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  setAwaitingPersistedTurn: React.Dispatch<React.SetStateAction<boolean>>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
  provider: ProviderSelection
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
  renderer: CliRenderer
  composerInterruptPendingRef: React.MutableRefObject<boolean>
  readWorkspaceDraft: (key: string) => string
  writeWorkspaceDraftParts: (key: string, parts: unknown[]) => void
  readWorkspaceDraftParts: (key: string) => unknown[]
  restoreComposerPromptPartExtmarks: (parts: ComposerPromptPart[], text: string) => void
  clearSessionRunning: (ref: RunningSessionRef) => void
  exitInProgressRef: React.RefObject<boolean>
}

export async function runSendComposerMessage(ctx: SendComposerMessageContext, draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) {
  const {
    composerTargetSessionRef, composerTargetSession, composerSessions, composerViewActions,
    composerViewRefs, showNotice, composerDraft, prepareComposerSubmission,
    composerMentionAttachments, composerPromptParts, composerPaneTargetKey,
    composerPreparingTargetKeyRef, composerSendState, reattachedRunningRef,
    commitQueuedComposerSends, queuedComposerSendsRef, sendComposerMessage, runTuiLocalCommand,
    canUseChannelBridge, selectedSessionTarget, routeComposerToBridgeRef, lastBridgeChatIdRef,
    setBridgeTranscriptEntries, canUseIdeBridge, routeComposerToIdeRef, composerAbortRef,
    composerRetryTimerRef, activeComposerTurnRequestIdRef, setSteeredSendNotice,
    steeredEchoCounterRef, steeredComposerSendsRef, setLiveTranscriptMessages: publishLiveTranscriptMessages,
    composerRetryCountRef, composerTurnProducedOutputRef, writeWorkspaceDraft,
    activeComposerSendCleanupRef, setComposerSendState, setComposerSendStartedAt,
    setComposerWaitingSeed, setComposerError, flushLiveText, pendingLiveTextRef,
    pendingLiveReasoningRef, liveTextTargetSessionRef, liveTextFlushTimerRef, setComposerLiveText,
    setComposerLiveReasoning, setComposerThinkingTokens, setLivePromptSuggestion, setLiveStatus,
    setLiveSubagentText, setLiveOutputTokens, setLiveToolActivities, setPendingPermissions,
    markSessionRunning, ownedTurnKeyRef, setComposerActivitySessionKey, selectedSessionKeyRef,
    sessionDetail, sessionDetailCacheRef, liveTranscriptBaselineRef, liveToolIndexesRef,
    liveToolInputJsonRef, setLocalCommandOutputs, tuiModelOverride, taskBudgetTokens,
    composerEnableWorkflow, tuiOpenCodeAgent, tuiEffort, tuiCopilotMode,
    composerCopilotContextTier, composerPermissionMode, composerCopilotPermissionMode,
    tuiAddedDirsByKeyRef, tuiCodexModeByKeyRef, composerCodexApproval, sessionContextUsageCacheRef,
    tuiPermissionModeByKeyRef, setTuiPermissionModeByKey, setOpenTabSessions, setSessions,
    setComposerPaneTargetKey, setSelectedSessionKey, setComposerLiveTodos, openModelPicker,
    setTuiModelOverride, openCreatedSession, setComposerLiveSlashCommands, reattachedRunningKeyRef,
    setReattachedRunning, setSentHistory, setInterruptPressActive, interruptPressTimeoutRef,
    setAwaitingPersistedTurn, refreshSessions, provider, refreshSelectedSessionDetail, renderer,
    composerInterruptPendingRef, readWorkspaceDraft, writeWorkspaceDraftParts,
    readWorkspaceDraftParts, restoreComposerPromptPartExtmarks, clearSessionRunning,
    exitInProgressRef,
  } = ctx
  const liveTextBatch = createLiveTextBatch(publishLiveTranscriptMessages, LIVE_TEXT_FLUSH_MS)
  const setLiveTranscriptMessages: typeof publishLiveTranscriptMessages = (update) => {
    liveTextBatch.flush()
    publishLiveTranscriptMessages(update)
  }
  const isCurrentTarget = () => Boolean(composerTargetSessionRef.current && composerTargetSession && composerSessions.same(sessionKey(composerTargetSessionRef.current), sessionKey(composerTargetSession)))
  const project = <Args extends unknown[]>(action: (...args: Args) => void) => (...args: Args) => { if (isCurrentTarget()) action(...args) }
  const setComposerDraft = project(composerViewActions.setComposerDraft)
  const setComposerMentionAttachments = project(composerViewActions.setComposerMentionAttachments)
  const setComposerPromptParts = project(composerViewActions.setComposerPromptParts)
  const setComposerMention = project(composerViewActions.setComposerMention)
  const setComposerMentionResults = project(composerViewActions.setComposerMentionResults)
  const setComposerMentionDismissedStart = project(composerViewActions.setComposerMentionDismissedStart)
  const setComposerSlashIndex = project(composerViewActions.setComposerSlashIndex)
  const setComposerSlashDismissed = project(composerViewActions.setComposerSlashDismissed)
  const setComposerHistoryIndex = project(composerViewActions.setComposerHistoryIndex)
  const setComposerHistoryOpen = project(composerViewActions.setComposerHistoryOpen)
  const setDraftBeforeHistory = project(composerViewActions.setDraftBeforeHistory)
  const setFollowTail = project(composerViewActions.setFollowTail)
  const setPendingNewCount = project(composerViewActions.setPendingNewCount)
  const setUnreadBoundaryKey = project(composerViewActions.setUnreadBoundaryKey)
  const setHistoryIndex = project(composerViewActions.setHistoryIndex)
  const setPermissionOptionIndex = project(composerViewActions.setPermissionOptionIndex)
  const setContextUsage = project(composerViewActions.setContextUsage)
  const setSessionDetail = project(composerViewActions.setSessionDetail)
  const setTuiCopilotMode = project(composerViewActions.setTuiCopilotMode)
  const composerTextareaRef = { get current() { return isCurrentTarget() ? composerViewRefs.textarea.current : null } }
  const composerDraftStorageKeyRef = { current: composerViewRefs.storage.current }
  const scopedRef = <T,>(source: { current: T }) => {
    let saved = source.current
    return { get current() { return isCurrentTarget() ? source.current : saved }, set current(value: T) { saved = value; if (isCurrentTarget()) source.current = value } }
  }
  const composerMentionAttachmentsRef = scopedRef(composerViewRefs.attachments)
  const composerPromptPartsRef = scopedRef(composerViewRefs.parts)
  // Notices raised while a turn streams can land after the user has moved to
  // another session; name the session they are about so they are not misread.
  const showTurnNotice = (tone: NoticeTone, text: string, durationMs?: number) => {
    const target = composerTargetSession
    showNotice(tone, target && !isCurrentTarget() ? `${formatSessionTitle(target)}: ${text}` : text, durationMs)
  }
  const visibleText = draftOverride ?? composerDraft
  const submission = attachmentsOverride
    ? {
        visibleText,
        messageText: visibleText.trim(),
        attachments: attachmentsOverride,
        promptParts: promptPartsOverride ?? [],
      }
    : prepareComposerSubmission(visibleText, composerMentionAttachments, composerPromptParts)
  const trimmed = submission.messageText
  if (!trimmed && submission.attachments.length === 0) return
  if (!composerTargetSession) {
    // A pane-aimed composer refuses rather than retargeting, so this is the
    // one case where the send is deliberately blocked and must say why —
    // an unexplained dead Enter key is worse than the message it replaces.
    if (composerPaneTargetKey) {
      showNotice('error', 'That split pane\'s session is gone — press esc and reopen the composer to retarget')
    }
    return
  }
  const submissionTargetKey = sessionKey(composerTargetSession)
  if (!isRetry && !isComposerTargetReady({
    preparingTargetKey: composerPreparingTargetKeyRef.current,
    targetSession: composerTargetSession,
    keyOf: sessionKey,
  })) {
    showNotice('info', 'Session is still loading — send will be available when it is ready')
    return
  }

  // Codex's /btw: an aside that waits for the running turn rather than
  // steering into it; with nothing running it is simply the next prompt.
  const btwAside = !isRetry && composerTargetSession.provider === 'codex'
    ? /^\/btw\s+(\S[\s\S]*)$/.exec(visibleText.trim())
    : null
  if (btwAside) {
    if (composerSendState === 'sending' || reattachedRunningRef.current) {
      composerTextareaRef.current?.setText('')
      composerTextareaRef.current?.extmarks.clear()
      setComposerDraft('')
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      commitQueuedComposerSends([...queuedComposerSendsRef.current, {
        id: createComposerQueueItemId(submissionTargetKey),
        targetKey: submissionTargetKey,
        text: btwAside[1]!,
        attachments: submission.attachments,
        promptParts: submission.promptParts,
      }])
      return
    }
    return sendComposerMessage(btwAside[1]!)
  }

  const crossSessionCommand = !isRetry && submission.attachments.length === 0
    ? parseCrossSessionComposerCommand(trimmed)
    : null
  if (crossSessionCommand) {
    composerTextareaRef.current?.setText('')
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    composerTextareaRef.current?.extmarks.clear()
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    try {
      if (crossSessionCommand.kind === 'list') {
        const targets = await listTuiAddressableSessions(composerTargetSession.sessionId)
        const summary = targets.length === 0
          ? 'No other running or recently active sessions are reachable'
          : targets.map((target) => `${target.name} (${target.provider}${target.running ? ', running' : ''})`).join(' · ')
        showNotice('info', summary, 12_000)
        return
      }
      if (!crossSessionCommand.target || !crossSessionCommand.text) {
        showNotice('error', 'Usage: /message <session-name> <message>')
        return
      }
      const fromName = composerTargetSession.customTitle?.trim()
        || composerTargetSession.summary?.trim()
        || `session-${composerTargetSession.sessionId.slice(0, 6)}`
      const result = await sendTuiCrossSessionMessage({
        fromSessionId: composerTargetSession.sessionId,
        fromName,
        toName: crossSessionCommand.target,
        text: crossSessionCommand.text,
      })
      if (!result.delivered) {
        showNotice('error', result.error || 'The cross-session message was not delivered')
        return
      }
      showNotice('info', result.mode === 'steered'
        ? `Delivered to ${result.targetName ?? crossSessionCommand.target}`
        : `Started a turn for ${result.targetName ?? crossSessionCommand.target}`)
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Cross-session messaging failed')
    }
    return
  }

  if (!isRetry && submission.attachments.length === 0 && trimmed.startsWith('/') && runTuiLocalCommand(composerTargetSession, trimmed)) {
    composerTextareaRef.current?.setText('')
    composerTextareaRef.current?.extmarks.clear()
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    return
  }

  // Global Channel Bridge binding: divert the send to the live `claude` CLI
  // session instead of the active provider. The durable outbox retains failed
  // sends for reconnect replay; replies and permission prompts surface in the
  // bridge popover (⇧C). Never diverts an auto-retry and requires actual text.
  if (!isRetry && canUseChannelBridge && selectedSessionTarget && routeComposerToBridgeRef.current && trimmed) {
    composerTextareaRef.current?.setText('')
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    composerTextareaRef.current?.extmarks.clear()
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    try {
      const timestamp = new Date().toISOString()
      const config = readBridgeConfigFromEnv()
      const chatId = lastBridgeChatIdRef.current ?? createChannelBridgeMessageId()
      lastBridgeChatIdRef.current = chatId
      const result = await sendDurableChannelMessage(channelBridgeFileOutboxStorage, config, {
        targetSessionId: selectedSessionTarget.sessionId,
        text: trimmed,
        chatId,
      })
      lastBridgeChatIdRef.current = result.response?.chat_id ?? chatId
      setBridgeTranscriptEntries((prev) => [...prev, { kind: 'sent', text: trimmed, timestamp }])
      showNotice('info', result.queued
        ? 'Queued for the live CLI bridge to reconnect'
        : 'Accepted by the live CLI bridge')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to reach the channel bridge')
    }
    return
  }

  // Global IDE Bridge binding: push the composer line as an @file mention into
  // the connected `claude` session instead of sending a provider turn. Accepts
  // "path" or "path:start-end". Tool calls / diffs surface in the IDE popover (⇧I).
  if (!isRetry && canUseIdeBridge && routeComposerToIdeRef.current && trimmed) {
    composerTextareaRef.current?.setText('')
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    composerTextareaRef.current?.extmarks.clear()
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    try {
      const match = trimmed.match(/^(.*?):(\d+)(?:-(\d+))?$/)
      const filePath = match ? match[1] : trimmed
      const lineStart = match ? Number(match[2]) : undefined
      const lineEnd = match ? (match[3] ? Number(match[3]) : lineStart) : undefined
      const result = await sendIdeAtMention(readIdeBridgeConfigFromEnv(), filePath, lineStart, lineEnd)
      showNotice(result.delivered ? 'info' : 'error', result.delivered ? 'Pushed @mention to the IDE session' : 'No `claude` session is connected to the IDE host yet')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to reach the IDE host')
    }
    return
  }

  const sendAttachments = submission.attachments
  // Native CLIs queue a follow-up prompt while the active turn streams.
  // Mirror that here: when sending, stash this draft and flush it after. A
  // reattached turn (running server-side, no owned stream) counts as sending
  // — starting a fresh turn now would run two concurrently. A transient
  // auto-retry bypasses the queue — the prior (failed) turn already settled,
  // composerSendState just hasn't been cleared yet across the backoff.
  if (!isRetry && (composerAbortRef.current !== null || composerRetryTimerRef.current !== null || reattachedRunningRef.current)) {
    composerTextareaRef.current?.setText('')
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    composerTextareaRef.current?.extmarks.clear()
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    // Native steering first: deliver the message INTO the running turn the
    // way the provider's own CLI does (Claude Code, Codex, Copilot, Pi, and
    // opencode all accept typed input mid-turn). Attachments can't ride a
    // steer; and if
    // the turn ends while the request is in flight the backend reports
    // delivered:false — both fall back to the client-side queue, which
    // sends as a fresh turn on idle.
    // Slash commands and `!` shell input never steer: steering would inject
    // them as literal prompt text mid-turn, whereas the native CLIs queue
    // them and execute them natively once the turn ends — the queue below
    // flushes into the send path, which does exactly that.
    const steerTarget = composerTargetSession
    if (trimmed && sendAttachments.length === 0 && steerTarget && !isNativeComposerCommandText(trimmed)) {
      try {
        const result = await deliverComposerSteer(
          (payload) => runTuiSessionAction(steerTarget, payload),
          {
            message: trimmed,
            provider: steerTarget.provider,
            turnRequestId: activeComposerTurnRequestIdRef.current ?? undefined,
          },
        )
        if (result.delivered === true) {
          setSteeredSendNotice(trimmed)
          // Echo the steered message into the live transcript immediately —
          // it's part of the running turn now, exactly like typing in the
          // native CLI. The persisted reconcile replaces this echo when the
          // turn lands.
          steeredEchoCounterRef.current += 1
          const liveMessageUuid = typeof result.messageUuid === 'string' && result.messageUuid
            ? result.messageUuid : `live-user-steer-${steeredEchoCounterRef.current}`
          if (typeof result.messageUuid === 'string') {
            steeredComposerSendsRef.current = [
              ...steeredComposerSendsRef.current,
              { text: trimmed, messageUuid: result.messageUuid, liveMessageUuid },
            ]
          }
          setLiveTranscriptMessages((prev) => [
            ...prev,
            makeLiveUserMessage(steerTarget, trimmed, liveMessageUuid),
          ])
          return
        }
      } catch {
        // Steering is best-effort; the queue below is the reliable path.
      }
    }
    commitQueuedComposerSends([...queuedComposerSendsRef.current, {
      id: createComposerQueueItemId(submissionTargetKey),
      targetKey: submissionTargetKey,
      text: submission.visibleText,
      attachments: sendAttachments,
      promptParts: submission.promptParts,
    }])
    return
  }

  if (!isRetry) composerRetryCountRef.current = 0
  composerTurnProducedOutputRef.current = false

  // Atomically consume the submitted snapshot before starting I/O. The user
  // can immediately compose a distinct follow-up while the provider works;
  // a second Enter can never accidentally queue the just-submitted prompt.
  if (!isRetry) {
    composerTextareaRef.current?.setText('')
    composerTextareaRef.current?.extmarks.clear()
    setComposerDraft('')
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, '')
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
    setComposerMentionDismissedStart(null)
    composerMentionAttachmentsRef.current = []
    composerPromptPartsRef.current = []
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    setComposerSlashIndex(0)
    setComposerSlashDismissed(false)
  }

  const targetSession = composerTargetSession
  const controller = new AbortController()
  const sendStartedAt = Date.now()
  const sendPerfStartedAt = performance.now()
  // Stable across automatic transport retries so Codex queue/add can
  // de-duplicate a prompt whose acknowledgement was lost in transit.
  const turnRequestId = retryTurnRequestId
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${sendStartedAt}-${Math.random().toString(36).slice(2)}`
  let resolveTurnCleanup: () => void = () => {}
  const turnCleanupPromise = new Promise<void>((resolve) => {
    resolveTurnCleanup = resolve
  })
  activeComposerSendCleanupRef.current = turnCleanupPromise
  composerAbortRef.current = controller
  activeComposerTurnRequestIdRef.current = turnRequestId
  setComposerSendState('sending')
  setSteeredSendNotice(null)
  steeredComposerSendsRef.current = []
  setComposerSendStartedAt(sendStartedAt)
  setComposerWaitingSeed(`${targetSession.provider ?? 'claude'}:${targetSession.sessionId}:${sendStartedAt}:${trimmed}`)
  setComposerError(null)
  flushLiveText() // flush any stale pending text
  pendingLiveTextRef.current = ''
  pendingLiveReasoningRef.current = ''
  liveTextTargetSessionRef.current = targetSession
  if (liveTextFlushTimerRef.current != null) {
    clearTimeout(liveTextFlushTimerRef.current)
    liveTextFlushTimerRef.current = null
  }
  setComposerLiveText('')
  setComposerLiveReasoning('')
  setComposerThinkingTokens(0)
  setLivePromptSuggestion(null)
  setLiveStatus(null)
  setLiveSubagentText({})
  setLiveOutputTokens(0)
  setLiveToolActivities(keepEmpty)
  setPendingPermissions(previous => keepFiltered(previous, entry => entry.sessionId !== targetSession.sessionId || (entry.provider ?? 'claude') !== (targetSession.provider ?? 'claude')))
  setPermissionOptionIndex(0)
  const runningRef: RunningSessionRef = {
    sessionId: targetSession.sessionId,
    providerInstanceId: targetSession.providerInstanceId,
    provider: targetSession.provider ?? 'claude',
  }
  markSessionRunning(runningRef)
  const targetKey = sessionKey(targetSession)
  // This send loop owns the turn's stream — the registry poll must not treat
  // the session as reattached while the stream is alive.
  ownedTurnKeyRef.current = targetKey
  setComposerActivitySessionKey(targetKey)
  // A new (pending) session has no history. Nor is the displayed detail
  // this session's just because this session is selected: a pending session
  // never loads one, so it still holds whatever was viewed before — and a
  // baseline of that transcript's length made the new session's rows never
  // count as "after" it, holding every first turn in Syncing until the 12s
  // escape hatch (Codex, every time).
  const displayedDetailIsTarget = selectedSessionKeyRef.current === targetKey
    && (sessionDetail?.rawMessages ?? []).every((message) => !message.session_id || message.session_id === targetSession.sessionId)
  const baselineDetail = targetSession.isPending
    ? null
    : sessionDetailCacheRef.current.get(targetKey) ?? (displayedDetailIsTarget ? sessionDetail : null)
  const baselineSummary = summarizeDurableSessionMessages(baselineDetail?.rawMessages ?? [])
  liveTranscriptBaselineRef.current.set(targetKey, {
    ...baselineSummary,
    startedAt: sendStartedAt,
  })
  liveToolIndexesRef.current.clear()
  liveToolInputJsonRef.current.clear()
  setLiveTranscriptMessages((prev) => [
    ...prev.filter((message) => liveMessageSessionKey(message) !== targetKey),
    makeLiveUserMessage(targetSession, trimmed),
  ])
  setLocalCommandOutputs((prev) => {
    const next = prev.filter((message) => liveMessageSessionKey(message) !== targetKey)
    return next.length === prev.length ? prev : next
  })
  setFollowTail(true)
  setPendingNewCount(0)
  setUnreadBoundaryKey(null)

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let replyAccumulator = ''
  let codexLiveMessageAccumulator = ''
  const claudeLiveTextByIndex = new Map<number, string>()
  const providerLiveTextByKey = new Map<string, string>()
  let copilotFinalMessageSeen = false
  let commandResultWithoutTranscript = false

  try {
    const overrideModel = tuiModelOverride[sessionKey(targetSession)]
    const res = await streamTuiSessionTurn(
      targetSession,
      {
        ...prepareComposerTurnRequest(targetSession, {
          message: trimmed,
          attachments: sendAttachments.length > 0 ? sendAttachments : undefined,
        }, {
          turnRequestId,
          model: overrideModel,
          effort: tuiEffort === 'auto' ? undefined : tuiEffort,
          agent: tuiOpenCodeAgent,
          mode: tuiCopilotMode,
          contextTier: composerCopilotContextTier !== 'default' ? composerCopilotContextTier : undefined,
          permissionMode: targetSession.provider === 'copilot' ? composerCopilotPermissionMode : composerPermissionMode,
          approvalPolicy: composerCodexApproval,
          taskBudgetTokens,
          enableWorkflow: composerEnableWorkflow,
        }),
        additionalDirectories: targetSession.provider === 'claude'
          ? tuiAddedDirsByKeyRef.current[sessionKey(targetSession)]
          : undefined,
        collaborationMode: targetSession.provider === 'codex'
          ? tuiCodexModeByKeyRef.current[sessionKey(targetSession)]
          : undefined,
      },
      controller.signal,
    )
    noteTuiComposerLatency(
      targetSession.provider ?? 'claude',
      'send-to-ack',
      performance.now() - sendPerfStartedAt,
    )

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error ?? `HTTP ${res.status}`)
    }

    reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')
    const decoder = new TextDecoder()
    let sseBuffer = ''
    let firstOutputRecorded = false
    const noteFirstOutput = () => {
      if (firstOutputRecorded) return
      firstOutputRecorded = true
      noteTuiComposerLatency(
        targetSession.provider ?? 'claude',
        'first-output',
        performance.now() - sendPerfStartedAt,
      )
    }

    const activeSubagentIdRef = { current: '' }

    const handleFrame = (frame: SseFrame) => {
      // Liveness pulse only — receiving it already reset the stall race.
      if (frame.event === 'heartbeat') return
      let parsed: unknown = null
      try {
        parsed = JSON.parse(frame.data)
      } catch {
        parsed = null
      }
      if (frame.event === 'turn-accepted') {
        const receipt = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
        const messageUuid = receipt?.messageUuid
        if (targetSession.provider === 'claude' && typeof messageUuid === 'string' && messageUuid) {
          const owner = typeof receipt?.sessionId === 'string' && receipt.sessionId
            ? { ...targetSession, sessionId: receipt.sessionId } : targetSession
          setLiveTranscriptMessages(previous => acknowledgeComposerMessage(previous, owner, messageUuid))
        }
        return
      }
      if (frame.event === 'error') {
        const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
        const message = record?.error
        const apiErrorStatus = typeof record?.apiErrorStatus === 'number' ? record.apiErrorStatus : undefined
        const usageLimit = typeof record?.usageLimit === 'string' ? record.usageLimit as UsageLimitKind : undefined
        throw new TransientAwareSendError(typeof message === 'string' ? message : 'Unknown agent error', apiErrorStatus, usageLimit)
      }
      if (frame.event === 'context-usage' && parsed) {
        const usage = parsed as ContextUsage
        touchMapEntry(sessionContextUsageCacheRef.current, sessionKey(targetSession), usage)
        setContextUsage(usage)
        return
      }
      if (frame.event === 'turn-usage' && parsed && typeof parsed === 'object') {
        const outputTokens = (parsed as { outputTokens?: unknown }).outputTokens
        if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
          setLiveOutputTokens(Math.max(0, outputTokens))
        }
        return
      }
      // Non-fatal turn notice (e.g. an MCP elicitation prompt). Surface it as a
      // transient banner without disturbing the live turn state.
      if (frame.event === 'turn-notice' && parsed) {
        const message = (parsed as { message?: unknown }).message
        if (typeof message === 'string' && message.trim()) {
          noteFirstOutput()
          showTurnNotice('info', message.trim())
        }
        return
      }
      if (frame.event === 'session' && parsed) {
        const evt = parsed as { sessionId?: unknown }
        if (typeof evt.sessionId === 'string' && evt.sessionId && targetSession.isPending) {
          const realId = evt.sessionId
          const oldKey = sessionKey(targetSession)
          const updated: Session = { ...targetSession, sessionId: realId, isPending: false }
          const newKey = sessionKey(updated)
          const baseline = liveTranscriptBaselineRef.current.get(oldKey)
          if (baseline) {
            liveTranscriptBaselineRef.current.delete(oldKey)
            liveTranscriptBaselineRef.current.set(newKey, baseline)
          }
          composerSessions.rekey(oldKey, newKey)
          if (ownedTurnKeyRef.current === oldKey) ownedTurnKeyRef.current = newKey
          setComposerActivitySessionKey((current) => current === oldKey ? newKey : current)
          commitQueuedComposerSends(rekeyComposerQueueTarget(queuedComposerSendsRef.current, oldKey, newKey))
          setLiveTranscriptMessages((prev) => prev.map((message) =>
            liveMessageSessionKey(message) === oldKey
              ? { ...message, sessionId: realId }
              : message
          ))
          const currentPermissionModes = tuiPermissionModeByKeyRef.current
          const pendingMode = currentPermissionModes[oldKey]
          if (pendingMode) {
            const next = { ...currentPermissionModes }
            delete next[oldKey]
            next[newKey] = pendingMode
            tuiPermissionModeByKeyRef.current = next
            setTuiPermissionModeByKey(next)
          }
          setOpenTabSessions((prev) => prev.map((s) => sessionKey(s) === oldKey ? updated : s))
          setSessions((prev) => prev.map((s) => sessionKey(s) === oldKey ? { ...s, sessionId: realId, isPending: false } : s))
          setComposerPaneTargetKey(current => current === oldKey ? newKey : current)
          if (selectedSessionKeyRef.current === oldKey) setSelectedSessionKey(newKey)
        }
        return
      }
      // A `!command` finished: show its output now, in the shape the
      // persisted entries thread into, in place of the plain echo.
      if (frame.event === 'bash-output' && parsed && typeof parsed === 'object') {
        const bash = parsed as { command?: unknown; stdout?: unknown; stderr?: unknown }
        noteFirstOutput()
        composerTurnProducedOutputRef.current = true
        const bashMessage: ThreadedMessage = {
          role: 'user',
          uuid: `live-bash:${sendStartedAt}`,
          sessionId: targetSession.sessionId,
          providerInstanceId: targetSession.providerInstanceId,
          provider: targetSession.provider ?? 'claude',
          blocks: [
            { type: 'bash_input', command: typeof bash.command === 'string' ? bash.command : trimmed.slice(1).trim() },
            { type: 'bash_output', stdout: typeof bash.stdout === 'string' ? bash.stdout.trim() : '', stderr: typeof bash.stderr === 'string' ? bash.stderr.trim() : '' },
          ],
        }
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(
          prev.filter((message) => !(liveMessageSessionKey(message) === targetKey && message.uuid === 'live-user')),
          bashMessage,
        ))
        return
      }
      if (frame.event === 'opencode-todos' && Array.isArray(parsed)) {
        setComposerLiveTodos(parsed as import('../../../../lib/taskRegistry').OpenCodeTodo[])
        return
      }
      if (frame.event === 'command-result' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        noteFirstOutput()
        const result = parsed as {
          message?: unknown
          mode?: unknown
          transcriptExpected?: unknown
          openSession?: unknown
          prefillInput?: unknown
          openModelPicker?: unknown
          model?: unknown
        }
        // A native command may hand work back to the composer: text to edit
        // (Copilot's add-timeline-entry), its model picker, or a model it set.
        if (typeof result.prefillInput === 'string' && result.prefillInput) {
          const prefill = result.prefillInput
          setTimeout(() => {
            composerTextareaRef.current?.setText(prefill)
            setComposerDraft(prefill)
          }, 0)
        }
        if (result.openModelPicker === true) void openModelPicker()
        if (typeof result.model === 'string' && result.model) {
          const pickedModel = result.model
          setTuiModelOverride((prev) => ({ ...prev, [sessionKey(targetSession)]: pickedModel }))
        }
        const opening = result.openSession as { sessionId?: unknown; title?: unknown } | undefined
        if (opening && typeof opening.sessionId === 'string') {
          // Codex /agent: switch to a sub-agent's own thread.
          void openCreatedSession({
            ...targetSession,
            sessionId: opening.sessionId,
            summary: typeof opening.title === 'string' ? opening.title : 'Sub-agent',
            customTitle: undefined,
            isPending: false,
          })
        }
        if (!commandResultExpectsTranscript(result)) commandResultWithoutTranscript = true
        if (
          result.mode === 'interactive'
          || result.mode === 'plan'
          || result.mode === 'autopilot'
          || result.mode === 'shell'
        ) {
          setTuiCopilotMode(result.mode)
        }
        if (typeof result.message === 'string' && result.message.trim()) {
          const message = result.message.trim()
          if (message.includes('\n')) {
            // A listing (/skills, /hooks, /ps …) is output, not a notice: a
            // notice is one line, and the native CLIs print it in the transcript.
            setLocalCommandOutputs((prev) => upsertThreadedMessage(prev, {
              role: 'user',
              uuid: `live-command-result:${sendStartedAt}`,
              sessionId: targetSession.sessionId,
              providerInstanceId: targetSession.providerInstanceId,
              provider: targetSession.provider,
              timestamp: new Date().toISOString(),
              blocks: [{ type: 'local_command_stdout', stdout: message }],
            }))
          } else {
            showTurnNotice('info', message)
          }
        }
        return
      }
      if (!parsed) return
      const parsedRecord = parsed as Record<string, unknown>

      const pendingPermission = extractPendingPermission(parsed)
      if (pendingPermission) {
        noteFirstOutput()
        const codexQuestionMessage = codexQuestionLiveMessage(pendingPermission, targetSession)
        if (codexQuestionMessage) {
          composerTurnProducedOutputRef.current = true
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, codexQuestionMessage))
        }
        setPermissionOptionIndex(0)
        setPendingPermissions((prev) => [...prev.filter((entry) => entry.id !== pendingPermission.id), pendingPermission])
      }
      const repliedPermissionId = extractPermissionReply(parsed)
      if (repliedPermissionId) {
        setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== repliedPermissionId))
      }

      if (parsedRecord.type === 'prompt_suggestion' && typeof parsedRecord.suggestion === 'string') {
        setLivePromptSuggestion(parsedRecord.suggestion)
      }
      if (parsedRecord.type === 'system' && parsedRecord.subtype === 'commands_changed') {
        const commands = normalizeSlashCommandSuggestions(parsedRecord.commands)
        if (commands) setComposerLiveSlashCommands(commands)
      }
      const commandLifecycle = parseClaudeCommandLifecycle(parsedRecord)
      if (commandLifecycle) {
        const { commandUuid, state } = commandLifecycle
        const tracked = steeredComposerSendsRef.current.find((entry) => entry.messageUuid === commandUuid)
        if (tracked) {
          if (state === 'cancelled' || state === 'discarded') {
            steeredComposerSendsRef.current = steeredComposerSendsRef.current.filter((entry) => entry.messageUuid !== commandUuid)
            setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => message.uuid !== tracked.liveMessageUuid))
          } else {
            steeredComposerSendsRef.current = steeredComposerSendsRef.current.map((entry) =>
              entry.messageUuid === commandUuid ? { ...entry, state } : entry)
          }
        }
      }
      if (parsedRecord.type === 'system' && parsedRecord.subtype === 'status') {
        const status = parsedRecord.status === 'requesting' || parsedRecord.status === 'compacting' ? parsedRecord.status : null
        setLiveStatus(status)
      }
      // The Claude SDK auto-retries transient API errors and emits an api_retry
      // system message per attempt. Surface it as the live "Retrying…" status
      // (same as Pi's native retry); it clears on the next delta/result.
      if (parsedRecord.type === 'system' && parsedRecord.subtype === 'api_retry') {
        setLiveStatus('retrying')
      }
      if (parsedRecord.type === 'system' && parsedRecord.subtype === 'thinking_tokens') {
        if (typeof parsedRecord.estimated_tokens === 'number') {
          setComposerThinkingTokens(parsedRecord.estimated_tokens)
        }
      }
      // A model refusal fell back to another model — evict the refused partial
      // from the live overlay so it doesn't linger (the banner arrives via the
      // normal threaded path).
      if (parsedRecord.type === 'system' && parsedRecord.subtype === 'model_refusal_fallback') {
        const uuids = Array.isArray(parsedRecord.retracted_message_uuids)
          ? parsedRecord.retracted_message_uuids.filter((u): u is string => typeof u === 'string')
          : []
        if (uuids.length > 0) {
          const retracted = new Set(uuids)
          setLiveTranscriptMessages((prev) => keepFiltered(prev, (m) => !retracted.has(m.uuid)))
        }
        setComposerLiveText('')
        setComposerLiveReasoning('')
      }
      // Pi surfaces auto-retry / auto-compaction as non-fatal progress so the
      // turn doesn't look hung while it recovers (mirrors native Pi).
      if (parsedRecord.type === 'pi_status') {
        if (parsedRecord.status === 'retry_start') setLiveStatus('retrying')
        else if (parsedRecord.status === 'compaction_start' || parsedRecord.status === 'summarization_retry_start') setLiveStatus('compacting')
        else if (parsedRecord.status === 'retry_end' || parsedRecord.status === 'compaction_end' || parsedRecord.status === 'summarization_retry_end') setLiveStatus(null)
        else if (parsedRecord.status === 'title_changed' && typeof parsedRecord.name === 'string') {
          const name = parsedRecord.name
          setSessionDetail((prev) => prev ? { ...prev, info: prev.info ? { ...prev.info, customTitle: name } : prev.info } : prev)
        }
      }
      if (parsedRecord.type === 'stream_event' && typeof parsedRecord.parent_tool_use_id === 'string' && parsedRecord.parent_tool_use_id) {
        const event = parsedRecord.event as Record<string, unknown> | undefined
        if (event?.type === 'content_block_delta') {
          const eventDelta = event.delta as Record<string, unknown> | undefined
          if (eventDelta?.type === 'text_delta' && typeof eventDelta.text === 'string') {
            const parentId = parsedRecord.parent_tool_use_id
            const deltaText = eventDelta.text
            setLiveSubagentText((prev) => ({ ...prev, [parentId]: (prev[parentId] ?? '') + deltaText }))
          }
        }
      }
      if (parsedRecord.type === 'user' && typeof parsedRecord.parent_tool_use_id === 'string' && parsedRecord.parent_tool_use_id) {
        const parentId = parsedRecord.parent_tool_use_id
        setLiveSubagentText((prev) => {
          if (!(parentId in prev)) return prev
          const { [parentId]: _, ...rest } = prev
          return rest
        })
      }

      const claudeToolUse = extractClaudeStreamToolUse(parsed)
      if (claudeToolUse) {
        noteFirstOutput()
        // A tool call is a side effect — never blind-retry past this point.
        composerTurnProducedOutputRef.current = true
        const startIndex = streamEventIndex(parsed, 'content_block_start')
        if (startIndex != null) {
          liveToolIndexesRef.current.set(startIndex, claudeToolUse.id)
          liveToolInputJsonRef.current.set(startIndex, '')
        }
        setLiveToolActivities((prev) => [...prev, { key: claudeToolUse.id, label: claudeToolUse.name, status: 'running' }])
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, {
          role: 'assistant',
          uuid: `live-tool:${claudeToolUse.id}`,
          sessionId: targetSession.sessionId,
          providerInstanceId: targetSession.providerInstanceId,
          provider: targetSession.provider ?? 'claude',
          blocks: [{
            type: 'tool_thread',
            toolUse: claudeToolUse,
            result: null,
          }],
        }))
      }

      const toolInputDelta = extractClaudeStreamToolInputDelta(parsed)
      if (toolInputDelta) {
        const toolKey = liveToolIndexesRef.current.get(toolInputDelta.index)
        if (toolKey) {
          const accumulated = `${liveToolInputJsonRef.current.get(toolInputDelta.index) ?? ''}${toolInputDelta.partialJson}`
          liveToolInputJsonRef.current.set(toolInputDelta.index, accumulated)
          const input = parseClaudeStreamToolInput(accumulated)
          if (input) {
            setLiveTranscriptMessages((prev) => updateLiveToolThreadInput(prev, toolKey, input))
          }
        }
      }

      const stopIndex = streamEventIndex(parsed, 'content_block_stop')
      if (stopIndex != null) {
        const toolKey = liveToolIndexesRef.current.get(stopIndex)
        if (toolKey) {
          const accumulated = liveToolInputJsonRef.current.get(stopIndex)
          const finalInput = accumulated ? parseClaudeStreamToolInput(accumulated) : null
          if (finalInput) {
            setLiveTranscriptMessages((prev) => updateLiveToolThreadInput(prev, toolKey, finalInput))
          }
          // content_block_stop only means the call finished streaming — the
          // tool itself runs after this, so the card stays running until its
          // tool_result arrives below.
        }
        liveToolInputJsonRef.current.delete(stopIndex)
        liveToolIndexesRef.current.delete(stopIndex)
      }

      // Real tool output for a live Claude card: fills in exit code, line
      // counts, diffs and errors while the turn is still running.
      const claudeToolResults = extractClaudeStreamToolResults(parsed)
      if (claudeToolResults.length > 0) {
        setLiveTranscriptMessages((prev) => claudeToolResults.reduce(applyLiveToolResult, prev))
        setLiveToolActivities((prev) => prev.map((activity) => claudeToolResults.some((r) => r.tool_use_id === activity.key)
          ? { ...activity, status: 'done' }
          : activity))
      }

      const openCodeToolThread = extractOpenCodeLiveToolThread(parsed, targetSession)
      if (openCodeToolThread) {
        noteFirstOutput()
        composerTurnProducedOutputRef.current = true
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, openCodeToolThread))
      }

      const openCodeSubagent = extractOpenCodeLiveSubagent(parsed)
      if (openCodeSubagent) {
        noteFirstOutput()
        activeSubagentIdRef.current = openCodeSubagent.agentId
        setLiveSubagentText((prev) => ({
          ...prev,
          [openCodeSubagent.agentId]: `Agent: ${openCodeSubagent.name}`,
        }))
        const label = openCodeSubagent.type === 'agent'
          ? `Running agent: ${openCodeSubagent.name}`
          : `Running subtask: ${openCodeSubagent.name}`
        const agentCard: ThreadedMessage = {
          role: 'assistant',
          uuid: `live-subagent:${openCodeSubagent.agentId}`,
          sessionId: targetSession.sessionId,
          providerInstanceId: targetSession.providerInstanceId,
          provider: targetSession.provider ?? 'opencode',
          blocks: [{ type: 'text', text: label }],
        }
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, agentCard))
      }

      if (targetSession.provider === 'codex') {
        const codexToolActivity = extractCodexLiveToolActivity(parsedRecord)
        if (codexToolActivity) {
          noteFirstOutput()
          composerTurnProducedOutputRef.current = true
          setLiveToolActivities((prev) => applyLiveToolActivity(prev, codexToolActivity))
        }
        setLiveTranscriptMessages((prev) => appendCodexLiveToolOutput(prev, parsedRecord, targetSession))
      }

      const codexCompletionItem = parsedRecord.type === 'codex_item_completed' && parsedRecord.item && typeof parsedRecord.item === 'object'
        ? parsedRecord.item as Record<string, unknown>
        : null
      const codexCompletionIsText = codexCompletionItem?.type === 'agentMessage' || codexCompletionItem?.type === 'plan'

      if (targetSession.provider === 'claude' && trimmed.startsWith('/') && parsedRecord.type === 'assistant') {
        const synthetic = parsedRecord.message as { model?: unknown; id?: unknown; content?: unknown } | undefined
        if (synthetic?.model === '<synthetic>' && Array.isArray(synthetic.content)) {
          const stdout = synthetic.content
            .map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' ? String((block as { text?: unknown }).text ?? '') : ''))
            .join('\n')
            .trim()
          if (stdout) {
            noteFirstOutput()
            const outputMessage: ThreadedMessage = {
              role: 'user',
              uuid: `live-local-command:${typeof synthetic.id === 'string' ? synthetic.id : sendStartedAt}`,
              sessionId: targetSession.sessionId,
              providerInstanceId: targetSession.providerInstanceId,
              provider: 'claude',
              timestamp: new Date().toISOString(),
              blocks: [{ type: 'local_command_stdout', stdout }],
            }
            setLocalCommandOutputs((prev) => upsertThreadedMessage(prev, outputMessage))
            // A local command runs no model turn and may persist nothing the
            // SDK returns, so waiting for persisted rows only ever ended at
            // the 12s escape hatch.
            commandResultWithoutTranscript = true
          }
        }
      }
      if (targetSession.provider === 'claude') {
        const threaded = normalizeClaudeStreamThreadedMessage(parsed)
        if (threaded) {
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, { ...threaded, providerInstanceId: targetSession.providerInstanceId }))
        }
      } else if (targetSession.provider === 'codex') {
        const threaded = normalizeCodexStreamThreadedMessage(parsed, targetSession.sessionId)
        if (threaded || codexCompletionIsText) {
          setLiveTranscriptMessages((prev) => {
            const withoutStreamingText = codexCompletionIsText
              ? prev.filter((message) => message.uuid !== CODEX_LIVE_ASSISTANT_UUID)
              : prev
            return threaded
              ? upsertThreadedMessage(withoutStreamingText, { ...threaded, providerInstanceId: targetSession.providerInstanceId })
              : withoutStreamingText
          })
        }
        if (codexCompletionIsText) {
          pendingLiveTextRef.current = ''
          setComposerLiveText('')
        }
      } else if (targetSession.provider === 'copilot') {
        const threaded = extractCopilotFinalAssistantMessage(parsed, targetSession)
        if (threaded) {
          noteFirstOutput()
          copilotFinalMessageSeen = true
          const finalText = extractStreamingAssistantText(parsed)
          if (finalText) replyAccumulator = finalText
          pendingLiveTextRef.current = ''
          setComposerLiveText('')
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(
            prev.filter((message) => (
              liveMessageSessionKey(message) !== targetKey
              || !isLiveAssistantTextMessage(message)
            )),
            threaded,
          ))
          return
        }
      }

      if (targetSession.provider === 'codex' && codexCompletionIsText) {
        const finalText = extractStreamingAssistantText(parsed)
        if (finalText) replyAccumulator = finalText
        return
      }

      // Reasoning streams on its own channel; capture it before the answer
      // bail-out so a thinking-only frame still updates the dim preview.
      const reasoningDelta = extractStreamingReasoningText(parsed)
      if (reasoningDelta) {
        noteFirstOutput()
        setLiveStatus(null)
        pendingLiveReasoningRef.current = `${pendingLiveReasoningRef.current}${reasoningDelta}`
        liveTextTargetSessionRef.current = targetSession
        if (liveTextFlushTimerRef.current == null) {
          liveTextFlushTimerRef.current = setTimeout(flushLiveText, LIVE_TEXT_FLUSH_MS)
        }
      }

      const delta = extractStreamingAssistantText(parsed)
      if (!delta) return
      noteFirstOutput()
      // Committed assistant output — this turn must not be blind-retried.
      composerTurnProducedOutputRef.current = true
      setLiveStatus(null)

      // Route agent/subtask text to liveSubagentText so it appears as ↪ subagent: <text>
      // in the status footer, visually distinct from the main model's text.
      const agentId = activeSubagentIdRef.current
      if (targetSession.provider === 'opencode' && agentId) {
        const replace = shouldReplaceLiveAssistantText(parsed)
        setLiveSubagentText((prev) => ({
          ...prev,
          [agentId]: replace ? delta : (prev[agentId] ?? '') + delta,
        }))
        return
      }

      const replace = shouldReplaceLiveAssistantText(parsed)
      replyAccumulator = replace ? delta : `${replyAccumulator}${delta}`
      if (targetSession.provider === 'claude') {
        const textBlockIndex = streamEventIndex(parsed, 'content_block_delta')
        if (textBlockIndex != null) {
          const blockText = `${claudeLiveTextByIndex.get(textBlockIndex) ?? ''}${delta}`
          claudeLiveTextByIndex.set(textBlockIndex, blockText)
          liveTextBatch.push(makeLiveAssistantTextMessage(
            targetSession,
            blockText,
            `${CLAUDE_LIVE_ASSISTANT_UUID_PREFIX}${textBlockIndex}`,
          ))
        }
      } else if (targetSession.provider === 'codex') {
        const visibleText = extractCodexVisibleAssistantText(parsed)
        if (visibleText) {
          codexLiveMessageAccumulator = shouldReplaceCodexVisibleAssistantText(parsed)
            ? visibleText
            : `${codexLiveMessageAccumulator}${visibleText}`
          liveTextBatch.push(makeLiveAssistantTextMessage(
            targetSession,
            codexLiveMessageAccumulator,
            CODEX_LIVE_ASSISTANT_UUID,
          ))
        }
      } else {
        const liveMessageKey = liveAssistantTextKey(parsedRecord, targetSession.provider)
        const liveMessageText = replace
          ? delta
          : `${providerLiveTextByKey.get(liveMessageKey) ?? ''}${delta}`
        providerLiveTextByKey.set(liveMessageKey, liveMessageText)
        liveTextBatch.push(makeLiveAssistantTextMessage(targetSession, liveMessageText, liveMessageKey))
      }
      pendingLiveTextRef.current = replace ? delta : `${pendingLiveTextRef.current}${delta}`
      liveTextTargetSessionRef.current = targetSession
      // One flush path for every provider: coalesce through a render-loop-
      // independent timer (see LIVE_TEXT_FLUSH_MS — must NOT be
      // requestAnimationFrame). opencode used to flush synchronously here, but
      // that was only a workaround for the OpenTUI RAF freeze the timer now
      // solves generically — so the provider split is gone.
      if (liveTextFlushTimerRef.current == null) {
        liveTextFlushTimerRef.current = setTimeout(flushLiveText, LIVE_TEXT_FLUSH_MS)
      }
    }

    // Stall watchdog: only Claude emits server heartbeats, so only Claude can
    // be confidently judged dead-vs-slow. Race each read against a timeout; on
    // a stall, stop owning the stream and fall through to the completion path
    // (awaitingPersistedTurn + a detail refresh) so the still-running turn keeps
    // rendering from the persisted log instead of a frozen "sending" spinner.
    const stallGuard = targetSession.provider === 'claude'
    let streamStalled = false
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>
      if (stallGuard) {
        const readPromise = reader.read()
        readPromise.catch(() => {}) // abandoned on stall; swallow its rejection
        let stallTimer: ReturnType<typeof setTimeout> | undefined
        const stallPromise = new Promise<typeof STREAM_STALL_SENTINEL>((resolve) => {
          stallTimer = setTimeout(() => resolve(STREAM_STALL_SENTINEL), CLAUDE_STREAM_STALL_MS)
        })
        const raced = await Promise.race([readPromise, stallPromise])
        if (stallTimer) clearTimeout(stallTimer)
        if (raced === STREAM_STALL_SENTINEL) { streamStalled = true; break }
        readResult = raced
      } else {
        readResult = await reader.read()
      }
      const { done, value } = readResult
      if (done) break
      sseBuffer += decoder.decode(value, { stream: true })
      const { frames, remaining } = extractSseFrames(sseBuffer)
      sseBuffer = remaining
      for (const frame of frames) {
        handleFrame(frame)
      }
    }

    if (streamStalled) {
      showTurnNotice('info', 'Live stream stalled — turn still running; syncing transcript.')
      // The turn is still running server-side, but `finally` clears this
      // loop's running mark and the registry poll only re-marks it on its
      // next tick — in between, a queued follow-up would flush as a second
      // concurrent turn. Hold the queue as for a reattached turn; the poll
      // takes over the flag from here.
      if (selectedSessionKeyRef.current === targetKey) {
        reattachedRunningKeyRef.current = targetKey
        reattachedRunningRef.current = true
        setReattachedRunning(true)
      }
    }

    if (sseBuffer.trim()) {
      const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
      for (const frame of frames) {
        handleFrame(frame)
      }
    }

    liveTextBatch.flush()

    if (targetSession.provider === 'copilot' && !copilotFinalMessageSeen && replyAccumulator.trim()) {
      setLiveTranscriptMessages((prev) => upsertThreadedMessage(
        prev.filter((message) => (
          liveMessageSessionKey(message) !== targetKey
          || !isLiveAssistantTextMessage(message)
        )),
        makeLiveAssistantTextMessage(
          targetSession,
          replyAccumulator,
          `live-copilot:fallback:${sendStartedAt}`,
        ),
      ))
    }

    setSentHistory((prev) => [...prev, {
      text: submission.visibleText.trim(),
      attachments: sendAttachments,
      promptParts: submission.promptParts,
    }])
    appendComposerSentHistory(submission.visibleText)
    setHistoryIndex(-1)
    setDraftBeforeHistory({ text: '', attachments: [], promptParts: [] })
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    setComposerSendState('idle')
    setInterruptPressActive(false)
    if (interruptPressTimeoutRef.current) {
      clearTimeout(interruptPressTimeoutRef.current)
      interruptPressTimeoutRef.current = null
    }
    setComposerError(null)
    if (commandResultWithoutTranscript) {
      liveTranscriptBaselineRef.current.delete(targetKey)
      setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      setAwaitingPersistedTurn(false)
    } else {
      setAwaitingPersistedTurn(true)
    }
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    void refreshSessions(provider, true, false)
    void refreshSelectedSessionDetail(targetSession, true)
    if (targetSession.provider === 'codex' && tuiCodexModeByKeyRef.current[targetKey] === 'plan') {
      // Codex asks "Implement this plan?" here; Plan mode never edits, so say
      // how to leave it rather than leave the user waiting on nothing.
      showTurnNotice('info', 'Plan mode · ⇧Tab to Default, then ask Codex to implement the plan', 10_000)
    }

    if (liveTextFlushTimerRef.current != null) {
      clearTimeout(liveTextFlushTimerRef.current)
      liveTextFlushTimerRef.current = null
    }
    pendingLiveTextRef.current = ''
    liveTextTargetSessionRef.current = null

    const elapsedMs = Date.now() - sendStartedAt
    if (elapsedMs >= NOTIFY_AFTER_MS) {
      const firstLine = replyAccumulator.split('\n').find((line) => line.trim().length > 0) ?? ''
      const preview = firstLine.length > NOTIFY_PREVIEW_CHARS
        ? `${firstLine.slice(0, NOTIFY_PREVIEW_CHARS - 1)}…`
        : firstLine || 'Reply ready'
      // Native OSC FFI: off on Windows, and only when the terminal advertises
      // notification support (capabilities is null when unknown — try anyway).
      // BMP-sanitize the model-generated preview/title before the boundary.
      if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
        try {
          renderer.triggerNotification(
            toBmpSafe(preview),
            toBmpSafe(`agent-viewer · ${formatSessionTitle(targetSession)}`),
          )
        } catch {
          // terminal doesn't support OSC notifications — silently ignore
        }
      }
    }
  } catch (err) {
    liveTextBatch.flush()
    // An interrupt aborts this controller, but the provider's reaction (Claude
    // sends an error frame for the cut-off turn) can land before the abort
    // does. Whatever error follows our own abort is the interrupt, not a
    // failed turn — treating it as one restored the old prompt and reattached
    // to the dying turn, delaying the next prompt ~30s.
    if ((err instanceof Error && err.name === 'AbortError') || controller.signal.aborted) {
      // Confirmed interrupt: cancelComposerSend already moved us into the
      // awaitingPersistedTurn reconcile and wants the partial output kept.
      // Don't tear it down here — just clean up the live-text frame plumbing.
      if (composerInterruptPendingRef.current) {
        composerInterruptPendingRef.current = false
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        if (liveTextFlushTimerRef.current != null) {
          clearTimeout(liveTextFlushTimerRef.current)
          liveTextFlushTimerRef.current = null
        }
        pendingLiveTextRef.current = ''
        liveTextTargetSessionRef.current = null
        return
      }
      liveTranscriptBaselineRef.current.delete(targetKey)
      setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
      setAwaitingPersistedTurn(false)
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      if (liveTextFlushTimerRef.current != null) {
        clearTimeout(liveTextFlushTimerRef.current)
        liveTextFlushTimerRef.current = null
      }
      pendingLiveTextRef.current = ''
      liveTextTargetSessionRef.current = null
      return
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
    // Visible auto-retry: ride out a transient API/network blip when the turn
    // produced no output yet (mirrors the web composer + Pi's native retry).
    // Keep the turn 'sending' with a 'retrying' status across the backoff,
    // then re-fire the same draft. The finally below preserves liveStatus
    // while a retry timer is armed (see the guarded setLiveStatus there).
    const retry = planComposerRetry(err, { producedOutput: composerTurnProducedOutputRef.current, attempts: composerRetryCountRef.current })
    if (retry) {
      composerRetryCountRef.current = retry.attempt
      const retryDraft = submission.visibleText
      const retryAttachments = sendAttachments
      setLiveStatus('retrying')
      setComposerLiveText('')
      setLiveToolActivities(keepEmpty)
      liveTranscriptBaselineRef.current.delete(targetKey)
      setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      if (composerRetryTimerRef.current) clearTimeout(composerRetryTimerRef.current)
      composerRetryTimerRef.current = setTimeout(() => {
        composerRetryTimerRef.current = null
        void runSendComposerMessage(ctx, retryDraft, retryAttachments, true, submission.promptParts, turnRequestId)
      }, retry.delayMs)
      return
    }
    // The stream died but the turn survived in the running registry — hand
    // off to the reattach poll instead of surfacing a send error (the web
    // composer's stall recovery, in-process). Keep the live echo + baseline:
    // the detail poll reconciles them once persisted rows land. Queued sends
    // stay armed; the queue flush is gated on reattachedRunning.
    // A pending session's turn registers under the id it was sent with, so
    // its first turn is probed like any other. An error the server sent as a
    // frame is the turn's own outcome, not a lost stream: the registry can
    // still list the turn for a moment while it tears down, and "reattaching"
    // there hid the reason (`Agent not found`) behind a turn that then
    // quietly produced nothing.
    let turnStillRunning = false
    if (!(err instanceof TransientAwareSendError)) {
      try {
        turnStillRunning = (await listTuiRunningSessions()).some((entry) =>
          entry.sessionId === targetSession.sessionId
          && entry.provider === (targetSession.provider ?? 'claude'))
      } catch { /* registry probe is best-effort */ }
    }
    if (turnStillRunning) {
      setComposerSendState('idle')
      setComposerError(null)
      setLiveStatus(null)
      setLiveToolActivities(keepEmpty)
      if (selectedSessionKeyRef.current === targetKey) {
        reattachedRunningKeyRef.current = targetKey
        reattachedRunningRef.current = true
        setReattachedRunning(true)
      }
      showTurnNotice('info', 'Send stream lost — reattached to the running turn', 3500)
      return
    }
    const failedDraft = submission.visibleText
    setComposerSendState('error')
    setComposerError(err instanceof Error ? err.message : 'Failed to send message')
    setComposerLiveText('')
    setLiveStatus(null)
    setLiveToolActivities(keepEmpty)
    setAwaitingPersistedTurn(false)
    // Don't auto-fire queued follow-ups after a failed turn. Rebuild one
    // editable snapshot from the failed send, every queued follow-up, and the
    // newest draft typed while the turn ran—attachments and prompt parts too.
    const failedQueue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
    commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    if (!isCurrentTarget()) {
      const key = sessionKey(targetSession)
      const restored = restoreComposerDraftPayload({ text: readWorkspaceDraft(key), attachments: [] }, failedQueue, { text: failedDraft, attachments: sendAttachments })
      writeWorkspaceDraft(key, restored.text)
      writeWorkspaceDraftParts(key, [...submission.promptParts, ...failedQueue.flatMap(entry => entry.promptParts), ...readWorkspaceDraftParts(key)])
      showNotice('error', `${formatSessionTitle(targetSession)}: ${errorMessage}`)
      return
    }
    const restoredPayload = restoreComposerDraftPayload(
      {
        text: composerTextareaRef.current?.plainText ?? '',
        attachments: composerMentionAttachmentsRef.current,
      },
      failedQueue,
      { text: failedDraft, attachments: sendAttachments },
    )
    const restoredParts = [
      ...submission.promptParts,
      ...failedQueue.flatMap((entry) => entry.promptParts),
      ...composerPromptPartsRef.current,
    ]
    const restoredDraft = restoredPayload.text
    composerTextareaRef.current?.setText(restoredDraft)
    setComposerDraft(restoredDraft)
    composerMentionAttachmentsRef.current = restoredPayload.attachments
    composerPromptPartsRef.current = restoredParts
    setComposerMentionAttachments(restoredPayload.attachments)
    setComposerPromptParts(restoredParts)
    restoreComposerPromptPartExtmarks(restoredParts, restoredDraft)
  } finally {
    liveTextBatch.cancel()
    void reader?.cancel().catch(() => {})
    composerAbortRef.current = null
    if (activeComposerTurnRequestIdRef.current === turnRequestId) {
      activeComposerTurnRequestIdRef.current = null
    }
    if (liveTextFlushTimerRef.current != null) {
      clearTimeout(liveTextFlushTimerRef.current)
      liveTextFlushTimerRef.current = null
    }
    pendingLiveTextRef.current = ''
    liveTextTargetSessionRef.current = null
    setComposerLiveText('')
    // Preserve the 'retrying' status while a transient-retry backoff is armed;
    // the catch above left composerSendState 'sending' so the badge shows.
    if (composerRetryTimerRef.current == null) setLiveStatus(null)
    setLiveSubagentText({})
    setLiveOutputTokens(0)
    setLiveToolActivities(keepEmpty)
    setComposerSendStartedAt(null)
    clearSessionRunning(runningRef)
    // Ownership is scoped to this session, including pending-id aliases.
    ownedTurnKeyRef.current = null
    if (activeComposerSendCleanupRef.current === turnCleanupPromise) {
      activeComposerSendCleanupRef.current = null
    }
    resolveTurnCleanup()
    if (composerSessions.get<SendState>(targetKey, 'composerSendState', 'idle') === 'idle' && !reattachedRunningRef.current && !exitInProgressRef.current) {
      const next = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)[0]
      if (next) {
        commitQueuedComposerSends(removeComposerQueueItem(queuedComposerSendsRef.current, next.id))
        queueMicrotask(() => { void runSendComposerMessage(ctx, next.text, next.attachments, false, next.promptParts) })
      }
    }
  }
}
