/** @jsxImportSource @opentui/react */
// The windowing system in the real App, driven by the mouse: dragging sessions
// from the rail onto the reader's edges, the layout menu's arrangements (main +
// stack, grid of four), dragging the divider, and a pane's title buttons.
//
// Every check reads laid-out frames. A pane drawn over the reader, or a drop
// that opened the session in the wrong place, renders plausible text either way.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-windowing-smoke-'))
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const NAMES = ['alpha', 'bravo', 'charlie', 'delta']
const SESSIONS: Session[] = NAMES.map((name, index) => ({
  sessionId: `win-${name}`, provider: 'claude', cwd: CWD, summary: `Win ${name}`, firstPrompt: `Win ${name}`, lastModified: 1_700_000_000_000 - index * 1000,
}))
const marker = (session: Session | string) => `${(typeof session === 'string' ? session : session.sessionId).toUpperCase()}-BODY`
const card = (session: Session): TuiTranscriptCard => ({
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
})
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: [card(session)],
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS, readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => [card(session)], formatTranscriptCardsAsync: async (session: Session) => [card(session)] }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => SESSIONS,
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 220, height: 46, kittyKeyboard: true })
const settle = async (ms = 150) => {
  await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, ms)) })
}
const fail = (message: string): never => {
  console.error(`${message}\n${setup.captureCharFrame()}`)
  process.exit(1)
}
const check = (condition: unknown, message: string) => { if (!condition) fail(message) }
const waitFor = async (label: string, test: () => boolean) => {
  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    if (test()) return
    await settle(80)
  }
  fail(`Timed out: ${label}`)
}
type Frame = { x: number; y: number; width: number; height: number }
const frame = (id: string): Frame | null => {
  const box = setup.renderer.root.findDescendantById(id) as unknown as Frame | null
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}
const panes = () => [0, 1, 2].map((index) => frame(`split-pane:${index}`)).filter((box): box is Frame => box !== null)
const locate = (needle: string, within?: Frame): { x: number; y: number } => {
  const lines = setup.captureCharFrame().split('\n')
  for (let y = within?.y ?? 0; y < (within ? within.y + within.height : lines.length); y += 1) {
    const x = (lines[y] ?? '').indexOf(needle, within?.x ?? 0)
    if (x >= 0 && (!within || x < within.x + within.width)) return { x, y }
  }
  return fail(`could not find ${JSON.stringify(needle)}`)
}
const click = async (x: number, y: number) => {
  await act(async () => { await setup.mockMouse.click(x, y) })
  await settle(200)
}
// A press, then motion a cell at a time, as a terminal reports a drag.
const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
  await act(async () => { await setup.mockMouse.pressDown(from.x, from.y) })
  await settle(40)
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1)
  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps)
    const y = Math.round(from.y + ((to.y - from.y) * step) / steps)
    await act(async () => { await setup.mockMouse.emitMouseEvent('drag', x, y) })
  }
  await settle(60)
  await act(async () => { await setup.mockMouse.release(to.x, to.y) })
  await settle(300)
}
const rail = () => frame('session-rail')!
const railRow = (name: string) => locate(`Win ${name}`, rail())
const readerShows = (name: string) => {
  const reader = frame('transcript-reader')!
  return setup.captureCharFrame().split('\n').slice(reader.y, reader.y + reader.height)
    .some((line) => line.slice(reader.x, reader.x + reader.width).includes(marker(`win-${name}`)))
}

await settle(2500)
// A click on a rail row still opens it (selection moved from press to release).
for (const name of ['delta', 'charlie', 'bravo', 'alpha']) {
  const row = railRow(name)
  await click(row.x + 1, row.y)
  await waitFor(`${name} to open from a click`, () => readerShows(name))
}
console.log('A click on a rail row still opens it.')

// ── Drag a session onto the reader's right edge, then its left ─────────────
let area = frame('window-area')!
let row = railRow('bravo')
await drag({ x: row.x + 1, y: row.y }, { x: area.x + area.width - 3, y: area.y + Math.floor(area.height / 2) })
await waitFor('bravo to open in a pane on the right', () => panes().length === 1)
let reader = frame('transcript-reader')!
check(panes()[0]!.x >= reader.x + reader.width - 1 && readerShows('alpha'), `bravo's pane is not right of the reader: pane ${JSON.stringify(panes()[0])}, reader ${JSON.stringify(reader)}`)
check(setup.captureCharFrame().includes(marker('win-bravo')), 'the pane does not show bravo')
check(!frame('window-drop-zone'), 'the drop-zone overlay outlived the drop')
row = railRow('charlie')
await drag({ x: row.x + 1, y: row.y }, { x: area.x + 3, y: area.y + Math.floor(area.height / 2) })
await waitFor('charlie to open in a pane on the left', () => setup.captureCharFrame().includes(marker('win-charlie')))
reader = frame('transcript-reader')!
check(panes()[0]!.x < reader.x, `charlie's pane is not left of the reader: pane ${JSON.stringify(panes()[0])}, reader ${JSON.stringify(reader)}`)
console.log('Dragging a session to an edge of the reader opens it in a pane on that side.')
// A third tab to arrange: a rail click only previews a session, a drop opens it as a tab.
row = railRow('delta')
await drag({ x: row.x + 1, y: row.y }, { x: area.x + Math.floor(area.width / 2), y: area.y + area.height - 2 })
await waitFor('delta below the reader', () => setup.captureCharFrame().includes(marker('win-delta')))
reader = frame('transcript-reader')!
check(panes()[0]!.y >= reader.y + reader.height - 1, `delta's pane is not below the reader: ${JSON.stringify(panes()[0])}`)

