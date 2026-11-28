// The Web half of the checkpoints plugin: /api/checkpoints against a real
// repository. Reads list a turn's snapshot and its changes; mutations act only
// on what the server can see now — a listed checkpoint, a current hunk, a
// current untracked file — and refuse anything else.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const repo = mkdtempSync(path.join(tmpdir(), 'checkpoints-route-'))
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T')
writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n'); git('add', '.'); git('commit', '-qm', 'base')

const { createTurnCheckpoint } = await import('../lib/checkpoints')
const route = await import('../app/api/checkpoints/route')
const get = async (query: Record<string, string>) => { const response = await route.GET(new NextRequest(`http://localhost/api/checkpoints?${new URLSearchParams({ cwd: repo, ...query })}`)); return { status: response.status, body: await response.json() } }
const post = async (body: Record<string, unknown>) => { const response = await route.POST(new NextRequest('http://localhost/api/checkpoints', { method: 'POST', body: JSON.stringify({ cwd: repo, ...body }) })); return { status: response.status, body: await response.json() } }

const checkpoint = (await createTurnCheckpoint(repo, { sessionId: 's1', provider: 'claude', message: 'edit a' }))!
writeFileSync(path.join(repo, 'a.txt'), 'one\nTWO\nthree\n')
writeFileSync(path.join(repo, 'new.txt'), 'fresh\n')

const list = await get({})
assert.equal(list.status, 200)
assert.deepEqual(list.body.checkpoints.map((entry: { sha: string }) => entry.sha), [checkpoint.sha])
const changes = await get({ action: 'changes', sha: checkpoint.sha })
assert.deepEqual(changes.body.changes.map((change: { path: string; status: string }) => `${change.status} ${change.path}`).sort(), ['A new.txt', 'M a.txt'])
assert.match((await get({ action: 'diff', sha: checkpoint.sha, file: 'a.txt' })).body.diff, /\+TWO/)
assert.equal((await get({ action: 'changes', sha: 'deadbeef' })).status, 404, 'an unlisted sha is refused')
console.log('Reads: the turn\'s checkpoint, what changed since it, and a file\'s diff; an unknown sha is refused.')

// Mutations: refused unless they name something current.
assert.equal((await post({ action: 'reject-hunk', patchText: 'diff --git a/x b/x\n' })).status, 409, 'an arbitrary patch is refused')
assert.equal((await post({ action: 'delete-untracked', path: 'a.txt' })).status, 409, 'a tracked file is not deletable as untracked')
assert.equal((await post({ action: 'delete-untracked', path: '../../etc/hosts' })).status, 409)
assert.equal((await post({ action: 'restore', sha: checkpoint.sha, paths: ['../outside'] })).status, 400, 'a path outside the checkpoint\'s changes is refused')
assert(existsSync(path.join(repo, 'a.txt')))
const working = await get({ action: 'working' })
assert.deepEqual(working.body.untracked, ['new.txt'])
assert.equal(working.body.hunks.length, 1)
assert.equal((await post({ action: 'reject-hunk', patchText: working.body.hunks[0].patchText })).status, 200)
assert.equal(readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n', 'rejecting the current hunk reverts it')
writeFileSync(path.join(repo, 'a.txt'), 'changed\n')
const restored = await post({ action: 'restore', sha: checkpoint.sha, paths: ['a.txt'] })
assert.equal(restored.status, 200)
assert.equal(readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n', 'restoring a file puts back the checkpoint\'s copy')
assert.equal((await post({ action: 'delete-untracked', path: 'new.txt' })).status, 200)
assert(!existsSync(path.join(repo, 'new.txt')))
console.log('Mutations: arbitrary patches, tracked or outside paths are refused; a current hunk rejects, a file restores, an untracked file deletes.')
// File history: one file through the turns that changed it; a hunk undoes only
// if it is one of that history's own.
await createTurnCheckpoint(repo, { sessionId: 's1', provider: 'claude', message: 'second turn' })
writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nTHREE\n')
const history = await get({ action: 'file-history', path: 'a.txt' })
assert.equal(history.status, 200, JSON.stringify(history.body))
assert.equal(history.body.history.relPath, 'a.txt')
const last = history.body.history.steps.at(-1)
assert.equal(last.until, null, 'the newest step runs to the working tree')
assert.match(last.diff, /\+THREE/)
assert.equal((await post({ action: 'revert-file-hunk', path: 'a.txt', patchText: working.body.hunks[0].patchText.replace('TWO', 'XYZ') })).status, 409, 'a patch outside the history is refused')
assert.equal((await post({ action: 'revert-file-hunk', path: 'a.txt', patchText: last.hunks[0].patchText })).status, 200)
assert.equal(readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n', 'undoing the step\'s hunk reverts it')
console.log('File history: a file\'s steps across turns; only a hunk of that history undoes.')
console.log('Checkpoints route smoke: PASS')
