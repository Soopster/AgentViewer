import type { TuiPierreDiffRow, TuiPierreSplitRow, TuiRenderSpan } from './pierreDiffView'
import { diffTextWidth } from './gitDiffText'

export type ReviewRow = TuiPierreDiffRow | TuiPierreSplitRow
export type DiffTextMatch = { row: number; path: string; side: 'old' | 'new'; line: number; start: number; end: number; key: string }
export type DiffCellSelection = { startRow: number; startColumn: number; endRow: number; endColumn: number; side: 'old' | 'new' }

/** Convert a terminal-cell column back to a UTF-16 source offset. */
export function sourceIndexAtCell(text: string, cell: number, tabWidth: number): number {
  const target = Math.max(0, cell)
  let source = 0
  let width = 0
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    const value = segment.segment
    const next = diffTextWidth(text.slice(0, source) + value, tabWidth)
    const segmentWidth = Math.max(0, next - width)
    if (target < next) return target - width < segmentWidth / 2 ? source : source + value.length
    source += value.length
    width = next
  }
  return text.length
}
function literalPattern(query: string) { return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu') }
export function diffMatchRanges(text: string, query: string): Array<{ start: number; end: number }> {
  if (!query) return []
  const pattern = literalPattern(query)
  return Array.from(text.matchAll(pattern), match => ({ start: match.index!, end: match.index! + match[0].length }))
}
export function findDiffTextMatches(rows: readonly ReviewRow[], query: string): DiffTextMatch[] {
  if (!query) return []
  const matches: DiffTextMatch[] = []
  const pattern = literalPattern(query)
  rows.forEach((row, index) => {
    const unified = row as TuiPierreDiffRow
    const split = row as TuiPierreSplitRow
    const sources: Array<{ text: string; side: 'old' | 'new'; line: number }> = []
    if (split.left || split.right) {
      if (split.left?.lineNum != null && split.left.kind !== 'context') sources.push({text:split.left.text, side:'old', line:split.left.lineNum})
      if (split.right?.lineNum != null) sources.push({text:split.right.text, side:'new', line:split.right.lineNum})
      else if (split.left?.lineNum != null && split.left.kind === 'context') sources.push({text:split.left.text, side:'old', line:split.left.lineNum})
    } else if (unified.newLine != null || unified.oldLine != null) {
      sources.push({text: unified.text, side:unified.newLine != null ? 'new' : 'old', line:unified.newLine ?? unified.oldLine!})
    }
    for (const source of sources) for (const match of source.text.matchAll(pattern)) {
      const range = { start: match.index!, end: match.index! + match[0].length }
      const path = row.filePath ?? ''
      matches.push({row:index, path, side:source.side, line:source.line, ...range, key:JSON.stringify([path, source.side, source.line, range.start])})
    }
  })
  return matches
}

/** Copy source text, never visual gutters, clipping, wrapping, or rendered tabs. */
export function copyDiffRows(rows: readonly ReviewRow[], start: number, end: number, side: 'old' | 'new' = 'new'): string | null {
  const path = rows[start]?.filePath
  const lines: string[] = []
  for (let index = Math.max(0, Math.min(start, end)); index <= Math.min(rows.length - 1, Math.max(start, end)); index++) {
    const row = rows[index]!
    if (row.filePath !== path) continue
    const split = row as TuiPierreSplitRow
    if (split.left || split.right) {
      const source = side === 'old' ? split.left : split.right
      if (source?.lineNum != null) lines.push(source.text)
    } else {
      const source = row as TuiPierreDiffRow
      if (side === 'old' ? source.oldLine != null : source.newLine != null || source.oldLine != null) lines.push(source.text)
    }
  }
  return lines.length ? lines.join('\n') : null
}

export function copyDiffCellSelection(rows: readonly ReviewRow[], selection: DiffCellSelection, tabWidth: number): string | null {
  const lower = Math.max(0, Math.min(selection.startRow, selection.endRow))
  const upper = Math.min(rows.length - 1, Math.max(selection.startRow, selection.endRow))
  const path = rows[lower]?.filePath
  const lines: string[] = []
  for (let index = lower; index <= upper; index += 1) {
    const row = rows[index]!
    if (row.filePath !== path) continue
    const split = row as TuiPierreSplitRow
    const source = split.left || split.right
      ? selection.side === 'old' ? split.left : split.right
      : (() => { const unified = row as TuiPierreDiffRow; return selection.side === 'old' ? (unified.oldLine != null ? unified : null) : (unified.newLine != null ? unified : unified.oldLine != null ? unified : null) })()
    if (!source) continue
    const text = source.text
    const start = index === selection.startRow ? sourceIndexAtCell(text, selection.startColumn, tabWidth) : 0
    const end = index === selection.endRow ? sourceIndexAtCell(text, selection.endColumn, tabWidth) : text.length
    lines.push(text.slice(Math.min(start, end), Math.max(start, end)))
  }
  return lines.length ? lines.join('\n') : null
}

/** Overlay literal matches while preserving all existing syntax/word-diff styling elsewhere. */
export function highlightDiffMatches(text: string, spans: TuiRenderSpan[] | undefined, query: string, fg: string, bg: string): TuiRenderSpan[] | undefined {
  const ranges = diffMatchRanges(text, query)
  if (!ranges.length) return spans
  const result: TuiRenderSpan[] = []
  let offset = 0
  for (const span of spans?.length ? spans : [{text}]) {
    const end = offset + span.text.length
    const cuts = [offset, ...ranges.flatMap(range => [range.start, range.end]).filter(at => at > offset && at < end), end]
    for (let i=0;i<cuts.length-1;i++) {
      const start = cuts[i]!, stop = cuts[i+1]!
      const matched = ranges.some(range => start >= range.start && start < range.end)
      result.push({...span, text:text.slice(start, stop), ...(matched ? {fg, bg} : {})})
    }
    offset = end
  }
  return result
}
