import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import type { Session } from '../../../lib/types'
import type { SessionCapabilities } from '../../../lib/types'
import type { SessionMessage } from '../../../lib/types'
import type { OpenCodeTodo } from '../../../lib/taskRegistry'
import type { CodexPlanStep } from '../../../lib/taskRegistry'
import { type ContextComposerHandle } from '../../ContextComposer'
import { createContextAttachment, readComposerContext, restoreContextAttachments, removeContextReference } from '@/lib/composerContext'
import { useState, useRef, useCallback, useMemo } from 'react'
import { type SessionDiagnosticSection, type SendAttachment } from '@/lib/types'
import { readJsonResponse } from '@/lib/httpResponse'
import { buildThreadedMessages, buildThreadedMessagesIncremental, computeTurnDurationsMs, stripToolCallBlocks, type IncrementalThreadingCache, type ThreadedMessage } from '@/lib/threading'
import { measureSync } from '@/lib/clientPerf'
import { pathBasename } from '@/lib/projectPaths'
import { type PendingPermission, type PendingQuestionAnswers } from '@/lib/permissions'
import { buildTaskActiveFormsForWeb } from '../../messageItemShared'
import { buildTaskRegistry, buildTaskRegistryFromCodexPlan, buildTaskRegistryFromTodos } from '@/lib/taskRegistry'
import { mergeComposerAttachments } from '@/lib/composerAttachments'
import { type FailedSend } from '../types'
import { withProviderQuery, threadedMessageKey, threadedMessageEqual } from '../threadedCompare'
import { normalizeSelectValue } from '../composerUi'
import { runIngestFileAttachments } from '../actions/composer'
import { runRespondToPermission, runRespondToQuestion } from '../actions/permissions'
import { runHandleForkFromMessage, runHandleDeleteSession, runRunSessionAction, runRunClaudeSessionAction } from '../actions/sessionActions'
import { runSearchClaudeHookEvents, runApplyClaudeMcpPermissionMode, runAddClaudeMcpServer, runToggleDiagnostics } from '../actions/claude'

export type UseIngestFileAttachmentsGroupContext = {
  activeComposerDraftKeyRef: RefObject<string | null>
  attachmentReadsRef: RefObject<number>
  setSendError: Dispatch<SetStateAction<string | null>>
  insertContextAttachments: (incoming: SendAttachment[]) => void
  inputTextRef: MutableRefObject<string>
  setInputText: Dispatch<SetStateAction<string>>
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  failedSend: FailedSend | null
  sendInFlightRef: MutableRefObject<boolean>
  awaitingPersistedTurnRef: MutableRefObject<boolean>
  setFailedSend: Dispatch<SetStateAction<FailedSend | null>>
  resizeComposer: () => void
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  session: Session | null
  deleting: boolean
  sessionCapabilities: SessionCapabilities | undefined
  setDeleting: Dispatch<SetStateAction<boolean>>
  setSessionActionError: Dispatch<SetStateAction<string | null>>
  setSessionActionNotice: Dispatch<SetStateAction<string | null>>
  onDelete: ((sessionId: string, provider?: Session['provider']) => void) | undefined
  sessionActionLoading: string | null
  setSessionActionLoading: Dispatch<SetStateAction<string | null>>
  setDiagnosticSections: Dispatch<SetStateAction<SessionDiagnosticSection[]>>
  setPendingPermissions: Dispatch<SetStateAction<PendingPermission[]>>
  commitClaudePermissionSelection: (nextMode: 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions') => void
  forking: boolean
  setForking: Dispatch<SetStateAction<boolean>>
  onFork: ((newSessionId: string, sourceSession?: Session) => void) | undefined
  forkingMessageId: string | null
  setForkingMessageId: Dispatch<SetStateAction<string | null>>
  setResumeFromMessageId: Dispatch<SetStateAction<string | null>>
  setComposerCollapsed: Dispatch<SetStateAction<boolean>>
  setHistoryIndex: Dispatch<SetStateAction<number>>
  draftBeforeHistoryRef: RefObject<{ text: string; cursorPos: number; }>
  setDiagnosticsLoading: Dispatch<SetStateAction<boolean>>
  selectedModelValue: string | null
  setSelectedModel: Dispatch<SetStateAction<string>>
  showDiagnostics: boolean
  setShowDiagnostics: Dispatch<SetStateAction<boolean>>
  diagnosticSections: SessionDiagnosticSection[]
  diagnosticsLoading: boolean
  prevThreadingRef: RefObject<IncrementalThreadingCache | null>
  messages: SessionMessage[]
  threadedCacheRef: { current: Map<string, ThreadedMessage>; }
  showTools: boolean
  bridgeTranscriptEntries: { kind: 'sent' | 'reply'; text: string; timestamp: string; }[]
  taskActiveFormsRef: { current: Map<string, string>; }
  openCodeTodos: OpenCodeTodo[] | undefined
  codexPlan: { plan: CodexPlanStep[]; explanation: string | null; } | undefined
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; } | undefined
}

