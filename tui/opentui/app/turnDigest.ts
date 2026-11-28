import type { TuiTranscriptCard } from '../../format'
import { formatFileEditSummary, mergeFileEditStats, type FileEditStat } from '../../../lib/turnEditStats'
import { formatElapsedClock } from './format'
import type { AgentToolGroupCard } from './types'

export type TurnDigest = {
  elapsedMs: number | null
  calls: number
  failures: number
  /** The first card of the turn holding a failed call: where "2 failed" jumps to. */
  firstFailureKey: string | null
  edits: FileEditStat[]
}

/** What the turn opened by `cards[promptIndex]` did, up to but not including `endIndex`. */
export function turnDigest(cards: readonly TuiTranscriptCard[], promptIndex: number, endIndex: number, elapsedMs: number | null): TurnDigest {
  const turn = cards.slice(promptIndex + 1, endIndex)
  let calls = 0
  let failures = 0
  let firstFailureKey: string | null = null
  for (const card of turn) {
    for (const call of (card as AgentToolGroupCard).agentToolCards ?? [card]) {
      if (call.category === 'technical') calls++
      if (!call.lines.some(line => line.tone === 'result_error')) continue
      failures++
      // The card on screen, which for a grouped call is its group.
      firstFailureKey ??= card.key
    }
  }
  return { elapsedMs, calls, failures, firstFailureKey, edits: mergeFileEditStats(turn.map(card => card.fileEdits)) }
}

export function turnDigestText(digest: TurnDigest): string | null {
  const parts = [
    digest.elapsedMs != null && digest.elapsedMs >= 1000 ? `Worked for ${formatElapsedClock(digest.elapsedMs)}` : null,
    digest.calls ? `${digest.calls} tool calls` : null,
    digest.failures ? `${digest.failures} failed` : null,
    formatFileEditSummary(digest.edits),
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
