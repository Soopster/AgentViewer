import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SpacesController } from './spacesStore'
import { workspaceOverview } from './workspaceOverviewData'
import { applyWorkspaceWindowAction, restoreShelvedWorkspaceWindow, shelveWorkspaceWindow } from './workspaceWindowShelf'

const cwd = mkdtempSync(path.join(tmpdir(), 'av-window-shelf-'))
try {
  const controller = new SpacesController(cwd)
  const workspace = controller.activeWorkspace()!
  const runtime = controller.runtime(workspace)
  const set = (key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
  const a = { sessionId: 'shelf-a', provider: 'claude', cwd, summary: 'Alpha' }
  const b = { sessionId: 'shelf-b', provider: 'claude', cwd, summary: 'Beta' }
  set('openTabSessions', [a, b])
  set('splitPinnedKeys', ['claude:shelf-a'])
  set('splitPaneCount', 1)
  set('windowOrder', ['claude:shelf-a'])
  set('windowStacks', [['claude:shelf-a', 'claude:shelf-b']])

  shelveWorkspaceWindow(controller, workspace.id, 'claude:shelf-a')
  assert.deepEqual(runtime.values.get('splitPinnedKeys'), ['claude:shelf-b'], 'shelving a tab frame promotes its sibling')
  assert.equal((runtime.values.get('shelvedWindowKeys') as Array<{ key: string }>)[0]?.key, 'claude:shelf-a')
  assert.ok(workspaceOverview(controller)[0]?.children[0]?.children.some(node => node.title === 'Shelf'), 'overview exposes a dedicated shelf group')
  restoreShelvedWorkspaceWindow(controller, workspace.id, 'claude:shelf-a')
  assert.deepEqual(runtime.values.get('windowStacks'), [['claude:shelf-b', 'claude:shelf-a']], 'restore reattaches the shelved tab')
  assert.deepEqual(runtime.values.get('shelvedWindowKeys'), [])

  set('windowStacks', [])
  set('splitPinnedKeys', ['claude:shelf-a', 'claude:shelf-b'])
  set('splitPaneCount', 2)
  set('windowOrder', ['claude:shelf-a', 'claude:shelf-b'])
  applyWorkspaceWindowAction(controller, workspace.id, ['claude:shelf-a', 'claude:shelf-b'], 'tab')
  assert.deepEqual(runtime.values.get('splitPinnedKeys'), ['claude:shelf-a'], 'batch tab action keeps one frame')
  assert.deepEqual(runtime.values.get('windowStacks'), [['claude:shelf-a', 'claude:shelf-b']])
  applyWorkspaceWindowAction(controller, workspace.id, ['claude:shelf-a', 'claude:shelf-b'], 'close')
  assert.deepEqual(runtime.values.get('splitPinnedKeys'), [], 'batch close removes all selected frames')
  assert.deepEqual(runtime.values.get('windowStacks'), [])

  console.log('Workspace shelf and batch window actions smoke: PASS')
} finally {
  rmSync(cwd, { recursive: true, force: true })
}
