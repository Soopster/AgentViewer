/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, testRender } from './testRender'
import { SpacesController } from './spacesStore'
import { WorkspaceContext } from './workspaceContext'
import { useEngineeringWorkbench } from './engineering/workbenchState'
import { acknowledgeWorkSnapshot, compareWorkSnapshots, editTaskBrief, workSnapshot, type TaskBrief, type WorkSnapshot } from './engineering/workbenchModel'

const directory = mkdtempSync(join(tmpdir(), 'engineering-workbench-state-'))
const controller = new SpacesController(directory)
const space = controller.activeSpace() ?? controller.addSpace(directory)
const first = controller.activeWorkspace()!
const second = controller.addWorkspace(space.id)!
const snapshot = (version: string) => workSnapshot({ root: '/repo', branch: 'main', fingerprint: version, files: [{ path: 'a.ts', status: ' M', additions: '1', deletions: '1', version }] }, [], [], [], 10)
const snapshots = [snapshot('one'), snapshot('two')]
let work: ReturnType<typeof useEngineeringWorkbench>
let configure: (next: Partial<{ other: boolean; root: string; version: number; active: boolean; ready: boolean }>) => void
function Probe({ root, active, ready, version }: { root: string; active: boolean; ready: boolean; version: number }) {
  work = useEngineeringWorkbench(root, active, active ? snapshots[version]! : null, ready)
  return <text>{work.brief.objective}</text>
}
function Fixture() {
  const [state, setState] = useState({ other: false, root: '/repo', version: 0, active: true, ready: false })
  configure = next => setState(previous => ({ ...previous, ...next }))
  return <WorkspaceContext.Provider value={{ controller, space, runtime: controller.runtime(state.other ? second : first) }}><Probe {...state} /></WorkspaceContext.Provider>
}
const setup = await testRender(<Fixture />, { width: 60, height: 12 })
const change = async (state: Parameters<typeof configure>[0]) => { await act(async () => { configure!(state); await setup.flush() }) }
try {
  assert.equal(Boolean(work!.checkpoint), false, 'Loading catalogs do not create a partial checkpoint')
  await change({ ready: true })
  assert.equal(work!.checkpoint?.files['a.ts'], 'one')
  await act(async () => { work!.setBrief(previous => ({ ...editTaskBrief(previous, 'objective', 'Keep the work coherent'), sessions: [{ key: 'claude:one:same-id', title: 'First' }, { key: 'codex:two:same-id', title: 'Second' }] })) })
  await change({ version: 1 })
  assert.equal(compareWorkSnapshots(work!.checkpoint, snapshots[1]!).count, 1)
  await change({ active: false })
  await change({ active: true })
  assert.equal(compareWorkSnapshots(work!.checkpoint, snapshots[1]!).count, 1, 'Leaving and reopening does not acknowledge unseen changes')
  await act(async () => { work!.setCheckpoint(previous => acknowledgeWorkSnapshot(previous, snapshots[1]!)) })
  assert.equal(compareWorkSnapshots(work!.checkpoint, snapshots[1]!).count, 0)
  await change({ other: true })
  assert.equal(work!.brief.objective, '', 'Another workspace has its own task')
  await change({ other: false, root: '/other' })
  assert.equal(work!.brief.objective, '', 'Another repository has its own task')
  await change({ root: '/repo' })
  assert.equal(work!.brief.objective, 'Keep the work coherent')
  controller.flush()
  const restored = new SpacesController(directory)
  const workspace = restored.getSnapshot().spaces.flatMap(item => item.workspaces).find(item => item.id === first.id)!
  const saved = restored.runtime(workspace).get<TaskBrief>('engineering:brief:/repo', {} as TaskBrief, true)
  assert.equal(saved.sessions.length, 2, 'Cross-provider session identities survive restart')
  const checkpoint = restored.runtime(workspace).get<WorkSnapshot>('engineering:checkpoint:/repo', {} as WorkSnapshot, true)
  assert.equal(checkpoint.reviewed, true)
  assert.equal(checkpoint.files['a.ts'], 'two')
  console.log('Engineering brief and catch-up workspace/repository isolation, revisit, acknowledgement and restart smoke passed')
} finally {
  await act(async () => { setup.renderer.destroy() })
  controller.flush(); rmSync(directory, { recursive: true, force: true })
}
process.exit(0)
