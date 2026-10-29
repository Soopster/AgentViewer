import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import { formatAsyncQuestionAnswers } from '../../../../lib/asyncQuestions'
import React from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type ThreadedMessage } from '../../../../lib/threading'
import { runTuiSessionAction } from '../../../../lib/tui/service'
import { type Session } from '../../../../lib/types'
import { isPendingRequestGone, PENDING_REQUEST_GONE_NOTICE } from '../../../../lib/pendingRequestGone'
import { type PendingPermission } from '../../../../lib/permissions'
import { collectQuestionAnswers } from '../../../../lib/questionnaire'
import { type PaneFocus, type NoticeTone } from '../types'
import { completeCodexQuestionLiveMessage } from '../liveStream'
import { keepFiltered } from '../collections'
import { openExternalUrl } from '../../terminalBrowser'
import { type PermissionResponse } from '../../../../lib/permissions'
import { type TuiPermissionMode } from '../types'
import { type TuiTranscriptCard } from '../../../format'
import { type TuiTranscriptView } from '../../../theme'
import { agentToolCardsFor, agentToolCardIsExpanded } from '../transcriptRows'
import { TranscriptDetailCache } from '../../transcriptDetailCache'
import { patchTuiSession, type TuiSessionDetail } from '../../../../lib/tui/service'
import { type ProviderSelection } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { touchMapEntry } from '../collections'
import { type MutableRefObject } from 'react'
import { type WorkspaceContextValue } from '../../workspaceContext'
import { type CliRenderer } from '@opentui/core'
import { interruptTuiSessionTurn } from '../../../../lib/tui/service'
import { type RunningSessionRef } from '../../../../lib/types'
import { resolve } from 'node:path'
import { type QueuedComposerSend } from '../types'
import { ATTACHED_DAEMON_HOST, EXIT_CLEANUP_TIMEOUT_MS } from '../timing'
import { type TranscriptSessionLoader } from '../../transcriptSessionLoader'
import { formatProviderLabel } from '../../../format'
import { forkTuiSession, rewindTuiSession } from '../../../../lib/tui/service'
import { type AgentProvider } from '../../../../lib/types'
import { forkPointBefore, type RewindCandidate } from '../../rewindTargets'
import { isAgentProvider } from '../../../../lib/provider'
import { createTuiSession } from '../../../../lib/tui/service'
import { buildContextHandoffPrompt } from '../../../../lib/contextHandoff'
import { buildHandoffBriefMarkdown } from '../../../../lib/handoffBrief'
import { recordContextTransfer } from '../../../../lib/contextTransfers'
import { toggleTuiSessionBookmark } from '../../../../lib/tui/service'
import { TERMINAL_SELECTION_COPY_WINDOW_MS } from '../layoutConstants'
import { cardClipboardText, writeClipboard } from '../clipboard'
import { createTuiWorktreeTask } from '../../../../lib/tui/service'
import { arrangePaneTree, reconcileWindowSplitTree, type WindowSplitTree } from '../../windowSplitTree'
import { type FloatingRect, type WindowStack } from '../../windowTabs'
import { type WindowItem } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { type SendAttachment } from '../../../../lib/types'
import { join } from 'node:path'
import { type ComposerPromptPart, type ComposerDraftSnapshot } from '../types'
import { recordVoice } from '../../voiceRecorder'
import { type AttentionItem } from '../../AttentionInboxPopover'

export type SubmitTuiQuestionContext = {
  composerTargetSession: Session | null
  permissionActionLoading: string | null
  questionSelections: Record<number, string[]>
  questionFreeformAnswers: Record<number, string>
  setQuestionFocusIndex: React.Dispatch<React.SetStateAction<number>>
  setQuestionOptionIndex: React.Dispatch<React.SetStateAction<number>>
  setAsyncQuestionPrompt: React.Dispatch<React.SetStateAction<PendingPermission | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  setComposerDraft: (action: React.SetStateAction<string>) => void
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setPermissionActionLoading: React.Dispatch<React.SetStateAction<string | null>>
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  setQuestionSelections: React.Dispatch<React.SetStateAction<Record<number, string[]>>>
  setQuestionFreeformAnswers: React.Dispatch<React.SetStateAction<Record<number, string>>>
  setQuestionFreeformEditing: React.Dispatch<React.SetStateAction<boolean>>
}

