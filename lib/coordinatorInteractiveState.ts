import type { ProtocolAgent, ProtocolRunSnapshot } from './agentProtocol'
import type { PendingPermission } from './permissions'

export type CoordinatorInteractiveState = {
  snapshot: ProtocolRunSnapshot | null
  interactive: {
    enabled: boolean; autoContinue: boolean; remainingTurns: number
    delivery: { batchId: string; state: string; createdAt: string; active: boolean } | null
  }
  runningAgentIds: string[]
  recoveries: string[]
  permissions: { agentId: string; agentName: string; permission: PendingPermission }[]
}

export function coordinatorAgentActivity(agent: ProtocolAgent, state: Pick<CoordinatorInteractiveState, 'permissions' | 'recoveries' | 'runningAgentIds'>): string {
  if (state.permissions.some(item => item.agentId === agent.id)) return 'Waiting for your answer'
  if (state.recoveries.includes(agent.id)) return 'Needs recovery · inspect before resuming'
  if (state.runningAgentIds.includes(agent.id)) return agent.status === 'blocked' ? 'Waiting for input' : 'Working · live turn'
  if (agent.turnActive) return 'Starting · awaiting provider activity'
  if (agent.status === 'blocked') return 'Blocked'
  if (agent.status === 'done') return 'Finished'
  if (agent.status === 'failed' || agent.status === 'stopped') return agent.status === 'failed' ? 'Failed' : 'Stopped'
  if (agent.liveness?.status === 'dead' || agent.liveness?.status === 'stale') return 'Unavailable · last observation is stale'
  if (agent.taskId) return agent.status === 'working' ? 'Starting · awaiting provider activity' : 'Queued'
  return 'Available'
}
