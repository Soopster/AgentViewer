/** @jsxImportSource @opentui/react */
// Window controls exercised through the real App keyboard and mouse dispatch.
import React from 'react'
import type { SurfacePanelState } from './surfacePanelState'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-window-audit-'))
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
const { readAllScreenText } = await import('../../plugins/terminal/tui/shellScreen')
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
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) }); await settle(60)
  await act(async () => { setup.mockInput.pressKey('w') }); await settle(150)
  await waitFor('layout picker', () => !!frame('window-layout:grid'))
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


const workspace = controller!.activeWorkspace()!, runtime = controller!.runtime(workspace)
const { surfaceViewNamespace } = await import('./windowViewState')
const { activeSurface, openSurface } = await import('./surfacePanelState')
const { arrangePaneTree } = await import('./windowSplitTree')
await act(async () => {
  setup.resize(360, 54)
  runtime.set('openTabSessions', SESSIONS)
  runtime.set('surfacePanelWidth', 112)
  runtime.set('windowSurfaces', ['browser', 'terminal'])
  const windows = ['claude:win-alpha', 'surface:browser', 'surface:terminal']
  runtime.set('splitPinnedKeys', ['claude:win-alpha'])
  runtime.set('splitPaneCount', 1)
  runtime.set('windowOrder', windows)
  runtime.set('windowSplitTree', arrangePaneTree(windows, false, 'columns'))
}); await settle(350)
const field = (kind: string, id: string | undefined, panelId: string | undefined, key: string) => `${surfaceViewNamespace(kind, id, panelId)}:${key}`
const draft = (id?: string, panelId?: string) => runtime.values.get(field('browser', id, panelId, 'browser:draft'))
const menuAction = async (id: string, label: string) => {
  const button = frame(`surface-window-menu:${id}`)!
  check(button, `no menu for ${id}`)
  await click(button.x + 1, button.y)
  const action = locate(label, frame('context-menu')!)
  await click(action.x + 2, action.y)
}
const toWindow = async () => {
  const button = locate('⧉ window', frame('surface-panel-frame')!)
  await click(button.x + 2, button.y)
}
await chordKey('2')
await act(async () => { await setup.mockInput.typeText('http://first.local/draft') }); await settle(120)
check(draft('browser') === 'http://first.local/draft', 'browser did not receive its draft')
const closedBefore = (runtime.values.get('closedWindows') as unknown[] | undefined)?.length ?? 0
await menuAction('browser', 'Move to side panel')
const panel1 = activeSurface(runtime.values.get('surfacePanel') as SurfacePanelState)!
check(draft(undefined, panel1.id) === 'http://first.local/draft', 'window-to-panel lost browser input')
check(((runtime.values.get('closedWindows') as unknown[])?.length ?? 0) === closedBefore, 'moving a pane recorded a closure')
await act(async () => { runtime.set<SurfacePanelState>('surfacePanel', state => openSurface(state, 'browser')) }); await settle(200)
const panel2 = activeSurface(runtime.values.get('surfacePanel') as SurfacePanelState)!
check(panel1.id !== panel2.id && draft(undefined, panel2.id) === '', 'panel instances share the same input')
await act(async () => { await setup.mockInput.typeText('http://second.local/draft') }); await settle(120)
check(draft(undefined, panel1.id) === 'http://first.local/draft', 'typing in the second panel changed the first')
await toWindow()
check(draft('browser') === 'http://second.local/draft', 'panel-to-window lost browser input')
check((runtime.values.get('surfacePanel') as { surfaces: unknown[] }).surfaces.length === 1, 'moving one panel closed its sibling')
await act(async () => { runtime.set('surfacePanel', (state: { surfaces: unknown[] }) => ({ ...state, activeId: panel1.id })); runtime.set('surfacePanelOpen', true) }); await settle(200)
await toWindow()
check(draft('browser#2') === 'http://first.local/draft', 'moving into an occupied kind reused the wrong view')
await act(async () => { runtime.set(field('browser', 'browser#2', undefined, 'browser:draft'), 'edited after relocation') }); await settle(120)
await chordKey('u')
check(draft(undefined, panel1.id) === 'edited after relocation', 'undo lost edits made after relocation')
await chordKey('U')
check(draft('browser#2') === 'edited after relocation', 'redo lost the relocated view state')
// Floating views are part of a saved working set, including their geometry.
await chordKey('4'); await chordKey('f')
await waitFor('browser floats', () => !!frame('floating-window'))
const floating = runtime.values.get('floatingWindow') as { key: string; rect: Frame }
await openMenu(); await key('n')
await act(async () => { await setup.mockInput.typeText('With floating browser') }); await settle(100)
await act(async () => { setup.mockInput.pressEnter() }); await settle(150)
await escape()
const saved = (await import('./windowLayoutStore')).listSavedWindowLayouts(CWD)[0]!
check(saved.floating?.key === floating.key, 'saving omitted the floating browser')
await chordKey('x'); await waitFor('float closed', () => !frame('floating-window'))
await openMenu(); const row = locate('With floating browser'); await click(row.x + 2, row.y)
await waitFor('floating view restored', () => !!frame('floating-window'))
check((runtime.values.get('floatingWindow') as { key: string }).key === floating.key, 'restore changed the floating identity')
check(draft('browser#2') === 'edited after relocation', 'saved layout changed the browser draft')
// A terminal move preserves the selected live shell rather than showing the first shell.
const { startShell, writeShell } = await import('./shellStore')
let shell1 = '', shell2 = ''
await act(async () => {
  shell1 = await startShell({ cwd: CWD, ownerId: workspace.id, cols: 70, rows: 18 })
  shell2 = await startShell({ cwd: CWD, ownerId: workspace.id, cols: 70, rows: 18 })
  writeShell(shell1, "echo FIRST_SHELL_ONLY\r"); writeShell(shell2, "echo SELECTED_SHELL_KEPT\r")
  runtime.set(field('terminal', 'terminal', undefined, 'process:selectedId'), shell2)
}); await settle(350)
await menuAction('terminal', 'Move to side panel')
const terminalPanel = activeSurface(runtime.values.get('surfacePanel') as SurfacePanelState)!
check(runtime.values.get(field('terminal', undefined, terminalPanel.id, 'process:selectedId')) === shell2, 'terminal relocation changed the selected shell')
await waitFor('selected shell remains visible', () => setup.captureCharFrame().includes('SELECTED_SHELL_KEPT'))
await toWindow()
check(runtime.values.get(field('terminal', 'terminal', undefined, 'process:selectedId')) === shell2, 'returning terminal to a window changed its shell')
// Restoring a missing original session must not substitute the current session.
const { saveWindowLayout } = await import('./windowLayoutStore')
saveWindowLayout(CWD, { ...saved, primaryOpen: true, reader: 'claude:deleted-session', panes: ['claude:win-bravo'], surfaces: [], stacks: [], popoverTabs: [], activePopoverTab: null, floating: null, order: ['claude:win-bravo'], splitTree: arrangePaneTree(['claude:win-bravo'], true, 'columns')! }, 'Missing original session')
await openMenu(); const missingRow = locate('Missing original session'); await click(missingRow.x + 2, missingRow.y)
await waitFor('missing-session layout restored', () => (runtime.values.get('windowOrder') as string[] | undefined)?.join(',') === 'claude:win-bravo')
check(!setup.captureCharFrame().includes(marker('win-alpha')), 'missing original session displayed an unrelated transcript')
check(frame('split-pane:0'), 'missing original session removed the surviving pane')
check(runtime.values.get('splitFocusIndex') === 0, 'missing-session recovery left the surviving pane unfocused')
await act(async () => { runtime.set('workspaceHasSession', false); runtime.set('splitFocusIndex', 0) }); await settle(150)
await chordKey('w')
await waitFor('layout picker without original frame', () => !!frame('window-layout:save'))
const originalRow = locate('With floating browser'); await click(originalRow.x + 2, originalRow.y)
await waitFor('known original session restored', () => setup.captureCharFrame().includes(marker('win-alpha')))
check(runtime.values.get('workspaceHasSession') === true, 'restore left its known session inactive')
// Ordinary surface panes retain a focus target when their focused neighbour closes.
await act(async () => {
  runtime.set('floatingWindow', null); runtime.set('windowStacks', []); runtime.set('windowPresentation', null)
  runtime.set('splitPinnedKeys', []); runtime.set('splitPaneCount', 0)
  runtime.set('windowSurfaces', ['browser', 'browser#2', 'browser#3'])
  runtime.set('windowOrder', ['surface:browser', 'surface:browser#2', 'surface:browser#3'])
  runtime.set('windowSplitTree', arrangePaneTree(['surface:browser', 'surface:browser#2', 'surface:browser#3'], false, 'columns'))
  runtime.set('surfacePanelOpen', false); runtime.set('splitFocusIndex', 1)
}); await settle(250)
await chordKey('x')
check(runtime.values.get('splitFocusIndex') === 1, 'closing the focused surface lost neighbour focus')
check((runtime.values.get('windowSurfaces') as string[]).join(',') === 'browser,browser#3', 'closing the focused surface removed another view')
await act(async () => { setup.resize(90, 24) }); await settle(250)
await menuAction('browser', 'Open another Browser window')
await waitFor('overflowed browser revealed', () => runtime.values.get('splitFocusIndex') === -1)
check(runtime.values.get('splitFocusIndex') === -1, 'overflowed browser did not take input focus')
check(frame('surface-frame:browser#2')!.width === frame('window-area')!.width, 'overflowed browser has no full-size frame')
await escape()
check(runtime.values.get('splitFocusIndex') !== -1, 'Escape did not return from the overflowed browser')
await act(async () => { setup.resize(360, 54) }); await settle(200)
await chordKey('1'); await chordKey('m')
const zoomedBrowser = setup.renderer.root.findDescendantById('surface-frame:browser')
await act(async () => { setup.resize(70, 18) }); await settle(250)
check((runtime.values.get('windowPresentation') as { target?: string } | null)?.target === 'surface:browser', 'shrinking the terminal cancelled tool-pane zoom')
check(frame('surface-frame:browser')!.width === frame('window-area')!.width, 'zoomed browser no longer fills the narrow workspace')
check(setup.renderer.root.findDescendantById('surface-frame:browser') === zoomedBrowser, 'resizing a zoomed surface remounted it')
await act(async () => { setup.resize(360, 54) }); await settle(200)
check((runtime.values.get('windowPresentation') as { target?: string } | null)?.target === 'surface:browser', 'growing the terminal cancelled tool-pane zoom')
await chordKey('m')
check(runtime.values.get('windowPresentation') == null, 'restoring the layout did not finish zoom')
for (const legacy of [false, true]) {
  const keys = SESSIONS.slice(0, 3).map(session => `${session.provider}:${session.sessionId}`)
  await act(async () => {
    runtime.set('workspaceHasSession', true)
    runtime.set('windowSurfaces', []); runtime.set('windowOrder', keys)
    runtime.set('splitPinnedKeys', keys); runtime.set('splitPaneCount', keys.length)
    runtime.set('splitArrangement', 'grid')
    runtime.set('windowSplitTree', legacy ? null : arrangePaneTree(keys, false, 'columns'))
    runtime.set('splitFocusIndex', 1)
  }); await settle(200)
  await chordKey('m')
  await act(async () => { setup.resize(70, 18) }); await settle(250)
  check((runtime.values.get('windowPresentation') as { target?: string } | null)?.target === keys[1], `${legacy ? 'legacy' : 'nested'} session zoom was cancelled by resizing`)
  check(frame('split-pane:1')!.width === frame('window-area')!.width, 'zoomed session does not fill the narrow workspace')
  await act(async () => { setup.resize(360, 54) }); await settle(200)
  await chordKey('m')
}
await act(async () => {
  runtime.set('splitPinnedKeys', []); runtime.set('splitPaneCount', 0)
  runtime.set('windowSurfaces', ['browser']); runtime.set('windowOrder', ['surface:browser'])
  runtime.set('windowStacks', [['surface:browser', 'surface:browser#2']])
  runtime.set('windowSplitTree', arrangePaneTree(['surface:browser'], false, 'columns'))
  runtime.set('floatingWindow', null); runtime.set('splitFocusIndex', 0)
  setup.resize(90, 18)
}); await settle(200)
await chordKey('1'); await chordKey('!')
check((runtime.values.get('floatingWindow') as { key: string } | null)?.key === 'surface:browser', 'detaching a cramped tab did not float it')
check((runtime.values.get('windowSurfaces') as string[]).join(',') === 'browser#2', 'detaching a cramped tab lost its sibling')
check(frame('floating-window'), 'detached tab has no visible floating frame')
await chordKey('u')
check(runtime.values.get('floatingWindow') == null, 'undo did not restore the tab group')
await act(async () => { setup.resize(360, 54) }); await settle(200)
await chordKey('1'); await chordKey('!')
check(runtime.values.get('floatingWindow') == null, 'detaching with enough room unnecessarily floated the tab')
check((runtime.values.get('windowSurfaces') as string[]).length === 2 && !frame('window-overflow'), 'detaching a tab hid a surviving pane')
await act(async () => {
  runtime.set('popoverTabs', ['browser']); runtime.set('activePopoverTab', 'browser')
  runtime.set('windowSurfaces', ['terminal']); runtime.set('windowOrder', ['surface:terminal']); runtime.set('windowStacks', [])
  runtime.set('windowSplitTree', arrangePaneTree(['surface:terminal'], true, 'columns'))
  runtime.set('splitFocusIndex', null)
  runtime.set(field('browser', 'browser', undefined, 'browser:draft'), 'root-tool-draft')
}); await settle(250)
const fromTool = frame('surface-frame:terminal')!, rootTool = frame('popover-tab-frame')!
await act(async () => { await setup.mockMouse.pressDown(fromTool.x + 4, fromTool.y) }); await settle(40)
const drop = { x: rootTool.x + Math.floor(rootTool.width / 2), y: rootTool.y + Math.floor(rootTool.height / 2) }
for (let step = 1; step <= 8; step++) await act(async () => {
  await setup.mockMouse.emitMouseEvent('drag', Math.round(fromTool.x + 4 + (drop.x - fromTool.x - 4) * step / 8), Math.round(fromTool.y + (drop.y - fromTool.y) * step / 8))
})
await settle(80)
check(setup.captureCharFrame().includes('Add as a tab of window 1'), 'a tool in the original frame describes a different drop action')
await act(async () => { await setup.mockMouse.release(drop.x, drop.y) }); await settle(200)
check(!frame('popover-tab-frame') && frame('window-tab:surface:browser') && frame('window-tab:surface:terminal'), 'a tool in the original frame cannot join the shared tab model')
check(draft('browser') === 'root-tool-draft', 'tabbing the original tool lost its draft')
await chordKey('u')
check(frame('popover-tab-frame') && draft('browser') === 'root-tool-draft', 'undo did not restore the original tool and its state')
const sourceRootTool = frame('popover-tab-frame')!, targetTool = frame('surface-frame:terminal')!
await act(async () => { await setup.mockMouse.pressDown(sourceRootTool.x + 4, sourceRootTool.y) }); await settle(40)
const toolDrop = { x: targetTool.x + Math.floor(targetTool.width / 2), y: targetTool.y + Math.floor(targetTool.height / 2) }
for (let step = 1; step <= 8; step++) await act(async () => {
  await setup.mockMouse.emitMouseEvent('drag', Math.round(sourceRootTool.x + 4 + (toolDrop.x - sourceRootTool.x - 4) * step / 8), Math.round(sourceRootTool.y + (toolDrop.y - sourceRootTool.y) * step / 8))
})
await act(async () => { await setup.mockMouse.release(toolDrop.x, toolDrop.y) }); await settle(200)
check(!frame('popover-tab-frame') && frame('window-tab:surface:browser') && frame('window-tab:surface:terminal'), 'the original tool title cannot drag into a peer frame')
await chordKey('u')
check(frame('popover-tab-frame') && draft('browser') === 'root-tool-draft', 'undo did not restore a tool dragged out of the original frame')
const rootTitle = frame('popover-tab-frame')!
await rightClick(rootTitle.x + 4, rootTitle.y)
check(frame('context-menu'), 'the original tool title has no pane context menu')
await escape(); await settle(450)
await act(async () => { await setup.mockMouse.click(rootTitle.x + 4, rootTitle.y) }); await settle(20)
await act(async () => { await setup.mockMouse.click(rootTitle.x + 4, rootTitle.y) }); await settle(120)
check((runtime.values.get('windowPresentation') as { target?: string } | null)?.target === 'surface:browser' && frame('popover-tab-frame')!.width === frame('window-area')!.width, `double-clicking the original tool title does not fill its frame: ${runtime.values.get('windowZoom')} / ${frame('popover-tab-frame')!.width} / ${frame('window-area')!.width}`)
await chordKey('m'); await settle(450)
const peerTitle = frame('surface-frame:terminal')!
await act(async () => { await setup.mockMouse.click(peerTitle.x + 4, peerTitle.y) }); await settle(20)
await act(async () => { await setup.mockMouse.click(peerTitle.x + 4, peerTitle.y) }); await settle(120)
check((runtime.values.get('windowPresentation') as { target?: string } | null)?.target === 'surface:terminal' && frame('surface-frame:terminal')!.width === frame('window-area')!.width, 'double-clicking a peer tool title does not fill its frame')
await chordKey('m')
// Presentation uses the existing surface frame and preserves the working layout.
await act(async () => {
  runtime.set('activePopoverTab', null); runtime.set('popoverTabs', [])
  runtime.set('floatingWindow', null); runtime.set('windowStacks', [])
  runtime.set('windowSurfaces', ['browser', 'browser#2'])
  runtime.set('windowOrder', ['surface:browser', 'surface:browser#2'])
  runtime.set('splitPinnedKeys', []); runtime.set('splitPaneCount', 0)
  runtime.set('windowSplitTree', arrangePaneTree(['surface:browser', 'surface:browser#2'], false, 'columns'))
  runtime.set('splitFocusIndex', 0); runtime.set('composerActive', false)
}); await settle(250)
const presentation = () => runtime.values.get('windowPresentation') as { mode: string; target: string } | null
const browserInstance = setup.renderer.root.findDescendantById('surface-frame:browser')
const originalTree = JSON.stringify(runtime.values.get('windowSplitTree'))
await chordKey('m')
check(presentation()?.target === 'surface:browser', 'zoom did not target focused browser')
await chordKey('w'); await key('f')
check(presentation()?.mode === 'fullscreen' && presentation()?.target === 'surface:browser', 'zoom to fullscreen changed target')
check(setup.renderer.root.findDescendantById('surface-frame:browser') === browserInstance, 'fullscreen remounted the browser')
check(frame('surface-frame:browser')?.width === 360, 'fullscreen browser does not fill terminal width')
check(frame('presentation-restore'), 'fullscreen has no restore control')
await act(async () => {
  const reversed = ['surface:browser#2', 'surface:browser']
  runtime.set('windowOrder', reversed)
  runtime.set('windowSplitTree', arrangePaneTree(reversed, false, 'columns'))
}); await settle(150)
check(presentation()?.target === 'surface:browser' && runtime.values.get('splitFocusIndex') === 1, 'reordering redirected fullscreen to another window')
check(setup.renderer.root.findDescendantById('surface-frame:browser') === browserInstance, 'reordering fullscreen remounted the browser')
await act(async () => {
  const original = ['surface:browser', 'surface:browser#2']
  runtime.set('windowOrder', original)
  runtime.set('windowSplitTree', arrangePaneTree(original, false, 'columns'))
}); await settle(150)

