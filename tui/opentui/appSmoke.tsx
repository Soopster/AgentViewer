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
const { captureCharFrame, captureSpans } = setup

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
const initialSpans = captureSpans().lines.flatMap((line) => line.spans)
const sessionHeaderSpan = initialSpans.find((span) => span.text.includes('SESSION'))
const configuredProvider = ['all', 'codex', 'opencode', 'copilot', 'pi', 'lmstudio'].includes(process.env.AGENT_VIEWER_PROVIDER ?? '')
  ? process.env.AGENT_VIEWER_PROVIDER!
  : 'claude'
const providerBadgeLabel = configuredProvider.toUpperCase()
const providerBadgeSpan = initialSpans.find((span) => span.text.trim() === providerBadgeLabel)
const providerBadgeRenderable = setup.renderer.root.findDescendantById('sidebar-provider-badge')
if (
  !sessionHeaderSpan
  || !providerBadgeSpan
  || providerBadgeRenderable?.width !== providerBadgeLabel.length + 2
  || providerBadgeSpan.text.length !== providerBadgeLabel.length + 2
  || sessionHeaderSpan.bg.toString() === providerBadgeSpan.bg.toString()
) {
  throw new Error('Session header provider badge is missing its compact distinctive background')
}

// The root command palette doubles as the discoverable hotkey guide. Verify it
// advertises the portable alias for a command whose direct Ctrl+Shift chord is
// unavailable in legacy/raw terminal protocols.
act(() => {
  setup.mockInput.pressKey('?')
})
await act(async () => {
  await setup.flush()
})
// The command array and category-grouped render order must stay identical.
// Eleven moves reaches the second Transcript command; a mismatch used to jump
// the highlight ahead to the later Session group instead.
for (let index = 0; index < 11; index += 1) {
  act(() => { setup.mockInput.pressArrow('down') })
  await act(async () => { await setup.flush() })
}
const orderedPaletteFrame = captureCharFrame()
if (!orderedPaletteFrame.includes('▎Previous search match')) {
  throw new Error(`Command palette keyboard navigation diverged from its visible category order:\n${orderedPaletteFrame}`)
}
for (const key of 'coordinated') {
  act(() => { setup.mockInput.pressKey(key) })
  await act(async () => { await setup.flush() })
}
const shortcutPaletteFrame = captureCharFrame()
if (!shortcutPaletteFrame.includes('Start coordinated run') || !shortcutPaletteFrame.includes('⌃K n / ⌃⇧N')) {
  throw new Error(`Command palette did not advertise the portable coordinated-run shortcut:\n${shortcutPaletteFrame}`)
}
act(() => {
  setup.mockInput.pressEscape()
})
await act(async () => {
  await setup.flush()
})

