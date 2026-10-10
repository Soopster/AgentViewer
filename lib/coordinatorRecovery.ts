import type { CoordinatorInteractiveState } from './coordinatorInteractiveState'
import { coordinatorAgentActivity } from './coordinatorInteractiveState'

export type RecoveryEvidence = {
  agentId: string; sessionId: string; provider: string; worktreePath: string; checkedAt: string
  directory: { available: boolean; detail: string }
  conversation: { available: boolean; detail: string }
}
export type RecoveryInspection = { runId: string; evidence: RecoveryEvidence[] }
export type RecoveryRow = { id: string; title: string; detail: string[]; agentId?: string; canResume: boolean; canReconcile?: boolean }

export function recoveryOverview(state: CoordinatorInteractiveState | null, inspection?: RecoveryInspection | null, pendingRequest?: string | null): RecoveryRow[] {
  if (!state?.snapshot) return [{ id: 'none', title: 'No team attached', detail: ['Enable coordination in this conversation to create a team.'], canResume: false }]
  const { snapshot, interactive } = state
  const rows: RecoveryRow[] = []
  if (pendingRequest) rows.push({ id: 'request', title: 'Unconfirmed client submission', detail: [pendingRequest, 'Inspect task history, then retry the exact saved request. Refreshing observation does not resend it.'], canResume: false })
  if (interactive.executionElsewhere) rows.push({ id: 'host', title: 'Another host owns execution', detail: ['This client observes the team. The existing host retains execution; it is not displaced or restarted.'], canResume: false })
  if (interactive.delivery) rows.push({ id: 'delivery', title: interactive.delivery.active ? 'Lead delivery is live' : 'Lead delivery is uncertain', detail: [`Batch ${interactive.delivery.batchId} · ${interactive.delivery.state} · ${interactive.delivery.createdAt}`, interactive.delivery.active ? 'Reconnect to the lead transcript; do not resend.' : 'Inspect the lead transcript and explicitly confirm received or not received in the teammate panel.'], canResume: false })
  if (interactive.resources?.pausedReason) rows.push({ id: 'budget', title: 'Scheduling paused by a limit', detail: [interactive.resources.pausedReason, 'Owned work is retained. Adjust the relevant team limit before resuming.'], canResume: false })
  for (const agent of snapshot.agents) {
    const evidence = inspection?.runId === snapshot.run.id ? inspection.evidence.find(item => item.agentId === agent.id && item.sessionId === agent.sessionId && item.provider === agent.provider && item.worktreePath === agent.worktreePath) : undefined
    const settled = state.settledExecutions?.includes(agent.id) === true
    const needsRecovery = state.recoveries.includes(agent.id) && !settled
    const task = snapshot.tasks.find(task => task.id === agent.taskId)
    const humanGate = state.permissions.some(item => item.agentId === agent.id) || task?.status === 'planned' || task?.status === 'blocked' || task?.receipt?.needsDecision?.some(decision => decision.status === 'open')
    const available = Boolean(evidence?.directory.available && evidence.conversation.available)
    rows.push({ id: agent.id, agentId: agent.id, title: `${agent.name} · ${coordinatorAgentActivity(agent, state)}`, detail: [
      `${agent.provider} · conversation ${agent.sessionId}`,
      `Saved directory: ${agent.worktreePath}${agent.worktreeBranch ? ` · ${agent.worktreeBranch}` : ''}`,
      task ? `Owned work: ${task.id} · ${task.title} · ${task.status}` : 'No open task assigned.',
      evidence ? `Directory: ${evidence.directory.detail}` : 'Directory availability has not been checked.',
      evidence ? `Conversation: ${evidence.conversation.detail} · checked ${evidence.checkedAt}` : 'Native conversation availability has not been checked.',
      ...(settled ? ['A durable result is terminal, but its prior stream marker remains. Inspect the result, then acknowledge it without starting a turn.'] : []),
      needsRecovery ? 'The ledger retains unfinished execution without a live turn observed here. Inspect the transcript before resuming.' : 'Observation reconnects automatically. Opening a transcript does not resend work.',
      ...(humanGate ? ['Answer the pending question, decision, or approval first.'] : []),
    ], canReconcile: settled && !interactive.executionElsewhere && !pendingRequest, canResume: needsRecovery && Boolean(task) && available && !humanGate && !interactive.executionElsewhere && !interactive.resources?.pausedReason && !pendingRequest })
  }
  return rows
}
