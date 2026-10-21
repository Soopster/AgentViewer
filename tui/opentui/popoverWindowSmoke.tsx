/** @jsxImportSource @opentui/react */
// Popovers broken out into windows, in the real App: ⌃⇧W moves an open popover
// into the layout and back; a pinned window keeps its session while the reader
// moves; a capturing window (the editor) takes keys ahead of the global
// shortcuts but not the ⌃B prefix; opening a popover that has a window goes to
// the window. Frames are read from layout, as in windowingMoreSmoke.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-popover-windows-'))
process.env.SHELL = '/bin/sh'
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
const SESSIONS: Session[] = NAMES.map((name, index) => ({
  sessionId: `win-${name}`, provider: 'claude', cwd: CWD, summary: `Win ${name}`, firstPrompt: `Win ${name}`, lastModified: 1_700_000_000_000 - index * 1000,
}))
const detailReads: string[] = []
const broadcastSends: Array<{ session: Session; body: Record<string, unknown> }> = []
const failedWindowSessions = new Set<string>()
const viewerNotes: Array<{ id: string; sessionId: string; provider: 'claude'; title: string; createdAt: number }> = []
const marker = (session: Session | string) => `${(typeof session === 'string' ? session : session.sessionId).toUpperCase()}-BODY`
const card = (session: Session): TuiTranscriptCard => ({
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: failedWindowSessions.has(session.sessionId) ? 'result_error' : 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
})
// Bravo's history is longer than a pane loads (80 cards), with one needle near the start.
const plainCard = (session: Session, index: number, text: string): TuiTranscriptCard => ({
  ...card(session), key: `${session.sessionId}-card-${index}`, compactSummary: text,
  lines: [{ text, tone: 'default' }], expandedLines: [{ text, tone: 'default' }], searchText: text, searchHaystackLower: text.toLowerCase(),
})
const cardsFor = (session: Session): TuiTranscriptCard[] => session.sessionId !== 'win-bravo'
  ? [card(session)]
  : [...Array.from({ length: 120 }, (_, index) => plainCard(session, index, index === 5 ? 'NEEDLE-IN-BRAVO' : `bravo line ${index}`)), card(session)]
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS.map((session) => ({ ...session })), readTuiSessionDetailAsync: async (session: Session) => { detailReads.push(session.sessionId); return detailFor(session) } }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => SESSIONS.map((session) => ({ ...session })),
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [...viewerNotes] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
  streamTuiSessionTurn: async (session: Session, body: Record<string, unknown>) => {
    broadcastSends.push({ session: { ...session }, body })
    return new Response('event: turn-accepted\ndata: {}\n\n')
  },
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 200, height: 46, kittyKeyboard: true })
const settle = async (ms = 150) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 30) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}
const fail = (message: string): never => {
  console.error(`${message}\n${setup.captureCharFrame()}`)
  process.exit(1)
}
const check = (condition: unknown, message: string) => { if (!condition) fail(message) }
const waitFor = async (label: string, test: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (test()) return
    await settle(80)
  }
  fail(`Timed out: ${label}`)
}
type Frame = { x: number; y: number; width: number; height: number }
const frame = (id: string): Frame | null => {
  const box = setup.renderer.root.findDescendantById(id) as unknown as Frame | null
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}
const screen = () => setup.captureCharFrame()
const locate = (needle: string, within?: Frame): { x: number; y: number } => {
  const lines = screen().split('\n')
  for (let y = within?.y ?? 0; y < (within ? within.y + within.height : lines.length); y += 1) {
    const x = (lines[y] ?? '').indexOf(needle, within?.x ?? 0)
    if (x >= 0) return { x, y }
  }
  return fail(`could not find ${JSON.stringify(needle)}`)
}
const click = async (x: number, y: number) => {
  await act(async () => { await setup.mockMouse.click(x, y) })
  await settle(200)
}
// pressKey types its argument literally, so Escape and Enter have their own calls.
const key = async (name: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}) => {
  await act(async () => {
    if (name === 'escape') setup.mockInput.pressEscape()
    else if (name === 'return') setup.mockInput.pressEnter()
    else setup.mockInput.pressKey(name, modifiers)
  })
  await settle(200)
}
const chordKey = async (name: string) => {
  await key('b', { ctrl: true })
  await key(name)
}
const readerShows = (name: string) => {
  const reader = frame('transcript-reader')!
  return screen().split('\n').slice(reader.y, reader.y + reader.height)
    .some((line) => line.slice(reader.x, reader.x + reader.width).includes(marker(`win-${name}`)))
}
// The surface layer draws a window's frame under the surface's own id.
const windowFrame = (id: string) => frame(`surface-frame:${id}`)
const titleOf = (id: string) => {
  const box = windowFrame(id)
  return box ? (screen().split('\n')[box.y] ?? '').slice(box.x, box.x + box.width) : ''
}

