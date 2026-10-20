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

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-spaces-render-'))
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

const store = await import('./spacesStore')
let controller: InstanceType<typeof store.SpacesController> | null = null
mock.module('./spacesStore', () => ({ ...store, SpacesController: class extends store.SpacesController { constructor() { super(); controller = this } } }))
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 220, height: 46, kittyKeyboard: true })
const settle = async (ms = 140) => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, ms)) }) }
const fail = (message: string): never => { console.error(`${message}\n${setup.captureCharFrame()}`); process.exit(1) }
const check = (value: unknown, message: string) => { if (!value) fail(message) }
const waitFor = async (label: string, test: () => boolean) => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) { if (test()) return; await settle(80) }
  fail(`Timed out: ${label}`)
}
const click = async (id: string) => {
  const node = setup.renderer.root.findDescendantById(id)
  if (!node) fail(`Missing control ${id}`)
  await act(async () => { await setup.mockMouse.click(node!.x + 1, node!.y) })
  await settle()
}
const chord = async (key: string) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) }); await settle(60)
  await act(async () => { setup.mockInput.pressKey(key) }); await settle()
}
await settle(1700)
check(controller, 'controller not installed')
const ctl = controller!
const first = ctl.activeWorkspace()!
const space = ctl.activeSpace()!
await act(async () => { setup.mockInput.pressEnter() })
await waitFor('initial transcript', () => setup.captureCharFrame().includes(marker('win-alpha')))
await act(async () => {
  ctl.runtime(first).set('openTabSessions', SESSIONS)
  ctl.runtime(first).set('splitPinnedKeys', ['claude:win-delta', 'claude:win-bravo', 'claude:win-charlie', 'claude:win-echo'])
  ctl.runtime(first).set('splitPaneCount', 4)
  ctl.runtime(first).set('windowOrder', ['claude:win-delta','claude:win-bravo','surface:terminal','surface:terminal#2','claude:win-charlie','claude:win-echo'])
  ctl.runtime(first).set('splitArrangement', 'grid')
  ctl.runtime(first).set('windowSurfaces', ['terminal', 'terminal#2'])
}); await settle(1700)
await chord('1'); await chord('f'); await settle(150)
const floatFrame = () => setup.renderer.root.findDescendantById('floating-window')!
const checkOpaque = () => {
  const box = floatFrame()
  const lines = setup.captureCharFrame().split('\n').slice(box.y + 1, box.y + box.height - 1).map(line => line.slice(box.x + 1, box.x + box.width - 1))
  const columns = [0,1,2,3,4].flatMap(index => {
    const pane = setup.renderer.root.findDescendantById(`split-pane:${index}`)
    return pane ? [pane.x, pane.x + pane.width - 1] : []
  }).map(x => x - box.x - 1).filter(x => x > 2 && x < box.width - 4)
  check(columns.every(x => lines.filter(line => line[x] === '│').length <= lines.length * 0.6), 'underlying window borders show through a floating transcript')
}
checkOpaque()
await waitFor('floating transcript to load', () => setup.captureCharFrame().includes(marker('win-delta')))
checkOpaque()
await chord('f')
await waitFor('docked', () => !setup.renderer.root.findDescendantById('floating-window'))
await chord('u')
await waitFor('undo to float', () => !!setup.renderer.root.findDescendantById('floating-window'))
await chord('u')
await waitFor('undo again to dock', () => !setup.renderer.root.findDescendantById('floating-window'))
await settle(300)
check(setup.captureCharFrame().includes('❯ Terminal'), 'undo hid terminal frames')
await chord('1'); await chord('f')
const size = { width: floatFrame().width, height: floatFrame().height }
await click('workspace-add')
await waitFor('empty second workspace', () => !!setup.renderer.root.findDescendantById('workspace-launcher'))
check(!setup.renderer.root.findDescendantById('floating-window'), 'new workspace inherited a floating window')
await click(`workspace-tab:${first.id}`)
await waitFor('floating window restored', () => !!setup.renderer.root.findDescendantById('split-pane:64'))
check(floatFrame().width === size.width && floatFrame().height === size.height, 'floating geometry was lost')
checkOpaque()
console.log('Spaces floating smoke passed (opaque floating transcripts over surfaces, independent workspace geometry and restoration)')
process.exit(0)
