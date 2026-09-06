/** @jsxImportSource @opentui/react */
// Surface-panel smoke: mounts the real OpenTUI root, opens the right-hand
// surface panel with ⇧O, and drives the launcher's letter shortcuts. It covers
// the wiring tsc cannot — that the panel actually takes width out of the reader,
// that the launcher renders every surface, and that a picked surface mounts.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Hermetic: state files resolve from process.cwd(). Import App AFTER chdir.
const repoRoot = process.cwd()
process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-surface-smoke-')))
const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 160, height: 44, kittyKeyboard: true })
const { captureCharFrame } = setup

const settle = async (ms = 600) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}

await settle(2500)

/** Locate a rendered label so the mouse assertions do not hard-code geometry. */
const locate = (frame: string, needle: string): { x: number; y: number } => {
  const lines = frame.split('\n')
  for (let y = 0; y < lines.length; y += 1) {
    const x = lines[y]!.indexOf(needle)
    if (x !== -1) return { x: x + 1, y }
  }
  throw new Error(`Could not locate "${needle}" in the frame:\n${frame}`)
}

const before = captureCharFrame()
if (!before || before.trim().length === 0) throw new Error('App rendered an empty frame')
if (before.includes('Open a surface')) throw new Error('Surface panel is visible before ⇧O')

act(() => { setup.mockInput.pressKey('O', { shift: true }) })
await settle(900)

const launcher = captureCharFrame()
for (const label of ['Open a surface', 'Browser', 'Terminal', 'Files', 'Diff', 'Pull request', 'Agents']) {
  if (!launcher.includes(label)) {
    throw new Error(`Surface launcher is missing "${label}"`)
  }
}
if (!launcher.includes('esc leaves')) {
  throw new Error('Surface launcher is missing its key hint row')
}

// The message column should be one continuous frame down to the footer: the
// composer docks directly below the transcript at the same x/width, and its
// bottom lands on the same row as the full-height surface panel.
type FrameGeometry = { x: number; y: number; width: number; height: number }
const transcriptFrame = setup.renderer.root.findDescendantById('transcript-reader') as unknown as FrameGeometry | null
const composerFrame = setup.renderer.root.findDescendantById('composer-dock') as unknown as FrameGeometry | null
const surfaceFrame = setup.renderer.root.findDescendantById('surface-panel-frame') as unknown as FrameGeometry | null
if (
  !transcriptFrame
  || !composerFrame
  || !surfaceFrame
  || transcriptFrame.x !== composerFrame.x
  || transcriptFrame.width !== composerFrame.width
  || transcriptFrame.x + transcriptFrame.width !== surfaceFrame.x
  || transcriptFrame.y + transcriptFrame.height !== composerFrame.y
  || composerFrame.y + composerFrame.height !== surfaceFrame.y + surfaceFrame.height
) {
  throw new Error(`Message frame does not meet the footer beside the surface panel:\n${launcher}`)
}

// = expands the panel to everything the reader's minimum leaves, and back.
const panelWidthOf = (frame: string) => Math.max(
  ...frame.split('\n').map((line) => {
    const index = line.indexOf('─ Panel')
    return index === -1 ? 0 : line.length - index
  }),
)
const restoredWidth = panelWidthOf(launcher)
act(() => { setup.mockInput.pressKey('=') })
await settle(700)
const expandedFrame = captureCharFrame()
if (!expandedFrame.includes('Panel · expanded')) throw new Error('= did not expand the panel')
if (panelWidthOf(expandedFrame) <= restoredWidth) {
  throw new Error('Expanded panel is no wider than the restored one')
}
act(() => { setup.mockInput.pressKey('=') })
await settle(700)
if (captureCharFrame().includes('Panel · expanded')) throw new Error('= did not restore the panel width')

// The launcher rows are clickable, not only keyable: a click opens the surface
// and takes panel focus, the same way clicking a split pane focuses it.
const filesCard = locate(launcher, '▤ Files')
await act(async () => { await setup.mockMouse.click(filesCard.x, filesCard.y) })
await settle(2000)
const clickedFiles = captureCharFrame()
if (clickedFiles.includes('Open a surface')) {
  throw new Error(`Clicking the Files launcher card did not open it:\n${clickedFiles}`)
}
// ⌃W closes it again so the keyboard path below starts from the launcher.
act(() => { setup.mockInput.pressKey('w', { ctrl: true }) })
await settle(700)

// D docks the git surface: the same popover the ⌃G overlay renders, filling
// the panel instead of the screen.
act(() => { setup.mockInput.pressKey('D') })
await settle(2500)
const diff = captureCharFrame()
if (diff.includes('Open a surface')) throw new Error('Launcher still showing after picking Diff')
if (!/Git|Status|Branches/.test(diff)) throw new Error(`Diff surface did not mount:\n${diff}`)
if (process.env.DUMP_FRAME === '1') {
  const lines = diff.split('\n')
  console.log(lines.map((line, index) => `${String(index).padStart(3)}|${line.slice(90)}`).slice(-14).join('\n'))
  console.log('rows', lines.length)
}

