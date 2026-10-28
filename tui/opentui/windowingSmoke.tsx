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
// Every session is in a window; the one showing the selected session is what
// this smoke calls the reader, and `panes()` are the windows beside it.
const windowFrames = () => Array.from({ length: 31 }, (_, index) => { const box = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as (Frame & { visible?: boolean }) | null; return box && box.visible !== false ? { x: box.x, y: box.y, width: box.width, height: box.height } : null })
const isReaderWindow = (box: Frame) => { const reader = frame('transcript-reader'); return !!reader && reader.x >= box.x && reader.y >= box.y && reader.x + reader.width <= box.x + box.width && reader.y + reader.height <= box.y + box.height }
const panes = () => windowFrames().filter((box): box is Frame => box !== null && !isReaderWindow(box))
// Pane i is the i-th window, in window order, that is not the reader's.
const paneWindows = () => windowFrames().map((box, index) => ({ box, index })).filter((entry) => entry.box !== null && !isReaderWindow(entry.box)).map((entry) => entry.index)
const paneIndex = (i: number) => paneWindows()[i] ?? -1
const paneFrame = (i: number) => frame(`split-pane:${paneIndex(i)}`)
const windowCount = () => windowFrames().filter((box) => box !== null).length
// The window showing a session, whichever it is.
const windowWith = (name: string) => windowFrames().find((box): box is Frame => box !== null
  && setup.captureCharFrame().split('\n').slice(box.y, box.y + box.height).some((line) => line.slice(box.x, box.x + box.width).includes(marker(`win-${name}`)))) ?? null
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
const focusedPane = (): number | null => { const focus = runtime().values.get('splitFocusIndex') as number | null; return focus === null ? null : paneWindows().indexOf(focus) }
// pressKey types its argument literally ("right" would be ⌃B r, rotate); arrows have their own call.
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
check(panes().length === 0 && (runtime().values.get('windowPresentation') as { mode?: string } | null)?.mode === 'zoom', 'Fill did not zoom the focused frame')
check(JSON.stringify(runtime().values.get('windowSplitTree')) === logicalBeforeFill, 'Fill discarded the other views')
await chord('m')
for (let count = 3; count > 0; count--) { await chord('2'); await chord('x') }
await chord('1')
check(panes().length === 0 && readerShows('alpha'), 'closing neighbours replaced the original session')

// Splits are local to the target frame and may mix axes.
// A drop focuses the new window, and focus is the selection, so the frame
// dropped on is found by the session it shows.
for (const [name, edge] of [['bravo', 'right'], ['charlie', 'left'], ['delta', 'bottom']] as const) {
  const row = railRow(name), target = windowWith('alpha')!
  const point = edge === 'right' ? { x: target.x + target.width - 3, y: target.y + Math.floor(target.height / 2) }
    : edge === 'left' ? { x: target.x + 2, y: target.y + Math.floor(target.height / 2) }
    : { x: target.x + Math.floor(target.width / 2), y: target.y + target.height - 2 }
  const count = windowCount()
  await drag({ x: row.x + 1, y: row.y }, point, () => check(setup.captureCharFrame().includes('Split here'), 'valid split has no drag feedback'))
  await waitFor(`${name} split ${edge}`, () => windowCount() === count + 1 && !!windowWith(name))
  const pane = windowWith(name)!, original = windowWith('alpha')!
  check(edge === 'right' ? pane.x >= original.x + original.width : edge === 'left' ? pane.x + pane.width <= original.x : pane.y >= original.y + original.height, 'split landed on the wrong side')
}
console.log('Rail drops create local mixed-axis splits without replacing neighbouring sessions.')
await chord('1'); await arrange('grid')
let reader = frame('transcript-reader')!, area = frame('window-area')!
const [topRight, bottomLeft, bottomRight] = panes() as [Frame, Frame, Frame]
check(topRight.y === reader.y && topRight.x > reader.x && bottomLeft.y >= reader.y + reader.height && bottomRight.y === bottomLeft.y, 'grid is not two by two')
check(bottomRight.x + bottomRight.width <= area.x + area.width, 'grid exceeds the window area')
const moving = paneFrame(0)!, target = paneFrame(2)!
await drag({ x: moving.x + 4, y: moving.y }, { x: target.x + Math.floor(target.width / 2), y: target.y + Math.floor(target.height / 2) })
await waitFor('centre drop groups tabs', () => !!frame('window-tab:claude:win-bravo') && !!frame('window-tab:claude:win-delta'))
await chord('u')
await waitFor('undo restores both frames', () => windowCount() === 4 && !!windowWith('bravo') && !!windowWith('delta')
  && windowWith('bravo')!.x > windowWith('alpha')!.x && windowWith('delta')!.y > windowWith('bravo')!.y)
