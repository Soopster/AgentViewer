/** @jsxImportSource @opentui/react */
// Navigation and the tab lifecycle: back/forward, remembered carets, reopening
// a closed file, closing the others, and the problem list.
//
// Every assertion here is about a place, and a place is invisible in a render —
// a transcript of the editor looks identical whether the caret came back to
// line 40 or silently reset to line 0. Two of these behaved that way before:
// the textarea is keyed by path, so every tab switch remounted it at 0:0, and
// "go back" popped its history rather than moving through it, so there was
// nothing to go forward to and a mis-jump could not be undone.
//
// Keys go through the popover's own handleKey first, exactly as App.tsx routes
// them, and fall through to the focused textarea only when the popover
// declines — a smoke that types into the textarea alone tests none of this.
import React, { act } from 'react'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import {
  createEditorJumpList,
  editorJumpBackward,
  editorJumpForward,
  forgetEditorJumpPath,
  recordEditorJump,
} from './editorJumpList'

// --- the stack itself, before any rendering ---------------------------------
{
  const list = createEditorJumpList()
  recordEditorJump(list, { path: 'a.ts', line: 1, character: 0 })
  recordEditorJump(list, { path: 'b.ts', line: 2, character: 0 })
  const back = editorJumpBackward(list, { path: 'c.ts', line: 3, character: 0 })
  if (back?.path !== 'b.ts') throw new Error('Back did not return the most recent entry')
  const forward = editorJumpForward(list, { path: 'b.ts', line: 2, character: 0 })
  if (forward?.path !== 'c.ts') throw new Error('Going back did not leave anywhere to go forward to')
  // A fresh jump abandons the branch that was ahead.
  editorJumpBackward(list, { path: 'c.ts', line: 3, character: 0 })
  recordEditorJump(list, { path: 'd.ts', line: 4, character: 0 })
  if (list.forward.length !== 0) throw new Error('A new jump did not clear the forward stack')
  // The same spot twice running is one entry, or "back" needs pressing twice
  // to move once.
  const collapsing = createEditorJumpList()
  recordEditorJump(collapsing, { path: 'a.ts', line: 1, character: 0 })
  recordEditorJump(collapsing, { path: 'a.ts', line: 1, character: 9 })
  if (collapsing.back.length !== 1) throw new Error('Consecutive entries for one line were not collapsed')
  forgetEditorJumpPath(collapsing, 'a.ts')
  if (collapsing.back.some((entry) => entry.path === 'a.ts')) {
    throw new Error('A deleted path stayed reachable through history')
  }
  console.log('Jump list moves both ways and forgets deleted paths.')
}

const workspace = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-nav-'))
const alphaPath = join(workspace, 'alpha.ts')
const betaPath = join(workspace, 'beta.ts')
const serverPath = join(workspace, 'fake-lsp')
const originalServer = process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })

const ALPHA = 'const alphaOne = 1\nconst alphaTwo = 2\nconst alphaThree = 3\nconst alphaFour = 4\nconst alphaFive = 5\nconst alphaSix = 6\n'
const BETA = 'const betaOne = 1\nconst betaTwo = 2\nconst betaThree = 3\nconst betaFour = 4\n'

