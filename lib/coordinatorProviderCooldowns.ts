import type { LedgerDatabase } from './coordinatorLedger'

export const PROVIDER_COOLDOWN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS protocol_provider_cooldowns (
    provider TEXT NOT NULL, provider_instance_id TEXT NOT NULL, retry_at TEXT,
    attempt_id TEXT NOT NULL, observed_at TEXT NOT NULL,
    PRIMARY KEY (provider, provider_instance_id)
  );
  CREATE TABLE IF NOT EXISTS protocol_cooldown_dispatches (
    run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, session_id TEXT NOT NULL, task_id TEXT, claim_generation INTEGER,
    provider TEXT NOT NULL, provider_instance_id TEXT NOT NULL,
    message TEXT NOT NULL, options_json TEXT NOT NULL,
    PRIMARY KEY (run_id, agent_id)
  );
`

export type ProviderCooldown = { provider: string; providerInstanceId: string; retryAt: string | null; attemptId: string; observedAt: string; resetKnown: boolean; active: boolean }

/** Only the native dispatcher calls this with a ledger-authenticated account binding. */
export function recordProviderCooldown(db: LedgerDatabase, attempt: { id: string; provider: string; provider_instance_id: string }, retryAt?: string) {
  const valid = retryAt && Number.isFinite(Date.parse(retryAt)) ? new Date(retryAt).toISOString() : null
  db.prepare(`INSERT INTO protocol_provider_cooldowns (provider, provider_instance_id, retry_at, attempt_id, observed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_instance_id) DO UPDATE SET
      retry_at = CASE WHEN excluded.retry_at IS NULL THEN protocol_provider_cooldowns.retry_at WHEN protocol_provider_cooldowns.retry_at IS NULL THEN excluded.retry_at ELSE MAX(excluded.retry_at, protocol_provider_cooldowns.retry_at) END,
      attempt_id = CASE WHEN protocol_provider_cooldowns.retry_at IS NULL OR excluded.retry_at > protocol_provider_cooldowns.retry_at THEN excluded.attempt_id ELSE protocol_provider_cooldowns.attempt_id END,
      observed_at = CASE WHEN protocol_provider_cooldowns.retry_at IS NULL OR excluded.retry_at > protocol_provider_cooldowns.retry_at THEN excluded.observed_at ELSE protocol_provider_cooldowns.observed_at END`)
    .run(attempt.provider, attempt.provider_instance_id, valid, attempt.id, new Date().toISOString())
}

export function readProviderCooldown(db: LedgerDatabase, provider: string, instance: string, now = Date.now()): ProviderCooldown | undefined {
  const row = db.prepare('SELECT * FROM protocol_provider_cooldowns WHERE provider = ? AND provider_instance_id = ?').get(provider, instance)
  if (!row) return undefined
  return { provider, providerInstanceId: instance, retryAt: row.retry_at ?? null, attemptId: row.attempt_id, observedAt: row.observed_at,
    resetKnown: row.retry_at !== null, active: row.retry_at !== null && Date.parse(row.retry_at) > now }
}

export type DeferredDispatch = { runId: string; agentId: string; sessionId: string; taskId: string | null; claimGeneration: number | null; provider: string; providerInstanceId: string; message: string; options: { permissionMode?: 'plan'; inboxMessageIds?: string[] } }

export function deferCooldownDispatch(db: LedgerDatabase, dispatch: DeferredDispatch): boolean {
  const existing = db.prepare('SELECT * FROM protocol_cooldown_dispatches WHERE run_id = ? AND agent_id = ?').get(dispatch.runId, dispatch.agentId)
  if (existing && existing.session_id === dispatch.sessionId && existing.task_id === dispatch.taskId && existing.claim_generation === dispatch.claimGeneration
    && existing.provider === dispatch.provider && existing.provider_instance_id === dispatch.providerInstanceId) return false
  db.prepare(`INSERT OR REPLACE INTO protocol_cooldown_dispatches
    (run_id, agent_id, session_id, task_id, claim_generation, provider, provider_instance_id, message, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(dispatch.runId, dispatch.agentId, dispatch.sessionId, dispatch.taskId, dispatch.claimGeneration, dispatch.provider, dispatch.providerInstanceId, dispatch.message, JSON.stringify(dispatch.options))
  return true
}

export function readCooldownDispatches(db: LedgerDatabase, runId: string): DeferredDispatch[] {
  return db.prepare('SELECT * FROM protocol_cooldown_dispatches WHERE run_id = ?').all(runId).map((row: Record<string, any>) => ({
    runId, agentId: row.agent_id, sessionId: row.session_id, taskId: row.task_id, claimGeneration: row.claim_generation,
    provider: row.provider, providerInstanceId: row.provider_instance_id, message: row.message, options: JSON.parse(row.options_json),
  }))
}
