/**
 * Rewrites the renderer's ANSI output into fewer bytes that paint the same cells.
 *
 * OpenTUI paints each run of equal style with its own `CUP + fg + bg + reset`,
 * even when the cursor already sits where the run starts and the colours have
 * not changed. A scrolled transcript frame is ~215 runs; those are ~58 bytes
 * each for ~5 bytes of text. ConPTY parses and re-renders every sequence, so on
 * Windows the sequence count, not the bandwidth, is the cost.
 *
 * Only two things are elided, and only when provably redundant:
 *  - a cursor move to the cell the cursor is already on (after plain
 *    width-1 text; anything else makes the position unknown and the move is kept);
 *  - SGR state the terminal already holds (the pending style is synced
 *    lazily, immediately before the next text or non-SGR sequence).
 * Every other sequence passes through verbatim, in order.
 */

type Style = { fg: string; bg: string; attrs: string }
const RESET: Style = { fg: '', bg: '', attrs: '' }
/** Matches no real style, so the next sync is a full restatement. */
const UNKNOWN: Style = { fg: '\0', bg: '\0', attrs: '\0' }

/** Terminal columns taken by `text`, or -1 when not certain (wide, combining, control). */
function plainWidth(text: string): number {
  let width = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return -1
    // Below U+1100 nothing is wide; U+0300-036F combine; surrogates may be wide.
    if (code >= 0x1100 || (code >= 0x300 && code <= 0x36f) || (code >= 0x80 && code < 0xa0)) return -1
    width++
  }
  return width
}

// SGR codes that switch an attribute off, and the attribute codes each one clears.
const ATTR_OFF: Record<number, readonly string[]> = {
  22: ['1', '2'], 23: ['3'], 24: ['4', '21'], 25: ['5', '6'], 27: ['7'], 28: ['8'], 29: ['9'], 55: ['53'],
}

/** Attributes are a sorted set of the codes that turn them on, so equal sets compare equal. */
function updateAttrs(attrs: string, code: number, text: string): string {
  const set = new Set(attrs === '' ? [] : attrs.split(';'))
  const off = ATTR_OFF[code]
  if (off) for (const on of off) set.delete(on)
  else set.add(text)
  return [...set].sort().join(';')
}

function applySgr(style: Style, params: string): Style {
  if (params === '' || params === '0') return RESET
  const parts = params.split(';')
  let { fg, bg, attrs } = style
  for (let i = 0; i < parts.length; i++) {
    const code = Number(parts[i])
    if (code === 0) { fg = ''; bg = ''; attrs = '' }
    else if (code === 38 || code === 48) {
      const mode = parts[i + 1]
      const count = mode === '2' ? 5 : mode === '5' ? 3 : 0
      if (count === 0) return UNKNOWN // unparseable: force a full resync
      const value = parts.slice(i, i + count).join(';')
      if (code === 38) fg = value
      else bg = value
      i += count - 1
    } else if (code === 39) fg = ''
    else if (code === 49) bg = ''
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = String(code)
    else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) bg = String(code)
    else attrs = updateAttrs(attrs, code, parts[i])
  }
  return { fg, bg, attrs }
}

const same = (a: Style, b: Style) => a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs

/** The shortest SGR that takes the terminal from `from` to `to`. */
function transition(from: Style, to: Style): string {
  if (same(from, to)) return ''
  if (to.fg === '' && to.bg === '' && to.attrs === '') return '\x1b[0m'
  const codes: string[] = []
  // Attributes cannot be individually cleared here, so any attribute change restarts from reset.
  const fromAttrs = from.attrs === '' ? [] : from.attrs.split(';')
  const toAttrs = to.attrs === '' ? [] : to.attrs.split(';')
  const restart = fromAttrs.some((attr) => !toAttrs.includes(attr))
  if (restart) {
    codes.push('0')
    if (to.fg) codes.push(to.fg)
    if (to.bg) codes.push(to.bg)
  } else {
    if (to.fg !== from.fg) codes.push(to.fg || '39')
    if (to.bg !== from.bg) codes.push(to.bg || '49')
  }
  const added = restart ? toAttrs : toAttrs.filter((attr) => !fromAttrs.includes(attr))
  codes.push(...added)
  return `\x1b[${codes.join(';')}m`
}

