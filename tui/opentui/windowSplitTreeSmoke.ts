import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeWindowSplitTree, reconcileWindowSplitTree, splitTreeFromRects, splitWindowLeaf, validWindowSplitTree, type WindowSplitTree } from './windowSplitTree'
import { computeWindowLayout, windowLayoutRects } from './windowLayout'
import { saveWindowLayout, listSavedWindowLayouts } from './windowLayoutStore'
import { SpacesController } from './spacesStore'
import { overviewRows, workspaceOverview } from './workspaceOverviewData'

const limits = { paneWidth: 30, paneRows: 6, readerWidth: 40, readerRows: 8 }
for (const arrangement of ['split', 'main-stack', 'grid'] as const) for (const readerLast of [false, true]) {
  const layout = computeWindowLayout({ arrangement, orientation: 'columns', width: 220, height: 48, requestedCount: 3, availableCount: 3, maxPanes: 5, readerShare: 0, minPaneWidth: 30, minPaneRows: 6, minReaderWidth: 40, minReaderRows: 8 })
  const rects = windowLayoutRects(layout, { width: 220, height: 48, orientation: 'columns', readerLast })
  const tree = { keys: rects.slice(1).map((_, i) => `window-${i}`), root: splitTreeFromRects(rects.map((rect, i) => ({ ...rect, slot: i - 1 }))) }
  assert.ok(validWindowSplitTree(tree))
  const computed = computeWindowSplitTree(tree, 220, 48, limits)
  rects.forEach((rect, i) => assert.deepEqual(computed.rects.get(i - 1), rect, `preset conversion ${arrangement} readerLast=${readerLast}`))
}
let tree: WindowSplitTree = { root: { slot: -1 }, keys: [] }
for (let slot = 0; slot < 12; slot++) {
  tree = { root: splitWindowLeaf(tree.root, slot - 1, slot, slot % 2 ? 'y' : 'x'), keys: [...tree.keys, `w${slot}`] }
  assert.ok(validWindowSplitTree(tree))
  for (const [width, height] of [[300, 100], [120, 40], [60, 20], [20, 5]]) {
    const before = JSON.stringify(tree)
    const computed = computeWindowSplitTree(tree, width!, height!, limits)
    const rects = [...computed.rects.values()]
    assert.equal(rects.reduce((sum, rect) => sum + rect.width * rect.height, 0), width! * height!, 'leaves tile all available cells')
    for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'leaves do not overlap')
    assert.equal(JSON.stringify(tree), before, 'responsive fitting preserves the logical tree')
  }
}
const closed = reconcileWindowSplitTree(tree, tree.keys.filter(key => key !== 'w2'))
assert.ok(validWindowSplitTree(closed), 'closing an interior window collapses and renumbers its branch')
assert.ok(!validWindowSplitTree({ ...tree, root: { slot: 0 } }), 'invalid persisted trees fail validation')

const cwd = mkdtempSync(path.join(tmpdir(), 'av-split-tree-'))
process.chdir(cwd)
saveWindowLayout(cwd, { arrangement: 'grid', orientation: 'columns', readerLast: false, readerShare: 0, secondaryShare: 0, reader: null, panes: [], surfaces: [], splitTree: tree }, 'Mixed')
assert.deepEqual(listSavedWindowLayouts(cwd)[0]!.splitTree, tree, 'saved layouts round-trip the tree')
const controller = new SpacesController(cwd)
const space = controller.getSnapshot().spaces[0]!
const first = space.workspaces[0]!
controller.runtime(first).set('windowSurfaces', ['terminal'])
controller.runtime(first).set('windowStacks', [['surface:terminal', 'surface:files']])
controller.runtime(first).set('windowAttention', new Map([['surface:terminal', { error: true }]]))
controller.runtime(first).set('windowOverviewWindows', [{ key: 'reader', title: 'Lead', detail: 'reader', hidden: false }, { key: 'surface:terminal', title: 'Build shell', detail: 'shell', hidden: true, badge: '!', tabs: [{ key: 'surface:files', title: 'Files tab', detail: 'tab', hidden: true }] }])
const second = controller.addWorkspace(space.id)!
controller.runtime(second).set('windowOverviewWindows', [{ key: 'reader', title: 'Review', detail: 'reader', hidden: false }])
const nodes = workspaceOverview(controller)
const rows = overviewRows(nodes, new Set(), '')
assert.ok(rows.some(row => row.target === 'surface:files' && row.depth === 3), 'tabs appear below windows')
assert.ok(rows.some(row => row.title.includes('! Build shell') && row.detail.includes('hidden')), 'hidden windows retain attention indicators')
const matches = overviewRows(nodes, new Set([`space:${space.id}`]), 'Files tab')
assert.ok(matches.some(row => row.target === 'surface:files'), 'search expands matching descendants')
assert.ok(!matches.some(row => row.title === 'Review'), 'search excludes unrelated workspaces')
assert.equal(overviewRows(nodes, new Set([`space:${space.id}`]), '').length, 1, 'branches collapse')
controller.runtime(first).get('windowSplitTree', tree, true)
controller.flush()
const restored = new SpacesController(cwd)
const restoredWorkspace = restored.getSnapshot().spaces[0]!.workspaces.find(workspace => workspace.id === first.id)!
assert.deepEqual(restored.runtime(restoredWorkspace).get('windowSplitTree', null, true), tree, 'workspace persistence round-trips the split tree')
console.log('Split tree and workspace overview smoke passed (preset conversion, mixed splits, geometry, responsive preservation, close, persistence, tabs, attention, search, folding)')

// A layout can consist entirely of ordinary session or surface panes.
const { arrangePaneTree, removePrimaryWindow, replacePrimaryWindow, movePaneToEdge, swapPaneSlots } = await import('./windowSplitTree')
const { evenWindowSplitTree } = await import('./windowSplitTree')
const threeAcross = arrangePaneTree(['a', 'b', 'c'], false, 'columns')!
const equalized = computeWindowSplitTree({ ...threeAcross, root: evenWindowSplitTree(threeAcross.root) }, 300, 40, limits)
assert.deepEqual([...equalized.rects.values()].map(rect => rect.width), [100, 100, 100], 'equalize sizes three panes evenly')
for (const style of ['columns', 'rows', 'grid', 'stack'] as const) {
  const generic = arrangePaneTree(['session:a', 'surface:terminal', 'session:b'], false, style, 1)!
  assert.ok(validWindowSplitTree(generic))
  for (const [width, height] of [[300, 80], [90, 24], [20, 5]]) {
    const geometry = computeWindowSplitTree(generic, width!, height!, limits)
    assert.ok(!geometry.rects.has(-1), 'no reserved frame')
    assert.equal([...geometry.rects.values()].reduce((area, rect) => area + rect.width * rect.height, 0), width! * height!)
  }
  assert.ok(validWindowSplitTree(movePaneToEdge(generic, 1, 'left')))
  assert.ok(validWindowSplitTree(swapPaneSlots(generic, 0, 2)))
}
const legacy = arrangePaneTree(['session:b', 'surface:terminal'], true, 'grid')!
assert.ok(validWindowSplitTree(removePrimaryWindow(legacy)))
assert.ok(validWindowSplitTree(replacePrimaryWindow(legacy, 'surface:terminal')))
assert.equal(arrangePaneTree([], false, 'grid'), null, 'empty workspaces have no artificial frame')
console.log('Ordinary panes arithmetic passed (no reserved frame, responsive fitting, placement, swapping, legacy conversion)')
