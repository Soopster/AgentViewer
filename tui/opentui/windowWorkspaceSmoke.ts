import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSavedWindowLayouts, saveWindowLayout, updateWindowLayout, type WindowLayoutContents } from './windowLayoutStore'
import { computeResponsiveWindowLayout, windowLayoutRects, windowPreviewLines, type WindowLayoutInput } from './windowLayout'
import { planWindowArrangement, planWindowSessionDrop } from './windowOperations'
import { nextWindowNeedingAttention, observeWindowAttention, readWindowAttention, windowAttentionBadge } from './windowAttention'

const originalCwd = process.cwd()
const cwd = mkdtempSync(join(tmpdir(), 'window-workspace-'))
try {
  process.chdir(cwd)
  const contents: WindowLayoutContents = {
    arrangement: 'grid', orientation: 'columns', readerLast: false,
    readerShare: 0.4, secondaryShare: 0.6, bottomShare: 0.7,
    reader: 'a', panes: ['b', 'c', 'd', 'e'], surfaces: ['terminal'],
  }
  const review = saveWindowLayout('project', contents, ' Review ')
  const renamed = updateWindowLayout('project', review.id, { name: 'Debugging' })
  assert.equal(renamed.id, review.id)
  assert.deepEqual(renamed.panes, contents.panes)
  const updated = updateWindowLayout('project', review.id, { layout: { ...contents, panes: ['e', 'c'], readerShare: 0.55 } })
  assert.equal(updated.name, 'Debugging')
  assert.equal(updated.readerShare, 0.55)
  assert.deepEqual(listSavedWindowLayouts('project'), [updated], 'edits persist without duplicating a layout')
  assert.deepEqual(listSavedWindowLayouts('other-project'), [])
  assert.throws(() => updateWindowLayout('project', review.id, { name: '   ' }))
  assert.throws(() => updateWindowLayout('project', 'missing', { layout: contents }))
  assert.deepEqual(listSavedWindowLayouts('project'), [updated], 'rejected edits leave the saved workspace intact')
} finally {
  process.chdir(originalCwd)
  rmSync(cwd, { recursive: true, force: true })
}

const base: WindowLayoutInput = {
  arrangement: 'grid', orientation: 'columns', width: 180, height: 40,
  requestedCount: 5, availableCount: 5, maxPanes: 5,
  readerShare: 0.4, secondaryShare: 0.6, bottomShare: 0.55,
  minReaderWidth: 40, minReaderRows: 12, minPaneWidth: 46, minPaneRows: 9,
}
for (const arrangement of ['split', 'grid', 'main-stack'] as const) {
  for (const orientation of ['columns', 'rows'] as const) {
    for (const readerLast of [false, true]) {
      const input = { ...base, arrangement, orientation }
      const { layout, overflowRows } = computeResponsiveWindowLayout(input)
      const area = { width: input.width, height: input.height - overflowRows }
      const rects = windowLayoutRects(layout, { ...area, orientation, readerLast })
      assert.equal(rects.length, layout.visibleCount + 1)
      assert.equal(rects.reduce((sum, rect) => sum + rect.width * rect.height, 0), area.width * area.height)
      for (let a = 0; a < rects.length; a += 1) {
        const rect = rects[a]!
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= area.width && rect.y + rect.height <= area.height)
        for (let b = a + 1; b < rects.length; b += 1) {
          const other = rects[b]!
          assert.ok(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y, 'preview frames must not overlap')
        }
      }
      const lines = windowPreviewLines(rects, area)
      assert.equal(lines.length, 6)
      assert.ok(lines.every((line) => line.length === 51))
    }
  }
}
const current = { arrangement: 'grid' as const, orientation: 'columns' as const, readerLast: false, count: 5, pins: ['b', 'c', 'd', 'e', 'f'] }
assert.deepEqual(planWindowSessionDrop(current, 'd', { kind: 'replace', index: 0 })?.pins, ['d', 'c', 'b', 'e', 'f'])
assert.deepEqual(planWindowSessionDrop(current, 'f', { kind: 'insert', index: 0, edge: 'right' })?.pins, ['b', 'f', 'c', 'd', 'e'], 'moving a pane retains hidden neighbours')
assert.equal(planWindowSessionDrop(current, 'g', { kind: 'insert', index: 0, edge: 'right' }), null)
assert.equal(planWindowArrangement('grid-six', current, 2).count, 2, 'preview only sessions that can be filled')
assert.equal(planWindowArrangement('reader-bottom', current, 5).readerLast, true)

let attention = observeWindowAttention(undefined, 'metadata', '1', null, false)
assert.equal(attention.unread, false, 'initial contents do not count as new output')
assert.equal(observeWindowAttention(attention, 'metadata', '1', null, false), attention)
attention = observeWindowAttention(attention, 'transcript', 'initial', null, false)
assert.equal(attention.unread, false, 'adding a second observation source is not new output')
attention = observeWindowAttention(attention, 'metadata', '2', null, false)
assert.equal(attention.unread, true)
attention = observeWindowAttention(attention, 'transcript', 'failed', 'tool-failed', false)
assert.equal(attention.error, true)
attention = readWindowAttention(attention)
assert.equal(attention.unread, false)
assert.equal(attention.error, false)
assert.equal(observeWindowAttention(attention, 'transcript', 'failed', 'tool-failed', false), attention, 'an acknowledged error must not reappear on an idle poll')
attention = observeWindowAttention(attention, 'transcript', 'new', null, true)
assert.equal(attention.unread, false, 'output in the focused window is already read')
assert.equal(windowAttentionBadge({ needsInput: true, error: true, unread: true }), '? input · ! error · ● unread')
assert.equal(nextWindowNeedingAttention(['a', 'b', 'c'], 'b', (key) => key === 'a' || key === 'c'), 'c')
assert.equal(nextWindowNeedingAttention(['a', 'b', 'c'], 'c', (key) => key === 'b'), 'b')
assert.equal(nextWindowNeedingAttention(['a', 'b'], 'a', () => false), null)
console.log('Editable layouts persist; previews tile the resulting geometry; attention acknowledges output without repeated badges.')