export async function runSubmitTuiQuestion(ctx: SubmitTuiQuestionContext, permission: PendingPermission) {
  const {
    composerTargetSession, permissionActionLoading, questionSelections, questionFreeformAnswers,
    setQuestionFocusIndex, setQuestionOptionIndex, setAsyncQuestionPrompt, showNotice,
    composerTextareaRef, composerDraft, setComposerDraft, setComposerActive, setFocusedPane,
    setPermissionActionLoading, setLiveTranscriptMessages, setPendingPermissions,
    setQuestionSelections, setQuestionFreeformAnswers, setQuestionFreeformEditing,
  } = ctx
  const target = composerTargetSession
  if (!target || permissionActionLoading) return
  const questions = permission.questions ?? []
  const { answers, missingIndex } = collectQuestionAnswers(questions, questionSelections, questionFreeformAnswers)
  if (missingIndex !== null) {
    // Jump focus to the first unanswered question instead of submitting.
    setQuestionFocusIndex(missingIndex)
    setQuestionOptionIndex(0)
    return
  }
  if (permission.asyncQuestion) {
    if (permission.sessionId !== target.sessionId || permission.provider !== target.provider || permission.providerInstanceId !== target.providerInstanceId) {
      setAsyncQuestionPrompt(null)
      showNotice('info', 'Open the original session to answer these questions.')
      return
    }
    const answer = formatAsyncQuestionAnswers(questions, answers)
    const existing = composerTextareaRef.current?.plainText ?? composerDraft
    const next = `${existing}${existing ? '\n\n' : ''}${answer}\n`
    composerTextareaRef.current?.setText(next)
    setComposerDraft(next)
    setAsyncQuestionPrompt(null)
    setComposerActive(true)
    setFocusedPane('messages')
    return
  }
  setPermissionActionLoading(permission.id)
  try {
    await runTuiSessionAction(
      { ...target, sessionId: permission.sessionId ?? target.sessionId },
      { action: 'respondQuestion', permissionId: permission.id, answers, provider: target.provider },
    )
    setLiveTranscriptMessages((prev) => completeCodexQuestionLiveMessage(prev, permission, answers))
    setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
    setQuestionSelections({})
    setQuestionFreeformAnswers({})
    setQuestionFreeformEditing(false)
    setQuestionFocusIndex(0)
    setQuestionOptionIndex(0)
  } catch (err) {
    if (isPendingRequestGone(err)) {
      setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
      showNotice('info', PENDING_REQUEST_GONE_NOTICE, 6000)
    } else {
      showNotice('error', err instanceof Error ? err.message : 'Failed to submit answer')
    }
  } finally {
    setPermissionActionLoading(null)
  }
}

