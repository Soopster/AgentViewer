/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React from 'react'
import { openExternalUrl } from '../../terminalBrowser'
import { type TextareaRenderable } from '@opentui/core'
import { type Session } from '../../../../lib/types'
import { permissionOptionsFor, type PendingPermission, type PermissionOption, type PermissionResponse } from '../../../../lib/permissions'
import { isCodexQuestionnaire } from '../../../../lib/questionnaire'
import { type TuiPermissionMode } from '../types'
import { handleCodexQuestionnaireKeys } from './codexQuestionnaireKeys'

/** Returns true when one of these branches handled the key. */
export function handleAskAndShortcutKeys({
  pendingPermissions, permissionActionLoading, questionFocusIndex, key, questionFreeformEditing,
  handled, questionOptionIndex, setQuestionFreeformEditing, setQuestionFreeformAnswers,
  setQuestionSelections, setQuestionOptionIndex, setQuestionFocusIndex, sequence,
  toggleTuiQuestionOption, questionFreeformAnswers, submitTuiQuestion, respondToTuiPermission,
  permissionOptionIndex, setPermissionOptionIndex, respondToTuiPlan, movePermissionOptionIndex,
  resolvePermissionOptionIndex, composerTargetSession, selectedSession,
  cycleClaudeComposerPermissionMode, executeCommandPalette, composerActive, isShifted,
  surfacePanelOpen, setSurfacePanelOpen, setSurfacePanelFocused, surfacePanelFocused,
  fullscreenMode, composerTextareaRef, composerDraft, toggleFullscreenMode,
}: {
  pendingPermissions: PendingPermission[]
  permissionActionLoading: string | null
  questionFocusIndex: number
  key: KeyEvent
  questionFreeformEditing: boolean
  handled: (action: () => void) => void
  questionOptionIndex: number
  setQuestionFreeformEditing: React.Dispatch<React.SetStateAction<boolean>>
  setQuestionFreeformAnswers: React.Dispatch<React.SetStateAction<Record<number, string>>>
  setQuestionSelections: React.Dispatch<React.SetStateAction<Record<number, string[]>>>
  setQuestionOptionIndex: React.Dispatch<React.SetStateAction<number>>
  setQuestionFocusIndex: React.Dispatch<React.SetStateAction<number>>
  sequence: string
  toggleTuiQuestionOption: (qi: number, multiSelect: boolean, label: string) => void
  questionFreeformAnswers: Record<number, string>
  submitTuiQuestion: (permission: PendingPermission) => Promise<void>
  respondToTuiPermission: (permission: PendingPermission, response: PermissionResponse, permissionMode?: TuiPermissionMode) => Promise<void>
  permissionOptionIndex: number
  setPermissionOptionIndex: React.Dispatch<React.SetStateAction<number>>
  respondToTuiPlan: (permission: PendingPermission, decision: 'acceptEdits' | 'default' | 'reject') => Promise<void>
  movePermissionOptionIndex: (permission: PendingPermission, options: PermissionOption[], delta: number) => void
  resolvePermissionOptionIndex: (permission: PendingPermission, options: PermissionOption[]) => number
  composerTargetSession: Session | null
  selectedSession: Session | null
  cycleClaudeComposerPermissionMode: (target: Session | null | undefined) => void
  executeCommandPalette: (id: string) => void
  composerActive: boolean
  isShifted: (char: string) => boolean
  surfacePanelOpen: boolean
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  surfacePanelFocused: boolean
  fullscreenMode: boolean
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  toggleFullscreenMode: (forced?: boolean) => void
}): boolean {
    // A pending tool approval blocks the turn — capture option nav / confirm /
    // number shortcuts so the user can allow or reject it. Other keys (scroll,
    // Ctrl+C interrupt) still fall through.
    // AskUserQuestion picker: navigate options, toggle, and submit. Takes over
    // the pending-approval keys when the active prompt carries questions.
    if (pendingPermissions.length > 0 && !permissionActionLoading && (pendingPermissions[0]!.questions?.length ?? 0) > 0) {
      const activePermission = pendingPermissions[0]!
      const questions = activePermission.questions ?? []
      // Codex's requestUserInput is a questionnaire, not a stacked picker: it
      // gets one tab per question plus Submit, matching the Codex CLI.
      if (isCodexQuestionnaire(activePermission)) {
        return handleCodexQuestionnaireKeys({
          permission: activePermission, questions, key, sequence, handled,
          questionFocusIndex, questionOptionIndex, questionFreeformEditing, questionFreeformAnswers,
          setQuestionFocusIndex, setQuestionOptionIndex, setQuestionSelections,
          setQuestionFreeformAnswers, setQuestionFreeformEditing, toggleTuiQuestionOption,
          submitTuiQuestion, respondToTuiPermission,
        })
      }
      const qi = Math.min(questionFocusIndex, questions.length - 1)
      const question = questions[qi]!
      if (question.externalUrl && key.name === 'o' && !questionFreeformEditing && !key.ctrl && !key.meta) {
        handled(() => { void openExternalUrl(question.externalUrl!) })
        return true
      }
      const freeformIndex = question.allowFreeform ? question.options.length : -1
      const optionCount = question.options.length + (question.allowFreeform ? 1 : 0)
      const optIndex = Math.min(questionOptionIndex, optionCount - 1)
      if (questionFreeformEditing) {
        if (key.name === 'return') {
          handled(() => setQuestionFreeformEditing(false))
          return true
        }
        if (key.name === 'escape') {
          handled(() => setQuestionFreeformEditing(false))
          return true
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          handled(() => setQuestionFreeformAnswers((prev) => ({
            ...prev,
            [qi]: (prev[qi] ?? '').slice(0, -1),
          })))
          return true
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          handled(() => {
            setQuestionFreeformAnswers((prev) => ({ ...prev, [qi]: `${prev[qi] ?? ''}${key.sequence}` }))
            if (!question.multiSelect) setQuestionSelections((prev) => ({ ...prev, [qi]: [] }))
          })
          return true
        }
        return true
      }
      if (key.name === 'up' || key.name === 'k') {
        handled(() => setQuestionOptionIndex((i) => Math.max(0, Math.min(i, optionCount - 1) - 1)))
        return true
      }
      if (key.name === 'down' || key.name === 'j') {
        handled(() => setQuestionOptionIndex((i) => Math.min(optionCount - 1, Math.min(i, optionCount - 1) + 1)))
        return true
      }
      if ((key.name === 'left' || key.name === 'right' || key.name === 'tab') && questions.length > 1) {
        const delta = key.name === 'left' ? -1 : 1
        handled(() => {
          setQuestionFocusIndex((i) => (i + delta + questions.length) % questions.length)
          setQuestionOptionIndex(0)
        })
        return true
      }
      if (sequence === ' ') {
        if (question.allowFreeform && optIndex === freeformIndex) {
          handled(() => setQuestionFreeformEditing(true))
        } else {
          const opt = question.options[optIndex]
          if (opt) handled(() => toggleTuiQuestionOption(qi, question.multiSelect === true, opt.value ?? opt.label))
        }
        return true
      }
      const qDigit = Number.parseInt(sequence, 10)
      if (!Number.isNaN(qDigit) && qDigit >= 1 && qDigit <= optionCount) {
        handled(() => {
          setQuestionOptionIndex(qDigit - 1)
          if (qDigit - 1 === freeformIndex) {
            setQuestionFreeformEditing(true)
          } else {
            const opt = question.options[qDigit - 1]
            if (opt) toggleTuiQuestionOption(qi, question.multiSelect === true, opt.value ?? opt.label)
          }
        })
        return true
      }
      if (key.name === 'return') {
        // Single-select advances to the next unanswered question; otherwise
        // submit (submit also jumps to any still-unanswered question).
        handled(() => {
          if (question.allowFreeform && optIndex === freeformIndex && !questionFreeformAnswers[qi]?.trim() && question.required !== false) setQuestionFreeformEditing(true)
          else void submitTuiQuestion(activePermission)
        })
        return true
      }
      // Esc skips the whole prompt (declines the tool), matching the web SKIP.
      if (key.name === 'escape') {
        handled(() => { void respondToTuiPermission(activePermission, 'reject') })
        return true
      }
      return true
    }

    // ExitPlanMode plan-approval: keep planning / approve (ask) / approve (auto).
    if (pendingPermissions.length > 0 && !permissionActionLoading && pendingPermissions[0]!.toolName === 'ExitPlanMode') {
      const activePermission = pendingPermissions[0]!
      const planOptions = ['reject', 'default', 'acceptEdits'] as const
      const idx = Math.min(permissionOptionIndex, planOptions.length - 1)
      if (key.name === 'left') {
        handled(() => setPermissionOptionIndex((i) => Math.max(0, i - 1)))
        return true
      }
      if (key.name === 'right' || key.name === 'tab') {
        handled(() => setPermissionOptionIndex((i) => Math.min(planOptions.length - 1, i + 1)))
        return true
      }
      if (key.name === 'return') {
        handled(() => { void respondToTuiPlan(activePermission, planOptions[idx]!) })
        return true
      }
      if (key.name === 'escape') {
        handled(() => { void respondToTuiPlan(activePermission, 'reject') })
        return true
      }
      const planDigit = Number.parseInt(sequence, 10)
      if (!Number.isNaN(planDigit) && planDigit >= 1 && planDigit <= planOptions.length) {
        handled(() => { void respondToTuiPlan(activePermission, planOptions[planDigit - 1]!) })
        return true
      }
      return true
    }

    if (pendingPermissions.length > 0 && !permissionActionLoading) {
      const activePermission = pendingPermissions[0]!
      const options = permissionOptionsFor(activePermission)
      if (key.name === 'left') {
        handled(() => movePermissionOptionIndex(activePermission, options, -1))
        return true
      }
      if (key.name === 'right' || key.name === 'tab') {
        handled(() => movePermissionOptionIndex(activePermission, options, 1))
        return true
      }
      if (key.name === 'return') {
        const option = options[resolvePermissionOptionIndex(activePermission, options)]
        if (option) handled(() => { void respondToTuiPermission(activePermission, option.response) })
        return true
      }
      const digit = Number.parseInt(sequence, 10)
      if (!Number.isNaN(digit) && digit >= 1 && digit <= options.length) {
        const option = options[digit - 1]!
        handled(() => { void respondToTuiPermission(activePermission, option.response) })
        return true
      }
    }

    // Shift+Tab cycles Claude permission modes from any focus state.
    if (key.name === 'tab' && key.shift) {
      const target = composerTargetSession ?? selectedSession
      if (target?.provider === 'claude') {
        handled(() => {
          cycleClaudeComposerPermissionMode(target)
        })
        return true
      }
      // The native CLIs put their own mode on this key too: Copilot cycles
      // interactive/plan/autopilot, OpenCode switches primary agent, Codex
      // toggles Plan/Default.
      if (target?.provider === 'copilot' || target?.provider === 'opencode' || target?.provider === 'codex') {
        handled(() => executeCommandPalette('mode'))
        return true
      }
    }

    // ⇧O opens the surface panel, or refocuses it once escaped out of, and
    // takes focus with it so the launcher's letter shortcuts land somewhere
    // predictable. It sits after every modal and is skipped while the composer
    // is up: a capital O in a draft, a rename or a palette filter is text, and
    // checked first it swallowed the rest of the draft into the panel.
    if (!composerActive && isShifted('O')) {
      handled(() => {
        // closed → open and focused → (escaped out) → focused again → closed.
        if (!surfacePanelOpen) {
          setSurfacePanelOpen(true)
          setSurfacePanelFocused(true)
          return
        }
        if (!surfacePanelFocused) {
          setSurfacePanelFocused(true)
          return
        }
        setSurfacePanelOpen(false)
        setSurfacePanelFocused(false)
      })
      return true
    }

    // Fullscreen's restore binding remains global even when the composer owns
    // keyboard input — but only over an empty draft: mid-draft, a capital Z is
    // text. Outside fullscreen, Shift+Z is always ordinary draft text.
    if (fullscreenMode && isShifted('Z') && !(composerActive && (composerTextareaRef.current?.plainText ?? composerDraft))) {
      handled(() => toggleFullscreenMode(false))
      return true
    }
  return false
}