await chordKey('2')
check(presentation()?.mode === 'fullscreen' && presentation()?.target === 'surface:browser#2', 'switching windows dropped fullscreen')
await chordKey('m')
check(!presentation() && runtime.values.get('splitFocusIndex') === 0, 'restore did not return original focus')
check(JSON.stringify(runtime.values.get('windowSplitTree')) === originalTree, 'presentation changed the split tree')
await chordKey('f'); await settle(150)
const floatBefore = JSON.stringify(runtime.values.get('floatingWindow'))
const floatingInstance = setup.renderer.root.findDescendantById('surface-frame:browser')
await chordKey('m')
check(presentation()?.target === 'surface:browser', 'floating browser could not zoom')
await chordKey('w'); await key('f')
check(presentation()?.mode === 'fullscreen', 'floating browser could not enter fullscreen')
check(setup.renderer.root.findDescendantById('surface-frame:browser') === floatingInstance, 'floating fullscreen remounted browser')
check(setup.captureCharFrame().includes('FULLSCREEN'), 'floating fullscreen hides the restore control')
const restoreButton = frame('presentation-restore')!
await click(restoreButton.x + 2, restoreButton.y)
check(!presentation(), 'floating fullscreen restore button is not clickable')
check(JSON.stringify(runtime.values.get('floatingWindow')) === floatBefore, 'restore changed floating geometry')
await chordKey('m'); await chordKey('x')
check(!presentation(), 'closing presentation target did not restore layout')
await act(async () => {
  runtime.set('windowSurfaces', ['editor'])
  runtime.set('windowSurfaceMeta', { editor: { cwd: CWD, path: path.join(CWD, 'README.md') } })
  runtime.set('windowOrder', ['surface:editor'])
  runtime.set('windowSplitTree', arrangePaneTree(['surface:editor'], false, 'columns'))
  runtime.set('splitFocusIndex', 0)
}); await settle(250)
const editorInstance = setup.renderer.root.findDescendantById('surface-frame:editor')
check(editorInstance, 'editor window did not mount')
await chordKey('m'); await chordKey('w'); await key('f')
check(presentation()?.target === 'surface:editor' && presentation()?.mode === 'fullscreen', 'capturing editor could not enter fullscreen through chords')
check(setup.renderer.root.findDescendantById('surface-frame:editor') === editorInstance, 'fullscreen remounted editor')
await chordKey('m')
check(!presentation(), 'capturing editor could not restore through chords')

console.log('Windowing audit rendered smoke passed (independent view state, relocation, floating layouts, live shells, recovery, focus, overflow reveal, responsive zoom, fitted or floating detach)')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