// Focus is the selection: the focused window is the selected session's.
const focusedSession = () => runtime().values.get('selectedSessionKey')
await chord('1'); await chordArrow('right'); check(focusedSession() === 'claude:win-bravo', 'right did not focus the adjacent pane')
await chordArrow('down'); check(focusedSession() === 'claude:win-delta', 'down did not focus the pane below')
await chordArrow('left'); check(focusedSession() === 'claude:win-charlie', 'left did not focus the adjacent pane')
const rowBefore = windowWith('alpha')!, rowDivider = frame('tree-divider:')!
await drag({ x: rowDivider.x + 10, y: rowDivider.y }, { x: rowDivider.x + 10, y: rowDivider.y + 3 }, () => check(!!frame('tree-divider-readout'), 'row divider has no size readout'))
check(windowWith('alpha')!.height >= rowBefore.height + 2, 'row divider did not resize both rows')
await chord('u')
await chord('1'); await arrange('main-stack')
reader = frame('transcript-reader')!
check(panes().length === 3 && panes().every(pane => pane.x === panes()[0]!.x && pane.x >= reader.x + reader.width), 'focused frame and stack arrangement is wrong')
const stackFirst = paneFrame(0)!, stackDivider = frame('tree-divider:1')!
await drag({ x: stackDivider.x + 5, y: stackDivider.y }, { x: stackDivider.x + 5, y: stackDivider.y - 2 })
check(paneFrame(0)!.height <= stackFirst.height - 1, 'stack divider did not resize its first pane')
reader = windowWith('alpha')!
const oldNeighbour = windowWith('charlie')!, tab = locate('Win bravo', frame('session-tabs')!)
await drag({ x: tab.x + 2, y: tab.y }, { x: reader.x + 2, y: reader.y + Math.floor(reader.height / 2) })
await waitFor('strip tab moves beside the target frame', () => windowWith('bravo')!.x < windowWith('alpha')!.x)
check(windowWith('charlie')!.x === oldNeighbour.x && windowWith('charlie')!.width === oldNeighbour.width, 'moving a tab rearranged an unrelated column')
const widthBefore = windowWith('alpha')!.width, mainDivider = frame('tree-divider:')!
await drag({ x: mainDivider.x, y: mainDivider.y + 3 }, { x: mainDivider.x + 12, y: mainDivider.y + 3 }, () => check(!!frame('tree-divider-readout'), 'main divider has no size readout'))
check(windowWith('alpha')!.width >= widthBefore + 4, 'main divider did not resize its neighbouring frames')
check(!setup.renderer.getSelection()?.getSelectedText?.(), 'divider dragging selected transcript text')
console.log('Grid, focused-frame stack, every shared divider, and strip-tab movement preserve local geometry.')

// Every title control acts on that frame and never promotes its contents. A
// click on a window focuses it, and focus is the selection.
const sameFrame = (a: Frame | null, b: Frame | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
const nameOf = (box: Frame) => ['alpha', 'bravo', 'charlie', 'delta'].find((name) => sameFrame(windowWith(name), box)) ?? null
const count = windowCount(), closing = paneFrame(1)!, closingName = nameOf(closing)!
const close = frame(`split-pane-close:${paneIndex(1)}`)!
await click(close.x + 1, close.y)
await waitFor('title close removes its frame', () => windowCount() === count - 1 && !windowWith(closingName))
const zoomedName = nameOf(paneFrame(0)!)!
const zoom = frame(`split-pane-promote:${paneIndex(0)}`)!
await click(zoom.x + 1, zoom.y)
await waitFor('title zoom fills the workspace', () => windowCount() === 1 && windowWith(zoomedName)?.width === frame('window-area')!.width)
await chord('m'); await settle(450)
check(windowCount() === count - 1 && !!windowWith('alpha'), 'title zoom replaced another session')
const pane = paneFrame(0)!, zoomedPaneIndex = paneIndex(0)
await click(pane.x + 6, pane.y); await click(pane.x + 6, pane.y)
check((runtime().values.get('windowPresentation') as { target?: string } | null)?.target === (runtime().values.get('windowOrder') as string[])[zoomedPaneIndex], 'double-click did not zoom its own frame')
await chord('m'); await settle(450)
reader = frame('transcript-reader')!
await click(reader.x + 4, reader.y); await click(reader.x + 4, reader.y)
// The selected session's window zooms like any other: by its index.
check((runtime().values.get('windowPresentation') as { mode?: string } | null)?.mode === 'zoom', 'double-click on the original frame behaves differently')
await chord('m')
const bravoTab = locate('Win bravo', frame('session-tabs')!)
const bravoBefore = windowWith('bravo')!
await click(bravoTab.x + 2, bravoTab.y)
check(runtime().values.get('selectedSessionKey') === 'claude:win-bravo' && sameFrame(windowWith('bravo'), bravoBefore) && !!windowWith('alpha'),
  'clicking a tab replaced another visible frame instead of focusing its own')
const tabRow = () => setup.captureCharFrame().split('\n')[frame('session-tabs')!.y] ?? ''
const closeTab = async (name: string) => {
  const at = tabRow().indexOf(`Win ${name}`), x = tabRow().indexOf('×', at)
  check(at >= 0 && x > at, `no close control for ${name}`)
  await click(x, frame('session-tabs')!.y)
  await waitFor(`${name} closes from the strip`, () => !tabRow().includes(`Win ${name}`))
}
await closeTab('delta')
check(!!windowWith('bravo') && !!windowWith('alpha'), 'closing another tab changed the surviving views')
await closeTab('alpha')
check(!windowWith('alpha') && !!windowWith('bravo') && windowCount() === 1, 'closing the original tab opened an unrelated session')
const bravo = locate('Win bravo', frame('session-tabs')!)
await act(async () => { await setup.mockMouse.pressDown(bravo.x + 2, bravo.y, 2 as never); await setup.mockMouse.release(bravo.x + 2, bravo.y, 2 as never) }); await settle(100)
const menuClose = locate('Close tab', frame('context-menu')!)
await click(menuClose.x + 1, menuClose.y)
check(!tabRow().includes('Win bravo') && windowCount() === 0, 'closing the last visible tab did not leave an empty layout')
console.log('Title controls, double-clicks, strip selection and closing use shared frame semantics.')
console.log('Windowing smoke passed')
act(() => setup.renderer.destroy())
process.exit(0)
