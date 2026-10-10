/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getThemePalette } from '../theme'

process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-workflow-render-')))
const coord = await import('../../lib/agentCoordination')
await coord.writeRunPlaybook(process.cwd(), { name: 'feature-team', argsHint: 'Feature name', requirePlanApproval: true, phases: [
  { title: 'Build', tasks: [{ title: 'Build {{args}}', detail: 'Implement {{args}}', paths: ['src/search.ts'], provider: 'codex' }] },
  { title: 'Review', tasks: [{ title: 'Review', detail: 'Review results', paths: [], provider: 'claude', seat: 'validator' }] },
] })
const { mock } = await (0, eval)('import("bun:test")')
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiCoordinatorCapabilities: async () => ({ provider: 'codex', providerInstanceId: 'codex-work', instances: [{ id: 'codex-work', provider: 'codex', displayName: 'Work' }], status: 'available', checkedAt: new Date().toISOString(), models: [{ value: 'advertised-model', displayName: 'Fixture model', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] }),
  listTuiRunPlaybooks: coord.listRunPlaybooks,
  previewTuiInteractiveWorkflow: (cwd: string, name: string, provider: 'codex', args: unknown) => coord.previewInteractiveWorkflow({ cwd, name, provider, args }),
}))
const store = await import('./interactiveCoordinatorStore')
const state = { ...store.getInteractiveCoordinatorState(), session: { sessionId: 'local-chat', provider: 'codex', cwd: process.cwd(), title: 'Conversation' }, open: true, data: { snapshot: null, interactive: { enabled: true, autoContinue: false, remainingTurns: 4, delivery: null, resources: { maxAgents: 3, occupiedAgents: 1, usage: {}, pausedReason: null } }, recoveries: [], permissions: [], runningAgentIds: [] } }
const submitted: any[] = []
mock.module('./interactiveCoordinatorStore', () => ({ ...store, getInteractiveCoordinatorState: () => state,
  subscribeInteractiveCoordinator: () => () => {},
  runInteractiveCoordinatorAction: async (request: unknown) => { submitted.push(request); return true },
}))
const { TeammatesPopover } = await import('./TeammatesPopover')
try {
  for (const [width, height] of [[110, 36], [44, 28]]) {
    let handler: (key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => void = () => {}
    const setup = await testRender(<TeammatesPopover width={width!} height={height!} theme={getThemePalette('dark')} onOpenSession={() => {}} onWatchSessions={() => {}} onNotice={() => {}} onKeyHandlerReady={value => { handler = value }} />, { width, height })
    const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 20)) }) }
    const press = async (name: string, sequence = name) => { act(() => handler({ name, sequence, ctrl: false, shift: false })); await settle() }
    await settle()
    await press('f')
    assert.ok(setup.captureCharFrame().includes('Team workflow'))
    await press('a')
    for (const char of 'search') await press(char)
    await press('return', '\r')
    await press('return', '\r')
    assert.ok(setup.captureCharFrame().includes('Build search'), setup.captureCharFrame())
    let sawDependency = false
    for (let row = 0; row < 25; row++) {
      if (setup.captureCharFrame().includes('Depends on: task-1')) sawDependency = true
      await press('j')
    }
    assert.ok(sawDependency, 'dependency graph remains inspectable at narrow size')
    const count = submitted.length
    await press('s')
    assert.equal(submitted.length, count + 1)
    assert.equal(submitted.at(-1).action, 'start-workflow')
    assert.equal(submitted.at(-1).workflowArgs, 'search')
    assert.equal(submitted.at(-1).playbook.name, 'feature-team')
    assert.ok(setup.captureCharFrame().includes('Teammates'), 'start returns to the same chat team')
    await press('f')
    await press('escape')
    assert.equal(submitted.length, count + 1, 'cancel sends no work')
    await press('g')
    assert.ok(setup.captureCharFrame().includes('Team resources'), 'limits open from the same teammate panel')
    let sawMissingUsage = false
    for (let page = 0; page < 4; page++) {
      sawMissingUsage ||= setup.captureCharFrame().includes('unavailable')
      await press('pagedown')
    }
    assert.ok(sawMissingUsage, 'missing usage remains visible in narrow layout')
    await press('tab')
    await press('return')
    for (const char of '100') await press(char)
    await press('return')
    await press('s')
    const beforeLimits = submitted.length
    assert.equal(submitted.length, beforeLimits, 'preview confirmation does not apply limits')
    await press('y')
    assert.equal(submitted.length, beforeLimits + 1)
    assert.equal(submitted.at(-1).action, 'settings')
    assert.equal(submitted.at(-1).budget.maxTokens, 100)
    assert.equal(submitted.at(-1).maxAgents, 3)
    assert.ok(setup.captureCharFrame().includes('Teammates'))
    const beforeOptions = submitted.length
    await press('n')
    assert.ok(setup.captureCharFrame().includes('Task model and effort'))
    await press('r')
    await press('i')
    await press('r')
    await press('m')
    await press('e')
    assert.ok(setup.captureCharFrame().includes('advertised-model'), setup.captureCharFrame())
    await press('return', '\r')
    act(() => handler({ name: 'u', sequence: 'u', ctrl: true, shift: false })); await settle()
    await press('return', '\r')
    await press('return')
    for (const char of 'custom-model') await press(char)
    await press('return')
    await press('tab')
    await press('return')
    act(() => handler({ name: 'u', sequence: 'u', ctrl: true, shift: false })); await settle()
    for (const char of 'high') await press(char)
    await press('return')
    await press('s')
    assert.equal(submitted.length, beforeOptions, 'saving model options does not create work')
    await press('d')
    for (const char of '@reviewer inspect the API') await press(char)
    await press('return')
    assert.equal(submitted.at(-1).action, 'delegate')
    assert.equal(submitted.at(-1).teammateName, 'reviewer')
    assert.equal(submitted.at(-1).requestedProviderInstanceId, 'codex-work')
    assert.equal(submitted.at(-1).requestedModel, 'custom-model')
    assert.equal(submitted.at(-1).requestedEffort, 'high')
    await press('n')
    await press('escape')
    assert.equal(submitted.length, beforeOptions + 1, 'cancel options does not create work')
    act(() => setup.renderer.destroy())
  }
  console.log('Workflow rendered smoke passed: teammate f entry, typed args, preview scrolling, explicit frozen start, cancel, resource limits with explicit confirmation, missing usage labels, wide and narrow geometry.')
} catch (error) { console.error(error); process.exit(1) }
process.exit(0)
