import assert from 'node:assert/strict'

import {
  calculateSplitPaneBodyRows,
  calculateSplitPaneLayout,
  groupItemsBySplitPaneKey,
  preserveArrayIdentity,
  removeSplitPaneKey,
  splitCommandKey,
} from './splitPaneState'

const paneA = { sessionKey: 'claude:a', text: 'A' }
const paneB = { sessionKey: 'codex:b', text: 'B' }
const grouped = groupItemsBySplitPaneKey(
  [paneA.sessionKey, paneB.sessionKey],
  [paneA, paneB],
  (item) => item.sessionKey,
  new Map(),
)
assert.deepEqual(grouped.get(paneA.sessionKey), [paneA])
assert.deepEqual(grouped.get(paneB.sessionKey), [paneB])

const unchanged = [paneA, paneB]
assert.equal(preserveArrayIdentity(unchanged, [paneA, paneB]), unchanged)
assert.notEqual(
  preserveArrayIdentity(unchanged, [paneA, { ...paneB, text: 'updated' }]),
  unchanged,
)

assert.deepEqual(removeSplitPaneKey(['pane-1', 'pane-2'], 0), ['pane-2'])
assert.deepEqual(removeSplitPaneKey(['pane-1', 'pane-2'], 1), ['pane-1'])
assert.equal(splitCommandKey('%', false), '⌃B %')
assert.equal(splitCommandKey('%', true), '? palette')

const firstPaneLayout = calculateSplitPaneLayout({
  readerAreaWidth: 130,
  requestedCount: 1,
  availableCount: 1,
  maxPanes: 2,
  minPaneWidth: 46,
  minReaderWidth: 40,
})
assert.equal(firstPaneLayout.visibleCount, 1)
assert.ok(firstPaneLayout.paneWidth >= 46)

const twoPaneLayout = calculateSplitPaneLayout({
  readerAreaWidth: 200,
  requestedCount: 2,
  availableCount: 2,
  maxPanes: 2,
  minPaneWidth: 46,
  minReaderWidth: 40,
})
assert.equal(twoPaneLayout.visibleCount, 2)

// Focus styling must never resize a pane's scroll viewport. The action row is
// permanently reserved, leaving the same body height before and after focus
// navigation; a live-status row remains the only intentional height change.
assert.equal(calculateSplitPaneBodyRows(40, 0), 35)
assert.equal(calculateSplitPaneBodyRows(40, 1), 34)
assert.equal(calculateSplitPaneBodyRows(6, 0), 3)

console.log('Split pane state routing, identity, viewport stability, close targeting, and layout passed')
