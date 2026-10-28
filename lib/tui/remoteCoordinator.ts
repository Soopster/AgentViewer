import type { ProtocolAgent, ProtocolRunSnapshot } from '../agentProtocol'
import type { AgentProvider, SessionMessage } from '../types'
import { machineHeaders } from '../machines.mjs'
import { listWatchedMachines, MACHINE_READ_TIMEOUT_MS, type WatchedMachine } from './machines'
import type { TuiSessionCoordinationRequest } from './service'
import { encodeSessionPath } from './remote'
import { clearCoordinatorRequest, readPendingCoordinatorRequest, reserveCoordinatorRequest } from './coordinatorRequests'
import type { CoordinatorInteractiveState } from '../coordinatorInteractiveState'
import type { PendingPermission } from '../permissions'
import { coordinatorPermissionToken } from '../coordinatorNativePermission'

/** Session/agent ids are only unique inside the owning machine's ledger. */
export type RemoteCoordinatorTarget = {
  machine: { name: string; baseUrl: string }
  runId: string
  agentId: string
  sessionId: string
  provider: AgentProvider
}
export type RemoteCoordinatorView = {
  snapshot: ProtocolRunSnapshot
  agent: ProtocolAgent
  lead: ProtocolAgent | null
  messages: SessionMessage[]
  transcriptNotice: string | null
  writeReason: string | null
  permissions: PendingPermission[]
  permissionNotice: string | null
  observedAt: number
}

const ACTIONS = new Set(['native-answer', 'message', 'delegate', 'interrupt-agent', 'resume-agent', 'review-plan', 'decision'])
export const REMOTE_COORDINATOR_FRESH_MS = 10_000
export function remoteCoordinatorRequestScope(target: RemoteCoordinatorTarget): string {
  return JSON.stringify(['remote-coordinator', target.machine.name, target.machine.baseUrl, target.runId, target.agentId, target.provider, target.sessionId])
}

function pairedMachine(target: RemoteCoordinatorTarget): WatchedMachine {
  const machine = listWatchedMachines().find(entry => entry.name === target.machine.name && entry.baseUrl === target.machine.baseUrl)
  if (!machine) throw new Error('This machine pairing changed or was removed; reselect it from the agent list')
  return machine
}

