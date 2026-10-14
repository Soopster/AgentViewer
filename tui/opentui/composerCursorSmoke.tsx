/** @jsxImportSource @opentui/react */
// The composer's cursor is drawn in the theme's text colour — the default is
// white on every theme, which vanishes on a light one — and turns into an
// underline while the draft is a `!` shell command. Neither is in the character
// frame, so this reads the renderer's cursor state.
import React from 'react'
import { testRender, act } from './testRender'
import { RGBA } from '@opentui/core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-composer-cursor-smoke-'))
mkdirSync(path.join(cwd, '.agent-viewer-data'))
// A light theme, chosen by name so the terminal is not consulted.
writeFileSync(path.join(cwd, '.agent-viewer-data', 'tui.json'), JSON.stringify({ theme: 'light' }))
process.chdir(cwd)

const { getThemePalette } = await import('../theme')
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
const textarea = () =>
  setup.renderer.root.findDescendantById('composer-textarea') as unknown as { focused: boolean; plainText: string } | null

await settle(2500)
act(() => { setup.mockInput.pressKey('c') })
for (let attempt = 0; attempt < 40 && !textarea()?.focused; attempt += 1) await settle()
if (!textarea()?.focused) fail(`the composer never took focus:\n${setup.captureCharFrame()}`)

const theme = getThemePalette('light')
const expectCursor = (style: string, color: string, when: string) => {
  const cursor = setup.renderer.getCursorState()
  if (cursor.style !== style) fail(`${when}: cursor is ${cursor.style}, expected ${style}`)
  if (!cursor.color.equals(RGBA.fromHex(color))) {
    fail(`${when}: cursor colour is ${cursor.color.toInts().join(',')}, expected ${color}`)
  }
}

await settle()
expectCursor('block', theme.text, 'an empty prompt')

await act(async () => { await setup.mockInput.typeText('!ls') })
await settle()
if (textarea()?.plainText !== '!ls') fail(`typed "!ls", composer holds ${JSON.stringify(textarea()?.plainText)}`)
expectCursor('underline', theme.amber, 'a ! shell command')

for (let i = 0; i < 3; i += 1) act(() => { setup.mockInput.pressBackspace() })
await settle()
expectCursor('block', theme.text, 'the command deleted again')

console.log('composer cursor smoke passed (theme-coloured block, underline for a ! command)')
process.exit(0)
