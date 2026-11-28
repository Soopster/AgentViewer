import type { TuiTranscriptCard, TuiTranscriptCardLine } from '../../format'
import { subagentName } from '../../../lib/subagentActivity'

type Merged = { sources: readonly TuiTranscriptCard[]; card: TuiTranscriptCard }
const mergedByFirst = new WeakMap<TuiTranscriptCard, Merged>()

function mergeRun(run: readonly TuiTranscriptCard[]): TuiTranscriptCard {
  const first = run[0]!
  const cached = mergedByFirst.get(first)
  // Cards are memoized by identity, so an unchanged run must stay the same object.
  if (cached && cached.sources.length === run.length && cached.sources.every((card, index) => card === run[index])) return cached.card
  // One row per agent, saying the last thing that happened to it.
  const latest = new Map<string, TuiTranscriptCardLine>()
  for (const card of run) for (const line of card.expandedLines) latest.set(line.subagent?.threadId ?? line.text, line)
  const lines = [...latest.values()]
  const searchText = lines.map(line => line.text).join('\n')
  const card: TuiTranscriptCard = {
    ...first, lines, expandedLines: lines,
    subagents: run.flatMap(item => item.subagents ?? []),
    compactSummary: lines.map(line => line.text).join(' · '),
    searchText, searchHaystackLower: searchText.toLowerCase(),
  }
  mergedByFirst.set(first, { sources: run, card })
  return card
}

/** Consecutive sub-agent records read as one block. Returns `cards` itself when there is nothing to merge. */
export function mergeSubagentCards(cards: TuiTranscriptCard[]): TuiTranscriptCard[] {
  if (!cards.some((card, index) => card.subagents && cards[index + 1]?.subagents)) return cards
  const result: TuiTranscriptCard[] = []
  for (let index = 0; index < cards.length;) {
    let end = index + 1
    if (cards[index]!.subagents) while (cards[end]?.subagents) end++
    result.push(end - index > 1 ? mergeRun(cards.slice(index, end)) : cards[index]!)
    index = end
  }
  return result
}

export type SubagentStripEntry = {
  id: string
  name: string
  /** `unknown` when the records name the agent without saying how it stands. */
  state: 'running' | 'completed' | 'failed' | 'unknown'
  durationMs: number | null
  /** Only an agent with a transcript of its own can be opened. */
  threadId: string | null
}

/** The sub-agents of the latest turn, read off the cards already loaded. */
export function latestTurnSubagents(cards: readonly TuiTranscriptCard[], running: boolean): SubagentStripEntry[] {
  let start = cards.length - 1
  while (start >= 0 && cards[start]!.role !== 'user') start--
  const entries = new Map<string, SubagentStripEntry & { startedAt: number | null }>()
  for (const card of cards.slice(start + 1)) {
    for (const activity of card.subagents ?? []) {
      const previous = entries.get(activity.threadId)
      const startedAt = previous?.startedAt ?? card.timestampMs ?? null
      const state = activity.kind === 'completed' ? 'completed' : activity.kind === 'interrupted' ? 'failed' : running ? 'running' : 'unknown'
      entries.set(activity.threadId, {
        id: activity.threadId, threadId: activity.threadId, name: subagentName(activity.path), state, startedAt,
        durationMs: state === 'completed' && startedAt != null && card.timestampMs != null ? card.timestampMs - startedAt : null,
      })
    }
    const header = card.lines[0]
    if (header?.tone !== 'tool' || !header.text.startsWith('agent ') || !card.toolNames?.some(name => name === 'Agent' || name === 'Task')) continue
    const failed = card.lines.some(line => line.tone === 'result_error')
    const done = card.lines.some(line => line.tone === 'result_ok')
    entries.set(card.key, {
      id: card.key, threadId: null, startedAt: null, durationMs: null,
      name: header.text.slice('agent '.length).replace(/ \[[^\]]*\]$/, ''),
      state: failed ? 'failed' : done ? 'completed' : running ? 'running' : 'unknown',
    })
  }
  return [...entries.values()].map(({ startedAt: _startedAt, ...entry }) => entry)
}
