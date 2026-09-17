// Interactive Coordinator notification signals, shared by the web and TUI.
//
// Taken from herdr's state-transition notifications (src/app/actions.rs): an
// agent that becomes blocked "needs attention", one that settles after working
// "finished", and neither fires while the user is already looking at it with
// the terminal focused. Two rules carry over exactly, because each failure is
// silent in the other direction:
//
// - **Only transitions notify.** The first observation of a conversation is a
//   baseline. Otherwise opening the TUI, or merely selecting an old chat,
//   replays a desktop notification for every question and result it already
//   holds — and a user taught that notifications are noise stops reading them.
// - **Suppression needs positive evidence the user is looking.** Viewing the
//   panel suppresses only while the terminal is not known to be blurred; an
//   unknown focus state counts as focused, as herdr's `outer_terminal_focus !=
//   Some(false)` does, so a terminal that cannot report focus is not spammed.
//
// Signal ids are durable-state ids, so a signal that clears and later returns
// with a new id (a second question, a later result) notifies again, while a
// poll that re-reads the same state never does.
import { coordinatorAttention } from './coordinatorAttention'
import { coordinatorStalledAgentIds, type CoordinatorInteractiveState } from './coordinatorInteractiveState'

export type CoordinatorSignal = {
  id: string
  kind: 'needs-attention' | 'finished'
  title: string
  detail: string
  agentId?: string
}

export function coordinatorSignals(
  state: CoordinatorInteractiveState | null,
  reviewed: readonly string[] = [],
  now = Date.now(),
): CoordinatorSignal[] {
  const snapshot = state?.snapshot
  if (!state || !snapshot) return []
  const nameOf = (agentId?: string) => snapshot.agents.find(agent => agent.id === agentId)?.name ?? 'A teammate'
  const signals: CoordinatorSignal[] = []
  for (const item of coordinatorAttention(snapshot)) {
    if (item.kind === 'result' && reviewed.includes(item.id)) continue
    signals.push({
      id: item.id,
      kind: item.kind === 'result' ? 'finished' : 'needs-attention',
      title: item.kind === 'result' ? `${nameOf(item.agentId)} finished` : `${nameOf(item.agentId)}: ${item.title}`,
      detail: item.kind === 'result' ? item.title : item.detail,
      agentId: item.agentId,
    })
  }
  for (const item of state.permissions) {
    if (item.agentId === snapshot.run.leadAgentId) continue
    signals.push({ id: `permission:${item.agentId}:${item.permission.id}`, kind: 'needs-attention',
      title: `${item.agentName} is waiting for your answer`, detail: item.permission.title, agentId: item.agentId })
  }
  for (const agentId of state.recoveries) {
    signals.push({ id: `recovery:${agentId}`, kind: 'needs-attention',
      title: `${nameOf(agentId)} needs recovery`, detail: 'Inspect its transcript before resuming.', agentId })
  }
  for (const agentId of coordinatorStalledAgentIds(state, now)) {
    const task = snapshot.tasks.find(entry => entry.id === snapshot.agents.find(agent => agent.id === agentId)?.taskId)
    signals.push({ id: `stalled:${agentId}:${task?.id}:${task?.updatedAt}`, kind: 'needs-attention',
      title: `${nameOf(agentId)} has not started`, detail: `${task?.title ?? 'Delegated work'} · no provider activity observed; inspect before resending.`, agentId })
  }
  return signals
}

/**
 * Signals that appeared since `previousIds`. A `null` baseline is the first
 * observation and yields nothing, by design (see the file header).
 */
export function newCoordinatorSignals(
  previousIds: ReadonlySet<string> | null,
  signals: readonly CoordinatorSignal[],
): CoordinatorSignal[] {
  if (!previousIds) return []
  return signals.filter(signal => !previousIds.has(signal.id))
}

/**
 * Herdr's `pane_attention_priority`, collapsed to what a conversation can hold:
 * something waiting on the user outranks an unreviewed result, which outranks
 * nothing. Used to pick which conversation "jump to attention" opens, so the
 * question blocking a teammate is never behind a result that can wait.
 */
export function coordinatorAttentionPriority(signals: readonly CoordinatorSignal[], unconfirmedRequest = false): number {
  if (unconfirmedRequest || signals.some(signal => signal.kind === 'needs-attention')) return 2
  return signals.length > 0 ? 1 : 0
}

/**
 * Herdr holds a notification for a moment (`ui.toast.delay_seconds`, default 1)
 * and drops it if the agent moved on — an approval auto-granted or answered
 * elsewhere within that window is not worth interrupting anyone for.
 */
export const COORDINATOR_NOTIFICATION_DELAY_MS = 1_000

/** Herdr's active-tab rule: quiet only when viewing AND not known to be blurred. */
export function coordinatorSignalSuppressed(viewing: boolean, terminalFocused: boolean | null): boolean {
  return viewing && terminalFocused !== false
}
