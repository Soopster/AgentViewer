/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { continuesTypingRun, MAX_UNDO_RUN_STEPS, undoTypingRun, type UndoableEditor } from './editorUndoRuns'

// The edit buffer records one undo step per character, so undoing a line took
// as many presses as it had letters. A typed run now comes off together — and
// the risk of that is the opposite failure: undoing more than the user typed.
// Every boundary that must stop the run is pinned here.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// --- what counts as one more character of the same run ----------------------

assert(continuesTypingRun({ row: 3, col: 10 }, { row: 3, col: 9 }), 'One column back on the same line continues a run')
assert(!continuesTypingRun({ row: 3, col: 10 }, { row: 2, col: 40 }), 'A different line ends the run')
assert(!continuesTypingRun({ row: 3, col: 10 }, { row: 3, col: 4 }), 'A multi-character step ends the run')
assert(!continuesTypingRun({ row: 3, col: 10 }, { row: 3, col: 11 }), 'Moving forward ends the run')
assert(!continuesTypingRun({ row: 3, col: 10 }, { row: 3, col: 10 }), 'Standing still ends the run')

/** A buffer whose caret walks back over a scripted sequence of positions. */
function scriptedEditor(positions: Array<{ row: number; col: number }>): UndoableEditor & { undos: number } {
  let index = 0
  return {
    undos: 0,
    get logicalCursor() { return positions[Math.min(index, positions.length - 1)]! },
    undo() {
      this.undos += 1
      index = Math.min(index + 1, positions.length - 1)
    },
  }
}

// Eleven characters typed on one line unwind in one press.
const run = scriptedEditor(Array.from({ length: 12 }, (_, step) => ({ row: 4, col: 11 - step })))
const runResult = undoTypingRun(run)
assert(runResult.steps === 11 && runResult.coalesced,
  `A typing run must unwind together: ${JSON.stringify(runResult)}`)

// A newline in the middle stops it: the run before the newline is a separate
// press, which is what makes undo predictable rather than greedy.
const acrossLines = scriptedEditor([
  { row: 5, col: 3 }, { row: 5, col: 2 }, { row: 5, col: 1 }, { row: 4, col: 20 }, { row: 4, col: 19 },
])
const acrossResult = undoTypingRun(acrossLines)
assert(acrossResult.steps === 3, `A run must stop at a line boundary: ${JSON.stringify(acrossResult)}`)

// A single non-typing edit — a paste, a formatting rewrite, a multi-cursor
// change — is one step on its own.
const paste = scriptedEditor([{ row: 2, col: 40 }, { row: 2, col: 0 }, { row: 2, col: 0 }])
assert(undoTypingRun(paste).steps === 1, 'A multi-character edit must undo as one step')

// An exhausted history stops rather than spinning.
const exhausted = scriptedEditor([{ row: 0, col: 0 }])
assert(undoTypingRun(exhausted).steps === 1, 'An empty history must not loop')

// And a pathological history is capped.
const endless = scriptedEditor(Array.from({ length: 5_000 }, (_, step) => ({ row: 1, col: 5_000 - step })))
assert(undoTypingRun(endless).steps === MAX_UNDO_RUN_STEPS, 'A long run must be capped')

console.log('Editor undo-run detection smoke passed')

// --- the real editor --------------------------------------------------------

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-undo-run-'))
const filePath = join(cwd, 'main.txt')
let keyHandler: ((key: EditorKeyEvent) => boolean) | null = null
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

try {
  await writeFile(filePath, 'start\n', 'utf8')

  const setup = await testRender(
    <EditorPopover cwd={cwd} initialPath={filePath} theme={DARK_THEME} width={100} height={26}
      syntaxStyle={syntaxStyle} onClose={() => {}} onKeyHandlerReady={(handler) => { keyHandler = handler }}
      onNotice={() => {}} onClipboardRead={async () => ''} onClipboardWrite={async () => {}} />,
    { width: 100, height: 26 },
  )
  const settle = async (ms = 300) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const press = async (key: EditorKeyEvent) => {
    const handler = keyHandler as ((key: EditorKeyEvent) => boolean) | null
    assert(handler, 'The editor never published a key handler')
    await act(async () => { handler(key) })
    await settle(200)
  }

  try {
    await settle(1_200)
    await settle(1_200)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable
    await act(async () => { editor.gotoLine(0) })
    await settle(200)

    await act(async () => { setup.mockInput.typeText('hello world') })
    await settle(400)
    assert(editor.plainText.startsWith('hello world'), `Typing did not land: ${JSON.stringify(editor.plainText)}`)

    // One press, not eleven.
    await press({ name: 'z', ctrl: true, sequence: '' } as EditorKeyEvent)
    assert(editor.plainText === 'start\n',
      `One undo must take back the whole typed run: ${JSON.stringify(editor.plainText)}`)

    // Redo still works, and puts the run back.
    await press({ name: 'z', ctrl: true, shift: true, sequence: '' } as EditorKeyEvent)
    assert(editor.plainText !== 'start\n', `Redo did nothing: ${JSON.stringify(editor.plainText)}`)

    console.log('Editor undo-run smoke passed (a typed run undoes in one press)')
    await settle(300)
  } finally {
    setup.renderer?.destroy?.()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
process.exit(0)