await waitFor('the app to render', () => screen().includes('SESSIONS') || screen().includes('New workspace'))
if (screen().includes('New workspace')) await key('return')
await waitFor('the reader on alpha', () => readerShows('alpha'))

// ── A pinned popover window ─────────────────────────────────────────────────
{
  await key('a', { ctrl: true })
  await waitFor('the analytics popover', () => screen().includes('Session analytics'))
  check(screen().includes('⧉ window'), 'the popover offers no ⧉ window button')
  await key('w', { ctrl: true, shift: true })
  await waitFor('analytics in a window', () => !!windowFrame('analytics') && !screen().includes('Session analytics'))
  check(titleOf('analytics').includes('Analytics · Win alpha'), `the window does not name its pinned session: ${titleOf('analytics')}`)
  // The reader moves on; the window keeps its session.
  // From the reader: with a window focused, a rail click opens the session as
  // a window instead. The rail's row, not a tab of the same name.
  const readerFrame = frame('transcript-reader')!
  await click(readerFrame.x + Math.floor(readerFrame.width / 2), readerFrame.y + Math.floor(readerFrame.height / 2))
  const rail = frame('session-rail')!
  const bravoRow = screen().split('\n').findIndex((line, y) => y > rail.y && line.slice(rail.x, rail.x + rail.width).includes('Win bravo'))
  const bravo = { x: rail.x + screen().split('\n')[bravoRow]!.slice(rail.x).indexOf('Win bravo'), y: bravoRow }
  await click(bravo.x + 2, bravo.y)
  await waitFor('the reader on bravo', () => readerShows('bravo'))
  await settle(300)
  check(titleOf('analytics').includes('Win alpha'), `the pinned window followed the reader: ${titleOf('analytics')}`)
  check(detailReads.includes('win-alpha'), 'the pinned window never read its own session')
  // ⌃⇧W on the focused window: full screen again, on the pinned session.
  const win = windowFrame('analytics')!
  await click(win.x + Math.floor(win.width / 2), win.y + Math.floor(win.height / 2))
  await key('w', { ctrl: true, shift: true })
  await waitFor('analytics back to full screen', () => !windowFrame('analytics') && screen().includes('Session analytics'))
  await key('escape')
  await waitFor('the popover closed', () => !screen().includes('Session analytics'))
  await waitFor('the reader back on the pinned session', () => readerShows('alpha'))
  console.log('⌃⇧W breaks analytics out into a window pinned to its session, and puts it back on that session.')
}

// ── A capturing window: the editor ──────────────────────────────────────────
{
  await key('e', { ctrl: true })
  await waitFor('the editor popover', () => screen().includes('EDITOR'))
  await key('w', { ctrl: true, shift: true })
  await waitFor('the editor in a window', () => !!windowFrame('editor') && !screen().includes('EDITOR '))
  check(titleOf('editor').includes('Editor'), `the editor window has no title: ${titleOf('editor')}`)
  const win = windowFrame('editor')!
  await click(win.x + Math.floor(win.width / 2), win.y + 3)
  // ⌃P is the editor's quick open; captured, it must not reach the app.
  await key('p', { ctrl: true })
  await waitFor('the editor quick open inside the window', () => screen().includes('Quick open'))
  const quick = locate('Quick open')
  check(quick.x >= win.x && quick.x < win.x + win.width, 'quick open drew outside the editor window')
  await key('escape')
  await waitFor('quick open closed', () => !screen().includes('Quick open'))
  check(!!windowFrame('editor'), 'Esc in a capturing window closed it')
  // The ⌃B prefix still reaches the window manager: zoom and restore.
  const before = windowFrame('editor')!.width
  await chordKey('m')
  await waitFor('the editor window zoomed', () => (windowFrame('editor')?.width ?? 0) > before)
  await chordKey('m')
  await waitFor('the layout restored', () => windowFrame('editor')?.width === before)
  // From the reader, ⌃E goes to the window rather than opening a second editor.
  const reader = frame('transcript-reader')!
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await key('e', { ctrl: true })
  await settle(300)
  check(!screen().includes('EDITOR '), '⌃E opened a second, full-screen editor beside its window')
  check(!!windowFrame('editor'), 'the editor window went away')
  console.log('The editor in a window takes its own keys, leaves ⌃B to the window manager, and is never opened twice.')
}

