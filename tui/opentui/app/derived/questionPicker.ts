/** @jsxImportSource @opentui/react */
import { type PendingPermission, type PendingQuestion, type PendingQuestionOption } from '../../../../lib/permissions'
import { isCodexQuestionnaire } from '../../../../lib/questionnaire'
import { QUESTION_PICKER_MIN_TRANSCRIPT_ROWS, QUESTION_PICKER_MIN_ROWS, QUESTION_PREVIEW_MIN_ROWS } from '../pickers'

export type QuestionPickerPlan = {
  questions: PendingQuestion[]
  /** Active tab for a Codex questionnaire (may equal `questions.length` for Submit). */
  focusIndex: number
  collapsed: boolean
  optionStart: number
  optionCount: number
  previewLines: string[]
  rows: number
  /** Codex questionnaire: one tab per question plus Submit. */
  tabbed: boolean
}

export type QuestionPickerPlanContext = {
  pendingPermissions: PendingPermission[]
  questionFocusIndex: number
  questionOptionIndex: number
  questionPreviewLines: (option: PendingQuestionOption | undefined) => string[]
  height: number
  workspacesEnabled: boolean
  searchMode: boolean
  sessionSearchMode: boolean
  embeddedComposer: boolean
  composerDockHeight: number
  composerPopoverHeight: number
}

export function runQuestionPickerPlan(ctx: QuestionPickerPlanContext): QuestionPickerPlan | null {
  const {
    pendingPermissions, questionFocusIndex, questionOptionIndex, questionPreviewLines, height,
    workspacesEnabled, searchMode, sessionSearchMode, embeddedComposer, composerDockHeight,
    composerPopoverHeight,
  } = ctx
  const permission = pendingPermissions[0]
  const questions = permission?.questions ?? []
  if (questions.length === 0) return null
  // Budget derived from the SAME expression mainContentHeight uses, so it is
  // automatically correct per transcript view (Chat and Agents dock the
  // composer inside the reader box; the other views do not). mainContentHeight floors at
  // QUESTION_PICKER_MIN_TRANSCRIPT_ROWS, and anything the picker reserves
  // beyond that floor is rows the screen does not have — which is exactly
  // when yoga starts compositing the card's rows onto each other.
  const budget = Math.max(
    height
    - (workspacesEnabled ? 3 : 2)
    - (searchMode || sessionSearchMode ? 4 : 1)
    - (embeddedComposer ? 0 : composerDockHeight)
    - composerPopoverHeight
    - QUESTION_PICKER_MIN_TRANSCRIPT_ROWS,
    QUESTION_PICKER_MIN_ROWS,
  )
  if (isCodexQuestionnaire(permission)) {
    return runCodexQuestionnairePlan({
      questions, questionFocusIndex, questionOptionIndex, questionPreviewLines, budget,
    })
  }
  const focusIndex = Math.min(Math.max(questionFocusIndex, 0), questions.length - 1)
  const optionRowsFor = (index: number) => {
    const question = questions[index]!
    return question.options.length + (question.allowFreeform ? 1 : 0)
  }
  // border(2) + outer padding(1) + title(1) + hint(1), plus the blank
  // marginTop row each question after the first carries.
  const chrome = 5 + (questions.length - 1)
  const questionRows = questions.length + questions.filter((question) => question.externalUrl).length
  const optionRowTotal = questions.reduce((total, _, index) => total + optionRowsFor(index), 0)
  // The preview belongs to the option the cursor is on, in the focused
  // question. The freeform "Other" row has no preview, and neither does an
  // option that did not carry one — both yield zero rows.
  const focusedQuestion = questions[focusIndex]!
  const previewCursor = Math.min(Math.max(questionOptionIndex, 0), Math.max(optionRowsFor(focusIndex) - 1, 0))
  const previewLines = questionPreviewLines(focusedQuestion.options[previewCursor])
  // One label row above the content.
  const previewRows = previewLines.length > 0 ? previewLines.length + 1 : 0
  const fullRows = chrome + questionRows + optionRowTotal + previewRows
  if (fullRows <= budget) {
    return { questions, focusIndex, collapsed: false, optionStart: 0, optionCount: optionRowsFor(focusIndex), previewLines, rows: fullRows, tabbed: false }
  }
  // Everything fits EXCEPT the preview: drop the preview rather than collapse
  // the questions. An option list you can act on is worth more than an
  // illustration of one of its entries.
  const withoutPreview = fullRows - previewRows
  if (previewRows > 0 && withoutPreview <= budget) {
    return { questions, focusIndex, collapsed: false, optionStart: 0, optionCount: optionRowsFor(focusIndex), previewLines: [], rows: withoutPreview, tabbed: false }
  }
  // Collapsed: every question keeps its own row, only the focused one shows
  // options, so ←/→ still reaches all of them.
  const collapsedChrome = chrome + questionRows
  const optionCount = Math.max(Math.min(optionRowsFor(focusIndex), budget - collapsedChrome), 1)
  const cursor = Math.min(Math.max(questionOptionIndex, 0), Math.max(optionRowsFor(focusIndex) - 1, 0))
  // Window around the cursor so the option the keys act on is always drawn.
  const optionStart = Math.min(
    Math.max(cursor - Math.floor(optionCount / 2), 0),
    Math.max(optionRowsFor(focusIndex) - optionCount, 0),
  )
  const collapsedRows = collapsedChrome + optionCount
  // Once collapsed the card is already short of room, so a preview only
  // appears if the leftover budget genuinely holds one — and it is trimmed to
  // what is left rather than pushing options off the bottom.
  const previewBudget = budget - collapsedRows - 1
  const collapsedPreview = previewLines.length > 0 && previewBudget + 1 >= QUESTION_PREVIEW_MIN_ROWS
    ? previewLines.slice(0, Math.max(previewBudget, 0))
    : []
  return {
    questions,
    focusIndex,
    collapsed: true,
    optionStart,
    optionCount,
    previewLines: collapsedPreview,
    rows: collapsedRows + (collapsedPreview.length > 0 ? collapsedPreview.length + 1 : 0),
    tabbed: false,
  }
}

