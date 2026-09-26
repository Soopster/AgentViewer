// The Coordinator ledger's read side that needs nothing but the database: row
// mappers, a read-only open, and the per-conversation attention summary.
//
// It exists apart from lib/agentCoordination.ts because that module imports the
// send path (~56MB in the TUI), and the session list must be able to say "this
// chat's team needs you" from boot — herdr's state rollup, where the sidebar
// alone shows which project needs a decision. A poll that loaded the send path
// to answer that would undo the deferral the TUI's memory budget rests on.
// Nothing here may import a provider, the send path, or agentCoordination.
import path from 'node:path'
import { existsSync } from 'node:fs'
import {
  normalizeAcceptanceContract,
  type ProtocolAcceptanceContract,
  type ProtocolAutonomy,
  type ProtocolClaudeAgentPolicy,
  type ProtocolLearningCandidate,
  type ProtocolLock,
  type ProtocolLockStatus,
  type ProtocolMessage,
  type ProtocolMessageKind,
  type ProtocolMessagePriority,
  type ProtocolPhaseReport,
  type ProtocolResumeCapsule,
  type ProtocolReviewReport,
  type ProtocolRun,
  type ProtocolRunBudget,
  type ProtocolRunSnapshot,
  type ProtocolRunStatus,
  type ProtocolTask,
  type ProtocolTaskReceipt,
  type ProtocolTaskStatus,
} from './agentProtocol'
import { coordinatorAttention } from './coordinatorAttention'
import type { AgentProvider } from './types'

export type LedgerDatabase = any
type Row = Record<string, unknown>

export const COORDINATION_DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination')
export const COORDINATION_DB_FILE = path.join(COORDINATION_DATA_DIR, 'coordination.sqlite')
/** A snapshot carries the newest terminal tasks only; attention ids must come from the same window. */
export const TERMINAL_TASK_HISTORY_WINDOW = 300

export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function parseJsonObject<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : undefined
  } catch {
    return undefined
  }
}

