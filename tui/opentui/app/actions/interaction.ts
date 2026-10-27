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
import { type PendingPermission, type PendingQuestionAnswers } from '../../../../lib/permissions'
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
  const answers: PendingQuestionAnswers = {}
  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i]!
    const selected = questionSelections[i] ?? []
    const freeform = questionFreeformAnswers[i]?.trim()
    const values = question.multiSelect && freeform
      ? [...selected, freeform]
      : freeform
      ? [freeform]
      : selected
    if (values.length === 0) {
      if (question.required === false) continue
      // Jump focus to the first unanswered question instead of submitting.
      setQuestionFocusIndex(i)
      setQuestionOptionIndex(0)
      return
    }
    answers[question.id ?? question.question] = values
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
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: React.SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): React.MutableRefObject<T>; peekRef<T>(key: string, name: string): React.MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
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
