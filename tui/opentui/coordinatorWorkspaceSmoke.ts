import assert from 'node:assert/strict'
import type { ProtocolRunSnapshot } from '../../lib/agentProtocol'
import { coordinatorWindowBadges, planCoordinatorWorkspace } from './coordinatorWorkspace'

const snapshot = {
  run: { id: 'run', leadAgentId: 'lead', status: 'running', requireReview: true, review: { status: 'pending' } },
  agents: [
    { id: 'nova', name: 'Nova', provider: 'codex', sessionId: 'nova', role: 'teammate' },
    { id: 'lead', name: 'Lead', provider: 'claude', sessionId: 'lead', role: 'lead' },
    { id: 'orion', name: 'Orion', provider: 'pi', sessionId: 'orion', role: 'teammate' },
    { id: 'external', name: 'External', provider: 'codex', sessionId: 'external:opaque', role: 'teammate' },
    { id: 'duplicate', name: 'Duplicate', provider: 'codex', sessionId: 'nova', role: 'teammate' },
  ],
  tasks: [{ id: 'task', title: 'Review the plan', status: 'planned', ownerAgentId: 'nova', updatedAt: '1' }],
  messages: [{ id: 'question', fromAgentId: 'orion', toAgentId: 'lead', replyRequired: true, body: 'Which path?' }],
  events: [], locks: [],
} as unknown as ProtocolRunSnapshot
const before = JSON.stringify(snapshot)
const plan = planCoordinatorWorkspace(snapshot, new Map())
assert.equal(plan.lead?.sessionKey, 'claude:lead')
assert.deepEqual(plan.targets.map(target => target.sessionKey), ['claude:lead', 'codex:nova', 'pi:orion'])
assert.equal(plan.skipped.length, 1)
assert.deepEqual([...coordinatorWindowBadges(snapshot)], [
  ['codex:nova', '? review'], ['pi:orion', '? reply'], ['claude:lead', '? review'],
])
snapshot.tasks[0]!.status = 'in_progress'
snapshot.messages[0]!.resolvedAt = 'now'
snapshot.run.review.status = 'approved'
assert.equal(coordinatorWindowBadges(snapshot).size, 0)
assert.deepEqual(planCoordinatorWorkspace(snapshot, new Map()).targets.map(target => target.sessionKey), plan.targets.map(target => target.sessionKey))
snapshot.run.status = 'completed'
snapshot.tasks[0]!.status = 'planned'
assert.equal(coordinatorWindowBadges(snapshot).size, 0, 'ended runs must not retain actionable gates')
// Reading a pending snapshot is passive: no result/mail/review acknowledgment.
const original = JSON.parse(before) as ProtocolRunSnapshot
planCoordinatorWorkspace(original, new Map())
coordinatorWindowBadges(original)
assert.equal(JSON.stringify(original), before)
console.log('Coordinator workspace smoke passed (stable cross-provider membership, unreadable participants, passive gates and resolution)')