export type RespondToTuiPermissionContext = {
  setAsyncQuestionPrompt: React.Dispatch<React.SetStateAction<PendingPermission | null>>
  composerTargetSession: Session | null
  permissionActionLoading: string | null
  setPermissionActionLoading: React.Dispatch<React.SetStateAction<string | null>>
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  setPermissionOptionIndex: React.Dispatch<React.SetStateAction<number>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

export async function runRespondToTuiPermission(ctx: RespondToTuiPermissionContext, permission: PendingPermission, response: PermissionResponse, permissionMode?: TuiPermissionMode) {
  const {
    setAsyncQuestionPrompt, composerTargetSession, permissionActionLoading,
    setPermissionActionLoading, setLiveTranscriptMessages, setPendingPermissions,
    setPermissionOptionIndex, showNotice,
  } = ctx
  if (permission.asyncQuestion) { setAsyncQuestionPrompt(null); return }
  const target = composerTargetSession
  if (!target || permissionActionLoading) return
  setPermissionActionLoading(permission.id)
  try {
    if (response === 'once' && permission.elicitation?.mode === 'url' && permission.url) {
      await openExternalUrl(permission.url)
    }
    await runTuiSessionAction(
      { ...target, sessionId: permission.sessionId ?? target.sessionId },
      { action: 'respondPermission', permissionId: permission.id, response, provider: target.provider, ...(permissionMode ? { permissionMode } : {}) },
    )
    if (permission.provider === 'codex' && permission.questions?.length) {
      setLiveTranscriptMessages((prev) => completeCodexQuestionLiveMessage(prev, permission, null))
    }
    setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
    setPermissionOptionIndex(0)
  } catch (err) {
    if (isPendingRequestGone(err)) {
      setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
      setPermissionOptionIndex(0)
      showNotice('info', PENDING_REQUEST_GONE_NOTICE, 6000)
    } else {
      showNotice('error', err instanceof Error ? err.message : 'Failed to respond to permission')
    }
  } finally {
    setPermissionActionLoading(null)
  }
}

export type ToggleExpansionContext = {
  readCursorIndex: () => number
  visibleTranscriptCards: TuiTranscriptCard[]
  groupedToolView: boolean
  resolvedExpandedKeys: Set<string>
  agentToolCursorByGroupKey: Record<string, string>
  transcriptView: TuiTranscriptView
  isChatLikeView: boolean
  expandedCardKeys: Set<string>
  collapsedCardKeys: Set<string>
  setAgentToolCursorByGroupKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setCollapsedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  setExpandedCardKeys: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function runToggleExpansion(ctx: ToggleExpansionContext, scope?: 'selected' | 'parent') {
  const {
    readCursorIndex, visibleTranscriptCards, groupedToolView, resolvedExpandedKeys,
    agentToolCursorByGroupKey, transcriptView, isChatLikeView, expandedCardKeys, collapsedCardKeys,
    setAgentToolCursorByGroupKey, setCollapsedCardKeys, setExpandedCardKeys,
  } = ctx
  if (scope === undefined) scope = 'selected'
  const cursorIndex = readCursorIndex()
  const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
  if (!card) return
  const agentToolCards = groupedToolView && resolvedExpandedKeys.has(card.key)
    ? agentToolCardsFor(card)
    : []
  const agentToolKey = agentToolCursorByGroupKey[card.key] ?? null
  const selectedAgentTool = scope === 'selected' && agentToolKey
    ? agentToolCards.find((toolCard) => toolCard.key === agentToolKey) ?? null
    : null
  const targetCard = selectedAgentTool ?? card
  const isAgentToolTarget = selectedAgentTool !== null
  const shouldAutoFold = (
    transcriptView === 'conversation'
    || isChatLikeView
    || transcriptView === 'agents'
  ) && targetCard.autoFold
  const isExpanded = isAgentToolTarget
    ? agentToolCardIsExpanded(targetCard, expandedCardKeys, collapsedCardKeys)
    : resolvedExpandedKeys.has(targetCard.key)

  if (!isAgentToolTarget && !isExpanded && card.key.startsWith('agents-tools:')) {
    const firstTool = agentToolCardsFor(card)[0]
    if (firstTool) {
      setAgentToolCursorByGroupKey((current) => (
        current[card.key] === firstTool.key
          ? current
          : { ...current, [card.key]: firstTool.key }
      ))
    }
  }

  if (shouldAutoFold) {
    setCollapsedCardKeys((current) => {
      if (!current.has(targetCard.key)) return current
      const next = new Set(current)
      next.delete(targetCard.key)
      return next
    })
    setExpandedCardKeys((current) => {
      const next = new Set(current)
      if (isExpanded) next.delete(targetCard.key)
      else next.add(targetCard.key)
      return next
    })
    return
  }

  setExpandedCardKeys((current) => {
    if (!current.has(targetCard.key)) return current
    const next = new Set(current)
    next.delete(targetCard.key)
    return next
  })
  setCollapsedCardKeys((current) => {
    const next = new Set(current)
    if (isExpanded) next.add(targetCard.key)
    else next.delete(targetCard.key)
    return next
  })
}

export type CommitRenameContext = {
  renameSessionKey: string | null
  selectedSession: Session | null
  renameDraftRef: React.RefObject<string>
  setRenameSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSessionDetail: React.Dispatch<React.SetStateAction<TuiSessionDetail | null>>
  sessionDetailCacheRef: React.RefObject<TranscriptDetailCache>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
  provider: ProviderSelection
}

export async function runCommitRename(ctx: CommitRenameContext) {
  const {
    renameSessionKey, selectedSession, renameDraftRef, setRenameSessionKey, setRenameDraft,
    setSessions, setOpenTabSessions, setSessionDetail, sessionDetailCacheRef, refreshSessions,
    provider,
  } = ctx
  if (!renameSessionKey || !selectedSession) return
  const trimmed = renameDraftRef.current.trim()
  setRenameSessionKey(null)
  setRenameDraft('')
  renameDraftRef.current = ''
  if (!trimmed) return
  setSessions((prev) => prev.map((session) => (
    sessionKey(session) === renameSessionKey
      ? { ...session, customTitle: trimmed, summary: trimmed }
      : session
  )))
  setOpenTabSessions((prev) => prev.map((session) => (
    sessionKey(session) === renameSessionKey
      ? { ...session, customTitle: trimmed, summary: trimmed }
      : session
  )))
  setSessionDetail((prev) => (
    prev && selectedSession && sessionKey(selectedSession) === renameSessionKey && prev.info
      ? {
          ...prev,
          info: {
            ...prev.info,
            customTitle: trimmed,
            summary: trimmed,
          },
        }
      : prev
  ))
  const cachedDetail = sessionDetailCacheRef.current.get(renameSessionKey)
  if (cachedDetail?.info) {
    touchMapEntry(sessionDetailCacheRef.current, renameSessionKey, {
      ...cachedDetail,
      info: {
        ...cachedDetail.info,
        customTitle: trimmed,
        summary: trimmed,
      },
    })
  }
  try {
    await patchTuiSession(selectedSession, { title: trimmed })
    void refreshSessions(provider, true, false)
  } catch {
    // rename failed silently — session list will show original title on next poll
  }
}

export type ConfirmExitContext = {
  exitInProgressRef: React.RefObject<boolean>
  setExitCleanupInProgress: React.Dispatch<React.SetStateAction<boolean>>
  setQueuedComposerSends: React.Dispatch<React.SetStateAction<QueuedComposerSend[]>>
  queuedComposerSendsRef: React.RefObject<QueuedComposerSend[]>
  workspaceContext: WorkspaceContextValue
  activeComposerSendCleanupRef: React.MutableRefObject<Promise<void> | null>
  composerAbortRef: React.MutableRefObject<AbortController | null>
  activeComposerTurnRequestIdRef: React.MutableRefObject<string | null>
  composerTargetSessionRef: React.RefObject<Session | null>
  runningSessionsRef: React.RefObject<RunningSessionRef[]>
  composerSessions: ComposerSessions
  persistTheme: () => void
  renderer: CliRenderer
}

export function runConfirmExit(ctx: ConfirmExitContext) {
  const {
    exitInProgressRef, setExitCleanupInProgress, setQueuedComposerSends, queuedComposerSendsRef,
    workspaceContext, activeComposerSendCleanupRef, composerAbortRef,
    activeComposerTurnRequestIdRef, composerTargetSessionRef, runningSessionsRef, composerSessions,
    persistTheme, renderer,
  } = ctx
  if (exitInProgressRef.current) return
  exitInProgressRef.current = true
  setExitCleanupInProgress(true)
  setQueuedComposerSends(queuedComposerSendsRef.current)
  try { workspaceContext.controller.flush() } catch { /* exit reports existing errors */ }

  const cleanupPromise = activeComposerSendCleanupRef.current
  const controller = composerAbortRef.current
  const activeTurnRequestId = activeComposerTurnRequestIdRef.current
  const activeTurnTarget = composerTargetSessionRef.current
  const runningRefs = [...runningSessionsRef.current]
  for (const key of composerSessions.keys()) composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current?.abort()

  void (async () => {
    const cleanupTasks: Promise<unknown>[] = []
    // Attached, the turns belong to the daemon: closing this window is a
    // detach, and interrupting them here would stop work in every other
    // client's view of it. Only the local stream above is dropped.
    if (!ATTACHED_DAEMON_HOST && activeTurnTarget && activeTurnRequestId) {
      cleanupTasks.push(interruptTuiSessionTurn({
        sessionId: activeTurnTarget.sessionId,
        provider: activeTurnTarget.provider,
        providerInstanceId: activeTurnTarget.providerInstanceId,
        turnRequestId: activeTurnRequestId,
      }).catch(() => undefined))
    }
    if (!ATTACHED_DAEMON_HOST && runningRefs.length > 0) {
      cleanupTasks.push(Promise.allSettled(runningRefs.map((running) => interruptTuiSessionTurn(running))))
    }
    for (const key of composerSessions.keys()) {
      const cleanup = composerSessions.peekRef<Promise<void> | null>(key, 'activeComposerSendCleanupRef')?.current
      if (cleanup) cleanupTasks.push(cleanup.catch(() => undefined))
    }
    if (cleanupTasks.length > 0) {
      await Promise.race([
        Promise.all(cleanupTasks).then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, EXIT_CLEANUP_TIMEOUT_MS)),
      ])
    }
    persistTheme()
    renderer.destroy()
    process.exit(0)
  })()
}

