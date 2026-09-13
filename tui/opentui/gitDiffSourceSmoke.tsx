/** @jsxImportSource @opentui/react */
// The diff-source picker is the one part of the git panel that can look
// perfectly correct and be showing the wrong change set: every source renders
// the same file tree and the same patch, so only the *content* distinguishes
// "the working tree" from "what turn 1 did". This drives the real popover
// against a repo with real checkpoints and asserts which files each source
// answers with.
import React, { act } from 'react'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { GitPopover } from './GitPopover'
import { createTurnCheckpoint } from '../../lib/checkpoints'

const execFileAsync = promisify(execFile)
const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-git-source-'))
const SESSION = 'session-under-test'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
let handleKey: ((key: Key) => void) | null = null

function press(name: string, sequence = name): Key {
  return { name, ctrl: false, shift: false, sequence }
}

async function flushEffects(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, 300))
  })
  await setup.flush()
}

function hasFile(frame: string, name: string): boolean {
  return frame.split('\n').some((line) => line.includes(name))
}

try {
  const git = (...args: string[]) => execFileAsync('git', args, { cwd })
  await git('init', '-q')
  await git('config', 'user.email', 'agent-viewer@example.invalid')
  await git('config', 'user.name', 'Agent Viewer')
  await writeFile(join(cwd, 'baseline.txt'), 'baseline\n')
  await git('add', '.')
  await git('commit', '-qm', 'baseline')

  // Two turns, each snapshotted before its own edit — the shape the picker
  // exists to read back.
  const first = await createTurnCheckpoint(cwd, { sessionId: SESSION, provider: 'claude', message: 'Add alpha' })
  await writeFile(join(cwd, 'alpha.txt'), 'alpha\n')
  const second = await createTurnCheckpoint(cwd, { sessionId: SESSION, provider: 'claude', message: 'Add beta' })
  await writeFile(join(cwd, 'beta.txt'), 'beta\n')
  if (!first || !second) throw new Error('checkpoints were not created')

  const setup = await testRender(
    <GitPopover
      cwd={cwd}
      sessionId={SESSION}
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
    if (!hasFile(frame, 'alpha.txt') || !hasFile(frame, 'beta.txt')) {
      throw new Error(`Working tree should list both new files:\n${frame}`)
    }

    await act(async () => { handleKey?.(press('t')) })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    for (const expected of ['Diff source', 'Working tree', 'Branch changes', 'Latest turn', 'Turn 1', 'Turn 2', 'Add alpha']) {
      if (!frame.includes(expected)) throw new Error(`Picker is missing ${expected}:\n${frame}`)
    }

    // Head items, then turns newest first: Working, Branch, Latest, Turn 2, Turn 1.
    await act(async () => {
      for (let i = 0; i < 4; i += 1) handleKey?.(press('down', 'j'))
      handleKey?.(press('return', '\r'))
    })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    if (!frame.includes('◇ Turn 1')) throw new Error(`Status pane should name the picked source:\n${frame}`)
    if (!hasFile(frame, 'alpha.txt')) throw new Error(`Turn 1 added alpha.txt:\n${frame}`)
    if (hasFile(frame, 'beta.txt')) {
      throw new Error(`Turn 1 must end at turn 2's checkpoint, not the working tree:\n${frame}`)
    }

    // Latest turn is the newest checkpoint against the tree as it stands.
    await act(async () => {
      handleKey?.(press('t'))
      handleKey?.(press('up', 'k'))
      handleKey?.(press('up', 'k'))
      handleKey?.(press('return', '\r'))
    })
    await flushEffects(setup)
    frame = setup.captureCharFrame()
    if (!frame.includes('◇ Latest turn')) throw new Error(`Expected the latest-turn source:\n${frame}`)
    if (!hasFile(frame, 'beta.txt') || hasFile(frame, 'alpha.txt')) {
      throw new Error(`Latest turn should be beta.txt alone:\n${frame}`)
    }

    console.log('Git diff-source picker smoke passed')
  } finally {
    act(() => { setup.renderer.destroy() })
  }

  // A session with no checkpoints of its own falls back to the repo's turns and
  // says so, rather than offering an empty menu.
  const other = await testRender(
    <GitPopover
      cwd={cwd}
      sessionId="a-different-session"
      theme={DARK_THEME}
      width={120}
      height={40}
      onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
    />,
    { width: 120, height: 40 },
  )
  try {
    await flushEffects(other)
    await act(async () => { handleKey?.(press('t')) })
    await flushEffects(other)
    const frame = other.captureCharFrame()
    if (!frame.includes('showing all')) throw new Error(`Expected the unscoped-fallback notice:\n${frame}`)
    if (!frame.includes('Turn 1')) throw new Error(`Fallback should still offer the repo's turns:\n${frame}`)
    console.log('Git diff-source session-scope fallback smoke passed')
  } finally {
    act(() => { other.renderer.destroy() })
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
