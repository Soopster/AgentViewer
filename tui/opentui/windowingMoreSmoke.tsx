/** @jsxImportSource @opentui/react */
// The rest of the windowing system in the real App: a grid of six, inserting
// beside a pane, swapping and zooming windows from the keyboard, right-click
// menus, saved layouts, searching a pane's whole history, and a shell as a
// window in the layout. Frames are read from layout, as in windowingSmoke.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-windowing-more-'))
process.env.SHELL = '/bin/sh'
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
const SESSIONS: Session[] = NAMES.map((name, index) => ({
  sessionId: `win-${name}`, provider: 'claude', cwd: CWD, summary: `Win ${name}`, firstPrompt: `Win ${name}`, lastModified: 1_700_000_000_000 - index * 1000,
}))
const marker = (session: Session | string) => `${(typeof session === 'string' ? session : session.sessionId).toUpperCase()}-BODY`
const card = (session: Session): TuiTranscriptCard => ({
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
})
// Bravo's history is longer than a pane loads (80 cards), with one needle near the start.
const plainCard = (session: Session, index: number, text: string): TuiTranscriptCard => ({
  ...card(session), key: `${session.sessionId}-card-${index}`, compactSummary: text,
  lines: [{ text, tone: 'default' }], expandedLines: [{ text, tone: 'default' }], searchText: text, searchHaystackLower: text.toLowerCase(),
})
const cardsFor = (session: Session): TuiTranscriptCard[] => session.sessionId !== 'win-bravo'
  ? [card(session)]
  : [...Array.from({ length: 120 }, (_, index) => plainCard(session, index, index === 5 ? 'NEEDLE-IN-BRAVO' : `bravo line ${index}`)), card(session)]
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS, readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
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
const panes = () => [0, 1, 2, 3, 4].map((index) => frame(`split-pane:${index}`)).filter((box): box is Frame => box !== null)
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
// A press, then motion a cell at a time, as a terminal reports a drag; `midway`
// runs with the button still held, where the drag's own feedback is visible.
const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, midway?: () => void) => {
  await act(async () => { await setup.mockMouse.pressDown(from.x, from.y) })
  await settle(40)
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1)
  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps)
    const y = Math.round(from.y + ((to.y - from.y) * step) / steps)
    await act(async () => { await setup.mockMouse.emitMouseEvent('drag', x, y) })
  }
  await settle(60)
  midway?.()
  await act(async () => { await setup.mockMouse.release(to.x, to.y) })
  await settle(300)
}
const rail = () => frame('session-rail')!
// The pane whose frame is lit: the focused one has the accent border, the rest share one colour.
const focusedPane = (): number | null => {
  const colours = [0, 1, 2].map((index) => {
    const wrapper = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as { getChildren(): Array<{ borderColor?: { toString(): string } }> } | null
    return wrapper ? String(wrapper.getChildren()[0]?.borderColor ?? '') : null
  })
  const present = colours.filter((colour): colour is string => colour !== null)
  const unique = present.filter((colour) => present.filter((other) => other === colour).length === 1)
  if (unique.length !== 1 || present.length < 2) return null
  return colours.indexOf(unique[0]!)
}
// pressKey types its argument literally ("right" would be ⌃B r, rotate); arrows have their own call.
const chordArrow = async (direction: 'up' | 'down' | 'left' | 'right') => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressArrow(direction) })
  await settle(150)
}
const paneShows = (index: number, name: string) => {
  const pane = frame(`split-pane:${index}`)
  if (!pane) return false
  return setup.captureCharFrame().split('\n').slice(pane.y, pane.y + pane.height)
    .some((line) => line.slice(pane.x, pane.x + pane.width).includes(marker(`win-${name}`)))
}
const railRow = (name: string) => locate(`Win ${name}`, rail())
const readerShows = (name: string) => {
  const reader = frame('transcript-reader')!
  return setup.captureCharFrame().split('\n').slice(reader.y, reader.y + reader.height)
    .some((line) => line.slice(reader.x, reader.x + reader.width).includes(marker(`win-${name}`)))
}


const { getShells, shellTerminal, resetShellsForTest } = await import('./shellStore')
const { readAllScreenText } = await import('./shellScreen')
const chordKey = async (key: string) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressKey(key) })
  await settle(200)
}
const arrowChord = async (direction: 'up' | 'down' | 'left' | 'right', shift = false) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressArrow(direction, shift ? { shift: true } : undefined) })
  await settle(200)
}
const paneHas = (index: number, text: string) => {
  const pane = frame(`split-pane:${index}`)
  if (!pane) return false
  return setup.captureCharFrame().split('\n').slice(pane.y, pane.y + pane.height)
    .some((line) => line.slice(pane.x, pane.x + pane.width).includes(text))
}
const paneName = (index: number) => NAMES.find((name) => paneHas(index, marker(`win-${name}`))) ?? null
const openMenu = async () => {
  const button = locate('⊞ layout')
  await click(button.x + 1, button.y)
  await waitFor('the layout menu', () => !!frame('window-layout:grid'))
}
const rightClick = async (x: number, y: number) => {
  // MouseButton.RIGHT is 2; the press is what opens the menu, as a terminal reports it.
  await act(async () => { await setup.mockMouse.pressDown(x, y, 2 as never) })
  await act(async () => { await setup.mockMouse.release(x, y, 2 as never) })
  await settle(200)
}

