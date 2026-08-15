// A2A Protocol 1.0 wire format for coordinated multi-agent runs. Agent Viewer
// uses the standard A2A Task, Message, TaskStatusUpdateEvent, and Artifact
// shapes plus a documented extension payload for coordination-only operations
// such as path locks and plan approval.
//
// Agents speak the protocol by emitting fenced ```a2a JSON blocks
// in their normal output; the coordinator (lib/agentCoordination.ts) parses
// them off each agent's stream, applies them to the shared ledger, and drives
// the work loop (claims, dependency unblocking, message delivery, follow-up
// turns, synthesis).
//
// Pure types + text builders only — no Node APIs — so it loads everywhere.

import type { AgentProvider } from './types'

export const AGENT_PROTOCOL_VERSION = '1.0' as const
export const A2A_COORDINATION_EXTENSION_URI = 'https://agent-viewer.dev/extensions/coordination/v1' as const
// Earlier AVP events remain readable for persisted transcripts and runs. New
// blocks are always emitted as A2A 1.0 StreamResponse objects.
export const SUPPORTED_PROTOCOL_VERSIONS = ['AVP/1', 'AVP/2', AGENT_PROTOCOL_VERSION] as const
export const EXTERNAL_COORD_PROTOCOL_VERSION = 2 as const
export const MIN_EXTERNAL_COORD_PROTOCOL_VERSION = 1 as const

export type AgentProtocolVersion = typeof AGENT_PROTOCOL_VERSION
export type A2ATaskState =
  | 'TASK_STATE_UNSPECIFIED'
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED'

export type A2APart = {
  text?: string
  raw?: string
  url?: string
  data?: unknown
  metadata?: Record<string, unknown>
  filename?: string
  mediaType?: string
}

export type A2AMessage = {
  messageId: string
  contextId?: string
  taskId?: string
  role: 'ROLE_USER' | 'ROLE_AGENT'
  parts: A2APart[]
  metadata?: Record<string, unknown>
  extensions?: string[]
  referenceTaskIds?: string[]
}

export type A2ATaskStatus = {
  state: A2ATaskState
  message?: A2AMessage
  timestamp?: string
}

export type A2AArtifact = {
  artifactId: string
  name?: string
  description?: string
  parts: A2APart[]
  metadata?: Record<string, unknown>
  extensions?: string[]
}

export type A2ATask = {
  id: string
  contextId?: string
  status: A2ATaskStatus
  artifacts?: A2AArtifact[]
  history?: A2AMessage[]
  metadata?: Record<string, unknown>
}

export type A2ATaskStatusUpdateEvent = {
  taskId: string
  contextId: string
  status: A2ATaskStatus
  metadata?: Record<string, unknown>
}

export type A2ATaskArtifactUpdateEvent = {
  taskId: string
  contextId: string
  artifact: A2AArtifact
  append?: boolean
  lastChunk?: boolean
  metadata?: Record<string, unknown>
}

/** A2A streaming/push union: exactly one field is present on the wire. */
export type A2AStreamResponse =
  | { task: A2ATask }
  | { message: A2AMessage }
  | { statusUpdate: A2ATaskStatusUpdateEvent }
  | { artifactUpdate: A2ATaskArtifactUpdateEvent }

// --- A2A Agent Card (spec §5, served from /.well-known/agent-card.json) ---

export type A2AAgentCapabilities = {
  streaming?: boolean
  pushNotifications?: boolean
  extensions?: A2AAgentExtension[]
  extendedAgentCard?: boolean
}

export type A2AAgentExtension = {
  uri: string
  description?: string
  required?: boolean
  params?: Record<string, unknown>
}

export type A2AAgentSkill = {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}

export type A2AAgentCardProvider = {
  organization: string
  url?: string
}

export type A2AAgentInterface = {
  url: string
  protocolBinding: string
  protocolVersion: string
  tenant?: string
}

export type A2ASecurityScheme = {
  apiKeySecurityScheme?: {
    location: string
    name: string
    description?: string
  }
  httpAuthSecurityScheme?: {
    scheme: string
    bearerFormat?: string
    description?: string
  }
  oauth2SecurityScheme?: {
    flows: Record<string, unknown>
    oauth2MetadataUrl?: string
    description?: string
  }
  openIdConnectSecurityScheme?: {
    openIdConnectUrl: string
    description?: string
  }
  mtlsSecurityScheme?: {
    description?: string
  }
}

export type A2ASecurityRequirement = {
  schemes: Record<string, { list: string[] }>
}

/** A JWS signature over an `AgentCard` (RFC 7515). agentViewer never signs its own card today. */
export type A2AAgentCardSignature = {
  protected: string
  signature: string
  header?: Record<string, unknown>
}

export type A2AAgentCard = {
  name: string
  description: string
  supportedInterfaces: A2AAgentInterface[]
  provider?: A2AAgentCardProvider
  version: string
  documentationUrl?: string
  capabilities: A2AAgentCapabilities
  securitySchemes?: Record<string, A2ASecurityScheme>
  securityRequirements?: A2ASecurityRequirement[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: A2AAgentSkill[]
  signatures?: A2AAgentCardSignature[]
  iconUrl?: string
}

export type ProtocolRunStatus = 'planning' | 'running' | 'synthesizing' | 'blocked' | 'completed' | 'failed' | 'stopped'
export type ProtocolAgentStatus = 'ready' | 'idle' | 'working' | 'blocked' | 'done' | 'failed' | 'stopped'
export type ProtocolAgentRole = 'lead' | 'teammate'
export type ProtocolTaskStatus = 'pending' | 'claimed' | 'planning' | 'planned' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export type ProtocolTaskTargetRole = 'lead' | 'teammate' | 'any'
export type ProtocolAutonomy = 'low' | 'medium' | 'high'
export type ProtocolSeat = 'director' | 'executor' | 'validator' | 'watcher'
export type ProtocolReviewStatus = 'not_required' | 'pending' | 'approved' | 'rejected'

export type ProtocolAssumption = {
  id: string
  text: string
  impactIfWrong: string
  status: 'unconfirmed' | 'confirmed' | 'deferred'
  source?: string
}

export type ProtocolAcceptanceContract = {
  goal: string
  nonGoals: string[]
  userVisibleAcceptance: string[]
  filesLikelyTouched: string[]
  verificationCommands: string[]
  manualQa: string[]
  escalationTriggers: string[]
  assumptions: ProtocolAssumption[]
  lockedDecisions: Array<{ decision: string; source: string }>
}

export type ProtocolNeedsDecision = {
  id: string
  question: string
  options: string[]
  assumed?: string
  impactIfWrong: string
  status: 'open' | 'answered' | 'deferred'
  answer?: string
}

export type ProtocolUsageReceipt = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  costUsd?: number
  durationMs?: number
}

/**
 * Coordinator-owned subset of Claude's AgentDefinition plus the parent
 * query's sandbox settings. Keeping this provider-specific policy on the
 * dispatch contract lets Claude enforce a task role mechanically while every
 * other provider continues to receive the ordinary model/effort fields.
 */
export type ProtocolClaudeAgentPolicy = {
  name: string
  description: string
  prompt: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  model?: string
  mcpServers?: Array<string | Record<string, unknown>>
  criticalSystemReminder?: string
  initialPrompt?: string
  maxTurns?: number
  background?: boolean
  memory?: 'user' | 'project' | 'local'
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'
  observer?: string
  observerMessage?: string
  sandbox?: {
    enabled?: boolean
    failIfUnavailable?: boolean
    autoAllowBashIfSandboxed?: boolean
    allowUnsandboxedCommands?: boolean
    filesystem?: {
      allowWrite?: string[]
      denyWrite?: string[]
    }
  }
}

export type ProtocolVerificationReceipt = {
  command: string
  passed: boolean
  exitCode?: number
  summary?: string
}

export type ProtocolTaskReceipt = {
  requestedProvider?: AgentProvider
  requestedModel?: string
  actualProvider: AgentProvider
  actualModel?: string
  provenance: 'ok' | 'drift' | 'unverifiable'
  stopReason: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'needs_decision'
  usage?: ProtocolUsageReceipt
  filesChanged: string[]
  commandsRun: string[]
  verification: ProtocolVerificationReceipt[]
  needsDecision: ProtocolNeedsDecision[]
  recordedAt: string
}

export type ProtocolReviewReport = {
  status: ProtocolReviewStatus
  reviewerAgentId?: string
  summary?: string
  detail?: string
  reviewedAt?: string
}

