/** @jsxImportSource @opentui/react */
// Window controls exercised through the real App keyboard and mouse dispatch.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-window-controls-'))
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
const broadcastSends: Array<{ session: Session; body: Record<string, unknown> }> = []
let promptActive = false
let permissionResponses = 0
const running = () => promptActive ? [{
  sessionId: SESSIONS[0]!.sessionId, provider: 'claude' as const,
  pendingPermissions: [], pendingPrompts: [{ requestId: 'controls-permission', sessionId: SESSIONS[0]!.sessionId,
    toolName: 'Bash', title: 'CONTROLS-PERMISSION', input: { command: 'echo fixture' } }],
}] : []
const marker = (session: Session | string) => `${(typeof session === 'string' ? session : session.sessionId).toUpperCase()}-BODY`
const card = (session: Session): TuiTranscriptCard => ({
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
})
const cardsFor = (session: Session) => [card(session)]
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS.map((session) => ({ ...session })), readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
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
  readTuiRuntimeActivity: async () => ({ running: running(), waiting: [], attention: [] }),
  listTuiRunningSessions: async () => running(),
  prewarmTuiSession: async () => {},
  runTuiSessionAction: async (_session: Session, body: Record<string, unknown>) => {
    if (body.action === 'respondPermission') { permissionResponses++; promptActive = false }
    return {}
  },
  streamTuiSessionTurn: async (session: Session, body: Record<string, unknown>) => {
    broadcastSends.push({ session: { ...session }, body })
    return new Response('event: turn-accepted\ndata: {}\n\n')
  },
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 220, height: 46, kittyKeyboard: process.env.AV_WINDOW_CONTROLS_LEGACY !== '1' })
const settle = async (ms = 150) => {
  await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, ms)) })
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
// Visible panes only: a zoom hides the others but keeps them mounted.
const panes = () => [0, 1, 2, 3, 4].map((index) => {
  const box = setup.renderer.root.findDescendantById(`split-pane:${index}`) as unknown as (Frame & { visible?: boolean }) | null
  return box && box.visible !== false ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
}).filter((box): box is Frame => box !== null)
const locate = (needle: string, within?: Frame): { x: number; y: number } => {
  const lines = setup.captureCharFrame().split('\n')
  for (let y = within?.y ?? 0; y < (within ? within.y + within.height : lines.length); y += 1) {
    const x = (lines[y] ?? '').indexOf(needle, within?.x ?? 0)
    if (x >= 0 && (!within || x < within.x + within.width)) return { x, y }
  }
  return fail(`could not find ${JSON.stringify(needle)}`)
}
const click = async (x: number, y: number) => {
  await act(async () => { await setup.mockMouse.click(x, y) })
  await settle(200)
}
const rail = () => frame('session-rail')!
const railRow = (name: string) => locate(`Win ${name}`, rail())
const readerShows = (name: string) => {
  const reader = frame('transcript-reader')!
  return setup.captureCharFrame().split('\n').slice(reader.y, reader.y + reader.height)
    .some((line) => line.slice(reader.x, reader.x + reader.width).includes(marker(`win-${name}`)))
}


const { getShells, shellTerminal, resetShellsForTest } = await import('./shellStore')
const { readAllScreenText } = await import('../../plugins/terminal/tui/shellScreen')
const chordKey = async (key: string) => {
  await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) })
  await settle(60)
  await act(async () => { setup.mockInput.pressKey(/^[0-8]$/.test(key) ? String(Number(key) + 1) : key) })
  await settle(200)
}
const paneHas = (index: number, text: string) => {
  // Index 64 is the floating window, whichever kind it holds.
  const pane = frame(index === 64 ? 'floating-window' : `split-pane:${index}`)
  if (!pane) return false
  return setup.captureCharFrame().split('\n').slice(pane.y, pane.y + pane.height)
    .some((line) => line.slice(pane.x, pane.x + pane.width).includes(text))
}
const paneName = (index: number) => NAMES.find((name) => paneHas(index, marker(`win-${name}`))) ?? null
const openMenu = async () => {
  const button = locate('⊞ layout')
  await click(button.x + 1, button.y)
  await waitFor('the layout menu', () => !!frame('window-layout:grid'))
}
const rightClick = async (x: number, y: number) => {
  // MouseButton.RIGHT is 2; the press is what opens the menu, as a terminal reports it.
  await act(async () => { await setup.mockMouse.pressDown(x, y, 2 as never) })
  await act(async () => { await setup.mockMouse.release(x, y, 2 as never) })
  await settle(200)
}

