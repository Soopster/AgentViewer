import type { ToolThread } from '../../lib/threading'
import { answerTextFor, parseAskUserAnswers, selectedOptionLabels, type AskUserQuestionSpec } from '../../lib/askUserAnswers'
import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'
import { line, truncateLine, MAX_CARD_LINES } from './text'
import { resultTextOf } from './tools'

type AskUserQuestion = AskUserQuestionSpec

export function formatAskUserQuestionTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] {
  const input = thread.toolUse.input as { questions?: Array<Partial<AskUserQuestion>> }
  // Normalize defensively: a streaming/partial tool call can arrive before
  // `options` (or `question`) exists, and downstream code assumes `q.options`
  // is always an array (q.options.slice would otherwise throw).
  const questions: AskUserQuestion[] = (Array.isArray(input.questions) ? input.questions : [])
    .filter((q): q is Partial<AskUserQuestion> => !!q && typeof q === 'object')
    .map((q) => ({
      question: typeof q.question === 'string' ? q.question : '',
      header: typeof q.header === 'string' ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options) ? q.options : [],
    }))
  const raw = resultTextOf(thread)
  const isError = thread.result?.is_error === true
  const parsed = parseAskUserAnswers(raw)
  // A completed, non-error result means the questions were answered — the answer
  // may be a JSON map OR a plain confirmation string, so don't require the map.
  const answered = !!thread.result && !isError

  const stateTone: TuiTranscriptLineTone = isError
    ? 'result_error'
    : answered
      ? 'result_ok'
      : thread.result
        ? 'dim'
        : 'thinking'
  const stateGlyph = isError ? '✗' : answered ? '✓' : thread.result ? '○' : '◌'
  const stateLabel = thread.toolUse.input.asyncUserInput === true ? 'click to answer · or reply in composer' : isError ? 'error' : answered ? 'answered' : thread.result ? 'no answer' : 'pending'

  const headerSummary = questions.length === 0
    ? 'no questions'
    : questions.length === 1
      ? truncateLine(questions[0].question)
      : `${questions.length} questions`

  const lines: TuiTranscriptCardLine[] = [
    line(`ask user: ${headerSummary}`, 'tool'),
    line(`${stateGlyph} ${stateLabel}`, stateTone),
  ]

  // Compact mode: show at most one line per question if there are multiple,
  // or all options collapsed for a single question.
  if (!expanded) {
    if (questions.length === 1) {
      const q = questions[0]
      const selected = selectedOptionLabels(q, parsed.answers, raw)
      const maxOptions = Math.max(MAX_CARD_LINES, 4)
      const visible = q.options.slice(0, maxOptions)
      for (const opt of visible) {
        const hit = selected.has(opt.label)
        const marker = hit
          ? (q.multiSelect ? '☑' : '●')
          : (q.multiSelect ? '☐' : '○')
        const tone: TuiTranscriptLineTone = hit ? 'result_ok' : 'muted'
        lines.push(line(`  ${marker} ${truncateLine(opt.label)}`, tone))
      }
      if (q.options.length > visible.length) {
        lines.push(line(`  … +${q.options.length - visible.length} more`, 'dim'))
      }
    } else {
      for (const q of questions.slice(0, 3)) {
        const selected = selectedOptionLabels(q, parsed.answers, raw)
        const answer = selected.size > 0
          ? [...selected].join(', ')
          : (answerTextFor(q, parsed.answers) || (answered ? '—' : 'pending'))
        const headerChip = q.header ? `[${q.header}] ` : ''
        const tone: TuiTranscriptLineTone = selected.size > 0 ? 'result_ok' : 'muted'
        lines.push(line(`  ${headerChip}${truncateLine(q.question)} → ${truncateLine(answer)}`, tone))
      }
      if (questions.length > 3) {
        lines.push(line(`  … +${questions.length - 3} more questions`, 'dim'))
      }
    }
    return lines
  }

  // Expanded mode: full questions, options, descriptions, selection markers,
  // and any user-supplied notes/preview content.
  for (const [qi, q] of questions.entries()) {
    if (qi > 0) lines.push(line('', 'dim'))
    const headerChip = q.header ? `[${q.header.toUpperCase()}] ` : ''
    const mode = q.multiSelect ? ' (multi-select)' : ''
    lines.push(line(`${headerChip}${truncateLine(q.question)}${mode}`, 'system'))

    const selected = selectedOptionLabels(q, parsed.answers, raw)
    for (const opt of q.options) {
      const hit = selected.has(opt.label)
      const marker = hit
        ? (q.multiSelect ? '☑' : '●')
        : (q.multiSelect ? '☐' : '○')
      const tone: TuiTranscriptLineTone = hit ? 'result_ok' : 'muted'
      lines.push(line(`  ${marker} ${truncateLine(opt.label)}${opt.preview ? '  ⤓' : ''}`, tone))
      if (opt.description) {
        lines.push(line(`      ${truncateLine(opt.description)}`, 'dim'))
      }
    }

    // A typed "Other" answer matches no option; show it rather than leaving
    // every box empty under an "answered" header.
    const custom = selected.size === 0 ? answerTextFor(q, parsed.answers) : ''
    if (custom) lines.push(line(`  → ${truncateLine(custom)}`, 'result_ok'))

    const note = parsed.annotations?.[q.question]?.notes?.trim()
    if (note) {
      for (const ln of note.split('\n')) {
        lines.push(line(`  ✎ ${truncateLine(ln)}`, 'agent'))
      }
    }
  }

  return lines
}
