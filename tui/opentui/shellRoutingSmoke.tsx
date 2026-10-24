/** @jsxImportSource @opentui/react */
// A shell in the real App: keys reach it through the root's routing, kitty-
// encoded the way the TUI's terminal sends them. The panel claims Escape, ⌃W,
// ⌃N, `=` and ⇧O for itself; a shell needs every one of them, so while it has
// the keyboard each must go to the shell — and ⌃] must give them back.
import React from 'react'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// Hermetic: state files resolve from process.cwd(). Import App AFTER chdir.
const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-viewer-shell-routing-')))
process.chdir(workspace)
process.env.SHELL = '/bin/sh'
const { default: OpenTuiApp } = await import('./App')
const { getShells, shellTerminal, resetShellsForTest } = await import('./shellStore')
const { readAllScreenText } = await import('./shellScreen')

// exitOnCtrlC off, as start.tsx runs the app: ⌃C is the shell's here.
const setup = await testRender(<OpenTuiApp />, { width: 160, height: 44, kittyKeyboard: true, exitOnCtrlC: false })
const settle = async (ms = 300) => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  await act(async () => { await setup.flush() })
}
const shellText = () => {
  const shell = getShells()[0]
  const term = shell ? shellTerminal(shell.id) : null
  return term ? readAllScreenText(term).join('\n') : ''
}
const until = async (predicate: () => boolean, what: string, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !predicate()) await settle(60)
  assert(predicate(), `${what}\n--- shell ---\n${shellText()}\n--- frame ---\n${setup.captureCharFrame()}`)
}
const typeText = async (text: string) => {
  await act(async () => { await setup.mockInput.typeText(text) })
  await settle(60)
}
const enter = async () => { act(() => { setup.mockInput.pressEnter() }); await settle(80) }

try {
  await settle(2500)
  act(() => { setup.mockInput.pressKey('k', { ctrl: true }) })
  await settle(120)
  act(() => { setup.mockInput.pressKey('l') })
  await settle(600)
  assert(setup.captureCharFrame().includes('❯ Terminal'), `⌃K l did not open the Terminal tab:\n${setup.captureCharFrame()}`)

  act(() => { setup.mockInput.pressKey('o') })
  await until(() => /[$#%>] ?$/m.test(shellText()), 'o did not start a shell with a prompt')

  // ⌃W is the panel's close-tab chord; here it must delete a word.
  await typeText('echo one two')
  act(() => { setup.mockInput.pressKey('w', { ctrl: true }) })
  await settle(80)
  await enter()
  await until(() => /^one\s*$/m.test(shellText()), '⌃W did not reach the shell as delete-word')
  assert(getShells()[0]?.status === 'running' && setup.captureCharFrame().includes('typing into the shell'), '⌃W closed the tab instead')

  // `=` expands the panel and Escape leaves it — both are keys a shell needs.
  await typeText('echo a=b')
  await enter()
  await until(() => /^a=b\s*$/m.test(shellText()), '= did not reach the shell')
  // vi-mode editing, `less` and vim all need Escape; it must not take the shell's keyboard away.
  act(() => { setup.mockInput.pressEscape() })
  await settle(150)
  assert(setup.captureCharFrame().includes('typing into the shell'), `Escape left the shell:\n${setup.captureCharFrame()}`)
  act(() => { setup.mockInput.pressKey('c', { ctrl: true }) })
  await settle(100)
  await typeText('echo still-here')
  await enter()
  await until(() => /^still-here\s*$/m.test(shellText()), 'the shell stopped taking keys after Escape')
  console.log('⌃W, = and Escape go to the shell while it has the keyboard.')

  // ⌃] hands the keys back, and Escape then leaves the panel as usual.
  act(() => { setup.mockInput.pressKey(']', { ctrl: true }) })
  await settle(150)
  assert(!setup.captureCharFrame().includes('typing into the shell'), `⌃] did not hand the keys back:\n${setup.captureCharFrame()}`)
  act(() => { setup.mockInput.pressEscape() })
  await settle(200)
  assert(getShells()[0]?.status === 'running', 'leaving the panel ended the shell')
  console.log('⌃] gives the keys back to the panel; the shell keeps running.')
  console.log('Shell routing smoke passed')
} finally {
  act(() => setup.renderer.destroy())
  await resetShellsForTest()
}
process.exit(0)
