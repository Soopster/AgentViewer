'use client'

import { use, useState } from 'react'
import { readAsyncQuestions, formatAsyncQuestionAnswers } from '@/lib/asyncQuestions'
import type { ToolUseBlock } from '@/lib/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { QuestionAnswerComposerContext } from './messageItemShared'

/** Async questions are follow-up suggestions, not blocking approval requests. */
export function AsyncQuestionCard({ toolUse }: { toolUse: ToolUseBlock }) {
  const toComposer = use(QuestionAnswerComposerContext)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = readAsyncQuestions(toolUse.input)
  return <div style={{ border: '1px solid var(--border)', padding: 12, display: 'grid', gap: 12 }}>
    <span style={{ color: 'var(--violet)' }}>Follow-up questions</span>
    {questions.map(question => <fieldset key={(question.id ?? question.question)} style={{ display: 'grid', gap: 8 }}>
      <legend>{question.question}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {question.options.map((option, index) => <Button key={`${index}:${option.label}`} type="button" variant="outline"
          aria-pressed={answers[(question.id ?? question.question)] === option.label}
          onClick={() => setAnswers(previous => ({ ...previous, [(question.id ?? question.question)]: option.label }))}>{option.label}</Button>)}
      </div>
      <Input aria-label={`Answer: ${question.question}`} placeholder="Your answer"
        value={answers[(question.id ?? question.question)] ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [(question.id ?? question.question)]: event.target.value }))} />
    </fieldset>)}
    <Button type="button" disabled={!toComposer || !questions.some(question => answers[(question.id ?? question.question)]?.trim())}
      onClick={() => toComposer?.(formatAsyncQuestionAnswers(questions, Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, [answer]]))))}>Use answers in composer</Button>
    <span style={{ color: 'var(--text-3)', fontSize: 12 }}>You can also reply directly in the composer.</span>
  </div>
}