export type AnsiCompactor = { write(chunk: string): string; stats: { bytesIn: number; bytesOut: number } }

export function createAnsiCompactor(): AnsiCompactor {
  let held = ''
  let terminal: Style = RESET
  let pending: Style = RESET
  // Where the cursor is, when known (1-based row/column, as in CUP).
  let row = 0
  let col = 0
  const stats = { bytesIn: 0, bytesOut: 0 }

  const unknown = () => { row = 0; col = 0 }

  function write(chunk: string): string {
    const input = held + chunk
    held = ''
    stats.bytesIn += chunk.length
    let out = ''
    let i = 0
    const sync = () => {
      const delta = transition(terminal, pending)
      if (delta) { out += delta; terminal = pending }
    }
    while (i < input.length) {
      if (input.charCodeAt(i) !== 0x1b) {
        // Plain text up to the next escape.
        let end = input.indexOf('\x1b', i)
        if (end === -1) end = input.length
        const text = input.slice(i, end)
        sync()
        out += text
        const width = plainWidth(text)
        if (width < 0 || row === 0) unknown()
        else col += width
        i = end
        continue
      }
      // An escape sequence. CSI is the case that matters; anything else is passed through whole.
      if (i + 1 >= input.length) { held = input.slice(i); break }
      if (input[i + 1] !== '[') {
        // OSC / DCS / APC / two-byte escapes: find the terminator (BEL or ST) or take two bytes.
        const kind = input[i + 1]
        if (kind === ']' || kind === 'P' || kind === '_' || kind === '^' || kind === 'X') {
          const bel = input.indexOf('\x07', i + 2)
          const st = input.indexOf('\x1b\\', i + 2)
          const stop = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
          if (stop === -1) { held = input.slice(i); break }
          const end = stop + (input[stop] === '\x07' ? 1 : 2)
          sync(); out += input.slice(i, end); unknown(); i = end
        } else {
          sync(); out += input.slice(i, i + 2); unknown(); i += 2
        }
        continue
      }
      let end = i + 2
      while (end < input.length && !(input.charCodeAt(end) >= 0x40 && input.charCodeAt(end) <= 0x7e)) end++
      if (end >= input.length) { held = input.slice(i); break }
      const body = input.slice(i + 2, end)
      const final = input[end]
      const raw = input.slice(i, end + 1)
      i = end + 1
      if (final === 'm' && pending === UNKNOWN && !/^0?(;|$)/.test(body)) {
        // The terminal's style is not known, so a delta from it cannot be computed: say it as it was said.
        out += raw
        continue
      }
      if (final === 'm' && /^[\d;]*$/.test(body)) {
        const next = applySgr(pending, body)
        if (next === UNKNOWN) {
          sync()
          out += raw
          terminal = pending = UNKNOWN
        } else pending = next
        continue
      }
      if (final === 'm') {
        // Colon sub-parameters (4:3 curly underline) or other forms: pass through and stop trusting the model.
        sync()
        out += raw
        terminal = pending = UNKNOWN
        continue
      }
      if (final === 'H' && /^\d+;\d+$/.test(body)) {
        const [r, c] = body.split(';').map(Number)
        if (r === row && c === col) continue
        out += raw
        row = r
        col = c
        continue
      }
      // Anything else (erase, modes, scroll, private sequences, ...) may read the style and moves the cursor unpredictably.
      sync()
      out += raw
      unknown()
    }
    stats.bytesOut += out.length
    return out
  }

  return { write, stats }
}
