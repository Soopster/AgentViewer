/** @jsxImportSource @opentui/react */
// Real-root layout and keyboard regression at narrow, standard and wide sizes.
// Fixture data is deterministic; no provider sends are performed.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

const sizes = [[80, 40], [120, 40], [200, 40], [100, 24]] as const
const childSize = process.env.ENGINEERING_VIEW_CHILD_SIZE
if (!childSize) {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  for (const [width, height] of sizes) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, ENGINEERING_VIEW_CHILD_SIZE: `${width}x${height}` }, encoding: 'utf8',
    })
    if (run.status !== 0) { process.stderr.write(run.stdout + run.stderr); process.exit(run.status ?? 1) }
  }
  console.log('Engineering view smoke passed at 80, 120, 200 columns and 100x24')
  process.exit(0)
}

const fixtureDirectory = path.join(mkdtempSync(path.join(tmpdir(), 'agent-viewer-engineering-view-')), 'agentViewer')
mkdirSync(fixtureDirectory)
process.chdir(fixtureDirectory)
const { spawnSync: runFixture } = await import('node:child_process')
runFixture('git', ['init', '-q'], { cwd: fixtureDirectory })
// The app writes its own state into the cwd; keep it out of the changes list so the file under review is the fixture's.
writeFileSync(path.join(fixtureDirectory, '.gitignore'), '.agent-viewer-data/\n')
runFixture('git', ['add', '.gitignore'], { cwd: fixtureDirectory })
runFixture('git', ['-c', 'user.email=smoke@example.com', '-c', 'user.name=smoke', 'commit', '-q', '-m', 'fixture'], { cwd: fixtureDirectory })
writeFileSync(path.join(fixtureDirectory, 'review-me.ts'), 'export const fixture = true\n')
let fixtureTheme: 'light' | 'dark' = 'dark'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'engineering-view-session',
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

