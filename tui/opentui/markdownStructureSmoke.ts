import assert from 'node:assert/strict'
import { markdownCodeChunks, markdownTableWidths } from './markdownStructure'
import type { SimpleHighlight } from '@opentui/core'

const source = Array.from({ length: 100 }, (_, index) => `line_${index} 界 😀`).join('\n')
const captures: SimpleHighlight[] = [[0, source.length, 'comment'], [source.indexOf('line_50'), source.indexOf('line_51'), 'string']]
const chunks = markdownCodeChunks(source, 32, captures)
assert.equal(chunks.map(chunk => chunk.text).join('\n'), source, 'chunking preserves every code unit, newline and trailing line')
assert.equal(chunks.length, 4)
assert.ok(chunks.every(chunk => chunk.highlights?.[0]?.[2] === 'comment'), 'whole-source comment state crosses every boundary')
for (const chunk of chunks) for (const [start, end] of chunk.highlights!) {
  assert.ok(start >= 0 && end <= chunk.text.length && end > start)
}
assert.equal(chunks[1]!.highlights!.at(-1)![2], 'string', 'overlap precedence follows the original capture order')
for (const text of ['', 'one\n', '\n', 'CRLF\r\n界\r\n']) assert.equal(markdownCodeChunks(text, 1).map(chunk => chunk.text).join('\n'), text)
const concealed = markdownCodeChunks('one\ntwo\nthree\nfour', 1, [[0, 13, 'conceal', { conceal: 'replacement' }]])
assert.equal(concealed[0]?.text, 'one\ntwo\nthree', 'replacement captures cannot be repeated at chunk boundaries')
assert.deepEqual(markdownTableWidths([4, 4], 9), [3, 3], 'ties allocate left to right')
assert.deepEqual(markdownTableWidths([30, 2, 3], 30), [21, 2, 3])
assert.deepEqual(markdownTableWidths([5, 6], 100), [5, 6], 'content tables do not stretch into unused width')
for (let columns = 1; columns <= 12; columns++) for (let width = 1; width < 160; width++) {
  const original = Array.from({ length: columns }, (_, index) => index * 13 % 71 + 1)
  const fitted = markdownTableWidths(original, width)
  const target = Math.max(columns, width - columns - 1)
  assert.equal(fitted.reduce((sum, value) => sum + value, 0), Math.min(original.reduce((sum, value) => sum + value, 0), target))
  assert.ok(fitted.every((value, index) => value >= 1 && value <= original[index]!))
}
console.log('Markdown structure passed: source/capture parity, Unicode/CRLF/trailing lines, precedence and bounded table-width allocation')
