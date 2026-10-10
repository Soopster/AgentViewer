/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/react/test-utils'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'
import { getThemePalette } from '../theme'
import { recoveryOverview, type RecoveryInspection } from '../../lib/coordinatorRecovery'

process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-recovery-render-')))
execFileSync('git', ['init', '-q'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '--allow-empty', '-qm', 'fixture'])
const { mock } = await (0, eval)('import("bun:test")')
const coord = await import('../../lib/agentCoordination')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Recovery fixture', provider: 'codex', baseCwd: process.cwd(), participantName: 'lead' })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, cwd: process.cwd(), provider: 'codex', participantName: 'reviewer' })).participant
const completed = (await coord.createExternalProtocolTask(lead, { title: 'Saved result', detail: 'Review', assignTo: worker.agentId })).task!
await coord.reportExternalProtocolProgress(worker, { status: 'working', taskId: completed.id })
const other = (await coord.joinExternalProtocolRun({ runId: lead.runId, cwd: process.cwd(), provider: 'codex', participantName: 'builder' })).participant
await coord.createExternalProtocolTask(lead, { title: 'Unfinished work', detail: 'Inspect', assignTo: other.agentId })
await coord.completeExternalProtocolTask(worker, { taskId: completed.id, summary: 'Retained completion' })
const snapshot = (await coord.readExternalProtocolStatus(lead)).snapshot
snapshot.agents = snapshot.agents.map(agent => ({ ...agent, sessionId: agent.role === 'lead' ? 'lead-chat' : `native-${agent.id}` }))
const state: CoordinatorInteractiveState = { snapshot, interactive: { enabled: true, autoContinue: false, remainingTurns: 4, delivery: null }, recoveries: [other.agentId], settledExecutions: [worker.agentId], runningAgentIds: [], permissions: [] }
let available = false
const inspection = (): RecoveryInspection => ({ runId: snapshot.run.id, evidence: snapshot.agents.map(agent => ({ agentId: agent.id, sessionId: agent.sessionId, provider: agent.provider, worktreePath: agent.worktreePath, checkedAt: '2026-10-10T00:00:00Z', directory: { available, detail: available ? 'available' : 'saved directory unavailable' }, conversation: { available: true, detail: 'native conversation available' } })) })
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service, inspectTuiCoordinatorRecovery: async () => inspection() }))
const store = await import('./interactiveCoordinatorStore')
const storeState = { ...store.getInteractiveCoordinatorState(), open: true, session: { sessionId: 'lead-chat', provider: 'codex' as const, cwd: process.cwd(), title: 'Conversation' }, data: state }
const sent: any[] = []; const inspected: string[] = []
mock.module('./interactiveCoordinatorStore', () => ({ ...store, subscribeInteractiveCoordinator: () => () => {}, getInteractiveCoordinatorState: () => storeState,
  runInteractiveCoordinatorAction: async (request: unknown) => { sent.push(request); return true },
}))
const { TeammatesPopover } = await import('./TeammatesPopover')
try {
  const disabledRows = recoveryOverview(state, inspection(), 'Pending exact request')
  assert.ok(disabledRows.every(row => !row.canResume && !row.canReconcile), 'an uncertain client submission blocks recovery mutations')
  for (const [width, height] of [[110, 36], [44, 28]]) {
    available = false
    let handler = (_: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => {}
    const setup = await testRender(<TeammatesPopover theme={getThemePalette('dark')} width={width!} height={height!} onOpenSession={agent => inspected.push(agent.id)} onWatchSessions={() => {}} onNotice={() => {}} onKeyHandlerReady={value => { handler = value }} />, { width, height })
    const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 20)) }) }
    const press = async (name: string) => { act(() => handler({ name, sequence: name, ctrl: false, shift: false })); await settle() }
    await settle(); await press('h')
    assert.ok(setup.captureCharFrame().includes('Team recovery'))
    const before = sent.length
    await press('tab'); await press('tab')
    await press('r')
    assert.equal(sent.length, before)
    let sawMissing = false
    for (let i = 0; i < 20; i++) { sawMissing ||= setup.captureCharFrame().includes('unavailable'); await press('j') }
    assert.ok(sawMissing, 'missing teammate directory remains readable at narrow size')
    available = true; await press('u'); await press('return')
    assert.equal(inspected.at(-1), other.agentId)
    await press('r')
    assert.equal(sent.length, before, 'resume requires deliberate confirmation')
    await press('y')
    assert.equal(sent.length, before + 1)
    assert.equal(sent.at(-1).action, 'resume-agent')
    assert.equal(sent.at(-1).to, other.agentId)
    await press('h'); await press('tab'); await press('a')
    await press('y')
    assert.equal(sent.at(-1).action, 'reconcile-agent')
    assert.equal(sent.at(-1).to, worker.agentId)
    await press('h'); await press('escape')
    assert.ok(setup.captureCharFrame().includes('Teammates'))
    act(() => setup.renderer.destroy())
  }
  console.log('Recovery rendered smoke passed: teammate h entry, saved identities/paths, unavailable directory retention, refresh and transcript inspection, explicit resume and no-turn acknowledgement, pending-request gate, wide/narrow layout.')
} catch (error) { console.error(error); process.exit(1) }
process.exit(0)
