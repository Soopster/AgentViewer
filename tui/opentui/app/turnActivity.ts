import type { TuiTranscriptCard } from '../../format'
import { agentToolCardsFor } from './transcriptRows'
import { turnSummaryText } from './transcriptStyle'

export function foldTurnActivity(cards: TuiTranscriptCard[], folded: ReadonlySet<string>, running: boolean): TuiTranscriptCard[] {
  if (!folded.size) return cards
  const result: TuiTranscriptCard[] = []
  for (let index = 0; index < cards.length;) {
    const prompt = cards[index]
    if (prompt.role !== 'user' || !folded.has(prompt.key)) { result.push(prompt); index++; continue }
    let end = index + 1
    while (end < cards.length && cards[end].role !== 'user') end++
    if (running && end === cards.length) { result.push(...cards.slice(index)); break }
    const removable = (card: TuiTranscriptCard): boolean => {
      const children = agentToolCardsFor(card)
      return (card.category === 'technical' || Boolean(card.thinkingTranscript))
        && !card.asyncQuestions?.length
        && ![card, ...children].some(item => item.asyncQuestions?.length || item.lines.some(line => line.tone === 'result_error'))
    }
    const turn = cards.slice(index + 1, end)
    const hidden = turn.filter(removable)
    result.push(prompt)
    if (hidden.length) {
      const last = turn.at(-1)?.timestampMs
      const elapsed = last != null && prompt.timestampMs != null ? last - prompt.timestampMs : null
      const text = `${turnSummaryText(cards, index, end, elapsed) ?? `${hidden.length} activity entries`} · e on prompt to expand`
      result.push({ provider: prompt.provider, key: `activity-summary:${prompt.key}`, role: 'assistant', label: 'Activity', category: 'conversation', autoFold: false, lines: [{ text, tone: 'system' }], expandedLines: [{ text, tone: 'system' }], compactSummary: text, searchText: text, searchHaystackLower: text.toLowerCase(), markdownContent: undefined, codeBlocks: undefined })
    }
    result.push(...turn.filter(card => !removable(card)))
    index = end
  }
  return result
}
