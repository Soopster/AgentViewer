// Agent Viewer Protocol (AVP/2) — the wire format for coordinated multi-agent
// runs, modeled on Claude Code agent teams (one lead decomposes and
// synthesizes; named teammates self-claim tasks from a shared list, message
// each other through a mailbox, and hold path locks so work never overlaps).
//
// Agents speak the protocol by emitting fenced ```agent-protocol JSON blocks
// in their normal output; the coordinator (lib/agentCoordination.ts) parses
// them off each agent's stream, applies them to the shared ledger, and drives
// the work loop (claims, dependency unblocking, message delivery, follow-up
// turns, synthesis).
//
// Pure types + text builders only — no Node APIs — so it loads everywhere.

import type { AgentProvider } from './types'

export const AGENT_PROTOCOL_VERSION = 'AVP/2' as const
// AVP/1 events (earlier runs, older prompts still in a model's context) are
// accepted on parse; new blocks are always emitted as AVP/2.
export const SUPPORTED_PROTOCOL_VERSIONS = ['AVP/1', 'AVP/2'] as const

export type AgentProtocolVersion = typeof AGENT_PROTOCOL_VERSION
export type ProtocolRunStatus = 'planning' | 'running' | 'synthesizing' | 'blocked' | 'completed' | 'failed' | 'stopped'
export type ProtocolAgentStatus = 'ready' | 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
export type ProtocolAgentRole = 'lead' | 'teammate'
export type ProtocolTaskStatus = 'pending' | 'claimed' | 'planning' | 'planned' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export type ProtocolLockStatus = 'active' | 'released' | 'expired' | 'denied'

export type ProtocolEventType =
  // agent lifecycle
  | 'agent.ready'
  | 'agent.heartbeat'
  | 'agent.start_work'
  | 'agent.stop_work'
  | 'agent.blocked'
  | 'agent.unblocked'
  // task list
  | 'task.created'
  | 'task.planned'
  | 'task.claim'
  | 'task.claimed'
  | 'task.completed'
  | 'task.failed'
  | 'plan.completed'
  | 'plan.approved'
  | 'plan.rejected'
  // path locks
  | 'lock.requested'
  | 'lock.granted'
  | 'lock.denied'
  | 'lock.released'
  // knowledge + mailbox
  | 'finding'
  | 'learning'
  | 'message'
  | 'handoff'
  | 'review.requested'
  | 'shutdown.requested'

export type AgentProtocolEvent = {
  version: AgentProtocolVersion
  runId: string
  agentId: string
  type: ProtocolEventType
  taskId?: string
  lockId?: string
  /** Recipient for `message` events: a teammate name, 'lead', or 'all'. */
  to?: string
  /** Title for `task.created` events. */
  title?: string
  /** Task ids a `task.created` task depends on. */
  dependsOn?: string[]
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
  leadAgentId?: string
  /** Lead's final synthesis, filled when the run completes. */
  summary?: string
  gateCommand?: string
  requirePlanApproval?: boolean
  createdAt: string
  updatedAt: string
}

