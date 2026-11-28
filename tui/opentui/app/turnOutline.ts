// The turn outline: every loaded prompt with what its turn did. Its state lives
// here, not in the root, so opening it and moving through it re-render only the
// window drawing it.
import { useSyncExternalStore } from 'react'
import type { TuiTranscriptCard } from '../../format'
import { formatElapsedClock } from './format'
import { turnDigest } from './turnDigest'

export type TurnOutlineRow = { key: string; number: number; prompt: string; detail: string; failed: boolean }

export function turnOutlineRows(cards: readonly TuiTranscriptCard[], preview: (card: TuiTranscriptCard) => string): TurnOutlineRow[] {
  const prompts = cards.flatMap((card, index) => card.role === 'user' ? [index] : [])
  return prompts.map((index, at) => {
    const end = prompts[at + 1] ?? cards.length
    const started = cards[index]!.timestampMs
    const finished = cards[end - 1]!.timestampMs
    const digest = turnDigest(cards, index, end, started != null && finished != null ? finished - started : null)
    const detail = [
      digest.elapsedMs != null && digest.elapsedMs >= 1000 ? formatElapsedClock(digest.elapsedMs) : null,
      digest.failures ? `× ${digest.failures}` : null,
      digest.edits.length ? `± ${digest.edits.length} file${digest.edits.length === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ')
    return { key: cards[index]!.key, number: at + 1, prompt: preview(cards[index]!), detail, failed: digest.failures > 0 }
  })
}

export type TurnOutlineState = {
  owner: string
  rows: TurnOutlineRow[]
  index: number
  partial: boolean
  onJump: (key: string) => void
}

let state: TurnOutlineState | null = null
const listeners = new Set<() => void>()
function set(next: TurnOutlineState | null): void {
  state = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function openTurnOutline(next: TurnOutlineState): void { set(next) }
export function closeTurnOutline(owner?: string): void {
  if (state && (!owner || state.owner === owner)) set(null)
}
export function chooseTurnOutlineRow(index: number): void {
  const current = state
  const row = current?.rows[index]
  if (!current || !row) return
  set(null)
  current.onJump(row.key)
}
/** The outline of one window, or null; other windows do not re-render for it. */
export function useTurnOutline(owner: string): TurnOutlineState | null {
  return useSyncExternalStore(subscribe, () => state?.owner === owner ? state : null)
}
/** While open the outline owns every key. */
export function handleTurnOutlineKey(key: { name: string; ctrl?: boolean }): boolean {
  if (!state) return false
  const move = (delta: number) => set({ ...state!, index: Math.max(0, Math.min(state!.rows.length - 1, state!.index + delta)) })
  if (key.name === 'escape' || key.name === 'q' || (key.ctrl && key.name === 'c')) set(null)
  else if (key.name === 'up' || key.name === 'k') move(-1)
  else if (key.name === 'down' || key.name === 'j') move(1)
  else if (key.name === 'pageup') move(-10)
  else if (key.name === 'pagedown') move(10)
  else if (key.name === 'home') move(-state.rows.length)
  else if (key.name === 'end') move(state.rows.length)
  else if (key.name === 'return') chooseTurnOutlineRow(state.index)
  return true
}
