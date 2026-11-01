// Text entry for the GitHub popover. The popover owns the keyboard (the surface
// is `keys: 'capture'`), so composing a comment is just editing a string here:
// no host input element, no focus slot to fight over. Pure so it can be tested.

export type ComposeKey = { name: string; ctrl: boolean; shift: boolean; meta?: boolean; sequence: string }

export type ComposeResult =
  | { kind: 'edit'; value: string }
  | { kind: 'submit' }
  | { kind: 'cancel' }
  | { kind: 'ignore' }

const MAX_LENGTH = 20_000

/** A printable key, or a bracketed/multi-character paste: no control characters except newline/tab. */
function printable(sequence: string): string | null {
  if (!sequence) return null
  // eslint-disable-next-line no-control-regex
  const cleaned = sequence.replace(/\u001b\[200~|\u001b\[201~/g, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Enter submits; ⌃J inserts a newline (Enter cannot, it is the submit key);
 * Backspace deletes; ⌃U clears the line; Escape cancels.
 */
export function applyComposeKey(value: string, key: ComposeKey): ComposeResult {
  if (key.name === 'escape') return { kind: 'cancel' }
  if (key.name === 'return' || key.name === 'enter') return { kind: 'submit' }
  if (key.ctrl) {
    if (key.name === 'j') return { kind: 'edit', value: `${value}\n` }
    if (key.name === 'u') return { kind: 'edit', value: value.slice(0, value.lastIndexOf('\n') + 1) }
    if (key.name === 'w') return { kind: 'edit', value: value.replace(/\s*\S*\s*$/, '') }
    return { kind: 'ignore' }
  }
  if (key.name === 'backspace' || key.name === 'delete') return { kind: 'edit', value: Array.from(value).slice(0, -1).join('') }
  if (key.meta) return { kind: 'ignore' }
  const text = printable(key.sequence)
  if (text === null) return { kind: 'ignore' }
  return { kind: 'edit', value: (value + text).slice(0, MAX_LENGTH) }
}

/** The last `rows` lines of the buffer wrapped to `width`, with a cursor mark on the final one. */
export function composeView(value: string, width: number, rows: number): string[] {
  const lines: string[] = []
  for (const line of `${value}▏`.split('\n')) {
    if (line.length <= width) { lines.push(line); continue }
    for (let at = 0; at < line.length; at += width) lines.push(line.slice(at, at + width))
  }
  return lines.slice(-rows)
}
