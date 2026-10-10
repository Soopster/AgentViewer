import assert from 'node:assert/strict'

import {
  CHORD_HELP_REVEAL_MS,
  chordEntries,
  chordHelpKeyWidth,
  chordHelpRows,
  chordHintText,
  chordUnknownKeyNotice,
  COMMAND_CHORD_MAP,
  SPLIT_CHORD_MAP,
} from './chordHelp'
import { PORTABLE_COMMAND_CHORDS, portableCommandChord } from './shortcutKeys'

// ── anti-drift: ⌃K ─────────────────────────────────────────────────────────
// The ⌃B table already had a guard in splitPaneSmoke. ⌃K had none: its keys
// were described by two hand-written strings (the status hint and the
// unknown-key notice) with the dispatcher's own table as a third copy.
const documentedCommandKeys = new Set(chordEntries(COMMAND_CHORD_MAP).map((entry) => entry.keys))
for (const key of Object.keys(PORTABLE_COMMAND_CHORDS)) {
  assert.ok(documentedCommandKeys.has(key), `⌃K ${key} is dispatched but missing from its help`)
  assert.equal(portableCommandChord(key), key, `⌃K ${key} must round-trip through the dispatcher's lookup`)
}
for (const entry of chordEntries(COMMAND_CHORD_MAP)) {
  const dispatched = entry.keys.split(' · ').some((key) => portableCommandChord(key) !== null)
  const cancel = entry.label.includes('cancel')
  assert.ok(dispatched || cancel,
    `⌃K help advertises "${entry.keys}" but the dispatcher does not bind it`)
}

// Every chord's label comes from the same entry as the command it runs, so a
// renamed command cannot keep its old label in the help.
assert.equal(PORTABLE_COMMAND_CHORDS.a.command, 'coord-board')
assert.equal(
  chordEntries(COMMAND_CHORD_MAP).find((entry) => entry.keys === 'a')?.label,
  PORTABLE_COMMAND_CHORDS.a.label,
)

// ── the hint lists only what the next keystroke can do ─────────────────────
// This is the rule that makes a derived hint better than a written one. ⌃B's
// table also documents the keys a *focused pane* takes, which need no prefix —
// listing those while ⌃B is pending would advertise keys that do nothing next.
const splitHint = chordHintText(SPLIT_CHORD_MAP)
for (const entry of chordEntries(SPLIT_CHORD_MAP)) {
  const firstKey = entry.keys.split(' · ')[0]!
  if (entry.hint === false) continue
  assert.ok(splitHint.includes(firstKey), `The pending-⌃B hint must list ${firstKey}`)
}

// An entry kept out of the hint is still in the overlay: it is a refinement of
// a listed key, not a secret.
const hintless = chordEntries(SPLIT_CHORD_MAP).filter((entry) => entry.hint === false)
assert.ok(hintless.length > 0, 'Some ⌃B entries really are held back from the hint')
const overlayKeys = new Set(chordHelpRows(SPLIT_CHORD_MAP).map((row) => row.keys))
for (const entry of hintless) {
  assert.ok(overlayKeys.has(entry.keys), `${entry.keys} is hidden from the hint and must remain in the overlay`)
}

// The hint is one line in the status bar. If it outgrows a standard terminal
// it is truncated from the right, and what it loses is how to escape the chord
// — the one thing a user who is lost actually needs.
const HINT_BUDGET = 120 - '⌃B  '.length
assert.ok(splitHint.length <= HINT_BUDGET,
  `The ⌃B hint is ${splitHint.length} columns and will truncate at 120: ${splitHint}`)
assert.ok(chordHintText(COMMAND_CHORD_MAP).length <= HINT_BUDGET, 'The ⌃K hint must fit too')
assert.ok(splitHint.includes('cancel') && splitHint.includes('all keys'),
  'The escape hatch and the help key must survive in the hint')
const unprefixed = (SPLIT_CHORD_MAP.unprefixedSections ?? []).flatMap((section) => section.entries)
assert.ok(unprefixed.length > 0, 'The ⌃B table really does carry an unprefixed section')
for (const entry of unprefixed) {
  assert.ok(!splitHint.includes(entry.label),
    `The pending-⌃B hint must not advertise "${entry.label}", which needs no prefix`)
}

const commandHint = chordHintText(COMMAND_CHORD_MAP)
for (const key of Object.keys(PORTABLE_COMMAND_CHORDS)) {
  assert.ok(commandHint.includes(key), `The pending-⌃K hint must list ${key}`)
}
assert.ok(commandHint.includes('cancel'), 'A pending chord must always say how to escape it')

// ── the unknown-key notice names the prefix and the alternatives ───────────
const notice = chordUnknownKeyNotice(SPLIT_CHORD_MAP, 'q')
assert.ok(notice.startsWith('⌃B q is not bound'), `Unexpected notice: ${notice}`)
assert.ok(notice.includes('?'), 'The notice must point at the help key')
assert.ok(chordUnknownKeyNotice(COMMAND_CHORD_MAP, 'q').startsWith('⌃K q is not bound'))

// ── overlay rows ───────────────────────────────────────────────────────────
// The overlay shows the unprefixed section too: it is reference, not a menu of
// what happens next, and a reader looking up split keys wants both halves.
const rows = chordHelpRows(SPLIT_CHORD_MAP)
const headings = rows.filter((row) => row.keys === null).map((row) => row.label)
assert.equal(headings.length,
  SPLIT_CHORD_MAP.sections.length + (SPLIT_CHORD_MAP.unprefixedSections?.length ?? 0),
  'One heading per section')
assert.equal(rows.filter((row) => row.keys !== null).length,
  chordEntries(SPLIT_CHORD_MAP).length + unprefixed.length,
  'Every entry from every section reaches the overlay')
assert.ok(new Set(rows.map((row) => row.id)).size === rows.length, 'Row ids are unique render keys')
assert.equal(chordHelpKeyWidth(SPLIT_CHORD_MAP),
  rows.reduce((widest, row) => Math.max(widest, row.keys?.length ?? 0), 0),
  'The key gutter is sized to the widest key actually rendered')

assert.ok(chordHelpRows(COMMAND_CHORD_MAP).length > Object.keys(PORTABLE_COMMAND_CHORDS).length,
  'The ⌃K overlay carries its heading and cancel row alongside the chords')

// ── the reveal delay ───────────────────────────────────────────────────────
// Long enough that typing a chord you know never shows it; short enough to read
// as an answer to hesitating rather than as a stall.
assert.ok(CHORD_HELP_REVEAL_MS >= 400 && CHORD_HELP_REVEAL_MS <= 1500,
  `A which-key reveal delay of ${CHORD_HELP_REVEAL_MS}ms is outside the useful range`)

console.log('Chord help smoke passed (⌃K anti-drift, hint scope, notices, overlay rows, reveal delay)')
