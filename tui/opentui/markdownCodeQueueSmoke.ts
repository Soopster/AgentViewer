import assert from 'node:assert/strict'
import { MarkdownCodeQueue } from './markdownCodeQueue'
import { markdownCodeChunks } from './markdownStructure'
import type { SimpleHighlight } from '@opentui/core'

const started: string[] = [], partitioned: string[] = []
const pending: Array<{ resolve: (captures: SimpleHighlight[]) => void; reject: (error: Error) => void }> = []
const queue = new MarkdownCodeQueue(content => {
  started.push(content)
  return new Promise((resolve, reject) => pending.push({ resolve, reject }))
}, async (content, captures) => { partitioned.push(content); return markdownCodeChunks(content, 32, captures) })
const tick = async () => { for (let step = 0; step < 12; step++) await Promise.resolve() }
const a = new AbortController(), b = new AbortController(), obsolete = new AbortController()
const first = queue.read('shared', 'js', a.signal)
const second = queue.read('shared', 'js', b.signal)
const cancelled = assert.rejects(first, /aborted/)
a.abort(); await cancelled; await tick()
assert.deepEqual(started, ['shared'], 'two consumers share a full syntax parse')
const old = queue.read('obsolete', 'js', obsolete.signal)
const oldRejected = assert.rejects(old, /aborted/)
obsolete.abort(); await oldRejected
const next = queue.read('latest', 'js', new AbortController().signal)
assert.deepEqual(started, ['shared'], 'queued versions cannot flood the syntax worker')
pending[0]!.resolve([]); await second; await tick()
assert.deepEqual(started, ['shared', 'latest'], 'obsolete source is removed before syntax parsing')
pending[1]!.resolve([]); await next; await tick()
const active = new AbortController()
const abandoned = queue.read('abandoned', 'js', active.signal)
await tick()
const abandonedRejected = assert.rejects(abandoned, /aborted/)
active.abort(); await abandonedRejected
pending[2]!.resolve([]); await tick()
assert.ok(!partitioned.includes('abandoned'), 'an abandoned active parse never reaches partitioning')
const failed = queue.read('failure', 'js', new AbortController().signal)
const failure = assert.rejects(failed, /offline/)
await tick(); pending[3]!.reject(new Error('offline')); await failure; await tick()
const retry = queue.read('failure', 'js', new AbortController().signal)
await tick(); pending[4]!.resolve([]); await retry
console.log('Code syntax queue passed: shared consumers, serial parsing, obsolete-version removal, active cancellation and failure recovery')
