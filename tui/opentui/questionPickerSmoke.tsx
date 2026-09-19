/** @jsxImportSource @opentui/react */
// AskUserQuestion picker smoke: mounts the real OpenTUI root with a mocked
// service layer that reports one running Claude session blocked on a
// multi-question AskUserQuestion prompt, then asserts the picker's rows do not
// composite on top of each other. The composer reserves the picker's height up
// front (`composerStatusBlockHeight`); when that budget is short, yoga shrinks
// the card and every option line lands on the question's row.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-question-smoke-')))

// `bun:test` isn't in @types/node (no bun-types dependency here), so the module
// mocker is resolved at runtime and typed locally — same pattern metricsLogger
// uses for Bun-only APIs.
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'question-smoke-session'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Question picker smoke',
  firstPrompt: 'Question picker smoke',
  lastModified: 1_700_000_000_000,
}

const QUESTIONS = [
  {
    question: 'What have you noticed about the TUI hang so far?',
    header: 'Symptom',
    options: [
      { label: 'Hangs on startup' },
      { label: 'Hangs after some interaction' },
      { label: 'Only hangs under tmux' },
      { label: 'Not sure / just saw it in memory' },
    ],
  },
  {
    question: 'What real terminal is this happening in?',
    header: 'Env',
    options: [
      { label: 'iTerm2' },
      { label: 'A real terminal (iTerm/Terminal.app/tmux)' },
      { label: 'VS Code integrated terminal' },
      { label: 'Not sure / need to check' },
    ],
  },
]

const RUNNING = [{
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  pendingPrompts: [{
    requestId: 'question-smoke-request',
    sessionId: SESSION_ID,
    toolName: 'AskUserQuestion',
    input: { questions: QUESTIONS },
  }],
  pendingPermissions: [],
}]

const EMPTY_DETAIL ={ info: null, rawMessages: [], threadedMessages: [], contextUsage: null }

// The sidebar/reader read through worker clients, so they are mocked
// separately from the main-thread service (mocks do not cross worker threads).
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
  listTuiRunningSessions: async () => RUNNING,
  readTuiRuntimeActivity: async () => ({ running: RUNNING, waiting: [], attention: [] }),
}))

const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 120, height: 44, kittyKeyboard: true })

try {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
  })
  const frame = setup.captureCharFrame()
  const lines = frame.split('\n')

  // Every option label must own a full row. A short height budget composites
  // them onto the question row, which shows up as a line carrying both.
  const expectations = [
    ...QUESTIONS[0]!.options.map((o) => o.label),
    ...QUESTIONS[1]!.options.map((o) => o.label),
    QUESTIONS[0]!.question,
    QUESTIONS[1]!.question,
  ]
  for (const text of expectations) {
    if (!lines.some((line) => line.includes(text))) {
      throw new Error(`Picker frame is missing "${text}":\n${frame}`)
    }
  }
  for (const question of QUESTIONS) {
    for (const option of question.options) {
      const collided = lines.find((line) => line.includes(option.label) && line.includes(question.question))
      if (collided) {
        throw new Error(`Option "${option.label}" composited onto its question row:\n${collided}\n\n${frame}`)
      }
    }
  }

  console.log('OpenTUI AskUserQuestion picker smoke passed')
} finally {
  act(() => {
    setup.renderer.destroy()
  })
}