export type RewindConversationToPromptContext = {
  composerTargetSession: Session | null
  sessionDetail: TuiSessionDetail | null
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  sessionDetailMtimeRef: React.RefObject<Map<string, number>>
  loader: TranscriptSessionLoader
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  startFreshSession: (targetProvider: AgentProvider, cwd: string) => Promise<void>
  writeWorkspaceDraft: (key: string, text: string) => void
  openCreatedSession: (draft: Session) => Promise<void>
}

export async function runRewindConversationToPrompt(ctx: RewindConversationToPromptContext, chosen: RewindCandidate) {
  const {
    composerTargetSession, sessionDetail, composerTextareaRef, setComposerDraft, setComposerActive,
    sessionDetailMtimeRef, loader, refreshSelectedSessionDetail, showNotice, startFreshSession,
    writeWorkspaceDraft, openCreatedSession,
  } = ctx
  const target = composerTargetSession
  const raw = sessionDetail?.rawMessages ?? []
  if (!target) return false
  const restorePrompt = () => setTimeout(() => {
    composerTextareaRef.current?.setText(chosen.text)
    setComposerDraft(chosen.text)
    setComposerActive(true)
  }, 0)
  try {
    if (target.provider === 'codex' || target.provider === 'opencode') {
      const turnId = raw.find((message) => message.uuid === chosen.uuid)?.turnId
      if (target.provider === 'codex' && !turnId) throw new Error('Could not find that prompt\'s turn')
      const body = target.provider === 'codex' ? { beforeTurnId: turnId } : { userMessageId: chosen.uuid }
      await rewindTuiSession(target, body)
      // The cached detail predates the revert and the sidebar's lastModified
      // has not caught up, so the read would otherwise be skipped as unchanged.
      sessionDetailMtimeRef.current.delete(sessionKey(target))
      loader.invalidate(target)
      await refreshSelectedSessionDetail(target, true)
      restorePrompt()
      showNotice('info', 'Rewound — the prompt is back in the composer; files are unchanged', 6000)
      return true
    }
    if (target.provider === 'claude' || target.provider === 'pi') {
      const point = forkPointBefore(raw, chosen.uuid)
      if (point === undefined) throw new Error('Could not find that prompt in the transcript')
      if (point === null) {
        await startFreshSession(target.provider, target.cwd ?? process.cwd())
      } else {
        const forked = await forkTuiSession(target, point)
        const fork: Session = {
          ...target,
          sessionId: forked.sessionId,
          createdAt: Date.now(),
          lastModified: Date.now(),
          summary: `Rewind of ${target.customTitle?.trim() || target.summary?.trim() || 'session'}`,
          customTitle: undefined,
          isPending: false,
        }
        // Opening the fork restores its own draft, so the prompt goes there.
        writeWorkspaceDraft(sessionKey(fork), chosen.text)
        await openCreatedSession(fork)
      }
      if (point === null) restorePrompt()
      showNotice('info', 'Rewound in a fork — the original is unchanged; files are unchanged', 6000)
      return true
    }
    showNotice('info', `${formatProviderLabel(target.provider ?? 'claude')} sessions cannot be rewound`)
    return false
  } catch (err) {
    showNotice('error', err instanceof Error ? err.message : 'Rewind failed')
    return false
  }
}

