/** @jsxImportSource @opentui/react */
import React, { useMemo } from 'react'
import assert from 'node:assert/strict'
import { useRenderer } from '@opentui/react'
import { buildSyntaxStyle } from './App'
import { buildMarkdownBlocks } from './markdownBlocks'
import { MarkdownBlockBody, NativeSelectableMarkdown } from './SelectableMarkdown'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'

const content = '| Col1 | Col2 |\n| --- | --- |\n| first | second |\n| third | fourth |'
const drags = [[1, 3, 4, 3], [1, 3, 3, 5], [1, 3, 10, 5], [10, 5, 1, 3], [8, 3, 10, 5]] as const
async function selections(structured: boolean) {
  function Body() {
    const renderer = useRenderer()
    const style = useMemo(() => buildSyntaxStyle(DARK_THEME, renderer.nativeScene), [renderer])
    const props = { content, syntaxStyle: style, fg: DARK_THEME.text, width: 60,
      selectionColors: { selectionBg: DARK_THEME.surface3, selectionFg: DARK_THEME.text }, borderColor: DARK_THEME.border }
    return structured ? <MarkdownBlockBody {...props} block={buildMarkdownBlocks(content, 4096, 0)[0]!} /> : <NativeSelectableMarkdown {...props} />
  }
  const setup = await testRender(<Body />, { width: 60, height: 12 })
  const selected: string[] = []
  const settle = async () => { await act(async () => { await setup.flush() }) }
  try {
    await settle()
    for (const [x1, y1, x2, y2] of drags) {
      setup.renderer.clearSelection()
      await act(async () => { await setup.mockMouse.drag(x1, y1, x2, y2) }); await settle()
      selected.push(setup.renderer.getSelection()?.getSelectedText() ?? '')
    }
  } finally { act(() => setup.renderer.destroy()) }
  return selected
}
const native = await selections(false)
assert.ok(native.every(text => text.length), 'native selection cases actually selected table content')
assert.ok(native.some(text => text.includes('\t')), 'grid copy includes native tab separators')
assert.deepEqual(await selections(true), native, 'virtual table cells preserve single-cell, column-lock, grid and reverse selection')
console.log('Markdown table selection passed: native copy parity for cells, columns, grids and reverse drags')
process.exit(0)