await settle(2500)
{
  const row = railRow('alpha')
  await click(row.x + 1, row.y)
  await waitFor('alpha in the reader', () => readerShows('alpha'))
}

// ── A grid of six ───────────────────────────────────────────────────────────
await openMenu()
const six = frame('window-layout:grid-six')!
await click(six.x + 3, six.y + 1)
await waitFor('five panes beside the reader', () => panes().length === 5)
{
  const reader = frame('transcript-reader')!
  const [a, b, c, d, e] = panes() as [Frame, Frame, Frame, Frame, Frame]
  check(a.y === reader.y && b.y === reader.y && c.y > reader.y && d.y === c.y && e.y === c.y, `not three on top and three below: ${JSON.stringify(panes())}`)
  check(e.x + e.width <= frame('window-area')!.x + frame('window-area')!.width, 'the grid runs past the window area')
}
console.log('A grid of six: the reader and two panes on top, three below.')
{
  // The bottom row's divider: the first bottom pane's right border.
  const first = frame('split-pane:2')!
  const readerWidthBefore = frame('transcript-reader')!.width
  const topPaneWidthBefore = frame('split-pane:0')!.width
  const handle = frame('split-bottom-divider')
  check(handle && handle.x === first.x + first.width - 1, `the bottom divider is not on the first bottom pane's right border: ${JSON.stringify(handle)} / ${JSON.stringify(first)}`)
  await drag({ x: handle!.x, y: handle!.y + 3 }, { x: handle!.x + 10, y: handle!.y + 3 }, () => {
    check(/left \d+% · \d+ cols/.test(setup.captureCharFrame()), 'the bottom divider does not show the width it is setting')
  })
  const wider = frame('split-pane:2')!
  check(wider.width >= first.width + 8 && frame('split-pane:3')!.x === wider.x + wider.width, `dragging the bottom divider did not widen the first bottom pane: ${first.width} → ${wider.width}`)
  check(frame('transcript-reader')!.width === readerWidthBefore && frame('split-pane:0')!.width === topPaneWidthBefore, 'the bottom divider moved the top row')
  await chordKey(']')
  check(frame('split-pane:2')!.width > wider.width, '⌃B ] did not widen it further')
  console.log('The bottom row\'s divider drags, and ⌃B [ ] move it from the keyboard.')
}

// ── Right-click a pane: close it ────────────────────────────────────────────
{
  const last = frame('split-pane:4')!
  await rightClick(last.x + 6, last.y)
  await waitFor('the pane menu', () => !!frame('context-menu'))
  const item = locate('Close pane', frame('context-menu')!)
  await click(item.x + 1, item.y)
  await waitFor('the pane to close', () => panes().length === 4)
  check(!frame('context-menu'), 'the menu stayed open after picking')
  // Right-click a rail row: open right of the reader (it joins the grid).
  const hidden = NAMES.find((name) => name !== 'alpha' && ![0, 1, 2, 3].some((index) => paneName(index) === name))!
  const row = railRow(hidden)
  await rightClick(row.x + 1, row.y)
  await waitFor('the rail menu', () => !!frame('context-menu'))
  const open = locate('Open right of the reader', frame('context-menu')!)
  await click(open.x + 1, open.y)
  await waitFor(`${hidden} to join the grid`, () => panes().length === 5 && paneName(0) === hidden)
  console.log('Right-click menus close a pane and open a rail session beside the reader.')
}

// ── Drop on a pane's edge: insert beside it ─────────────────────────────────
{
  await chordKey('x')
  await waitFor('four panes', () => panes().length === 4)
  const hidden = NAMES.find((name) => name !== 'alpha' && ![0, 1, 2, 3].some((index) => paneName(index) === name))!
  const first = frame('split-pane:0')!
  const row = railRow(hidden)
  await drag({ x: row.x + 1, y: row.y }, { x: first.x + first.width - 2, y: first.y + Math.floor(first.height / 2) }, () => {
    check(setup.captureCharFrame().includes('Beside pane 1'), 'a pane\'s edge does not say it will insert beside it')
  })
  await waitFor(`${hidden} beside pane 1`, () => panes().length === 5 && paneName(1) === hidden)
  console.log('Dropping on a pane\'s edge inserts beside it.')
}

