/** @jsxImportSource @opentui/react */
// What a turn did, where the engineer looks: each turn closes with
// `Worked for 16s · 2 files · +3 −1`, and a click on it opens that turn's
// checkpoint diff bounded by the next turn's snapshot. Also pins the chrome
// that frees rows for it: the status bar rides the composer dock's border
// (one row, mode-dependent keys only), the border carries context and plan-limit
// meters that turn amber/red as they fill, and a tab says when its session is
// waiting on you.
//
// Every one of these renders as plausible text either way, so the counts are
// checked against the edits' real line changes and the click against the diff
// range actually requested.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'
import { fileEditStatsFromToolCalls, formatFileEditSummary } from '../../lib/turnEditStats'
import type { TurnCheckpoint } from '../../lib/checkpoints'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-turn-summary-smoke-')))
delete process.env.AGENT_VIEWER_ATTACH

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

// ── counting: the calls' real line changes ─────────────────────────────────
{
  const stats = fileEditStatsFromToolCalls([
    // Ten lines of shared context, one word changed: −1 +1, not −10 +10.
    {
      name: 'Edit',
      input: {
        file_path: '/repo/a.ts',
        old_string: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'old'].join('\n'),
        new_string: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'new'].join('\n'),
      },
      failed: false,
    },
    { name: 'Write', input: { file_path: '/repo/b.ts', content: 'one\ntwo' }, failed: false },
    // A failed call changed nothing.
    { name: 'Edit', input: { file_path: '/repo/c.ts', old_string: 'x', new_string: 'y\nz' }, failed: true },
    // A patch's own +/- lines, per file, merged with the edit to a.ts.
    {
      name: 'apply_patch',
      input: { patch: '*** Begin Patch\n*** Update File: /repo/a.ts\n@@\n-gone\n+here\n+also\n*** End Patch' },
      failed: false,
    },
    { name: 'Read', input: { file_path: '/repo/d.ts' }, failed: false },
  ])
  const byPath = new Map(stats.map((stat) => [stat.path, stat]))
  assert(stats.length === 2, `expected 2 files, got ${JSON.stringify(stats)}`)
  assert(byPath.get('/repo/a.ts')?.added === 3 && byPath.get('/repo/a.ts')?.removed === 2, `a.ts counts wrong: ${JSON.stringify(byPath.get('/repo/a.ts'))}`)
  assert(byPath.get('/repo/b.ts')?.added === 2 && byPath.get('/repo/b.ts')?.removed === 0, 'b.ts counts wrong')
  assert(formatFileEditSummary(stats) === '2 files · +5 −2', `summary was ${formatFileEditSummary(stats)}`)
  assert(formatFileEditSummary([]) === null, 'a turn with no edits must not claim one')
}

