/** @jsxImportSource @opentui/react */
// A file's line endings must survive a round trip through the editor.
//
// The terminal edit buffer strips carriage returns, so a CRLF file used to
// come back as LF and be saved that way: open a Windows-authored file, type
// one character, save, and every line in the file had changed. Nothing else
// could catch it — the editor renders a CRLF file and an LF file identically,
// and the diff only appears in git.
import React, { act } from 'react'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import {
  applyEditorLineEnding,
  detectEditorLineEnding,
  normalizeEditorNewlines,
} from './editorLineEndings'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

const CR = String.fromCharCode(13)
const CRLF = `${CR}\n`

// Unit coverage first: the helpers the whole boundary rests on.
if (detectEditorLineEnding(`a${CRLF}b\n`) !== CRLF) throw new Error('A file containing CRLF must be treated as CRLF')
if (detectEditorLineEnding('a\nb\n') !== '\n') throw new Error('An LF file must be treated as LF')
if (normalizeEditorNewlines(`a${CRLF}b${CR}c\n`) !== 'a\nb\nc\n') throw new Error('CRLF and lone CR must both normalize to LF')
if (applyEditorLineEnding('a\nb\n', CRLF) !== `a${CRLF}b${CRLF}`) throw new Error('LF content must be written back as CRLF')
if (applyEditorLineEnding('a\nb\n', '\n') !== 'a\nb\n') throw new Error('LF content must be written back unchanged')

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-line-ending-'))
const sourcePath = join(workspace, 'main.ts')
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = join(workspace, 'absent-language-server')
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null

try {
  const original = `const alpha = 1${CRLF}const bravo = 2${CRLF}const charlie = 3${CRLF}`
  await writeFile(sourcePath, original, 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={sourcePath}
      theme={DARK_THEME}
      width={96}
      height={24}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 96, height: 24 },
  )
  const settle = async (durationMs: number) => {
    const deadline = performance.now() + durationMs
    while (performance.now() < deadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
    }
  }

  try {
    await settle(900)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor || !handleKey) throw new Error('Line-ending smoke did not mount the editor')

    // The buffer works in LF regardless of what the file used, so no carriage
    // return should be visible to the editor or rendered into the frame.
    if (editor.plainText.includes(CR)) throw new Error('The buffer should hold LF, not the file\'s CRLF')
    if (!editor.plainText.startsWith('const alpha = 1\nconst bravo = 2\n')) {
      throw new Error(`A CRLF file loaded wrong: ${JSON.stringify(editor.plainText)}`)
    }
    console.log('A CRLF file loads into the buffer as LF.')

    // A one-character edit followed by a save must change exactly that one
    // character on disk.
    act(() => {
      editor.focus()
      editor.cursorOffset = editor.plainText.indexOf('const bravo')
    })
    await settle(120)
    await act(async () => { await setup.mockInput.typeText('//') })
    await settle(200)
    act(() => { handleKey?.({ name: 's', ctrl: true, shift: false, sequence: '' }) })
    const saveDeadline = performance.now() + 8_000
    let onDisk = await readFile(sourcePath, 'utf8')
    while (performance.now() < saveDeadline && !onDisk.includes('//const bravo')) {
      await settle(60)
      onDisk = await readFile(sourcePath, 'utf8')
    }
    const expected = original.replace('const bravo', '//const bravo')
    if (onDisk !== expected) {
      throw new Error(
        `Saving a CRLF file did not preserve its line endings.\n`
        + `expected ${JSON.stringify(expected)}\n     got ${JSON.stringify(onDisk)}`,
      )
    }
    console.log('Saving a CRLF file rewrites only the edited text, not every line ending.')

    // An external change with the file's own endings must not read as a
    // conflict, and must not loop the disk watcher.
    const externally = original.replace('const charlie = 3', 'const charlie = 30')
    await writeFile(sourcePath, externally.replace('const bravo', '//const bravo'), 'utf8')
    const reloadDeadline = performance.now() + 10_000
    while (performance.now() < reloadDeadline && !editor.plainText.includes('charlie = 30')) await settle(60)
    if (!editor.plainText.includes('charlie = 30')) {
      throw new Error(`An external edit to a CRLF file never reloaded:\n${setup.captureCharFrame()}`)
    }
    if (editor.plainText.includes(CR)) throw new Error('A reload put carriage returns into the buffer')
    if (setup.captureCharFrame().includes('changed on disk')) {
      throw new Error(`A clean external edit to a CRLF file was reported as a conflict:\n${setup.captureCharFrame()}`)
    }
    console.log('An external edit to a CRLF file reloads cleanly instead of reading as a conflict.')
    console.log('Editor line-ending smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}
