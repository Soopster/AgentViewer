/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { ProtocolRunSnapshot } from '../../lib/agentProtocol'
import { DARK_THEME } from '../theme'
import { act, testRender } from './testRender'
import { coordinationOverview, coordinationRunsForRepository } from './engineering/coordinationOverview'
import { EngineeringWork, type EngineeringWorkHandle, type WorkSection } from './engineering/EngineeringWork'
import type { EngineeringCoordinationFeed } from './engineering/EngineeringCoordination'
import { emptyTaskBrief } from './engineering/workbenchModel'

const snapshot = {
  run: { id: 'run-1', prompt: 'Build authentication', status: 'running', baseCwd: '/repo', createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:05:00Z' },
  agents: [
    { id: 'builder', name: 'Builder', provider: 'claude', providerInstanceId: 'one', sessionId: 'same-id', role: 'lead', worktreePath: '/repo', worktreeBranch: 'main', status: 'working', turnActive: true, liveness: { status: 'fresh' } },
    { id: 'reviewer', name: 'Reviewer', provider: 'codex', providerInstanceId: 'two', sessionId: 'same-id', role: 'teammate', worktreePath: '/worktrees/review', worktreeBranch: 'review', status: 'blocked', liveness: { status: 'stale' } },
  ],
  tasks: [
    { id: 'implement', title: 'Implement authentication', ownerAgentId: 'builder', status: 'in_progress', paths: ['src/auth.ts'], blockedBy: ['gate'] },
    { id: 'review', title: 'Review authentication', ownerAgentId: 'reviewer', status: 'blocked', paths: ['src/auth.ts'], blockedBy: ['implement', 'gate', 'missing'] },
    { id: 'gate', title: 'Choose API contract', status: 'pending', paths: ['src/config.ts'], blockedBy: [] },
    { id: 'finished', title: 'Document behavior', status: 'completed', paths: ['src/**'], blockedBy: [], receipt: { filesChanged: ['docs/notes.md'] } },
  ],
  messages: [
    { id: 'status-1', fromAgentId: 'reviewer', kind: 'status', body: 'Earlier status', createdAt: '2026-11-07T00:01:00Z' },
    { id: 'status-2', fromAgentId: 'reviewer', kind: 'status', body: 'Waiting for implementation.', createdAt: '2026-11-07T00:02:00Z' },
  ], locks: [], events: [],
} as unknown as ProtocolRunSnapshot
const before = JSON.stringify(snapshot)
const overview = coordinationOverview(snapshot)
assert.equal(overview.tasks.find(item => item.task.id === 'review')?.dependencies.find(item => item.id === 'missing')?.unresolved, true)
assert.equal(overview.tasks.find(item => item.task.id === 'review')?.lastStatus, 'Waiting for implementation.')
assert.deepEqual(overview.overlaps.map(item => item.path), ['src/auth.ts'], 'Uses reported completion footprints rather than a completed broad grant')
assert.equal(overview.holdUps[0]?.taskId, 'gate')
const foreign = { ...snapshot, run: { ...snapshot.run, id: 'foreign', baseCwd: '/repository' }, agents: snapshot.agents.map(agent => ({ ...agent, worktreePath: '/elsewhere' })) }
const worktreeRun = { ...snapshot, run: { ...snapshot.run, id: 'worktree', baseCwd: '/another-repo' } }
assert.deepEqual(coordinationRunsForRepository([snapshot, foreign, worktreeRun], '/repo').map(item => item.run.id), ['run-1', 'worktree'])
assert.equal(JSON.stringify(snapshot), before, 'Overview derivation is passive')

let acquire = 0, release = 0, openedRun = '', openedAgent = ''
let observed: ReadonlyMap<string, ProtocolRunSnapshot> = new Map([[snapshot.run.id, snapshot]])
const listeners = new Set<() => void>()
const feed: EngineeringCoordinationFeed = {
  getSnapshot: () => observed,
  subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  acquire: () => { acquire++; return () => { release++ } },
}
const handle = React.createRef<EngineeringWorkHandle>()
const width = Number(process.env.ENGINEERING_COORDINATION_WIDTH ?? 48)
function Fixture() {
  const [section, setSection] = useState<WorkSection>('brief')
  const [brief, setBrief] = useState(emptyTaskBrief)
  return <EngineeringWork root="/repo" width={width} height={30} theme={DARK_THEME} focused ready brief={brief} setBrief={setBrief}
    section={section} onSection={setSection} checkpoint={null} current={null}
    delta={{ files: [], sessions: [], checks: [], attention: [], branchChanged: false, count: 0 }} onAcknowledge={() => {}}
    currentSession={null} selectedMessage={null} selectedMessageFiles={[]} selectedFile={null} sources={new Map()} checks={[]} attention={[]}
    coordinationFeed={feed} onOpenCoordinator={id => { openedRun = id ?? '' }} onOpenCoordinatorAgent={agent => { openedAgent = agent.id }}
    onRunCheck={() => {}} onOpenFile={() => {}} onChooseFile={() => {}} onOpenSession={() => {}} onJump={() => {}} onCopy={() => {}} onAppend={() => {}} onAttention={() => {}} onFocus={() => {}} handleRef={handle} />
}
const setup = await testRender(<Fixture />, { width, height: 30 })
const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 5)); await setup.flush() }) }
const click = async (id: string) => {
  await act(async () => { (setup.renderer.root.findDescendantById('engineering-work-body') as ScrollBoxRenderable).scrollChildIntoView(id) })
  await settle()
  const node = setup.renderer.root.findDescendantById(id)
  assert.ok(node, `Missing ${id}`)
  await act(async () => { await setup.mockMouse.click(node.x + 1, node.y) })
  await settle()
}
try {
  await settle()
  assert.equal(acquire, 0, 'Brief does not start a Coordinator feed')
  await click('engineering-work:agents')
  assert.equal(acquire, 1)
  assert.match(setup.captureCharFrame(), /live turn/)
  assert.match(setup.captureCharFrame(), width < 48 ? /blocked/ : /blocked.*stale/)
  await click('engineering-coordination:task:review')
  assert.match(setup.captureCharFrame(), /Declared file scope/)
  assert.ok(setup.renderer.root.findDescendantById('engineering-coordination:dependency:implement'))
  await click('engineering-coordination:dependency:implement')
  assert.match(setup.captureCharFrame(), /Implement authentication/)
  await click('engineering-coordination:agent:reviewer')
  await click('engineering-coordination:open-agent')
  assert.equal(openedAgent, 'reviewer', 'Agent identity is not confused by identical provider session IDs')
  await click('engineering-coordination:open')
  assert.equal(openedRun, 'run-1')
  assert.equal(JSON.stringify(snapshot), before, 'Inspecting and following links does not mutate run, task, or mailbox state')
  await act(async () => {
    observed = new Map([[snapshot.run.id, { ...snapshot, agents: snapshot.agents.map(agent => ({ ...agent, status: 'idle', turnActive: false })) }]])
    for (const listener of listeners) listener()
  })
  await settle()
  await click('engineering-work:brief')
  assert.equal(release, 1, 'Leaving Agents releases its feed holder')
  assert.equal(listeners.size, 0)
  await act(async () => { handle.current?.handleKey({ name: '4', sequence: '4', ctrl: false, shift: false }) })
  await settle()
  assert.equal(acquire, 2, 'Keyboard section navigation can reopen the overview')
  console.log('Engineering Coordinator scopes, dependencies, blockers, overlap rules, passive links and feed lifecycle smoke passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
process.exit(0)
