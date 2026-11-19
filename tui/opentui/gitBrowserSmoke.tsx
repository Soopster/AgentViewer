/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../../lib/git/command'
import { browseHistory, browseCommit, browseDirectory, browseBlob, browseChangedFiles } from '../../lib/git/browse'
import { GitPopover, type GitKeyEvent } from '../../plugins/git/tui/GitPopover'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
const root = await mkdtemp(join(tmpdir(), 'git-browser-')), linked = `${root}-linked`
let handler: (key: GitKeyEvent) => boolean | void = () => false
try {
  await git(root, ['init', '-q'])
  await git(root, ['config', 'user.name', 'Browser Test']); await git(root, ['config', 'user.email', 'browser@example.invalid']); await git(root, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested', 'before.txt'), 'historical contents\n'); await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]))
  await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'Root commit'])
  await git(root, ['mv', 'nested/before.txt', 'nested/after.txt']); await git(root, ['commit', '-qm', 'Rename file'])
  await writeFile(join(root, 'nested', 'after.txt'), 'local contents\n'); await writeFile(join(root, 'untracked.txt'), 'untracked contents\n')
  await symlink('/etc/passwd', join(root, 'outside-link'))
  const history = await browseHistory(root, 'HEAD')
  assert.equal(history.length, 2); assert.equal(history[0]!.subject, 'Rename file'); assert.equal(history[1]!.subject, 'Root commit'); assert(history[0]!.graph?.includes('●'))
  const commit = await browseCommit(root, history[0]!.sha)
  assert.equal(commit.author, 'Browser Test'); assert.equal(commit.parents[0], history[1]!.sha)
  assert.deepEqual(await browseChangedFiles(root, commit), [{ status: 'R100', previousPath: 'nested/before.txt', path: 'nested/after.txt' }])
  const entries = await browseDirectory(root, commit.sha, 'nested')
  assert.equal(await browseBlob(root, entries[0]!), 'historical contents\n')
  const revisionRoot = await browseDirectory(root, commit.sha)
  assert.equal(await browseBlob(root, revisionRoot.find(e => e.name === 'binary')!), 'Binary file — no text preview.')
  const local = await browseDirectory(root, null)
  assert(local.some(e => e.name === 'untracked.txt')); assert.equal(await browseBlob(root, local.find(e => e.name === 'outside-link')!), 'Symbolic link (not followed).')
  const setup = await testRender(<GitPopover cwd={root} width={145} height={45} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} />, { width: 145, height: 45 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); await setup.flush() }); await setup.flush() }
  const key = async (name: string, sequence = name, ctrl = false, shift = false) => { await act(async () => { handler({ name, sequence, ctrl, shift }) }); await settle() }
  const wait = async (text: string) => { for (let i = 0; i < 15 && !setup.captureCharFrame().includes(text); i++) await settle(); expect(text) }
  const expect = (text: string) => assert(setup.captureCharFrame().includes(text), `Missing ${text}\n${setup.captureCharFrame()}`)
  try {
    for (let i = 0; i < 12 && !setup.captureCharFrame().includes('local contents'); i++) await settle(); expect('Local Changes'); expect('File Tree'); expect('Stage changes'); expect('local contents');
    await key('n', 'n', true); await key('down'); await key('return'); await wait('Root commit'); expect('Browser Test')
    await key('return'); await wait('historical contents')
    await key('tab', '\t', false, true); await key('left'); await wait('Author'); expect('Rename file'); expect('nested/after.txt')
    await key('right'); await key('right'); await wait('nested');
    await key('return'); await key('return'); await wait('after.txt'); await key('down'); await wait('historical contents');
    assert(!setup.captureCharFrame().includes('local contents'), 'Revision preview must never read the working file')
    await git(root, ['worktree', 'add', '-q', '-b', 'linked', linked])
    await writeFile(join(linked, 'linked-only.txt'), 'worktree contents\n')
    await key('r', 'r', true); await wait('Worktrees (2)')
    const clickNavigation = async (text: string) => {
      const y = setup.captureCharFrame().split('\n').findIndex(line => line.includes(text)); assert(y >= 0, `Missing navigation ${text}`)
      await act(async () => { await setup.mockMouse.click(5, y) }); await settle()
    }
    await clickNavigation('▶ Worktrees'); await clickNavigation('linked ·'); await wait('[Repo] linked'); await wait('linked-only.txt')
    await clickNavigation('▶ Worktrees')
    const originalBranch = (await git(root, ['branch', '--show-current'])).trim()
    await clickNavigation(`${originalBranch} ·`); await wait('historical contents')
    console.log('Git browser smoke passed: structured history, rename, revision blobs, local tree, symlink, shell navigation, Commit and Changes.')
  } finally { act(() => setup.renderer.destroy()) }
  for (const [width, height, docked] of [[50, 18, false], [90, 28, false], [130, 40, true]] as const) {
    const small = await testRender(<GitPopover cwd={root} width={width} height={height} docked={docked} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} />, { width, height })
    const settleSmall = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); await small.flush() }); await small.flush() }
    const press = async (name: string, ctrl = false) => { await act(async () => { handler({ name, sequence: name, ctrl, shift: false }) }); await settleSmall() }
    try {
      await settleSmall(); await settleSmall()
      assert(small.captureCharFrame().includes('File Tree'), `Tabs missing at ${width}x${height}`)
      await press('n', true); await press('home'); await press('down'); await press('return')
      for (let i = 0; i < 15 && !small.captureCharFrame().includes('Root commit'); i++) await settleSmall()
      assert(small.captureCharFrame().includes('Root commit'), `History missing at ${width}x${height}`)
      if (height < 32) assert(!small.captureCharFrame().includes('File Tree'), 'Short history occupies the detail area')
      await press('return')
      for (let i = 0; i < 15 && !small.captureCharFrame().includes('historical contents'); i++) await settleSmall()
      assert(small.captureCharFrame().includes('File Tree'), `Details missing at ${width}x${height}`)
      const lines = small.captureCharFrame().split('\n')
      assert(lines.every(line => line.length <= width + 1), 'Layout must stay within terminal columns')
    } finally { act(() => small.renderer.destroy()) }
  }
  console.log('Git browser responsive smoke passed: 50x18, 90x28 and docked 130x40 history/detail navigation.')
} finally { await rm(linked, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
