import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mutateReview, readReview } from '../lib/review/store'
import { refreshReview } from '../lib/review/refresh'

const exec = promisify(execFile)
const cwd = await mkdtemp(join(tmpdir(), 'review-agent-reload-'))
const reviewDir = join(cwd, '.reviews')
process.env.AGENT_VIEWER_REVIEW_DIR = reviewDir

async function git(...args: string[]) {
  await exec('git', args, { cwd })
}

try {
  await git('init', '-q')
  await git('config', 'user.email', 'review-smoke@example.test')
  await git('config', 'user.name', 'Review smoke')
  await writeFile(join(cwd, 'a.ts'), 'export const value = 1\n')
  await git('add', 'a.ts')
  await git('commit', '-qm', 'baseline')
  await writeFile(join(cwd, 'a.ts'), 'export const value = 2\n')

  const initialPatch = (await exec('git', ['diff', 'HEAD'], { cwd })).stdout
  await mutateReview({ cwd, source: 'working', requestId: 'open-view', publish: { patch: initialPatch, viewId: 'tui-view', surface: 'tui' } })
  const before = await readReview(cwd, 'working')
  await writeFile(join(cwd, 'a.ts'), 'export const value = 3\n')

  const refreshed = await refreshReview({ cwd, source: 'working', viewId: 'tui-view', requestId: 'reload-1' })
  assert.notEqual(refreshed.document.revision, before.document.revision, 'reload fetches the latest Git patch')
  assert.equal(refreshed.views.find(view => view.id === 'tui-view')?.surface, 'tui', 'reload preserves the selected open view')
  assert.equal(refreshed.document.files[0], 'a.ts')
  assert.equal((await refreshReview({ cwd, source: 'working', viewId: 'tui-view', requestId: 'reload-1' })).sequence, refreshed.sequence, 'stable request ID is idempotent')

  await writeFile(join(cwd, 'a.ts'), 'export const value = 4\n')
  const cliEntry = fileURLToPath(new URL('../bin/agent-viewer-review.ts', import.meta.url))
  const cli = await exec('bun', [cliEntry, 'reload', '--source', 'working', '--view-id', 'tui-view', '--request-id', 'reload-cli'], {
    cwd, env: { ...process.env, AGENT_VIEWER_REVIEW_DIR: reviewDir },
  })
  const cliResult = JSON.parse(cli.stdout)
  assert.notEqual(cliResult.document.revision, refreshed.document.revision, 'terminal command refreshes the open view')
  assert.equal(cliResult.views.find((view: { id: string }) => view.id === 'tui-view')?.surface, 'tui')

  await mutateReview({ cwd, source: 'working', requestId: 'close-view', publish: { viewId: 'tui-view', surface: 'tui', close: true } })
  await assert.rejects(() => refreshReview({ cwd, source: 'working', viewId: 'tui-view', requestId: 'reload-closed' }), /closed or no longer active/)
  await assert.rejects(() => refreshReview({ cwd, source: 'pr:42', viewId: 'tui-view', requestId: 'reload-pr' }), /cannot refresh its own patch/)
  console.log('Agent review reload smoke passed: live Git refresh, view identity, retry safety, closed-view and read-only-source guards')
} finally {
  await rm(cwd, { recursive: true, force: true })
}