const [width, height] = childSize.split('x').map(Number) as [number, number]
const setup = await testRender(<OpenTuiApp />, { width, height, kittyKeyboard: true })
const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 1200)) }) }
const press = async (key: string) => { await act(async () => { setup.mockInput.pressKey(key) }); await settle() }
const arrow = async (direction: 'up' | 'down' | 'left' | 'right') => { await act(async () => { setup.mockInput.pressArrow(direction) }) }
try {
  await settle()
  await act(async () => { setup.mockInput.pressEnter() })
  await settle()
  const legacy = setup.captureCharFrame()
  const oldReader = setup.renderer.root.findDescendantById('transcript-reader')
  const originalReader = oldReader ? { x: oldReader.x, width: oldReader.width, height: oldReader.height } : null
  if (legacy.includes('ENGINEERING ·')) throw new Error('Engineering chrome leaked into Chat')
  await press('v')
  for (let i = 0; i < 7; i++) await arrow('down')
  await act(async () => { setup.mockInput.pressEnter() })
  await settle()
  let frame = setup.captureCharFrame()
  writeFileSync(`/tmp/engineering-view-${width}.txt`, frame)
  if (!frame.includes('ENGINEERING ·') || (!frame.includes('recovery path') || !frame.includes('operation.'))) throw new Error(`Engineering view missing content at ${width}:\n${frame}`)
  const inspector = setup.renderer.root.findDescendantById('engineering-inspector')
  if (width === 200 && !inspector) throw new Error('Wide view did not mount inspector')
  if (width < 132 && inspector) throw new Error('Narrow view squeezed in an inspector')
  await press('F8')
  await act(async () => { setup.mockInput.pressEnter() })
  await settle()
  const comment = setup.renderer.root.findDescendantById('engineering-input:comment')
  if (!comment) throw new Error('Selected file did not expose a review comment field')
  await act(async () => { await setup.mockMouse.click(comment.x + 1, comment.y) })
  await act(async () => { setup.mockInput.typeText('j/k review comment') })
  await settle()
  if (!setup.captureCharFrame().includes('j/k review comment')) throw new Error('Inspector text input lost keys to reader shortcuts')
  await act(async () => { setup.mockInput.pressEscape() })
  await settle()
  if (width === 200) {
    // Per-file git actions run against the fixture repository and report what they did.
    await press('F8')
    await press('s')
    if (!setup.captureCharFrame().includes('Staged review-me.ts')) throw new Error(`Stage did not report:\n${setup.captureCharFrame()}`)
    const staged = runFixture('git', ['status', '--porcelain'], { cwd: fixtureDirectory, encoding: 'utf8' }).stdout
    if (!staged.startsWith('A  review-me.ts')) throw new Error(`Stage did not reach the index: ${staged}`)
    await press('x')
    if (!setup.captureCharFrame().includes('Not in HEAD')) throw new Error('Revert of a file absent from HEAD was not refused')
    await press('u')
    const unstaged = runFixture('git', ['status', '--porcelain'], { cwd: fixtureDirectory, encoding: 'utf8' }).stdout
    if (!unstaged.startsWith('?? review-me.ts')) throw new Error(`Unstage did not reach the index: ${unstaged}`)
    // Revert asks twice, and only the second press touches the file.
    writeFileSync(path.join(fixtureDirectory, '.gitignore'), '.agent-viewer-data/\nlocal-edit\n')
    await settle(); await new Promise(resolve => setTimeout(resolve, 5200)); await settle()
    await press('k')
    await press('x')
    if (!setup.captureCharFrame().includes('x again reverts .gitignore')) throw new Error(`Revert did not ask first:\n${setup.captureCharFrame()}`)
    if (!readFileSync(path.join(fixtureDirectory, '.gitignore'), 'utf8').includes('local-edit')) throw new Error('First x already reverted')
    await press('x')
    if (readFileSync(path.join(fixtureDirectory, '.gitignore'), 'utf8') !== '.agent-viewer-data/\n') throw new Error('Second x did not revert')
    await act(async () => { setup.mockInput.pressEscape() })
    await settle()
  }
  await press('F8')
  await press(']')
  await settle()
  frame = setup.captureCharFrame()
  if (!frame.includes('Application-recorded checks')) throw new Error(`Checks inspector inaccessible:\n${frame}`)
  await act(async () => { setup.mockInput.pressEscape() })
  await settle()
  await press('F9')
  if (!setup.renderer.root.findDescendantById('engineering-terminal')) throw new Error('Terminal drawer inaccessible')
  await press('F9')
  if (setup.renderer.root.findDescendantById('engineering-terminal')) throw new Error('Terminal drawer did not close')
  if (width === 200) {
    const click = async (id: string) => {
      const node = setup.renderer.root.findDescendantById(id)
      if (!node) throw new Error(`Missing inspector presentation control ${id}:\n${setup.captureCharFrame()}`)
      await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
      await settle()
    }
    const dockWidth = setup.renderer.root.findDescendantById('engineering-inspector')!.width
    const headerRow = setup.captureCharFrame().split('\n')[0] ?? ''
    if (/\b(Build|Review|Agents)\b/.test(headerRow)) throw new Error('Separate engineering presets remain in the header')
    await press('F7')
    if (setup.renderer.root.findDescendantById('engineering-inspector')) throw new Error('Focus did not hide docked inspector')
    await press('F7')
    if (setup.renderer.root.findDescendantById('engineering-inspector')!.width !== dockWidth) throw new Error('Focus changed saved inspector width')
    if (!setup.captureCharFrame().includes('Application-recorded checks')) throw new Error('Focus changed selected inspector tab')
    await click('engineering-inspector-expand')
    if (setup.renderer.root.findDescendantById('engineering-inspector')!.width !== width) throw new Error('Expanded inspector did not use terminal width')
    if (!setup.captureCharFrame().includes('Application-recorded checks')) throw new Error('Expand lost inspector tab')
    await click('engineering-inspector-expand')
    if (setup.renderer.root.findDescendantById('engineering-inspector')!.width !== dockWidth) throw new Error('Restore lost inspector width')
    await click('engineering-inspector-window')
    const window = setup.renderer.root.findDescendantById('surface-window-to-panel:engineering-inspector')
    if (!window) throw new Error(`Inspector did not enter shared window manager:\n${setup.captureCharFrame()}`)
    if (!setup.captureCharFrame().includes('Application-recorded checks')) throw new Error('Window move lost inspector tab')
    const tiledWidth = setup.renderer.root.findDescendantById('engineering-inspector')!.width
    await click('engineering-inspector-expand')
    if (setup.renderer.root.findDescendantById('engineering-inspector')!.width <= tiledWidth) throw new Error('Inspector window did not zoom')
    await click('engineering-inspector-expand')
    if (setup.renderer.root.findDescendantById('engineering-inspector')!.width !== tiledWidth) throw new Error('Inspector window did not restore its tile')
    await click('surface-window-to-panel:engineering-inspector')
    if (setup.renderer.root.findDescendantById('surface-window-to-panel:engineering-inspector')) throw new Error('Return left a duplicate inspector window')
    if (setup.renderer.root.findDescendantById('engineering-inspector')!.width !== dockWidth) throw new Error('Return did not restore docked inspector')
    await act(async () => { setup.mockInput.pressEscape() })
    await settle()
  }
  // Preview another view, then cancel: Engineering must remain selected.
  await press('v')
  await arrow('up')
  await act(async () => { setup.mockInput.pressEscape() })
  await settle()
  if (!setup.captureCharFrame().includes('ENGINEERING ·')) throw new Error('View preview cancellation lost Engineering')
  // Return to Chat and verify its inline composer and content survived.
  await press('v')
  for (let i = 0; i < 7; i++) await arrow('up')
  await act(async () => { setup.mockInput.pressEnter() })
  await settle()
  frame = setup.captureCharFrame()
  if (frame.includes('ENGINEERING ·') || (!frame.includes('recovery path') || !frame.includes('operation.'))) throw new Error(`Chat did not restore:\n${frame}`)
  const restoredReader = setup.renderer.root.findDescendantById('transcript-reader')
  if (originalReader && (!restoredReader || restoredReader.x !== originalReader.x || restoredReader.width !== originalReader.width || restoredReader.height !== originalReader.height)) throw new Error('Legacy reader geometry changed after visiting Engineering')
  if (setup.renderer.root.findDescendantById('engineering-inspector')) throw new Error('Engineering inspector remained active outside view')
  console.log(`Engineering isolation and inspector keyboard smoke passed at ${width}`)
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