async function jsonAt<T>(machine: WatchedMachine, route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${machine.baseUrl}${route}`, {
    ...init, headers: { 'Content-Type': 'application/json', ...machineHeaders(machine) },
    signal: AbortSignal.timeout(MACHINE_READ_TIMEOUT_MS), cache: 'no-store',
  })
  if (response.status === 401 || response.status === 403) throw new Error('Remote access denied or credential revoked · re-add the machine with the required scope')
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new Error(failure?.error || `Remote request failed (HTTP ${response.status})`)
  }
  const payload = await response.json().catch(() => null)
  if (!payload) throw new Error('Remote response was unreadable; inspect before retrying')
  return payload as T
}

export async function readRemoteCoordinator(target: RemoteCoordinatorTarget): Promise<RemoteCoordinatorView> {
  const machine = pairedMachine(target)
  const [snapshot, version] = await Promise.all([
    jsonAt<ProtocolRunSnapshot>(machine, `/api/agent-protocol/runs/${encodeURIComponent(target.runId)}`),
    jsonAt<{ features?: string[] }>(machine, '/api/version').catch(() => null),
  ])
  if (snapshot.run?.id !== target.runId) throw new Error('Remote team identity changed; reselect the agent')
  const agent = snapshot.agents.find(entry => entry.id === target.agentId && entry.sessionId === target.sessionId && entry.provider === target.provider)
  if (!agent) throw new Error('Remote teammate identity changed; reselect the agent')
  const lead = snapshot.agents.find(entry => entry.id === snapshot.run.leadAgentId && entry.role === 'lead') ?? null
  const ended = ['completed', 'failed', 'stopped'].includes(snapshot.run.status)
  const writeReason = machine.scope !== 'full' ? 'Read-only pairing · pair with full scope to send input'
    : !version?.features?.includes('coordination.identityGuard') ? 'Daemon lacks guarded remote controls · inspection remains available'
    : !lead || /^(external:|pending:)/.test(lead.sessionId) ? 'External lead · answer through its Coordinator client'
    : agent.role !== 'teammate' ? 'Lead conversation · select a teammate to send remote actions'
    : ended ? 'This team has ended · results remain available' : null
  let messages: SessionMessage[] = []
  let permissions: PendingPermission[] = []
  let permissionNotice: string | null = !version?.features?.includes('coordination.nativeAnswers') ? 'Daemon lacks native request controls' : null
  let transcriptNotice: string | null = null
  async function readRequests() {
    if (!permissionNotice && lead && !/^(external:|pending:)/.test(lead.sessionId)) {
      try {
        const state = await jsonAt<CoordinatorInteractiveState>(machine, `${encodeSessionPath(lead.sessionId, '/coordination')}?provider=${encodeURIComponent(lead.provider)}`)
        if (state.snapshot?.run.id !== target.runId || !state.snapshot.agents.some(entry => entry.id === target.agentId && entry.sessionId === target.sessionId && entry.provider === target.provider)) throw new Error('Native request team identity changed')
        permissions = state.permissions.filter(entry => entry.agentId === target.agentId).map(entry => entry.permission)
      } catch (error) { permissionNotice = error instanceof Error ? error.message : 'Native requests unavailable' }
    } else if (!permissionNotice) permissionNotice = 'Native requests need a connected lead conversation'
  }
  async function readTranscript(nativeAgent: ProtocolAgent) {
    if (/^(external:|pending:)/.test(nativeAgent.sessionId)) transcriptNotice = 'This participant has no native transcript; its messages and results are shown below'
    else {
      const transcript = await jsonAt<{ sessionId: string; provider: AgentProvider; messages: SessionMessage[] }>(machine,
        `${encodeSessionPath(nativeAgent.sessionId, '/messages')}?provider=${encodeURIComponent(nativeAgent.provider)}&tail=1&limit=100`)
      if (transcript.sessionId !== nativeAgent.sessionId || transcript.provider !== nativeAgent.provider || !Array.isArray(transcript.messages)) {
        throw new Error('Remote transcript identity did not match the selected teammate')
      }
      messages = transcript.messages
    }
  }
  await Promise.all([readRequests(), readTranscript(agent)])
  return { snapshot, agent, lead, messages, permissions, permissionNotice, transcriptNotice, writeReason, observedAt: Date.now() }
}

export function pendingRemoteCoordinatorRequest(target: RemoteCoordinatorTarget): TuiSessionCoordinationRequest | null {
  return readPendingCoordinatorRequest(remoteCoordinatorRequestScope(target))
}
export function discardRemoteCoordinatorRequest(target: RemoteCoordinatorTarget, requestId: string): void {
  clearCoordinatorRequest(remoteCoordinatorRequestScope(target), requestId)
}

/** Never changes global attach/provider state. An uncertain send keeps its exact journal entry. */
export async function sendRemoteCoordinatorRequest(target: RemoteCoordinatorTarget, request: TuiSessionCoordinationRequest): Promise<void> {
  if (!ACTIONS.has(request.action)) throw new Error('This action is not available from the remote teammate panel')
  const view = await readRemoteCoordinator(target)
  const nativeRetry = request.action === 'native-answer' && pendingRemoteCoordinatorRequest(target)?.requestId === request.requestId
  if (view.writeReason && !(nativeRetry && view.writeReason === 'This team has ended · results remain available')) throw new Error(view.writeReason)
  if (request.action === 'native-answer') {
    if (view.permissionNotice) throw new Error(view.permissionNotice)
    // A lost successful response removes the prompt. Its exact saved request
    // must still reach the daemon's cached result instead of being resent anew.
    if (!nativeRetry && !view.permissions.some(permission => permission.id === request.permissionId && coordinatorPermissionToken(permission) === request.permissionToken)) throw new Error('Provider request changed or was answered; refresh before sending')
  }
  if (request.to && request.to !== target.agentId) throw new Error('Remote request must address the selected teammate')
  if (request.taskId && !view.snapshot.tasks.some(task => task.id === request.taskId && task.ownerAgentId === target.agentId)) throw new Error('Task no longer belongs to the selected teammate')
  if (request.inReplyTo && !view.snapshot.messages.some(message => message.id === request.inReplyTo && message.fromAgentId === target.agentId && message.toAgentId === view.lead!.id)) throw new Error('Reply target is not a question from this teammate to its lead')
  const bound: TuiSessionCoordinationRequest = {
    ...request, to: target.agentId, expectedRunId: target.runId,
    expectedAgent: { id: target.agentId, sessionId: target.sessionId, provider: target.provider },
  }
  const scope = remoteCoordinatorRequestScope(target)
  reserveCoordinatorRequest(scope, bound)
  const result = await jsonAt<{ snapshot: ProtocolRunSnapshot }>(pairedMachine(target), encodeSessionPath(view.lead!.sessionId, '/coordination'), {
    method: 'POST', body: JSON.stringify({ provider: view.lead!.provider, ...bound }),
  })
  if (result.snapshot?.run.id !== target.runId) throw new Error('Remote response changed team identity; inspect before retrying this request')
  clearCoordinatorRequest(scope, bound.requestId)
}
