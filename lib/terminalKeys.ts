// Turning a key the TUI received back into the bytes a shell expects.
//
// The TUI asks its own terminal for the kitty keyboard protocol, so a key can
// arrive as `CSI 97;5u` rather than the `^A` a shell understands. Forwarding
// the raw sequence would therefore type escape codes into the shell; this
// re-encodes every key as a legacy xterm sequence instead, from its parsed
// name and modifiers, which is what readline, zle, vim and less all read.

export type TerminalKey = {
  name: string
  ctrl: boolean
  shift: boolean
  meta?: boolean
  option?: boolean
  sequence?: string
  raw?: string
}

export type TerminalKeyModes = {
  /** DECCKM: the application asked for `ESC O A` arrows (vim, less). */
  cursorKeysApp?: boolean
}

const CSI = '\x1b['
const SS3 = '\x1bO'

const TILDE_KEYS: Record<string, number> = {
  insert: 2, delete: 3, pageup: 5, pagedown: 6,
  f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24,
}
const LETTER_KEYS: Record<string, string> = {
  up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F',
  f1: 'P', f2: 'Q', f3: 'R', f4: 'S',
}
const CTRL_SYMBOLS: Record<string, string> = {
  '@': '\x00', '2': '\x00', space: '\x00', ' ': '\x00',
  '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', '6': '\x1e', '_': '\x1f', '-': '\x1f', '/': '\x1f', '?': '\x7f',
}

/** xterm's modifier parameter: 1 + shift + 2·alt + 4·ctrl. */
function modifierParam(key: TerminalKey, alt: boolean): number {
  return 1 + (key.shift ? 1 : 0) + (alt ? 2 : 0) + (key.ctrl ? 4 : 0)
}

const KITTY_KEY = /^\x1b\[(\d+)(?::(\d+))?(?::\d+)?(?:;(\d+)(?::\d+)?)?(?:;([\d:]+))?u$/

/** The text a printable key produces, from whichever form it arrived in. */
function printableText(key: TerminalKey): string | null {
  const sequence = key.sequence ?? ''
  if (sequence && !sequence.startsWith('\x1b') && [...sequence].every((char) => char >= ' ' && char !== '\x7f')) return sequence
  const kitty = KITTY_KEY.exec(key.raw ?? sequence)
  if (kitty) {
    if (kitty[4]) return String.fromCodePoint(...kitty[4].split(':').map(Number))
    const shifted = kitty[2] ? Number(kitty[2]) : null
    const code = key.shift && shifted ? shifted : Number(kitty[1])
    if (code < 32 || code === 127 || code > 0x10ffff || (code >= 57344 && code <= 63743)) return null
    const char = String.fromCodePoint(code)
    return key.shift && !shifted ? char.toUpperCase() : char
  }
  if ([...key.name].length === 1) return key.shift ? key.name.toUpperCase() : key.name
  return null
}

/** The bytes for one key, or null for a key with no terminal meaning (a bare modifier). */
export function encodeTerminalKey(key: TerminalKey, modes: TerminalKeyModes = {}): string | null {
  const alt = Boolean(key.meta || key.option)
  const prefix = alt ? '\x1b' : ''
  const name = key.name

  switch (name) {
    case 'return':
    case 'enter':
      return `${prefix}\r`
    case 'linefeed':
      return `${prefix}\n`
    case 'tab':
      return key.shift ? `${CSI}Z` : `${prefix}\t`
    case 'backspace':
      return key.ctrl ? `${prefix}\b` : `${prefix}\x7f`
    case 'escape':
      return '\x1b'
    case 'space':
      return key.ctrl ? `${prefix}\x00` : `${prefix} `
  }

  const letter = LETTER_KEYS[name]
  if (letter) {
    const param = modifierParam(key, alt)
    if (param > 1) return `${CSI}1;${param}${letter}`
    const arrow = name === 'up' || name === 'down' || name === 'left' || name === 'right' || name === 'home' || name === 'end'
    if (name.startsWith('f')) return `${SS3}${letter}`
    return arrow && modes.cursorKeysApp ? `${SS3}${letter}` : `${CSI}${letter}`
  }
  const tilde = TILDE_KEYS[name]
  if (tilde !== undefined) {
    const param = modifierParam(key, alt)
    return param > 1 ? `${CSI}${tilde};${param}~` : `${CSI}${tilde}~`
  }

  if (key.ctrl) {
    if (/^[a-z]$/i.test(name)) return `${prefix}${String.fromCharCode(name.toLowerCase().charCodeAt(0) - 96)}`
    const symbol = CTRL_SYMBOLS[name] ?? CTRL_SYMBOLS[printableText({ ...key, ctrl: false }) ?? '']
    if (symbol) return `${prefix}${symbol}`
  }

  const text = printableText(key)
  return text === null ? null : `${prefix}${text}`
}

/** Pasted text, bracketed when the application asked (so a shell does not run each line). */
export function encodeTerminalPaste(text: string, bracketed: boolean): string {
  const normalized = text.replace(/\r?\n/g, '\r')
  // A paste carrying the end marker would end the bracket early and run the rest.
  return bracketed ? `\x1b[200~${normalized.replaceAll('\x1b[201~', '')}\x1b[201~` : normalized
}
