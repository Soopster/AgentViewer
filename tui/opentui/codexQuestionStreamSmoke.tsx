/** @jsxImportSource @opentui/react */
// Codex structured-question smoke: drives the native app-server request through
// a live TUI turn, verifies both the transcript card and picker, then answers it
// and checks the response payload and resolved card.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
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

  act(() => { setup.mockInput.pressKey('1') })
  await settle(100)
  act(() => { setup.mockInput.pressEnter() })
  await settle(500)

  const response = actions.find((action) => action.action === 'respondQuestion')
  const answers = response?.answers as Record<string, string[]> | undefined
  if (response?.permissionId !== 'request-1' || answers?.[QUESTION_ID]?.[0] !== 'Developer tool') {
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
