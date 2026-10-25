/** @jsxImportSource @opentui/react */
import React from 'react'
import { useKeyboard } from '@opentui/react'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { GitPopover, type GitKeyEvent, type GitPopoverProps } from '../../plugins/git/tui/GitPopover'
const exec = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'git-workspace-ui-'))
let handler: (key: GitKeyEvent) => boolean | void = () => {}
let capture = false
function RoutedWorkspace(props: GitPopoverProps) {
  useKeyboard(event => { if (handler(event) !== false) { event.preventDefault(); event.stopPropagation() } })
  return <GitPopover {...props} />
}
const key = (name: string, sequence = name, ctrl = false) => handler({ name, sequence, ctrl, shift: false })
try {
  await exec('git', ['init', '-q'], { cwd: root })
  await exec('git', ['config', 'user.name', 'Workspace Test'], { cwd: root })
  await exec('git', ['config', 'user.email', 'workspace@example.invalid'], { cwd: root })
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: root })
  await writeFile(join(root, 'sample.txt'), 'first\nsecond\n')
  const setup = await testRender(<RoutedWorkspace cwd={root} width={120} height={40} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} onKeyCaptureChange={next => { capture = next }} />, { width: 120, height: 40 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); await setup.flush() }); await setup.flush() }
  const waitText = async (text: string) => { for (let i = 0; i < 30; i++) { await settle(); if (setup.captureCharFrame().includes(text)) return }; expect(text) }
  const expect = (text: string) => { const frame = setup.captureCharFrame(); if (!frame.includes(text)) throw new Error(`Missing ${text}\n${frame}`) }
  try {
    await settle(); expect('[1] Status');
    await act(async () => key('g')); await waitText('[: Actions]'); expect('Git workspace'); expect('sample.txt'); expect('[3] Branches'); expect('[5] Stashes')
    await act(async () => key('tab', '\t')); await settle()
    await act(async () => key('down')); await act(async () => key('a')); await settle()
    expect('2 lines selected')
    await act(async () => key('s')); await waitText('Selection updated')
    const indexed = (await exec('git', ['show', ':sample.txt'], { cwd: root })).stdout
    if (indexed !== 'first\nsecond\n') throw new Error('Hunk staging failed')
    await act(async () => key('t')); await settle(); expect('staged: sample.txt')
    await act(async () => key('c')); await settle(); expect('Commit message')
    if (!capture) throw new Error('Composer must capture global shortcuts')
    await act(async () => { setup.mockInput.typeText('Workspace UI commit') }); await settle()
    await act(async () => key('return', '\r', true)); await waitText('Enter confirms'); expect('staged preview')
    await act(async () => key('return', '\r')); for (let i = 0; i < 30 && capture; i++) await settle();
    if (capture) throw new Error(`Commit did not finish:\n${setup.captureCharFrame()}`)
    const subject = (await exec('git', ['log', '-1', '--format=%s'], { cwd: root })).stdout.trim()
    if (subject !== 'Workspace UI commit') throw new Error(`Wrong commit message ${subject}`)
    if (capture) throw new Error('Commit completion must release shortcut capture')
    await act(async () => key('G')); await settle(); expect('[1] Status')
    console.log('Git workspace TUI smoke passed: changes by default, workspace navigation, hunk staging, staged view, native composer, reviewed commit, review-mode navigation.')
  } finally { act(() => setup.renderer.destroy()) }
  const small = await testRender(<RoutedWorkspace cwd={root} width={50} height={18} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} />, { width: 50, height: 18 })
  try { await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); await small.flush() }); await act(async () => { key('g'); await small.flush() }); await small.flush(); if (!small.captureCharFrame().includes('Git workspace')) throw new Error('Small terminal workspace missing') } finally { act(() => small.renderer.destroy()) }
} finally { await rm(root, { recursive: true, force: true }) }
