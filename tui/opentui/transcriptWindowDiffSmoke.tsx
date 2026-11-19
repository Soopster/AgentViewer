/** @jsxImportSource @opentui/react */
// Diff annotations and composer actions work in background transcript windows.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-transcript-diff-'))
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
const cardsFor = (session: Session): TuiTranscriptCard[] => {
  const first: TuiTranscriptCard = {
  ...card(session), category: 'diff', label: 'fixture.ts', autoFold: false,
  editDiff: `diff --git a/fixture.ts b/fixture.ts\n--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1,2 +1,2 @@\n-before\n+${marker(session)}\n unchanged\n`,
}
  return [first, { ...first, key: `${first.key}-second`, label: 'other.ts', compactSummary: 'OTHER_FILE_SUMMARY', lines: [{ text: 'OTHER_FILE_SUMMARY', tone: 'default' }], expandedLines: [{ text: 'OTHER_FILE_SUMMARY', tone: 'default' }], editDiff: first.editDiff!.replaceAll('fixture.ts', 'other.ts').replace(marker(session), 'SECOND_FILE_ONLY') }]
}
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
  readTuiTranscriptView: async () => 'conversation',
  readTuiDiffLayout: async () => process.env.AV_DIFF_LAYOUT === 'split' ? 'split' : 'stack',
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
try {
  await settle(2500)
  const runtime = controller!.runtime(controller!.activeWorkspace()!)
  const keys = SESSIONS.slice(0, 2).map(sessionKey)
  await act(async () => {
    runtime.set('openTabSessions', SESSIONS.slice(0, 2))
    runtime.set('selectedSessionKey', keys[0])
    runtime.set('workspaceHasSession', true)
    runtime.set('splitPinnedKeys', keys)
    runtime.set('splitPaneCount', 2)
    runtime.set('windowOrder', keys)
    runtime.set('windowSplitTree', { primary: false, keys, root: { axis: 'x', ratio: 0.5, first: { slot: 0 }, second: { slot: 1 } } })
  })
  await settle(600)
  await chordKey('1')
  await waitFor('two diff windows', () => paneHas(0, marker(SESSIONS[0]!)) && paneHas(1, marker(SESSIONS[1]!)))
  // A saved note must be visible in its background window, never in a neighbour
  // that happens to have the same line range.
  const selection = { start: 1, side: 'additions', end: 1, endSide: 'additions' } as const
  const noteKey = [`${keys[1]}\u0000card:${SESSIONS[1]!.sessionId}-card`, 1, 'additions', 1, 'additions'].join('\u0000')
  const legacyNoteKey = [keys[1], 1, 'additions', 1, 'additions'].join('\u0000')
  await act(async () => { runtime.set('transcriptDiffNotes', new Map([[legacyNoteKey, { range: selection, text: 'BACKGROUND_NOTE_ONLY' }]])) })
  await settle(200)
  check(paneHas(1, 'BACKGROUND_NOTE_ONLY'), 'background transcript omitted its saved diff note')
  check(!paneHas(0, 'BACKGROUND_NOTE_ONLY'), 'diff note leaked into another session with the same line numbers')
  const backgroundPane = frame('split-pane:1')!
  const bodyLines = setup.captureCharFrame().split('\n')
  const bodyY = bodyLines.reduce((found, line, y) => y >= backgroundPane.y && y < backgroundPane.y + backgroundPane.height && line.slice(backgroundPane.x, backgroundPane.x + backgroundPane.width).includes(marker(SESSIONS[1]!)) ? y : found, -1)
  await act(async () => { await setup.mockMouse.moveTo(backgroundPane.x + 20, bodyY) }); await settle(150)
  const addNoteAction = () => Array.from({ length: 12 }, (_, row) => frame(`diff-note-add:${SESSIONS[1]!.sessionId}-card:${row}`)).find(Boolean)
  await waitFor('background diff add-note action', () => !!addNoteAction())
  const add = addNoteAction()!
  await act(async () => { await setup.mockMouse.click(add.x, add.y) }); await settle(200)
  check(paneHas(1, 'Draft note'), 'background add-note action did not open its editor')
  check(!paneHas(0, 'Draft note'), 'background note editor leaked into the selected transcript')
  await act(async () => { for (let i = 0; i < 'BACKGROUND_NOTE_ONLY'.length; i++) setup.mockInput.pressBackspace() }); await settle(80)
  await act(async () => { await setup.mockInput.typeText('EDITED_BACKGROUND_NOTE') }); await settle(80)
  await act(async () => { setup.mockInput.pressEnter() }); await settle(200)
  const savedNotes = runtime.values.get('transcriptDiffNotes') as Map<string, { text: string }>
  check(savedNotes.get(noteKey)?.text === 'EDITED_BACKGROUND_NOTE', `background editor saved against the wrong session: ${JSON.stringify([...savedNotes])}`)
  check(!savedNotes.has(legacyNoteKey), 'editing a legacy note did not migrate it to the specific diff card')
  const pane = frame('split-pane:1')!
  const lines = setup.captureCharFrame().split('\n')
  check(lines.slice(pane.y, pane.y + pane.height).filter(line => line.slice(pane.x, pane.x + pane.width).includes('EDITED_BACKGROUND_NOTE')).length === 1, 'note appeared on another file with the same line numbers')
  const sendY = lines.findIndex((line, y) => y >= pane.y && y < pane.y + pane.height && line.slice(pane.x, pane.x + pane.width).includes('Send to composer'))
  check(sendY >= 0, 'background note had no composer action')
  const sendX = lines[sendY]!.indexOf('Send to composer', pane.x)
  await press('c')
  await act(async () => { await setup.mockInput.typeText('ALPHA_DRAFT') }); await settle(150)
  await escape()
  check(runtime.values.get('composerDraft') === 'ALPHA_DRAFT', 'fixture did not create the first session draft')
  await act(async () => { runtime.set(`draft:${keys[1]}`, 'BRAVO_DRAFT') }); await settle(100)
  await act(async () => { await setup.mockMouse.click(sendX + 2, sendY) }); await settle(400)
  check(runtime.values.get('composerPaneTargetKey') === keys[1], 'background note targeted another transcript composer')
  check(setup.captureCharFrame().includes('EDITED_BACKGROUND_NOTE'), 'background diff note was not inserted into composer')
  check(String(runtime.values.get('composerDraft') ?? '').includes('EDITED_BACKGROUND_NOTE'), 'composer draft did not receive background note')
  const targetDraft = String(runtime.values.get('composerDraft') ?? '')
  check(targetDraft.startsWith('BRAVO_DRAFT') && !targetDraft.includes('ALPHA_DRAFT'), 'sending a background note mixed the two session drafts')
  check(runtime.values.get(`draft:${keys[0]}`) === 'ALPHA_DRAFT', `sending a background note overwrote the other session draft: ${JSON.stringify(runtime.values.get(`draft:${keys[0]}`))}`)
  console.log('Transcript diff window smoke passed (background mouse editing, legacy note migration, session and file isolation, composer targeting)')
} finally { setup.renderer.destroy() }
process.exit(0)
