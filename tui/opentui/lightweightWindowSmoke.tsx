/** @jsxImportSource @opentui/react */
// Lightweight windows (`v` then Tab): the chosen view drawn the old pane's way.
// It drops bookkeeping rows, groups tool calls and drops empty placeholders
// whatever the view, starts every card folded, mounts the transcript's tail
// and loads a page at a time as the cursor walks back (kept across a remount),
// and draws no view header. Tab in the view menu turns it back off.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Renderable } from '@opentui/core'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-lightweight-'))
process.env.SHELL = '/bin/sh'
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const SESSION: Session = { sessionId: 'lightweight', provider: 'claude', cwd: CWD, summary: 'Lightweight windows', firstPrompt: 'Lightweight windows', lastModified: 1_700_000_000_000 }
const OTHER: Session = { sessionId: 'lightweight-other', provider: 'claude', cwd: CWD, summary: 'Other session', firstPrompt: 'Other session', lastModified: 1_600_000_000_000 }
const label = (index: number) => `MESSAGE-${String(index).padStart(3, '0')}`
const card = (index: number, extra: Partial<TuiTranscriptCard> = {}): TuiTranscriptCard => ({
  key: `light-card-${index}`, role: index % 2 === 0 ? 'user' : 'assistant', provider: 'claude', label: 'Assistant',
  category: 'conversation', autoFold: false, compactSummary: label(index),
  lines: [{ text: label(index), tone: 'default' }], expandedLines: [{ text: label(index), tone: 'default' }],
  searchText: label(index), searchHaystackLower: label(index).toLowerCase(),
  ...extra,
})
const LONG_LINES = Array.from({ length: 14 }, (_, line) => ({ text: `LONG-LINE-${String(line + 1).padStart(2, '0')}`, tone: 'default' as const }))
// 200 ordinary messages, then the tail the old pane shaped: a bookkeeping row,
// two tool calls, an empty placeholder and a long reply.
const cards: TuiTranscriptCard[] = [
  ...Array.from({ length: 200 }, (_, index) => card(index)),
  card(200, { key: 'light-system', category: 'system', role: 'system', lines: [{ text: 'SYSTEM-ROW', tone: 'default' }], expandedLines: [{ text: 'SYSTEM-ROW', tone: 'default' }], compactSummary: 'SYSTEM-ROW' }),
  card(201, { key: 'light-tool-a', category: 'technical', role: 'assistant', lines: [{ text: 'TOOL-A', tone: 'default' }], expandedLines: [{ text: 'TOOL-A', tone: 'default' }], compactSummary: 'TOOL-A' }),
  card(202, { key: 'light-tool-b', category: 'technical', role: 'assistant', lines: [{ text: 'TOOL-B', tone: 'default' }], expandedLines: [{ text: 'TOOL-B', tone: 'default' }], compactSummary: 'TOOL-B' }),
  card(203, { key: 'light-ghost', lines: [], expandedLines: [], compactSummary: '' }),
  card(204, { key: 'light-long', role: 'assistant', lines: LONG_LINES, expandedLines: LONG_LINES, compactSummary: 'LONG-LINE-01' }),
]
const PERSISTED = 200 + 2 // what survives the shaping: the tools as one row and the long reply
const otherCards = [card(0, { key: 'other-card', compactSummary: 'OTHER-SESSION', lines: [{ text: 'OTHER-SESSION', tone: 'default' }], expandedLines: [{ text: 'OTHER-SESSION', tone: 'default' }] })]
const cardsFor = (session: Session) => session.sessionId === OTHER.sessionId ? otherCards : cards
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const SESSIONS = () => [{ ...SESSION }, { ...OTHER }]
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS(), readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const stored: { lightweight: boolean | null } = { lightweight: null }
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiTranscriptView: async () => 'conversation',
  readTuiLightweightWindows: async () => true,
  writeTuiLightweightWindows: async (value: boolean) => { stored.lightweight = value },
  readTuiStickyHeaders: async () => true,
  readTuiSessions: async () => SESSIONS(),
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 160, height: 40, kittyKeyboard: true })
const settle = async (ms = 150) => {
  await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, ms)) })
}
const fail = (message: string): never => {
  console.error(`${message}\n${setup.captureCharFrame()}`)
  process.exit(1)
}
const waitFor = async (what: string, test: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (test()) return
    await settle(80)
  }
  fail(`Timed out: ${what}`)
}
const press = async (value: string) => {
  await act(async () => { setup.mockInput.pressKey(value) })
  await settle(200)
}
const frame = () => setup.captureCharFrame()
const hint = () => /↑ (\d+) earlier messages? — k\/g to load/.exec(frame())?.[1] ?? null
const scroll = () => setup.renderer.root.findDescendantById('transcript-scroll') as unknown as Renderable & { scrollTop: number; scrollHeight: number }
// Every mounted card, by the key in its `card:` id.
const mountedCards = (): string[] => {
  const keys: string[] = []
  const walk = (node: Renderable) => {
    if (node.id?.startsWith('card:')) keys.push(node.id.slice(5))
    for (const child of node.getChildren()) walk(child as Renderable)
  }
  const sb = scroll()
  if (sb) walk(sb)
  return keys
}
const toTop = async () => {
  await act(async () => { scroll().scrollTop = 0 })
  await settle(200)
}

