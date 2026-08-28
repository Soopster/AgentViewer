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

export const PORTABLE_COMMAND_CHORDS = {
  a: 'coord-board',
  g: 'pull-requests',
  n: 'coord-start',
} as const

export type PortableCommandChord = keyof typeof PORTABLE_COMMAND_CHORDS

export function portableCommandChord(sequence: string): PortableCommandChord | null {
  const normalized = sequence.toLowerCase()
  return normalized in PORTABLE_COMMAND_CHORDS
    ? normalized as PortableCommandChord
    : null
}
