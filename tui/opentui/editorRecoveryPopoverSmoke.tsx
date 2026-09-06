/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover, type EditorKeyEvent } from './EditorPopover'
import { readEditorRecovery, writeEditorRecovery } from './editorRecovery'

const root = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-recovery-ui-'))
const safePath = join(root, 'safe.ts')
const conflictPath = join(root, 'conflict.ts')
let handleKey: ((key: EditorKeyEvent) => boolean) | null = null
const closeState: { count: number } = { count: 0 }

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex(DARK_THEME.violet), bold: true },
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

async function flush(setup: Awaited<ReturnType<typeof testRender>>, delay = 200) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, delay))
    await setup.flush()
  })
}

try {
  await writeFile(safePath, 'const safe = 1\n', 'utf8')
  await writeFile(conflictPath, 'const conflict = 1\n', 'utf8')
  await writeEditorRecovery(root, {
    version: 1,
    savedAt: Date.now(),
    activePath: 'safe.ts',
    cursor: { line: 0, character: 12 },
    buffers: [
      { path: 'safe.ts', savedContent: 'const safe = 1\n', content: 'const safe = 2\n' },
      { path: 'conflict.ts', savedContent: 'const conflict = 1\n', content: 'const conflict = 2\n' },
    ],
  })
  await writeFile(conflictPath, 'const conflict = 3\n', 'utf8')

  const setup = await testRender(
    <EditorPopover
      cwd={root}
      initialPath={null}
      theme={DARK_THEME}
      width={100}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => { closeState.count += 1 }}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 100, height: 30 },
  )

  try {
    await flush(setup, 450)
    const conflictFrame = setup.captureCharFrame()
    if (!conflictFrame.includes('Recovery conflicts 1/1') || !conflictFrame.includes('conflict.ts')) {
      throw new Error(`Recovery conflict was not gated behind an explicit picker:\n${conflictFrame}`)
    }

    act(() => { handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
    await flush(setup)
    const editor = setup.renderer.root.findDescendantById('project-editor-textarea') as TextareaRenderable | null
    if (editor?.plainText !== 'const safe = 2\n') {
      throw new Error(`Safe recovery buffer was not restored: ${JSON.stringify(editor?.plainText)}`)
    }
    if (editor.logicalCursor.row !== 0 || editor.logicalCursor.col !== 12) {
      throw new Error(`Recovery cursor was not restored: ${JSON.stringify(editor.logicalCursor)}`)
    }
    if (!setup.captureCharFrame().includes('safe.ts')) throw new Error('Recovered file was not activated')

    const retained = await readEditorRecovery(root)
    if (retained.snapshot?.buffers[0]?.content !== 'const safe = 2\n' || retained.conflicts[0]?.path !== 'conflict.ts') {
      throw new Error(`Recovery autosave did not retain safe and conflicted buffers: ${JSON.stringify(retained)}`)
    }

    act(() => { handleKey?.({ name: 'q', ctrl: true, shift: false, sequence: '\u0011' }) })
    await flush(setup)
    const confirmFrame = setup.captureCharFrame()
    if (closeState.count !== 0 || !confirmFrame.includes('modified file')) {
      throw new Error(`First Ctrl+Q did not require confirmation for a recovered dirty buffer: ${closeState.count}\n${confirmFrame}`)
    }
    act(() => { handleKey?.({ name: 'q', ctrl: true, shift: false, sequence: '\u0011' }) })
    await flush(setup)
    if (Number(closeState.count) !== 1) throw new Error(`Confirmed recovery discard did not close exactly once: ${closeState.count}`)
    const cleared = await readEditorRecovery(root)
    if (cleared.snapshot || cleared.conflicts.length) throw new Error('Confirmed recovery discard did not clear the snapshot')

    console.log('Editor recovery UI restore/conflict/cursor/discard smoke passed')
  } finally {
    act(() => setup.renderer.destroy())
  }
} finally {
  syntaxStyle.destroy()
  await rm(root, { recursive: true, force: true })
}
