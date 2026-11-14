/** @jsxImportSource @opentui/react */
// A body the plain-paragraph gate accepts renders exactly as OpenTUI's
// <markdown> renders it: the same characters, colours and attributes, cell for
// cell. The gate (isPlainMarkdownParagraph) is what lets a stream card skip a
// markdown renderable, a code renderable and a tree-sitter round trip, so a
// sample it wrongly accepts is a card that silently loses its styling — this
// compares the two renderers on every accepted sample, and checks that the
// constructs they render differently are refused.
import React from 'react'
import assert from 'node:assert/strict'
import { useRenderer } from '@opentui/react'
import { testRender, act } from './testRender'
import { buildSyntaxStyle, isPlainMarkdownParagraph, renderInlineMarkdownSpans } from './App'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'
import { DARK_THEME } from '../theme'

registerExtraTreeSitterParsers()
const WIDTH = 60
const accepted = [
  'Hi. You still have the Codex fix uncommitted.',
  'Use **bold** and `code` here, then **more bold** at the end.',
  'Line one of a paragraph\nline two continues it',
  'Done — `npm run tui:check` passes, and the smoke chain is green after a long run that wraps onto a second and third line.',
  'Numbers like 3.5 and 2-3 and #hash in the middle stay plain.',
]
const refused = ['A *soft* point', '[docs](#intro)', '~~gone~~', 'See [docs](https://x.y)', 'see lib/x.ts', '- item', '# Heading', '> quote', 'a\n\nb', 'snake_case _it_', 'Fish &amp; chips', '```\ncode\n```', 'a | b', '2 * 3', '**unclosed']

for (const sample of refused) assert.equal(isPlainMarkdownParagraph(sample), false, `gate accepted ${JSON.stringify(sample)}`)

type Cell = string
const render = async (content: string, mode: 'markdown' | 'spans'): Promise<Cell[]> => {
  // The style belongs to the scene that draws it, so it is built inside the render.
  const Body = () => {
    const renderer = useRenderer()
    const style = React.useMemo(() => buildSyntaxStyle(DARK_THEME, renderer.nativeScene), [renderer])
    return mode === 'markdown'
      ? <box width={WIDTH}><markdown content={content} syntaxStyle={style} fg={DARK_THEME.text} streaming={false} width={WIDTH} /></box>
      : <box width={WIDTH}><text fg={DARK_THEME.text} wrapMode="word" width={WIDTH}>{renderInlineMarkdownSpans(content, DARK_THEME, DARK_THEME.text, 'k')}</text></box>
  }
  const setup = await testRender(<Body />, { width: WIDTH + 2, height: 8 })
  for (let i = 0; i < 60; i++) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 20)) })
  const spans = (setup as unknown as { captureSpans(): { lines: { spans: { text: string; fg?: { toString(): string }; attributes?: number }[] }[] } }).captureSpans()
  const cells = spans.lines.flatMap((line, row) => line.spans.flatMap((span) => [...span.text].map((ch) => `${row}:${ch}:${span.fg?.toString()}:${span.attributes ?? 0}`)))
  setup.renderer.destroy()
  return cells
}

for (const sample of accepted) {
  assert.equal(isPlainMarkdownParagraph(sample), true, `gate refused ${JSON.stringify(sample)}`)
  const [markdown, spans] = [await render(sample, 'markdown'), await render(sample, 'spans')]
  assert.ok(markdown.some((cell) => !cell.split(':')[1].match(/\s/)), `markdown rendered nothing for ${JSON.stringify(sample)}; this compares nothing`)
  assert.deepEqual(spans, markdown, `inline spans differ from <markdown> for ${JSON.stringify(sample)}`)
}
console.log(`Plain markdown smoke passed (${accepted.length} paragraphs identical cell for cell; ${refused.length} non-plain constructs refused)`)
process.exit(0)
