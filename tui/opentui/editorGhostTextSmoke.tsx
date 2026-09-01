/** @jsxImportSource @opentui/react */
// Ghost text: the part of the selected suggestion the user has not typed yet,
// drawn dim at the caret.
//
// It is an overlay, never buffer content, and that is the property worth
// guarding: text inserted into the buffer to look like a suggestion would reach
// the tab's content, the dirty flag, the language server, the tree-sitter
// buffer and — the moment anyone pressed save — the file on disk. So this
// checks both halves every time: that the ghost is on screen, and that the
// document does not contain it.
import React, { act } from 'react'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, editorGhostSuffix, type EditorKeyEvent } from './EditorPopover'

// --- the rule, in isolation --------------------------------------------------

const completion = (insertText: string, insertTextFormat?: 1 | 2) => ({ insertText, insertTextFormat })

if (editorGhostSuffix('bo', 2, completion('body')) !== 'dy') throw new Error('A suggestion continuing the typed prefix must ghost its remainder')
if (editorGhostSuffix('const bo', 8, completion('body')) !== 'dy') throw new Error('A prefix mid-line at end of line must still ghost')
if (editorGhostSuffix('bo\nnext', 2, completion('body')) !== 'dy') throw new Error('End of line before a newline must ghost')
// Nothing to add.
if (editorGhostSuffix('body', 4, completion('body')) !== null) throw new Error('A fully typed suggestion must not ghost')
// Not a continuation: showing `dy` after `xy` would be a lie about what Tab does.
if (editorGhostSuffix('xy', 2, completion('body')) !== null) throw new Error('A suggestion that does not continue the prefix must not ghost')
if (editorGhostSuffix('BO', 2, completion('body')) !== null) throw new Error('Ghosting must be case-exact, not case-insensitive')
// An overlay cannot push real text aside the way virtual text can.
if (editorGhostSuffix('bo)', 2, completion('body')) !== null) throw new Error('A caret with text after it must not ghost')
// Snippet bodies are placeholder syntax, not text.
if (editorGhostSuffix('fu', 2, completion('function ${1:name}() {}', 2)) !== null) throw new Error('A snippet must not ghost its placeholder syntax')
if (editorGhostSuffix('bo', 2, undefined) !== null) throw new Error('No selection means no ghost')
if (editorGhostSuffix('', 0, completion('body')) !== null) throw new Error('An empty prefix must not ghost a whole word')
if (editorGhostSuffix('bo', 2, completion('bo\nnext')) !== null) throw new Error('A multi-line suggestion must not ghost')
console.log('Ghost suffix is produced only where a suggestion truly continues what was typed.')

// --- on screen, against the real editor --------------------------------------

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-ghost-'))
const sourcePath = join(workspace, 'main.ts')
const serverPath = join(workspace, 'fake-lsp')
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

const GHOST_HEX = DARK_THEME.dim
const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex(DARK_THEME.violet), bold: true },
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

