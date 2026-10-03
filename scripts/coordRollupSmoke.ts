import assert from 'node:assert/strict'
import type { ProtocolTask } from '../lib/agentProtocol'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeRunRollup, describeRunRollup, formatRunRollup } from '../lib/coordinatorRollup'

const T0 = Date.parse('2026-10-04T09:00:00Z')
const task = (id: string, status: ProtocolTask['status'], paths: string[], extra: Partial<ProtocolTask> = {}): ProtocolTask => ({
  id, runId: 'r', title: id, prompt: '', status, targetRole: 'teammate', paths, blockedBy: [], seat: 'executor', verifyCommands: [],
  createdAt: '', updatedAt: '', ownerAgentId: id === 't1' ? 'a1' : 'a2', ...extra,
})
const names = new Map([['a1', 'ada'], ['a2', 'bo']])
const rollup = (tasks: ProtocolTask[], run: Partial<Parameters<typeof computeRunRollup>[0]['run']> = {}, usage = {}) =>
  computeRunRollup({ run: { createdAt: '2026-10-04T09:00:00Z', status: 'running', ...run }, tasks, agentNames: names, usage, now: T0 + 12 * 60_000 })

// Counts and elapsed.
const r = rollup([task('t1', 'completed', ['a']), task('t2', 'in_progress', ['b']), task('t3', 'failed', ['c']), task('t4', 'pending', ['d']), task('t5', 'cancelled', ['e']), task('t6', 'blocked', ['f'])])
assert.deepEqual(r.tasks, { total: 6, done: 1, failed: 1, active: 1, pending: 1, blocked: 1 })
assert.equal(r.elapsedMs, 12 * 60_000)

// Overlap: same file, parent directory, and a glob root all collide; disjoint paths and whole-tree grants do not.
assert.deepEqual(rollup([task('t1', 'in_progress', ['src/a.ts']), task('t2', 'in_progress', ['src/a.ts'])]).overlaps.map((o) => [o.path, o.live, o.owners]), [['src/a.ts', true, ['ada', 'bo']]])
assert.equal(rollup([task('t1', 'in_progress', ['src/']), task('t2', 'pending', ['src/lib/x.ts'])]).overlaps[0]?.path, 'src/lib/x.ts', 'reports the narrower path in contention')
assert.equal(rollup([task('t1', 'in_progress', ['src/**']), task('t2', 'pending', ['src/lib/x.ts'])]).overlaps.length, 1, 'a glob overlaps what is under its root')
assert.equal(rollup([task('t1', 'in_progress', ['src/a.ts']), task('t2', 'in_progress', ['src/ab.ts'])]).overlaps.length, 0, 'a shared prefix of letters is not a shared directory')
assert.equal(rollup([task('t1', 'in_progress', ['**']), task('t2', 'in_progress', ['**'])]).overlaps.length, 0, 'whole-tree grants say nothing about where work lands')
assert.equal(rollup([task('t1', 'failed', ['a']), task('t2', 'in_progress', ['a'])]).overlaps.length, 0, 'work that will not land cannot collide')
assert.equal(rollup([task('t1', 'cancelled', ['a']), task('t2', 'in_progress', ['a'])]).overlaps.length, 0)

// A finished task is judged by what it changed, not by the wider grant it held.
const grant = task('t1', 'completed', ['src/'], { receipt: { filesChanged: ['src/only.ts'] } as ProtocolTask['receipt'] })
assert.equal(rollup([grant, task('t2', 'in_progress', ['src/other.ts'])]).overlaps.length, 0)
assert.equal(rollup([grant, task('t2', 'in_progress', ['src/only.ts'])]).overlaps[0]?.live, true)
assert.equal(rollup([grant, task('t2', 'completed', ['src/only.ts'], { receipt: { filesChanged: ['src/only.ts'] } as ProtocolTask['receipt'] })]).overlaps[0]?.live, false, 'two finished tasks that collided are history, not a live risk')
assert.equal(rollup([grant]).filesTouched, 1)

// Budget warning fires near the limit, says which, and stops once the run is over.
assert.equal(rollup([], { budget: { maxCostUsd: 10 } }, { costUsd: 7 }).budgetWarning, undefined)
assert.equal(rollup([], { budget: { maxCostUsd: 10 } }, { costUsd: 8.2 }).budgetWarning, '82% of the cost budget is used')
assert.equal(rollup([], { budget: { maxTokens: 1000, maxCostUsd: 10 } }, { totalTokens: 950, costUsd: 1 }).budgetWarning, '95% of the token budget is used', 'names the tightest budget')
assert.equal(rollup([], { budget: { maxDurationMinutes: 14 } }).budgetWarning, '86% of the time budget is used')
assert.equal(rollup([], { status: 'completed', budget: { maxCostUsd: 10 } }, { costUsd: 12 }).budgetWarning, undefined)

assert.equal(formatRunRollup(rollup([task('t1', 'completed', []), task('t2', 'failed', [])], {}, { totalTokens: 42_300, costUsd: 0.834 })), '1/2 done · 1 failed · 42k tok · $0.83 · 12m')
assert.equal(formatRunRollup(rollup([task('t1', 'pending', [])]), { maxCostUsd: 5 }), '0/1 done · 12m')