export function parseJsonList<T>(value: unknown): T[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function rowToRun(row: Row): ProtocolRun {
  const prompt = String(row.prompt)
  const autonomy: ProtocolAutonomy = row.autonomy === 'low' || row.autonomy === 'high' ? row.autonomy : 'medium'
  const requireReview = Boolean(Number(row.require_review ?? 0))
  return {
    id: String(row.id),
    prompt,
    status: String(row.status) as ProtocolRunStatus,
    provider: String(row.provider) as ProtocolRun['provider'],
    baseCwd: String(row.base_cwd),
    maxAgents: Number(row.max_agents) || 1,
    leadAgentId: typeof row.lead_agent_id === 'string' ? row.lead_agent_id : undefined,
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    gateCommand: typeof row.gate_command === 'string' && row.gate_command ? row.gate_command : undefined,
    requirePlanApproval: Boolean(Number(row.require_plan_approval ?? 0)),
    autonomy,
    acceptanceContract: normalizeAcceptanceContract(
      prompt,
      parseJsonObject<Partial<ProtocolAcceptanceContract>>(row.acceptance_contract_json),
    ),
    requireReview,
    requireReceipts: Boolean(Number(row.require_receipts ?? 0)),
    review: parseJsonObject<ProtocolReviewReport>(row.review_json) ?? { status: requireReview ? 'pending' : 'not_required' },
    budget: parseJsonObject<ProtocolRunBudget>(row.budget_json),
    phaseReports: parseJsonList<ProtocolPhaseReport>(row.phase_reports_json),
    resumeCapsule: parseJsonObject<ProtocolResumeCapsule>(row.resume_capsule_json),
    learningCandidates: parseJsonList<ProtocolLearningCandidate>(row.learning_candidates_json),
    useWorktrees: row.use_worktrees == null ? true : Boolean(Number(row.use_worktrees)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function rowToTask(row: Row): ProtocolTask {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    title: String(row.title),
    prompt: String(row.prompt),
    status: String(row.status) as ProtocolTaskStatus,
    ownerAgentId: typeof row.owner_agent_id === 'string' ? row.owner_agent_id : undefined,
    targetRole: row.target_role === 'lead' || row.target_role === 'any' ? row.target_role : 'teammate',
    roleName: typeof row.role_name === 'string' && row.role_name ? row.role_name : undefined,
    roleDescription: typeof row.role_description === 'string' && row.role_description ? row.role_description : undefined,
    paths: parseJsonArray(row.paths_json),
    blockedBy: parseJsonArray(row.blocked_by_json),
    phase: typeof row.phase === 'string' && row.phase ? row.phase : undefined,
    seat: row.seat === 'director' || row.seat === 'validator' || row.seat === 'watcher' ? row.seat : 'executor',
    requestedProvider: typeof row.requested_provider === 'string' && row.requested_provider ? row.requested_provider as ProtocolTask['requestedProvider'] : undefined,
    requestedModel: typeof row.requested_model === 'string' && row.requested_model ? row.requested_model : undefined,
    requestedEffort: typeof row.requested_effort === 'string' && row.requested_effort ? row.requested_effort : undefined,
    claudeAgentPolicy: parseJsonObject<ProtocolClaudeAgentPolicy>(row.claude_agent_policy_json),
    verifyCommands: parseJsonArray(row.verify_commands_json),
    receipt: parseJsonObject<ProtocolTaskReceipt>(row.receipt_json),
    resultSummary: typeof row.result_summary === 'string' && row.result_summary ? row.result_summary : undefined,
    resultDetail: typeof row.result_detail === 'string' && row.result_detail ? row.result_detail : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function rowToLock(row: Row): ProtocolLock {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    agentId: String(row.agent_id),
    taskId: typeof row.task_id === 'string' ? row.task_id : undefined,
    path: String(row.path),
    mode: String(row.mode) as ProtocolLock['mode'],
    status: String(row.status) as ProtocolLockStatus,
    leaseExpiresAt: String(row.lease_expires_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function rowToMessage(row: Row): ProtocolMessage {
  const kind = typeof row.kind === 'string' ? row.kind as ProtocolMessageKind : 'request'
  const priority = typeof row.priority === 'string' ? row.priority as ProtocolMessagePriority : 'normal'
  return {
    id: String(row.id),
    runId: String(row.run_id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    body: String(row.body),
    kind,
    priority,
    replyRequired: row.reply_required === 1 || row.reply_required === true,
    correlationId: typeof row.correlation_id === 'string' ? row.correlation_id : undefined,
    inReplyTo: typeof row.in_reply_to === 'string' ? row.in_reply_to : undefined,
    createdAt: String(row.created_at),
    deliveredAt: typeof row.delivered_at === 'string' ? row.delivered_at : undefined,
    resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : undefined,
  }
}

/** Tasks exactly as a run snapshot windows them: every open task plus the newest terminal ones. */
export function readSnapshotTasksSync(db: LedgerDatabase, runId: string): ProtocolTask[] {
  const active = db.prepare(`
    SELECT * FROM protocol_tasks WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at ASC
  `).all(runId).map(rowToTask)
  const recentTerminal = (db.prepare(`
    SELECT * FROM protocol_tasks WHERE run_id = ? AND status IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at DESC LIMIT ?
  `).all(runId, TERMINAL_TASK_HISTORY_WINDOW) as Row[]).map(rowToTask).reverse()
  return [...recentTerminal, ...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Messages exactly as a run snapshot windows them. */
export function readSnapshotMessagesSync(db: LedgerDatabase, runId: string): ProtocolMessage[] {
  return db.prepare('SELECT * FROM protocol_messages WHERE run_id = ? ORDER BY created_at ASC LIMIT 200').all(runId).map(rowToMessage)
}

export type InteractiveAttentionSummary = {
  sessionId: string
  provider: AgentProvider
  runId: string
  /** Questions, plans, decisions, blockers and reviews waiting on the user. */
  waiting: number
  /** Every result the team holds; `resultIds` lets each client subtract what it has reviewed. */
  finished: number
  resultIds: string[]
}

/**
 * Per-conversation attention, from the ledger alone: no provider calls, no
 * session activation, nothing acknowledged. `coordinatorAttention` decides
 * what counts, over the same task and message windows a full snapshot uses —
 * agents, locks and events only colour the detail text, which a count does not
 * show, so they are not read.
 */
export function readInteractiveAttentionSync(db: LedgerDatabase, limit = 25): InteractiveAttentionSummary[] {
  // The conversation's own columns are aliased: `r.*` also has a provider.
  const rows = db.prepare(`SELECT r.*, s.session_id AS interactive_session_id, s.provider AS interactive_provider
    FROM protocol_interactive_sessions s JOIN protocol_runs r ON r.id = s.run_id
    ORDER BY r.updated_at DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 100))) as Row[]
  const summary: InteractiveAttentionSummary[] = []
  for (const row of rows) {
    const runId = String(row.id)
    const snapshot: ProtocolRunSnapshot = {
      run: rowToRun(row),
      agents: [],
      tasks: readSnapshotTasksSync(db, runId),
      locks: [],
      messages: readSnapshotMessagesSync(db, runId),
      events: [],
    }
    const items = coordinatorAttention(snapshot)
    if (items.length === 0) continue
    const resultIds = items.filter(item => item.kind === 'result').map(item => item.id)
    summary.push({
      sessionId: String(row.interactive_session_id),
      provider: String(row.interactive_provider) as AgentProvider,
      runId,
      waiting: items.length - resultIds.length,
      finished: resultIds.length,
      resultIds,
    })
  }
  return summary
}

let readOnlyLedger: LedgerDatabase | null = null

/**
 * A read-only handle on the ledger, or null when there is no ledger yet (the
 * Coordinator has never been used here) or it cannot be opened. It never
 * creates or migrates the file — that belongs to agentCoordination.
 */
export async function openCoordinationLedgerReadOnly(): Promise<LedgerDatabase | null> {
  if (readOnlyLedger) return readOnlyLedger
  if (!existsSync(COORDINATION_DB_FILE)) return null
  try {
    try {
      const { DatabaseSync } = await (0, eval)('import("node:sqlite")') as typeof import('node:sqlite')
      readOnlyLedger = new DatabaseSync(COORDINATION_DB_FILE, { readOnly: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/node:sqlite|No such built-in module|Cannot find/i.test(message)) throw err
      const { Database } = await (0, eval)('import("bun:sqlite")') as { Database: new (file: string, options?: { readonly?: boolean }) => LedgerDatabase }
      readOnlyLedger = new Database(COORDINATION_DB_FILE, { readonly: true })
    }
    return readOnlyLedger
  } catch {
    return null
  }
}
