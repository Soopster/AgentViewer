/** @jsxImportSource @opentui/react */
// Codex structured-question smoke: drives the native app-server request through
// a live TUI turn, verifies both the transcript card and picker, then answers it
// and checks the response payload and resolved card.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-codex-question-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'codex-question-smoke-session'
const QUESTION_ID = 'project_kind'
const QUESTION = 'Which sample project should we build?'
const SECOND_ID = 'runtime'
const SECOND_QUESTION = 'Where should the sample project run?'
const SECOND_LOCAL = 'Run locally'
const SECOND_CLOUD = 'Deploy to cloud'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'codex' as const,
  cwd: process.cwd(),
  summary: 'Codex question smoke',
  firstPrompt: 'Codex question smoke',
  lastModified: 1_700_000_000_000,
}

const encoder = new TextEncoder()
let pushFrame: (payload: unknown) => void = () => {}
let closeStream: () => void = () => {}
const streamBody = new ReadableStream<Uint8Array>({
  start(controller) {
    pushFrame = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
    closeStream = () => controller.close()
  },
})

const actions: Array<Record<string, unknown>> = []
const EMPTY_DETAIL = { info: null, rawMessages: [], threadedMessages: [], contextUsage: null }
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION],
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
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => EMPTY_DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [],
  readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  runTuiSessionAction: async (_session: unknown, action: Record<string, unknown>) => {
    actions.push(action)
    return { ok: true }
  },
  streamTuiSessionTurn: async () => new Response(streamBody, {
    headers: { 'Content-Type': 'text/event-stream' },
  }),
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 48, kittyKeyboard: true })
const settle = async (ms: number) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressKey('c') })
  await settle(200)
  await act(async () => { await setup.mockInput.typeText('ask me a question') })
  act(() => { setup.mockInput.pressEnter() })
  await settle(400)

  await act(async () => {
    pushFrame({ type: 'codex_agent_message_delta', threadId: SESSION_ID, turnId: 'turn-1', itemId: 'answer-1', delta: 'Streaming before the question' })
  })
  await settle(250)
  if (!setup.captureCharFrame().includes('Streaming before the question')) {
    throw new Error(`Codex text must render before item/turn completion:\n${setup.captureCharFrame()}`)
  }

  await act(async () => {
    pushFrame({
      type: 'codex_approval',
      event: {
        type: 'approval.requested',
        requestId: 'request-1',
        method: 'item/tool/requestUserInput',
        threadId: SESSION_ID,
        params: {
          threadId: SESSION_ID,
          turnId: 'turn-1',
          itemId: 'item-1',
          questions: [{
            id: QUESTION_ID,
            header: 'Sample',
            question: QUESTION,
            isOther: true,
            isSecret: false,
            options: [
              { label: 'Developer tool', description: 'Build a CLI utility.' },
              { label: 'Web dashboard', description: 'Build a browser UI.' },
            ],
          }, {
            id: SECOND_ID,
            header: 'Runtime',
            question: SECOND_QUESTION,
            isOther: false,
            isSecret: false,
            options: [
              { label: SECOND_LOCAL },
              { label: SECOND_CLOUD },
            ],
          }],
        },
      },
    })
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  const pendingFrame = setup.captureCharFrame()
  if (!pendingFrame.includes('CODEX asks') || !pendingFrame.includes(QUESTION)) {
    throw new Error(`Codex question picker did not render:\n${pendingFrame}`)
  }
  if (!pendingFrame.includes('tool ask user')) {
    throw new Error(`Codex question did not render as a transcript tool card:\n${pendingFrame}`)
  }
  // Codex CLI parity: one tab per question plus Submit, and only the active
  // question's options are drawn.
  if (!pendingFrame.includes('[Sample]') || !pendingFrame.includes('[Runtime]') || !pendingFrame.includes('[Submit]')) {
    throw new Error(`Codex questionnaire tabs did not render:\n${pendingFrame}`)
  }
  if (pendingFrame.includes(SECOND_LOCAL) || pendingFrame.includes(SECOND_CLOUD)) {
    throw new Error(`Inactive question options rendered outside their tab:\n${pendingFrame}`)
  }

  // A single-choice selection advances to the next tab.
  act(() => { setup.mockInput.pressKey('1') })
  await settle(200)
  const secondTabFrame = setup.captureCharFrame()
  if (!secondTabFrame.includes(SECOND_QUESTION) || !secondTabFrame.includes(SECOND_LOCAL)) {
    throw new Error(`Single-choice selection did not advance to the next tab:\n${secondTabFrame}`)
  }
  if (!secondTabFrame.includes('▶[Runtime]')) {
    throw new Error(`Runtime tab is not marked active:\n${secondTabFrame}`)
  }

  // Answering the last question advances to Submit, which summarises both.
  act(() => { setup.mockInput.pressKey('1') })
  await settle(200)
  const submitFrame = setup.captureCharFrame()
  if (!submitFrame.includes('▶[Submit]')) {
    throw new Error(`Submit tab is not reachable:\n${submitFrame}`)
  }
  if (!submitFrame.includes('Sample: Developer tool') || !submitFrame.includes('Runtime: Run locally')) {
    throw new Error(`Submit tab does not summarise the answers:\n${submitFrame}`)
  }

  act(() => { setup.mockInput.pressEnter() })
  await settle(500)

  const response = actions.find((action) => action.action === 'respondQuestion')
  const answers = response?.answers as Record<string, string[]> | undefined
  if (response?.permissionId !== 'request-1'
    || answers?.[QUESTION_ID]?.[0] !== 'Developer tool'
    || answers?.[SECOND_ID]?.[0] !== SECOND_LOCAL) {
    throw new Error(`Codex question response was not keyed by schema id: ${JSON.stringify(response)}`)
  }
  act(() => { setup.mockInput.pressEscape() })
  await settle(100)
  act(() => { setup.mockInput.pressKey('e') })
  await settle(200)
  const answeredFrame = setup.captureCharFrame()
  if (!answeredFrame.includes('✓ answered') || !answeredFrame.includes('Developer tool')) {
    throw new Error(`Codex question transcript card did not resolve with its answer:\n${answeredFrame}`)
  }

  console.log('OpenTUI Codex question stream smoke passed')
} finally {
  closeStream()
  act(() => { setup.renderer.destroy() })
}

process.exit(0)
