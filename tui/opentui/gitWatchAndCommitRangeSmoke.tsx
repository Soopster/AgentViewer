/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { testRender } from '@opentui/react/test-utils'
import { DARK_THEME } from '../theme'
import { GitPopover } from './GitPopover'
import { fetchGitData } from '../../lib/gitProvider'
import { fetchSourceDiff, fetchSourceStatus } from '../../lib/gitDiffSources'
import { fetchGitReviewStream } from '../../lib/review/gitStream'
import { runGitCommand } from '../../lib/gitNodeProvider'

const execFileAsync = promisify(execFile)
const cwd = await mkdtemp(join(tmpdir(), 'agent-viewer-git-watch-range-'))
const reviewDir = await mkdtemp(join(tmpdir(), 'agent-viewer-review-state-'))
process.env.AGENT_VIEWER_REVIEW_DIR = reviewDir
type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
let handleKey: ((key: Key) => void) | null = null
const press = (name: string, sequence = name, shift = false): Key => ({ name, ctrl: false, shift, sequence })

async function flush(setup: Awaited<ReturnType<typeof testRender>>, delay = 250) {
  await act(async () => {
    await setup.flush()
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  })
  await setup.flush()
}

try {
  const git = (...args: string[]) => execFileAsync('git', args, { cwd })
  await git('init', '-q')
  await git('config', 'user.email', 'agent-viewer@example.invalid')
  await git('config', 'user.name', 'Agent Viewer')
  await writeFile(join(cwd, 'tracked.txt'), 'baseline\n')
  await git('add', '.')
  await git('commit', '-qm', 'baseline')
  await writeFile(join(cwd, 'tracked.txt'), 'first commit change\n')
  await git('commit', '-qam', 'first change')
  await writeFile(join(cwd, 'second.txt'), 'second commit change\n')
  await git('add', '.')
  await git('commit', '-qm', 'second change')
  const head = (await git('rev-parse', 'HEAD')).stdout.trim()
  const base = (await git('rev-parse', 'HEAD~2')).stdout.trim()
  const commitRange = { kind: 'commit-range' as const, base, head }
  const rangeData = await fetchGitData(cwd, runGitCommand)
  const rangeStatus = await fetchSourceStatus(cwd, runGitCommand, commitRange)
  const rangePatch = await fetchGitReviewStream(cwd, runGitCommand, commitRange, rangeStatus)
  if (rangeData.commitGraph.length < 3 || !rangePatch.includes('first commit change') || !rangePatch.includes('second commit change')) {
    throw new Error(`Commit graph/range projection omitted commits or changes:\n${rangePatch}`)
  }
  await writeFile(join(cwd, 'tracked.txt'), 'dirty before watch\n')

  const setup = await testRender(
    <GitPopover cwd={cwd} theme={DARK_THEME} width={120} height={40} onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }} />,
    { width: 120, height: 40 },
  )
  try {
    await flush(setup)
    await act(async () => { handleKey?.(press('W', 'W')) })
    await flush(setup)
    await writeFile(join(cwd, 'tracked.txt'), 'changed while watching\n')
    await flush(setup, 4500)
    let frame = setup.captureCharFrame()
    if (!frame.includes('changed while watching')) throw new Error(`Watch mode did not refresh changed file content:\n${frame}`)
    if (!frame.includes('LIVE')) throw new Error(`Watch mode indicator is missing:\n${frame}`)

    await act(async () => { handleKey?.(press('4', '4')) })
    await flush(setup)
    await act(async () => { handleKey?.(press('v')) })
    await flush(setup)
    await act(async () => { handleKey?.(press('j')) })
    await flush(setup)
    await act(async () => { handleKey?.(press('return', '\r')) })
    await flush(setup, 700)
    frame = setup.captureCharFrame()
    if (!frame.includes('Commit range')) throw new Error(`Selected commit range was not opened as the review source:\n${frame}`)
    if (!frame.includes('second.txt') || !frame.includes('tracked.txt')) throw new Error(`Commit range should list files from both selected commits:\n${frame}`)
  } finally {
    await act(async () => { handleKey?.(press('W', 'W')); await setup.flush() })
    setup.renderer.destroy()
  }
  console.log('Git watch refresh and contiguous commit-range review smoke passed')
} finally {
  await rm(cwd, { recursive: true, force: true })
  await rm(reviewDir, { recursive: true, force: true })
}
