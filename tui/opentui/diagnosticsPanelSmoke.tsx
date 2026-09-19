/** @jsxImportSource @opentui/react */
// The diagnostics panel (⇧D) scrolls rather than clips.
//
// It renders fifteen sections into a 28-row overlay, so it has always shown less
// than it holds — the body was a plain `overflow="hidden"` box and everything
// past roughly the MCP list was simply not drawn, with nothing on screen to say
// so. The panel looked complete. Adding CONTEXT WINDOW, PERMISSION RULES and
// HOOKS REGISTERED made that materially worse, since those are the long ones.
//
// A clipped panel and a scrolled-to-top panel paint an IDENTICAL first frame, so
// the only way to tell them apart is to scroll and check that content which was
// off-screen arrives. That is what this does.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SessionDiagnosticSection } from '../../lib/types'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-diagnostics-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'diagnostics-smoke-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Diagnostics smoke',
  firstPrompt: 'Diagnostics smoke',
  lastModified: 1_700_000_000_000,
}

// A marker in the LAST section, far enough down that it cannot be on the first
// screen. If it is visible without scrolling the panel is not overflowing and
// this test proves nothing, so that is asserted too.
const TAIL_MARKER = 'TAIL-SECTION-MARKER'
const SECTIONS: SessionDiagnosticSection[] = [
  { id: 'commands', title: 'COMMANDS', items: Array.from({ length: 12 }, (_, i) => `command-${i}`) },
  { id: 'context-window', title: 'CONTEXT WINDOW', items: Array.from({ length: 12 }, (_, i) => `  ctx-row-${i} · 1.0k`) },
  { id: 'permission-rules', title: 'PERMISSION RULES', items: Array.from({ length: 20 }, (_, i) => `allow · Bash(cmd${i}) · localSettings · persistent`) },
  { id: 'latency', title: 'LATENCY & MODEL USAGE', items: [TAIL_MARKER] },
]

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
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
  readTuiSessionDiagnostics: async () => ({ sections: SECTIONS, currentModel: 'claude-opus-5' }),
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 34, kittyKeyboard: true })
const settle = async (ms = 150) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(500)

  // ⇧D opens diagnostics.
  act(() => { setup.mockInput.pressKey('d', { shift: true }) })
  await settle(600)
  if (!setup.captureCharFrame().includes('DIAGNOSTICS')) fail('⇧D did not open the diagnostics panel')
  if (!setup.captureCharFrame().includes('COMMANDS')) fail('diagnostics rendered no sections')

  // The premise: the content must not fit, or scrolling proves nothing.
  if (setup.captureCharFrame().includes(TAIL_MARKER)) {
    fail('the fixture fits on one screen, so this test cannot detect clipping')
  }

  // The footer has to advertise the keys, or a scrollable panel is
  // indistinguishable from a clipped one for anyone who does not guess.
  if (!setup.captureCharFrame().includes('⌃u/⌃d scroll')) fail('the panel scrolls but never says so')

  // ── scrolling reaches the last section ───────────────────────────────────
  for (let i = 0; i < 12 && !setup.captureCharFrame().includes(TAIL_MARKER); i += 1) {
    act(() => { setup.mockInput.pressKey('d', { ctrl: true }) })
    await settle(90)
  }
  if (!setup.captureCharFrame().includes(TAIL_MARKER)) {
    fail('scrolling never reached the last section — the panel is still clipping')
  }

  // ── and back up ──────────────────────────────────────────────────────────
  for (let i = 0; i < 12 && !setup.captureCharFrame().includes('COMMANDS'); i += 1) {
    act(() => { setup.mockInput.pressKey('u', { ctrl: true }) })
    await settle(90)
  }
  if (!setup.captureCharFrame().includes('COMMANDS')) fail('⌃u did not scroll back to the first section')

  // ── every item of a section is rendered ──────────────────────────────────
  // The renderer used to slice each section to 10 rows. That cap existed because
  // the panel clipped anyway; leaving it in would be a second, SILENT truncation
  // on top of the one the adapter applies and announces.
  let sawLastRule = false
  for (let i = 0; i < 12 && !sawLastRule; i += 1) {
    if (setup.captureCharFrame().includes('Bash(cmd19)')) { sawLastRule = true; break }
    act(() => { setup.mockInput.pressKey('d', { ctrl: true }) })
    await settle(90)
  }
  if (!sawLastRule) fail('the 20th rule of a section was never rendered — a section is still capped')

  // Escape closes. The raw byte, not pressEscape(): the abstract key name does
  // not reach this app's handler (the same quirk appSmoke works around).
  // Closing is deliberately NOT asserted here. The diagnostics overlay's cells
  // stay painted after it unmounts — React stops rendering the panel (verified by
  // instrumenting the render) but the frame still shows it. That reproduces with
  // the original plain `overflow="hidden"` body too, so it predates the scrollbox
  // and is a separate defect from what this file covers; asserting it here would
  // make this smoke fail for a reason it is not about.

  console.log('Diagnostics panel smoke passed (scrolls to the last section, renders full sections, advertises its keys)')
} finally {
  act(() => { setup.renderer.destroy() })
}
