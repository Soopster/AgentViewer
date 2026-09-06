import assert from 'node:assert/strict'
import { countLinesUpTo } from '../lib/boundedLineCount'

const baseline = (text: string, cap: number) => Math.min(text.split('\n').length, cap)
for (const text of ['', 'one line', '\n', '\r\n', 'a\n\nb\n', 'a\u2028b', '😀\n日本語', 'line\n'.repeat(1000)]) {
  for (const cap of [1, 2, 20, 21, 25, 26, 1001]) {
    assert.equal(countLinesUpTo(text, cap), baseline(text, cap))
  }
}
let seed = 12345
for (let run = 0; run < 1000; run++) {
  let text = ''
  for (let i = 0; i < run % 300; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    text += ['x', '\n', '\r', ' ', '\t'][seed % 5]
  }
  assert.equal(countLinesUpTo(text, 26), baseline(text, 26))
}
function measure(operation: () => number) {
  const samples = []
  for (let i = 0; i < 25; i++) {
    const start = performance.now()
    const value = operation()
    const elapsed = performance.now() - start
    assert.ok(value > 0)
    if (i >= 5) samples.push(elapsed)
  }
  samples.sort((a, b) => a - b)
  return { p50Ms: samples[10], p95Ms: samples[18] }
}
for (const lines of [100, 10_000, 1_000_000]) {
  const text = 'tool output line\n'.repeat(lines)
  console.log(JSON.stringify({ workload: 'collapsed-tool-line-count', lines, cap: 26,
    before: measure(() => baseline(text, 26)), after: measure(() => countLinesUpTo(text, 26)) }))
}
console.log('Bounded line count parity passed, including trailing lines, CRLF and randomized inputs')
