/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import type { ScrollBarRenderable, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-'))
const filePath = join(cwd, 'main.ts')
const secondFilePath = join(cwd, 'second.ts')
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
let closeCount = 0
const notices: Array<{ kind: 'info' | 'error'; message: string }> = []
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
  const longLine = `const wrappedText = '${'word '.repeat(36).trim()}'`
  const overflowLines = Array.from({ length: 36 }, (_, index) => `const filler${index} = ${index}`).join('\n')
  await writeFile(filePath, `const answer = 41\nconst otherAnswer = answer + 1\n  const nested = true\n${longLine}\n${overflowLines}\n`, 'utf8')
  await writeFile(secondFilePath, 'export const second = true\n', 'utf8')
  await Promise.all(Array.from({ length: 36 }, (_, index) => (
    writeFile(join(cwd, `fixture-${String(index).padStart(2, '0')}.ts`), `export const fixture${index} = ${index}\n`, 'utf8')
  )))
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
      onNotice={(kind, message) => { notices.push({ kind, message }) }}
    />,
    { width: 110, height: 34 },
  )

  try {
    await flush(setup, 300)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await setup.flush()
    const initialFrame = setup.captureCharFrame()
    for (const expected of ['EDITOR', 'EXPLORER', 'main.ts', 'INSERT', '^P open', '^Space complete', 'Alt+Z wrap off', 'V velocity off']) {
      if (!initialFrame.includes(expected)) throw new Error(`Missing ${expected} from editor frame:\n${initialFrame}`)
    }
    if (!/\b1\s+const answer/.test(initialFrame)) throw new Error(`Editor did not render line numbers:\n${initialFrame}`)
    const keywordColor = RGBA.fromHex(DARK_THEME.violet).toString()
    const syntaxSpans = setup.captureSpans().lines.flatMap((line) => line.spans)
    if (!syntaxSpans.some((span) => span.text.includes('const') && span.fg.toString() === keywordColor)) {
      const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
      throw new Error(`Tree-sitter syntax highlighting did not color the TypeScript keyword: ${JSON.stringify(editor?.getLineHighlights(0) ?? [])}\n${initialFrame}`)
    }

    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor) throw new Error('Editor textarea was not mounted')
    const explorerScrollbox = setup.renderer.root.findDescendantById('project-editor-explorer-scrollbox') as ScrollBoxRenderable | null
    if (!explorerScrollbox?.verticalScrollBar.visible || explorerScrollbox.scrollHeight <= explorerScrollbox.viewport.height) {
      throw new Error(`Explorer scrollbar was not visible for an overflowing tree: ${JSON.stringify({ scrollHeight: explorerScrollbox?.scrollHeight, viewportHeight: explorerScrollbox?.viewport.height, visible: explorerScrollbox?.verticalScrollBar.visible })}`)
    }
    const editorScrollbar = setup.renderer.root.findDescendantById('project-editor-scrollbar') as ScrollBarRenderable | null
    if (!editorScrollbar?.visible || editorScrollbar.scrollSize <= editorScrollbar.viewportSize) {
      throw new Error(`Editor scrollbar was not visible for an overflowing buffer: ${JSON.stringify({ scrollSize: editorScrollbar?.scrollSize, viewportSize: editorScrollbar?.viewportSize, visible: editorScrollbar?.visible })}`)
    }
    act(() => { editorScrollbar.slider.value = 5 })
    await flush(setup, 150)
    if (editor.scrollY <= 0 || editorScrollbar.scrollPosition !== editor.scrollY) {
      throw new Error(`Dragging the editor scrollbar did not synchronize its viewport: ${JSON.stringify({ editorScrollY: editor.scrollY, scrollbarPosition: editorScrollbar.scrollPosition })}`)
    }
    act(() => {
      editor.setCursor(1, 5)
      handleKey?.({ name: 'home', ctrl: false, shift: false, sequence: '\u001b[H' })
    })
    if (editor.logicalCursor.col !== 0) throw new Error(`Home did not move to line start: ${JSON.stringify(editor.logicalCursor)}`)
    act(() => { handleKey?.({ name: 'end', ctrl: false, shift: false, sequence: '\u001b[F' }) })
    if (editor.logicalCursor.col !== 'const otherAnswer = answer + 1'.length) {
      throw new Error(`End did not move to line end: ${JSON.stringify(editor.logicalCursor)}`)
    }
    act(() => {
      editor.setCursor(2, '  const nested = true'.length)
      handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' })
    })
    await act(async () => { await setup.mockInput.typeText('keptIndent') })
    await setup.flush()
    if (!editor.plainText.includes('\n  keptIndent')) {
      throw new Error(`Enter did not preserve current indentation: ${JSON.stringify(editor.plainText)}`)
    }
    const unwrappedLineCount = editor.editorView.getTotalVirtualLineCount()
    act(() => { handleKey?.({ name: 'z', ctrl: false, shift: false, option: true, sequence: 'z' }) })
    await flush(setup, 150)
    const wrappedLineCount = editor.editorView.getTotalVirtualLineCount()
    if (editor.wrapMode !== 'word' || wrappedLineCount <= unwrappedLineCount) {
      throw new Error(`Alt+Z did not enable word wrapping: ${JSON.stringify({ wrapMode: editor.wrapMode, before: unwrappedLineCount, after: wrappedLineCount })}`)
    }
    if (!notices.some((notice) => notice.message === 'Editor word wrap enabled')) {
      throw new Error(`Enabling word wrap did not emit a toast notice: ${JSON.stringify(notices)}`)
    }
    act(() => { handleKey?.({ name: 'z', ctrl: false, shift: false, option: true, sequence: 'z' }) })
    await flush(setup, 150)
    if (String(editor.wrapMode) !== 'none' || !notices.some((notice) => notice.message === 'Editor word wrap disabled')) {
      throw new Error(`Alt+Z did not disable word wrapping cleanly: ${JSON.stringify({ wrapMode: editor.wrapMode, notices })}`)
    }
    act(() => { handleKey?.({ name: 'v', ctrl: false, shift: false, option: true, sequence: 'v' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('NORMAL')) throw new Error('Alt+V did not enable Vim Normal mode')
    if (!notices.some((notice) => notice.kind === 'info' && notice.message === 'Editor Vim mode enabled')) {
      throw new Error(`Enabling Vim mode did not emit a toast notice: ${JSON.stringify(notices)}`)
    }
    act(() => {
      editor.setCursor(0, 5)
      handleKey?.({ name: '0', ctrl: false, shift: false, sequence: '0' })
    })
    if (editor.logicalCursor.col !== 0) throw new Error(`Vim 0 did not move to line start: ${JSON.stringify(editor.logicalCursor)}`)
    act(() => { handleKey?.({ name: 'a', ctrl: false, shift: true, sequence: 'A' }) })
    await act(async () => { await setup.mockInput.typeText(' // vim') })
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await setup.flush()
    if (!editor.plainText.includes('const answer = 41 // vim') || !setup.captureCharFrame().includes('NORMAL')) {
      throw new Error(`Vim A/Insert/Escape flow failed:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'v', ctrl: false, shift: false, option: true, sequence: 'v' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('INSERT')) throw new Error('Alt+V did not disable Vim mode')
    if (!notices.some((notice) => notice.message === 'Editor Vim mode disabled')) {
      throw new Error(`Disabling Vim mode did not emit a toast notice: ${JSON.stringify(notices)}`)
    }
    act(() => { handleKey?.({ name: 'V', ctrl: false, shift: true, sequence: 'V' }) })
    act(() => { handleKey?.({ name: 'V', ctrl: false, shift: true, sequence: 'V' }) })
    act(() => { handleKey?.({ name: 'b', ctrl: true, shift: false, sequence: '\u0002' }) })
    act(() => { handleKey?.({ name: 'b', ctrl: true, shift: false, sequence: '\u0002' }) })
    await setup.flush()
    for (const expectedNotice of [
      'Editor velocity scrolling enabled',
      'Editor velocity scrolling disabled',
      'Editor explorer disabled',
      'Editor explorer enabled',
    ]) {
      if (!notices.some((notice) => notice.message === expectedNotice)) {
        throw new Error(`Missing toggle toast ${expectedNotice}: ${JSON.stringify(notices)}`)
      }
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

    act(() => { handleKey?.({ name: 'f', ctrl: true, shift: false, sequence: '\u0006' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('Find in file')) throw new Error('Ctrl+F did not open in-buffer search')
    for (const character of 'answer') {
      act(() => { handleKey?.({ name: character, ctrl: false, shift: false, sequence: character }) })
    }
    act(() => { handleKey?.({ name: 'c', ctrl: false, shift: false, option: true, sequence: 'c' }) })
    act(() => { handleKey?.({ name: 'c', ctrl: false, shift: false, option: true, sequence: 'c' }) })
    if (!notices.some((notice) => notice.message === 'Editor find match case enabled')
      || !notices.some((notice) => notice.message === 'Editor find match case disabled')) {
      throw new Error(`Find match-case toggles did not emit toast notices: ${JSON.stringify(notices)}`)
    }
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await setup.flush()
    if (editor?.getSelectedText().toLowerCase() !== 'answer' || !setup.captureCharFrame().includes('/3')) {
      throw new Error(`Find did not select and count the first result:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    act(() => { handleKey?.({ name: 'g', ctrl: true, shift: false, sequence: '\u0007' }) })
    act(() => { handleKey?.({ name: '2', ctrl: false, shift: false, sequence: '2' }) })
    act(() => { handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' }) })
    await setup.flush()
    if (editor?.logicalCursor.row !== 1) throw new Error(`Ctrl+G did not move to line 2: ${JSON.stringify(editor?.logicalCursor)}`)

    act(() => { handleKey?.({ name: 'p', ctrl: true, shift: false, sequence: '\u0010' }) })
    act(() => { handleKey?.({ name: '>', ctrl: false, shift: true, sequence: '>' }) })
    await setup.flush()
    const commandFrame = setup.captureCharFrame()
    if (!commandFrame.includes('COMMANDS') || !commandFrame.includes('Find in File')) {
      throw new Error(`Unified quick open did not expose commands:\n${commandFrame}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })

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
    act(() => { handleKey?.({ name: 'p', ctrl: true, shift: false, sequence: '\u0010' }) })
    act(() => { handleKey?.({ name: '#', ctrl: false, shift: true, sequence: '#' }) })
    await setup.flush()
    if (!setup.captureCharFrame().includes('BUFFERS') || !setup.captureCharFrame().includes('main.ts')) {
      throw new Error(`Unified quick open did not expose open buffers:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    act(() => { handleKey?.({ name: 'tab', ctrl: true, shift: false, sequence: '\u0009' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('const answer')) throw new Error('Ctrl+Tab did not switch to the previous open file')
    act(() => { handleKey?.({ name: 'tab', ctrl: true, shift: true, sequence: '\u0009' }) })
    await flush(setup, 150)
    if (!setup.captureCharFrame().includes('export const second')) throw new Error('Ctrl+Shift+Tab did not switch to the next open file')

    console.log('Editor popover edit/search/navigation/quick-open smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  syntaxStyle.destroy()
  await rm(cwd, { recursive: true, force: true })
}
