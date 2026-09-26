/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { readEditorRecovery } from './editorRecovery'

const root = await mkdtemp(join(tmpdir(), 'editor-save-recovery-'))
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(DARK_THEME.text) } })
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
try {
  await writeFile(join(root, 'file.txt'), 'original\n')
  const setup = await testRender(<EditorPopover cwd={root} initialPath="file.txt" theme={DARK_THEME}
    width={100} height={30} syntaxStyle={syntaxStyle} onClose={() => {}}
    onKeyHandlerReady={(handler) => { handleKey = handler }} />, { width: 100, height: 30 })
  const settle = async () => {
    for (let i = 0; i < 12; i++) await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }
  try {
    await settle()
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable
    assert.ok(editor)
    for (const shift of [false, true]) {
      act(() => { editor.setText(`save-${shift}\n`) })
      await settle()
      act(() => {
        handleKey?.({ name: 's', ctrl: true, shift, sequence: '\u0013' })
        editor.setText(`newer-${shift}\n`)
      })
      await settle()
      assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), `save-${shift}\n`)
      const recovery = await readEditorRecovery(root)
      assert.equal(recovery.snapshot?.buffers[0]?.content, `newer-${shift}\n`)
      assert.equal(recovery.snapshot?.buffers[0]?.savedContent, `save-${shift}\n`)
      assert.equal(recovery.conflicts.length, 0)
    }
    act(() => { handleKey?.({ name: 's', ctrl: true, shift: false, sequence: '\u0013' }) })
    await settle()
    assert.equal((await readEditorRecovery(root)).snapshot, null)
    console.log('Editor save/save-all preserve in-flight edits in recovery and clear clean recovery smoke passed')
  } finally { act(() => setup.renderer.destroy()) }
} finally {
  syntaxStyle.destroy()
  await rm(root, { recursive: true, force: true })
}