export type ProtocolProgressEvidence = {
  sequence: number
  signal: 'heartbeat' | 'turn' | 'transcript' | 'process' | 'artifact' | 'task_event'
  detail?: string
  observedAt: string
}

export type ProtocolPhaseReport = {
  phase: string
  status: 'active' | 'passed' | 'failed' | 'blocked' | 'awaiting_approval'
  requestedModels: string[]
  actualModels: string[]
  usage: ProtocolUsageReceipt
  driftTaskIds: string[]
  openDecisionIds: string[]
  completedTaskIds: string[]
  failedTaskIds: string[]
  updatedAt: string
}

export type ProtocolRunBudget = {
  maxTokens?: number
  maxCostUsd?: number
  maxDurationMinutes?: number
}

export type ProtocolResumeCapsule = {
  runId: string
  status: ProtocolRunStatus
  currentPhase?: string
  completedTasks: Array<{ id: string; summary?: string }>
  activeTasks: Array<{ id: string; title: string; ownerAgentId?: string; status: ProtocolTaskStatus }>
  openDecisions: ProtocolNeedsDecision[]
  assumptions: ProtocolAssumption[]
  nextAction: string
  createdAt: string
}

export type ProtocolLearningCandidate = {
  id: string
  kind: 'validation' | 'provenance' | 'liveness' | 'provider' | 'decision' | 'review'
  summary: string
  occurrences: number
  status: 'observed' | 'recurring' | 'promoted'
  suggestedTarget: 'playbook' | 'role' | 'project_memory'
}

/**
 * Maps the Coordinator's task-board status onto the A2A task-state enum.
 * Lives here (rather than lib/a2aAdapter.ts) so lib/agentCoordination.ts can
 * use it too — e.g. to shape push-notification payloads — without an
 * adapter/coordination import cycle.
 */
export function taskStateFromStatus(status: ProtocolTaskStatus): A2ATaskState {
  switch (status) {
    case 'pending':
    case 'blocked':
      return 'TASK_STATE_SUBMITTED'
    case 'claimed':
    case 'planning':
    case 'in_progress':
      return 'TASK_STATE_WORKING'
    case 'planned':
      // Awaiting the lead's plan-approval review before implementation starts.
      return 'TASK_STATE_INPUT_REQUIRED'
    case 'completed':
      return 'TASK_STATE_COMPLETED'
    case 'failed':
      return 'TASK_STATE_FAILED'
    case 'cancelled':
      return 'TASK_STATE_CANCELED'
    default:
      return 'TASK_STATE_UNSPECIFIED'
  }
}
export type ProtocolLockStatus = 'active' | 'released' | 'expired' | 'denied'
export type ProtocolMessageKind = 'request' | 'response' | 'status' | 'status_summary' | 'finding' | 'handoff' | 'review_request' | 'review_result'
export type ProtocolMessagePriority = 'urgent' | 'normal' | 'status'
export const PROTOCOL_FAILURE_CLASSES = [
  'rate_limited',
  'authentication_failed',
  'context_exhausted',
  'approval_blocked',
  'cli_missing',
  'transient_transport',
  'provider_failure',
  'provider_timeout',
  'supervisor_stopped',
] as const
export type ProtocolFailureClass = (typeof PROTOCOL_FAILURE_CLASSES)[number]

export type ExternalProtocolClient = {
  name: string
  version?: string
  protocolVersion: number
}

export type ExternalProtocolCapabilities = {
  /** AHP connection identity when this participant was joined through AHP. */
  ahpClientId?: string
  unattended?: boolean
  sessionResume?: boolean
  midTurnSteer?: boolean
  filesystemWrite?: boolean
  git?: boolean
  browser?: boolean
  maxParallelTasks?: number
  tools?: string[]
}

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
  | 'task.released'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  // provider-native task/workflow evidence (does not mutate board ownership)
  | 'task.child.started'
  | 'task.child.progress'
  | 'task.child.completed'
  | 'task.child.failed'
  | 'task.child.cancelled'
  | 'usage.observed'
  | 'plan.completed'
  | 'plan.approved'
  | 'plan.rejected'
  | 'decision.raised'
  | 'decision.resolved'
  | 'review.requested'
  | 'review.completed'
  | 'phase.reported'
  | 'phase.approved'
  | 'phase.rejected'
  | 'checkpoint.created'
  | 'model.drift'
  | 'learning.promoted'
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
  // run lifecycle (coordinator-authored: synthesizing, reopened, completed…)
  | 'run.status'

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
  autonomy: ProtocolAutonomy
  acceptanceContract: ProtocolAcceptanceContract
  requireReview: boolean
  requireReceipts: boolean
  review: ProtocolReviewReport
  budget?: ProtocolRunBudget
  phaseReports: ProtocolPhaseReport[]
  resumeCapsule?: ProtocolResumeCapsule
  learningCandidates: ProtocolLearningCandidate[]
  /** Whether locally managed teammates receive isolated git worktrees. */
  useWorktrees?: boolean
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
  client?: ExternalProtocolClient
  capabilities?: ExternalProtocolCapabilities
  /**
   * A turn is streaming for this agent right now. Runtime-only (derived from
   * the process-local running-turn registry at snapshot time, never persisted)
   * — distinguishes "actively working" from "marked working but stalled".
   */
  turnActive?: boolean
  /**
   * Liveness at snapshot time (same fresh/stale/dead classification returned
   * in coord_send_message's `delivery` field), computed here too so a lead
   * can tell who is actually reachable directly from coord_status/coord_wait
   * instead of having to send a probe message first to find out.
   */
  liveness?: { status: ProtocolAgentLivenessStatus; ageSeconds: number | null }
  /**
   * Timestamp of this participant's last event that actually reached the
   * team — an explicit send_message/publish_finding, or any event that
   * queued a message to the lead (heartbeat with content, blocked, plan
   * submitted, ...). Drives the reply guard (see externalActionableSync's
   * replyGuardDue): undefined/stale here while owning a task for a while
   * means real work may be happening with nobody told.
   */
  lastReportAt?: string
  /**
   * Set by the lead (coord_cancel_turn) to interrupt this participant's
   * in-flight turn without releasing its owned task — the external worker
   * supervisor polls this and aborts the current provider tick, then starts
   * a fresh one. Cleared once the worker observes and acts on it.
   */
  cancelRequestedAt?: string
  /** Which senders' mailbox messages actually reach this participant — see ProtocolAgentRespondToMode. */
  respondTo?: { mode: ProtocolAgentRespondToMode; allowlist: string[] }
  progressEvidence?: ProtocolProgressEvidence
  createdAt: string
  updatedAt: string
}

/**
 * Mirrors buzz-acp's respond-to author gate: which senders' mailbox messages
 * are delivered to this participant. `owner-only`/`allowlist` are meant for
 * externally-facing agents that should ignore chatter from anyone but their
 * operator or an approved list; `nobody` is the broadcast-only case (act on
 * heartbeats/schedule, ignore all inbound mail). Default (unset) is `anyone`
 * — today's behavior, unchanged for every run that doesn't opt in.
 */
export type ProtocolAgentRespondToMode = 'owner-only' | 'allowlist' | 'anyone' | 'nobody'

export type ProtocolTask = {
  id: string
  runId: string
  title: string
  prompt: string
  status: ProtocolTaskStatus
  ownerAgentId?: string
  /** Which participant role should claim this lane. Defaults to teammate. */
  targetRole: ProtocolTaskTargetRole
  /**
   * Lead-defined specialization for whoever claims this task — e.g. "Explorer"
   * / "read-only research, report findings, no edits". Unlike targetRole (a
   * fixed structural lead/teammate/any gate), this is a free-form persona the
   * lead invents per task as it distributes work, so it naturally varies task
   * to task and run to run.
   */
  roleName?: string
  roleDescription?: string
  paths: string[]
  blockedBy: string[]
  /** Playbook phase this task belongs to (display + barrier grouping). */
  phase?: string
  seat: ProtocolSeat
  requestedProvider?: AgentProvider
  requestedModel?: string
  requestedEffort?: string
  /** Explicit/derived native policy used only for Claude SDK dispatches. */
  claudeAgentPolicy?: ProtocolClaudeAgentPolicy
  verifyCommands: string[]
  receipt?: ProtocolTaskReceipt
  /** Durable terminal report supplied by the task owner. */
  resultSummary?: string
  resultDetail?: string
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
  kind: ProtocolMessageKind
  priority: ProtocolMessagePriority
  replyRequired: boolean
  correlationId?: string
  inReplyTo?: string
  createdAt: string
  /** Set when steered into a live turn or included in a dispatched turn. */
  deliveredAt?: string
  resolvedAt?: string
  batchedMessageIds?: string[]
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
  /** Saved playbook to seed before teammate sessions start. */
  playbookName?: string
  /** Value interpolated into {{args}} / {{args.key}} placeholders. */
  playbookArgs?: unknown
  /** Provider used by the lead that plans, coordinates, and synthesizes. */
  provider: AgentProvider
  /** Provider pool assigned round-robin to teammates. Defaults to the lead provider. */
  teammateProviders?: AgentProvider[]
  maxAgents?: number
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
  /**
   * Give every locally managed teammate an isolated git worktree. Defaults to
   * true; disable only when the user explicitly chooses a shared checkout.
   */
  useWorktrees?: boolean
  autonomy?: ProtocolAutonomy
  acceptanceContract?: Partial<ProtocolAcceptanceContract>
  requireReview?: boolean
  budget?: ProtocolRunBudget
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
  serverProtocolVersion: number
  negotiatedProtocolVersion: number
  capabilities: ExternalProtocolCapabilities
}

