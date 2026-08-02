import {
  type AgentInfo,
  type ChatState,
  type ChatSummary,
  type MessageKind,
  type RootState,
  type SessionLifecycle,
  type SessionState,
  type SessionStatus,
  type SessionSummary,
  type Snapshot,
  type Turn,
  type TurnState,
  type URI,
} from '@microsoft/agent-host-protocol'
import { pathToFileURL } from 'node:url'
import type {
  ProtocolAgent,
  ProtocolMessage,
  ProtocolRun,
  ProtocolRunSnapshot,
  ProtocolRunStatus,
} from './agentProtocol'
import type { AgentProvider } from './types'

export const AHP_ROOT_CHANNEL = 'ahp-root://' as const
export const AHP_COORDINATOR_META_KEY = 'dev.agent-viewer.coordinator' as const
export const AHP_COORDINATOR_META_VERSION = 1 as const

// The official package publishes these as ambient const enums. Next's
// isolatedModules mode cannot reference those values directly, so retain the
// normative wire values locally while keeping the public types checked.
const AHP_SESSION_LIFECYCLE_READY = 'ready' as SessionLifecycle
const AHP_STATUS_IDLE = 1 as SessionStatus
const AHP_STATUS_ERROR = 2 as SessionStatus
const AHP_STATUS_IN_PROGRESS = 8 as SessionStatus
const AHP_STATUS_INPUT_NEEDED = 24 as SessionStatus
const AHP_CHAT_INTERACTIVITY_READ_ONLY = 'read-only' as NonNullable<ChatSummary['interactivity']>
const AHP_MESSAGE_KIND_AGENT = 'agent' as MessageKind
const AHP_TURN_STATE_COMPLETE = 'complete' as TurnState

const PROVIDERS: ReadonlyArray<{ provider: AgentProvider; displayName: string }> = [
  { provider: 'claude', displayName: 'Claude' },
  { provider: 'codex', displayName: 'Codex' },
  { provider: 'opencode', displayName: 'OpenCode' },
  { provider: 'copilot', displayName: 'GitHub Copilot' },
  { provider: 'pi', displayName: 'Pi' },
]

export function coordinatorSessionUri(runId: string): URI {
  return `ahp-session:/${encodeURIComponent(runId)}`
}

export function coordinatorChatUri(runId: string, agentId: string): URI {
  return `ahp-chat:/${encodeURIComponent(runId)}/${encodeURIComponent(agentId)}`
}

