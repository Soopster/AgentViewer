/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { GitPopover } from './GitPopover'

const execFileAsync = promisify(execFile)
const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-git-popover-'))
let handleKey: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null

function modifiedFileRows(frame: string): string[] {
  return frame.split('\n').filter((line) => line.includes('M GitPopover.tsx'))
}

async function flushEffects(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
  await setup.flush()
}

try {
  await mkdir(join(cwd, 'tui', 'opentui'), { recursive: true })
  const filePath = join(cwd, 'tui', 'opentui', 'GitPopover.tsx')
  await writeFile(filePath, 'before\n')
  await execFileAsync('git', ['init', '-q'], { cwd })
  await execFileAsync('git', ['add', '.'], { cwd })
  await execFileAsync('git', ['-c', 'user.name=Agent Viewer', '-c', 'user.email=agent-viewer@example.invalid', 'commit', '-qm', 'baseline'], { cwd })
  await writeFile(filePath, 'after\n')

  const setup = await testRender(
    <GitPopover
      cwd={cwd}
      theme={DARK_THEME}
      width={120}
      height={40}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 120, height: 40 },
  )

  try {
    await flushEffects(setup)
    let frame = setup.captureCharFrame()
    if (modifiedFileRows(frame).length !== 1) {
      throw new Error(`Expected one modified file row on initial render:\n${frame}`)
    }

    // Clicking the flattened directory row toggles it just like h/l.
    await act(async () => { await setup.mockMouse.click(8, 8) })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    if (modifiedFileRows(frame).length !== 0) {
      throw new Error(`Expected mouse click to collapse the file tree:\n${frame}`)
    }
    await act(async () => { await setup.mockMouse.click(8, 8) })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    if (modifiedFileRows(frame).length !== 1) {
      throw new Error(`Expected mouse click to re-expand the file tree:\n${frame}`)
    }

    await act(async () => {
      handleKey?.({ name: 'h', ctrl: false, shift: false, sequence: 'h' })
    })
    await flushEffects(setup)
    await act(async () => {
      handleKey?.({ name: 'h', ctrl: false, shift: false, sequence: 'h' })
    })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    if (modifiedFileRows(frame).length !== 0) {
      throw new Error(`Expected no file row after collapse:\n${frame}`)
    }

    await act(async () => {
      handleKey?.({ name: 'l', ctrl: false, shift: false, sequence: 'l' })
    })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    if (modifiedFileRows(frame).length !== 1) {
      throw new Error(`Expected one modified file row after re-expand:\n${frame}`)
    }

    console.log('Git popover expand/collapse smoke passed')
  } finally {
    act(() => {
      setup.renderer.destroy()
    })
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
