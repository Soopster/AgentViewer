import type { ProtocolAgent } from './agentProtocol'

export type CoordinatorWaitingPolicy = {
  mode: 'managed' | 'interactive' | 'cooperative' | 'unknown'
  source: 'unattended-capability' | 'managed-binding' | 'external-client' | 'cooperative-session' | 'unverified-host'
  idleAction: 'return_to_supervisor' | 'subscribe_or_wait' | 'return_to_user' | 'check_host'
  coordWaitAllowed: boolean
}

/** Waiting ownership is independent of liveness, task status and auto-continue. */
export function coordinatorWaitingPolicy(agent: Pick<ProtocolAgent, 'id' | 'sessionId' | 'capabilities'>, managedBinding: boolean): CoordinatorWaitingPolicy {
  if (agent.capabilities?.unattended === true) return { mode: 'managed', source: 'unattended-capability', idleAction: 'return_to_supervisor', coordWaitAllowed: false }
  if (agent.id.startsWith('coop-')) return { mode: 'cooperative', source: 'cooperative-session', idleAction: 'return_to_user', coordWaitAllowed: false }
  if (managedBinding) return { mode: 'managed', source: 'managed-binding', idleAction: 'return_to_supervisor', coordWaitAllowed: false }
  if (agent.sessionId.startsWith('external:')) return { mode: 'interactive', source: 'external-client', idleAction: 'subscribe_or_wait', coordWaitAllowed: true }
  return { mode: 'unknown', source: 'unverified-host', idleAction: 'check_host', coordWaitAllowed: false }
}