export type CreateExternalProtocolRunParams = {
  /** Optional caller-selected id (used by AHP's client-selected session URI). */
  runId?: string
  prompt: string
  baseCwd: string
  provider: AgentProvider
  participantName: string
  client?: ExternalProtocolClient
  capabilities?: ExternalProtocolCapabilities
  maxAgents?: number
  gateCommand?: string
  requirePlanApproval?: boolean
  autonomy?: ProtocolAutonomy
  acceptanceContract?: Partial<ProtocolAcceptanceContract>
  requireReview?: boolean
  budget?: ProtocolRunBudget
  /** Seed the entire task board from this playbook (no lead planning turn). */
  playbook?: RunPlaybook
  /** Interpolated into {{args}} / {{args.<key>}} in playbook task text. */
  playbookArgs?: unknown
  /** Which senders' mailbox messages reach this participant. Omitted means `anyone` (today's behavior). */
  respondTo?: { mode: ProtocolAgentRespondToMode; allowlist?: string[] }
}

export type JoinExternalProtocolRunParams = {
  /** Omit to auto-join the newest joinable run, preferring this checkout. */
  runId?: string
  provider: AgentProvider
  participantName: string
  cwd: string
  client?: ExternalProtocolClient
  capabilities?: ExternalProtocolCapabilities
  /** Which senders' mailbox messages reach this participant. Omitted means `anyone` (today's behavior). */
  respondTo?: { mode: ProtocolAgentRespondToMode; allowlist?: string[] }
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

export type ProtocolTaskPlanState = 'none' | 'awaiting' | 'approved' | 'rejected'

/**
 * Role-aware digest of what this participant can act on right now. Returned by
 * wait/status so an autonomous CLI can decide whether to spend a model turn
 * without diffing snapshots.
 */
export type ExternalProtocolActionable = {
  runStatus: ProtocolRunStatus
  /** Pending, unowned tasks whose dependencies are all completed. */
  claimableTasks: Array<{ id: string; title: string; targetRole: ProtocolTaskTargetRole }>
  /** Undelivered mailbox messages addressed to this participant. */
  inboxCount: number
  urgentCount: number
  statusCount: number
  replyRequiredCount: number
  /** Lead only: task ids with submitted plans awaiting review. */
  plansAwaitingReview: string[]
  /** The task this participant currently owns, if any. */
  myTask: { id: string; status: ProtocolTaskStatus; planState: ProtocolTaskPlanState } | null
  /** Every task is completed/failed/cancelled — the lead should finalize. */
  allTasksTerminal: boolean
  /** Reply guard: owns a task, has been silent past the threshold — see replyGuardReminder for the text to surface. */
  replyGuardDue: boolean
  replyGuardReminder?: string
}

export type ExternalProtocolWaitResult = {
  changed: boolean
  timedOut: boolean
  cursor: string | null
  snapshot: ProtocolRunSnapshot
  inbox: ExternalProtocolInboxResult
  /** Non-heartbeat events after the supplied cursor (what actually changed). */
  events: AgentProtocolEvent[]
  actionable: ExternalProtocolActionable
}

export type ExternalProtocolStatusResult = {
  snapshot: ProtocolRunSnapshot
  actionable: ExternalProtocolActionable
  cursor: string | null
  /** Workflow-style progress rollup: task counts per playbook phase. */
  phases: ProtocolPhaseRollup[]
}

/**
 * Compact result for every board mutation. Mutations ride MCP tool results
 * into a model's context, so they return what the agent needs to decide its
 * next step — run status, fresh cursor, phase rollups, the actionable digest,
 * and the affected task — never the full snapshot (coord_status/coord_wait
 * remain the full views).
 */
export type ExternalProtocolMutationResult = {
  runStatus: ProtocolRunStatus
  cursor: string | null
  phases: ProtocolPhaseRollup[]
  actionable: ExternalProtocolActionable
  /** The task this mutation created or affected, when applicable. */
  task?: ProtocolTask
}

export type ExternalProtocolLockResult = ExternalProtocolMutationResult & {
  granted: Array<{ lockId: string; path: string }>
  denied: Array<{ path: string; reason: string }>
}

export type ExternalProtocolReleaseResult = ExternalProtocolMutationResult & {
  task: ProtocolTask
}

export type ExternalProtocolClaimResult = ExternalProtocolMutationResult & {
  task: ProtocolTask
}

/**
 * coord_create_task's result: existing tasks whose title/detail closely
 * overlap the new one, surfaced as a heads-up (not a block) so a lead or
 * self-tasking teammate can catch redundant work before it's claimed.
 */
export type ExternalProtocolTaskCreateResult = ExternalProtocolMutationResult & {
  similarTasks?: Array<{ taskId: string; title: string; similarity: number }>
}

/** One match from coord_query_context's lexical search over findings/learnings/tasks. */
export type ProtocolContextMatch = {
  kind: 'finding' | 'learning' | 'handoff' | 'review.requested' | 'task.completed' | 'task.failed' | 'plan.approved' | 'plan.rejected' | 'task' | 'project_memory'
  taskId?: string
  agentId?: string
  summary: string
  detail?: string
  timestamp: string
  score: number
}

export type ExternalProtocolContextResult = {
  results: ProtocolContextMatch[]
}

export type ProtocolAgentLivenessStatus = 'fresh' | 'stale' | 'dead'

export type ProtocolDeliveryHint = {
  name: string
  status: ProtocolAgentLivenessStatus
  /** Seconds since the recipient's last heartbeat/turn; null if never seen. */
  ageSeconds: number | null
}

/**
 * coord_send_message's result: per-recipient liveness at send time, so the
 * sender knows immediately whether an @mention landed on someone actively
 * working, someone asleep, or someone gone — instead of finding out minutes
 * later when nothing happens. Mirrors murmur's say() delivery hints
 * (mentioned_active/stale/unknown), computed from data we already track
 * (ProtocolAgent.lastSeenAt / turnActive) rather than free-text mention
 * parsing, since our `to` field is an explicit recipient, not embedded text.
 */
export type ExternalProtocolMessageResult = ExternalProtocolMutationResult & {
  delivery: ProtocolDeliveryHint[]
}

// ---------------------------------------------------------------------------
// Run playbooks — the Claude Code dynamic-workflows model adapted to a
// multi-CLI board: the plan lives in a reusable, parameterized artifact
// instead of a lead's planning turn. A playbook seeds the whole task board at
// run creation; phases are barriers (every task in phase N+1 depends on every
// task in phase N) plus explicit per-task dependencies by key.

export type PlaybookTask = {
  /** Stable key other tasks may reference in dependsOn. */
  key?: string
  title: string
  /** Full teammate prompt. Supports {{args}} and {{args.<key>}} interpolation. */
  detail: string
  /** Role responsible for this lane. Defaults to teammate. */
  role?: ProtocolTaskTargetRole
  paths?: string[]
  /** Keys (same or earlier phase) this task depends on, beyond the phase barrier. */
  dependsOn?: string[]
  seat?: ProtocolSeat
  provider?: AgentProvider
  model?: string
  effort?: string
  /** Optional Claude-native overrides; role/task defaults are derived when omitted. */
  claude?: Partial<Omit<ProtocolClaudeAgentPolicy, 'name' | 'description' | 'prompt'>> & {
    name?: string
    description?: string
    prompt?: string
  }
  verifyCommands?: string[]
}

export type PlaybookPhase = {
  title: string
  tasks: PlaybookTask[]
}

export type RunPlaybook = {
  /** Slug used as the /command-style handle and file name. */
  name: string
  description?: string
  /** Shown to the invoker as guidance for what to pass as args. */
  argsHint?: string
  maxAgents?: number
  gateCommand?: string
  requirePlanApproval?: boolean
  autonomy?: ProtocolAutonomy
  requireReview?: boolean
  acceptanceContract?: Partial<ProtocolAcceptanceContract>
  budget?: ProtocolRunBudget
  phases: PlaybookPhase[]
}

export type PlaybookSummary = {
  name: string
  description?: string
  argsHint?: string
  path: string
  phaseCount: number
  taskCount: number
  expectsArgs: boolean
  maxAgents?: number
  gateCommand?: string
  requirePlanApproval?: boolean
  autonomy?: ProtocolAutonomy
  requireReview?: boolean
  budget?: ProtocolRunBudget
}

export type ProtocolPhaseRollup = {
  title: string
  total: number
  pending: number
  active: number
  completed: number
  failed: number
}

const PLAYBOOK_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidPlaybookName(value: unknown): value is string {
  return typeof value === 'string' && PLAYBOOK_NAME_RE.test(value)
}

export function isProtocolAutonomy(value: unknown): value is ProtocolAutonomy {
  return value === 'low' || value === 'medium' || value === 'high'
}

function protocolStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
}

