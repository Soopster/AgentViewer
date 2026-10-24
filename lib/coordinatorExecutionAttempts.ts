import { randomUUID } from 'node:crypto'
import type { LedgerDatabase } from './coordinatorLedger'
import type { AgentProvider } from './types'
import { isAgentProvider } from './provider'
import { recordProviderCooldown } from './coordinatorProviderCooldowns'

export type ExecutionAttemptState = 'prepared' | 'submitted' | 'settled' | 'rejected' | 'uncertain' | 'reconciled'
export type ExecutionAttempt = {
  id: string; runId: string; agentId: string; taskId: string | null
  sessionId: string; provider: string; providerInstanceId: string
  claimGeneration: number | null; state: ExecutionAttemptState
  createdAt: string; updatedAt: string; failureClass: string | null
  detail: string | null; retryAt: string | null
}

export const EXECUTION_ATTEMPT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS protocol_execution_attempts (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, task_id TEXT, session_id TEXT NOT NULL,
    provider TEXT NOT NULL, provider_instance_id TEXT NOT NULL, claim_generation INTEGER,
    state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    failure_class TEXT, detail TEXT, retry_at TEXT
  );
  CREATE INDEX IF NOT EXISTS protocol_attempt_agent_idx ON protocol_execution_attempts(run_id, agent_id, created_at);
  CREATE TABLE IF NOT EXISTS protocol_execution_configs (
    run_id TEXT PRIMARY KEY REFERENCES protocol_runs(id) ON DELETE CASCADE,
    settings_json TEXT NOT NULL
  );
