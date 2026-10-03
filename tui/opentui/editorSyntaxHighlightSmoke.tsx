/** @jsxImportSource @opentui/react */
// Syntax highlighting is applied imperatively to the editor's native buffer,
// so no other smoke can see it: the editor renders identically whether the
// highlighter painted every token or none at all. This one reads the rendered
// spans' colors.
//
// It covers the case incremental highlighting can get wrong that whole-file
// re-highlighting could not: an edit that shifts line numbers. The parser
// answers with only the lines it re-parsed, so if the decoration already on
// the lines below does not move with the text, inserting one line at the top
// smears every color in the file down by a row.
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

const KEYWORD_HEX = '#ff00ff'
const STRING_HEX = '#00ff88'
const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-syntax-smoke-'))
const sourcePath = join(workspace, 'main.ts')
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = join(workspace, 'absent-language-server')
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex(KEYWORD_HEX), bold: true },
  string: { fg: RGBA.fromHex(STRING_HEX) },
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

async function settle(setup: Awaited<ReturnType<typeof testRender>>, durationMs: number): Promise<void> {
  const deadline = performance.now() + durationMs
  while (performance.now() < deadline) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 8))
    })
  }
}

try {
  await writeFile(sourcePath, [
    'const alpha = 1',
    'const bravo = 2',
    'const charlie = "marker-charlie"',
    'const delta = 4',
    '',
  ].join('\n'), 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={sourcePath}
      theme={DARK_THEME}
      width={100}
      height={26}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 100, height: 26 },
  )

  const keyword = RGBA.fromHex(KEYWORD_HEX).toString()
  const stringColor = RGBA.fromHex(STRING_HEX).toString()

  // The row a piece of text is rendered on, and whether it carries the colour
  // the highlighter should have given it.
  const findColored = (setup2: Awaited<ReturnType<typeof testRender>>, text: string, color: string) => {
    const lines = setup2.captureSpans().lines
    for (let row = 0; row < lines.length; row += 1) {
      const spans = lines[row]!.spans
      if (!spans.some((span) => span.text.includes(text))) continue
      const colored = spans.some((span) => span.fg.toString() === color && span.text.trim().length > 0)
      return { row, colored }
    }
    return null
  }

  try {
    const highlightDeadline = performance.now() + 12_000
    while (performance.now() < highlightDeadline) {
      await settle(setup, 60)
      if (findColored(setup, 'alpha', keyword)?.colored) break
    }
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor || !handleKey) throw new Error('Syntax smoke did not mount the editor')

    const opened = findColored(setup, 'alpha', keyword)
    if (!opened?.colored) {
      throw new Error(`Opening a TypeScript file painted no keyword colour:\n${setup.captureCharFrame()}`)
    }
    const openedString = findColored(setup, 'marker-charlie', stringColor)
    if (!openedString?.colored) {
      throw new Error(`Opening a TypeScript file painted no string colour:\n${setup.captureCharFrame()}`)
    }
    console.log('Opening a file paints syntax colours.')

    // Insert a line at the very top. Every line below shifts down by one; the
    // parser will report only the lines it re-parsed, so the colours on the
    // untouched lines have to travel with their text.
    act(() => {
      editor.focus()
      editor.cursorOffset = 0
      handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' })
    })
    const shiftDeadline = performance.now() + 12_000
    let shifted = findColored(setup, 'marker-charlie', stringColor)
    while (performance.now() < shiftDeadline) {
      await settle(setup, 60)
      shifted = findColored(setup, 'marker-charlie', stringColor)
      if (shifted && shifted.row !== openedString.row && shifted.colored) break
    }
    if (!shifted?.colored) {
      throw new Error(
        `Inserting a line above lost the highlight on the lines below it`
        + ` (row ${openedString.row} -> ${shifted?.row ?? 'missing'}):\n${setup.captureCharFrame()}`,
      )
    }
    console.log('Inserting a line keeps the colours on the lines it pushed down.')

    // A word typed into the middle of the file must pick up its own colour,
    // which is the incremental response landing on the right line.
    const beforeTyping = editor.plainText
    act(() => {
      editor.cursorOffset = beforeTyping.indexOf('const delta')
    })
    await settle(setup, 80)
    await act(async () => { await setup.mockInput.typeText('export ') })
    const typedDeadline = performance.now() + 12_000
    let typed = findColored(setup, 'export', keyword)
    while (performance.now() < typedDeadline) {
      await settle(setup, 60)
      typed = findColored(setup, 'export', keyword)
      if (typed?.colored) break
    }
    if (!typed?.colored) {
      throw new Error(`A keyword typed mid-file was never highlighted:\n${setup.captureCharFrame()}`)
    }
    console.log('A keyword typed mid-file is highlighted incrementally.')
    console.log('Editor syntax highlighting smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}
