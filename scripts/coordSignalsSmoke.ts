// Interactive Coordinator signals: stalled starts, transition-only
// notifications, and herdr's focus suppression. Every rule here fails silently
// in one direction — a missed stall reads as "Starting" forever, a replayed
// baseline spams on launch, a wrong suppression hides the one question that
// matters — so each is pinned directly rather than through a rendered frame.
import assert from 'node:assert/strict'
import type { ProtocolRunSnapshot } from '../lib/agentProtocol'
import { coordinatorAttentionCount } from '../lib/coordinatorAttentionCount'
import { COORDINATOR_START_STALL_MS, coordinatorAgentActivity, coordinatorAgentNote, coordinatorAgentWorkspace, coordinatorBackgroundAgents, coordinatorBackgroundWork, coordinatorStalledAgentIds, type CoordinatorInteractiveState } from '../lib/coordinatorInteractiveState'
import { coordinatorAlertDelivery, coordinatorAttentionPriority, coordinatorResultIdsForAgent, coordinatorRosterOrder, coordinatorSignals, coordinatorSignalSuppressed, newCoordinatorSignals } from '../lib/coordinatorSignals'

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

// ── Herdr's agent-panel priority order ──────────────────────────────────────
function team(): CoordinatorInteractiveState {
  const base = fixture()
  const snapshot = base.snapshot!
  const teammate = (id: string, name: string, taskId: string, status = 'working') => ({ id, name, role: 'teammate', sessionId: `${id}-chat`, status, taskId })
  const task = (id: string, owner: string, status: string, updatedAt: string) => ({ id, title: id, status, ownerAgentId: owner, updatedAt })
  snapshot.agents = [snapshot.agents[0], teammate('idle', 'idle', 'T0', 'idle'), teammate('busy', 'busy', 'T1'), teammate('done', 'done', 'T2', 'done'), teammate('asks', 'asks', 'T3')] as never
  snapshot.tasks = [task('T0', 'idle', 'completed', '2026-09-16T00:00:00Z'), task('T1', 'busy', 'in_progress', '2026-09-17T00:00:00Z'),
    task('T2', 'done', 'completed', '2026-09-17T00:02:00Z'), task('T3', 'asks', 'in_progress', '2026-09-17T00:01:00Z')] as never
  snapshot.messages = [{ id: 'mq', fromAgentId: 'asks', toAgentId: 'lead', replyRequired: true, body: '?' }] as never
  return { ...base, runningAgentIds: ['busy', 'asks'] }
}
const roster = team()
const idleResult = coordinatorResultIdsForAgent(roster.snapshot, 'idle')
assert.deepEqual(coordinatorRosterOrder(roster, idleResult, t0).map(agent => agent.id), ['asks', 'done', 'busy', 'idle'],
  'waiting on the user, then unreviewed result, then working, then the rest')
assert.deepEqual(coordinatorRosterOrder(roster, [], t0).map(agent => agent.id), ['asks', 'done', 'idle', 'busy'],
  'within a tier the most recent task change leads')
assert.deepEqual(coordinatorResultIdsForAgent(roster.snapshot, 'done'), ['result:T2:2026-09-17T00:02:00Z'])
assert.deepEqual(coordinatorResultIdsForAgent(roster.snapshot, 'asks'), [], 'work in progress has no result to mark reviewed')
assert.deepEqual(coordinatorRosterOrder(roster, coordinatorResultIdsForAgent(roster.snapshot, 'done').concat(idleResult), t0).map(agent => agent.id), ['asks', 'busy', 'done', 'idle'],
  'reading a teammate\'s results drops it out of the result tier')

// ── The teammate's own last word (herdr's agent-reported tokens) ────────────
const noteSnapshot = fixture().snapshot!
const teammateAgent = noteSnapshot.agents[1]!
assert.equal(coordinatorAgentNote(teammateAgent, noteSnapshot), '', 'no reports, nothing to quote')
noteSnapshot.events.push(
  { version: '1.0', runId: 'run', agentId: 'w1', type: 'agent.start_work', summary: 'Reading parser.ts' } as never,
  { version: '1.0', runId: 'run', agentId: 'lead', type: 'agent.heartbeat', summary: 'lead thinking' } as never,
  { version: '1.0', runId: 'run', agentId: 'w1', type: 'message', summary: 'asked orion about grammar' } as never,
)
assert.equal(coordinatorAgentNote(teammateAgent, noteSnapshot), 'Reading parser.ts', 'mail to a teammate is not a status line, and the lead is not this teammate')
noteSnapshot.events.push({ version: '1.0', runId: 'run', agentId: 'w1', type: 'agent.heartbeat', summary: '  \n  Half way through the tests  ' } as never)
assert.equal(coordinatorAgentNote(teammateAgent, noteSnapshot), 'Half way through the tests', 'the newest report wins, trimmed to one line')
noteSnapshot.events.push({ version: '1.0', runId: 'run', agentId: 'w1', type: 'agent.heartbeat', summary: 'x'.repeat(200) } as never)
const long = coordinatorAgentNote(teammateAgent, noteSnapshot)
assert.ok(long.length <= 72 && long.endsWith('…'), `a roster row caps the quote: ${long.length}`)
noteSnapshot.events.push({ version: '1.0', runId: 'run', agentId: 'w1', type: 'agent.heartbeat', summary: '' } as never)
assert.equal(coordinatorAgentNote(teammateAgent, noteSnapshot), long, 'a heartbeat with nothing to say does not erase the last word')

