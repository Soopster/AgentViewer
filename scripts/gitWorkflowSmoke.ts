import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { actWorkspace, readWorkspace } from '../lib/git/workspaceService'
import { readConflict } from '../lib/git/workflowOperations'
import { chooseConflictBlock, conflictBlocks } from '../lib/git/conflictText'
import type { WorkflowDraft, WorkspaceSnapshot } from '../lib/git/workspaceTypes'
const exec = promisify(execFile), directory = await mkdtemp(join(tmpdir(), 'git-workflow-')), root = join(directory, 'work'), remote = join(directory, 'remote.git'), other = join(directory, 'other')
const git = async (cwd: string, ...args: string[]) => (await exec('git', args, { cwd })).stdout
const write = (path: string, content: string) => writeFile(join(root, path), content)
async function configure(cwd: string) { for (const [key, value] of [['user.name', 'Workflow Test'], ['user.email', 'workflow@example.invalid'], ['commit.gpgsign', 'false']]) await git(cwd, 'config', key!, value!) }
async function act(action: WorkflowDraft, snapshot?: WorkspaceSnapshot) {
  const state = snapshot ?? await readWorkspace(root)
  return actWorkspace(root, randomUUID(), { ...action, revision: state.workflowRevision })
}
async function ok(action: WorkflowDraft) { const result = await act(action); assert.equal(result.error, undefined, result.error ?? 'Expected successful Git operation'); return result.snapshot }
async function commit(message: string) { await git(root, 'add', '-A'); await git(root, 'commit', '-qm', message) }
try {
  const marked = 'before\r\n<<<<<<< ours\r\nleft\r\n||||||| base\r\nbase\r\n=======\r\nright\r\n>>>>>>> theirs\r\nafter\r\n'
  assert.equal(conflictBlocks(marked)[0]?.base, 'base\r\n')
  assert.equal(chooseConflictBlock(marked, 0, 'both'), 'before\r\nleft\r\nright\r\nafter\r\n')
  await mkdir(root); await git(root, 'init', '-q', '-b', 'main'); await configure(root)
  await write('conflict.txt', 'base\n'); await commit('Baseline')
  let state = await readWorkspace(root), baseline = state.head!
  await ok({ kind: 'branch-create', name: 'feature', start: baseline, switchTo: false })
  state = await ok({ kind: 'branch-rename', name: 'feature', sha: baseline, newName: 'renamed' })
  assert.ok(state.branches.includes('renamed'))
  await assert.rejects(act({ kind: 'branch-delete', name: 'renamed', sha: baseline }, { ...state, workflowRevision: 'outdated' }), /changed/)
  await ok({ kind: 'branch-switch', name: 'renamed', sha: baseline })
  await write('carried.txt', 'carried\n')
  await ok({ kind: 'branch-switch', name: 'main', sha: baseline })
  assert.equal(await readFile(join(root, 'carried.txt'), 'utf8'), 'carried\n')
  await ok({ kind: 'branch-delete', name: 'renamed', sha: baseline })
  // Selected-file stash leaves unrelated work in place, including untracked files.
  await write('unrelated.txt', 'leave me\n')
  state = await ok({ kind: 'stash-create', mode: 'selected', paths: ['carried.txt'], includeUntracked: true, message: 'Selected file' })
  assert.ok(state.files.some(file => file.path === 'unrelated.txt'))
  assert.ok(!state.files.some(file => file.path === 'carried.txt'))
  let stash = state.stashes[0]!
  const dirtyApply = await act({ kind: 'stash-apply', ...stash, restoreIndex: false }); assert.match(dirtyApply.error!, /Commit or stash/)
  await rm(join(root, 'unrelated.txt'))
  state = await ok({ kind: 'stash-pop', sha: stash.sha, selector: stash.selector, restoreIndex: false })
  assert.equal(state.stashes.length, 0); assert.equal(await readFile(join(root, 'carried.txt'), 'utf8'), 'carried\n')
  await rm(join(root, 'carried.txt'))
  // Staged-only stash and index restoration.
  await write('staged.txt', 'staged\n'); await git(root, 'add', 'staged.txt')
  await write('unstaged.txt', 'not staged\n')
  state = await ok({ kind: 'stash-create', mode: 'staged', paths: [], includeUntracked: false, message: 'Only index' })
  assert.ok(state.files.some(file => file.path === 'unstaged.txt')); stash = state.stashes[0]!
  await rm(join(root, 'unstaged.txt'))
  state = await ok({ kind: 'stash-apply', sha: stash.sha, selector: stash.selector, restoreIndex: true })
  assert.ok(state.files.some(file => file.path === 'staged.txt' && file.x === 'A'))
  await commit('Staged restoration')
  await ok({ kind: 'stash-drop', sha: stash.sha, selector: stash.selector, restoreIndex: false })
  // Keep-index stashes preserve staged work while removing unstaged work.
  await write('staged.txt', 'keep this staged\n'); await git(root, 'add', 'staged.txt')
  await write('conflict.txt', 'stash only the working edits\n')
  state = await ok({ kind: 'stash-create', mode: 'keep-index', paths: [], includeUntracked: false, message: 'Keep index' })
  assert.ok(state.files.some(file => file.path === 'staged.txt' && file.x === 'M'))
  assert.equal(await readFile(join(root, 'conflict.txt'), 'utf8'), 'base\n')
  stash = state.stashes[0]!; await commit('Kept staged work'); await ok({ kind: 'stash-drop', sha: stash.sha, selector: stash.selector, restoreIndex: false })
  // Conflicted pop must keep the stash and return current conflict state.
  await write('conflict.txt', 'stashed\n')
  state = await ok({ kind: 'stash-create', mode: 'all', paths: [], includeUntracked: false, message: 'Conflict stash' }); stash = state.stashes[0]!
  await write('conflict.txt', 'committed\n'); await commit('Diverging content')
  const pop = await act({ kind: 'stash-pop', sha: stash.sha, selector: stash.selector, restoreIndex: false })
  assert.ok(pop.error); assert.ok(pop.snapshot.stashes.some(entry => entry.sha === stash.sha)); assert.ok(pop.snapshot.files.some(file => file.conflict))
  const conflict = await readConflict(root, 'conflict.txt')
  assert.equal(conflict.ours?.content, 'committed\n'); assert.equal(conflict.theirs?.content, 'stashed\n')
  await ok({ kind: 'conflict-save', path: 'conflict.txt', content: 'resolved manually\n' }); await commit('Resolved stash')
  await ok({ kind: 'stash-drop', sha: stash.sha, selector: stash.selector, restoreIndex: false })
  // Merge conflict: inspect, choose a version, continue. Also cover abort.
  state = await readWorkspace(root); const mergeBase = state.head!
  await ok({ kind: 'branch-create', name: 'merge-feature', start: mergeBase, switchTo: true })
  await write('conflict.txt', 'feature\n'); await commit('Feature')
  const featureSha = (await readWorkspace(root)).head!
  await ok({ kind: 'branch-switch', name: 'main', sha: mergeBase })
  await write('conflict.txt', 'main\n'); await commit('Main')
  let merged = await act({ kind: 'branch-merge', name: 'merge-feature', sha: featureSha })
  assert.ok(merged.error); assert.equal(merged.snapshot.operation, 'merge')
  const badContinue = await act({ kind: 'operation', operation: 'merge', action: 'continue' }); assert.match(badContinue.error!, /Resolve and stage/)
  await ok({ kind: 'resolve', path: 'conflict.txt', choice: 'ours' })
  state = await ok({ kind: 'operation', operation: 'merge', action: 'continue' }); assert.equal(state.operation, null)
  const beforeAbort = state.head!
  await ok({ kind: 'branch-create', name: 'abort-source', start: beforeAbort, switchTo: true })
  await write('conflict.txt', 'abort-source\n'); await commit('Abort source'); const abortSource = (await readWorkspace(root)).head!
  await ok({ kind: 'branch-switch', name: 'main', sha: beforeAbort }); await write('conflict.txt', 'abort-target\n'); await commit('Abort target')
  const abortTarget = (await readWorkspace(root)).head!
  assert.ok((await act({ kind: 'branch-merge', name: 'abort-source', sha: abortSource })).error)
  state = await ok({ kind: 'operation', operation: 'merge', action: 'abort' }); assert.equal(state.head, abortTarget); assert.equal(state.files.length, 0)
  // A replayed commit can be explicitly skipped.
  await ok({ kind: 'branch-create', name: 'skip-source', start: abortTarget, switchTo: true }); await write('conflict.txt', 'skip-source\n'); await commit('Skip me')
  await ok({ kind: 'branch-switch', name: 'main', sha: abortTarget }); await write('conflict.txt', 'skip-target\n'); await commit('Skip target')
  await git(root, 'rebase', 'main', 'skip-source').catch(() => '')
  state = await readWorkspace(root); assert.equal(state.operation, 'rebase')
  state = await ok({ kind: 'operation', operation: 'rebase', action: 'skip' }); assert.equal(state.operation, null)
  const main = state.branchRefs.find(branch => branch.name === 'main')!
  await ok({ kind: 'branch-switch', name: 'main', sha: main.sha })
  // Modify/delete resolution: choosing an absent side stages the deletion.
  await write('deleted.txt', 'delete baseline\n'); await commit('Deletion baseline')
  state = await readWorkspace(root); const deletionBase = state.head!
  await ok({ kind: 'branch-create', name: 'delete-source', start: deletionBase, switchTo: true })
  await write('deleted.txt', 'source modification\n'); await commit('Source modification'); const deletionSource = (await readWorkspace(root)).head!
  await ok({ kind: 'branch-switch', name: 'main', sha: deletionBase }); await git(root, 'rm', 'deleted.txt'); await commit('Delete file')
  assert.ok((await act({ kind: 'branch-merge', name: 'delete-source', sha: deletionSource })).error)
  assert.equal((await readConflict(root, 'deleted.txt')).ours, null)
  await ok({ kind: 'resolve', path: 'deleted.txt', choice: 'ours' }); await ok({ kind: 'operation', operation: 'merge', action: 'continue' })
  assert.equal((await git(root, 'ls-files', '--', 'deleted.txt')).trim(), '')
  // Bare remote: publish, fetch, fast-forward, configure tracking.
  await git(directory, 'init', '-q', '--bare', remote)
  await ok({ kind: 'remote-add', name: 'origin', url: remote })
  const beforeRemoteChange = await readWorkspace(root)
  await git(root, 'remote', 'set-url', 'origin', remote + '.changed')
  await assert.rejects(act({ kind: 'fetch', remote: 'origin' }, beforeRemoteChange), /references changed/)
  await git(root, 'remote', 'set-url', 'origin', remote)
  state = await ok({ kind: 'push', remote: 'origin', branch: 'main', setUpstream: true, lease: null })
  assert.equal(state.upstream, 'origin/main')
  await git(directory, 'clone', '-q', '-b', 'main', remote, other); await configure(other)
  await writeFile(join(other, 'remote.txt'), 'remote\n'); await git(other, 'add', '.'); await git(other, 'commit', '-qm', 'Remote work'); await git(other, 'push', '-q')
  state = await ok({ kind: 'fetch', remote: 'origin' }); assert.equal(state.behind, 1)
  await ok({ kind: 'pull', remote: 'origin', branch: 'main', strategy: 'ff-only' })
  assert.equal(await readFile(join(root, 'remote.txt'), 'utf8'), 'remote\n')
  await ok({ kind: 'branch-track', name: 'main', upstream: 'origin/main' })
  state = await ok({ kind: 'branch-create', name: 'tracked', start: 'refs/remotes/origin/main', switchTo: false })
  assert.equal(state.branchRefs.find(branch => branch.name === 'tracked')?.upstream, 'origin/main')
  await ok({ kind: 'branch-delete', name: 'tracked', sha: state.branchRefs.find(branch => branch.name === 'tracked')!.sha })
  // A stale force lease must not overwrite a newer remote tip.
  state = await readWorkspace(root); const lease = state.remoteBranches.find(branch => branch.name === 'origin/main')!.sha
  await writeFile(join(other, 'remote.txt'), 'new remote\n'); await git(other, 'commit', '-qam', 'New remote'); await git(other, 'push', '-q')
  const rejected = await act({ kind: 'push', remote: 'origin', branch: 'main', setUpstream: false, lease }); assert.ok(rejected.error)
  await git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/lease-test')
  state = await ok({ kind: 'fetch', remote: 'origin' })
  const goodLease = state.remoteBranches.find(branch => branch.name === 'origin/lease-test')!.sha
  const oldLocalHead = state.head!
  await ok({ kind: 'push', remote: 'origin', branch: 'lease-test', setUpstream: false, lease: goodLease })
  assert.equal((await git(remote, 'rev-parse', 'refs/heads/lease-test')).trim(), oldLocalHead)
  await write('conflict.txt', 'local rebase\n'); await commit('Local rebase')
  await writeFile(join(other, 'conflict.txt'), 'remote rebase\n'); await git(other, 'commit', '-qam', 'Remote rebase'); await git(other, 'push', '-q')
  const rebased = await act({ kind: 'pull', remote: 'origin', branch: 'main', strategy: 'rebase' })
  assert.ok(rebased.error); assert.equal(rebased.snapshot.operation, 'rebase')
  await ok({ kind: 'resolve', path: 'conflict.txt', choice: 'theirs' })
  state = await ok({ kind: 'operation', operation: 'rebase', action: 'continue' }); assert.equal(state.operation, null)
  await ok({ kind: 'push', remote: 'origin', branch: 'main', setUpstream: false, lease: null })
  // App operation leases reject active owners and recover a dead owner.
  const leaseFile = join(root, '.git', 'agent-viewer-operation.lock')
  await writeFile(leaseFile, JSON.stringify({ pid: process.pid, token: 'active-fixture' }))
  await assert.rejects(act({ kind: 'fetch', remote: 'origin' }), /Another Agent Viewer Git operation/)
  await rm(leaseFile)
  const deadPid = Number((await exec(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout)
  await writeFile(leaseFile, JSON.stringify({ pid: deadPid, token: 'dead-fixture' }))
  await ok({ kind: 'fetch', remote: 'origin' })
  await assert.rejects(readFile(leaseFile), /ENOENT/)
  // Branch occupancy and invalid input are checked before mutation.
  const occupied = join(directory, 'occupied'); await git(root, 'worktree', 'add', '-qb', 'occupied', occupied)
  state = await readWorkspace(root)
  const occupiedBranch = state.branchRefs.find(branch => branch.name === 'occupied')!
  assert.match((await act({ kind: 'branch-switch', name: 'occupied', sha: occupiedBranch.sha })).error!, /already checked out/)
  assert.match((await act({ kind: 'branch-create', name: '--bad', start: state.head!, switchTo: false })).error!, /Invalid branch/)
  await ok({ kind: 'remote-remove', name: 'origin' })
  console.log('Git workflow integration passed: branches, dirty switching, selected/staged stashes, conflict-preserving pop, manual resolution, merge/rebase continue, local remote fetch/pull/push, force lease rejection, worktree occupancy.')
} finally { await rm(directory, { recursive: true, force: true }) }
