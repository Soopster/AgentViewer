// The editor paints per-row decoration that does not move when rows are
// inserted or removed, so the Highlights backend is only correct if the rows it
// re-sends leave every row equal to a fresh tokenization of the final text.
// This replays random edits through the real facade and worker onto a model of
// the editor's decoration (row -> captures, replaced a row at a time) and
// compares it with a tokenizer built from the final source.
import assert from 'node:assert/strict'
import { LiveTokenizer } from '@pierre/highlights'
import { editorHighlightGroup } from './editorHighlightProtocol'
import { openEditorSyntaxBuffer, type EditorSyntaxLine } from './editorSyntaxBuffer'

const THEME = { name: 'Agent Viewer scopes', appearance: 'dark', cssVariables: true, style: {} } as const
const SNIPPETS = [
  '/*', '*/', '`', '"', "'", '\n', '\n\n', 'const x = 1', '// note\n', 'é😀漢', '\t', 'function f() {}', '}', '{', '`${a}`',
  '\n/* multi\nline */\n', '', 'abc', '#', 'return ',
]
const SEED_SOURCE = [
  'import { a } from "b"', '// comment', 'const s = `template ${a}`', '/* block', ' * comment', ' */',
  'function f(x: number) {', '\treturn x + 1 // 漢字', '}', 'class C { m() { return "é😀" } }', '',
].join('\n').repeat(40)

let state = 1
const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32

function expected(source: string): string {
  const tokenizer = new LiveTokenizer({ lang: 'typescript', theme: THEME, code: source })
  const rows: string[] = []
  for (let line = 0; line < tokenizer.lineCount; line += 1) {
    const out: string[] = []
    for (const token of tokenizer.getLineTokens(line).tokens) {
      const group = editorHighlightGroup(token.color)
      if (group && token.content.length > 0) out.push(`${token.offset}-${token.offset + token.content.length}:${group}`)
    }
    rows.push(out.join(','))
  }
  tokenizer.dispose()
  return rows.join('\n')
}

async function settle(painted: Map<number, string>, source: string, label: string) {
  const want = expected(source)
  const deadline = performance.now() + 8_000
  let got = ''
  while (performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 40))
    const rows = want.split('\n').length
    got = Array.from({ length: rows }, (_, line) => painted.get(line) ?? '').join('\n')
    if (got === want) return
  }
  const wantRows = want.split('\n')
  const gotRows = got.split('\n')
  const bad = wantRows.findIndex((row, line) => row !== gotRows[line])
  assert.fail(`${label}: row ${bad} painted ${JSON.stringify(gotRows[bad])} but a fresh tokenizer gives ${JSON.stringify(wantRows[bad])}`)
}

const painted = new Map<number, string>()
const apply = (lines: EditorSyntaxLine[], full: boolean) => {
  if (full) painted.clear()
  for (const entry of lines) {
    painted.set(entry.line, entry.highlights.map(h => `${h.startCol}-${h.endCol}:${h.group}`).join(','))
  }
}

let content = SEED_SOURCE
const buffer = openEditorSyntaxBuffer({ content, filetype: 'typescript', backend: 'highlights', getViewport: () => [0, 60], onHighlights: apply })
await settle(painted, content, 'open')

for (let step = 0; step < 150; step += 1) {
  const at = Math.floor(random() * (content.length + 1))
  const remove = random() < 0.4 ? Math.floor(random() * 30) : 0
  const insert = SNIPPETS[Math.floor(random() * SNIPPETS.length)]!
  const next = content.slice(0, at) + insert + content.slice(Math.min(content.length, at + remove))
  buffer.update(content, next)
  content = next
  // Half the steps are typed in bursts, with no pause for the worker to catch up.
  if (random() < 0.5) await settle(painted, content, `step ${step}`)
}
await settle(painted, content, 'final')

// A -> B -> A: the text is identical but the revision is not.
const original = content
buffer.update(content, `${original}\n/* B`)
buffer.update(`${original}\n/* B`, original)
await settle(painted, original, 'A -> B -> A')

// Emptying the file must remove every colour.
buffer.update(content, '')
await settle(painted, '', 'empty file')

buffer.dispose()
console.log('Editor Highlights incremental smoke passed (150 random edits, bursts, A-B-A, empty file)')
process.exit(0)