/**
 * Codex CLI parity: the tab bar sits above one active question (or the Submit
 * summary), so the card stays short no matter how many questions there are.
 * Rows above the active question: border(2) + outer padding(1) + title(1) +
 * hint(1) + tab bar(1).
 */
function runCodexQuestionnairePlan({
  questions, questionFocusIndex, questionOptionIndex, questionPreviewLines, budget,
}: {
  questions: PendingQuestion[]
  questionFocusIndex: number
  questionOptionIndex: number
  questionPreviewLines: (option: PendingQuestionOption | undefined) => string[]
  budget: number
}): QuestionPickerPlan {
  const focusIndex = Math.min(Math.max(questionFocusIndex, 0), questions.length)
  const submitTab = focusIndex === questions.length
  const chrome = 6
  if (submitTab) {
    // The summary is one row per question, so it obeys the same budget as an
    // option list: draw what fits and mark the rest instead of asking for rows
    // the screen does not have.
    const summaryRows = Math.max(Math.min(questions.length, budget - chrome), 1)
    return {
      questions, focusIndex, collapsed: false, optionStart: 0, optionCount: summaryRows,
      previewLines: [], rows: chrome + summaryRows, tabbed: true,
    }
  }
  const question = questions[focusIndex]!
  const optionRows = question.options.length + (question.allowFreeform ? 1 : 0)
  const cursor = Math.min(Math.max(questionOptionIndex, 0), Math.max(optionRows - 1, 0))
  const previewLines = questionPreviewLines(question.options[cursor])
  const previewRows = previewLines.length > 0 ? previewLines.length + 1 : 0
  const questionRows = 1 + (question.externalUrl ? 1 : 0)
  const fullRows = chrome + questionRows + optionRows + previewRows
  const base = { questions, focusIndex, tabbed: true as const }
  if (fullRows <= budget) {
    return { ...base, collapsed: false, optionStart: 0, optionCount: optionRows, previewLines, rows: fullRows }
  }
  const withoutPreview = fullRows - previewRows
  if (previewRows > 0 && withoutPreview <= budget) {
    return { ...base, collapsed: false, optionStart: 0, optionCount: optionRows, previewLines: [], rows: withoutPreview }
  }
  const optionCount = Math.max(Math.min(optionRows, budget - chrome - questionRows), 1)
  const optionStart = Math.min(
    Math.max(cursor - Math.floor(optionCount / 2), 0),
    Math.max(optionRows - optionCount, 0),
  )
  const collapsedRows = chrome + questionRows + optionCount
  const previewBudget = budget - collapsedRows - 1
  const collapsedPreview = previewLines.length > 0 && previewBudget + 1 >= QUESTION_PREVIEW_MIN_ROWS
    ? previewLines.slice(0, Math.max(previewBudget, 0))
    : []
  return {
    ...base,
    collapsed: true,
    optionStart,
    optionCount,
    previewLines: collapsedPreview,
    rows: collapsedRows + (collapsedPreview.length > 0 ? collapsedPreview.length + 1 : 0),
  }
}