// ── A global popover window, closed and undone ──────────────────────────────
{
  const reader = frame('transcript-reader')!
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await key('k', { ctrl: true })
  await key('s')
  await waitFor('the daily summary', () => screen().includes('Daily summary'))
  await key('w', { ctrl: true, shift: true })
  await waitFor('the daily summary in a window', () => !!windowFrame('daily-summary'))
  const close = frame('surface-window-close:daily-summary')!
  await click(close.x + 1, close.y)
  await waitFor('the window closed', () => !windowFrame('daily-summary'))
  await chordKey('u')
  await waitFor('undo to bring the window back', () => !!windowFrame('daily-summary'))
  console.log('A daily summary window closes with × and undo brings it back.')
}

// ── The agent control center as a window ────────────────────────────────────
{
  const reader = frame('transcript-reader')!
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await key('k', { ctrl: true })
  await key('a')
  await waitFor('the control center', () => screen().includes('AGENT CONTROL CENTER'))
  await key('w', { ctrl: true, shift: true })
  await waitFor('the control center in a window', () => !!windowFrame('coordination'))
  const win = windowFrame('coordination')!
  const inside = screen().split('\n').slice(win.y, win.y + win.height).some((line) => line.slice(win.x, win.x + win.width).includes('AGENT CONTROL'))
  check(inside, 'the control center window does not show the control center')
  check(titleOf('coordination').includes('Control center'), `the control center window has no title: ${titleOf('coordination')}`)
  console.log('The agent control center breaks out into a window.')
}

// ── Fill this tab, and a new tab of its own ─────────────────────────────────
{
  const area = () => frame('window-area')!
  // ⧉ window offers the three places a popover can go. From the reader: a
  // focused window would take ⌃A as its own key.
  const reader = frame('transcript-reader')!
  await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
  await key('a', { ctrl: true })
  await waitFor('analytics again', () => screen().includes('Session analytics'))
  const detach = frame('popover-detach')!
  await click(detach.x + 2, detach.y)
  await waitFor('the placement menu', () => !!frame('context-menu') && screen().includes('As a tab in this workspace') && screen().includes('In a new workspace'))
  const asTab = locate('As a tab in this workspace')
  await click(asTab.x + 1, asTab.y)
  // A tab of this workspace's strip, shown in the reader's place.
  const tabRow = () => screen().split('\n')[frame('session-tabs')!.y] ?? ''
  await waitFor('analytics as a tab in the strip', () => tabRow().includes('Analytics') && !!frame('popover-tab-frame') && !screen().includes('Session analytics'))
  const tabFrame = () => setup.renderer.root.findDescendantById('popover-tab-frame') as unknown as { visible?: boolean } | null
  const readerVisible = () => (setup.renderer.root.findDescendantById('transcript-reader') as unknown as { visible?: boolean }).visible !== false
  check(!readerVisible(), 'the transcript still shows under a popover tab')
  // Like any tab: a session tab shows the reader, the popover tab brings it back, × closes it.
  const sessionTab = locate('Win alpha', frame('session-tabs')!)
  await click(sessionTab.x + 2, sessionTab.y)
  await waitFor('a session tab to show the reader', () => readerVisible() && !tabFrame())
  const popoverTab = locate('Analytics', frame('session-tabs')!)
  await click(popoverTab.x + 2, popoverTab.y)
  await waitFor('the popover tab again', () => !!tabFrame() && !readerVisible())
  const closeX = tabRow().indexOf('×', tabRow().indexOf('Analytics'))
  await click(closeX, frame('session-tabs')!.y)
  await waitFor('× to close the popover tab', () => !tabRow().includes('Analytics') && readerVisible())
  // A new tab of its own: the workspace tab bar gains a tab, and the old tab keeps its windows.
  const tabsBefore = (setup.renderer.root.findDescendantById('workspace-tabs') as unknown as { getChildren(): Array<{ id: string }> }).getChildren().filter((child) => child.id.startsWith('workspace-tab:')).map((child) => child.id)
  // Its window from earlier would take ⌃K s; close it so the popover opens.
  const existing = frame('surface-window-close:daily-summary')
  if (existing) { await click(existing.x + 1, existing.y); await waitFor('the old window closed', () => !windowFrame('daily-summary')) }
  const reader2 = frame('transcript-reader')!
  await click(reader2.x + Math.floor(reader2.width / 2), reader2.y + Math.floor(reader2.height / 2))
  await key('k', { ctrl: true })
  await key('s')
  await waitFor('the daily summary popover', () => !!frame('popover-detach'))
  const detach2 = frame('popover-detach')!
  await click(detach2.x + 2, detach2.y)
  await waitFor('the placement menu', () => screen().includes('In a new workspace'))
  const tab = locate('In a new workspace')
  await click(tab.x + 1, tab.y)
  const tabsAfter = () => (setup.renderer.root.findDescendantById('workspace-tabs') as unknown as { getChildren(): Array<{ id: string }> }).getChildren().filter((child) => child.id.startsWith('workspace-tab:')).map((child) => child.id)
  await waitFor('a new workspace tab', () => tabsAfter().length === tabsBefore.length + 1)
  await waitFor('the daily summary filling the new tab', () => (windowFrame('daily-summary')?.width ?? 0) === area().width)
  check(!windowFrame('coordination'), 'the new tab shows the old tab\'s windows')
  check(screen().split('\n')[0]?.includes('Daily summary'), `the new tab is not named for its popover: ${screen().split('\n')[0]}`)
  // Back to the first tab: its windows are where they were.
  const first = frame(tabsBefore[0]!)!
  await click(first.x + 2, first.y)
  await waitFor('the first tab again', () => !!windowFrame('coordination') && !!windowFrame('editor'))
  console.log('A popover becomes a tab of this workspace (switched and closed like any tab) or a new workspace of its own.')
}

