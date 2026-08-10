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
  await new Promise((resolve) => setTimeout(resolve, 350))
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('NEW WORKFLOW')) {
  throw new Error(`N from Agent Operations did not open New Workflow:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('Use separate teammate checkouts')) {
  throw new Error(`New Workflow is missing the optional worktree control:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('2 available')) {
  throw new Error(`New Workflow did not expose the saved playbook selector:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('Autonomy') || !coordinationFrame.includes('Judgment review')) {
  throw new Error(`New Workflow did not expose autonomy and judgment review controls:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('Acceptance checks') || !coordinationFrame.includes('Non-goals') || !coordinationFrame.includes('Manual QA') || !coordinationFrame.includes('Escalation')) {
  throw new Error(`New Workflow did not expose the acceptance contract controls:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('Tokens') || !coordinationFrame.includes('Minutes')) {
  throw new Error(`New Workflow did not expose token and duration budgets:\n${coordinationFrame}`)
}

// Prompt -> contract fields -> playbook. Select the first playbook, then move into its
// argument field and assert spaces remain spaces (a one-row bottom border once
// rendered through them as hyphens).
for (let index = 0; index < 5; index += 1) {
  act(() => { setup.mockInput.pressTab() })
  await act(async () => { await setup.flush() })
}
act(() => {
  setup.mockInput.pressArrow('right')
})
await act(async () => {
  await setup.flush()
})
act(() => {
  setup.mockInput.pressTab()
})
await act(async () => {
  await setup.flush()
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('What to audit') || coordinationFrame.includes('What-to-audit')) {
  throw new Error(`Playbook argument input rendered spaces incorrectly:\n${coordinationFrame}`)
}

// The provider pool uses checkboxes for membership and a separate, strongly
// marked cursor for Left/Right navigation.
for (let index = 0; index < 2; index += 1) {
  act(() => { setup.mockInput.pressTab() })
  await act(async () => { await setup.flush() })
}
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('›[x]CLAUDE‹')) {
  throw new Error(`Provider pool did not mark its keyboard cursor:\n${coordinationFrame}`)
}
act(() => { setup.mockInput.pressArrow('right') })
await act(async () => { await setup.flush() })
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('›[ ]CODEX‹')) {
  throw new Error(`Provider pool cursor did not move independently of membership:\n${coordinationFrame}`)
}

// Return to the playbook row. Opening the manager proves the launcher hands
// keyboard ownership to the CRUD surface.
for (let index = 0; index < 3; index += 1) {
  act(() => { setup.mockInput.pressTab({ shift: true }) })
  await act(async () => { await setup.flush() })
}
act(() => {
  setup.mockInput.pressKey('m')
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 250))
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('PLAYBOOK MANAGER') || !coordinationFrame.includes('audit')) {
  throw new Error(`New Workflow did not open the playbook manager:\n${coordinationFrame}`)
}
act(() => {
  setup.mockInput.pressKey('n')
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 150))
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('PLAYBOOK SETTINGS') || !coordinationFrame.includes('WORKFLOW STRUCTURE') || !coordinationFrame.includes('Task instructions')) {
  throw new Error(`New playbook did not open the structured editor:\n${coordinationFrame}`)
}
if (coordinationFrame.includes('"name": "new-playbook"')) {
  throw new Error(`New playbook unexpectedly exposed the raw JSON editor:\n${coordinationFrame}`)
}
if (!coordinationFrame.includes('Describe when this workflow should be used') || coordinationFrame.includes('Describe-when-this-workflow')) {
  throw new Error(`Structured playbook fields rendered spaces incorrectly:\n${coordinationFrame}`)
}
act(() => { setup.mockInput.pressArrow('left') })
await act(async () => {
  await setup.mockInput.typeText('x')
  await setup.flush()
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('new-playbooxk')) {
  throw new Error(`Left arrow did not move within the structured text field:\n${coordinationFrame}`)
}
act(() => { setup.mockInput.pressArrow('right') })
await act(async () => {
  await setup.mockInput.typeText('y')
  await setup.flush()
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('new-playbooxky')) {
  throw new Error(`Right arrow did not move within the structured text field:\n${coordinationFrame}`)
}
act(() => { setup.mockInput.pressTab() })
await act(async () => { await setup.flush() })
act(() => {
  setup.mockInput.pressKey('END')
  setup.mockInput.pressEnter()
})
await act(async () => {
  await setup.mockInput.typeText('Second line')
  await setup.flush()
})
coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('Second line') || !coordinationFrame.includes('Enter newline')) {
  throw new Error(`Structured description did not support multiline editing:\n${coordinationFrame}`)
}

console.log('Full App smoke render, playbook manager launch, Agent Operations N launch, and split chord passed')
// Boot effects leave live timers (session polls, registry reconcile) — exit
// explicitly instead of waiting for them.
process.exit(0)
