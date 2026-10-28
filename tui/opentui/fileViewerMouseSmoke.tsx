/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BoxRenderable, ScrollBoxRenderable } from '@opentui/core'
import { testRenderWithSyntaxStyle, act } from './testRender'
import { DARK_THEME } from '../theme'
import { FileViewerPopover } from '../../plugins/files/tui/FileViewerPopover'
const root = await mkdtemp(join(tmpdir(), 'files-mouse-'))
const fixture = join(root, 'workspace')
await mkdir(fixture)
await mkdir(join(root, 'sibling'))
await writeFile(join(root, 'sibling', 'sibling.txt'), 'SIBLING')
await mkdir(join(fixture, 'a-dir'))
await writeFile(join(fixture, 'a-dir', 'inside.txt'), 'INSIDE_PREVIEW')
await writeFile(join(fixture, 'b.txt'), 'CLICKED_FILE_PREVIEW\n' + Array.from({ length: 120 }, (_, index) => `preview line ${index}`).join('\n'))
await writeFile(join(fixture, '.hidden.txt'), 'hidden')
for (let index = 0; index < 40; index++) await writeFile(join(fixture, `z${String(index).padStart(2, '0')}.txt`), `file ${index}`)
try {
  for (const [width, docked] of [[120, false], [120, true], [52, true]] as const) {
    const edited: string[] = []
    const setup = await testRenderWithSyntaxStyle({}, style => <FileViewerPopover cwd={fixture} docked={docked} width={width} height={26} theme={DARK_THEME} syntaxStyle={style} velocityScrollEnabled={false} onToggleVelocityScroll={() => {}} onClose={() => {}} onKeyHandlerReady={() => {}} onEditPath={path => { edited.push(path) }} />, { width, height: 26 })
    const node = (id: string) => setup.renderer.root.findDescendantById(id) as BoxRenderable | undefined
    const settle = async (check: () => boolean, label: string) => {
      for (let i = 0; i < 100; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); await setup.flush() })
        if (check()) return
      }
      assert.fail(`${label}\n${setup.captureCharFrame()}`)
    }
    const click = async (id: string) => {
      const target = node(id)
      assert.ok(target, id)
      await act(async () => { await setup.mockMouse.click(target.x + 1, target.y) })
    }
    try {
      await settle(() => !!node('files-entry:b.txt'), 'listing loads')
      await click('files-entry:b.txt')
      await settle(() => setup.captureCharFrame().includes('CLICKED_FILE_PREVIEW'), 'single click previews file')
      assert.equal(edited.length, 0, 'single click does not edit')
      const preview = node('files-preview-scroll') as ScrollBoxRenderable
      await act(async () => { await setup.mockMouse.scroll(preview.x + 4, preview.y + 3, 'down') })
      assert.ok(preview.scrollTop > 0, 'wheel scrolls file preview')
      const closeControl = node('files-action:close')!
      assert.ok(closeControl.x + closeControl.width <= width, 'mouse toolbar stays inside narrow and wide windows')
      await click('files-entry:a-dir')
      await click('files-entry:a-dir')
      await settle(() => !!node('files-entry:inside.txt'), 'double click opens folder')
      await click('files-action:parent')
      await settle(() => !!node('files-entry:b.txt'), 'parent button navigates up')
      await settle(() => !!node('files-preview-entry:inside.txt'), 'parent navigation restores selected directory')
      await click('files-preview-entry:inside.txt')
      await settle(() => setup.captureCharFrame().includes('INSIDE_PREVIEW'), 'directory preview entry navigates and selects')
      await click('files-action:parent')
      await settle(() => !!node('files-entry:b.txt'), 'return to fixture')
      if (width === 120) {
        await settle(() => !!node('files-parent:sibling'), 'parent entries load')
        await click('files-parent:sibling')
        await settle(() => !!node('files-entry:sibling.txt'), 'parent column supports mouse navigation')
        await click('files-action:parent')
        await settle(() => !!node('files-entry:workspace'), 'parent directory loads')
        await click('files-entry:workspace')
        await click('files-entry:workspace')
        await settle(() => !!node('files-entry:b.txt'), 'return from parent column')
      }
      await click('files-action:hidden')
      await settle(() => !!node('files-entry:.hidden.txt'), 'mouse hidden toggle')
      const list = node('files-list-scroll') as ScrollBoxRenderable
      await act(async () => { await setup.mockMouse.scroll(list.x + 4, list.y + 3, 'down') })
      assert.ok(list.scrollTop > 0, 'wheel scrolls file list')
      await act(async () => { list.scrollTo(0) })
      await click('files-entry:b.txt')
      await click('files-action:open')
      assert.deepEqual(edited, [join(fixture, 'b.txt')], 'mouse open uses editor service')
    } finally { await act(async () => setup.renderer.destroy()) }
  }
  const chosen: string[] = []
  const picker = await testRenderWithSyntaxStyle({}, style => <FileViewerPopover cwd={fixture} docked width={60} height={24} theme={DARK_THEME} syntaxStyle={style} velocityScrollEnabled={false} onToggleVelocityScroll={() => {}} onClose={() => {}} onKeyHandlerReady={() => {}} onSelectDirectory={path => chosen.push(path)} />, { width: 60, height: 24 })
  try {
    const wait = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); await picker.flush() })
        const target = picker.renderer.root.findDescendantById(id)
        if (target) return target
      }
      assert.fail(`Missing picker target ${id}`)
    }
    const file = await wait('files-entry:b.txt')
    await act(async () => { await picker.mockMouse.click(file.x + 2, file.y) })
    const choose = await wait('files-action:open')
    await act(async () => { await picker.mockMouse.click(choose.x + 1, choose.y) })
    assert.deepEqual(chosen, [], 'folder picker cannot choose a file')
    const folder = await wait('files-entry:a-dir')
    await act(async () => { await picker.mockMouse.click(folder.x + 2, folder.y) })
    await act(async () => { await picker.mockMouse.click(choose.x + 1, choose.y) })
    assert.deepEqual(chosen, [join(fixture, 'a-dir')], 'mouse chooses selected folder explicitly')
  } finally { await act(async () => picker.renderer.destroy()) }
  console.log('Files mouse passed: click previews, double-click folder, parent/preview navigation, hidden toggle, wheel scrolling, editor open; overlay and wide/narrow dock')
} finally { await rm(root, { recursive: true, force: true }) }
process.exit(0)
