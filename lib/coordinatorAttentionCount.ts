import { coordinatorAttention } from './coordinatorAttention'
import { describeRunRollup } from './coordinatorRollup'
import { coordinatorStalledAgentIds, type CoordinatorInteractiveState } from './coordinatorInteractiveState'

export function coordinatorAttentionCount(state: CoordinatorInteractiveState | null, reviewed: readonly string[] = [], now = Date.now()): number {
  if (!state) return 0
  const items = state.snapshot ? coordinatorAttention(state.snapshot).filter(item => item.kind !== 'result' || !reviewed.includes(item.id)) : []
  const rollup = state.interactive.enabled && state.snapshot?.rollup ? describeRunRollup(state.snapshot.rollup, state.snapshot.run.budget).attentionCount : 0
  return rollup + items.length + state.permissions.filter(item => item.agentId !== state.snapshot?.run.leadAgentId).length
    + state.recoveries.length + (state.settledExecutions?.length ?? 0) + coordinatorStalledAgentIds(state, now).length + Number(Boolean(state.interactive.delivery && !state.interactive.delivery.active))
}
