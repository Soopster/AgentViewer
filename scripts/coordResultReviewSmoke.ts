import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-result-review-'))
process.chdir(cwd)
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
git('init', '-q'); git('config', 'user.name', 'Smoke'); git('config', 'user.email', 'smoke@example.test')
writeFileSync('.gitignore', '.agent-viewer-data/\n.agent-viewer-worktrees/\n')
writeFileSync('file.txt', 'before\n'); git('add', '.'); git('commit', '-qm', 'baseline')
const coord = await import('../lib/agentCoordination')
const { createWorktreeTask } = await import('../lib/worktreeTasks')
const { readCoordinatorResultReview: read, integrateCoordinatorResult: integrate } = await import('../lib/coordinatorResultReviewServer')
const { resultVerification, coordinatorResultLines } = await import('../lib/coordinatorResultReview')
const { coordinatorCheckoutRevision } = await import('../lib/coordinatorResultGit')
const sessionId = 'result-review-lead'
await coord.configureInteractiveCoordinator({ sessionId, provider: 'codex', cwd })
const lead = await coord.sessionCoordinatorIdentity(sessionId, 'codex')
try {
  const worktree = await createWorktreeTask(cwd, 'review-result')
  const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', participantName: 'reviewer', cwd: worktree.path })).participant
  const delegated = await coord.createExternalProtocolTask(lead, { assignTo: worker.agentId, title: 'Change file', detail: 'Change and verify file', paths: ['**'], verifyCommands: ['git diff --check'] })
  const taskId = delegated.task!.id
  await coord.reportExternalProtocolProgress(worker, { status: 'working', taskId })
  writeFileSync(path.join(worktree.path, 'file.txt'), 'after\n')
  writeFileSync(path.join(worktree.path, 'new file.txt'), 'untracked\n')
  await coord.publishExternalProtocolFinding(worker, { kind: 'finding', taskId, summary: 'New file is intentional', detail: 'Review both paths.' })
  assert.equal((await coord.completeExternalProtocolTask(worker, { taskId, summary: 'Change ready', filesChanged: ['file.txt'], commandsRun: ['reported-only'] })).accepted, true)
  const fresh = await read(sessionId, 'codex', taskId)
  assert.equal(fresh.verification, 'current')
  assert.deepEqual(fresh.checkout!.files.sort(), ['file.txt', 'new file.txt'])
  assert.match(fresh.checkout!.diff, /after/)
  assert.ok(coordinatorResultLines(fresh).join('\n').includes('New file is intentional'))
  assert.equal(fresh.task.receipt!.verification[0]!.command, 'git diff --check')
  assert.equal(fresh.integrationBlockers.length, 0, fresh.integrationBlockers.join('\n'))
  assert.equal(resultVerification({ ...fresh.task, receipt: undefined }), 'missing')
  assert.equal(resultVerification({ ...fresh.task, receipt: { ...fresh.task.receipt!, verificationRevision: undefined } }, fresh.checkout!.revision), 'unbound')
  assert.equal(resultVerification({ ...fresh.task, receipt: { ...fresh.task.receipt!, verification: [{ command: 'false', passed: false }] } }, fresh.checkout!.revision), 'failed')
  writeFileSync(path.join(worktree.path, 'new file.txt'), 'changed after verification\n')
  const stale = await read(sessionId, 'codex', taskId)
  assert.equal(stale.verification, 'stale', 'untracked content edits invalidate verification')
  await assert.rejects(integrate(sessionId, 'codex', taskId, fresh.checkout!.token, 'stale'), /stale/)
  writeFileSync(path.join(worktree.path, 'new file.txt'), 'untracked\n')
  assert.equal(await coordinatorCheckoutRevision(worktree.path), fresh.checkout!.revision)
  writeFileSync('local.txt', 'preserve local changes\n')
  assert.ok((await read(sessionId, 'codex', taskId)).integrationBlockers.some(reason => reason.includes('target checkout')))
  const { unlinkSync } = await import('node:fs'); unlinkSync('local.txt')
  // A clean target moving after review must also reject the old token.
  writeFileSync('other.txt', 'target moves\n'); git('add', 'other.txt'); git('commit', '-qm', 'target advance')
  await assert.rejects(integrate(sessionId, 'codex', taskId, fresh.checkout!.token, 'target-changed'), /changed since review/)
  const ready = await read(sessionId, 'codex', taskId)
  const result = await integrate(sessionId, 'codex', taskId, ready.checkout!.token, 'integrate-once')
  assert.equal(result.staged, true)
  assert.match(git('diff', '--cached'), /after/)
  assert.equal(git('log', '-1', '--format=%s'), 'target advance', 'integration does not commit target')
  assert.deepEqual(await integrate(sessionId, 'codex', taskId, ready.checkout!.token, 'integrate-once'), result, 'same request reconciles despite now-dirty target')
  assert.equal(git('diff', '--name-only'), '', 'target has only staged changes')
  // Committed changes are subject to the completed task's original path grants.
  git('commit', '-qm', 'user integrates first result')
  const limitedTree = await createWorktreeTask(cwd, 'limited-result')
  const limitedWorker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', participantName: 'limited', cwd: limitedTree.path })).participant
  const limitedTask = (await coord.createExternalProtocolTask(lead, { assignTo: limitedWorker.agentId, title: 'Scoped edit', detail: 'Only file.txt', paths: ['file.txt'] })).task!
  writeFileSync(path.join(limitedTree.path, 'file.txt'), 'scoped change\n')
  assert.equal((await coord.completeExternalProtocolTask(limitedWorker, { taskId: limitedTask.id, summary: 'Scoped result' })).accepted, true)
  writeFileSync(path.join(limitedTree.path, 'outside.txt'), 'outside granted paths\n')
  execFileSync('git', ['add', '.'], { cwd: limitedTree.path })
  execFileSync('git', ['commit', '-qm', 'late unrelated committed work'], { cwd: limitedTree.path })
  const limitedReview = await read(sessionId, 'codex', limitedTask.id)
  assert.ok(limitedReview.checkout!.files.includes('outside.txt'))
  assert.ok(limitedReview.integrationBlockers.some(reason => reason.includes('outside.txt')), 'committed out-of-scope paths cannot bypass the merge gate')
  console.log('Result review: real git files/diff, executed receipt, stale evidence, dirty/moved target guards, staging and exact-request replay passed')
} finally { await coord.stopProtocolRun(lead.runId) }
