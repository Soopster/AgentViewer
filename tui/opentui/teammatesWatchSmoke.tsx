/** @jsxImportSource @opentui/react */
// Full-App check of watching teammates (herdr's every-agent-on-screen): from
// the Teammates panel, `O` must put the team's transcripts in split panes
// beside the lead's chat, in stable registration order. The popover smoke pins the key
// and splitPaneSmoke the planner; this is the only check that the panes
// actually mount with the teammates' transcripts in them.
//
// Teammates join as external participants so no provider runs; the one seam
// mocked is the transcript resolver, which refuses external participants, so
// each teammate maps to a fixture session whose transcript names it.
import React from 'react'
import { testRender, act } from './testRender'
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
// Orion needs the lead and leads the roster, but watching must preserve registration order.
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
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (check(setup.captureCharFrame())) return
    await settle(80)
  }
  fail(`Timed out: ${label}`)
}

await settle(2500)
act(() => { setup.mockInput.pressEnter() })
await waitFor('the lead chat to open', (frame) => frame.includes(transcriptText('watch-lead')))
// Herdr's rollup: the lead chat's session row says its team needs the user,
// without opening the Teammates panel.
await waitFor('the lead chat row to carry its team\'s mark', (frame) =>
  frame.split('\n').some((line) => line.includes('!1') && line.includes('│') && line.indexOf('!1') < 34))

act(() => { setup.mockInput.pressKey('k', { ctrl: true }) })
await settle(80)
act(() => { setup.mockInput.pressKey('t') })
await waitFor('the Teammates panel to list the team', (frame) => frame.includes('orion') && frame.includes('nova'))

act(() => { setup.mockInput.pressKey('O') })
await waitFor('both teammates to be watched beside the lead', (frame) =>
  frame.includes(transcriptText('watch-orion')) && frame.includes(transcriptText('watch-nova')))

const frame = setup.captureCharFrame()
// The rollup reaches the tab strip too, now that the team's chats are tabs.
if (!frame.split('\n').slice(0, 3).some((line) => line.includes('!1 Lead chat'))) fail('the lead chat\'s tab does not carry its team\'s mark')
if (!frame.includes(transcriptText('watch-lead'))) fail('watching the team replaced the lead chat')
if (frame.includes('─ Teammates ─')) fail('the Teammates panel stayed open over the panes')
// Main-stack keeps the lead on the left and teammates in registration order
// top to bottom, even though attention order put Orion first in the popover.
const rowOf = (needle: string) => frame.split('\n').findIndex(line => line.includes(needle))
if (rowOf(transcriptText('watch-nova')) >= rowOf(transcriptText('watch-orion'))) {
  fail('watch run reordered teammates by attention instead of registration')
}
const chord = async (key: string) => {
  act(() => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(80)
  act(() => { setup.mockInput.pressKey(key) })
  await settle(180)
}
// Save the run identity with the ordinary editable workspace.
await chord('w')
act(() => { setup.mockInput.pressKey('s') })
await settle(180)
const { listSavedWindowLayouts } = await import('./windowLayoutStore')
const saved = listSavedWindowLayouts(CWD)[0]!
if (saved?.coordinatorRunId !== lead.runId) fail('saving lost the run binding')
act(() => { setup.mockInput.pressEscape() })
await settle(80)
// A participant joining the watched run appends at the end without moving
// the lead or the original teammates. No provider turn is started by this fixture.
await coord.joinExternalProtocolRun({ runId: lead.runId, participantName: 'lyra', provider: 'claude', cwd: CWD })
await waitFor('a new teammate to append without focus stealing', frame => frame.includes(transcriptText('watch-lyra')) && frame.includes(transcriptText('watch-lead')))
// A short terminal hides Orion. Selecting it brings it into the visible pane,
// retaining the lead in the reader and Nova in overflow.
act(() => { setup.resize(230, 20) })
await settle(250)
// Window 0 is the lead; 1 and 2 are Nova and Orion.
if (setup.renderer.root.findDescendantById('split-pane:2')) fail('short terminal did not hide the second teammate')
await chord('p')
await act(async () => { await setup.mockInput.pasteBracketedText('orion') })
await settle(120)
act(() => { setup.mockInput.pressEnter() })
await waitFor('the hidden teammate to be brought into view', frame => frame.includes(transcriptText('watch-orion')))
if (!setup.captureCharFrame().includes(transcriptText('watch-lead'))) fail('hidden teammate switching replaced the lead')
await chord('u')
act(() => { setup.resize(230, 44) })
await settle(250)
// A watched workspace is one undo step, including its lead selection and pins.
act(() => { setup.mockInput.pressKey('b', { ctrl: true }) })
await settle(80)
act(() => { setup.mockInput.pressKey('u') })
await settle(200)
if (setup.captureCharFrame().includes(transcriptText('watch-orion'))) fail('undo left a watched pane mounted')
if (!setup.captureCharFrame().includes(transcriptText('watch-lead'))) fail('undo lost the original reader')

// Restoring a saved run rehydrates transcripts from the ledger, even though
// this provider's indexed sidebar only contains the lead.
await chord('w')
const savedRow = setup.renderer.root.findDescendantById(`window-layout:saved:${saved.id}`)!
if (!savedRow) fail('saved workspace is missing')
await act(async () => { await setup.mockMouse.click(savedRow.x + 3, savedRow.y) })
await waitFor('the saved run workspace to return', frame => frame.includes(transcriptText('watch-orion')) && frame.includes(transcriptText('watch-nova')))
const after = await service.readTuiProtocolRun(lead.runId)
if (!after?.messages.some(message => message.body === 'Strict or compatible parser?' && message.replyRequired && !message.resolvedAt)) {
  fail('watching or restoring acknowledged the pending question')
}

console.log('Teammates watch smoke passed (O watches the run in stable order with the lead retained; undo restores the workspace)')
process.exit(0)
