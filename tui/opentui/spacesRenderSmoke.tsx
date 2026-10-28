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
const setup = await testRender(<OpenTuiApp />, { width: 180, height: 42, kittyKeyboard: true })
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
// A pane and draft survive switching away and back.
await act(async () => { ctl.runtime(first).set('openTabSessions', SESSIONS.slice(0, 2)) }); await settle(100)
await chord('%')
await waitFor('split pane', () => !!setup.renderer.root.findDescendantById('split-pane:0'))
await act(async () => { setup.mockInput.pressKey('o', { ctrl: true }) })
await settle(100)
await act(async () => { await setup.mockInput.pasteBracketedText('FIRST SPACE DRAFT') })
await settle(150)
await click('workspace-add')
const second = ctl.activeWorkspace()!
check(second.id !== first.id, 'new workspace did not activate')
await waitFor('project launcher', () => !!setup.renderer.root.findDescendantById('workspace-launcher'))
check(!setup.renderer.root.findDescendantById('split-pane:0'), 'new workspace inherited old panes')
await click('workspace-launcher:open-session')
await waitFor('same session in second workspace', () => setup.captureCharFrame().includes(marker('win-alpha')))
await act(async () => { setup.mockInput.pressKey('o', { ctrl: true }) }); await settle(100)
await act(async () => { await setup.mockInput.pasteBracketedText('SECOND SPACE DRAFT') }); await settle(150)
await click(`workspace-tab:${first.id}`)
await waitFor('first layout restored', () => !!setup.renderer.root.findDescendantById('split-pane:0'))
check(ctl.runtime(first).values.get('composerDraft') === 'FIRST SPACE DRAFT', 'first draft was lost or shared')
check(ctl.runtime(second).values.get('composerDraft') === 'SECOND SPACE DRAFT', 'second draft was overwritten')
// A late completion is isolated to the originating runtime.
await act(async () => { ctl.runtime(second).set('searchQuery', 'inactive-only') })
check(ctl.runtime(first).values.get('searchQuery') !== 'inactive-only', 'inactive state leaked')
await chord('S')
await waitFor('spaces switcher', () => !!setup.renderer.root.findDescendantById('spaces-manager'))
await act(async () => { setup.mockInput.pressEscape() }); await settle(100)
// Confirm closure before discarding a draft; cancellation is harmless.
await click(`workspace-close:${first.id}`)
await waitFor('close confirmation', () => setup.captureCharFrame().includes('Discard drafts'))
await act(async () => { setup.mockInput.pressEscape() }); await settle(100)
check(ctl.activeWorkspace()?.id === first.id, 'cancel close changed active workspace')
await act(async () => { setup.mockInput.pressEscape() }); await settle(100)
// Different spaces may use the same project without sharing their workspace.
await act(async () => { ctl.addSpace(CWD, 'Other project') }); await settle(1400)
await waitFor('new space launcher', () => !!setup.renderer.root.findDescendantById('workspace-launcher'))
check(ctl.activeSpace()?.name === 'Other project', 'space did not change')
await act(async () => { ctl.activate(space.id, first.id) }); await settle(1400)
await waitFor('previous space layout', () => !!setup.renderer.root.findDescendantById('split-pane:0'))
ctl.flush()
const restored = new store.SpacesController(CWD)
check(restored.getSnapshot().spaces.length === 2, 'spaces did not persist')
check(restored.activeWorkspace()?.id === first.id, 'active workspace did not persist')
await act(async () => { setup.resize(80, 24) }); await settle(200)
check(setup.renderer.root.findDescendantById('workspace-tabs'), 'workspace navigation vanished on a small terminal')
// Disabling navigation preserves the active layout and survives a restart.
const activeBeforeToggle = ctl.activeWorkspace()!.id
const layoutBeforeToggle = JSON.stringify(ctl.runtime(ctl.activeWorkspace()!).values.get('windowSplitTree'))
await chord('W')
check(!ctl.workspacesEnabled, 'workspace shortcut did not disable workspaces')
check(!setup.renderer.root.findDescendantById('workspace-tabs'), 'disabled workspace tabs remained visible')
check(!setup.renderer.root.findDescendantById('spaces-rail'), 'disabled spaces rail remained visible')
check(ctl.activeWorkspace()?.id === activeBeforeToggle, 'toggle changed active workspace')
check(JSON.stringify(ctl.runtime(ctl.activeWorkspace()!).values.get('windowSplitTree')) === layoutBeforeToggle, 'toggle discarded current layout')
ctl.flush()
check(!new store.SpacesController(CWD).workspacesEnabled, 'disabled setting did not persist')
await chord('W')
check(ctl.workspacesEnabled, 'workspace shortcut did not enable workspaces')
check(setup.renderer.root.findDescendantById('workspace-tabs'), 'enabled workspace tabs did not return')
check(ctl.activeWorkspace()?.id === activeBeforeToggle, 'enabling changed active workspace')
console.log('Spaces rendered smoke passed (tabs, isolated shared-session drafts, layout restoration, close confirmation, spaces, restart, small terminal)')
process.exit(0)
