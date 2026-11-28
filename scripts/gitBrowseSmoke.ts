import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchSourceStatus } from '../lib/gitDiffSources'
import { git } from '../lib/git/command'
import { browseHistory, browseCommit, browseChangedFiles, browseDirectory, browseBlob, browseWorktrees, PREVIEW_LIMIT, EMPTY_TREE } from '../lib/git/browse'

const root = await mkdtemp(join(tmpdir(), 'git-browse-data-')), linked = `${root}-linked`
try {
  await git(root, ['init', '-q', '-b', 'main'])
  await git(root, ['config', 'user.name', 'History Fixture']); await git(root, ['config', 'user.email', 'history@example.invalid']); await git(root, ['config', 'commit.gpgsign', 'false'])
  await mkdir(join(root, 'dir')); await writeFile(join(root, 'dir', 'tab\tand\nnewline.txt'), 'root contents\n')
  await writeFile(join(root, 'binary'), Buffer.from([0, 1])); await writeFile(join(root, '.gitignore'), 'ignored\n')
  await git(root, ['add', '.']); await git(root, ['commit', '-qm', 'Root\n\nFull message body'])
  const first = (await browseHistory(root, 'HEAD'))[0]!
  assert.deepEqual(first.parents, []); assert(first.message.includes('Full message body'))
  assert((await browseChangedFiles(root, first)).some(f => f.path === 'dir/tab\tand\nnewline.txt'))
  const sourceFiles = await fetchSourceStatus(root, git, { kind: 'commit-range', base: EMPTY_TREE, head: first.sha })
  assert(sourceFiles.some(file => file.path === 'dir/tab\tand\nnewline.txt'))
  const tree = (await git(root, ['rev-parse', 'HEAD^{tree}'])).trim()
  let parent = first.sha
  for (let i = 0; i < 101; i++) parent = (await git(root, ['commit-tree', tree, '-p', parent, '-m', `Commit ${i}`])).trim()
  await git(root, ['update-ref', 'refs/heads/main', parent])
  const page1 = await browseHistory(root, 'HEAD'), page2 = await browseHistory(root, 'HEAD', 100)
  assert.equal(page1.length, 100); assert.equal(page2.length, 2)
  assert.equal(new Set([...page1, ...page2].map(c => c.sha)).size, 102)
  const side = (await git(root, ['commit-tree', tree, '-p', first.sha, '-m', 'Side branch'])).trim()
  const merge = (await git(root, ['commit-tree', tree, '-p', parent, '-p', side, '-m', 'Merge'])).trim()
  const merged = await browseCommit(root, merge)
  assert.deepEqual(merged.parents, [parent, side]); assert.deepEqual(await browseChangedFiles(root, merged), [])
  const entries = await browseDirectory(root, first.sha, 'dir')
  assert.equal(entries[0]!.name, 'tab\tand\nnewline.txt'); assert.equal(await browseBlob(root, entries[0]!), 'root contents\n')
  await writeFile(join(root, 'dir', 'tab\tand\nnewline.txt'), 'local only\n')
  assert.equal(await browseBlob(root, entries[0]!), 'root contents\n')
  await writeFile(join(root, 'ignored'), 'ignored\n'); await writeFile(join(root, 'untracked'), 'visible\n')
  await writeFile(join(root, 'large'), 'x'.repeat(PREVIEW_LIMIT + 5)); await symlink('/etc/passwd', join(root, 'external'))
  const local = await browseDirectory(root, null)
  assert(!local.some(e => e.name === 'ignored')); assert(local.some(e => e.name === 'untracked'))
  assert((await browseBlob(root, local.find(e => e.name === 'large')!)).endsWith('Preview truncated at 1 MiB.'))
  assert((await browseBlob(root, local.find(e => e.name === 'external')!)).includes('not followed'))
  assert((await browseBlob(root, local.find(e => e.name === 'binary')!)).startsWith('Binary'))
  await assert.rejects(browseDirectory(root, null, '../'))
  await git(root, ['worktree', 'add', '-q', '-b', 'linked-branch', linked])
  const canonicalLinked = await realpath(linked)
  assert((await browseWorktrees(root)).some(w => w.branch === 'linked-branch' && w.path === canonicalLinked))
  await git(root, ['update-index', '--add', '--cacheinfo', `160000,${first.sha},module`])
  await git(root, ['commit', '-qm', 'Submodule'])
  const head = (await browseHistory(root, 'HEAD'))[0]!
  const submodule = (await browseDirectory(root, head.sha)).find(e => e.name === 'module')!
  assert.equal((await browseDirectory(root, null)).find(e => e.name === 'module')?.kind, 'submodule')
  assert.equal(submodule.kind, 'submodule'); assert((await browseBlob(root, submodule)).startsWith('Submodule'))
  console.log('Git browsing data passed: pagination, root/merge parents, full messages, unusual paths, immutable blobs, binary/large files, ignored/untracked files, symlinks, submodules and linked worktrees.')
} finally { await rm(linked, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
