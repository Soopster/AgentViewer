// The diff-source picker's vocabulary, shared by the web popover and the TUI.
//
// Both surfaces offer the same four choices and must agree on what they mean:
// which trees a choice resolves to, how a turn is numbered, and how it is
// labelled. Keeping that here means a change to the menu cannot land in one UI
// and quietly not the other — only the rendering differs.

import type { GitDiffSource, GitTurnRef } from './gitProvider'

/** What the user picked, which is not the same as what gets diffed: 'latest'
 *  has to keep meaning "whichever turn is newest" after another turn runs, so
 *  it is resolved against the turn list on every read rather than frozen into
 *  a sha when the menu is clicked. */
export type DiffSourceSelection =
  | { kind: 'working' }
  | { kind: 'branch' }
  | { kind: 'latest' }
  | { kind: 'turn'; sha: string }

/** Turns are listed newest first; numbering counts up from the oldest so a
 *  turn keeps its number as newer ones arrive. */
export function turnNumber(turns: GitTurnRef[], index: number): number {
  return turns.length - index
}

/** A selection only becomes a diff source once the turn list is known: with no
 *  checkpoints, 'latest' has nothing to point at and falls back to the working
 *  tree rather than showing an empty diff. */
export function resolveDiffSource(selection: DiffSourceSelection, turns: GitTurnRef[]): GitDiffSource {
  if (selection.kind === 'branch') return { kind: 'branch' }
  if (selection.kind === 'turn') return { kind: 'turn', sha: selection.sha }
  if (selection.kind === 'latest') {
    const latest = turns[0]
    return latest ? { kind: 'turn', sha: latest.sha } : { kind: 'working' }
  }
  return { kind: 'working' }
}

/** Identity of a source, for comparing one read's source against the next. */
export function diffSourceKey(source: GitDiffSource): string {
  return source.kind === 'turn' ? `turn:${source.sha}` : source.kind
}

export function diffSourceLabel(selection: DiffSourceSelection, turns: GitTurnRef[]): string {
  if (selection.kind === 'branch') return 'Branch changes'
  if (selection.kind === 'latest') return 'Latest turn'
  if (selection.kind === 'turn') {
    const index = turns.findIndex((turn) => turn.sha === selection.sha)
    return index === -1 ? 'Turn' : `Turn ${turnNumber(turns, index)}`
  }
  return 'Working tree'
}

/** A time alone cannot separate 60 turns spread over days — 15:56 appears once
 *  per day the agent ran — so anything older than today carries its date. */
export function formatTurnTime(createdAt: number, now: Date = new Date()): string {
  if (!createdAt) return ''
  const at = new Date(createdAt)
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  const sameDay = at.getFullYear() === now.getFullYear()
    && at.getMonth() === now.getMonth()
    && at.getDate() === now.getDate()
  return sameDay ? time : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

export type DiffSourceMenuItem = {
  selection: DiffSourceSelection
  label: string
  /** What the turn was asked to do — the number alone identifies nothing. */
  secondary?: string
  detail?: string
}

/** The three whole-change-set choices, in menu order. */
export const DIFF_SOURCE_HEAD_ITEMS: DiffSourceMenuItem[] = [
  { selection: { kind: 'working' }, label: 'Working tree' },
  { selection: { kind: 'branch' }, label: 'Branch changes' },
  { selection: { kind: 'latest' }, label: 'Latest turn' },
]

export function turnMenuItems(turns: GitTurnRef[]): DiffSourceMenuItem[] {
  return turns.map((turn, index) => ({
    selection: { kind: 'turn', sha: turn.sha },
    label: `Turn ${turnNumber(turns, index)}`,
    secondary: turn.label,
    detail: formatTurnTime(turn.createdAt),
  }))
}

export function isSameSelection(left: DiffSourceSelection, right: DiffSourceSelection): boolean {
  if (left.kind !== right.kind) return false
  return left.kind === 'turn' && right.kind === 'turn' ? left.sha === right.sha : true
}
