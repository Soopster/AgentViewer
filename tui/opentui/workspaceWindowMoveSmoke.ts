import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SpacesController } from './spacesStore'
import { moveWorkspaceWindow } from './workspaceWindowMove'
import { readAllScreenText } from './shellScreen'
import { WindowHistory } from './windowHistory'
import { placeWindowSplit, computeWindowSplitTree, validWindowSplitTree, type WindowSplitTree } from './windowSplitTree'
import { closeWorkspaceResources, workspaceResources } from './workspaceResources'
import { startShell, reassignShell, getShells, writeShell, shellTerminal, resetShellsForTest } from './shellStore'

const cwd = mkdtempSync(path.join(tmpdir(), 'av-window-move-'))
const controller = new SpacesController(cwd)
const source = controller.activeWorkspace()!, space = controller.activeSpace()!
const destination = controller.addWorkspace(space.id)!
const a = controller.runtime(source), b = controller.runtime(destination)
const set = (runtime: typeof a, key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
const session = { sessionId: 'moving', provider: 'claude', cwd } as const
set(a, 'openTabSessions', [session]); set(a, 'splitPinnedKeys', ['claude:moving']); set(a, 'splitPaneCount', 1)
set(a, 'windowSurfaces', ['terminal']); set(a, 'windowOrder', ['surface:terminal', 'claude:moving'])
set(a, 'windowStacks', [['surface:terminal', 'surface:browser']])
set(a, 'surface:browser:browser:browser:draft', 'http://localhost:3000')
set(a, 'windowSurfaceMeta', { terminal: { title: 'Kept terminal' } })
set(a, 'draft:claude:moving', 'unsent text')
set(b, 'windowSurfaces', ['terminal']); set(b, 'windowOrder', ['surface:terminal'])
const id = await startShell({ cwd, ownerId: source.id, cols: 60, rows: 15 })
assert.equal(getShells().find(shell => shell.id === id)?.status, 'running')
a.set('ref:shellSelections', { current: new Map([['terminal', id]]) })
a.set('surface:terminal:terminal:process:selectedId', id)
controller.activate(space.id, source.id)
let left = 0
a.beforeLeave = () => { left++; set(a, 'draft:claude:moving', 'flushed draft') }
const result = moveWorkspaceWindow(controller, source.id, destination.id, 'surface:terminal')
assert.equal(result.key, 'surface:terminal#2', 'surface ID collision is resolved')
assert.equal(left, 1, 'mounted workspace is flushed before mutation')
assert.equal(a.values.get('windowSurfaces') instanceof Array, true)
assert.deepEqual(a.values.get('windowSurfaces'), [])
assert.deepEqual(b.values.get('windowStacks'), [['surface:terminal#2', 'surface:browser']])
assert.equal(b.values.get('surface:browser:browser:browser:draft'), 'http://localhost:3000')
assert.deepEqual(result.resourceIds, [id])
assert.ok(reassignShell(id, source.id, destination.id))
closeWorkspaceResources(source.id)
assert.equal(getShells().find(shell => shell.id === id)?.status, 'running', 'closing the source does not stop the moved shell')
assert.ok(workspaceResources([destination.id]).some(resource => resource.id === id))
writeShell(id, "printf 'MOVED_SHELL_ALIVE\\n'\r")
await new Promise(resolve => setTimeout(resolve, 350))
assert.ok(readAllScreenText(shellTerminal(id)!).join('\n').includes('MOVED_SHELL_ALIVE'), 'moved shell accepts input and produces output')
moveWorkspaceWindow(controller, source.id, destination.id, 'claude:moving')
assert.deepEqual(a.values.get('splitPinnedKeys'), [])
assert.equal(b.values.get('draft:claude:moving'), 'flushed draft')
assert.throws(() => moveWorkspaceWindow(controller, source.id, source.id, 'reader'), /another workspace/)
controller.flush()
const restored = new SpacesController(cwd)
assert.ok((restored.runtime(restored.activeWorkspace()!).snapshot().windowSurfaces as string[]).includes('terminal#2'))
// Redo follows undo order and a new edit invalidates the redo branch.
const history = new WindowHistory<number>(String)
history.checkpoint(1); history.checkpoint(2)
assert.equal(history.undo(3), 2); assert.equal(history.undo(2), 1)
assert.equal(history.redo(1), 2); assert.equal(history.redo(2), 3)
assert.equal(history.undo(3), 2); history.checkpoint(2); assert.equal(history.redo(4), null)
// Moving a nested leaf preserves its identity and tiles every cell once.
const tree: WindowSplitTree = { keys: ['a', 'b', 'c'], root: { axis: 'x', ratio: .4, first: { slot: -1 }, second: { axis: 'y', ratio: .5, first: { slot: 0 }, second: { axis: 'x', ratio: .5, first: { slot: 1 }, second: { slot: 2 } } } } }
for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
  const moved = placeWindowSplit(tree, 'a', 'c', edge)!
  assert.ok(validWindowSplitTree(moved))
  const geometry = computeWindowSplitTree(moved, 300, 80, { readerWidth: 40, readerRows: 10, paneWidth: 30, paneRows: 6 })
  assert.equal(geometry.rects.size, 4)
  assert.equal([...geometry.rects.values()].reduce((sum, rect) => sum + rect.width * rect.height, 0), 24000)
}
assert.equal(placeWindowSplit(tree, 'a', 'a', 'left'), null)
await resetShellsForTest()
console.log('Workspace move smoke passed (tabs, collisions, drafts, persistence, live shell ownership, undo/redo, nested relocation)')
