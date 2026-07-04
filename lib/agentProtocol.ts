import type { AgentProvider } from './types'

export const AGENT_PROTOCOL_VERSION = 'AVP/1' as const

export type AgentProtocolVersion = typeof AGENT_PROTOCOL_VERSION
export type ProtocolRunStatus = 'planning' | 'running' | 'blocked' | 'completed' | 'failed' | 'stopped'
export type ProtocolAgentStatus = 'ready' | 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
export type ProtocolTaskStatus = 'pending' | 'claimed' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export type ProtocolLockStatus = 'active' | 'released' | 'expired' | 'denied'
export type ProtocolEventType =
  | 'agent.ready'
  | 'agent.heartbeat'
  | 'agent.start_work'
  | 'agent.stop_work'
  | 'agent.blocked'
  | 'agent.unblocked'
  | 'task.planned'
  | 'task.claimed'
  | 'task.completed'
  | 'task.failed'
  | 'lock.requested'
  | 'lock.granted'
  | 'lock.denied'
  | 'lock.released'
  | 'finding'
  | 'learning'
  | 'handoff'
  | 'review.requested'

export type AgentProtocolEvent = {
  version: AgentProtocolVersion
  runId: string
  agentId: string
  type: ProtocolEventType
  taskId?: string
  lockId?: string
  summary?: string
  detail?: string
  paths?: string[]
  payload?: Record<string, unknown>
  timestamp?: string
}

export type ProtocolRun = {
  id: string
  prompt: string
  status: ProtocolRunStatus
  provider: AgentProvider
  baseCwd: string
  maxAgents: number
  createdAt: string
  updatedAt: string
}

export type ProtocolAgent = {
  id: string
  runId: string
  provider: AgentProvider
  sessionId: string
  worktreePath: string
  worktreeBranch: string
  taskId?: string
  status: ProtocolAgentStatus
  lastSeenAt?: string
  createdAt: string
  updatedAt: string
}

export type ProtocolTask = {
  id: string
  runId: string
  title: string
  prompt: string
  status: ProtocolTaskStatus
  ownerAgentId?: string
  paths: string[]
  blockedBy: string[]
  createdAt: string
  updatedAt: string
}

export type ProtocolLock = {
  id: string
  runId: string
  agentId: string
  taskId?: string
  path: string
  mode: 'read' | 'write'
  status: ProtocolLockStatus
  leaseExpiresAt: string
  createdAt: string
  updatedAt: string
}

export type ProtocolRunSnapshot = {
  run: ProtocolRun
  agents: ProtocolAgent[]
  tasks: ProtocolTask[]
  locks: ProtocolLock[]
  events: AgentProtocolEvent[]
}

export type StartProtocolRunParams = {
  prompt: string
  baseCwd: string
  provider: AgentProvider
  maxAgents: number
  title?: string
  model?: string
  effort?: string
}

export type StartProtocolRunResult = {
  snapshot: ProtocolRunSnapshot
  sessions: Array<{
    sessionId: string
    provider: AgentProvider
    cwd: string
    summary: string
    isPending: boolean
  }>
}

const PROTOCOL_BLOCK_RE = /```agent-protocol\s*([\s\S]*?)```/g

function isProtocolEventType(value: unknown): value is ProtocolEventType {
  return typeof value === 'string' && (
    value === 'agent.ready'
    || value === 'agent.heartbeat'
    || value === 'agent.start_work'
    || value === 'agent.stop_work'
    || value === 'agent.blocked'
    || value === 'agent.unblocked'
    || value === 'task.planned'
    || value === 'task.claimed'
    || value === 'task.completed'
    || value === 'task.failed'
    || value === 'lock.requested'
    || value === 'lock.granted'
    || value === 'lock.denied'
    || value === 'lock.released'
    || value === 'finding'
    || value === 'learning'
    || value === 'handoff'
    || value === 'review.requested'
  )
}

function sanitizeProtocolEvent(value: unknown): AgentProtocolEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.version !== AGENT_PROTOCOL_VERSION) return null
  if (typeof record.runId !== 'string' || !record.runId.trim()) return null
  if (typeof record.agentId !== 'string' || !record.agentId.trim()) return null
  if (!isProtocolEventType(record.type)) return null
  const paths = Array.isArray(record.paths)
    ? record.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : undefined
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : undefined
  return {
    version: AGENT_PROTOCOL_VERSION,
    runId: record.runId.trim(),
    agentId: record.agentId.trim(),
    type: record.type,
    taskId: typeof record.taskId === 'string' && record.taskId.trim() ? record.taskId.trim() : undefined,
    lockId: typeof record.lockId === 'string' && record.lockId.trim() ? record.lockId.trim() : undefined,
    summary: typeof record.summary === 'string' && record.summary.trim() ? record.summary.trim() : undefined,
    detail: typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : undefined,
    paths,
    payload,
    timestamp: typeof record.timestamp === 'string' && record.timestamp.trim() ? record.timestamp.trim() : undefined,
  }
}

export function parseAgentProtocolEvents(text: string): AgentProtocolEvent[] {
  if (!text.includes('agent-protocol')) return []
  const events: AgentProtocolEvent[] = []
  for (const match of text.matchAll(PROTOCOL_BLOCK_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      const event = sanitizeProtocolEvent(parsed)
      if (event) events.push(event)
    } catch {
      // Invalid model output is ignored; the coordinator keeps running.
    }
  }
  return events
}

export function makeProtocolBlock(event: AgentProtocolEvent): string {
  return [
    '```agent-protocol',
    JSON.stringify({ ...event, version: AGENT_PROTOCOL_VERSION }, null, 2),
    '```',
  ].join('\n')
}

export function buildProtocolPreamble(params: {
  runId: string
  agentId: string
  taskId: string
  taskTitle: string
  taskPrompt: string
  paths: string[]
  allTasks: ProtocolTask[]
}): string {
  const taskList = params.allTasks.map((task) => `- ${task.id}: ${task.title} [${task.status}]`).join('\n')
  const pathList = params.paths.length > 0 ? params.paths.map((path) => `- ${path}`).join('\n') : '- (no path lock requested yet)'
  return [
    'You are participating in an Agent Viewer coordinated multi-agent run.',
    `Protocol version: ${AGENT_PROTOCOL_VERSION}`,
    `Run ID: ${params.runId}`,
    `Your agent ID: ${params.agentId}`,
    `Your task ID: ${params.taskId}`,
    '',
    'Rules:',
    '- Before starting work, emit an `agent.ready` block.',
    '- When you begin work, emit `agent.start_work` with this task ID.',
    '- Use `finding` for facts that another agent should know.',
    '- Use `learning` for reusable implementation context.',
    '- Use `agent.blocked` when you cannot proceed, including a concise blocker summary.',
    '- Use `task.completed` when your assigned task is complete.',
    '- Do not edit files outside your granted paths. Ask for more with `lock.requested` and include `paths`.',
    '',
    'Assigned task:',
    params.taskPrompt,
    '',
    'Granted paths:',
    pathList,
    '',
    'Current task board:',
    taskList,
    '',
    'Emit protocol messages exactly as fenced JSON blocks like:',
    makeProtocolBlock({
      version: AGENT_PROTOCOL_VERSION,
      runId: params.runId,
      agentId: params.agentId,
      type: 'agent.ready',
      taskId: params.taskId,
      summary: 'Ready for work.',
    }),
  ].join('\n')
}
