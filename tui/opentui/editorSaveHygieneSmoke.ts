import {
  applyEditorSaveHygiene,
  applyEditorTextEdits,
  editorLineStartOffsets,
  editorPositionOffset,
  ensureEditorFinalNewline,
  trimEditorTrailingWhitespace,
} from './editorSaveHygiene'
import type { EditorTextEdit } from './editorLsp'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const edit = (
  startLine: number, startCharacter: number,
  endLine: number, endCharacter: number,
  newText: string,
): EditorTextEdit => ({
  range: { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } },
  newText,
})

// --- applying a server's edits ---------------------------------------------
// Formatting is the only thing here that can scramble a file rather than just
// annoy someone, and it does it silently: the text is still valid, just wrong.

const document = 'const a=1\nconst b=2\nconst c=3\n'

// Applied last-first. In document order, the second edit's offsets would have
// been shifted by the first one's length change.
const formatted = applyEditorTextEdits(document, [
  edit(0, 7, 0, 8, ' = '),
  edit(1, 7, 1, 8, ' = '),
  edit(2, 7, 2, 8, ' = '),
])
assert(formatted === 'const a = 1\nconst b = 2\nconst c = 3\n',
  `Multiple edits were not applied against the original document: ${JSON.stringify(formatted)}`)

// Order in the array must not matter — a server may send them in any order.
const shuffled = applyEditorTextEdits(document, [
  edit(2, 7, 2, 8, ' = '),
  edit(0, 7, 0, 8, ' = '),
  edit(1, 7, 1, 8, ' = '),
])
assert(shuffled === formatted, `Edit order changed the result: ${JSON.stringify(shuffled)}`)

// A whole-document replacement, which is what most formatters actually send.
const wholeFile = applyEditorTextEdits(document, [edit(0, 0, 3, 0, 'formatted\n')])
assert(wholeFile === 'formatted\n', `A whole-document edit did not replace the file: ${JSON.stringify(wholeFile)}`)

// An insert at the very end, and one at the very start.
assert(applyEditorTextEdits('a\n', [edit(1, 0, 1, 0, 'b\n')]) === 'a\nb\n', 'An append at EOF was lost')
assert(applyEditorTextEdits('a\n', [edit(0, 0, 0, 0, 'x')]) === 'xa\n', 'An insert at the start was lost')

// A character offset past the end of its line clamps to that line, rather than
// eating the newline and joining two lines together.
assert(applyEditorTextEdits('ab\ncd\n', [edit(0, 99, 0, 99, '!')]) === 'ab!\ncd\n',
  'A column past the end of a line must clamp to the line end')

// Overlapping edits mean the server contradicted itself. There is no safe
// guess, so this refuses rather than writing a spliced-together document.
let overlapRefused = false
try {
  applyEditorTextEdits('abcdef\n', [edit(0, 0, 0, 4, 'X'), edit(0, 2, 0, 6, 'Y')])
} catch {
  overlapRefused = true
}
assert(overlapRefused, 'Overlapping edits were applied instead of refused')

// The bug this replaced: an out-of-range column resolved to null, and
// `slice(0, null)` truncated the document to nothing without a word.
assert(applyEditorTextEdits('keep me\n', [edit(0, 200, 0, 200, '!')]) === 'keep me!\n',
  'An out-of-range column must clamp, not truncate the file')

assert(applyEditorTextEdits(document, []) === document, 'An empty edit list changed the document')

// Positions are UTF-16 code units, so an astral character counts as two — an
// offset computed in code points would land inside the surrogate pair.
const astral = 'a😀b\n'
const astralStarts = editorLineStartOffsets(astral)
assert(editorPositionOffset(astral, astralStarts, { line: 0, character: 3 }) === 3,
  'A position after an astral character must be counted in UTF-16 units')
assert(applyEditorTextEdits(astral, [edit(0, 3, 0, 4, 'B')]) === 'a😀B\n',
  'An edit after an astral character replaced the wrong text')

// CRLF never reaches here — the buffer is LF-only — but a lone \r inside a line
// must not be treated as a line break.
const carriage = 'a\rb\nc\n'
assert(editorLineStartOffsets(carriage).length === 3, 'A bare carriage return must not start a line')

console.log('Editor save-hygiene edit-application smoke passed')

// --- whitespace hygiene -----------------------------------------------------

assert(trimEditorTrailingWhitespace('a  \nb\t\nc\n') === 'a\nb\nc\n', 'Trailing whitespace was not trimmed')
assert(trimEditorTrailingWhitespace('  indented\n') === '  indented\n', 'Leading whitespace must survive')
assert(trimEditorTrailingWhitespace('a\n\n\nb\n') === 'a\n\n\nb\n', 'Blank lines must stay blank, not vanish')
assert(trimEditorTrailingWhitespace('   \n') === '\n', 'A whitespace-only line must be emptied')
// The caret's own line is exempt: trimming it mid-indent deletes the
// whitespace the user is standing in and drops them to column 1.
assert(trimEditorTrailingWhitespace('a  \n    \nc  \n', 1) === 'a\n    \nc\n',
  'The caret line must keep its trailing whitespace')
const clean = 'a\nb\n'
assert(trimEditorTrailingWhitespace(clean) === clean, 'A clean file must come back as the same string')

assert(ensureEditorFinalNewline('a') === 'a\n', 'A missing final newline was not added')
assert(ensureEditorFinalNewline('a\n') === 'a\n', 'A final newline was doubled')
assert(ensureEditorFinalNewline('') === '', 'An empty file must not gain a newline')
assert(ensureEditorFinalNewline('a\n\n') === 'a\n\n', 'A deliberate blank last line must survive')

// Off by default, because each of these rewrites lines nobody touched.
const messy = 'a  \nb'
assert(applyEditorSaveHygiene(messy, { trimTrailingWhitespace: false, finalNewline: false, formatOnSave: false }) === messy,
  'Save hygiene must do nothing when it is switched off')
assert(applyEditorSaveHygiene(messy, { trimTrailingWhitespace: true, finalNewline: true, formatOnSave: false }) === 'a\nb\n',
  'Save hygiene did not apply both enabled transforms')

console.log('Editor save-hygiene whitespace smoke passed')
