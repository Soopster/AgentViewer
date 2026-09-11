import type { ProtocolRunSnapshot } from './agentProtocol'

export type CoordinatorAttentionItem = {
  id: string
  kind: 'result' | 'blocker' | 'plan' | 'decision' | 'message' | 'review'
  title: string
  detail: string
  agentId?: string
  taskId?: string
  decisionId?: string
  messageId?: string
}

/** Derived from durable state; reading attention never acknowledges model mail. */
export function coordinatorAttention(snapshot: ProtocolRunSnapshot): CoordinatorAttentionItem[] {
  const items: CoordinatorAttentionItem[] = []
  for (const task of snapshot.tasks) {
    const base = { agentId: task.ownerAgentId, taskId: task.id }
    if (['completed', 'failed', 'cancelled'].includes(task.status)) items.push({ ...base,
      id: `result:${task.id}:${task.updatedAt}`, kind: 'result', title: `${task.title} · ${task.status}`,
      detail: task.resultSummary || task.resultDetail || 'No result summary supplied.',
    })
    if (task.status === 'blocked') items.push({ ...base, id: `blocker:${task.id}:${task.updatedAt}`, kind: 'blocker', title: task.title,
      detail: [...snapshot.events].reverse().find(event => event.taskId === task.id && event.type === 'agent.blocked')?.summary || 'Teammate needs help to continue.',
    })
    if (task.status === 'planned') items.push({ ...base, id: `plan:${task.id}:${task.updatedAt}`, kind: 'plan', title: task.title,
      detail: [...snapshot.events].reverse().find(event => event.taskId === task.id && event.type === 'plan.completed')?.detail || 'Review the submitted plan before approving work.',
    })
    for (const decision of task.receipt?.needsDecision ?? []) {
      if (decision.status === 'open') items.push({ ...base, id: `decision:${task.id}:${decision.id}`, kind: 'decision',
        title: decision.question, detail: decision.impactIfWrong, decisionId: decision.id })
    }
  }
  for (const message of snapshot.messages) {
    if (message.toAgentId === snapshot.run.leadAgentId && message.replyRequired && !message.resolvedAt) items.push({
      id: `message:${message.id}`, kind: 'message', title: 'Teammate needs a reply', detail: message.body,
      agentId: message.fromAgentId, messageId: message.id,
    })
  }
  if (snapshot.run.requireReview && snapshot.run.review.status === 'pending') items.push({
    id: `review:${snapshot.run.id}`, kind: 'review', title: 'Run review required', detail: 'Review task results in the Coordinator before finalizing.',
  })
  return items.sort((a, b) => Number(a.kind === 'result') - Number(b.kind === 'result'))
}
