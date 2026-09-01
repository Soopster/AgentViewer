/** @jsxImportSource @opentui/react */
// Tab, in every state the editor can be in when it is pressed.
//
// Tab is overloaded — indent, outdent, accept a completion, accept a ghost,
// advance a snippet placeholder — and each claimant sits in front of the next
// in one key handler. That ordering is easy to break from either end: a new
// claimant added too early swallows indenting, and a claimant that declines
// without anyone behind it makes the key do nothing at all. Plain Tab with no
// selection did exactly that — the popover declined it and the textarea has no
// Tab action, so it silently inserted nothing.
import React, { act } from 'react'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-tab-'))
const sourcePath = join(workspace, 'main.ts')
const serverPath = join(workspace, 'fake-lsp')
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

try {
  // Only answers for `zz`, so every other case here runs with no completions
  // and no ghost standing — which is where indenting has to work.
  await writeFile(serverPath, String.raw`#!/usr/bin/env node
let input = Buffer.alloc(0)
function send(m) { const b = JSON.stringify(m); process.stdout.write('Content-Length: ' + Buffer.byteLength(b) + '\r\n\r\n' + b) }
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  while (true) {
    const he = input.indexOf('\r\n\r\n')
    if (he < 0) return
    const m = /Content-Length:\s*(\d+)/i.exec(input.subarray(0, he).toString('ascii'))
    if (!m) return
    const len = Number(m[1]); const st = he + 4
    if (input.length < st + len) return
    const msg = JSON.parse(input.subarray(st, st + len).toString('utf8'))
    input = input.subarray(st + len)
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 2 }, completionProvider: {} } } })
    if (msg.method === 'textDocument/completion') send({ jsonrpc: '2.0', id: msg.id, result: [
      { label: 'zzebra', kind: 6, sortText: '000', preselect: true, insertText: 'zzebra' },
    ] })
  }
})
`, 'utf8')
  await chmod(serverPath, 0o755)
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = serverPath
  await writeFile(sourcePath, 'alpha\nbravo\n', 'utf8')

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
  const settle = async (durationMs: number) => {
    const deadline = performance.now() + durationMs
    while (performance.now() < deadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
    }
  }

  try {
    await settle(900)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (!editor || !handleKey) throw new Error('Tab smoke did not mount the editor')

    const text = (): string => editor.plainText
    const reset = async (value: string) => {
      act(() => { editor.replaceText(value); editor.focus(); editor.clearSelection() })
      await settle(300)
    }
    // The real routing: App gives the key to the popover, and only if the
    // popover declines does the focused textarea get it.
    const pressTab = async (shift = false) => {
      let consumed = false
      act(() => { consumed = handleKey?.({ name: 'tab', ctrl: false, shift, sequence: '\t' }) ?? false })
      if (!consumed) await act(async () => { await setup.mockInput.pressTab() })
      await settle(200)
    }

    await reset('alpha\nbravo\n')
    act(() => { editor.setCursor(0, 5) })
    await settle(300)
    await pressTab()
    // Column 5 with a two-space indent: the next tab stop is column 6, so one
    // space, not a whole unit.
    if (text() !== 'alpha \nbravo\n') {
      throw new Error(`Tab at end of a line did not indent: ${JSON.stringify(text())}`)
    }
    console.log('Tab with nothing selected inserts an indent.')

    // Indenting advances to the next tab stop, so a caret sitting part-way
    // through an indent lands on it instead of overshooting.
    await reset('alpha\n')
    act(() => { editor.setCursor(0, 1) })
    await settle(300)
    await pressTab()
    if (text() !== 'a lpha\n') {
      throw new Error(`Tab did not advance to the next tab stop: ${JSON.stringify(text())}`)
    }
    console.log('Tab advances to the next tab stop rather than inserting a whole unit.')

    await reset('alpha\nbravo\n')
    act(() => { editor.setSelection(0, 8) })
    await settle(300)
    await pressTab()
    if (text() !== '  alpha\n  bravo\n') {
      throw new Error(`Tab with a selection did not indent every selected line: ${JSON.stringify(text())}`)
    }
    console.log('Tab with a selection indents every line it covers.')

    await reset('  alpha\n  bravo\n')
    act(() => { editor.setSelection(0, 12) })
    await settle(300)
    await pressTab(true)
    if (text() !== 'alpha\nbravo\n') {
      throw new Error(`Shift+Tab with a selection did not outdent: ${JSON.stringify(text())}`)
    }
    console.log('Shift+Tab with a selection outdents every line it covers.')

    await reset('  alpha\n')
    act(() => { editor.setCursor(0, 4) })
    await settle(300)
    await pressTab(true)
    if (text() !== 'alpha\n') {
      throw new Error(`Shift+Tab with nothing selected did not outdent the line: ${JSON.stringify(text())}`)
    }
    console.log('Shift+Tab with nothing selected outdents the current line.')

    // With a suggestion on screen, Tab belongs to the suggestion — that is the
    // one case where it must not indent.
    await reset('alpha\nzz')
    act(() => { editor.gotoBufferEnd() })
    await settle(200)
    await act(async () => { await setup.mockInput.typeText('e') })
    const suggestionDeadline = performance.now() + 8_000
    while (performance.now() < suggestionDeadline && !setup.captureCharFrame().includes('zzebra')) await settle(40)
    if (!setup.captureCharFrame().includes('zzebra')) {
      throw new Error(`The suggestion never appeared:\n${setup.captureCharFrame()}`)
    }
    await pressTab()
    if (!text().endsWith('zzebra')) {
      throw new Error(`Tab indented instead of accepting the visible suggestion: ${JSON.stringify(text())}`)
    }
    console.log('Tab accepts a visible suggestion instead of indenting.')

    // And once the suggestion is gone, Tab is an indent key again.
    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '' }) })
    await settle(300)
    const beforeIndent = text()
    await pressTab()
    if (text() !== `${beforeIndent}  `) {
      throw new Error(
        `Tab did not go back to indenting once the suggestion was dismissed:`
        + ` ${JSON.stringify(text().slice(-20))}`,
      )
    }
    console.log('Tab indents again once the suggestion is dismissed.')
    console.log('Editor tab smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}
