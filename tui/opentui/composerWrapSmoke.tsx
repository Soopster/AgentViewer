/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-composer-wrap-smoke-')))
const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, {
  width: 120,
  height: 40,
  kittyKeyboard: true,
})

await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 2500))
})

// Select chat view, whose compact one-row composer exposed the clipping bug.
act(() => {
  setup.mockInput.pressKey('v')
})
await act(async () => {
  await setup.flush()
})
for (let index = 0; index < 5; index += 1) {
  act(() => { setup.mockInput.pressArrow('down') })
}
act(() => {
  setup.mockInput.pressEnter()
})
await act(async () => {
  await setup.flush()
})

type ComposerTextarea = {
  height: number
  focused: boolean
  plainText: string
  wrapMode: string
  editorView: { getTotalVirtualLineCount: () => number }
}
const textarea = () =>
  setup.renderer.root.findDescendantById('composer-textarea') as unknown as ComposerTextarea | null
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}

const draft = 'wrap this long composer text '.repeat(12)

// Focus the composer, then type: the draft has to arrive the way a user's does.
// `setText` writes straight into the edit buffer without emitting the
// content-change event, so `composerDraft` — the state the composer's height is
// derived from — never moves, and the composer stays one row no matter how the
// wrapping behaves. This smoke spent a while asserting exactly that.
//
// Both steps are polled rather than given one fixed wait. The session opens
// asynchronously, and a `c` that lands before it does goes to the transcript
// instead, leaving the keystrokes to fall on the floor — which reads as a
// wrapping failure rather than a focus one.
// Wait for chat view itself first. `chat-composer-focus-state` is rendered only
// by the chat composer, so it is the signal that the session finished opening
// *and* that the view picker landed where this smoke assumes — a `c` sent
// before that goes somewhere else entirely and never comes back.
for (let attempt = 0; attempt < 40 && !setup.renderer.root.findDescendantById('chat-composer-focus-state'); attempt += 1) {
  await settle()
}
if (!setup.renderer.root.findDescendantById('chat-composer-focus-state')) {
  throw new Error(`Chat view never opened:\n${setup.captureCharFrame()}`)
}
// One press, then poll: `c` only activates while the composer is inactive, so a
// second press after it lands is typed into the draft instead.
act(() => { setup.mockInput.pressKey('c') })
for (let attempt = 0; attempt < 40 && !textarea()?.focused; attempt += 1) {
  await settle()
}
if (!textarea()?.focused) {
  throw new Error(`Composer never took focus in chat view:\n${setup.captureCharFrame()}`)
}
const initialHeight = textarea()!.height

await act(async () => {
  await setup.mockInput.typeText(draft)
})
for (let attempt = 0; attempt < 12 && (textarea()?.plainText.length ?? 0) < draft.length; attempt += 1) {
  await settle()
}
if ((textarea()?.plainText.length ?? 0) !== draft.length) {
  throw new Error(
    `Composer holds ${textarea()?.plainText.length ?? 0} of ${draft.length} typed characters:\n`
    + setup.captureCharFrame(),
  )
}

// A single logical line should produce multiple virtual rows and grow the
// compact composer, rather than scrolling within one clipped viewport row.
const wrappedTextarea = textarea()
const totalLines = wrappedTextarea?.editorView.getTotalVirtualLineCount() ?? 0
if (
  !wrappedTextarea
  || wrappedTextarea.wrapMode !== 'word'
  || totalLines <= 1
  || wrappedTextarea.height <= initialHeight
) {
  throw new Error(
    `Long text did not expand the chat composer `
    + `(wrap=${wrappedTextarea?.wrapMode ?? 'missing'}, total=${totalLines}, `
    + `height=${wrappedTextarea?.height ?? 0}, initial=${initialHeight}):\n${setup.captureCharFrame()}`,
  )
}

console.log('OpenTUI chat composer soft-wrap smoke passed')
process.exit(0)