export function runIdFromCoordinatorSessionUri(channel: string): string | null {
  const match = /^ahp-session:\/([^/?#]+)$/.exec(channel)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return null
  }
}

export function coordinatorChatParts(channel: string): { runId: string; agentId: string } | null {
  const match = /^ahp-chat:\/([^/?#]+)\/([^/?#]+)$/.exec(channel)
  if (!match) return null
  try {
    return {
      runId: decodeURIComponent(match[1]!),
      agentId: decodeURIComponent(match[2]!),
    }
  } catch {
    return null
  }
}

function activity(status: ProtocolRunStatus): string | undefined {
  switch (status) {
    case 'planning':
      return 'Planning multi-agent work'
    case 'running':
      return 'Coordinating agents'
    case 'synthesizing':
      return 'Synthesizing results'
    case 'blocked':
      return 'Waiting for input'
    default:
      return undefined
  }
}

function runStatus(status: ProtocolRunStatus): SessionStatus {
  switch (status) {
    case 'planning':
    case 'running':
    case 'synthesizing':
      return AHP_STATUS_IN_PROGRESS
    case 'blocked':
      return AHP_STATUS_INPUT_NEEDED
    case 'failed':
      return AHP_STATUS_ERROR
    default:
      return AHP_STATUS_IDLE
  }
}

function agentStatus(agent: ProtocolAgent): SessionStatus {
  if (agent.status === 'blocked') return AHP_STATUS_INPUT_NEEDED
  if (agent.status === 'failed') return AHP_STATUS_ERROR
  if (agent.turnActive || agent.status === 'working') return AHP_STATUS_IN_PROGRESS
  return AHP_STATUS_IDLE
}

function fileUri(filePath: string): URI {
  return pathToFileURL(filePath).href
}

function chatSummary(run: ProtocolRun, agent: ProtocolAgent): ChatSummary {
  const workingDirectory = agent.worktreePath ? fileUri(agent.worktreePath) : undefined
  return {
    resource: coordinatorChatUri(run.id, agent.id),
    title: agent.role === 'lead' ? 'Lead' : agent.name,
    // Surface Coordinator liveness through AHP's standard status flags while
    // retaining workflow-specific detail in activity and namespaced metadata.
    status: agentStatus(agent),
    activity: agent.taskId
      ? `${agent.status}: ${agent.taskId}`
      : agent.status === 'working'
        ? 'Working'
        : undefined,
    modifiedAt: agent.updatedAt,
    // Coordinator participants exchange work through the durable mailbox and
    // task tools. These AHP chats are projections, not agent prompt streams.
    interactivity: AHP_CHAT_INTERACTIVITY_READ_ONLY,
    workingDirectory,
  }
}

export function coordinatorChatTurn(message: ProtocolMessage): Turn {
  return {
    id: `mailbox:${message.id}`,
    startedAt: message.createdAt,
    duration: 0,
    message: {
      text: message.body,
      origin: { kind: AHP_MESSAGE_KIND_AGENT },
      _meta: {
        [AHP_COORDINATOR_META_KEY]: {
          messageId: message.id,
          fromAgentId: message.fromAgentId,
          toAgentId: message.toAgentId,
          kind: message.kind,
          priority: message.priority,
          replyRequired: message.replyRequired,
          correlationId: message.correlationId,
          inReplyTo: message.inReplyTo,
          deliveredAt: message.deliveredAt,
          resolvedAt: message.resolvedAt,
        },
      },
    },
    responseParts: [],
    usage: undefined,
    state: AHP_TURN_STATE_COMPLETE,
  }
}

function coordinatorMeta(snapshot: ProtocolRunSnapshot): Record<string, unknown> {
  return {
    version: AHP_COORDINATOR_META_VERSION,
    run: snapshot.run,
    agents: snapshot.agents,
    tasks: snapshot.tasks,
    locks: snapshot.locks,
    messages: snapshot.messages,
    phases: [...new Set(snapshot.tasks.map((task) => task.phase).filter(Boolean))],
    latestEvents: snapshot.events,
  }
}

export function coordinatorSessionSummary(run: ProtocolRun): SessionSummary {
  const workingDirectory = fileUri(run.baseCwd)
  return {
    resource: coordinatorSessionUri(run.id),
    provider: run.provider,
    title: run.prompt.split('\n')[0]?.trim().slice(0, 120) || 'Coordinator run',
    status: runStatus(run.status),
    activity: activity(run.status),
    project: {
      displayName: run.baseCwd.split(/[\\/]/).filter(Boolean).at(-1) || run.baseCwd,
      uri: fileUri(run.baseCwd),
    },
    workingDirectory,
    createdAt: run.createdAt,
    modifiedAt: run.updatedAt,
    _meta: {
      [AHP_COORDINATOR_META_KEY]: {
        version: AHP_COORDINATOR_META_VERSION,
        runId: run.id,
        status: run.status,
        maxAgents: run.maxAgents,
      },
    },
  } as SessionSummary
}

export function coordinatorSessionState(snapshot: ProtocolRunSnapshot): SessionState {
  const chats = snapshot.agents.map((agent) => chatSummary(snapshot.run, agent))
  const lead = snapshot.agents.find((agent) => agent.role === 'lead')
  const activeClients = snapshot.agents.flatMap((agent) => agent.capabilities?.ahpClientId ? [{
    clientId: agent.capabilities.ahpClientId,
    displayName: agent.name,
    tools: (agent.capabilities.tools ?? []).map((name) => ({
      name,
      description: `Tool published by ${agent.name}`,
      inputSchema: { type: 'object' },
    })),
  }] : [])
  const workingDirectory = fileUri(snapshot.run.baseCwd)
  return {
    provider: snapshot.run.provider,
    title: snapshot.run.prompt.split('\n')[0]?.trim().slice(0, 120) || 'Coordinator run',
    status: runStatus(snapshot.run.status),
    activity: activity(snapshot.run.status),
    project: {
      displayName: snapshot.run.baseCwd.split(/[\\/]/).filter(Boolean).at(-1) || snapshot.run.baseCwd,
      uri: fileUri(snapshot.run.baseCwd),
    },
    workingDirectory,
    lifecycle: AHP_SESSION_LIFECYCLE_READY,
    activeClients,
    chats,
    defaultChat: lead ? coordinatorChatUri(snapshot.run.id, lead.id) : chats[0]?.resource,
    _meta: {
      [AHP_COORDINATOR_META_KEY]: coordinatorMeta(snapshot),
    },
  } as SessionState
}

export function coordinatorChatState(
  snapshot: ProtocolRunSnapshot,
  agent: ProtocolAgent,
): ChatState {
  const summary = chatSummary(snapshot.run, agent)
  return {
    ...summary,
    turns: snapshot.messages
      .filter((message) => message.fromAgentId === agent.id || message.toAgentId === agent.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(coordinatorChatTurn),
    _meta: {
      [AHP_COORDINATOR_META_KEY]: {
        version: AHP_COORDINATOR_META_VERSION,
        runId: snapshot.run.id,
        agent,
        task: snapshot.tasks.find((task) => task.id === agent.taskId),
        inbox: snapshot.messages.filter((message) => message.toAgentId === agent.id),
      },
    },
  }
}

export function coordinatorRootState(activeSessions: number): RootState {
  const agents: AgentInfo[] = PROVIDERS.map(({ provider, displayName }) => ({
    provider,
    displayName,
    description: `Run ${displayName} in an Agent Viewer multi-agent Coordinator session.`,
    models: [],
    capabilities: {},
  } as AgentInfo))
  return {
    agents,
    activeSessions,
    _meta: {
      [AHP_COORDINATOR_META_KEY]: {
        version: AHP_COORDINATOR_META_VERSION,
        workflowFeatures: [
          'task-board',
          'dependencies',
          'path-locks',
          'durable-mailbox',
          'plan-approval',
          'completion-gates',
        ],
      },
    },
  }
}

export function coordinatorSnapshotForChannel(
  channel: string,
  runs: ProtocolRun[],
  snapshots: Map<string, ProtocolRunSnapshot>,
  fromSeq: number,
): Snapshot | null {
  if (channel === AHP_ROOT_CHANNEL) {
    return {
      resource: AHP_ROOT_CHANNEL,
      state: coordinatorRootState(runs.length),
      fromSeq,
    }
  }
  const runId = runIdFromCoordinatorSessionUri(channel)
  if (runId) {
    const snapshot = snapshots.get(runId)
    return snapshot ? { resource: channel, state: coordinatorSessionState(snapshot), fromSeq } : null
  }
  const chat = coordinatorChatParts(channel)
  if (chat) {
    const snapshot = snapshots.get(chat.runId)
    const agent = snapshot?.agents.find((candidate) => candidate.id === chat.agentId)
    return snapshot && agent
      ? { resource: channel, state: coordinatorChatState(snapshot, agent), fromSeq }
      : null
  }
  return null
}