// ── Every other popover kind opens as a window from the palette ─────────────
{
  // Queries avoid j and k: the palette takes them as moves even while typing.
  const kinds: Array<[string, string, string]> = [
    ['attention', 'Attention inbox in a window', 'Attention'],
    ['prompt-library', 'Prompt library in a window', 'Prompts'],
    ['playbooks', ' manager in a window', 'Playbooks'],
    ['messaging', 'Cross-session messaging in a window', 'Messaging'],
    ['handoff', 'Handoff brief in a window', 'Handoff brief'],
    ['tasks', 'list in a window', 'Tasks'],
    ['checkpoints', 'review in a window', 'Checkpoints'],
    ['desk', '', 'Desk'],
    ['diagnostics', 'Diagnostics in a window', 'Diagnostics'],
    ['teammates', 'Teammates in a window', 'Teammates'],
  ]
  for (const [id, label, title] of kinds) {
    const reader = frame('transcript-reader')
    if (reader && reader.width > 0) await click(reader.x + Math.floor(reader.width / 2), reader.y + Math.floor(reader.height / 2))
    if (label) {
      await key('?')
      await settle(300)
      await act(async () => { await setup.mockInput.typeText(label) })
      await settle(200)
      await key('return')
    } else {
      // "Desk" has a k, which the palette eats: open the desk (⌃K b) and break it out.
      await key('k', { ctrl: true })
      await key('b')
      await settle(300)
      await key('w', { ctrl: true, shift: true })
    }
    await waitFor(`${label} as a window`, () => !!windowFrame(id) && titleOf(id).includes(title))
    const box = windowFrame(id)!
    // Docked: no second frame inside the window's own.
    const inner = (screen().split('\n')[box.y + 1] ?? '').slice(box.x + 1, box.x + 3)
    check(!/^[┌┏╭]/.test(inner), `${id} drew its own frame inside the window: ${JSON.stringify(inner)}`)
    const close = frame(`surface-window-close:${id}`)
    if (close) { await click(close.x + 1, close.y); await waitFor(`${id} closed`, () => !windowFrame(id)) }
  }
  console.log('Every popover kind opens as a docked window from the palette.')
}

console.log('Popover window smoke passed')
act(() => setup.renderer.destroy())
process.exit(0)
