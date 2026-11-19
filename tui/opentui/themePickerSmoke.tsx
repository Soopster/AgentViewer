/** @jsxImportSource @opentui/react */
// The theme menu is the theme-picker plugin: it opens over the app, previews as the
// arrows move, restores on Escape, searches, chooses and persists, and its Tab toggle
// follows the terminal. Which theme is active is read off the painted background.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-theme-picker-smoke-'))
process.chdir(cwd)
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => [] }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service, readTuiSessions: async () => [] }))

// The TUI registers the theme packs at boot (shell/localPlugins.ts); the smoke does the same.
const { syncTuiPluginThemes } = await import('./shell/pluginThemes')
syncTuiPluginThemes()
const { getThemePalette } = await import('../theme')
const { THEMES } = await import('./app/themes')
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms: number) => {
  const until = Date.now() + ms
  while (Date.now() < until) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 16)) })
}
const fail = (message: string): never => { console.error(message); process.exit(1) }
const hex = (value: number) => value.toString(16).padStart(2, '0')
const paintedBackground = (): string => {
  const counts = new Map<string, number>()
  for (const line of setup.captureSpans().lines) for (const span of line.spans) {
    const [r, g, b] = span.bg.toInts()
    const key = `#${hex(r)}${hex(g)}${hex(b)}`
    counts.set(key, (counts.get(key) ?? 0) + span.width)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}
const frame = () => setup.captureCharFrame()
const stored = () => JSON.parse(readFileSync(path.join(cwd, '.agent-viewer-data', 'tui.json'), 'utf8')) as { theme?: string; themeFollowsTerminal?: boolean }
const key = async (press: () => void) => { await act(async () => { press() }); await settle(250) }

await settle(1500)
if (!THEMES.includes('nord') || !THEMES.includes('dracula')) fail('the theme packs did not register their themes')
const before = paintedBackground()

// Opens as an overlay with its search field and groups.
await key(() => setup.mockInput.pressKey('t'))
if (!frame().includes('Search themes')) fail(`the theme menu did not open:\n${frame()}`)
if (!/LIGHT\s*\|\s*DARK/.test(frame())) fail('the menu does not show its groups')

// Arrowing previews the theme under the cursor (compared with the menu open: its own backing paints too).
const opened = paintedBackground()
await key(() => setup.mockInput.pressArrow('down'))
const previewed = paintedBackground()
if (previewed === opened) fail('moving down did not preview another theme')

// Escape restores what was there and closes the menu.
await key(() => setup.mockInput.pressEscape())
if (frame().includes('Search themes')) fail('Escape left the menu open')
if (paintedBackground() !== before) fail(`Escape did not restore the theme: ${paintedBackground()} vs ${before}`)

// Searching narrows the list and previews the first match; Enter chooses and stores it.
await key(() => setup.mockInput.pressKey('t'))
// A search is within the shown group; dracula is a dark theme.
await key(() => setup.mockInput.pressArrow('right'))
await act(async () => { await setup.mockInput.typeText('dracula') })
await settle(300)
const typed = paintedBackground()
if (typed === opened) fail('typing a search did not preview its first match')
await key(() => setup.mockInput.pressEnter())
if (frame().includes('Search themes')) fail('Enter left the menu open')
const choice = stored()
if (!choice.theme || !/dracula/.test(choice.theme)) fail(`the chosen theme was not stored: ${JSON.stringify(choice)}`)
if (choice.themeFollowsTerminal !== false) fail('choosing a theme by name should stop following the terminal')
if (paintedBackground() !== getThemePalette(choice.theme!).bg.toLowerCase()) fail(`the stored theme is not the one painted: ${paintedBackground()} vs ${getThemePalette(choice.theme!).bg}`)

// Tab turns following the terminal back on.
await key(() => setup.mockInput.pressKey('t'))
await key(() => setup.mockInput.pressTab())
// (The footer row is under the toasts in this frame, so read the stored setting instead of the label.)
await settle(300)
if (stored().themeFollowsTerminal !== true) fail(`Tab did not turn terminal following on: ${JSON.stringify(stored())}`)
await key(() => setup.mockInput.pressEscape())

console.log('theme picker smoke passed (opens, previews, restores, searches, chooses and stores, follows)')
process.exit(0)
