/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/react/test-utils'
import { getThemePalette } from '../theme'
import { filterCoordinatorRoster } from '../../lib/coordinatorRosterFilter'
import type { CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'

const agent = (id: string, name: string, provider = 'codex') => ({ id, name, provider, role: 'teammate', sessionId: id, status: 'idle', worktreePath: `/tmp/${name}`, worktreeBranch: `team/${name}` })
const data = { snapshot: { run: { id: 'team', leadAgentId: 'lead', status: 'running' }, agents: [
  { ...agent('lead', 'lead'), role: 'lead', sessionId: 'chat' }, agent('a', 'builder'), agent('b', 'gate-reviewer', 'claude'), agent('c', 'finisher'),
], tasks: [{ id: 'task', ownerAgentId: 'c', title: 'Review API routes', paths: ['src/api'], status: 'completed', updatedAt: '2026-10-10T00:00:00Z' }], messages: [], events: [] },
  interactive: { enabled: true, autoContinue: false, remainingTurns: 4, delivery: null }, runningAgentIds: ['a'], recoveries: ['b'], permissions: [],
} as unknown as CoordinatorInteractiveState
const resultId = 'result:task:2026-10-10T00:00:00Z'
assert.deepEqual(filterCoordinatorRoster(data, [], 'claude gate team/', 'blocked').agents.map(item => item.id), ['b'])
assert.deepEqual(filterCoordinatorRoster(data, [], 'api', 'done').agents.map(item => item.id), ['c'])
assert.equal(filterCoordinatorRoster(data, [resultId], '', 'done').agents.length, 0)
assert.deepEqual(filterCoordinatorRoster(data, [], '', 'working', true).counts, { all: 3, blocked: 0, working: 0, done: 0, idle: 0, unknown: 3 })
assert.equal(filterCoordinatorRoster({ ...data, backgroundAgents: [{ agentId: 'c', tasks: 1, wakeups: 0 }] }, [], '', 'working').agents.length, 2)
assert.equal(filterCoordinatorRoster({ ...data, permissions: [{ agentId: 'a', agentName: 'builder', permission: {} as never }] }, [], '', 'blocked').agents.length, 2)
const { mock } = await (0, eval)('import("bun:test")')
const store = await import('./interactiveCoordinatorStore')
let state = { ...store.getInteractiveCoordinatorState(), session: { sessionId: 'chat', provider: 'codex', cwd: '/tmp', title: 'Chat' }, open: true, data }
const listeners = new Set<() => void>()
let mutations = 0
mock.module('./interactiveCoordinatorStore', () => ({ ...store, getInteractiveCoordinatorState: () => state, subscribeInteractiveCoordinator: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  runInteractiveCoordinatorAction: async () => { mutations++; return true },
}))
const { TeammatesPopover } = await import('./TeammatesPopover')
for (const [width, height] of [[110, 38], [44, 30]]) {
  let handler: (key: any) => void = () => {}
  const opened: string[] = []
  const setup = await testRender(<TeammatesPopover theme={getThemePalette('dark')} width={width!} height={height!} onOpenSession={item => opened.push(item.id)} onWatchSessions={() => {}} onNotice={() => {}} onKeyHandlerReady={value => { handler = value }} />, { width, height })
  const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 20)) }) }
  const press = async (name: string, sequence = name, ctrl = false) => { act(() => handler({ name, sequence, ctrl, shift: false })); await settle() }
  await settle()
  await press('/')
  for (const char of 'gate') await press(char)
  assert.ok(!setup.captureCharFrame().includes('Team resources'), 'search g must not invoke resource controls')
  assert.ok(!setup.captureCharFrame().includes('Team workflow'), 'search f must not invoke workflow controls')
  await press('return', '\r')
  assert.equal(opened.length, 0, 'finishing search does not open a transcript')
  await press('return', '\r')
  assert.deepEqual(opened, ['b'], 'opening follows visible agent identity')
  await press('/')
  for (const char of 'missing') await press(char)
  await press('escape', '\u001b')
  await press('return', '\r')
  assert.equal(opened.length, 1, 'empty result never opens a hidden teammate')
  await press('u', '\u0015', true)
  await press('t')
  await press('return', '\r')
  assert.equal(opened.at(-1), 'b', 'state filter targets the teammate needing input')
  await press('down')
  state = { ...state, data: { ...data, recoveries: [] } }
  act(() => { for (const listener of listeners) listener() })
  await settle()
  const beforeRefreshOpen = opened.length
  await press('return', '\r')
  assert.equal(opened.length, beforeRefreshOpen, 'a state refresh cannot retarget a filtered-out selection')
  state = { ...state, data }
  act(() => { for (const listener of listeners) listener() })
  await settle()
  assert.equal(mutations, 0, 'navigation submits no work')
  act(() => setup.renderer.destroy())
}
console.log('Roster search passed: names/providers/tasks/paths/branches, observed and unknown states, review markers, background work, search keyboard isolation, filtered transcript identity, empty results, and wide/narrow rendering.')
process.exit(0)
