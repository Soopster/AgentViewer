// What a click inside a transcript card can ask of the window drawing it. Cards are
// memoized and cached per selection variant, so these go through module slots
// rather than props on every card (as the turn summary's opener does).
import type { SubagentActivity, Session } from '../../../lib/types'

export type TranscriptWindowActions = {
  selected: () => boolean
  has: (cardKey: string) => boolean
  jumpToKey: (cardKey: string) => void
  session: () => Session
  openOutline: () => void
}

const windows = new Set<TranscriptWindowActions>()
export function registerTranscriptWindow(actions: TranscriptWindowActions): () => void {
  windows.add(actions)
  return () => { windows.delete(actions) }
}

/** The window holding a card, preferring the selected one when two show the same session. */
function windowWith(cardKey: string): TranscriptWindowActions | undefined {
  const holding = [...windows].filter(window => window.has(cardKey))
  return holding.find(window => window.selected()) ?? holding[0]
}

export function jumpToCardInWindow(cardKey: string): void {
  windowWith(cardKey)?.jumpToKey(cardKey)
}

/** False when no window is showing a transcript. */
export function openSelectedWindowOutline(): boolean {
  const target = [...windows].find(window => window.selected())
  target?.openOutline()
  return Boolean(target)
}

type SubagentOpener = (parent: Session, activity: SubagentActivity) => void
let subagentOpener: SubagentOpener | null = null
export function registerSubagentRowOpener(opener: SubagentOpener): () => void {
  subagentOpener = opener
  return () => { if (subagentOpener === opener) subagentOpener = null }
}
export function openSubagent(parent: Session, activity: SubagentActivity): void {
  subagentOpener?.(parent, activity)
}
export function openSubagentFromCard(cardKey: string, activity: SubagentActivity): void {
  const parent = windowWith(cardKey)?.session()
  if (parent) openSubagent(parent, activity)
}
