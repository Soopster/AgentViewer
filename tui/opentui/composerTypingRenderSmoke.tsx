/** @jsxImportSource @opentui/react */
// Typing into the composer must not re-render the root per keystroke.
//
// The draft used to be root state, so every key rendered the whole app (~3.5ms
// of React work on top of the terminal's own frame). It is now read, not
// subscribed to: the root renders only when something it draws from the draft
// changes (line counts, a slash command being typed, the width of the
// character count), and the status row's count subscribes on its own. The frame
// is identical either way, so this reads `readRootRenderCount()` and the screen
// for the count itself, which is what would silently go stale if the child did
// not subscribe.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-typing-render-smoke-')))
const { default: OpenTuiApp, readRootRenderCount } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 140, height: 40, kittyKeyboard: true })
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
await settle(2500)

act(() => { setup.mockInput.pressKey('c') })
await settle(500)
// Four characters first: crossing from none to some changes the stats row's
// shape, which is a legitimate render.
for (const ch of 'abcd') act(() => { setup.mockInput.pressKey(ch) })
await settle(500)

const before = readRootRenderCount()
for (const ch of 'efghi') {
  act(() => { setup.mockInput.pressKey(ch) })
  await settle(60)
}
await settle(400)
const renders = readRootRenderCount() - before
if (renders !== 0) {
  console.error(`typing 5 characters re-rendered the root ${renders} time(s)`)
  process.exit(1)
}
const frame = setup.captureCharFrame()
if (!/9 chars/.test(frame)) {
  console.error(`the character count did not follow the draft:\n${frame}`)
  process.exit(1)
}
console.log('composer typing render smoke passed (no root renders per key, count follows)')
process.exit(0)