// Hold-ups: the unfinished task with the most work stacked behind it, counting through chains.
{
  const dep = (id: string, status: ProtocolTask['status'], blockedBy: string[] = []) => task(id, status, [], { blockedBy })
  const board = [
    dep('root', 'in_progress'),
    dep('a', 'pending', ['root']), dep('b', 'pending', ['root']),
    dep('c', 'pending', ['a']), dep('d', 'pending', ['a', 'b']),
    dep('lonely', 'in_progress'), dep('onlyChild', 'pending', ['lonely']),
    dep('done', 'completed'), dep('afterDone', 'pending', ['done']), dep('afterDone2', 'pending', ['done']),
  ]
  const out = rollup(board).holdUps
  assert.deepEqual(out.map((h) => [h.taskId, h.holdsUp]), [['root', 4], ['a', 2]], 'counts distinct dependents through the chain; one dependent is not a hold-up; finished tasks hold nothing up')
  assert.match(describeRunRollup(rollup(board)).holdUpLines[0]!, /^root “root” \(.*in progress\) holds up 4 tasks$/)
  // A malformed cycle terminates rather than spinning.
  const cycle = [dep('x', 'pending', ['z']), dep('y', 'pending', ['x']), dep('z', 'pending', ['y'])]
  assert.ok(rollup(cycle).holdUps.length <= 3)
  assert.equal(rollup([dep('r', 'in_progress'), ...Array.from({ length: 10 }, (_, i) => dep(`h${i}`, 'pending', ['r', ...(i ? [`h${i - 1}`] : [])]))]).holdUps.length, 3, 'capped at three lines')
}

// The indexed overlap finder must agree with the obvious pairwise definition on arbitrary boards.
{
  const dirs = ['a', 'a/b', 'a/b/c', 'a/bc', 'd', 'd/e', 'f/g/h', '**', 'a/*', 'a/b/*.ts']
  let seed = 7
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
  const root = (value: string) => { const i = value.search(/[*?[]/); return (i < 0 ? value : value.slice(0, i)).replace(/\/$/, '') }
  const covers = (a: string, b: string) => a === b || b.startsWith(`${a}/`)
  for (let round = 0; round < 300; round += 1) {
    const statuses: ProtocolTask['status'][] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled']
    const board = Array.from({ length: 2 + rand(9) }, (_, i) => task(`k${i}`, statuses[rand(statuses.length)]!,
      Array.from({ length: 1 + rand(3) }, () => `${dirs[rand(dirs.length)]}${rand(3) === 0 ? '/x.ts' : ''}`)))
    const expected = new Set<string>()
    const relevant = board.filter((t) => t.status !== 'failed' && t.status !== 'cancelled')
    for (let i = 0; i < relevant.length; i += 1) for (let j = i + 1; j < relevant.length; j += 1) {
      for (const a of relevant[i]!.paths) for (const b of relevant[j]!.paths) {
        const x = root(a), y = root(b)
        if (!x || !y || x === '**' || y === '**') continue
        if (covers(x, y) || covers(y, x)) expected.add(x.length >= y.length ? x : y)
      }
    }
    const got = new Set(rollup(board).overlaps.map((o) => o.path))
    assert.deepEqual([...got].sort(), [...expected].sort(), `round ${round}: ${board.map((t) => `${t.status}:${t.paths}`).join(' | ')}`)
  }
}

// What surfaces print: only live overlaps are listed, capped, and counted for attention.
const many = rollup(['a', 'b', 'c', 'd', 'e'].flatMap((name, i) => [task(`x${i}`, 'in_progress', [`${name}.ts`]), task(`y${i}`, 'pending', [`${name}.ts`])]))
const described = describeRunRollup(many)
assert.equal(described.overlapLines.length, 3)
assert.equal(described.hiddenOverlaps, 2)
assert.equal(described.attentionCount, 1, 'overlaps are one item of attention, not one per path')
assert.match(described.overlapLines[0]!, /both target it/)
assert.equal(describeRunRollup(rollup([task('t1', 'completed', ['a.ts'], { receipt: { filesChanged: ['a.ts'] } as ProtocolTask['receipt'] }), task('t2', 'completed', ['a.ts'], { receipt: { filesChanged: ['a.ts'] } as ProtocolTask['receipt'] })])).attentionCount, 0)
assert.equal(describeRunRollup(rollup([], { budget: { maxCostUsd: 1 } }, { costUsd: 0.9 })).attentionCount, 1)

// End to end: a real ledger reports the same rollup on its snapshot.
const root = mkdtempSync(path.join(tmpdir(), 'coord-rollup-'))
process.chdir(root)
const coordination = await import('../lib/agentCoordination')
const identity = (await coordination.createExternalProtocolRun({ prompt: 'rollup', provider: 'codex', baseCwd: root, participantName: 'lead', maxAgents: 3 })).participant
await coordination.createExternalProtocolTask(identity, { title: 'one', detail: 'one', paths: ['src/shared.ts'] })
await coordination.createExternalProtocolTask(identity, { title: 'two', detail: 'two', paths: ['src/shared.ts', 'src/own.ts'] })
const live = (await coordination.readProtocolRun(identity.runId))!.rollup!
assert.equal(live.tasks.total, 2)
assert.deepEqual(live.overlaps.map((o) => [o.path, o.live]), [['src/shared.ts', true]])
// The lead is told in the result of the very call that created the collision.
const created = await coordination.createExternalProtocolTask(identity, { title: 'three', detail: 'three', paths: ['src/own.ts'] })
assert.match(created.actionable.overlapWarnings?.[0] ?? '', /src\/(shared|own)\.ts — .*both target it/)
assert.equal((await coordination.readExternalProtocolStatus(identity)).actionable.overlapWarnings?.length, 2, 'and on every status read until it is resolved')
console.log('coord rollup smoke: ok')
process.exit(0)
