// Every position the edit buffer hands out or accepts is in display cells:
// the cursor column, `cursorOffset`, selections, `setCursor`, highlights. The
// editor's own model — completion, snippets, LSP, search, brackets, syntax —
// is string indices. The two agree only on printable ASCII: a tab is two
// cells, a CJK character or an emoji two, and a control character as many as
// the installed OpenTUI draws it with (0.6.1 began drawing `\f` as `^L`).
// Mixing them puts the cursor, a completion's replaced range or a highlight
// one cell off for every such character earlier on the line.
//
// Widths are measured, not assumed: OpenTUI reports each grapheme's width
// once and the answer is cached. That makes the conversion exact for whatever
// version is installed — the widths of controls and of some emoji changed in
// 0.6 — where a hand-written table would drift the next time OpenTUI changes
// one. 0.6.2 measures without a buffer (`measureEditText`); older builds are
// asked through a scratch edit buffer, which 0.6 requires an owner for.
import * as core from '@opentui/core'
import type { EditBuffer, WidthMethod } from '@opentui/core'

export type CellMeasure = ((grapheme: string) => number) & { dispose?: () => void }

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const measures = new Map<WidthMethod, CellMeasure>()

type MeasureEditText = (text: string, options: { widthMethod: WidthMethod }) => number
type CreateEditBuffer = (widthMethod: WidthMethod, owner?: unknown) => EditBuffer
type ResourceContextClass = new (options: { objectCapacity: number; renderCellsMax: number }) => unknown

function scratchBuffer(widthMethod: WidthMethod): EditBuffer {
  const create = (core.EditBuffer as unknown as { create: CreateEditBuffer }).create.bind(core.EditBuffer)
  const ResourceContext = (core as unknown as { ResourceContext?: ResourceContextClass }).ResourceContext
  if (!ResourceContext) return create(widthMethod)
  return create(widthMethod, new ResourceContext({ objectCapacity: 16, renderCellsMax: 4096 }))
}

/** Exported for the smoke, which checks both readers against a real buffer. */
export function graphemeWidthReader(widthMethod: WidthMethod, options: { viaBuffer?: boolean } = {}): CellMeasure {
  const measureEditText = (core as unknown as { measureEditText?: MeasureEditText }).measureEditText
  if (measureEditText && !options.viaBuffer) return (grapheme) => measureEditText(grapheme, { widthMethod })
  let scratch: EditBuffer | null = null
  const read: CellMeasure = (grapheme) => {
    scratch ??= scratchBuffer(widthMethod)
    scratch.setText(grapheme)
    scratch.setCursor(0, 0)
    return scratch.getEOL().col
  }
  read.dispose = () => { scratch?.destroy(); scratch = null }
  return read
}

/** The width the edit buffer gives one grapheme, measured once per method. */
export function bufferCellMeasure(widthMethod: WidthMethod): CellMeasure {
  const existing = measures.get(widthMethod)
  if (existing) return existing
  const cache = new Map<string, number>()
  const read = graphemeWidthReader(widthMethod)
  const measure: CellMeasure = (grapheme) => {
    const known = cache.get(grapheme)
    if (known !== undefined) return known
    const width = read(grapheme)
    cache.set(grapheme, width)
    return width
  }
  measure.dispose = () => { cache.clear(); read.dispose?.() }
  measures.set(widthMethod, measure)
  return measure
}

/** The measure for an editor's own buffer: same width method, same widths. */
export function editorCellMeasure(editor: { ctx: { widthMethod: WidthMethod } }): CellMeasure {
  return bufferCellMeasure(editor.ctx.widthMethod)
}

/** Cells taken by `line.slice(0, index)`. `line` must hold no newline. */
export function cellColumnAt(line: string, index: number, measure: CellMeasure): number {
  const end = Math.max(0, Math.min(index, line.length))
  if (PRINTABLE_ASCII.test(line)) return end
  let cells = 0
  for (const { segment, index: at } of graphemes.segment(line)) {
    if (at >= end) break
    cells += segment.length === 1 && segment >= ' ' && segment <= '~' ? 1 : measure(segment)
  }
  return cells
}

/**
 * The string index at cell `column` of `line`, clamped to the line. A column
 * inside a wide character or a tab lands on its start, which is where the
 * buffer puts a cursor there.
 */
export function indexAtCellColumn(line: string, column: number, measure: CellMeasure): number {
  if (column <= 0) return 0
  if (PRINTABLE_ASCII.test(line)) return Math.min(column, line.length)
  let cells = 0
  for (const { segment, index } of graphemes.segment(line)) {
    const width = segment.length === 1 && segment >= ' ' && segment <= '~' ? 1 : measure(segment)
    if (cells + width > column) return index
    cells += width
    if (cells === column) return index + segment.length
  }
  return line.length
}

type DisplayTable = { content: string; lineStarts: readonly number[]; displayStarts: number[] | null }
let lastTable: DisplayTable | null = null

// Display offsets are cells within a line plus one per line break, so a
// document's display starts differ from its string starts only after a line
// that is not plain ASCII. A document with none — most source — costs one
// regex scan and keeps the string starts.
function displayStartsFor(content: string, lineStarts: readonly number[], measure: CellMeasure): number[] | null {
  if (lastTable && lastTable.content === content && lastTable.lineStarts === lineStarts) return lastTable.displayStarts
  let displayStarts: number[] | null = null
  if (/[^\x20-\x7e\n]/.test(content)) {
    displayStarts = new Array(lineStarts.length)
    let shift = 0
    for (let line = 0; line < lineStarts.length; line += 1) {
      displayStarts[line] = lineStarts[line]! + shift
      const start = lineStarts[line]!
      const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : content.length
      const text = content.slice(start, end)
      if (!PRINTABLE_ASCII.test(text)) shift += cellColumnAt(text, text.length, measure) - text.length
    }
  }
  lastTable = { content, lineStarts, displayStarts }
  return displayStarts
}

function lineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low
}

function lineText(content: string, lineStarts: readonly number[], line: number): string {
  const start = lineStarts[line] ?? content.length
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : content.length
  return content.slice(start, end)
}

/** A string index as the buffer's display offset (selections, `cursorOffset`). */
export function displayOffsetAt(content: string, index: number, lineStarts: readonly number[], measure: CellMeasure): number {
  const displayStarts = displayStartsFor(content, lineStarts, measure)
  const clamped = Math.max(0, Math.min(index, content.length))
  if (!displayStarts) return clamped
  const line = lineAt(lineStarts, clamped)
  return displayStarts[line]! + cellColumnAt(lineText(content, lineStarts, line), clamped - lineStarts[line]!, measure)
}

/** A display offset from the buffer as a string index. */
export function indexAtDisplayOffset(content: string, displayOffset: number, lineStarts: readonly number[], measure: CellMeasure): number {
  const displayStarts = displayStartsFor(content, lineStarts, measure)
  const clamped = Math.max(0, displayOffset)
  if (!displayStarts) return Math.min(clamped, content.length)
  const line = lineAt(displayStarts, clamped)
  return lineStarts[line]! + indexAtCellColumn(lineText(content, lineStarts, line), clamped - displayStarts[line]!, measure)
}

/** Drop measured graphemes and any native scratch buffers when the editor is disabled. */
export function clearEditorCellMeasureCache(): void {
  for (const measure of measures.values()) measure.dispose?.()
  measures.clear()
}