// ── Each teammate's own checkout (herdr's agent cwd/branch) ─────────────────
const worktreeSnapshot = fixture().snapshot!
const [leadAgent, teammate] = worktreeSnapshot.agents as unknown as Array<{ worktreePath: string; worktreeBranch: string }>
leadAgent.worktreePath = '/repo'; leadAgent.worktreeBranch = 'main'
teammate.worktreePath = '/repo/.worktrees/nova'; teammate.worktreeBranch = 'coord/nova'
assert.equal(coordinatorAgentWorkspace(worktreeSnapshot.agents[1], worktreeSnapshot), 'coord/nova')
teammate.worktreePath = '/repo'
assert.equal(coordinatorAgentWorkspace(worktreeSnapshot.agents[1], worktreeSnapshot), '', 'a shared checkout is the lead\'s branch; saying it twice is noise')
teammate.worktreePath = '/repo/.worktrees/nova'; teammate.worktreeBranch = ''
assert.equal(coordinatorAgentWorkspace(worktreeSnapshot.agents[1], worktreeSnapshot), '', 'no branch, nothing to say')

// ── Herdr's background-work rule (#1630, #3090, #3414) ──────────────────────
assert.equal(coordinatorBackgroundWork([{ type: 'shell', status: 'running' }], []), null, 'a background shell alone is not the agent working')
assert.deepEqual(coordinatorBackgroundWork([{ type: 'subagent', status: 'running' }, { type: 'monitor', status: 'pending' }, { type: 'shell', status: 'running' }], []), { tasks: 2, wakeups: 0 })
assert.equal(coordinatorBackgroundWork([{ type: 'subagent', status: 'completed' }], []), null, 'finished background work does not keep anyone working')
assert.deepEqual(coordinatorBackgroundWork([], [{ id: 'c1' }]), { tasks: 0, wakeups: 1 }, 'a scheduled wake-up will bring the agent back')
const background = { ...state, backgroundAgents: coordinatorBackgroundAgents(state.snapshot!.agents, [{ sessionId: 'worker-chat', backgroundTasks: [{ type: 'subagent', status: 'running' }], sessionCrons: [{}] }]) }
assert.deepEqual(background.backgroundAgents, [{ agentId: 'w1', tasks: 1, wakeups: 1 }])
assert.equal(coordinatorAgentActivity(state.snapshot!.agents[1], background), 'Working in background · 1 background task · 1 scheduled wake-up')
assert.deepEqual(coordinatorStalledAgentIds(background, late), [], 'an agent waiting on its own background work has not stalled')
assert.equal(coordinatorAgentActivity(state.snapshot!.agents[1], { ...background, permissions: [{ agentId: 'w1', agentName: 'reviewer', permission: { id: 'p', title: 't' } as never }] }), 'Waiting for your answer',
  'a question outranks background work: it is what the user can act on')

// ── Herdr's focus rule ──────────────────────────────────────────────────────
assert.equal(coordinatorSignalSuppressed(true, true), true, 'looking and focused: quiet')
assert.equal(coordinatorSignalSuppressed(true, null), true, 'unknown focus counts as focused')
assert.equal(coordinatorSignalSuppressed(true, false), false, 'looking at a blurred terminal is not looking')
assert.equal(coordinatorSignalSuppressed(false, true), false, 'another conversation always notifies')

// ── Herdr's delivery setting (ui.toast.delivery) ────────────────────────────
assert.deepEqual(coordinatorAlertDelivery('off', false, false), { notice: false, desktop: false }, 'off means off, even for a background team')
assert.deepEqual(coordinatorAlertDelivery('in-app', false, true), { notice: true, desktop: false })
assert.deepEqual(coordinatorAlertDelivery('desktop', false, true), { notice: true, desktop: true })
assert.deepEqual(coordinatorAlertDelivery('desktop', true, true), { notice: false, desktop: false }, 'looking at the team with the terminal focused: quiet')
assert.deepEqual(coordinatorAlertDelivery('desktop', true, false), { notice: false, desktop: true }, 'the panel already shows it, but a blurred terminal still needs the desktop alert')

console.log('Coordinator signals: stall window + exclusions, baseline-silent transitions, reviewed results, lead exclusion, attention priority, roster order, worktree labels, teammate notes, per-agent results, background work, delivery setting, focus suppression passed')
