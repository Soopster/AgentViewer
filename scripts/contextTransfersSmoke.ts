import assert from 'node:assert/strict'
import { mkdtempSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'context-transfers-')))
const { recordContextTransfer, listContextTransfers, sessionLineage, parseContextTransfers } = await import('../lib/contextTransfers')

recordContextTransfer({ type: 'fork', source: { sessionId: 'a', point: 'm1' }, target: { sessionId: 'b' }, strategy: 'native' })
recordContextTransfer({ type: 'failover', source: { sessionId: 'b' }, target: { sessionId: 'c' }, strategy: 'fresh_session', runId: 'r1' })
recordContextTransfer({ type: 'handoff', source: { sessionId: 'x' }, target: { sessionId: '' }, strategy: 'context_handoff' })

assert.equal(listContextTransfers('b').length, 2, 'a session sees transfers into and out of it')
assert.deepEqual(sessionLineage('c').map((t) => [t.source.sessionId, t.target.sessionId, t.type]), [['b', 'c', 'failover'], ['a', 'b', 'fork']], 'lineage walks back to the origin')
assert.deepEqual(sessionLineage('a'), [], 'an origin has no ancestors')
assert.equal(listContextTransfers('x').length, 0, 'an edge with no session id is not recorded')

// A torn final write costs that line, never the history.
appendFileSync(path.join(process.cwd(), '.agent-viewer-data', 'context-transfers.jsonl'), '{"id":"torn","type":"for')
assert.equal(listContextTransfers('b').length, 2)
assert.equal(parseContextTransfers('not json\n').length, 0)

// A lineage cycle terminates.
recordContextTransfer({ type: 'fork', source: { sessionId: 'c' }, target: { sessionId: 'a' }, strategy: 'native' })
assert.ok(sessionLineage('a').length <= 3)
console.log('context transfers smoke: ok')
