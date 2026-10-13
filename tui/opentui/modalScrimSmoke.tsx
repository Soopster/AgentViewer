/** @jsxImportSource @opentui/react */
// A modal dims and drains the colour from what is behind it, and leaves itself
// alone. The character frame is the same with or without a scrim, and the same
// whether the panel is above it or under it, so this reads painted colours.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-modal-scrim-smoke-'))
mkdirSync(path.join(cwd, '.agent-viewer-data'))
writeFileSync(path.join(cwd, '.agent-viewer-data', 'tui.json'), JSON.stringify({ theme: 'dark' }))
process.chdir(cwd)

const { getThemePalette } = await import('../theme')
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

type Cell = { text: string; fg: [number, number, number]; bg: [number, number, number] }
const cells = (): Cell[][] => setup.captureSpans().lines.map((line) => line.spans.flatMap((span) => {
  const [fr, fg, fb] = span.fg.toInts()
  const [br, bg, bb] = span.bg.toInts()
  const cell: Cell = { text: span.text, fg: [fr, fg, fb], bg: [br, bg, bb] }
  return Array.from({ length: span.width }, () => cell)
}))
const light = ([r, g, b]: [number, number, number]) => r + g + b
const saturation = ([r, g, b]: [number, number, number]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b, 1)
const hex = (rgb: [number, number, number]) => `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`

await settle(2500)
const before = cells()
// ⇧F opens the worktree task modal, which sits in the middle of the screen.
act(() => { setup.mockInput.pressKey('F', { shift: true }) })
await settle(600)
const frame = setup.captureCharFrame()
if (!frame.includes('New worktree task')) fail(`⇧F did not open the worktree modal:\n${frame}`)
const after = cells()

// Behind the modal: the top row is darker, and coloured cells are greyer.
// Dimming alone scales every channel alike and leaves saturation where it was,
// so the two are measured separately.
let compared = 0
let coloured = 0
for (let x = 0; x < 120; x += 1) {
  const was = before[0]?.[x]
  const now = after[0]?.[x]
  if (!was || !now || light(was.fg) === 0) continue
  compared += 1
  if (light(now.fg) >= light(was.fg)) fail(`cell ${x},0 behind the modal was not dimmed (${hex(was.fg)} → ${hex(now.fg)})`)
}
if (compared < 10) fail(`only ${compared} cells of the top row had anything to compare`)
const modalRows = frame.split('\n').flatMap((line, y) => (/[┌│└]/.test(line.slice(20, 100)) ? [y] : []))
for (let y = 0; y < before.length; y += 1) {
  if (modalRows.includes(y)) continue
  for (let x = 0; x < 120; x += 1) {
    const was = before[y]?.[x]
    const now = after[y]?.[x]
    if (!was || !now || was.text !== now.text || saturation(was.fg) < 0.3) continue
    coloured += 1
    if (saturation(now.fg) > saturation(was.fg) * 0.8) {
      fail(`cell ${x},${y} behind the modal kept its colour (${hex(was.fg)} → ${hex(now.fg)})`)
    }
  }
}
if (coloured === 0) fail('nothing coloured was behind the modal, so desaturation was not tested')

// The modal itself: its title is drawn in the theme's own amber, untouched.
const theme = getThemePalette('dark')
const titleRow = frame.split('\n').findIndex((line) => line.includes('New worktree task'))
const titleColumn = frame.split('\n')[titleRow]!.indexOf('New worktree task')
const title = after[titleRow]?.[titleColumn]
if (!title || hex(title.fg) !== theme.amber.toLowerCase()) {
  fail(`the modal's title is ${title ? hex(title.fg) : 'missing'}, expected the theme's ${theme.amber} — the scrim reached the panel`)
}

console.log(`modal scrim smoke passed (${compared} cells dimmed, ${coloured} coloured cells desaturated, the panel untouched)`)
process.exit(0)
