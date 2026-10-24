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

const spacesStore = await import('./spacesStore')
let spacesController: InstanceType<typeof spacesStore.SpacesController> | null = null
mock.module('./spacesStore', () => ({ ...spacesStore, SpacesController: class extends spacesStore.SpacesController { constructor() { super(); spacesController = this } } }))
const { default: OpenTuiApp, freeTitleColumn } = await import('./App')
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
// Every session is in a window. The one showing the selected session is what
// this smoke calls the reader; the panes are the others, in window order.
// Visible windows only: a zoom hides the others but keeps them mounted.
const windowFrames = () => Array.from({ length: 31 }, (_, index) => index).map((index) => {
  const box = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as (Frame & { visible?: boolean }) | null
  return box && box.visible !== false ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
})
const isReaderWindow = (box: Frame) => {
  const reader = frame('transcript-reader')
  return !!reader && reader.x >= box.x && reader.y >= box.y && reader.x + reader.width <= box.x + box.width && reader.y + reader.height <= box.y + box.height
}
const paneWindows = () => windowFrames().map((box, index) => ({ box, index })).filter((entry) => entry.box !== null && !isReaderWindow(entry.box)).map((entry) => entry.index)
const paneIndex = (i: number) => (i === 64 ? 64 : paneWindows()[i] ?? -1)
const paneFrame = (i: number) => frame(i === 64 ? 'floating-window' : `split-pane:${paneIndex(i)}`)
const panes = () => paneWindows().map((index) => frame(`split-pane:${index}`)!).filter(Boolean)
const windowCount = () => windowFrames().filter((box) => box !== null).length
// By absolute window index (64 is the floating window), with an empty frame for
// an index that is not laid out, so positions in the list are window indices.
const allWindows = () => windowFrames().slice(0, Math.max(...windowFrames().map((box, index) => (box ? index + 1 : 0)), 0)).map((box) => box ?? { x: 0, y: 0, width: 0, height: 0 })
const windowFrame = (i: number) => frame(i === 64 ? 'floating-window' : `split-pane:${i}`)
const windowHas = (i: number, text: string) => {
  const box = windowFrame(i)
  if (!box) return false
  return setup.captureCharFrame().split('\n').slice(box.y, box.y + box.height).some((line) => line.slice(box.x, box.x + box.width).includes(text))
}
const focusedWindow = () => spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('splitFocusIndex') as number | null
// The session window i shows, by its absolute index (focus moves the reader, not the windows).
const windowName = (i: number) => {
  const box = windowFrame(i)
  if (!box) return null
  const rows = setup.captureCharFrame().split('\n').slice(box.y, box.y + box.height).map((line) => line.slice(box.x, box.x + box.width))
  return NAMES.find((name) => rows.some((line) => line.includes(marker(`win-${name}`)))) ?? null
}
// Whether any window, the reader's included, shows a session.
const shareStack = (...keys: string[]) => ((spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('windowStacks') ?? []) as string[][]).some(stack => keys.every(key => stack.includes(key)))
const shownAnywhere = (name: string) => windowFrames().some((box) => box !== null
  && setup.captureCharFrame().split('\n').slice(box.y, box.y + box.height).some((line) => line.slice(box.x, box.x + box.width).includes(marker(`win-${name}`))))
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
const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, midway?: () => void | Promise<void>) => {
  await act(async () => { await setup.mockMouse.pressDown(from.x, from.y) })
  await settle(40)
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1)
  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps)
    const y = Math.round(from.y + ((to.y - from.y) * step) / steps)
    await act(async () => { await setup.mockMouse.emitMouseEvent('drag', x, y) })
  }
  await settle(60)
  await midway?.()
  await act(async () => { await setup.mockMouse.release(to.x, to.y) })
  await settle(300)
}
const rail = () => frame('session-rail')!
// A surface window is drawn by the surface layer over its slot: the two must coincide exactly.
const checkSurfaceAlignment = (when: string) => {
  for (let index = 0; index < 31; index += 1) {
    const slot = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as (Frame & { visible?: boolean; getChildren?: () => unknown[] }) | null
    if (!slot || slot.visible === false || (slot.getChildren?.().length ?? 0) > 0) continue
    const frames = setup.renderer.root.findDescendantById('window-area') as unknown as { getChildren(): Array<Frame & { id: string; visible?: boolean }> }
    const drawn = frames.getChildren().find((child) => child.id.startsWith('surface-frame:') && child.visible !== false && child.x === slot.x && child.y === slot.y)
    check(drawn && drawn.width === slot.width && drawn.height === slot.height, `${when}: surface window ${index + 1} is not drawn over its slot (${JSON.stringify({ x: slot.x, y: slot.y, w: slot.width, h: slot.height })})`)
  }
}
// Observe the actual workspace focus; frame children may be wrappers or tab strips.
const focusedPane = (): number | null => {
  const focus = spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('splitFocusIndex') as number | null
  return focus === null || focus === 64 ? focus : paneWindows().indexOf(focus)
}

const chordArrow = async (direction: 'up' | 'down' | 'left' | 'right') => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressArrow(direction) })
  await settle(150)
}
const paneShows = (index: number, name: string) => {
  const pane = paneFrame(index)
  if (!pane) return false
  return setup.captureCharFrame().split('\n').slice(pane.y, pane.y + pane.height)
    .some((line) => line.slice(pane.x, pane.x + pane.width).includes(marker(`win-${name}`)))
}
const railRow = (name: string) => locate(`Win ${name}`, rail())
const readerShows = (name: string) => {
  const reader = frame('transcript-reader')
  if (!reader) return false
  return setup.captureCharFrame().split('\n').slice(reader.y, reader.y + reader.height)
    .some((line) => line.slice(reader.x, reader.x + reader.width).includes(marker(`win-${name}`)))
}


