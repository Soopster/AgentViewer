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
import type { ProtocolAgent, ProtocolRunSnapshot } from './agentProtocol'

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

/**
 * Where one alert goes, given herdr's delivery setting and active-tab rule.
 * The in-app notice is skipped while viewing — the panel already shows it —
 * but a desktop alert is not: `viewing` with a blurred terminal is not looking.
 */
export function coordinatorAlertDelivery(
  mode: 'off' | 'in-app' | 'desktop',
  viewing: boolean,
  terminalFocused: boolean | null,
): { notice: boolean; desktop: boolean } {
  if (mode === 'off' || coordinatorSignalSuppressed(viewing, terminalFocused)) return { notice: false, desktop: false }
  return { notice: !viewing, desktop: mode === 'desktop' }
}

/** Herdr's active-tab rule: quiet only when viewing AND not known to be blurred. */
export function coordinatorSignalSuppressed(viewing: boolean, terminalFocused: boolean | null): boolean {
  return viewing && terminalFocused !== false
}

/**
 * Teammates in herdr's agent-panel order (`AgentPanelSort::Priority`): waiting
 * on the user, then an unreviewed result, then working, then the rest; within a
 * tier, the most recent task change first. Ties keep roster order, and recency
 * reads the task — not heartbeats — so a quiet roster does not reshuffle.
 */
export function coordinatorRosterOrder(
  state: CoordinatorInteractiveState | null,
  reviewed: readonly string[] = [],
  now = Date.now(),
): ProtocolAgent[] {
  const snapshot = state?.snapshot
  if (!state || !snapshot) return []
  const signals = coordinatorSignals(state, reviewed, now)
  const tier = (agent: ProtocolAgent) => {
    if (agent.status === 'blocked' || signals.some(signal => signal.agentId === agent.id && signal.kind === 'needs-attention')) return 3
    if (signals.some(signal => signal.agentId === agent.id && signal.kind === 'finished')) return 2
    if (agent.turnActive || state.runningAgentIds.includes(agent.id) || state.backgroundAgents?.some(entry => entry.agentId === agent.id)) return 1
    return 0
  }
  const changedAt = (agent: ProtocolAgent) => {
    const times = snapshot.tasks.filter(task => task.ownerAgentId === agent.id).map(task => Date.parse(task.updatedAt)).filter(Number.isFinite)
    return times.length ? Math.max(...times) : 0
  }
  return snapshot.agents
    .filter(agent => agent.role === 'teammate')
    .map((agent, index) => ({ agent, index, tier: tier(agent), changedAt: changedAt(agent) }))
    .sort((a, b) => b.tier - a.tier || b.changedAt - a.changedAt || a.index - b.index)
    .map(entry => entry.agent)
}

/**
 * Herdr marks an agent's completion seen when the user focuses it. Opening a
 * teammate's transcript is that focus here, so its results are reviewed by the
 * act of reading them rather than by a second keystroke.
 */
export function coordinatorResultIdsForAgent(snapshot: ProtocolRunSnapshot | null | undefined, agentId: string): string[] {
  if (!snapshot) return []
  return coordinatorAttention(snapshot).filter(item => item.kind === 'result' && item.agentId === agentId).map(item => item.id)
}
