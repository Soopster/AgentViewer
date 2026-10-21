/** @jsxImportSource @opentui/react */
// Window controls exercised through the real App keyboard and mouse dispatch.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-window-tree-'))
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
let promptActive = false
let permissionResponses = 0
const running = () => promptActive ? [{
  sessionId: SESSIONS[0]!.sessionId, provider: 'claude' as const,
  pendingPermissions: [], pendingPrompts: [{ requestId: 'controls-permission', sessionId: SESSIONS[0]!.sessionId,
    toolName: 'Bash', title: 'CONTROLS-PERMISSION', input: { command: 'echo fixture' } }],
}] : []
const marker = (session: Session | string) => `${(typeof session === 'string' ? session : session.sessionId).toUpperCase()}-BODY`
const card = (session: Session): TuiTranscriptCard => ({
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
})
const cardsFor = (session: Session) => [card(session)]
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
  readTuiRuntimeActivity: async () => ({ running: running(), waiting: [], attention: [] }),
  listTuiRunningSessions: async () => running(),
  prewarmTuiSession: async () => {},
  runTuiSessionAction: async (_session: Session, body: Record<string, unknown>) => {
    if (body.action === 'respondPermission') { permissionResponses++; promptActive = false }
    return {}
  },
  streamTuiSessionTurn: async (session: Session, body: Record<string, unknown>) => {
    broadcastSends.push({ session: { ...session }, body })
    return new Response('event: turn-accepted\ndata: {}\n\n')
  },
}))

