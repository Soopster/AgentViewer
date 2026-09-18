import type { ProtocolAgent, ProtocolRunSnapshot } from './agentProtocol'
import type { PendingPermission } from './permissions'

export type CoordinatorInteractiveState = {
  snapshot: ProtocolRunSnapshot | null
  interactive: {
    executionElsewhere?: boolean
    enabled: boolean; autoContinue: boolean; remainingTurns: number
    delivery: { batchId: string; state: string; createdAt: string; active: boolean } | null
  }
  runningAgentIds: string[]
  recoveries: string[]
  /**
   * Teammates whose turn ended with background work still due to report back.
   * Optional: a daemon older than this field simply omits it.
   */
  backgroundAgents?: { agentId: string; tasks: number; wakeups: number }[]
  permissions: { agentId: string; agentName: string; permission: PendingPermission }[]
}

/**
 * What the teammate last said it was doing, in its own words — herdr's
 * agent-reported sidebar tokens, whose point is that a state label ("working")
 * does not say what the work IS.
 *
 * Only the teammate's own reports count: progress, heartbeats with something to
 * say, a block, a finding, a result. Mail to other teammates is not a status
 * line, and the lead's own events are not the teammate's voice. One line, capped,
 * because this shares a roster row.
 */
const COORDINATOR_NOTE_EVENTS = new Set([
  'agent.start_work', 'agent.heartbeat', 'agent.blocked', 'agent.ready',
  'task.completed', 'task.failed', 'finding.published', 'plan.completed',
])
const COORDINATOR_NOTE_MAX = 72

export function coordinatorAgentNote(agent: ProtocolAgent, snapshot: ProtocolRunSnapshot | null | undefined): string {
  if (!snapshot) return ''
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index]!
    if (event.agentId !== agent.id || !COORDINATOR_NOTE_EVENTS.has(event.type)) continue
    const line = (event.summary ?? '').split('\n').map(part => part.trim()).find(Boolean)
    if (!line) continue
    return line.length > COORDINATOR_NOTE_MAX ? `${line.slice(0, COORDINATOR_NOTE_MAX - 1)}…` : line
  }
  return ''
}

/**
 * The teammate's own checkout, when it has one — herdr's agent list carries
 * each agent's `cwd` and branch, and a team whose members work in separate
 * worktrees is unreadable without it: every row otherwise looks like the same
 * place. Empty for a teammate sharing the lead's checkout, where the branch is
 * the lead's and saying so twice is noise.
 */
export function coordinatorAgentWorkspace(agent: ProtocolAgent, snapshot: ProtocolRunSnapshot | null | undefined): string {
  const lead = snapshot?.agents.find(entry => entry.id === snapshot.run.leadAgentId)
  if (!agent.worktreeBranch || (lead && agent.worktreePath === lead.worktreePath)) return ''
  return agent.worktreeBranch
}

/**
 * How long delegated work may sit claimed with no dispatch before it is
 * reported as stalled — herdr's five-second `agent_prompt_stalled` gate, sized
 * to what this transport actually waits on. Provider spawn time is NOT part of
 * it: `turnActive` is set synchronously when a dispatch starts, before the
 * durable reservation and before the provider launches, and a reservation left
 * without a turn is reported as recovery instead. So a claimed task that is
 * neither in flight nor in recovery is one no dispatch has picked up at all.
 * Delegation dispatches immediately and the maintenance sweep retries every 5s
 * (`MAIL_SWEEP_INTERVAL_MS`); 15s is three missed passes. Crossing it proves
 * only that nothing was observed — never that the work was not delivered.
 */
/**
 * Background work that keeps a teammate "working" after its turn ends — herdr's
 * rule (#1630, #3090, #3414): background subagents, MCP tasks, monitors and
 * scheduled wakeups will wake the session with more to say, so an idle prompt
 * there is not done. A background shell alone is not: a dev server can run for
 * hours without the agent ever coming back to report.
 */
export function coordinatorBackgroundWork(
  tasks: readonly { type: string; status: string }[],
  wakeups: readonly unknown[],
): { tasks: number; wakeups: number } | null {
  const live = tasks.filter(task => task.type !== 'shell' && ['running', 'pending'].includes(task.status)).length
  return live || wakeups.length ? { tasks: live, wakeups: wakeups.length } : null
}