function parseClaudeAgentPolicy(value: unknown): PlaybookTask['claude'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const sandboxRecord = record.sandbox && typeof record.sandbox === 'object' && !Array.isArray(record.sandbox)
    ? record.sandbox as Record<string, unknown>
    : undefined
  const filesystemRecord = sandboxRecord?.filesystem && typeof sandboxRecord.filesystem === 'object' && !Array.isArray(sandboxRecord.filesystem)
    ? sandboxRecord.filesystem as Record<string, unknown>
    : undefined
  const permissionMode = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'].includes(String(record.permissionMode))
    ? record.permissionMode as ProtocolClaudeAgentPolicy['permissionMode']
    : undefined
  const effort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(String(record.effort))
    ? record.effort as ProtocolClaudeAgentPolicy['effort']
    : undefined
  return {
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined,
    description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined,
    prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : undefined,
    tools: record.tools === undefined ? undefined : protocolStringArray(record.tools),
    disallowedTools: record.disallowedTools === undefined ? undefined : protocolStringArray(record.disallowedTools),
    skills: record.skills === undefined ? undefined : protocolStringArray(record.skills),
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : undefined,
    mcpServers: Array.isArray(record.mcpServers)
      ? record.mcpServers.filter((entry): entry is string | Record<string, unknown> => (
        (typeof entry === 'string' && entry.trim().length > 0)
        || Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))
      ))
      : undefined,
    criticalSystemReminder: typeof record.criticalSystemReminder === 'string' && record.criticalSystemReminder.trim()
      ? record.criticalSystemReminder.trim()
      : undefined,
    initialPrompt: typeof record.initialPrompt === 'string' && record.initialPrompt.trim() ? record.initialPrompt.trim() : undefined,
    maxTurns: typeof record.maxTurns === 'number' && Number.isInteger(record.maxTurns) && record.maxTurns > 0
      ? record.maxTurns
      : undefined,
    background: typeof record.background === 'boolean' ? record.background : undefined,
    memory: ['user', 'project', 'local'].includes(String(record.memory))
      ? record.memory as ProtocolClaudeAgentPolicy['memory']
      : undefined,
    effort,
    permissionMode,
    observer: typeof record.observer === 'string' && record.observer.trim() ? record.observer.trim() : undefined,
    observerMessage: typeof record.observerMessage === 'string' && record.observerMessage.trim() ? record.observerMessage.trim() : undefined,
    sandbox: sandboxRecord ? {
      enabled: typeof sandboxRecord.enabled === 'boolean' ? sandboxRecord.enabled : undefined,
      failIfUnavailable: typeof sandboxRecord.failIfUnavailable === 'boolean' ? sandboxRecord.failIfUnavailable : undefined,
      autoAllowBashIfSandboxed: typeof sandboxRecord.autoAllowBashIfSandboxed === 'boolean' ? sandboxRecord.autoAllowBashIfSandboxed : undefined,
      allowUnsandboxedCommands: typeof sandboxRecord.allowUnsandboxedCommands === 'boolean' ? sandboxRecord.allowUnsandboxedCommands : undefined,
      filesystem: filesystemRecord ? {
        allowWrite: filesystemRecord.allowWrite === undefined ? undefined : protocolStringArray(filesystemRecord.allowWrite),
        denyWrite: filesystemRecord.denyWrite === undefined ? undefined : protocolStringArray(filesystemRecord.denyWrite),
      } : undefined,
    } : undefined,
  }
}

export function normalizeAcceptanceContract(
  goal: string,
  value?: Partial<ProtocolAcceptanceContract>,
): ProtocolAcceptanceContract {
  const source = value && typeof value === 'object' ? value : {}
  return {
    goal: typeof source.goal === 'string' && source.goal.trim() ? source.goal.trim() : goal.trim(),
    nonGoals: protocolStringArray(source.nonGoals),
    userVisibleAcceptance: protocolStringArray(source.userVisibleAcceptance),
    filesLikelyTouched: protocolStringArray(source.filesLikelyTouched),
    verificationCommands: protocolStringArray(source.verificationCommands),
    manualQa: protocolStringArray(source.manualQa),
    escalationTriggers: protocolStringArray(source.escalationTriggers),
    assumptions: Array.isArray(source.assumptions) ? source.assumptions.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string' || !entry.text.trim()) return []
      return [{
        id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `A${index + 1}`,
        text: entry.text.trim(),
        impactIfWrong: typeof entry.impactIfWrong === 'string' ? entry.impactIfWrong.trim() : '',
        status: entry.status === 'confirmed' || entry.status === 'deferred' ? entry.status : 'unconfirmed',
        source: typeof entry.source === 'string' && entry.source.trim() ? entry.source.trim() : undefined,
      } satisfies ProtocolAssumption]
    }) : [],
    lockedDecisions: Array.isArray(source.lockedDecisions) ? source.lockedDecisions.flatMap((entry) => (
      entry && typeof entry === 'object' && typeof entry.decision === 'string' && entry.decision.trim()
        ? [{ decision: entry.decision.trim(), source: typeof entry.source === 'string' ? entry.source.trim() : 'run contract' }]
        : []
    )) : [],
  }
}

/** Replace {{args}} / {{args.key}} placeholders; non-string args are JSON-encoded. */
export function interpolatePlaybookText(text: string, args: unknown): string {
  if (!text.includes('{{')) return text
  const render = (value: unknown): string => {
    if (value === undefined || value === null) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  return text.replace(/\{\{\s*args(?:\.([A-Za-z0-9_-]+))?\s*\}\}/g, (_match, key: string | undefined) => {
    if (!key) return render(args)
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      return render((args as Record<string, unknown>)[key])
    }
    return ''
  })
}

