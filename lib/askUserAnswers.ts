import { isQuestionUnansweredOutcome, type QuestionAnnotation } from './claudeQuestionOutcomes'
import type { ToolResultBlock } from './types'
export type AskUserOption = { label: string; description?: string; preview?: string }
export type AskUserQuestionSpec = { question: string; header?: string; multiSelect?: boolean; options: AskUserOption[] }
export type AskUserAnnotation = QuestionAnnotation
export type AskUserAnswers = { answers?: Record<string, string>; annotations?: Record<string, AskUserAnnotation>; response?: string }

export function questionOutcomeLabel(question: Pick<AskUserQuestionSpec, 'question'>, result: AskUserAnswers): string | null {
  const outcome = result.annotations?.[question.question]?.unanswered
  return !isQuestionUnansweredOutcome(outcome) ? null : outcome === 'replied_in_chat' ? 'replied in chat' : outcome
}

export function questionOutcomeSummary(questions: Pick<AskUserQuestionSpec, 'question'>[], result: AskUserAnswers): string | null {
  const outcomes = questions.map(question => questionOutcomeLabel(question, result))
  if (!outcomes.some(Boolean)) return null
  return outcomes.every(outcome => outcome === outcomes[0]) ? outcomes[0]! : 'completed with unanswered questions'
}

/** AskUserQuestion's SDK sidecar carries UI-only annotations absent from model text. */
export function attachAskUserResultSidecar(results: ToolResultBlock[], raw: unknown): ToolResultBlock[] {
  if (results.length !== 1 || !raw || typeof raw !== 'object' || Array.isArray(raw)) return results
  const value = raw as Record<string, unknown>
  if (!Array.isArray(value.questions) || !value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) return results
  const answers = Object.fromEntries(Object.entries(value.answers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  const annotations: Record<string, AskUserAnnotation> = Object.create(null)
  if (value.annotations && typeof value.annotations === 'object' && !Array.isArray(value.annotations)) {
    for (const [question, rawAnnotation] of Object.entries(value.annotations)) {
      if (!rawAnnotation || typeof rawAnnotation !== 'object') continue
      const entry = rawAnnotation as Record<string, unknown>
      annotations[question] = {
        ...(typeof entry.preview === 'string' ? { preview: entry.preview } : {}),
        ...(typeof entry.notes === 'string' ? { notes: entry.notes } : {}),
        ...(isQuestionUnansweredOutcome(entry.unanswered) ? { unanswered: entry.unanswered } : {}),
      }
    }
  }
  return [{ ...results[0]!, questionResult: { answers, annotations, ...(typeof value.response === 'string' ? { response: value.response } : {}) } }]
}

/** `"<question>"="<answer>"` pairs, comma-separated, as the tool's plain
 * confirmation string reports them. Backslash escapes are honoured so a quote
 * inside a question doesn't end the match early. */
const CONFIRMATION_PAIR = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g

function unescapeConfirmation(value: string): string {
  return value.replace(/\\(["\\])/g, '$1')
}

/** The result arrives either as a JSON answers map or as the plain
 * confirmation string. Both reduce to the same question → answer map, so
 * callers never have to sniff the raw text for option labels. */
export function parseAskUserAnswers(raw: string | null | undefined, sidecar?: AskUserAnswers): AskUserAnswers {
  if (sidecar) return sidecar
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as AskUserAnswers
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch { /* not JSON — fall through to the confirmation string */ }

  const answers: Record<string, string> = {}
  for (const match of raw.matchAll(CONFIRMATION_PAIR)) {
    answers[unescapeConfirmation(match[1])] = unescapeConfirmation(match[2])
  }
  return Object.keys(answers).length > 0 ? { answers } : {}
}

/** The answer a question was actually given, whatever form the result took. */
export function answerTextFor(question: Pick<AskUserQuestionSpec, 'question'>, answers: AskUserAnswers['answers']): string {
  const answer = answers?.[question.question]
  return typeof answer === 'string' ? answer.trim() : ''
}

function labelsFromAnswer(answer: string, labels: string[]): Set<string> {
  // A single-select answer is the label verbatim, so check it whole first —
  // splitting on commas would shred a label that contains one.
  if (labels.includes(answer)) return new Set([answer])
  const parts = answer.split(',').map((part) => part.trim()).filter(Boolean)
  return new Set(parts.filter((part) => labels.includes(part)))
}

/** Which of a question's options the user picked.
 *
 * Multi-select answers are one comma-separated string per question, so a
 * substring scan of the whole result never matches: `"Second option"` with its
 * quotes appears only when it is the entire answer, and every label after the
 * first is preceded by a comma rather than the `=`. Resolving the question's
 * own answer first is what makes a multi-select selection render at all, and it
 * also stops one question's answer from checking another's identically-named
 * option. `rawResult` stays as a last-resort scan for results in neither
 * documented shape.
 */
export function selectedOptionLabels(
  question: AskUserQuestionSpec,
  answers: AskUserAnswers['answers'],
  rawResult?: string | null,
): Set<string> {
  const labels = (Array.isArray(question.options) ? question.options : []).map((option) => option.label)
  const answer = answerTextFor(question, answers)
  if (answer) {
    const matched = labelsFromAnswer(answer, labels)
    // An empty set here is meaningful: the user typed a custom "Other" answer,
    // which matches no option. Don't fall through and guess from the raw text.
    return matched
  }
  if (rawResult) {
    const hits = labels.filter((label) => rawResult.includes(`"${label}"`) || rawResult.includes(`=${label}`))
    if (hits.length > 0) return new Set(hits)
  }
  return new Set()
}
