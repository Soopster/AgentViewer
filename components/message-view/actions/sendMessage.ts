import type { Session } from '../../../lib/types'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import type { RefObject } from 'react'
import type { ChannelBridge } from '../../useChannelBridge'
import type { IdeBridge } from '../../useIdeBridge'
import type { SessionMessage } from '../../../lib/types'
import { type ContextComposerHandle } from '../../ContextComposer'
import { projectComposerContext, referencedComposerAttachments } from '@/lib/composerContext'
import { type SendState, type ContextUsage, type SessionInfo, type SendAttachment, type ReasoningEffortLevel } from '@/lib/types'
import { type ThreadedMessage } from '@/lib/threading'
import { recordClientPerf } from '@/lib/clientPerf'
import { applyClaudeLiveToolResults, extractClaudeStreamToolResults, extractClaudeStreamToolInputDelta, normalizeClaudeStreamThreadedMessage, parseClaudeStreamToolInput } from '@/lib/claudeMapper'
import { normalizeCodexStreamArtifactMessage } from '@/lib/codexMapper'
import { normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '@/lib/slashCommands'
import { extractCopilotPushedAttachments, extractPendingPermission, extractPermissionReply, type PendingPermission } from '@/lib/permissions'
import { parseClaudeCommandLifecycle } from '@/lib/claudeCommandLifecycle'
import { isResumeDropsTurnRefusal, isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs, TransientAwareSendError, type UsageLimitKind } from '@/lib/transientError'
import { sessionIdentityKey } from '@/lib/sessionIdentity'
import { commandResultExpectsTranscript, isNativeComposerCommandText } from '@/lib/composerCommands'
import { deliverComposerSteer } from '@/lib/composerSteering'
import { clearComposerQueueTarget, createComposerQueueItemId, mergeComposerAttachments, restoreComposerDraftPayload, selectComposerQueueTarget } from '@/lib/composerAttachments'
import { type QueuedWebSend, type PendingMessageBaseline, type CopilotContextTier, type FailedSend, type SteeredSendEntry, type LiveToolActivity } from '../types'
import { SENT_HISTORY_MAX, writePersistedSentHistory, STREAM_STALL_SENTINEL, CLAUDE_STREAM_STALL_MS } from '../constants'
import { extractSseFrames, extractLiveToolStart, upsertThreadedMessage, updateLiveToolThreadInput, extractCompletedToolKey, completeLiveToolThread, extractLiveToolStopIndex, extractStreamingAssistantText, shouldReplaceLiveAssistantText, extractStreamingReasoningText } from '../liveStream'
import { buildPendingMessageBaseline, retargetPendingMessageBaseline } from '../threadedCompare'
import { getWebComposerQueueStore } from '../composerStorage'

export type SendMessageContext = {
  session: Session | null
  setSendError: Dispatch<SetStateAction<string | null>>
  modelsLoading: boolean
  selectedModel: string
  pendingSendOnModelsReadyRef: MutableRefObject<string | null>
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  inputTextRef: MutableRefObject<string>
  attachments: SendAttachment[]
  attachmentReadsRef: RefObject<number>
  channelBridgeRef: RefObject<ChannelBridge>
  canUseChannelBridge: boolean
  setInputText: Dispatch<SetStateAction<string>>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  resizeComposer: () => void
  ideBridgeRef: RefObject<IdeBridge>
  canUseIdeBridge: boolean
  sendInFlightRef: MutableRefObject<boolean>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  reattachedRunningRef: MutableRefObject<boolean>
  activeTurnRequestIdRef: MutableRefObject<string | null>
  setSteeredNotice: Dispatch<SetStateAction<string | null>>
  steeredUserTextsRef: MutableRefObject<SteeredSendEntry[]>
  setSteeredUserTexts: Dispatch<SetStateAction<SteeredSendEntry[]>>
  commitQueuedSends: (next: QueuedWebSend[]) => void
  queuedSendsRef: RefObject<QueuedWebSend[]>
  transientRetryCountRef: MutableRefObject<number>
  turnProducedOutputRef: MutableRefObject<boolean>
  setReattachedRunning: Dispatch<SetStateAction<boolean>>
  pushedCopilotAttachmentsRef: MutableRefObject<SendAttachment[]>
  selectedEffort: ReasoningEffortLevel | 'auto'
  sentHistoryRef: RefObject<string[]>
  setSentHistory: Dispatch<SetStateAction<string[]>>
  setHistoryIndex: Dispatch<SetStateAction<number>>
  draftBeforeHistoryRef: RefObject<{ text: string; cursorPos: number; }>
  setSendState: Dispatch<SetStateAction<SendState>>
  setFailedSend: Dispatch<SetStateAction<FailedSend | null>>
  setInterrupting: Dispatch<SetStateAction<boolean>>
  setOptimisticUserText: Dispatch<SetStateAction<string | null>>
  setOptimisticContextText: Dispatch<SetStateAction<string | null>>
  clearLiveAssistantText: () => void
  setLiveToolActivities: Dispatch<SetStateAction<LiveToolActivity[]>>
  setLiveThreadedMessages: Dispatch<SetStateAction<ThreadedMessage[]>>
  setLivePromptSuggestion: Dispatch<SetStateAction<string | null>>
  setLiveStatus: Dispatch<SetStateAction<'requesting' | 'compacting' | 'retrying' | null>>
  clearLiveSubagentText: () => void
  setAwaitingPersistedTurn: Dispatch<SetStateAction<boolean>>
  setAutoFollow: Dispatch<SetStateAction<boolean>>
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  messages: SessionMessage[]
  liveToolIndexesRef: MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: MutableRefObject<Map<number, string>>
  abortControllerRef: MutableRefObject<AbortController | null>
  resumeFromMessageId: string | null
  selectedAgent: string
  selectedCopilotMode: string
  selectedCopilotContextTier: CopilotContextTier | null
  selectedPermissionMode: 'auto' | 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  taskBudgetTokens: number | null
  enableWorkflow: boolean
  selectedCodexApproval: 'auto' | 'untrusted' | 'on-request' | 'never'
  setContextUsage: Dispatch<SetStateAction<ContextUsage | null>>
  liveTurnSessionHandoffRef: MutableRefObject<string | null>
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): MutableRefObject<T>; peekRef<T>(key: string, name: string): MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
  onFork: ((newSessionId: string, sourceSession?: Session) => void) | undefined
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  setSelectedCopilotMode: Dispatch<SetStateAction<string>>
  setLiveSlashCommands: Dispatch<SetStateAction<SlashCommandSuggestion[]>>
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>
  queueLiveSubagentDelta: (parentId: string, delta: string) => void
  removeLiveSubagentEntry: (parentId: string) => void
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
  composerQueueTargetKey: string | null
  queueLiveAssistantText: (deltaText: string, replace: boolean) => void
  queueLiveReasoningText: (deltaText: string) => void
  setLiveThinkingTokens: Dispatch<SetStateAction<number>>
  flushLiveAssistantTextNow: () => void
  refreshSessionModels: ({ preserveSelection }: { preserveSelection: boolean; }) => void
  setResumeFromMessageId: Dispatch<SetStateAction<string | null>>
  transientRetryTimerRef: MutableRefObject<NodeJS.Timeout | null>
  activeWebComposerOwnerRef: RefObject<string>
  composerQueueClaimInFlightRef: RefObject<Set<string>>
  setQueuedSends: Dispatch<SetStateAction<QueuedWebSend[]>>
}