const { getShells, shellTerminal, resetShellsForTest } = await import('./shellStore')
const { readAllScreenText } = await import('./shellScreen')
const chordKey = async (key: string) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressKey(/^[0-8]$/.test(key) ? String(Number(key) + 1) : key) })
  await settle(200)
}
const arrowChord = async (direction: 'up' | 'down' | 'left' | 'right', shift = false) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressArrow(direction, shift ? { shift: true } : undefined) })
  await settle(200)
}
const paneHas = (index: number, text: string) => {
  // Index 64 is the floating window, whichever kind it holds.
  const pane = paneFrame(index)
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
  const actual = (index === 0 ? frame('transcript-reader') : paneFrame(index - 1))!
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
  await chordKey('5')
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
  await chordKey('0')
  const before = frame('transcript-reader')!.width
  await chordKey('>')
  check(frame('transcript-reader')!.width !== before, 'the resize did not change geometry')
  await chordKey('u')
  check(frame('transcript-reader')!.width === before, 'undo did not restore the reader ratio')
  // Height is constrained too, including the row occupied by the strip. Two
  // rows of minimum-height windows fit 24 rows exactly, so go below that.
  await act(async () => { setup.resize(220, 22) })
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
  const first = paneFrame(2)!
  const readerWidthBefore = frame('transcript-reader')!.width
  const topPaneWidthBefore = paneFrame(0)!.width
  const handle = frame('tree-divider:1')
  check(handle && handle.x === first.x + first.width - 1, `the bottom divider is not on the first bottom pane's right border: ${JSON.stringify(handle)} / ${JSON.stringify(first)}`)
  const beforeClick = JSON.stringify(spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('windowSplitTree'))
  await click(handle!.x, handle!.y + 3)
  check(JSON.stringify(spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('windowSplitTree')) === beforeClick && !frame('tree-divider-drag'), 'clicking a divider changed the layout or left a drag active')
  await drag({ x: handle!.x, y: handle!.y + 3 }, { x: handle!.x + 10, y: handle!.y + 3 }, () => {
    check(!!frame('tree-divider-readout'), 'the bottom divider does not show the width it is setting')
  })
  const wider = paneFrame(2)!
  check(wider.width >= first.width + 8 && paneFrame(3)!.x === wider.x + wider.width, `dragging the bottom divider did not widen the first bottom pane: ${first.width} → ${wider.width}`)
  check(frame('transcript-reader')!.width === readerWidthBefore && paneFrame(0)!.width === topPaneWidthBefore, 'the bottom divider moved the top row')
  // ⌃B [ ] size the focused pane against its neighbour. Focusing it makes it
  // the selection, so it is followed by window index from here.
  const firstBottom = paneIndex(2)
  const bottomFrame = () => frame(`split-pane:${firstBottom}`)!
  await chordKey(String(firstBottom))
  await chordKey(']')
  check(bottomFrame().width > wider.width, '⌃B ] did not widen the focused pane')
  await chordKey('u')
  check(bottomFrame().width === wider.width, 'undo did not restore the keyboard resize')
  await chordKey('u')
  check(bottomFrame().width === first.width, 'a divider drag must undo in one step')
  const beforeCancel = JSON.stringify(spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('windowSplitTree'))
  const cancelHandle = frame('tree-divider:1')!
  await drag({ x: cancelHandle.x, y: cancelHandle.y + 3 }, { x: cancelHandle.x + 6, y: cancelHandle.y + 3 }, async () => {
    await act(async () => { setup.mockInput.pressEscape() }); await settle(100)
  })
  check(JSON.stringify(spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('windowSplitTree')) === beforeCancel && !frame('tree-divider-drag'), 'releasing a cancelled divider drag changed the layout')
  console.log('The bottom row\'s divider drags, and ⌃B [ ] move it from the keyboard.')
}
{
  // Every border: the one between the top row's two panes drags too, and leaves the reader alone.
  const left = paneFrame(0)!
  const right = paneFrame(1)!
  const readerWidth = frame('transcript-reader')!.width
  const handle = frame('tree-divider:01')
  check(handle && handle.x === left.x + left.width - 1, `no border handle between the top panes: ${JSON.stringify(handle)}`)
  await drag({ x: handle!.x, y: handle!.y + 2 }, { x: handle!.x - 8, y: handle!.y + 2 })
  check(paneFrame(0)!.width <= left.width - 6 && paneFrame(1)!.width >= right.width + 6, `the top border did not move: ${left.width}/${right.width} → ${paneFrame(0)!.width}/${paneFrame(1)!.width}`)
  check(frame('transcript-reader')!.width === readerWidth, 'the top border moved the reader')
  await chordKey('u')
  check(paneFrame(0)!.width === left.width, 'the border drag did not undo')
  console.log('The border between any two panes drags.')
}

// ── Right-click a pane: close it ────────────────────────────────────────────
{
  const last = paneFrame(4)!
  await rightClick(last.x + 6, last.y)
  await waitFor('the pane menu', () => !!frame('context-menu'))
  const item = locate('Close pane', frame('context-menu')!)
  await click(item.x + 1, item.y)
  await waitFor('the pane to close', () => panes().length === 4)
  check(!frame('context-menu'), 'the menu stayed open after picking')
  // Right-click a rail row: open right of the reader (it joins the grid).
  const hidden = NAMES.find((name) => !shownAnywhere(name))!
  const row = railRow(hidden)
  await rightClick(row.x + 1, row.y)
  await waitFor('the rail menu', () => !!frame('context-menu'))
  const open = locate('Open as a pane on the right', frame('context-menu')!)
  await click(open.x + 1, open.y)
  await waitFor(`${hidden} to join the grid`, () => windowCount() === 6 && shownAnywhere(hidden))
  await openMenu(); const grid = frame('window-layout:grid-six')!; await click(grid.x + 3, grid.y + 1)
  console.log('Right-click menus close a pane and split the focused pane for a rail session.')
}

