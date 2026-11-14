// Window arrangements as arithmetic: every frame fits the area, the reader and
// panes share it without overlap or gap, and a layout that does not fit drops
// panes before it shrinks anything below its minimum. The App draws exactly
// these sizes, so a wrong sum here is a pane drawn over another one.
import assert from 'node:assert/strict'
import { computeWindowLayout, distributeExtent, computeResponsiveWindowLayout, readerShareAt, windowDropZone, windowDropZoneRect, windowInDirection, type WindowLayoutInput } from './windowLayout'
import { WindowHistory } from './windowHistory'
import { SPLIT_SHARE_EVEN } from './splitPaneState'

const base: WindowLayoutInput = {
  arrangement: 'grid', orientation: 'columns', width: 180, height: 40, requestedCount: 3, availableCount: 3, maxPanes: 3,
  readerShare: SPLIT_SHARE_EVEN, minPaneWidth: 46, minPaneRows: 9, minReaderWidth: 40, minReaderRows: 12,
}

// Reserving the overflow strip can itself push another pane out. Refit once
// against the smaller budget; never mutate the requested layout to make it fit.
{
  const requested = { ...base, arrangement: 'main-stack' as const, height: 18 }
  const small = computeResponsiveWindowLayout(requested)
  assert.equal(small.overflowRows, 1)
  assert.equal(small.layout.visibleCount, 1)
  assert.equal(small.layout.reader.height, 17)
  assert.equal(requested.requestedCount, 3)
  const restored = computeResponsiveWindowLayout({ ...requested, height: 40 })
  assert.equal(restored.overflowRows, 0)
  assert.equal(restored.layout.visibleCount, 3)
  for (const arrangement of ['split', 'grid', 'main-stack'] as const) {
    assert.equal(computeResponsiveWindowLayout({ ...base, arrangement, height: 8 }).layout.visibleCount, 0)
    assert.equal(computeResponsiveWindowLayout({ ...base, arrangement, width: 60 }).layout.visibleCount, 0)
  }
  const history = new WindowHistory<{ order: string[]; share: number }>(JSON.stringify, 2)
  const a = { order: ['a', 'b', 'c'], share: 0 }
  const b = { order: ['a', 'c'], share: 0 }
  const c = { order: ['c', 'a'], share: 0.6 }
  history.checkpoint(a)
  history.checkpoint(a) // nested operation
  history.checkpoint(b)
  history.checkpoint(c) // rejected/no-op operation
  assert.deepEqual(history.undo(c), b, 'skip no-ops, restore the previous logical order')
  assert.equal(history.undo(b), null, 'history is bounded')
  history.checkpoint(a)
  assert.deepEqual(history.undo(c), a)
  assert.equal(history.undo(a), null)
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

// The second divider: the grid's row split, and a stack's first pane.
{
  const tall = computeWindowLayout({ ...base, secondaryShare: 0.7 })
  assert.equal(tall.reader.height, 28, 'the grid top row follows its divider')
  assert.equal(tall.reader.height + tall.panes[1]!.height, 40)
  const clamped = computeWindowLayout({ ...base, secondaryShare: 0.95 })
  assert.equal(clamped.panes[1]!.height, 9, 'the bottom row keeps its minimum however far the divider goes')
  const stacked = computeWindowLayout({ ...base, arrangement: 'main-stack', secondaryShare: 0.5 })
  assert.equal(stacked.panes[0]!.height, 20, 'a stack\'s first pane follows its divider')
  assert.equal(stacked.panes.reduce((sum, pane) => sum + pane.height, 0), 40, 'and the stack still fills the column')
  assert.ok(stacked.panes.slice(1).every((pane) => pane.height >= 9), 'the rest keep their minimum')
  console.log('The second divider sizes the grid\'s rows and a stack\'s first pane, within their minimums.')
}

// Focus by direction, over a grid: reader top-left, panes top-right, bottom-left, bottom-right.
{
  type Window = { id: string | number; rect: { x: number; y: number; width: number; height: number } }
  const windows: Window[] = [
    { id: 'reader', rect: { x: 0, y: 0, width: 90, height: 20 } },
    { id: 0, rect: { x: 90, y: 0, width: 90, height: 20 } },
    { id: 1, rect: { x: 0, y: 20, width: 90, height: 20 } },
    { id: 2, rect: { x: 90, y: 20, width: 90, height: 20 } },
  ]
  assert.equal(windowInDirection(windows, 'reader', 'right'), 0)
  assert.equal(windowInDirection(windows, 'reader', 'down'), 1, 'down from the reader is the pane under it, not the diagonal one')
  assert.equal(windowInDirection(windows, 2, 'left'), 1)
  assert.equal(windowInDirection(windows, 2, 'up'), 0)
  assert.equal(windowInDirection(windows, 'reader', 'left'), null, 'nothing beyond the edge')
  // A stack: the reader beside three panes; right from the reader goes to the one level with its middle.
  const stack: Window[] = [
    { id: 'reader', rect: { x: 0, y: 0, width: 100, height: 30 } },
    { id: 0, rect: { x: 100, y: 0, width: 80, height: 10 } },
    { id: 1, rect: { x: 100, y: 10, width: 80, height: 10 } },
    { id: 2, rect: { x: 100, y: 20, width: 80, height: 10 } },
  ]
  assert.equal(windowInDirection(stack, 'reader', 'right'), 1)
  assert.equal(windowInDirection(stack, 2, 'left'), 'reader')
  // Rows that split differently: right from the bottom-right pane is nothing, not the top row's end.
  const uneven: Window[] = [
    { id: 'reader', rect: { x: 0, y: 0, width: 60, height: 20 } },
    { id: 0, rect: { x: 60, y: 0, width: 60, height: 20 } },
    { id: 1, rect: { x: 120, y: 0, width: 62, height: 20 } },
    { id: 2, rect: { x: 0, y: 20, width: 60, height: 20 } },
    { id: 3, rect: { x: 60, y: 20, width: 60, height: 20 } },
    { id: 4, rect: { x: 120, y: 20, width: 60, height: 20 } },
  ]
  assert.equal(windowInDirection(uneven, 4, 'right'), null, 'a slightly wider pane above is not "to the right"')
  assert.equal(windowInDirection(uneven, 4, 'up'), 1)
  console.log('Focus moves to the window in the direction asked, preferring the one directly beside.')
}

// Up to five panes: the grid grows a third column, and drops panes the width cannot hold.
{
  const five = computeWindowLayout({ ...base, width: 240, requestedCount: 5, availableCount: 5, maxPanes: 5 })
  assert.equal(five.visibleCount, 5)
  assert.equal(five.topPanes, 2, 'reader and two panes on top')
  assert.equal(five.reader.width + five.panes[0]!.width + five.panes[1]!.width, 240, 'the top row fills the width')
  assert.equal(five.panes[2]!.width + five.panes[3]!.width + five.panes[4]!.width, 240, 'the bottom row fills the width')
  const four = computeWindowLayout({ ...base, width: 240, requestedCount: 4, availableCount: 4, maxPanes: 5 })
  assert.equal(four.topPanes, 2)
  assert.equal(four.panes.length, 4, 'three on top, two below')
  const cramped = computeWindowLayout({ ...base, width: 120, requestedCount: 5, availableCount: 5, maxPanes: 5 })
  assert.ok(cramped.visibleCount < 5 && cramped.panes.every((pane) => pane.width >= 46), 'a narrow grid drops panes before any falls below its minimum')
  const stack5 = computeWindowLayout({ ...base, arrangement: 'main-stack', height: 60, requestedCount: 5, availableCount: 5, maxPanes: 5 })
  assert.equal(stack5.visibleCount, 5)
  assert.equal(stack5.panes.reduce((sum, pane) => sum + pane.height, 0), 60)
  console.log('The grid and the stack take up to five panes, dropping what will not fit.')
}

// The bottom row's own divider.
{
  const wide = computeWindowLayout({ ...base, bottomShare: 0.7 })
  assert.equal(wide.panes[1]!.width, 126, 'the bottom row\'s first pane follows its divider')
  assert.equal(wide.panes[1]!.width + wide.panes[2]!.width, 180, 'and the row still fills the width')
  const squeezed = computeWindowLayout({ ...base, bottomShare: 0.95 })
  assert.equal(squeezed.panes[2]!.width, 46, 'the last pane keeps its minimum')
  const six = computeWindowLayout({ ...base, width: 240, requestedCount: 5, availableCount: 5, maxPanes: 5, bottomShare: 0.5 })
  assert.equal(six.panes[2]!.width, 120, 'with three below, the first takes the share')
  assert.equal(six.panes[2]!.width + six.panes[3]!.width + six.panes[4]!.width, 240)
  assert.equal(computeWindowLayout({ ...base, bottomShare: 0.7 }).reader.width, grid.reader.width, 'the bottom divider leaves the top row alone')
  console.log('The bottom row has its own divider, within its panes\' minimums.')
}

// Every shared border: each group of panes is divided by its own weights.
{
  assert.deepEqual(distributeExtent(100, 3, [2, 1, 1], 10), [50, 25, 25], 'weights divide the extent')
  assert.deepEqual(distributeExtent(100, 3, [10, 1, 1], 20), [60, 20, 20], 'a frame below its minimum is held at it')
  assert.equal(distributeExtent(101, 3, undefined, 10).reduce((a, b) => a + b, 0), 101, 'rounding still fills the extent')
  const split = computeWindowLayout({ ...base, arrangement: 'split', width: 240, requestedCount: 2, availableCount: 2, maxPanes: 2, weights: { split: [3, 1] } })
  assert.ok(split.panes[0]!.width > split.panes[1]!.width && split.groups[0]?.key === 'split', `a split divides its panes by weight: ${JSON.stringify(split.panes)}`)
  const stack = computeWindowLayout({ ...base, arrangement: 'main-stack', height: 60, weights: { stack: [1, 2, 1] } })
  assert.deepEqual(stack.panes.map((pane) => pane.height), [15, 30, 15], 'a stack divides its column by weight')
  assert.deepEqual(stack.groups, [{ key: 'stack', axis: 'y', members: [0, 1, 2] }])
  const six = computeWindowLayout({ ...base, width: 240, requestedCount: 5, availableCount: 5, maxPanes: 5, weights: { gridTop: [1, 3], gridBottom: [1, 1, 2] } })
  assert.ok(six.panes[1]!.width > six.panes[0]!.width * 2, 'the grid\'s top row divides by weight')
  assert.equal(six.panes[4]!.width, 120, 'the bottom row divides by weight')
  assert.deepEqual(six.groups.map((group) => group.key), ['gridTop', 'gridBottom'])
  assert.deepEqual(six.groups[1]!.members, [2, 3, 4], 'groups name panes by their index')
  const legacy = computeWindowLayout({ ...base, bottomShare: 0.7, weights: { gridBottom: [1, 1] } })
  assert.equal(legacy.panes[1]!.width, 90, 'weights win over the older bottom share')
  console.log('Every group of panes is divided by its own weights, within minimums.')
}
console.log('Window layout smoke passed')