export type HandoffToProviderContext = {
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  newSessionBusy: boolean
  sessionDetail: TuiSessionDetail | null
  setNewSessionBusy: React.Dispatch<React.SetStateAction<boolean>>
  writeWorkspaceDraft: (key: string, text: string) => void
  openCreatedSession: (draft: Session) => Promise<void>
}

export async function runHandoffToProvider(ctx: HandoffToProviderContext, target: Session, providerName: string) {
  const {
    showNotice, newSessionBusy, sessionDetail, setNewSessionBusy, writeWorkspaceDraft,
    openCreatedSession,
  } = ctx
  const nextProvider = providerName.trim().toLowerCase()
  if (!isAgentProvider(nextProvider)) {
    showNotice('info', 'Usage: /handoff <claude|codex|opencode|copilot|pi>', 5000)
    return
  }
  if (newSessionBusy) return
  const detail = sessionDetail && sessionDetail.info?.sessionId === target.sessionId ? sessionDetail : null
  if (!detail) {
    showNotice('info', 'Nothing to hand off yet — send a first message')
    return
  }
  setNewSessionBusy(true)
  try {
    const prompt = buildContextHandoffPrompt({
      fromProvider: target.provider ?? 'claude',
      brief: buildHandoffBriefMarkdown({ session: target, detail, git: null, bookmarkIds: new Set() }),
      raw: detail.rawMessages,
    })
    const created = await createTuiSession({ provider: nextProvider, cwd: target.cwd ?? process.cwd() })
    const next: Session = {
      sessionId: created.sessionId,
      provider: created.provider,
      cwd: created.cwd,
      createdAt: Date.now(),
      lastModified: Date.now(),
      summary: `Handoff from ${target.customTitle?.trim() || target.summary?.trim() || 'session'}`,
      isPending: created.isPending,
    }
    recordContextTransfer({
      type: 'handoff',
      source: { provider: target.provider, sessionId: target.sessionId },
      target: { provider: created.provider, sessionId: created.sessionId },
      strategy: 'context_handoff',
    })
    writeWorkspaceDraft(sessionKey(next), prompt)
    await openCreatedSession(next)
    showNotice('info', `Continuing on ${formatProviderLabel(created.provider)} — the handoff is in the composer; the original is unchanged`, 6000)
  } catch (err) {
    showNotice('error', err instanceof Error ? err.message : 'Handoff failed')
  } finally {
    setNewSessionBusy(false)
  }
}

export type ToggleBookmarkForCursorContext = {
  selectedSessionTarget: Session | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  readCursorIndex: () => number
  visibleTranscriptCards: TuiTranscriptCard[]
  bookmarkKeysRef: React.RefObject<Set<string>>
  setBookmarkKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  readerTitle: string
}

