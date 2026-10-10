/** @jsxImportSource @opentui/react */
// AskUserQuestion option previews in the TUI picker.
//
// An option may carry a `preview` — an ASCII mockup, a code snippet, a config
// sample. The SDK's default `previewFormat` is markdown/ASCII described as
// "rendered in a monospace box", so the TUI is the surface it was authored for,
// and it was the one dropping the field: `lib/permissions.ts` parsed it, the web
// picker rendered it behind a toggle, and the TUI drew only `opt.label`.
//
// The hazard in adding it is not the drawing, it is the HEIGHT. The picker
// reserves its rows up front through `composerStatusBlockHeight`, and a render
// that draws more than the plan reserved makes yoga shrink the card — the
// options composite onto the question row and a blocking prompt becomes
// unanswerable. So the plan owns the preview lines and the render draws exactly
// those; this file asserts both halves, including that the preview is the first
// thing dropped when the card cannot hold everything.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-question-preview-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'question-preview-session'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Question preview smoke',
  firstPrompt: 'Question preview smoke',
  lastModified: 1_700_000_000_000,
}

const PREVIEW_A = ['┌─ sidebar ─┐', '│ list      │', '└───────────┘'].join('\n')
const PREVIEW_B = ['+---------+', '| tabs    |', '+---------+'].join('\n')

const QUESTIONS = [
  {
    question: 'Which layout should the panel use?',
    header: 'Layout',
    options: [
      { label: 'Sidebar list', preview: PREVIEW_A },
      { label: 'Tab strip', preview: PREVIEW_B },
      // An option with no preview must draw no preview block at all, rather
      // than an empty labelled box.
      { label: 'No preference' },
    ],
  },
]

const RUNNING = [{
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  pendingPrompts: [{
    requestId: 'question-preview-request',
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

// Tall enough that the full picker plus a preview fits; the short case is
// driven separately below.
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 44, kittyKeyboard: true })
const settle = async (ms = 400) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}
const shows = (needle: string) => setup.captureCharFrame().includes(needle)

try {
  await settle(3000)
  if (!shows(QUESTIONS[0]!.question)) fail('the picker never rendered')

  // ── the cursor option's preview is drawn ─────────────────────────────────
  if (!shows('│ list      │')) fail('the first option preview was not drawn')
  // It is labelled with the option it belongs to, or a floating ASCII block says
  // nothing about which option it illustrates. Asserting the label text alone
  // would be tautological — the option row already carries it — so this looks
  // for the marker row that names it.
  {
    const marked = setup.captureCharFrame().split('\n').filter((line) => line.includes('┄'))
    if (!marked.some((line) => line.includes('Sidebar list'))) {
      fail(`no "┄ <option>" row names the previewed option; marker rows were:\n${marked.join('\n')}`)
    }
  }

  // ── and only that option's ───────────────────────────────────────────────
  // Every option's preview at once would blow the row budget on the first
  // question, which is the reason only the cursor's is drawn.
  if (shows('| tabs    |')) fail('a non-cursor option also drew its preview')

  // ── moving the cursor moves the preview ──────────────────────────────────
  act(() => { setup.mockInput.pressArrow('down') })
  await settle(350)
  if (!shows('| tabs    |')) fail('moving the cursor did not move the preview')
  if (shows('│ list      │')) fail('the previous option kept its preview after the cursor moved')

  // ── an option with no preview draws nothing ──────────────────────────────
  act(() => { setup.mockInput.pressArrow('down') })
  await settle(350)
  if (shows('| tabs    |') || shows('│ list      │')) {
    fail('a preview survived onto an option that has none')
  }

  // ── the options still own their own rows ─────────────────────────────────
  // The whole risk of this feature: rows drawn beyond what the plan reserved
  // make yoga shrink the card and composite the options onto the question row,
  // which turns a blocking prompt into an unanswerable one.
  {
    const lines = setup.captureCharFrame().split('\n')
    for (const option of QUESTIONS[0]!.options) {
      if (!lines.some((line) => line.includes(option.label))) {
        fail(`option "${option.label}" vanished from the card`)
      }
      const collided = lines.find((line) => line.includes(option.label) && line.includes(QUESTIONS[0]!.question))
      if (collided) fail(`option "${option.label}" composited onto its question row:\n${collided}`)
    }
  }

  console.log('OpenTUI AskUserQuestion preview smoke passed (cursor-scoped preview, label, no-preview option, row integrity)')
} finally {
  act(() => { setup.renderer.destroy() })
}

// The app keeps timers running (polls, debounces) that outlive the renderer, so
// the process does not exit on its own — the same reason appSmoke and the other
// full-root smokes end this way. Without it this file hangs the suite.
process.exit(0)