// ── Drop on a pane's edge: insert beside it ─────────────────────────────────
{
  await chordKey('5')
  await chordKey('x')
  await waitFor('four panes', () => panes().length === 4)
  const hidden = NAMES.find((name) => !shownAnywhere(name))!
  const first = paneFrame(0)!
  const row = railRow(hidden)
  await drag({ x: row.x + 1, y: row.y }, { x: first.x + first.width - 2, y: first.y + Math.floor(first.height / 2) }, () => {
    check(setup.captureCharFrame().includes('Split does not fit'), 'an undersized target did not explain why the split is refused')
    check(!frame('window-drop-zone'), 'an invalid split still shows a destination outline')
  })
  check(panes().length === 4, 'an undersized edge drop changed the layout')
  await rightClick(row.x + 1, row.y)
  const open = locate('Open as a pane on the right', frame('context-menu')!)
  await click(open.x + 1, open.y)
  await waitFor('five panes restored', () => panes().length === 5)
  await openMenu(); const grid = frame('window-layout:grid-six')!; await click(grid.x + 3, grid.y + 1)
  console.log('An undersized edge drop is refused without changing its neighbours.')
}

// ── ⌃B ⇧→ swaps; ⌃B m zooms ─────────────────────────────────────────────────
{
  // Focus explicitly: Escape on an already-focused transcript requests exit.
  // Windows are followed by absolute index: focusing one makes it the reader.
  await chordKey('0')
  await arrowChord('right')
  check(focusedWindow() === 1, `directional focus did not reach the first adjacent window: ${focusedWindow()}`)
  // A swap trades the two windows' places; each keeps its session.
  const at = (i: number) => JSON.stringify(frame(`split-pane:${i}`))
  const left = at(1), right = at(2)
  await arrowChord('right', true)
  await waitFor('⌃B ⇧→ to swap the two top windows', () => at(1) === right && at(2) === left)
  await chordKey('u')
  await waitFor('undo to restore the window positions', () => at(1) === left && at(2) === right)
  await arrowChord('right', true)
  await waitFor('the swap again', () => at(1) === right && at(2) === left)
  const before = [0, 1, 2, 3, 4, 5].map(windowName)
  await chordKey('m')
  await waitFor('⌃B m to zoom one window', () => windowCount() === 1)
  const area = frame('window-area')!
  const zoomed = windowFrames().find((box) => box !== null)!
  check(zoomed.width === area.width && zoomed.height === area.height, `the zoomed window is not the whole area: ${JSON.stringify(zoomed)} in ${JSON.stringify(area)}`)
  check(!frame('split-secondary-divider'), 'the second divider is still drawn over a zoomed window')
  await chordKey('m')
  await waitFor('⌃B m to restore the layout', () => windowCount() === 6)
  // Kept mounted: every window shows its session on the first frame back, with no reload.
  check([0, 1, 2, 3, 4, 5].every((index) => windowName(index) === before[index]), `windows reloaded after the zoom: ${JSON.stringify([0, 1, 2, 3, 4, 5].map(windowName))} vs ${JSON.stringify(before)}`)
  console.log('⌃B ⇧arrows swap windows; ⌃B m zooms and restores.')
}

// Dropping in the middle groups panes as tabs; undo restores their frames.
{
  const all = [0, 1, 2, 3, 4, 5]
  await waitFor('window sessions after zoom', () => all.every((index) => windowName(index) !== null))
  const order = all.map(windowName)
  const source = frame('split-pane:2')!
  const target = frame('split-pane:1')!
  await drag({ x: source.x + 10, y: source.y }, { x: target.x + Math.floor(target.width / 2), y: target.y + Math.floor(target.height / 2) })
  await waitFor('centre drop to group the windows', () => !!frame(`window-tab:claude:win-${order[1]}`) && !!frame(`window-tab:claude:win-${order[2]}`))
  await chordKey('u')
  await waitFor('undo to restore both replaced sessions', () => all.every((index) => windowName(index) === order[index]))
  // The original frame keeps its session while its geometry moves.
  await chordKey('0')
  const originalFrame = frame('split-pane:0')!
  await arrowChord('right', true)
  await waitFor('original frame swapped with a window', () => JSON.stringify(frame('split-pane:0')) !== JSON.stringify(originalFrame) && windowName(0) === order[0])
  await chordKey('u')
  await waitFor('undo to restore the window order', () => JSON.stringify(frame('split-pane:0')) === JSON.stringify(originalFrame) && all.every((index) => windowName(index) === order[index]))
  console.log('Moves and replacements undo together with the reader session and divider geometry.')
}

// The switcher includes hidden windows and leaves their logical order intact.
{
  const all = [0, 1, 2, 3, 4, 5]
  await waitFor('window sessions for switching', () => all.every((index) => windowName(index) !== null))
  const order = all.map(windowName)
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
  await waitFor('every original window returned in order', () => all.every((index) => windowName(index) === order[index]))
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
  // Windows remount after a zoom; read the order once each shows its session again.
  const all = [0, 1, 2, 3, 4, 5]
  await waitFor('every window to show its session', () => all.every((index) => windowName(index) !== null))
  const order = all.map(windowName)
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
  // Every window is saved, the selected session's included.
  check(listSavedWindowLayouts(CWD)[0]?.panes.length === 6, 'saving at a small size discarded hidden windows')
  await act(async () => { setup.mockInput.pressKey('5') })
  await act(async () => { setup.resize(220, 46) })
  await settle(300)
  await waitFor('one window filling the area', () => windowCount() === 1)
  await openMenu()
  const savedRow = setup.renderer.root.findDescendantById('window-layout:save')
  check(savedRow, 'the save row is gone')
  const row = locate('Layout 1')
  await click(row.x + 1, row.y)
  await waitFor('the saved layout to come back in order', () => windowCount() === 6 && all.every((index) => windowName(index) === order[index]))
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
  await chordKey('5')
  await chordKey('x')
  await waitFor('five windows for the updated workspace', () => windowCount() === 5)
  await openMenu()
  const update = frame(`window-layout:update:${saved.id}`)!
  await click(update.x + 1, update.y)
  const updated = listSavedWindowLayouts(CWD)[0]!
  check(updated.panes.length === 5 && updated.id === saved.id && updated.name === 'Review', 'update did not replace the contents under the existing name')
  await act(async () => { setup.mockInput.pressEscape() })
  await chordKey('u')
  await waitFor('the original six windows back', () => windowCount() === 6)
  await openMenu()
  await act(async () => { setup.mockInput.pressKey('n') })
  await waitFor('the named-save input', () => !!frame('window-layout:name'))
  await act(async () => { await setup.mockInput.typeText('Debugging') })
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the named workspace saved', () => listSavedWindowLayouts(CWD).some((entry) => entry.name === 'Debugging' && entry.panes.length === 6))
  await act(async () => { setup.mockInput.pressEscape() })
  console.log('Saved workspaces can be named, renamed with paste, updated in place, and previewed before restoring.')
}

