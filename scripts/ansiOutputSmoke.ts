// Terminal colour codes in tool output must come out as styled runs whose text
// is exactly the visible text: no escape left behind, no character lost.
import assert from 'node:assert/strict'
import { ansiHighlighterReady, ansiRuns, hasAnsiStyle, loadAnsiHighlighter, stripAnsi } from '../lib/ansiOutput'

const sample = '\x1b[31mFAIL\x1b[0m src/a.ts\n\x1b[1;4;38;5;208mwarn\x1b[0m plain \x1b[2K\x1b[42mgreen bg\x1b[49m\n\x1b[3mé😀漢\x1b[23m'

assert.equal(hasAnsiStyle('plain text'), false)
assert.equal(hasAnsiStyle('\x1b[2K only erase'), false, 'cursor/erase sequences carry no style')
assert.equal(hasAnsiStyle(sample), true)
assert.equal(ansiRuns(sample, 'dark'), null, 'answers null until the highlighter has loaded')

assert.equal(await loadAnsiHighlighter(), true)
assert.equal(ansiHighlighterReady(), true)

for (const appearance of ['dark', 'light'] as const) {
  const lines = ansiRuns(sample, appearance)!
  assert.ok(lines, 'highlighter produced runs')
  const visible = lines.map(line => line.map(run => run.text).join('')).join('\n')
  assert.equal(visible, stripAnsi(sample), `${appearance}: runs reassemble to the visible text`)
  assert.ok(!visible.includes('\x1b'), 'no escape survives')

  const fail = lines[0]![0]!
  assert.equal(fail.text, 'FAIL')
  assert.ok(fail.color, 'red text keeps a colour')
  assert.equal(lines[0]![1]!.color, undefined, 'default-coloured text carries no colour of its own')
  const warn = lines[1]![0]!
  assert.ok(warn.bold && warn.underline, 'bold + underline flags survive')
  assert.ok(lines[1]!.some(run => run.background), 'background colours survive')
  assert.ok(lines[2]![0]!.italic, 'italic survives and non-ASCII text is intact')
}
assert.notEqual(ansiRuns(sample, 'dark')![0]![0]!.color, ansiRuns(sample, 'light')![0]![0]!.color, 'the palette follows the appearance')
console.log('ANSI output smoke passed')