export async function runToggleBookmarkForCursor(ctx: ToggleBookmarkForCursorContext) {
  const {
    selectedSessionTarget, showNotice, readCursorIndex, visibleTranscriptCards, bookmarkKeysRef,
    setBookmarkKeys, readerTitle,
  } = ctx
  const target = selectedSessionTarget
  if (!target) { showNotice('error', 'No session selected'); return }
  const cursorIndex = readCursorIndex()
  const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
  if (!card) { showNotice('error', 'No message selected'); return }
  if (card.key.startsWith('live-')) { showNotice('error', 'Cannot bookmark a streaming message'); return }
  const uuid = card.key
  const next = !bookmarkKeysRef.current.has(uuid)
  setBookmarkKeys((prev) => {
    const updated = new Set(prev)
    if (next) updated.add(uuid)
    else updated.delete(uuid)
    return updated
  })
  try {
    const meta = next
      ? {
          role: card.role,
          label: card.role === 'user' ? 'user' : 'assistant',
          preview: (card.compactSummary || card.searchText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
          sessionTitle: readerTitle || undefined,
          messageTimestamp: card.timestamp,
        }
      : undefined
    const ids = await toggleTuiSessionBookmark(
      { sessionId: target.sessionId, provider: target.provider } as Session,
      uuid,
      next,
      meta,
    )
    setBookmarkKeys(new Set(ids))
    showNotice('info', next ? 'Bookmarked message' : 'Removed bookmark')
  } catch (err) {
    setBookmarkKeys((prev) => {
      const updated = new Set(prev)
      if (next) updated.delete(uuid)
      else updated.add(uuid)
      return updated
    })
    showNotice('error', err instanceof Error ? err.message : 'Failed to update bookmark')
  }
}

export type CopySelectedMessageContext = {
  terminalSelectionRef: React.RefObject<{ text: string; capturedAt: number; } | null>
  renderer: CliRenderer
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  readCursorIndex: () => number
  visibleTranscriptCards: TuiTranscriptCard[]
}

export async function runCopySelectedMessage(ctx: CopySelectedMessageContext, cardOverride?: TuiTranscriptCard) {
  const {
    terminalSelectionRef, renderer, showNotice, readCursorIndex, visibleTranscriptCards,
  } = ctx
  const terminalSelection = terminalSelectionRef.current
  if (
    terminalSelection
    && Date.now() - terminalSelection.capturedAt <= TERMINAL_SELECTION_COPY_WINDOW_MS
    && terminalSelection.text.trim()
  ) {
    try {
      await writeClipboard(terminalSelection.text, renderer)
      terminalSelectionRef.current = null
      showNotice('info', 'Copied terminal selection to clipboard')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy selection')
    }
    return
  }

  const cursorIndex = readCursorIndex()
  const card = cardOverride ?? (cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null)
  if (!card) {
    showNotice('error', 'No message selected')
    return
  }
  const text = cardClipboardText(card)
  if (!text) {
    showNotice('error', 'Selected message has no copyable text')
    return
  }
  try {
    await writeClipboard(text, renderer)
    showNotice('info', 'Copied selected message to clipboard')
  } catch (err) {
    showNotice('error', err instanceof Error ? err.message : 'Failed to copy to clipboard')
  }
}

export type SubmitWorktreeTaskContext = {
  worktreeDraft: string
  worktreeSubmitInFlightRef: React.RefObject<boolean>
  selectedSession: Session | null
  sessionDetail: TuiSessionDetail | null
  setWorktreeBusy: React.Dispatch<React.SetStateAction<boolean>>
  provider: ProviderSelection
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setComposerPaneTargetKey: React.Dispatch<React.SetStateAction<string | null>>
  setComposerPreferredTargetKey: React.Dispatch<React.SetStateAction<string | null>>
  prepareCreatedSessionForComposer: (draft: Session) => Promise<void>
  setWorktreeModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWorktreeDraft: React.Dispatch<React.SetStateAction<string>>
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

export async function runSubmitWorktreeTask(ctx: SubmitWorktreeTaskContext) {
  const {
    worktreeDraft, worktreeSubmitInFlightRef, selectedSession, sessionDetail, setWorktreeBusy,
    provider, setOpenTabSessions, setSelectedSessionKey, setComposerPaneTargetKey,
    setComposerPreferredTargetKey, prepareCreatedSessionForComposer, setWorktreeModalOpen,
    setWorktreeDraft, setComposerActive, showNotice,
  } = ctx
  const name = worktreeDraft.trim()
  // Ref-guarded: Enter can arrive via both the input's onSubmit and the
  // keyboard branch in the same tick, before worktreeBusy state lands.
  if (!name || worktreeSubmitInFlightRef.current) return
  worktreeSubmitInFlightRef.current = true
  const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
  setWorktreeBusy(true)
  try {
    const task = await createTuiWorktreeTask(baseCwd, name)
    const targetProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
    const result = await createTuiSession({ provider: targetProvider, cwd: task.path, title: name })
    const draft: Session = {
      sessionId: result.sessionId,
      provider: result.provider,
      cwd: result.cwd,
      createdAt: Date.now(),
      lastModified: Date.now(),
      summary: name,
      isPending: result.isPending,
    }
    setOpenTabSessions((prev) => prev.some((s) => sessionKey(s) === sessionKey(draft)) ? prev : [...prev, draft])
    setSelectedSessionKey(sessionKey(draft))
    setComposerPaneTargetKey(sessionKey(draft))
    setComposerPreferredTargetKey(sessionKey(draft))
    await prepareCreatedSessionForComposer(draft)
    setWorktreeModalOpen(false)
    setWorktreeDraft('')
    setComposerActive(true)
    showNotice('info', `Worktree task on ${task.branch} — the session runs in an isolated checkout.`, 5000)
  } catch (err) {
    showNotice('error', err instanceof Error ? err.message : 'Failed to create worktree task')
  } finally {
    worktreeSubmitInFlightRef.current = false
    setWorktreeBusy(false)
  }
}

export type SelectSidebarSessionContext = {
  setSidebarSubagentCursor: React.Dispatch<React.SetStateAction<string | null>>
  windowItems: WindowItem[]
  focusSplitPane: (paneIndex: number) => void
  floatingItem: WindowItem | null
  splitFocusIndex: number | null
  checkpointWindowLayout: () => void
  setWorkspaceLaunched: React.Dispatch<React.SetStateAction<boolean>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  focusedWindowItem: WindowItem | null
  windowItemKey: (item: WindowItem) => string
  orderedWindowKeys: string[]
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  commitWindowKeys: (keys: string[], tree?: WindowSplitTree) => void
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  reconciledSplitTree: WindowSplitTree | null
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  liveWindowStacks: WindowStack[]
  setComposerPaneTargetKey: React.Dispatch<React.SetStateAction<string | null>>
  setOverviewPendingTarget: React.Dispatch<React.SetStateAction<string | null>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setActivePopoverTab: React.Dispatch<React.SetStateAction<string | null>>
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function runSelectSidebarSession(ctx: SelectSidebarSessionContext, session: Session) {
  const {
    setSidebarSubagentCursor, windowItems, focusSplitPane, floatingItem, splitFocusIndex,
    checkpointWindowLayout, setWorkspaceLaunched, setOpenTabSessions, focusedWindowItem,
    windowItemKey, orderedWindowKeys, floatingWindow, setFloatingWindow, commitWindowKeys,
    setWindowSplitTree, reconciledSplitTree, setWindowStacks, liveWindowStacks,
    setComposerPaneTargetKey, setOverviewPendingTarget, setFocusedPane, setActivePopoverTab,
    setWorkspaceHasSession, setSelectedSessionKey, setError,
  } = ctx
  setSidebarSubagentCursor(null)
  const existing = windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === sessionKey(session))
  if (existing >= 0) { focusSplitPane(existing); return }
  if (floatingItem?.kind === 'session' && sessionKey(floatingItem.session) === sessionKey(session)) { focusSplitPane(FLOATING_PANE_INDEX); return }
  const key = sessionKey(session)
  // A focused window takes the selection; otherwise selecting it is enough,
  // and the selected session is put in a window.
  if (splitFocusIndex !== null) {
    checkpointWindowLayout()
    setWorkspaceLaunched(true)
    setOpenTabSessions(current => current.some(tab => sessionKey(tab) === key) ? current : [...current, session])
    const old = focusedWindowItem?.kind === 'session' ? windowItemKey(focusedWindowItem) : null
    const nextKeys = old && splitFocusIndex !== FLOATING_PANE_INDEX ? orderedWindowKeys.map(entry => entry === old ? key : entry) : [...orderedWindowKeys, key]
    if (old && splitFocusIndex === FLOATING_PANE_INDEX && floatingWindow) setFloatingWindow({ ...floatingWindow, key })
    else {
      commitWindowKeys(nextKeys)
      setWindowSplitTree(reconciledSplitTree ? reconcileWindowSplitTree(reconciledSplitTree, nextKeys, false) : arrangePaneTree(nextKeys, false, 'columns'))
    }
    if (old) setWindowStacks(liveWindowStacks.map(stack => stack.map(entry => entry === old ? key : entry)))
    setComposerPaneTargetKey(key)
    setOverviewPendingTarget(key)
    setFocusedPane('messages')
    return
  }
  setActivePopoverTab(null)
  setComposerPaneTargetKey(key)
  setWorkspaceHasSession(true); setWorkspaceLaunched(true)
  setSelectedSessionKey(key)
  setError(null)
  setFocusedPane('sessions')
}

export type ReplySelectedMessageContext = {
  readCursorIndex: () => number
  visibleTranscriptCards: TuiTranscriptCard[]
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  applyComposerSnapshot: (snapshot: ComposerDraftSnapshot) => void
  composerMentionAttachments: SendAttachment[]
  composerPromptParts: ComposerPromptPart[]
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
}

export function runReplySelectedMessage(ctx: ReplySelectedMessageContext, cardOverride?: TuiTranscriptCard) {
  const {
    readCursorIndex, visibleTranscriptCards, showNotice, composerTextareaRef, composerDraft,
    applyComposerSnapshot, composerMentionAttachments, composerPromptParts, setComposerActive,
  } = ctx
  const cursorIndex = readCursorIndex()
  const card = cardOverride ?? (cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null)
  if (!card) {
    showNotice('error', 'No message selected')
    return
  }
  const text = cardClipboardText(card).trim()
  if (!text) {
    showNotice('error', 'Selected message has no reply text')
    return
  }

  const quoted = text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const existing = composerTextareaRef.current?.plainText ?? composerDraft
  const separator = existing.length > 0 ? (existing.endsWith('\n') ? '' : '\n\n') : ''
  const next = `${existing}${separator}${quoted}\n\n`

  applyComposerSnapshot({
    text: next,
    attachments: [...composerMentionAttachments],
    promptParts: [...composerPromptParts],
    cursorOffset: next.length,
  })
  setComposerActive(true)
}

export type MoveAgentToolCursorContext = {
  groupedToolView: boolean
  readCursorIndex: () => number
  visibleTranscriptCards: TuiTranscriptCard[]
  resolvedExpandedKeys: Set<string>
  agentToolCursorByGroupKey: Record<string, string>
  setAgentToolCursorByGroupKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

export function runMoveAgentToolCursor(ctx: MoveAgentToolCursorContext, delta: -1 | 1) {
  const {
    groupedToolView, readCursorIndex, visibleTranscriptCards, resolvedExpandedKeys,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey,
  } = ctx
  if (!groupedToolView) return false
  const cursorIndex = readCursorIndex()
  const groupCard = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
  if (!groupCard || !resolvedExpandedKeys.has(groupCard.key)) return false
  const toolCards = agentToolCardsFor(groupCard)
  if (toolCards.length === 0) return false
  const currentKey = agentToolCursorByGroupKey[groupCard.key] ?? null
  const currentIndex = currentKey
    ? toolCards.findIndex((toolCard) => toolCard.key === currentKey)
    : -1
  if (currentIndex === -1) {
    if (delta < 0) return false
    const first = toolCards[0]
    if (!first) return false
    setAgentToolCursorByGroupKey((current) => current[groupCard.key] === first.key ? current : { ...current, [groupCard.key]: first.key })
    return true
  }
  const nextIndex = currentIndex + delta
  if (nextIndex < 0 || nextIndex >= toolCards.length) return false
  const next = toolCards[nextIndex]
  if (!next) return false
  setAgentToolCursorByGroupKey((current) => current[groupCard.key] === next.key ? current : { ...current, [groupCard.key]: next.key })
  return true
}

export type ToggleVoiceContext = {
  voiceJob: React.RefObject<{ controller: AbortController; stop?: () => void; } | null>
  setVoiceStatus: React.Dispatch<React.SetStateAction<string>>
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  insertComposerTextAtCursor: (textToInsert: string) => void
}

export function runToggleVoice(ctx: ToggleVoiceContext) {
  const {
    voiceJob, setVoiceStatus, setComposerActive, insertComposerTextAtCursor,
  } = ctx
  if (voiceJob.current) {
    if (voiceJob.current.stop) voiceJob.current.stop()
    else { voiceJob.current.controller.abort(); voiceJob.current = null; setVoiceStatus('Voice input cancelled') }
    return
  }
  const job: { controller: AbortController; stop?: () => void } = { controller: new AbortController() }
  voiceJob.current = job
  setComposerActive(true)
  setVoiceStatus('Opening microphone…')
  void recordVoice(job.controller.signal, (stop) => {
    job.stop = () => { stop(); job.stop = undefined; setVoiceStatus('Transcribing locally…') }
    setVoiceStatus('Listening… Ctrl+Shift+V to stop')
  }).then(text => {
    if (!job.controller.signal.aborted) insertComposerTextAtCursor(`${text} `)
  }).catch(error => {
    if (!job.controller.signal.aborted) setVoiceStatus(error instanceof Error ? error.message : 'Voice input failed')
  }).finally(() => {
    if (voiceJob.current === job) {
      voiceJob.current = null
      setVoiceStatus(current => /^(Opening|Listening|Transcribing)/.test(current) ? '' : current)
    }
  })
}

export type RespondToAttentionItemContext = {
  attentionRespondingId: string | null
  setAttentionRespondingId: React.Dispatch<React.SetStateAction<string | null>>
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  setBackgroundPrompts: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

export async function runRespondToAttentionItem(ctx: RespondToAttentionItemContext, item: AttentionItem, response: PermissionResponse) {
  const {
    attentionRespondingId, setAttentionRespondingId, setPendingPermissions, setBackgroundPrompts,
    showNotice,
  } = ctx
  const permission = item.permission
  if (!permission || attentionRespondingId) return
  setAttentionRespondingId(permission.id)
  try {
    await runTuiSessionAction(
      { sessionId: item.sessionId, provider: item.provider } as Session,
      { action: 'respondPermission', permissionId: permission.id, response, provider: item.provider },
    )
    setPendingPermissions((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
    setBackgroundPrompts((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
  } catch (err) {
    if (isPendingRequestGone(err)) {
      setPendingPermissions((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
      setBackgroundPrompts((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
      showNotice('info', PENDING_REQUEST_GONE_NOTICE, 6000)
    } else {
      showNotice('error', err instanceof Error ? err.message : 'Failed to respond to permission')
    }
  } finally {
    setAttentionRespondingId(null)
  }
}
