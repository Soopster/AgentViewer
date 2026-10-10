/** @jsxImportSource @opentui/react */
// SCROLLBACK view: STREAM's rows read as a terminal scrollback. No card is ever
// highlighted, j/k move the text by rows rather than a cursor by cards, and
// scrolling back to the bottom follows the tail again.
//
// None of that is visible to a type-checker, and most of it is not visible in
// a single frame either — a cursor-less view and a view whose cursor happens to
// be off screen paint the same thing — so this drives the real root and reads
// the scroll position back.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-scrollback-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'scrollback-smoke-session',
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Scrollback transcript smoke',
  firstPrompt: 'Scrollback transcript smoke',
  lastModified: 1_700_000_000_000,
}
const card = (key: string, role: 'user' | 'assistant', lines: string[]): TuiTranscriptCard => ({
  key,
  role,
  provider: 'claude',
  label: role === 'user' ? 'You' : 'Assistant',
  category: 'conversation',
  autoFold: false,
  compactSummary: lines[0] ?? '',
  lines: lines.map((text) => ({ text, tone: 'default' as const })),
  expandedLines: lines.map((text) => ({ text, tone: 'default' as const })),
  searchText: lines.join('\n'),
  searchHaystackLower: lines.join('\n').toLowerCase(),
})

// Replies of seven rows: a card cursor can only move in steps of a whole
// reply, and a reply cut off by the viewport's top edge is what a stray
// scroll-into-view would visibly pull back down.
const REPLY_ROWS = 7
const REPLIES = Array.from({ length: 20 }, (_, reply) => card(
  `scrollback-reply-${reply}`,
  'assistant',
  Array.from({ length: REPLY_ROWS }, (_, row) => `reply ${String(reply).padStart(2, '0')} row ${row}`),
))
const USER = card('scrollback-user', 'user', ['Explain the pool.'])
const LAST = card('scrollback-last', 'assistant', ['That is the whole pool.'])
// A tool row folds to its first line of output; only an expanded card shows
// the second.
const TOOL: TuiTranscriptCard = {
  ...card('scrollback-tool', 'assistant', ['tool Bash: pwd']),
  label: 'Bash',
  category: 'technical',
  autoFold: true,
  lines: [{ text: 'tool Bash: pwd', tone: 'tool' }],
  expandedLines: [{ text: 'tool Bash: pwd', tone: 'tool' }, { text: '/srv/pool-checkout', tone: 'result_ok' }, { text: 'second-output-row', tone: 'result_ok' }],
}

const DETAIL = {
  info: null,
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [USER, ...REPLIES, TOOL, LAST],
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
  readTuiTranscriptView: async () => 'scrollback',
  writeTuiTranscriptView: async () => {},
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms = 200) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

type Scroll = { scrollTop: number; scrollHeight: number; viewport: { height: number } }
const scroll = () => {
  const sb = setup.renderer.root.findDescendantById('transcript-scroll') as unknown as Scroll | null
  if (!sb) throw new Error(`no transcript scrollbox:\n${setup.captureCharFrame()}`)
  return sb
}
const limit = () => Math.max(scroll().scrollHeight - scroll().viewport.height, 0)
// The pane title says READING for as long as the tail is not being followed;
// being scrolled to the bottom is not the same thing.
const followsTail = () => !setup.captureCharFrame().includes('READING')
const rowWith = (needle: string) => setup.captureCharFrame().split('\n').find((row) => row.includes(needle))

