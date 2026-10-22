/** @jsxImportSource @opentui/react */
// Each transcript retains its reading position and folding while focus changes.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-transcript-state-'))
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
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: true,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
})
const CARD_COUNT = Number(process.env.AV_RENDERER_CARD_COUNT ?? 80)
const cardsFor = (session: Session) => Array.from({ length: CARD_COUNT }, (_, index) => ({
  ...card(session), key: `${session.sessionId}-card-${index}`,
  role: index === 0 ? 'user' as const : 'assistant' as const,
  category: index === 0 ? 'conversation' as const : 'technical' as const,
  compactSummary: `${marker(session)} MESSAGE-${String(index).padStart(3, '0')}`,
  expandedLines: Array.from({ length: 5 }, (_, row) => ({ text: `${marker(session)} DETAIL-${String(index).padStart(3, '0')}-${row}`, tone: 'default' as const })),
  lines: Array.from({ length: 4 }, (_, row) => ({ text: `${marker(session)} ${index} row ${row}`, tone: index === 1 ? 'thinking' as const : 'default' as const })),
}))
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
  readTuiTranscriptView: async () => 'scrollback',
  readTuiTabsEnabled: async () => process.env.AV_RENDERER_TABS !== '0',
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
const paneText = (index: number) => {
  const pane = frame(index === 64 ? 'floating-window' : `split-pane:${index}`)!
  return setup.captureCharFrame().split('\n').slice(pane.y + 1, pane.y + pane.height - 1).map(line => line.slice(pane.x + 1, pane.x + pane.width - 1)).join('\n')
}
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
  await chordKey('1')
  await waitFor('first transcript ready', () => paneHas(0, marker(SESSIONS[0]!)))
  await press('g'); await press('e'); await settle(300)
  check(paneText(0).includes('DETAIL-001-'), 'first transcript did not show its reading position')
  await act(async () => { setup.mockInput.pressTab() }); await settle(250)
  check(paneText(0).includes('DETAIL-001-1'), 'moving focus to the rail collapsed an open transcript')
  await act(async () => { setup.mockInput.pressTab() }); await settle(250)
  await chordKey('2')
  await waitFor('second transcript ready', () => paneHas(1, marker(SESSIONS[1]!)))
  await settle(600)
  check(paneText(0).includes('DETAIL-001-1'), 'background transcript lost its folding or reading position')
  check(!paneText(1).includes(`DETAIL-${String(CARD_COUNT - 1).padStart(3, '0')}-1`), 'expansion leaked into another transcript window')
  await chordKey('1')
  await waitFor('first transcript refocused', () => paneHas(0, 'DETAIL-001-1'))
  await chordKey('f')
  await waitFor('expanded transcript floated', () => paneHas(64, 'DETAIL-001-1'))
  await chordKey('1')
  await waitFor('second transcript refocused', () => paneHas(0, marker(SESSIONS[1]!)))
  await waitFor('background floating transcript ready', () => paneHas(64, marker(SESSIONS[0]!)))
  await settle(200)
  check(paneText(64).includes('DETAIL-001-1'), 'background floating transcript lost its reading state')
  const spaceId = controller!.activeSpace()!.id
  const workspaceId = controller!.activeWorkspace()!.id
  await act(async () => { controller!.addWorkspace(spaceId) }); await settle(250)
  await act(async () => { controller!.activate(spaceId, workspaceId) }); await settle(500)
  await waitFor('floating reading state after workspace return', () => paneHas(64, 'DETAIL-001-1'))
  await chordKey('2')
  await waitFor('floating reading state refocused after workspace return', () => paneHas(64, 'DETAIL-001-1'))
  const appController = controller!
  appController.flush()
  const restoredController = new store.SpacesController()
  const restoredWorkspace = restoredController.activeWorkspace()!
  const restored = restoredController.runtime(restoredWorkspace).values.get('ref:readerPositions') as { current: Map<string, { state: { followTail: boolean }; scrollbackExpanded?: boolean }> }
  check(restored.current.get(keys[0]!)?.state.followTail === false, 'saved workspace lost the paused reading position')
  check(restored.current.get(keys[0]!)?.scrollbackExpanded === true, 'saved workspace lost the transcript expansion state')
  // Thinking expansion must use the same body preparation in a background pane.
  await act(async () => { appController.preferences.set('transcriptView', 'conversation') }); await settle(500)
  await press('g'); await press('i')
  await waitFor('thinking body in the selected transcript', () => paneHas(64, 'DETAIL-001-1'))
  await chordKey('1')
  await waitFor('thinking body in the background transcript', () => paneHas(64, 'DETAIL-001-1'))
  check(!paneText(64).includes('DETAIL-002-1'), 'thinking mode expanded ordinary collapsed cards')
  if (CARD_COUNT > 240) {
    await press('g')
    await settle(300)
    const { setReaderWindowStart } = await import('./readerWindowStore')
    await act(async () => { setReaderWindowStart(80) }); await settle(500)
    check(paneText(64).includes('DETAIL-001-1'), 'scrolling the selected transcript shifted a different window')
  }
  console.log('Transcript window state smoke passed (independent folding, background position, float relocation, workspace return, persisted state, shared thinking renderer)')
} finally {
  setup.renderer.destroy()
}
process.exit(0)
