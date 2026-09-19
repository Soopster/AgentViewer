/** @jsxImportSource @opentui/react */
// Chat-card border regression: OpenTUI reuses a technical card when moving
// between Agents and Chat. The native box must clear the Agents border when
// that same keyed card returns to Chat.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-chat-border-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'chat-border-smoke-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Chat border smoke',
  firstPrompt: 'Chat border smoke',
  lastModified: 1_700_000_000_000,
}
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
  compactSummary: 'Done.',
  lines: [{ text: 'Done.', tone: 'default' }],
  expandedLines: [{ text: 'Done.', tone: 'default' }],
  searchText: 'Done.',
  searchHaystackLower: 'done.',
}
const DETAIL = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [CARD, PROSE_CARD],
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
  readTuiTranscriptView: async () => 'chat',
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
const settle = async (ms = 100) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
type CardBox = {
  border: boolean | string[]
  x: number
  y: number
}
const cardBox = (key: string) => setup.renderer.root.findDescendantById(`card:${key}`) as unknown as CardBox | null
const cardOrigin = (card: { x: number; y: number }) => setup.captureCharFrame().split('\n')[card.y]?.[card.x]
const isBorderCorner = (value: string | undefined) => value === '┌' || value === '┏'
const assertBorderless = (key: string, phase: string) => {
  const card = cardBox(key)
  if (!card || !Array.isArray(card.border) || card.border.length !== 0) {
    throw new Error(`${phase} retained a card border for ${key}:\n${setup.captureCharFrame()}`)
  }
}
const assertBordered = (key: string) => {
  const card = cardBox(key)
  if (!card || !Array.isArray(card.border) || card.border.length !== 4) {
    throw new Error(`Agents did not render the expected card border for ${key}:\n${setup.captureCharFrame()}`)
  }
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(500)
  assertBorderless(CARD.key, 'Initial Chat')
  assertBorderless(PROSE_CARD.key, 'Initial Chat')

  // Chat is the final menu item; Agents is immediately above it. Both reuse
  // this technical card's key, which exercises the native prop transition.
  act(() => { setup.mockInput.pressKey('v') })
  await settle()
  act(() => { setup.mockInput.pressArrow('up') })
  act(() => { setup.mockInput.pressEnter() })
  await settle()
  assertBordered(CARD.key)
  assertBordered(PROSE_CARD.key)
  const agentsToolCard = cardBox(CARD.key)
  if (!agentsToolCard || !isBorderCorner(cardOrigin(agentsToolCard))) {
    throw new Error(`Agents card border was not painted:\n${setup.captureCharFrame()}`)
  }

  act(() => { setup.mockInput.pressKey('v') })
  await settle()
  act(() => { setup.mockInput.pressArrow('down') })
  act(() => { setup.mockInput.pressEnter() })
  await settle()
  assertBorderless(CARD.key, 'Returned Chat')
  assertBorderless(PROSE_CARD.key, 'Returned Chat')
  const returnedToolCard = cardBox(CARD.key)
  if (!returnedToolCard || isBorderCorner(cardOrigin(returnedToolCard))) {
    throw new Error(`Returned Chat still painted the Agents card border:\n${setup.captureCharFrame()}`)
  }

  console.log('OpenTUI chat view border smoke passed')
} finally {
  act(() => { setup.renderer.destroy() })
}