try {
  await writeFile(serverPath, String.raw`#!/usr/bin/env node
let input = Buffer.alloc(0)
let documentText = ''
function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body)
}
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  while (true) {
    const headerEnd = input.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const match = /Content-Length:\s*(\d+)/i.exec(input.subarray(0, headerEnd).toString('ascii'))
    if (!match) return
    const length = Number(match[1])
    const start = headerEnd + 4
    if (input.length < start + length) return
    const message = JSON.parse(input.subarray(start, start + length).toString('utf8'))
    input = input.subarray(start + length)
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 2 }, completionProvider: {} } } })
    if (message.method === 'textDocument/didOpen') documentText = message.params.textDocument.text
    if (message.method === 'textDocument/completion') {
      send({ jsonrpc: '2.0', id: message.id, result: [
        { label: 'bodyweight', kind: 6, sortText: '000', preselect: true, insertText: 'bodyweight' },
        { label: 'bodySize', kind: 6, sortText: '001', insertText: 'bodySize' },
      ] })
    }
  }
})
`, 'utf8')
  await chmod(serverPath, 0o755)
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = serverPath
  await writeFile(sourcePath, 'const seed = 0\n', 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={sourcePath}
      theme={DARK_THEME}
      width={110}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 110, height: 30 },
  )
  const settle = async (durationMs: number) => {
    const deadline = performance.now() + durationMs
    while (performance.now() < deadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
    }
  }

  const ghostColor = RGBA.fromHex(GHOST_HEX).toString()
  // The editor's own rows. The status line and footer are dim too, and the
  // message after accepting a suggestion contains the suggestion's name — a
  // search over the whole frame would find that and call it a ghost.
  const CONTENT_ROWS = 14
  /** The row and column at which `text` is drawn in the ghost colour. */
  const findGhost = (text: string): { row: number; column: number } | null => {
    const lines = setup.captureSpans().lines
    for (let row = 0; row < Math.min(lines.length, CONTENT_ROWS); row += 1) {
      let column = 0
      for (const span of lines[row]!.spans) {
        if (span.fg.toString() === ghostColor && span.text.includes(text)) {
          return { row, column: column + span.text.indexOf(text) }
        }
        column += span.text.length
      }
    }
    return null
  }
  const findText = (text: string): { row: number; column: number } | null => {
    const frame = setup.captureCharFrame().split('\n')
    for (let row = 0; row < frame.length; row += 1) {
      const column = frame[row]!.indexOf(text)
      if (column >= 0) return { row, column }
    }
    return null
  }

  try {
    await settle(900)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor || !handleKey) throw new Error('Ghost smoke did not mount the editor')

    act(() => { editor.focus(); editor.gotoBufferEnd() })
    await settle(120)
    await act(async () => { await setup.mockInput.typeText('bo') })

    const deadline = performance.now() + 8_000
    while (performance.now() < deadline && !findGhost('dyweight')) await settle(40)
    const ghost = findGhost('dyweight')
    if (!ghost) {
      throw new Error(`Typing a prefix with a matching suggestion drew no ghost text:\n${setup.captureCharFrame()}`)
    }

    // The ghost has to sit exactly where the next character would be typed —
    // one column off and it reads as a rendering fault rather than a hint.
    const typed = findText('bo')
    if (!typed) throw new Error('Could not find the typed prefix on screen')
    if (ghost.row !== typed.row) {
      throw new Error(`Ghost text is on row ${ghost.row} but the caret is on row ${typed.row}`)
    }
    if (ghost.column !== typed.column + 2) {
      throw new Error(
        `Ghost text starts at column ${ghost.column}; the caret sits at ${typed.column + 2}.`
        + ` The overlay's left offset does not match the editor's content origin.`,
      )
    }
    console.log('Ghost text is drawn dim, on the caret\'s row, at the caret\'s column.')

    // The whole point: it is painted over the terminal, not typed into the file.
    if (editor.plainText.includes('dyweight') || editor.plainText.includes('bodyweight')) {
      throw new Error(`Ghost text reached the document: ${JSON.stringify(editor.plainText.slice(-40))}`)
    }
    if (!editor.plainText.endsWith('bo')) {
      throw new Error(`The buffer should hold only what was typed: ${JSON.stringify(editor.plainText.slice(-40))}`)
    }
    console.log('The ghost is an overlay: the document still holds only what was typed.')

    // Moving the selection re-ghosts against the newly selected suggestion.
    act(() => { handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '[B' }) })
    const selectionDeadline = performance.now() + 5_000
    while (performance.now() < selectionDeadline && !findGhost('dySize')) await settle(40)
    if (!findGhost('dySize')) {
      throw new Error(`Selecting another suggestion did not update the ghost:\n${setup.captureCharFrame()}`)
    }
    console.log('Moving through the list re-ghosts against the selected suggestion.')

    // Accepting turns the hint into real text, and the hint goes away.
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    const acceptDeadline = performance.now() + 5_000
    while (performance.now() < acceptDeadline && !editor.plainText.endsWith('bodySize')) await settle(40)
    if (!editor.plainText.endsWith('bodySize')) {
      throw new Error(`Accepting the suggestion did not insert it: ${JSON.stringify(editor.plainText.slice(-40))}`)
    }
    await settle(200)
    if (findGhost('dySize')) throw new Error('The ghost is still drawn after its suggestion was accepted')
    console.log('Accepting inserts the real text and clears the ghost.')

    // A caret with code after it has no empty columns to borrow.
    act(() => {
      editor.replaceText('const seed = 0\nbo)\n')
      editor.setCursor(1, 2)
    })
    await settle(400)
    await act(async () => { await setup.mockInput.typeText('') })
    await settle(600)
    if (findGhost('dyweight') || findGhost('dySize')) {
      throw new Error(`Ghost text was drawn over code following the caret:\n${setup.captureCharFrame()}`)
    }
    console.log('No ghost is drawn where it would paint over the rest of the line.')
    console.log('Editor ghost text smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}
