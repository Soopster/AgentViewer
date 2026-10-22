/** @jsxImportSource @opentui/react */
// The sticky prompt header names the turn that owns the top of the viewport.
// Near the tail a newer prompt is usually on screen too, and a header still
// showing the older one reads as the question being answered below it. Pins:
// a multi-line prompt is read as one line, a newer prompt in view takes over
// the header, and scrolling it out of view hands the header back.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-sticky-header-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'sticky-header-smoke-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Sticky header smoke',
  firstPrompt: 'Sticky header smoke',
  lastModified: 1_700_000_000_000,
}
const card = (key: string, role: 'user' | 'assistant', lines: string[]): TuiTranscriptCard => ({
  key,
  role,
  provider: 'claude',
  label: role === 'user' ? 'You' : 'Assistant',
  category: 'conversation',
  autoFold: false,
  compactSummary: lines[0] ?? '',
  lines: lines.map((text) => ({ text, tone: 'default' as const })),
  expandedLines: lines.map((text) => ({ text, tone: 'default' as const })),
  searchText: lines.join('\n'),
  searchHaystackLower: lines.join('\n').toLowerCase(),
})
const replies = (prefix: string, count: number) => Array.from({ length: count }, (_, reply) => card(
  `${prefix}-${reply}`,
  'assistant',
  Array.from({ length: 6 }, (_, row) => `${prefix} ${reply} row ${row}`),
))

const DETAIL = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [
    card('first-prompt', 'user', ['Do', '5. Summarise the groups']),
    ...replies('long', 16),
    card('second-prompt', 'user', ['Roll that back']),
    card('tail', 'assistant', ['Rolled back.']),
  ],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
}

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION],
  readTuiSessionDetailAsync: async () => DETAIL,
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiTranscriptView: async () => 'scrollback',
  readTuiStickyHeaders: async () => true,
  writeTuiTranscriptView: async () => {},
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms = 200) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}
const headerRow = () => setup.captureCharFrame().split('\n').find((row) => row.includes('▌ PROMPT')) ?? null
type Scroll = { scrollTop: number; scrollHeight: number; viewport: { height: number } }
// The focused window's transcript (every session is shown in a window).
const scroll = () => setup.renderer.root.findDescendantById('split-scroll:0') as unknown as Scroll

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(800)
  if (process.env.DUMP_FRAME) console.log(setup.captureCharFrame())

  const atTail = headerRow()
  if (!atTail) fail('No sticky header at the tail')
  if (!atTail!.includes('Roll that back')) fail('A newer prompt on screen did not take over the header')

  // Scroll the newer prompt out of view; the older turn owns the top again.
  act(() => { scroll().scrollTop = Math.max(scroll().scrollHeight - scroll().viewport.height - 40, 10) })
  await settle(600)
  const midway = headerRow()
  if (!midway?.includes('Do 5. Summarise the groups')) fail('The sticky header did not read a multi-line prompt as one line, or lost it mid-transcript')
  if (midway!.includes('Roll that back')) fail('The header named a newer prompt that is not on screen')
} finally {
  setup.renderer.destroy()
}
console.log('Sticky header smoke passed (newer prompt in view takes over, multi-line prompt, handed back off screen)')
process.exit(0)
