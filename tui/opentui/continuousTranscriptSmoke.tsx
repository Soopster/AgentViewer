/** @jsxImportSource @opentui/react */
// TRANSCRIPT view, after opencode's session view: prompts are ruled bands,
// replies are unmarked prose sharing the prompt's text column, and a turn ends
// with a footer naming who answered and how long it took.
//
// The rendering is the contract here, and it is invisible to a type-checker —
// the view is a set of prop choices inside the stream branch, so the only way
// to know a message kept its rule or lost its marker is to render it and read
// the frame back.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-continuous-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'continuous-smoke-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Continuous transcript smoke',
  firstPrompt: 'Continuous transcript smoke',
  lastModified: 1_700_000_000_000,
}
const card = (
  key: string,
  role: 'user' | 'assistant',
  label: string,
  text: string,
  category: TuiTranscriptCard['category'],
): TuiTranscriptCard => ({
  key,
  role,
  provider: 'claude',
  label,
  category,
  autoFold: category === 'technical',
  compactSummary: text,
  lines: [{ text, tone: category === 'technical' ? 'tool' : 'default' }],
  expandedLines: [{ text, tone: category === 'technical' ? 'tool' : 'default' }],
  searchText: text,
  searchHaystackLower: text.toLowerCase(),
})

const USER = card('continuous-user', 'user', 'You', 'Refactor the pool.', 'conversation')
const ASSISTANT = card('continuous-assistant', 'assistant', 'Assistant', 'Reading the pool now.', 'conversation')
const TOOL = { ...card('continuous-tool', 'assistant', 'Bash', 'tool Bash: pwd', 'technical'), durationLabel: '3.2s' }

const DETAIL = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [USER, ASSISTANT, TOOL],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
}

let startingView = 'transcript'
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
  readTuiTranscriptView: async () => startingView,
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
const settle = async (ms = 150) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

type Box = { border: boolean | string[]; x: number; y: number; width: number; height: number }
const cardBox = (key: string) => setup.renderer.root.findDescendantById(`card:${key}`) as unknown as Box | null
// The rule is on the body box *inside* the keyed card, so read the painted
// frame rather than the outer box's own border prop.
const ruleColumn = (key: string): string[] => {
  const box = cardBox(key)
  if (!box) throw new Error(`no card box for ${key}:\n${setup.captureCharFrame()}`)
  const lines = setup.captureCharFrame().split('\n')
  const column: string[] = []
  for (let y = box.y; y < box.y + box.height; y += 1) {
    const ch = lines[y]?.[box.x]
    if (ch !== undefined) column.push(ch)
  }
  return column
}
const hasRule = (key: string) => ruleColumn(key).some((ch) => ch === '│' || ch === '┃' || ch === '▏')

const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(600)

  const frame = setup.captureCharFrame()
  // DUMP_FRAME=1 prints the rendered transcript: this file asserts on a picture,
  // and reading the picture is how you work out why an assertion moved.
  if (process.env.DUMP_FRAME) console.log(frame)
  if (!frame.includes('Reading the pool now.')) fail('TRANSCRIPT did not render the assistant message')

  // ── only the prompt is ruled ─────────────────────────────────────────────
  // The band is the turn boundary; a rule on every reply is what made the old
  // view read as a stack of boxes rather than as a conversation.
  if (!hasRule(USER.key)) fail('TRANSCRIPT left the prompt without its rule')
  for (const key of [ASSISTANT.key, TOOL.key]) {
    if (hasRule(key)) fail(`TRANSCRIPT ruled ${key}; only prompts carry a rule`)
  }

  // ── prompts, replies and the turn footer share one text column ──────────
  if (!frame.includes('Claude · 3.2s')) fail('TRANSCRIPT did not close the turn with its footer')
  {
    const lines = frame.split('\n')
    const column = (needle: string) => {
      const line = lines.find((row) => row.includes(needle))
      if (!line) fail(`no row contains ${needle}`)
      return line!.indexOf(needle)
    }
    const promptColumn = column('Refactor the pool.')
    if (promptColumn !== column('Reading the pool now.')) {
      fail('TRANSCRIPT reply text does not start in the prompt text column')
    }
    if (promptColumn !== column('Claude · 3.2s')) {
      fail('TRANSCRIPT turn footer does not start in the prompt text column')
    }
  }

  // ── the prompt is a padded band ──────────────────────────────────────────
  // A blank row above and below the text inside the band is what makes it read
  // as a panel rather than a highlighted line.
  {
    const box = cardBox(USER.key)!
    const lines = frame.split('\n')
    const textRow = lines.findIndex((row) => row.includes('Refactor the pool.'))
    if (textRow <= box.y) fail('TRANSCRIPT prompt band has no padding above its text')
  }

  // Only the turn's last reply carries it.
  if (frame.split('Claude · ').length !== 2) fail('TRANSCRIPT painted the footer on more than one reply')

  // ── two messages never touch ─────────────────────────────────────────────
  // The rule is the only separator, so abutting messages read as one message
  // with a colour change halfway down.
  {
    const assistantBox = cardBox(ASSISTANT.key)!
    const toolBox = cardBox(TOOL.key)!
    if (toolBox.y <= assistantBox.y + assistantBox.height) {
      fail('TRANSCRIPT ran two messages together; each needs a blank line after it')
    }
  }

  // ── and no per-line markers ──────────────────────────────────────────────
  // The markers are what stop a transcript reading as prose; the rule already
  // says whose message it is. `❯` doubles as the composer prompt glyph, so
  // only the transcript region is searched.
  const transcriptTop = cardBox(USER.key)!.y
  const transcriptBottom = cardBox(TOOL.key)!.y + cardBox(TOOL.key)!.height
  const transcriptRegion = frame.split('\n').slice(transcriptTop, transcriptBottom).join('\n')
  for (const marker of ['❯', '•', '▸']) {
    if (transcriptRegion.includes(marker)) {
      fail(`TRANSCRIPT painted a ${marker} marker; the rule is meant to be the only chrome`)
    }
  }

  // ── the neighbouring stream-like view is unchanged ───────────────────────
  // TRANSCRIPT shares the stream render path with STREAM and CHAT, so it is one
  // prop away from silently redefining them for everyone already using them.
  // CHAT sits immediately above TRANSCRIPT in the view menu; if that ordering
  // ever changes, a card view lands here instead and its full border fails the
  // no-rule assertion rather than passing quietly.
  act(() => { setup.mockInput.pressKey('v') })
  await settle()
  act(() => { setup.mockInput.pressArrow('up') })
  act(() => { setup.mockInput.pressEnter() })
  await settle(400)
  const streamFrame = setup.captureCharFrame()
  if (!streamFrame.includes('Reading the pool now.')) fail('The neighbouring view did not render the transcript')
  if (hasRule(ASSISTANT.key)) fail('A stream-like view must keep its rule for user prompts alone')
  if (!streamFrame.includes('•') && !streamFrame.includes('❯')) {
    fail('A stream-like view must keep its per-line markers')
  }

  console.log('Continuous transcript smoke passed (ruled prompt band, aligned replies, turn footer, no markers, neighbouring view unchanged)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
