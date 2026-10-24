/** @jsxImportSource @opentui/react */
// Active transcript controls work in every tiled and floating window.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-transcript-parity-'))
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
const cardsFor = (session: Session) => Array.from({ length: 80 }, (_, index) => ({
  ...card(session), key: `${session.sessionId}-card-${index}`,
  role: index === 0 ? 'user' as const : 'assistant' as const,
  lines: Array.from({ length: 4 }, (_, row) => ({ text: `${marker(session)} ${index} row ${row}`, tone: 'default' as const })),
}))
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
let detailReads = 0
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS.map((session) => ({ ...session })), readTuiSessionDetailAsync: async (session: Session) => { detailReads++; return detailFor(session) } }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiTranscriptView: async () => 'scrollback',
  readTuiStickyHeaders: async () => true,
  readTuiSessions: async () => SESSIONS.map((session) => ({ ...session })),
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
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
const press = async (value: string) => {
  await act(async () => { setup.mockInput.pressKey(value) })
  await settle(250)
}
const sessionKey = (session: Session) => `${session.provider}:${session.sessionId}`
const escape = async () => { await act(async () => { setup.mockInput.pressEscape() }); await settle(200) }
const search = async (name: string) => {
  await press('/')
  check(setup.captureCharFrame().includes('SEARCH  '), `${name} did not expose the full transcript search`)
  await act(async () => { for (let i = 0; i < 4; i++) setup.mockInput.pressBackspace() }); await settle(80)
  await act(async () => { await setup.mockInput.typeText('BODY') }); await settle(200)
  check(setup.captureCharFrame().includes('80 matches'), `${name} search did not include its complete transcript`)
  await escape()
}
const contains = (outer: Frame, inner: Frame) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
try {
  await settle(2500)
  const runtime = controller!.runtime(controller!.activeWorkspace()!)
  const keys = SESSIONS.slice(0, 2).map(sessionKey)
  await act(async () => {
    runtime.set('openTabSessions', SESSIONS.slice(0, 2))
    runtime.set('splitPinnedKeys', keys)
    runtime.set('splitPaneCount', 2)
    runtime.set('windowOrder', keys)
    runtime.set('windowSplitTree', { primary: false, keys, root: { axis: 'x', ratio: 0.5, first: { slot: 0 }, second: { slot: 1 } } })
  })
  await settle(600)
  for (const number of ['1', '2']) {
    await chordKey(number)
    await waitFor(`window ${number} transcript ready`, () => paneHas(Number(number) - 1, marker(SESSIONS[Number(number) - 1]!)))
    await search(`Tiled window ${number}`)
  }
  const readsBeforeFocus = detailReads
  for (const number of ['1', '2', '1', '2']) await chordKey(number)
  check(detailReads === readsBeforeFocus, `focusing unchanged loaded windows triggered ${detailReads - readsBeforeFocus} redundant session reads`)
  await chordKey('f')
  await waitFor('second transcript floating', () => !!frame('floating-window') && paneHas(64, marker(SESSIONS[1]!)))
  await search('Floating window')
  check(contains(frame('floating-window')!, frame('transcript-scroll')!), `floating transcript viewport escaped its frame: ${JSON.stringify([frame('floating-window'), frame('transcript-scroll')])}`)
  await press('g')
  check(runtime.values.get('transcriptCursorKey') === `${SESSIONS[1]!.sessionId}-card-0`, `floating window did not use full transcript navigation: ${JSON.stringify({cursor:runtime.values.get('transcriptCursorKey'), selected:runtime.values.get('selectedSessionKey'), focus:runtime.values.get('splitFocusIndex')})}`)
  await press('G')
  check(runtime.values.get('transcriptCursorKey') === `${SESSIONS[1]!.sessionId}-card-79`, 'floating window could not jump to the newest message')
  // Native title drag and resize still work when the full transcript owns the frame.
  const initial = frame('floating-window')!
  await act(async () => { await setup.mockMouse.pressDown(initial.x + 4, initial.y) }); await settle(50)
  await act(async () => { await setup.mockMouse.emitMouseEvent('drag', initial.x + 7, initial.y + 2) }); await settle(100)
  const duringMove = frame('floating-window')!
  check(duringMove && (duringMove.x !== initial.x || duringMove.y !== initial.y), 'shared transcript title no longer moves its floating window')
  await escape()
  await act(async () => { await setup.mockMouse.release(initial.x + 7, initial.y + 2) }); await settle(250)
  const moved = frame('floating-window')!
  check(moved && moved.x === initial.x && moved.y === initial.y, 'cancelled title drag did not restore the floating frame')
  const handle = frame('floating-resize')!
  await act(async () => { await setup.mockMouse.pressDown(handle.x, handle.y) }); await settle(50)
  await act(async () => { await setup.mockMouse.emitMouseEvent('drag', handle.x - 5, handle.y - 2) }); await settle(100)
  await act(async () => { await setup.mockMouse.release(handle.x - 5, handle.y - 2) }); await settle(250)
  check(frame('floating-window')!.width < moved.width, 'shared floating transcript could not resize')
  check(contains(frame('floating-window')!, frame('transcript-scroll')!), 'resized transcript viewport escaped its frame')
  await chordKey('1')
  await search('Tiled window beside floating window')
  await chordKey('2')
  await search('Refocused floating window')
  await press('Z')
  check(runtime.values.get('fullscreenMode') === true, 'floating transcript could not enter full screen')
  check(!frame('floating-window'), 'full screen left a duplicate floating transcript')
  check(runtime.values.get('selectedSessionKey') === keys[1], 'full screen switched to a different transcript')
  check(!!frame('transcript-scroll'), 'full screen lost the floating transcript')
  await press('Z')
  await waitFor('floating transcript restored from full screen', () => !!frame('floating-window') && paneHas(64, marker(SESSIONS[1]!)) && !!frame('reader-window-close'))
  check(runtime.values.get('selectedSessionKey') === keys[1], 'leaving full screen changed transcript identity')
  const close = frame('reader-window-close')!
  await act(async () => { await setup.mockMouse.click(close.x + 1, close.y) }); await settle(300)
  await waitFor('floating title close preserves the other transcript', () => !frame('floating-window') && paneHas(0, marker(SESSIONS[0]!)))
  // A workspace containing only a floating transcript has the same controls.
  await chordKey('1'); await chordKey('f')
  await waitFor('sole transcript floating', () => !!frame('floating-window') && paneHas(64, marker(SESSIONS[0]!)))
  await search('Sole floating transcript')
  await chordKey('o')
  check(runtime.values.get('splitFocusIndex') === 64, 'focus cycle skipped the sole floating transcript')
  await press('Z')
  check(runtime.values.get('fullscreenMode') === true && runtime.values.get('selectedSessionKey') === keys[0], 'sole floating transcript lost identity in full screen')
  await press('Z')
  await waitFor('sole floating transcript restored', () => !!frame('floating-window') && !!frame('reader-window-close'))
  const dock = frame('floating-dock')!
  await act(async () => { await setup.mockMouse.click(dock.x + 1, dock.y) }); await settle(300)
  await waitFor('shared transcript docked', () => !frame('floating-window') && paneHas(0, marker(SESSIONS[0]!)))
  await chordKey('1'); await chordKey('f')
  await waitFor('sole transcript refloated', () => !!frame('floating-window') && !!frame('reader-window-close'))
  const finalClose = frame('reader-window-close')!
  await act(async () => { await setup.mockMouse.click(finalClose.x + 1, finalClose.y) }); await settle(300)
  await waitFor('sole floating transcript title close', () => !frame('floating-window') && panes().length === 0 && setup.captureCharFrame().includes('No panes open'))
  // An open tool tab must not downgrade a neighbouring transcript's controls.
  await act(async () => {
    runtime.set('openTabSessions', SESSIONS.slice(0, 2))
    runtime.set('selectedSessionKey', keys[0])
    runtime.set('workspaceHasSession', true)
    runtime.set('splitPinnedKeys', keys)
    runtime.set('splitPaneCount', 2)
    runtime.set('windowOrder', keys)
    runtime.set('windowSplitTree', { primary: false, keys, root: { axis: 'x', ratio: 0.5, first: { slot: 0 }, second: { slot: 1 } } })
    runtime.set('popoverTabs', ['browser'])
    runtime.set('activePopoverTab', 'browser')
  })
  await settle(600)
  // The tool tab takes over the selected transcript's window (window 1); the
  // other transcript is window 2 beside it.
  await chordKey('2')
  await waitFor('transcript alongside tool tab', () => !!frame('popover-tab-frame') && paneHas(1, marker(SESSIONS[1]!)))
  check(!paneHas(0, marker(SESSIONS[0]!)), 'the tool tab did not take over its window')
  check(setup.captureCharFrame().split('\n')[frame('split-pane:1')!.y]?.slice(frame('split-pane:1')!.x, frame('split-pane:1')!.x + frame('split-pane:1')!.width).includes('2 ·'), 'focused transcript title does not match its focus shortcut number beside a tool tab')
  await search('Second transcript beside a tool tab')
  check(!!frame('popover-tab-frame'), 'transcript focus closed the tool tab')
  await chordKey('f')
  await waitFor('floating transcript alongside tool tab', () => !!frame('floating-window') && paneHas(64, marker(SESSIONS[1]!)))
  await search('Floating transcript beside a tool tab')
  check(!!frame('popover-tab-frame'), 'floating transcript took the tool tab frame')
  check(contains(frame('floating-window')!, frame('transcript-scroll')!), 'tool tab changed floating viewport bounds')
  await chordKey('1')
  check(runtime.values.get('splitFocusIndex') === null, 'tool tab did not receive focus')
  // The window behind the tab is not a stop of its own.
  await chordKey('o')
  check(runtime.values.get('splitFocusIndex') === 64, 'focus cycle skipped the floating transcript')
  await chordKey('o')
  check(runtime.values.get('splitFocusIndex') === null, 'focus cycle did not return to the tool tab')
  await chordKey('2')
  await act(async () => { setup.mockInput.pressTab() }); await settle(200)
  check(runtime.values.get('focusedPane') === 'sessions', 'Tab from a floating transcript did not reach the rail')
  await act(async () => { setup.mockInput.pressTab() }); await settle(200)
  check(runtime.values.get('splitFocusIndex') === 64 && runtime.values.get('focusedPane') === 'messages', 'rail Tab did not return to the floating transcript')
  // Older layouts can still use the preset geometry instead of a split tree.
  await act(async () => {
    runtime.set('floatingWindow', null)
    runtime.set('splitPinnedKeys', keys)
    runtime.set('splitPaneCount', 2)
    runtime.set('windowOrder', keys)
    runtime.set('windowSplitTree', null)
  })
  await settle(500)
  await chordKey('2')
  await waitFor('legacy layout transcript beside tool tab', () => !!frame('popover-tab-frame') && paneHas(1, marker(SESSIONS[1]!)))
  await search('Second transcript in a legacy layout with a tool tab')
  check(contains(frame('split-pane:1')!, frame('transcript-scroll')!), `legacy transcript viewport escaped its frame: ${JSON.stringify({ frame: frame('split-pane:1'), scroll: frame('transcript-scroll') })}`)
  await chordKey('1'); await chordKey('m')
  check(!setup.captureCharFrame().includes(marker(SESSIONS[1]!)), 'zooming the tool tab painted a transcript over it')
  check(frame('popover-tab-frame')!.width === frame('window-area')!.width, 'zoomed tool tab did not fill the workspace')
  await chordKey('m'); await chordKey('2')
  await waitFor('transcript restored after tool tab zoom', () => paneHas(1, marker(SESSIONS[1]!)))
  // With one transcript, the tool tab takes its window, and is window 1.
  await act(async () => {
    runtime.set('openTabSessions', SESSIONS.slice(0, 1))
    runtime.set('splitPinnedKeys', keys.slice(0, 1))
    runtime.set('splitPaneCount', 1)
    runtime.set('windowOrder', keys.slice(0, 1))
    runtime.set('windowSplitTree', null)
  })
  await settle(500)
  await waitFor('the tool tab in the only window', () => !!frame('popover-tab-frame') && frame('popover-tab-frame')!.width === frame('window-area')!.width)
  check(!setup.captureCharFrame().includes(marker(SESSIONS[0]!)), 'the transcript behind the tool tab is painted')
  await chordKey('1')
  check(runtime.values.get('splitFocusIndex') === null, 'window 1 is not the tool tab')
  console.log('Transcript window parity smoke passed (search, navigation, geometry, gestures, full screen, close, tool tabs, focus cycle, legacy layouts, zoom)')
} finally {
  setup.renderer.destroy()
}
process.exit(0)
