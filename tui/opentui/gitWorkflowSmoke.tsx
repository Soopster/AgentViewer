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
import { GitPopover, type GitKeyEvent, type GitPopoverProps } from './GitPopover'
const exec = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'git-workflow-ui-'))
let handler: (key: GitKeyEvent) => boolean | void = () => {}, capture = false
function RoutedWorkspace(props: GitPopoverProps) {
  useKeyboard(event => { if (handler(event) !== false) { event.preventDefault(); event.stopPropagation() } })
  return <GitPopover {...props} />
}
const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout
try {
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'Workflow UI'); await git('config', 'user.email', 'workflow-ui@example.invalid'); await git('config', 'commit.gpgsign', 'false')
  await writeFile(join(root, 'conflict.txt'), 'base\n'); await git('add', '.'); await git('commit', '-qm', 'Baseline')
  await writeFile(join(root, 'conflict.txt'), 'TUI stash\n')
  const setup = await testRender(<RoutedWorkspace cwd={root} width={140} height={44} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} onKeyCaptureChange={value => { capture = value }} />, { width: 140, height: 44 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); await setup.flush() }); await setup.flush() }
  const press = async (name: string, sequence = name, ctrl = false) => { await act(async () => { handler({ name, sequence, ctrl, shift: false }) }); await settle() }
  const wait = async (condition: () => boolean, message: string) => { for (let i = 0; i < 100; i++) { if (condition()) return; await settle() } throw new Error(`${message}\n${setup.captureCharFrame()}`) }
  const choose = async (label: string) => {
    for (let index = 0; index < 30; index++) { if (setup.captureCharFrame().includes(`▶ ${label}`)) { await press('return', '\r'); return }; await press('down') }
    throw new Error(`Action not found: ${label}\n${setup.captureCharFrame()}`)
  }
  const reviewAndConfirm = async () => { await press('return', '\r', true); await wait(() => setup.captureCharFrame().includes('Enter confirms'), 'Action confirmation missing'); await press('return', '\r'); await wait(() => !capture, 'Action did not finish') }
  try {
    await wait(() => setup.captureCharFrame().includes('conflict.txt'), 'Workspace did not load')
    await press('g'); await wait(() => setup.captureCharFrame().includes('[: Actions]'), 'Workspace did not open')
    await press(':'); await choose('Create stash')
    await act(async () => { setup.mockInput.typeText('TUI saved changes') }); await settle()
    await reviewAndConfirm()
    if (!(await git('stash', 'list')).includes('TUI saved changes')) throw new Error('Native stash message input failed')
    await press(':'); await choose('Create branch')
    await act(async () => { setup.mockInput.typeText('tui-feature') }); await settle()
    await reviewAndConfirm()
    if ((await git('branch', '--show-current')).trim() !== 'tui-feature') throw new Error('Create/switch branch failed')
    await press('5'); await press(':'); await choose('Apply stash@{0}'); await reviewAndConfirm()
    if (await readFile(join(root, 'conflict.txt'), 'utf8') !== 'TUI stash\n') throw new Error('Stash application failed')
    if (!(await git('stash', 'list')).includes('TUI saved changes')) throw new Error('Apply unexpectedly dropped stash')
    // Introduce a real merge conflict and refresh the existing workspace.
    await git('stash', 'push', '-qm', 'Reset fixture'); await git('switch', '-qc', 'other')
    await writeFile(join(root, 'conflict.txt'), 'other\n'); await git('commit', '-qam', 'Other')
    await git('switch', '-q', 'tui-feature'); await writeFile(join(root, 'conflict.txt'), 'feature\n'); await git('commit', '-qam', 'Feature')
    await git('merge', 'other').catch(() => '')
    await press('r'); await wait(() => setup.captureCharFrame().includes('merge'), 'Merge state did not refresh')
    await press('2'); await press('f'); await wait(() => setup.captureCharFrame().includes('Resolve conflict'), 'Conflict editor missing')
    await wait(() => !setup.captureCharFrame().includes('Loading conflict versions…') && setup.captureCharFrame().includes('ours · b/o/t'), 'Conflict versions did not load')
    await press('e'); await wait(() => setup.captureCharFrame().includes('1 conflict blocks remain'), 'Editable conflict result missing')
    await press('o', 'o', true); await wait(() => setup.captureCharFrame().includes('0 conflict blocks remain'), 'Choosing ours block failed')
    await press('return', '\r', true); await wait(() => setup.captureCharFrame().includes('Enter confirms resolution'), 'Resolution confirmation missing')
    await press('return', '\r'); await wait(() => !capture, 'Resolution did not complete')
    if (await readFile(join(root, 'conflict.txt'), 'utf8') !== 'feature\n') throw new Error('Wrong conflict content saved')
    await press(':'); await choose('Continue merge'); await press('return', '\r'); await wait(() => !capture, 'Merge continue did not complete')
    const parents = (await git('show', '-s', '--format=%P', 'HEAD')).trim().split(' ')
    if (parents.length !== 2) throw new Error('Merge was not completed')
    console.log('Git workflow TUI passed: action previews, native fields, stash/create-branch/apply, editable conflict blocks, resolution staging, merge continue.')
  } finally { act(() => setup.renderer.destroy()) }
} finally { await rm(root, { recursive: true, force: true }) }
