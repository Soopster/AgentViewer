/** @jsxImportSource @opentui/react */
// The desk (⌃K b). Three layers, because each fails differently:
//   - the model: commands, layouts that tile, cell-aware columns, the tables;
//   - the component driven by keys: <GO>, autocomplete, numbered rows, layout,
//     MENU, CANCEL, and its painted colours (the frame text is the same in any
//     palette, so the colours are read from spans);
//   - the real App: ⌃K b opens it and Escape gives the screen back.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { testRender, act } from './testRender'
import type { Session } from '../../lib/types'
import {
  DESK_LAYOUTS,
  buildIndicesTable,
  buildMonitorTable,
  deskColumnWidths,
  deskFit,
  deskPanelRects,
  deskSuggestions,
  parseDeskCommand,
  type DeskActivity,
  type DeskTableInput,
} from './deskModel'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-desk-smoke-')))

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// ── Model ────────────────────────────────────────────────────────────────────

assert.deepEqual(parseDeskCommand('top <GO>'), { kind: 'function', id: 'TOP' })
assert.deepEqual(parseDeskCommand('news'), { kind: 'function', id: 'TOP' })
assert.deepEqual(parseDeskCommand(' 12 '), { kind: 'row', row: 12 })
assert.deepEqual(parseDeskCommand('lay 6'), { kind: 'layout', layout: '6' })
assert.deepEqual(parseDeskCommand('LAY 5').kind, 'search', 'an unknown layout is not silently a layout')
assert.deepEqual(parseDeskCommand('flaky test'), { kind: 'search', query: 'flaky test' })
assert.deepEqual(parseDeskCommand(''), { kind: 'none' })

// Every layout tiles its area exactly — no overlap, no gap at the right or bottom.
for (const layout of DESK_LAYOUTS) {
  for (const [w, h] of [[120, 37], [173, 41], [81, 23]] as const) {
    const rects = deskPanelRects(layout, w, h)
    assert.equal(rects.length, Number(layout))
    const covered = new Uint8Array(w * h)
    for (const rect of rects) {
      for (let y = rect.top; y < rect.top + rect.height; y += 1) {
        for (let x = rect.left; x < rect.left + rect.width; x += 1) {
          assert.equal(covered[y * w + x], 0, `layout ${layout} overlaps at ${x},${y}`)
          covered[y * w + x] = 1
        }
      }
    }
    assert.ok(covered.every((cell) => cell === 1), `layout ${layout} leaves a gap at ${w}x${h}`)
  }
}

// Columns are counted in cells: an emoji is two, so it must not push the row.
assert.equal(deskFit('ab', 5), 'ab   ')
assert.equal(deskFit('ab', 5, 'right'), '   ab')
assert.equal(deskFit('🚀 launch', 6), '🚀 la…')
assert.equal(deskFit('漢字テスト', 5), '漢字…')
assert.equal(deskColumnWidths([{ title: 'A', width: 3 }, { title: 'B', width: 'flex' }, { title: 'C', width: 4 }], 40).reduce((a, b) => a + b, 0) + 2, 40)

const now = Date.UTC(2026, 9, 18, 3, 0, 0)
const minute = 60_000
const sessions: Session[] = [
  { sessionId: 'aaaa-1111-run', provider: 'claude', customTitle: 'Fix flaky deploy test', lastModified: now - 2 * minute, cwd: '/src/alpha' },
  { sessionId: 'bbbb-2222-ask', provider: 'codex', summary: 'Refactor billing service', lastModified: now - 40 * minute, cwd: '/src/beta' },
  { sessionId: 'cccc-3333-old', provider: 'claude', summary: 'Write the release notes', lastModified: now - 30 * 60 * minute, cwd: '/src/alpha' },
  { sessionId: 'dddd-4444-pi', provider: 'pi', summary: '🚀 Rocket launch checklist', lastModified: now - 5 * 60 * minute, cwd: '/src/gamma' },
]
const activity = new Map<string, DeskActivity>([['claude:aaaa-1111-run', 'running'], ['codex:bbbb-2222-ask', 'needs-input']])
const baseInput: DeskTableInput = {
  sessions, activity, upticks: new Set(['claude:aaaa-1111-run']), now, alerts: [], loaded: null,
  loadedCards: null, loadedContext: null, loadedModel: null, loadedMessageCount: null, chartWidth: 60, chartHeight: 8,
}
const monitor = buildMonitorTable(baseInput)
assert.equal(monitor.rows.length, 4)
assert.deepEqual(monitor.rows.map((row) => row.cells[3].text), ['RUN', 'ASK', '—', '—'])
assert.equal(monitor.rows[0].cells[5].text, '▲', 'an uptick marks CHG')
const indices = buildIndicesTable(baseInput)
const claudeIndex = indices.rows.find((row) => row.key === 'wei:claude')!
assert.deepEqual([claudeIndex.cells[2].text, claudeIndex.cells[3].text], ['1', '0'], 'claude: one print today, one in the prior 24h, net 0')
const codexIndex = indices.rows.find((row) => row.key === 'wei:codex')!
assert.equal(codexIndex.cells[3].tone, 'up')
assert.equal(deskSuggestions('mo', sessions)[0]?.label, 'MON')
assert.ok(deskSuggestions('billing', sessions).some((suggestion) => suggestion.kind === 'session' && suggestion.key === 'codex:bbbb-2222-ask'))

