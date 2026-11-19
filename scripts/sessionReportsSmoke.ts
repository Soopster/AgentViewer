// Self-reported agent state: ordering by seq, lapse by ttl, and per-session lookup.
import assert from 'node:assert/strict'
import { clearSessionReport, listSessionReports, recordSessionReport } from '../lib/sessionReports'

const t0 = 1_000_000
const first = recordSessionReport({ source: 'amp', state: 'working', sessionId: 's1', ttlMs: 5000 }, t0)!
assert.equal(first.seq, 1)
assert.equal(recordSessionReport({ source: 'amp', state: 'idle', sessionId: 's1', seq: 1 }, t0 + 10), null, 'an equal seq is stale')
assert.equal(recordSessionReport({ source: 'amp', state: 'idle', sessionId: 's1', seq: 0 }, t0 + 10), null, 'an older seq is stale')
assert.equal(listSessionReports('s1', t0 + 20)[0].state, 'working', 'a stale write changed nothing')
assert.equal(recordSessionReport({ source: 'amp', state: 'blocked', sessionId: 's1', seq: 2, ttlMs: 5000 }, t0 + 30)!.state, 'blocked')
assert.equal(listSessionReports('other', t0 + 40).length, 0)
assert.equal(listSessionReports('s1', t0 + 6000).length, 0, 'a report lapses: a dead agent must not read as working forever')
assert.throws(() => recordSessionReport({ source: ' ', state: 'idle' }), /source is required/)
recordSessionReport({ source: 'x', state: 'idle' }, t0)
assert.equal(clearSessionReport('x'), true); assert.equal(clearSessionReport('x'), false)
console.log('sessionReportsSmoke ok')
