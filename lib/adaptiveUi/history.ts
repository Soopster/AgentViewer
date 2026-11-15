// An append-only record of what happened to card rules and who did it, beside the rules themselves
// (`.history.jsonl` in the recipes directory: not a rule file, so the loader never reads it). A card
// can be designed by a model, edited by an agent and switched on by a person; this is how a person
// finds out which, and it is the evidence the design requests' preference hints are drawn from.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type CardHistoryActor = 'user' | 'model' | 'agent' | 'cli' | 'mod'
export type CardHistoryAction = 'create' | 'design' | 'patch' | 'enable' | 'disable' | 'delete'
export type CardHistoryEntry = { readonly at: string; readonly id: string; readonly actor: CardHistoryActor; readonly action: CardHistoryAction; readonly revision?: number; readonly summary: string; readonly blockTypes?: readonly string[] }

const FILE = '.history.jsonl'
const MAX_BYTES = 256 * 1024
const KEEP_LINES = 500
const ACTORS = new Set(['user', 'model', 'agent', 'cli', 'mod'])
const ACTIONS = new Set(['create', 'design', 'patch', 'enable', 'disable', 'delete'])

export function appendCardHistory(dir: string, entry: Omit<CardHistoryEntry, 'at'>, now = new Date()): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, FILE)
    appendFileSync(file, `${JSON.stringify({ at: now.toISOString(), ...entry, summary: entry.summary.slice(0, 300) })}\n`, { mode: 0o600 })
    if (statSync(file).size > MAX_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, `${lines.slice(-KEEP_LINES).join('\n')}\n`, { mode: 0o600 })
      renameSync(temp, file)
    }
  } catch { /* an audit trail that cannot be written must not stop a rule from being saved */ }
}

/** Newest first. Lines that do not parse or do not fit the shape are skipped. */
export function readCardHistory(dir: string, options: { id?: string; limit?: number } = {}): CardHistoryEntry[] {
  let text = ''
  try { text = readFileSync(join(dir, FILE), 'utf8') } catch { return [] }
  const out: CardHistoryEntry[] = []
  for (const line of text.split('\n').reverse()) {
    if (!line) continue
    try {
      const entry = JSON.parse(line) as CardHistoryEntry
      if (typeof entry.id !== 'string' || typeof entry.at !== 'string' || !ACTORS.has(entry.actor) || !ACTIONS.has(entry.action) || typeof entry.summary !== 'string') continue
      if (options.id && entry.id !== options.id) continue
      out.push(entry)
      if (out.length >= (options.limit ?? 50)) break
    } catch { /* torn line */ }
  }
  return out
}

/**
 * What this person tends to keep, from their own decisions: block types in rules they left enabled, and in
 * rules they disabled or deleted. Fed to design requests so a card starts near what they have accepted.
 * Needs at least MIN_SIGNALS decisions to say anything: a hint from one data point is a guess.
 */
export const PREFERENCE_MIN_SIGNALS = 3
export function preferenceHint(history: readonly CardHistoryEntry[], activeBlockTypes: readonly (readonly string[])[]): string | null {
  const removed = new Map<string, number>(), kept = new Map<string, number>()
  for (const types of activeBlockTypes) for (const type of new Set(types)) kept.set(type, (kept.get(type) ?? 0) + 1)
  const decided = new Set<string>()
  for (const entry of history) {
    if (entry.actor !== 'user' || (entry.action !== 'delete' && entry.action !== 'disable') || !entry.blockTypes) continue
    decided.add(`${entry.id}@${entry.at}`)
    for (const type of new Set(entry.blockTypes)) removed.set(type, (removed.get(type) ?? 0) + 1)
  }
  if (activeBlockTypes.length + decided.size < PREFERENCE_MIN_SIGNALS) return null
  const rank = (counts: Map<string, number>, other: Map<string, number>) => [...counts].filter(([type, n]) => n > (other.get(type) ?? 0)).sort((a, b) => b[1] - a[1]).map(([type]) => type).slice(0, 4)
  const likes = rank(kept, removed), dislikes = rank(removed, kept)
  if (!likes.length && !dislikes.length) return null
  return `This person's earlier decisions: they keep cards that use ${likes.join(', ') || 'no clear favourite'}${dislikes.length ? ` and removed cards that used ${dislikes.join(', ')}` : ''}. Prefer the former unless the data clearly needs the latter.`
}
