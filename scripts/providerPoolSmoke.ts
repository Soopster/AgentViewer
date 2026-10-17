import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { selectAcpPoolEvictions } from '../lib/acpClientPool'
import {
  dispatchClaudeBufferedMessages,
  selectClaudePoolEvictions,
} from '../lib/claudePool'
import { selectCopilotPoolEvictions } from '../lib/copilotClient'
import { selectPiPoolEvictions } from '../lib/piClient'
import { selectIdleProviderPoolEvictions } from '../lib/providerPoolPolicy'

const sharedFixture = [
  { key: 'active-old', lastUsed: 1, active: true },
  { key: 'idle-old', lastUsed: 2, active: false },
  { key: 'active-new', lastUsed: 3, active: true },
  { key: 'idle-mid', lastUsed: 4, active: false },
  { key: 'protected', lastUsed: 5, active: false },
  { key: 'idle-new', lastUsed: 6, active: false },
]
assert.deepEqual(
  selectIdleProviderPoolEvictions(sharedFixture, 3, 'protected'),
  ['idle-old', 'idle-mid', 'idle-new'],
  'a soft-cap recovery should evict every required idle entry in LRU order',
)
assert.deepEqual(
  selectIdleProviderPoolEvictions(sharedFixture.filter((entry) => entry.active), 0),
  [],
  'active provider turns must never be selected for eviction',
)

assert.deepEqual(selectClaudePoolEvictions([
  { poolKey: 'old', lastActivityAt: 1, inTurn: false },
  { poolKey: 'busy', lastActivityAt: 2, inTurn: true },
  { poolKey: 'new', lastActivityAt: 3, inTurn: false },
], 2, 'new'), ['old'])

assert.deepEqual(selectCopilotPoolEvictions([
  { sessionId: 'old', lastUsed: 1, activeUses: 0 },
  { sessionId: 'busy', lastUsed: 2, activeUses: 2 },
  { sessionId: 'new', lastUsed: 3, activeUses: 0 },
], 2, 'new'), ['old'])

assert.deepEqual(selectPiPoolEvictions([
  { sessionId: 'old', lastUsed: 1, isStreaming: false },
  { sessionId: 'busy', lastUsed: 2, isStreaming: true },
  { sessionId: 'new', lastUsed: 3, isStreaming: false },
], 2, 'new'), ['old'])

assert.deepEqual(selectAcpPoolEvictions([
  { sessionId: 'old', lastActivityAt: 1, inTurn: false },
  { sessionId: 'busy', lastActivityAt: 2, inTurn: true },
  { sessionId: 'new', lastActivityAt: 3, inTurn: false },
], 2, 'new'), ['old'])

const phases: string[] = []
dispatchClaudeBufferedMessages(
  [{ type: 'result' } as never],
  {
    onMessage: () => phases.push('current'),
    onBufferedMessage: () => phases.push('buffered'),
  },
)
assert.deepEqual(
  phases,
  ['buffered'],
  'buffered Claude results must not enter the new turn boundary handler',
)

const candidates = Array.from({ length: 10_000 }, (_, index) => ({
  key: `session-${index}`,
  lastUsed: index,
  active: index % 3 === 0,
}))
const startedAt = performance.now()
const selected = selectIdleProviderPoolEvictions(candidates, 8)
const elapsedMs = performance.now() - startedAt
assert.equal(selected.length, candidates.filter((entry) => !entry.active).length)
assert.ok(elapsedMs < 100, `provider pool eviction selection took ${elapsedMs.toFixed(2)}ms`)

console.log(`provider pool smoke passed (${elapsedMs.toFixed(2)}ms for 10k candidates)`)
