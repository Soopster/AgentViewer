import type { TuiTranscriptCard, TuiTranscriptCardLine } from '../../format'

export const TOOL_OUTPUT_PREVIEW_LINES = 6

/** Limit output only, retaining the command heading and any failure indicator. */
export function toolOutputPreview(card: TuiTranscriptCard, bodyLines: TuiTranscriptCardLine[]) {
  if (card.category !== 'technical' || card.thinkingTranscript || card.asyncQuestions?.length
    || (card as TuiTranscriptCard & { agentToolCards?: unknown[] }).agentToolCards?.length) return null
  const lines = bodyLines.flatMap(line => line.text.split('\n').map(text => ({ ...line, text })))
  const limit = TOOL_OUTPUT_PREVIEW_LINES + (lines[0]?.tone === 'tool' ? 1 : 0)
  if (lines.length <= limit) return null
  const preview = lines.slice(0, limit)
  const failure = lines.slice(limit).find(line => line.tone === 'result_error')
  if (failure) preview[preview.length - 1] = failure
  return { lines: preview, hidden: lines.length - preview.length }
}
