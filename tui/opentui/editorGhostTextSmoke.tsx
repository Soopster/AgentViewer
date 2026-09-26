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
import { EditorPopover, editorGhostCandidate, editorGhostSuffix, type EditorKeyEvent } from './EditorPopover'

// --- the rules, in isolation ------------------------------------------------

const word = (content: string, cursorOffset: number, insertText: string) =>
  editorGhostCandidate(content, cursorOffset, { label: insertText, insertText, source: 'buffer' })

// A candidate is the offset acceptance starts replacing from, plus what it puts
// there — derived once, then re-checked against the buffer as it changes.
if (JSON.stringify(word('bo', 2, 'body')) !== JSON.stringify({ replaceStart: 0, newText: 'body' })) {
  throw new Error('A plain suggestion replaces the word under the caret')
}
// A language server's own edit range wins, because that is what acceptance uses.
const lspItem = (newText: string, startCharacter: number, endCharacter: number, insertTextFormat?: 1 | 2) => ({
  label: newText,
  insertText: newText,
  insertTextFormat,
  source: 'lsp' as const,
  textEdit: {
    range: { start: { line: 0, character: startCharacter }, end: { line: 0, character: endCharacter } },
    newText,
  },
})
if (JSON.stringify(editorGhostCandidate('a.bo', 4, lspItem('bodyweight', 2, 4))) !== JSON.stringify({ replaceStart: 2, newText: 'bodyweight' })) {
  throw new Error('A server-supplied textEdit range must be used instead of the word under the caret')
}
// An edit that does not end at the caret describes something else entirely.
if (editorGhostCandidate('a.bo', 4, lspItem('bodyweight', 0, 2)) !== null) {
  throw new Error('An edit that does not end at the caret must not ghost')
}
// Snippet bodies are placeholder syntax, not text.
if (editorGhostCandidate('fu', 2, lspItem('function ${1:name}() {}', 0, 2, 2)) !== null) {
  throw new Error('A snippet must not ghost its placeholder syntax')
}
if (editorGhostCandidate('bo', 2, undefined) !== null) throw new Error('No selection means no candidate')

const candidate = (newText: string, replaceStart = 0) => ({ replaceStart, newText })

if (editorGhostSuffix('bo', 2, candidate('body')) !== 'dy') throw new Error('A suggestion continuing the typed prefix must ghost its remainder')
if (editorGhostSuffix('const bo', 8, candidate('body', 6)) !== 'dy') throw new Error('A prefix mid-line at end of line must still ghost')
if (editorGhostSuffix('bo\nnext', 2, candidate('body')) !== 'dy') throw new Error('End of line before a newline must ghost')
// The overlay can sit on blank columns, which trailing whitespace already is.
if (editorGhostSuffix('bo   \nnext', 2, candidate('body')) !== 'dy') throw new Error('Trailing whitespace is blank space the ghost may occupy')
// Nothing to add.
if (editorGhostSuffix('body', 4, candidate('body')) !== null) throw new Error('A fully typed suggestion must not ghost')
// Not a continuation: showing `dy` after `xy` would be a lie about what Tab does.
if (editorGhostSuffix('xy', 2, candidate('body')) !== null) throw new Error('A suggestion that does not continue the prefix must not ghost')
if (editorGhostSuffix('BO', 2, candidate('body')) !== null) throw new Error('Ghosting must be case-exact, not case-insensitive')
// An overlay cannot push real text aside the way virtual text can.
if (editorGhostSuffix('bo)', 2, candidate('body')) !== null) throw new Error('A caret with code after it must not ghost')
if (editorGhostSuffix('bo', 2, null) !== null) throw new Error('No candidate means no ghost')
if (editorGhostSuffix('', 0, candidate('body')) !== null) throw new Error('An empty prefix must not ghost a whole word')
if (editorGhostSuffix('bo', 2, candidate('bo\nnext')) !== null) throw new Error('A multi-line suggestion must not ghost')

