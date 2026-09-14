import { coordinatorAttention } from './coordinatorAttention'
import type { CoordinatorInteractiveState } from './coordinatorInteractiveState'

export function coordinatorAttentionCount(state: CoordinatorInteractiveState | null, reviewed: readonly string[] = []): number {
  if (!state) return 0
  const items = state.snapshot ? coordinatorAttention(state.snapshot).filter(item => item.kind !== 'result' || !reviewed.includes(item.id)) : []
  return items.length + state.permissions.filter(item => item.agentId !== state.snapshot?.run.leadAgentId).length
    + state.recoveries.length + Number(Boolean(state.interactive.delivery && !state.interactive.delivery.active))
}
