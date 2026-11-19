/** @jsxImportSource @opentui/react */
import React from 'react'
import { useKeyboard } from '@opentui/react'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { GitPopover, type GitKeyEvent, type GitPopoverProps } from '../../plugins/git/tui/GitPopover'
const exec = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'git-hunk-actions-'))
let handler: (key: GitKeyEvent) => boolean | void = () => {}
let capture = false
function RoutedWorkspace(props: GitPopoverProps) {
  useKeyboard(event => { if (handler(event) !== false) { event.preventDefault(); event.stopPropagation() } })
  return <GitPopover {...props} />
}
const key = (name: string, sequence = name, ctrl = false) => handler({ name, sequence, ctrl, shift: false })
try {
  await exec('git', ['init', '-q'], { cwd: root })
  await exec('git', ['config', 'user.name', 'Hunk Test'], { cwd: root })
  await exec('git', ['config', 'user.email', 'hunk@example.invalid'], { cwd: root })
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: root })
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
  await writeFile(join(root, 'f.txt'), lines.join('\n') + '\n')
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-qm', 'base'], { cwd: root })
  const edited = lines.map(line => line === 'line 3' || line === 'line 35' ? `${line} CHANGED` : line)
  await writeFile(join(root, 'f.txt'), edited.join('\n') + '\n')
  const setup = await testRender(<RoutedWorkspace cwd={root} width={120} height={40} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} onKeyCaptureChange={next => { capture = next }} />, { width: 120, height: 40 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); await setup.flush() }); await setup.flush() }
  const waitText = async (text: string) => { for (let i = 0; i < 30; i++) { await settle(); if (setup.captureCharFrame().includes(text)) return }; throw new Error(`Missing ${text}\n${setup.captureCharFrame()}`) }
  const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout
  try {
    await settle(); await act(async () => key('g')); await waitText('[S accept hunk]'); await waitText('[D reject hunk]')
    await act(async () => key('tab', '\t')); await settle()
    // The diff cursor starts on the first hunk header: accept stages only that hunk.
    await act(async () => key('S')); await waitText('Selection updated')
    const cached = await git('diff', '--cached')
    if (!cached.includes('+line 3 CHANGED') || cached.includes('line 35')) throw new Error(`Accepting the first hunk staged the wrong thing:\n${cached}`)
    // Move to the remaining (second) hunk, arm the discard, then confirm it.
    for (let i = 0; i < 6; i++) { await act(async () => key('down')) }
    await settle()
    await act(async () => key('D')); await waitText('D again to discard')
    if (!(await git('diff')).includes('line 35 CHANGED')) throw new Error('Arming the discard must not change the file')
    await act(async () => key('D')); await waitText('Changes discarded')
    const worktree = await git('diff')
    if (worktree.includes('line 35 CHANGED') || (await readFile(join(root, 'f.txt'), 'utf8')).includes('line 35 CHANGED')) throw new Error('The second hunk was not discarded')
    if (!(await readFile(join(root, 'f.txt'), 'utf8')).includes('line 3 CHANGED')) throw new Error('The accepted hunk must stay')
    console.log('Git workspace hunk actions passed: accept stages one hunk, reject needs a second press, discard restores only that hunk.')
  } finally { act(() => setup.renderer.destroy()) }
} finally { await rm(root, { recursive: true, force: true }) }
process.exit(0)
