import assert from 'node:assert/strict'

import {
  buildTimelineRowLayout,
  computeTimelineScrollCompensation,
  findTimelineScrollAnchor,
  getVirtualTimelineWindow,
  resolveTimelineRenderedHeight,
} from '../lib/timelineVirtualizer.ts'

const rows = Array.from({ length: 20 }, (_, index) => ({
  key: `row-${index}`,
  estimate: 100 + (index % 3) * 25,
}))

const measuredHeights = new Map([
  ['row-2', 420],
  ['row-8', 60],
])

const layout = buildTimelineRowLayout(rows, measuredHeights, (row) => row.estimate)

assert.equal(layout.heights[2], 420, 'measured heights should replace estimates')
assert.equal(layout.heights[8], 60, 'measured short rows should replace estimates')
assert.equal(layout.indexByKey.get('row-8'), 8, 'layout should index rows by key')
assert.equal(
  layout.totalHeight,
  rows.reduce((total, row) => total + (measuredHeights.get(row.key) ?? row.estimate), 0),
  'layout total should include estimates and measurements',
)

const anchor = findTimelineScrollAnchor(rows, layout, layout.tops[7] + 12)
assert.deepEqual(
  anchor,
  { index: 7, key: 'row-7', offset: 12 },
  'anchor should identify the row occupying scrollTop and preserve its in-row offset',
)

const changes = [
  { index: 1, previousHeight: 100, nextHeight: 180 },
  { index: 7, previousHeight: 125, nextHeight: 260 },
  { index: 10, previousHeight: 125, nextHeight: 20 },
]

assert.equal(
  computeTimelineScrollCompensation(changes, anchor),
  80,
  'only changes strictly above the anchor row should compensate scrollTop',
)

const virtualWindow = getVirtualTimelineWindow({
  layout,
  rowCount: rows.length,
  scrollTop: layout.tops[7] + 20,
  viewportHeight: 300,
  overscanPx: 150,
})

assert.ok(virtualWindow.startIndex < 7, 'overscan should include rows above the viewport')
assert.ok(virtualWindow.endIndex > 7, 'visible window should include the anchor row')
assert.ok(virtualWindow.endIndex <= rows.length, 'visible window should not exceed row count')
assert.equal(virtualWindow.totalHeight, layout.totalHeight, 'virtual window should report measured total height')

assert.equal(
  resolveTimelineRenderedHeight({
    measuredTotalHeight: 2_000,
    activeScrollHeight: 2_500,
    visibleBottom: 2_200,
  }),
  2_500,
  'active user scroll should keep the prior spacer height stable',
)

assert.equal(
  resolveTimelineRenderedHeight({
    measuredTotalHeight: 2_800,
    activeScrollHeight: 2_500,
    visibleBottom: 2_900,
  }),
  2_900,
  'stable spacer height should still grow enough to contain visible rows',
)

assert.equal(
  resolveTimelineRenderedHeight({
    measuredTotalHeight: 2_800,
    activeScrollHeight: null,
    visibleBottom: 2_900,
  }),
  2_800,
  'idle rendering should use the current measured total height',
)

console.log('timeline virtualizer checks passed')
