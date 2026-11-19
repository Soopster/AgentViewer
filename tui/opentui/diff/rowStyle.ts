// How a unified diff row looks, shared by every stacked diff the TUI draws (the Git
// review, the Engineering inspector). Pure: colours come from the caller's theme.
import type { TuiThemePalette } from '../../theme'
import type { TuiPierreDiffRow } from '../pierreDiffView'
import { diffTextHeight } from '../gitDiffText'

/** Rows whose text is source code: wrapped, sliced horizontally and syntax-coloured. */
export function isDiffCodeRow(row: Pick<TuiPierreDiffRow, 'tone'>): boolean {
  return row.tone === 'context' || row.tone === 'addition' || row.tone === 'deletion'
}

export function diffRowColor(row: Pick<TuiPierreDiffRow, 'tone'>, theme: TuiThemePalette): string {
  switch (row.tone) {
    case 'addition': return theme.green
    case 'deletion': return theme.red
    case 'file':
    case 'hunk': return theme.cyan
    case 'tree':
    case 'meta': return theme.dim
    default: return theme.text
  }
}

export function diffRowBackground(row: Pick<TuiPierreDiffRow, 'tone'>, theme: TuiThemePalette): string | undefined {
  switch (row.tone) {
    case 'addition': return theme.diffAddBg
    case 'deletion': return theme.diffRemoveBg
    case 'file':
    case 'hunk': return theme.diffMetaBg
    default: return undefined
  }
}

export function diffRowIndicator(row: Pick<TuiPierreDiffRow, 'tone' | 'indicator'>): string {
  if (row.indicator) return row.indicator
  switch (row.tone) {
    case 'addition': return '+'
    case 'deletion': return '-'
    case 'file': return '>'
    case 'hunk': return '@'
    case 'tree': return '|'
    default: return ' '
  }
}

export function formatDiffLineNumber(lineNumber: number | undefined, width: number): string {
  return lineNumber == null ? ''.padStart(width, ' ') : lineNumber.toString().padStart(width, ' ')
}

/** Digits needed for the widest line number, so the gutter is one fixed column. */
export function diffGutterDigits(rows: readonly Pick<TuiPierreDiffRow, 'oldLine' | 'newLine'>[]): number {
  let max = 1
  for (const row of rows) max = Math.max(max, row.oldLine ?? 0, row.newLine ?? 0)
  return String(max).length
}

/** The cursor/indicator column every stacked row draws before its text. */
export const DIFF_INDICATOR_WIDTH = 3

/** Cells left for a row's text once the gutter, indicator, any trailing column and the scrollbar are taken. */
export function diffStackTextColumns(width: number, gutterDigits: number, showLineNumbers: boolean, trailingColumns = 0): number {
  const gutter = showLineNumbers ? gutterDigits * 2 + 2 : 0
  return Math.max(width - gutter - DIFF_INDICATOR_WIDTH - trailingColumns - 1, 1)
}

/** A row's height in terminal rows: code rows wrap when asked to, headers never do. */
export function diffStackRowHeight(row: Pick<TuiPierreDiffRow, 'tone' | 'text'>, columns: number, tabWidth: number, wrap: boolean): number {
  return isDiffCodeRow(row) ? diffTextHeight(row.text ?? '', columns, tabWidth, wrap) : 1
}

export function fitDiffCell(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

/** Which syntax palette a theme wants, from its background's luminance. */
export function diffAppearance(theme: Pick<TuiThemePalette, 'bg'>): 'dark' | 'light' {
  const hex = theme.bg.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? 'light' : 'dark'
}