/** True when any task text carries {{args…}} placeholders. */
export function playbookExpectsArgs(playbook: RunPlaybook): boolean {
  const needs = (text: string) => /\{\{\s*args/.test(text)
  return playbook.phases.some((phase) => phase.tasks.some((task) => (
    needs(task.title) || needs(task.detail) || (task.paths ?? []).some(needs)
  )))
}

/** Validate untrusted JSON into a RunPlaybook, with actionable errors. */
export function parseRunPlaybook(value: unknown): RunPlaybook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('playbook must be an object')
  const record = value as Record<string, unknown>
  if (!isValidPlaybookName(record.name)) {
    throw new Error('playbook.name must be a lowercase slug (a-z, 0-9, hyphens, max 64 chars)')
  }
  if (!Array.isArray(record.phases) || record.phases.length === 0) {
    throw new Error('playbook.phases must be a non-empty array')
  }
  const keyPhase = new Map<string, number>()
  const phases: PlaybookPhase[] = record.phases.map((phaseValue, phaseIndex) => {
    if (!phaseValue || typeof phaseValue !== 'object') throw new Error(`playbook.phases[${phaseIndex}] must be an object`)
    const phase = phaseValue as Record<string, unknown>
    const title = typeof phase.title === 'string' && phase.title.trim() ? phase.title.trim() : `Phase ${phaseIndex + 1}`
    if (!Array.isArray(phase.tasks) || phase.tasks.length === 0) {
      throw new Error(`playbook phase "${title}" must have a non-empty tasks array`)
    }
    const tasks: PlaybookTask[] = phase.tasks.map((taskValue, taskIndex) => {
      if (!taskValue || typeof taskValue !== 'object') throw new Error(`task ${taskIndex + 1} in phase "${title}" must be an object`)
      const task = taskValue as Record<string, unknown>
      const taskTitle = typeof task.title === 'string' ? task.title.trim() : ''
      const detail = typeof task.detail === 'string' ? task.detail.trim() : ''
      if (!taskTitle || !detail) throw new Error(`task ${taskIndex + 1} in phase "${title}" needs title and detail`)
      if (task.role !== undefined && task.role !== 'lead' && task.role !== 'teammate' && task.role !== 'any') {
        throw new Error(`task ${taskIndex + 1} in phase "${title}" has invalid role; expected lead, teammate, or any`)
      }
      if (task.seat !== undefined && !['director', 'executor', 'validator', 'watcher'].includes(String(task.seat))) {
        throw new Error(`task ${taskIndex + 1} in phase "${title}" has invalid seat`)
      }
      if (task.provider !== undefined && !['claude', 'codex', 'opencode', 'copilot', 'pi'].includes(String(task.provider))) {
        throw new Error(`task ${taskIndex + 1} in phase "${title}" has invalid provider`)
      }
      const key = typeof task.key === 'string' && task.key.trim() ? task.key.trim() : undefined
      if (key) {
        if (keyPhase.has(key)) throw new Error(`duplicate playbook task key: ${key}`)
        keyPhase.set(key, phaseIndex)
      }
      return {
        key,
        title: taskTitle,
        detail,
        role: task.role === 'lead' || task.role === 'any' ? task.role : 'teammate',
        paths: Array.isArray(task.paths)
          ? task.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : undefined,
        dependsOn: Array.isArray(task.dependsOn)
          ? task.dependsOn.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : undefined,
        seat: ['director', 'executor', 'validator', 'watcher'].includes(String(task.seat)) ? task.seat as ProtocolSeat : undefined,
        provider: typeof task.provider === 'string' ? task.provider as AgentProvider : undefined,
        model: typeof task.model === 'string' && task.model.trim() ? task.model.trim() : undefined,
        effort: typeof task.effort === 'string' && task.effort.trim() ? task.effort.trim() : undefined,
        claude: parseClaudeAgentPolicy(task.claude),
        verifyCommands: protocolStringArray(task.verifyCommands),
      }
    })
    return { title, tasks }
  })
  phases.forEach((phase, phaseIndex) => {
    for (const task of phase.tasks) {
      for (const dep of task.dependsOn ?? []) {
        const depPhase = keyPhase.get(dep)
        if (depPhase === undefined) throw new Error(`task "${task.title}" depends on unknown key: ${dep}`)
        // A dependency on a later phase can never complete first — the barrier
        // makes the later phase wait on this one, so the board deadlocks.
        if (depPhase > phaseIndex) {
          throw new Error(`task "${task.title}" depends on "${dep}" in a later phase — later-phase dependencies deadlock the phase barrier`)
        }
      }
    }
  })
  return {
    name: record.name,
    description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : undefined,
    argsHint: typeof record.argsHint === 'string' && record.argsHint.trim() ? record.argsHint.trim() : undefined,
    maxAgents: Number.isFinite(Number(record.maxAgents)) && Number(record.maxAgents) > 0 ? Number(record.maxAgents) : undefined,
    gateCommand: typeof record.gateCommand === 'string' && record.gateCommand.trim() ? record.gateCommand.trim() : undefined,
    requirePlanApproval: record.requirePlanApproval === true ? true : undefined,
    autonomy: isProtocolAutonomy(record.autonomy) ? record.autonomy : undefined,
    requireReview: record.requireReview === true ? true : undefined,
    acceptanceContract: record.acceptanceContract && typeof record.acceptanceContract === 'object'
      ? record.acceptanceContract as Partial<ProtocolAcceptanceContract>
      : undefined,
    budget: record.budget && typeof record.budget === 'object' ? {
      maxTokens: Number.isFinite(Number((record.budget as Record<string, unknown>).maxTokens))
        ? Math.max(1, Number((record.budget as Record<string, unknown>).maxTokens)) : undefined,
      maxCostUsd: Number.isFinite(Number((record.budget as Record<string, unknown>).maxCostUsd))
        ? Math.max(0.01, Number((record.budget as Record<string, unknown>).maxCostUsd)) : undefined,
      maxDurationMinutes: Number.isFinite(Number((record.budget as Record<string, unknown>).maxDurationMinutes))
        ? Math.max(1, Number((record.budget as Record<string, unknown>).maxDurationMinutes)) : undefined,
    } : undefined,
    phases,
  }
}

export type ExternalProtocolCompletionResult = ExternalProtocolMutationResult & {
  accepted: boolean
  reason?: string
}

const PROTOCOL_BLOCK_RE = /```(?:a2a|agent-protocol)\s*([\s\S]*?)```/g
const A2A_EXTENSION_KEY = A2A_COORDINATION_EXTENSION_URI

const EVENT_TYPES: ReadonlySet<string> = new Set<ProtocolEventType>([
  'agent.ready', 'agent.heartbeat', 'agent.start_work', 'agent.stop_work',
  'agent.blocked', 'agent.unblocked',
  'task.created', 'task.planned', 'task.claim', 'task.claimed',
  'task.released', 'task.completed', 'task.failed', 'plan.completed',
  'task.child.started', 'task.child.progress', 'task.child.completed',
  'task.child.failed', 'task.child.cancelled', 'usage.observed',
  'plan.approved', 'plan.rejected',
  'decision.raised', 'decision.resolved', 'review.completed', 'phase.reported',
  'phase.approved', 'phase.rejected',
  'checkpoint.created', 'model.drift', 'learning.promoted',
  'lock.requested', 'lock.granted', 'lock.denied', 'lock.released',
  'finding', 'learning', 'message', 'handoff', 'review.requested',
  'shutdown.requested', 'run.status',
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

function cleanRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textFromParts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const text = value
    .map((part) => cleanRecord(part)?.text)
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n')
    .trim()
  return text || undefined
}

function splitSummaryDetail(text: string | undefined): { summary?: string; detail?: string } {
  if (!text) return {}
  const [summary, ...detail] = text.split('\n\n')
  return { summary: cleanString(summary), detail: cleanString(detail.join('\n\n')) }
}

function extensionFromMetadata(value: unknown): Record<string, unknown> | undefined {
  const metadata = cleanRecord(value)
  return cleanRecord(metadata?.[A2A_EXTENSION_KEY])
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function isA2APart(value: unknown): boolean {
  const part = cleanRecord(value)
  if (!part) return false
  return ['text', 'raw', 'url', 'data'].filter((key) => hasOwn(part, key)).length === 1
}

function isA2AMessage(value: unknown): boolean {
  const message = cleanRecord(value)
  return Boolean(
    message
    && cleanString(message.messageId)
    && (message.role === 'ROLE_USER' || message.role === 'ROLE_AGENT')
    && Array.isArray(message.parts)
    && message.parts.length > 0
    && message.parts.every(isA2APart),
  )
}

function isA2ATaskStatus(value: unknown): boolean {
  const status = cleanRecord(value)
  const states: ReadonlySet<unknown> = new Set<A2ATaskState>([
    'TASK_STATE_UNSPECIFIED', 'TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING',
    'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED',
    'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_REJECTED', 'TASK_STATE_AUTH_REQUIRED',
  ])
  return Boolean(status && states.has(status.state) && (!status.message || isA2AMessage(status.message)))
}

function isA2AArtifact(value: unknown): boolean {
  const artifact = cleanRecord(value)
  return Boolean(
    artifact
    && cleanString(artifact.artifactId)
    && Array.isArray(artifact.parts)
    && artifact.parts.length > 0
    && artifact.parts.every(isA2APart),
  )
}

function sanitizeA2AStreamResponse(value: unknown): AgentProtocolEvent | null {
  const response = cleanRecord(value)
  if (!response) return null

  const populated = ['task', 'message', 'statusUpdate', 'artifactUpdate']
    .filter((key) => cleanRecord(response[key]))
  if (populated.length !== 1) return null

  const kind = populated[0]
  const body = cleanRecord(response[kind])!
  const artifact = kind === 'artifactUpdate' ? cleanRecord(body.artifact) : undefined
  const status = kind === 'task' || kind === 'statusUpdate' ? cleanRecord(body.status) : undefined
  const valid = kind === 'message'
    ? isA2AMessage(body)
    : kind === 'task'
      ? Boolean(cleanString(body.id) && isA2ATaskStatus(status)
        && (!body.artifacts || (Array.isArray(body.artifacts) && body.artifacts.every(isA2AArtifact))))
      : kind === 'statusUpdate'
        ? Boolean(cleanString(body.taskId) && cleanString(body.contextId) && isA2ATaskStatus(status))
        : Boolean(cleanString(body.taskId) && cleanString(body.contextId) && isA2AArtifact(artifact))
  if (!valid) return null
  const statusMessage = cleanRecord(status?.message)
  const metadata = extensionFromMetadata(
    kind === 'message' ? body.metadata
      : kind === 'artifactUpdate' ? body.metadata ?? artifact?.metadata
        : body.metadata ?? statusMessage?.metadata,
  )
  if (!metadata) return null

  const type = metadata.operation
  const runId = cleanString(body.contextId)
  const agentId = cleanString(metadata.agentId)
  if (!isProtocolEventType(type) || !runId || !agentId) return null

  const taskId = cleanString(body.taskId) ?? (kind === 'task' ? cleanString(body.id) : undefined)
  const messageText = kind === 'message'
    ? textFromParts(body.parts)
    : statusMessage
      ? textFromParts(statusMessage.parts)
      : artifact
        ? textFromParts(artifact.parts)
        : undefined
  const fallbackText = splitSummaryDetail(messageText)
  return {
    version: AGENT_PROTOCOL_VERSION,
    runId,
    agentId,
    type,
    taskId,
    lockId: cleanString(metadata.lockId),
    to: cleanString(metadata.to),
    title: cleanString(metadata.title) ?? (kind === 'task' ? cleanString(cleanRecord(body.metadata)?.title) : undefined),
    dependsOn: cleanStringArray(metadata.dependsOn),
    summary: cleanString(metadata.summary) ?? fallbackText.summary,
    detail: cleanString(metadata.detail) ?? fallbackText.detail,
    paths: cleanStringArray(metadata.paths),
    payload: cleanRecord(metadata.payload),
    timestamp: cleanString(metadata.timestamp) ?? cleanString(status?.timestamp),
  }
}

/** Normalize A2A 1.0 wire objects and legacy AVP events into the ledger shape. */
export function sanitizeProtocolEvent(value: unknown): AgentProtocolEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const a2a = sanitizeA2AStreamResponse(record)
  if (a2a) return a2a
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
  if (!text.includes('```a2a') && !text.includes('agent-protocol')) return []
  const events: AgentProtocolEvent[] = []
  for (const match of text.matchAll(PROTOCOL_BLOCK_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    try {
      const parsed = parseProtocolBlockJson(raw)
      const event = sanitizeProtocolEvent(parsed)
      if (event) events.push(event)
    } catch {
      // Invalid model output is ignored; the coordinator keeps running.
    }
  }
  return events
}

/**
 * Models occasionally close the outer StreamResponse immediately after its
 * `task` member, then append `artifacts`/`metadata` as trailing siblings. The
 * leading object is still a complete A2A Task and its status message carries
 * the coordination extension. Recover only that balanced leading JSON object;
 * normal JSON remains strict and all recovered values still pass the full A2A
 * sanitizer before they can mutate the Coordinator ledger.
 */
function parseProtocolBlockJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (originalError) {
    const start = raw.search(/[\[{]/)
    if (start < 0) throw originalError
    const opener = raw[start]
    const closer = opener === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === opener) depth += 1
      else if (char === closer) depth -= 1
      if (depth === 0) return JSON.parse(raw.slice(start, index + 1)) as unknown
    }
    throw originalError
  }
}

function a2aStateForEvent(type: ProtocolEventType): A2ATaskState {
  if (type === 'task.completed') return 'TASK_STATE_COMPLETED'
  if (type === 'task.failed') return 'TASK_STATE_FAILED'
  if (type === 'task.released') return 'TASK_STATE_SUBMITTED'
  if (type === 'agent.blocked' || type === 'task.planned') return 'TASK_STATE_INPUT_REQUIRED'
  if (type === 'task.created' || type === 'task.claim') return 'TASK_STATE_SUBMITTED'
  return 'TASK_STATE_WORKING'
}

function eventExtension(event: AgentProtocolEvent): Record<string, unknown> {
  return {
    agentId: event.agentId,
    operation: event.type,
    ...(event.lockId ? { lockId: event.lockId } : {}),
    ...(event.to ? { to: event.to } : {}),
    ...(event.title ? { title: event.title } : {}),
    ...(event.dependsOn ? { dependsOn: event.dependsOn } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
    ...(event.paths ? { paths: event.paths } : {}),
    ...(event.payload ? { payload: event.payload } : {}),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
  }
}

function eventText(event: AgentProtocolEvent): string {
  return [event.summary, event.detail].filter(Boolean).join('\n\n') || event.type
}

/** Convert the internal ledger event to a standards-shaped A2A StreamResponse. */
export function makeA2AStreamResponse(event: AgentProtocolEvent): A2AStreamResponse {
  const metadata = { [A2A_EXTENSION_KEY]: eventExtension(event) }
  const message: A2AMessage = {
    messageId: `${event.runId}:${event.agentId}:${event.timestamp ?? 'current'}:${event.type}`,
    contextId: event.runId,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    role: 'ROLE_AGENT',
    parts: [{ text: eventText(event), mediaType: 'text/plain' }],
    metadata,
    extensions: [A2A_COORDINATION_EXTENSION_URI],
    ...(event.dependsOn ? { referenceTaskIds: event.dependsOn } : {}),
  }

  if (event.type === 'task.created' && event.taskId) {
    return {
      task: {
        id: event.taskId,
        contextId: event.runId,
        status: { state: 'TASK_STATE_SUBMITTED', message, ...(event.timestamp ? { timestamp: event.timestamp } : {}) },
        metadata: { ...metadata, title: event.title ?? event.summary ?? event.taskId },
      },
    }
  }

  if (event.type === 'task.completed' && event.taskId) {
    return {
      task: {
        id: event.taskId,
        contextId: event.runId,
        status: { state: 'TASK_STATE_COMPLETED', message, ...(event.timestamp ? { timestamp: event.timestamp } : {}) },
        artifacts: [{
          artifactId: `${event.taskId}:result`,
          name: 'Task result',
          description: event.summary,
          parts: [{ text: eventText(event), mediaType: 'text/plain' }],
          metadata,
          extensions: [A2A_COORDINATION_EXTENSION_URI],
        }],
        metadata,
      },
    }
  }

  if (event.taskId && (
    event.type.startsWith('task.')
    || event.type.startsWith('plan.')
    || event.type === 'agent.start_work'
    || event.type === 'agent.stop_work'
    || event.type === 'agent.blocked'
    || event.type === 'agent.unblocked'
  )) {
    return {
      statusUpdate: {
        taskId: event.taskId,
        contextId: event.runId,
        status: { state: a2aStateForEvent(event.type), message, ...(event.timestamp ? { timestamp: event.timestamp } : {}) },
        metadata,
      },
    }
  }

  if ((event.type === 'finding' || event.type === 'learning') && event.taskId) {
    return {
      artifactUpdate: {
        taskId: event.taskId,
        contextId: event.runId,
        artifact: {
          artifactId: `${event.taskId}:${event.type}:${event.agentId}`,
          name: event.type === 'finding' ? 'Finding' : 'Learning',
          parts: [{ text: eventText(event), mediaType: 'text/plain' }],
          metadata,
          extensions: [A2A_COORDINATION_EXTENSION_URI],
        },
        append: true,
        metadata,
      },
    }
  }

  return { message }
}

export function makeProtocolBlock(event: AgentProtocolEvent): string {
  return [
    '```a2a',
    JSON.stringify(makeA2AStreamResponse(event), null, 2),
    '```',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Prompt builders. The doc's coordination surface (task list, mailbox,
// roster/team config, self-claiming, idle notification) is reproduced as
// plain-text sections every agent receives at the top of each turn.

/** Lead-defined specialization framing for a task, or [] when none was set. */
function taskRoleLines(task: Pick<ProtocolTask, 'roleName' | 'roleDescription'> | null | undefined): string[] {
  if (!task?.roleName) return []
  return [
    `Role for this task: ${task.roleName}${task.roleDescription ? ` — ${task.roleDescription}` : ''}`,
    '',
  ]
}

export function formatTaskBoard(tasks: ProtocolTask[]): string {
  if (tasks.length === 0) return '- (no tasks yet)'
  return tasks.map((task) => {
    const deps = task.blockedBy.length > 0 ? ` deps:[${task.blockedBy.join(',')}]` : ''
    const owner = task.ownerAgentId ? ` owner:${task.ownerAgentId}` : ''
    const resultDetail = task.resultDetail && task.resultDetail.length > 1200
      ? `${task.resultDetail.slice(0, 1199)}…`
      : task.resultDetail
    const result = task.resultSummary
      ? `\n  result: ${task.resultSummary}${resultDetail ? ` — ${resultDetail}` : ''}`
      : ''
    const spec = task.roleName ? ` spec:${task.roleName}` : ''
    return `- ${task.id} [${task.status}] role:${task.targetRole}${spec}${owner}${deps} ${task.title}${result}`
  }).join('\n')
}

export function formatRoster(agents: ProtocolAgent[]): string {
  if (agents.length === 0) return '- (no teammates yet)'
  return agents.map((agent) => (
    `- ${agent.name} (${agent.role}, id:${agent.id}, status:${agent.status}${agent.taskId ? `, task:${agent.taskId}` : ''})`
  )).join('\n')
}

function formatLeadSupervisionRoster(agents: ProtocolAgent[]): string {
  if (agents.length === 0) return '- (no teammates yet)'
  return agents.map((agent) => {
    const task = agent.taskId ? `, task:${agent.taskId}` : ''
    const turn = agent.turnActive ? ', turn:active' : ''
    const lastSeen = agent.lastSeenAt ?? agent.updatedAt
    return `- ${agent.name} (${agent.role}, id:${agent.id}, status:${agent.status}${task}${turn}, last update:${lastSeen})`
  }).join('\n')
}

export function formatInbox(messages: ProtocolMessage[], agentsById: Map<string, ProtocolAgent>): string {
  if (messages.length === 0) return '(empty)'
  return messages.map((message) => {
    const from = agentsById.get(message.fromAgentId)?.name ?? message.fromAgentId
    // Tag urgency/reply-obligation inline — dropping these left every inbox
    // line looking identical, so an urgent reply-required request read the
    // same as an FYI status ping and got the same (non-)priority.
    const tags = [
      message.priority === 'urgent' ? 'URGENT' : null,
      message.replyRequired ? 'reply-required' : null,
      message.kind !== 'request' && message.kind !== 'response' ? message.kind : null,
    ].filter(Boolean)
    const tag = tags.length > 0 ? ` [${tags.join(', ')}]` : ''
    return `- from ${from}${tag}: ${message.body}`
  }).join('\n')
}

/**
 * Points a spawned agent at the coordinate-agents skill for the depth this
 * inline preamble doesn't cover (playbooks, project memory/reusable roles,
 * shared-checkout guardrails, cooperative participants, the multi-agent
 * startup invariant). Mirrors bin/agent-viewer-coord-worker.mjs's tickPrompt,
 * which grounds its unattended workers the same way — TUI/web-launched runs
 * previously skipped this because they never go through that script. No
 * `node:path` here (this module is Node-API-free so it loads everywhere);
 * a plain forward-slash join is fine since this only ever renders into a
 * human/model-facing instruction string, never touches the filesystem.
 */
function skillGroundingLine(cwd: string): string {
  const skillPath = `${cwd.replace(/\/+$/, '')}/.agents/skills/coordinate-agents/SKILL.md`
  return `Read and follow the coordinate-agents skill at ${skillPath} if it exists, then use the agent-viewer coord_* MCP tools now. Do not search outside this checkout for the skill; these instructions are sufficient if the file is absent.`
}

function protocolGrammar(runId: string, agentId: string): string {
  const example = makeA2AStreamResponse({
    version: AGENT_PROTOCOL_VERSION,
    runId,
    agentId,
    type: 'message',
    to: 'lead',
    summary: 'Send a message to the lead.',
  })
  return [
    `This is an internal Agent Viewer run bound to A2A Protocol ${AGENT_PROTOCOL_VERSION}.`,
    'Do not call `coord_*` MCP tools, invoke an external Coordinator workflow, or try to create, join, resume, or inspect the run through the MCP bridge. The fenced events you emit here are the authoritative control channel.',
    '',
    'Speak the protocol by emitting A2A StreamResponse JSON objects fenced with the `a2a` language (each on its own lines). Emit exactly one of `task`, `message`, `statusUpdate`, or `artifactUpdate` in each block.',
    `Use contextId ${runId}. Put Agent Viewer coordination fields in metadata["${A2A_COORDINATION_EXTENSION_URI}"] and declare that same URI in the extensions array on Messages and Artifacts.`,
    'Illustrative A2A message only — do not echo this example as an event:',
    JSON.stringify(example, null, 2),
    '',
    `Set \`metadata["${A2A_COORDINATION_EXTENSION_URI}"].operation\` to one of these coordination operations:`,
    '- `agent.start_work` / `agent.stop_work` (include taskId) — bracket every work stint.',
    '- `agent.heartbeat` (taskId, summary) — on a task running longer than ~2 minutes, emit one every ~2 minutes with a one-line status. The lead sees silence past that window as stalled, not just slow.',
    '- `agent.blocked` — you cannot proceed; summary = the blocker. `agent.unblocked` when cleared.',
    '- `task.claim` (taskId) — request the next pending task. The coordinator grants or denies it.',
    '- `task.created` (taskId, title, detail, paths, dependsOn) — add newly discovered work as an A2A Task in SUBMITTED state.',
    '- `task.planned` (taskId, summary, detail) — submit an implementation plan for your claimed task before editing when plan approval is required.',
    '- `plan.approved` / `plan.rejected` (taskId, summary/detail) — lead-only approval decision for a teammate plan.',
    '- `task.completed` / `task.failed` (taskId, summary/detail) — complete with an A2A Task result Artifact or fail with a TaskStatusUpdateEvent. For completion, include payload fields `actualModel`, `usage`, `filesChanged`, `commandsRun`, and `needsDecision`; these form the durable receipt. Completion is gated: changes outside your locked paths, failed verification, unresolved low/medium-autonomy decisions, or model drift are rejected with feedback.',
    '- `lock.requested` (paths) — ask for write access before touching paths you do not hold.',
    '- `finding` — a fact other agents need (summary + detail). `learning` — reusable implementation context. When task-scoped, emit these as Artifact updates.',
    '- `message` (to, summary/detail) — an A2A Message to one teammate by name, "lead", or "all". Delivered live when the recipient is mid-turn, else on their next turn.',
    '- `shutdown.requested` — ask the coordinator to retire you when your work is done.',
  ].join('\n')
}

/** First turn for the team lead: decompose the prompt into a real task list. */
export function buildLeadPlanPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name'>
  prompt: string
  teammateCount: number
  useWorktrees: boolean
  cwd: string
}): string {
  return [
    `You are the TEAM LEAD of a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id} · Your name: ${params.agent.name}`,
    skillGroundingLine(params.cwd),
    '',
    `Up to ${params.teammateCount} teammates will be spawned to execute the task list you produce.`,
    params.useWorktrees
      ? 'Each teammate works in its own isolated git worktree and self-claims tasks from the board.'
      : 'All teammates work in the same shared checkout. Give every task strictly non-overlapping write paths; path locks are the concurrency boundary.',
    '',
    'Your job THIS TURN (do not implement anything yourself):',
    `1. Study the request below. Explore the repository read-only as needed.`,
    `2. Decompose it into small, self-contained tasks — aim for ${Math.max(params.teammateCount * 2, 4)}-${params.teammateCount * 5} of them, each a clear deliverable`,
    '   (a function, a module, a test file, a review). Emit one `task.created` block per task with:',
    '   - `title`: short imperative title',
    '   - `detail`: the full prompt a teammate needs to do the work without your context',
    '   - `paths`: the file paths/globs the task will write (its lock claim). Non-overlapping paths across tasks — two agents editing the same file is the failure mode to design away.',
    '   - `dependsOn`: task ids that must complete first (use the ids you assign, task-1, task-2, …)',
    '   - Make every task achievable using only its own paths and the public/test seams its dependencies are explicitly required to deliver. If a test needs new exports or dependency injection, put that production file and its tests in one task, or require the producer task to expose and verify the seam before creating a test-only dependent task.',
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
  useWorktrees: boolean
  cwd: string
}): string {
  const pathList = params.task.paths.length > 0
    ? params.task.paths.map((path) => `- ${path}`).join('\n')
    : '- (no write paths yet — your plan may request paths, but do not edit)'
  return [
    `You are teammate "${params.agent.name}" in a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    skillGroundingLine(params.cwd),
    params.useWorktrees
      ? 'Your task will run in an isolated git worktree. Plan only for your granted paths; integration happens after the task is complete.'
      : 'Your task will run in the shared checkout. Plan only for your granted paths, preserve existing changes, and avoid every path owned by another participant.',
    '',
    'THIS TURN IS PLAN-ONLY. Do not edit files, run destructive commands, or mark the task complete.',
    'Study the repo read-only and propose the approach. The team lead must approve before you implement.',
    '',
    ...taskRoleLines(params.task),
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
    '- If the task is impossible as scoped, emit `agent.blocked`; this automatically alerts the lead. Also `message` the specific teammate who can resolve it when applicable.',
    '- End with `agent.stop_work`. Do not emit `task.completed` until the lead emits `plan.approved`.',
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/** A teammate turn: first assignment or a follow-up dispatch in the work loop. */
export function buildTeammateTurnPreamble(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name' | 'role'>
  roster: ProtocolAgent[]
  task: ProtocolTask | null
  allTasks: ProtocolTask[]
  inbox: ProtocolMessage[]
  agentsById: Map<string, ProtocolAgent>
  note?: string
  gateCommand?: string
  requirePlanApproval?: boolean
  useWorktrees: boolean
  cwd: string
}): string {
  const pathList = params.task && params.task.paths.length > 0
    ? params.task.paths.map((path) => `- ${path}`).join('\n')
    : '- (none granted yet — request with `lock.requested` before writing)'
  return [
    params.agent.role === 'lead'
      ? `You are the TEAM LEAD in a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}), now executing an explicit lead-owned integration task.`
      : `You are teammate "${params.agent.name}" in a coordinated multi-agent run (protocol ${AGENT_PROTOCOL_VERSION}).`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    skillGroundingLine(params.cwd),
    params.useWorktrees
      ? 'You work in an isolated git worktree; your changes merge back later. Never edit files outside your granted paths.'
      : 'You work in the shared checkout. Never edit files outside your granted paths, overwrite another participant\'s changes, or reset or clean existing files.',
    '',
    ...taskRoleLines(params.task),
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
      ? [`- Completions are gate-checked: \`${params.gateCommand}\` runs in ${params.useWorktrees ? 'your worktree' : 'the shared checkout'} and must exit 0, or the completion is rejected with its output. Run it yourself before completing.`]
      : []),
    '- Inbox items tagged `[reply-required]` above need a `message` reply this turn, before other work — that reply is the sender\'s only signal their request landed. Silence reads as dropped, not busy.',
    '- Share what you find: `finding` for facts others need, `learning` for reusable context — teammates and the lead see them.',
    '- If blocked, emit `agent.blocked` with the exact blocker; this automatically alerts the lead. Also `message` the specific teammate best placed to unblock you, then read your inbox and resume with `agent.unblocked` when guidance clears it. Do not silently stop.',
    params.agent.role === 'lead'
      ? '- After completing, claim only another explicit lead-owned task. Do not absorb teammate lanes while live teammates are available.'
      : '- After completing, you may immediately `task.claim` the next pending unblocked task in this same turn, or end the turn — the coordinator will re-dispatch you.',
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
  supervisionUpdate?: boolean
  cwd: string
}): string {
  return [
    `You are the TEAM LEAD (protocol ${AGENT_PROTOCOL_VERSION}). Teammates need your help mid-run.`,
    `Run ID: ${params.runId} · Your agent ID: ${params.agent.id}`,
    skillGroundingLine(params.cwd),
    '',
    'Your inbox:',
    formatInbox(params.inbox, params.agentsById),
    '',
    'Live team status:',
    formatLeadSupervisionRoster(params.roster),
    '',
    'Task board:',
    formatTaskBoard(params.tasks),
    '',
    'Resolve the situation THIS TURN — coordinate, do not implement:',
    '- Inbox items tagged `[reply-required]` above need a `message` reply before anything else — a teammate waiting on you reads silence as dropped, not busy.',
    '- Review every teammate status and owned task. Leave healthy active work alone; unblock blocked agents, reassign abandoned work, and give idle agents newly claimable work.',
    '- Treat each terminal task result as authoritative input. Acknowledge dependencies it unlocks and preserve important results for final synthesis.',
    ...(params.requirePlanApproval
      ? [
          '- For any `planned` task, approve the plan with `plan.approved` (taskId, summary) only if it has clear files, steps, verification, and avoids path conflicts.',
          '- Reject weak or risky plans with `plan.rejected` (taskId, summary/detail) and concrete feedback. The teammate will revise in plan mode.',
        ]
      : []),
    '- `message` a blocked teammate (by name) with concrete unblocking guidance. Your message wakes them.',
    '- A path/scope blocker needs a board change, not the unchanged task sent back again: create a replacement task with the required paths (and fail the superseded task), or direct the owner to request the precise additional lock. Do not burn intervention turns repeating a scope that the teammate already proved impossible.',
    '- If a task is genuinely unachievable or duplicated, emit `task.failed` (taskId, summary) so the run can finish without it.',
    '- If the work needs reshaping, emit `task.created` replacements (title, detail, paths, dependsOn).',
    params.reviewingPlans
      ? '- This turn is reviewing teammate plans; it does not consume the stuck-task intervention budget.'
      : params.supervisionUpdate
        ? '- This is a supervision checkpoint; it does not consume the stuck-task intervention budget. If the team is healthy, record no speculative changes and return to monitoring.'
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
  useWorktrees: boolean
  cwd: string
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
    skillGroundingLine(params.cwd),
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
    params.useWorktrees
      ? 'risks in merging the worktrees. Then emit ONE `finding` block whose `summary`'
      : 'risks from concurrent edits in the shared checkout. Then emit ONE `finding` block whose `summary`',
    'is a one-line result and whose `detail` is the full synthesis — that block is',
    'recorded as the run summary. End with `agent.stop_work`.',
    '',
    protocolGrammar(params.runId, params.agent.id),
  ].join('\n')
}

