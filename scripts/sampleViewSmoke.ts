// A sample reads as aligned input rows and a bounded, gutter-marked result; wrapped lines hang under their value.
import assert from 'node:assert/strict'
import { inputRows, resultView, sampleLines, SAMPLE_VIEW_LIMITS, wrapWithIndent } from '../lib/adaptiveUi/sampleView'
const text = (lines: ReturnType<typeof sampleLines>) => lines.map(line => line.parts.map(([t]) => t).join(''))

// Wrapping: within width, hanging indent, long tokens split, nothing lost.
const wrapped = wrapWithIndent('alpha beta gamma delta epsilon zeta', 12, 2, 4)
assert.ok(wrapped.every(line => line.length <= 12), JSON.stringify(wrapped)); assert.ok(wrapped[0]!.startsWith('  ') && wrapped.slice(1).every(line => line.startsWith('    ')))
assert.equal(wrapped.join(' ').replace(/\s+/g, ' ').trim(), 'alpha beta gamma delta epsilon zeta')
assert.deepEqual(wrapWithIndent('x'.repeat(25), 10).map(line => line.length), [10, 10, 5])

// Input: one aligned row per argument; objects compacted; long values cut.
const sample = { input: { createIfEmpty: true, name: 'x', filter: { a: 1, b: [1, 2] }, note: 'n'.repeat(500) }, result: { text: '{"ok":true,"items":[{"id":1},{"id":2}]}', isError: false } }
assert.deepEqual(inputRows(sample.input).map(([key]) => key), ['createIfEmpty', 'name', 'filter', 'note'])
assert.equal(inputRows(sample.input)[2]![1], '{"a":1,"b":[1,2]}'); assert.ok(inputRows(sample.input)[3]![1].length <= SAMPLE_VIEW_LIMITS.valueChars)
const lines = text(sampleLines(sample, 0, 3, 60))
assert.equal(lines[0], 'Sample 1 of 3'); assert.equal(lines[1], 'Input')
assert.ok(lines[2]!.startsWith('  createIfEmpty  true')); assert.ok(lines[3]!.startsWith('  name           x'), 'values line up in one column')
assert.ok(lines.every(line => line.length <= 60), `no line is wider than the pane: ${lines.filter(line => line.length > 60)[0]}`)
const noteStart = lines.findIndex(line => line.includes('nnnn')); assert.ok(lines[noteStart + 1]!.startsWith(' '.repeat(2 + 13 + 2)), 'a wrapped value hangs under its value')

// Result: valid JSON is pretty-printed behind a gutter; text is wrapped behind one; an error is marked in words.
assert.equal(resultView(sample).kind, 'json'); assert.ok(lines.includes('Result')); assert.ok(lines.some(line => line.startsWith('  │ ') && line.includes('"ok": true')))
const err = text(sampleLines({ input: {}, result: { text: 'Browser extension is not connected. '.repeat(40), isError: true } }, 0, 1, 70))
assert.ok(err.includes('Sample') && err.includes('  (no arguments)') && err.includes('Result · error'))
const gutter = err.filter(line => line.startsWith('  │ ')); assert.ok(gutter.length <= SAMPLE_VIEW_LIMITS.textLines + 1 && gutter.at(-1)!.includes('more line'), 'long text is cut, and says how much')
// Bounded JSON, and a call that never finished.
const big = text(sampleLines({ input: { a: 1 }, result: { text: JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ i })) }), isError: false } }, 0, 1, 80))
assert.ok(big.filter(line => line.startsWith('  │ ')).length <= SAMPLE_VIEW_LIMITS.jsonLines + 1 && big.at(-1)!.includes('more lines'))
assert.ok(text(sampleLines({ input: { a: 1 } }, 0, 1, 80)).includes('  (the call had not finished: no result kept)'))
// Colour is never the only signal: an error's tone and its words travel together.
assert.ok(sampleLines({ input: {}, result: { text: 'boom', isError: true } }, 0, 1, 80).some(line => line.parts.some(([t, tone]) => t === 'Result · error' && tone === 'bad')))
assert.ok(text(sampleLines(sample, 0, 1, 10)).every(line => line.length <= SAMPLE_VIEW_LIMITS.minWidth + 6), 'a very narrow pane is clamped, not broken')
console.log('sampleViewSmoke: ok')
