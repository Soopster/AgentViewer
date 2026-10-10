// One table per prefix chord, and every surface that describes that chord reads
// it. Modelled on opencode's which-key panel
// (`packages/tui/src/feature-plugins/system/which-key.tsx`), which renders from
// the binding registry rather than from a maintained list.
//
// The problem this removes is drift, not effort. ⌃B was described in two places
// and ⌃K in two more: the status-bar hint while the chord is pending, the
// notice shown when an unrecognised key is pressed, and (for ⌃B) the overlay.
// Each was a hand-written string, so a chord could be added to the dispatcher
// and quietly stay out of some of its own help, or — worse — a removed chord
// could go on being advertised.

import { PORTABLE_COMMAND_CHORDS } from './shortcutKeys'
import { SPLIT_CHORD_HELP } from './splitPaneState'

export type ChordEntry = {
  /** Display form of the key(s), ` · `-separated when several do the same thing. */
  keys: string
  label: string
  /**
   * Terser label for the one-line status hint, where the full label would not
   * fit. Optional: an entry with no short form uses its label in both places.
   */
  short?: string
  /**
   * Set false to keep an entry out of the one-line hint. Entries are included
   * by default, so adding a chord cannot leave it silently unadvertised.
   */
  hint?: false
}
export type ChordSection = { title: string; entries: ChordEntry[] }

export type ChordMap = {
  /** Display form of the prefix itself, e.g. `⌃B`. */
  prefix: string
  title: string
  sections: ChordSection[]
  /**
   * Sections describing keys that are *not* reached through the prefix. They
   * belong in the overlay as reference, but never in the pending-chord hint —
   * a hint must list only what the next keystroke can do.
   */
  unprefixedSections?: ChordSection[]
}

export const SPLIT_CHORD_MAP: ChordMap = {
  prefix: '⌃B',
  title: 'split pane keybinds',
  sections: SPLIT_CHORD_HELP.filter((section) => !section.title.includes('no ⌃B')),
  unprefixedSections: SPLIT_CHORD_HELP.filter((section) => section.title.includes('no ⌃B')),
}

export const COMMAND_CHORD_MAP: ChordMap = {
  prefix: '⌃K',
  title: 'command chords',
  sections: [
    {
      title: 'commands',
      entries: [
        ...Object.entries(PORTABLE_COMMAND_CHORDS).map(([key, entry]) => ({
          keys: key,
          label: entry.label,
          short: entry.short,
        })),
        { keys: 'esc · ⌃C · ⌃G', label: 'cancel the chord', short: 'cancel' },
      ],
    },
  ],
}

/** Every entry the next keystroke could match, in overlay order. */
export function chordEntries(map: ChordMap): ChordEntry[] {
  return map.sections.flatMap((section) => section.entries)
}

/**
 * The one-line hint shown while the prefix is pending. Built from the table, so
 * it cannot advertise a key the dispatcher no longer handles.
 */
export function chordHintText(map: ChordMap): string {
  return chordEntries(map)
    .filter((entry) => entry.hint !== false)
    // One key per entry in the hint. An entry may bind several keys for the
    // same action (`% · v`), and spelling all of them out costs more width than
    // the whole rest of the entry — the overlay is where the aliases belong.
    .map((entry) => `${entry.keys.split(' · ')[0]} ${entry.short ?? entry.label}`)
    .join('  ')
}

/** The notice shown when a key is pressed that the prefix does not bind. */
export function chordUnknownKeyNotice(map: ChordMap, pressed: string): string {
  const keys = chordEntries(map).map((entry) => entry.keys).join(' · ')
  return `${map.prefix} ${pressed} is not bound — ${keys}`
}

export type ChordHelpRow = {
  /** Stable render key. */
  id: string
  /** Null on a section heading. */
  keys: string | null
  label: string
}

/** Overlay rows: a heading per section, then its entries. */
export function chordHelpRows(map: ChordMap): ChordHelpRow[] {
  const rows: ChordHelpRow[] = []
  for (const section of [...map.sections, ...(map.unprefixedSections ?? [])]) {
    rows.push({ id: `head:${section.title}`, keys: null, label: section.title })
    for (const entry of section.entries) {
      rows.push({ id: `${section.title}:${entry.keys}`, keys: entry.keys, label: entry.label })
    }
  }
  return rows
}

/** Widest key column across the rows, for the overlay's fixed key gutter. */
export function chordHelpKeyWidth(map: ChordMap): number {
  return chordHelpRows(map).reduce((widest, row) => Math.max(widest, row.keys?.length ?? 0), 0)
}

/**
 * How long a prefix may sit pending before its help appears on its own.
 *
 * This is the behaviour which-key is named for, and the reason it helps anyone
 * who has not already read the help: a user who does not know `?` exists still
 * learns the chord set by hesitating. Short enough to feel like an answer,
 * long enough that someone typing a chord they know never sees it.
 */
export const CHORD_HELP_REVEAL_MS = 900