// Updates mark background panes passively. Only the explicit attention chord
// moves focus, and looking at a pane acknowledges output/errors, not prompts.
{
  const all = [0, 1, 2, 3, 4, 5]
  await waitFor('window contents before background activity', () => all.every((index) => windowName(index) !== null))
  await settle(100)
  const targetIndex = all.find((index) => windowName(index) === 'charlie')!
  const focusBefore = focusedWindow(), orderBefore = all.map(windowName)
  const sessionIndex = SESSIONS.findIndex((session) => session.sessionId === 'win-charlie')
  failedWindowSessions.add('win-charlie')
  SESSIONS[sessionIndex] = { ...SESSIONS[sessionIndex]!, lastModified: Date.now() }
  await waitFor('the background error badge', () => setup.captureCharFrame().includes('! error'))
  check(focusedWindow() === focusBefore, 'background output stole focus')
  check(setup.captureCharFrame().includes('unread'), 'new background output was not marked unread')
  await chordKey('a')
  await waitFor('attention to focus the affected pane', () => !setup.captureCharFrame().includes('! error') && !setup.captureCharFrame().includes('unread'))
  check(focusedWindow() === targetIndex && all.every((index) => windowName(index) === orderBefore[index]),
    'the attention shortcut replaced a window instead of focusing the visible one')
  viewerNotes.push({ id: 'window-input', sessionId: 'win-charlie', provider: 'claude', title: 'Needs a decision', createdAt: Date.now() })
  await waitFor('the pending-input badge', () => setup.captureCharFrame().includes('? input'))
  check(windowName(targetIndex) === 'charlie', 'a prompt moved the windows')
  viewerNotes.length = 0
  failedWindowSessions.clear()
  await waitFor('the resolved input badge to disappear', () => !setup.captureCharFrame().includes('? input'))
  await act(async () => { setup.mockInput.pressEscape() })
  console.log('Unread output, errors, and pending input are passive; the attention chord acknowledges the chosen window.')
}

