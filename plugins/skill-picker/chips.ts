/**
 * Skills the person added to the prompt being written, kept so the composer can show each as a
 * chip it can remove. A chip is only a label for text already in the draft: it is shown while that
 * text is still there and removing it takes the text back out, so it never claims a skill the
 * prompt no longer holds. Module state, shared by the picker and the accessory (one bundle).
 */
export type SkillChip = { readonly id: string; readonly name: string; readonly text: string }

const MAX_CHIPS = 12
const chips = new Map<string, readonly SkillChip[]>()
const listeners = new Set<() => void>()
const EMPTY: readonly SkillChip[] = []
let counter = 0

const notify = () => { for (const listener of listeners) listener() }

export function addSkillChip(sessionId: string, name: string, insertedText: string): void {
  const text = insertedText.trim()
  if (!text) return
  const current = chips.get(sessionId) ?? EMPTY
  if (current.some(chip => chip.text === text)) return
  counter += 1
  chips.set(sessionId, [...current, { id: `chip-${counter}`, name, text }].slice(-MAX_CHIPS))
  notify()
}

export function removeSkillChip(sessionId: string, id: string): void {
  const current = chips.get(sessionId)
  if (!current?.some(chip => chip.id === id)) return
  chips.set(sessionId, current.filter(chip => chip.id !== id))
  notify()
}

/** Stable between changes, so it can be a `useSyncExternalStore` snapshot. */
export function skillChipsFor(sessionId: string): readonly SkillChip[] {
  return chips.get(sessionId) ?? EMPTY
}

export function subscribeSkillChips(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The chips whose text is still in the draft. */
export function visibleSkillChips(all: readonly SkillChip[], draft: string): SkillChip[] {
  return all.filter(chip => draft.includes(chip.text))
}

/** The draft with one inserted skill taken back out, and the space it was set off by. */
export function draftWithoutSkill(draft: string, text: string): string {
  const at = draft.indexOf(text)
  if (at < 0) return draft
  let before = draft.slice(0, at)
  let after = draft.slice(at + text.length)
  // The space the insert added goes with it; otherwise one beside it, so none is left doubled.
  if (after.startsWith(' ')) after = after.slice(1)
  else if (before.endsWith(' ')) before = before.slice(0, -1)
  return before + after
}
