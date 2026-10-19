/** @jsxImportSource @opentui/react */
// Interactive shells in the Terminal tab, on a real PTY.
//
// What makes it a terminal rather than a command box is state that outlives a
// command — `cd` and `export` — and keys a shell needs that the TUI also
// wants: ⌃C, Escape, arrows in application mode. Each fails quietly: a key
// re-encoded wrong types escape codes into the prompt, and a PTY left at its
// spawn size wraps every line at the wrong column.
import React from 'react'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { ProcessPane, type ProcessPaneKey } from './ProcessPane'
import { getShells, resetShellsForTest, shellTerminal } from './shellStore'
import { readAllScreenText, readScreenRuns } from './shellScreen'
import { resetProcessesForTest } from './processStore'
import { encodeTerminalKey, encodeTerminalPaste } from '../../lib/terminalKeys'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ── Keys ────────────────────────────────────────────────────────────────────
{
  const key = (name: string, extra: Partial<Parameters<typeof encodeTerminalKey>[0]> = {}) => ({ name, ctrl: false, shift: false, ...extra })
  assert(encodeTerminalKey(key('a', { ctrl: true, sequence: '\x1b[97;5u', raw: '\x1b[97;5u' })) === '\x01', 'a kitty ⌃A must reach the shell as ^A')
  assert(encodeTerminalKey(key('c', { ctrl: true })) === '\x03', '⌃C')
  assert(encodeTerminalKey(key('up')) === '\x1b[A' && encodeTerminalKey(key('up'), { cursorKeysApp: true }) === '\x1bOA', 'arrows follow DECCKM')
  assert(encodeTerminalKey(key('left', { ctrl: true })) === '\x1b[1;5D', '⌃← carries its modifier')
  assert(encodeTerminalKey(key('tab', { shift: true })) === '\x1b[Z', '⇧Tab')
  assert(encodeTerminalKey(key('b', { meta: true, sequence: 'b' })) === '\x1bb', 'Alt+B is ESC b')
  assert(encodeTerminalKey(key('1', { shift: true, raw: '\x1b[49:33;2u', sequence: '\x1b[49:33;2u' })) === '!', 'a shifted kitty key types its shifted character')
  assert(encodeTerminalKey(key('backspace')) === '\x7f' && encodeTerminalKey(key('escape')) === '\x1b', 'backspace and escape')
  assert(encodeTerminalKey(key('pageup')) === '\x1b[5~' && encodeTerminalKey(key('f5')) === '\x1b[15~', 'tilde keys')
  assert(encodeTerminalKey(key('é', { sequence: 'é' })) === 'é', 'non-ASCII text passes through')
  assert(encodeTerminalPaste('a\nb', true) === '\x1b[200~a\rb\x1b[201~', 'bracketed paste')
  assert(encodeTerminalPaste('x\x1b[201~rm -rf ~', true) === '\x1b[200~xrm -rf ~\x1b[201~', 'a paste cannot end its own bracket')
  console.log('Keys are re-encoded as the legacy sequences a shell reads, whatever the TUI received.')
}

