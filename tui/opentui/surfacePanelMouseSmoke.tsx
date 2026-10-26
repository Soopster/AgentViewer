/** @jsxImportSource @opentui/react */
// The surface panel and its Terminal tab driven by the mouse alone, in the
// real App: the bar's buttons, dragging the inner border, the process and
// shell tabs, the hint buttons, and a shell program that asked for the mouse.
//
// Every target is located in the painted frame, never assumed: a click target
// that renders but takes no clicks (or another element's clicks) looks the
// same in a screenshot.
import React from 'react'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-viewer-surface-mouse-')))
process.chdir(workspace)
process.env.SHELL = '/bin/sh'
const { default: OpenTuiApp } = await import('./App')
const { getShells, shellTerminal, resetShellsForTest } = await import('./shellStore')
const { readAllScreenText } = await import('../../plugins/terminal/tui/shellScreen')
const { getProcesses, resetProcessesForTest } = await import('./processStore')

const WIDTH = 160
const HEIGHT = 48
const setup = await testRender(<OpenTuiApp />, { width: WIDTH, height: HEIGHT, kittyKeyboard: true, exitOnCtrlC: false })
const settle = async (ms = 250) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
type Frame = { x: number; y: number; width: number; height: number }
const frame = (id: string): Frame | null => {
  const box = setup.renderer.root.findDescendantById(id) as unknown as Frame | null
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}
const panel = () => {
  const box = frame('surface-panel-frame')
  assert(box, `no panel:\n${setup.captureCharFrame()}`)
  return box
}
/** The cell a label starts at, searched inside the panel only. */
const locate = (needle: string): { x: number; y: number } => {
  const box = panel()
  const lines = setup.captureCharFrame().split('\n')
  for (let y = box.y; y < box.y + box.height; y += 1) {
    const x = (lines[y] ?? '').indexOf(needle, box.x)
    if (x >= 0 && x < box.x + box.width) return { x, y }
  }
  throw new Error(`could not find ${JSON.stringify(needle)} in the panel:\n${setup.captureCharFrame()}`)
}
// A press, then motion a cell at a time, as a terminal reports a drag.
const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
  await act(async () => { await setup.mockMouse.pressDown(from.x, from.y) })
  await settle(80)
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps)
    const y = Math.round(from.y + ((to.y - from.y) * step) / steps)
    await act(async () => { await setup.mockMouse.emitMouseEvent('drag', x, y) })
    await settle(30)
  }
  await act(async () => { await setup.mockMouse.release(to.x, to.y) })
  await settle()
}
const click = async (needle: string, offset = 1) => {
  const at = locate(needle)
  await act(async () => { await setup.mockMouse.click(at.x + offset, at.y) })
  await settle()
}
const shellText = () => {
  const shell = getShells()[0]
  const term = shell ? shellTerminal(shell.id) : null
  return term ? readAllScreenText(term).join('\n') : ''
}
const until = async (predicate: () => boolean, what: string, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !predicate()) await settle(60)
  assert(predicate(), `${what}\n--- shell ---\n${shellText()}\n--- frame ---\n${setup.captureCharFrame()}`)
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressKey('O', { shift: true }) })
  await settle(400)

  // ── The bar's buttons and the border ─────────────────────────────────────
  const beside = panel()
  await click('⤓ under')
  const under = panel()
  assert(under.y > beside.y && under.x < beside.x, `the under button did not move the panel: ${JSON.stringify(under)}`)
  await drag({ x: under.x + 40, y: under.y }, { x: under.x + 40, y: under.y - 4 })
  assert(panel().height === under.height + 4, `dragging the top border up did not grow the panel: ${under.height} → ${panel().height}`)
  // The border is text; a drag that also selected it would copy a run of ─ on release.
  assert(!setup.renderer.getSelection()?.getSelectedText?.(), `the resize drag selected text: ${JSON.stringify(setup.renderer.getSelection()?.getSelectedText?.())}`)
  await click('⇥ beside')
  const back = panel()
  assert(back.x + back.width === WIDTH, 'the beside button did not move it back')
  await drag({ x: back.x, y: back.y + 10 }, { x: back.x - 6, y: back.y + 10 })
  assert(panel().width === back.width + 6, `dragging the left border left did not widen the panel: ${back.width} → ${panel().width}`)
  await click('▣ expand')
  assert(panel().width > back.width + 6 && setup.captureCharFrame().includes('Panel · expanded'), 'expand did not expand')
  await click('▭ restore')
  assert(panel().width === back.width + 6, 'restore did not restore the dragged width')
  console.log('The bar\'s buttons move and expand the panel, and its inner border drags to resize.')

  // ── The Terminal tab ─────────────────────────────────────────────────────
  await click('Terminal')
  await click('+ shell')
  await until(() => /[$#%>] ?$/m.test(shellText()), '+ shell did not start a shell')
  await act(async () => { await setup.mockInput.typeText('printf "\\033[?1000h\\033[?1006h"; cat -v') })
  act(() => { setup.mockInput.pressEnter() })
  await settle(400)
  // The program asked for the mouse: the wheel goes to it, as SGR bytes cat -v makes visible.
  const shellArea = locate('cat -v')
  await act(async () => { await setup.mockMouse.scroll(shellArea.x + 2, shellArea.y + 1, 'up') })
  await until(() => shellText().includes('^[[<64;'), 'the wheel did not reach a program that asked for the mouse')
  act(() => { setup.mockInput.pressKey('c', { ctrl: true }) })
  await settle(200)
  console.log('A program that asks for the mouse is sent it.')

  // Hint buttons and tabs: leave the shell, run a command, switch between them.
  await click('⌃]', 0)
  assert(!setup.captureCharFrame().includes('typing into the shell'), 'the ⌃] hint did not hand the keys back')
  await click('+ command')
  await act(async () => { await setup.mockInput.typeText('echo from-a-click') })
  act(() => { setup.mockInput.pressEnter() })
  await until(() => getProcesses().some((entry) => entry.command === 'echo from-a-click' && entry.lines.includes('from-a-click')), '+ command did not run it')
  await click('❯ sh')
  assert(setup.captureCharFrame().includes('shell ·'), `the shell tab did not select the shell:\n${setup.captureCharFrame()}`)
  await click('echo from-a-cl')
  assert(setup.captureCharFrame().includes('· echo from-a-click'), 'the process tab did not select the process')
  await click('remove', 0)
  assert(!getProcesses().some((entry) => entry.command === 'echo from-a-click'), 'the remove hint did not remove the finished process')
  console.log('Tabs select, and every hint is a button.')

  // The bar's own ×, not a tab's (which closes that tab).
  await click('expand  ×', 'expand  '.length)
  assert(!frame('surface-panel-frame'), 'the × button did not close the panel')
  console.log('Surface panel mouse smoke passed')
} finally {
  act(() => setup.renderer.destroy())
  await resetShellsForTest()
  await resetProcessesForTest()
}
process.exit(0)
