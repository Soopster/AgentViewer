/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA, SyntaxStyle } from '@opentui/core'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { EditorPopover } from './EditorPopover'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'

registerExtraTreeSitterParsers()

// Clicking a buffer tab must select it. Clicking the `×` on that tab must close
// it. These are one row apart in the layout and a hit-test that resolves the
// whole tab to its close glyph makes the tab bar actively hostile: every
// attempt to switch buffers throws one away instead.

const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-tab-mouse-'))
const firstPath = join(cwd, 'first.ts')
const secondPath = join(cwd, 'second.ts')

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex(DARK_THEME.text) },
})

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

try {
  await writeFile(firstPath, 'export const first = 1\n', 'utf8')
  await writeFile(secondPath, 'export const second = 2\n', 'utf8')
  // The editor must not try to reach a language server here: it has nothing to
  // do with the tab bar and would only add seconds of startup.
  process.env.AGENT_VIEWER_LSP_IDLE_MS = '0'

  const setup = await testRender(
    <EditorPopover
      cwd={cwd}
      initialPath={firstPath}
      theme={DARK_THEME}
      width={110}
      height={30}
      syntaxStyle={syntaxStyle}
      onClose={() => {}}
      onKeyHandlerReady={() => {}}
      onNotice={() => {}}
      onClipboardRead={async () => ''}
      onClipboardWrite={async () => {}}
    />,
    { width: 110, height: 30 },
  )

  const settle = async (ms = 300) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
    await act(async () => { await setup.flush() })
  }

  const locate = (needle: string): { x: number; y: number } => {
    const frame = setup.captureCharFrame()
    const lines = frame.split('\n')
    for (let y = 0; y < lines.length; y += 1) {
      const x = lines[y]!.indexOf(needle)
      if (x !== -1) return { x, y }
    }
    throw new Error(`Could not locate "${needle}" in the frame:\n${frame}`)
  }

  try {
    await settle(1_500)
    await settle(1_500)
    assert(setup.captureCharFrame().includes('first.ts'),
      `The initial buffer did not open:\n${setup.captureCharFrame()}`)

    // The tab bar is the first row; its own label is what we click, never the
    // `×` that sits after it.
    const tabRow = locate('first.ts').y
    const label = locate('first.ts')
    await act(async () => { await setup.mockMouse.click(label.x + 2, tabRow) })
    await settle(300)

    const afterLabelClick = setup.captureCharFrame().split('\n')[tabRow]!
    assert(afterLabelClick.includes('first.ts'),
      `Clicking a tab's label closed the tab instead of selecting it: ${JSON.stringify(afterLabelClick)}`)
    assert(!afterLabelClick.includes('No buffers'),
      `Clicking a tab's label closed the last buffer: ${JSON.stringify(afterLabelClick)}`)

    // Every column of the label must select rather than close, so a click that
    // lands one cell off does not destroy work.
    for (const offset of [0, 1, 3, 'first.ts'.length - 1]) {
      await act(async () => { await setup.mockMouse.click(label.x + Number(offset), tabRow) })
      await settle(200)
      const row = setup.captureCharFrame().split('\n')[tabRow]!
      assert(row.includes('first.ts'), `Clicking column ${offset} of the tab label closed it: ${JSON.stringify(row)}`)
    }

    // And the close glyph must still close.
    const closeGlyph = setup.captureCharFrame().split('\n')[tabRow]!.indexOf('×')
    assert(closeGlyph !== -1, 'The tab bar has no close control')
    await act(async () => { await setup.mockMouse.click(closeGlyph, tabRow) })
    await settle(300)
    // The explorer lists the filename too, so only the tab row itself answers
    // whether the buffer closed.
    const afterCloseRow = setup.captureCharFrame().split('\n')[tabRow]!
    assert(!afterCloseRow.includes('first.ts') && afterCloseRow.includes('No buffers'),
      `Clicking the tab's × did not close it: ${JSON.stringify(afterCloseRow)}`)

    console.log('Editor tab mouse smoke passed (label selects, × closes)')
  } finally {
    setup.renderer?.destroy?.()
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