try {
  // Publishes two diagnostics for whatever file is opened, which is all the
  // problem list needs to exist at all.
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
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: { openClose: true, change: 2 } } } })
    if (msg.method === 'textDocument/didOpen') {
      const uri = msg.params.textDocument.uri
      send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [
        { range: { start: { line: 1, character: 6 }, end: { line: 1, character: 8 } }, severity: 1, source: 'fake', message: 'first fake problem' },
        { range: { start: { line: 4, character: 6 }, end: { line: 4, character: 8 } }, severity: 2, source: 'fake', message: 'second fake problem' },
      ] } })
    }
  }
})
`, 'utf8')
  await chmod(serverPath, 0o755)
  process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = serverPath
  await writeFile(alphaPath, ALPHA, 'utf8')
  await writeFile(betaPath, BETA, 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={workspace}
      initialPath={alphaPath}
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

  try {
    await settle(1_200)
    if (!handleKey) throw new Error('Navigation smoke never received the key handler')
    const activeEditor = (): TextareaRenderable => {
      const node = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
      if (!node) throw new Error('Navigation smoke did not mount the editor')
      return node
    }
    // The textarea is remounted per path, so it must be re-found after any
    // switch — holding the first one measures a detached buffer.
    const activeText = (): string => activeEditor().plainText
    const activeRow = (): number => activeEditor().logicalCursor.row
    const press = async (key: EditorKeyEvent) => {
      let consumed = false
      act(() => { consumed = handleKey?.(key) ?? false })
      if (!consumed) await act(async () => { await setup.mockInput.pressKey(key.sequence ?? '') })
      await settle(220)
    }
    const key = (name: string, extra: Partial<EditorKeyEvent> = {}): EditorKeyEvent => (
      { name, ctrl: false, shift: false, sequence: '', ...extra } as EditorKeyEvent
    )
    const type = async (text: string) => {
      for (const character of text) await press(key(character, { sequence: character }))
    }
    const openViaQuickOpen = async (query: string) => {
      await press(key('p', { ctrl: true }))
      await type(query)
      await press(key('return'))
      await settle(400)
    }

    if (!activeText().startsWith('const alphaOne')) throw new Error('alpha.ts did not open')

    // --- back and forward ---------------------------------------------------
    act(() => { activeEditor().setCursor(3, 6) })
    await settle(250)
    await openViaQuickOpen('beta')
    if (!activeText().startsWith('const betaOne')) {
      throw new Error(`Quick open did not switch to beta.ts: ${JSON.stringify(activeText().slice(0, 20))}`)
    }
    await press(key('t', { ctrl: true }))
    if (!activeText().startsWith('const alphaOne')) throw new Error('Ctrl+T did not go back to alpha.ts')
    if (activeRow() !== 3) throw new Error(`Going back landed on line ${activeRow() + 1}, not the line it left from`)
    console.log('Ctrl+T returns to the file and line the jump left from.')

    await press(key('t', { option: true }))
    if (!activeText().startsWith('const betaOne')) {
      throw new Error(`Alt+T did not go forward again: ${JSON.stringify(activeText().slice(0, 20))}`)
    }
    console.log('Alt+T goes forward again — back is no longer one-way.')

    await press(key('t', { ctrl: true }))
    if (!activeText().startsWith('const alphaOne')) throw new Error('Back after a forward step did not work')
    console.log('Back and forward compose rather than cancelling the history out.')

    // --- remembered caret across a tab switch -------------------------------
    act(() => { activeEditor().setCursor(5, 3) })
    await settle(250)
    await press(key('tab', { ctrl: true }))
    if (!activeText().startsWith('const betaOne')) throw new Error('Ctrl+Tab did not switch tabs')
    act(() => { activeEditor().setCursor(2, 4) })
    await settle(250)
    await press(key('tab', { ctrl: true }))
    if (!activeText().startsWith('const alphaOne')) throw new Error('Ctrl+Tab did not switch back')
    if (activeRow() !== 5) {
      throw new Error(`Switching back to alpha.ts reset the caret to line ${activeRow() + 1} instead of 6`)
    }
    console.log('Switching tabs keeps each file’s caret where it was left.')

    // --- close, reopen, and the caret surviving it --------------------------
    await press(key('tab', { ctrl: true }))
    if (!activeText().startsWith('const betaOne')) throw new Error('Expected beta.ts to be active before closing it')
    await press(key('w', { ctrl: true }))
    await settle(300)
    if (!activeText().startsWith('const alphaOne')) throw new Error('Ctrl+W did not close beta.ts')
    await press(key('t', { ctrl: true, shift: true }))
    await settle(500)
    if (!activeText().startsWith('const betaOne')) {
      throw new Error(`Ctrl+Shift+T did not reopen the closed file: ${JSON.stringify(activeText().slice(0, 20))}`)
    }
    if (activeRow() !== 2) {
      throw new Error(`Reopening beta.ts landed on line ${activeRow() + 1} rather than the line it was closed on`)
    }
    console.log('Ctrl+Shift+T reopens the last closed file at the line it was closed on.')

    // --- close others -------------------------------------------------------
    await press(key('w', { option: true }))
    await settle(300)
    if (!activeText().startsWith('const betaOne')) throw new Error('Close others closed the active tab')
    // The explorer lists every file in the workspace, so presence alone proves
    // nothing — a file that is *also* open shows up a second time, in the tab
    // strip, and that second mention is what closing removes.
    const mentions = (frame: string, name: string): number => frame.split(name).length - 1
    const frameAfterCloseOthers = setup.captureCharFrame()
    if (mentions(frameAfterCloseOthers, 'alpha.ts') !== 1) {
      throw new Error(`Alt+W left alpha.ts open in the tab strip:\n${frameAfterCloseOthers}`)
    }
    if (mentions(frameAfterCloseOthers, 'beta.ts') < 2) {
      throw new Error(`Alt+W closed the active tab as well:\n${frameAfterCloseOthers}`)
    }
    console.log('Alt+W closes every other saved tab and keeps the active one.')

    // --- the problem list ---------------------------------------------------
    const problemDeadline = performance.now() + 8_000
    while (performance.now() < problemDeadline) {
      act(() => { handleKey?.(key('f7')) })
      await settle(120)
      if (setup.captureCharFrame().includes('first fake problem')) break
    }
    const problemFrame = setup.captureCharFrame()
    if (!problemFrame.includes('first fake problem') || !problemFrame.includes('second fake problem')) {
      throw new Error(`F7 did not list the file’s diagnostics:\n${problemFrame}`)
    }
    console.log('F7 lists every diagnostic in the file, not just the first.')

    await press(key('down'))
    await press(key('return'))
    if (activeRow() !== 4) {
      throw new Error(`Choosing the second problem moved to line ${activeRow() + 1}, not line 5`)
    }
    // The message also lands in the status bar, so the overlay's own hint line
    // is what says whether the list is still on screen.
    if (setup.captureCharFrame().includes('Enter jump')) {
      throw new Error('The problem list stayed open after jumping')
    }
    console.log('Enter jumps to the selected problem and closes the list.')

    // And the jump list learned about it: going back leaves the problem's line.
    await press(key('t', { ctrl: true }))
    if (activeRow() === 4 && activeText().startsWith('const betaOne')) {
      throw new Error('Jumping to a problem did not record a place to go back to')
    }
    console.log('A problem jump is recorded in the navigation history.')
    console.log('Editor navigation smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  if (originalServer == null) delete process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN
  else process.env.AGENT_VIEWER_TYPESCRIPT_LSP_BIN = originalServer
  syntaxStyle.destroy()
  await rm(workspace, { recursive: true, force: true })
}
