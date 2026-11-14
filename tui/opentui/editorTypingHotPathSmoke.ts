import assert from 'node:assert/strict'
// @ts-expect-error -- Bun-only diagnostic API
import { heapStats } from 'bun:jsc'
import { classifyEditorOffset, editorSyntaxForPath, type EditorOffsetKind } from '../../plugins/editor/tui/editorSyntaxContext'

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

// Optional exact frozen-source oracle; default reference stays self-contained.
const frozen: typeof classifyEditorOffset | undefined = process.env.EDITOR_CONTEXT_BASELINE
  ? (await import(process.env.EDITOR_CONTEXT_BASELINE)).classifyEditorOffset : undefined
const paths = 'ts tsx js jsx mjs cjs c h cc cpp hpp cs go java kt swift rs scala php dart zig css scss less py rb sh bash zsh toml yaml yml json sql lua md txt'.split(' ').map((extension) => `file.${extension}`)
const fragments = ['abc', '// note', '/*', '*/', '"text"', "'it\\'s'", '`template ${value}`', '# hash', '"""doc', "'''doc", '--[[ lua', ']]', '-- sql', '\\', '"', "'", '`', '\n', '\r\n', '\n  ', 'name: value', '{"key":"value"}', '👩‍💻', 'x'.repeat(31), '"unterminated\n', '/["/]/g', 'a/*b*/c']
let seed = 0x2a171
function random(max: number) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
  return (seed >>> 0) % max
}
let checks = 0
function verify(content: string) {
  // Offset order alternates and language changes between calls: shared global
  // expressions must not leak lastIndex from an earlier document or query.
  const offsets = Array.from({ length: content.length + 1 }, (_, i) => i % 2 ? content.length - (i >> 1) : i >> 1)
  offsets.push(-1, .5, content.length - .5, Infinity, NaN)
  for (const offset of offsets) for (const path of paths) {
    const expected = referenceClassify(content, offset, editorSyntaxForPath(path))
    assert.equal(classifyEditorOffset(content, offset, path), expected, `${path} offset=${offset} ${JSON.stringify(content)}`)
    if (frozen) assert.equal(expected, frozen(content, offset, path), `Frozen baseline ${path} offset=${offset}`)
    checks += 1
  }
}
for (const fixture of ['', '/* a */ b', '--[[ a\n b ]] c', "doesn't matter\ncode", "doesn't close", '"a\\"b"c', '"line\nb', '"""doc\nend""" code', '`x\n${"value"}` next', '👩‍💻//note\r\nnext', 'a/"b"/\'c\'/']) verify(fixture)
for (let document = 0; document < 100; document += 1) {
  let content = Array.from({ length: 3 + random(15) }, () => fragments[random(fragments.length)]!).join('')
  verify(content)
  const at = random(content.length + 1)
  content = content.slice(0, at) + fragments[random(fragments.length)]! + content.slice(Math.min(content.length, at + random(4)))
  verify(content)
}
let generation = 0
function churn() {
  for (let i = 0; i < 5000; i += 1) {
    const content = `unique${generation++} ` + fragments[i % fragments.length]!
    classifyEditorOffset(content, content.length, paths[i % paths.length]!)
  }
}
const collect = () => (globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
churn()
collect()
const before = heapStats().heapSize
for (let i = 0; i < 5; i += 1) churn()
collect()
const after = heapStats().heapSize
assert.ok(after - before < 2 * 1048576, `Unexpected lexical cache growth: ${after - before} bytes`)
console.log(`Editor context parity passed (${checks} offsets, ${paths.length} filetypes, ${frozen ? 'frozen + reference' : 'reference'} oracle); post-GC heap ${(before / 1048576).toFixed(2)} -> ${(after / 1048576).toFixed(2)} MiB`)
