import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SpacesController } from './spacesStore'
import { workspaceStorageKey } from './workspaceContext'
import { addProcess, getProcesses, startProcess, resetProcessesForTest } from './processStore'
import { closeWorkspaceResources } from './workspaceResources'

const root = mkdtempSync(path.join(tmpdir(), 'agent-viewer-spaces-'))
const controller = new SpacesController(root)
const firstSpace = controller.activeSpace()!
const first = controller.activeWorkspace()!
const runtime = controller.runtime(first)
assert.equal(controller.migrated, true)
runtime.get('splitPinnedKeys', ['claude:first'], true)
runtime.get('expanded', new Set(['card']), true)
runtime.get('windowAttention', new Map([['claude:first', { unread: true }]]), true)
runtime.get('draft:claude:first', 'first draft', true)
runtime.get('splitPaneCount', 0, true)
const observedCounts: number[] = []
const unsubscribe = runtime.subscribe('splitPinnedKeys', () => observedCounts.push(runtime.values.get('splitPaneCount') as number))
runtime.set('splitPinnedKeys', ['claude:changed'])
runtime.set('splitPaneCount', 1)
assert.deepEqual(observedCounts, [], 'a layout transaction must not notify halfway through')
await Promise.resolve()
assert.deepEqual(observedCounts, [1])
unsubscribe()
let left = 0
runtime.beforeLeave = () => { left++ }
const second = controller.addWorkspace(firstSpace.id)!
assert.equal(left, 1)
assert.equal(controller.activeWorkspace()?.id, second.id)
assert.equal(controller.runtime(second).get('workspaceLaunched', true, true), false)
controller.runtime(second).get('draft:claude:first', 'second draft', true)
controller.runtime(second).set('draft:claude:first', 'second updated')
assert.equal(runtime.get('draft:claude:first', '', true), 'first draft')
// A late callback targets the originating workspace, never the newly active one.
const late = () => runtime.set('draft:claude:first', 'late first update')
late()
assert.equal(controller.runtime(second).get('draft:claude:first', '', true), 'second updated')
assert.notEqual(workspaceStorageKey(first.id, 'claude:first'), workspaceStorageKey(second.id, 'claude:first'))
const other = controller.addSpace(root, 'Another project')
assert.equal(other.cwd, firstSpace.cwd, 'same-directory spaces retain independent identity')
controller.activate(firstSpace.id, first.id)
assert.equal(controller.activeWorkspace()?.id, first.id)
controller.rename(second.id, 'Review')
controller.move(second.id, -1)
controller.flush()
const restored = new SpacesController(root)
assert.equal(restored.activeWorkspace()?.id, first.id)
const restoredFirst = restored.runtime(restored.activeWorkspace()!)
assert.deepEqual(restoredFirst.get('expanded', new Set(), true), new Set(['card']))
assert.equal(restoredFirst.get<Map<string, { unread: boolean }>>('windowAttention', new Map(), true).get('claude:first')?.unread, true)
assert.equal(restored.getSnapshot().spaces[0]?.workspaces[0]?.name, 'Review')
// Identical commands in different workspaces must have independent lifecycles.
const a = addProcess({ name: 'server', cwd: root, command: 'echo fixture', ownerId: first.id })
const b = addProcess({ name: 'server', cwd: root, command: 'echo fixture', ownerId: second.id })
assert.notEqual(a, b)
assert.equal(addProcess({ name: 'server', cwd: root, command: 'echo fixture', ownerId: second.id }), b)
const liveA = addProcess({ name: 'live-a', cwd: root, command: `"${process.execPath}" -e "setInterval(function(){},30000)"`, ownerId: first.id })
const liveB = addProcess({ name: 'live-b', cwd: root, command: `"${process.execPath}" -e "setInterval(function(){},30000)"`, ownerId: second.id })
startProcess(liveA); startProcess(liveB)
await new Promise(resolve => setTimeout(resolve, 70))
const secondPid = getProcesses().find(process => process.id === liveB)!.pid!
assert.doesNotThrow(() => process.kill(secondPid, 0))
controller.activate(firstSpace.id, second.id)
assert.doesNotThrow(() => process.kill(secondPid, 0), 'switching keeps background processes alive')
closeWorkspaceResources(first.id)
assert.doesNotThrow(() => process.kill(secondPid, 0), 'closing a different workspace cannot stop this process')
assert.equal(getProcesses().find(process => process.id === b)?.status, 'idle')
assert.throws(() => addProcess({ name: 'late', command: 'echo late', cwd: root, ownerId: first.id }))
controller.close(second.id)
controller.close(first.id)
assert.equal(controller.activeSpace()?.workspaces.length, 1)
assert.equal(controller.activeWorkspace()?.values.workspaceLaunched, false)
// Keep a last-good generation when the main file is corrupt.
controller.flush(); controller.flush()
writeFileSync(controller.file, '{broken')
assert.ok(new SpacesController(root).getSnapshot().spaces.length)
writeFileSync(`${controller.file}.bak`, '{also broken')
const failed = new SpacesController(root)
assert.ok(failed.recoveryWarning)
failed.flush()
assert.equal(readFileSync(controller.file, 'utf8'), '{broken')
controller.close(other.id)
controller.close(firstSpace.id)
assert.equal(controller.activeSpace(), null)
controller.flush()
assert.equal(new SpacesController(root).activeSpace(), null)
await resetProcessesForTest()
console.log('Spaces smoke passed (independent state/drafts, late callbacks, resource ownership, persistence, recovery, management)')
