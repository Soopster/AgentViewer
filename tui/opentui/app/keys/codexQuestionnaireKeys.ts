/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { Dispatch, SetStateAction } from 'react'
import { clampQuestionTab } from '../../../../lib/questionnaire'
import type { PendingPermission, PendingQuestion, PermissionResponse } from '../../../../lib/permissions'
import { openExternalUrl } from '../../terminalBrowser'

export type CodexQuestionnaireKeyContext = {
  permission: PendingPermission
  questions: PendingQuestion[]
  key: KeyEvent
  sequence: string
  handled: (action: () => void) => void
  questionFocusIndex: number
  questionOptionIndex: number
  questionFreeformEditing: boolean
  questionFreeformAnswers: Record<number, string>
  setQuestionFocusIndex: Dispatch<SetStateAction<number>>
  setQuestionOptionIndex: Dispatch<SetStateAction<number>>
  setQuestionSelections: Dispatch<SetStateAction<Record<number, string[]>>>
  setQuestionFreeformAnswers: Dispatch<SetStateAction<Record<number, string>>>
  setQuestionFreeformEditing: Dispatch<SetStateAction<boolean>>
  toggleTuiQuestionOption: (qi: number, multiSelect: boolean, label: string) => void
  submitTuiQuestion: (permission: PendingPermission) => Promise<void>
  respondToTuiPermission: (permission: PendingPermission, response: PermissionResponse) => Promise<void>
}

/**
 * Codex CLI's tabbed questionnaire. One tab per question plus a Submit tab:
 * ←/→ (and Tab/⇧Tab) move between tabs without requiring an answer, choosing a
 * single-select option advances, multi-select toggles and advances on Enter,
 * and Enter on Submit returns the structured answers.
 */
export function handleCodexQuestionnaireKeys(ctx: CodexQuestionnaireKeyContext): boolean {
  const {
    permission, questions, key, sequence, handled, questionFocusIndex,
    questionOptionIndex, questionFreeformEditing, questionFreeformAnswers,
    setQuestionFocusIndex, setQuestionOptionIndex, setQuestionSelections,
    setQuestionFreeformAnswers, setQuestionFreeformEditing, toggleTuiQuestionOption,
    submitTuiQuestion, respondToTuiPermission,
  } = ctx
  const submitIndex = questions.length
  const focusIndex = clampQuestionTab(permission, questionFocusIndex)
  const submitTab = focusIndex === submitIndex
  const question = submitTab ? null : questions[focusIndex]!
  const moveTab = (delta: number) => {
    const next = Math.min(Math.max(focusIndex + delta, 0), submitIndex)
    setQuestionFocusIndex(next)
    setQuestionOptionIndex(0)
    setQuestionFreeformEditing(false)
  }
  const advance = () => {
    const next = Math.min(focusIndex + 1, submitIndex)
    setQuestionFocusIndex(next)
    setQuestionOptionIndex(0)
    setQuestionFreeformEditing(false)
  }

  if (question && questionFreeformEditing) {
    if (key.name === 'return') {
      handled(() => {
        setQuestionFreeformEditing(false)
        advance()
      })
      return true
    }
    if (key.name === 'escape') {
      handled(() => setQuestionFreeformEditing(false))
      return true
    }
    if (key.name === 'backspace' || key.name === 'delete') {
      handled(() => setQuestionFreeformAnswers((prev) => ({
        ...prev,
        [focusIndex]: (prev[focusIndex] ?? '').slice(0, -1),
      })))
      return true
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      handled(() => {
        setQuestionFreeformAnswers((prev) => ({ ...prev, [focusIndex]: `${prev[focusIndex] ?? ''}${key.sequence}` }))
        if (!question.multiSelect) setQuestionSelections((prev) => ({ ...prev, [focusIndex]: [] }))
      })
      return true
    }
    return true
  }

  if (submitTab) {
    if (key.name === 'left' || (key.name === 'tab' && key.shift)) {
      handled(() => moveTab(-1))
      return true
    }
    if (key.name === 'right' || key.name === 'tab') {
      handled(() => moveTab(1))
      return true
    }
    if (key.name === 'return') {
      handled(() => { void submitTuiQuestion(permission) })
      return true
    }
    if (key.name === 'escape') {
      handled(() => { void respondToTuiPermission(permission, 'reject') })
      return true
    }
    return true
  }

  const questionRow = question!
  if (questionRow.externalUrl && key.name === 'o' && !key.ctrl && !key.meta) {
    handled(() => { void openExternalUrl(questionRow.externalUrl!) })
    return true
  }
  if (key.name === 'left' || (key.name === 'tab' && key.shift)) {
    handled(() => moveTab(-1))
    return true
  }
  if (key.name === 'right' || key.name === 'tab') {
    handled(() => moveTab(1))
    return true
  }

  const freeformIndex = questionRow.allowFreeform ? questionRow.options.length : -1
  const optionCount = questionRow.options.length + (questionRow.allowFreeform ? 1 : 0)
  const optIndex = Math.min(Math.max(questionOptionIndex, 0), Math.max(optionCount - 1, 0))
  const singleSelect = questionRow.multiSelect !== true
  const selectOption = (index: number) => {
    if (index === freeformIndex) {
      setQuestionFreeformEditing(true)
      if (singleSelect) setQuestionSelections((prev) => ({ ...prev, [focusIndex]: [] }))
      return
    }
    const option = questionRow.options[index]
    if (!option) return
    toggleTuiQuestionOption(focusIndex, questionRow.multiSelect === true, option.value ?? option.label)
    if (singleSelect) advance()
  }

  if (key.name === 'up' || key.name === 'k') {
    handled(() => setQuestionOptionIndex((i) => Math.max(0, Math.min(i, optionCount - 1) - 1)))
    return true
  }
  if (key.name === 'down' || key.name === 'j') {
    handled(() => setQuestionOptionIndex((i) => Math.min(optionCount - 1, Math.min(i, optionCount - 1) + 1)))
    return true
  }
  if (sequence === ' ') {
    handled(() => selectOption(optIndex))
    return true
  }
  const digit = Number.parseInt(sequence, 10)
  if (!Number.isNaN(digit) && digit >= 1 && digit <= optionCount) {
    handled(() => {
      setQuestionOptionIndex(digit - 1)
      selectOption(digit - 1)
    })
    return true
  }
  if (key.name === 'return') {
    handled(() => {
      if (freeformIndex >= 0 && optIndex === freeformIndex && !questionFreeformAnswers[focusIndex]?.trim()) {
        setQuestionFreeformEditing(true)
      } else {
        advance()
      }
    })
    return true
  }
  if (key.name === 'escape') {
    handled(() => { void respondToTuiPermission(permission, 'reject') })
    return true
  }
  return true
}
