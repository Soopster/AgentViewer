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

const initialTextarea = setup.renderer.root.findDescendantById('composer-textarea') as unknown as {
  height: number
  setText: (text: string) => void
} | null
if (!initialTextarea) {
  throw new Error(`Chat view frame missing the composer textarea:\n${setup.captureCharFrame()}`)
}
const initialHeight = initialTextarea.height

// A single logical line should produce multiple virtual rows and grow the
// compact composer, rather than scrolling within one clipped viewport row.
act(() => {
  initialTextarea.setText('wrap this long composer text '.repeat(28))
})
await act(async () => {
  await setup.flush()
})

const wrappedTextarea = setup.renderer.root.findDescendantById('composer-textarea') as unknown as {
  height: number
  editorView: { getTotalVirtualLineCount: () => number }
  wrapMode: string
} | null
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
