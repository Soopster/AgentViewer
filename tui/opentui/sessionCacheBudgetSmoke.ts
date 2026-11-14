import assert from 'node:assert/strict'
import { SessionCacheBudget } from './sessionCacheBudget'
import { TranscriptDetailCache } from './transcriptDetailCache'
import type { TuiSessionDetail } from '../../lib/tui/service'
const budget = new SessionCacheBudget(100)
const first = new TranscriptDetailCache(budget)
const second = new TranscriptDetailCache(budget)
const payload = (bytes: number) => ({ estimatedRetainedBytes: bytes } as TuiSessionDetail)
first.set('a', payload(60)); second.set('a', payload(60))
assert.equal(budget.bytes, 60, 'shared representations account for one session')
budget.retain('a')
first.set('b', payload(60))
assert.ok(first.has('a') && second.has('a'), 'visible session survives warm eviction')
assert.ok(!first.has('b'))
budget.release('a')
first.set('c', payload(60))
assert.ok(!first.has('a') && !second.has('a'), 'eviction releases every cache owner')
assert.equal(budget.bytes, 60)
budget.retain('c'); budget.retain('c'); budget.release('c')
first.set('d', payload(60))
assert.ok(first.has('c') && !first.has('d'), 'leases are reference counted')
budget.release('c')
console.log('Session cache budget passed: shared accounting, coordinated eviction and visibility leases')
