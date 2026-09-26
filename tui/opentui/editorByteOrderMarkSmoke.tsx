/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { editorTextFromDisk, editorTextToDisk } from './editorLineEndings'
import { prepareEditorBuffer } from './editorLargeFile'

// Visual Studio writes a UTF-8 BOM into most files it creates, and the terminal
// edit buffer silently drops a leading U+FEFF: 13 characters handed in, 12 held.
// The editor's integrity check reads any such shortfall as the buffer having
// refused the file, so it closed the tab and reported that the file "did not fit
// the editor buffer" — a capacity error, at any size, for most files on Windows.
//
// The mark is therefore stripped for the buffer and restored on write, exactly
// like a CRLF ending. Both halves fail invisibly: a file that will not open and
// a file whose first three bytes are quietly rewritten both look fine on screen.

const BOM = '﻿'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// --- the boundary itself ----------------------------------------------------

const fromDisk = editorTextFromDisk(`${BOM}one\r\ntwo\r\n`)
assert(!fromDisk.content.startsWith(BOM), 'The mark must not reach the buffer')
assert(fromDisk.content === 'one\ntwo\n', `The text must be LF and mark-free: ${JSON.stringify(fromDisk.content)}`)
assert(fromDisk.byteOrderMark && fromDisk.lineEnding === '\r\n', 'Both marks must be remembered')

const roundTripped = editorTextToDisk(fromDisk.content, fromDisk)
assert(roundTripped === `${BOM}one\r\ntwo\r\n`, `A round trip must be byte-identical: ${JSON.stringify(roundTripped)}`)

const withoutMark = editorTextFromDisk('one\ntwo\n')
assert(!withoutMark.byteOrderMark, 'A file with no mark must not gain one')
assert(editorTextToDisk('one\ntwo\n', withoutMark) === 'one\ntwo\n', 'A file with no mark must not gain one on write')

// A mark that is somehow already in the text is not doubled.
assert(editorTextToDisk(`${BOM}x\n`, { lineEnding: '\n', byteOrderMark: true }) === `${BOM}x\n`,
  'The mark must not be applied twice')

// Only a *leading* mark is a BOM; the same character mid-file is content.
const midFile = editorTextFromDisk(`a${BOM}b\n`)
assert(!midFile.byteOrderMark && midFile.content === `a${BOM}b\n`,
  'A U+FEFF inside the file is content, not a byte order mark')

// The open path strips it too, or the buffer refuses the file.
assert(!prepareEditorBuffer(`${BOM}hello\n`).content.startsWith(BOM),
  'prepareEditorBuffer must strip the mark the buffer will not hold')
assert(prepareEditorBuffer(`${BOM}hello\n`).byteOrderMark, 'prepareEditorBuffer must remember the mark')

console.log('Editor byte-order-mark boundary smoke passed')

// --- opening and saving one for real ----------------------------------------

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-bom-'))
const filePath = join(workspace, 'Program.cs')
const originalBytes = Buffer.concat([
  Buffer.from([0xEF, 0xBB, 0xBF]),
  Buffer.from('class C\r\n{\r\n}\r\n', 'utf8'),
])

let keyHandler: ((key: EditorKeyEvent) => boolean) | null = null
const notices: Array<{ kind: 'info' | 'error'; message: string }> = []
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

try {
  await writeFile(filePath, originalBytes)

  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={filePath}
      theme={DARK_THEME}
      width={110}
      height={28}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { keyHandler = handler }}
      onNotice={(kind, message) => { notices.push({ kind, message }) }}
      onClipboardRead={async () => ''}
      onClipboardWrite={async () => {}}
    />,
    { width: 110, height: 28 },
  )

  const settle = async (ms = 350) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }
  const waitForFrame = async (predicate: (rendered: string) => boolean, description: string, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const frame = setup.captureCharFrame()
      if (predicate(frame)) return frame
      await settle(150)
    }
    throw new Error(`Timed out waiting for ${description}:\n${setup.captureCharFrame()}`)
  }

  try {
    // It opens at all. This is the Windows failure: the tab was closed on sight
    // and the reason given was the buffer's capacity.
    const opened = await waitForFrame((frame) => frame.includes('Program.cs') && frame.includes('class C'),
      'the BOM file to open')
    assert(!opened.includes('did not fit the editor buffer'),
      `A file with a byte order mark was reported as too big for the buffer:\n${opened}`)
    assert(!opened.includes('was not opened'), `The BOM file's tab was closed:\n${opened}`)

    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable
    assert(!editor.plainText.startsWith(BOM), 'The mark must not be in the buffer')
    assert(editor.plainText === 'class C\n{\n}\n',
      `The buffer must hold LF, mark-free text: ${JSON.stringify(editor.plainText)}`)

    // Editing and saving must put both the mark and the CRLF endings back.
    // Read fresh on every press: the popover republishes its handler whenever
    // its state changes, so a handler captured once holds a stale `activeTab`
    // and saves the content as it was before the edit.
    const press = async (key: EditorKeyEvent) => {
      const handler = keyHandler as ((key: EditorKeyEvent) => boolean) | null
      assert(handler, 'The editor never published a key handler')
      await act(async () => { handler(key) })
    }
    await act(async () => { editor.gotoLine(2) })
    await settle(200)
    await act(async () => { setup.mockInput.typeText('  // added') })
    await settle(400)
    assert(editor.plainText.includes('// added'),
      `Typing did not reach the buffer: ${JSON.stringify(editor.plainText)}`)
    await press({ name: 's', ctrl: true, sequence: '' } as EditorKeyEvent)
    await settle(700)

    const saved = Buffer.from(await readFile(filePath))
    // Asserted first: the mark and the endings would both "survive" a save that
    // never happened, so proving the file changed is what makes the rest mean
    // anything.
    assert(saved.toString('utf8').includes('// added'),
      `The edit never reached the file: ${JSON.stringify(saved.toString('utf8'))} · notices ${JSON.stringify(notices)}`)
    assert(saved.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])),
      `The byte order mark was dropped on save: ${saved.subarray(0, 8).toString('hex')}`)
    const savedText = saved.toString('utf8')
    assert(savedText.includes('\r\n') && !/[^\r]\n/.test(savedText.slice(1)),
      `CRLF endings were not preserved alongside the mark: ${JSON.stringify(savedText)}`)

    console.log('Editor byte-order-mark open/save smoke passed (opens, and the mark survives a save)')
    await settle(400)
  } finally {
    setup.renderer?.destroy?.()
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
}
process.exit(0)
