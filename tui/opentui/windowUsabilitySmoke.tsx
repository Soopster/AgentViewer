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

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-window-usability-'))
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

const key = async (value: string) => { await act(async () => { if (value === 'up' || value === 'down') setup.mockInput.pressArrow(value); else setup.mockInput.pressKey(value) }); await settle(120) }
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

// Close and recover a pane independently of other layout edits.
const workspace = controller!.activeWorkspace()!
const runtime = controller!.runtime(workspace)
const closedName = paneName(1)!
const original = JSON.stringify([frame('transcript-reader'), ...panes()])
await chordKey('x')
await waitFor('pane closed', () => panes().length === 1)
await chordKey('X')
await waitFor('pane reopened', () => panes().length === 2 && paneName(1) === closedName)
check(JSON.stringify([frame('transcript-reader'), ...panes()]) === original, 'reopen lost the original nested position')
await chordKey('u'); await waitFor('reopen undone', () => panes().length === 1)
await chordKey('U'); await waitFor('reopen redone', () => panes().length === 2)
// Previous-pane toggles between two panes, rather than always through the reader.
await chordKey('1'); await chordKey('2'); await chordKey(';')
check(runtime.values.get('splitFocusIndex') === 0, 'previous pane did not return to pane 1')
await chordKey(';'); check(runtime.values.get('splitFocusIndex') === 1, 'previous pane did not toggle back to pane 2')
// The exact preview rectangle is the rectangle committed by an edge drop.
const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, checkPreview?: () => void) => {
  await act(async () => { await setup.mockMouse.pressDown(from.x, from.y) }); await settle(40)
  for (let step = 1; step <= 8; step++) {
    await act(async () => { await setup.mockMouse.emitMouseEvent('drag', Math.round(from.x + (to.x - from.x) * step / 8), Math.round(from.y + (to.y - from.y) * step / 8)) })
  }
  await settle(100); checkPreview?.()
  await act(async () => { await setup.mockMouse.release(to.x, to.y) }); await settle(250)
}
const movingName = paneName(0)!, from = frame('split-pane:0')!, target = frame('split-pane:1')!
let preview: Frame | null = null
await drag({ x: from.x + 5, y: from.y }, { x: target.x + 2, y: target.y + Math.floor(target.height / 2) }, () => {
  preview = frame('window-drop-zone')
  check(preview, 'nested edge drag omitted its preview')
})
const movingIndex = [0, 1].find(index => paneName(index) === movingName)!
check(same(frame(`split-pane:${movingIndex}`), preview), 'edge drop did not match its exact preview')
// Centre drops group the windows as tabs.
const a = frame('split-pane:0')!, b = frame('split-pane:1')!
await drag({ x: a.x + 5, y: a.y }, { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) })
await waitFor('centre drop creates tabs', () => panes().length === 1 && (runtime.values.get('windowStacks') as string[][]).length === 1)
// Move that entire tabbed window using the title menu.
let destination: typeof workspace | null = null
await act(async () => { destination = controller!.addWorkspace(controller!.activeSpace()!.id) }); await settle(300)
await act(async () => { controller!.rename(destination!.id, 'Destination'); controller!.activate(controller!.activeSpace()!.id, workspace.id) }); await settle(400)
await chordKey('1'); await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) }); await settle(60); await act(async () => { setup.mockInput.pressEnter() }); await settle(200)
await waitFor('pane menu', () => !!frame('context-menu'))
const moveAction = locate('Move to workspace…'); await click(moveAction.x + 2, moveAction.y)
await waitFor('destination picker', () => setup.captureCharFrame().includes('/ Destination'))
const option = locate('/ Destination'); await click(option.x + 2, option.y)
await waitFor('window moved', () => controller!.activeWorkspace()!.id === destination!.id && panes().length === 1)
check((runtime.values.get('splitPinnedKeys') as string[]).length === 0, 'source kept the moved pane')
const destinationRuntime = controller!.runtime(destination!)
check((destinationRuntime.values.get('windowStacks') as string[][]).length === 1, 'move lost the window tabs')
// Recent windows crosses workspace boundaries.
await chordKey('L'); await waitFor('recent picker', () => setup.captureCharFrame().includes('Recent windows'))
check(setup.captureCharFrame().includes('Win alpha'), 'recent windows lost the original workspace reader')
await escape()
// The overview also exposes moving an individual background tab.
await portable('o')
await act(async () => { await setup.mockInput.typeText(`Win ${movingName}`) }); await settle(150)
await act(async () => { setup.mockInput.pressArrow('down') }); await settle(80)
// Search includes its ancestors; navigate to the matching tab row explicitly.
const nodes = (await import('./workspaceOverviewData')).overviewRows((await import('./workspaceOverviewData')).workspaceOverview(controller!), new Set(), `Win ${movingName}`)
const tabIndex = nodes.findIndex(node => node.id.includes(':tab:') && node.title.includes(movingName))
check(tabIndex >= 0, 'moved tab missing from overview')
for (let i = 0; i < nodes.length + 1; i++) await key('up')
for (let i = 0; i < tabIndex; i++) await key('down')
await act(async () => { setup.mockInput.pressKey('w', { ctrl: true }) }); await settle(200)
check(setup.captureCharFrame().includes('Move to workspace…'), 'overview move shortcut did not open the picker')
await act(async () => { setup.mockInput.pressEnter() }); await settle(350)
await waitFor('single tab moved back', () => controller!.activeWorkspace()!.id === workspace.id && panes().length === 1)
check((destinationRuntime.values.get('windowStacks') as string[][]).length === 0, 'moving a tab retained a stale group')
check((runtime.values.get('splitPinnedKeys') as string[]).length === 1, 'moving one tab moved the entire group')
// A floating window also docks into a nested edge using the exact preview.
await chordKey('1'); await chordKey('f')
await waitFor('pane floated', () => !!frame('floating-window') && panes().length === 0)
const floating = frame('floating-window')!, readerTarget = frame('transcript-reader')!
let floatPreview: Frame | null = null
await drag({ x: floating.x + 5, y: floating.y }, { x: readerTarget.x + Math.floor(readerTarget.width / 2), y: readerTarget.y + readerTarget.height - 2 }, () => { floatPreview = frame('float-dock-zone') })
await waitFor('floating pane split-docked', () => !frame('floating-window') && panes().length === 1)
check(same(frame('split-pane:0'), floatPreview), 'floating drop did not match its preview')
// Closing a terminal view keeps its process and reopens the same selection.
const terminalKey = 'surface:terminal'
await act(async () => { runtime.set('windowSurfaces', ['terminal']); runtime.set('windowOrder', [...(runtime.values.get('windowOrder') as string[]), terminalKey]) }); await settle(400)
const terminalIndex = (runtime.values.get('windowOrder') as string[]).indexOf(terminalKey)
await chordKey(String(terminalIndex + 1))
await waitFor('terminal window', () => !!frame('surface-window:terminal') || setup.captureCharFrame().includes('Terminal'))
await chordKey('x')
await waitFor('terminal closed', () => !(runtime.values.get('windowSurfaces') as string[]).includes('terminal'))
await chordKey('X')
await waitFor('terminal reopened', () => (runtime.values.get('windowSurfaces') as string[]).includes('terminal'))
console.log('Window usability rendered smoke passed (reopen, redo, previous pane, exact drag preview, centre tabs, workspace moves, recent windows, overview move, floating edge drop, terminal reopen)')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