// ── The layout menu: grid, then main + stack ────────────────────────────────
const layoutButton = locate('⊞ layout')
await click(layoutButton.x + 1, layoutButton.y)
await waitFor('the layout menu to open', () => setup.captureCharFrame().includes('Window layout') && !!frame('window-layout:grid'))
const gridIcon = frame('window-layout:grid')!
await click(gridIcon.x + 3, gridIcon.y + 1)
await waitFor('three panes in a grid', () => panes().length === 3)
reader = frame('transcript-reader')!
area = frame('window-area')!
const [topRight, bottomLeft, bottomRight] = panes() as [Frame, Frame, Frame]
check(topRight.y === reader.y && topRight.x > reader.x, `grid top row: reader ${JSON.stringify(reader)}, pane ${JSON.stringify(topRight)}`)
check(bottomLeft.y >= reader.y + reader.height && bottomRight.y === bottomLeft.y && bottomRight.x > bottomLeft.x, `grid bottom row: ${JSON.stringify([bottomLeft, bottomRight])}`)
check(bottomLeft.y + bottomLeft.height <= area.y + area.height && topRight.x + topRight.width <= area.x + area.width, 'a grid pane runs outside the window area')
console.log('The menu\'s grid puts the reader and three panes two by two.')
if (process.env.DUMP_FRAME) console.log(setup.captureCharFrame())

await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
await settle(80)
await act(async () => { setup.mockInput.pressKey('w') })
await waitFor('⌃B w to open the menu', () => !!frame('window-layout:main-stack'))
const stackIcon = frame('window-layout:main-stack')!
await click(stackIcon.x + 3, stackIcon.y + 1)
await waitFor('main + stack', () => panes().length >= 2 && panes()[0]!.y !== panes()[1]!.y)
reader = frame('transcript-reader')!
const stack = panes()
check(stack.every((pane) => pane.x === stack[0]!.x && pane.x >= reader.x + reader.width - 1), `the stack is not one column right of the reader: ${JSON.stringify(stack)}`)
console.log('Main + stack puts the panes in one column beside the reader.')

// ── The divider ─────────────────────────────────────────────────────────────
const before = frame('transcript-reader')!
const divider = frame('split-divider-handle')!
await drag({ x: divider.x, y: divider.y + 4 }, { x: divider.x - 12, y: divider.y + 4 })
const after = frame('transcript-reader')!
check(after.width < before.width - 6, `dragging the divider left did not narrow the reader: ${before.width} → ${after.width}`)
check(!setup.renderer.getSelection()?.getSelectedText?.(), 'the divider drag selected text')
console.log('The divider drags to resize the reader against its panes.')

// ── A pane's title buttons ──────────────────────────────────────────────────
const count = panes().length
const close = frame('split-pane-close:1')!
await click(close.x + 1, close.y)
await waitFor('× to close that pane', () => panes().length === count - 1)
const promote = frame('split-pane-promote:0')!
const promoted = NAMES.find((name) => setup.captureCharFrame().split('\n').slice(panes()[0]!.y, panes()[0]!.y + panes()[0]!.height)
  .some((line) => line.slice(panes()[0]!.x, panes()[0]!.x + panes()[0]!.width).includes(marker(`win-${name}`))))!
await click(promote.x + 1, promote.y)
await waitFor(`⤢ to open ${promoted} in the reader`, () => readerShows(promoted))
console.log('A pane\'s × closes it and ⤢ opens it in the reader.')

// ── The menu by keyboard: Reader only ───────────────────────────────────────
await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
await settle(80)
await act(async () => { setup.mockInput.pressKey('w') })
await waitFor('the menu', () => !!frame('window-layout:fill'))
await act(async () => { setup.mockInput.pressKey('5') })
await waitFor('Reader only to close every pane', () => panes().length === 0)
console.log('The menu works from the keyboard too.')
console.log('Windowing smoke passed')
act(() => setup.renderer.destroy())
process.exit(0)
