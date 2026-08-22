/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import type { TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-'))
const filePath = join(cwd, 'main.ts')
const secondFilePath = join(cwd, 'second.ts')
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
let closeCount = 0
registerExtraTreeSitterParsers()

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex(DARK_THEME.violet), bold: true },
  string: { fg: RGBA.fromHex(DARK_THEME.green) },
  function: { fg: RGBA.fromHex(DARK_THEME.cyan) },
  variable: { fg: RGBA.fromHex(DARK_THEME.text) },
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

async function flush(setup: Awaited<ReturnType<typeof testRender>>, delay = 250) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, delay))
  })
  await setup.flush()
}

try {
  await writeFile(filePath, 'const answer = 41\n', 'utf8')
  await writeFile(secondFilePath, 'export const second = true\n', 'utf8')
  const setup = await testRender(
    <EditorPopover
      cwd={cwd}
      initialPath={filePath}
      theme={DARK_THEME}
      width={110}
      height={34}
      syntaxStyle={syntaxStyle}
      onClose={() => { closeCount += 1 }}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 110, height: 34 },
  )

  try {
    await flush(setup, 300)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await setup.flush()
    const initialFrame = setup.captureCharFrame()
    for (const expected of ['EDITOR', 'EXPLORER', 'main.ts', 'INSERT', '^P files']) {
      if (!initialFrame.includes(expected)) throw new Error(`Missing ${expected} from editor frame:\n${initialFrame}`)
    }
    if (!/\b1\s+const answer/.test(initialFrame)) throw new Error(`Editor did not render line numbers:\n${initialFrame}`)
    const keywordColor = RGBA.fromHex(DARK_THEME.violet).toString()
    const syntaxSpans = setup.captureSpans().lines.flatMap((line) => line.spans)
    if (!syntaxSpans.some((span) => span.text.includes('const') && span.fg.toString() === keywordColor)) {
      const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
      throw new Error(`Tree-sitter syntax highlighting did not color the TypeScript keyword: ${JSON.stringify(editor?.getLineHighlights(0) ?? [])}\n${initialFrame}`)
    }

    const tabResult = (handleKey as ((key: EditorKeyEvent) => boolean) | null)?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' })
    if (tabResult !== false) throw new Error('Tab was intercepted instead of being left for the text editor')
    act(() => { handleKey?.({ name: 'e', ctrl: true, shift: false, sequence: '\u0005' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('EXPLORER')) throw new Error('Ctrl+E did not move focus to Explorer')
    act(() => { handleKey?.({ name: 'e', ctrl: true, shift: false, sequence: '\u0005' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('INSERT')) throw new Error('Ctrl+E did not move focus back to editor')

    await act(async () => {
      await setup.mockInput.typeText('// edited\n')
    })
    await flush(setup, 200)
    const dirtyFrame = setup.captureCharFrame()
    if (!dirtyFrame.includes('modified')) throw new Error(`Editor did not mark changed buffer dirty:\n${dirtyFrame}`)
    act(() => { handleKey?.({ name: 'q', ctrl: true, shift: false, sequence: '\u0011' }) })
    await setup.flush()
    if (closeCount !== 0 || !setup.captureCharFrame().includes('unsaved changes') || !setup.captureCharFrame().includes('main.ts')) {
      throw new Error('Editor did not guard Ctrl+Q while a buffer was dirty')
    }

    await act(async () => { await setup.mockInput.typeText('ans') })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await setup.flush()
    const completionFrame = setup.captureCharFrame()
    if (!completionFrame.includes('completions') || !completionFrame.includes('answer')) {
      throw new Error(`Buffer autocomplete did not open with the matching symbol:\n${completionFrame}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await setup.flush()

    await act(async () => {
      handleKey?.({ name: 's', ctrl: true, shift: false, sequence: '\u0013' })
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    await setup.flush()
    const written = await readFile(filePath, 'utf8')
    if (!written.includes('// edited')) throw new Error(`Ctrl+S did not write edited content: ${JSON.stringify(written)}`)
    if (!setup.captureCharFrame().includes('saved')) throw new Error('Editor did not return to saved state')

    act(() => { handleKey?.({ name: 'p', ctrl: true, shift: false, sequence: '\u0010' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('Quick open')) throw new Error('Ctrl+P did not open file picker')

    for (const character of 'second.ts') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await flush(setup, 300)
    const secondFrame = setup.captureCharFrame()
    if (!secondFrame.includes('second.ts') || !secondFrame.includes('export const second')) {
      throw new Error(`Opening a second file did not switch buffers cleanly:\n${secondFrame}`)
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: true, shift: false, sequence: '\u0009' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('const answer')) throw new Error('Ctrl+Tab did not switch to the previous open file')
    act(() => { handleKey?.({ name: 'tab', ctrl: true, shift: true, sequence: '\u0009' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('export const second')) throw new Error('Ctrl+Shift+Tab did not switch to the next open file')

    console.log('Editor popover edit/save/quick-open smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  syntaxStyle.destroy()
  await rm(cwd, { recursive: true, force: true })
}
