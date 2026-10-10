import type { ExternalProtocolIdentity } from './agentProtocol'
import type { AgentProvider } from './types'
import { coordinatorPermissionToken, validateCoordinatorNativeAnswer, type CoordinatorNativeAnswer } from './coordinatorNativePermission'
import { extractPendingPermissions } from './permissions'

/** Called inside the lead's durable idempotency reservation. Never starts a turn. */
export async function answerCoordinatorNativePermission(identity: ExternalProtocolIdentity, request: CoordinatorNativeAnswer & {
  to?: string
  expectedAgent?: { id: string; sessionId: string; provider: AgentProvider }
}): Promise<{ answered: true }> {
  const [{ readExternalProtocolRun }, backend] = await Promise.all([import('./agentCoordination'), import('./sessionBackend')])
  const snapshot = await readExternalProtocolRun(identity)
  if (snapshot.run.leadAgentId !== identity.agentId) throw new Error('Answer native requests from the lead conversation')
  const expected = request.expectedAgent
  const agent = snapshot.agents.find(entry => entry.id === request.to && entry.role === 'teammate')
  if (!expected || !agent || expected.id !== agent.id || expected.sessionId !== agent.sessionId || expected.provider !== agent.provider) throw new Error('Teammate identity changed; refresh before answering')
  const permission = extractPendingPermissions(backend.readViewSessionRunning(agent.sessionId).pendingPermissions, { sessionId: agent.sessionId, provider: agent.provider })
    .find(entry => entry.id === request.permissionId)
  if (!permission || coordinatorPermissionToken(permission) !== request.permissionToken) throw new Error('Provider request changed or was answered; refresh before sending')
  if (permission.provider !== agent.provider) throw new Error('Provider request identity changed')
  validateCoordinatorNativeAnswer(permission, request)
  const result = await backend.runViewSessionAction({ sessionId: permission.sessionId ?? agent.sessionId, provider: agent.provider, body: {
    action: request.answers ? 'respondQuestion' : 'respondPermission', permissionId: permission.id,
    expectedPermissionToken: coordinatorPermissionToken(permission),
    ...(request.answers ? { answers: request.answers } : { response: request.response }),
    ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
  } })
  if (result.ok === false) throw new Error('Provider did not confirm this answer; inspect before retrying')
  return { answered: true }
}
