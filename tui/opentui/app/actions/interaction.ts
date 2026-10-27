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
