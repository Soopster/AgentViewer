import type { TuiTranscriptCard } from '../../format'
import type { AgentToolGroupCard } from './types'

// What `<`/`>` (errors) and `#`/`$` (edits) stop on. A tool group is judged by
// the tools inside it, since the group card itself carries neither.
function cardsWithin(card: TuiTranscriptCard): readonly TuiTranscriptCard[] {
  return (card as AgentToolGroupCard).agentToolCards ?? [card]
}

export const cardHasError = (card: TuiTranscriptCard): boolean =>
  cardsWithin(card).some((inner) => inner.lines.some((line) => line.tone === 'result_error'))

export const cardHasEdit = (card: TuiTranscriptCard): boolean =>
  cardsWithin(card).some((inner) => (inner.fileEdits?.length ?? 0) > 0)
