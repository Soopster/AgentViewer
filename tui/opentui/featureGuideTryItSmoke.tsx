/** @jsxImportSource @opentui/react */
// "Try it" in What's new in Agent Viewer, through the real App: a plugin command
// opens its surface (the guide must not close it again on the way out), and a
// host palette command runs too. Each case boots its own App.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-feature-guide-try-'))
mkdirSync(path.join(cwd, '.agent-viewer-data'))
writeFileSync(path.join(cwd, '.agent-viewer-data', 'tui.json'), JSON.stringify({ theme: 'dark' }))
process.chdir(cwd)

const { default: OpenTuiApp } = await import('./App')
const fail = (message: string): never => { console.error(message); process.exit(1) }

const setup = await testRender(<OpenTuiApp />, { width: 140, height: 44, kittyKeyboard: true })
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
const type = async (text: string) => { for (const ch of text) act(() => { setup.mockInput.pressKey(ch) }); await settle(200) }

await settle(2500)
// [search typed into the guide, text only the opened surface shows, what it is]
const CASES: [string, string, string][] = [
  ['focus mode', 'Not focusing', 'a plugin command (Focus Mode) opens its surface and the guide does not close it again'],
  ['oled', 'Search themes', 'a host palette command (the theme menu) runs'],
]
for (const [search, expected, what] of CASES) {
  act(() => { setup.mockInput.pressKey('?') })
  await settle(400)
  await type('latest features and how to use them')
  act(() => { setup.mockInput.pressEnter() })
  await settle(1500)
  if (!setup.captureCharFrame().includes('features · ')) fail(`the guide did not open:\n${setup.captureCharFrame()}`)
  await type('/')
  await type(search)
  act(() => { setup.mockInput.pressEnter() })
  await settle(300)
  if (setup.captureCharFrame().includes(expected)) fail(`"${expected}" was on screen before Try it, so the case proves nothing`)
  await type('o')
  await settle(1200)
  const frame = setup.captureCharFrame()
  if (frame.includes('features · ')) fail(`the guide stayed open after Try it (${search}):\n${frame}`)
  if (!frame.includes(expected)) fail(`Try it did not work: ${what}\n${frame}`)
  act(() => { setup.mockInput.pressEscape() })
  await settle(600)
}
// Every entry's command must be one the App can run: the guide closes and no
// "not available" notice appears. new-scratch is skipped: it creates a session.
const { FEATURE_GUIDE } = await import('../../lib/featureGuide')
let swept = 0
for (const entry of FEATURE_GUIDE) {
  if (!entry.command || entry.command === 'new-scratch') continue
  act(() => { setup.mockInput.pressKey('?') })
  await settle(400)
  await type('latest features and how to use them')
  act(() => { setup.mockInput.pressEnter() })
  await settle(1200)
  await type('/')
  // The guide's search reads letters only one at a time; a title's own words find it.
  await type(entry.title.replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim())
  act(() => { setup.mockInput.pressEnter() })
  await settle(300)
  await type('o')
  await settle(900)
  const frame = setup.captureCharFrame()
  if (frame.includes('features · ')) fail(`${entry.id}: the guide stayed open after Try it:\n${frame}`)
  if (/not available here|Turn on the .* plugin/.test(frame)) fail(`${entry.id}: Try it could not run ${entry.command}:\n${frame}`)
  swept += 1
  for (let i = 0; i < 3; i += 1) { act(() => { setup.mockInput.pressEscape() }); await settle(250) }
  // Escape on an empty app asks to quit; answer no.
  if (/Quit|quit\?/.test(setup.captureCharFrame())) { act(() => { setup.mockInput.pressKey('n') }); await settle(250) }
}
console.log(`featureGuideTryItSmoke: PASS (${CASES.length} cases, ${swept} entries' commands ran)`)
process.exit(0)