export type ProtocolAgent = {
  id: string
  runId: string
  /** Human-addressable name teammates use in `message.to` (doc: teammates message each other by name). */
  name: string
  role: ProtocolAgentRole
  provider: AgentProvider
  sessionId: string
  worktreePath: string
  worktreeBranch: string
  taskId?: string
  status: ProtocolAgentStatus
  lastSeenAt?: string
  /**
   * A turn is streaming for this agent right now. Runtime-only (derived from
   * the process-local running-turn registry at snapshot time, never persisted)
   * — distinguishes "actively working" from "marked working but stalled".
   */
  turnActive?: boolean
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

/** One mailbox delivery: a message event fans out to one row per recipient. */
export type ProtocolMessage = {
  id: string
  runId: string
  fromAgentId: string
  toAgentId: string
  body: string
  createdAt: string
  /** Set when steered into a live turn or included in a dispatched turn. */
  deliveredAt?: string
}

export type ProtocolWorktreeCleanupResult = {
  agentId: string
  agentName: string
  path: string
  branch: string
  status: 'removed' | 'skipped' | 'missing' | 'failed'
  reason?: string
  dirtyFiles?: number
  aheadCommits?: number
}

export type ProtocolRunSnapshot = {
  run: ProtocolRun
  agents: ProtocolAgent[]
  tasks: ProtocolTask[]
  locks: ProtocolLock[]
  messages: ProtocolMessage[]
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
  /**
   * Quality gate (the doc's TaskCompleted-hook pattern): shell command run in
   * the teammate's worktree when it emits `task.completed`. Non-zero exit
   * rejects the completion and feeds the output back to the teammate.
   */
  gateCommand?: string
  /**
   * Claude Code's plan-approval pattern: teammates must submit a plan for
   * their claimed task and wait for lead approval before implementation.
   * Claude teammates are dispatched in provider plan mode for this turn; other
   * providers receive the same protocol instruction without provider-enforced
   * read-only mode.
   */
  requirePlanApproval?: boolean
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

/** Capability-bound identity used by an independently launched CLI participant. */
export type ExternalProtocolIdentity = {
  runId: string
  agentId: string
  token: string
}

export type ExternalProtocolParticipant = ExternalProtocolIdentity & {
  name: string
  role: ProtocolAgentRole
  provider: AgentProvider
  cwd: string
}

export type CreateExternalProtocolRunParams = {
  prompt: string
  baseCwd: string
  provider: AgentProvider
  participantName: string
  maxAgents?: number
  gateCommand?: string
  requirePlanApproval?: boolean
}

export type JoinExternalProtocolRunParams = {
  runId: string
  provider: AgentProvider
  participantName: string
  cwd: string
}

export type ExternalProtocolParticipantResult = {
  participant: ExternalProtocolParticipant
  snapshot: ProtocolRunSnapshot
  instructions: string
}

export type ExternalProtocolInboxResult = {
  messages: ProtocolMessage[]
  nextCursor: string | null
}

export type ExternalProtocolCompletionResult = {
  accepted: boolean
  reason?: string
  snapshot: ProtocolRunSnapshot
}

const PROTOCOL_BLOCK_RE = /```agent-protocol\s*([\s\S]*?)```/g

const EVENT_TYPES: ReadonlySet<string> = new Set<ProtocolEventType>([
  'agent.ready', 'agent.heartbeat', 'agent.start_work', 'agent.stop_work',
  'agent.blocked', 'agent.unblocked',
  'task.created', 'task.planned', 'task.claim', 'task.claimed',
  'task.completed', 'task.failed', 'plan.completed',
  'plan.approved', 'plan.rejected',
  'lock.requested', 'lock.granted', 'lock.denied', 'lock.released',
  'finding', 'learning', 'message', 'handoff', 'review.requested',
  'shutdown.requested',
])

export function isProtocolEventType(value: unknown): value is ProtocolEventType {
  return typeof value === 'string' && EVENT_TYPES.has(value)
}

export function isSupportedProtocolVersion(value: unknown): boolean {
  return typeof value === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length > 0 ? items.map((item) => item.trim()) : undefined
}

export function sanitizeProtocolEvent(value: unknown): AgentProtocolEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isSupportedProtocolVersion(record.version)) return null
  if (typeof record.runId !== 'string' || !record.runId.trim()) return null
  if (typeof record.agentId !== 'string' || !record.agentId.trim()) return null
  if (!isProtocolEventType(record.type)) return null
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : undefined
  return {
    version: AGENT_PROTOCOL_VERSION,
    runId: record.runId.trim(),
    agentId: record.agentId.trim(),
    type: record.type,
    taskId: cleanString(record.taskId),
    lockId: cleanString(record.lockId),
    to: cleanString(record.to),
    title: cleanString(record.title),
    dependsOn: cleanStringArray(record.dependsOn),
    summary: cleanString(record.summary),
    detail: cleanString(record.detail),
    paths: cleanStringArray(record.paths),
    payload,
    timestamp: cleanString(record.timestamp),
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

// ---------------------------------------------------------------------------
// Prompt builders. The doc's coordination surface (task list, mailbox,
// roster/team config, self-claiming, idle notification) is reproduced as
// plain-text sections every agent receives at the top of each turn.

export function formatTaskBoard(tasks: ProtocolTask[]): string {
  if (tasks.length === 0) return '- (no tasks yet)'
  return tasks.map((task) => {
    const deps = task.blockedBy.length > 0 ? ` deps:[${task.blockedBy.join(',')}]` : ''
    const owner = task.ownerAgentId ? ` owner:${task.ownerAgentId}` : ''
    return `- ${task.id} [${task.status}]${owner}${deps} ${task.title}`
  }).join('\n')
}

export function formatRoster(agents: ProtocolAgent[]): string {
  if (agents.length === 0) return '- (no teammates yet)'
  return agents.map((agent) => (
    `- ${agent.name} (${agent.role}, id:${agent.id}, status:${agent.status}${agent.taskId ? `, task:${agent.taskId}` : ''})`
  )).join('\n')
}

export function formatInbox(messages: ProtocolMessage[], agentsById: Map<string, ProtocolAgent>): string {
  if (messages.length === 0) return '(empty)'
  return messages.map((message) => {
    const from = agentsById.get(message.fromAgentId)?.name ?? message.fromAgentId
    return `- from ${from}: ${message.body}`
  }).join('\n')
}

function protocolGrammar(runId: string, agentId: string): string {
  return [
    'Speak the protocol by emitting fenced JSON blocks (each on its own lines):',
    makeProtocolBlock({
      version: AGENT_PROTOCOL_VERSION,
      runId,
      agentId,
      type: 'message',
      to: 'lead',
      summary: 'Example: send a message to a teammate by name, or to "lead" or "all".',
    }),
    '',
    'Event types you may emit:',
    '- `agent.start_work` / `agent.stop_work` (include taskId) — bracket every work stint.',
    '- `agent.blocked` — you cannot proceed; summary = the blocker. `agent.unblocked` when cleared.',
    '- `task.claim` (taskId) — request the next pending task. The coordinator grants or denies it.',
    '- `task.created` (title, detail, paths, dependsOn) — add newly discovered work to the board.',
    '- `task.planned` (taskId, summary, detail) — submit an implementation plan for your claimed task before editing when plan approval is required.',
    '- `plan.approved` / `plan.rejected` (taskId, summary/detail) — lead-only approval decision for a teammate plan.',
    '- `task.completed` / `task.failed` (taskId, summary) — end your task. Completion is gated: changes outside your locked paths are rejected with feedback.',
    '- `lock.requested` (paths) — ask for write access before touching paths you do not hold.',
    '- `finding` — a fact other agents need (summary + detail). `learning` — reusable implementation context.',
    '- `message` (to, summary/detail) — direct mail to one teammate by name, "lead", or "all". Delivered live when the recipient is mid-turn, else on their next turn.',
    '- `shutdown.requested` — ask the coordinator to retire you when your work is done.',
  ].join('\n')
}

/** First turn for the team lead: decompose the prompt into a real task list. */
export function buildLeadPlanPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name'>
  prompt: string
  teammateCount: number
}): string {
  return [
    `You are the TEAM LEAD of a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id} · Your name: ${params.agent.name}`,
    '',
    `Up to ${params.teammateCount} teammates will be spawned to execute the task list you produce.`,
    'Each teammate works in its own isolated git worktree and self-claims tasks from the board.',
    '',
    'Your job THIS TURN (do not implement anything yourself):',
    `1. Study the request below. Explore the repository read-only as needed.`,
    `2. Decompose it into small, self-contained tasks — aim for ${Math.max(params.teammateCount * 2, 4)}-${params.teammateCount * 5} of them, each a clear deliverable`,
    '   (a function, a module, a test file, a review). Emit one `task.created` block per task with:',
    '   - `title`: short imperative title',
    '   - `detail`: the full prompt a teammate needs to do the work without your context',
    '   - `paths`: the file paths/globs the task will write (its lock claim). Non-overlapping paths across tasks — two agents editing the same file is the failure mode to design away.',
    '   - `dependsOn`: task ids that must complete first (use the ids you assign, task-1, task-2, …)',
    '3. Emit `finding` blocks for anything you learned that every teammate should know.',
    '4. Finish with a single `plan.completed` block.',
    '',
    'The request:',
    params.prompt,
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/** A teammate planning turn: read-only plan mode before implementation. */
export function buildTeammatePlanPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name'>
  roster: ProtocolAgent[]
  task: ProtocolTask
  allTasks: ProtocolTask[]
  inbox: ProtocolMessage[]
  agentsById: Map<string, ProtocolAgent>
  note?: string
}): string {
  const pathList = params.task.paths.length > 0
    ? params.task.paths.map((path) => `- ${path}`).join('\n')
    : '- (no write paths yet — your plan may request paths, but do not edit)'
  return [
    `You are teammate "${params.agent.name}" in a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    '',
    'THIS TURN IS PLAN-ONLY. Do not edit files, run destructive commands, or mark the task complete.',
    'Study the repo read-only and propose the approach. The team lead must approve before you implement.',
    '',
    ...(params.note ? [`Coordinator note: ${params.note}`, ''] : []),
    'Team roster (message anyone by name):',
    formatRoster(params.roster),
    '',
    'Your inbox:',
    formatInbox(params.inbox, params.agentsById),
    '',
    `Task to plan: ${params.task.id} — ${params.task.title}`,
    '',
    params.task.prompt,
    '',
    'Expected write paths for this task:',
    pathList,
    '',
    'Task board:',
    formatTaskBoard(params.allTasks),
    '',
    'Plan approval rules:',
    '- Emit exactly one `task.planned` block for this task with:',
    '  - `taskId`: this task id',
    '  - `summary`: one-line approach',
    '  - `detail`: files to touch, implementation steps, verification, risks/conflicts',
    '- If the task is impossible as scoped, emit `agent.blocked` and `message` the lead instead.',
    '- End with `agent.stop_work`. Do not emit `task.completed` until the lead emits `plan.approved`.',
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/** A teammate turn: first assignment or a follow-up dispatch in the work loop. */
export function buildTeammateTurnPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name'>
  roster: ProtocolAgent[]
  task: ProtocolTask | null
  allTasks: ProtocolTask[]
  inbox: ProtocolMessage[]
  agentsById: Map<string, ProtocolAgent>
  note?: string
  gateCommand?: string
  requirePlanApproval?: boolean
}): string {
  const pathList = params.task && params.task.paths.length > 0
    ? params.task.paths.map((path) => `- ${path}`).join('\n')
    : '- (none granted yet — request with `lock.requested` before writing)'
  return [
    `You are teammate "${params.agent.name}" in a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    'You work in an isolated git worktree; your changes merge back later. Never edit files outside your granted paths.',
    '',
    ...(params.note ? [`Coordinator note: ${params.note}`, ''] : []),
    'Team roster (message anyone by name):',
    formatRoster(params.roster),
    '',
    'Your inbox:',
    formatInbox(params.inbox, params.agentsById),
    '',
    params.task
      ? [
          `Your claimed task: ${params.task.id} — ${params.task.title}`,
          '',
          params.task.prompt,
          '',
          'Granted paths (your write locks):',
          pathList,
        ].join('\n')
      : 'You have no claimed task. Review the board and emit `task.claim` for the next pending task whose dependencies are completed, or `agent.stop_work` if nothing remains.',
    '',
    'Task board:',
    formatTaskBoard(params.allTasks),
    '',
    'Work loop rules:',
    '- Emit `agent.start_work` (with taskId) before you begin; `task.completed` when the deliverable is done.',
    ...(params.requirePlanApproval
      ? ['- This task has lead-approved planning. Stay inside the approved plan or emit `message`/`task.planned` again if the approach needs material changes.']
      : []),
    ...(params.gateCommand
      ? [`- Completions are gate-checked: \`${params.gateCommand}\` runs in your worktree and must exit 0, or the completion is rejected with its output. Run it yourself before completing.`]
      : []),
    '- Share what you find: `finding` for facts others need, `learning` for reusable context — teammates and the lead see them.',
    '- If blocked, emit `agent.blocked` with the blocker and `message` the teammate (or lead) who can unblock you. Do not silently stop.',
    '- After completing, you may immediately `task.claim` the next pending unblocked task in this same turn, or end the turn — the coordinator will re-dispatch you.',
    '- Do not repeat work another agent owns; the board and locks are authoritative.',
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/**
 * Mid-run lead turn: the lead was woken because teammates need help (blocked,
 * stalled, or messaged it while idle). It coordinates — it never implements.
 */
export function buildLeadInterventionPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name'>
  roster: ProtocolAgent[]
  tasks: ProtocolTask[]
  inbox: ProtocolMessage[]
  agentsById: Map<string, ProtocolAgent>
  interventionsLeft: number
  requirePlanApproval?: boolean
  reviewingPlans?: boolean
}): string {
  return [
    `You are the TEAM LEAD (protocol ${AGENT_PROTOCOL_VERSION}). Teammates need your help mid-run.`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    '',
    'Your inbox:',
    formatInbox(params.inbox, params.agentsById),
    '',
    'Team roster:',
    formatRoster(params.roster),
    '',
    'Task board:',
    formatTaskBoard(params.tasks),
    '',
    'Resolve the situation THIS TURN — coordinate, do not implement:',
    ...(params.requirePlanApproval
      ? [
          '- For any `planned` task, approve the plan with `plan.approved` (taskId, summary) only if it has clear files, steps, verification, and avoids path conflicts.',
          '- Reject weak or risky plans with `plan.rejected` (taskId, summary/detail) and concrete feedback. The teammate will revise in plan mode.',
        ]
      : []),
    '- `message` a blocked teammate (by name) with concrete unblocking guidance. Your message wakes them.',
    '- If a task is genuinely unachievable or duplicated, emit `task.failed` (taskId, summary) so the run can finish without it.',
    '- If the work needs reshaping, emit `task.created` replacements (title, detail, paths, dependsOn).',
    params.reviewingPlans
      ? '- This turn is reviewing teammate plans; it does not consume the stuck-task intervention budget.'
      : `- You have ${params.interventionsLeft} intervention turn${params.interventionsLeft === 1 ? '' : 's'} left this run — after that, stuck tasks are auto-failed. Prefer decisive resolution over back-and-forth.`,
    '- End the turn with `agent.stop_work`.',
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/** Final lead turn: synthesize the team's findings into one deliverable summary. */
export function buildLeadSynthesisPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name'>
  prompt: string
  tasks: ProtocolTask[]
  knowledge: Array<{ agentId: string; type: string; summary?: string; detail?: string }>
  agentsById: Map<string, ProtocolAgent>
}): string {
  const knowledgeList = params.knowledge.length > 0
    ? params.knowledge.map((item) => {
        const who = params.agentsById.get(item.agentId)?.name ?? item.agentId
        return `- [${item.type}] ${who}: ${item.summary ?? ''}${item.detail ? ` — ${item.detail}` : ''}`
      }).join('\n')
    : '- (none recorded)'
  return [
    `You are the TEAM LEAD (protocol ${AGENT_PROTOCOL_VERSION}). All teammate tasks have finished.`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    '',
    'Original request:',
    params.prompt,
    '',
    'Final task board:',
    formatTaskBoard(params.tasks),
    '',
    'Findings and learnings reported by the team:',
    knowledgeList,
    '',
    'Synthesize the run: what was done, what was learned, what remains, and any',
    'risks in merging the worktrees. Then emit ONE `finding` block whose `summary`',
    'is a one-line result and whose `detail` is the full synthesis — that block is',
    'recorded as the run summary. End with `agent.stop_work`.',
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/**
 * Fallback decomposition when the lead produces no tasks: role-based lanes,
 * with only the implementation lane holding a write lock.
 */
export function fallbackTaskTemplates(prompt: string, maxAgents: number): Array<{ title: string; prompt: string; paths: string[] }> {
  const capped = Math.max(1, Math.min(maxAgents, 6))
  return [
    {
      title: 'Implementation worker',
      prompt: `Implement the requested change end to end. Coordinate over the protocol before touching new paths.\n\nOriginal prompt:\n${prompt}`,
      paths: ['**'],
    },
    {
      title: 'Research worker',
      prompt: `Explore the codebase and publish findings, risks, and relevant files. Do not edit files unless you receive a lock.\n\nOriginal prompt:\n${prompt}`,
      paths: [],
    },
    {
      title: 'Verification worker',
      prompt: `Focus on tests, type-checking strategy, edge cases, and review findings. Do not edit files unless you receive a lock.\n\nOriginal prompt:\n${prompt}`,
      paths: [],
    },
    {
      title: 'Integration reviewer',
      prompt: `Track cross-file integration concerns, merge risks, and gaps between workers. Do not edit files unless you receive a lock.\n\nOriginal prompt:\n${prompt}`,
      paths: [],
    },
  ].slice(0, capped)
}