// ── Component ────────────────────────────────────────────────────────────────

const { DeskView, DESK_COLORS } = await import('./DeskView')
const loads: string[] = []
const opened: string[] = []
let closed = 0
let themed = 0
let keyHandler: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null

function Harness() {
  const [loaded, setLoaded] = React.useState<Session | null>(null)
  return (
    <DeskView
      sessions={sessions}
      activity={activity}
      alerts={[{ key: 'p1', sessionKey: 'codex:bbbb-2222-ask', provider: 'codex', sessionTitle: 'Refactor billing service', title: 'Bash: rm -rf build', needsInput: true, createdAt: now }]}
      loaded={loaded}
      loadedCards={null}
      loadedContext={null}
      loadedModel={null}
      loadedMessageCount={null}
      themeActive={false}
      width={140}
      height={40}
      onLoadSession={(session) => { loads.push(session.sessionId); setLoaded(session) }}
      onOpenSession={(session) => { opened.push(session.sessionId) }}
      onOpenAlert={() => {}}
      onApplyTheme={() => { themed += 1 }}
      onClose={() => { closed += 1 }}
      onKeyHandlerReady={(handler) => { keyHandler = handler }}
    />
  )
}

const setup = await testRender(<Harness />, { width: 140, height: 40 })
const settle = async (ms = 60) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
const press = async (name: string, extra: Partial<{ ctrl: boolean; shift: boolean; sequence: string }> = {}) => {
  act(() => { keyHandler?.({ name, ctrl: false, shift: false, sequence: name.length === 1 ? name : '', ...extra }) })
  await settle()
}
const type = async (text: string) => {
  for (const char of text) await press(char === ' ' ? 'space' : char.toLowerCase(), { sequence: char })
}
await settle(200)
let frame = setup.captureCharFrame()
for (const expected of ['AGENT VIEWER ▸ DESK', '1) MON', 'SESSION MONITOR', '2) TOP', '3) DES', '4) GP', 'CLD 111RUN', 'CANCEL', 'GO', 'NO SECURITY LOADED']) {
  if (!frame.includes(expected)) fail(`desk frame is missing ${JSON.stringify(expected)}:\n${frame}`)
}
if (!frame.includes('*BN')) fail(`an alert that needs input did not lead the newswire:\n${frame}`)

type Rgb = [number, number, number]
const spanAt = (row: number, col: number): { fg: Rgb; bg: Rgb } => {
  let x = 0
  for (const span of setup.captureSpans().lines[row]?.spans ?? []) {
    if (col < x + span.width) return { fg: span.fg.toInts().slice(0, 3) as Rgb, bg: span.bg.toInts().slice(0, 3) as Rgb }
    x += span.width
  }
  return fail(`no span at ${row},${col}`)
}
const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
if (hex(spanAt(0, 2).bg) !== DESK_COLORS.redBar) fail(`title bar is not the red bar: ${hex(spanAt(0, 2).bg)}`)
if (hex(spanAt(1, 1).bg) !== DESK_COLORS.amber) fail(`command-line panel chip is not amber: ${hex(spanAt(1, 1).bg)}`)
if (hex(spanAt(39, 1).bg) !== DESK_COLORS.cancelRed) fail(`CANCEL key is not red: ${hex(spanAt(39, 1).bg)}`)
const monitorHeaderRow = frame.split('\n').findIndex((line) => line.includes('TICKER'))
const tickerCol = frame.split('\n')[monitorHeaderRow].indexOf('TICKER')
if (hex(spanAt(monitorHeaderRow, tickerCol).fg) !== DESK_COLORS.amber) fail('column headings are not amber')

// Autocomplete: a partial mnemonic lists functions; ⏎ takes the highlighted one.
await type('mo')
frame = setup.captureCharFrame()
if (!frame.includes(' MON ') || !frame.includes('FUNC')) fail(`typing MO did not offer MON:\n${frame}`)
await type('st')
await press('return')
frame = setup.captureCharFrame()
if (!frame.includes('1) MOST') || !frame.includes('MOST ACTIVE')) fail(`MOST <GO> did not run in panel 1:\n${frame}`)

// MENU (⌫ on an empty line) returns the panel to what it ran before.
await press('backspace')
frame = setup.captureCharFrame()
if (!frame.includes('1) MON')) fail(`MENU did not return panel 1 to MON:\n${frame}`)

// A number <GO> picks that numbered row, which loads it into every panel.
await type('2')
await press('return')
await settle(200)
if (loads.at(-1) !== 'bbbb-2222-ask') fail(`2 <GO> loaded ${loads.at(-1)} instead of row 2`)
frame = setup.captureCharFrame()
if (!frame.includes('CDX 222ASK') || !frame.includes('REFACTOR BILLING SERVICE')) fail(`the loaded security is not shown:\n${frame}`)
if (!frame.includes('NEEDS YOU')) fail(`DES does not describe the loaded session:\n${frame}`)
// The same row again is the second click: read it.
await type('2')
await press('return')
if (opened.at(-1) !== 'bbbb-2222-ask') fail('2 <GO> on the loaded row did not open it')

