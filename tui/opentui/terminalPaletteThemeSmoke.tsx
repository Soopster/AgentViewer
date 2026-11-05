/** @jsxImportSource @opentui/react */
// The TERMINAL theme is made of the colours the terminal reports for itself.
// OpenTUI asks with OSC 4/10/11, but refuses to under the test renderer ("requires
// an active terminal"), so the smoke answers at the renderer's API instead: a
// stubbed getPalette for the first read, and the `palette` event OpenTUI emits
// when the terminal's colours change. It reads the painted colours back, since
// the character frame is the same in every theme.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-terminal-palette-smoke-'))
mkdirSync(path.join(cwd, '.agent-viewer-data'))
writeFileSync(path.join(cwd, '.agent-viewer-data', 'tui.json'), JSON.stringify({ theme: 'terminal-palette' }))
process.chdir(cwd)

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => [] }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service, readTuiSessions: async () => [] }))

const { terminalPaletteTheme } = await import('../theme')
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

// A scheme nothing built in matches: a teal-black background, and accents
// that differ from every built-in theme's.
const SCHEME = {
  background: '#0b1f24',
  foreground: '#d8e6e3',
  ansi: ['#0b1f24', '#e06c75', '#7fbf6a', '#e5c07b', '#5aa9e6', '#c678dd', '#56b6c2', '#c0cfcc',
    '#40565b', '#ff7b86', '#98d982', '#f0d08c', '#7cc0f0', '#d692e8', '#6fd0dc', '#ffffff'],
}
const hex = (value: [number, number, number, number]) => `#${value.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`
const painted = () => {
  const counts = new Map<string, number>()
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      for (const key of [hex(span.bg.toInts()), hex(span.fg.toInts())]) counts.set(key, (counts.get(key) ?? 0) + span.width)
    }
  }
  return counts
}

let asked = 0
const reported = { palette: SCHEME.ansi, defaultForeground: SCHEME.foreground, defaultBackground: SCHEME.background }
;(setup.renderer as unknown as { getPalette: () => Promise<typeof reported> }).getPalette = async () => {
  asked += 1
  return reported
}
await settle(2500)
if (asked !== 1) fail(`the restored terminal theme asked for the palette ${asked} times, expected once`)

const expected = terminalPaletteTheme({
  palette: SCHEME.ansi,
  defaultForeground: SCHEME.foreground,
  defaultBackground: SCHEME.background,
})
if (!expected) fail('a full scheme built no theme')
if (expected!.red !== SCHEME.ansi[1] || expected!.text !== SCHEME.foreground || expected!.bg !== SCHEME.background) {
  fail(`the theme did not take the scheme's colours: ${JSON.stringify(expected)}`)
}
const colours = painted()
if (!colours.has(expected!.surface)) {
  fail(`nothing on screen is the terminal theme's surface ${expected!.surface}; most painted: ${[...colours].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c).join(', ')}`)
}
if (!colours.has(expected!.text)) fail(`no text is painted in the terminal's foreground ${expected!.text}`)

// The terminal's colours change (an appearance flip, a new scheme): OpenTUI
// re-reads them and says so, and the theme follows without being asked.
const LIGHT_SCHEME = { ...reported, defaultForeground: '#1d2a2e', defaultBackground: '#f4f1e8' }
await act(async () => { setup.renderer.emit('palette', LIGHT_SCHEME) })
await settle()
const relit = terminalPaletteTheme(LIGHT_SCHEME)!
if (!painted().has(relit.surface)) fail(`a changed palette was not repainted (expected surface ${relit.surface})`)
if (asked !== 1) fail('a palette event made the app ask again instead of using what it was told')

// A terminal that reports no background has nothing to build from.
if (terminalPaletteTheme({ palette: [], defaultForeground: '#ffffff', defaultBackground: null }) !== null) {
  fail('a terminal with no reported background built a theme anyway')
}

console.log('terminal palette theme smoke passed (asks once, paints the reported scheme, follows a change)')
process.exit(0)
