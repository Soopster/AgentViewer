import type { PendingPermission, PendingQuestion, PendingQuestionAnswers } from './permissions'

/**
 * Codex's blocking `item/tool/requestUserInput` request is a questionnaire, not
 * an approval. It gets the Codex CLI's tabbed treatment (one tab per question
 * plus Submit) rather than the stacked picker used elsewhere.
 */
export function isCodexQuestionnaire(permission: PendingPermission | null | undefined): boolean {
  return !!permission
    && permission.provider === 'codex'
    && permission.toolName === 'item/tool/requestUserInput'
    && permission.asyncQuestion !== true
    && (permission.questions?.length ?? 0) > 0
}

/** Highest valid picker focus index: the Submit tab is one past the questions. */
export function questionTabCount(permission: PendingPermission | null | undefined): number {
  const count = permission?.questions?.length ?? 0
  if (count === 0) return 0
  return isCodexQuestionnaire(permission) ? count + 1 : count
}

export function clampQuestionTab(permission: PendingPermission | null | undefined, index: number): number {
  const count = questionTabCount(permission)
  return count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1)
}

/** The answer values a question contributes, matching the web and TUI pickers. */
export function questionAnswerValues(
  question: PendingQuestion,
  selected: string[] | undefined,
  freeform: string | undefined,
): string[] {
  const trimmed = freeform?.trim()
  if (question.multiSelect) return trimmed ? [...(selected ?? []), trimmed] : [...(selected ?? [])]
  if (trimmed) return [trimmed]
  return [...(selected ?? [])]
}

export function questionIsAnswered(
  question: PendingQuestion,
  selected: string[] | undefined,
  freeform: string | undefined,
): boolean {
  return questionAnswerValues(question, selected, freeform).length > 0
}

/**
 * Build the `respondQuestion` payload for a questionnaire. Returns the first
 * required question left unanswered so a surface can move focus there instead
 * of submitting a partial answer.
 */
export function collectQuestionAnswers(
  questions: PendingQuestion[],
  selections: Record<number, string[]>,
  freeformAnswers: Record<number, string>,
): { answers: PendingQuestionAnswers; missingIndex: number | null } {
  const answers: PendingQuestionAnswers = {}
  let missingIndex: number | null = null
  questions.forEach((question, index) => {
    const values = questionAnswerValues(question, selections[index], freeformAnswers[index])
    if (values.length === 0) {
      if (question.required !== false && missingIndex === null) missingIndex = index
      return
    }
    answers[question.id ?? question.question] = values
  })
  return { answers, missingIndex }
}
