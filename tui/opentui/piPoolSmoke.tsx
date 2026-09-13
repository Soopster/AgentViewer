import assert from 'node:assert/strict'
import { selectPiPoolEvictions } from '../../lib/piClient'

assert.deepEqual(
  selectPiPoolEvictions([
    { sessionId: 'oldest', lastUsed: 1, isStreaming: false },
    { sessionId: 'active', lastUsed: 2, isStreaming: true },
    { sessionId: 'recent', lastUsed: 3, isStreaming: false },
    { sessionId: 'newest', lastUsed: 4, isStreaming: false },
  ]),
  ['oldest'],
)

assert.deepEqual(
  selectPiPoolEvictions([
    { sessionId: 'idle-old', lastUsed: 1, isStreaming: false },
    { sessionId: 'streaming-old', lastUsed: 2, isStreaming: true },
    { sessionId: 'streaming-new', lastUsed: 3, isStreaming: true },
    { sessionId: 'idle-new', lastUsed: 4, isStreaming: false },
    { sessionId: 'newest', lastUsed: 5, isStreaming: false },
  ]),
  ['idle-old', 'idle-new'],
)

assert.deepEqual(
  selectPiPoolEvictions([
    { sessionId: 'streaming-a', lastUsed: 1, isStreaming: true },
    { sessionId: 'streaming-b', lastUsed: 2, isStreaming: true },
    { sessionId: 'streaming-c', lastUsed: 3, isStreaming: true },
    { sessionId: 'streaming-d', lastUsed: 4, isStreaming: true },
  ]),
  [],
)

assert.deepEqual(
  selectPiPoolEvictions([
    { sessionId: 'streaming-a', lastUsed: 1, isStreaming: true },
    { sessionId: 'streaming-b', lastUsed: 2, isStreaming: true },
    { sessionId: 'streaming-c', lastUsed: 3, isStreaming: true },
    { sessionId: 'just-created', lastUsed: 4, isStreaming: false },
  ], 3, 'just-created'),
  [],
)

console.log('Pi session pool smoke passed')
