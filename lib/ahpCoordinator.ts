import {
  type AgentInfo,
  type ChatOrigin,
  type ChatState,
  type ChatSummary,
  type MessageKind,
  type ResponsePart,
  type RootState,
  type SessionLifecycle,
  type SessionState,
  type SessionStatus,
  type SessionSummary,
  type Snapshot,
  type ToolCallCompletedState,
  type ToolInput,
  type ToolResultSubagentContent,
  type Turn,
  type TurnState,
  type URI,
} from '@microsoft/agent-host-protocol'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ProtocolAgent,
  ProtocolMessage,
  ProtocolRun,
  ProtocolRunSnapshot,
  ProtocolRunStatus,
  ProtocolTask,
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
const AHP_TOOL_CALL_STATUS_COMPLETED = 'completed' as ToolCallCompletedState['status']
const AHP_TOOL_CALL_CONFIRMED_NOT_NEEDED = 'not-needed' as ToolCallCompletedState['confirmed']
const AHP_TOOL_RESULT_CONTENT_TYPE_SUBAGENT = 'subagent' as ToolResultSubagentContent['type']

// Materialized task prompts backing ContentRef-lazy-loaded tool input (see
// spawnToolInput below) — written under the server cwd so AhpResourceAccess's
// existing file:// root grants (which always include process.cwd()) can
// resolve them without a bespoke resource scheme.
const AHP_TASK_PROMPT_DIR = path.join(process.cwd(), '.agent-viewer-data', 'ahp-task-prompts')
// Inline tool input below this size; larger prompts get a ContentRef instead,
// matching the SDK's guidance to lazy-load large tool inputs rather than
// inline them in every snapshot/diff.
const AHP_CONTENT_REF_THRESHOLD = 4000

function spawnToolCallId(agentId: string): string {
  return `spawn:${agentId}`
}

// Writes the task's prompt to a stable per-task file (idempotent — skipped if
// already present, since task prompts are immutable after creation) and
// returns a ContentRef pointing at it. Falls back to inline JSON when the
// prompt is small enough that a lazy-loaded reference isn't worth the file.
function spawnToolInput(run: ProtocolRun, agent: ProtocolAgent, task: ProtocolTask | undefined): ToolInput {
  const summary = { name: agent.name, role: agent.role, provider: agent.provider, task: task?.title }
  const prompt = task?.prompt
  if (!prompt || prompt.length < AHP_CONTENT_REF_THRESHOLD) {
    return JSON.stringify(prompt ? { ...summary, prompt } : summary)
  }
  try {
    const dir = path.join(AHP_TASK_PROMPT_DIR, run.id)
    const file = path.join(dir, `${task.id}.md`)
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, prompt, 'utf8')
    }
    return { uri: pathToFileURL(file).href, sizeHint: prompt.length, contentType: 'text/markdown' }
  } catch {
    // Disk unavailable/read-only — fall back to inline rather than reference
    // a ContentRef the client can never resolve.
    return JSON.stringify({ ...summary, prompt })
  }
}

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

// The run's baseCwd is always workingDirectories[0] — a fixed process root
// that predates every agent and can't be reassigned once the run starts, so
// it satisfies MultipleWorkingDirectoriesCapability.immutablePrimary. Any
// distinct git-worktree paths teammates were spawned into are additional
// equal-peer directories the session grants tool access to.
function sessionWorkingDirectories(run: ProtocolRun, agents: ProtocolAgent[]): URI[] {
  const primary = fileUri(run.baseCwd)
  const extra = agents
    .map((agent) => agent.worktreePath)
    .filter((worktreePath): worktreePath is string => Boolean(worktreePath) && worktreePath !== run.baseCwd)
    .map(fileUri)
  return [primary, ...new Set(extra)]
}

function chatSummary(run: ProtocolRun, agent: ProtocolAgent, leadAgent: ProtocolAgent | undefined): ChatSummary {
  const workingDirectories = agent.worktreePath ? [fileUri(agent.worktreePath)] : undefined
  // Non-lead chats report themselves as spawned by the lead's synthetic
  // spawn_agent tool call (see agentSpawnTurn) — an AHP client renders them as
  // side chats under the lead instead of flat session-level siblings. The
  // toolCallId must match the one the lead's turn uses for the same agent.
  const origin: ChatOrigin | undefined = agent.role !== 'lead' && leadAgent
    ? { kind: 'tool', chat: coordinatorChatUri(run.id, leadAgent.id), toolCallId: spawnToolCallId(agent.id) } as ChatOrigin
    : undefined
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
    workingDirectories,
    origin,
  }
}

