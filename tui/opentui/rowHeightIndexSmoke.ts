import assert from 'node:assert/strict'
import { RowHeightIndex } from './rowHeightIndex'
const values = Array.from({ length: 1000 }, (_, index) => index % 13 + 1)
const index = new RowHeightIndex(values)
for (let step = 0; step < 300; step++) {
 const at = step * 197 % values.length
 const next = step % 41 + 1
 values[at] = next
 index.update(at, next)
 let offset = 0
 for (let i = 0; i < values.length; i++) {
  assert.equal(index.offset(i), offset)
  assert.equal(index.at(offset), i)
  assert.equal(index.at(offset + values[i]! - 1), i)
  offset += values[i]!
 }
 assert.equal(index.total, offset)
 assert.equal(index.at(offset), values.length)
 const window = index.window(step * 17, 40)
 assert.equal(window.before + index.offset(window.end) - index.offset(window.start) + window.after, offset)
}
assert.deepEqual(new RowHeightIndex([]).window(0, 40), { start: 0, end: 0, before: 0, after: 0 })
assert.equal(new RowHeightIndex([NaN, Infinity, 0, -4]).total, 4)
console.log('Row height index passed: variable measurements, offsets, inverse lookup, empty and invalid heights')
const { deriveRowReaderWindow } = await import('./readerWindowStore')
const mixed = new RowHeightIndex([1, 1, 5000, 1, 1, 10000])
assert.deepEqual(deriveRowReaderWindow(mixed, 120, 120, true, null), { start: 5, end: 6, maxStart: 5 })
assert.deepEqual(deriveRowReaderWindow(mixed, 120, 120, false, 0), { start: 0, end: 3, maxStart: 5 })
const uniform = new RowHeightIndex(Array(1000).fill(4))
assert.deepEqual(deriveRowReaderWindow(uniform, 120, 120, true, null), { start: 970, end: 1000, maxStart: 970 })
assert.equal(deriveRowReaderWindow(uniform, 120, 120, false, 500).end, 530)
console.log('Row-budget reader windows passed: tall single cards, detached ranges, tail and safety cap')
// A tall penultimate region followed by three short messages used to put the
// physical scrollbar at its bottom while the mounted range omitted the tail.
const tallBeforeTail = new RowHeightIndex([...Array(20).fill(8), 1000, 3, 3, 3])
const liveTail = deriveRowReaderWindow(tallBeforeTail, 120, 200, true, null)
assert.equal(liveTail.end, tallBeforeTail.length, 'following must include all three newest messages after a tall card')
const detachedEnd = deriveRowReaderWindow(tallBeforeTail, 120, 200, false, liveTail.maxStart)
assert.equal(detachedEnd.end, tallBeforeTail.length, 'the final detached window must also reach the true tail')
for (let count = 1; count <= 300; count++) {
 const varied = new RowHeightIndex(Array.from({ length: count }, (_, i) => i % 7 ? i % 13 + 1 : 1_000))
 for (const budget of [1, 19, 120, 241, 1000]) {
  const tail = deriveRowReaderWindow(varied, 120, budget, true, null)
  assert.equal(tail.end, count, `tail excludes messages: count=${count}, budget=${budget}`)
  assert.ok(tail.end - tail.start <= 120, 'keep the card safety cap')
 }
}
console.log('Tail completeness passed: tall-card boundary, detached end and 1500 varied layouts')
