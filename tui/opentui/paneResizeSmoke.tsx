/** @jsxImportSource @opentui/react */
// Real-root layout and keyboard regression at narrow, standard and wide sizes.
// Fixture data is deterministic; no provider sends are performed.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

const fixtureDirectory = path.join(mkdtempSync(path.join(tmpdir(), 'agent-viewer-pane-resize-')), 'agentViewer')
mkdirSync(fixtureDirectory)
process.chdir(fixtureDirectory)
const { spawnSync: runFixture } = await import('node:child_process')
runFixture('git', ['init', '-q'], { cwd: fixtureDirectory })
writeFileSync(path.join(fixtureDirectory, 'review-me.ts'), 'export const fixture = true\n')
let fixtureTheme: 'light' | 'dark' = 'dark'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'pane-resize-session',
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
  expandedLines: [{ text: 'tool Bash: pwd', tone: 'tool' }, { text: 'full-only operation output', tone: 'default' }],
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


const { TRANSCRIPT_VIEWS } = await import('./app/commands')
const setup = await testRender(<OpenTuiApp />, { width: 200, height: 48, kittyKeyboard: true })
const settle = async (ms = 80) => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, ms)) }) }
const node = (id: string) => {
  const result = setup.renderer.root.findDescendantById(id)
  if (!result || result.width < 1 || result.height < 1) throw new Error(`Missing visible ${id}\n${setup.captureCharFrame()}`)
  return { x: result.x, y: result.y, width: result.width, height: result.height }
}
const drag = async (id: string, dx: number, dy: number, cancel = false) => {
  const handle = node(id)
  const x = handle.x + Math.floor((handle.width - 1) / 2), y = handle.y + Math.floor((handle.height - 1) / 2)
  await act(async () => { await setup.mockMouse.pressDown(x, y) }); await settle()
  try { node('pane-resize-capture'); node('pane-resize-readout') } catch (error) { throw new Error(`${id} did not start at ${x},${y}: ${String(error)}`) }
  await act(async () => { await setup.mockMouse.moveTo(x + dx, y + dy) }); await settle()
  if (cancel) { await act(async () => { setup.mockInput.pressEscape() }); await settle() }
  await act(async () => { await setup.mockMouse.release(x + dx, y + dy) }); await settle()
  if (setup.renderer.root.findDescendantById('pane-resize-capture')) throw new Error('Drag capture remained after release')
  if (setup.renderer.getSelection()?.getSelectedText?.()) throw new Error('Resizing selected border text')
}
let current = TRANSCRIPT_VIEWS.indexOf('chat')
const choose = async (index: number) => {
  await act(async () => { setup.mockInput.pressKey('v') }); await settle()
  const direction = index < current ? 'up' : 'down'
  for (let step = 0; step < Math.abs(index - current); step++) {
    await act(async () => { setup.mockInput.pressArrow(direction) })
  }
  await act(async () => { setup.mockInput.pressEnter() }); await settle(300)
  current = index
}
try {
  await settle(1500)
  await act(async () => { setup.mockInput.pressEnter() }); await settle(200)
  for (const [index, view] of (process.env.PANE_RESIZE_TOOLS_ONLY ? [[TRANSCRIPT_VIEWS.indexOf('engineering'), 'engineering'] as const] : [...TRANSCRIPT_VIEWS.entries()])) {
    await choose(index)
    const railId = view === 'engineering' ? 'engineering-sessions' : 'session-rail'
    const before = node(railId)
    await drag('pane-resize-sidebar', 6, 0)
    if (node(railId).width !== before.width + 6) throw new Error(`${view}: sidebar did not grow`)
    await drag('pane-resize-sidebar', 4, 0, true)
    if (node(railId).width !== before.width + 6) throw new Error(`${view}: Escape did not restore sidebar width`)
    await drag('pane-resize-sidebar', -6, 0)
    const composer = node('composer-dock')
    await drag('pane-resize-composer', 0, -3)
    if (node('composer-dock').height !== composer.height + 3) throw new Error(`${view}: composer did not grow`)
    await drag('pane-resize-composer', 0, 3)
    if (node('composer-dock').height !== composer.height) throw new Error(`${view}: composer did not shrink`)
    console.log(`${view}: mouse sidebar/composer resize and cancellation passed`)
  }
  const rail = node('engineering-sessions')
  const composer = node('composer-dock')
  if (rail.y + rail.height !== composer.y) throw new Error(`Sidebar does not fill down to the composer: ${JSON.stringify({ rail, composer })}`)
  await act(async () => { await setup.mockMouse.click(composer.x + composer.width - 4, composer.y + 1) }); await settle()
  const inactiveBorder = String((setup.renderer.root.findDescendantById('engineering-sessions') as unknown as { borderColor: unknown }).borderColor)
  await act(async () => { await setup.mockMouse.click(rail.x + 2, rail.y + 1) }); await settle()
  const activeBorder = String((setup.renderer.root.findDescendantById('engineering-sessions') as unknown as { borderColor: unknown }).borderColor)
  if (activeBorder === inactiveBorder) throw new Error(`Sidebar focus did not light its border: ${inactiveBorder} → ${activeBorder}\n${setup.captureCharFrame()}`)
  const header = node('engineering-header')
  if (header.height !== 1) throw new Error('Wide Engineering header must use a single row')
  const headerText = setup.captureCharFrame().split('\n')[0]!
  if (headerText.includes('0 running') || headerText.includes('0 attention')) throw new Error('Idle zero counters clutter the header')
  node('engineering-diff-preview')
  const inspector = node('engineering-inspector')
  await drag('pane-resize-inspector', -8, 0)
  if (node('engineering-inspector').width !== inspector.width + 8) throw new Error('Inspector did not widen')
  await drag('pane-resize-inspector', 8, 0)
  await drag('pane-resize-files', 0, 3)
  await drag('pane-resize-files', 0, -3)
  await act(async () => { setup.mockInput.pressKey('F9') }); await settle(200)
  const drawer = node('engineering-terminal')
  await drag('pane-resize-drawer', 0, -4)
  if (node('engineering-terminal').height !== drawer.height + 4) throw new Error('Terminal drawer did not grow')
  await drag('pane-resize-drawer', 0, 4)
  await act(async () => { setup.mockInput.pressKey('F9') }); await settle()
  await act(async () => { setup.mockInput.pressKey('O', { shift: true }) }); await settle(200)
  const surface = node('surface-panel-frame')
  await drag('surface-panel-resize-handle', -4, 0)
  if (node('surface-panel-frame').width !== surface.width + 4) throw new Error('Docked surface did not use shared horizontal resize')
  await drag('surface-panel-resize-handle', 4, 0)
  await act(async () => { setup.mockInput.pressKey('|') }); await settle(200)
  const under = node('surface-panel-frame')
  await drag('surface-panel-resize-handle', 0, -3)
  if (node('surface-panel-frame').height !== under.height + 3) throw new Error('Docked surface did not use shared vertical resize')
  await act(async () => { setup.mockInput.pressEscape() }); await settle()
  await act(async () => { setup.mockInput.pressKey('T', { shift: true }) }); await settle(200)
  const tasks = node('task-side-panel-frame')
  await drag('pane-resize-tasks', -4, 0)
  if (node('task-side-panel-frame').width !== tasks.width + 4) throw new Error('Task panel did not use shared resize')
  await drag('pane-resize-tasks', 4, 0)
  console.log('Engineering header, sidebar focus/height, inspector, file split, terminal, surface and task mouse resize passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
