/** @jsxImportSource @opentui/react */
// `x` in the rail settles a session — the web rail's ✓ — through the same
// store, so finished work leaves the resting list. Pins: the row is marked at
// once and stays while selected (a second `x` reopens it), leaves the list once
// the cursor moves on and is counted in the header, the state is written to
// the shared store, and a write made by another process reaches a listing.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-settled-smoke-')))
delete process.env.AGENT_VIEWER_ATTACH

const inbox = await import('../../lib/sessionInbox')
const INBOX_FILE = path.join(process.cwd(), '.agent-viewer-data', 'session-inbox.json')

// ── another process's write reaches this one's next read ─────────────────
{
  const before = await inbox.readSessionInboxStates([{ provider: 'claude', sessionId: 'elsewhere' }])
  if (before.size !== 0) throw new Error('fresh store is not empty')
  mkdirSync(path.dirname(INBOX_FILE), { recursive: true })
  writeFileSync(INBOX_FILE, JSON.stringify({ version: 1, states: { 'claude:claude:elsewhere': { settledAt: 1 } } }))
  const after = await inbox.readSessionInboxStates([{ provider: 'claude', sessionId: 'elsewhere' }])
  if (after.get('claude:claude:elsewhere')?.settledAt !== 1) throw new Error('A settle written by another process never reached this one: the store cache is held for the process lifetime')
}

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const session = (id: string, title: string, ageMinutes: number): Session => ({
  sessionId: id,
  provider: 'claude',
  cwd: process.cwd(),
  summary: title,
  firstPrompt: title,
  lastModified: Date.now() - ageMinutes * 60_000,
} as Session)
// Old enough not to read as written by a CLI elsewhere — that mark, and
// keeping a live session visible, outrank settling.
const BASE = [session('s-alpha', 'Alpha work', 60), session('s-beta', 'Beta work', 120), session('s-gamma', 'Gamma work', 180)]
// The listing decorates from the real store, as lib/sessionReads does.
const listSessions = async () => {
  const states = await inbox.readSessionInboxStates(BASE)
  return BASE.map((s) => {
    const state = states.get(inbox.sessionInboxKey('claude', s.sessionId))
    return state ? { ...s, inbox: state } : s
  })
}
const DETAIL = {
  info: null, rawMessages: [], threadedMessages: [], transcriptCards: [],
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
}

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: listSessions,
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
  readTuiSessions: listSessions,
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 140, height: 30, kittyKeyboard: true })
const settle = async (ms = 200) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
    await setup.flush()
  })
}
const frame = () => setup.captureCharFrame()
const fail = (message: string): never => {
  throw new Error(`${message}\n${frame()}`)
}
// Rail rows only: the tab strip carries the selected title too.
const row = (title: string) => frame().split('\n').map((line) => line.slice(0, 32)).find((line) => line.startsWith('│') && line.includes(title)) ?? null
const press = async (sequence: string) => {
  act(() => { setup.mockInput.pressKey(sequence) })
  await settle(300)
}
const stored = () => {
  try {
    return (JSON.parse(readFileSync(INBOX_FILE, 'utf8')) as { states: Record<string, { settledAt?: number }> }).states
  } catch {
    return {}
  }
}

try {
  await settle(2500)
  if (!row('Alpha work')) fail('The rail never listed the sessions')

  // ── the footer lists the rail's own keys while it has focus ─────────────
  const footer = frame().split('\n').filter((line) => line.includes('⌃K commands')).at(-1) ?? ''
  if (process.env.DUMP_FRAME) console.log(footer)
  for (const hint of ['j/k select', 'x settle', '/ search', '⌃R rename']) {
    if (!footer.includes(hint)) fail(`The footer does not hint "${hint}" while the rail has focus: ${footer}`)
  }
  // Priority order: a later, smaller group must not show once one was dropped.
  if (!footer.includes('⇧S sort') && footer.includes('[/] width')) fail(`A low-priority hint showed after a dropped group: ${footer}`)

  // ── x marks the selected row and writes the store ────────────────────────
  await press('x')
  const marked = row('Alpha work')
  if (!marked?.includes('✓')) fail('Settling did not mark the selected row')
  if (!stored()['claude:claude:s-alpha']?.settledAt) fail('Settling did not reach the shared store')

  // ── a second x reopens it ────────────────────────────────────────────────
  await press('x')
  if (row('Alpha work')?.includes('✓')) fail('A second x did not reopen the session')
  if (stored()['claude:claude:s-alpha']?.settledAt) fail('Reopening did not reach the shared store')

  // ── settled, then the cursor moves on: the row leaves the resting list ──
  await press('x')
  await press('j')
  await settle(5600) // through a sidebar poll, which must not put it back
  if (row('Alpha work')) fail('A settled session stayed in the list after the cursor moved on')
  // A narrow rail drops the `1 settled` suffix; the count still says one is hidden.
  if (!frame().includes('SESSIONS 2/3')) fail('The header does not count the settled session it hides')
  if (!row('Beta work')) fail('Settling one session hid another')

  console.log('Settled sessions smoke passed (cross-process store read, x marks + writes, x reopens, hidden once left and counted, survives a poll)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