// ── ⌃B ⇧→ swaps; ⌃B m zooms ─────────────────────────────────────────────────
{
  // From the reader: the right-click earlier left a pane focused.
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(100)
  await arrowChord('right')
  const left = paneName(0)
  const right = paneName(1)
  await arrowChord('right', true)
  await waitFor('⌃B ⇧→ to swap the two top panes', () => paneName(0) === right && paneName(1) === left)
  await chordKey('m')
  await waitFor('⌃B m to zoom one window', () => panes().length === 1)
  const area = frame('window-area')!
  check(panes()[0]!.width === area.width && panes()[0]!.height === area.height, `the zoomed window is not the whole area: ${JSON.stringify(panes())} in ${JSON.stringify(area)}`)
  check(!frame('split-secondary-divider'), 'the second divider is still drawn over a zoomed window')
  await chordKey('m')
  await waitFor('⌃B m to restore the layout', () => panes().length === 5)
  console.log('⌃B ⇧arrows swap windows; ⌃B m zooms and restores.')
}

// ── Saved layouts ───────────────────────────────────────────────────────────
{
  // Panes remount after a zoom; read the order once each shows its session again.
  await waitFor('every pane to show its session', () => [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  const order = [0, 1, 2, 3, 4].map(paneName)
  await openMenu()
  const save = frame('window-layout:save')!
  await click(save.x + 4, save.y)
  await waitFor('the save to be reported', () => setup.captureCharFrame().includes('Saved Layout 1'))
  // The menu stays open after a save, now listing it.
  check(setup.captureCharFrame().includes('Layout 1') && !!frame('window-layout:grid'), 'the menu closed on save, or does not list the saved layout')
  await act(async () => { setup.mockInput.pressKey('5') })
  await waitFor('reader only', () => panes().length === 0)
  await openMenu()
  const savedRow = setup.renderer.root.findDescendantById('window-layout:save')
  check(savedRow, 'the save row is gone')
  const row = locate('Layout 1')
  await click(row.x + 1, row.y)
  await waitFor('the saved layout to come back in order', () => panes().length === 5 && [0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]))
  console.log('A saved layout restores the same windows in the same places.')
}

// ── Search a pane's whole history ───────────────────────────────────────────
{
  const index = [0, 1, 2, 3, 4].find((at) => paneName(at) === 'bravo')!
  await chordKey(String(index + 1))
  check(!paneHas(index, 'NEEDLE-IN-BRAVO'), 'the needle is already on screen; the test proves nothing')
  await act(async () => { setup.mockInput.pressKey('/') })
  await settle(80)
  await act(async () => { await setup.mockInput.typeText('needle') })
  await settle(80)
  check(setup.captureCharFrame().includes('/needle▏'), 'the pane title does not show the query being typed')
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the search to page back to the needle', () => paneHas(index, 'NEEDLE-IN-BRAVO'))
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(100)
  console.log('Searching a pane pages its older history in to reach the match.')
}

// ── A shell as a window ─────────────────────────────────────────────────────
{
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(100)
  act(() => { setup.mockInput.pressKey('O', { shift: true }) })
  await settle(400)
  const panel = frame('surface-panel-frame')!
  const terminal = locate(' Terminal', panel)
  await click(terminal.x + 2, terminal.y)
  await waitFor('the Terminal tab', () => setup.captureCharFrame().includes('⧉ window'))
  const toWindow = locate('⧉ window')
  await click(toWindow.x + 2, toWindow.y)
  await waitFor('the terminal to become a window', () => setup.captureCharFrame().includes('❯ Terminal') && !frame('surface-panel-frame')?.width || setup.captureCharFrame().includes('❯ Terminal'))
  const window = panes().find((pane) => setup.captureCharFrame().split('\n')[pane.y]?.slice(pane.x, pane.x + pane.width).includes('❯ Terminal'))
  check(window, `no terminal window in the layout: ${JSON.stringify(panes())}`)
  await act(async () => { setup.mockInput.pressKey('o') })
  await waitFor('a shell in the window', () => /[$#%>] ?$/m.test((() => { const shell = getShells()[0]; const term = shell ? shellTerminal(shell.id) : null; return term ? readAllScreenText(term).join('\n') : '' })()))
  await act(async () => { await setup.mockInput.typeText('echo from-a-window') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the shell to run in the window', () => paneHas(panes().indexOf(window!), 'from-a-window') || setup.captureCharFrame().includes('from-a-window'))
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await rightClick(window!.x + 6, window!.y)
  await waitFor('the window menu', () => !!frame('context-menu'))
  const close = locate('Close window', frame('context-menu')!)
  await click(close.x + 1, close.y)
  await waitFor('the terminal window to close', () => !setup.captureCharFrame().includes('❯ Terminal'))
  console.log('A shell runs as a window in the layout and closes from its menu.')
}

console.log('Windowing (more) smoke passed')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
