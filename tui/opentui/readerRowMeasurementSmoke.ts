import assert from 'node:assert/strict'
import { BoxRenderable, LayoutEvents } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { measureReaderRowHeights } from './readerLayout'
import { RowHeightIndex } from './rowHeightIndex'

// Layout-changed runs before OpenTUI publishes y/height screen properties.
// Resizing/expanding a row must update the virtual window's index in that
// frame, rather than wait for some unrelated future layout to correct it.
const setup = await createTestRenderer({ width: 80, height: 24 })
const first = new BoxRenderable(setup.renderer, { height: 2, marginBottom: 1 })
const second = new BoxRenderable(setup.renderer, { height: 3 })
setup.renderer.root.add(first)
setup.renderer.root.add(second)
await setup.flush()
const index = new RowHeightIndex([100, 100, 100, 100])
let measurements = 0
let expectedFirst = 2
const measure = () => {
  measurements++
  measureReaderRowHeights([first, second], 1, index, 1)
  assert.equal(index.height(1), expectedFirst + 1, 'index must see current Yoga height during the layout event')
  assert.equal(index.height(2), 4, 'trailing row includes the card gap')
  assert.equal(index.height(0), 100, 'mounted offset preserves earlier estimates')
  assert.equal(index.height(3), 100, 'unmounted tail preserves its estimate')
}
setup.renderer.root.on(LayoutEvents.LAYOUT_CHANGED, measure)
try {
  expectedFirst = 8
  first.height = expectedFirst
  await setup.flush()
  assert(measurements > 0, 'fixture must exercise a native layout event')
  const afterGrow = measurements
  expectedFirst = 1
  first.height = expectedFirst
  await setup.flush()
  assert(measurements > afterGrow, 'shrinking must also exercise native layout')
  assert.equal(index.offset(3), 106)
  measureReaderRowHeights([], 0, index, 1)
  assert.equal(index.offset(3), 106, 'empty mounted window preserves estimates')
  console.log('Reader row measurement smoke passed (same-frame growth/shrink, gaps, mounted offset)')
} finally {
  setup.renderer.root.off(LayoutEvents.LAYOUT_CHANGED, measure)
  await setup.dispose()
}
