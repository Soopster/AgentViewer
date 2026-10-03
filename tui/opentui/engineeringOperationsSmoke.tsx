/** @jsxImportSource @opentui/react */
// Real-root engineering operations: grouped failures, inspection, and empty-session composition.
// Fixture data is deterministic; no provider sends are performed.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

const fixtureDirectory = path.join(mkdtempSync(path.join(tmpdir(), 'agent-viewer-engineering-shell-')), 'agentViewer')
mkdirSync(fixtureDirectory)
process.chdir(fixtureDirectory)
let fixtureTheme: 'light' | 'dark' = 'dark'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'engineering-shell-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Coordinator recovery review',
  firstPrompt: 'Coordinator recovery review',
  lastModified: Date.now() - 12 * 60_000,
}
const SESSIONS = [SESSION, ...['Provider compatibility', 'Tab activity indicators', 'Interactive coordination'].map((summary, index) => ({ ...SESSION, sessionId: `engineering-${index}`, summary, lastModified: SESSION.lastModified - (index + 1) * 3_600_000 }))]
const CARD: TuiTranscriptCard = {
  key: 'chat-border-tool',
  role: 'assistant',
  provider: 'claude',
  label: 'Bash',
  category: 'technical',
  autoFold: true,
  compactSummary: 'tool Bash: pwd',
  lines: [{ text: 'tool Bash: pwd', tone: 'tool' }],
  expandedLines: [{ text: 'tool Bash: pwd', tone: 'tool' }],
  searchText: 'pwd',
  searchHaystackLower: 'pwd',
}
const PROSE_CARD: TuiTranscriptCard = {
  key: 'chat-border-prose',
  role: 'assistant',
  provider: 'claude',
  label: 'Assistant',
  category: 'conversation',
  autoFold: false,
  compactSummary: 'The recovery path needs to distinguish observed delivery from a settled result.',
  lines: [{ text: 'The recovery path needs to distinguish observed delivery from a settled result. Keep uncertain operations visible until inspection resolves them; restarting must preserve the pending operation.', tone: 'default' }],
  expandedLines: [{ text: 'The recovery path needs to distinguish observed delivery from a settled result. Keep uncertain operations visible until inspection resolves them; restarting must preserve the pending operation.', tone: 'default' }],
  searchText: 'Done.',
  searchHaystackLower: 'done.',
}
const USER_CARD: TuiTranscriptCard = {
  ...PROSE_CARD, key: 'engineering-user', role: 'user', label: 'You',
  lines: [{ text: 'Inspect coordinator recovery and show the changes needed for a reliable handoff.', tone: 'default' }],
  expandedLines: [{ text: 'Inspect coordinator recovery and show the changes needed for a reliable handoff.', tone: 'default' }],
}
const DETAIL = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [USER_CARD, CARD, PROSE_CARD],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
}

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => SESSIONS,
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
  readTuiTheme: async () => fixtureTheme,
  readTuiTranscriptView: async () => 'agents',
  readTuiTranscriptWidth: async () => 'readable',
  writeTuiTranscriptWidth: async () => {},
  writeTuiTranscriptView: async () => {},
  readTuiSessions: async () => SESSIONS,
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const tools: TuiTranscriptCard[] = Array.from({ length: 8 }, (_, index) => ({
  ...CARD,
  key: `engineering-operation-${index}`,
  label: index === 0 ? 'Bash' : 'Read',
  pending: index === 7,
  lines: [
    { text: index === 0 ? 'tool Bash: npm run check' : `tool Read: lib/recovery/step-${index}.ts`, tone: 'tool' },
    { text: index === 0 ? '✗ exit 1: invariant violated' : index === 7 ? 'running' : '✓ complete', tone: index === 0 ? 'result_error' : index === 7 ? 'dim' : 'result_ok' },
  ],
  expandedLines: [
    { text: index === 0 ? 'tool Bash: npm run check' : `tool Read: lib/recovery/step-${index}.ts`, tone: 'tool' },
    { text: index === 0 ? '✗ exit 1: invariant violated' : index === 7 ? 'running' : '✓ complete', tone: index === 0 ? 'result_error' : index === 7 ? 'dim' : 'result_ok' },
    { text: index === 0 ? 'Recovery requires an explicit inspection before retry.' : `export const step${index} = true`, tone: 'default' },
  ],
}))
DETAIL.transcriptCards = [USER_CARD, ...tools, PROSE_CARD]
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async () => {
  await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 500)) })
}
const frame = () => setup.captureCharFrame()
const fail = (message: string): never => { throw new Error(`${message}\n${frame()}`) }
try {
  await settle()
  act(() => { setup.mockInput.pressEnter() })
  await settle()
  if (!frame().includes('8 tool calls') || !frame().includes('failed') || !frame().includes('running')) fail('Collapsed operations hid their failure state')
  writeFileSync('/tmp/engineering-dense-120.json', JSON.stringify(setup.captureSpans(), null, 2))
  act(() => { setup.mockInput.pressKey('k') })
  act(() => { setup.mockInput.pressKey('e') })
  await settle()
  for (const card of tools) {
    if (!setup.renderer.root.findDescendantById(`card:${card.key}`)) fail(`Expanded group lost ${card.key}`)
  }
  // The first nested operation is selected on expansion; inspect its output.
  act(() => { setup.mockInput.pressKey('e') })
  await settle()
  if (!frame().includes('invariant violated')) fail('Failed command output was inaccessible')
  writeFileSync('/tmp/engineering-error-120.json', JSON.stringify(setup.captureSpans(), null, 2))
  act(() => { setup.mockInput.pressKey('c') })
  await settle()
  await act(async () => { await setup.mockInput.typeText('Fix the recovery invariant') })
  await settle()
  if (!frame().includes('Fix the recovery invariant')) fail('Dense group blocked the composer')
  console.log('Engineering dense operations passed: collapsed failure, eight nested tools, error output, composer')
} finally {
  act(() => { setup.renderer.destroy() })
}
DETAIL.transcriptCards = []
SESSION.sessionId = 'engineering-empty-session'
const empty = await testRender(<OpenTuiApp />, { width: 100, height: 24, kittyKeyboard: true })
const settleEmpty = async () => {
  await act(async () => { await empty.flush(); await new Promise(resolve => setTimeout(resolve, 500)) })
}
try {
  await settleEmpty()
  act(() => { empty.mockInput.pressEnter() })
  await settleEmpty()
  const emptyFrame = empty.captureCharFrame()
  if (!emptyFrame.includes('Start an engineering task') || !emptyFrame.includes('Press c') || !emptyFrame.includes('? help')) {
    throw new Error(`Empty session lost its start/help affordances:\n${emptyFrame}`)
  }
  writeFileSync('/tmp/engineering-empty-100.json', JSON.stringify(empty.captureSpans(), null, 2))
  act(() => { empty.mockInput.pressKey('c') })
  await settleEmpty()
  await act(async () => { await empty.mockInput.typeText('Start an engineering review') })
  await settleEmpty()
  if (!empty.captureCharFrame().includes('Start an engineering review')) {
    throw new Error(`Empty session did not accept a draft:\n${empty.captureCharFrame()}`)
  }
  console.log('Engineering empty session passed: visible start/help affordances and working composer')
} finally {
  act(() => { empty.renderer.destroy() })
}
process.exit(0)
