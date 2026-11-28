/** @jsxImportSource @opentui/react */
// Full-app streaming workload: 80 text deltas arriving on separate event-loop
// turns. Checks visible text before EOF and counts root renders separately
// from terminal presentation. STREAM_BATCH_OBSERVE=1 records the old baseline.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-stream-batch-')))

// `bun:test` isn't in @types/node (no bun-types dependency here), so the module
// mocker is resolved at runtime and typed locally.
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'live-tool-smoke-session'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Live tool smoke',
  firstPrompt: 'Live tool smoke',
  lastModified: 1_700_000_000_000,
}
const OTHER_SESSION = {
  sessionId: 'live-tool-unrelated-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Unrelated idle tab',
  firstPrompt: 'Unrelated idle tab',
  lastModified: 1_699_999_999_000,
}
const encoder = new TextEncoder()
let pushFrame: (payload: unknown) => void = () => {}
let pushEvent: (event: string, payload: unknown) => void = () => {}
let closeStream: () => void = () => {}
let streamClosed = false
const streamBody = new ReadableStream<Uint8Array>({
  start(controller) {
    pushFrame = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
    pushEvent = (event, payload) =>
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
    closeStream = () => controller.close()
  },
})

const EMPTY_DETAIL = { info: null, rawMessages: [], threadedMessages: [], contextUsage: null }

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION, OTHER_SESSION],
  readTuiSessionDetailAsync: async () => EMPTY_DETAIL,
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))

const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [SESSION, OTHER_SESSION],
  readTuiSessionDetail: async () => EMPTY_DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  // Keep the smoke hermetic: these spawn provider CLIs on composer focus.
  prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [],
  readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  streamTuiSessionTurn: async () => new Response(streamBody, {
    headers: { 'Content-Type': 'text/event-stream' },
  }),
  runTuiSessionAction: async (target: Parameters<typeof service.runTuiSessionAction>[0], body: Parameters<typeof service.runTuiSessionAction>[1]) => body.action === 'steer'
    ? { delivered: true, messageUuid: 'claude-steered-prompt' }
    : service.runTuiSessionAction(target, body),
}))

const { default: OpenTuiApp, readRootRenderCount } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 180, height: 44, kittyKeyboard: true })
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const settle = async (ms: number) => {
  await act(async () => { await wait(ms); await setup.flush() })
}
const delta = (text: string, index = 0) => pushFrame({
  type: 'stream_event',
  event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
})
try {
  await settle(2500)
  act(() => { setup.mockInput.pressKey('c') })
  await settle(200)
  await act(async () => { await setup.mockInput.typeText('stream a reply') })
  act(() => { setup.mockInput.pressEnter() })
  await settle(400)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  const before = readRootRenderCount()
  const started = performance.now()
  for (let index = 0; index < 80; index++) {
    delta(index === 0 ? 'BATCH_START ' : 'x')
    // Separate event-loop turns prevent React automatic batching from hiding
    // per-token updates. Do not force renderer.flush() for every token.
    await wait(2)
  }
  delta(' BATCH_END')
  await wait(200)
  await setup.flush()
  const renders = readRootRenderCount() - before
  const elapsedMs = performance.now() - started
  const frame = setup.captureCharFrame()
  if (!frame.includes('BATCH_START') || !frame.includes('BATCH_END')) {
    throw new Error(`Streaming text did not become visible before EOF:\n${frame}`)
  }
  // EOF inside the batch window must retain the final partial text.
  delta('FINAL_PARTIAL', 1)
  closeStream()
  streamClosed = true
  await wait(300)
  await setup.flush()
  if (!setup.captureCharFrame().includes('FINAL_PARTIAL')) throw new Error(`EOF lost pending text:\n${setup.captureCharFrame()}`)
  console.log(JSON.stringify({ workload: '81 deltas at 2ms, 180x44 full app', renders, elapsedMs }))
  if (process.env.STREAM_BATCH_OBSERVE !== '1' && renders >= 60) {
    throw new Error(`Text deltas bypassed batching: ${renders} root renders`)
  }
  console.log('stream batch smoke passed (preview before EOF, final partial text retained)')
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
} finally {
  if (!streamClosed) closeStream()
}
