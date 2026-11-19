export type QuestionUnansweredOutcome = 'skipped' | 'replied_in_chat' | 'dismissed'
export type QuestionResponseOptions = { unanswered?: QuestionUnansweredOutcome; response?: string }
export type QuestionAnnotation = { preview?: string; notes?: string; unanswered?: QuestionUnansweredOutcome }
/** The terminal picker's chat-reply mode shares its existing text buffer. */
export const QUESTION_CHAT_REPLY_INDEX = -1

export function isQuestionUnansweredOutcome(value: unknown): value is QuestionUnansweredOutcome {
  return value === 'skipped' || value === 'replied_in_chat' || value === 'dismissed'
}

/** Undefined means this frame says nothing about the query's capabilities. */
export function claudeQuestionOutcomeCapability(message: unknown): boolean | undefined {
  if (!message || typeof message !== 'object') return undefined
  const frame = message as Record<string, unknown>
  if (frame.type !== 'system' || frame.subtype !== 'init') return undefined
  return Array.isArray(frame.capabilities) && frame.capabilities.includes('ask_user_question_unanswered_v1')
}

/** Never forward unadvertised or future enum values to strict older CLIs. */
export function claudeQuestionAnnotations(input: Record<string, unknown> | undefined, answers: Record<string, string>, annotations: unknown, options: QuestionResponseOptions, supported: boolean): Record<string, QuestionAnnotation> | undefined {
  const result: Record<string, QuestionAnnotation> = Object.create(null)
  const answered = (question: string) => Object.hasOwn(answers, question) && typeof answers[question] === 'string' && answers[question]!.trim()
  if (annotations && typeof annotations === 'object' && !Array.isArray(annotations)) {
    for (const [question, raw] of Object.entries(annotations)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const value = raw as Record<string, unknown>
      const annotation: QuestionAnnotation = {}
      if (typeof value.preview === 'string') annotation.preview = value.preview
      if (typeof value.notes === 'string') annotation.notes = value.notes
      if (supported && isQuestionUnansweredOutcome(value.unanswered) && !answered(question)) annotation.unanswered = value.unanswered
      if (Object.keys(annotation).length) result[question] = annotation
    }
  }
  if (supported && isQuestionUnansweredOutcome(options.unanswered) && Array.isArray(input?.questions)) {
    for (const raw of input.questions) {
      if (!raw || typeof raw !== 'object') continue
      const question = (raw as Record<string, unknown>).question
      if (typeof question === 'string' && !answered(question)) {
        result[question] = { ...result[question], unanswered: options.unanswered }
      }
    }
  }
  return Object.keys(result).length ? Object.fromEntries(Object.entries(result)) : undefined
}
