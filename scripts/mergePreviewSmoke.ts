import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseMergeTreeConflicts, previewMergeConflicts } from '../lib/coordinatorResultGit'

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=s', '-c', 'user.email=s@e.test', ...args], { cwd, encoding: 'utf8' }).trim()
const repo = mkdtempSync(path.join(tmpdir(), 'merge-preview-'))
git(repo, 'init', '-q', '-b', 'main')
writeFileSync(path.join(repo, 'shared.txt'), 'one\ntwo\nthree\n')
writeFileSync(path.join(repo, 'quiet.txt'), 'untouched\n')
git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base')

// A branch that edits a line the main checkout also edits, and one that edits something else.
git(repo, 'checkout', '-qb', 'collides'); writeFileSync(path.join(repo, 'shared.txt'), 'one\nTWO FROM BRANCH\nthree\n'); git(repo, 'commit', '-qam', 'branch edit')
git(repo, 'checkout', '-q', 'main'); git(repo, 'checkout', '-qb', 'clean'); writeFileSync(path.join(repo, 'quiet.txt'), 'changed\n'); git(repo, 'commit', '-qam', 'quiet edit')
git(repo, 'checkout', '-q', 'main'); writeFileSync(path.join(repo, 'shared.txt'), 'one\nTWO FROM MAIN\nthree\n'); git(repo, 'commit', '-qam', 'main edit')
const head = git(repo, 'rev-parse', 'HEAD')

assert.deepEqual(await previewMergeConflicts(repo, 'collides'), { conflicts: ['shared.txt'] })
assert.deepEqual(await previewMergeConflicts(repo, 'clean'), { conflicts: [] })
assert.equal(git(repo, 'rev-parse', 'HEAD'), head, 'a preview never moves the target')
assert.equal(git(repo, 'status', '--porcelain'), '', 'and never dirties it')
assert.equal(await previewMergeConflicts(repo, 'no-such-branch'), null, 'unknown is unknown, not clean')
assert.equal(await previewMergeConflicts(path.join(repo, 'missing-dir'), 'clean'), null)

assert.deepEqual(parseMergeTreeConflicts('abc123\na.ts\nb.ts\n\nAuto-merging a.ts\n'), ['a.ts', 'b.ts'], 'stops at the blank line before any messages')
assert.deepEqual(parseMergeTreeConflicts('abc123\n'), [])
console.log('merge preview smoke: ok')