export function useIngestFileAttachmentsGroup(ctx: UseIngestFileAttachmentsGroupContext) {
  const {
    activeComposerDraftKeyRef, attachmentReadsRef, setSendError, insertContextAttachments,
    inputTextRef, setInputText, setAttachments, failedSend, sendInFlightRef,
    awaitingPersistedTurnRef, setFailedSend, resizeComposer, textareaRef, session, deleting,
    sessionCapabilities, setDeleting, setSessionActionError, setSessionActionNotice, onDelete,
    sessionActionLoading, setSessionActionLoading, setDiagnosticSections, setPendingPermissions,
    commitClaudePermissionSelection, forking, setForking, onFork, forkingMessageId,
    setForkingMessageId, setResumeFromMessageId, setComposerCollapsed, setHistoryIndex,
    draftBeforeHistoryRef, setDiagnosticsLoading, selectedModelValue, setSelectedModel,
    showDiagnostics, setShowDiagnostics, diagnosticSections, diagnosticsLoading, prevThreadingRef,
    messages, threadedCacheRef, showTools, bridgeTranscriptEntries, taskActiveFormsRef,
    openCodeTodos, codexPlan, projectView,
  } = ctx

  const ingestFileAttachments = useCallback(async (files: File[]) => runIngestFileAttachments({
    activeComposerDraftKeyRef, attachmentReadsRef, setSendError, insertContextAttachments,
  }, files), [insertContextAttachments, setSendError])

  const handleComposerPaste = useCallback(async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items
    if (!items || items.length === 0) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (files.length === 0) return
    event.preventDefault()
    await ingestFileAttachments(files)
  }, [ingestFileAttachments])

  const [composerDropActive, setComposerDropActive] = useState(false)
  const dropDepthRef = useRef(0)

  const handleComposerDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    dropDepthRef.current += 1
    setComposerDropActive(true)
  }, [])

  const handleComposerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleComposerDragLeave = useCallback(() => {
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
    if (dropDepthRef.current === 0) setComposerDropActive(false)
  }, [])

  const handleComposerDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dropDepthRef.current = 0
    setComposerDropActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) return
    await ingestFileAttachments(files)
  }, [ingestFileAttachments])

  const removeAttachment = useCallback((id: string | undefined, index: number) => {
    if (id) {
      const next = removeContextReference(inputTextRef.current, id)
      setInputText(next)
      inputTextRef.current = next
    }
    setAttachments((prev) => prev.filter((attachment, attachmentIndex) => (
      id ? attachment.id !== id : attachmentIndex !== index
    )))
  }, [inputTextRef, setInputText, setAttachments])

  const restoreFailedSend = useCallback(() => {
    if (!failedSend || sendInFlightRef.current || awaitingPersistedTurnRef.current) return
    setInputText(failedSend.text)
    inputTextRef.current = failedSend.text
    setAttachments(failedSend.attachments)
    setFailedSend(null)
    setSendError(null)
    window.requestAnimationFrame(() => {
      resizeComposer()
      textareaRef.current?.focus()
    })
  }, [failedSend, resizeComposer, inputTextRef, sendInFlightRef, awaitingPersistedTurnRef, textareaRef, setInputText, setSendError, setAttachments, setFailedSend])

  const handleDeleteSession = useCallback(async () => runHandleDeleteSession({
    session, deleting, sessionCapabilities, setDeleting, setSessionActionError,
    setSessionActionNotice, onDelete,
  }), [deleting, onDelete, session, sessionCapabilities?.deleteSession])

  const runSessionAction = useCallback(async (action: string) => runRunSessionAction({
    session, sessionActionLoading, setSessionActionLoading, setSessionActionError,
    setSessionActionNotice, setDiagnosticSections,
  }, action), [session, sessionActionLoading])

  const respondToPermission = useCallback(async (permission: PendingPermission, response: 'once' | 'always' | 'reject', permissionMode?: 'acceptEdits' | 'default') => runRespondToPermission({
    setSessionActionLoading, setSessionActionError, setPendingPermissions, session,
    sessionActionLoading,
  }, permission, response, permissionMode), [session, sessionActionLoading])

  // Submit answers to a structured question prompt. Codex keys answers by its
  // schema id; Claude falls back to question text. Arrays stay lossless for
  // Codex/MCP (including custom answers that contain commas).
  const respondToQuestion = useCallback(async (permission: PendingPermission, answers: PendingQuestionAnswers) => runRespondToQuestion({
    session, sessionActionLoading, setSessionActionLoading, setSessionActionError,
    setPendingPermissions,
  }, permission, answers), [session, sessionActionLoading])

  // Respond to an ExitPlanMode plan-approval. Approving allows the tool (the SDK
  // exits plan mode for this turn) AND switches the composer + warm query to the
  // chosen mode so subsequent turns aren't back in plan mode. Reject keeps planning.
  const respondToPlan = useCallback(async (
    permission: PendingPermission,
    decision: 'acceptEdits' | 'default' | 'reject',
  ) => {
    if (decision === 'reject') {
      await respondToPermission(permission, 'reject')
      return
    }
    commitClaudePermissionSelection(decision)
    // The mode rides the approval itself: allowing ExitPlanMode restores the
    // pre-plan mode, overwriting a mode change sent separately.
    await respondToPermission(permission, 'once', decision)
  }, [respondToPermission, commitClaudePermissionSelection])

  const handleFork = useCallback(async () => {
    if (!session || forking) return
    setForking(true)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
      const data = await readJsonResponse(res)
      if (data.error) throw new Error(data.error)
      onFork?.(data.sessionId)
    } catch (err) {
      console.error('Fork failed:', err)
    } finally {
      setForking(false)
    }
  }, [session, forking, onFork])

  const handleForkFromMessage = useCallback(async (messageId: string) => runHandleForkFromMessage({
    session, forkingMessageId, sessionCapabilities, setForkingMessageId, setSessionActionError,
    setSessionActionNotice, onFork,
  }, messageId), [forkingMessageId, onFork, session, sessionCapabilities?.messageFork])

  const toggleResumeFromMessage = useCallback((messageId: string) => {
    if (!sessionCapabilities?.resumeAtMessage) return
    setResumeFromMessageId((prev) => prev === messageId ? null : messageId)
    setSessionActionError(null)
    setSessionActionNotice(null)
  }, [sessionCapabilities?.resumeAtMessage])

  const focusComposer = useCallback(() => {
    setComposerCollapsed(false)
    window.requestAnimationFrame(() => {
      resizeComposer()
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }, [resizeComposer, textareaRef])

  const handleReusePrompt = useCallback((text: string) => {
    const restoredContext = readComposerContext(text)
    const trimmed = restoredContext.text.trim()
    if (!trimmed) return
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer, inputTextRef, setInputText, setAttachments])

  const handleQuoteMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const quoted = trimmed
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const existing = inputTextRef.current
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '' : '\n\n') : ''
    const next = `${existing}${separator}${quoted}\n\n`
    setInputText(next)
    inputTextRef.current = next
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer, inputTextRef, setInputText])

  const handleQuestionAnswerToComposer = useCallback((answer: string) => {
    const existing = inputTextRef.current
    const next = `${existing}${existing ? '\n\n' : ''}${answer}\n`
    setInputText(next)
    inputTextRef.current = next
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer, inputTextRef, setInputText])

  const handleDiffCommentToComposer = useCallback((prompt: string) => {
    if (!prompt.trim()) return
    const label = /File: (.*)/.exec(prompt)?.[1] || 'Diff comment'
    insertContextAttachments([createContextAttachment('diff', label, prompt)])
  }, [insertContextAttachments])

  const handleEditFromMessage = useCallback((messageId: string, text: string) => {
    const restoredContext = readComposerContext(text)
    const trimmed = restoredContext.text.trim()
    if (!trimmed) return
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    if (sessionCapabilities?.resumeAtMessage) {
      setResumeFromMessageId(messageId)
      setSessionActionNotice('Editing — safe resume armed; the next send will replace from this point in a guarded fork.')
    }
    focusComposer()
  }, [focusComposer, sessionCapabilities?.resumeAtMessage, inputTextRef, setInputText, setAttachments])

  const refreshDiagnostics = useCallback(async () => {
    if (!session) return
    setDiagnosticsLoading(true)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/diagnostics`, session.provider, session.providerInstanceId))
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDiagnosticSections(data.sections ?? [])
      const diagnosticsModel = normalizeSelectValue(data.currentModel)
      if (diagnosticsModel && !selectedModelValue) setSelectedModel(diagnosticsModel)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to refresh diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  }, [selectedModelValue, session, setSelectedModel])

  const [claudeMcpBusy, setClaudeMcpBusy] = useState<string | null>(null)
  const [claudeHookQuery, setClaudeHookQuery] = useState('')
  const [claudeHookSearching, setClaudeHookSearching] = useState(false)
  // Tracks only policies applied in this viewer. Absence is deliberately shown
  // as unknown rather than guessing the SDK's current per-server override.
  const [claudeMcpPermissionModes, setClaudeMcpPermissionModes] = useState<Record<string, 'default' | 'auto'>>({})
  const runClaudeSessionAction = useCallback(async (action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) => runRunClaudeSessionAction({
    session, setClaudeMcpBusy, setSessionActionError, setSessionActionNotice, refreshDiagnostics,
  }, action, extra, busyKey, successNotice), [refreshDiagnostics, session])

  const applyClaudeMcpPermissionMode = useCallback(async (serverName: string, permissionModeKey: string, mode: 'default' | 'auto' | null, previous: 'default' | 'auto' | undefined) => runApplyClaudeMcpPermissionMode({
    setClaudeMcpPermissionModes, runClaudeSessionAction,
  }, serverName, permissionModeKey, mode, previous), [runClaudeSessionAction])

  const addClaudeMcpServer = useCallback(async () => runAddClaudeMcpServer({
    runClaudeSessionAction, setSessionActionError,
  }), [runClaudeSessionAction])

  const searchClaudeHookEvents = useCallback(async () => runSearchClaudeHookEvents({
    session, setClaudeHookSearching, setSessionActionError, claudeHookQuery, setDiagnosticSections,
    setSessionActionNotice,
  }), [claudeHookQuery, session])

  const toggleDiagnostics = useCallback(async () => runToggleDiagnostics({
    session, showDiagnostics, setShowDiagnostics, diagnosticSections, diagnosticsLoading,
    setDiagnosticsLoading, setDiagnosticSections, selectedModelValue, setSelectedModel,
    setSessionActionError,
  }), [diagnosticSections.length, diagnosticsLoading, selectedModelValue, session, showDiagnostics, setSelectedModel])

  const threadedFull = useMemo(() => measureSync('threading.build', () => {
    const prev = prevThreadingRef.current
    const nextMessages = (prev ? buildThreadedMessagesIncremental(messages, prev) : null)
      ?? buildThreadedMessages(messages)
    const previous = threadedCacheRef.current
    const stabilized = nextMessages.map((message) => {
      const cached = previous.get(threadedMessageKey(message))
      return cached && threadedMessageEqual(cached, message) ? cached : message
    })
    const nextCache = new Map<string, ThreadedMessage>()
    for (const message of stabilized) nextCache.set(threadedMessageKey(message), message)
    threadedCacheRef.current = nextCache
    prevThreadingRef.current = { messages, threaded: stabilized }
    return stabilized
  }), [messages])
  const threaded = useMemo(
    () => (showTools ? threadedFull : stripToolCallBlocks(threadedFull)),
    [threadedFull, showTools],
  )
  const turnDurations = useMemo(() => computeTurnDurationsMs(threadedFull), [threadedFull])

  // Merge bridge transcript messages into the main threaded view
  const threadedWithBridge = useMemo(() => {
    if (bridgeTranscriptEntries.length === 0) return threaded

    const bridgeMessages: ThreadedMessage[] = bridgeTranscriptEntries.map((entry, i) => ({
      role: entry.kind === 'sent' ? 'user' : 'assistant',
      uuid: `bridge-${i}`,
      timestamp: entry.timestamp,
      origin: { kind: 'bridge' },
      blocks: [{ type: 'text', text: entry.text } as any],
    }))

    // Merge chronologically by timestamp
    const allMessages = [...threaded, ...bridgeMessages]
    return allMessages.sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return aTime - bTime
    })
  }, [threaded, bridgeTranscriptEntries])

  // buildTaskActiveFormsForWeb returns a fresh Map every time `threaded`
  // changes identity (every poll that merges a delta), which would churn the
  // TaskActiveFormsContext value and re-render all mounted TaskCards even when
  // no task state changed. Reuse the prior Map instance when contents are
  // value-equal so idle polls don't propagate through the context. Value-aware
  // (not size/keys-only): a TaskUpdate reuses a taskId key with a new form.
  const taskActiveForms = useMemo(() => {
    const next = buildTaskActiveFormsForWeb(threadedWithBridge)
    const prev = taskActiveFormsRef.current
    let same = prev.size === next.size
    if (same) {
      for (const [key, value] of next) {
        if (prev.get(key) !== value) { same = false; break }
      }
    }
    const result = same ? prev : next
    taskActiveFormsRef.current = result
    return result
  }, [threadedWithBridge])
  const taskRegistry = useMemo(() => {
    const registry = buildTaskRegistry(threadedWithBridge)
    if (openCodeTodos && openCodeTodos.length > 0) {
      const todosRegistry = buildTaskRegistryFromTodos(openCodeTodos)
      for (const [id, task] of todosRegistry) {
        registry.set(id, task)
      }
    }
    if (codexPlan && codexPlan.plan.length > 0) {
      const planRegistry = buildTaskRegistryFromCodexPlan(codexPlan.plan)
      for (const [id, task] of planRegistry) {
        registry.set(id, task)
      }
    }
    return registry
  }, [threadedWithBridge, openCodeTodos, codexPlan])
  const [taskRailOpen, setTaskRailOpen] = useState(true)
  const isProject = !!projectView
  const dirName  = projectView?.key ?? (pathBasename(session?.cwd) || session?.sessionId) ?? ''

  return {
    handleComposerPaste, composerDropActive, handleComposerDragEnter, handleComposerDragOver,
    handleComposerDragLeave, handleComposerDrop, removeAttachment, restoreFailedSend,
    handleDeleteSession, runSessionAction, respondToPermission, respondToQuestion, respondToPlan,
    handleFork, handleForkFromMessage, toggleResumeFromMessage, handleReusePrompt,
    handleQuoteMessage, handleQuestionAnswerToComposer, handleDiffCommentToComposer,
    handleEditFromMessage, claudeMcpBusy, claudeHookQuery, setClaudeHookQuery, claudeHookSearching,
    claudeMcpPermissionModes, runClaudeSessionAction, applyClaudeMcpPermissionMode,
    addClaudeMcpServer, searchClaudeHookEvents, toggleDiagnostics, threadedFull, threaded,
    turnDurations, threadedWithBridge, taskActiveForms, taskRegistry, taskRailOpen,
    setTaskRailOpen, isProject, dirName,
  }
}
