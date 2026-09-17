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
  permissions: { agentId: string; agentName: string; permission: PendingPermission }[]
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
    if (state.runningAgentIds.includes(agent.id) || state.recoveries.includes(agent.id) || state.permissions.some(item => item.agentId === agent.id)) return false
    const task = snapshot.tasks.find(entry => entry.id === agent.taskId)
    const claimedAt = task ? Date.parse(task.updatedAt) : NaN
    return task?.status === 'claimed' && Number.isFinite(claimedAt) && now - claimedAt >= COORDINATOR_START_STALL_MS
  }).map(agent => agent.id)
}

export function coordinatorAgentActivity(agent: ProtocolAgent, state: Pick<CoordinatorInteractiveState, 'permissions' | 'recoveries' | 'runningAgentIds'> & Partial<Pick<CoordinatorInteractiveState, 'interactive'>>, observationUnavailable = false, stalled = false): string {
  if (observationUnavailable) return 'Unknown · last observation unavailable'
  if (state.interactive?.executionElsewhere) return 'Managed by another host · inspect there'
  if (state.permissions.some(item => item.agentId === agent.id)) return 'Waiting for your answer'
  if (state.recoveries.includes(agent.id)) return 'Needs recovery · inspect before resuming'
  if (state.runningAgentIds.includes(agent.id)) return agent.status === 'blocked' ? 'Waiting for input' : 'Working · live turn'
  if (agent.turnActive) return 'Starting · awaiting provider activity'
  if (stalled) return 'Stalled · no provider activity observed · inspect before resending'
  if (agent.status === 'blocked') return 'Blocked'
  if (agent.status === 'done') return 'Finished'
  if (agent.status === 'failed' || agent.status === 'stopped') return agent.status === 'failed' ? 'Failed' : 'Stopped'
  if (agent.liveness?.status === 'dead' || agent.liveness?.status === 'stale') return 'Unavailable · last observation is stale'
  if (agent.taskId) return agent.status === 'working' ? 'Starting · awaiting provider activity' : 'Queued'
  return 'Available'
}
