/** @jsxImportSource @opentui/react */
// Which-key reveal, driven through the real root. The rule under test cannot be
// checked any other way: the panel and the pending chord are both on screen, and
// whether the next keystroke reaches the chord dispatcher or is eaten by the
// panel is invisible in the frame until you press one.
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-chord-help-smoke-')))
const { CHORD_HELP_REVEAL_MS } = await import('./chordHelp')
const { default: OpenTuiApp } = await import('./App')

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

// ── a self-revealed panel must not swallow the chord's next key ────────────
// `q` is not a ⌃B chord, so the dispatcher answers with its unknown-key notice.
// If the panel had consumed the keystroke instead, the notice would be absent
// and the chord silently cancelled — hesitating would change what a key does.
await act(async () => { mockInput.pressKey('q') })
await settle(300)
const afterUnbound = captureCharFrame()
assert.ok(afterUnbound.includes('is not bound'),
  `The pending chord must still receive the key: ${JSON.stringify(afterUnbound.slice(-400))}`)
assert.ok(!afterUnbound.includes('split pane keybinds'),
  'Resolving the chord takes the self-revealed panel with it')

// ── a panel opened on purpose does absorb the next key ─────────────────────
// It is a reference card the user asked for, so any key dismisses it rather
// than leaving them hunting for the one that does.
await act(async () => { mockInput.pressKey('b', { ctrl: true }) })
await settle(50)
await act(async () => { mockInput.pressKey('?') })
await settle(200)
assert.ok(captureCharFrame().includes('split pane keybinds'), '⌃B ? opens the panel')
assert.ok(captureCharFrame().includes('any key closes'),
  'An explicitly opened panel must say it closes on any key — and that line lives in the footer, '
  + 'which the composer dock used to draw over')

// A different unbound key from the one used above: the earlier notice is still
// on screen, so the assertion has to be about *this* key rather than about any
// notice at all.
await act(async () => { mockInput.pressKey('w') })
await settle(300)
const afterDismiss = captureCharFrame()
assert.ok(!afterDismiss.includes('split pane keybinds'), 'Any key dismisses a panel that was asked for')
assert.ok(!afterDismiss.includes('⌃B w is not bound'),
  'A dismissing key is absorbed by the panel, not re-dispatched as a chord')

// ── the same machinery serves ⌃K ───────────────────────────────────────────
await act(async () => { mockInput.pressKey('k', { ctrl: true }) })
await settle(CHORD_HELP_REVEAL_MS + 400)
assert.ok(captureCharFrame().includes('command chords'),
  'The ⌃K prefix reveals its own table, not the split one')
await act(async () => { mockInput.pressEscape() })
await settle(200)
assert.ok(!captureCharFrame().includes('command chords'), 'Cancelling the chord closes its panel')

console.log('Chord help reveal smoke passed (delayed reveal, no key swallowing, explicit panel absorbs, ⌃K parity)')
process.exit(0)
