/** @jsxImportSource @opentui/react */
// A tab whose session has a turn in flight spins, so work you are not looking
// at is still visible from the strip.
//
// The animation is applied imperatively (the root's render is far too
// expensive to run ten times a second for one glyph), which means React's own
// tree says nothing about it — the only way to know the frame is painted, and
// that it keeps moving, is to render the real app against the real running
// registry and read the frame back.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setRunningSession, clearRunningSession } from '../../lib/sessionRuntime'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-tab-spinner-smoke-')))
// An attached TUI would observe the daemon's registry instead of the one this
// smoke injects into.
delete process.env.AGENT_VIEWER_ATTACH

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'tab-spinner-smoke-session'
const TITLE = 'Tab spinner smoke'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: TITLE,
  firstPrompt: TITLE,
  lastModified: 1_700_000_000_000,
}
const DETAIL = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
}

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION],
  readTuiSessionDetailAsync: async () => DETAIL,
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
// readTuiRuntimeActivity is deliberately NOT mocked: the spinner's whole input
// is the running registry, and a stubbed activity read would assert nothing
// about the path that actually drives it.
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const { TAB_SPINNER_FRAMES } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 140, height: 40, kittyKeyboard: true })
const settle = async (ms = 200) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
    await setup.flush()
  })
}
const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}
// Read the strip's own row and columns. The sidebar carries the same title, so
// a frame-wide search for it would pass against a row the strip never painted.
type Box = { x: number; y: number; width: number }
const tabLine = (): string => {
  const box = setup.renderer.root.findDescendantById('session-tabs') as unknown as Box | null
  if (!box) return ''
  const row = setup.captureCharFrame().split('\n')[box.y] ?? ''
  return row.slice(box.x, box.x + box.width)
}
const spinnerGlyph = (line: string): string | null =>
  TAB_SPINNER_FRAMES.find((frame) => line.includes(`${frame} `)) ?? null
const waitFor = async (description: string, predicate: () => boolean, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await settle(150)
  if (!predicate()) fail(description)
}

try {
  await settle(2500)
  // Open the session as a tab — the strip only exists once something is in it.
  act(() => { setup.mockInput.pressEnter() })
  await settle(600)
  if (!tabLine().includes(TITLE)) fail('The tab strip never rendered the session')

  // ── idle: no spinner ─────────────────────────────────────────────────────
  // A permanently spinning tab says nothing; the glyph has to mean a turn.
  if (spinnerGlyph(tabLine())) fail('An idle tab is spinning')

  // ── running: the tab spins, and keeps spinning ───────────────────────────
  act(() => {
    setRunningSession(SESSION_ID, { provider: 'claude', interrupt: async () => {} })
  })
  await waitFor('A running session did not put a spinner on its tab', () => spinnerGlyph(tabLine()) !== null)
  if (!tabLine().includes(TITLE)) fail('The spinner replaced the tab title instead of prefixing it')

  // A static first frame is indistinguishable from a spinner that never
  // advances — which is exactly what a missing interval looks like.
  const firstGlyph = spinnerGlyph(tabLine())
  await waitFor(
    'The tab spinner never advanced past its first frame',
    () => {
      const glyph = spinnerGlyph(tabLine())
      return glyph !== null && glyph !== firstGlyph
    },
    4000,
  )

  // ── the turn ends: the glyph goes, the title stays ───────────────────────
  act(() => { clearRunningSession(SESSION_ID) })
  await waitFor('The spinner outlived the turn that started it', () => spinnerGlyph(tabLine()) === null)
  if (!tabLine().includes(TITLE)) fail('Clearing the spinner took the tab title with it')

  console.log('Tab spinner smoke passed (idle clean, spins while running, advances, clears on finish)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
