import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mutateReview, readReview } from '../lib/review/store'
import type { ReviewOperation } from '../lib/review/types'

if (process.argv[2] === '--reply') {
  await mutateReview({ cwd: process.argv[3]!, source: 'working', requestId: process.argv[5]!, operation: { type: 'reply', noteId: process.argv[4]!, text: process.argv[5]!, author: 'agent' } })
} else {
  const cwd = await mkdtemp(join(tmpdir(), 'review-store-'))
  process.env.AGENT_VIEWER_REVIEW_DIR = join(cwd, '.reviews')
  const patch = (start = 1, text = 'new') => `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -${start},2 +${start},2 @@\n-old\n+${text}\n context\n`
  const publish = (text: string, viewId = 'test') => mutateReview({ cwd, source: 'working', requestId: randomUUID(), publish: { patch: text, viewId, surface: 'smoke' } })
  const apply = (operation: ReviewOperation, requestId: string = randomUUID()) => mutateReview({ cwd, source: 'working', requestId, operation })
  try {
    let state = await publish(patch())
    const revision = state.document.revision
    const hunkId = state.document.hunks[0]!.id
    state = await apply({ type: 'note', revision, filePath: 'a.ts', range: { start: 1, end: 1, side: 'additions' }, text: 'Human feedback', author: 'user' })
    const noteId = state.notes[0]!.id
    await apply({ type: 'decision', revision, hunkId, status: 'approved', rationale: 'Checked boundary case' })
    state = await publish(patch(11))
    assert.equal(state.notes[0]!.resolution, 'active')
    assert.equal(state.notes[0]!.range.start, 11, 'unchanged content moves its anchor')
    assert.equal(state.decisions[0]!.hunkId, hunkId, 'line movement preserves approval')
    const concurrent = promisify(execFile)
    await Promise.all(Array.from({ length: 6 }, (_, index) => concurrent(index % 2 ? 'bun' : process.execPath,
      [...(index % 2 ? [] : ['--import', 'tsx']), 'scripts/reviewStoreSmoke.ts', '--reply', cwd, noteId, `reply-${index}`])))
    state = await readReview(cwd, 'working')
    assert.equal(state.notes[0]!.replies.length, 6, 'Node and Bun writers preserve all replies')
    const replyOperation = { type: 'reply' as const, noteId, text: 'retry', author: 'agent' as const }
    await apply(replyOperation, 'same-request'); state = await apply(replyOperation, 'same-request')
    assert.equal(state.notes[0]!.replies.length, 7, 'retry is idempotent')
    await assert.rejects(() => apply({ type: 'note', revision: state.document.revision, id: noteId, expectedVersion: state.notes[0]!.version, filePath: 'a.ts', range: state.notes[0]!.range, text: 'overwrite', author: 'agent' }), /another author/)
    await assert.rejects(() => apply({ type: 'resolve', noteId, expectedVersion: 1, resolved: true }), /Note changed/)
    state = await apply({ type: 'navigate', viewId: 'test', revision: state.document.revision, target: { filePath: 'a.ts', hunkId } }, 'jump')
    assert.equal(state.views[0]!.navigation?.appliedAt, undefined, 'requested is not applied')
    state = await apply({ type: 'ack', viewId: 'test', navigationId: 'jump' })
    assert(state.views[0]!.navigation?.appliedAt)
    await mutateReview({ cwd, source: 'working', requestId: randomUUID(), publish: { viewId: 'test', surface: 'smoke', close: true } })
    await assert.rejects(() => apply({ type: 'navigate', viewId: 'test', revision: state.document.revision, target: { filePath: 'a.ts' } }), /closed/)
    state = await publish(patch(11, 'changed again'))
    assert.equal(state.notes[0]!.resolution, 'stale')
    assert.equal(state.notes[0]!.replies.length, 7)
    assert.equal(state.decisions.length, 0, 'changed code loses previous approval')
    await assert.rejects(() => apply({ type: 'decision', revision, hunkId, status: 'approved' }), /Review changed/)
    state = await publish('')
    assert.equal(state.notes[0]!.resolution, 'orphaned')
    assert.equal((await readReview(cwd, 'branch')).notes.length, 0, 'comparison isolation')
    assert.equal((await readReview(cwd, 'pr:42')).notes.length, 0, 'PR isolation')
    console.log('Review store smoke passed: content reconciliation, stale/orphan retention, decision invalidation, multi-process Node/Bun writes, conflict checks, idempotency, navigation receipts, scope isolation')
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
