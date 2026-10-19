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
const broadcastSends: Array<{ session: Session; body: Record<string, unknown> }> = []
const failedWindowSessions = new Set<string>()
const viewerNotes: Array<{ id: string; sessionId: string; provider: 'claude'; title: string; createdAt: number }> = []
const marker = (session: Session | string) => `${(typeof session === 'string' ? session : session.sessionId).toUpperCase()}-BODY`
const card = (session: Session): TuiTranscriptCard => ({
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: failedWindowSessions.has(session.sessionId) ? 'result_error' : 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
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
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS.map((session) => ({ ...session })), readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => SESSIONS.map((session) => ({ ...session })),
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [...viewerNotes] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
  streamTuiSessionTurn: async (session: Session, body: Record<string, unknown>) => {
    broadcastSends.push({ session: { ...session }, body })
    return new Response('event: turn-accepted\ndata: {}\n\n')
  },
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
  const deadline = Date.now() + 10_000
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
// Visible panes only: a zoom hides the others but keeps them mounted.
const panes = () => [0, 1, 2, 3, 4].map((index) => {
  const box = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as (Frame & { visible?: boolean }) | null
  return box && box.visible !== false ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}).filter((box): box is Frame => box !== null)
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
await waitFor('a geometry preview before applying a layout', () => !!frame('window-layout:preview') && !!frame('window-preview:0'))
check(panes().length === 0, 'previewing a layout applied it')
const six = frame('window-layout:grid-six')!
await act(async () => { await setup.mockMouse.moveTo(six.x + 3, six.y + 1) })
await settle(100)
await waitFor('all six frames in the layout preview', () => !!frame('window-preview:5'))
const predictedGrid = [0, 1, 2, 3, 4, 5].map((index) => {
  const rect = frame(`window-preview:${index}`)!
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})
check(panes().length === 0, 'hovering applied the grid')
await click(six.x + 3, six.y + 1)
await waitFor('five panes beside the reader', () => panes().length === 5)
for (let index = 0; index < 6; index += 1) {
  const actual = frame(index === 0 ? 'transcript-reader' : `split-pane:${index - 1}`)!
  const predicted = predictedGrid[index]!
  check(actual.x === predicted.x && actual.y === predicted.y && actual.width === predicted.width && actual.height === predicted.height, `preview geometry differs from applied window ${index}: ${JSON.stringify(predicted)} / ${JSON.stringify(actual)}`)
}
{
  const reader = frame('transcript-reader')!
  const [a, b, c, d, e] = panes() as [Frame, Frame, Frame, Frame, Frame]
  check(a.y === reader.y && b.y === reader.y && c.y > reader.y && d.y === c.y && e.y === c.y, `not three on top and three below: ${JSON.stringify(panes())}`)
  check(e.x + e.width <= frame('window-area')!.x + frame('window-area')!.width, 'the grid runs past the window area')
}
console.log('A grid of six: the reader and two panes on top, three below.')

// Window undo restores logical panes even if the terminal changed size since
// the action. A resize must not become an undo step or rewrite the pane order.
{
  await waitFor('all initial pane sessions to load', () => [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  const order = [0, 1, 2, 3, 4].map(paneName)
  await chordKey('x')
  await waitFor('one pane closed', () => panes().length === 4)
  await act(async () => { setup.resize(90, 46) })
  await settle(300)
  await waitFor('the overflow strip on a narrow terminal', () => !!frame('window-overflow') && panes().length === 0)
  check(setup.captureCharFrame().includes('hidden'), 'the hidden panes have no visible overflow indicator')
  await chordKey('u')
  await act(async () => { setup.resize(220, 46) })
  await settle(300)
  await waitFor('undo to restore all five panes after growing', () => panes().length === 5 && [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  check([0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]), 'undo or resizing changed pane order')
  check(!frame('window-overflow'), 'the strip remained after all panes fitted')
  const before = frame('transcript-reader')!.width
  await chordKey('>')
  check(frame('transcript-reader')!.width !== before, 'the resize did not change geometry')
  await chordKey('u')
  check(frame('transcript-reader')!.width === before, 'undo did not restore the reader ratio')
  // Height is constrained too, including the row occupied by the strip.
  await act(async () => { setup.resize(220, 24) })
  await settle(300)
  await waitFor('overflow when the terminal is short', () => !!frame('window-overflow') && panes().length < 5)
  await act(async () => { setup.resize(220, 46) })
  await settle(300)
  await waitFor('all panes restored after growing taller', () => panes().length === 5 && !frame('window-overflow') && [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  check([0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]), 'height changes rewrote pane order')
  console.log('Undo restores closed panes and sizes; narrow and short terminals preserve the full window order.')
}

{
  // The bottom row's divider: the first bottom pane's right border.
  const first = frame('split-pane:2')!
  const readerWidthBefore = frame('transcript-reader')!.width
  const topPaneWidthBefore = frame('split-pane:0')!.width
  const handle = frame('window-border:gridBottom:0')
  check(handle && handle.x === first.x + first.width - 1, `the bottom divider is not on the first bottom pane's right border: ${JSON.stringify(handle)} / ${JSON.stringify(first)}`)
  await drag({ x: handle!.x, y: handle!.y + 3 }, { x: handle!.x + 10, y: handle!.y + 3 }, () => {
    check(/\d+ cols · pane 3/.test(setup.captureCharFrame()), 'the bottom divider does not show the width it is setting')
  })
  const wider = frame('split-pane:2')!
  check(wider.width >= first.width + 8 && frame('split-pane:3')!.x === wider.x + wider.width, `dragging the bottom divider did not widen the first bottom pane: ${first.width} → ${wider.width}`)
  check(frame('transcript-reader')!.width === readerWidthBefore && frame('split-pane:0')!.width === topPaneWidthBefore, 'the bottom divider moved the top row')
  // ⌃B [ ] size the focused pane against its neighbour.
  await chordKey('3')
  await chordKey(']')
  check(frame('split-pane:2')!.width > wider.width, '⌃B ] did not widen the focused pane')
  await chordKey('u')
  check(frame('split-pane:2')!.width === wider.width, 'undo did not restore the keyboard resize')
  await chordKey('u')
  check(frame('split-pane:2')!.width === first.width, 'a divider drag must undo in one step')
  console.log('The bottom row\'s divider drags, and ⌃B [ ] move it from the keyboard.')
}
{
  // Every border: the one between the top row's two panes drags too, and leaves the reader alone.
  const left = frame('split-pane:0')!
  const right = frame('split-pane:1')!
  const readerWidth = frame('transcript-reader')!.width
  const handle = frame('window-border:gridTop:0')
  check(handle && handle.x === left.x + left.width - 1, `no border handle between the top panes: ${JSON.stringify(handle)}`)
  await drag({ x: handle!.x, y: handle!.y + 2 }, { x: handle!.x - 8, y: handle!.y + 2 })
  check(frame('split-pane:0')!.width <= left.width - 6 && frame('split-pane:1')!.width >= right.width + 6, `the top border did not move: ${left.width}/${right.width} → ${frame('split-pane:0')!.width}/${frame('split-pane:1')!.width}`)
  check(frame('transcript-reader')!.width === readerWidth, 'the top border moved the reader')
  await chordKey('u')
  check(frame('split-pane:0')!.width === left.width, 'the border drag did not undo')
  console.log('The border between any two panes drags.')
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
    check(!!frame('window-preview:5'), 'a drop does not preview every resulting window')
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
  await chordKey('u')
  await waitFor('undo to restore the pane positions', () => paneName(0) === left && paneName(1) === right)
  await arrowChord('right', true)
  await waitFor('the swap again', () => paneName(0) === right && paneName(1) === left)
  const before = [0, 1, 2, 3, 4].map(paneName)
  await chordKey('m')
  await waitFor('⌃B m to zoom one window', () => panes().length === 1)
  const area = frame('window-area')!
  check(panes()[0]!.width === area.width && panes()[0]!.height === area.height, `the zoomed window is not the whole area: ${JSON.stringify(panes())} in ${JSON.stringify(area)}`)
  check(!frame('split-secondary-divider'), 'the second divider is still drawn over a zoomed window')
  await chordKey('m')
  await waitFor('⌃B m to restore the layout', () => panes().length === 5)
  // Kept mounted: every pane shows its session on the first frame back, with no reload.
  check([0, 1, 2, 3, 4].every((index) => paneName(index) === before[index]), `panes reloaded after the zoom: ${JSON.stringify([0, 1, 2, 3, 4].map(paneName))} vs ${JSON.stringify(before)}`)
  console.log('⌃B ⇧arrows swap windows; ⌃B m zooms and restores.')
}

// Dropping in the middle replaces/swaps a pane; undo restores both occupants.
{
  await waitFor('pane sessions after zoom', () => [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  const order = [0, 1, 2, 3, 4].map(paneName)
  const source = frame('split-pane:1')!
  const target = frame('split-pane:0')!
  await drag({ x: source.x + 10, y: source.y }, { x: target.x + Math.floor(target.width / 2), y: target.y + Math.floor(target.height / 2) })
  await waitFor('drop to replace the first pane', () => paneName(0) === order[1])
  await chordKey('u')
  await waitFor('undo to restore both replaced sessions', () => [0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]))
  // Swapping the reader needs to restore its session too, not just the pins.
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(100)
  await arrowChord('right', true)
  await waitFor('reader swapped with a pane', () => !readerShows('alpha'))
  await chordKey('u')
  await waitFor('undo to restore the reader and pane order', () => readerShows('alpha') && [0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]))
  console.log('Moves and replacements undo together with the reader session and divider geometry.')
}

// The switcher includes hidden windows and leaves their logical order intact.
{
  await waitFor('pane sessions for switching', () => [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  const order = [0, 1, 2, 3, 4].map(paneName)
  await act(async () => { setup.resize(90, 46) })
  await settle(300)
  await chordKey('p')
  await waitFor('the quick window switcher', () => !!frame('window-switcher'))
  await act(async () => { await setup.mockInput.pasteBracketedText('claude charlie') })
  await settle(100)
  check(setup.captureCharFrame().includes('hidden'), 'the hidden match is not identified')
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the hidden session opened in the reader', () => readerShows('charlie') && !frame('window-switcher'))
  await chordKey('p')
  await waitFor('the switcher again', () => !!frame('window-switcher'))
  await act(async () => { await setup.mockInput.typeText('alpha') })
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the original reader restored', () => readerShows('alpha'))
  await act(async () => { setup.resize(220, 46) })
  await settle(300)
  await waitFor('every original pane returned in order', () => [0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]))
  console.log('Quick switching searches provider/title/project and opens hidden session windows without losing their order.')
}

// Actual App routing: selecting and reviewing does not send. Repeated submit
// keys send each captured target once and leave the reader/composer alone.
{
  await chordKey('b')
  await waitFor('broadcast input', () => !!frame('window-broadcast'))
  check(broadcastSends.length === 0, 'opening broadcast sent a prompt')
  await act(async () => { setup.mockInput.pressKey(' ') })
  await act(async () => { setup.mockInput.pressArrow('down'); setup.mockInput.pressKey(' ') })
  await act(async () => { setup.mockInput.pressTab() })
  await act(async () => { await setup.mockInput.pasteBracketedText('Review this change\nCheck edge cases.') })
  await act(async () => { setup.mockInput.pressEnter({ ctrl: true }) })
  await waitFor('the broadcast review', () => !!frame('window-broadcast:review'))
  check(setup.captureCharFrame().includes('Broadcast to 2 session windows'), 'review does not list the selected target count')
  check(broadcastSends.length === 0, 'reviewing sent the prompt before confirmation')
  await act(async () => { setup.mockInput.pressEnter(); setup.mockInput.pressEnter() })
  await waitFor('both delivery receipts', () => setup.captureCharFrame().includes('Turn started') && broadcastSends.length === 2)
  check(new Set(broadcastSends.map((send) => send.session.sessionId)).size === 2, 'a target received the broadcast twice')
  check(broadcastSends.every((send) => send.body.message === 'Review this change\nCheck edge cases.' && send.body.manualPermissions === true), 'broadcast changed the prompt or target permission behavior')
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the broadcast result closed', () => !frame('window-broadcast'))
  check(readerShows('alpha'), 'broadcast replaced the active reader')
  console.log('Broadcast selects explicit panes, reviews the prompt, and submits once per target without changing the reader.')
}

// ── Saved layouts ───────────────────────────────────────────────────────────
{
  // Panes remount after a zoom; read the order once each shows its session again.
  await waitFor('every pane to show its session', () => [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  const order = [0, 1, 2, 3, 4].map(paneName)
  await act(async () => { setup.resize(90, 46) })
  await settle(300)
  await chordKey('w')
  await waitFor('the layout menu while panes are hidden', () => !!frame('window-layout:save'))
  const save = frame('window-layout:save')!
  await click(save.x + 4, save.y)
  await waitFor('the save to be reported', () => setup.captureCharFrame().includes('Saved Layout 1'))
  // The menu stays open after a save, now listing it.
  check(setup.captureCharFrame().includes('Layout 1') && !!frame('window-layout:grid'), 'the menu closed on save, or does not list the saved layout')
  const { listSavedWindowLayouts } = await import('./windowLayoutStore')
  check(listSavedWindowLayouts(CWD)[0]?.panes.length === 5, 'saving at a small size discarded hidden panes')
  await act(async () => { setup.mockInput.pressKey('5') })
  await act(async () => { setup.resize(220, 46) })
  await settle(300)
  await waitFor('reader only', () => panes().length === 0)
  await openMenu()
  const savedRow = setup.renderer.root.findDescendantById('window-layout:save')
  check(savedRow, 'the save row is gone')
  const row = locate('Layout 1')
  await click(row.x + 1, row.y)
  await waitFor('the saved layout to come back in order', () => panes().length === 5 && [0, 1, 2, 3, 4].every((index) => paneName(index) === order[index]))
  console.log('A saved layout restores the same windows in the same places.')
}

// Named workspaces: rename and update preserve the saved identity, and the
// native input owns ordinary keys and bracketed paste while it is being edited.
{
  const { listSavedWindowLayouts } = await import('./windowLayoutStore')
  const saved = listSavedWindowLayouts(CWD)[0]!
  await openMenu()
  const rename = frame(`window-layout:rename:${saved.id}`)!
  check(rename, 'rename is not available beside the saved workspace')
  await click(rename.x + 1, rename.y)
  await waitFor('the layout name input', () => !!frame('window-layout:name'))
  await act(async () => {
    setup.mockInput.pressKey('END')
    for (let i = 0; i < saved.name.length; i += 1) setup.mockInput.pressBackspace()
  })
  await act(async () => { await setup.mockInput.pasteBracketedText('Review') })
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the workspace renamed', () => listSavedWindowLayouts(CWD)[0]?.name === 'Review')
  check(listSavedWindowLayouts(CWD)[0]?.id === saved.id, 'rename created a replacement layout')
  const savedRow = frame(`window-layout:saved:${saved.id}`)!
  await act(async () => { await setup.mockMouse.moveTo(savedRow.x + 5, savedRow.y) })
  await settle(100)
  await waitFor('the saved layout geometry preview', () => !!frame('window-layout:preview') && !!frame('window-preview:5'))
  await act(async () => { setup.mockInput.pressEscape() })
  await chordKey('x')
  await waitFor('four panes for the updated workspace', () => panes().length === 4)
  await openMenu()
  const update = frame(`window-layout:update:${saved.id}`)!
  await click(update.x + 1, update.y)
  const updated = listSavedWindowLayouts(CWD)[0]!
  check(updated.panes.length === 4 && updated.id === saved.id && updated.name === 'Review', 'update did not replace the contents under the existing name')
  await act(async () => { setup.mockInput.pressEscape() })
  await chordKey('u')
  await waitFor('the original five panes back', () => panes().length === 5)
  await openMenu()
  await act(async () => { setup.mockInput.pressKey('n') })
  await waitFor('the named-save input', () => !!frame('window-layout:name'))
  await act(async () => { await setup.mockInput.typeText('Debugging') })
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the named workspace saved', () => listSavedWindowLayouts(CWD).some((entry) => entry.name === 'Debugging' && entry.panes.length === 5))
  await act(async () => { setup.mockInput.pressEscape() })
  console.log('Saved workspaces can be named, renamed with paste, updated in place, and previewed before restoring.')
}

// Updates mark background panes passively. Only the explicit attention chord
// moves focus, and looking at a pane acknowledges output/errors, not prompts.
{
  await waitFor('pane contents before background activity', () => [0, 1, 2, 3, 4].every((index) => paneName(index) !== null))
  await settle(100)
  const targetIndex = [0, 1, 2, 3, 4].find((index) => paneName(index) === 'charlie')!
  const sessionIndex = SESSIONS.findIndex((session) => session.sessionId === 'win-charlie')
  failedWindowSessions.add('win-charlie')
  SESSIONS[sessionIndex] = { ...SESSIONS[sessionIndex]!, lastModified: Date.now() }
  await waitFor('the background error badge', () => setup.captureCharFrame().includes('! error'))
  check(readerShows('alpha') && focusedPane() === null, 'background output stole focus')
  check(setup.captureCharFrame().includes('unread'), 'new background output was not marked unread')
  await chordKey('a')
  await waitFor('attention to focus the affected pane', () => !setup.captureCharFrame().includes('! error') && !setup.captureCharFrame().includes('unread'))
  check(readerShows('alpha'), 'the attention shortcut replaced the reader instead of focusing a visible pane')
  viewerNotes.push({ id: 'window-input', sessionId: 'win-charlie', provider: 'claude', title: 'Needs a decision', createdAt: Date.now() })
  await waitFor('the pending-input badge', () => setup.captureCharFrame().includes('? input'))
  check(paneName(targetIndex) === 'charlie', 'a prompt moved the panes')
  viewerNotes.length = 0
  failedWindowSessions.clear()
  await waitFor('the resolved input badge to disappear', () => !setup.captureCharFrame().includes('? input'))
  await act(async () => { setup.mockInput.pressEscape() })
  console.log('Unread output, errors, and pending input are passive; the attention chord acknowledges the chosen window.')
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
  await act(async () => { setup.resize(65, 46) })
  await settle(300)
  await chordKey('p')
  await waitFor('the switcher for a hidden surface', () => !!frame('window-switcher'))
  await act(async () => { await setup.mockInput.typeText('terminal') })
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the hidden terminal peek', () => !!frame('split-pane:-1') && setup.captureCharFrame().includes('from-a-window'))
  await act(async () => { setup.mockInput.pressEscape() })
  await waitFor('the peek dismissed', () => !frame('split-pane:-1'))
  await act(async () => { setup.resize(220, 46) })
  await settle(300)
  await waitFor('the terminal restored to its layout slot', () => !!frame('surface-window-close:terminal'))
  const restoredTerminal = frame('surface-window-close:terminal')!
  await rightClick(restoredTerminal.x - 4, restoredTerminal.y)
  await waitFor('the window menu', () => !!frame('context-menu'))
  const close = locate('Close window', frame('context-menu')!)
  await click(close.x + 1, close.y)
  await waitFor('the terminal window to close', () => !setup.captureCharFrame().includes('❯ Terminal'))
  console.log('A shell runs as a window in the layout and closes from its menu.')
}

// ── Surface windows are windows: several of a kind, own keys, drag and swap ──
{
  const windowIndexOf = (buttonId: string): number => {
    const button = frame(buttonId)
    if (!button) return -1
    return panes().findIndex((pane) => pane.width > 0 && button.y === pane.y && button.x >= pane.x && button.x < pane.x + pane.width)
  }
  act(() => { setup.mockInput.pressKey('O', { shift: true }) })
  await settle(400)
  const terminal = locate(' Terminal', frame('surface-panel-frame')!)
  await click(terminal.x + 2, terminal.y)
  await waitFor('the Terminal tab', () => setup.captureCharFrame().includes('⧉ window'))
  const toWindow = locate('⧉ window')
  await click(toWindow.x + 2, toWindow.y)
  await waitFor('a terminal window', () => !!frame('surface-window-close:terminal'))
  const first = frame('surface-window-close:terminal')!
  await rightClick(first.x - 4, first.y)
  await waitFor('the window menu', () => !!frame('context-menu'))
  const another = locate('Open another', frame('context-menu')!)
  await click(another.x + 1, another.y)
  await waitFor('a second terminal window', () => !!frame('surface-window-close:terminal#2') && setup.captureCharFrame().includes('❯ Terminal 2'))
  check(frame('surface-window-close:terminal'), 'opening another terminal closed the first')

  // Each window's shell takes its own keys.
  const shellText = (index: number) => { const shell = getShells()[index]; const term = shell ? shellTerminal(shell.id) : null; return term ? readAllScreenText(term).join('\n') : '' }
  const before = getShells().length
  await chordKey(String(windowIndexOf('surface-window-close:terminal') + 1))
  await act(async () => { setup.mockInput.pressKey('o') })
  await waitFor('a shell in the first window', () => getShells().length === before + 1 && /[$#%>] ?$/m.test(shellText(before)))
  await act(async () => { await setup.mockInput.typeText('echo one-window') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the first shell to run', () => shellText(before).includes('one-window'))
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await chordKey(String(windowIndexOf('surface-window-close:terminal#2') + 1))
  await act(async () => { setup.mockInput.pressKey('o') })
  await waitFor('a shell in the second window', () => getShells().length === before + 2 && /[$#%>] ?$/m.test(shellText(before + 1)))
  await act(async () => { await setup.mockInput.typeText('echo two-window') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the second shell to run', () => shellText(before + 1).includes('two-window'))
  check(!shellText(before).includes('two-window'), 'typing in the second window reached the first window’s shell')
  check(paneHas(windowIndexOf('surface-window-close:terminal'), 'one-window'), 'the first window does not show the shell typed into it')
  check(!paneHas(windowIndexOf('surface-window-close:terminal'), 'two-window'), 'the first window shows the second window’s shell')
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(100)

  // Dragging a surface window's title onto a session pane swaps the two.
  const from = windowIndexOf('surface-window-close:terminal#2')
  const target = panes().findIndex((pane, index) => index !== from && pane.width > 0 && paneName(index) !== null)
  check(from >= 0 && target >= 0, `no surface/session pair to swap: ${from} ${target}`)
  const sessionBefore = paneName(target)
  const source = frame(`split-pane:${from}`)!
  const dest = frame(`split-pane:${target}`)!
  await drag({ x: source.x + 3, y: source.y }, { x: dest.x + Math.floor(dest.width / 2), y: dest.y + Math.floor(dest.height / 2) }, () => {
    check(setup.captureCharFrame().includes(`Swap with window ${target + 1}`), 'the drag ghost does not say it swaps')
  })
  await waitFor('the swap', () => windowIndexOf('surface-window-close:terminal#2') === target)
  await waitFor(`the session (${sessionBefore}) in the surface's old place`, () => paneName(from) === sessionBefore)
  check(paneHas(target, 'two-window'), 'the moved window no longer shows its own shell')
  check(new Set(panes().map((_, index) => paneName(index)).filter(Boolean)).has(sessionBefore), 'the swap hid the session it swapped with')
  await chordKey('u')
  await waitFor('undo to put the surface back', () => windowIndexOf('surface-window-close:terminal#2') === from)
  console.log('Surface windows open several of a kind, take their own keys, and swap with session panes by drag.')
}

// ── Tabbed windows ──────────────────────────────────────────────────────────
{
  const sessionPanes = () => panes().map((_, index) => index).filter((index) => paneName(index) !== null)
  await waitFor('two session panes to tab together', () => sessionPanes().length >= 2)
  const framesBefore = panes().length
  const [anchorIndex, movingIndex] = sessionPanes()
  const anchorName = paneName(anchorIndex!)!
  const movingName = paneName(movingIndex!)!
  // Drag one pane's title onto another's: it becomes a tab there.
  const source = frame(`split-pane:${movingIndex}`)!
  const dest = frame(`split-pane:${anchorIndex}`)!
  await drag({ x: source.x + 6, y: source.y }, { x: dest.x + Math.floor(dest.width / 2), y: dest.y }, () => {
    check(setup.captureCharFrame().includes(`Add as a tab of window ${anchorIndex! + 1}`), 'the drag ghost does not offer a tab')
  })
  await waitFor('the tab strip', () => !!frame('window-tab:claude:win-' + anchorName) && !!frame('window-tab:claude:win-' + movingName))
  // More windows than fit: the freed frame goes to a hidden one, so count where each name shows.
  const framesShowing = (name: string) => panes().filter((_, index) => paneName(index) === name).length
  check(framesShowing(movingName) === 1 && framesShowing(anchorName) === 0, `the two tabs are not one frame: ${movingName}=${framesShowing(movingName)} ${anchorName}=${framesShowing(anchorName)} (${framesBefore} frames)`)
  // Closing some other pane's tab leaves a pin to refill: a background tab must not be what fills it.
  const others = panes().map((_, index) => index).filter((index) => paneName(index) !== null && paneName(index) !== movingName)
  if (others.length > 0) {
    const victim = paneName(others[others.length - 1]!)!
    const tabBarEntry = locate(`Win ${victim}`, { x: 0, y: 0, width: 220, height: 1 })
    await rightClick(tabBarEntry.x + 1, tabBarEntry.y)
    await waitFor('the tab menu', () => !!frame('context-menu'))
    const closeTab = locate('Close tab', frame('context-menu')!)
    await click(closeTab.x + 1, closeTab.y)
    await waitFor('the tab closed', () => framesShowing(victim) === 0)
    await settle(300)
    check(framesShowing(anchorName) === 0 && !!frame('window-tab:claude:win-' + anchorName), `a background tab was pulled into a pane: ${anchorName}`)
  }
  const tabFrame = panes().findIndex((_, index) => paneName(index) === movingName)
  check(tabFrame >= 0, 'the dropped tab is not the one shown')
  // Clicking the other tab shows it in the same frame.
  const otherTab = frame('window-tab:claude:win-' + anchorName)!
  await click(otherTab.x + 2, otherTab.y)
  await waitFor('the clicked tab shown', () => paneName(tabFrame) === anchorName)
  // ⌃B . steps tabs in the focused window.
  await chordKey(String(tabFrame + 1))
  await chordKey('.')
  await waitFor('⌃B . to step to the next tab', () => paneName(tabFrame) === movingName)
  // Closing a tab leaves the frame showing the other.
  const close = frame('window-tab-close:claude:win-' + movingName)!
  await click(close.x, close.y)
  await waitFor('closing a tab to show the other', () => paneName(tabFrame) === anchorName && !frame('window-tabs:' + tabFrame))
  check(framesShowing(anchorName) === 1 && framesShowing(movingName) === 0, 'closing a tab closed the frame, or left the closed tab in a window')
  // ⌃B t tabs the focused window onto the one before; ⌃B ! breaks it back out.
  await waitFor('another session pane', () => sessionPanes().length >= 2)
  const second = sessionPanes()[1]!
  const secondName = paneName(second)!
  await chordKey(String(second + 1))
  await chordKey('t')
  await waitFor('⌃B t to make a tab', () => !!frame('window-tab:claude:win-' + secondName))
  const shownAt = panes().findIndex((_, index) => paneName(index) === secondName)
  await chordKey(String(shownAt + 1))
  await chordKey('!')
  await waitFor('⌃B ! to break the tab out', () => !frame('window-tab:claude:win-' + secondName))
  check(panes().some((_, index) => paneName(index) === secondName), 'the broken-out tab is not a window')
  // A tab dragged out of its strip onto empty space is its own window.
  await chordKey(String(panes().findIndex((_, index) => paneName(index) === secondName) + 1))
  await chordKey('t')
  await waitFor('tabbed again', () => !!frame('window-tab:claude:win-' + secondName))
  const tab = frame('window-tab:claude:win-' + secondName)!
  const reader = frame('transcript-reader')!
  await drag({ x: tab.x + 2, y: tab.y }, { x: reader.x + Math.floor(reader.width / 2), y: reader.y + Math.floor(reader.height / 2) })
  await waitFor('a tab dragged out to be a window', () => !frame('window-tab:claude:win-' + secondName) && framesShowing(secondName) === 1)
  console.log('Windows share a frame as tabs: drag onto a title, click, ⌃B . steps, × closes one, ⌃B t / ⌃B ! join and leave.')
}

// ── A floating window ───────────────────────────────────────────────────────
{
  const session = panes().map((_, index) => index).find((index) => paneName(index) !== null)!
  const name = paneName(session)!
  const inLayout = () => panes().some((_, index) => paneName(index) === name)
  await chordKey(String(session + 1))
  await chordKey('f')
  await waitFor('the floating window', () => !!frame('floating-window'))
  check(!inLayout(), 'floating the window left it in the layout too')
  const floating = () => frame('floating-window')!
  // Nothing from the windows underneath shows through it.
  const checkOpaque = (when: string) => {
    const box = floating()
    const inside = setup.captureCharFrame().split('\n').slice(box.y + 1, box.y + box.height - 1).map((line) => line.slice(box.x + 1, box.x + box.width - 1))
    // An underlying frame's border column, inside the floating box, must not show its │ down the rows.
    const borderColumns = panes().flatMap((pane) => [pane.x, pane.x + pane.width - 1]).map((x) => x - box.x - 1).filter((x) => x > 2 && x < box.width - 4)
    const showing = borderColumns.filter((x) => inside.filter((line) => line[x] === '│').length > inside.length * 0.6)
    check(showing.length === 0, `the windows underneath show through the floating one ${when}:\n${inside.join('\n')}`)
  }
  checkOpaque('while it loads')
  await waitFor('the floating window to show its session', () => paneHas(64, marker(`win-${name}`)))
  checkOpaque('once loaded')
  // Its title moves it; ◢ resizes it.
  const start = floating()
  await drag({ x: start.x + 10, y: start.y }, { x: start.x + 4, y: start.y + 2 })
  await waitFor('the floating window to move', () => floating().x === start.x - 6 && floating().y === start.y + 2)
  const handle = frame('floating-resize')!
  await drag({ x: handle.x, y: handle.y }, { x: handle.x - 10, y: handle.y - 3 })
  await waitFor('the floating window to shrink', () => floating().width === start.width - 10 && floating().height === start.height - 3)
  // Keys go to it while it is focused.
  check(setup.captureCharFrame().includes('⊞ dock'), 'no dock button on the floating window')
  await chordKey('f')
  await waitFor('docking it back', () => !frame('floating-window') && inLayout())
  check(paneName(session) === name, `docking did not put it back in its slot: window ${session + 1} shows ${paneName(session)}`)
  await chordKey('u')
  await waitFor('undo to float it again', () => !!frame('floating-window'))
  await chordKey('u')
  await waitFor('undo again to put it back where it was', () => !frame('floating-window') && inLayout())
  // A surface window floats too, and its shell keeps its keys there.
  const shellWindow = panes().findIndex((pane) => setup.captureCharFrame().split('\n')[pane.y]?.slice(pane.x, pane.x + pane.width).includes('❯ Terminal'))
  check(shellWindow >= 0, 'no terminal window left to float')
  await chordKey(String(shellWindow + 1))
  await chordKey('f')
  await waitFor('the floating terminal', () => !!frame('floating-window') && paneHas(64, 'Terminal'))
  await act(async () => { setup.mockInput.pressKey('o') })
  await settle(400)
  await act(async () => { await setup.mockInput.typeText('echo from-a-float') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the floating shell to run', () => paneHas(64, 'from-a-float'))
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await chordKey('f')
  await waitFor('the terminal docked', () => !frame('floating-window'))
  console.log('A window floats over the layout, moves by its title, resizes by ◢, docks with ⌃B f, and undo walks it back.')
}

// ── Clicking a window focuses it ────────────────────────────────────────────
{
  const sessionWindows = panes().map((_, index) => index).filter((index) => paneName(index) !== null)
  check(sessionWindows.length >= 3, 'need three session panes to click between')
  // A focused session pane's frame is lit: its border colour is the one no other session pane shares.
  const paneColour = (index: number) => String((setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as { getChildren(): Array<{ borderColor?: unknown }> } | null)?.getChildren()[0]?.borderColor ?? '')
  const paneFocused = (index: number) => {
    const others = sessionWindows.filter((other) => other !== index).map(paneColour)
    return others.length > 0 && others.every((colour) => colour !== paneColour(index)) && new Set(others).size === 1
  }
  const borderOf = (id: string) => String((setup.renderer.root.findDescendantById(id) as unknown as { borderColor?: unknown } | null)?.borderColor ?? '')

  for (const index of sessionWindows.slice(0, 2)) {
    const pane = frame(`split-pane:${index}`)!
    await click(pane.x + Math.floor(pane.width / 2), pane.y + Math.floor(pane.height / 2))
    await waitFor(`a click in pane ${index + 1}'s body to focus it`, () => paneFocused(index))
  }
  const reader = frame('transcript-reader')!
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await waitFor('a click in the reader to take focus back from the pane', () => sessionWindows.every((index) => !paneFocused(index)))
  // From the rail, a click in the reader moves the keys there: j then scrolls
  // the transcript instead of moving the rail's selection.
  const railAlpha = locate('Win alpha', rail())
  await click(railAlpha.x + 2, railAlpha.y)
  await waitFor('alpha in the reader', () => readerShows('alpha'))
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await settle(150)
  await act(async () => { setup.mockInput.pressKey('j') })
  await settle(400)
  check(readerShows('alpha'), 'after a click in the reader, j still moved the rail selection')
  // From the rail, a click in a pane focuses the pane, not the rail.
  const row = locate('Win alpha', rail())
  await click(row.x + 2, row.y)
  await settle(200)
  const pane = frame(`split-pane:${sessionWindows[0]}`)!
  await click(pane.x + Math.floor(pane.width / 2), pane.y + Math.floor(pane.height / 2))
  await waitFor('a click in a pane after the rail to focus the pane', () => paneFocused(sessionWindows[0]!))
  // A surface window's body focuses it too.
  const surface = panes().findIndex((entry) => setup.captureCharFrame().split('\n')[entry.y]?.slice(entry.x, entry.x + entry.width).includes('❯ Terminal'))
  if (surface >= 0) {
    const box = frame(`split-pane:${surface}`)!
    const before = borderOf(`split-pane:${surface}`)
    await click(box.x + Math.floor(box.width / 2), box.y + Math.floor(box.height / 2))
    await waitFor('a click in a surface window to focus it', () => borderOf(`split-pane:${surface}`) !== before && !paneFocused(sessionWindows[0]!))
  }
  console.log('A click anywhere in a window — pane, reader or surface — gives it focus.')
}

console.log('Windowing (more) smoke passed')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
