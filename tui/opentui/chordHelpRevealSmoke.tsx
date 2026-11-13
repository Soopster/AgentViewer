/** @jsxImportSource @opentui/react */
// Which-key reveal, driven through the real root. The rule under test cannot be
// checked any other way: the panel and the pending chord are both on screen, and
// whether the next keystroke reaches the chord dispatcher or is eaten by the
// panel is invisible in the frame until you press one.
import React from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-chord-help-smoke-')))
const { CHORD_HELP_REVEAL_MS } = await import('./chordHelp')
const { default: OpenTuiApp } = await import('./App')

function collectIds(): string[] {
  const out: string[] = []
  const walk = (node: { id?: string; getChildren?: () => unknown[] }) => {
    if (node.id) out.push(node.id)
    for (const child of node.getChildren?.() ?? []) walk(child as never)
  }
  walk(setup.renderer.root as never)
  return out
}
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const { captureCharFrame, mockInput } = setup

const settle = async (ms: number) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

await settle(2500)
assert.ok(!captureCharFrame().includes('split pane keybinds'),
  'The help panel must not be showing before a chord is pressed')

// ── hesitating on a prefix reveals its keys ────────────────────────────────
await act(async () => { mockInput.pressKey('b', { ctrl: true }) })
await settle(Math.floor(CHORD_HELP_REVEAL_MS / 3))
assert.ok(!captureCharFrame().includes('split pane keybinds'),
  'The panel must not appear immediately — someone typing a chord they know should never see it')

await settle(CHORD_HELP_REVEAL_MS)
assert.ok(captureCharFrame().includes('split pane keybinds'),
  'Holding a prefix must reveal its keys on its own')

await settle(4_100)
assert.ok(captureCharFrame().includes('split pane keybinds'), 'Ctrl+B help must remain beyond the old four-second timeout')

// ── a self-revealed panel must not swallow the chord's next key ────────────
// `~` is not a ⌃B chord, so the dispatcher answers with its unknown-key notice.
// If the panel had consumed the keystroke instead, the notice would be absent
// and the chord silently cancelled — hesitating would change what a key does.
await act(async () => { mockInput.pressKey('~') })
await settle(300)
const afterUnbound = captureCharFrame()
assert.ok(afterUnbound.includes('is not bound'),
  `The pending chord must still receive the key: ${JSON.stringify(afterUnbound.slice(-400))}`)
assert.ok(!afterUnbound.includes('split pane keybinds'),
  'Resolving the chord takes the self-revealed panel with it')

// ── a panel opened on purpose is a palette over the chord table ───────────
// It owns the keyboard: j/k and arrows move the selection, typing filters,
// ⏎ runs the selected chord, Esc closes. No key reaches the chord dispatcher.
await act(async () => { mockInput.pressKey('b', { ctrl: true }) })
await settle(50)
await act(async () => { mockInput.pressKey('?') })
await settle(200)
assert.ok(captureCharFrame().includes('split pane keybinds'), '⌃B ? opens the panel')
assert.ok(captureCharFrame().includes('esc closes'), 'the footer says how to close it')
const selectedPosition = () => /\b(\d+)\/(\d+)\b/.exec(captureCharFrame().split('\n').find(line => line.includes('type to filter') || line.includes('> ')) ?? '')
assert.equal(selectedPosition()?.[1], '1', 'the panel opens on its first entry')
await act(async () => { mockInput.pressKey('j') })
await settle(100)
await act(async () => { mockInput.pressArrow('down') })
await settle(100)
assert.equal(selectedPosition()?.[1], '3', 'j and ↓ move the selection')
await act(async () => { await mockInput.typeText('widen') })
await settle(150)
assert.ok(captureCharFrame().includes('> widen'), 'typing filters the table')
assert.ok(!captureCharFrame().includes('⌃B w is not bound'), 'a typed key reached the chord dispatcher')
assert.ok(captureCharFrame().includes('split pane keybinds'), 'typing closed the panel')
await act(async () => { mockInput.pressEscape() })
await settle(200)
assert.ok(!captureCharFrame().includes('split pane keybinds'), 'Esc closes the panel')

// ⏎ on an entry runs its chord exactly as typing it would: ⌃B ? then filter to
// the window layout menu (⌃B w) and run it.
await act(async () => { mockInput.pressKey('b', { ctrl: true }) })
await settle(50)
await act(async () => { mockInput.pressKey('?') })
await settle(200)
await act(async () => { await mockInput.typeText('layout menu') })
await settle(150)
await act(async () => { mockInput.pressEnter() })
await settle(400)
assert.ok(!captureCharFrame().includes('split pane keybinds'), 'running an entry closed the panel')
const layoutMenuOpen = () => collectIds().some(id => id.startsWith('window-layout:'))
assert.ok(layoutMenuOpen(), `⏎ did not run ⌃B w (the layout menu):\n${captureCharFrame()}`)
await act(async () => { mockInput.pressEscape() })
await settle(200)
assert.ok(!layoutMenuOpen(), 'the layout menu did not close')

// ── the mouse, as in the palette: hover selects, a click runs, a press outside closes ──
await act(async () => { mockInput.pressKey('b', { ctrl: true }) })
await settle(50)
await act(async () => { mockInput.pressKey('?') })
await settle(200)
type Frame = { x: number; y: number }
const rowNode = (id: string) => setup.renderer.root.findDescendantById(id) as unknown as Frame | null
const stacked = rowNode('chord-help-row:split:" · s')
assert.ok(stacked, `no row for ⌃B " :\n${JSON.stringify(collectIds().filter(id => id.startsWith('chord-help-row')).slice(0, 5))}`)
await act(async () => { await setup.mockMouse.moveTo(stacked.x + 6, stacked.y) })
await settle(150)
assert.equal(selectedPosition()?.[1], '2', 'hovering an entry selects it')
await act(async () => { await setup.mockMouse.click(2, 12) })
await settle(200)
assert.ok(!captureCharFrame().includes('split pane keybinds'), 'a press outside closes the panel')
// The self-revealed panel answers the mouse too: hesitate on ⌃B, then click "layout menu".
await act(async () => { mockInput.pressKey('b', { ctrl: true }) })
await settle(CHORD_HELP_REVEAL_MS + 300)
const layoutRow = collectIds().find(id => id.startsWith('chord-help-row:') && id.endsWith(':w'))
assert.ok(layoutRow, 'the revealed panel has no ⌃B w row')
const layoutFrame = rowNode(layoutRow)!
await act(async () => { await setup.mockMouse.click(layoutFrame.x + 6, layoutFrame.y) })
await settle(400)
assert.ok(layoutMenuOpen(), 'clicking a revealed entry did not run its chord')
await act(async () => { mockInput.pressEscape() })
await settle(200)

// ── the same machinery serves ⌃K ───────────────────────────────────────────
await act(async () => { mockInput.pressKey('k', { ctrl: true }) })
await settle(CHORD_HELP_REVEAL_MS + 400)
assert.ok(captureCharFrame().includes('command chords'),
  'The ⌃K prefix reveals its own table, not the split one')
await settle(4_100)
assert.ok(captureCharFrame().includes('command chords'), 'Ctrl+K help must remain beyond the old four-second timeout')
await act(async () => { mockInput.pressEscape() })
await settle(200)
assert.ok(!captureCharFrame().includes('command chords'), 'Cancelling the chord closes its panel')

console.log('Chord help reveal smoke passed (delayed reveal, no key swallowing, palette keys/filter/run, ⌃K parity)')
process.exit(0)
