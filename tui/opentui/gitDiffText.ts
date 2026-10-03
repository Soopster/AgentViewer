import type { TuiRenderSpan } from './pierreDiffView'

const runtime = globalThis as typeof globalThis & { Bun: { stringWidth: (text: string) => number } }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const ascii = /^[\x20-\x7e\t]*$/

function graphemes(text: string): Iterable<string> {
  return ascii.test(text) ? text : Array.from(segmenter.segment(text), item => item.segment)
}

/** Lay out terminal cells identically for row measurement and painted syntax spans. */
export function layoutDiffText(text: string, columns: number, tabWidth: number, wrap: boolean, offset = 0, spans?: TuiRenderSpan[]): TuiRenderSpan[][] {
  columns = Math.max(1, columns)
  tabWidth = Math.max(1, tabWidth)
  const lines: TuiRenderSpan[][] = [[]]
  let sourceColumn = 0
  let paintedColumn = 0
  let sourceIndex = 0
  let spanIndex = 0
  let spanEnd = spans?.[0]?.text.length ?? 0
  const push = (value: string, style?: TuiRenderSpan) => {
    if (!value) return
    const line = lines[lines.length - 1]!
    const last = line.at(-1)
    if (last && last.fg === style?.fg && last.bg === style?.bg) last.text += value
    else line.push({ text: value, fg: style?.fg, bg: style?.bg })
  }
  for (const glyph of graphemes(text)) {
    while (spans && sourceIndex >= spanEnd && spanIndex < spans.length - 1) spanEnd += spans[++spanIndex]!.text.length
    const style = spans?.[spanIndex]
    sourceIndex += glyph.length
    const width = glyph === '\t' ? tabWidth - sourceColumn % tabWidth : glyph.length === 1 && glyph.charCodeAt(0) < 127 ? 1 : runtime.Bun.stringWidth(glyph)
    const value = glyph === '\t' ? ' '.repeat(width) : glyph
    if (wrap) {
      // Tabs are spaces and may span a wrap boundary; a grapheme never splits across rows.
      if (glyph === '\t') {
        for (let cell = 0; cell < width; cell++) {
          if (paintedColumn >= columns) { lines.push([]); paintedColumn = 0 }
          push(' ', style); paintedColumn++
        }
      } else {
        if (paintedColumn + width > columns && paintedColumn > 0) { lines.push([]); paintedColumn = 0 }
        push(width > columns ? '�' : value, style)
        paintedColumn += Math.min(width, columns)
      }
    } else {
      const left = Math.max(sourceColumn, offset)
      const right = Math.min(sourceColumn + width, offset + columns)
      if (right > left) push(left === sourceColumn && right === sourceColumn + width ? value : ' '.repeat(right - left), style)
      if (sourceColumn >= offset + columns) break
    }
    sourceColumn += width
  }
  return lines
}

export function diffTextHeight(text: string, columns: number, tabWidth: number, wrap: boolean): number {
  return wrap ? layoutDiffText(text, columns, tabWidth, true).length : 1
}

export function diffTextWidth(text: string, tabWidth: number): number {
  let width = 0
  for (const glyph of graphemes(text)) width += glyph === '\t' ? tabWidth - width % tabWidth : glyph.length === 1 && glyph.charCodeAt(0) < 127 ? 1 : runtime.Bun.stringWidth(glyph)
  return width
}

export type DiffLayoutMode = 'auto' | 'stack' | 'split'
export function resolveDiffLayout(mode: DiffLayoutMode, width: number): 'stack' | 'split' {
  return mode === 'auto' ? width >= 100 ? 'split' : 'stack' : mode
}

/** Whitespace-separated path terms narrow the review without changing its source. */
export function matchesDiffFile(path: string, query: string): boolean {
  const lower = path.toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term => lower.includes(term))
}
