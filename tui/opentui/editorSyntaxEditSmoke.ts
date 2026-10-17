// A wrong tree-sitter edit fails silently, which is the whole reason this
// exists. The parser applies the range it is handed to its own copy of the
// tree; if that range names the wrong rows or the wrong columns, the tree
// diverges from the buffer and every highlight after it decorates the wrong
// text — with no error, no exception, and a screen that still looks plausible.
//
// So the incremental path is checked against the obvious-but-slow one: for
// every edit, the positions must equal a fresh scan of the content, and the
// line table carried forward across edits must equal a table rebuilt from
// scratch. Both were verified to fail when the tail shift in
// `advanceLineStarts` is skewed by one and when the newline rescan is dropped.
import { advanceLineStarts, editorLineStarts, editorSyntaxEdit } from './editorSyntaxBuffer'

function referencePosition(content: string, offset: number): { row: number; column: number } {
  let row = 0
  let lineStart = 0
  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      row += 1
      lineStart = index + 1
    }
  }
  return { row, column: offset - lineStart }
}

function check(before: string, after: string, starts: readonly number[], label: string): number[] {
  const edit = editorSyntaxEdit(before, after, starts)
  const fresh = editorLineStarts(after)
  if (before === after) {
    if (edit !== null) throw new Error(`${label}: an identical content produced an edit`)
    return fresh
  }
  if (!edit) throw new Error(`${label}: a changed content produced no edit`)

  // The range must actually describe the transformation.
  const rebuilt = before.slice(0, edit.startIndex)
    + after.slice(edit.startIndex, edit.newEndIndex)
    + before.slice(edit.oldEndIndex)
  if (rebuilt !== after) throw new Error(`${label}: the edit range does not reconstruct the new content`)
  if (edit.startIndex > edit.oldEndIndex || edit.startIndex > edit.newEndIndex) {
    throw new Error(`${label}: the edit range runs backwards`)
  }

  const expected = {
    startPosition: referencePosition(before, edit.startIndex),
    oldEndPosition: referencePosition(before, edit.oldEndIndex),
    newEndPosition: referencePosition(after, edit.newEndIndex),
  }
  for (const key of ['startPosition', 'oldEndPosition', 'newEndPosition'] as const) {
    const actual = edit[key]
    const want = expected[key]
    if (actual.row !== want.row || actual.column !== want.column) {
      throw new Error(
        `${label}: ${key} was ${actual.row}:${actual.column}, expected ${want.row}:${want.column}`,
      )
    }
  }

  const advanced = advanceLineStarts(
    starts, after, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, edit.startPosition.row,
  )
  if (advanced.length !== fresh.length || advanced.some((value, index) => value !== fresh[index])) {
    throw new Error(
      `${label}: the carried line table diverged (${advanced.length} entries vs ${fresh.length})`,
    )
  }
  return advanced
}

// Named cases first, so a failure names the shape rather than a seed.
const cases: Array<[string, string, string]> = [
  ['append at end', 'a\nb\nc\n', 'a\nb\nc\nd'],
  ['insert at start', 'a\nb\n', 'X\na\nb\n'],
  ['insert a newline mid-line', 'alpha beta\n', 'alpha\n beta\n'],
  ['delete a newline', 'a\nb\nc\n', 'a\nbc\n' + ''],
  ['delete across several lines', 'a\nb\nc\nd\ne\n', 'a\ne\n'],
  ['replace the whole content', 'a\nb\n', 'zzz'],
  ['empty to content', '', 'a\nb\n'],
  ['content to empty', 'a\nb\n', ''],
  ['no trailing newline', 'a\nb', 'a\nbc'],
  ['edit on the last line', 'a\nb\nc', 'a\nb\ncd'],
  ['a lone newline', '\n', '\n\n'],
  ['surrogate pairs', 'a😀b\nc\n', 'a😀bZ\nc\n'],
  ['identical', 'a\nb\n', 'a\nb\n'],
]
for (const [label, before, after] of cases) check(before, after, editorLineStarts(before), label)

// A run long enough to cross the block-comparison boundary, so the fast path
// and its remainder loop are both exercised on real-sized content.
const seedLines: string[] = []
for (let index = 0; index < 900; index += 1) {
  seedLines.push(`export function row${index}(value: number): string { return \`r-${index}-\${value}\` }`)
}
let content = `${seedLines.join('\n')}\n`
let starts = editorLineStarts(content)
if (content.length < 8_192) throw new Error('The randomized corpus is too small to reach the block scan')

let seed = 0x2f6e2b1
const random = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
  return ((seed >>> 0) % 1_000_000) / 1_000_000
}
const inserts = ['x', '\n', 'const ', '\n  return 1\n', '()', '😀', '// note\n']
for (let step = 0; step < 3_000; step += 1) {
  const offset = Math.floor(random() * (content.length + 1))
  const after = random() < 0.35
    ? content.slice(0, offset) + content.slice(Math.min(content.length, offset + 1 + Math.floor(random() * 40)))
    : content.slice(0, offset) + inserts[Math.floor(random() * inserts.length)]! + content.slice(offset)
  starts = check(content, after, starts, `randomized step ${step} at ${offset}`)
  content = after
  if (content.length === 0) { content = 'a\nb\n'; starts = editorLineStarts(content) }
}

console.log('editor syntax edit smoke passed')