// The candidate is re-checked as the word grows, which is what keeps the hint
// still while a list is being re-requested.
if (editorGhostSuffix('b', 1, candidate('bodyweight')) !== 'odyweight') throw new Error('A standing candidate must shrink as the word is typed')
if (editorGhostSuffix('body', 4, candidate('bodyweight')) !== 'weight') throw new Error('A standing candidate must shrink as the word is typed')
if (editorGhostSuffix('bodyq', 5, candidate('bodyweight')) !== null) throw new Error('A standing candidate must drop once the word stops matching')
console.log('Ghost candidates mirror what acceptance does, and are re-checked against the live buffer.')

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

    // Back to the first suggestion, so the run below types through `bodyweight`.
    act(() => { handleKey?.({ name: 'up', ctrl: false, shift: false, sequence: '[A' }) })
    const backDeadline = performance.now() + 5_000
    while (performance.now() < backDeadline && !findGhost('dyweight')) await settle(40)
    if (!findGhost('dyweight')) throw new Error('Moving back up the list did not restore the first suggestion\'s ghost')

    // The reliability property. The completion list is cleared on every
    // keystroke and a new one costs a debounce plus a round trip, so a ghost
    // derived from the list alone blinks out for ~120ms per character — at
    // typing speed it is only ever visible to someone who has stopped. Typing
    // through the word must leave the hint standing at every step.
    for (const [typed, expected] of [['d', 'yweight'], ['y', 'weight'], ['w', 'eight']] as const) {
      await act(async () => { await setup.mockInput.typeText(typed) })
      await settle(24)
      const standing = findGhost(expected)
      if (!standing) {
        throw new Error(
          `The ghost blinked out while typing: after '${typed}' there was no dim '${expected}'.\n`
          + setup.captureCharFrame(),
        )
      }
    }
    console.log('The ghost holds still while a word is typed, rather than blinking once per character.')

    // ...and goes away as soon as the word stops matching it.
    await act(async () => { await setup.mockInput.typeText('q') })
    await settle(24)
    if (findGhost('ight') || findGhost('ght')) {
      throw new Error(`The ghost survived a keystroke that no longer matches it:\n${setup.captureCharFrame()}`)
    }
    console.log('The ghost drops the moment the typed word stops matching it.')

    // A visible hint has to be actionable. Immediately after a keystroke the
    // list is cleared and has not come back, so Tab would otherwise indent
    // while a suggestion sits on screen.
    act(() => { handleKey?.({ name: 'backspace', ctrl: false, shift: false, sequence: '' }) })
    await settle(400)
    await act(async () => { await setup.mockInput.typeText('e') })
    // No settling: this is the window where the list is empty by construction.
    if (findGhost('ight') == null) {
      throw new Error(`No ghost was standing in the window before the list returns:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    await settle(120)
    if (!editor.plainText.endsWith('bodyweight')) {
      throw new Error(
        `Tab did not accept the standing ghost before the list returned: ${JSON.stringify(editor.plainText.slice(-40))}`,
      )
    }
    console.log('Tab accepts a standing ghost even before the completion list comes back.')

    // Reset for the acceptance-through-the-list check below.
    act(() => { editor.replaceText('const seed = 0\nbo'); editor.gotoBufferEnd() })
    await settle(500)

    // Accepting through an open list inserts the real text and retires the hint.
    const listDeadline = performance.now() + 8_000
    while (performance.now() < listDeadline && !setup.captureCharFrame().includes('completions')) await settle(40)
    if (!findGhost('dyweight')) {
      throw new Error(`The reopened list did not ghost its selection:\n${setup.captureCharFrame()}`)
    }
    act(() => { handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' }) })
    const acceptDeadline = performance.now() + 5_000
    while (performance.now() < acceptDeadline && !editor.plainText.endsWith('bodyweight')) await settle(40)
    if (!editor.plainText.endsWith('bodyweight')) {
      throw new Error(`Accepting the suggestion did not insert it: ${JSON.stringify(editor.plainText.slice(-40))}`)
    }
    await settle(200)
    if (findGhost('dyweight')) throw new Error('The ghost is still drawn after its suggestion was accepted')
    console.log('Accepting through the list inserts the real text and clears the ghost.')

    // Escape refuses the suggestion, and the hint outlives the list by design —
    // so it has to be retired explicitly or it would describe something the
    // user has just declined.
    act(() => { editor.replaceText('const seed = 0\nbo'); editor.gotoBufferEnd() })
    const escDeadline = performance.now() + 8_000
    while (performance.now() < escDeadline && !findGhost('dyweight')) await settle(40)
    if (!findGhost('dyweight')) throw new Error('No ghost to dismiss')
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await settle(300)
    if (findGhost('dyweight')) {
      throw new Error(`The ghost survived an Escape that dismissed its suggestion:\n${setup.captureCharFrame()}`)
    }
    console.log('Escape retires the ghost along with the list.')

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
