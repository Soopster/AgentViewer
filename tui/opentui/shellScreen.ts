// Reading a terminal emulator's screen as rows of styled runs the pane can
// paint as spans. One run per stretch of identical style: a row is usually two
// or three runs, so a full screen is a few dozen spans, not one per cell.

import { TextAttributes } from '@opentui/core'

import type { TuiThemePalette } from '../theme'

/** The part of `@wterm/core`'s interface this needs; a fake in a test supplies the same. */
export type ScreenSource = {
  getCell(row: number, col: number): CellLike
  getScrollbackCell(offset: number, col: number): CellLike
  getScrollbackCount(): number
  getCursor(): { row: number; col: number; visible: boolean }
  getRows(): number
  getCols(): number
  usingAltScreen(): boolean
}

type CellLike = { char: number; chars?: string; fg: number; bg: number; flags: number; width?: number; fgRgb?: number; bgRgb?: number }

export type ScreenRun = { text: string; fg: string; bg?: string; attributes?: number }

const DEFAULT_COLOR = 256
const BOLD = 0x01
const DIM = 0x02
const ITALIC = 0x04
const UNDERLINE = 0x08
const REVERSE = 0x20
const INVISIBLE = 0x40
const STRIKE = 0x80

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

/** The 16 ANSI colours in the app theme's own hues, so a shell's prompt matches the TUI around it. */
export function ansiPalette(theme: TuiThemePalette): string[] {
  const base = [theme.surface3, theme.red, theme.green, theme.amber, theme.violet, theme.pink, theme.cyan, theme.muted]
  return [...base, theme.dim, theme.red, theme.green, theme.amber, theme.violet, theme.pink, theme.cyan, theme.text]
}

function indexedColor(index: number, palette: string[]): string {
  if (index < 16) return palette[index]!
  if (index < 232) {
    const value = index - 16
    const steps = [0, 95, 135, 175, 215, 255]
    const r = steps[Math.floor(value / 36) % 6]!
    const g = steps[Math.floor(value / 6) % 6]!
    const b = steps[value % 6]!
    return hex((r << 16) | (g << 8) | b)
  }
  const grey = 8 + (index - 232) * 10
  return hex((grey << 16) | (grey << 8) | grey)
}

function cellColor(index: number, rgb: number | undefined, palette: string[], fallback: string | undefined): string | undefined {
  if (rgb !== undefined && index !== DEFAULT_COLOR) return hex(rgb)
  if (index === DEFAULT_COLOR || index < 0 || index > 255) return fallback
  return indexedColor(index, palette)
}

function cellText(cell: CellLike): string {
  if (cell.width === 0) return ''
  if (cell.chars) return cell.chars
  return cell.char > 0 ? String.fromCodePoint(cell.char) : ' '
}

/**
 * The rows to paint, oldest first: `scrollBack` rows into the scrollback, the
 * rest from the live screen. The cursor is drawn reversed when asked for and
 * only while the view is at the live screen.
 */
export function readScreenRuns(
  source: ScreenSource,
  theme: TuiThemePalette,
  options: { scrollBack?: number; showCursor?: boolean } = {},
): ScreenRun[][] {
  const palette = ansiPalette(theme)
  const rows = source.getRows()
  const cols = source.getCols()
  const back = Math.max(0, Math.min(options.scrollBack ?? 0, source.usingAltScreen() ? 0 : source.getScrollbackCount()))
  const cursor = source.getCursor()
  const out: ScreenRun[][] = []
  for (let row = 0; row < rows; row += 1) {
    // Row `row` of the view: the first `back` rows come from the scrollback, newest last.
    const fromScrollback = row < back
    const offset = back - 1 - row
    const runs: ScreenRun[] = []
    let current: ScreenRun | null = null
    for (let col = 0; col < cols; col += 1) {
      const cell = fromScrollback ? source.getScrollbackCell(offset, col) : source.getCell(row - back, col)
      const text = cellText(cell)
      if (!text) continue
      let fg = cellColor(cell.fg, cell.fgRgb, palette, theme.text) ?? theme.text
      let bg = cellColor(cell.bg, cell.bgRgb, palette, undefined)
      const atCursor = options.showCursor && back === 0 && cursor.visible && cursor.row === row && cursor.col === col
      if ((cell.flags & REVERSE) !== 0 !== Boolean(atCursor)) {
        const swapped = bg ?? theme.bg
        bg = fg
        fg = swapped
      }
      const attributes = ((cell.flags & BOLD) ? TextAttributes.BOLD : 0)
        | ((cell.flags & DIM) ? TextAttributes.DIM : 0)
        | ((cell.flags & ITALIC) ? TextAttributes.ITALIC : 0)
        | ((cell.flags & UNDERLINE) ? TextAttributes.UNDERLINE : 0)
        | ((cell.flags & STRIKE) ? TextAttributes.STRIKETHROUGH : 0)
      const shown = (cell.flags & INVISIBLE) ? ' '.repeat([...text].length) : text
      if (current && current.fg === fg && current.bg === bg && (current.attributes ?? 0) === attributes) {
        current.text += shown
      } else {
        current = { text: shown, fg, ...(bg ? { bg } : {}), ...(attributes ? { attributes } : {}) }
        runs.push(current)
      }
    }
    // Trailing blank cells in the default style are dropped; the row is padded by its box.
    const last = runs[runs.length - 1]
    if (last && !last.bg && !last.attributes) {
      last.text = last.text.replace(/ +$/, '')
      if (!last.text) runs.pop()
    }
    out.push(runs)
  }
  return out
}

/** Plain text of the screen, for tests and for copying. */
export function screenText(runs: ScreenRun[][]): string[] {
  return runs.map((row) => row.map((run) => run.text).join('').replace(/ +$/, ''))
}

function sourceRowText(get: (col: number) => CellLike, cols: number): { text: string; full: boolean } {
  let text = ''
  for (let col = 0; col < cols; col += 1) text += cellText(get(col))
  const trimmed = text.replace(/ +$/, '')
  // The core does not report soft wraps, so a row filled to its last column is
  // taken as continuing on the next — what a wrapped stack-trace line looks like.
  return { text: trimmed, full: trimmed.length > 0 && cellText(get(cols - 1)).trim() !== '' }
}

/** Every retained line as plain text, oldest first: the scrollback, then the screen, wrapped rows rejoined. */
export function readAllScreenText(source: ScreenSource): string[] {
  const cols = source.getCols()
  const rows: Array<{ text: string; full: boolean }> = []
  for (let offset = source.getScrollbackCount() - 1; offset >= 0; offset -= 1) {
    rows.push(sourceRowText((col) => source.getScrollbackCell(offset, col), cols))
  }
  for (let row = 0; row < source.getRows(); row += 1) rows.push(sourceRowText((col) => source.getCell(row, col), cols))
  const lines: string[] = []
  let continuing = false
  for (const row of rows) {
    if (continuing) lines[lines.length - 1] += row.text
    else lines.push(row.text)
    continuing = row.full
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