const store = await import('./spacesStore')
let controller: InstanceType<typeof store.SpacesController> | null = null
mock.module('./spacesStore', () => ({ ...store, SpacesController: class extends store.SpacesController { constructor() { super(); controller = this } } }))
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 220, height: 46, kittyKeyboard: process.env.AV_WINDOW_CONTROLS_LEGACY !== '1' })
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
const rail = () => frame('session-rail')!
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
const paneHas = (index: number, text: string) => {
  // Index 64 is the floating window, whichever kind it holds.
  const pane = frame(index === 64 ? 'floating-window' : `split-pane:${index}`)
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

const key = async (value: string) => { await act(async () => { setup.mockInput.pressKey(value) }); await settle(120) }
const escape = async () => { await act(async () => { setup.mockInput.pressEscape() }); await settle(120) }
const portable = async (value: string) => {
  await act(async () => { setup.mockInput.pressKey('k', { ctrl: true }) }); await settle(40)
  await key(value)
}
const pickLayout = async (name: string) => { await openMenu(); const rect = frame(`window-layout:${name}`)!; await click(rect.x + 2, rect.y + 1) }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
await pickLayout('grid-six')
await waitFor('all session tabs', () => panes().length === 5 && [0, 1, 2, 3, 4].every(index => paneName(index) !== null))
await pickLayout('fill')
await waitFor('reader only', () => panes().length === 0)
await chordKey('%')
await waitFor('first split', () => panes().length === 1)
const reader = frame('transcript-reader')!
const right = frame('split-pane:0')!
await chordKey('"')
await waitFor('local stacked split', () => panes().length === 2)
check(same(frame('transcript-reader'), reader), 'splitting the right pane rearranged the reader')
const top = frame('split-pane:0')!, bottom = frame('split-pane:1')!
check(top.x === right.x && bottom.x === right.x && top.width === right.width && bottom.width === right.width && top.y + top.height === bottom.y && bottom.y + bottom.height === right.y + right.height, 'stacked children do not tile the focused pane')
await chordKey('1'); await chordKey('%')
await waitFor('local horizontal split', () => panes().length === 3)
check(same(frame('transcript-reader'), reader), 'nested horizontal split rearranged the reader')
check(same(frame('split-pane:1'), bottom), 'nested split rearranged the neighbouring bottom pane')
const nested = JSON.stringify([frame('transcript-reader'), ...panes()])
await chordKey('%')
check(panes().length === 3 && JSON.stringify([frame('transcript-reader'), ...panes()]) === nested, `an undersized pane accepted a split or changed geometry: ${panes().length} / ${nested} / ${JSON.stringify([frame('transcript-reader'), ...panes()])}`)
// Mouse resizing owns exactly its branch and is undoable.
const divider = frame('tree-divider:1')!
await act(async () => { await setup.mockMouse.pressDown(divider.x + 2, divider.y) }); await settle(50)
await act(async () => { await setup.mockMouse.emitMouseEvent('drag', divider.x + 2, divider.y + 3) }); await settle(80)
await act(async () => { await setup.mockMouse.release(divider.x + 2, divider.y + 3) }); await settle(180)
check(same(frame('transcript-reader'), reader), 'dragging a nested divider resized the reader')
check(frame('split-pane:1')!.y !== bottom.y, 'nested divider did not move')
await chordKey('u')
check(JSON.stringify([frame('transcript-reader'), ...panes()]) === nested, 'undo did not restore nested divider geometry')
await portable('w'); await key(']'); await key('u'); await escape()
check(JSON.stringify([frame('transcript-reader'), ...panes()]) === nested, 'keyboard resize undo changed a neighbouring branch')
// Zoom retains the exact mounted transcript subtree.
const paneNode = setup.renderer.root.findDescendantById('split-pane:2')!
const content = paneNode.getChildren()[0]
await chordKey('m'); await chordKey('m')
check(setup.renderer.root.findDescendantById('split-pane:2')!.getChildren()[0] === content, 'zoom remounted the pane content')
check(JSON.stringify([frame('transcript-reader'), ...panes()]) === nested, 'zoom changed custom geometry')
// Shrinking hides windows without rewriting the saved logical split tree.
const firstWorkspace = controller!.activeWorkspace()!
const logical = JSON.stringify(controller!.runtime(firstWorkspace).values.get('windowSplitTree'))
await act(async () => { setup.resize(90, 24) }); await settle(250)
check(panes().length < 3, 'small terminal did not hide windows')
check(JSON.stringify(controller!.runtime(firstWorkspace).values.get('windowSplitTree')) === logical, 'terminal resize rewrote logical splits')
await act(async () => { setup.resize(220, 46) }); await settle(250)
check(JSON.stringify([frame('transcript-reader'), ...panes()]) === nested, 'terminal growth did not restore the custom layout')
// Saved layouts preserve custom geometry and preview it accurately.
await openMenu(); await key('n')
await act(async () => { await setup.mockInput.typeText('Nested work') }); await settle(100)
await act(async () => { setup.mockInput.pressEnter() }); await settle(200)
await escape()
const { listSavedWindowLayouts } = await import('./windowLayoutStore')
check(!!listSavedWindowLayouts(CWD)[0]?.splitTree, 'saved layout lost the split tree')
await pickLayout('grid')
await openMenu(); const saved = locate('Nested work'); await click(saved.x + 1, saved.y)
await waitFor('custom layout restored', () => JSON.stringify([frame('transcript-reader'), ...panes()]) === nested)
// Turn a pane into a tab, then find that background tab through the tree.
await chordKey('3'); const tabTitle = paneName(2)!
await chordKey('t')
await portable('o')
await waitFor('workspace overview', () => setup.captureCharFrame().includes('Workspace overview'))
check(setup.captureCharFrame().includes('tab'), 'the overview omitted grouped tabs')
await act(async () => { await setup.mockInput.typeText(`Win ${tabTitle}`) }); await settle(150)
await act(async () => { setup.mockInput.pressEnter() }); await settle(200)
check(!frame('window-switcher'), 'tab selection did not close the overview')
check(setup.captureCharFrame().includes(marker(`win-${tabTitle}`)), 'the chosen background tab did not activate')
// Navigate from a different workspace to a window in the original one.
await act(async () => { controller!.addWorkspace(controller!.activeSpace()!.id) }); await settle(300)
await portable('o')
await act(async () => { await setup.mockInput.typeText('Win bravo') }); await settle(150)
await act(async () => { setup.mockInput.pressEnter() }); await settle(300)
await waitFor('cross-workspace window activation', () => controller!.activeWorkspace()!.id === firstWorkspace.id && !frame('window-switcher'))
check(controller!.runtime(firstWorkspace).values.get('windowOverviewPendingTarget') === null, 'cross-workspace focus request did not resolve')
console.log('Window tree rendered smoke passed (local mixed splits, minimums, mouse/keyboard resize, undo, mounted zoom, responsive restore, saved layouts, tabs, cross-workspace selection)')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