export async function runSendMessage(ctx: SendMessageContext, retryOverride?: { text: string; attachments: SendAttachment[]; turnRequestId?: string; } | undefined) {
  const {
    session, setSendError, modelsLoading, selectedModel, pendingSendOnModelsReadyRef, textareaRef,
    inputTextRef, attachments, attachmentReadsRef, channelBridgeRef, canUseChannelBridge,
    setInputText, setAttachments, resizeComposer, ideBridgeRef, canUseIdeBridge, sendInFlightRef,
    awaitingPersistedTurnRef, reattachedRunningRef, activeTurnRequestIdRef, setSteeredNotice,
    steeredUserTextsRef, setSteeredUserTexts, commitQueuedSends, queuedSendsRef,
    transientRetryCountRef, turnProducedOutputRef, setReattachedRunning,
    pushedCopilotAttachmentsRef, selectedEffort, sentHistoryRef, setSentHistory, setHistoryIndex,
    draftBeforeHistoryRef, setSendState, setFailedSend, setInterrupting, setOptimisticUserText,
    setOptimisticContextText, clearLiveAssistantText, setLiveToolActivities,
    setLiveThreadedMessages, setLivePromptSuggestion, setLiveStatus, clearLiveSubagentText,
    setAwaitingPersistedTurn, setAutoFollow, pendingMessageBaselineRef, messages,
    liveToolIndexesRef, liveToolInputJsonRef, abortControllerRef, resumeFromMessageId,
    selectedAgent, selectedCopilotMode, selectedCopilotContextTier, selectedPermissionMode,
    taskBudgetTokens, enableWorkflow, selectedCodexApproval, setContextUsage,
    liveTurnSessionHandoffRef, composerSessions, composerOwnerKey, onFork, setSessionActionNotice,
    setSelectedCopilotMode, setLiveSlashCommands, setSessionInfo, queueLiveSubagentDelta,
    removeLiveSubagentEntry, setPendingPermissions, composerQueueTargetKey, queueLiveAssistantText,
    queueLiveReasoningText, setLiveThinkingTokens, flushLiveAssistantTextNow, refreshSessionModels,
    setResumeFromMessageId, transientRetryTimerRef, activeWebComposerOwnerRef,
    composerQueueClaimInFlightRef, setQueuedSends,
  } = ctx
  if (!session) return
  setSendError(null)

  // Custom-model providers (LM Studio, opencode/copilot custom endpoints) can
  // take a moment to enumerate their model list on a cold connection. Sending
  // before that resolves means `selectedModel` is still '' and the request
  // falls back to whatever the backend guesses as a default — which may not
  // actually be available yet. Block until the fetch settles (success or
  // failure) rather than gamble on an unresolved model.
  // Claude and Codex are exempt: both explicitly treat an omitted `model` as
  // "use the CLI/thread's own configured default" server-side, exactly like
  // typing into the native CLI never waits on a model list first — gating
  // the very first send on this fetch (which can take a second or two,
  // notably Claude's getContextUsage() round trip) only made the composer
  // feel slower than the CLI for no correctness benefit.
  const modelIsOptionalForProvider = session.provider === 'claude' || session.provider === 'codex'
  if (!retryOverride && !modelIsOptionalForProvider && modelsLoading && !selectedModel) {
    pendingSendOnModelsReadyRef.current = session.sessionId
    setSendError('Waiting for model list to load…')
    return
  }

  // Global Channel Bridge binding: when the user has toggled "route composer
  // through bridge", a normal composer send (never an auto-retry) is diverted
  // to the live `claude` CLI session instead of the active provider. The send
  // is fire-and-forget — replies/permission prompts surface in the bridge
  // panel — so we just push the text, clear the composer, and return before
  // any of the provider streaming machinery runs.
  try {
    projectComposerContext(retryOverride?.text ?? textareaRef.current?.value ?? inputTextRef.current, retryOverride?.attachments ?? attachments)
  } catch (error) {
    setSendError(error instanceof Error ? error.message : 'Context is unavailable')
    return
  }
  if (attachmentReadsRef.current > 0) {
    setSendError('Attachments are still being read. Try sending again in a moment.')
    return
  }
  const bridge = channelBridgeRef.current
  if (!retryOverride && canUseChannelBridge && bridge.routeComposer) {
    const text = (textareaRef.current?.value ?? inputTextRef.current).trim()
    if (!text) return
    if (referencedComposerAttachments(text, attachments).some(a => a.contextKind === 'image' && a.data && !a.path)) {
      setSendError('Use direct chat to send image data, or attach the image by its local path for the bridge.')
      return
    }
    try {
      await bridge.send(projectComposerContext(text, attachments).text)
      setInputText('')
      inputTextRef.current = ''
      if (textareaRef.current) textareaRef.current.value = ''
      setAttachments([])
      window.requestAnimationFrame(resizeComposer)
    } catch {
      // error surfaced via the bridge panel (bridge.sendError)
    }
    return
  }
  // Global IDE Bridge binding: like the channel bridge above, but pushes the
  // composer line as an @file mention into the `claude` session connected to
  // agentViewer's IDE host instead of sending a chat turn. Fire-and-forget —
  // tool calls / diffs surface in the IDE panel.
  const ide = ideBridgeRef.current
  if (!retryOverride && canUseIdeBridge && ide.routeComposer) {
    const text = (textareaRef.current?.value ?? inputTextRef.current).trim()
    if (!text) return
    if (referencedComposerAttachments(text, attachments).some(a => a.contextKind === 'image' && a.data && !a.path)) {
      setSendError('Use direct chat to send image data, or attach the image by its local path for the bridge.')
      return
    }
    try {
      await ide.send(projectComposerContext(text, attachments).text)
      setInputText('')
      inputTextRef.current = ''
      if (textareaRef.current) textareaRef.current.value = ''
      setAttachments([])
      window.requestAnimationFrame(resizeComposer)
    } catch {
      // error surfaced via the IDE bridge panel (ide.sendError)
    }
    return
  }
  // Provider CLIs accept follow-up input while the current turn is still
  // streaming — they steer or queue it. Mirror that: if a send fires
  // while one is in flight, stash the draft and have the post-stream effect
  // flush it once the current turn lands. A transient auto-retry (retryOverride)
  // is never a queue candidate — it only fires after the failed turn settled.
  if (!retryOverride && (sendInFlightRef.current || awaitingPersistedTurnRef.current || reattachedRunningRef.current)) {
    const queueText = (textareaRef.current?.value ?? inputTextRef.current).trim()
    const queueAttachments = referencedComposerAttachments(queueText, attachments)
    if (!queueText && queueAttachments.length === 0) return
    setInputText('')
    inputTextRef.current = ''
    textareaRef.current?.value !== undefined && (textareaRef.current!.value = '')
    setAttachments([])
    window.requestAnimationFrame(resizeComposer)
    // Native steering first: deliver the message INTO the running turn
    // (Claude pushes onto the warm query's input stream, Codex turn/steer,
    // Copilot immediate mode, Pi steer(), opencode queues server-side).
    // Attachments can't ride a
    // steer, and a turn in post-stream reconcile has nothing to steer —
    // those (and delivered:false / errors) fall back to the client queue.
    // Slash commands and `!` shell input never steer: steering would inject
    // them as literal prompt text mid-turn, whereas the native CLIs queue
    // them and execute them natively once the turn ends — the queue below
    // flushes into the send path, which does exactly that.
    if ((sendInFlightRef.current || reattachedRunningRef.current) && queueAttachments.length === 0 && !isNativeComposerCommandText(queueText)) {
      try {
        const result = await deliverComposerSteer(async (payload) => {
          const res = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, providerInstanceId: session.providerInstanceId }),
          })
          if (!res.ok) throw new Error(`Steer failed with HTTP ${res.status}`)
          const json = await res.json() as { result?: { delivered?: unknown; messageUuid?: unknown } }
          if (!json.result) throw new Error('Steer response did not include a result')
          return json.result
        }, {
          message: queueText,
          provider: session.provider,
          turnRequestId: activeTurnRequestIdRef.current ?? undefined,
        })
        if (result.delivered === true) {
          setSteeredNotice(queueText)
          // Echo it into the live overlay immediately — it's part of the
          // running turn now, like typing in the provider's native CLI.
          const messageUuid = typeof result.messageUuid === 'string' ? result.messageUuid : undefined
          const nextSteeredEntries = [...steeredUserTextsRef.current, { text: queueText, messageUuid }]
          steeredUserTextsRef.current = nextSteeredEntries
          setSteeredUserTexts(nextSteeredEntries)
          return
        }
      } catch {
        // Steering is best-effort; the queue below is the reliable path.
      }
    }
    const targetKey = sessionIdentityKey(session)
    commitQueuedSends([...queuedSendsRef.current, {
      id: createComposerQueueItemId(targetKey),
      targetKey,
      text: queueText,
      attachments: queueAttachments,
    }])
    return
  }

  const text = retryOverride ? retryOverride.text : (textareaRef.current?.value ?? inputTextRef.current).trim()
  const sendAttachments = referencedComposerAttachments(text, retryOverride ? retryOverride.attachments : attachments)
  if (!text && sendAttachments.length === 0) return

  // Reset the retry counter at the start of a fresh (non-retry) send.
  if (!retryOverride) transientRetryCountRef.current = 0
  pendingSendOnModelsReadyRef.current = null
  turnProducedOutputRef.current = false

  sendInFlightRef.current = true
  // We now own a live stream — drop any reattach tracking so the turn renders
  // from the stream, not the /running poll.
  reattachedRunningRef.current = false
  setReattachedRunning(false)
  pushedCopilotAttachmentsRef.current = []
  // A send consumes its attachment chips immediately, just like its text.
  // This lets the user compose the next prompt while the turn runs without
  // accidentally re-queuing the prior turn's files. Retries keep the user's
  // newer draft attachments untouched and reuse the captured payload.
  if (!retryOverride) setAttachments([])
  const effort = selectedEffort === 'auto' ? undefined : selectedEffort
  const historyText = projectComposerContext(text, sendAttachments).text
  const currentSentHistory = sentHistoryRef.current
  if (text && currentSentHistory[currentSentHistory.length - 1] !== historyText) {
    const next = [...currentSentHistory, historyText]
    const capped = next.length > SENT_HISTORY_MAX ? next.slice(next.length - SENT_HISTORY_MAX) : next
    sentHistoryRef.current = capped
    setSentHistory(capped)
    writePersistedSentHistory(capped)
  }
  setHistoryIndex(-1)
  draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
  setInputText('')
  inputTextRef.current = ''
  setSendState('sending')
  setSteeredNotice(null)
  setFailedSend(null)
  setInterrupting(false)
  setOptimisticUserText(text)
  setOptimisticContextText(historyText)
  setSteeredUserTexts([])
  clearLiveAssistantText()
  setLiveToolActivities([])
  setLiveThreadedMessages([])
  setLivePromptSuggestion(null)
  setLiveStatus(null)
  clearLiveSubagentText()
  awaitingPersistedTurnRef.current = false
  setAwaitingPersistedTurn(false)
  setAutoFollow(true)
  pendingMessageBaselineRef.current = buildPendingMessageBaseline(messages, session.sessionId)
  liveToolIndexesRef.current.clear()
  liveToolInputJsonRef.current.clear()

  window.requestAnimationFrame(resizeComposer)

  const controller = new AbortController()
  const sendPerfStartedAt = performance.now()
  // Keep the request id stable across an automatic transport retry. Codex's
  // persistent queue uses it as clientUserMessageId, so a response lost after
  // queue/add cannot manufacture a duplicate queued prompt on retry.
  const turnRequestId = retryOverride?.turnRequestId
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  abortControllerRef.current = controller
  activeTurnRequestIdRef.current = turnRequestId

  try {
    const res = await fetch(`/api/sessions/${session.sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        model: selectedModel || undefined,
        effort,
        attachments: sendAttachments,
        resumeSessionAt: resumeFromMessageId ?? undefined,
        // Same message: it's both the fork point and the prompt UUID of the
        // turn being discarded from the UI's perspective (see resumeDropsTurn
        // usage doc). The CLI refuses the fork if that turn's own tool_result
        // or structured_output would be left in the discarded range.
        resumeDropsTurn: resumeFromMessageId ?? undefined,
        forkSession: Boolean(resumeFromMessageId),
        provider: session.provider,
        providerInstanceId: session.providerInstanceId,
        agent: session.provider === 'opencode' && selectedAgent ? selectedAgent : undefined,
        mode: session.provider === 'copilot' ? selectedCopilotMode : undefined,
        contextTier: session.provider === 'copilot'
          ? selectedCopilotContextTier ?? undefined
          : undefined,
        manualPermissions: session.provider === 'copilot'
          || (session.provider === 'claude' && selectedPermissionMode !== 'bypassPermissions' && selectedPermissionMode !== 'plan')
          ? true : undefined,
        nativeCommands: session.provider === 'copilot' ? true : undefined,
        detachOnClientAbort: true,
        turnRequestId,
        taskBudgetTokens: taskBudgetTokens ?? undefined,
        enableWorkflow: session.provider === 'claude' && enableWorkflow ? true : undefined,
        isPendingSession: session.isPending === true ? true : undefined,
        cwd: session.cwd ?? undefined,
        permissionMode: session.provider === 'claude' ? selectedPermissionMode : undefined,
        approvalPolicy: session.provider === 'codex' && selectedCodexApproval !== 'auto'
          ? selectedCodexApproval
          : undefined,
      }),
      signal: controller.signal,
    })
    recordClientPerf(
      `composer.${session.provider ?? 'claude'}.send-to-ack`,
      performance.now() - sendPerfStartedAt,
    )

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error ?? `HTTP ${res.status}`)
    }

    if (!res.body) throw new Error('No response stream returned')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    let firstOutputRecorded = false
    const noteFirstOutput = () => {
      if (firstOutputRecorded) return
      firstOutputRecorded = true
      recordClientPerf(
        `composer.${session.provider ?? 'claude'}.first-output`,
        performance.now() - sendPerfStartedAt,
      )
    }
    // Stall watchdog: only Claude emits server heartbeats, so only Claude can
    // be confidently judged dead-vs-slow. Race each read against a timeout; if
    // neither data nor a heartbeat lands within the window, treat the socket as
    // dead and recover via reattach instead of blocking on read() for minutes.
    const stallGuard = session.provider === 'claude'
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
        if (frame.event === 'heartbeat') {
          // Liveness pulse only — receiving it already reset the stall race on
          // this iteration; nothing else to do.
          continue
        }

        // Transport-only receipt consumed by cross-session senders. The
        // normal composer already owns this stream, so it has nothing to do.
        if (frame.event === 'turn-accepted') continue

        if (frame.event === 'context-usage') {
          try { setContextUsage(JSON.parse(frame.data)) } catch { /* ignore */ }
          continue
        }

        if (frame.event === 'session') {
          try {
            const parsed = JSON.parse(frame.data)
            if (resumeFromMessageId && parsed.sessionId && parsed.sessionId !== session.sessionId) {
              liveTurnSessionHandoffRef.current = parsed.sessionId
              composerSessions.rekey(composerOwnerKey, sessionIdentityKey({ ...session, sessionId: parsed.sessionId }))
              if (pendingMessageBaselineRef.current) {
                pendingMessageBaselineRef.current = retargetPendingMessageBaseline(pendingMessageBaselineRef.current, parsed.sessionId)
              }
              onFork?.(parsed.sessionId, session)
              setSessionActionNotice('Forked a continuation from the selected point.')
            } else if (session.isPending && parsed.sessionId) {
              // Swap to the real SDK session id silently. Real CLI shows no
              // "new session created" banner — the streaming reply itself
              // signals that the session is live.
              liveTurnSessionHandoffRef.current = parsed.sessionId
              composerSessions.rekey(composerOwnerKey, sessionIdentityKey({ ...session, sessionId: parsed.sessionId }))
              if (pendingMessageBaselineRef.current) {
                pendingMessageBaselineRef.current = retargetPendingMessageBaseline(pendingMessageBaselineRef.current, parsed.sessionId, true)
              }
              onFork?.(parsed.sessionId, session)
            }
          } catch { /* ignore */ }
          continue
        }

        if (frame.event === 'error') {
          try {
            const parsed = JSON.parse(frame.data)
            throw new TransientAwareSendError(parsed.error ?? 'Unknown agent error', parsed.apiErrorStatus, parsed.usageLimit as UsageLimitKind | undefined)
          } catch (e) { throw e }
        }

        // OpenCode session.status frames mirror opencode-web's busy
        // indicator. Maps to our own live-status state.
        if (frame.event === 'opencode-status') {
          try {
            const parsed = JSON.parse(frame.data) as { type?: string }
            if (parsed.type === 'busy') setLiveStatus('requesting')
            else if (parsed.type === 'idle') setLiveStatus(null)
          } catch { /* ignore */ }
          continue
        }

        if (frame.event === 'opencode-todos') {
          // Todos are surfaced through the polling refresh today, but
          // catching the frame here drops it cleanly rather than letting
          // the generic JSON.parse below fail on a non-data frame.
          continue
        }

        // Non-fatal turn notice (e.g. an MCP elicitation prompt). Unlike
        // command-result, this must NOT clear the live turn state — the turn
        // is still running; we just surface a transient banner.
        if (frame.event === 'turn-notice') {
          try {
            const parsed = JSON.parse(frame.data) as { message?: unknown }
            if (typeof parsed.message === 'string' && parsed.message.trim()) {
              noteFirstOutput()
              setSessionActionNotice(parsed.message.trim())
            }
          } catch { /* ignore malformed notice */ }
          continue
        }

        if (frame.event === 'command-result') {
          try {
            const parsed = JSON.parse(frame.data) as { message?: unknown; mode?: unknown; transcriptExpected?: unknown }
            noteFirstOutput()
            if (typeof parsed.message === 'string' && parsed.message.trim()) {
              setSessionActionNotice(parsed.message.trim())
            }
            if (typeof parsed.mode === 'string') {
              setSelectedCopilotMode(parsed.mode)
            }
            if (!commandResultExpectsTranscript(parsed)) {
              pendingMessageBaselineRef.current = null
              setOptimisticUserText(null)
              setSteeredUserTexts([])
              clearLiveAssistantText()
              setLiveToolActivities([])
              setLiveThreadedMessages([])
              clearLiveSubagentText()
            }
          } catch { /* ignore malformed command result */ }
          continue
        }

        try {
          const parsed = JSON.parse(frame.data)
          if (parsed?.type === 'prompt_suggestion' && typeof parsed.suggestion === 'string') {
            setLivePromptSuggestion(parsed.suggestion)
          }
          if (parsed?.type === 'system' && parsed.subtype === 'commands_changed') {
            const commands = normalizeSlashCommandSuggestions(parsed.commands)
            if (commands) setLiveSlashCommands(commands)
          }
          if (parsed?.type === 'system' && parsed.subtype === 'status') {
            const next = parsed.status === 'requesting' || parsed.status === 'compacting' ? parsed.status : null
            setLiveStatus(next)
          }
          // The Claude SDK auto-retries transient API errors (overload/network)
          // and emits an api_retry system message per attempt. Surface it as the
          // live "Retrying…" status — same UX Pi gets natively — so a multi-second
          // SDK retry reads as recovery instead of a hang. It clears when the next
          // assistant delta / result arrives (those setLiveStatus(null) below).
          if (parsed?.type === 'system' && parsed.subtype === 'api_retry') {
            setLiveStatus('retrying')
          }
          // Pi surfaces auto-retry / auto-compaction as non-fatal progress so the
          // turn doesn't look hung while it recovers (mirrors native Pi).
          if (parsed?.type === 'pi_status') {
            if (parsed.status === 'retry_start') setLiveStatus('retrying')
            else if (parsed.status === 'compaction_start' || parsed.status === 'summarization_retry_start') setLiveStatus('compacting')
            else if (parsed.status === 'retry_end' || parsed.status === 'compaction_end' || parsed.status === 'summarization_retry_end') setLiveStatus(null)
            else if (parsed.status === 'title_changed' && typeof parsed.name === 'string') {
              setSessionInfo((prev) => prev ? { ...prev, customTitle: parsed.name } : prev)
            }
          }
          // command_lifecycle frames: the CLI's authoritative per-message
          // queue state, correlated to steered echoes by uuid stamp.
          // cancelled/discarded means the message will never run — drop the
          // echo instead of leaving a ghost the transcript never reconciles.
          const commandLifecycle = parseClaudeCommandLifecycle(parsed)
          if (commandLifecycle) {
            const { commandUuid, state: lifecycleState } = commandLifecycle
            const currentSteeredEntries = steeredUserTextsRef.current
            if (currentSteeredEntries.some((entry) => entry.messageUuid === commandUuid)) {
              const nextSteeredEntries = lifecycleState === 'cancelled' || lifecycleState === 'discarded'
                ? currentSteeredEntries.filter((entry) => entry.messageUuid !== commandUuid)
                : currentSteeredEntries.map((entry) => entry.messageUuid === commandUuid
                  ? { ...entry, state: lifecycleState }
                  : entry)
              steeredUserTextsRef.current = nextSteeredEntries
              setSteeredUserTexts(nextSteeredEntries)
            }
          }
          if (parsed?.type === 'stream_event' && typeof parsed.parent_tool_use_id === 'string' && parsed.parent_tool_use_id) {
            const event = parsed.event
            if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
              const parentId = parsed.parent_tool_use_id
              const delta = event.delta.text
              queueLiveSubagentDelta(parentId, delta)
            }
          }
          if (parsed?.type === 'user' && typeof parsed.parent_tool_use_id === 'string' && parsed.parent_tool_use_id) {
            // Route the clear through the same ref buffer so a buffered delta
            // flushing after this removal can't resurrect the deleted text.
            removeLiveSubagentEntry(parsed.parent_tool_use_id)
          }
          const pendingPermission = extractPendingPermission(parsed)
          if (pendingPermission) {
            noteFirstOutput()
            setPendingPermissions((prev) => [
              ...prev.filter((permission) => permission.id !== pendingPermission.id),
              pendingPermission,
            ])
          }
          const repliedPermissionId = extractPermissionReply(parsed)
          if (repliedPermissionId) {
            setPendingPermissions((prev) => prev.filter((permission) => permission.id !== repliedPermissionId))
          }
          const pushedAttachments = extractCopilotPushedAttachments(parsed)
          if (pushedAttachments.length > 0) {
            pushedCopilotAttachmentsRef.current = mergeComposerAttachments(pushedCopilotAttachmentsRef.current, pushedAttachments)
            setAttachments((prev) => mergeComposerAttachments(prev, pushedAttachments))
            const nextQueuedSends = (() => {
              const current = queuedSendsRef.current
              let newestTargetIndex = -1
              for (let index = current.length - 1; index >= 0; index -= 1) {
                if (current[index]!.targetKey === composerQueueTargetKey) {
                  newestTargetIndex = index
                  break
                }
              }
              if (newestTargetIndex < 0) return current
              return current.map((queued, index) => index === newestTargetIndex
                ? { ...queued, attachments: mergeComposerAttachments(queued.attachments, pushedAttachments) }
                : queued)
            })()
            if (nextQueuedSends !== queuedSendsRef.current) commitQueuedSends(nextQueuedSends)
          }
          const toolStart = extractLiveToolStart(parsed)
          if (toolStart) {
            noteFirstOutput()
            // A tool call is a real side effect — once one starts, this turn
            // must never be silently auto-retried (it could re-run the tool).
            turnProducedOutputRef.current = true
            if (parsed.type === 'stream_event') {
              liveToolIndexesRef.current.set(toolStart.index, toolStart.key)
              liveToolInputJsonRef.current.set(toolStart.index, '')
            }
            setLiveToolActivities((prev) => {
              const existing = prev.filter((activity) => activity.key !== toolStart.key)
              return [...existing, { key: toolStart.key, label: toolStart.label, detail: toolStart.detail, status: 'running', toolUse: 'toolUse' in toolStart ? toolStart.toolUse : undefined }]
            })
            const liveToolUse = 'toolUse' in toolStart ? toolStart.toolUse : undefined
            if (liveToolUse && session.provider === 'claude') {
              setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, {
                role: 'assistant',
                uuid: `live-tool:${toolStart.key}`,
                sessionId: session.sessionId,
                provider: session.provider,
                blocks: [{
                  type: 'tool_thread',
                  toolUse: liveToolUse,
                  result: null,
                }],
              }))
            }
          }

          const toolInputDelta = extractClaudeStreamToolInputDelta(parsed)
          if (toolInputDelta) {
            const toolKey = liveToolIndexesRef.current.get(toolInputDelta.index)
            if (toolKey) {
              const accumulated = `${liveToolInputJsonRef.current.get(toolInputDelta.index) ?? ''}${toolInputDelta.partialJson}`
              liveToolInputJsonRef.current.set(toolInputDelta.index, accumulated)
              const input = parseClaudeStreamToolInput(accumulated)
              if (input) {
                setLiveThreadedMessages((prev) => updateLiveToolThreadInput(prev, toolKey, input))
              }
            }
          }

          const completedToolKey = extractCompletedToolKey(parsed)
          if (completedToolKey) {
            setLiveToolActivities((prev) => prev.map((activity) =>
              activity.key === completedToolKey
                ? { ...activity, status: 'done' }
                : activity
            ))
            if (session.provider === 'claude') {
              setLiveThreadedMessages((prev) => completeLiveToolThread(prev, completedToolKey))
            }
          }

          const toolStopIndex = extractLiveToolStopIndex(parsed)
          if (toolStopIndex != null && parsed.type !== 'codex_item_completed') {
            const activityKey = liveToolIndexesRef.current.get(toolStopIndex)
            if (activityKey) {
              const accumulated = liveToolInputJsonRef.current.get(toolStopIndex)
              const finalInput = accumulated ? parseClaudeStreamToolInput(accumulated) : null
              if (finalInput) {
                setLiveThreadedMessages((prev) => updateLiveToolThreadInput(prev, activityKey, finalInput))
              }
              setLiveToolActivities((prev) => prev.map((activity) =>
                activity.key === activityKey
                  ? { ...activity, status: 'done' }
                  : activity
              ))
              if (session.provider === 'claude') {
                setLiveThreadedMessages((prev) => completeLiveToolThread(prev, activityKey))
              }
            }
            liveToolInputJsonRef.current.delete(toolStopIndex)
            liveToolIndexesRef.current.delete(toolStopIndex)
          }

          const deltaText = extractStreamingAssistantText(parsed)
          if (deltaText) {
            noteFirstOutput()
            // Committed assistant output — don't blind-retry past this point.
            turnProducedOutputRef.current = true
            setLiveStatus(null)
            queueLiveAssistantText(deltaText, shouldReplaceLiveAssistantText(parsed))
          }

          const reasoningDelta = extractStreamingReasoningText(parsed)
          if (reasoningDelta) {
            noteFirstOutput()
            setLiveStatus(null)
            queueLiveReasoningText(reasoningDelta)
          }

          if (parsed?.type === 'system' && parsed.subtype === 'thinking_tokens') {
            const estimate = typeof parsed.estimated_tokens === 'number' ? parsed.estimated_tokens : null
            if (estimate != null) setLiveThinkingTokens(estimate)
          }

          // A model refusal triggered a fallback to another model. Evict the
          // refused partial from the live overlay so it doesn't linger; the
          // banner itself arrives through the normal threaded path.
          if (parsed?.type === 'system' && parsed.subtype === 'model_refusal_fallback') {
            const retracted = Array.isArray(parsed.retracted_message_uuids)
              ? new Set(parsed.retracted_message_uuids.filter((u: unknown): u is string => typeof u === 'string'))
              : null
            if (retracted && retracted.size > 0) {
              setLiveThreadedMessages((prev) => prev.filter((m) => !retracted.has(m.uuid)))
            }
            clearLiveAssistantText()
          }

          if (session.provider === 'claude') {
            const results = extractClaudeStreamToolResults(parsed)
            if (results.length) {
              setLiveThreadedMessages(previous => applyClaudeLiveToolResults(previous, results))
            }
            const threaded = normalizeClaudeStreamThreadedMessage(parsed)
            if (threaded) {
              setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, { ...threaded, providerInstanceId: session.providerInstanceId }))
            }
          } else if (session.provider === 'codex') {
            const threaded = normalizeCodexStreamArtifactMessage(parsed, session.sessionId)
            if (threaded) {
              setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, { ...threaded, providerInstanceId: session.providerInstanceId }))
            }
          }
        } catch {
          /* ignore malformed stream payloads */
        }
      }
    }

    if (streamStalled) {
      // The send stream went silent past CLAUDE_STREAM_STALL_MS. The turn keeps
      // running server-side (detachOnClientAbort), so don't interrupt it — drop
      // our dead live stream and let the persisted-window SSE + /running
      // reattach poll render the rest. Keeps the partial output visible and the
      // composer honest ("turn still running") instead of a frozen spinner.
      try { await reader.cancel() } catch { /* already torn down */ }
      flushLiveAssistantTextNow()
      setSendState('idle')
      setLiveStatus(null)
      setSessionActionNotice('Live stream stalled — reconnected to the running turn.')
      // We know a turn is in flight; mark reattached so the composer reflects it
      // immediately. The /running poll reconciles and clears it when it ends.
      reattachedRunningRef.current = true
      setReattachedRunning(true)
      // Reconcile the partial overlay against the persisted timeline as it
      // streams in over the always-on events SSE.
      if (pendingMessageBaselineRef.current) {
        awaitingPersistedTurnRef.current = true
        setAwaitingPersistedTurn(true)
      }
      return
    }

    sseBuffer += decoder.decode()

    if (sseBuffer.trim()) {
      const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
      for (const frame of frames) {
        if (frame.event !== 'error') continue
        try {
          const parsed = JSON.parse(frame.data)
          throw new TransientAwareSendError(parsed.error ?? 'Unknown agent error', parsed.apiErrorStatus, parsed.usageLimit as UsageLimitKind | undefined)
        } catch (e) { throw e }
      }
    }

    flushLiveAssistantTextNow()
    setSendState('idle')
    setLiveStatus(null)
    const pushedAttachments = pushedCopilotAttachmentsRef.current
    pushedCopilotAttachmentsRef.current = []
    // Copilot may push fresh context attachments during the turn. Merge them
    // into whatever the user attached to their next draft while this send was
    // running; never overwrite that newer draft state on completion.
    setAttachments((current) => mergeComposerAttachments(current, pushedAttachments))
    // Pick up any model/effort the user invoked via a slash command (e.g.
    // `/model claude-sonnet-4-6`) so the composer chip mirrors the SDK.
    refreshSessionModels({ preserveSelection: true })
    if (pendingMessageBaselineRef.current) {
      awaitingPersistedTurnRef.current = true
      setAwaitingPersistedTurn(true)
    } else {
      awaitingPersistedTurnRef.current = false
      setAwaitingPersistedTurn(false)
    }
    setResumeFromMessageId(null)
    textareaRef.current?.focus()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // User cancelled — already reset by cancelSend()
      return
    }
    const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
    const apiErrorStatus = err instanceof TransientAwareSendError ? err.apiErrorStatus : undefined
    const usageLimitKind = err instanceof TransientAwareSendError ? err.usageLimitKind : undefined
    // The fork point straddled the discarded turn's own payload (a
    // tool_result carrier or structured_output attachment) — the CLI
    // refuses deterministically, so retrying the same fork target would
    // fail forever. Drop it now so the restored draft resends as a plain
    // follow-up instead of repeating the same refused truncation.
    if (isResumeDropsTurnRefusal(errorMessage) && resumeFromMessageId) {
      setResumeFromMessageId(null)
      setSessionActionNotice('Could not edit cleanly from that point — resend below as a normal message instead.')
    }
    // Visible auto-retry: native CLIs quietly ride out transient API/network
    // blips. Mirror that — but only when the error is transient AND the turn
    // streamed no output (so a retry can't duplicate a tool call or partial
    // reply) AND we're under the retry budget. Show a "Retrying…" badge so a
    // multi-second wait reads as recovery, not a hang.
    const canRetry = isTransientSendError(errorMessage, apiErrorStatus, usageLimitKind)
      && !turnProducedOutputRef.current
      && transientRetryCountRef.current < MAX_TRANSIENT_SEND_RETRIES
    if (canRetry) {
      transientRetryCountRef.current += 1
      const attempt = transientRetryCountRef.current
      // Keep the turn visually "sending" with a retry status; clear only the
      // (empty) live overlay. sendState stays 'sending' across the backoff.
      setLiveStatus('retrying')
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      clearLiveSubagentText()
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      if (transientRetryTimerRef.current) clearTimeout(transientRetryTimerRef.current)
      transientRetryTimerRef.current = setTimeout(() => {
        transientRetryTimerRef.current = null
        void runSendMessage(ctx, { text, attachments: sendAttachments, turnRequestId })
      }, transientRetryBackoffMs(attempt))
      return
    }
    setSendState('error')
    setSendError(errorMessage)
    setLiveStatus(null)
    setFailedSend({ text, attachments: sendAttachments })
    // Restore the failed draft, queued follow-ups, and anything the user was
    // already composing, including every attachment from all three sources.
    // A failed turn must be fully reversible, never merely text-recoverable.
    const failedQueue = selectComposerQueueTarget(queuedSendsRef.current, composerQueueTargetKey)
    commitQueuedSends(clearComposerQueueTarget(queuedSendsRef.current, composerQueueTargetKey))
    const restored = restoreComposerDraftPayload(
      { text: inputTextRef.current, attachments: [] },
      failedQueue,
      { text, attachments: sendAttachments },
    ).text
    inputTextRef.current = restored
    if (textareaRef.current) textareaRef.current.value = restored
    setInputText(restored)
    setAttachments((current) => restoreComposerDraftPayload(
      { text: '', attachments: current },
      failedQueue,
      { text: '', attachments: sendAttachments },
    ).attachments)
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
    textareaRef.current?.focus()
  } finally {
    abortControllerRef.current = null
    activeTurnRequestIdRef.current = null
    sendInFlightRef.current = false
    // The inactive session's queue must advance without borrowing the active composer.
    if (composerQueueTargetKey && !composerSessions.same(activeWebComposerOwnerRef.current, composerOwnerKey)
      && !controller.signal.aborted && transientRetryTimerRef.current == null
      && composerSessions.get<SendState>(composerOwnerKey, 'sendState', 'idle') === 'idle'
      && !reattachedRunningRef.current) {
      const next = queuedSendsRef.current.find(entry => entry.targetKey === composerQueueTargetKey)
      if (next && !composerQueueClaimInFlightRef.current.has(next.id)) {
        composerQueueClaimInFlightRef.current.add(next.id)
        void getWebComposerQueueStore().claim(composerQueueTargetKey, next.id).then(claim => {
          queuedSendsRef.current = claim.entries
          setQueuedSends(claim.entries)
          if (!claim.claimed) return
          if (sendInFlightRef.current) { commitQueuedSends([next, ...claim.entries]); return }
          void runSendMessage(ctx, { text: next.text, attachments: next.attachments })
        }).catch(error => { setSendError(error instanceof Error ? error.message : 'Could not claim the queued prompt') }).finally(() => composerQueueClaimInFlightRef.current.delete(next.id))
      }
    }
  }
}