// A name is a security search.
await type('release')
await press('return')
await settle(200)
if (loads.at(-1) !== 'cccc-3333-old') fail(`a search did not load the matching session (got ${loads.at(-1)})`)

// Layout: LAY 1 is one panel; ⌃L cycles on.
await type('lay 1')
await press('return')
frame = setup.captureCharFrame()
if (frame.includes('2) TOP')) fail(`LAY 1 still shows panel 2:\n${frame}`)
await press('l', { ctrl: true })
frame = setup.captureCharFrame()
if (!frame.includes('2) TOP') || !frame.includes('LAYOUT 2')) fail(`⌃L did not move to layout 2:\n${frame}`)

// Tab moves focus; the focused panel's chip goes yellow.
await press('tab')
// Row 1 is the command line, which names the focused panel too; the chip is below the tape.
const panelTwoRow = setup.captureCharFrame().split('\n').findIndex((line, row) => row > 2 && line.includes('2) TOP'))
if (!setup.captureCharFrame().split('\n')[1].includes('2) TOP')) fail('the command line does not name the focused panel')
const panelTwoCol = setup.captureCharFrame().split('\n')[panelTwoRow].indexOf('2) TOP')
if (hex(spanAt(panelTwoRow, panelTwoCol).bg) !== DESK_COLORS.yellow) fail(`Tab did not focus panel 2: ${hex(spanAt(panelTwoRow, panelTwoCol).bg)} at ${panelTwoRow},${panelTwoCol}\n${setup.captureCharFrame()}`)

await type('theme')
await press('return')
if (themed !== 1) fail('THEME <GO> did not apply the app theme')

// CANCEL clears a typed command first, and only an empty line closes the desk.
await type('xyz')
await press('escape')
if (closed !== 0) fail('Escape with a typed command closed the desk instead of cancelling it')
await press('escape')
if (closed !== 1) fail('Escape on an empty command line did not close the desk')
setup.renderer.destroy()

// ── The real App ─────────────────────────────────────────────────────────────

// Boot in bloomberg-light: the stored theme must be accepted (not fall back to
// `light`) and actually paint the app's background.
const { mkdirSync, writeFileSync } = await import('fs')
mkdirSync('.agent-viewer-data', { recursive: true })
writeFileSync('.agent-viewer-data/tui.json', JSON.stringify({ theme: 'bloomberg-light' }))
const { getThemePalette, BLOOMBERG_THEME, BLOOMBERG_LIGHT_THEME } = await import('../theme')
assert.equal(getThemePalette('bloomberg-dark'), BLOOMBERG_THEME)
assert.equal(getThemePalette('bloomberg-light'), BLOOMBERG_LIGHT_THEME)
const { default: OpenTuiApp } = await import('./App')
const app = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2500)) })
{
  const backgrounds = new Map<string, number>()
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      const key = hex(span.bg.toInts().slice(0, 3) as Rgb)
      backgrounds.set(key, (backgrounds.get(key) ?? 0) + span.width)
    }
  }
  // The root paints `surface`, which is white in the fallback `light` theme
  // too; the raised surfaces are what only bloomberg-light paints.
  const raised = (backgrounds.get(BLOOMBERG_LIGHT_THEME.surface2) ?? 0) + (backgrounds.get(BLOOMBERG_LIGHT_THEME.surface3) ?? 0)
  if (raised === 0) fail(`bloomberg-light did not paint the app: ${JSON.stringify([...backgrounds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4))}`)
}
act(() => { app.mockInput.pressKey('k', { ctrl: true }) })
await act(async () => { await app.flush() })
act(() => { app.mockInput.pressKey('b') })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
await act(async () => { await app.flush() })
let appFrame = app.captureCharFrame()
if (!appFrame.includes('AGENT VIEWER ▸ DESK')) fail(`⌃K b did not open the desk:\n${appFrame}`)
// Letters belong to the desk's command line, not the app's shortcuts.
act(() => { app.mockInput.pressKey('t') })
await act(async () => { await app.flush() })
appFrame = app.captureCharFrame()
if (!/1\) MON\s+T█/.test(appFrame.replace(/\n/g, ' '))) fail(`a letter did not reach the desk's command line:\n${appFrame}`)
act(() => { app.mockInput.pressEscape() })
await act(async () => { await app.flush() })
act(() => { app.mockInput.pressEscape() })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
await act(async () => { await app.flush() })
appFrame = app.captureCharFrame()
if (appFrame.includes('AGENT VIEWER ▸ DESK')) fail(`Escape did not close the desk:\n${appFrame}`)
if (!appFrame.includes('COMPOSER')) fail(`the app did not come back after the desk:\n${appFrame}`)
app.renderer.destroy()

console.log('Desk smoke passed (commands, layouts tile, cell-aware columns, tables, autocomplete, MENU, row <GO>, search, layout, focus, theme, CANCEL, colours, both themes, ⌃K b in the App)')
process.exit(0)
