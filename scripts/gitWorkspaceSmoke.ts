import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { actWorkspace, inspectWorkspace, previewWorkspace, readWorkspace } from '../lib/git/workspaceService'
import { patchRows, type WorkspaceAction } from '../lib/git/workspaceTypes'
const exec = promisify(execFile), root = await mkdtemp(join(tmpdir(), 'git-workspace-'))
const git = async (...args: string[]) => (await exec('git', args, { cwd: root })).stdout
const act = (action: WorkspaceAction, id = randomUUID()) => actWorkspace(root, id, action)
async function stageFile(path: string, kind: 'stage' | 'unstage' = 'stage') {
  return act({ kind, paths: [path], revision: (await readWorkspace(root)).revision })
}
async function lines(path: string, side: 'staged' | 'unstaged', filter: (text: string) => boolean) {
  const preview = await previewWorkspace(root, side, path)
  return act({ kind: 'patch', path, side, revision: preview.revision, patch: preview.patch, lines: patchRows(preview.patch).filter(row => row.changed && filter(row.text)).map(row => row.index) })
}
async function commit(message: string, amend = false) {
  const state = await readWorkspace(root)
  return act({ kind: 'commit', message, amend, indexRevision: state.indexRevision, head: state.head })
}
try {
  await git('init', '-q'); await git('config', 'user.name', 'Workspace Test'); await git('config', 'user.email', 'workspace@example.invalid')
  await git('config', 'commit.gpgsign', 'false'); await git('config', 'core.hooksPath', join(root, 'hooks'))
  // Unborn repository and literal pathspecs.
  let state = await readWorkspace(root)
  assert.equal(state.head, null)
  await writeFile(join(root, '[draft].txt'), 'one\ntwo\nthree\n')
  await stageFile('[draft].txt'); assert.match(await git('show', ':[draft].txt'), /one/)
  await stageFile('[draft].txt', 'unstage'); assert.equal((await git('ls-files')).trim(), '')
  await stageFile('[draft].txt'); await commit('Initial')
  assert.equal((await readWorkspace(root)).commits.length, 1)
  // Replacement: stage only addition; preserve original line until deletion is selected.
  await writeFile(join(root, '[draft].txt'), 'one\nTWO\nthree\n')
  await lines('[draft].txt', 'unstaged', text => text === '+TWO')
  assert.equal(await git('show', ':[draft].txt'), 'one\ntwo\nTWO\nthree\n')
  await lines('[draft].txt', 'staged', text => text === '+TWO')
  assert.equal(await git('show', ':[draft].txt'), 'one\ntwo\nthree\n')
  await lines('[draft].txt', 'unstaged', text => text === '-two' || text === '+TWO')
  assert.equal(await git('show', ':[draft].txt'), 'one\nTWO\nthree\n')
  // Commit identities are bound to the previewed HEAD and index.
  const before = await readWorkspace(root)
  await writeFile(join(root, 'later.txt'), 'later\n'); await stageFile('later.txt')
  await assert.rejects(act({ kind: 'commit', message: 'stale', amend: false, head: before.head, indexRevision: before.indexRevision }), /changed/)
  await stageFile('later.txt', 'unstage')
  const stale = await previewWorkspace(root, 'unstaged', 'later.txt')
  await writeFile(join(root, 'later.txt'), 'changed externally\n')
  await assert.rejects(act({ kind: 'stage', paths: ['later.txt'], revision: stale.revision }), /changed/)
  // Failed hooks retain the staged changes and propagate output.
  await mkdir(join(root, 'hooks')); await writeFile(join(root, 'hooks', 'pre-commit'), '#!/bin/sh\necho intentional-hook-failure >&2\nexit 1\n'); await chmod(join(root, 'hooks', 'pre-commit'), 0o755)
  await assert.rejects(commit('Blocked'), /intentional-hook-failure/)
  assert.match(await git('diff', '--cached'), /TWO/)
  await writeFile(join(root, 'hooks', 'pre-commit'), '#!/bin/sh\necho generated > generated.txt\ngit add generated.txt\n'); await chmod(join(root, 'hooks', 'pre-commit'), 0o755)
  await assert.rejects(commit('Expanded by hook'), /hook changed the staged content/)
  assert.equal((await readWorkspace(root)).commits.length, 1)
  assert.equal((await git('ls-files', '--', 'generated.txt')).trim(), '')
  await rm(join(root, 'hooks', 'pre-commit'))
  await commit('Replacement'); await commit('Replacement amended', true)
  assert.equal((await readWorkspace(root)).commits[0]?.subject, 'Replacement amended')
  assert.equal((await readWorkspace(root)).commits.length, 2)
  // New file partial staging and unstaging.
  await writeFile(join(root, 'new file.txt'), 'alpha\nbeta\ngamma\n')
  await lines('new file.txt', 'unstaged', text => text === '+beta')
  assert.equal(await git('show', ':new file.txt'), 'beta\n')
  await lines('new file.txt', 'staged', text => text === '+beta')
  assert.equal((await git('ls-files', '--', 'new file.txt')).trim(), '')
  // Deletion can be partial; unselected lines remain in the index.
  await rm(join(root, '[draft].txt'))
  await lines('[draft].txt', 'unstaged', text => text === '-TWO')
  assert.equal(await git('show', ':[draft].txt'), 'one\nthree\n')
  await lines('[draft].txt', 'staged', text => text === '-TWO')
  assert.equal(await git('show', ':[draft].txt'), 'one\nTWO\nthree\n')
  // No newline and multi-hunk changes.
  await writeFile(join(root, '[draft].txt'), 'one\nTWO\nthree\n')
  await writeFile(join(root, 'long.txt'), Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'))
  await stageFile('long.txt'); await commit('Long baseline')
  await writeFile(join(root, 'long.txt'), Array.from({ length: 30 }, (_, i) => i === 1 ? 'changed early' : i === 28 ? 'changed late' : `line ${i}`).join('\n'))
  await lines('long.txt', 'unstaged', text => text.includes('late') || text === '-line 28')
  const indexed = await git('show', ':long.txt'); assert.match(indexed, /changed late/); assert.doesNotMatch(indexed, /changed early/); assert.ok(!indexed.endsWith('\n'))
  // Rename whole-file actions include both names.
  await writeFile(join(root, 'renamed.txt'), await readFile(join(root, '[draft].txt'))); await rm(join(root, '[draft].txt'))
  await git('add', '--', '[draft].txt', 'renamed.txt')
  const renamed = (await readWorkspace(root)).files.find(file => file.previousPath)
  assert.ok(renamed); await stageFile(renamed.path, 'unstage')
  assert.equal((await git('diff', '--cached', '--name-only', '--', '[draft].txt', 'renamed.txt')).trim(), '')
  // Binary files and executable files can be staged whole.
  await writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2, 255])); await stageFile('binary.dat')
  assert.deepEqual(Buffer.from((await exec('git', ['show', ':binary.dat'], { cwd: root, encoding: 'buffer' })).stdout), Buffer.from([0, 1, 2, 255]))
  // Duplicate request IDs do not stage newer content or create duplicate commits.
  state = await readWorkspace(root)
  const action: WorkspaceAction = { kind: 'stage', paths: ['later.txt'], revision: state.revision }, id = randomUUID()
  const first = await act(action, id)
  await writeFile(join(root, 'later.txt'), 'newer\n')
  assert.deepEqual(await act(action, id), first)
  assert.equal(await git('show', ':later.txt'), 'changed externally\n')
  await assert.rejects(act({ kind: 'stage', paths: ['../outside'], revision: (await readWorkspace(root)).revision }), /Invalid repository path/)
  await assert.rejects(act({ kind: 'stage', paths: ['.git/config'], revision: (await readWorkspace(root)).revision }), /Invalid repository path/)
  // Shared index locks are respected.
  await writeFile(join(root, '.git', 'index.lock'), '')
  await assert.rejects(stageFile('later.txt'), /locked/)
  await rm(join(root, '.git', 'index.lock'))
  // Inspect stash and committed history using stable object IDs.
  await git('stash', 'push', '-u', '-m', 'Workspace stash')
  state = await readWorkspace(root)
  assert.ok(state.stashes.length)
  assert.match(await inspectWorkspace(root, 'stash', state.stashes[0]!.sha), /diff --git/)
  assert.match(await inspectWorkspace(root, 'commit', state.commits[0]!.sha), /commit /)
  console.log('Git workspace integration smoke passed: staging, partial lines, commits, amend, failures, stale previews, identities, locks, stash/history previews.')
} finally { await rm(root, { recursive: true, force: true }) }
