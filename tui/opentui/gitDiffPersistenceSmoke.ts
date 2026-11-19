import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const originalCwd = process.cwd()
const cwd = await mkdtemp(path.join(tmpdir(), 'git-diff-state-'))
process.chdir(cwd)
try {
  const state = await import('../../lib/tuiDiffReviewState')
  const key = state.tuiDiffReviewStorageKey(cwd, 'working')
  const snapshot = {
    preferences: { layoutMode: 'split' as const, wrap: true, tabWidth: 8 as const, horizontalOffset: 12, showLineNumbers: false, showHunkHeaders: true },
    notes: [{ filePath: 'src/a.ts', range: { start: 4, side: 'additions' as const, end: 5, endSide: 'additions' as const }, text: 'Check this branch' }],
  }
  state.writeTuiDiffReviewState(key, snapshot)
  assert.deepEqual(state.readTuiDiffReviewState(key), snapshot)
  const stored = JSON.parse(await readFile(path.join(cwd, '.agent-viewer-data', 'diff-review-v1.json'), 'utf8'))
  assert.equal(stored[key].version, 1)
  assert.equal(state.readTuiDiffReviewState('missing').preferences.layoutMode, 'auto')
  state.writeTuiDiffReviewState(key, { ...snapshot, notes: [] })
  assert.deepEqual(state.readTuiDiffReviewState(key).notes, [])
  console.log('Git diff persistence smoke passed: scoped preferences, notes, validation, atomic store')
} finally {
  process.chdir(originalCwd)
  await rm(cwd, { recursive: true, force: true })
}
