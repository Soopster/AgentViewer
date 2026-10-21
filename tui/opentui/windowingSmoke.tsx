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

const spacesStore = await import('./spacesStore')
let controller: InstanceType<typeof spacesStore.SpacesController> | null = null
mock.module('./spacesStore', () => ({ ...spacesStore, SpacesController: class extends spacesStore.SpacesController { constructor() { super(); controller = this } } }))
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
const panes = () => Array.from({ length: 31 }, (_, index) => { const box = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as (Frame & { visible?: boolean }) | null; return box && box.visible !== false ? { x: box.x, y: box.y, width: box.width, height: box.height } : null }).filter((box): box is Frame => box !== null)
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
const runtime = () => controller!.runtime(controller!.activeWorkspace()!)
const focusedPane = (): number | null => runtime().values.get('splitFocusIndex') as number | null
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
  const reader = frame('transcript-reader')
  if (!reader) return false
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

// Layout choices are previews until applied; Fill zooms and retains every view.
const chord = async (key: string) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) }); await settle(50)
  await act(async () => { setup.mockInput.pressKey(key) }); await settle(150)
}
const openLayout = async () => { await chord('w'); await waitFor('layout menu', () => !!frame('window-layout:grid')) }
const arrange = async (action: string) => { await openLayout(); const icon = frame(`window-layout:${action}`)!; await click(icon.x + 3, icon.y + 1) }
await openLayout()
const gridChoice = frame('window-layout:grid')!
await act(async () => { await setup.mockMouse.moveTo(gridChoice.x + 3, gridChoice.y + 1) }); await settle(100)
check(setup.captureCharFrame().includes('Grid of four · ⏎ applies'), 'hover does not describe the arrangement')
await click(2, 2)
check(!frame('window-layout:grid'), 'clicking outside did not dismiss the menu')
await arrange('grid')
await waitFor('grid fills from available sessions', () => panes().length === 3)
const logicalBeforeFill = JSON.stringify(runtime().values.get('windowSplitTree'))
await chord('1'); await openLayout()
await act(async () => { setup.mockInput.pressKey('5') }); await settle(150)
check(panes().length === 0 && runtime().values.get('windowZoom') === 'reader', 'Fill did not zoom the focused frame')
check(JSON.stringify(runtime().values.get('windowSplitTree')) === logicalBeforeFill, 'Fill discarded the other views')
await chord('m')
for (let count = 3; count > 0; count--) { await chord('2'); await chord('x') }
await chord('1')
check(panes().length === 0 && readerShows('alpha'), 'closing neighbours replaced the original session')

// Splits are local to the target frame and may mix axes.
for (const [name, edge] of [['bravo', 'right'], ['charlie', 'left'], ['delta', 'bottom']] as const) {
  const row = railRow(name), reader = frame('transcript-reader')!
  const point = edge === 'right' ? { x: reader.x + reader.width - 3, y: reader.y + Math.floor(reader.height / 2) }
    : edge === 'left' ? { x: reader.x + 2, y: reader.y + Math.floor(reader.height / 2) }
    : { x: reader.x + Math.floor(reader.width / 2), y: reader.y + reader.height - 2 }
  const count = panes().length
  await drag({ x: row.x + 1, y: row.y }, point, () => check(setup.captureCharFrame().includes('Split here'), 'valid split has no drag feedback'))
  await waitFor(`${name} split ${edge}`, () => panes().length === count + 1 && paneShows(count, name))
  const pane = frame(`split-pane:${count}`)!, original = frame('transcript-reader')!
  check(edge === 'right' ? pane.x >= original.x + original.width : edge === 'left' ? pane.x + pane.width <= original.x : pane.y >= original.y + original.height, 'split landed on the wrong side')
  check(readerShows('alpha'), 'splitting a frame changed its session')
}
console.log('Rail drops create local mixed-axis splits without replacing neighbouring sessions.')
await chord('1'); await arrange('grid')
let reader = frame('transcript-reader')!, area = frame('window-area')!
const [topRight, bottomLeft, bottomRight] = panes() as [Frame, Frame, Frame]
check(topRight.y === reader.y && topRight.x > reader.x && bottomLeft.y >= reader.y + reader.height && bottomRight.y === bottomLeft.y, 'grid is not two by two')
check(bottomRight.x + bottomRight.width <= area.x + area.width, 'grid exceeds the window area')
const moving = frame('split-pane:0')!, target = frame('split-pane:2')!
await drag({ x: moving.x + 4, y: moving.y }, { x: target.x + Math.floor(target.width / 2), y: target.y + Math.floor(target.height / 2) })
await waitFor('centre drop groups tabs', () => !!frame('window-tab:claude:win-bravo') && !!frame('window-tab:claude:win-delta'))
await chord('u')
await waitFor('undo restores both frames', () => panes().length === 3 && paneShows(0, 'bravo') && paneShows(2, 'delta'))
await chord('1'); await chordArrow('right'); check(focusedPane() === 0, 'right did not focus the adjacent pane')
await chordArrow('down'); check(focusedPane() === 2, 'down did not focus the pane below')
await chordArrow('left'); check(focusedPane() === 1, 'left did not focus the adjacent pane')
const rowBefore = frame('transcript-reader')!, rowDivider = frame('tree-divider:')!
await drag({ x: rowDivider.x + 10, y: rowDivider.y }, { x: rowDivider.x + 10, y: rowDivider.y + 3 }, () => check(!!frame('tree-divider-readout'), 'row divider has no size readout'))
check(frame('transcript-reader')!.height >= rowBefore.height + 2, 'row divider did not resize both rows')
await chord('u')
await chord('1'); await arrange('main-stack')
reader = frame('transcript-reader')!
check(panes().length === 3 && panes().every(pane => pane.x === panes()[0]!.x && pane.x >= reader.x + reader.width), 'focused frame and stack arrangement is wrong')
const stackFirst = frame('split-pane:0')!, stackDivider = frame('tree-divider:1')!
await drag({ x: stackDivider.x + 5, y: stackDivider.y }, { x: stackDivider.x + 5, y: stackDivider.y - 2 })
check(frame('split-pane:0')!.height <= stackFirst.height - 1, 'stack divider did not resize its first pane')
reader = frame('transcript-reader')!
const oldNeighbour = frame('split-pane:1')!, tab = locate('Win bravo', frame('session-tabs')!)
await drag({ x: tab.x + 2, y: tab.y }, { x: reader.x + 2, y: reader.y + Math.floor(reader.height / 2) })
await waitFor('strip tab moves beside the target frame', () => frame('split-pane:0')!.x < frame('transcript-reader')!.x)
check(frame('split-pane:1')!.x === oldNeighbour.x && frame('split-pane:1')!.width === oldNeighbour.width, 'moving a tab rearranged an unrelated column')
const widthBefore = frame('transcript-reader')!.width, mainDivider = frame('tree-divider:')!
await drag({ x: mainDivider.x, y: mainDivider.y + 3 }, { x: mainDivider.x + 12, y: mainDivider.y + 3 }, () => check(!!frame('tree-divider-readout'), 'main divider has no size readout'))
check(frame('transcript-reader')!.width >= widthBefore + 4, 'main divider did not resize its neighbouring frames')
check(!setup.renderer.getSelection()?.getSelectedText?.(), 'divider dragging selected transcript text')
console.log('Grid, focused-frame stack, every shared divider, and strip-tab movement preserve local geometry.')

