/** @jsxImportSource @opentui/react */
// With no theme chosen, the app matches the terminal's background and follows
// it when it flips; a theme picked by name stops that.
//
// The terminal answers OSC 10/11 with its colours, which is all OpenTUI infers
// the mode from, so the smoke plays the terminal's half on stdin. Which palette
// is active is not in the character frame, so it reads the painted background.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-theme-follow-smoke-'))
process.chdir(cwd)

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [],
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [],
}))

const { getThemePalette } = await import('../theme')
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms: number) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 16))
    })
  }
}
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const hex = (value: number) => value.toString(16).padStart(2, '0')
const paintedBackground = (): string => {
  const counts = new Map<string, number>()
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      const [r, g, b] = span.bg.toInts()
      const key = `#${hex(r)}${hex(g)}${hex(b)}`
      counts.set(key, (counts.get(key) ?? 0) + span.width)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}
const terminalReports = async (foreground: string, background: string) => {
  await act(async () => {
    setup.renderer.stdin.emit('data', Buffer.from(`\x1b]10;rgb:${foreground}\x07\x1b]11;rgb:${background}\x07`))
  })
  await settle(400)
}
const expectTheme = (name: 'light' | 'dark', when: string) => {
  // Most of the frame is panes, which sit on the surface colour rather than bg.
  const want = getThemePalette(name).surface.toLowerCase()
  const got = paintedBackground()
  if (got !== want) fail(`${when}: painted ${got}, expected the ${name} theme's ${want}`)
}

await settle(1500)
await terminalReports('ffff/ffff/ffff', '0000/0000/0000')
expectTheme('dark', 'a dark terminal with no theme chosen')

// The OS appearance flips: the terminal says so (?997) and answers the re-query.
await act(async () => { setup.renderer.stdin.emit('data', Buffer.from('\x1b[?997;2n')) })
await terminalReports('0000/0000/0000', 'ffff/ffff/ffff')
expectTheme('light', 'the terminal turning light')

// Picking a theme by name is a choice, and the terminal no longer overrides it.
await act(async () => { setup.mockInput.pressKey('t') })
await settle(300)
await act(async () => { setup.mockInput.pressEnter() })
await settle(300)
const chosen = JSON.parse(readFileSync(path.join(cwd, '.agent-viewer-data', 'tui.json'), 'utf8')) as {
  theme?: string
  themeFollowsTerminal?: boolean
}
if (chosen.themeFollowsTerminal !== false) fail(`choosing a theme left themeFollowsTerminal ${String(chosen.themeFollowsTerminal)}`)
const afterChoice = paintedBackground()
await act(async () => { setup.renderer.stdin.emit('data', Buffer.from('\x1b[?997;1n')) })
await terminalReports('ffff/ffff/ffff', '0000/0000/0000')
if (paintedBackground() !== afterChoice) fail('the terminal turning dark replaced a theme chosen by name')

console.log('theme follow smoke passed (matches the terminal, follows a flip, yields to a chosen theme)')
process.exit(0)
