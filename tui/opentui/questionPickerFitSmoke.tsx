/** @jsxImportSource @opentui/react */
// AskUserQuestion picker fit smoke.
//
// The picker reserves its rows through composerStatusBlockHeight. That
// reservation used to be unbounded — one row per question plus one per option
// — so on a short terminal it asked for more rows than existed, yoga shrank
// the card, and the options that fell off the bottom were invisible AND
// unanswerable. A blocking prompt you cannot see is the worst possible
// failure, and it happened on every transcript view, for every provider.
//
// This drives the real OpenTUI root once per transcript view at a short
// height and asserts the focused question stays completely answerable.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const VIEWS = ['conversation', 'full', 'continue', 'stream', 'agents', 'chat'] as const
const view = process.env.SMOKE_PICKER_VIEW

// Parent: run one child per view, since the transcript view is read once at
// startup and the app root is a module singleton.
if (!view) {
  for (const candidate of VIEWS) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, SMOKE_PICKER_VIEW: candidate },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(`Picker fit smoke failed in "${candidate}" view:\n${result.stdout}\n${result.stderr}`)
    }
  }
  console.log(`OpenTUI AskUserQuestion picker fit smoke passed (${VIEWS.length} views)`)
  process.exit(0)
}

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-picker-fit-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'picker-fit-smoke-session'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Picker fit smoke',
  firstPrompt: 'Picker fit smoke',
  lastModified: 1_700_000_000_000,
}

const QUESTIONS = [
  {
    question: 'Which subsystem should we start with?',
    header: 'Scope',
    options: [
      { label: 'The composer send path' },
      { label: 'The transcript renderer' },
      { label: 'The session index' },
      { label: 'The coordinator' },
    ],
    allowFreeform: true,
  },
  {
    question: 'How thorough should the pass be?',
    header: 'Depth',
    options: [
      { label: 'Quick sanity check' },
      { label: 'Normal review' },
      { label: 'Exhaustive audit' },
    ],
  },
]

const RUNNING = [{
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  pendingPrompts: [{
    requestId: 'picker-fit-request',
    sessionId: SESSION_ID,
    toolName: 'AskUserQuestion',
    input: { questions: QUESTIONS },
  }],
  pendingPermissions: [],
}]

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
const tuiState = await import('../../lib/tuiState')
mock.module('../../lib/tuiState', () => ({
  ...tuiState,
  getConfiguredTuiTranscriptView: async () => view,
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => EMPTY_DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  listTuiRunningSessions: async () => RUNNING,
  readTuiRuntimeActivity: async () => ({ running: RUNNING, waiting: [], attention: [] }),
  prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [],
  readTuiComposerOptions: async () => ({ agents: [], models: [] }),
}))

const { default: OpenTuiApp } = await import('./App')

// Deliberately short: 26 rows is a perfectly ordinary split terminal, and the
// unbounded reservation clipped the picker well before this.
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 26, kittyKeyboard: true })
const settle = async (ms: number) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const press = async (arrow: 'up' | 'down' | 'left' | 'right') => {
  act(() => { setup.mockInput.pressArrow(arrow) })
  await settle(200)
}
const rows = () => setup.captureCharFrame().split('\n')
const has = (needle: string) => rows().some((line) => line.includes(needle))
const cursorRow = () => rows().find((line) => /▶\s+[○●☐☑]/.test(line)) ?? ''

try {
  await settle(3000)

  const frame = setup.captureCharFrame()
  if (!has(QUESTIONS[0]!.question)) throw new Error(`Focused question missing in "${view}":\n${frame}`)
  // Unfocused questions keep a row of their own, or ←/→ is undiscoverable.
  if (!has(QUESTIONS[1]!.question)) throw new Error(`Unfocused question lost its row in "${view}":\n${frame}`)
  if (!/submit/.test(frame)) throw new Error(`Picker hint missing in "${view}":\n${frame}`)
  if (!cursorRow()) throw new Error(`No option cursor is visible in "${view}":\n${frame}`)

  // Nothing may composite onto the question rows.
  for (const question of QUESTIONS) {
    for (const option of question.options) {
      const collided = rows().find((line) => line.includes(option.label) && line.includes(question.question))
      if (collided) throw new Error(`Option composited onto its question row in "${view}":\n${collided}`)
    }
  }

  // Every option of the focused question must be reachable — including the
  // freeform "Other" row, which is a separate render branch and was the one
  // that escaped the window.
  const seen = new Set<string>()
  for (let i = 0; i < QUESTIONS[0]!.options.length + 1; i += 1) {
    const row = cursorRow()
    if (!row) throw new Error(`Option ${i + 1} of the focused question is not visible in "${view}"`)
    seen.add(row.trim())
    if (i < QUESTIONS[0]!.options.length) await press('down')
  }
  for (const option of QUESTIONS[0]!.options) {
    if (![...seen].some((row) => row.includes(option.label))) {
      throw new Error(`Option "${option.label}" was never reachable in "${view}":\n${[...seen].join('\n')}`)
    }
  }
  if (![...seen].some((row) => row.includes('Other'))) {
    throw new Error(`The freeform option was never reachable in "${view}":\n${[...seen].join('\n')}`)
  }

  // ←/→ must move focus and expand the other question's options.
  await press('right')
  if (!has(QUESTIONS[1]!.options[0]!.label)) {
    throw new Error(`Second question did not expand its options in "${view}":\n${setup.captureCharFrame()}`)
  }

  console.log(`picker fit ok: ${view}`)
} finally {
  act(() => {
    setup.renderer.destroy()
  })
}

process.exit(0)
