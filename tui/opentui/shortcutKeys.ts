import type { KeyEvent } from '@opentui/core'
import { activeChordBindings } from './userKeys'
import { listPluginCommands } from '../../lib/plugins/catalog'

export type ShortcutKeyEvent = Pick<
  KeyEvent,
  'ctrl' | 'meta' | 'name' | 'option' | 'sequence' | 'shift'
>

export function isCtrlKey(key: ShortcutKeyEvent, char: string): boolean {
  const normalized = char.toLowerCase()
  const code = normalized.charCodeAt(0)
  const ctrlSequence = code >= 97 && code <= 122
    ? String.fromCharCode(code - 96)
    : ''
  return (key.ctrl && key.name.toLowerCase() === normalized) || key.sequence === ctrlSequence
}

export function isCtrlShiftKey(key: ShortcutKeyEvent, char: string): boolean {
  // Raw one-byte terminal input cannot distinguish Ctrl+Shift+letter from
  // Ctrl+letter. Never guess: callers provide a portable sequential chord for
  // these actions, while Kitty/CSI-u and modifyOtherKeys retain `shift` here.
  return isCtrlKey(key, char) && key.shift
}

export function isShiftedKey(key: ShortcutKeyEvent, char: string): boolean {
  const normalized = char.toLowerCase()
  const shifted = char.toUpperCase()
  return key.name.toLowerCase() === normalized
    && (key.shift || key.name === shifted || key.sequence === shifted)
}

export function isAltKey(key: ShortcutKeyEvent, char: string): boolean {
  // Legacy terminals encode Alt as an ESC-prefixed key and OpenTUI exposes it
  // as `meta`; enhanced keyboard protocols expose the same modifier as
  // `option` (and usually `meta`). Accept both representations.
  return (key.option || key.meta) && key.name.toLowerCase() === char.toLowerCase()
}

// The ⌃K chord table. A chord's command id and its human label live in the
// same entry so the dispatcher, the status-bar hint, the unknown-key notice and
// the ⌃K ? overlay are all one table — four hand-written copies of this set is
// how three of them end up describing keys the fourth no longer has.
//
// Plugin commands bring their own chord (`tuiChord` in the manifest); only the
// shell's window commands are listed here. Adding a plugin chord touches the
// plugin alone.
export type CommandChordEntry = { readonly command: string; readonly label: string; readonly short: string; readonly hint?: false }

const HOST_COMMAND_CHORDS: Record<string, CommandChordEntry> = {
  o: { command: 'window-switcher', label: 'Workspace overview', short: 'tree' },
  q: { command: 'window-identify', label: 'Identify windows', short: 'id' },
  w: { command: 'window-manage', label: 'Manage windows', short: 'win' },
  v: { command: 'transcript-pager', label: 'Open transcript in $VISUAL / $EDITOR / pager', short: 'page' },
}

function buildCommandChords(): Record<string, CommandChordEntry> {
  const table: Record<string, CommandChordEntry> = {}
  const plugin = listPluginCommands('tui').filter(command => command.tuiChord)
    .sort((a, b) => a.tuiChord!.key.localeCompare(b.tuiChord!.key))
  for (const command of plugin) {
    const chord = command.tuiChord!
    const key = chord.key.toLowerCase()
    if (!/^[a-z0-9]$/.test(key)) throw new Error(`Plugin command ${command.id} has an invalid ⌃K chord: ${chord.key}`)
    if (table[key] || HOST_COMMAND_CHORDS[key]) throw new Error(`⌃K ${key} is claimed twice (${command.id} and ${(table[key] ?? HOST_COMMAND_CHORDS[key])!.command})`)
    table[key] = { command: command.id, label: chord.label ?? command.label, short: chord.short, ...(chord.hint === false ? { hint: false as const } : {}) }
  }
  return { ...table, ...HOST_COMMAND_CHORDS }
}

export const PORTABLE_COMMAND_CHORDS: Readonly<Record<string, CommandChordEntry>> = buildCommandChords()

export type PortableCommandChord = string

/** The command id a ⌃K key runs — the built-in table, or the user's keys.json over it. */
export function portableCommandChord(sequence: string): string | null {
  const normalized = sequence.toLowerCase()
  const bindings = activeChordBindings()
  if (bindings) return bindings.has(normalized) ? normalized : null
  return Object.hasOwn(PORTABLE_COMMAND_CHORDS, normalized) ? normalized : null
}

export function portableChordCommand(chord: string): string {
  return activeChordBindings()?.get(chord)?.command
    ?? PORTABLE_COMMAND_CHORDS[chord]!.command
}
