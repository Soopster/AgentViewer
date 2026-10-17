// The editor converts between string indices and the buffer's display cells
// in editorCells.ts. A wrong conversion fails silently — a cursor, a replaced
// range or a highlight lands a cell off — so this compares it against a real
// edit buffer on random lines mixing every kind of character that is not one
// cell wide.
import assert from 'node:assert/strict'
import * as core from '@opentui/core'
import {
  bufferCellMeasure,
  cellColumnAt,
  graphemeWidthReader,
  displayOffsetAt,
  indexAtCellColumn,
  indexAtDisplayOffset,
} from './editorCells'

const measure = bufferCellMeasure('unicode')
// The ground truth is a real edit buffer (0.6 requires it an owner).
const ResourceContext = (core as unknown as { ResourceContext?: new (o: { objectCapacity: number; renderCellsMax: number }) => unknown }).ResourceContext
const truth = (core.EditBuffer as unknown as { create: (w: string, o?: unknown) => core.EditBuffer }).create(
  'unicode',
  ResourceContext ? new ResourceContext({ objectCapacity: 16, renderCellsMax: 65536 }) : undefined,
)

const cellsOf = (text: string) => {
  truth.setText(text)
  truth.setCursor(0, 0)
  return truth.getEOL().col
}

const PIECES = ['a', 'Z', ' ', '\t', '中', '日本', '👍🏽', '👨‍👩‍👧', 'é', 'é', '\f', '\x07', '\x1b', 'x']
let seed = 7
const random = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed % n
}
const randomLine = () => Array.from({ length: 1 + random(12) }, () => PIECES[random(PIECES.length)]).join('')
const boundaries = (line: string) => {
  const ends = [0]
  for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)) ends.push(index + segment.length)
  return ends
}

let checked = 0
for (let round = 0; round < 400; round += 1) {
  const line = randomLine()
  // Index → cells, at every grapheme boundary, against the buffer's own width
  // of that prefix.
  for (const index of boundaries(line)) {
    assert.equal(cellColumnAt(line, index, measure), cellsOf(line.slice(0, index)),
      `cells before index ${index} of ${JSON.stringify(line)}`)
    // And back: the column of a boundary is that boundary.
    assert.equal(indexAtCellColumn(line, cellsOf(line.slice(0, index)), measure), index,
      `index at the cell column of boundary ${index} of ${JSON.stringify(line)}`)
    checked += 1
  }
  // Cells → index for every column. The result must be the grapheme the
  // buffer's cursor sits on: a boundary whose column is at or before the
  // cursor, with the next boundary past it. (0.5 lets a cursor rest inside a
  // wide character; its index is that character's start.)
  const ends = boundaries(line)
  const total = cellsOf(line)
  for (let column = 0; column <= total; column += 1) {
    truth.setText(line)
    truth.setCursor(0, column)
    const cursor = truth.getCursorPosition().col
    const index = indexAtCellColumn(line, cursor, measure)
    assert.ok(ends.includes(index), `column ${column} of ${JSON.stringify(line)} gave ${index}, not a grapheme boundary`)
    const at = cellsOf(line.slice(0, index))
    const next = ends.find((end) => end > index)
    assert.ok(at <= cursor && (next === undefined || cellsOf(line.slice(0, next)) > cursor || at === cursor),
      `column ${cursor} of ${JSON.stringify(line)} gave index ${index} at column ${at}`)
    checked += 1
  }
}

// Whole documents: display offsets are what selections and cursorOffset use.
for (let round = 0; round < 60; round += 1) {
  const lines = Array.from({ length: 1 + random(6) }, () => (random(3) === 0 ? 'plain ascii line' : randomLine()))
  const content = lines.join('\n')
  const lineStarts = [0]
  for (let i = 0; i < content.length; i += 1) if (content[i] === '\n') lineStarts.push(i + 1)
  for (let line = 0; line < lines.length; line += 1) {
    for (const index of boundaries(lines[line]!)) {
      const stringOffset = lineStarts[line]! + index
      const column = cellsOf(lines[line]!.slice(0, index))
      truth.setText(content)
      const expected = truth.positionToOffset(line, column)
      assert.equal(displayOffsetAt(content, stringOffset, lineStarts, measure), expected,
        `display offset of index ${stringOffset} in ${JSON.stringify(content)}`)
      assert.equal(indexAtDisplayOffset(content, expected, lineStarts, measure), stringOffset,
        `index at display offset ${expected} in ${JSON.stringify(content)}`)
      checked += 1
    }
  }
}

// Both width readers agree: measureEditText where this OpenTUI has it, and the
// scratch buffer older builds fall back to.
const viaBuffer = graphemeWidthReader('unicode', { viaBuffer: true })
for (const piece of PIECES) assert.equal(viaBuffer(piece), cellsOf(piece), `scratch-buffer width of ${JSON.stringify(piece)}`)
const native = typeof (core as unknown as { measureEditText?: unknown }).measureEditText === 'function'

// Plain ASCII is the fast path and must stay the identity.
assert.equal(displayOffsetAt('abc\ndef', 5, [0, 4], measure), 5)
assert.equal(indexAtDisplayOffset('abc\ndef', 5, [0, 4], measure), 5)

console.log(`editor cells smoke passed (${checked} positions agree with the edit buffer; widths from ${native ? 'measureEditText' : 'a scratch buffer'}, both readers checked)`)