await settle(2500)
{
  const row = railRow('alpha')
  await click(row.x + 1, row.y)
  await waitFor('alpha in the reader', () => readerShows('alpha'))
}

// Start with six visible windows so resize and swap have real neighbours.
await openMenu()
const six = frame('window-layout:grid-six')!
await click(six.x + 3, six.y + 1)
await waitFor('five panes', () => panes().length === 5)
await waitFor('pane transcripts', () => [0, 1, 2, 3, 4].every(index => paneName(index) !== null))
const portable = async (key: string) => {
  await act(async () => { setup.mockInput.pressKey('k', { ctrl: true }) })
  await settle(40)
  await act(async () => { setup.mockInput.pressKey(key) })
  await settle(160)
}
const key = async (value: string) => { await act(async () => { setup.mockInput.pressKey(/^[0-8]$/.test(value) && !promptActive ? String(Number(value) + 1) : value) }); await settle(120) }
const escape = async () => { await act(async () => { setup.mockInput.pressEscape() }); await settle(120) }
const menuPick = async (label: string) => { const point = locate(label, frame('context-menu')!); await click(point.x + 1, point.y) }
const guide = () => setup.captureCharFrame().includes('MANAGE WINDOWS')
const geometry = () => JSON.stringify([frame('transcript-reader'), ...panes()])
const checkMenuAnchor = (point: { x: number; y: number }) => {
  const menu = frame('context-menu')!
  check(menu.x === Math.max(0, Math.min(point.x, 220 - menu.width - 1)), 'title menu is not anchored to its button or pointer')
  check(menu.y === Math.max(0, Math.min(point.y + 1, 46 - menu.height - 1)), 'title menu is not below its button or pointer')
}
const readerMenuButton = frame('reader-window-menu')!
await click(readerMenuButton.x, readerMenuButton.y)
checkMenuAnchor(readerMenuButton)
await escape()
await act(async () => { setup.mockInput.pressKey('b', { ctrl: true }) }); await settle(50)
await act(async () => { setup.mockInput.pressEnter() }); await settle(150)
checkMenuAnchor(readerMenuButton)
await escape()
const readerTitle = frame('transcript-reader')!
const readerPointer = { x: readerTitle.x + 5, y: readerTitle.y }
await rightClick(readerPointer.x, readerPointer.y)
checkMenuAnchor(readerPointer)
await escape()

