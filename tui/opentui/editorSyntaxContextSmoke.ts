import { classifyEditorOffset, editorSyntaxForPath, indentForClosingBracket, matchingBracketAt } from './editorSyntaxContext'

function expectKind(content: string, marker: string, path: string, expected: string) {
  const offset = content.indexOf(marker)
  if (offset < 0) throw new Error(`Marker ${marker} missing from fixture`)
  const actual = classifyEditorOffset(content, offset + marker.length, path)
  if (actual !== expected) {
    throw new Error(`Expected ${expected} after ${JSON.stringify(marker)} in ${path}, got ${actual}`)
  }
}

const ts = [
  'const total = 1 // running tot',
  'const label = "user na"',
  '/* block com',
  ' still com */',
  'const tmpl = `line one',
  'line two temp`',
  "const it = doesn't matter",
  'function run() { retur',
].join('\n')

expectKind(ts, '// running tot', 'a.ts', 'comment')
expectKind(ts, '"user na', 'a.ts', 'string')
expectKind(ts, 'block com', 'a.ts', 'comment')
expectKind(ts, 'still com', 'a.ts', 'comment')
expectKind(ts, 'line two temp', 'a.ts', 'string')
expectKind(ts, 'retur', 'a.ts', 'code')
// An apostrophe in prose must not swallow the rest of the file as a string.
expectKind(ts, "doesn't matt", 'a.ts', 'code')

const py = ['# note her', 'x = """doc her', 'still doc"""', 'y = spa'].join('\n')
expectKind(py, '# note her', 'a.py', 'comment')
expectKind(py, '"""doc her', 'a.py', 'string')
expectKind(py, 'still doc', 'a.py', 'string')
expectKind(py, 'y = spa', 'a.py', 'code')
// `#` is not a comment token in TypeScript.
expectKind('const a = 1 # not a com', '# not a com', 'a.ts', 'code')
// A hash inside a JS string stays a string, not a comment.
expectKind('const a = "# not a com"', '# not a com', 'a.py', 'string')

const escaped = 'const a = "quote \\" inside" + tai'
if (classifyEditorOffset(escaped, escaped.length, 'a.ts') !== 'code') {
  throw new Error('Escaped quote inside a string ended the string early')
}

const brackets = 'call(one, two[three], {four: 5})'
const outer = matchingBracketAt(brackets, brackets.indexOf('('), 'a.ts')
if (outer?.open !== 4 || outer.close !== brackets.length - 1) {
  throw new Error(`Outer bracket pair was not matched: ${JSON.stringify(outer)}`)
}
// The cursor sitting just after a closer matches it, as in a real editor.
const afterClose = matchingBracketAt(brackets, brackets.length, 'a.ts')
if (afterClose?.open !== 4) {
  throw new Error(`Bracket before the cursor was not matched: ${JSON.stringify(afterClose)}`)
}
const inner = matchingBracketAt(brackets, brackets.indexOf('['), 'a.ts')
if (inner?.open !== brackets.indexOf('[') || inner.close !== brackets.indexOf(']')) {
  throw new Error(`Nested bracket pair was not matched: ${JSON.stringify(inner)}`)
}
if (matchingBracketAt('call(one', 4, 'a.ts') !== null) {
  throw new Error('An unbalanced bracket reported a match')
}
if (matchingBracketAt(brackets, brackets.indexOf('two'), 'a.ts') !== null) {
  throw new Error('A non-bracket offset reported a match')
}

// A closer typed on a blank line aligns with the line that opened the block.
const block = 'function run() {\n  if (ok) {\n    call()\n    '
if (indentForClosingBracket(block, block.length, '}', 'a.ts') !== '  ') {
  throw new Error(`A closer did not align with its opener's line: ${JSON.stringify(indentForClosingBracket(block, block.length, '}', 'a.ts'))}`)
}
const outerBlock = `${block}}\n  `
if (indentForClosingBracket(outerBlock, outerBlock.length, '}', 'a.ts') !== '') {
  throw new Error('The outer closer did not align with the outermost opener')
}
// Nothing to realign when the caret is not on a blank line, when the pair
// opened on this same line, or when the bracket is unbalanced.
if (indentForClosingBracket('  call(x', 8, ')', 'a.ts') !== null) {
  throw new Error('A closer typed after code was realigned')
}
if (indentForClosingBracket('  const a = { ', 14, '}', 'a.ts') !== null) {
  throw new Error('A pair opened on the caret line was realigned')
}
if (indentForClosingBracket('    ', 4, '}', 'a.ts') !== null) {
  throw new Error('An unbalanced closer was realigned')
}

// `:` opens a block only where the language says it does.
if (!editorSyntaxForPath('a.py').colonOpensBlock || editorSyntaxForPath('a.ts').colonOpensBlock) {
  throw new Error('Colon block rules did not follow the language')
}

console.log('editor syntax context smoke passed')
