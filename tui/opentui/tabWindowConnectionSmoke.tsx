/** @jsxImportSource @opentui/react */
// The existing tab row connects visually to its owning window without moving
// either frame or intercepting their title/tab controls.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import assert from 'node:assert/strict'
import { tabConnectionGeometry } from './SessionTabConnection'

const testTabs = { x: 31, y: 0, width: 150, height: 1 }
const testWindow = { x: 30, y: 1, width: 151, height: 30 }
assert.ok(tabConnectionGeometry(testTabs, testWindow, 0, 0, 40))
assert.deepEqual(tabConnectionGeometry(testTabs, testWindow, 2, 2, 40), tabConnectionGeometry(testTabs, testWindow, 0, 0, 40))
assert.equal(tabConnectionGeometry(testTabs, testWindow, 0, 1, 40), null, 'offscreen tabs do not connect')
assert.equal(tabConnectionGeometry({ ...testTabs, width: 30 }, testWindow, 0, 0, 40), null, 'clipped tab')
assert.equal(tabConnectionGeometry(testTabs, { ...testWindow, y: 5 }, 0, 0, 40), null, 'lower pane')
assert.equal(tabConnectionGeometry(testTabs, { ...testWindow, x: 100 }, 0, 0, 40), null, 'neighbouring pane')
assert.equal(tabConnectionGeometry(testTabs, { ...testWindow, width: 50 }, 0, 0, 40), null, 'title controls')

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-tabs-in-border-')))
delete process.env.AGENT_VIEWER_ATTACH

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const session = (id: string, title: string, lastModified: number): Session => ({
  sessionId: id, provider: 'claude', cwd: process.cwd(), summary: title, firstPrompt: title, lastModified,
})
const ALPHA = session('tabs-border-alpha', 'Alpha session', 1_700_000_000_000)
const BRAVO = session('tabs-border-bravo', 'Bravo session', 1_600_000_000_000)
const SESSIONS = () => [{ ...ALPHA }, { ...BRAVO }]
// The card lookup is handed a session or its info, which has no summary.
const titleOf = (target: Pick<Session, 'sessionId'>) => SESSIONS().find((candidate) => candidate.sessionId === target.sessionId)?.summary ?? 'Unknown'
const cardsFor = (target: Pick<Session, 'sessionId'>): TuiTranscriptCard[] => [{
  key: `${target.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation',
  autoFold: false, compactSummary: `${titleOf(target)} body`, lines: [{ text: `${titleOf(target)} body`, tone: 'default' }],
  expandedLines: [{ text: `${titleOf(target)} body`, tone: 'default' }], searchText: titleOf(target), searchHaystackLower: titleOf(target).toLowerCase(),
}]
const detailFor = (target: Session) => ({
  info: { sessionId: target.sessionId, provider: 'claude' as const, cwd: process.cwd() },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(target),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS(), readTuiSessionDetailAsync: async (target: Session) => detailFor(target), readTuiSubagentSummariesAsync: async () => [] }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (target: Session) => cardsFor(target), formatTranscriptCardsAsync: async (target: Session) => cardsFor(target) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => SESSIONS(),
  readTuiSessionDetail: async (target: Session) => detailFor(target),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 160, height: 40, kittyKeyboard: true })
const settle = async (ms = 200) => {
  await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, ms)); await setup.flush() })
}
const fail = (message: string): never => {
  console.error(`${message}\n${setup.captureCharFrame()}`)
  process.exit(1)
}
const waitFor = async (what: string, test: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (test()) return
    await settle(100)
  }
  fail(`Timed out: ${what}`)
}
type Rect = { x: number; y: number; width: number; height: number }
const rectOf = (id: string) => setup.renderer.root.findDescendantById(id) as unknown as Rect | null
const row = (y: number) => setup.captureCharFrame().split('\n')[y] ?? ''
const strip = () => rectOf('session-tabs')

try {
  await settle(2500)
  // Open both sessions as tabs: Enter opens the selected rail row as one.
  act(() => { setup.mockInput.pressEnter() })
  await settle(500)
  act(() => { setup.mockInput.pressTab() })
  await settle(200)
  act(() => { setup.mockInput.pressKey('j') })
  await settle(300)
  act(() => { setup.mockInput.pressEnter() })
  await waitFor('both tabs', () => {
    const box = strip()
    return Boolean(box && row(box.y).includes('Alpha session') && row(box.y).includes('Bravo session'))
  })

  const tabs = rectOf('session-tabs')! as Rect & { getSelectedIndex(): number; getTabWidth(): number; scrollOffset: number }
  const reader = rectOf('transcript-reader')!
  if (tabs.y + 1 !== reader.y) fail('the tab row moved into the window instead of remaining above it')
  const left = tabs.x + (tabs.getSelectedIndex() - tabs.scrollOffset) * tabs.getTabWidth()
  const right = left + tabs.getTabWidth() - 1
  await waitFor('the selected tab joined to the window', () => row(reader.y)[left] === '╯' && row(reader.y)[right] === '╰')
  if (row(tabs.y)[left] !== '╭' || row(tabs.y)[right] !== '╮') fail('the active tab has no connected outline')
  if (!row(reader.y).includes('layout')) fail('the connection overwrote title controls')
  if (process.env.TAB_CONNECTION_FRAME) writeFileSync(process.env.TAB_CONNECTION_FRAME, setup.captureCharFrame())
  // A native close hit keeps its original coordinates.
  const close = row(tabs.y).indexOf('×', left)
  if (close <= left || close >= right) fail('the tab lost its close button')
  await act(async () => { await setup.mockMouse.click(close, tabs.y) })
  await waitFor('the connected tab closed', () => !row(strip()!.y).includes('Bravo session'))
  // Fullscreen still removes tabs; restoring reconnects them above the window.
  const alpha = row(strip()!.y).indexOf('Alpha session')
  await act(async () => { await setup.mockMouse.click(alpha + 2, strip()!.y) })
  await waitFor('the remaining tab opened', () => Boolean(rectOf('transcript-reader')))
  act(() => { setup.mockInput.pressKey('Z', { shift: true }) })
  await waitFor('fullscreen without a tab connector', () => {
    const restore = rectOf('fullscreen-restore')
    return Boolean(restore && row(restore.y).includes('FULLSCREEN') && !row(restore.y).includes('╭'))
  })
  act(() => { setup.mockInput.pressKey('Z', { shift: true }) })
  await waitFor('the original tab row restored', () => Boolean(strip() && rectOf('transcript-reader') && strip()!.y + 1 === rectOf('transcript-reader')!.y))
  console.log('Tab/window connection passed (separate row, native frame, connected outline, controls, close)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
