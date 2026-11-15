/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { git } from '../../lib/git/command'
import { GitPopover } from '../../plugins/git/tui/GitPopover'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'

const root = await mkdtemp(join(tmpdir(), 'git-workspace-mouse-'))
try {
  await git(root, ['init', '-q'])
  await git(root, ['config', 'user.name', 'Mouse Fixture'])
  await git(root, ['config', 'user.email', 'mouse@example.invalid'])
  await git(root, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/first.ts'), 'before\n')
  await writeFile(join(root, 'src/second.ts'), 'before\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-qm', 'Baseline'])
  await writeFile(join(root, 'src/first.ts'), Array.from({ length: 80 }, (_, i) => `after-${i}\n`).join(''))
  await writeFile(join(root, 'src/second.ts'), 'second change\n')
  const setup = await testRender(<GitPopover docked cwd={root} width={160} height={36} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={() => {}} />, { width: 160, height: 36 })
  const frame = () => setup.captureCharFrame()
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await setup.flush() }); await setup.flush() }
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 40 && !predicate(); i++) await settle(); assert(predicate(), frame()) }
  const clickId = async (id: string) => {
    const target = setup.renderer.root.findDescendantById(id)
    assert(target, `Missing ${id}\n${frame()}`)
    await act(async () => { await setup.mockMouse.click(target.x + 1, target.y) }); await settle()
  }
  const clickText = async (text: string) => {
    const lines = frame().split('\n'), y = lines.findIndex(line => line.includes(text))
    assert(y >= 0, `Missing ${text}\n${frame()}`)
    await act(async () => { await setup.mockMouse.click(lines[y]!.indexOf(text) + 1, y) }); await settle()
  }
  try {
    await until(() => frame().includes('File Tree'))
    await clickText('Commit')
    await until(() => frame().includes('Commit message') && frame().includes('after-0'))
    await clickText('second.ts')
    await until(() => frame().includes('unstaged: src/second.ts'))
    assert(frame().includes('Commit message'), 'message box stays visible while browsing files')
    await clickText('▼ src')
    assert(!frame().split('\n').some(line => line.slice(0, 46).includes('second.ts')), 'folder collapses')
    await clickText('▶ src')
    await clickText('first.ts')
    await until(() => frame().includes('after-0'))
    const diff = setup.renderer.root.findDescendantById('git-workspace-diff')!
    const initial = frame()
    for (let i = 0; i < 10; i++) await act(async () => { await setup.mockMouse.scroll(diff.x + 8, diff.y + 4, 'down') })
    await settle()
    assert.notEqual(frame(), initial, 'wheel scrolls the diff')
    await clickId('git-stage-file')
    await until(() => frame().includes('unstaged: src/second.ts'))
    assert.equal(await git(root, ['diff', '--cached', '--name-only']), 'src/first.ts\n')
    await clickText('[t staged/unstaged]')
    await until(() => frame().includes('staged: src/first.ts'))
    await clickId('git-stage-file')
    await until(() => frame().includes('staged: clean'))
    await clickText('[t staged/unstaged]')
    await until(() => frame().includes('unstaged: src/first.ts'))
    await until(() => frame().includes('after-0'))
    await clickText('@@ -1')
    await clickId('git-apply-lines')
    await until(() => frame().includes('unstaged: src/second.ts'))
    assert.equal(await git(root, ['diff', '--cached', '--name-only']), 'src/first.ts\n')
    await clickId('git-stage-all')
    await until(() => frame().includes('unstaged: clean'))
    assert.equal((await git(root, ['diff', '--cached', '--name-only'])).trim().split('\n').length, 2)
    await writeFile(join(root, 'unstaged.txt'), 'unstaged-only-marker\n')
    await clickId('git-refresh')
    await until(() => frame().includes('unstaged-only-marker'))
    await clickText('[c commit]')
    await clickId('git-workspace-message')
    await act(async () => { setup.mockInput.typeText('Mouse commit') }); await settle()
    await clickId('git-save-draft')
    await clickText('[c commit]')
    assert(frame().includes('Mouse commit'), 'draft survives switching focus')
    await clickId('git-review-commit')
    await until(() => frame().includes('[Confirm commit]'))
    assert(frame().includes('Commit · staged preview'), 'review replaces the unstaged file preview')
    assert(frame().includes('after-0'), 'staged preview starts at its first file')
    assert(!frame().includes('unstaged-only-marker'), 'unstaged content is excluded from commit review')
    await clickId('git-edit-message')
    await until(() => frame().includes('[Review staged diff]'))
    await clickId('git-review-commit')
    await until(() => frame().includes('[Confirm commit]'))
    await clickId('git-confirm-commit')
    await until(() => !frame().includes('[Confirm commit]'))
    assert(frame().includes('Commit message'), 'message box stays visible after committing')
    assert.equal((await git(root, ['log', '-1', '--format=%s'])).trim(), 'Mouse commit')
    assert.equal((await git(root, ['status', '--short'])).trim(), '?? unstaged.txt', 'confirmation commits only staged files')
    console.log('Git workspace mouse smoke passed: compose-to-file focus, folder toggles, diff wheel, stage/unstage file, selected hunk, stage all, persistent message box and draft, review/edit/confirm commit.')
  } finally { act(() => setup.renderer.destroy()) }
} finally { await rm(root, { recursive: true, force: true }) }
