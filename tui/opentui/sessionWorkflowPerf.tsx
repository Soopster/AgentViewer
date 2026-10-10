/** @jsxImportSource @opentui/react */
// Hermetic real-root profiling. React render/commit and native root paint are
// separate samples; none includes physical terminal I/O or provider service
// latency. Run each scenario in a fresh process, e.g.
// WORKFLOW_SCENARIO=tabs WORKFLOW_SESSIONS=2000 bun tui/opentui/sessionWorkflowPerf.tsx
import React, { act, type ProfilerOnRenderCallback } from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session, SessionMessage } from '../../lib/types'
import { buildThreadedMessages } from '../../lib/threading'
import { formatTranscriptCards } from '../format'
import type { ScrollBoxRenderable } from '@opentui/core'

const scenario = process.env.WORKFLOW_SCENARIO ?? 'sidebar'
const sessionCount = Number(process.env.WORKFLOW_SESSIONS ?? 120)
const messageCount = Number(process.env.WORKFLOW_MESSAGES ?? 10_000)
const steps = Number(process.env.WORKFLOW_STEPS ?? 24)
const now = () => performance.now()
// Failed guards must stop the App's timers rather than leave a hung benchmark.
process.on('unhandledRejection', (error) => { console.error(error); process.exit(1) })
process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-session-workflow-')))
const sessions: Session[] = Array.from({ length: sessionCount }, (_, index) => ({
  sessionId: `workflow-session-${index}`, provider: 'codex', cwd: process.cwd(),
  summary: `Workflow session ${index}`, lastModified: 1700000000000 - index,
}))
const details = sessions.slice(0, 3).map((session) => {
  const rawMessages: SessionMessage[] = Array.from({ length: messageCount }, (_, index) => ({
    type: index % 2 ? 'assistant' : 'user', uuid: `${session.sessionId}-${index}`,
    session_id: session.sessionId, parent_tool_use_id: null,
    message: { role: index % 2 ? 'assistant' : 'user', content: `Session ${session.sessionId} message ${index}\nA deterministic second line.` },
  }))
  if (scenario === 'diff-switch') {
    const id = `${session.sessionId}-edit`
    rawMessages.push({ type: 'assistant', uuid: id, session_id: session.sessionId, parent_tool_use_id: null,
      message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit',
        input: { file_path: `${process.cwd()}/fixture.ts`, old_string: 'old first\nold second\nold third', new_string: 'new first\nnew second\nnew third' } }] } },
      { type: 'user', uuid: `${id}-result`, session_id: session.sessionId, parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Applied edit' }] } })
  }
  const threadedMessages = buildThreadedMessages(rawMessages)
  return { info: session, rawMessages, threadedMessages,
    transcriptCards: formatTranscriptCards(threadedMessages), transcriptCardsDensity: 'balanced' as const,
    transcriptCardsShowToolCalls: true, contextUsage: null }
})
const reads: string[] = []
const detailFor = (session: Session) => {
  reads.push(session.sessionId)
  const index = sessions.findIndex((candidate) => candidate.sessionId === session.sessionId)
  assert.ok(index >= 0 && index < details.length, 'fixture accesses only its three distinct prepared transcripts')
  return details[index]
}
const specifier: string = 'bun:test'
const { mock } = await import(specifier) as { mock: { module(name: string, factory: () => unknown): void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => sessions,
  readTuiSessionDetailAsync: async (session: Session) => detailFor(session),
  warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
let emit: (payload: unknown, event?: string) => void = () => { throw new Error('no live stream') }
const stream = new ReadableStream<Uint8Array>({ start(controller) {
  emit = (payload, event) => controller.enqueue(new TextEncoder().encode(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(payload)}\n\n`))
}})
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'codex', readTuiTranscriptView: async () => 'conversation',
  readTuiSessions: async () => sessions, readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
  streamTuiSessionTurn: async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
}))
try {
const { default: App, readRootRenderCount } = await import('./App')
let measuring = false
const reactRender: number[] = [], reactCommit: number[] = [], rootPaint: number[] = [], rendererFrame: number[] = []
const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration, _base, _start, commitTime) => {
  if (!measuring) return
  reactRender.push(actualDuration)
  reactCommit.push(Math.max(0, now() - commitTime))
}
const { testRender } = await import('@opentui/react/test-utils')
const setup = await testRender(<React.Profiler id="root" onRender={onRender}><App /></React.Profiler>, { width: 140, height: 44, kittyKeyboard: true })
const originalPaint = setup.renderer.root.render.bind(setup.renderer.root)
setup.renderer.root.render = (...args) => {
  const started = now()
  originalPaint(...args)
  if (measuring) rootPaint.push(now() - started)
}
setup.renderer.on('frame', () => {
  if (!measuring) return
  // FRAME fires before collectStatSample; read after the callback returns.
  // Use the JS wall-clock sample rather than assuming native FFI stats units.
  queueMicrotask(() => {
    const sample = setup.renderer.getStats().frameTimes.at(-1)
    if (sample !== undefined) rendererFrame.push(sample)
  })
})
setup.renderer.setGatherStats(true)
const settle = async (ms: number) => {
  const until = now() + ms
  while (now() < until) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 16)) })
}
const press = async (key: string, ms = 180, ctrl = false, shift = false) => {
  act(() => {
    const modifiers = { ctrl, shift }
    if (key === 'tab') setup.mockInput.pressTab(modifiers)
    else if (key === 'escape') setup.mockInput.pressEscape(modifiers)
    else if (key === 'return') setup.mockInput.pressEnter(modifiers)
    else setup.mockInput.pressKey(key, modifiers)
  })
  await settle(ms)
}
const scroll = () => setup.renderer.root.findDescendantById('transcript-scroll') as ScrollBoxRenderable
const primarySession = () => {
  const nodes = [scroll().content]
  const identities = new Set<string>()
  while (nodes.length) {
    const node = nodes.pop()!
    if (node.id.startsWith('card:')) {
      const session = sessions.slice(0, 3).find((session) => node.id.includes(session.sessionId))
      if (session) identities.add(session.sessionId)
    }
    nodes.push(...node.getChildren() as typeof nodes)
  }
  assert.equal(identities.size, 1, 'primary transcript contains one distinct session identity')
  return [...identities][0]
}
await settle(1000)
assert.ok(reads.includes(sessions[0].sessionId), 'first distinct session opened')
await press('tab') // pin first and focus reader
await press('g')
if (scenario === 'tabs' || scenario === 'split' || scenario === 'diff-switch') {
  await press('tab')
  await press('j', 550)
  await press('tab')
  assert.ok(reads.includes(sessions[1].sessionId), 'second distinct session opened')
  if (scenario === 'split') {
    await press('b', 100, true); await press('%', 200)
    const splitFrame = setup.captureCharFrame()
    assert.ok(splitFrame.includes('Session workflow-session-0 message') && splitFrame.includes('Session workflow-session-1 message'),
      'split and primary panes show their distinct transcript contents')
  }
} else if (scenario === 'sidebar') await press('tab')
else if (scenario === 'composer' || scenario === 'live' || scenario === 'paused-live' || scenario === 'todos-switch') {
  await press('c')
  if (scenario !== 'composer') {
    await act(async () => { await setup.mockInput.typeText('fixture live turn') })
    await press('return', 300)
    emit({ type: 'codex_agent_message_delta', delta: 'Live delta seed. ' })
    await settle(100)
    if (scenario === 'paused-live') { await press('escape'); await press('g') }
  }
}
await settle(200)
if (scenario === 'todos-switch') {
  emit([{ id: 'fixture-todo', content: 'Unique live fixture todo', status: 'in_progress', priority: 'high' }], 'opencode-todos')
  await settle(100)
  await press('escape')
  await press('T', 180, false, true)
  assert.ok(setup.captureCharFrame().includes('Unique live fixture todo'), 'streamed live todo is visible')
  await press('tab'); await press('j', 550); await press('tab')
  assert.equal(primarySession(), sessions[1].sessionId)
  assert.ok(!setup.captureCharFrame().includes('Unique live fixture todo'), 'nonempty live todos clear on session switch')
  console.log('Session live todos switch smoke passed (streamed todo disappears on actual session switch)')
  process.exit(0)
}
if (scenario === 'diff-switch') {
  assert.ok(details[1].transcriptCards.some((card) => card.category === 'diff'), 'actual Edit diff fixture')
  await press('G', 150, false, true)
  for (let index = 0; index < 4; index++) await press('ARROW_DOWN', 100, false, true)
  await press('a')
  const selected = setup.captureCharFrame().split('\n').find((line) => line.includes('Draft note'))
  assert.ok(selected?.includes('→'), `actual multi-line diff range selected: ${selected}`)
  await press('escape')
  assert.ok(!setup.captureCharFrame().includes('Draft note'), 'draft dismissed before switching')
  await press('tab'); await press('k', 550); await press('tab')
  assert.equal(primarySession(), sessions[0].sessionId, setup.captureCharFrame())
  await press('tab'); await press('j', 550); await press('tab')
  assert.equal(primarySession(), sessions[1].sessionId, setup.captureCharFrame())
  await press('a')
  const restored = setup.captureCharFrame().split('\n').find((line) => line.includes('Draft note'))
  assert.ok(restored && !restored.includes('→'), `return to session clears the nonempty selection: ${restored}`)
  console.log('Session diff selection switch smoke passed (actual multi-line range cleared across cached tab switches)')
  process.exit(0)
}
const heap = async () => {
  const diagnostic: string = 'bun:jsc'
  const { heapStats } = await import(diagnostic) as { heapStats(): { heapSize: number; objectCount: number } }
  ;(globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
  return { ...heapStats(), rssBytes: process.memoryUsage.rss() }
}
const before = await heap()
const renderCountBefore = readRootRenderCount()
const readCountBefore = reads.length
const scrollBefore = scroll()?.scrollTop
measuring = true
if (scenario === 'idle') await settle(2200)
else for (let index = 0; index < steps; index++) {
  if (scenario === 'sidebar') await press(index % 2 ? 'k' : 'j', 33)
  else if (scenario === 'tabs') {
    const previous = primarySession()
    await press(index % 2 ? 'ARROW_RIGHT' : 'ARROW_LEFT', 60)
    const current = primarySession()
    assert.notEqual(current, previous, 'every arrow switched the primary transcript')
    assert.equal(current, sessions[index % 2 ? 1 : 0].sessionId, 'cached tab restored the requested session')
  }
  else if (scenario === 'composer') {
    await act(async () => { await setup.mockInput.typeText('x') }); await settle(33)
  } else if (scenario === 'split') await press(index % 2 ? 'k' : 'j', 33)
  else if (scenario === 'live' || scenario === 'paused-live') {
    await act(async () => { emit({ type: 'codex_agent_message_delta', delta: `Live delta ${index}. ` }) })
    await settle(60)
  } else throw new Error(`Unknown scenario ${scenario}`)
}
await settle(200)
measuring = false
const renders = readRootRenderCount() - renderCountBefore
const readCount = reads.length - readCountBefore
const after = await heap()
if (scenario === 'idle') assert.equal(renders, 0, 'idle root stays stable')
if (scenario === 'paused-live') {
  assert.equal(scroll().scrollTop, scrollBefore, 'paused reader anchor did not follow live deltas')
  await press('G') // inspection outside the timing window proves processing
}
if (scenario === 'live' || scenario === 'paused-live') assert.ok(setup.captureCharFrame().includes('Live delta'), 'live output reached reader')
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
  return { samples: sorted.length, medianMs: at(.5), p95Ms: at(.95), maxMs: at(1), over8_33: sorted.filter((value) => value > 8.33).length }
}
const countRows = (node: typeof setup.renderer.root): number => (node.id.startsWith('sidebar:') ? 1 : 0)
  + node.getChildren().reduce((sum, child) => sum + countRows(child as typeof node), 0)
const mountedRows = countRows(setup.renderer.root)
console.log(`WORKFLOW ${JSON.stringify({ runtime: `Bun ${process.versions.bun}`, scenario, sessionCount, messageCount, steps, renders, reads: readCount, mountedRows,
  reactRender: summary(reactRender), reactCommit: summary(reactCommit), rootPaint: summary(rootPaint), rendererFrame: summary(rendererFrame),
  retainedHeap: { beforeBytes: before.heapSize, afterBytes: after.heapSize }, rss: { beforeBytes: before.rssBytes, afterBytes: after.rssBytes } })}`)
process.exit(0)
} catch (error) { console.error(error); process.exit(1) }
