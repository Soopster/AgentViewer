// Interactive Coordinator signals: stalled starts, transition-only
// notifications, and herdr's focus suppression. Every rule here fails silently
// in one direction — a missed stall reads as "Starting" forever, a replayed
// baseline spams on launch, a wrong suppression hides the one question that
// matters — so each is pinned directly rather than through a rendered frame.
import assert from 'node:assert/strict'
import type { ProtocolRunSnapshot } from '../lib/agentProtocol'
import { coordinatorAttentionCount } from '../lib/coordinatorAttentionCount'
import { COORDINATOR_START_STALL_MS, coordinatorAgentActivity, coordinatorStalledAgentIds, type CoordinatorInteractiveState } from '../lib/coordinatorInteractiveState'
import { coordinatorAttentionPriority, coordinatorSignals, coordinatorSignalSuppressed, newCoordinatorSignals } from '../lib/coordinatorSignals'

const claimedAt = '2026-09-17T00:00:00.000Z'
const t0 = Date.parse(claimedAt)
function fixture(overrides: { taskStatus?: string; turnActive?: boolean; sessionId?: string; runStatus?: string } = {}): CoordinatorInteractiveState {
  const snapshot = {
    run: { id: 'run', status: overrides.runStatus ?? 'running', leadAgentId: 'lead', requireReview: false, review: { status: 'none' } },
    agents: [
      { id: 'lead', name: 'lead', role: 'lead', sessionId: 'chat', status: 'working' },
      { id: 'w1', name: 'reviewer', role: 'teammate', sessionId: overrides.sessionId ?? 'worker-chat', status: 'working', taskId: 'T1', turnActive: overrides.turnActive },
    ],
    tasks: [{ id: 'T1', title: 'Review the diff', status: overrides.taskStatus ?? 'claimed', ownerAgentId: 'w1', updatedAt: claimedAt }],
    locks: [], messages: [], events: [],
  } as unknown as ProtocolRunSnapshot
  return { snapshot, interactive: { enabled: true, autoContinue: false, remainingTurns: 4, delivery: null }, runningAgentIds: [], recoveries: [], permissions: [] }
}

// ── Stalled start ────────────────────────────────────────────────────────────
const state = fixture()
assert.deepEqual(coordinatorStalledAgentIds(state, t0 + COORDINATOR_START_STALL_MS - 1), [], 'inside the window is still starting')
assert.deepEqual(coordinatorStalledAgentIds(state, t0 + COORDINATOR_START_STALL_MS), ['w1'], 'crossing the window with no activity is a stall')
const late = t0 + COORDINATOR_START_STALL_MS + 1_000
assert.deepEqual(coordinatorStalledAgentIds({ ...state, runningAgentIds: ['w1'] }, late), [], 'an observed live turn is activity')
assert.deepEqual(coordinatorStalledAgentIds(fixture({ turnActive: true }), late), [], 'a streaming turn is activity')
assert.deepEqual(coordinatorStalledAgentIds({ ...state, recoveries: ['w1'] }, late), [], 'recovery already owns this teammate; do not double-report')
assert.deepEqual(coordinatorStalledAgentIds(fixture({ taskStatus: 'in_progress' }), late), [], 'work that reached a provider is not a start stall')
assert.deepEqual(coordinatorStalledAgentIds(fixture({ sessionId: 'external:worker' }), late), [], 'external supervisors are described by liveness')
assert.deepEqual(coordinatorStalledAgentIds(fixture({ runStatus: 'completed' }), late), [], 'an ended run has nothing to start')
assert.deepEqual(coordinatorStalledAgentIds({ ...state, interactive: { ...state.interactive, executionElsewhere: true } }, late), [],
  'this host cannot observe another host\'s turns, so silence there proves nothing')
assert.match(coordinatorAgentActivity(state.snapshot!.agents[1], state, false, true), /^Stalled .*inspect before resending/)
assert.equal(coordinatorAttentionCount(state, [], late), coordinatorAttentionCount(state, [], t0) + 1, 'a stall is counted as attention')

// ── Transition-only signals ─────────────────────────────────────────────────
const baseline = coordinatorSignals(state, [], t0)
assert.deepEqual(newCoordinatorSignals(null, baseline), [], 'the first observation is a baseline, never a notification')
const seen = new Set(baseline.map(signal => signal.id))
assert.deepEqual(newCoordinatorSignals(seen, coordinatorSignals(state, [], t0 + 1_000)), [], 'a re-read of the same state is silent')

const stalledSignals = newCoordinatorSignals(seen, coordinatorSignals(state, [], late))
assert.equal(stalledSignals.length, 1)
assert.equal(stalledSignals[0].kind, 'needs-attention')
assert.match(stalledSignals[0].title, /reviewer has not started/)

const asking = fixture()
asking.snapshot!.messages.push({ id: 'm1', runId: 'run', fromAgentId: 'w1', toAgentId: 'lead', replyRequired: true, body: 'Which branch?' } as never)
const question = newCoordinatorSignals(seen, coordinatorSignals(asking, [], t0))
assert.deepEqual(question.map(signal => [signal.kind, signal.agentId]), [['needs-attention', 'w1']], 'a new question needs attention')

const finished = fixture({ taskStatus: 'completed' })
const alreadyHeld = coordinatorSignals(finished, [], t0)
assert.ok(alreadyHeld.length > 0)
assert.deepEqual(newCoordinatorSignals(null, alreadyHeld), [], 'opening a conversation that already holds a result does not replay it')
const done = newCoordinatorSignals(seen, coordinatorSignals(finished, [], t0))
assert.deepEqual(done.map(signal => signal.kind), ['finished'])
assert.match(done[0].title, /reviewer finished/)
assert.deepEqual(coordinatorSignals(finished, [done[0].id], t0).filter(signal => signal.kind === 'finished'), [], 'a reviewed result is not a signal')

const permission = { ...state, permissions: [{ agentId: 'w1', agentName: 'reviewer', permission: { id: 'p1', title: 'Run npm test' } as never }] }
assert.deepEqual(newCoordinatorSignals(seen, coordinatorSignals(permission, [], t0)).map(signal => signal.id), ['permission:w1:p1'])
const leadPermission = { ...state, permissions: [{ agentId: 'lead', agentName: 'lead', permission: { id: 'p2', title: 'x' } as never }] }
assert.deepEqual(newCoordinatorSignals(seen, coordinatorSignals(leadPermission, [], t0)), [], 'the lead is the conversation itself; its own card already shows')

// ── Herdr's attention priority ──────────────────────────────────────────────
assert.equal(coordinatorAttentionPriority([]), 0)
assert.equal(coordinatorAttentionPriority(done), 1, 'an unreviewed result is worth a look')
assert.equal(coordinatorAttentionPriority([...done, ...question]), 2, 'anything waiting on the user outranks results')
assert.equal(coordinatorAttentionPriority([], true), 2, 'an unconfirmed request waits on the user')

// ── Herdr's focus rule ──────────────────────────────────────────────────────
assert.equal(coordinatorSignalSuppressed(true, true), true, 'looking and focused: quiet')
assert.equal(coordinatorSignalSuppressed(true, null), true, 'unknown focus counts as focused')
assert.equal(coordinatorSignalSuppressed(true, false), false, 'looking at a blurred terminal is not looking')
assert.equal(coordinatorSignalSuppressed(false, true), false, 'another conversation always notifies')

console.log('Coordinator signals: stall window + exclusions, baseline-silent transitions, reviewed results, lead exclusion, attention priority, focus suppression passed')
