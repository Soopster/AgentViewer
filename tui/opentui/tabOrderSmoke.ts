// Pinned tabs sit first in their own order; a move never crosses the pinned boundary.
import assert from 'node:assert/strict'
import { moveTabKey, orderTabs, togglePinnedKey } from './tabOrder'

const keys = ['a', 'b', 'c', 'd', 'e']
const id = (key: string) => key
assert.deepEqual(orderTabs(keys, id, new Set()), keys, 'nothing pinned: untouched')
assert.deepEqual(orderTabs(keys, id, new Set(['d', 'b'])), ['b', 'd', 'a', 'c', 'e'], 'pinned first, each group keeps its order')
const pinned = new Set(['b', 'd'])
assert.deepEqual(moveTabKey(keys, 'e', -1, new Set()), ['a', 'b', 'c', 'e', 'd'])
assert.deepEqual(moveTabKey(keys, 'a', -1, new Set()), keys, 'the first tab cannot move left')
assert.deepEqual(moveTabKey(keys, 'e', 1, new Set()), keys, 'the last tab cannot move right')
// With b and d pinned the strip reads b d a c e: d swaps with b, but cannot move into the unpinned group.
assert.deepEqual(moveTabKey(keys, 'd', -1, pinned), ['d', 'b', 'a', 'c', 'e'])
assert.deepEqual(moveTabKey(keys, 'd', 1, pinned), keys, 'a pinned tab stops at the boundary: nothing changes')
assert.deepEqual(moveTabKey(keys, 'a', -1, pinned), keys, 'an unpinned tab stops at the boundary: nothing changes')
assert.deepEqual(moveTabKey(keys, 'a', 1, pinned), ['b', 'd', 'c', 'a', 'e'])
assert.deepEqual(togglePinnedKey(['a'], 'b'), ['a', 'b'])
assert.deepEqual(togglePinnedKey(['a', 'b'], 'a'), ['b'])
console.log('Tab order smoke passed (pinned first, stable groups, boundary, toggle)')
