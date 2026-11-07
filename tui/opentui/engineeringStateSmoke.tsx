/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useLayoutEffect, useState } from 'react'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { testRender, act } from './testRender'
import { SpacesController } from './spacesStore'
import { WorkspaceContext, useAppState, useWorkspaceState } from './workspaceContext'
import { useSessionSidebarState, type SessionSidebarPreferences } from './app/state/sessionSidebarState'
import { useEngineeringLayout, useEngineeringWorkspaceState } from './engineering/state'
import type { TuiTranscriptView } from '../theme'

const cwd = mkdtempSync(join(tmpdir(), 'engineering-state-'))
const controller = new SpacesController(cwd)
const space = controller.activeSpace() ?? controller.addSpace(cwd)
const first = controller.activeWorkspace()!
const second = controller.addWorkspace(space.id)!
type Probe = {
  view: TuiTranscriptView; setView: React.Dispatch<React.SetStateAction<TuiTranscriptView>>
  layout: ReturnType<typeof useEngineeringLayout>
  sidebar: ReturnType<typeof useSessionSidebarState>
  query: string; setQuery: React.Dispatch<React.SetStateAction<string>>
  share: number; setShare: React.Dispatch<React.SetStateAction<number>>
  draft: string; setDraft: React.Dispatch<React.SetStateAction<string>>
}
let probe: Probe
let switchWorkspace: (second: boolean) => void
function Probe() {
  const [view, setView] = useAppState<TuiTranscriptView>('transcriptView', 'chat')
  const layout = useEngineeringLayout(200, 40)
  const sidebar = useSessionSidebarState()
  const [query, setQuery] = useWorkspaceState('sessionSearchQuery', '')
  const [share, setShare] = useEngineeringWorkspaceState('splitReaderShare', .5)
  const [draft, setDraft] = useWorkspaceState('composerDraft', '')
  useLayoutEffect(() => { probe = { view, setView, layout, sidebar, query, setQuery, share, setShare, draft, setDraft } })
  return <text>{`${view} ${share} ${layout.preferences.inspectorWidth} ${draft}`}</text>
}
function Fixture() {
  const [other, setOther] = useState(false)
  useLayoutEffect(() => { switchWorkspace = setOther }, [])
  return <WorkspaceContext.Provider value={{ controller, space, runtime: controller.runtime(other ? second : first) }}><Probe /></WorkspaceContext.Provider>
}
const setup = await testRender(<Fixture />, { width: 200, height: 40 })
try {
  await act(async () => { probe!.setShare(.7); probe!.setDraft('Keep this draft') })
  await act(async () => { probe!.setView('engineering') })
  assert.equal(probe!.share, .5)
  assert.equal(probe!.draft, 'Keep this draft')
  await act(async () => {
    probe!.setShare(.3)
    probe!.setQuery('reconnect')
    probe!.sidebar.setActivity('pinned')
    probe!.sidebar.togglePin({ sessionId: 'shared-pin', provider: 'claude' })
    probe!.layout.setPreferences(previous => ({ ...previous, inspectorWidth: 64 }))
  })
  await act(async () => { probe!.setView('chat') })
  assert.equal(probe!.share, .7, 'Engineering must not alter the legacy layout')
  assert.equal(probe!.query, 'reconnect', 'Search is shared across views')
  assert.equal(probe!.sidebar.activity, 'pinned', 'Activity filter is shared across views')
  assert.equal(probe!.layout.width, 200, 'Engineering must release its width reservation')
  await act(async () => { probe!.setView('engineering') })
  assert.equal(probe!.share, .3)
  assert.equal(probe!.layout.preferences.inspectorWidth, 64)
  await act(async () => { switchWorkspace!(true) })
  assert.equal(probe!.share, .5)
  assert.equal(probe!.layout.preferences.inspectorWidth, 48)
  assert.equal(probe!.query, '')
  await act(async () => { switchWorkspace!(false) })
  assert.equal(probe!.query, 'reconnect')
  controller.flush()
  const restored = new SpacesController(cwd)
  const restoredFirst = restored.getSnapshot().spaces.flatMap(space => space.workspaces).find(workspace => workspace.id === first.id)!
  const saved = restored.runtime(restoredFirst).get<import('./engineering/model').EngineeringPreferences>('engineering:preferences', {} as import('./engineering/model').EngineeringPreferences, true)
  assert.equal(saved.inspectorWidth, 64)
  const sidebar = restored.runtime(restoredFirst).get<SessionSidebarPreferences>('sidebar:preferences', { pinned: [], activity: null }, true)
  assert.equal(sidebar.activity, 'pinned')
  assert.equal(sidebar.pinned.length, 1, 'Shared pins survive restart')
  assert.equal(restored.runtime(restoredFirst).get('sessionSearchQuery', '', true), 'reconnect')
  assert.equal(restored.runtime(restoredFirst).get('splitReaderShare', 0, true), .7)
  assert.equal(restored.runtime(restoredFirst).get('engineering:splitReaderShare', 0, true), .3)
  console.log('Engineering layout, workspace, draft and restart isolation smoke passed')
} finally {
  await act(async () => { setup.renderer.destroy() })
  controller.flush()
  rmSync(cwd, { recursive: true, force: true })
}
process.exit(0)