// Shift+Z is the TUI equivalent of the web transcript fullscreen experience: it
// keeps the reader and composer, replaces the ordinary header with one compact
// restore affordance, and hides the surrounding app chrome. Composer visibility
// remains independently toggleable while fullscreen is active.
act(() => {
  setup.mockInput.pressKey('z', { shift: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
let fullscreenFrame = captureCharFrame()
if (!fullscreenFrame.includes('FULLSCREEN  Shift+Z restore')) {
  throw new Error(`Shift+Z did not expose the fullscreen restore affordance:\n${fullscreenFrame}`)
}
if (fullscreenFrame.includes('j/k move') || fullscreenFrame.includes('SESSIONS') || fullscreenFrame.includes('● LIVE')) {
  throw new Error(`Fullscreen left non-essential app chrome visible:\n${fullscreenFrame}`)
}
const fullscreenReader = setup.renderer.root.findDescendantById('transcript-reader') as unknown as { border: boolean | string[]; width: number } | null
const fullscreenComposer = setup.renderer.root.findDescendantById('composer-dock') as unknown as { border: boolean | string[] } | null
const fullscreenRows = fullscreenFrame.split('\n')
if (
  !fullscreenReader
  || !Array.isArray(fullscreenReader.border)
  || fullscreenReader.border.length !== 0
  || fullscreenReader.width !== 120
  || !fullscreenComposer
  || !Array.isArray(fullscreenComposer.border)
  || fullscreenComposer.border.length !== 0
  || fullscreenRows[0]?.startsWith('┌')
  || fullscreenRows[1]?.startsWith('│')
) {
  throw new Error(`Fullscreen did not remove the edge frames or return their width to the transcript:\n${fullscreenFrame}`)
}

act(() => {
  setup.mockInput.pressKey('e', { shift: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
fullscreenFrame = captureCharFrame()
if (fullscreenFrame.includes('COMPOSER') || !fullscreenFrame.includes('FULLSCREEN  Shift+Z restore')) {
  throw new Error(`Shift+E did not minimize the composer independently in fullscreen:\n${fullscreenFrame}`)
}
act(() => {
  setup.mockInput.pressKey('e', { shift: true })
  setup.mockInput.pressKey('z', { shift: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
const restoredFullscreenFrame = captureCharFrame()
if (restoredFullscreenFrame.includes('FULLSCREEN  Shift+Z restore') || !restoredFullscreenFrame.includes('COMPOSER')) {
  throw new Error(`Shift+Z did not restore normal chrome and composer state:\n${restoredFullscreenFrame}`)
}

// The fullscreen toggle must also restore the app while the composer owns the
// keyboard; Esc only leaves the composer and keeps fullscreen active.
act(() => {
  setup.mockInput.pressKey('z', { shift: true })
})
await act(async () => {
  await setup.flush()
})
act(() => {
  setup.mockInput.pressKey('c')
})
await act(async () => {
  await setup.flush()
})
act(() => {
  setup.mockInput.pressEscape()
})
await act(async () => {
  await setup.flush()
})
const escapedComposerFrame = captureCharFrame()
if (!escapedComposerFrame.includes('FULLSCREEN  Shift+Z restore')) {
  throw new Error(`Esc unexpectedly restored normal chrome from fullscreen:\n${escapedComposerFrame}`)
}
act(() => {
  setup.mockInput.pressKey('c')
})
await act(async () => {
  await setup.flush()
})
act(() => {
  setup.mockInput.pressKey('z', { shift: true })
})
await act(async () => {
  await setup.flush()
})
const shiftZRestoredFrame = captureCharFrame()
if (shiftZRestoredFrame.includes('FULLSCREEN  Shift+Z restore') || !shiftZRestoredFrame.includes('SESSIONS')) {
  throw new Error(`Shift+Z did not restore normal chrome while the composer was active:\n${shiftZRestoredFrame}`)
}
act(() => {
  setup.mockInput.pressEscape()
})
await act(async () => {
  await setup.flush()
})

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

// Cross-session messaging has its own global popover. It must open from the
// root shortcut even when no session exists in this hermetic workspace, and
// keep the empty state actionable rather than falling through to the reader.
act(() => {
  setup.mockInput.pressKey('M', { shift: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 250))
})
const messagingFrame = captureCharFrame()
if (!messagingFrame.includes('Cross-session messaging')) {
  throw new Error(`Shift+M did not open cross-session messaging:\n${messagingFrame}`)
}
if (!messagingFrame.includes('reachable') || !messagingFrame.includes('message')) {
  throw new Error(`Cross-session messaging popover is missing discovery/composer UI:\n${messagingFrame}`)
}
act(() => {
  setup.mockInput.pressEscape()
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})

// The project editor is a first-class root overlay. Verify the portable Ctrl+E
// launcher and that its own Ctrl+Q command returns keyboard ownership to App.
act(() => {
  setup.mockInput.pressKey('e', { ctrl: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 250))
})
const editorFrame = captureCharFrame()
if (!editorFrame.includes('EDITOR') || !editorFrame.includes('EXPLORER') || !editorFrame.includes('^P open')) {
  throw new Error(`Ctrl+E did not open the project editor:\n${editorFrame}`)
}
act(() => {
  setup.mockInput.pressKey('q', { ctrl: true })
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 100))
})
if (captureCharFrame().includes(' EDITOR')) {
  throw new Error('Ctrl+Q did not close the project editor')
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

// Exercise the portable root command chord and overlay hand-off. Ctrl+K then A
// must work even when a terminal cannot distinguish Ctrl+Shift+A from Ctrl+A.
// This is intentionally App-level: the CoordinationPopover smoke also covers
// `n`, but it cannot prove the board closes and the New Workflow launcher.
act(() => {
  setup.mockInput.pressKey('k', { ctrl: true })
})
await act(async () => {
  await setup.flush()
})
const commandChordFrame = captureCharFrame()
if (!commandChordFrame.includes('a Agent Operations')) {
  throw new Error(`Ctrl+K did not expose the portable command chord:\n${commandChordFrame}`)
}
act(() => {
  setup.mockInput.pressKey('a')
})
await act(async () => {
  await setup.flush()
  await new Promise((resolve) => setTimeout(resolve, 200))
})
let coordinationFrame = captureCharFrame()
if (!coordinationFrame.includes('AGENT CONTROL CENTER')) {
  throw new Error(`Ctrl+K A did not open Agent Operations:\n${coordinationFrame}`)
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
