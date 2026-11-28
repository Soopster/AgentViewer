import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-result-diff-'))
process.chdir(cwd)
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
git('init', '-q'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.test')
writeFileSync('.gitignore', '.agent-viewer-data/\n.agent-viewer-worktrees/\n')
writeFileSync('file.txt', 'base\n'); git('add', '.'); git('commit', '-qm', 'fixture')
const coord = await import('../lib/agentCoordination')
const { createWorktreeTask } = await import('../lib/worktreeTasks')
const { readExternalCoordinatorResultReview: read, readExternalCoordinatorResultDiff: page } = await import('../lib/coordinatorResultReviewServer')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Large paged review', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
try {
  const tree = await createWorktreeTask(cwd, 'paged-review')
  const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd: tree.path, participantName: 'worker' })).participant
  const task = (await coord.createExternalProtocolTask(lead, { assignTo: worker.agentId, title: 'Large file', detail: 'Inspect all changes', paths: ['file.txt'], verifyCommands: ['git diff --check'] })).task!
  writeFileSync(path.join(tree.path, 'file.txt'), Array.from({ length: 2000 }, (_, index) => `line-${index}: ${'x'.repeat(120)}\n`).join(''))
  assert.equal((await coord.completeExternalProtocolTask(worker, { taskId: task.id, summary: 'Large result verified' })).accepted, true)
  const overview = await read(lead, task.id)
  const preview = await read(lead, task.id, true)
  assert.equal(overview.checkout!.diffIncluded, false)
  assert.equal(preview.checkout!.diffTruncated, true, 'the legacy preview cannot include this whole diff')
  assert.equal(overview.checkout!.token, preview.checkout!.token)
  const token = overview.checkout!.token
  let offset = 0
  let combined = ''
  let count = 0
  for (;;) {
    const result = await page(lead, { taskId: task.id, reviewToken: token, file: 'file.txt', offset, limit: 16000 })
    assert.ok(result.diff.length <= 16000)
    assert.equal(result.offset, offset)
    combined += result.diff; count++
    if (!result.hasMore) { assert.equal(result.nextOffset, null); break }
    assert.equal(result.nextOffset, offset + result.diff.length)
    offset = result.nextOffset!
  }
  const expected = execFileSync('git', ['--literal-pathspecs', 'diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', overview.checkout!.base, '--', 'file.txt'], { cwd: tree.path, encoding: 'utf8' })
  assert.equal(combined, expected, 'pages reconstruct the complete Git diff beyond the old cap')
  assert.match(combined, /line-1999/)
  await assert.rejects(page(worker, { taskId: task.id, reviewToken: token }), /Only the Coordinator lead/)
  await assert.rejects(page(lead, { taskId: task.id, reviewToken: token, limit: 16001 }), /limit/)
  writeFileSync(path.join(tree.path, 'file.txt'), 'source changed\n')
  await assert.rejects(page(lead, { taskId: task.id, reviewToken: token, offset: 16000 }), /changed since review/)
  console.log(`Paged result diff passed: ${combined.length} characters across ${count} complete pages; legacy preview=${JSON.stringify(preview).length}, overview=${JSON.stringify(overview).length} response chars. Role, limit and stale-pin guards retained.`)
} finally { await coord.stopProtocolRun(lead.runId) }
process.exit(0)
