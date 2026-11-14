import type { SelectedLineRange } from '@pierre/diffs'

const MAX_CONTEXT_CHARS = 20000

export type DiffCommentComposerInput = {
  filePath: string
  range: SelectedLineRange
  comment: string
  context: string
  source?: string
}

export function formatDiffSelectedRange(range: SelectedLineRange): string {
  const start = `L${range.start}${range.side === 'deletions' ? ' (old)' : ''}`
  const end = `L${range.end}${range.endSide === 'deletions' ? ' (old)' : ''}`
  return range.start === range.end && range.side === range.endSide ? start : `${start} -> ${end}`
}

function trimContext(context: string): string {
  if (context.length <= MAX_CONTEXT_CHARS) return context
  const headLength = Math.floor(MAX_CONTEXT_CHARS * 0.65)
  const tailLength = MAX_CONTEXT_CHARS - headLength
  return [
    context.slice(0, headLength).trimEnd(),
    `\n\n... truncated ${context.length - MAX_CONTEXT_CHARS} chars ...\n\n`,
    context.slice(context.length - tailLength).trimStart(),
  ].join('')
}

export function buildDiffCommentComposerPrompt(input: DiffCommentComposerInput): string {
  const source = input.source ? `\nSource: ${input.source}` : ''
  return [
    'Please follow up on this diff comment.',
    '',
    `File: ${input.filePath || '(unknown file)'}`,
    `Range: ${formatDiffSelectedRange(input.range)}${source}`,
    '',
    'Comment:',
    input.comment.trim(),
    '',
    'Diff context:',
    '```diff',
    trimContext(input.context).trim(),
    '```',
  ].join('\n')
}
