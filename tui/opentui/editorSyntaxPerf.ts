// Per-edit cost of the highlighting pipeline's pure functions, swept by file
// size.
//
// `editorTypingPerf.tsx` measures the whole editor, which is the number a
// typist feels — but the highlighter's share of it is small and both of its
// hot functions are debounced, so a change worth 25x here moves `cpu/key`
// there by a fraction of that and lands inside the harness's run-to-run
// spread. This harness has no React, no worker, and no timers: it calls the
// functions directly, so the same change is unambiguous and reproduces to a
// few percent.
//
// The property being measured is the same one: cost must track the edit, not
// the file. Read the `growth` line, not the absolute milliseconds — a 100x
// file that costs 100x more per keystroke is the bug, whatever the constant.
//
//   bun run ./tui/opentui/editorSyntaxPerf.ts
//   EDITOR_SYNTAX_PERF_SIZES=200,20000 bun run ./tui/opentui/editorSyntaxPerf.ts
import { advanceLineStarts, editorLineStarts, editorSyntaxEdit } from './editorSyntaxBuffer'
import { classifyEditorOffset, matchingBracketAt } from './editorSyntaxContext'

const SIZES = (process.env.EDITOR_SYNTAX_PERF_SIZES ?? '200,2000,6000,20000')
  .split(',').map((value) => Number.parseInt(value.trim(), 10)).filter((value) => value > 0)
const REPS = Number.parseInt(process.env.EDITOR_SYNTAX_PERF_REPS ?? '', 10) || 400

// The same corpus editorTypingPerf.tsx types into, so the two harnesses are
// describing one editor rather than two different workloads.
function sourceOfLines(lines: number): string {
  const out: string[] = ['export type Row = { id: number; label: string; total: number }', '']
  for (let index = 0; out.length < lines; index += 1) {
    out.push(
      `export function computeRow${index}(rows: Row[], factor: number): number {`,
      `  const scaled = rows.map((row) => row.total * factor + ${index})`,
      `  const label = scaled.length > 0 ? \`row-${index}\` : 'empty'`,
      '  return scaled.reduce((sum, value) => sum + value, label.length)',
      '}',
      '',
    )
  }
  return `${out.slice(0, lines).join('\n')}\n`
}

type Caret = 'end' | 'middle' | 'start'

/** One keystroke's worth of parser bookkeeping: derive the edit, carry the line table. */
function timeEdit(source: string, caret: Caret, reps: number): number {
  let content = source
  let starts: readonly number[] = editorLineStarts(content)
  const caretAt = () => caret === 'end' ? content.length : caret === 'start' ? 0 : content.length >> 1
  // The splice is the harness's own cost, not the editor's, so it is done for
  // the warm-up too and the two runs differ only in what is being measured.
  const step = () => {
    const offset = caretAt()
    const after = `${content.slice(0, offset)}x${content.slice(offset)}`
    const edit = editorSyntaxEdit(content, after, starts)
    if (edit) {
      starts = advanceLineStarts(starts, after, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, edit.startPosition.row)
    }
    content = after
  }
  for (let index = 0; index < 50; index += 1) step()
  const startedAt = performance.now()
  for (let index = 0; index < reps; index += 1) step()
  return (performance.now() - startedAt) / reps
}

/**
 * The harness's own cost: building the post-edit string. The editor gets that
 * string from the text buffer rather than concatenating it, so this is not the
 * editor's work — but it is O(file) and it is inside the `edit` timings above,
 * where at 20,000 lines it is most of them. Subtract it before concluding that
 * the edit computation grew.
 */
function timeSplice(source: string, caret: Caret, reps: number): number {
  let content = source
  let sink = 0
  const caretAt = () => caret === 'end' ? content.length : caret === 'start' ? 0 : content.length >> 1
  const step = () => {
    const offset = caretAt()
    content = `${content.slice(0, offset)}x${content.slice(offset)}`
    sink += content.length
  }
  for (let index = 0; index < 50; index += 1) step()
  const startedAt = performance.now()
  for (let index = 0; index < reps; index += 1) step()
  const elapsed = (performance.now() - startedAt) / reps
  if (sink < 0) throw new Error('unreachable')
  return elapsed
}

/** The completion path's "am I in a comment or a string?" question, asked at the caret. */
function timeClassify(source: string, reps: number): number {
  for (let index = 0; index < 20; index += 1) classifyEditorOffset(source, source.length - index, 'main.ts')
  const startedAt = performance.now()
  for (let index = 0; index < reps; index += 1) classifyEditorOffset(source, source.length - (index % 64), 'main.ts')
  return (performance.now() - startedAt) / reps
}

/** Bracket matching from the caret, whose worst case is an unbalanced file. */
function timeBracket(source: string, reps: number): number {
  const offset = source.lastIndexOf('}')
  for (let index = 0; index < 20; index += 1) matchingBracketAt(source, offset, 'main.ts')
  const startedAt = performance.now()
  for (let index = 0; index < reps; index += 1) matchingBracketAt(source, offset, 'main.ts')
  return (performance.now() - startedAt) / reps
}

const ms = (value: number) => `${value.toFixed(4)}ms`

console.log('Editor syntax pipeline cost per edit, by file size')
console.log(`  ${REPS} repetitions per cell; cost must not grow with the file`)
console.log(
  `  ${'lines'.padStart(6)} ${'chars'.padStart(9)} ${'edit@end'.padStart(11)} ${'edit@mid'.padStart(11)}`
  + ` ${'edit@start'.padStart(11)} ${'splice'.padStart(11)} ${'classify'.padStart(11)} ${'bracket'.padStart(11)}`,
)

const rows: Array<{ lines: number; edit: number; classify: number }> = []
for (const lines of SIZES) {
  const source = sourceOfLines(lines)
  const editEnd = timeEdit(source, 'end', REPS)
  const editMiddle = timeEdit(source, 'middle', REPS)
  const editStart = timeEdit(source, 'start', REPS)
  const splice = timeSplice(source, 'end', REPS)
  const classify = timeClassify(source, REPS)
  const bracket = timeBracket(source, REPS)
  rows.push({ lines, edit: Math.max(0, editEnd - splice), classify })
  console.log(
    `  ${String(lines).padStart(6)} ${String(source.length).padStart(9)} ${ms(editEnd).padStart(11)}`
    + ` ${ms(editMiddle).padStart(11)} ${ms(editStart).padStart(11)} ${ms(splice).padStart(11)}`
    + ` ${ms(classify).padStart(11)} ${ms(bracket).padStart(11)}`,
  )
}

const smallest = rows[0]
const largest = rows.at(-1)
if (smallest && largest && largest !== smallest) {
  const ratio = largest.lines / smallest.lines
  console.log(
    `  growth at ${largest.lines} lines vs ${smallest.lines} (${ratio.toFixed(0)}x the file):`
    + ` edit ${(largest.edit / Math.max(1e-4, smallest.edit)).toFixed(1)}x (net of splice),`
    + ` classify ${(largest.classify / Math.max(1e-4, smallest.classify)).toFixed(1)}x`,
  )
}
