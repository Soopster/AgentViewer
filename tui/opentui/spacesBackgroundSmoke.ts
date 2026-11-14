import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProtocolRunSnapshot } from '../../lib/agentProtocol'
import { SpacesController } from './spacesStore'
const root = mkdtempSync(path.join(tmpdir(), 'spaces-background-'))
process.chdir(root)
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }
const snapshot = {
  run: { id: 'run', leadAgentId: 'lead', status: 'running', requireReview: false, review: { status: 'pending' } },
  agents: [{ id: 'lead', name: 'Lead', role: 'lead', provider: 'claude', sessionId: 'lead' }, { id: 'nova', name: 'Nova', role: 'teammate', provider: 'codex', sessionId: 'nova' }],
  tasks: [{ id: 'blocked', title: 'Needs input', ownerAgentId: 'nova', status: 'blocked', updatedAt: '1' }],
  events: [], locks: [], messages: [],
} as unknown as ProtocolRunSnapshot
mock.module('../../lib/tui/service', () => ({
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  readTuiProtocolRun: async () => snapshot,
  readTuiSessions: async () => [],
}))
const controller = new SpacesController(root)
const first = controller.activeWorkspace()!
const runtime = controller.runtime(first)
runtime.get('openTabSessions', [{ sessionId: 'lead', provider: 'claude' }], true)
runtime.get('selectedSessionKeyState', 'claude:lead', true)
runtime.get('coordinatorWorkspaceRunId', 'run', true)
runtime.get('splitPinnedKeys', [] as string[], true)
runtime.get('splitPaneCount', 0, true)
runtime.get('ref:watchedRoster', { current: { runId: 'run', keys: new Set(['claude:lead']) } }, true)
const active = controller.addWorkspace(controller.activeSpace()!.id)!
let rootUpdates = 0
let badgeUpdates = 0
controller.subscribe(() => rootUpdates++)
controller.subscribeAttention(() => badgeUpdates++)
const { startSpacesBackground } = await import('./spacesBackground')
const stop = startSpacesBackground(controller)
await new Promise(resolve => setTimeout(resolve, 150))
stop()
assert.equal(controller.activeWorkspace()?.id, active.id)
assert.deepEqual(runtime.values.get('splitPinnedKeys'), ['codex:nova'])
assert.equal(runtime.values.get('splitPaneCount'), 1)
assert.equal(controller.getAttention(first.id), '?')
assert.equal(badgeUpdates, 1)
assert.equal(rootUpdates, 0, 'inactive updates must not rerender the application root')
controller.flush()
console.log('Spaces background smoke passed (inactive Coordinator membership and gates update without focus changes or root rendering)')
