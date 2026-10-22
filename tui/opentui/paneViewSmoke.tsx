/** @jsxImportSource @opentui/react */
// PANE (`v`): the lightweight window view. It mounts the transcript's tail,
// says how much is above it, and loads a page at a time as the cursor walks
// back — and draws no view header or sticky prompt.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-pane-view-'))
process.env.SHELL = '/bin/sh'
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const SESSION: Session = { sessionId: 'pane-view', provider: 'claude', cwd: CWD, summary: 'Pane view', firstPrompt: 'Pane view', lastModified: 1_700_000_000_000 }
const CARD_COUNT = 200
const label = (index: number) => `MESSAGE-${String(index).padStart(3, '0')}`
const cards: TuiTranscriptCard[] = Array.from({ length: CARD_COUNT }, (_, index) => ({
  key: `pane-card-${index}`, role: index % 2 === 0 ? 'user' : 'assistant', provider: 'claude', label: 'Assistant',
  category: 'conversation', autoFold: false, compactSummary: label(index),
  lines: [{ text: label(index), tone: 'default' }], expandedLines: [{ text: label(index), tone: 'default' }],
  searchText: index === 5 ? `${label(index)} needle` : label(index),
  searchHaystackLower: (index === 5 ? `${label(index)} needle` : label(index)).toLowerCase(),
}))
const detail = {
  info: { sessionId: SESSION.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cards,
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
}
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => [{ ...SESSION }], readTuiSessionDetailAsync: async () => detail }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: () => cards, formatTranscriptCardsAsync: async () => cards }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiTranscriptView: async () => 'pane',
  readTuiStickyHeaders: async () => true,
  readTuiSessions: async () => [{ ...SESSION }],
  readTuiSessionDetail: async () => detail,
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
const hint = () => /↑ (\d+) earlier messages? — k\/g to load/.exec(setup.captureCharFrame())?.[1] ?? null

try {
  await settle(2500)
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('the tail to show', () => setup.captureCharFrame().includes(label(CARD_COUNT - 1)))
  if (setup.captureCharFrame().includes('CONVERSATION ·') || setup.captureCharFrame().includes('PANE ·')) fail('PANE drew a view header')
  // The hint heads the mounted cards; read it from the top of the scroll.
  const toTop = async () => {
    await act(async () => { (setup.renderer.root.findDescendantById('transcript-scroll') as unknown as { scrollTop: number }).scrollTop = 0 })
    await settle(200)
  }
  await toTop()
  if (hint() !== String(CARD_COUNT - 80)) fail(`the tail mounted more or less than a page: ${hint()} hidden`)
  // g walks to the first loaded card and loads the page before it; the cursor
  // stays on that card while older ones appear above.
  await press('g')
  await waitFor('g to keep the cursor on the old first card', () => setup.captureCharFrame().includes(label(CARD_COUNT - 80)))
  await toTop()
  if (hint() !== String(CARD_COUNT - 160)) fail(`g did not load one page: ${hint()} hidden`)
  await press('g')
  await waitFor('the next page', () => setup.captureCharFrame().includes(label(CARD_COUNT - 160)))
  await toTop()
  if (hint() !== null) fail('the whole transcript should be loaded')
  if (!setup.captureCharFrame().includes(label(0))) fail('the first message is not reachable once everything is loaded')
  console.log('PANE view smoke passed (tail mount, earlier-messages hint, g loads a page at a time, no view header)')
} finally {
  setup.renderer.destroy()
}
process.exit(0)