/** Assemble `backgroundAgents` from the waiting-session registry (lib/sessionRuntime.ts). */
export function coordinatorBackgroundAgents(
  agents: readonly ProtocolAgent[],
  waiting: readonly { sessionId: string; backgroundTasks: readonly { type: string; status: string }[]; sessionCrons: readonly unknown[] }[],
): NonNullable<CoordinatorInteractiveState['backgroundAgents']> {
  const bySession = new Map(waiting.map(entry => [entry.sessionId, entry]))
  return agents.flatMap(agent => {
    const entry = bySession.get(agent.sessionId)
    const work = entry && coordinatorBackgroundWork(entry.backgroundTasks, entry.sessionCrons)
    return work ? [{ agentId: agent.id, ...work }] : []
  })
}

export const COORDINATOR_START_STALL_MS = 15_000

/**
 * Managed teammates holding a claimed task that no provider turn has picked up
 * within the stall window. External workers are excluded: they run in their
 * own supervisors, which liveness already describes.
 */
export function coordinatorStalledAgentIds(state: CoordinatorInteractiveState | null, now = Date.now()): string[] {
  const snapshot = state?.snapshot
  if (!state || !snapshot || state.interactive.executionElsewhere || !['running', 'planning', 'blocked'].includes(snapshot.run.status)) return []
  return snapshot.agents.filter(agent => {
    if (agent.role !== 'teammate' || !agent.taskId || agent.turnActive || agent.sessionId.startsWith('external:')) return false
    if (state.runningAgentIds.includes(agent.id) || state.backgroundAgents?.some(entry => entry.agentId === agent.id) || state.recoveries.includes(agent.id) || state.permissions.some(item => item.agentId === agent.id)) return false
    const task = snapshot.tasks.find(entry => entry.id === agent.taskId)
    const claimedAt = task ? Date.parse(task.updatedAt) : NaN
    return task?.status === 'claimed' && Number.isFinite(claimedAt) && now - claimedAt >= COORDINATOR_START_STALL_MS
  }).map(agent => agent.id)
}

export function coordinatorAgentActivity(agent: ProtocolAgent, state: Pick<CoordinatorInteractiveState, 'permissions' | 'recoveries' | 'runningAgentIds'> & Partial<Pick<CoordinatorInteractiveState, 'interactive' | 'backgroundAgents'>>, observationUnavailable = false, stalled = false): string {
  if (observationUnavailable) return 'Unknown · last observation unavailable'
  if (state.interactive?.executionElsewhere) return 'Managed by another host · inspect there'
  if (state.permissions.some(item => item.agentId === agent.id)) return 'Waiting for your answer'
  if (state.recoveries.includes(agent.id)) return 'Needs recovery · inspect before resuming'
  if (state.runningAgentIds.includes(agent.id)) return agent.status === 'blocked' ? 'Waiting for input' : 'Working · live turn'
  if (agent.turnActive) return 'Starting · awaiting provider activity'
  const background = state.backgroundAgents?.find(entry => entry.agentId === agent.id)
  if (background) {
    const parts = [background.tasks ? `${background.tasks} background task${background.tasks === 1 ? '' : 's'}` : '', background.wakeups ? `${background.wakeups} scheduled wake-up${background.wakeups === 1 ? '' : 's'}` : ''].filter(Boolean)
    return `Working in background · ${parts.join(' · ')}`
  }
  if (stalled) return 'Stalled · no provider activity observed · inspect before resending'
  if (agent.status === 'blocked') return 'Blocked'
  if (agent.status === 'done') return 'Finished'
  if (agent.status === 'failed' || agent.status === 'stopped') return agent.status === 'failed' ? 'Failed' : 'Stopped'
  if (agent.liveness?.status === 'dead' || agent.liveness?.status === 'stale') return 'Unavailable · last observation is stale'
  if (agent.taskId) return agent.status === 'working' ? 'Starting · awaiting provider activity' : 'Queued'
  return 'Available'
}