const workspace = await realpath(await mkdtemp(join(tmpdir(), 'agent-viewer-shell-pane-')))
const previousShell = process.env.SHELL
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  await mkdir(join(workspace, 'sub'))
  // A known shell with no user profile, so the test does not depend on someone's prompt.
  process.env.SHELL = '/bin/sh'
  process.env.ENV = ''

  let handleKey: ((key: ProcessPaneKey) => void) | null = null
  let capture = 'none'
  const captured = () => capture
  // The pane's size is state, so the test can resize it the way the panel does.
  let resizePane: ((size: { width: number; height: number }) => void) | null = null
  function Harness({ children }: { children: (size: { width: number; height: number }) => React.ReactNode }) {
    const [size, setSize] = React.useState({ width: 82, height: 20 })
    resizePane = setSize
    return <>{children(size)}</>
  }
  const setup = await testRender(
    <Harness>{(size) => (
    <ProcessPane
      theme={DARK_THEME}
      width={size.width}
      height={size.height}
      focused
      cwd={workspace}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onCaptureChange={(value) => { capture = value }}
      onOpenFile={() => {}}
      onNotice={() => {}}
    />
    )}</Harness>,
    { width: 82, height: 20 },
  )
  const settle = async (ms: number) => {
    const deadline = performance.now() + ms
    while (performance.now() < deadline) await act(async () => { await setup.flush(); await wait(10) })
  }
  const send = async (key: ProcessPaneKey) => {
    act(() => { handleKey?.(key) })
    await settle(30)
  }
  const type = async (text: string) => {
    for (const char of text) await send({ name: char, ctrl: false, shift: false, sequence: char })
  }
  const enter = () => send({ name: 'return', ctrl: false, shift: false, sequence: '\r' })
  const shellText = () => {
    const shell = getShells()[0]
    const term = shell ? shellTerminal(shell.id) : null
    return term ? readAllScreenText(term).join('\n') : ''
  }
  const until = async (predicate: () => boolean, what: string, timeoutMs = 8000) => {
    const deadline = performance.now() + timeoutMs
    while (performance.now() < deadline && !predicate()) await settle(50)
    assert(predicate(), `${what}\n--- shell ---\n${shellText()}\n--- frame ---\n${setup.captureCharFrame()}`)
  }

  try {
    await settle(200)
    await send({ name: 'o', ctrl: false, shift: false, sequence: 'o' })
    await until(() => captured() === 'terminal' && getShells()[0]?.status === 'running', 'o did not open a shell with the keyboard')
    // Typed before the first prompt, input is echoed ahead of it, as in any terminal.
    await until(() => /[$#%>] ?$/m.test(shellText()), 'the shell never drew a prompt')

    // State that outlives a command is what a command box cannot do.
    await type('cd sub'); await enter()
    await type('export AV_SMOKE=kept'); await enter()
    await type('echo "at:$PWD:$AV_SMOKE"'); await enter()
    await until(() => shellText().includes(`at:${workspace}/sub:kept`), 'cd and export did not persist across commands')
    console.log('cd and export persist from one command to the next.')

    // The PTY is the pane's size: 17 rows (20 less the tab row, status and hint) by 80 columns.
    await type('stty size'); await enter()
    await until(() => /^17 80$/m.test(shellText()), 'the PTY was not sized to the pane')
    // A narrower panel must reach the PTY too, or every line wraps at the old width.
    act(() => { resizePane?.({ width: 70, height: 16 }) })
    await settle(100)
    await type('stty size'); await enter()
    await until(() => /^13 68$/m.test(shellText()), 'resizing the pane did not resize the PTY')
    console.log('The shell sees the pane\'s size, and follows it when the pane is resized.')

    // ⌃C interrupts the foreground program and the shell carries on.
    await type('cat'); await enter()
    await settle(200)
    await send({ name: 'c', ctrl: true, shift: false, sequence: '\x1b[99;5u', raw: '\x1b[99;5u' })
    await type('echo after-interrupt'); await enter()
    await until(() => /^after-interrupt$/m.test(shellText()), '⌃C did not reach the shell as an interrupt')
    console.log('⌃C goes to the shell, as an interrupt, while it has the keyboard.')

    // Colour comes through the emulator into painted runs.
    await type("printf '\\033[31mREDTEXT\\033[0m\\n'"); await enter()
    await until(() => shellText().includes('\nREDTEXT'), 'printf did not run')
    const term = shellTerminal(getShells()[0]!.id)!
    const red = readScreenRuns(term, DARK_THEME).flat().find((run) => run.text.startsWith('REDTEXT'))
    assert(red?.fg === DARK_THEME.red, `ANSI red was painted ${red?.fg}`)
    await until(() => setup.captureCharFrame().includes('REDTEXT'), 'the pane did not paint the shell')
    console.log('ANSI colours are painted in the theme\'s own hues.')

    // Scrollback: output that scrolled off is reachable once the keys are handed back.
    await type('seq 1 120'); await enter()
    await until(() => /^120$/m.test(shellText()), 'seq did not finish')
    await send({ name: ']', ctrl: true, shift: false, sequence: '\x1d' })
    assert(captured() === 'none', '⌃] did not hand the keys back')
    for (let press = 0; press < 3; press += 1) await send({ name: 'pageup', ctrl: false, shift: false, sequence: '' })
    await settle(100)
    assert(/rows up/.test(setup.captureCharFrame()) && !/^\s*120\s*$/m.test(setup.captureCharFrame()), `PgUp did not scroll the shell back:\n${setup.captureCharFrame()}`)
    await send({ name: 'G', ctrl: false, shift: true, sequence: 'G' })
    console.log('⌃] leaves the shell, and PgUp then reads its scrollback.')

    // Closing the view leaves the shell running.
    act(() => setup.renderer.destroy())
    await wait(200)
    assert(getShells()[0]?.status === 'running', 'closing the view ended the shell')
    console.log('The shell keeps running after its view is gone.')
  } finally {
    try { act(() => setup.renderer.destroy()) } catch { /* already */ }
  }
  console.log('Shell pane smoke passed')
} finally {
  if (previousShell === undefined) delete process.env.SHELL
  else process.env.SHELL = previousShell
  await resetShellsForTest()
  await resetProcessesForTest()
  await rm(workspace, { recursive: true, force: true })
}
