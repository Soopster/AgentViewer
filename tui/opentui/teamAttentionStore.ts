// Which conversations' teams need the user, for the session list — herdr's
// state rollup, where the sidebar alone says which project needs a decision.
// The Teammates badge only knew about conversations the TUI had observed, so a
// team waiting in another chat was invisible until that chat was selected.
//
// Outside the root, like coordinatorStore: the poll re-reads every few seconds
// and commits only when a mark actually changes, so the root (which paints the
// session rows) re-renders on a change, never on a poll.
import { teamAttentionMark } from '../../lib/coordinatorAttention'
import { readCoordinatorReviewed } from '../../lib/tui/coordinatorReviewed'
import { coordinatorRequestScope } from '../../lib/tui/coordinatorRequests'
import { readTuiInteractiveAttention } from '../../lib/tui/service'

export type TeamAttentionMark = { waiting: number; finished: number }
export type TeamAttention = ReadonlyMap<string, TeamAttentionMark>

const POLL_MS = 5_000
const EMPTY: TeamAttention = new Map()
let marks: TeamAttention = EMPTY
let signature = ''
const listeners = new Set<() => void>()

export function getTeamAttention(): TeamAttention {
  return marks
}

export function subscribeTeamAttention(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** One read: summaries minus this client's reviewed markers, keyed like the TUI's sessionKey. */
export async function refreshTeamAttention(): Promise<void> {
  const summaries = await readTuiInteractiveAttention().catch(() => null)
  // A failed read keeps the last marks rather than clearing them: "no marks"
  // would claim nobody needs the user when the list does not know.
  if (!summaries) return
  const next = new Map<string, TeamAttentionMark>()
  for (const summary of summaries) {
    const reviewed = summary.resultIds?.length ? readCoordinatorReviewed(coordinatorRequestScope(summary.provider, summary.sessionId)) : []
    const mark = teamAttentionMark(summary, reviewed)
    if (mark) next.set(`${summary.provider}:${summary.sessionId}`, mark)
  }
  const nextSignature = [...next].map(([key, mark]) => `${key}=${mark.waiting}/${mark.finished}`).sort().join('|')
  if (nextSignature === signature) return
  signature = nextSignature
  marks = next
  for (const listener of listeners) listener()
}

/** Start polling; returns the stop. The root owns the only feed. */
export function startTeamAttentionFeed(): () => void {
  void refreshTeamAttention()
  const timer = setInterval(() => { void refreshTeamAttention() }, POLL_MS)
  return () => clearInterval(timer)
}

/** Reset for tests. */
export function resetTeamAttention(): void {
  marks = EMPTY
  signature = ''
}
