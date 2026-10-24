/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { useRenderer } from '@opentui/react'
import { getBaseAttributes, MAX_LINK_URL_BYTES, type CodeRenderable } from '@opentui/core'
import { testRender, act } from './testRender'
import { buildSyntaxStyle } from './App'
import { DARK_THEME } from '../theme'
import { buildMarkdownBlocks } from './markdownBlocks'
import { MarkdownBlockBody } from './SelectableMarkdown'
const samples = [
 'First **bold** paragraph with Unicode 界 and emoji 😀.\n\nSecond paragraph.\n\nThird paragraph.',
 '# Heading\n\nA paragraph.\n\n## Another heading\n\nMore prose.',
 'Before\n\n```\ncode line one\ncode line two\n```\n\nAfter',
 'Before\n\n- one\n- two\n  - nested\n\nAfter',
 'Before\n\n> a quote\n> second line\n\nAfter',
 'Before\n\n| a | b |\n| - | - |\n| c | d |\n\nAfter',
 'A [reference][ref].\n\nAnother [reference][ref].\n\n[ref]: https://example.test "Title"',
]
assert.equal(MAX_LINK_URL_BYTES, 512, 'review inline-link capability limits when upgrading OpenTUI')
const render = async (content: string, partition: boolean, structured = false, width = 60) => {
 const Body = () => {
  const renderer = useRenderer()
  const style = React.useMemo(() => buildSyntaxStyle(DARK_THEME, renderer.nativeScene), [renderer])
  return <box width={width} flexDirection="column">{partition ? buildMarkdownBlocks(content, 16, structured ? 0 : 160).map(block =>
   <box key={block.key} flexDirection="column" marginBottom={block.marginBottom}>{structured ? <MarkdownBlockBody block={block} content={block.content} syntaxStyle={style} fg={DARK_THEME.text} width={width}
      selectionColors={{ selectionBg: DARK_THEME.surface3, selectionFg: DARK_THEME.text }} borderColor={DARK_THEME.border} />
    : <markdown content={block.content} syntaxStyle={style} fg={DARK_THEME.text} width={width} streaming={false} tableOptions={{ widthMode: 'content', borders: true, borderColor: DARK_THEME.border, selectable: true }} />}</box>
  ) : <markdown content={content} syntaxStyle={style} fg={DARK_THEME.text} width={width} streaming={false} tableOptions={{ widthMode: 'content', borders: true, borderColor: DARK_THEME.border, selectable: true }} />}</box>
 }
 const setup = await testRender(<Body />, { width, height: 55 })
 for (let i = 0; i < (structured ? 40 : 12); i++) await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 16)) })
 const visit = async (node: { getChildren(): unknown[] }) => {
  if ('highlightingDone' in node) await (node as CodeRenderable).highlightingDone
  for (const child of node.getChildren()) await visit(child as Parameters<typeof visit>[0])
 }
 await act(async () => { await visit(setup.renderer.root); await setup.flush() })
 const frame = setup.captureCharFrame()
 const spans = setup.captureSpans().lines.map(line => line.spans.map(span => ({ ...span, attributes: getBaseAttributes(span.attributes) })))
 setup.renderer.destroy()
 return { frame, spans }
}
const structuredSamples = [
 'Before\n\n```js\n/* a comment\n   across lines */\nconst text = `界 😀\nmultiline`;\nconsole.log(text)\n```\n\nAfter',
 'Before\n\n99. **first** item\n100. next\n101. third\n\nAfter',
 '- first\n  - nested\n    - deeper\n- second\n\n  more prose\n\n- third',
 '- [x] done\n- [ ] pending\n- `code` and **bold**',
 '| **Heading** | Other |\n| --- | --- |\n| a **bold** cell | a much longer value that wraps |\n| 界 😀 | `code` |\n| [label](https://example.test) | last |',
 '| a | b | c |\n| - | - | - |\n| 12345678901234567890123456789 | xx | zzz |\n| a | b | c |',
 `\`\`\`js\n/*\n${Array.from({ length: 36 }, (_, index) => `comment_${index} 界 😀`).join('\n')}\n*/\nconst text = "after comment";\n\`\`\``,
 `\`\`\`js\nconst text = \`\n${Array.from({ length: 36 }, (_, index) => `template_${index} 界 😀`).join('\n')}\n\`;\n\`\`\``,
 `\`\`\`\`markdown\n# Heading\n${Array.from({ length: 28 }, () => 'prose').join('\n')}\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n\nAfter\n\`\`\`\``,
]
for (const width of [30, 60]) for (const sample of structuredSamples) {
 const expected = await render(sample, false, false, width)
 const actual = await render(sample, true, true, width)
 assert.deepEqual(actual, expected, `Structured partition changed text/colors at ${width}: ${JSON.stringify(sample)}`)
}
for (const sample of samples) {
 const expected = await render(sample, false)
 const actual = await render(sample, true)
 assert.deepEqual(actual, expected, `Partition changed Markdown rendering: ${JSON.stringify(sample)}`)
}
console.log('Markdown blocks passed: prose, Unicode, headings, fences, nested lists, quotes, tables and reference links')
process.exit(0)
