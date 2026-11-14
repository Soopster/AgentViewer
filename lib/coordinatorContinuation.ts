import type { ProtocolMessage } from './agentProtocol'

/** Human ownership comes from a provider request or an explicit review gate,
 * never from an agent saying it is blocked or asking another agent a question. */
export type CoordinatorHumanGate = {
  agentId: string
  kind: 'permission' | 'question' | 'plan' | 'decision'
  id?: string
}

export type CoordinatorContinuationInput = {
  mode: 'app-managed' | 'external'
  autoContinue: boolean
  remainingTurns: number
  runStatus: string
  leadAgentId: string
  leadBusy: boolean
  deliveryPending: boolean
  budgetExceeded: boolean
  mail: readonly Pick<ProtocolMessage, 'kind' | 'replyRequired'>[]
  humanGates?: readonly CoordinatorHumanGate[]
}

export type CoordinatorContinuationState = {
  mode: CoordinatorContinuationInput['mode']
  autoContinue: boolean
  remainingTurns: number
  pendingMessageCount: number
  canContinue: boolean
  pausedReason: 'external-host' | 'run-not-running' | 'continuation-disabled'
    | 'allowance-exhausted' | 'lead-busy' | 'delivery-unconfirmed'
    | 'lead-human-gate' | 'budget-exhausted' | 'no-actionable-mail' | null
  humanGates: CoordinatorHumanGate[]
}

/** Pure scheduling policy, also suitable for a bounded status diagnostic.
 * Allowing coordination grants no authority to answer any human gate. A
 * teammate's approval can remain pending while the lead handles other work.
 * The lead's own provider request prevents starting a competing provider turn.
 */
export function classifyCoordinatorContinuation(input: CoordinatorContinuationInput): CoordinatorContinuationState {
  const humanGates = (input.humanGates ?? []).map(gate => ({ ...gate }))
  const actionable = input.mail.some(message => message.replyRequired
    || (message.kind !== 'status' && message.kind !== 'status_summary'))
  let pausedReason: CoordinatorContinuationState['pausedReason'] = null
  if (input.mode === 'external') pausedReason = 'external-host'
  else if (input.runStatus !== 'running') pausedReason = 'run-not-running'
  else if (!input.autoContinue) pausedReason = 'continuation-disabled'
  else if (input.remainingTurns <= 0) pausedReason = 'allowance-exhausted'
  else if (input.leadBusy) pausedReason = 'lead-busy'
  else if (input.deliveryPending) pausedReason = 'delivery-unconfirmed'
  else if (humanGates.some(gate => gate.agentId === input.leadAgentId
    && (gate.kind === 'permission' || gate.kind === 'question'))) pausedReason = 'lead-human-gate'
  else if (input.budgetExceeded) pausedReason = 'budget-exhausted'
  else if (!actionable) pausedReason = 'no-actionable-mail'
  return {
    mode: input.mode, autoContinue: input.autoContinue, remainingTurns: input.remainingTurns,
    pendingMessageCount: input.mail.length, canContinue: pausedReason === null, pausedReason, humanGates,
  }
}
