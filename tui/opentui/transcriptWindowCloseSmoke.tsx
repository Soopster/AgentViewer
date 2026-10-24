/** @jsxImportSource @opentui/react */
// Closing a transcript tab targets its window, including the selected and floating windows.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-transcript-close-'))
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
try {
  await settle(2500)
  const runtime = controller!.runtime(controller!.activeWorkspace()!)
  const keys = SESSIONS.slice(0, 2).map(sessionKey)
  await act(async () => {
    runtime.set('openTabSessions', SESSIONS.slice(0, 3))
    runtime.set('splitPinnedKeys', keys)
    runtime.set('splitPaneCount', 2)
    runtime.set('windowOrder', keys)
    runtime.set('windowSplitTree', { primary: false, keys, root: { axis: 'x', ratio: 0.5, first: { slot: 0 }, second: { slot: 1 } } })
  })
  await settle(600)
  await chordKey('1')
  await waitFor('selected transcript in first window', () => paneHas(0, marker(SESSIONS[0]!)))
  await press('w')
  await waitFor('closed tab replaced in its own window', () => paneHas(0, marker(SESSIONS[2]!)))
  check(paneHas(1, marker(SESSIONS[1]!)), 'closing selected transcript changed its neighbour')
  check(!(runtime.values.get('splitPinnedKeys') as string[]).includes(keys[0]!), 'closed transcript stayed pinned')
  check((runtime.values.get('splitPinnedKeys') as string[]).length === 2, 'closing a tab opened an extra window')

  await chordKey('u')
  await waitFor('closed selected tab restored by undo', () => paneHas(0, marker(SESSIONS[0]!)))
  check((runtime.values.get('openTabSessions') as Session[]).length === 3, 'undo did not restore the closed tab')
  await press('w')
  await waitFor('selected tab replaced again', () => paneHas(0, marker(SESSIONS[2]!)))

  // All remaining tabs are already displayed: close the focused window.
  await press('w')
  await waitFor('window closed when no background tab remains', () => panes().length === 1)
  check(paneHas(0, marker(SESSIONS[1]!)), 'closing selected window replaced the surviving transcript')
  await chordKey('1')
  await chordKey('f')
  await waitFor('surviving transcript floating', () => !!frame('floating-window'))
  await press('w')
  await waitFor('floating transcript closed', () => !frame('floating-window'))
  check(!(runtime.values.get('openTabSessions') as Session[]).length, 'floating close left its tab open')
  check(setup.captureCharFrame().includes('No panes open'), 'closing final window opened an unrelated session')
  // A grouped successor belongs in the same frame; a floating transcript
  // and another frame's tabs are never candidates for replacement.
  const allKeys = SESSIONS.map(sessionKey)
  await act(async () => {
    runtime.set('openTabSessions', SESSIONS.slice(0, 5))
    runtime.set('selectedSessionKey', allKeys[0])
    runtime.set('splitPinnedKeys', keys)
    runtime.set('splitPaneCount', 2)
    runtime.set('windowOrder', keys)
    runtime.set('windowStacks', [[allKeys[0], allKeys[2]]])
    runtime.set('windowSplitTree', { primary: false, keys, root: { axis: 'x', ratio: 0.5, first: { slot: 0 }, second: { slot: 1 } } })
    runtime.set('floatingWindow', { key: allKeys[3], rect: { x: 15, y: 15, width: 60, height: 15 } })
  })
  await settle(500)
  await chordKey('1')
  await press('w')
  await waitFor('grouped successor in the same frame', () => paneHas(0, marker(SESSIONS[2]!)))
  check(paneHas(1, marker(SESSIONS[1]!)), 'grouped close changed the neighbouring transcript')
  check((runtime.values.get('floatingWindow') as { key: string }).key === allKeys[3], 'grouped close took the floating transcript')
  await chordKey('3')
  await press('w')
  await waitFor('floating tab replaced without docking', () => (runtime.values.get('floatingWindow') as { key: string } | null)?.key === allKeys[4])
  check((runtime.values.get('splitPinnedKeys') as string[]).length === 2, 'floating replacement created a tiled window')
  await chordKey('u')
  await waitFor('floating close undone in place', () => (runtime.values.get('floatingWindow') as { key: string } | null)?.key === allKeys[3])
  await press('w')
  await waitFor('floating tab replaced again', () => (runtime.values.get('floatingWindow') as { key: string } | null)?.key === allKeys[4])
  await press('w')
  await waitFor('replacement floating tab closed', () => !frame('floating-window'))
  check(paneHas(0, marker(SESSIONS[2]!)) && paneHas(1, marker(SESSIONS[1]!)), 'floating close stole a transcript from the tiled windows')
  await chordKey('1'); await press('w')
  await waitFor('only final tiled transcript remains', () => panes().length === 1)
  await chordKey('1'); await press('w')
  await waitFor('final tiled transcript closed', () => setup.captureCharFrame().includes('No panes open'))
  check(!(runtime.values.get('openTabSessions') as Session[]).length, 'final tiled close left a tab open')
  console.log('Transcript window close parity smoke passed')
} finally {
  setup.renderer.destroy()
}
process.exit(0)