const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}
// Each press is its own tap: velocity scroll (off by default) would otherwise
// be free to turn a held key into more than a row.
const press = async (key: string, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    act(() => { setup.mockInput.pressKey(key) })
    await settle()
  }
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(600)

  if (process.env.DUMP_FRAME) console.log(setup.captureCharFrame())
  if (!rowWith('That is the whole pool.')) fail('SCROLLBACK did not open on the tail of the transcript')
  if (limit() < 60) fail('The fixture no longer overflows the viewport; scrolling would prove nothing')
  if (scroll().scrollTop !== limit()) fail('SCROLLBACK did not start at the bottom')

  // ── the pane is the transcript ───────────────────────────────────────────
  // The stream views draw no reader header, context row or idle ticker; the
  // rows budgeted for them belong to the text. At 40 rows that is the pane's
  // frame, the dock and the status bar away from the whole screen.
  if (scroll().viewport.height < 29) {
    fail(`SCROLLBACK shows ${scroll().viewport.height} transcript rows of 40; chrome is holding the rest`)
  }
  {
    const { IDLE_TICKER_PHRASES } = await import('./App')
    const frame = setup.captureCharFrame()
    if (IDLE_TICKER_PHRASES.some((phrase) => frame.includes(phrase))) fail('SCROLLBACK painted the idle ticker')
    const title = frame.split('\n').find((row) => row.includes('SCROLLBACK')) ?? ''
    if (/\d+\/\d+/.test(title)) fail('SCROLLBACK titled the pane with a card position it has no cursor for')
  }

  // ── nothing is highlighted ───────────────────────────────────────────────
  // A stream-like view marks its cursor card with ❯; the tail card is where
  // the cursor sits on open, so it is the one that would carry it.
  if (rowWith('That is the whole pool.')!.includes('❯')) fail('SCROLLBACK painted a card cursor')

  // ── j/k move the text by rows ────────────────────────────────────────────
  // A card cursor moving up from the tail would reveal a whole seven-row
  // reply; three rows is only reachable by scrolling the text.
  const bottom = limit()
  const paneTop = (scroll() as unknown as { y: number }).y
  await press('k', 3)
  // Leaving the tail must not shift the pane: the text would jump by more
  // than the rows that were asked for.
  if ((scroll() as unknown as { y: number }).y !== paneTop) fail('SCROLLBACK shifted the transcript pane on leaving the tail')
  if (scroll().scrollTop !== bottom - 3) {
    fail(`SCROLLBACK k×3 moved ${bottom - scroll().scrollTop} rows; expected 3`)
  }
  if (rowWith('That is the whole pool.')?.includes('❯')) fail('SCROLLBACK painted a card cursor after scrolling')
  await press('j', 1)
  if (scroll().scrollTop !== bottom - 2) fail('SCROLLBACK j did not move the text down one row')

  // ── and every row of a walk is one row ───────────────────────────────────
  // Scrolling drags the hidden cursor onto whichever reply the top edge now
  // cuts through. Revealing that cursor would pull the reply fully into view,
  // so a walk long enough to cross reply boundaries has to stay exact.
  for (let step = 1; step <= REPLY_ROWS * 2 + 2; step += 1) {
    await press('k')
    if (scroll().scrollTop !== bottom - 2 - step) {
      fail(`SCROLLBACK k moved ${bottom - 2 - scroll().scrollTop} rows after ${step} presses`)
    }
  }
  await press('j', REPLY_ROWS * 2 + 2)
  if (scroll().scrollTop !== bottom - 2) fail('SCROLLBACK did not walk back down row for row')

  // ── paging, and the position holds ───────────────────────────────────────
  // Leaving the tail parks the hidden cursor on a visible message; revealing
  // that cursor would pull a reply cut by the top edge fully into view.
  act(() => { setup.mockInput.pressKey('u', { ctrl: true }) })
  await settle(500)
  const halfPage = Math.ceil((scroll().viewport.height - 2) / 2)
  if (scroll().scrollTop !== bottom - 2 - halfPage) {
    fail(`SCROLLBACK ⌃u moved ${bottom - 2 - scroll().scrollTop} rows; expected ${halfPage}`)
  }
  if (rowWith('That is the whole pool.')) fail('SCROLLBACK still shows the tail after paging up')
  // A page is far enough that the hidden cursor's reply leaves the viewport
  // and the cursor is re-parked on the reply the top edge cuts through — the
  // one case where revealing it would move the text.
  for (let pages = 1; pages <= 2; pages += 1) {
    const before = scroll().scrollTop
    // No mock name for PageUp; pressKey would type the letters.
    act(() => { setup.renderer.stdin.emit('data', Buffer.from('\x1b[5~')) })
    await settle(500)
    const expected = Math.max(before - (scroll().viewport.height - 2), 0)
    if (scroll().scrollTop !== expected) {
      fail(`SCROLLBACK PgUp ${pages} landed on row ${scroll().scrollTop}; expected ${expected}`)
    }
  }
  if (followsTail()) fail('SCROLLBACK still claims to follow the tail after paging up')

  // ── the bottom follows the tail again ────────────────────────────────────
  for (let i = 0; i < 12 && scroll().scrollTop < limit(); i += 1) {
    act(() => { setup.mockInput.pressKey('d', { ctrl: true }) })
    await settle()
  }
  if (scroll().scrollTop !== limit()) fail('SCROLLBACK could not scroll back to the bottom')
  if (!rowWith('That is the whole pool.')) fail('SCROLLBACK lost the tail after scrolling back down')
  // Being at the bottom is not following it: without this a reply arriving
  // now would land below the fold.
  if (!followsTail()) fail('SCROLLBACK reached the bottom without following the tail again')

  // ── a click focuses, it does not select ──────────────────────────────────
  // Click a reply the top edge cuts through: selecting it would reveal it,
  // which is the scroll a click must not cause.
  const topReplyRow = () => {
    const rows = setup.captureCharFrame().split('\n')
    const index = rows.findIndex((row) => /reply \d\d row \d/.test(row))
    return { index, cut: index >= 0 && !rows[index]!.includes('row 0') }
  }
  await press('k', 2)
  for (let i = 0; i < REPLY_ROWS && !topReplyRow().cut; i += 1) await press('k')
  const { index: target, cut } = topReplyRow()
  if (!cut) fail('No reply is cut by the top edge; the click would prove nothing')
  const beforeClick = scroll().scrollTop
  await act(async () => { await setup.mockMouse.click(60, target) })
  await settle(400)
  if (scroll().scrollTop !== beforeClick) fail('A click in SCROLLBACK moved the transcript')

  // ── e unfolds the whole transcript, and folds it again ───────────────────
  // There is no cursor card for `e` to act on, so it acts on all of them.
  await press('G')
  await settle(400)
  if (rowWith('second-output-row')) fail('SCROLLBACK showed full tool output before anything was expanded')
  await press('e')
  await settle(600)
  if (process.env.DUMP_FRAME) console.log(setup.captureCharFrame())
  if (!rowWith('second-output-row')) fail('SCROLLBACK e did not expand the transcript')
  await press('e')
  await settle(600)
  if (rowWith('second-output-row')) fail('SCROLLBACK e did not fold the transcript again')

  // ── a click unfolds one item, and only a click ───────────────────────────
  const rowIndex = (needle: string) => setup.captureCharFrame().split('\n').findIndex((row) => row.includes(needle))
  const column = (needle: string) => setup.captureCharFrame().split('\n')[rowIndex(needle)]!.indexOf(needle)
  {
    // A drag that starts on the row is a text selection.
    const y = rowIndex('Ran pwd')
    if (y < 0) fail('No folded tool row on screen to click')
    const x = column('Ran pwd')
    await act(async () => { await setup.mockMouse.drag(x, y, x + 6, y) })
    await settle(400)
    if (rowWith('second-output-row')) fail('A drag across a folded tool row expanded it')

    await act(async () => { await setup.mockMouse.click(x, y) })
    await settle(600)
    if (!rowWith('second-output-row')) fail('A click on a folded tool row did not expand it')
    // Sticking to the bottom would push the clicked item up by what it grew.
    if (rowIndex('1 tool call') !== y) fail('The clicked item moved when it expanded')
    if (!rowWith('reply 19 row 6')) fail('Expanding one item disturbed its neighbours')

    // Its output is selectable text, not a fold button.
    await act(async () => { await setup.mockMouse.click(column('second-output-row'), rowIndex('second-output-row')) })
    await settle(400)
    if (!rowWith('second-output-row')) fail('A click inside an expanded item folded it')

    await act(async () => { await setup.mockMouse.click(column('1 tool call'), rowIndex('1 tool call')) })
    await settle(600)
    if (rowWith('second-output-row')) fail('A click on an expanded item\'s first row did not fold it')

    // And `e` still means everything, whatever was clicked before.
    await act(async () => { await setup.mockMouse.click(column('Ran pwd'), rowIndex('Ran pwd')) })
    await settle(600)
    await press('e')
    await settle(600)
    if (!rowWith('second-output-row')) fail('Expand-all folded an item a click had opened')
    await press('e')
    await settle(600)
    if (rowWith('second-output-row')) fail('Fold-all left an item a click had opened')
  }

  // ── the neighbouring STREAM view still has its cursor ────────────────────
  // SCROLLBACK shares STREAM's render path and its chrome flag; STREAM sits
  // four rows above it in the view menu.
  act(() => { setup.mockInput.pressKey('v') })
  await settle()
  for (let i = 0; i < 4; i += 1) act(() => { setup.mockInput.pressArrow('up') })
  act(() => { setup.mockInput.pressEnter() })
  await settle(400)
  await press('G')
  await settle(400)
  const streamRow = rowWith('That is the whole pool.')
  if (!streamRow) fail('STREAM did not render the tail')
  if (!streamRow!.includes('❯')) fail('STREAM lost its card cursor; SCROLLBACK must not redefine it')

  console.log('Scrollback transcript smoke passed (no cursor, row scrolling, stable position, tail re-follow, click does not select, expand all, click to expand, STREAM unchanged)')
} finally {
  setup.renderer.destroy?.()
}
process.exit(0)