// The lead's synthetic view of spawning a teammate — a completed tool call
// whose ToolResultSubagentContent points at the teammate's chat. Consistent
// with the teammate chat's own ChatOrigin (same toolCallId), as the spec
// requires for the tool/sideChat edge to resolve in both directions.
function agentSpawnTurn(run: ProtocolRun, agent: ProtocolAgent, task: ProtocolTask | undefined): Turn {
  const toolCallId = spawnToolCallId(agent.id)
  const toolCall: ToolCallCompletedState = {
    toolCallId,
    toolName: 'spawn_agent',
    displayName: 'Spawn teammate',
    status: AHP_TOOL_CALL_STATUS_COMPLETED,
    confirmed: AHP_TOOL_CALL_CONFIRMED_NOT_NEEDED,
    invocationMessage: `Spawning ${agent.name} (${agent.provider})`,
    toolInput: spawnToolInput(run, agent, task),
    success: true,
    pastTenseMessage: `Spawned ${agent.name}`,
    content: [{
      type: AHP_TOOL_RESULT_CONTENT_TYPE_SUBAGENT,
      resource: coordinatorChatUri(run.id, agent.id),
      title: agent.name,
      agentName: agent.provider,
      description: task?.title,
    }],
  }
  return {
    id: `spawn-turn:${agent.id}`,
    startedAt: agent.createdAt,
    duration: 0,
    message: {
      text: `Spawn ${agent.name}`,
      origin: { kind: AHP_MESSAGE_KIND_AGENT },
    },
    responseParts: [{ kind: 'toolCall', toolCall } as ResponsePart],
    usage: undefined,
    state: AHP_TURN_STATE_COMPLETE,
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

export function coordinatorSessionSummary(run: ProtocolRun, agents: ProtocolAgent[] = []): SessionSummary {
  const workingDirectories = sessionWorkingDirectories(run, agents)
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
    workingDirectories,
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
  const lead = snapshot.agents.find((agent) => agent.role === 'lead')
  const chats = snapshot.agents.map((agent) => chatSummary(snapshot.run, agent, lead))
  const activeClients = snapshot.agents.flatMap((agent) => agent.capabilities?.ahpClientId ? [{
    clientId: agent.capabilities.ahpClientId,
    displayName: agent.name,
    tools: (agent.capabilities.tools ?? []).map((name) => ({
      name,
      description: `Tool published by ${agent.name}`,
      inputSchema: { type: 'object' },
    })),
  }] : [])
  const workingDirectories = sessionWorkingDirectories(snapshot.run, snapshot.agents)
  return {
    provider: snapshot.run.provider,
    title: snapshot.run.prompt.split('\n')[0]?.trim().slice(0, 120) || 'Coordinator run',
    status: runStatus(snapshot.run.status),
    activity: activity(snapshot.run.status),
    project: {
      displayName: snapshot.run.baseCwd.split(/[\\/]/).filter(Boolean).at(-1) || snapshot.run.baseCwd,
      uri: fileUri(snapshot.run.baseCwd),
    },
    workingDirectories,
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
  const lead = snapshot.agents.find((candidate) => candidate.role === 'lead')
  const summary = chatSummary(snapshot.run, agent, lead)
  const mailboxTurns = snapshot.messages
    .filter((message) => message.fromAgentId === agent.id || message.toAgentId === agent.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map(coordinatorChatTurn)
  // The lead's chat additionally carries one synthetic spawn_agent turn per
  // teammate, interleaved chronologically with its mailbox turns, so the
  // side-chat edges declared in chatSummary() resolve to a real tool call.
  const spawnTurns = agent.role === 'lead'
    ? snapshot.agents
      .filter((candidate) => candidate.id !== agent.id)
      .map((candidate) => agentSpawnTurn(snapshot.run, candidate, snapshot.tasks.find((task) => task.id === candidate.taskId)))
    : []
  const turns = [...mailboxTurns, ...spawnTurns].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))
  return {
    ...summary,
    turns,
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
    // The run's baseCwd (workingDirectories[0]) is fixed for the run's
    // lifetime — teammates get additional worktree directories, never a
    // replacement for the primary — so immutablePrimary applies.
    capabilities: { multipleWorkingDirectories: { immutablePrimary: true } },
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