// ⌃T re-opens the launcher over the mounted surface so a second tab can be
// added, and both then live in the tab strip.
act(() => { setup.mockInput.pressKey('t', { ctrl: true }) })
await settle(600)
if (!captureCharFrame().includes('Open a surface')) {
  throw new Error('⌃T did not re-open the launcher over an open surface')
}
act(() => { setup.mockInput.pressKey('A') })
await settle(1200)
const twoTabs = captureCharFrame()
if (!twoTabs.includes('Diff') || !twoTabs.includes('Agents')) {
  throw new Error(`Second tab did not join the strip:\n${twoTabs}`)
}
// Clicking a tab switches to it, and clicking its × closes it. Escape first, so
// the click also has to take focus back — a click on an unfocused panel must
// work, otherwise the mouse and the keyboard disagree about where focus is.
act(() => { setup.mockInput.pressKey('\x1b') })
await settle(400)
const diffTab = locate(twoTabs, '± Diff')
await act(async () => { await setup.mockMouse.click(diffTab.x + 2, diffTab.y) })
await settle(1500)
const backOnDiff = captureCharFrame()
if (!/Git|Status|Branches/.test(backOnDiff)) {
  throw new Error(`Clicking the Diff tab did not switch to it:\n${backOnDiff}`)
}
const diffClose = locate(backOnDiff, '± Diff')
await act(async () => { await setup.mockMouse.click(diffClose.x + '± Diff '.length, diffClose.y) })
await settle(1200)
const afterClose = captureCharFrame()
if (/\[1\] Status/.test(afterClose)) {
  throw new Error(`Clicking × on the Diff tab did not close it:\n${afterClose}`)
}
act(() => { setup.mockInput.pressKey('w', { ctrl: true }) })
await settle(700)

// ⌃W closes it and returns to the launcher.
act(() => { setup.mockInput.pressKey('w', { ctrl: true }) })
await settle(700)
if (!captureCharFrame().includes('Open a surface')) {
  throw new Error('⌃W did not close the docked surface')
}

// F docks the file browser. Narrow panels drop the parent column rather than
// overflowing, so the listing and preview must both still be there.
act(() => { setup.mockInput.pressKey('F') })
await settle(2000)
const files = captureCharFrame()
if (!/Files|items|Preview/.test(files)) throw new Error(`Files surface did not mount:\n${files}`)

// Tab belongs to the surface, not the panel: the file browser switches its own
// listing/preview panes with it. With a second tab open, a Tab that cycled the
// panel would swap the whole surface out — assert it does not.
act(() => { setup.mockInput.pressKey('t', { ctrl: true }) })
await settle(500)
act(() => { setup.mockInput.pressKey('A') })
await settle(1200)
act(() => { setup.mockInput.pressKey('p', { ctrl: true }) })
await settle(1200)
const beforeTab = captureCharFrame()
if (!/items/.test(beforeTab)) throw new Error(`⌃P did not return to the file browser:\n${beforeTab}`)
act(() => { setup.mockInput.pressTab() })
await settle(700)
const afterTab = captureCharFrame()
if (!/items/.test(afterTab)) {
  throw new Error(`Tab cycled the panel's tabs instead of the surface's panes:\n${afterTab}`)
}
act(() => { setup.mockInput.pressKey('w', { ctrl: true }) })
await settle(600)
act(() => { setup.mockInput.pressKey('w', { ctrl: true }) })
await settle(700)

// B opens the browser surface: a URL prompt, not the launcher.
act(() => { setup.mockInput.pressKey('B') })
await settle(900)
const browser = captureCharFrame()
if (browser.includes('Open a surface')) throw new Error('Launcher still showing after picking Browser')
if (!browser.includes('URL, host, or port')) throw new Error('Browser surface did not mount')

// Escape returns focus to the reader without closing the panel, so the
// transcript keys work again while the surface stays put.
act(() => { setup.mockInput.pressKey('\x1b') })
await settle(500)
const afterEscape = captureCharFrame()
if (!afterEscape.includes('URL, host, or port')) {
  throw new Error('Escape closed the surface instead of only blurring the panel')
}

// ⇧O refocuses, ⇧O again closes the panel entirely.
act(() => { setup.mockInput.pressKey('O', { shift: true }) })
await settle(400)
act(() => { setup.mockInput.pressKey('O', { shift: true }) })
await settle(600)
const closed = captureCharFrame()
if (closed.includes('URL, host, or port')) throw new Error('⇧O did not close the surface panel')
const closedTranscriptFrame = setup.renderer.root.findDescendantById('transcript-reader') as unknown as FrameGeometry | null
const closedComposerFrame = setup.renderer.root.findDescendantById('composer-dock') as unknown as FrameGeometry | null
if (
  !closedTranscriptFrame
  || !closedComposerFrame
  || closedTranscriptFrame.y + closedTranscriptFrame.height !== closedComposerFrame.y
) {
  throw new Error(`Transcript left a blank row above the composer after the surface panel closed:\n${closed}`)
}

process.chdir(repoRoot)
console.log('surfacePanelSmoke: ok')
// Boot effects leave live timers (session polls, registry reconcile) — exit
// explicitly instead of waiting for them.
process.exit(0)
