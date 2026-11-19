import type { ProtocolRunSnapshot } from '../../../lib/agentProtocol'
import { computeRunRollup } from '../../../lib/coordinatorRollup'
import { workRelativePath } from './workbenchModel'

export const isFinishedCoordinatorTask = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)
export function coordinationRunsForRepository(snapshots: Iterable<ProtocolRunSnapshot>, root: string): ProtocolRunSnapshot[] {
  return [...snapshots].filter(snapshot => workRelativePath(snapshot.run.baseCwd, root) !== null
    || snapshot.agents.some(agent => agent.worktreePath && workRelativePath(agent.worktreePath, root) !== null))
    .sort((a, b) => Number(['completed', 'failed', 'stopped'].includes(a.run.status)) - Number(['completed', 'failed', 'stopped'].includes(b.run.status))
      || b.run.updatedAt.localeCompare(a.run.updatedAt))
}

/** Use the Coordinator's own overlap and bottleneck semantics, not another guess. */
export function coordinationOverview(snapshot: ProtocolRunSnapshot) {
  const agents = new Map(snapshot.agents.map(agent => [agent.id, agent]))
  const byId = new Map(snapshot.tasks.map(task => [task.id, task]))
  const latestStatus = new Map<string, (typeof snapshot.messages)[number]>()
  for (const message of snapshot.messages) {
    if (!['status', 'status_summary'].includes(message.kind)) continue
    if (!latestStatus.has(message.fromAgentId) || latestStatus.get(message.fromAgentId)!.createdAt < message.createdAt) latestStatus.set(message.fromAgentId, message)
  }
  const tasks = snapshot.tasks.map(task => ({
    task, owner: task.ownerAgentId ? agents.get(task.ownerAgentId) : undefined,
    dependencies: task.blockedBy.map(id => ({ id, task: byId.get(id), unresolved: byId.get(id)?.status !== 'completed' })),
    lastStatus: task.ownerAgentId ? latestStatus.get(task.ownerAgentId)?.body : undefined,
  }))
  const rollup = snapshot.rollup ?? computeRunRollup({ run: snapshot.run, tasks: snapshot.tasks, agentNames: new Map(snapshot.agents.map(agent => [agent.id, agent.name])), usage: {} })
  return { agents, tasks, overlaps: rollup.overlaps.filter(overlap => overlap.live), holdUps: rollup.holdUps, idleWarning: rollup.idleWarning, budgetWarning: rollup.budgetWarning }
}
