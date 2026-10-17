import { coordinatorAttention } from './coordinatorAttention'
import { coordinatorStalledAgentIds, type CoordinatorInteractiveState } from './coordinatorInteractiveState'
import { coordinatorPickerState, coordinatorRosterOrder, type CoordinatorPickerState } from './coordinatorSignals'

export const COORDINATOR_ROSTER_FILTERS = ['all', 'blocked', 'working', 'done', 'idle', 'unknown'] as const
export type CoordinatorRosterFilter = typeof COORDINATOR_ROSTER_FILTERS[number]
export const COORDINATOR_ROSTER_LABELS: Record<CoordinatorRosterFilter, string> = {
  all: 'All teammates', blocked: 'Needs input', working: 'Working', done: 'Unreviewed results', idle: 'Idle or queued', unknown: 'Unknown',
}

/** Read-only navigation: filtering never acknowledges a result or submits work. */
export function filterCoordinatorRoster(state: CoordinatorInteractiveState | null, reviewed: readonly string[], query: string, filter: CoordinatorRosterFilter, observationUnavailable = false) {
  const roster = coordinatorRosterOrder(state, reviewed)
  const snapshot = state?.snapshot
  const counts: Record<CoordinatorRosterFilter, number> = { all: roster.length, blocked: 0, working: 0, done: 0, idle: 0, unknown: 0 }
  if (!snapshot || !state) return { agents: roster, counts }
  const attention = coordinatorAttention(snapshot)
  const stalled = new Set(coordinatorStalledAgentIds(state))
  const needsInput = new Set([...state.permissions.map(item => item.agentId), ...state.recoveries, ...stalled])
  const running = new Set([...state.runningAgentIds, ...(state.backgroundAgents ?? []).map(item => item.agentId)])
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const taskText = new Map<string, string[]>()
  for (const task of snapshot.tasks) if (task.ownerAgentId) {
    const words = taskText.get(task.ownerAgentId) ?? []
    words.push(task.title, ...(task.paths ?? []))
    taskText.set(task.ownerAgentId, words)
  }
  const agents = roster.filter(agent => {
    let status: CoordinatorPickerState
    if (observationUnavailable || state.interactive.executionElsewhere) status = 'unknown'
    else if (needsInput.has(agent.id)) status = 'blocked'
    else if (running.has(agent.id)) status = 'working'
    else if (agent.liveness?.status === 'dead' || agent.liveness?.status === 'stale') status = 'unknown'
    else if (state.interactive.resources?.pausedReason && agent.taskId && !['blocked', 'done', 'failed', 'stopped'].includes(agent.status)) status = 'idle'
    else status = coordinatorPickerState(agent, snapshot, reviewed, attention)
    counts[status] += 1
    if (filter !== 'all' && status !== filter) return false
    const text = [agent.name, agent.provider, agent.sessionId, agent.worktreePath, agent.worktreeBranch, ...(taskText.get(agent.id) ?? [])].join(' ').toLocaleLowerCase()
    return tokens.every(token => text.includes(token))
  })
  return { agents, counts }
}
