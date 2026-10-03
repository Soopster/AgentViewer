import { detectEditorIndentUnit, transformEditorCase, transformEditorLines, trimEditorTrailingWhitespace } from './editorTransforms'

const moved = transformEditorLines('alpha\nbeta\ngamma\n', 6, 6, 'move-up')
if (moved.content !== 'beta\nalpha\ngamma\n' || moved.start !== 0) throw new Error(`Move line up failed: ${JSON.stringify(moved)}`)
const movedDown = transformEditorLines(moved.content, 0, 4, 'move-down')
if (movedDown.content !== 'alpha\nbeta\ngamma\n') throw new Error(`Move line down failed: ${JSON.stringify(movedDown)}`)
const sorted = transformEditorLines('zeta\nAlpha\nitem10\nitem2\n', 0, 24, 'sort')
if (sorted.content !== 'Alpha\nitem2\nitem10\nzeta\n') throw new Error(`Natural line sort failed: ${JSON.stringify(sorted)}`)
const duplicated = transformEditorLines('one\ntwo\n', 0, 7, 'duplicate')
if (duplicated.content !== 'one\ntwo\none\ntwo\n') throw new Error(`Duplicate selected lines failed: ${JSON.stringify(duplicated)}`)
const upper = transformEditorCase('const café = 1', 7, 7, 'upper')
if (upper.content !== 'const CAFÉ = 1') throw new Error(`Unicode word uppercase failed: ${JSON.stringify(upper)}`)
const trimmed = trimEditorTrailingWhitespace('one  \n two\t\n')
if (trimmed.content !== 'one\n two\n') throw new Error(`Trailing whitespace cleanup failed: ${JSON.stringify(trimmed)}`)
if (detectEditorIndentUnit('if true:\n    value = 1\n', 'main.py') !== '    '
  || detectEditorIndentUnit('if (ok) {\n\treturn\n}', 'main.go') !== '\t'
  || detectEditorIndentUnit('', 'main.ts') !== '  ') throw new Error('Indent-unit inference failed')

console.log('Editor move/sort/duplicate/Unicode-case/whitespace transform smoke passed')

// --- Adversarial cases: file boundaries, mixed indentation, Unicode words ---

// A comment-continuation line (" * …") carries one leading space. It is not an
// indent unit — Math.max(2, …) below already refuses to report one — so it must
// not be allowed to decide the file's indentation.
const jsdocTabs = '/**\n * Does a thing.\n * @param x the x\n */\nfunc main() {\n\tif ok {\n\t\treturn\n\t}\n}'
const jsdocSpaces = '/**\n * hi\n */\nfunction f() {\n    return 1\n}'
if (detectEditorIndentUnit(jsdocTabs, 'main.go') !== '\t') {
  throw new Error(`A doc comment flipped a tab-indented file to spaces: ${JSON.stringify(detectEditorIndentUnit(jsdocTabs, 'main.go'))}`)
}
if (detectEditorIndentUnit(jsdocSpaces, 'a.js') !== '    ') {
  throw new Error(`A doc comment shrank a 4-space file: ${JSON.stringify(detectEditorIndentUnit(jsdocSpaces, 'a.js'))}`)
}
if (detectEditorIndentUnit('a\n  b\n    c\n', 'a.ts') !== '  '
  || detectEditorIndentUnit('a\n\tb\n\t\tc\n', 'a.ts') !== '\t'
  || detectEditorIndentUnit('plain text\n', 'notes.txt') !== '  ') {
  throw new Error('Plain indent inference drifted')
}

// Line transforms on a buffer with no trailing newline must not invent one.
if (transformEditorLines('a\nb', 2, 2, 'move-up').content !== 'b\na'
  || transformEditorLines('a\nb', 0, 0, 'move-down').content !== 'b\na'
  || transformEditorLines('abc', 1, 1, 'duplicate').content !== 'abc\nabc') {
  throw new Error('Line transforms altered the trailing-newline state of the buffer')
}
// The phantom line after a trailing newline is not a line to swap with.
if (transformEditorLines('a\nb\n', 2, 2, 'move-down').content !== 'a\nb\n') {
  throw new Error('Move-down walked onto the phantom line after the trailing newline')
}
// Nothing above line 0, and nothing to do in an empty buffer.
for (const transform of ['move-up', 'move-down', 'sort', 'duplicate'] as const) {
  const result = transformEditorLines('', 0, 0, transform)
  if (result.start !== (transform === 'duplicate' ? 1 : 0) || result.end !== result.start) {
    throw new Error(`Empty-buffer ${transform} produced a stray caret: ${JSON.stringify(result)}`)
  }
}
if (transformEditorLines('only\n', 0, 0, 'move-up').content !== 'only\n') throw new Error('Move-up off the top of the buffer must be a no-op')

// A caret past the end of the destination line clamps rather than overshooting.
const clampedCaret = transformEditorLines('aaaa\nb\n', 4, 4, 'move-down')
if (clampedCaret.content !== 'b\naaaa\n' || clampedCaret.start !== 6) {
  throw new Error(`Move-down did not clamp the caret to the shorter line: ${JSON.stringify(clampedCaret)}`)
}

// Case transforms may change length (ß -> SS); the reported range must describe
// the replacement, not the source.
const sharpS = transformEditorCase('straße', 0, 6, 'upper')
if (sharpS.content !== 'STRASSE' || sharpS.end !== 7) throw new Error(`Length-changing uppercase drifted: ${JSON.stringify(sharpS)}`)
// A caret inside a word takes the whole word, combining marks and all.
const combiningWord = transformEditorCase('let café = 1', 6, 6, 'upper')
if (combiningWord.content !== 'let CAFÉ = 1') throw new Error(`Combining-mark word case failed: ${JSON.stringify(combiningWord)}`)
// A selection that cuts a surrogate pair must not corrupt the buffer.
const halfPair = transformEditorCase('a\u{1F600}b', 0, 2, 'upper')
if (/[\uD800-\uDFFF]/.test(halfPair.content.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))) {
  throw new Error(`Case transform left a lone surrogate: ${JSON.stringify(halfPair.content)}`)
}
if (transformEditorCase('', 0, 0, 'upper').content !== '') throw new Error('Case transform on an empty buffer must be a no-op')

// Trailing-whitespace trimming touches spaces and tabs only, on every line
// including an unterminated last one, and never the newlines themselves.
const trimmedMixed = trimEditorTrailingWhitespace('a \t \nb\n\t\nc  ')
if (trimmedMixed.content !== 'a\nb\n\nc') throw new Error(`Trailing whitespace trim drifted: ${JSON.stringify(trimmedMixed.content)}`)
if (trimEditorTrailingWhitespace('').content !== '') throw new Error('Trimming an empty buffer must be a no-op')

console.log('Editor transform boundary/indent/Unicode-case smoke passed')
