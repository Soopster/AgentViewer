/** @jsxImportSource @opentui/react */
// The edit buffer counts display cells; the editor counts string indices. On a
// line with a tab or a wide character before the cursor the two disagree, and
// every crossing between them that is not converted puts a selection, a cursor
// or a jump a cell off. This drives the real popover on such a line.
import React from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender, testRenderWithSyntaxStyle, act } from './testRender'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from '../../plugins/editor/tui/EditorPopover'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const LINE = '\tfoo 中foo bar'
const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-wide-text-'))
const filePath = join(cwd, 'main.txt')
let keyHandler: ((key: EditorKeyEvent) => boolean) | null = null
const syntaxStyleDefinitions = { default: { fg: RGBA.fromHex(DARK_THEME.text) } }
let syntaxStyle!: SyntaxStyle

try {
  await writeFile(filePath, `${LINE}\nnext\n`, 'utf8')
  const setup = await testRenderWithSyntaxStyle(syntaxStyleDefinitions, (style) => { syntaxStyle = style; return (<EditorPopover cwd={cwd} initialPath={filePath} theme={DARK_THEME} width={100} height={26}
      syntaxStyle={syntaxStyle} onClose={() => {}} onKeyHandlerReady={(handler) => { keyHandler = handler }}
      onNotice={() => {}} onClipboardRead={async () => ''} onClipboardWrite={async () => {}} />) },
    { width: 100, height: 26 },
  )
  const settle = async (ms = 300) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const press = async (key: Partial<EditorKeyEvent> & { name: string }) => {
    const handler = keyHandler as ((key: EditorKeyEvent) => boolean) | null
    assert(handler, 'The editor never published a key handler')
    await act(async () => { handler({ sequence: '', ctrl: false, shift: false, meta: false, ...key } as EditorKeyEvent) })
    await settle(200)
  }

  try {
    await settle(1_200)
    await settle(1_200)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable
    assert(editor?.plainText.startsWith(LINE), `The file did not open: ${JSON.stringify(editor?.plainText)}`)
    // Cells on this line: the tab is wider than one, and so is 中.
    const tabCells = (() => { editor.setCursor(0, 0); editor.moveCursorRight(); return editor.logicalCursor.col })()
    assert(tabCells > 1, `The fixture needs a tab wider than one cell (got ${tabCells})`)

    // The cursor inside the first "foo" (cells: the tab, then "f").
    await act(async () => { editor.setCursor(0, tabCells + 1) })
    await settle(200)

    // Ctrl+D selects the word under the cursor, then its next occurrence. Both
    // are found as string ranges and set as a selection.
    await press({ name: 'd', ctrl: true })
    assert(editor.getSelectedText() === 'foo', `Ctrl+D selected ${JSON.stringify(editor.getSelectedText())}, not "foo"`)
    await press({ name: 'd', ctrl: true })
    assert(editor.getSelectedText() === 'foo',
      `The occurrence after 中 selected ${JSON.stringify(editor.getSelectedText())}, not "foo"`)
    await press({ name: 'escape' })

    // End lands on the end of the line; Home on its first non-blank character,
    // which is after the tab.
    await act(async () => { editor.setCursor(0, tabCells + 2) })
    await settle(200)
    await press({ name: 'end' })
    const endColumn = editor.logicalCursor.col
    await act(async () => { editor.gotoLineTextEnd() })
    assert(endColumn === editor.logicalCursor.col, `End stopped at cell ${endColumn}, the line ends at ${editor.logicalCursor.col}`)
    await press({ name: 'home' })
    assert(editor.logicalCursor.col === tabCells, `Home stopped at cell ${editor.logicalCursor.col}, the text starts at ${tabCells}`)

    // Shift+End from there selects exactly the rest of the line.
    await press({ name: 'end', shift: true })
    assert(editor.getSelectedText() === LINE.slice(1),
      `Shift+End selected ${JSON.stringify(editor.getSelectedText())}, not ${JSON.stringify(LINE.slice(1))}`)

    // The status bar counts characters: the end of the line is after all of
    // LINE's characters, however many cells the tab and 中 take.
    await press({ name: 'escape' })
    await act(async () => { editor.gotoLineTextEnd() })
    await settle(200)
    const status = setup.captureCharFrame().match(/Ln (\d+), Col (\d+)/)
    assert(status && status[1] === '1' && status[2] === String(LINE.length + 1),
      `The status bar read ${status?.[0] ?? 'nothing'} at the end of line 1, not Ln 1, Col ${LINE.length + 1}`)

    console.log('Editor wide-text smoke passed (selections, cursor moves and the status column agree with the text after a tab and 中)')
    await settle(300)
  } finally {
    setup.renderer?.destroy?.()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
process.exit(0)