/**
 * Turn prompt for an agent dispatched with real coord_* tool calls
 * (lib/agentCoordinationSdkTools.ts) instead of the fenced ```a2a text
 * protocol. Mirrors bin/agent-viewer-coord-worker.mjs's tickPrompt() — short
 * and role-generic, because the agent pulls roster/board/inbox itself via
 * coord_status/coord_read_inbox rather than having them dumped into every
 * dispatch. The coordinator note (blocked-task nudge, intervention reason,
 * synthesis request) is the only per-dispatch content that actually varies.
 */
export function buildSdkToolsTickPrompt(params: {
  runId: string
  agent: Pick<ProtocolAgent, 'id' | 'name' | 'role'>
  note?: string
  cwd: string
}): string {
  const roleGuidance = params.agent.role === 'lead'
    ? 'You are the lead: supervise and delegate before implementing. Never claim a teammate lane merely because it is claimable; claim only an explicit lead integration/review task, decompose the board with coord_create_task when it is empty, and finalize the run with coord_finalize_run once every task is terminal. If the board has more unblocked parallel work than idle teammates can absorb, call coord_spawn_teammate to grow the team instead of queueing it all onto the current roster.'
    : 'You are a teammate: answer reply-required mail first, then continue your owned task or claim one unblocked lane with coord_claim_task. Complete, release, or hand off owned work before ending your turn.'
  return [
    `Continue Coordinator run ${params.runId} as ${params.agent.name} (${params.agent.role}). You are ALREADY bound to this run — start with coord_status and act on the board and your inbox.`,
    skillGroundingLine(params.cwd),
    roleGuidance,
    'Drain the inbox with coord_read_inbox, then perform every immediately actionable step, including implementation and verification.',
    'When completing a task, submit an honest structured receipt with the actual model, token usage when available, changed files, commands run, and any unresolved decision. Never claim a requested model was used unless the provider confirms it.',
    'Coordinate actively — teammates cannot see your terminal: answer reply-required mail first, publish reusable discoveries with coord_publish_finding, and message teammates your progress affects with coord_send_message.',
    'If blocked, report it with coord_progress(status="blocked") and the exact obstacle, then message whoever can unblock you.',
    params.agent.role === 'lead' ? 'At phase or judgment gates, use coord_review_phase and coord_review_run; resolve explicit questions with coord_resolve_decision. Promote recurring learning only through coord_promote_learning so proposed policy changes remain reviewable.' : '',
    'If nothing is immediately actionable, end your turn rather than waiting — the coordinator re-dispatches you when the board changes.',
    ...(params.note ? [`Coordinator note: ${params.note}`] : []),
  ].join(' ')
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
