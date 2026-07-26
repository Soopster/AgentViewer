/** @jsxImportSource @opentui/react */
// Full-app smoke: mounts the real OpenTUI root under the test renderer, lets
// the boot effects settle (theme/provider/session load, running-registry
// poll), and asserts a frame actually rendered. Catches runtime wiring errors
// that the component-level smokes and tsc can't — it exercises the same code
// path `npm run tui` boots, minus the terminal.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// Hermetic: state files resolve from process.cwd(), so run against a temp
// data dir rather than the user's real preferences. Import App AFTER chdir.
process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-app-smoke-')))
const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, {
  width: 120,
  height: 40,
  // Preserve distinct Ctrl+Shift chords so the smoke exercises the same
  // Agent Operations shortcuts as a modern terminal.
  kittyKeyboard: true,
})
const { captureCharFrame } = setup

await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 2500))
})

const frame = captureCharFrame()
if (!frame || frame.trim().length === 0) {
  throw new Error('Full app rendered an empty frame')
}
if (!frame.includes('COMPOSER')) {
  throw new Error('Full app frame missing the composer dock')
}

// New agent session: Shift+N opens the folder/provider picker modal (rather
// than immediately creating a session in the viewed workspace). Assert the
// modal renders both choosable rows, then Esc restores the reader so the
// split-chord test below runs from a clean root state.
act(() => {
  setup.mockInput.pressKey('N', { shift: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 150))
})
const newSessionFrame = captureCharFrame()
if (!newSessionFrame.includes('New agent session')) {
  throw new Error(`Shift+N did not open the New agent session modal:\n${newSessionFrame}`)
}
if (!newSessionFrame.includes('Folder') || !newSessionFrame.includes('Provider')) {
  throw new Error(`New agent session modal is missing the folder/provider rows:\n${newSessionFrame}`)
}
act(() => {
  setup.mockInput.pressEscape()
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
const afterCloseFrame = captureCharFrame()
if (afterCloseFrame.includes('New agent session')) {
  throw new Error(`Esc did not close the New agent session modal:\n${afterCloseFrame}`)
}

// Split transcript panes ride a tmux-style prefix: ⌃B arms the chord (the
// status bar becomes the chord legend), then `%` runs the split — which must
// refuse here rather than mount an empty pane, since no second tab is open.
act(() => {
  setup.mockInput.pressKey('b', { ctrl: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
const chordFrame = captureCharFrame()
if (!chordFrame.includes('% split')) {
  throw new Error(`Ctrl+B did not arm the split chord:\n${chordFrame}`)
}

act(() => {
  setup.mockInput.pressKey('%')
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 200))
})
const splitFrame = captureCharFrame()
if (!splitFrame.includes('Open another tab to split')) {
  throw new Error(`Ctrl+B % did not run the split transcript command:\n${splitFrame}`)
}

// Exercise the real root keyboard dispatcher and overlay hand-off. This is
// intentionally App-level: the CoordinationPopover smoke also covers `n`, but
// it cannot prove the board closes and the New Workflow launcher replaces it.
act(() => {
  setup.mockInput.pressKey('a', { ctrl: true, shift: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 200))
})
let coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('AGENT CONTROL CENTER')) {
  throw new Error(`Ctrl+Shift+A did not open Agent Operations:\n${coordinationFrame}`)
}

act(() => {
  setup.mockInput.pressKey('n')
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 200))
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('NEW WORKFLOW')) {
  throw new Error(`N from Agent Operations did not open New Workflow:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('Use separate teammate checkouts')) {
  throw new Error(`New Workflow is missing the optional worktree control:\n${coordinationFrame}`)
}

console.log('Full App smoke render, Agent Operations N launch, and split chord passed')
// Boot effects leave live timers (session polls, registry reconcile) — exit
// explicitly instead of waiting for them.
process.exit(0)