// Every title control acts on that frame and never promotes its contents.
const count = panes().length, close = frame('split-pane-close:1')!
await click(close.x + 1, close.y)
await waitFor('title close removes its frame', () => panes().length === count - 1)
const zoom = frame('split-pane-promote:0')!
await click(zoom.x + 1, zoom.y)
await waitFor('title zoom fills the workspace', () => panes().length === 1 && frame('split-pane:0')!.width === frame('window-area')!.width)
check(runtime().values.get('selectedSessionKey') === 'claude:win-alpha', 'title zoom replaced the original session')
await chord('m'); await settle(450)
const pane = frame('split-pane:0')!
await click(pane.x + 6, pane.y); await click(pane.x + 6, pane.y)
check(runtime().values.get('windowZoom') === 0, 'double-click did not zoom its own frame')
await chord('m'); await settle(450)
reader = frame('transcript-reader')!
await click(reader.x + 4, reader.y); await click(reader.x + 4, reader.y)
check(runtime().values.get('windowZoom') === 'reader', 'double-click on the original frame behaves differently')
await chord('m')
const bravoTab = locate('Win bravo', frame('session-tabs')!)
await click(bravoTab.x + 2, bravoTab.y)
check(focusedPane() === 0 && readerShows('alpha'), 'clicking a tab replaced another visible frame')
const tabRow = () => setup.captureCharFrame().split('\n')[frame('session-tabs')!.y] ?? ''
const closeTab = async (name: string) => {
  const at = tabRow().indexOf(`Win ${name}`), x = tabRow().indexOf('×', at)
  check(at >= 0 && x > at, `no close control for ${name}`)
  await click(x, frame('session-tabs')!.y)
  await waitFor(`${name} closes from the strip`, () => !tabRow().includes(`Win ${name}`))
}
await closeTab('delta')
check(paneShows(0, 'bravo') && readerShows('alpha'), 'closing another tab changed the surviving views')
await closeTab('alpha')
check(!frame('transcript-reader') && paneShows(0, 'bravo'), 'closing the original tab opened an unrelated session')
const bravo = locate('Win bravo', frame('session-tabs')!)
await act(async () => { await setup.mockMouse.pressDown(bravo.x + 2, bravo.y, 2 as never); await setup.mockMouse.release(bravo.x + 2, bravo.y, 2 as never) }); await settle(100)
const menuClose = locate('Close tab', frame('context-menu')!)
await click(menuClose.x + 1, menuClose.y)
check(!tabRow().includes('Win bravo') && panes().length === 0, 'closing the last visible tab did not leave an empty layout')
console.log('Title controls, double-clicks, strip selection and closing use shared frame semantics.')
console.log('Windowing smoke passed')
act(() => setup.renderer.destroy())
process.exit(0)
