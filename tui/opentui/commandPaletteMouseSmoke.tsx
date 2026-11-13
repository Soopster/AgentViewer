/** @jsxImportSource @opentui/react */
// The command palette with the mouse alone: the wheel scrolls the list without
// moving the selection, hovering selects, a click on a row runs it, the ▼ row
// pages, and a press outside closes. PgDn/End move the selection by keyboard.
import React from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-palette-mouse-')))
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 36, kittyKeyboard: true })
const settle = async (ms = 150) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) }); await act(async () => { await setup.flush() }) }
type Frame = { x: number; y: number; width: number; height: number }
const node = (id: string) => setup.renderer.root.findDescendantById(id) as unknown as Frame | null
const screen = () => setup.captureCharFrame()
const position = () => /(\d+)\/(\d+)/.exec(screen().split('\n').find(line => line.includes('type to filter') || line.includes('> ')) ?? '')
const openPalette = async () => { await act(async () => { setup.mockInput.pressKey('?') }); await settle(300); assert(node('command-palette'), 'the palette did not open') }

await settle(2500)
await openPalette()
const palette = node('command-palette')!
const before = position()?.[1]
assert.equal(before, '1', 'the palette opens on its first command')
assert(!screen().includes('▲ '), 'nothing is hidden above at the start')

await act(async () => { await setup.mockMouse.scroll(palette.x + 10, palette.y + 1, "down") })
await settle()
assert(screen().includes('▲ '), `the wheel did not scroll the list:\n${screen()}`)
assert.equal(position()?.[1], '1', 'the wheel moved the selection')

const below = node('command-palette-more-below')
assert(below, 'no ▼ row to page with')
const firstRowBefore = screen()
await act(async () => { await setup.mockMouse.click(below.x + 2, below.y) })
await settle()
assert.notEqual(screen(), firstRowBefore, 'clicking ▼ did not page the list')

// Hover selects the row under the pointer.
const rows = () => (setup.renderer.root.findDescendantById('command-palette') as unknown as { getChildren(): Array<{ id: string; x: number; y: number }> }).getChildren().filter(child => child.id?.startsWith('command-palette-row:'))
const target = rows()[3]!
await act(async () => { await setup.mockMouse.moveTo(target.x + 4, target.y) })
await settle()
assert.notEqual(position()?.[1], '1', 'hovering did not select the row')

await settle()

// A press outside closes it.
await act(async () => { await setup.mockMouse.click(2, 12) })
await settle()
assert(!node('command-palette'), 'a press outside did not close the palette')

// A click on a row runs it: filter to the plugin manager and click its row.
await openPalette()
await act(async () => { await setup.mockInput.typeText('Plugins: turn') })
await settle(300)
const run = rows()[0]
assert(run, `no row for the plugin manager:\n${screen()}`)
await act(async () => { await setup.mockMouse.click(run.x + 4, run.y) })
await settle(500)
assert(!node('command-palette'), 'running a command left the palette open')
assert(node('plugin-manager'), `clicking the row did not run it:\n${screen()}`)
console.log('Command palette mouse smoke passed (wheel scroll, ▼ paging, hover select, click outside, click to run)')
act(() => setup.renderer.destroy())
process.exit(0)
