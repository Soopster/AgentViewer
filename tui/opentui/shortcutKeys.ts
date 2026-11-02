import type { KeyEvent } from '@opentui/core'

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
export const PORTABLE_COMMAND_CHORDS = {
  a: { command: 'coord-board', label: 'Agent Operations', short: 'ops' },
  b: { command: 'desk', label: 'Bloomberg-style desk', short: 'desk' },
  f: { command: 'changed-files', label: 'Files touched by this session', short: 'files' },
  g: { command: 'pull-requests', label: 'Pull requests', short: 'PRs' },
  h: { command: 'index-search', label: 'Search the session index', short: 'find' },
  l: { command: 'processes', label: 'Processes and logs', short: 'logs' },
  m: { command: 'tab-manager', label: 'Manage tabs (pin, reorder)', short: 'tabs', hint: false },
  n: { command: 'coord-start', label: 'New coordinated run', short: 'run' },
  p: { command: 'tool-timing', label: 'Tool timing by turn', short: 'time', hint: false },
  s: { command: 'daily-summary', label: 'Daily summary of agent work', short: 'sum' },
  t: { command: 'coord-teammates', label: 'Teammates for this conversation', short: 'team' },
  o: { command: 'window-switcher', label: 'Workspace overview', short: 'tree' },
  q: { command: 'window-identify', label: 'Identify windows', short: 'id' },
  w: { command: 'window-manage', label: 'Manage windows', short: 'win' },
  v: { command: 'transcript-pager', label: 'Open transcript in $VISUAL / $EDITOR / pager', short: 'page' },
} as const

export type PortableCommandChord = keyof typeof PORTABLE_COMMAND_CHORDS

export function portableCommandChord(sequence: string): PortableCommandChord | null {
  const normalized = sequence.toLowerCase()
  return normalized in PORTABLE_COMMAND_CHORDS
    ? normalized as PortableCommandChord
    : null
}
