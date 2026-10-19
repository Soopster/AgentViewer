// Window arrangements as arithmetic: every frame fits the area, the reader and
// panes share it without overlap or gap, and a layout that does not fit drops
// panes before it shrinks anything below its minimum. The App draws exactly
// these sizes, so a wrong sum here is a pane drawn over another one.
import assert from 'node:assert/strict'
import { computeWindowLayout, readerShareAt, windowDropZone, windowDropZoneRect, type WindowLayoutInput } from './windowLayout'
import { SPLIT_SHARE_EVEN } from './splitPaneState'

const base: WindowLayoutInput = {
  arrangement: 'grid', orientation: 'columns', width: 180, height: 40, requestedCount: 3, availableCount: 3, maxPanes: 3,
  readerShare: SPLIT_SHARE_EVEN, minPaneWidth: 46, minPaneRows: 9, minReaderWidth: 40, minReaderRows: 12,
}

const grid = computeWindowLayout(base)
assert.equal(grid.visibleCount, 3)
assert.equal(grid.reader.width + grid.panes[0]!.width, 180, 'the top row is the whole width')
assert.equal(grid.reader.height + grid.panes[1]!.height, 40, 'the two rows are the whole height')
assert.equal(grid.panes[1]!.width + grid.panes[2]!.width, 180, 'the bottom row is the whole width')
assert.equal(grid.reader.height, grid.panes[0]!.height, 'the reader and its neighbour share the top row')

const short = computeWindowLayout({ ...base, height: 18 })
assert.equal(short.visibleCount, 1, 'a grid with no room for a second row keeps one pane beside the reader')
assert.equal(short.reader.height, 18)

const stack = computeWindowLayout({ ...base, arrangement: 'main-stack', requestedCount: 3 })
assert.equal(stack.visibleCount, 3)
assert.equal(stack.panes.reduce((sum, pane) => sum + pane.height, 0), 40, 'the stack fills the column')
assert.ok(stack.panes.every((pane) => pane.width === stack.panes[0]!.width), 'the stack is one column')
assert.equal(stack.reader.width + stack.panes[0]!.width, 180)
assert.ok(stack.reader.width > stack.panes[0]!.width, 'main + stack gives the reader the larger share by default')

const crowded = computeWindowLayout({ ...base, arrangement: 'main-stack', height: 20 })
assert.equal(crowded.visibleCount, 2, 'a stack drops panes that would be shorter than their minimum')

const narrow = computeWindowLayout({ ...base, width: 70 })
assert.equal(narrow.visibleCount, 0, 'too narrow for the reader and a pane: no panes, not a squeezed reader')
assert.equal(narrow.reader.width, 70)

const split = computeWindowLayout({ ...base, arrangement: 'split', requestedCount: 1 })
assert.equal(split.reader.width + split.panes[0]!.width, 180, 'split keeps the tmux arithmetic')
console.log('Grid, main + stack and split tile the area exactly and drop panes before squeezing.')

const area = { x: 10, y: 5, width: 100, height: 40 }
assert.equal(windowDropZone(area, { x: 12, y: 25 }), 'left')
assert.equal(windowDropZone(area, { x: 108, y: 25 }), 'right')
assert.equal(windowDropZone(area, { x: 60, y: 6 }), 'top')
assert.equal(windowDropZone(area, { x: 60, y: 44 }), 'bottom')
assert.equal(windowDropZone(area, { x: 60, y: 25 }), 'center')
assert.equal(windowDropZone(area, { x: 9, y: 25 }), null, 'outside the area is no drop')
assert.equal(windowDropZone(area, { x: 13, y: 6 }), 'top', 'a corner goes to the nearer edge')
assert.equal(windowDropZone(area, { x: 13, y: 7 }), 'left', 'a corner goes to the nearer edge')
assert.deepEqual(windowDropZoneRect(area, 'right'), { x: 60, y: 5, width: 50, height: 40 })
assert.equal(readerShareAt(area, 40, 'x', false), 0.3)
assert.equal(readerShareAt(area, 40, 'x', true), 0.7, 'a reader on the right grows as the divider moves left')
console.log('Drops land on the nearest edge or the middle; a dragged divider maps to a share.')
console.log('Window layout smoke passed')