// ── Search a pane's whole history ───────────────────────────────────────────
{
  // A window's search is the transcript search: / opens its bar, the window
  // highlights the matches, and Enter jumps to one, sliding older history in.
  const index = [0, 1, 2, 3, 4, 5].find((at) => windowName(at) === 'bravo')!
  const shows = (text: string) => { const box = frame(`split-pane:${index}`)!; return setup.captureCharFrame().split('\n').slice(box.y, box.y + box.height).some((line) => line.slice(box.x, box.x + box.width).includes(text)) }
  await chordKey(String(index))
  check(!shows('NEEDLE-IN-BRAVO'), 'the needle is already on screen; the test proves nothing')
  await act(async () => { setup.mockInput.pressKey('/') })
  await settle(80)
  await act(async () => { await setup.mockInput.typeText('needle') })
  await settle(200)
  check(setup.captureCharFrame().includes('SEARCH') && /1\/1 matches|1 match/.test(setup.captureCharFrame()), 'the search bar does not count the match')
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the search to page back to the needle', () => shows('NEEDLE-IN-BRAVO'))
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
  const window = allWindows().find((pane) => setup.captureCharFrame().split('\n')[pane.y]?.slice(pane.x, pane.x + pane.width).includes('❯ Terminal'))
  check(window, `no terminal window in the layout: ${JSON.stringify(allWindows())}`)
  await act(async () => { setup.mockInput.pressKey('o') })
  await waitFor('a shell in the window', () => /[$#%>] ?$/m.test((() => { const shell = getShells()[0]; const term = shell ? shellTerminal(shell.id) : null; return term ? readAllScreenText(term).join('\n') : '' })()))
  await act(async () => { await setup.mockInput.typeText('echo from-a-window') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the shell to run in the window', () => windowHas(allWindows().indexOf(window!), 'from-a-window') || setup.captureCharFrame().includes('from-a-window'))
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await act(async () => { setup.resize(65, 46) })
  await settle(300)
  await chordKey('p')
  await waitFor('the switcher for a hidden surface', () => !!frame('window-switcher'))
  await act(async () => { await setup.mockInput.typeText('terminal') })
  await act(async () => { setup.mockInput.pressEnter() })
  const peekVisible = () => (setup.renderer.root.findDescendantById('surface-frame:terminal') as unknown as { visible?: boolean } | null)?.visible !== false
  await waitFor('the hidden terminal peek', () => peekVisible() && setup.captureCharFrame().includes('from-a-window'))
  await act(async () => { setup.mockInput.pressEscape() })
  await waitFor('the peek dismissed', () => !peekVisible())
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
    return allWindows().findIndex((pane) => pane.width > 0 && button.y === pane.y && button.x >= pane.x && button.x < pane.x + pane.width)
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
  await chordKey('w'); const grid = frame('window-layout:grid-six')!; await click(grid.x + 3, grid.y + 1)
  await waitFor('both terminal frames fitted', () => windowIndexOf('surface-window-close:terminal') >= 0 && windowIndexOf('surface-window-close:terminal#2') >= 0)

  // Each window's shell takes its own keys.
  const shellText = (index: number) => { const shell = getShells()[index]; const term = shell ? shellTerminal(shell.id) : null; return term ? readAllScreenText(term).join('\n') : '' }
  const before = getShells().length
  await chordKey(String(windowIndexOf('surface-window-close:terminal')))
  await act(async () => { setup.mockInput.pressKey('o') })
  await waitFor('a shell in the first window', () => getShells().length === before + 1 && /[$#%>] ?$/m.test(shellText(before)))
  await act(async () => { await setup.mockInput.typeText('echo one-window') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the first shell to run', () => shellText(before).includes('one-window'))
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await chordKey(String(windowIndexOf('surface-window-close:terminal#2')))
  await act(async () => { setup.mockInput.pressKey('o') })
  await waitFor('a shell in the second window', () => getShells().length === before + 2 && /[$#%>] ?$/m.test(shellText(before + 1)))
  await act(async () => { await setup.mockInput.typeText('echo two-window') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the second shell to run', () => shellText(before + 1).includes('two-window'))
  check(!shellText(before).includes('two-window'), 'typing in the second window reached the first window’s shell')
  check(windowHas(windowIndexOf('surface-window-close:terminal'), 'one-window'), 'the first window does not show the shell typed into it')
  check(!windowHas(windowIndexOf('surface-window-close:terminal'), 'two-window'), 'the first window shows the second window’s shell')
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(100)

  // Dragging a surface window's title onto a session pane swaps the two.
  const from = windowIndexOf('surface-window-close:terminal#2')
  const target = allWindows().findIndex((pane, index) => index !== from && pane.width > 0 && windowName(index) !== null)
  check(from >= 0 && target >= 0, `no surface/session pair to swap: ${from} ${target}`)
  const sessionBefore = windowName(target)
  const mountedFrame = setup.renderer.root.findDescendantById('surface-frame:terminal#2')
  check(mountedFrame, 'the surface layer did not draw the terminal window')
  const source = windowFrame(from)!
  const dest = windowFrame(target)!
  await drag({ x: source.x + 3, y: source.y }, { x: dest.x + Math.floor(dest.width / 2), y: dest.y + Math.floor(dest.height / 2) }, () => {
    check(setup.captureCharFrame().includes(`Add as a tab of window ${target + 1}`), 'the drag ghost does not offer tabs')
  })
  await waitFor('the surface grouped as a tab', () => !!frame(`window-tab:claude:win-${sessionBefore}`) && !!frame('window-tab:surface:terminal#2'))
  const movedIndex = windowIndexOf('surface-window-close:terminal#2')
  check(windowHas(movedIndex, 'two-window'), 'the moved window no longer shows its own shell')
  check(setup.renderer.root.findDescendantById('surface-frame:terminal#2') === mountedFrame, 'tabbing the surface remounted it')
  checkSurfaceAlignment('after grouping as tabs')
  await chordKey('u')
  await waitFor('undo to put the surface back', () => windowIndexOf('surface-window-close:terminal#2') === from)
  checkSurfaceAlignment('after undo')
  // As a background tab it stays mounted, hidden; shown again, it is the same window.
  await chordKey(String(from))
  await chordKey('t')
  await waitFor('the terminal as a tab', () => !!frame('window-tab:surface:terminal#2'))
  const tabs = frame('window-tab:surface:terminal#2')!
  const strip = allWindows().findIndex((pane) => pane.y === tabs.y && tabs.x >= pane.x && tabs.x < pane.x + pane.width)
  const otherTab = (setup.renderer.root.findDescendantById(`window-tabs:${strip}`) as unknown as { getChildren(): Array<Frame & { id: string }> }).getChildren().find((child) => child.id !== 'window-tab:surface:terminal#2')!
  await click(otherTab.x + 2, otherTab.y)
  await waitFor('the other tab shown', () => (setup.renderer.root.findDescendantById('surface-frame:terminal#2') as unknown as { visible?: boolean } | null)?.visible === false)
  check(setup.renderer.root.findDescendantById('surface-frame:terminal#2') === mountedFrame, 'a background tab was unmounted')
  const back = frame('window-tab:surface:terminal#2')!
  await click(back.x + 2, back.y)
  await waitFor('the terminal tab shown again', () => windowHas(strip, 'two-window'))
  check(setup.renderer.root.findDescendantById('surface-frame:terminal#2') === mountedFrame, 'showing a tab again remounted it')
  checkSurfaceAlignment('a shown tab')
  await chordKey(String(strip))
  await chordKey('!')
  await waitFor('the terminal broken out again', () => !frame('window-tab:surface:terminal#2') && windowIndexOf('surface-window-close:terminal#2') >= 0)
  console.log('Surface windows open several of a kind, take their own keys, and swap with session panes by drag.')
}

// ── Tabbed windows ──────────────────────────────────────────────────────────
{
  const sessionPanes = () => allWindows().map((_, index) => index).filter((index) => windowName(index) !== null)
  await waitFor('two session panes to tab together', () => sessionPanes().length >= 2)
  const framesBefore = allWindows().length
  const [anchorIndex, movingIndex] = sessionPanes()
  const anchorName = windowName(anchorIndex!)!
  const movingName = windowName(movingIndex!)!
  // Drag one pane's title onto another's: it becomes a tab there.
  const source = windowFrame(movingIndex)!
  const dest = windowFrame(anchorIndex)!
  await drag({ x: source.x + 6, y: source.y }, { x: dest.x + Math.floor(dest.width / 2), y: dest.y }, () => {
    check(setup.captureCharFrame().includes(`Add as a tab of window ${anchorIndex! + 1}`), 'the drag ghost does not offer a tab')
  })
  await waitFor('the tab strip', () => !!frame('window-tab:claude:win-' + anchorName) && !!frame('window-tab:claude:win-' + movingName))
  // More windows than fit: the freed frame goes to a hidden one, so count where each name shows.
  const framesShowing = (name: string) => allWindows().filter((_, index) => windowName(index) === name).length
  // The global strip replaces a focused host's local tab controls. Focus a
  // neighbour when exercising the stack's own controls below.
  const focusOutsideStack = async () => {
    const other = allWindows().findIndex((_, index) => {
      const name = windowName(index)
      return name !== null && name !== anchorName && name !== movingName
    })
    check(other >= 0, 'no neighbour for the tabbed window')
    await chordKey(String(other))
  }
  check(framesShowing(movingName) === 1 && framesShowing(anchorName) === 0, `the two tabs are not one frame: ${movingName}=${framesShowing(movingName)} ${anchorName}=${framesShowing(anchorName)} (${framesBefore} frames)`)
  // Closing some other pane's tab leaves a pin to refill: a background tab must not be what fills it.
  const others = allWindows().map((_, index) => index).filter((index) => windowName(index) !== null && windowName(index) !== movingName)
  if (others.length > 0) {
    const victim = windowName(others[others.length - 1]!)!
    // Expose all strip entries when the tab host is one narrow grid cell.
    const host = allWindows().findIndex((_, index) => windowName(index) === movingName)
    await chordKey(String(host))
    await chordKey('m')
    // A tab's name can be cut short in a narrow window; its first letter is unique.
    const tabBarEntry = locate(`Win ${victim[0]}`, frame('session-tabs')!)
    await rightClick(tabBarEntry.x + 1, tabBarEntry.y)
    await waitFor('the tab menu', () => !!frame('context-menu'))
    const closeTab = locate('Close tab', frame('context-menu')!)
    await click(closeTab.x + 1, closeTab.y)
    await chordKey('m')
    await waitFor('the tab closed', () => framesShowing(victim) === 0)
    await settle(300)
    await focusOutsideStack()
    check(framesShowing(anchorName) === 0 && !!frame('window-tab:claude:win-' + anchorName), `a background tab was pulled into a pane: ${anchorName}`)
  }
  const tabFrame = allWindows().findIndex((_, index) => windowName(index) === movingName)
  check(tabFrame >= 0, 'the dropped tab is not the one shown')
  // Clicking the other tab shows it in the same frame.
  const otherTab = frame('window-tab:claude:win-' + anchorName)!
  await click(otherTab.x + 2, otherTab.y)
  await waitFor('the clicked tab shown', () => windowName(tabFrame) === anchorName)
  // ⌃B . steps tabs in the focused window.
  await chordKey(String(tabFrame))
  await chordKey('.')
  await waitFor('⌃B . to step to the next tab', () => windowName(tabFrame) === movingName)
  // Closing a tab leaves the frame showing the other.
  await focusOutsideStack()
  const close = frame('window-tab-close:claude:win-' + movingName)!
  await click(close.x, close.y)
  await waitFor('closing a tab to show the other', () => windowName(tabFrame) === anchorName && !frame('window-tabs:' + tabFrame))
  check(framesShowing(anchorName) === 1 && framesShowing(movingName) === 0, 'closing a tab closed the frame, or left the closed tab in a window')
  // ⌃B t tabs the focused window onto the one before; ⌃B ! breaks it back out.
  await waitFor('another session pane', () => sessionPanes().length >= 2)
  const second = sessionPanes()[1]!
  const secondName = windowName(second)!
  await chordKey(String(second))
  await chordKey('t')
  await waitFor('⌃B t to make a tab', () => shareStack('claude:win-' + secondName))
  const shownAt = allWindows().findIndex((_, index) => windowName(index) === secondName)
  await chordKey(String(shownAt))
  await chordKey('!')
  await waitFor('⌃B ! to break the tab out', () => !shareStack('claude:win-' + secondName))
  check(allWindows().some((_, index) => windowName(index) === secondName) || !!frame('floating-window'), 'the broken-out tab has no visible window')
  // A tab dragged out of its strip onto empty space is its own window.
  await chordKey(String(allWindows().findIndex((_, index) => windowName(index) === secondName)))
  await chordKey('t')
  await waitFor('tabbed again', () => shareStack('claude:win-' + secondName))
  await focusOutsideStack()
  const tab = frame('window-tab:claude:win-' + secondName)!
  await drag({ x: tab.x + 2, y: tab.y }, { x: 2, y: tab.y + 3 })
  await waitFor('a tab dragged out to be a window', () => !shareStack('claude:win-' + secondName) && (framesShowing(secondName) === 1 || !!frame('floating-window')))
  console.log('Windows share a frame as tabs: drag onto a title, click, ⌃B . steps, × closes one, ⌃B t / ⌃B ! join and leave.')
}

// ── A floating window ───────────────────────────────────────────────────────
{
  if (frame('floating-window')) {
    await chordKey('f')
    await waitFor('previously detached window docked', () => !frame('floating-window'))
  }
  const session = allWindows().map((_, index) => index).find((index) => windowName(index) !== null)!
  const name = windowName(session)!
  // From the layout, not the screen: the floating window is drawn over tiled ones.
  const inLayout = () => ((spacesController!.runtime(spacesController!.activeWorkspace()!).values.get('windowOrder') ?? []) as string[]).includes(`claude:win-${name}`)
  await chordKey(String(session))
  await chordKey('f')
  await waitFor('the floating window', () => !!frame('floating-window'))
  check(!inLayout(), 'floating the window left it in the layout too')
  const floating = () => frame('floating-window')!
  // Nothing from the windows underneath shows through it.
  const checkOpaque = (when: string) => {
    const box = floating()
    const inside = setup.captureCharFrame().split('\n').slice(box.y + 1, box.y + box.height - 1).map((line) => line.slice(box.x + 1, box.x + box.width - 1))
    // An underlying frame's border column, inside the floating box, must not show its │ down the rows.
    const borderColumns = allWindows().flatMap((pane) => [pane.x, pane.x + pane.width - 1]).map((x) => x - box.x - 1).filter((x) => x > 2 && x < box.width - 4)
    const showing = borderColumns.filter((x) => inside.filter((line) => line[x] === '│').length > inside.length * 0.6)
    check(showing.length === 0, `the windows underneath show through the floating one ${when}:\n${inside.join('\n')}`)
  }
  checkOpaque('while it loads')
  await waitFor('the floating window to show its session', () => windowHas(64, marker(`win-${name}`)))
  checkOpaque('once loaded')
  // Its title moves it; ◢ resizes it.
  const start = floating()
  await click(freeTitleColumn(start), start.y)
  check(!!frame('floating-window') && JSON.stringify(floating()) === JSON.stringify(start), 'clicking a floating title moved or docked the window')
  await drag({ x: freeTitleColumn(start), y: start.y }, { x: freeTitleColumn(start) - 6, y: start.y + 2 })
  await waitFor('the floating window to move', () => floating().x === start.x - 6 && floating().y === start.y + 2)
  const handle = frame('floating-resize')!
  await drag({ x: handle.x, y: handle.y }, { x: handle.x - 10, y: handle.y - 3 })
  await waitFor('the floating window to shrink', () => floating().width === start.width - 10 && floating().height === start.height - 3)
  // Keys go to it while it is focused.
  check(setup.captureCharFrame().includes('⊞ dock'), 'no dock button on the floating window')
  await chordKey('f')
  await waitFor('docking it back', () => !frame('floating-window') && inLayout())
  check(windowName(session) === name, `docking did not put it back in its slot: window ${session + 1} shows ${windowName(session)}`)
  await chordKey('u')
  await waitFor('undo to float it again', () => !!frame('floating-window'))
  await chordKey('u')
  await waitFor('undo the floating resize', () => floating().width === start.width && floating().height === start.height)
  await chordKey('u')
  await waitFor('undo the floating move', () => floating().x === start.x && floating().y === start.y)
  await chordKey('u')
  await waitFor('undo floating to restore its pane', () => !frame('floating-window') && inLayout())
  // A surface window floats too, and its shell keeps its keys there.
  const shellWindow = allWindows().findIndex((pane) => setup.captureCharFrame().split('\n')[pane.y]?.slice(pane.x, pane.x + pane.width).includes('❯ Terminal'))
  check(shellWindow >= 0, 'no terminal window left to float')
  await chordKey(String(shellWindow))
  await chordKey('f')
  await waitFor('the floating terminal', () => !!frame('floating-window') && windowHas(64, 'Terminal'))
  await act(async () => { setup.mockInput.pressKey('o') })
  await settle(400)
  await act(async () => { await setup.mockInput.typeText('echo from-a-float') })
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('the floating shell to run', () => windowHas(64, 'from-a-float'))
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  await chordKey('f')
  await waitFor('the terminal docked', () => !frame('floating-window'))
  console.log('A window floats over the layout, moves by its title, resizes by ◢, docks with ⌃B f, and undo walks it back.')
}

// ── Clicking a window focuses it ────────────────────────────────────────────
{
  await chordKey('0')
  const sessionWindows = allWindows().map((_, index) => index).filter((index) => windowName(index) !== null)
  check(sessionWindows.length >= 2, 'need two session panes to click between')
  // A focused session pane's frame is lit: its border colour is the one no other session pane shares.
  const paneFocused = (index: number) => focusedWindow() === index
  const borderOf = (id: string) => String((setup.renderer.root.findDescendantById(id) as unknown as { borderColor?: unknown } | null)?.borderColor ?? '')

  for (const index of sessionWindows.slice(0, 2)) {
    const pane = windowFrame(index)!
    await click(pane.x + Math.floor(pane.width / 2), pane.y + Math.floor(pane.height / 2))
    await waitFor(`a click in pane ${index + 1}'s body to focus it`, () => paneFocused(index))
  }
  // The reader is the selected session's window: a click in it focuses that window.
  const readerIndex = () => allWindows().findIndex((box) => box.width > 0 && isReaderWindow(box))
  const firstFocused = sessionWindows[0]!
  await click(windowFrame(firstFocused)!.x + 4, windowFrame(firstFocused)!.y + 4)
  await waitFor('the first window focused again', () => paneFocused(firstFocused))
  const reader = frame('transcript-reader')!
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await waitFor('a click in the reader focuses its window', () => focusedWindow() === readerIndex())
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
  const pane = windowFrame(sessionWindows[0])!
  await click(pane.x + Math.floor(pane.width / 2), pane.y + Math.floor(pane.height / 2))
  await waitFor('a click in a pane after the rail to focus the pane', () => paneFocused(sessionWindows[0]!))
  // A surface window's body focuses it too.
  const surface = allWindows().findIndex((entry) => setup.captureCharFrame().split('\n')[entry.y]?.slice(entry.x, entry.x + entry.width).includes('❯ Terminal'))
  if (surface >= 0) {
    const box = windowFrame(surface)!
    // The surface layer draws the frame over the slot; its id is the surface's.
    const drawn = (setup.renderer.root.findDescendantById('window-area') as unknown as { getChildren(): Array<Frame & { id: string; visible?: boolean }> })
      .getChildren().find((child) => child.id.startsWith('surface-frame:') && child.visible !== false && child.x === box.x && child.y === box.y)!
    const before = borderOf(drawn.id)
    await click(box.x + Math.floor(box.width / 2), box.y + Math.floor(box.height / 2))
    await waitFor('a click in a surface window to focus it', () => borderOf(drawn.id) !== before && !paneFocused(sessionWindows[0]!))
  }
  console.log('A click anywhere in a window — pane, reader or surface — gives it focus.')
}

// ── All frame types share tab, move, cancel, float and dock behavior ─────────
{
  const runtime = spacesController!.runtime(spacesController!.activeWorkspace()!)
  const { arrangePaneTree } = await import('./windowSplitTree')
  await act(async () => {
    // Window 0 is alpha (the selected session, the "reader"), 1 bravo, 2 the terminal.
    runtime.set('workspaceHasSession', true)
    runtime.set('selectedSessionKey', 'claude:win-alpha'); runtime.set('readerSession', SESSIONS[0])
    runtime.set('openTabSessions', SESSIONS); runtime.set('splitPinnedKeys', ['claude:win-alpha', 'claude:win-bravo']); runtime.set('splitPaneCount', 2)
    runtime.set('windowSurfaces', ['terminal']); runtime.set('windowOrder', ['claude:win-alpha', 'claude:win-bravo', 'surface:terminal'])
    runtime.set('windowStacks', []); runtime.set('floatingWindow', null); runtime.set('windowZoom', null)
    runtime.set('windowSplitTree', arrangePaneTree(['claude:win-alpha', 'claude:win-bravo', 'surface:terminal'], false, 'columns'))
    runtime.set('splitFocusIndex', null); runtime.set('surfacePanelOpen', false)
    setup.resize(360, 54)
  }); await settle(300)
  await act(async () => { setup.mockInput.pressKey(']', { ctrl: true }) }); await settle(100)
  const bravoVisible = () => {
    const pane = windowFrame(1)
    return !!pane && (setup.captureCharFrame().split('\n')[pane.y] ?? '').slice(pane.x, pane.x + pane.width).includes('Win bravo')
  }
  await waitFor('mixed frames for drag checks', () => readerShows('alpha') && bravoVisible() && !!frame('surface-window-close:terminal'))
  let reader = frame('transcript-reader')!
  let pane = windowFrame(1)!
  await drag({ x: freeTitleColumn(reader), y: reader.y }, { x: pane.x + Math.floor(pane.width / 2), y: pane.y + Math.floor(pane.height / 2) })
  await waitFor('original frame joins the same tab model', () => shareStack('claude:win-alpha', 'claude:win-bravo'))
  await chordKey('u')
  await waitFor('undo restores original and ordinary frames', () => readerShows('alpha') && bravoVisible())
  reader = frame('transcript-reader')!; pane = windowFrame(1)!
  const beforeCancel = JSON.stringify(runtime.values.get('windowSplitTree'))
  await drag({ x: freeTitleColumn(reader), y: reader.y }, { x: pane.x + Math.floor(pane.width / 2), y: pane.y + Math.floor(pane.height / 2) }, async () => {
    await act(async () => { setup.mockInput.pressEscape() }); await settle(100)
    check(!frame('window-drag-ghost'), 'Escape did not cancel the drag')
  })
  check(readerShows('alpha') && JSON.stringify(runtime.values.get('windowSplitTree')) === beforeCancel, 'a cancelled drag changed the layout')
  reader = frame('transcript-reader')!
  const originalX = reader.x
  await drag({ x: freeTitleColumn(reader), y: reader.y }, { x: reader.x + reader.width - 2, y: reader.y + Math.floor(reader.height / 2) })
  await waitFor('original frame moves right without changing its session', () => frame('transcript-reader')!.x > originalX && readerShows('alpha'))
  await chordKey('u')
  await waitFor('undo restores original frame geometry', () => frame('transcript-reader')!.x === originalX)
  reader = frame('transcript-reader')!
  const surfaceSlot = windowFrame(2)!
  await drag({ x: surfaceSlot.x + 4, y: surfaceSlot.y }, { x: reader.x + Math.floor(reader.width / 2), y: reader.y + Math.floor(reader.height / 2) }, () => {
    check(setup.captureCharFrame().includes('Add as a tab of window 1'), 'surface-to-original drag describes the wrong action')
  })
  await waitFor('surface and original session become tabs', () => shareStack('surface:terminal', 'claude:win-alpha'))
  // The live shell owns Ctrl+B for nested tmux; release capture before undo.
  await act(async () => { setup.mockInput.pressKey(']', { ctrl: true }) }); await settle(100)
  await chordKey('u')
  await waitFor('undo restores surface and original session', () => readerShows('alpha') && !!frame('surface-window-close:terminal'))
  await chordKey('2')
  // A focused shell owns ⌃B: hand the keys back before the chord.
  await act(async () => { setup.mockInput.pressKey(']', { ctrl: true }) }); await settle(100)
  await chordKey('f')
  await waitFor('surface floats', () => !!frame('floating-window'))
  const floated = frame('floating-window')!
  const target = windowFrame(0)!
  await drag({ x: freeTitleColumn(floated), y: floated.y }, { x: target.x + Math.floor(target.width / 2), y: target.y })
  await waitFor('floating surface becomes a tab', () => !frame('floating-window') && shareStack('surface:terminal', 'claude:win-alpha'))
  await act(async () => { setup.mockInput.pressKey(']', { ctrl: true }) }); await settle(100)
  await chordKey('1'); await chordKey('!')
  await settle(200)
  if (!frame('floating-window')) {
    const index = (runtime.values.get('windowOrder') as string[]).indexOf('surface:terminal')
    check(index >= 0, 'detached surface disappeared')
    await chordKey(String(index)); await chordKey('f')
  }
  await waitFor('detached surface floats again', () => !!frame('floating-window'))
  const area = frame('window-area')!, again = frame('floating-window')!
  await drag({ x: freeTitleColumn(again), y: again.y }, { x: area.x + area.width - 1, y: again.y + 3 })
  await waitFor('floating window docks by drag', () => !frame('floating-window'))
  console.log('Original, session and surface frames share tabs and movement; Escape cancels; floating windows tab and dock by drag.')
}

console.log('Windowing (more) smoke passed')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
