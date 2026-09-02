/** @jsxImportSource @opentui/react */
// Live tool rendering smoke: drives a scripted Claude turn (tool call, then its
// real tool_result) through the composer and asserts the streaming card shows
// the tool as running until its output arrives, then shows the real outcome —
// never a synthesized "output will appear when the transcript syncs" filler.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-live-tool-smoke-')))

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
const COMMAND = 'git status --short'
const OUTPUT = 'M  tui/opentui/App.tsx\nM  tui/format.ts\n'
const INTRO = 'I will inspect the working tree first.'
const OUTRO = 'The working tree has two relevant changes.'

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
}))

const { extractClaudeStreamToolResults } = await import('../../lib/claudeMapper')
const sidecarResults = extractClaudeStreamToolResults({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [] },
  tool_use_result: {
    type: 'tool_result',
    tool_use_id: 'toolu_sidecar',
    content: 'denied',
    isError: true,
  },
  tool_result_meta: { denied: true },
})
if (sidecarResults.length !== 1
  || sidecarResults[0].is_error !== true
  || sidecarResults[0].tool_result_meta?.denied !== true) {
  throw new Error('Claude structured tool-result sidecar was not normalized')
}

const { default: OpenTuiApp, IDLE_TICKER_PHRASES } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 120, height: 44, kittyKeyboard: true })
const settle = async (ms: number) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const emitFrame = async (payload: unknown, ms = 500) => {
  await act(async () => {
    pushFrame(payload)
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const emitEvent = async (event: string, payload: unknown, ms = 200) => {
  await act(async () => {
    pushEvent(event, payload)
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

try {
  await settle(2500)

  act(() => { setup.mockInput.pressKey('c') })
  await settle(200)
  await act(async () => { await setup.mockInput.typeText('run git status') })
  act(() => { setup.mockInput.pressEnter() })
  await settle(400)

  // The model emits the tool call: name, then its input, then the end of the
  // call — the tool has not run yet at this point.
  await emitFrame({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: INTRO },
    },
  }, 0)
  await emitFrame({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_smoke_1', name: 'Bash', input: {} },
    },
  }, 0)
  await emitFrame({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: COMMAND }) },
    },
  }, 0)
  await emitFrame({ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } })

  const runningFrame = setup.captureCharFrame()
  if (!runningFrame.includes('git status')) {
    throw new Error(`Live card never rendered the streamed command:\n${runningFrame}`)
  }
  if (/output will appear/i.test(runningFrame)) {
    throw new Error(`Live card rendered synthesized result filler:\n${runningFrame}`)
  }
  if (!/running/i.test(runningFrame)) {
    throw new Error(`Live card did not show the tool as still running:\n${runningFrame}`)
  }
  // Exactly one spinner at a time. The idle ticker means "nothing is
  // happening", so it must never sit above a live turn's status row — that
  // put "waiting patiently" directly on top of "Shaping the next move… 2s".
  const idlePhrasesOn = (f: string) => IDLE_TICKER_PHRASES.filter((phrase) => f.includes(phrase))
  const strayIdle = idlePhrasesOn(runningFrame)
  if (strayIdle.length > 0) {
    throw new Error(`Idle ticker rendered during a running turn (${strayIdle.join(', ')}):\n${runningFrame}`)
  }

  // The turn status line stays pinned once output starts — native CLIs keep
  // the elapsed clock, token counter and interrupt affordance visible for the
  // whole turn instead of hiding them behind the first delta.
  if (!/⌃C cancel/.test(runningFrame)) {
    throw new Error(`Turn status line lost its interrupt hint while streaming:\n${runningFrame}`)
  }
  if (!/\d+s\s+·/.test(runningFrame)) {
    throw new Error(`Turn status line lost its elapsed clock while streaming:\n${runningFrame}`)
  }
  if (runningFrame.indexOf(INTRO) > runningFrame.indexOf('tool Bash')) {
    throw new Error(`Claude text did not stream into the conversation before its tool call:\n${runningFrame}`)
  }
  if ((runningFrame.match(new RegExp(INTRO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length !== 1) {
    throw new Error(`Claude text rendered outside the transcript or more than once:\n${runningFrame}`)
  }

  // Navigate to a different session while the first session's stream remains
  // open. The transcript cards were already session-keyed; the regression was
  // the global composer/tool/status state continuing to render underneath the
  // unrelated tab (and then pulling navigation back when the stream ended).
  act(() => { setup.mockInput.pressEscape() })
  await settle(100)
  act(() => { setup.mockInput.pressTab() })
  await settle(100)
  act(() => { setup.mockInput.pressArrow('down') })
  await settle(100)
  act(() => { setup.mockInput.pressEnter() })
  await settle(300)

  const unrelatedFrame = setup.captureCharFrame()
  if (
    unrelatedFrame.includes(INTRO)
    || unrelatedFrame.includes(COMMAND)
    || unrelatedFrame.includes('tools  ')
    || /⌃C cancel/.test(unrelatedFrame)
  ) {
    throw new Error(`Live composer state bled into the unrelated tab:\n${unrelatedFrame}`)
  }

  // Return to the origin session and prove its live status/tool card remained
  // attached there while it was hidden.
  act(() => { setup.mockInput.pressTab() })
  await settle(100)
  act(() => { setup.mockInput.pressArrow('up') })
  await settle(100)
  act(() => { setup.mockInput.pressEnter() })
  await settle(300)
  const returnedFrame = setup.captureCharFrame()
  if (!returnedFrame.includes(INTRO) || !returnedFrame.includes(COMMAND) || !/⌃C cancel/.test(returnedFrame)) {
    throw new Error(`Origin tab did not retain its live composer state:\n${returnedFrame}`)
  }

  // Chat keeps the live-turn status as one fixed footer row immediately above
  // its composer. It must not sit inside the full-height transcript scrollbox,
  // where a short turn makes the remaining viewport look like a giant footer.
  act(() => { setup.mockInput.pressKey('v') })
  await settle(100)
  for (let index = 0; index < 5; index += 1) {
    act(() => { setup.mockInput.pressArrow('down') })
  }
  act(() => { setup.mockInput.pressEnter() })
  await settle(200)

  type FrameGeometry = { y: number; height: number }
  const chatStatus = setup.renderer.root.findDescendantById('chat-turn-status') as unknown as FrameGeometry | null
  const chatComposer = setup.renderer.root.findDescendantById('composer-dock') as unknown as FrameGeometry | null
  if (
    !chatStatus
    || !chatComposer
    || chatStatus.height !== 1
    || chatStatus.y + chatStatus.height !== chatComposer.y
  ) {
    throw new Error(
      `Chat turn status did not occupy one row directly above the composer `
      + `(status=${chatStatus ? `${chatStatus.y}/${chatStatus.height}` : 'missing'}, `
      + `composer=${chatComposer ? `${chatComposer.y}/${chatComposer.height}` : 'missing'}):\n`
      + setup.captureCharFrame(),
    )
  }
  const idleChatComposerFrame = setup.captureCharFrame()
  if (!idleChatComposerFrame.includes('› ')) {
    throw new Error(`Unfocused Chat composer did not expose its input rail:\n${idleChatComposerFrame}`)
  }
  act(() => { setup.mockInput.pressKey('c') })
  await settle(150)
  const focusedChatComposerFrame = setup.captureCharFrame()
  if (!focusedChatComposerFrame.includes('❯ ')) {
    throw new Error(`Focused Chat composer did not expose its active input rail:\n${focusedChatComposerFrame}`)
  }
  act(() => { setup.mockInput.pressEscape() })
  await settle(100)
  // Return to Conversation so the existing detailed tool-result assertions
  // continue covering the expanded card presentation too.
  act(() => { setup.mockInput.pressKey('v') })
  await settle(100)
  for (let index = 0; index < 5; index += 1) {
    act(() => { setup.mockInput.pressArrow('up') })
  }
  act(() => { setup.mockInput.pressEnter() })
  await settle(200)

  // The tool's real result arrives while the turn is still streaming.
  await emitFrame({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_smoke_1', content: OUTPUT }],
    },
  })
  await emitFrame({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'text_delta', text: OUTRO },
    },
  })

  // The server reports live output tokens as an absolute total over
  // `turn-usage` (createClaudeTurnUsageTracker); the pinned status line must
  // show that number, and a later, larger total must replace it rather than
  // add to it.
  await emitEvent('turn-usage', { outputTokens: 40 })
  const firstUsageFrame = setup.captureCharFrame()
  if (!/↓ 40 tokens/.test(firstUsageFrame)) {
    throw new Error(`Status line did not adopt the reported turn usage:\n${firstUsageFrame}`)
  }
  await emitEvent('turn-usage', { outputTokens: 70 })
  const secondUsageFrame = setup.captureCharFrame()
  if (!/↓ 70 tokens/.test(secondUsageFrame)) {
    throw new Error(`Status line did not track the updated turn usage:\n${secondUsageFrame}`)
  }
  if (/↓ 110 tokens/.test(secondUsageFrame)) {
    throw new Error(`Status line summed absolute turn totals instead of replacing:\n${secondUsageFrame}`)
  }

  const resultFrame = setup.captureCharFrame()
  if (/output will appear/i.test(resultFrame)) {
    throw new Error(`Live card rendered synthesized result filler:\n${resultFrame}`)
  }
  if (!resultFrame.includes('✓ OK')) {
    throw new Error(`Live card did not adopt the real tool result:\n${resultFrame}`)
  }
  if (/running/i.test(resultFrame.split('\n').filter((l) => l.includes('OK')).join('\n'))) {
    throw new Error(`Live card still reads as running after its result:\n${resultFrame}`)
  }
  if (!/⌃C cancel/.test(resultFrame)) {
    throw new Error(`Turn status line vanished after the tool result landed:\n${resultFrame}`)
  }
  const strayIdleAfter = idlePhrasesOn(resultFrame)
  if (strayIdleAfter.length > 0) {
    throw new Error(`Idle ticker returned mid-turn (${strayIdleAfter.join(', ')}):\n${resultFrame}`)
  }
  if (resultFrame.indexOf('tool Bash') > resultFrame.indexOf(OUTRO)) {
    throw new Error(`Claude follow-up text did not stream after its tool call:\n${resultFrame}`)
  }

  // Finishing in the background must not pull navigation back to the origin
  // or move its short-lived persisted-sync spinner onto the selected tab.
  act(() => { setup.mockInput.pressTab() })
  await settle(100)
  act(() => { setup.mockInput.pressArrow('down') })
  await settle(100)
  act(() => { setup.mockInput.pressEnter() })
  await settle(200)
  await act(async () => {
    closeStream()
    streamClosed = true
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
  const completedElsewhereFrame = setup.captureCharFrame()
  if (
    completedElsewhereFrame.includes(INTRO)
    || completedElsewhereFrame.includes(OUTRO)
    || completedElsewhereFrame.includes('Syncing transcript')
    || /⌃C cancel/.test(completedElsewhereFrame)
  ) {
    throw new Error(`Background completion changed or contaminated the unrelated tab:\n${completedElsewhereFrame}`)
  }

  console.log('OpenTUI live tool stream smoke passed')
} finally {
  if (!streamClosed) closeStream()
  act(() => {
    setup.renderer.destroy()
  })
}

// The mocked streaming turn leaves the app's reader/poll timers alive after
// renderer teardown. This is a standalone smoke process, so exit explicitly
// like appSmoke.tsx does and let the parent smoke chain continue.
process.exit(0)
