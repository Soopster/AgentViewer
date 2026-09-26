/** @jsxImportSource @opentui/react */
// Full-App check of watching teammates (herdr's every-agent-on-screen): from
// the Teammates panel, `O` must put the team's transcripts in split panes
// beside the lead's chat, in attention order. The popover smoke pins the key
// and splitPaneSmoke the planner; this is the only check that the panes
// actually mount with the teammates' transcripts in them.
//
// Teammates join as external participants so no provider runs; the one seam
// mocked is the transcript resolver, which refuses external participants, so
// each teammate maps to a fixture session whose transcript names it.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-watch-smoke-'))
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const LEAD: Session = { sessionId: 'watch-lead', provider: 'claude', cwd: CWD, summary: 'Lead chat', firstPrompt: 'Lead chat', lastModified: 1_700_000_000_000 }
const transcriptText = (sessionId: string) => `${sessionId.toUpperCase()}-TRANSCRIPT`
const card = (sessionId: string): TuiTranscriptCard => ({
  key: `${sessionId}-card`,
  role: 'assistant',
  provider: 'claude',
  label: 'Assistant',
  category: 'conversation',
  autoFold: false,
  compactSummary: transcriptText(sessionId),
  lines: [{ text: transcriptText(sessionId), tone: 'default' }],
  expandedLines: [{ text: transcriptText(sessionId), tone: 'default' }],
  searchText: transcriptText(sessionId),
  searchHaystackLower: transcriptText(sessionId).toLowerCase(),
})
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [card(session.sessionId)],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
})

const coord = await import('../../lib/agentCoordination')
await coord.configureInteractiveCoordinator({ sessionId: LEAD.sessionId, provider: 'claude', cwd: CWD, autoContinue: false })
const lead = await coord.sessionCoordinatorIdentity(LEAD.sessionId, 'claude')
await coord.joinExternalProtocolRun({ runId: lead.runId, participantName: 'nova', provider: 'claude', cwd: CWD })
const orion = (await coord.joinExternalProtocolRun({ runId: lead.runId, participantName: 'orion', provider: 'claude', cwd: CWD })).participant
// Orion needs the lead, so it leads the roster and must get the first pane.
await coord.sendExternalProtocolMessage(orion, { to: 'lead', body: 'Strict or compatible parser?', replyRequired: true })

const splitState = await import('./splitPaneState')
mock.module('./splitPaneState', () => ({
  ...splitState,
  resolveCoordinationTranscriptTarget: (agent: { name: string }) => {
    const session: Session = { sessionId: `watch-${agent.name}`, provider: 'claude', cwd: CWD, summary: agent.name, lastModified: 1_700_000_000_000 }
    return { kind: 'open', sessionKey: splitState.transcriptSessionKey(session), session, indexed: false }
  },
}))
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [LEAD],
  readTuiSessionDetailAsync: async (session: Session) => detailFor(session),
}))
// A split pane formats its cards from the threaded transcript itself.
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({
  ...threadingClient,
  getTranscriptCardsSync: (session: Session) => [card(session.sessionId)],
  formatTranscriptCardsAsync: async (session: Session) => [card(session.sessionId)],
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [LEAD],
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 230, height: 44, kittyKeyboard: true })
const settle = async (ms = 150) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const fail = (message: string): never => {
  console.error(`${message}\n${setup.captureCharFrame()}`)
  process.exit(1)
}
const waitFor = async (label: string, check: (frame: string) => boolean) => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (check(setup.captureCharFrame())) return
    await settle(80)
  }
  fail(`Timed out: ${label}`)
}

await settle(2500)
act(() => { setup.mockInput.pressEnter() })
await waitFor('the lead chat to open', (frame) => frame.includes(transcriptText('watch-lead')))

act(() => { setup.mockInput.pressKey('k', { ctrl: true }) })
await settle(80)
act(() => { setup.mockInput.pressKey('t') })
await waitFor('the Teammates panel to list the team', (frame) => frame.includes('orion') && frame.includes('nova'))

act(() => { setup.mockInput.pressKey('O') })
await waitFor('both teammates to be watched beside the lead', (frame) =>
  frame.includes(transcriptText('watch-orion')) && frame.includes(transcriptText('watch-nova')))

const frame = setup.captureCharFrame()
if (!frame.includes(transcriptText('watch-lead'))) fail('watching the team replaced the lead chat in the reader')
if (frame.includes('─ Teammates ─')) fail('the Teammates panel stayed open over the panes')
// Attention order: the teammate asking the lead gets the first pane, drawn
// left of the other. Columns are compared wherever each transcript landed, so
// the check cannot pass by the two never sharing a row.
const columnOf = (needle: string) => {
  for (const line of frame.split('\n')) {
    const x = line.indexOf(needle)
    if (x >= 0) return x
  }
  return fail(`${needle} is not on screen`)
}
if (columnOf(transcriptText('watch-orion')) > columnOf(transcriptText('watch-nova'))) {
  fail('the teammate waiting on the lead did not get the first pane')
}

console.log('Teammates watch smoke passed (O puts the team in split panes beside the lead, in attention order)')
process.exit(0)