try {
  await settle(2500)
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the tail to show', () => frame().includes('LONG-LINE-01'))
  if (frame().includes('CONVERSATION ·')) fail('a lightweight window drew a view header')

  // 1. Every card starts folded, even a reply CONVERSATION would open.
  if (frame().includes('LONG-LINE-14')) fail('the long reply was not folded')
  // 2. The old pane's shaping, whatever the view.
  const mounted = mountedCards()
  if (mounted.includes('light-system') || frame().includes('SYSTEM-ROW')) fail('the bookkeeping row was not dropped')
  if (mounted.includes('light-tool-a') || mounted.includes('light-tool-b') || !mounted.some((key) => key.startsWith('agents-tools:light-tool-a:light-tool-b:2'))) {
    fail(`the two tool calls were not grouped: ${mounted.slice(-5).join(', ')}`)
  }
  if (mounted.includes('light-ghost')) fail('the empty placeholder was not dropped')

  // The tail page, and g loading one page at a time.
  await toTop()
  if (hint() !== String(PERSISTED - 80)) fail(`the tail mounted more or less than a page: ${hint()} hidden`)
  await press('g')
  await waitFor('g to keep the cursor on the old first card', () => frame().includes(label(PERSISTED - 80)))
  await toTop()
  if (hint() !== String(PERSISTED - 160)) fail(`g did not load one page: ${hint()} hidden`)

  // 3. The loaded pages survive a remount: the window shows another session's
  // tab and comes back.
  await act(async () => { setup.mockInput.pressTab() })
  await settle(200)
  await press('j')
  await settle(500)
  await act(async () => { setup.mockInput.pressTab() })
  await waitFor('the other session', () => frame().includes('OTHER-SESSION'))
  await act(async () => { setup.mockInput.pressArrow('left') })
  await waitFor('the first session again', () => !frame().includes('OTHER-SESSION') && frame().includes('MESSAGE-'))
  await settle(400)
  await toTop()
  if (hint() !== String(PERSISTED - 160)) fail(`coming back dropped the loaded pages: ${hint()} hidden`)

  await press('g')
  await waitFor('the last page', () => frame().includes(label(PERSISTED - 160)))
  await toTop()
  if (hint() !== null) fail('the whole transcript should be loaded')
  // A remounted window grows its mounted slice back over a few frames.
  await waitFor('the first message once everything is loaded', () => {
    scroll().scrollTop = 0
    return frame().includes(label(0))
  })

  // Tab in the view menu turns it off: the same view, drawn normally.
  await press('v')
  await waitFor('the view menu', () => frame().includes('TRANSCRIPT VIEW') && frame().includes('● lightweight windows'))
  await act(async () => { setup.mockInput.pressTab() })
  await settle(200)
  if (!frame().includes('○ lightweight windows')) fail('Tab did not turn lightweight windows off')
  if (stored.lightweight !== false) fail('turning it off was not stored')
  await act(async () => { setup.mockInput.pressEscape() })
  await settle(300)
  await press('G')
  await waitFor('CONVERSATION to open the long reply', () => frame().includes('LONG-LINE-14'))
  if (!mountedCards().includes('light-system')) fail('CONVERSATION should show the bookkeeping row again')
  console.log('Lightweight window smoke passed (folded, shaped, tail pages kept across a remount, Tab toggles it on the current view)')
} finally {
  setup.renderer.destroy()
}
process.exit(0)