await portable('q')
await waitFor('reader identification', () => !!frame('window-control:1'))
check([2, 3, 4, 5, 6].every(number => !!frame(`window-control:${number}`)), 'visible panes lack identification')
const identified = frame('window-control:4')!
check(identified.width === frame('split-pane:2')!.width, 'identification changed pane geometry')
await key('3')
check(!frame('window-control:1'), 'identification did not dismiss on selection')
await portable('w')
check(guide(), 'portable management command did not enter the mode')
const before = geometry()
await key(']'); await key(']'); await key(']')
check(geometry() !== before, 'repeated resize had no effect')
await key('u')
check(geometry() === before, 'one undo did not restore the grouped resize')
check(guide(), 'undo exited management mode')
// Other layout changes break the resize undo group.
await key(']'); await key('0'); await key('>'); await key('u')
check(geometry() !== before, 'undo crossed a focus change and erased the earlier resize')
await key('u')
check(geometry() === before, 'second undo did not restore the earlier resize')
await key('3')
const swapRects = [frame('split-pane:2'), frame('split-pane:3')]
await act(async () => { setup.mockInput.pressArrow('right', { shift: true }) }); await settle(200)
check(JSON.stringify(frame('split-pane:2')) === JSON.stringify(swapRects[1]) && JSON.stringify(frame('split-pane:3')) === JSON.stringify(swapRects[0]), 'management swap did not exchange the adjacent windows')
await key('u')
await key('3'); await key(']'); await key('>'); await key('+'); await key('=')
check(geometry() === before, 'equalize did not reset all pane weights and dividers')
await escape()
check(!guide(), 'Escape failed to end management')
await chordKey('e')
check(guide(), 'Ctrl+B e failed to enter management')
await act(async () => { setup.mockInput.pressEnter() }); await settle()
check(!guide(), 'Enter failed to end management')
// A title-button menu targets the clicked pane, regardless of prior focus.
await chordKey('1')
const secondName = paneName(1)
const secondWidth = frame('split-pane:1')!.width
const button = frame('split-pane-menu:1')!
await click(button.x, button.y)
checkMenuAnchor(button)
await menuPick('Zoom window')
check(paneName(1) === secondName && frame('split-pane:1')!.width > secondWidth, 'menu zoom missed its target')
await portable('q')
await waitFor('zoomed identification', () => !!frame('window-control:3'))
check(!frame('window-control:1') && !frame('window-control:2') && !frame('window-control:4'), 'identification includes zoom-hidden windows')
await escape()
await portable('w'); await key('m'); await escape()
await portable('q')
const readerOverlay = frame('window-control:1')!
await click(readerOverlay.x + 3, readerOverlay.y + 2)
check(!frame('window-control:1'), 'clicking identification did not dismiss it')
await portable('q')
await waitFor('identification timeout', () => !frame('window-control:1'))
// Management must not type into a live composer or send its draft.
await chordKey('1'); await key('c'); await key('draft stays')
const textarea = () => setup.renderer.root.findDescendantById('composer-textarea') as unknown as { plainText: string } | null
const draft = textarea()?.plainText
check(draft?.includes('draft stays'), 'composer fixture was not active')
await portable('w'); await key('h'); await key('h');
await act(async () => { await setup.mockInput.pasteBracketedText('blocked-paste') }); await settle()
check(textarea()?.plainText === draft && broadcastSends.length === 0, 'management input leaked into the composer')
await escape()
check(textarea()?.plainText === draft, 'leaving management lost the draft')
await escape()
// Current geometry must be reflected after a terminal resize, and hidden panes excluded.
await portable('q')
await act(async () => { setup.resize(90, 24) }); await settle(300)
for (let number = 1; number <= 6; number++) {
  const overlay = frame(`window-control:${number}`)
  if (overlay) check(overlay.x >= 0 && overlay.y >= 0 && overlay.x + overlay.width <= 90 && overlay.y + overlay.height <= 24, 'identification exceeds terminal bounds')
}
await escape()
const reader = frame('transcript-reader')!
await click(reader.x + 2, reader.y + 2)
const readerButton = frame('reader-window-menu')!
await click(readerButton.x, readerButton.y)
const compactMenu = frame('context-menu')!
check(compactMenu.x + compactMenu.width <= 90 && compactMenu.y + compactMenu.height <= 24, 'pane menu exceeds terminal bounds')
await escape()
await act(async () => { setup.resize(220, 46) }); await settle(200)
// Float a session: include it in identification with the next available digit.
await chordKey('1'); await chordKey('f')
await waitFor('floating window', () => !!frame('floating-window'))
await portable('q')
const floatingNumber = panes().length + 2
await waitFor('floating identification', () => !!frame(`window-control:${floatingNumber}`))
check(frame(`window-control:${floatingNumber}`)!.width === frame('floating-window')!.width, 'floating identification uses a docked frame')
await act(async () => { setup.mockInput.pressKey(String(floatingNumber)) }); await settle(120)
await portable('w'); await key(' ')
await menuPick('Dock window')
await waitFor('docked window', () => !frame('floating-window'))
// Make room for the shell and browser checks; presets preserve existing views.
for (let count = panes().length; count > 1; count--) { await chordKey(String(count)); await chordKey('x') }
// A shell that owns the keyboard must still yield to the portable controls.
await openMenu()
const two = frame('window-layout:two')!
await click(two.x + 3, two.y + 1)
await portable('q'); await key('0')
await act(async () => { setup.mockInput.pressKey('O', { shift: true }) }); await settle(300)
const terminalTab = locate(' Terminal', frame('surface-panel-frame')!)
await click(terminalTab.x + 2, terminalTab.y)
await menuWaitForWindowButton()
async function menuWaitForWindowButton() {
  await waitFor('panel window button', () => setup.captureCharFrame().includes('⧉ window'))
  const point = locate('⧉ window'); await click(point.x + 2, point.y)
}
await key('o')
const shellText = () => {
  const shell = getShells()[0]; const terminal = shell ? shellTerminal(shell.id) : null
  return terminal ? readAllScreenText(terminal).join('\n') : ''
}
await waitFor('shell prompt', () => /[$#%>] ?$/m.test(shellText()))
const shellBefore = shellText()
await portable('w'); check(guide(), 'captured shell swallowed the portable prefix')
await key('h'); await act(async () => { await setup.mockInput.pasteBracketedText('shell-paste-must-not-leak') }); await settle()
check(shellText() === shellBefore, 'management typing or paste reached the shell')
await escape()
await act(async () => { await setup.mockInput.typeText('echo controls-shell-ok'); setup.mockInput.pressEnter() })
await waitFor('shell remains interactive', () => shellText().includes('controls-shell-ok'))
// Release shell capture before opening another panel.
await act(async () => { setup.mockInput.pressKey(']', { ctrl: true }) }); await settle()
await escape()
await act(async () => { setup.mockInput.pressKey('O', { shift: true }) }); await settle(300)
const browserTab = locate(' Browser', frame('surface-panel-frame')!)
await click(browserTab.x + 2, browserTab.y)
await escape()
await key('?')
await act(async () => { await setup.mockInput.typeText('Browser in a window') }); await settle()
await act(async () => { setup.mockInput.pressEnter() }); await settle(300)
await waitFor('browser window', () => !!frame('surface-window-menu:browser'))
await key('address-draft')
await portable('w'); check(guide(), 'browser input swallowed the portable prefix')
await key('h'); await key('h'); await escape()
check(setup.captureCharFrame().includes('address-draft') && !setup.captureCharFrame().includes('address-drafth'), 'management keys reached the browser address input')
const browserMenuButton = frame('surface-window-menu:browser')!
await click(browserMenuButton.x, browserMenuButton.y)
checkMenuAnchor(browserMenuButton)
await escape()
// An arriving permission must end management and retain keyboard priority.
await portable('q'); await key('0'); await portable('w')
promptActive = true
await waitFor('permission interrupts management', () => !!frame('permission-prompt') && !guide())
await portable('w'); check(!guide(), 'window controls took priority over the permission')
check(permissionResponses === 0, 'window controls answered the permission')
await key('2')
await waitFor('permission cleared', () => !frame('permission-prompt'))
check(permissionResponses === 1, 'the permission did not receive its response key')
check(!guide(), 'management resumed behind the permission')
console.log('Window controls smoke passed (identification, zoom, click, timeout, management, grouped undo, menu targeting, draft isolation, responsive geometry, floating windows, shell/browser capture, paste, permission priority)')
act(() => setup.renderer.destroy())
await resetShellsForTest()
process.exit(0)