// ── the app ────────────────────────────────────────────────────────────────
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'turn-summary-smoke-session'
const TITLE = 'Turn summary smoke'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: TITLE,
  firstPrompt: TITLE,
  lastModified: 1_700_000_000_000,
}
const T0 = Date.parse('2026-10-17T01:00:00Z')
const card = (key: string, role: 'user' | 'assistant', text: string, atSeconds: number, extra: Partial<TuiTranscriptCard> = {}): TuiTranscriptCard => ({
  key,
  role,
  provider: 'claude',
  label: role === 'user' ? 'You' : 'Assistant',
  category: 'conversation',
  autoFold: false,
  compactSummary: text,
  lines: [{ text, tone: 'default' as const }],
  expandedLines: [{ text, tone: 'default' as const }],
  searchText: text,
  searchHaystackLower: text.toLowerCase(),
  timestampMs: T0 + atSeconds * 1000,
  ...extra,
})
const DETAIL = {
  info: { sessionId: SESSION_ID, cwd: process.cwd() },
  rawMessages: [
    { type: 'user', uuid: 'p1', session_id: SESSION_ID, parent_tool_use_id: null, timestamp: new Date(T0).toISOString(), message: { role: 'user', content: 'Fix the parser' } },
    { type: 'user', uuid: 'p2', session_id: SESSION_ID, parent_tool_use_id: null, timestamp: new Date(T0 + 60_000).toISOString(), message: { role: 'user', content: 'Now the docs' } },
  ],
  threadedMessages: [],
  transcriptCards: [
    card('p1', 'user', 'Fix the parser', 0),
    card('a1', 'assistant', 'Edited the parser.', 16, {
      fileEdits: [{ path: '/repo/parser.ts', added: 2, removed: 1 }, { path: '/repo/lexer.ts', added: 1, removed: 0 }],
    }),
    card('p2', 'user', 'Now the docs', 60),
    card('a2', 'assistant', 'Docs updated.', 64, { fileEdits: [{ path: '/repo/README.md', added: 4, removed: 2 }] }),
  ],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: { totalTokens: 170_000, maxTokens: 200_000, percentage: 85, model: 'claude-opus-5-5', categories: [] },
}
const RESETS_AT = Date.now() + 2 * 60 * 60 * 1000
const LIMITS = { windows: [{ label: '5h', utilization: 82, resetsAt: RESETS_AT }, { label: '7d', utilization: 30, resetsAt: null }], readAt: Date.now() }
const CHECKPOINTS: TurnCheckpoint[] = [
  { ref: 'refs/agent-viewer-checkpoints/3', sha: 'sha-later', createdAt: T0 + 60_000, label: 'Now the docs', sessionId: SESSION_ID, provider: 'claude' },
  { ref: 'refs/agent-viewer-checkpoints/2', sha: 'sha-other', createdAt: T0 + 30_000, label: 'unrelated', sessionId: 'another-session', provider: 'claude' },
  { ref: 'refs/agent-viewer-checkpoints/1', sha: 'sha-turn', createdAt: T0 + 200, label: 'Fix the parser', sessionId: SESSION_ID, provider: 'claude' },
]
const diffRequests: Array<{ sha: string; until?: string }> = []

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION],
  readTuiSessionDetailAsync: async () => DETAIL,
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: DETAIL.contextUsage }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiTranscriptView: async () => 'stream',
  writeTuiTranscriptView: async () => {},
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: DETAIL.contextUsage }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [{ sessionId: SESSION_ID, provider: 'claude', backgroundTasks: [], sessionCrons: [], updatedAt: Date.now() }], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
  peekTuiClaudePlanLimits: () => LIMITS,
  readTuiClaudePlanLimits: async () => LIMITS,
  listTuiCheckpoints: async () => CHECKPOINTS,
  listTuiWorkingDiff: async () => ({ hunks: [], untracked: [] }),
  readTuiCheckpointChanges: async () => [],
  readTuiCheckpointDiff: async (_cwd: string, sha: string, _file?: string, until?: string) => {
    diffRequests.push({ sha, until })
    return '--- a/parser.ts\n+++ b/parser.ts\n@@ -1 +1 @@\n-old parse\n+new parse'
  },
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 160, height: 44, kittyKeyboard: true })
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
const waitFor = async (description: string, predicate: () => boolean, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate() && Date.now() < deadline) await settle(150)
  if (!predicate()) fail(description)
}
const rowsWith = (text: string) => frame().split('\n').filter((row) => row.includes(text))

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(800)
  if (process.env.DUMP_FRAME) console.log(frame())

  // ── each turn closes with what it did ──────────────────────────────────
  await waitFor('The first turn has no summary rule', () => rowsWith('Worked for 16s · 2 files · +3 −1').length > 0)
  await waitFor('The last turn has no closing summary', () => rowsWith('Worked for 4s · 1 file · +4 −2').length > 0)

  // ── one footer row, in the dock border ─────────────────────────────────
  const dockRows = rowsWith('model:')
  if (dockRows.length !== 1) fail('Expected one dock border row carrying the model')
  if (!dockRows[0]!.includes('⌃K commands')) fail('The status bar keys did not move into the dock border')
  if (rowsWith('⇧W').length > 0 || rowsWith('←/→ tabs').length > 0) fail('Fixed keys still crowd the footer; they belong in ?')
  const lastRow = frame().split('\n').filter((row) => row.trim()).at(-1) ?? ''
  if (lastRow.includes('⌃K commands') && !lastRow.includes('model:')) fail('A separate status-bar row is still drawn')

  // ── meters ─────────────────────────────────────────────────────────────
  if (!dockRows[0]!.includes('ctx:170.0k/200.0k 85%')) fail('The context meter is missing from the dock border')
  if (!/limit:5h 82% ↻/.test(dockRows[0]!)) fail('The plan-limit meter (tightest window, with its reset) is missing')
  // Urgent meters move ahead of the model, where the border cannot cut them off.
  if (dockRows[0]!.indexOf('ctx:') > dockRows[0]!.indexOf('model:')) fail('Urgent meters were not moved ahead of the model')

  // ── a tab says its session waits on you ─────────────────────────────────
  type Box = { x: number; y: number; width: number }
  const tabs = setup.renderer.root.findDescendantById('session-tabs') as unknown as Box | null
  const tabRow = tabs ? (frame().split('\n')[tabs.y] ?? '').slice(tabs.x, tabs.x + tabs.width) : ''
  if (!tabRow.includes(`◌ ${TITLE}`)) fail(`A waiting session's tab has no ◌ glyph: "${tabRow}"`)

  // ── a click opens that turn's checkpoint diff ──────────────────────────
  const rows = frame().split('\n')
  const y = rows.findIndex((row) => row.includes('Worked for 16s'))
  const x = rows[y]!.indexOf('Worked for 16s') + 3
  await act(async () => { await setup.mockMouse.click(x, y) })
  await waitFor('Clicking the turn summary did not open the checkpoint diff', () => frame().includes('+new parse'))
  const request = diffRequests.at(-1)
  if (request?.sha !== 'sha-turn') fail(`The diff was not the clicked turn's checkpoint: ${JSON.stringify(request)}`)
  // Bounded by this session's next snapshot, not another session's, and not "now".
  if (request?.until !== 'sha-later') fail(`The diff was not bounded by the next turn: ${JSON.stringify(request)}`)

  console.log('Turn summary smoke passed (counts, per-turn summary, click → bounded checkpoint diff, one-row footer in dock, meters, tab glyph)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