`

export type ExecutionSettings = { teammateProviders: AgentProvider[]; model?: string; effort?: string; executionStarted?: boolean; modelSource?: { provider: AgentProvider; providerInstanceId: string } }

export function saveExecutionSettings(db: LedgerDatabase, runId: string, settings: ExecutionSettings): void {
  db.prepare('INSERT OR REPLACE INTO protocol_execution_configs (run_id, settings_json) VALUES (?, ?)').run(runId, JSON.stringify(settings))
}

export function readExecutionSettings(db: LedgerDatabase, runId: string): ExecutionSettings | undefined {
  const row = db.prepare('SELECT settings_json FROM protocol_execution_configs WHERE run_id = ?').get(runId)
  if (!row) return undefined
  const settings = JSON.parse(row.settings_json) as ExecutionSettings
  if (!Array.isArray(settings.teammateProviders) || !settings.teammateProviders.length || !settings.teammateProviders.every(isAgentProvider)
    || (settings.model !== undefined && typeof settings.model !== 'string') || (settings.effort !== undefined && typeof settings.effort !== 'string')
    || (settings.executionStarted !== undefined && typeof settings.executionStarted !== 'boolean')
    || (settings.modelSource && (!isAgentProvider(settings.modelSource.provider) || typeof settings.modelSource.providerInstanceId !== 'string' || !settings.modelSource.providerInstanceId))) throw new Error('Saved execution settings are invalid; inspect the run before recovery')
  return settings
}

export function beginExecutionAttempt(db: LedgerDatabase, binding: Pick<ExecutionAttempt, 'runId' | 'agentId' | 'taskId' | 'sessionId' | 'provider' | 'providerInstanceId' | 'claimGeneration'>): string {
  const id = randomUUID()
  const ts = new Date().toISOString()
  db.prepare(`INSERT INTO protocol_execution_attempts
    (id, run_id, agent_id, task_id, session_id, provider, provider_instance_id, claim_generation, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`).run(id, binding.runId, binding.agentId, binding.taskId, binding.sessionId, binding.provider, binding.providerInstanceId, binding.claimGeneration, ts, ts)
  return id
}

export function updateExecutionAttempt(db: LedgerDatabase, id: string, state: ExecutionAttemptState, failure?: { kind: string; detail: string; retryAt?: string }): void {
  db.exec('SAVEPOINT coordinator_attempt_state')
  try {
    const updated = db.prepare(`UPDATE protocol_execution_attempts SET state = ?, updated_at = ?, failure_class = ?, detail = ?, retry_at = ? WHERE id = ? AND state NOT IN ('settled', 'rejected', 'reconciled')`)
      .run(state, new Date().toISOString(), failure?.kind ?? null, failure?.detail.slice(0, 1200) ?? null, failure?.retryAt ?? null, id)
    if (updated.changes && failure?.kind === 'rate_limited') {
      const attempt = db.prepare('SELECT id, provider, provider_instance_id FROM protocol_execution_attempts WHERE id = ?').get(id)
      if (attempt) recordProviderCooldown(db, attempt, failure.retryAt)
    }
    db.exec('RELEASE coordinator_attempt_state')
  } catch (error) {
    db.exec('ROLLBACK TO coordinator_attempt_state')
    db.exec('RELEASE coordinator_attempt_state')
    throw error
  }
}

export function unresolvedExecutionAttempt(db: LedgerDatabase, runId: string, agentId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM protocol_execution_attempts WHERE run_id = ? AND agent_id = ? AND state IN ('prepared', 'submitted', 'uncertain') LIMIT 1").get(runId, agentId))
}

/** Explicit, gated recovery retires observation uncertainty without claiming completion. */
export function reconcileExecutionAttempts(db: LedgerDatabase, runId: string, agentId: string): void {
  db.prepare("UPDATE protocol_execution_attempts SET state = 'reconciled', updated_at = ? WHERE run_id = ? AND agent_id = ? AND state IN ('prepared', 'submitted', 'uncertain')")
    .run(new Date().toISOString(), runId, agentId)
}

export function readExecutionAttempts(db: LedgerDatabase, runId: string, agentId: string): ExecutionAttempt[] {
  return db.prepare('SELECT * FROM protocol_execution_attempts WHERE run_id = ? AND agent_id = ? ORDER BY rowid DESC LIMIT 10').all(runId, agentId).map((row: Record<string, unknown>) => ({
    id: String(row.id), runId: String(row.run_id), agentId: String(row.agent_id), taskId: row.task_id === null ? null : String(row.task_id),
    sessionId: String(row.session_id), provider: String(row.provider), providerInstanceId: String(row.provider_instance_id),
    claimGeneration: row.claim_generation === null ? null : Number(row.claim_generation), state: row.state as ExecutionAttemptState,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), failureClass: row.failure_class === null ? null : String(row.failure_class),
    detail: row.detail === null ? null : String(row.detail), retryAt: row.retry_at === null ? null : String(row.retry_at),
  }))
}

export function executionCooldown(attempts: ExecutionAttempt[], binding: { sessionId: string; provider: string; providerInstanceId?: string; taskId?: string | null }, now = Date.now()) {
  const latest = attempts.find(attempt => attempt.sessionId === binding.sessionId && attempt.provider === binding.provider
    && attempt.providerInstanceId === (binding.providerInstanceId ?? binding.provider) && attempt.taskId === (binding.taskId ?? null))
  if (!latest || latest.failureClass !== 'rate_limited') return null
  return { attemptId: latest.id, retryAt: latest.retryAt, resetKnown: latest.retryAt !== null,
    active: latest.retryAt !== null && Date.parse(latest.retryAt) > now }
}

/** Only explicit provider Retry-After evidence is accepted; never guess from prose. */
export function providerRetryAt(value: string | null, now = Date.now()): string | undefined {
  if (!value?.trim()) return undefined
  const text = value.trim()
  const milliseconds = /^\d+(?:\.\d+)?$/.test(text) ? now + Number(text) * 1000 : Date.parse(text)
  return Number.isFinite(milliseconds) && milliseconds >= now && milliseconds <= 8.64e15 ? new Date(milliseconds).toISOString() : undefined
}
