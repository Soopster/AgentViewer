import type { TuiTranscriptCard } from '../../../../tui/format'

export type TimedCall = { label: string; durationMs: number }
export type TimedTurn = { key: string; title: string; calls: TimedCall[]; totalMs: number; maxMs: number }
type WithNested = TuiTranscriptCard & { agentToolCards?: readonly TuiTranscriptCard[] }

/** Newest turn first; a turn with no timed call is dropped. Calls inside a turn keep their order. */
export function timedTurns(cards: readonly TuiTranscriptCard[]): TimedTurn[] {
  const turns: Array<{ key: string; title: string; calls: TimedCall[] }> = []
  let current = { key: 'earlier', title: 'earlier', calls: [] as TimedCall[] }
  turns.push(current)
  for (const card of cards) {
    if (card.role === 'user') {
      const title = (card.lines.map((line) => line.text).find((text) => text.trim()) ?? 'prompt').replace(/^(prompt|you|user)\s*[:·-]?\s*/i, '').replace(/\s+/g, ' ').trim() || 'prompt'
      current = { key: card.key, title, calls: [] }
      turns.push(current)
      continue
    }
    for (const inner of (card as WithNested).agentToolCards ?? [card]) {
      for (const timing of inner.toolTimings ?? []) current.calls.push({ label: timing.label, durationMs: timing.durationMs })
    }
  }
  return turns
    .filter((turn) => turn.calls.length > 0)
    .map((turn) => ({
      ...turn,
      totalMs: turn.calls.reduce((sum, call) => sum + call.durationMs, 0),
      maxMs: Math.max(...turn.calls.map((call) => call.durationMs)),
    }))
    .reverse()
}

/** A bar of `cells` cells, at least one cell for any call so a short one is still visible. */
export function durationBar(durationMs: number, maxMs: number, cells: number): string {
  if (maxMs <= 0) return ''.padEnd(cells, '░')
  const filled = Math.max(1, Math.min(cells, Math.round((durationMs / maxMs) * cells)))
  return '█'.repeat(filled).padEnd(cells, '░')
}
