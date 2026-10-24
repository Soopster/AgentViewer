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

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-equal-panes-'))
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
const panes = () => Array.from({ length: 31 }, (_, index) => index).map((index) => {
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
await act(async () => { runtime.set('openTabSessions', SESSIONS) }); await settle(200)
// The first session is closable, and the empty workspace has no phantom reader.
await chordKey('1'); await chordKey('x')
await waitFor('empty workspace', () => setup.captureCharFrame().includes('No panes open'))
check(!frame('transcript-reader'), 'closing the first session left its reserved frame')
await chordKey('X')
await waitFor('first pane reopened', () => !!frame('transcript-reader'))
// Floating the original session removes its old frame; docking makes an ordinary pane.
await chordKey('1'); await chordKey('f')
await waitFor('original pane floating', () => !!frame('floating-window') && panes().length === 0)
check(!(runtime.values.get('splitPinnedKeys') as string[]).length, 'floating retained a reserved tiled slot')
await chordKey('f')
await waitFor('session docked without a reader', () => !frame('floating-window') && panes().length === 1)
check((runtime.values.get('windowSplitTree') as { primary?: boolean } | null)?.primary !== true, 'operation recreated a reserved reader slot')
await chordKey('1'); await chordKey('"')
await waitFor('ordinary pane split', () => panes().length === 2)
check((runtime.values.get('windowSplitTree') as { primary?: boolean } | null)?.primary !== true, 'operation recreated a reserved reader slot')
const firstName = paneName(0)!, secondName = paneName(1)!
// Focus updates the explicit composer target; surfaces leave that target intact.
await chordKey('2')
check(runtime.values.get('composerPaneTargetKey') === `claude:win-${secondName}`, 'session focus did not aim the composer')
await act(async () => { runtime.set('windowSurfaces', ['browser']); runtime.set('windowOrder', [...(runtime.values.get('windowOrder') as string[]), 'surface:browser']) }); await settle(300)
await chordKey('3')
check(runtime.values.get('composerPaneTargetKey') === `claude:win-${secondName}`, 'browser focus retargeted the composer')
// The layout picker uses focused placement and numbered panes, with no R role.
await chordKey('2')
await openMenu()
check(!setup.captureCharFrame().includes('R reader'), 'layout picker still advertises a reader role')
const choice = frame('window-layout:reader-left')!
await click(choice.x + 2, choice.y + 1)
await waitFor('focused pane moved left', () => frame('split-pane:1')!.x === frame('window-area')!.x)
check(paneName(0) === firstName && paneName(1) === secondName, 'moving a pane exchanged session contents')
// Saved layouts retain the absence of a special frame.
await openMenu(); await key('n')
await act(async () => { await setup.mockInput.typeText('Ordinary panes') }); await settle(80)
await act(async () => { setup.mockInput.pressEnter() }); await settle(150)
await escape()
const saved = (await import('./windowLayoutStore')).listSavedWindowLayouts(CWD)[0]!
check(saved.primaryOpen === false && saved.splitTree?.primary === false, 'saved layout brought back the reader role')
// Every session frame offers the same close/float/tab operations.
const first = frame('split-pane:0')!
await rightClick(first.x + 5, first.y)
check(setup.captureCharFrame().includes('Float window'), 'ordinary session menu cannot float')
check(setup.captureCharFrame().includes('Close pane'), 'ordinary session menu cannot close')
await escape()
// Centre drop onto the original session creates ordinary tabs.
const drag = async (from: Frame, to: Frame) => {
  await act(async () => { await setup.mockMouse.pressDown(from.x + 5, from.y) }); await settle(40)
  await act(async () => { await setup.mockMouse.emitMouseEvent('drag', to.x + Math.floor(to.width / 2), to.y + Math.floor(to.height / 2)) }); await settle(100)
  await act(async () => { await setup.mockMouse.release(to.x + Math.floor(to.width / 2), to.y + Math.floor(to.height / 2)) }); await settle(200)
}
await drag(frame('split-pane:1')!, frame('split-pane:0')!)
await waitFor('ordinary session tabs', () => panes().length === 2 && (runtime.values.get('windowStacks') as string[][]).length === 1)
check((runtime.values.get('windowSplitTree') as { primary?: boolean } | null)?.primary !== true, 'operation recreated a reserved reader slot')
// A fresh workspace's first session can become a tab, just like any other.
await act(async () => { controller!.addWorkspace(controller!.activeSpace()!.id) }); await settle(250)
const freshRuntime = controller!.runtime(controller!.activeWorkspace()!)
await act(async () => {
  freshRuntime.set('workspaceLaunched', true); freshRuntime.set('workspaceHasSession', true)
  freshRuntime.set('selectedSessionKey', 'claude:win-alpha')
  freshRuntime.set('readerSession', SESSIONS[0]); freshRuntime.set('openTabSessions', SESSIONS)
}); await settle(250)
await chordKey('%')
await waitFor('fresh split', () => panes().length === 2 && paneName(0) === 'alpha')
// The original session can exchange geometry with a tool window.
await act(async () => { freshRuntime.set('splitPinnedKeys', ['claude:win-alpha']); freshRuntime.set('splitPaneCount', 1); freshRuntime.set('windowSurfaces', ['browser']); freshRuntime.set('windowOrder', ['claude:win-alpha', 'surface:browser']) }); await settle(200)
const originalX = frame('split-pane:0')!.x
await chordKey('1')
await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) }); await settle(50)
await act(async () => { setup.mockInput.pressArrow('right', { shift: true }) }); await settle(200)
check(frame('split-pane:0')!.x > originalX, 'the original session could not swap positions with a browser')
await chordKey('u'); await settle(150)
await act(async () => { freshRuntime.set('windowSurfaces', []); freshRuntime.set('windowOrder', ['claude:win-alpha', 'claude:win-bravo']); freshRuntime.set('splitPinnedKeys', ['claude:win-alpha', 'claude:win-bravo']); freshRuntime.set('splitPaneCount', 2) }); await settle(200)
await chordKey('1'); await chordKey('t')
await waitFor('first session tabbed', () => panes().length === 1 && (freshRuntime.values.get('windowStacks') as string[][]).length === 1)
// Undo restores both windows and redo returns to a tab group.
await chordKey('u'); await waitFor('first-session tab undo', () => panes().length === 2)
await chordKey('U'); await waitFor('first-session tab redo', () => panes().length === 1)
// Starting from an empty workspace creates an ordinary pane immediately.
await act(async () => { controller!.addWorkspace(controller!.activeSpace()!.id) }); await settle(250)
const emptyRow = railRow('delta'); await click(emptyRow.x + 1, emptyRow.y)
await waitFor('new ordinary session', () => panes().length === 1 && paneName(0) === 'delta')
check((controller!.runtime(controller!.activeWorkspace()!).values.get('windowSplitTree') as { primary?: boolean } | null)?.primary !== true, 'a new workspace created a reserved reader slot')
await chordKey('1'); await chordKey('x')
await waitFor('last ordinary pane closed', () => panes().length === 0 && setup.captureCharFrame().includes('No panes open'))
await chordKey('X'); await waitFor('ordinary pane recovered', () => panes().length === 1 && paneName(0) === 'delta')
console.log('Equal panes rendered smoke passed (close last, empty workspace, reopen, original session float/dock, split without reader, stable composer target, focused layout placement, saved generic layout, menus, tabs)')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
