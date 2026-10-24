/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { useRenderer } from '@opentui/react'
import { testRender, act } from './testRender'
import { buildSyntaxStyle } from './App'
import { DARK_THEME } from '../theme'
import { buildMarkdownBlocks } from './markdownBlocks'
const samples = [
 'First **bold** paragraph with Unicode 界 and emoji 😀.\n\nSecond paragraph.\n\nThird paragraph.',
 '# Heading\n\nA paragraph.\n\n## Another heading\n\nMore prose.',
 'Before\n\n```\ncode line one\ncode line two\n```\n\nAfter',
 'Before\n\n- one\n- two\n  - nested\n\nAfter',
 'Before\n\n> a quote\n> second line\n\nAfter',
 'Before\n\n| a | b |\n| - | - |\n| c | d |\n\nAfter',
 'A [reference][ref].\n\nAnother [reference][ref].\n\n[ref]: https://example.test "Title"',
]
const render = async (content: string, partition: boolean) => {
 const Body = () => {
  const renderer = useRenderer()
  const style = React.useMemo(() => buildSyntaxStyle(DARK_THEME, renderer.nativeScene), [renderer])
  return <box width={60} flexDirection="column">{partition ? buildMarkdownBlocks(content, 16).map(block =>
   <box key={block.key} flexDirection="column" marginBottom={block.marginBottom}><markdown content={block.content} syntaxStyle={style} fg={DARK_THEME.text} width={60} streaming={false} tableOptions={{ widthMode: 'content', borders: true, borderColor: DARK_THEME.border, selectable: true }} /></box>
  ) : <markdown content={content} syntaxStyle={style} fg={DARK_THEME.text} width={60} streaming={false} tableOptions={{ widthMode: 'content', borders: true, borderColor: DARK_THEME.border, selectable: true }} />}</box>
 }
 const setup = await testRender(<Body />, { width: 60, height: 55 })
 for (let i = 0; i < 12; i++) await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 16)) })
 const frame = setup.captureCharFrame()
 setup.renderer.destroy()
 return frame
}
for (const sample of samples) {
 const expected = await render(sample, false)
 const actual = await render(sample, true)
 assert.equal(actual, expected, `Partition changed Markdown rendering: ${JSON.stringify(sample)}`)
}
console.log('Markdown blocks passed: prose, Unicode, headings, fences, nested lists, quotes, tables and reference links')
process.exit(0)
