// `classifyEditorOffset` decides whether the completion popup opens, so getting
// it wrong is not a crash — it is suggestions appearing inside a comment, or
// silently refusing to appear in code, in whichever file happens to trip the
// bug. The fast scan skips any code unit that can begin no delimiter in the
// language, which is only sound if the delimiter table is complete; this smoke
// checks it differentially against the straightforward scan it replaced, over
// randomized content in every language family the editor knows.
import { classifyEditorOffset, editorSyntaxForPath, type EditorOffsetKind } from './editorSyntaxContext'

type Syntax = ReturnType<typeof editorSyntaxForPath>

// The original implementation, kept verbatim as the oracle.
function referenceClassify(content: string, offset: number, syntax: Syntax): EditorOffsetKind {
  const target = Math.max(0, Math.min(content.length, offset))
  let index = 0
  while (index < target) {
    const character = content[index]!
    const lineComment = syntax.lineComments.find((token) => content.startsWith(token, index))
    if (lineComment) {
      const lineEnd = content.indexOf('\n', index)
      if (lineEnd < 0 || lineEnd >= target) return 'comment'
      index = lineEnd + 1
      continue
    }
    const blockComment = syntax.blockComments.find(([open]) => content.startsWith(open, index))
    if (blockComment) {
      const close = content.indexOf(blockComment[1], index + blockComment[0].length)
      if (close < 0 || close + blockComment[1].length > target) return 'comment'
      index = close + blockComment[1].length
      continue
    }
    const tripleQuote = syntax.tripleQuotes.find((token) => content.startsWith(token, index))
    if (tripleQuote) {
      const close = content.indexOf(tripleQuote, index + tripleQuote.length)
      if (close < 0 || close + tripleQuote.length > target) return 'string'
      index = close + tripleQuote.length
      continue
    }
    if (syntax.quotes.includes(character)) {
      const multiline = syntax.multilineQuotes.includes(character)
      let scan = index + 1
      while (scan < content.length) {
        const inner = content[scan]!
        if (inner === '\\') { scan += 2; continue }
        if (inner === character) break
        if (inner === '\n' && !multiline) break
        scan += 1
      }
      if (scan >= content.length) return 'string'
      if (content[scan] !== character) {
        index += 1
        continue
      }
      if (scan >= target) return 'string'
      index = scan + 1
      continue
    }
    index += 1
  }
  return 'code'
}

// One path per language family, plus a plain-text file, which has no delimiters
// at all and must therefore classify everything as code.
const PATHS = ['a.ts', 'a.py', 'a.rb', 'a.json', 'a.sql', 'a.lua', 'a.css', 'a.yaml', 'a.md']

// Fragments chosen so the random splice produces unterminated strings, nested
// quote characters, escapes at the very end, and comment opens with no close —
// the shapes where a scan that skips too much diverges.
const FRAGMENTS = [
  'const value = 1', '// note', '/*', '*/', '"text"', "'it\\'s'", '`tpl ${x}`',
  '# hash', '"""doc', "'''doc", '-- sql', '--[[ lua', ']]', '\\', '"', "'", '`',
  '\n', '\n  ', 'name: value', '{ "k": "v" }', '😀', 'x'.repeat(37), '/* unclosed',
  '"unterminated\n', 'a/*b*/c', '#{interp}',
]

let seed = 0x51f3c9d
const random = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
  return ((seed >>> 0) % 1_000_000) / 1_000_000
}

let checks = 0
for (let document = 0; document < 400; document += 1) {
  const parts: string[] = []
  const pieces = 4 + Math.floor(random() * 40)
  for (let piece = 0; piece < pieces; piece += 1) parts.push(FRAGMENTS[Math.floor(random() * FRAGMENTS.length)]!)
  const content = parts.join('')
  for (const path of PATHS) {
    const syntax = editorSyntaxForPath(path)
    // Every offset, not a sample: divergence tends to sit on one boundary.
    for (let offset = 0; offset <= content.length; offset += 1) {
      const actual = classifyEditorOffset(content, offset, path)
      const expected = referenceClassify(content, offset, syntax)
      checks += 1
      if (actual !== expected) {
        throw new Error(
          `classifyEditorOffset(${path}) said ${actual}, expected ${expected}, at offset ${offset}`
          + ` of ${JSON.stringify(content)}`,
        )
      }
    }
  }
}

// Out-of-range offsets are clamped rather than throwing.
if (classifyEditorOffset('const a = 1', -5, 'a.ts') !== 'code') throw new Error('A negative offset was not clamped')
if (classifyEditorOffset('// c', 9_999, 'a.ts') !== 'comment') throw new Error('An overshooting offset was not clamped')

console.log(`editor syntax context scan smoke passed (${checks.toLocaleString()} offsets)`)
