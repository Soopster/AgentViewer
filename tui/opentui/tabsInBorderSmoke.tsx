/** @jsxImportSource @opentui/react */
// The session tabs sit in the top border of the window a tab opens in, in
// place of its title, instead of on a row of their own above every window.
// Laid-out frames are the only place this shows: the strip and a title row are
// both one row of text, so the frame must be read back by position.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

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

const { default: OpenTuiApp, freeTitleColumn } = await import('./App')
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
const strip = () => rectOf('session-tabs-host')

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

  // 1. The strip is the selected window's top border, not a row above it.
  const reader = rectOf('transcript-reader')
  const box = strip()!
  if (!reader) fail('no selected window')
  if (box.y !== reader!.y) fail(`the tabs are on row ${box.y}, the selected window's border on row ${reader!.y}`)
  if (box.x !== reader!.x + 1) fail(`the tabs start at column ${box.x}, inside the border at ${reader!.x + 1}`)
  const area = rectOf('window-area')!
  if (reader!.y !== area.y) fail(`the selected window starts on row ${reader!.y}, below the window area's top ${area.y}: a row is still spent above it`)

  // 2. The host window draws no title of its own, but keeps its buttons.
  const border = row(reader!.y)
  const afterTabs = border.slice(box.x + box.width, reader!.x + reader!.width)
  if (/Bravo session|Alpha session/.test(afterTabs)) fail(`the host window still draws its title: ${afterTabs}`)
  if (!border.includes('layout')) fail('the host window lost its title buttons')

  // 3. Another window keeps its title, and the tabs follow the selection to it.
  act(() => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(100)
  act(() => { setup.mockInput.pressKey('%') })
  await waitFor('a second window', () => Boolean(rectOf('split-pane:1')))
  await settle(800)
  const hostBefore = strip()!
  const other = [rectOf('split-pane:0')!, rectOf('split-pane:1')!].find((frame) => frame.x !== hostBefore.x - 1)
  if (!other) fail('could not tell the two windows apart')
  const otherTitle = row(other!.y).slice(other!.x, other!.x + other!.width)
  if (!/session/.test(otherTitle)) fail(`the window without the tabs lost its title: ${otherTitle}`)
  act(() => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(100)
  act(() => { setup.mockInput.pressKey('o') })
  await waitFor('the tabs to move to the focused window', () => strip()?.x === other!.x + 1 && strip()?.y === other!.y)

  // Floating title interaction must not hit the extra Dock control.
  act(() => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(100)
  act(() => { setup.mockInput.pressKey('f') })
  await waitFor('a floating tab host', () => Boolean(rectOf('floating-window')) && (rectOf('floating-dock')?.width ?? 0) > 0)
  const floating = rectOf('floating-window')!
  const start = { x: floating.x, y: floating.y }
  const grab = freeTitleColumn(floating)
  const workspace = rectOf('window-area')!
  // Drop inside the tiled window, clear of its edge docking zones.
  const drop = { x: workspace.x + Math.floor(workspace.width / 2), y: workspace.y + Math.floor(workspace.height / 2) }
  const expected = {
    x: Math.max(workspace.x, Math.min(workspace.x + workspace.width - floating.width, start.x + drop.x - grab)),
    y: Math.max(workspace.y, Math.min(workspace.y + workspace.height - floating.height, drop.y)),
  }
  await act(async () => { await setup.mockMouse.pressDown(grab, start.y) })
  await settle(50)
  await act(async () => { await setup.mockMouse.emitMouseEvent('drag', drop.x, drop.y) })
  await settle(100)
  await act(async () => { await setup.mockMouse.release(drop.x, drop.y) })
  await waitFor('floating title drag without docking', () => rectOf('floating-window')?.x === expected.x && rectOf('floating-window')?.y === expected.y)

  console.log('Tabs in border smoke passed (title placement, selection, preserved controls, floating title drag)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
