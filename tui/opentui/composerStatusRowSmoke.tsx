/** @jsxImportSource @opentui/react */
// The docked composer's stats/hint row is painted *into* its bottom border,
// the way the title is painted into the top one. Nothing else can see that:
// the row renders identically whether it sits on the border or on an ordinary
// flow row one line above it, and the only symptom of getting it wrong is a
// wasted row of draft area. This pins both halves — the row lands on the
// border, and the dock spends no height on it.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Hermetic: state files resolve from process.cwd(). Import App AFTER chdir.
process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-composer-status-smoke-')))
const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 140, height: 40, kittyKeyboard: true })
const settle = async (ms = 700) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
await settle(2500)

type Geometry = { x: number; y: number; width: number; height: number }
const dock = setup.renderer.root.findDescendantById('composer-dock') as unknown as Geometry | null
const status = setup.renderer.root.findDescendantById('composer-dock-status') as unknown as Geometry | null
if (!dock || !status) throw new Error('Composer dock or its status row is missing')

const borderRow = dock.y + dock.height - 1
if (status.y !== borderRow) {
  throw new Error(`Status row is on row ${status.y}, not the dock's bottom border row ${borderRow}`)
}
// It has to stay inside the border's horizontal run, or it paints over a corner.
if (status.x <= dock.x || status.x + status.width >= dock.x + dock.width) {
  throw new Error(`Status row ${status.x}..${status.x + status.width} overruns the dock's corners`)
}

// And it must actually be drawn there: an absolutely positioned row that is
// clipped by the parent would satisfy the geometry check and show nothing.
const frame = setup.captureCharFrame().split('\n')
const drawn = frame[borderRow] ?? ''
if (!drawn.includes('send')) {
  throw new Error(`Bottom border row does not carry the composer hints:\n${drawn}`)
}
// And it costs the dock no height: outside fullscreen the dock is exactly the
// draft plus its two border rows. A status row that moved onto the border but
// left its row reserved renders identically — only this catches that.
const textarea = setup.renderer.root.findDescendantById('composer-textarea') as unknown as Geometry | null
if (!textarea) throw new Error('Composer textarea is missing')
if (dock.height !== textarea.height + 2) {
  throw new Error(`Dock is ${dock.height} rows for a ${textarea.height}-row draft; expected ${textarea.height + 2}`)
}

// Chat view docks its own composer inside the reader's frame, with its own
// border and its own status row — the same rule, a separate implementation.
act(() => { setup.mockInput.pressKey('v') })
await settle(400)
for (let index = 0; index < 5; index += 1) act(() => { setup.mockInput.pressArrow('down') })
act(() => { setup.mockInput.pressEnter() })
await settle(1500)

const chatDock = setup.renderer.root.findDescendantById('composer-dock') as unknown as Geometry | null
const chatStatus = setup.renderer.root.findDescendantById('chat-composer-status') as unknown as Geometry | null
if (!chatDock || !chatStatus) throw new Error('Chat composer dock or its status row is missing')
const chatBorderRow = chatDock.y + chatDock.height - 1
if (chatStatus.y !== chatBorderRow) {
  throw new Error(`Chat status row is on row ${chatStatus.y}, not the border row ${chatBorderRow}`)
}
// Overrunning here overwrites the chat dock's own right border, which is inside
// the reader's — the frame loses a wall rather than merely looking cramped.
if (chatStatus.x <= chatDock.x || chatStatus.x + chatStatus.width >= chatDock.x + chatDock.width) {
  throw new Error(`Chat status row ${chatStatus.x}..${chatStatus.x + chatStatus.width} overruns its border`)
}
const chatFrame = setup.captureCharFrame().split('\n')
const chatDrawn = chatFrame[chatBorderRow] ?? ''
if (!/focus|send/.test(chatDrawn)) {
  throw new Error(`Chat bottom border row does not carry the status text:\n${chatDrawn}`)
}
// Both dock borders must survive the overlay: the chat dock's and the reader's.
if (!/[│┘].*[│┘]\s*$/.test(chatDrawn.trimEnd())) {
  throw new Error(`Chat status row painted over a frame wall:\n${chatDrawn}`)
}
const chatTextarea = setup.renderer.root.findDescendantById('composer-textarea') as unknown as Geometry | null
if (!chatTextarea) throw new Error('Chat composer textarea is missing')
if (chatDock.height !== chatTextarea.height + 2) {
  throw new Error(`Chat dock is ${chatDock.height} rows for a ${chatTextarea.height}-row draft; expected ${chatTextarea.height + 2}`)
}

console.log('composerStatusRowSmoke: ok')
process.exit(0)
