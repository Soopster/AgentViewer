import type { TuiPierreDiffRow, TuiPierreSplitRow, TuiRenderSpan } from './pierreDiffView'

export type ReviewRow = TuiPierreDiffRow | TuiPierreSplitRow
export type DiffTextMatch = { row: number; path: string; side: 'old' | 'new'; line: number; start: number; end: number; key: string }
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
