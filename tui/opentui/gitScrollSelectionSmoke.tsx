/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import type { ScrollBoxRenderable } from '@opentui/core'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { git } from '../../lib/git/command'
import { GitReviewPopover, type GitKeyEvent } from '../../plugins/git/tui/GitPopover'
import { buildPierreDiffView } from './pierreDiffView'
import { testRender, act } from './testRender'
import { diffTextHeight } from './gitDiffText'
import { DARK_THEME } from '../theme'
const cwd = await mkdtemp(join(tmpdir(), 'git-scroll-selection-'))
const previousReviewDirectory = process.env.AGENT_VIEWER_REVIEW_DIR
process.env.AGENT_VIEWER_REVIEW_DIR = join(cwd, '.git', 'review-store')
let handler: (key: GitKeyEvent) => boolean | void = () => false
const paths = ['a/first.ts', ...Array.from({ length: 50 }, (_, index) => `files/file${String(index).padStart(2, '0')}.ts`), 'nested/deep/current.ts', 'z/end.ts']
const contents = (path: string, version: string) => Array.from({ length: path.startsWith('files/') ? 2 : 160 }, (_, index) => `${version}-${index} ${"long-".repeat(40)}`).join('\n') + '\n'
try {
  await git(cwd, ['init', '-q'])
  for (const path of paths) { await mkdir(dirname(join(cwd, path)), { recursive: true }); await writeFile(join(cwd, path), contents(path, 'before')) }
  await git(cwd, ['add', '.']); await git(cwd, ['-c', 'user.name=Scroll Fixture', '-c', 'user.email=scroll@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Baseline'])
  for (const path of paths) await writeFile(join(cwd, path), contents(path, 'after'))
  const view = buildPierreDiffView(await git(cwd, ['diff', 'HEAD']), 'scroll-test', null, 'dark', false, true)!
  const setup = await testRender(<GitReviewPopover embedded docked cwd={cwd} width={120} height={40} theme={DARK_THEME} onClose={() => {}} onKeyHandlerReady={next => { handler = next }} />, { width: 120, height: 40 })
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); await setup.flush() }); await setup.flush() }
  const selected = (name: string) => setup.captureCharFrame().split('\n').some(line => { const left = line.slice(0, 38); return left.includes(name) && left.includes('▎') })
  const until = async (predicate: () => boolean, message: string) => { for (let i = 0; i < 25 && !predicate(); i++) await settle(); assert(predicate(), `${message}\n${setup.captureCharFrame()}`) }
  const press = async (name: string) => { await act(async () => { handler({ name, sequence: name, ctrl: false, shift: false }) }); await settle() }
  try {
    await until(() => (setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable | null)?.scrollHeight! > 1000, 'full comparison is loaded')
    await until(() => selected('first.ts'), 'first file starts selected')
    const scroll = setup.renderer.root.findDescendantById('git-diff-scroll') as ScrollBoxRenderable
    const tree = setup.renderer.root.findDescendantById('git-review-files') as ScrollBoxRenderable
    const middle = view.rows.findIndex(row => row.tone === 'file' && row.filePath === 'nested/deep/current.ts')
    assert(middle >= 0, JSON.stringify(view.rows.filter(row => row.tone === 'file').map(row => row.filePath)))
    await act(async () => { scroll.scrollTo(middle + 12) }); await settle()
    await until(() => selected('current.ts'), 'scrolling updates the selected file')
    assert.equal(scroll.scrollTop, middle + 12, 'passive selection never jumps the diff back to its file header')
    assert(tree.scrollTop > 0, 'file tree reveals the selected row')
    assert(setup.captureCharFrame().includes('52/53'), 'file count matches the visible diff file')
    const directoryRow = setup.captureCharFrame().split('\n').findIndex(line => line.slice(0, 38).includes('nested/deep'))
    assert(directoryRow >= 0)
    await act(async () => { await setup.mockMouse.click(6, directoryRow) }); await settle()
    assert(!selected('current.ts'), 'user can collapse the current directory without being forced open immediately')
    const end = view.rows.findIndex(row => row.tone === 'file' && row.filePath === 'z/end.ts')
    await act(async () => { scroll.scrollTo(end + 12) }); await settle(); await until(() => selected('end.ts'), 'forward scroll follows the last file')
    await act(async () => { scroll.scrollTo(middle + 12) }); await settle(); await until(() => selected('current.ts'), 'returning to a collapsed file reveals it')
    await act(async () => { scroll.scrollTo(middle - 2) }); await settle()
    await act(async () => { await setup.mockMouse.scroll(scroll.x + 5, scroll.y + 5, 'down') }); await settle()
    await until(() => selected('current.ts'), 'mouse wheel crossing a file boundary updates selection')
    await act(async () => { tree.scrollTo(0) }); await settle()
    const firstRow = setup.captureCharFrame().split('\n').findIndex(line => line.slice(0, 38).includes('first.ts'))
    await act(async () => { await setup.mockMouse.click(8, firstRow) }); await settle()
    await until(() => selected('first.ts') && scroll.scrollTop < 5, 'explicit tree clicks still jump into the diff')
    await press('s')
    const splitEnd = view.splitRows.findIndex(row => row.tone === 'file' && row.filePath === 'z/end.ts')
    await act(async () => { scroll.scrollTo(splitEnd + 12) }); await settle(); await until(() => selected('end.ts'), 'split diffs follow the viewport too')
    assert.equal(scroll.scrollTop, splitEnd + 12, 'split follow does not reset reading position')
    await press('v')
    const raw = (await git(cwd, ['diff', 'HEAD'])).split('\n')
    const plainMiddle = raw.findIndex(line => line.startsWith('diff --git ') && line.includes('nested/deep/current.ts'))
    await act(async () => { scroll.scrollTo(plainMiddle + 12) }); await settle(); await until(() => selected('current.ts'), 'plain diff scroll follows the selected file')
    assert.equal(scroll.scrollTop, plainMiddle + 12, 'plain follow leaves the scroll offset unchanged')
    assert(setup.captureCharFrame().includes('52/53'), 'plain view file counter matches the viewport')
    await act(async () => { tree.scrollTo(0) }); await settle()
    const plainFirst = setup.captureCharFrame().split('\n').findIndex(line => line.slice(0, 38).includes('first.ts'))
    await act(async () => { await setup.mockMouse.click(8, plainFirst) }); await settle()
    await until(() => selected('first.ts') && scroll.scrollTop < 5, 'plain view tree clicks jump to the raw patch header')
    await act(async () => { scroll.scrollTo(plainMiddle - 1) }); await settle()
    await act(async () => { await setup.mockMouse.scroll(scroll.x + 5, scroll.y + 5, 'down') }); await settle(); await until(() => selected('current.ts'), 'plain wheel scrolling follows file boundaries')
    await press('z')
    const wrappedMiddle = raw.slice(0, plainMiddle + 12).reduce((height, line) => height + diffTextHeight(line, scroll.width - 1, 4, true), 0)
    await act(async () => { scroll.scrollTo(wrappedMiddle) }); await settle(); await until(() => selected('current.ts'), 'wrapped plain view follows terminal row geometry')
    assert.equal(scroll.scrollTop, wrappedMiddle, 'wrapped plain view never jumps back to the file header')
    await press('v'); await until(() => selected('end.ts'), 'returning to parsed view restores its reading position and selection')
    console.log('Git scroll selection passed: viewport-driven highlights/counts, tree reveal, collapsed directories, wheel scrolling, click-to-jump split layout, and plain view without scroll feedback.')
  } finally { act(() => setup.renderer.destroy()) }
} finally {
  if (previousReviewDirectory === undefined) delete process.env.AGENT_VIEWER_REVIEW_DIR; else process.env.AGENT_VIEWER_REVIEW_DIR = previousReviewDirectory
  await rm(cwd, { recursive: true, force: true })
}
