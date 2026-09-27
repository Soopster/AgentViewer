/** @jsxImportSource @opentui/react */
// Real-root layout and keyboard regression at narrow, standard and wide sizes.
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
  readTuiTranscriptView: async () => 'chat',
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

const { default: OpenTuiApp } = await import('./App')
for (const [width, height] of [[80, 40], [120, 40], [200, 40], [100, 24]]) {
  fixtureTheme = width === 80 ? 'light' : 'dark'
  SESSION.sessionId = `engineering-shell-${width}`
  const setup = await testRender(<OpenTuiApp />, { width, height, kittyKeyboard: true })
  const settle = async () => {
    await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 1200)) })
  }
  try {
    await settle()
    const frame = setup.captureCharFrame()
    const footer = frame.trimEnd().split('\n').at(-1) ?? ''
    if (!footer.includes('commands') || !footer.includes('? help')) {
      throw new Error(`Command discovery missing at ${width} columns:\n${frame}`)
    }
    act(() => { setup.mockInput.pressEnter() })
    await settle()
    const focused = setup.captureCharFrame()
    if (!focused.includes('c compose')) throw new Error(`Reader shortcuts missing at ${width}:\n${focused}`)
    const node = (id: string) => setup.renderer.root.findDescendantById(id) as unknown as { x: number; y: number; width: number; height: number } | null
    const reader = node('transcript-reader')
    const prose = node(`card:${PROSE_CARD.key}`)
    if (!reader || !prose || prose.x > reader.x + 5 || prose.width > 114) {
      throw new Error(`Readable layout lost its bounded left alignment at ${width}: ${JSON.stringify({ reader: reader && { x: reader.x, width: reader.width }, prose: prose && { x: prose.x, width: prose.width } })}`)
    }
    writeFileSync(`/tmp/engineering-tui-${width}.txt`, focused)
    writeFileSync(`/tmp/engineering-tui-${width}.json`, JSON.stringify(setup.captureSpans(), null, 2))
    // All three layouts remain reachable; changing width must not lose cards.
    for (const mode of ['centered', 'full', 'readable']) {
      act(() => { setup.mockInput.pressKey('W') })
      await settle()
      const card = node(`card:${PROSE_CARD.key}`)
      if (!card) throw new Error(`${mode} lost the transcript`)
      if (width === 200 && (
        (mode === 'centered' && card.x <= reader.x + 5)
        || (mode === 'full' && card.width <= 144)
        || (mode === 'readable' && (card.width > 114 || card.x > reader.x + 5))
      )) throw new Error(`${mode} did not apply its layout geometry: reader=${reader.x}/${reader.width}, card=${card.x}/${card.width}\n${setup.captureCharFrame()}`)
    }
    // Inspect the reference's Agents presentation at every supported width.
    act(() => { setup.mockInput.pressKey('v') })
    await settle()
    act(() => { setup.mockInput.pressArrow('up') })
    act(() => { setup.mockInput.pressEnter() })
    await settle()
    const agentsFrame = setup.captureCharFrame()
    for (const card of [USER_CARD, CARD, PROSE_CARD]) {
      const rendered = node(`card:${card.key}`)
      if (!rendered || rendered.x < reader.x || rendered.x + rendered.width > reader.x + reader.width) {
        throw new Error(`Agents card escaped the reader at ${width}: ${card.key}`)
      }
    }
    if (!agentsFrame.includes('pending operation.') || !agentsFrame.includes('pwd')) {
      throw new Error(`Agents lost conversation or tool content at ${width}:\n${agentsFrame}`)
    }
    const agentsDock = node('composer-dock')
    if (!agentsDock || agentsDock.height !== 4 || agentsDock.x < reader.x
      || agentsDock.y + agentsDock.height > reader.y + reader.height
      || agentsFrame.includes('COMPOSER') || agentsFrame.includes('watching the wire')) {
      throw new Error(`Agents composer was not compact and inside the reader at ${width}x${height}:\n${agentsFrame}`)
    }
    writeFileSync(`/tmp/engineering-agents-${width}.txt`, agentsFrame)
    writeFileSync(`/tmp/engineering-agents-${width}.json`, JSON.stringify(setup.captureSpans(), null, 2))
    act(() => { setup.mockInput.pressKey('c') })
    await settle()
    await act(async () => { await setup.mockInput.typeText('Review the recovery edge cases') })
    await settle()
    if (height === 24) {
      await act(async () => { await setup.mockInput.typeText(' long draft'.repeat(100)) })
      await settle()
      const dock = node('composer-dock')
      const scroll = node('transcript-scroll')
      if (!dock || !scroll || dock.height > Math.floor(height * 0.35)
        || dock.y + dock.height >= height || scroll.height < 8) {
        throw new Error(`Long draft displaced the reader at ${width}x${height}:\n${setup.captureCharFrame()}`)
      }
      writeFileSync(`/tmp/engineering-composer-${width}.json`, JSON.stringify(setup.captureSpans(), null, 2))
    }
    const composing = setup.captureCharFrame()
    if ((height !== 24 && !composing.includes('Review the recovery')) || !composing.includes('send')) {
      throw new Error(`Composer input or submit hint missing at ${width}:\n${composing}`)
    }
  } finally {
    act(() => { setup.renderer.destroy() })
  }
}
console.log('Engineering shell render smoke passed at 80, 120 and 200 columns and 100x24 with a long draft')
process.exit(0)
