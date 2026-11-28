import type { PiToolContribution } from '../../lib/plugins/piTools'
import { Type } from 'typebox'
import type { PendingQuestion } from '../../lib/permissions'

const parameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  questions: Type.Array(Type.Object({
    question: Type.String({ minLength: 1, maxLength: 500 }),
    kind: Type.Union([Type.Literal('single'), Type.Literal('multiple'), Type.Literal('text')]),
    required: Type.Optional(Type.Boolean()),
    options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 2, maxItems: 12, uniqueItems: true })),
  }), { minItems: 1, maxItems: 8 }),
})

export const interviewTool: PiToolContribution<typeof parameters> = {
  name: 'agent_viewer_interview',
  label: 'Interview',
  description: 'Ask the user several questions together and wait for a single submission. Use text, single-choice, or multiple-choice questions.',
  parameters,
  async run(params, ask) {
    const questions: PendingQuestion[] = params.questions.map((question, index) => {
      if (question.kind !== 'text' && (!question.options || question.options.length < 2)) throw new Error('Choice questions need at least two options.')
      return {
        id: `q${index + 1}`,
        question: question.question,
        required: question.required !== false,
        multiSelect: question.kind === 'multiple',
        allowFreeform: question.kind === 'text',
        options: (question.kind === 'text' ? [] : question.options ?? []).map(label => ({ label })),
      }
    })
    const answers = await ask(params.title, questions)
    return answers === undefined ? 'Interview ended without a submission.' : JSON.stringify(answers)
  },
}
