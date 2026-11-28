import type { PendingQuestion, PendingQuestionAnswers } from './permissions'

export function readAsyncQuestions(input: Record<string, unknown>): PendingQuestion[] {
  if (input.asyncUserInput !== true || !Array.isArray(input.questions)) return []
  return input.questions.flatMap((value): PendingQuestion[] => {
    if (!value || typeof value !== 'object' || typeof value.question !== 'string' || typeof value.id !== 'string') return []
    return [{ id: value.id, question: value.question, allowFreeform: true,
      options: Array.isArray(value.options) ? value.options.filter((option: unknown): option is { label: string } =>
        !!option && typeof option === 'object' && 'label' in option && typeof option.label === 'string') : [] }]
  })
}

export function formatAsyncQuestionAnswers(questions: PendingQuestion[], answers: PendingQuestionAnswers): string {
  return questions.flatMap(question => {
    const values = answers[question.id ?? question.question]?.filter(value => value.trim())
    return values?.length ? [`${question.question}\n${values.join(', ')}`] : []
  }).join('\n\n')
}
