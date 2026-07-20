// Coordinator for AVP/2 multi-agent runs, modeled on Claude Code agent teams:
// a LEAD session decomposes the prompt into a shared task list, named
// TEAMMATES (each in an isolated git worktree) self-claim tasks and work a
// continuous loop (claim → work → complete → claim next), a MAILBOX carries
// direct messages between agents (steered live into a running turn when
// possible), path LOCKS keep writers from overlapping, and the lead
// synthesizes everything into a run summary at the end.
//
// The ledger lives in SQLite (shared with the web API routes); the work loop
// (turn dispatch, message delivery, completion gating) runs in the process
// that started the run — the same process-local model as the running-turn
// registry.

import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  AGENT_PROTOCOL_VERSION,
  EXTERNAL_COORD_PROTOCOL_VERSION,
  MIN_EXTERNAL_COORD_PROTOCOL_VERSION,
  buildLeadInterventionPreamble,
  buildLeadPlanPreamble,
  buildLeadSynthesisPreamble,
  buildTeammatePlanPreamble,
  buildTeammateTurnPreamble,
  fallbackTaskTemplates,
  interpolatePlaybookText,
  isValidPlaybookName,
  parseAgentProtocolEvents,
  parseRunPlaybook,
  playbookExpectsArgs,
  type AgentProtocolEvent,
  type CreateExternalProtocolRunParams,
  type ExternalProtocolActionable,
  type ExternalProtocolCapabilities,
  type ExternalProtocolClient,
  type ExternalProtocolClaimResult,
  type ExternalProtocolCompletionResult,
  type ExternalProtocolIdentity,
  type ExternalProtocolInboxResult,
  type ExternalProtocolLockResult,
  type ExternalProtocolMutationResult,
  type ExternalProtocolParticipant,
  type ExternalProtocolParticipantResult,
  type ExternalProtocolReleaseResult,
  type ExternalProtocolStatusResult,
  type ExternalProtocolWaitResult,
  type JoinExternalProtocolRunParams,
  type PlaybookSummary,
  type ProtocolAgent,
  type ProtocolAgentStatus,
  type ProtocolLock,
  type ProtocolLockStatus,
  type ProtocolMessage,
  type ProtocolMessageKind,
  type ProtocolMessagePriority,
  type ProtocolFailureClass,
  type ProtocolPhaseRollup,
  type ProtocolRun,
  type ProtocolRunSnapshot,
  type ProtocolRunStatus,
  type ProtocolTask,
  type ProtocolTaskStatus,
  type ProtocolWorktreeCleanupResult,
  type RunPlaybook,
  type StartProtocolRunParams,
  type StartProtocolRunResult,
} from './agentProtocol'
import { createNewViewSession, streamViewSessionTurn } from './sessionBackend'
import { getRunningSessionInfo, interruptRunningSession, steerRunningSession } from './sessionRuntime'
import { createWorktreeTask, findRepoRoot, findWorktreeTaskForCwd, removeWorktreeTask, type WorktreeTask } from './worktreeTasks'

type SqliteDatabase = any
type Row = Record<string, unknown>

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination')
const DB_FILE = path.join(DATA_DIR, 'coordination.sqlite')
const LOCK_LEASE_MS = 20 * 60_000
const SCHEMA_VERSION = 10
const EVENT_WINDOW = 300
const LOCK_HISTORY_WINDOW = 200
const EXTERNAL_AGENT_STALE_MS = Math.max(60_000, Number(process.env.AGENT_VIEWER_COORD_STALE_MS) || 5 * 60_000)
const MAIL_SWEEP_INTERVAL_MS = 5_000
const REPLY_ESCALATION_MS = 3 * 60_000
const STATUS_BATCH_THRESHOLD = 3
const STATUS_BATCH_MAX_WAIT_MS = 15_000
// One automatic re-dispatch when a teammate's turn ends mid-task; after that
// the teammate is marked blocked and the lead is notified (doc: teammates may
// stop on errors; the lead/user nudges or replaces them).
const MAX_TURN_NUDGES = 1
// Mid-run lead intervention turns (woken by teammate messages / stuck tasks).
// Bounded so a stuck teammate ↔ lead exchange can't ping-pong tokens forever;
// once exhausted, stuck tasks are auto-failed so the run reaches synthesis.
const MAX_LEAD_INTERVENTIONS = 3
const TEAMMATE_NAMES = ['nova', 'orion', 'lyra', 'vega', 'atlas', 'rhea', 'iris', 'flint'] as const

let database: SqliteDatabase | null = null
let databaseOpenPromise: Promise<SqliteDatabase> | null = null
let writeQueue: Promise<unknown> = Promise.resolve()

// Per-run work-loop state. Only exists in the process that started the run.
type RunController = {
  runId: string
  prompt: string
  provider: ProtocolRun['provider']
  teammateProviders: ProtocolRun['provider'][]
  baseCwd: string
  maxAgents: number
  title?: string
  model?: string
  effort?: string
  gateCommand?: string
  requirePlanApproval: boolean
  useWorktrees: boolean
  stopped: boolean
  synthesisStarted: boolean
  interventionsUsed: number
  turnInFlight: Set<string>
  /** agentId → latest (realized) session id for steering/interrupting. */
  sessionIds: Map<string, string>
  /** agentId → session still pending its first turn. */
  pendingSessions: Set<string>
  /** `${agentId}:${taskId}` → nudges used. */
  nudges: Map<string, number>
  /** agentId → coordinator note to prepend to the next dispatched turn. */
  dispatchNotes: Map<string, string>
}

const controllers = new Map<string, RunController>()

// In-process change signal so coord_wait wakes in milliseconds instead of on
// its fallback poll. All ledger writes flow through this process (web routes,
// MCP bridge HTTP, internal work loop), so an emitter is sufficient; the
// fallback poll in waitForExternalProtocolChange covers anything missed.
const runNotifier = new EventEmitter()
runNotifier.setMaxListeners(0)

function notifyRunChanged(runId: string): void {
  runNotifier.emit(`run:${runId}`)
}

function waitForRunSignal(runId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const key = `run:${runId}`
    const done = () => {
      clearTimeout(timer)
      runNotifier.off(key, done)
      resolve()
    }
    const timer = setTimeout(done, Math.max(1, ms))
    timer.unref?.()
    runNotifier.on(key, done)
  })
}

function nowIso(): string {
  return new Date().toISOString()
}

function leaseIso(ms = LOCK_LEASE_MS): string {
  return new Date(Date.now() + ms).toISOString()
}

async function ensureDirs(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

function configureDatabase(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
  `)
}

function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocol_runs (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      base_cwd TEXT NOT NULL,
      max_agents INTEGER NOT NULL,
      lead_agent_id TEXT,
      summary TEXT,
      gate_command TEXT,
      require_plan_approval INTEGER NOT NULL DEFAULT 0,
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocol_agents (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'teammate',
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      worktree_branch TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      last_seen_at TEXT,
      client_name TEXT,
      client_version TEXT,
      protocol_version INTEGER NOT NULL DEFAULT 1,
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, id)
    );

    CREATE INDEX IF NOT EXISTS protocol_agents_run_idx ON protocol_agents(run_id);
    CREATE INDEX IF NOT EXISTS protocol_agents_session_idx ON protocol_agents(session_id);

    CREATE TABLE IF NOT EXISTS protocol_tasks (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_agent_id TEXT,
      paths_json TEXT NOT NULL,
      blocked_by_json TEXT NOT NULL,
      phase TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, id)
    );

    CREATE INDEX IF NOT EXISTS protocol_tasks_run_idx ON protocol_tasks(run_id);

    CREATE TABLE IF NOT EXISTS protocol_locks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      path TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS protocol_locks_run_idx ON protocol_locks(run_id);
    CREATE INDEX IF NOT EXISTS protocol_locks_agent_idx ON protocol_locks(agent_id);

    CREATE TABLE IF NOT EXISTS protocol_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      task_id TEXT,
      lock_id TEXT,
      summary TEXT,
      detail TEXT,
      paths_json TEXT NOT NULL,
      payload_json TEXT,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS protocol_events_run_idx ON protocol_events(run_id, created_at);

    CREATE TABLE IF NOT EXISTS protocol_messages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'request',
      priority TEXT NOT NULL DEFAULT 'normal',
      reply_required INTEGER NOT NULL DEFAULT 0,
      correlation_id TEXT,
      in_reply_to TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      resolved_at TEXT,
      escalated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS protocol_messages_run_idx ON protocol_messages(run_id, to_agent_id, delivered_at);

    CREATE TABLE IF NOT EXISTS protocol_participant_tokens (
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS protocol_task_baselines (
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, task_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS protocol_idempotency (
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      request_id TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, agent_id, action, request_id)
    );
  `)
  migrateSchema(db)
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
}

// v1 → v2: named agents with roles, lead + summary on runs, mailbox table
// (created above with IF NOT EXISTS). ALTERs are individually guarded so a
// partially migrated database converges.
// v2 → v3: task/agent ids are per-run (`task-1`, `lead`, `agent-1` repeat in
// every run) — the original single-column PRIMARY KEYs made every run after
// the first collide with UNIQUE constraint failures. Rebuild those tables
// with composite (run_id, id) keys.
// v3 → v4: persist run-level day-to-day guardrails (completion gate and plan
// approval) so snapshots and resumed UI panels show the actual run settings.
// v4 → v5: capability tokens let independently launched CLI processes bind
// to one registered agent identity without accepting caller-supplied ids.
// v5 → v6: claim-time worktree baselines and mutation idempotency make
// external supervisors safe to resume after dirty checkouts or transport loss.
// v6 → v7: playbook runs — tasks carry a phase label for barrier grouping and
// workflow-style progress rollups.
// v7 → v8: external client negotiation/capabilities plus typed mailbox intent,
// correlations, reply requirements, and resolution state.
// v8 → v9: persist whether locally managed teammates use isolated worktrees
// or intentionally share the run checkout.
// v9 → v10: track when a stale reply-required message was escalated, so the
// mailbox sweep nudges a silent recipient (and the lead) exactly once.
function migrateSchema(db: SqliteDatabase): void {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as Row | undefined
  const version = row ? Number(row.value) || 0 : 0
  if (version >= SCHEMA_VERSION) return
  const alters = [
    "ALTER TABLE protocol_agents ADD COLUMN name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE protocol_agents ADD COLUMN role TEXT NOT NULL DEFAULT 'teammate'",
    'ALTER TABLE protocol_runs ADD COLUMN lead_agent_id TEXT',
    'ALTER TABLE protocol_runs ADD COLUMN summary TEXT',
    'ALTER TABLE protocol_runs ADD COLUMN gate_command TEXT',
    'ALTER TABLE protocol_runs ADD COLUMN require_plan_approval INTEGER NOT NULL DEFAULT 0',
  ]
  for (const statement of alters) {
    try {
      db.exec(statement)
    } catch {
      // column already exists
    }
  }
  rebuildForCompositeKeys(db)
  // v7 additions run after the composite-key rebuild so pre-v3 databases get
  // the column on the rebuilt table rather than losing it in the copy.
  try {
    db.exec('ALTER TABLE protocol_tasks ADD COLUMN phase TEXT')
  } catch {
    // column already exists
  }
  const v8Alters = [
    'ALTER TABLE protocol_agents ADD COLUMN client_name TEXT',
    'ALTER TABLE protocol_agents ADD COLUMN client_version TEXT',
    'ALTER TABLE protocol_agents ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1',
    "ALTER TABLE protocol_agents ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE protocol_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'request'",
    "ALTER TABLE protocol_messages ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
    'ALTER TABLE protocol_messages ADD COLUMN reply_required INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE protocol_messages ADD COLUMN correlation_id TEXT',
    'ALTER TABLE protocol_messages ADD COLUMN in_reply_to TEXT',
    'ALTER TABLE protocol_messages ADD COLUMN resolved_at TEXT',
  ]
  for (const statement of v8Alters) {
    try {
      db.exec(statement)
    } catch {
      // column already exists
    }
  }
  try {
    db.exec('ALTER TABLE protocol_runs ADD COLUMN use_worktrees INTEGER NOT NULL DEFAULT 1')
  } catch {
    // column already exists
  }
  try {
    db.exec('ALTER TABLE protocol_messages ADD COLUMN escalated_at TEXT')
  } catch {
    // column already exists
  }
}

function hasSingleColumnPk(db: SqliteDatabase, table: string): boolean {
  const rows = db.prepare(`SELECT pk FROM pragma_table_info('${table}') WHERE pk > 0`).all() as Row[]
  return rows.length === 1
}

function rebuildForCompositeKeys(db: SqliteDatabase): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (hasSingleColumnPk(db, 'protocol_agents')) {
      db.exec(`
        CREATE TABLE protocol_agents_v3 (
          id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'teammate',
          provider TEXT NOT NULL,
          session_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          worktree_branch TEXT NOT NULL,
          task_id TEXT,
          status TEXT NOT NULL,
          last_seen_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (run_id, id)
        );
        INSERT OR IGNORE INTO protocol_agents_v3 (
          id, run_id, name, role, provider, session_id, worktree_path, worktree_branch,
          task_id, status, last_seen_at, created_at, updated_at
        ) SELECT
          id, run_id, name, role, provider, session_id, worktree_path, worktree_branch,
          task_id, status, last_seen_at, created_at, updated_at
        FROM protocol_agents;
        DROP TABLE protocol_agents;
        ALTER TABLE protocol_agents_v3 RENAME TO protocol_agents;
        CREATE INDEX IF NOT EXISTS protocol_agents_run_idx ON protocol_agents(run_id);
        CREATE INDEX IF NOT EXISTS protocol_agents_session_idx ON protocol_agents(session_id);
      `)
    }
    if (hasSingleColumnPk(db, 'protocol_tasks')) {
      db.exec(`
        CREATE TABLE protocol_tasks_v3 (
          id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL,
          owner_agent_id TEXT,
          paths_json TEXT NOT NULL,
          blocked_by_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (run_id, id)
        );
        INSERT OR IGNORE INTO protocol_tasks_v3 (
          id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at
        ) SELECT
          id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at
        FROM protocol_tasks;
        DROP TABLE protocol_tasks;
        ALTER TABLE protocol_tasks_v3 RENAME TO protocol_tasks;
        CREATE INDEX IF NOT EXISTS protocol_tasks_run_idx ON protocol_tasks(run_id);
      `)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

async function openDatabase(): Promise<SqliteDatabase> {
  let DatabaseCtor: new (file: string) => SqliteDatabase
  try {
    const sqliteMod = await (0, eval)('import("node:sqlite")') as typeof import('node:sqlite')
    DatabaseCtor = sqliteMod.DatabaseSync as new (file: string) => SqliteDatabase
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/node:sqlite|No such built-in module|Cannot find/i.test(message)) throw err
    const bunSqlite = await (0, eval)('import("bun:sqlite")') as { Database: new (file: string) => SqliteDatabase }
    DatabaseCtor = bunSqlite.Database
  }
  await ensureDirs()
  const db = new DatabaseCtor(DB_FILE)
  try {
    configureDatabase(db)
    initializeSchema(db)
    pruneExpiredRunsSync(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

// Terminal runs older than the retention window are pruned when the ledger
// opens; FK cascades clean their events, tasks, agents, tokens, messages,
// locks, baselines, and idempotency rows, so long-lived daemons and heavy
// playbook reuse can't grow coordination.sqlite forever.
const RUN_RETENTION_MS = Math.max(1, Number(process.env.AGENT_VIEWER_COORD_RETENTION_DAYS) || 14) * 86_400_000

function pruneExpiredRunsSync(db: SqliteDatabase): void {
  try {
    const cutoff = new Date(Date.now() - RUN_RETENTION_MS).toISOString()
    db.prepare("DELETE FROM protocol_runs WHERE status IN ('completed', 'failed', 'stopped') AND updated_at < ?").run(cutoff)
  } catch {
    // Best-effort: a partially migrated schema must not block opening.
  }
}

async function getDatabase(): Promise<SqliteDatabase> {
  if (database) return database
  if (!databaseOpenPromise) {
    databaseOpenPromise = openDatabase().then((db) => {
      database = db
      return db
    }).catch((err) => {
      databaseOpenPromise = null
      throw err
    })
  }
  return databaseOpenPromise
}

async function enqueueWrite<T>(fn: (db: SqliteDatabase) => T | Promise<T>): Promise<T> {
  const run = async () => fn(await getDatabase())
  const next = writeQueue.then(run, run)
  writeQueue = next.catch(() => undefined)
  return next
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : undefined
  } catch {
    return undefined
  }
}

function rowToRun(row: Row): ProtocolRun {
  return {
    id: String(row.id),
    prompt: String(row.prompt),
    status: String(row.status) as ProtocolRunStatus,
    provider: String(row.provider) as ProtocolRun['provider'],
    baseCwd: String(row.base_cwd),
    maxAgents: Number(row.max_agents) || 1,
    leadAgentId: typeof row.lead_agent_id === 'string' ? row.lead_agent_id : undefined,
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    gateCommand: typeof row.gate_command === 'string' && row.gate_command ? row.gate_command : undefined,
    requirePlanApproval: Boolean(Number(row.require_plan_approval ?? 0)),
    useWorktrees: row.use_worktrees == null ? true : Boolean(Number(row.use_worktrees)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToAgent(row: Row): ProtocolAgent {
  const protocolVersion = Number(row.protocol_version) || MIN_EXTERNAL_COORD_PROTOCOL_VERSION
  const capabilities = parseJsonObject<ExternalProtocolCapabilities>(row.capabilities_json)
  return {
    id: String(row.id),
    runId: String(row.run_id),
    name: typeof row.name === 'string' && row.name ? row.name : String(row.id),
    role: row.role === 'lead' ? 'lead' : 'teammate',
    provider: String(row.provider) as ProtocolAgent['provider'],
    sessionId: String(row.session_id),
    worktreePath: String(row.worktree_path),
    worktreeBranch: String(row.worktree_branch),
    taskId: typeof row.task_id === 'string' ? row.task_id : undefined,
    status: String(row.status) as ProtocolAgentStatus,
    lastSeenAt: typeof row.last_seen_at === 'string' ? row.last_seen_at : undefined,
    client: typeof row.client_name === 'string' && row.client_name
      ? {
          name: row.client_name,
          version: typeof row.client_version === 'string' && row.client_version ? row.client_version : undefined,
          protocolVersion,
        }
      : undefined,
    capabilities,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToTask(row: Row): ProtocolTask {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    title: String(row.title),
    prompt: String(row.prompt),
    status: String(row.status) as ProtocolTaskStatus,
    ownerAgentId: typeof row.owner_agent_id === 'string' ? row.owner_agent_id : undefined,
    paths: parseJsonArray(row.paths_json),
    blockedBy: parseJsonArray(row.blocked_by_json),
    phase: typeof row.phase === 'string' && row.phase ? row.phase : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToLock(row: Row): ProtocolLock {
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

function rowToMessage(row: Row): ProtocolMessage {
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

function rowToEvent(row: Row): AgentProtocolEvent {
  const payload = typeof row.payload_json === 'string'
    ? (() => { try { return JSON.parse(row.payload_json) as Record<string, unknown> } catch { return undefined } })()
    : undefined
  return {
    version: AGENT_PROTOCOL_VERSION,
    runId: String(row.run_id),
    agentId: String(row.agent_id),
    type: String(row.type) as AgentProtocolEvent['type'],
    taskId: typeof row.task_id === 'string' ? row.task_id : undefined,
    lockId: typeof row.lock_id === 'string' ? row.lock_id : undefined,
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    detail: typeof row.detail === 'string' ? row.detail : undefined,
    paths: parseJsonArray(row.paths_json),
    payload,
    timestamp: String(row.timestamp),
  }
}

/**
 * Mark agents whose turn is streaming right now. Best-effort and process-local
 * (like the running-turn registry itself): accurate in the process that runs
 * the work loop, which is where web routes and the in-process TUI read from.
 */
function annotateLiveTurns(runId: string, agents: ProtocolAgent[]): ProtocolAgent[] {
  const controller = controllers.get(runId)
  return agents.map((agent) => {
    const sessionId = controller?.sessionIds.get(agent.id) ?? agent.sessionId
    const turnActive = controller?.turnInFlight.has(agent.id) === true
      || getRunningSessionInfo(sessionId).running
    return turnActive ? { ...agent, turnActive } : agent
  })
}

function readSnapshotSync(db: SqliteDatabase, runId: string): ProtocolRunSnapshot | null {
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) return null
  const agents = annotateLiveTurns(runId, db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? ORDER BY created_at ASC').all(runId).map(rowToAgent))
  const tasks = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? ORDER BY created_at ASC').all(runId).map(rowToTask)
  const activeLocks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND status = 'active' AND lease_expires_at > ? ORDER BY created_at ASC")
    .all(runId, nowIso()) as Row[]).map(rowToLock)
  const recentInactiveLocks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND status != 'active' ORDER BY created_at DESC LIMIT ?")
    .all(runId, LOCK_HISTORY_WINDOW) as Row[]).map(rowToLock).reverse()
  const locks = [...recentInactiveLocks, ...activeLocks]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const messages = db.prepare('SELECT * FROM protocol_messages WHERE run_id = ? ORDER BY created_at ASC LIMIT 200').all(runId).map(rowToMessage)
  // Latest window, chronological — an active run must show its NEWEST events.
  const events = (db.prepare('SELECT * FROM protocol_events WHERE run_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(runId, EVENT_WINDOW) as Row[]).map(rowToEvent).reverse()
  return { run: rowToRun(runRow), agents, tasks, locks, messages, events }
}

export async function readProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  const db = await getDatabase()
  return readSnapshotSync(db, runId)
}

export async function listProtocolRuns(limit = 20): Promise<ProtocolRun[]> {
  const db = await getDatabase()
  const rows = db.prepare('SELECT * FROM protocol_runs ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(limit, 100))) as Row[]
  return rows.map(rowToRun)
}

// ---------------------------------------------------------------------------
// External CLI participants

function normalizeParticipantName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('participant name is required')
  if (name.length > 80) throw new Error('participant name must be 80 characters or fewer')
  return name
}

function negotiateExternalClient(
  client: ExternalProtocolClient | undefined,
  capabilities: ExternalProtocolCapabilities | undefined,
): { client: ExternalProtocolClient; capabilities: ExternalProtocolCapabilities } {
  const protocolVersion = client?.protocolVersion ?? MIN_EXTERNAL_COORD_PROTOCOL_VERSION
  if (!Number.isInteger(protocolVersion) || protocolVersion < MIN_EXTERNAL_COORD_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Coordinator protocol version: ${protocolVersion}`)
  }
  if (protocolVersion > EXTERNAL_COORD_PROTOCOL_VERSION) {
    throw new Error(
      `Coordinator client protocol ${protocolVersion} is newer than server protocol ${EXTERNAL_COORD_PROTOCOL_VERSION}; upgrade Agent Viewer`,
    )
  }
  const tools = Array.isArray(capabilities?.tools)
    ? [...new Set(capabilities.tools.map((entry) => entry.trim()).filter(Boolean))].slice(0, 100)
    : undefined
  const maxParallelTasks = capabilities?.maxParallelTasks === undefined
    ? undefined
    : Math.max(1, Math.min(32, Math.trunc(capabilities.maxParallelTasks)))
  return {
    client: {
      name: client?.name.trim().slice(0, 80) || 'legacy-mcp-client',
      version: client?.version?.trim().slice(0, 80) || undefined,
      protocolVersion,
    },
    capabilities: JSON.parse(JSON.stringify({
      unattended: capabilities?.unattended === true || undefined,
      sessionResume: capabilities?.sessionResume === true || undefined,
      midTurnSteer: capabilities?.midTurnSteer === true || undefined,
      filesystemWrite: capabilities?.filesystemWrite === true || undefined,
      git: capabilities?.git === true || undefined,
      browser: capabilities?.browser === true || undefined,
      maxParallelTasks,
      tools,
    })) as ExternalProtocolCapabilities,
  }
}

function hashParticipantToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function participantTokenMatches(token: string, storedHex: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/i.test(storedHex)) return false
  const supplied = hashParticipantToken(token)
  const stored = Buffer.from(storedHex, 'hex')
  return supplied.length === stored.length && timingSafeEqual(supplied, stored)
}

function requireExternalParticipantSync(db: SqliteDatabase, identity: ExternalProtocolIdentity): ProtocolAgent {
  const tokenRow = db.prepare(
    'SELECT token_hash FROM protocol_participant_tokens WHERE run_id = ? AND agent_id = ?',
  ).get(identity.runId, identity.agentId) as Row | undefined
  if (!tokenRow || !participantTokenMatches(identity.token, String(tokenRow.token_hash ?? ''))) {
    throw new Error('Invalid Coordinator participant capability')
  }
  const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?')
    .get(identity.runId, identity.agentId) as Row | undefined
  if (!agentRow) throw new Error('Coordinator participant not found')
  return rowToAgent(agentRow)
}

// External responses ride MCP tool results into a model's context; a tighter
// event window than the UI's keeps every mutation response affordable.
const EXTERNAL_EVENT_WINDOW = 20

function statusMessageGroupKey(row: Row): string {
  return `${String(row.from_agent_id ?? '')}\0${String(row.correlation_id ?? '')}`
}

function readyStatusMessageGroups(rows: Row[], now = Date.now()): Set<string> {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    if (row.priority !== 'status' && row.kind !== 'status') continue
    const key = statusMessageGroupKey(row)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const ready = new Set<string>()
  for (const [key, group] of groups) {
    const oldest = group.reduce((value, row) => {
      const created = typeof row.created_at === 'string' ? new Date(row.created_at).getTime() : now
      return Math.min(value, created)
    }, Number.POSITIVE_INFINITY)
    if (group.length >= STATUS_BATCH_THRESHOLD || oldest <= now - STATUS_BATCH_MAX_WAIT_MS) ready.add(key)
  }
  return ready
}

function externalSnapshotSync(db: SqliteDatabase, runId: string, agentId: string): ProtocolRunSnapshot {
  const snapshot = readSnapshotSync(db, runId)
  if (!snapshot) throw new Error('Coordinator run not found')
  return {
    ...snapshot,
    // Mail is consumed through the cursor-aware inbox API. Repeating up to 200
    // historical bodies on every status/wait response made context scale with
    // run age without helping the next decision.
    messages: [],
    // Keep other agents' direct message text out of the shared event timeline.
    events: snapshot.events
      .filter((event) => event.type !== 'message' || event.agentId === agentId)
      .slice(-EXTERNAL_EVENT_WINDOW),
  }
}

function externalActionableSync(db: SqliteDatabase, runId: string, agentId: string): ExternalProtocolActionable {
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) throw new Error('Coordinator run not found')
  const run = rowToRun(runRow)
  const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?')
    .get(runId, agentId) as Row | undefined
  const agent = agentRow ? rowToAgent(agentRow) : null
  const tasks = listTasksSync(db, runId)
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const claimable = tasks.filter((task) => (
    task.status === 'pending' && !task.ownerAgentId && taskDepsCompleted(task, tasksById)
  ))
  const mailbox = db.prepare(`
    SELECT kind, priority, created_at, from_agent_id, correlation_id FROM protocol_messages
    WHERE run_id = ? AND to_agent_id = ? AND delivered_at IS NULL
  `).all(runId, agentId) as Row[]
  const statusRows = mailbox.filter((row) => row.priority === 'status' || row.kind === 'status')
  const ordinaryRows = mailbox.filter((row) => row.priority !== 'status' && row.kind !== 'status')
  const readyStatusGroups = readyStatusMessageGroups(mailbox)
  const replyRequiredCount = Number((db.prepare(`
    SELECT COUNT(*) AS n FROM protocol_messages
    WHERE run_id = ? AND to_agent_id = ? AND reply_required = 1 AND resolved_at IS NULL
  `).get(runId, agentId) as Row | undefined)?.n) || 0
  const myTaskRow = agent?.taskId ? tasksById.get(agent.taskId) : undefined
  return {
    runStatus: run.status,
    claimableTasks: claimable.map((task) => ({ id: task.id, title: task.title })),
    inboxCount: ordinaryRows.length + readyStatusGroups.size,
    urgentCount: ordinaryRows.filter((row) => row.priority === 'urgent').length,
    statusCount: statusRows.length,
    replyRequiredCount,
    plansAwaitingReview: agent?.role === 'lead'
      ? tasks.filter((task) => task.status === 'planned').map((task) => task.id)
      : [],
    myTask: myTaskRow
      ? { id: myTaskRow.id, status: myTaskRow.status, planState: taskPlanStateSync(db, runId, myTaskRow.id) }
      : null,
    allTasksTerminal: tasks.length > 0
      && tasks.every((task) => ['completed', 'failed', 'cancelled'].includes(task.status)),
  }
}

function externalParticipantInstructions(participant: ExternalProtocolParticipant): string {
  return [
    `You are ${participant.name} (${participant.role}) in Coordinator run ${participant.runId}.`,
    'Read the board before acting. Claim one unblocked task, request locks before editing, and stay inside the returned task paths.',
    'Use Coordinator tools for plans, messages, findings, blocking, completion, and heartbeats. Read your inbox between work steps.',
    `Work from ${participant.cwd}. If another participant uses the same checkout, coordinate non-overlapping paths before editing.`,
  ].join(' ')
}

async function participantWorktree(cwd: string): Promise<{ cwd: string; branch: string }> {
  const resolved = path.resolve(cwd.trim() || process.cwd())
  const worktree = await findWorktreeTaskForCwd(resolved).catch(() => null)
  return { cwd: worktree?.path ?? resolved, branch: worktree?.branch ?? '' }
}

function issueParticipant(
  db: SqliteDatabase,
  params: {
    runId: string
    name: string
    role: 'lead' | 'teammate'
    provider: ProtocolRun['provider']
    cwd: string
    branch: string
    agentId?: string
    client?: ExternalProtocolClient
    capabilities?: ExternalProtocolCapabilities
  },
): ExternalProtocolParticipant {
  const negotiated = negotiateExternalClient(params.client, params.capabilities)
  const agentId = params.agentId ?? `external-${randomUUID()}`
  const token = randomBytes(32).toString('base64url')
  const ts = nowIso()
  db.prepare(`
    INSERT INTO protocol_agents (
      id, run_id, name, role, provider, session_id, worktree_path, worktree_branch,
      task_id, status, last_seen_at, client_name, client_version, protocol_version,
      capabilities_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ready', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agentId,
    params.runId,
    params.name,
    params.role,
    params.provider,
    `external:${agentId}`,
    params.cwd,
    params.branch,
    ts,
    negotiated.client.name,
    negotiated.client.version ?? null,
    negotiated.client.protocolVersion,
    JSON.stringify(negotiated.capabilities),
    ts,
    ts,
  )
  db.prepare(`
    INSERT INTO protocol_participant_tokens (run_id, agent_id, token_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(params.runId, agentId, hashParticipantToken(token).toString('hex'), ts)
  insertEventSync(db, {
    version: AGENT_PROTOCOL_VERSION,
    runId: params.runId,
    agentId,
    type: 'agent.ready',
    summary: `${params.name} joined from an external ${params.provider} CLI`,
    timestamp: ts,
  })
  return {
    runId: params.runId,
    agentId,
    token,
    name: params.name,
    role: params.role,
    provider: params.provider,
    cwd: params.cwd,
    serverProtocolVersion: EXTERNAL_COORD_PROTOCOL_VERSION,
    negotiatedProtocolVersion: negotiated.client.protocolVersion,
    capabilities: negotiated.capabilities,
  }
}

/**
 * Seed the whole board from a playbook: tasks land phase by phase, every task
 * in phase N+1 blocked by every task in phase N (barrier), plus explicit
 * key-based dependencies. The plan is held by the artifact, not a lead turn.
 */
function seedPlaybookTasksSync(
  db: SqliteDatabase,
  runId: string,
  agentId: string,
  playbook: RunPlaybook,
  args: unknown,
): void {
  // Pre-assign every task id in insertion order so key references resolve
  // regardless of declaration order within a phase. (Later-phase references
  // are rejected at parse time — they would deadlock against the barrier.)
  const startCount = Number((db.prepare('SELECT COUNT(*) AS n FROM protocol_tasks WHERE run_id = ?').get(runId) as Row | undefined)?.n) || 0
  const keyToId = new Map<string, string>()
  let assigned = startCount
  for (const phase of playbook.phases) {
    for (const entry of phase.tasks) {
      assigned += 1
      if (entry.key) keyToId.set(entry.key, `task-${assigned}`)
    }
  }
  let previousPhaseIds: string[] = []
  for (const phase of playbook.phases) {
    const phaseIds: string[] = []
    for (const entry of phase.tasks) {
      const explicitDeps = (entry.dependsOn ?? []).map((key) => {
        const id = keyToId.get(key)
        if (!id) throw new Error(`playbook task "${entry.title}" depends on unknown key: ${key}`)
        return id
      })
      const task = insertTaskSync(db, runId, {
        title: interpolatePlaybookText(entry.title, args),
        prompt: interpolatePlaybookText(entry.detail, args),
        paths: (entry.paths ?? []).map((lockPath) => interpolatePlaybookText(lockPath, args)),
        blockedBy: [...new Set([...previousPhaseIds, ...explicitDeps])],
        phase: phase.title,
      })
      if (entry.key) keyToId.set(entry.key, task.id)
      phaseIds.push(task.id)
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId,
        type: 'task.created',
        taskId: task.id,
        title: task.title,
        detail: task.prompt,
        paths: task.paths,
        dependsOn: task.blockedBy,
        payload: { phase: phase.title, playbook: playbook.name },
      })
    }
    previousPhaseIds = phaseIds
  }
}

export async function createExternalProtocolRun(
  params: CreateExternalProtocolRunParams,
): Promise<ExternalProtocolParticipantResult> {
  const prompt = params.prompt.trim()
  if (!prompt) throw new Error('prompt is required')
  const name = normalizeParticipantName(params.participantName)
  const worktree = await participantWorktree(params.baseCwd)
  const playbook = params.playbook
  if (playbook && params.playbookArgs === undefined && playbookExpectsArgs(playbook)) {
    throw new Error(
      `Playbook "${playbook.name}" expects args (${playbook.argsHint ?? 'see the {{args}} placeholders in its task text'}) — pass args when creating the run`,
    )
  }
  const runId = randomUUID()
  const ts = nowIso()
  const result = await enqueueWrite((db) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const agentId = `external-${randomUUID()}`
      db.prepare(`
        INSERT INTO protocol_runs (
          id, prompt, status, provider, base_cwd, max_agents, lead_agent_id, summary,
          gate_command, require_plan_approval, created_at, updated_at
        ) VALUES (?, ?, 'running', ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(
        runId,
        prompt,
        params.provider,
        worktree.cwd,
        Math.max(2, Math.min(params.maxAgents ?? playbook?.maxAgents ?? 6, 16)),
        agentId,
        (params.gateCommand ?? playbook?.gateCommand)?.trim() || null,
        (params.requirePlanApproval ?? playbook?.requirePlanApproval) === true ? 1 : 0,
        ts,
        ts,
      )
      const participant = issueParticipant(db, {
        runId,
        agentId,
        name,
        role: 'lead',
        provider: params.provider,
        cwd: worktree.cwd,
        branch: worktree.branch,
        client: params.client,
        capabilities: params.capabilities,
      })
      if (playbook) seedPlaybookTasksSync(db, runId, agentId, playbook, params.playbookArgs)
      db.exec('COMMIT')
      return { participant, snapshot: externalSnapshotSync(db, runId, participant.agentId) }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(runId)
  return { ...result, instructions: externalParticipantInstructions(result.participant) }
}

/**
 * Discovery for "join the coordinator run" without a pasted id: newest
 * joinable run (live, with capacity), preferring one whose base checkout
 * contains — or is contained by — the joiner's cwd or repo root, so a second
 * terminal in the same project lands in that project's run.
 */
function resolveJoinableExternalRunSync(db: SqliteDatabase, joinerPaths: string[]): ProtocolRun {
  const rows = db.prepare(`
    SELECT * FROM protocol_runs
    WHERE status IN ('planning', 'running')
    ORDER BY updated_at DESC LIMIT 50
  `).all() as Row[]
  const joinable = rows.map(rowToRun).filter((run) => {
    const count = Number((db.prepare(
      'SELECT COUNT(*) AS n FROM protocol_agents WHERE run_id = ?',
    ).get(run.id) as Row | undefined)?.n) || 0
    return count < run.maxAgents
  })
  if (joinable.length === 0) {
    throw new Error('No joinable Coordinator run found. Create one with coord_create_run, or pass an explicit run id.')
  }
  const contains = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  const sameCheckout = joinable.find((run) => (
    joinerPaths.some((joinerPath) => joinerPath && contains(path.resolve(run.baseCwd), joinerPath))
  ))
  return sameCheckout ?? joinable[0]
}

export async function joinExternalProtocolRun(
  params: JoinExternalProtocolRunParams,
): Promise<ExternalProtocolParticipantResult> {
  const name = normalizeParticipantName(params.participantName)
  const worktree = await participantWorktree(params.cwd)
  const joinerPaths = [path.resolve(params.cwd.trim() || process.cwd()), worktree.cwd]
  const joinerRoot = await findRepoRoot(worktree.cwd).catch(() => null)
  if (joinerRoot) joinerPaths.push(joinerRoot)
  const result = await enqueueWrite((db) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const run = params.runId
        ? (() => {
            const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(params.runId) as Row | undefined
            if (!runRow) throw new Error('Coordinator run not found')
            return rowToRun(runRow)
          })()
        : resolveJoinableExternalRunSync(db, joinerPaths)
      if (!['planning', 'running'].includes(run.status)) throw new Error(`Coordinator run is ${run.status}`)
      const participantCount = Number((db.prepare(
        'SELECT COUNT(*) AS count FROM protocol_agents WHERE run_id = ?',
      ).get(run.id) as Row | undefined)?.count) || 0
      if (participantCount >= run.maxAgents) throw new Error('Coordinator run has reached its participant limit')
      const duplicate = db.prepare('SELECT 1 FROM protocol_agents WHERE run_id = ? AND lower(name) = lower(?)')
        .get(run.id, name)
      if (duplicate) throw new Error(`Coordinator participant name already exists: ${name}`)
      const participant = issueParticipant(db, {
        runId: run.id,
        name,
        role: 'teammate',
        provider: params.provider,
        cwd: worktree.cwd,
        branch: worktree.branch,
        client: params.client,
        capabilities: params.capabilities,
      })
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(nowIso(), run.id)
      db.exec('COMMIT')
      return { participant, snapshot: externalSnapshotSync(db, run.id, participant.agentId) }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(result.participant.runId)
  return { ...result, instructions: externalParticipantInstructions(result.participant) }
}

export async function resumeExternalProtocolParticipant(
  identity: ExternalProtocolIdentity,
  negotiation?: { client?: ExternalProtocolClient; capabilities?: ExternalProtocolCapabilities },
): Promise<ExternalProtocolParticipantResult> {
  const db = await getDatabase()
  let agent = requireExternalParticipantSync(db, identity)
  if (negotiation?.client || negotiation?.capabilities) {
    const negotiated = negotiateExternalClient(negotiation.client, negotiation.capabilities)
    await enqueueWrite((writeDb) => {
      requireExternalParticipantSync(writeDb, identity)
      writeDb.prepare(`
        UPDATE protocol_agents
        SET client_name = ?, client_version = ?, protocol_version = ?, capabilities_json = ?, updated_at = ?
        WHERE run_id = ? AND id = ?
      `).run(
        negotiated.client.name,
        negotiated.client.version ?? null,
        negotiated.client.protocolVersion,
        JSON.stringify(negotiated.capabilities),
        nowIso(),
        identity.runId,
        identity.agentId,
      )
    })
    const refreshed = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?')
      .get(identity.runId, identity.agentId) as Row | undefined
    if (refreshed) agent = rowToAgent(refreshed)
  }
  const participant: ExternalProtocolParticipant = {
    ...identity,
    name: agent.name,
    role: agent.role,
    provider: agent.provider,
    cwd: agent.worktreePath,
    serverProtocolVersion: EXTERNAL_COORD_PROTOCOL_VERSION,
    negotiatedProtocolVersion: agent.client?.protocolVersion ?? MIN_EXTERNAL_COORD_PROTOCOL_VERSION,
    capabilities: agent.capabilities ?? {},
  }
  return {
    participant,
    snapshot: externalSnapshotSync(db, identity.runId, identity.agentId),
    instructions: externalParticipantInstructions(participant),
  }
}

export async function readExternalProtocolRun(identity: ExternalProtocolIdentity): Promise<ProtocolRunSnapshot> {
  const db = await getDatabase()
  requireExternalParticipantSync(db, identity)
  return externalSnapshotSync(db, identity.runId, identity.agentId)
}

/** Rollup/save group for tasks created outside any playbook phase. */
const UNPHASED_GROUP = 'Tasks'

/** Workflow-style progress: task counts per playbook phase, in board order. */
function phaseRollups(tasks: ProtocolTask[]): ProtocolPhaseRollup[] {
  const order: string[] = []
  const rollups = new Map<string, ProtocolPhaseRollup>()
  for (const task of tasks) {
    const title = task.phase ?? UNPHASED_GROUP
    let rollup = rollups.get(title)
    if (!rollup) {
      rollup = { title, total: 0, pending: 0, active: 0, completed: 0, failed: 0 }
      rollups.set(title, rollup)
      order.push(title)
    }
    rollup.total += 1
    if (task.status === 'completed') rollup.completed += 1
    else if (task.status === 'failed' || task.status === 'cancelled') rollup.failed += 1
    else if (task.status === 'pending') rollup.pending += 1
    else rollup.active += 1
  }
  return order.map((title) => rollups.get(title)!)
}

/**
 * Compact post-mutation view: enough for the agent's next decision without
 * echoing the board it already knows. Full views stay on status/wait. The
 * cursor lets the MCP bridge advance past the caller's own events so its next
 * coord_wait doesn't wake on them.
 */
function externalMutationResultSync(
  db: SqliteDatabase,
  runId: string,
  agentId: string,
  task?: ProtocolTask,
): ExternalProtocolMutationResult {
  const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) throw new Error('Coordinator run not found')
  return {
    runStatus: String(runRow.status) as ProtocolRunStatus,
    cursor: latestRunCursorSync(db, runId),
    phases: phaseRollups(listTasksSync(db, runId)),
    actionable: externalActionableSync(db, runId, agentId),
    ...(task ? { task } : {}),
  }
}

async function externalMutationResult(
  identity: ExternalProtocolIdentity,
  task?: ProtocolTask,
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  return externalMutationResultSync(db, identity.runId, identity.agentId, task)
}

export async function readExternalProtocolStatus(identity: ExternalProtocolIdentity): Promise<ExternalProtocolStatusResult> {
  const db = await getDatabase()
  requireExternalParticipantSync(db, identity)
  const snapshot = externalSnapshotSync(db, identity.runId, identity.agentId)
  return {
    snapshot,
    actionable: externalActionableSync(db, identity.runId, identity.agentId),
    cursor: latestRunCursorSync(db, identity.runId),
    phases: phaseRollups(snapshot.tasks),
  }
}

function latestRunCursorSync(db: SqliteDatabase, runId: string): string | null {
  const event = db.prepare(
    "SELECT rowid AS cursor FROM protocol_events WHERE run_id = ? AND type != 'agent.heartbeat' ORDER BY rowid DESC LIMIT 1",
  ).get(runId) as Row | undefined
  return typeof event?.cursor === 'number' || typeof event?.cursor === 'bigint'
    ? String(event.cursor)
    : null
}

// A participant's own tool calls insert events; waking it on those would turn
// every mutation into a spurious wake (and, in worker mode, a wasted model
// turn). Only events authored by OTHER agents (teammates, the lead, the
// coordinator) count as changes for a given waiter.
function hasEventAfterCursorSync(db: SqliteDatabase, runId: string, cursor: string | null, excludeAgentId?: string): boolean {
  if (!cursor) return true
  if (!/^\d+$/.test(cursor)) return true
  return Boolean(db.prepare(`
    SELECT 1 FROM protocol_events
    WHERE run_id = ? AND rowid > ? AND type != 'agent.heartbeat' AND agent_id != ?
    LIMIT 1
  `).get(runId, Number(cursor), excludeAgentId ?? ''))
}

/** Events after `cursor` (all authors), oldest first, message-privacy filtered. */
function eventsAfterCursorSync(
  db: SqliteDatabase,
  runId: string,
  agentId: string,
  cursor: string | null,
): { events: AgentProtocolEvent[]; cursor: string | null } {
  const rows = cursor && /^\d+$/.test(cursor)
    ? db.prepare(`
        SELECT rowid AS cursor, * FROM protocol_events
        WHERE run_id = ? AND rowid > ? AND type != 'agent.heartbeat'
        ORDER BY rowid ASC LIMIT 100
      `).all(runId, Number(cursor)) as Row[]
    : (db.prepare(`
        SELECT rowid AS cursor, * FROM protocol_events
        WHERE run_id = ? AND type != 'agent.heartbeat'
        ORDER BY rowid DESC LIMIT 50
      `).all(runId) as Row[]).reverse()
  const last = rows.at(-1)?.cursor
  return {
    events: rows.map(rowToEvent).filter((event) => event.type !== 'message' || event.agentId === agentId),
    cursor: typeof last === 'number' || typeof last === 'bigint' ? String(last) : cursor,
  }
}

function recoverStaleExternalParticipantsSync(db: SqliteDatabase, runId: string): void {
  const cutoff = new Date(Date.now() - EXTERNAL_AGENT_STALE_MS).toISOString()
  const stale = db.prepare(`
    SELECT * FROM protocol_agents
    WHERE run_id = ? AND session_id LIKE 'external:%'
      AND status IN ('ready', 'idle', 'working', 'blocked')
      AND COALESCE(last_seen_at, updated_at) < ?
  `).all(runId, cutoff) as Row[]
  for (const row of stale) {
    const agent = rowToAgent(row)
    const ts = nowIso()
    if (agent.taskId) {
      db.prepare(`
        UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, updated_at = ?
        WHERE run_id = ? AND id = ? AND owner_agent_id = ?
      `).run(ts, runId, agent.taskId, agent.id)
    }
    db.prepare(`
      UPDATE protocol_locks SET status = 'released', updated_at = ?
      WHERE run_id = ? AND agent_id = ? AND status = 'active'
    `).run(ts, runId, agent.id)
    db.prepare(`
      UPDATE protocol_agents SET task_id = NULL, status = 'stopped', updated_at = ?
      WHERE run_id = ? AND id = ?
    `).run(ts, runId, agent.id)
    insertEventSync(db, {
      version: AGENT_PROTOCOL_VERSION,
      runId,
      agentId: agent.id,
      type: 'agent.blocked',
      taskId: agent.taskId,
      summary: `${agent.name} heartbeat expired; its task and locks were released`,
      timestamp: ts,
      payload: { stale: true },
    })
  }
}

export async function waitForExternalProtocolChange(
  identity: ExternalProtocolIdentity,
  params: { cursor?: string; timeoutMs?: number } = {},
): Promise<ExternalProtocolWaitResult> {
  const timeoutMs = Math.max(0, Math.min(params.timeoutMs ?? 25_000, 55_000))
  const deadline = Date.now() + timeoutMs
  const cursor = params.cursor?.trim() || null
  const db = await getDatabase()
  await enqueueWrite((writeDb) => {
    requireExternalParticipantSync(writeDb, identity)
    recoverStaleExternalParticipantsSync(writeDb, identity.runId)
    const ts = nowIso()
    writeDb.prepare(`
      UPDATE protocol_agents
      SET last_seen_at = ?, updated_at = ?, status = CASE WHEN status = 'stopped' THEN 'ready' ELSE status END
      WHERE run_id = ? AND id = ?
    `).run(ts, ts, identity.runId, identity.agentId)
    writeDb.prepare(`
      UPDATE protocol_locks SET lease_expires_at = ?, updated_at = ?
      WHERE run_id = ? AND agent_id = ? AND status = 'active'
    `).run(leaseIso(), ts, identity.runId, identity.agentId)
  })
  for (;;) {
    const changed = hasEventAfterCursorSync(db, identity.runId, cursor, identity.agentId)
    if (changed || Date.now() >= deadline) {
      const page = changed
        ? eventsAfterCursorSync(db, identity.runId, identity.agentId, cursor)
        : { events: [], cursor: latestRunCursorSync(db, identity.runId) }
      const snapshot = await readExternalProtocolRun(identity)
      const inbox = await readExternalProtocolInbox(identity, { acknowledge: false })
      return {
        changed,
        timedOut: !changed,
        // Advance only through the rows returned by this page. If more than
        // 100 events arrived in a burst, the next wait returns immediately
        // with the next page instead of skipping straight to the newest row.
        cursor: page.cursor,
        snapshot,
        inbox,
        events: page.events,
        actionable: externalActionableSync(db, identity.runId, identity.agentId),
      }
    }
    // Near-realtime: ledger writes signal the notifier; the timeout is only a
    // fallback for writes from another process sharing the SQLite file.
    await waitForRunSignal(identity.runId, Math.min(1_000, deadline - Date.now()))
  }
}

const externalIdempotencyInFlight = new Map<string, Promise<unknown>>()

export async function runExternalProtocolIdempotent<T>(
  identity: ExternalProtocolIdentity,
  action: string,
  requestId: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const key = requestId?.trim()
  if (!key) return operation()
  if (key.length > 160) throw new Error('requestId must be 160 characters or fewer')
  const cached = await enqueueWrite((db) => {
    requireExternalParticipantSync(db, identity)
    const row = db.prepare(`
      SELECT response_json FROM protocol_idempotency
      WHERE run_id = ? AND agent_id = ? AND action = ? AND request_id = ?
    `).get(identity.runId, identity.agentId, action, key) as Row | undefined
    return typeof row?.response_json === 'string' ? JSON.parse(row.response_json) as T : undefined
  })
  if (cached !== undefined) return cached
  const inFlightKey = `${identity.runId}\0${identity.agentId}\0${action}\0${key}`
  const existing = externalIdempotencyInFlight.get(inFlightKey) as Promise<T> | undefined
  if (existing) return existing

  const pending = (async () => {
    const result = await operation()
    // Rejected completions (gate/plan failures) must not be cached: the agent is
    // told to retry mutations with the SAME request_id, and a retry after fixing
    // the gate must re-run the checks rather than replay the stale rejection.
    if (result && typeof result === 'object' && (result as { accepted?: unknown }).accepted === false) {
      return result
    }
    await enqueueWrite((db) => {
      db.prepare(`
        INSERT OR IGNORE INTO protocol_idempotency
          (run_id, agent_id, action, request_id, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(identity.runId, identity.agentId, action, key, JSON.stringify(result), nowIso())
    })
    return result
  })()
  externalIdempotencyInFlight.set(inFlightKey, pending)
  try {
    return await pending
  } finally {
    if (externalIdempotencyInFlight.get(inFlightKey) === pending) {
      externalIdempotencyInFlight.delete(inFlightKey)
    }
  }
}

export async function createExternalProtocolTask(
  identity: ExternalProtocolIdentity,
  params: { title: string; detail: string; paths?: string[]; dependsOn?: string[]; phase?: string },
): Promise<ExternalProtocolMutationResult> {
  const result = await enqueueWrite((db) => {
    const agent = requireExternalParticipantSync(db, identity)
    const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(identity.runId) as Row | undefined
    if (!runRow) throw new Error('Coordinator run not found')
    // Any participant may add discovered work while the run is live. The lead
    // may also add tasks during synthesis — its review found follow-up work —
    // which reopens the board.
    const reopening = runRow.status === 'synthesizing' && agent.role === 'lead'
    if (runRow.status !== 'running' && !reopening) throw new Error('Coordinator run is not accepting tasks')
    const title = params.title.trim()
    const detail = params.detail.trim()
    if (!title || !detail) throw new Error('task title and detail are required')
    db.exec('BEGIN IMMEDIATE')
    try {
      const task = insertTaskSync(db, identity.runId, {
        title,
        prompt: detail,
        paths: params.paths ?? [],
        blockedBy: params.dependsOn ?? [],
        phase: params.phase?.trim() || undefined,
      })
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId: identity.runId,
        agentId: identity.agentId,
        type: 'task.created',
        taskId: task.id,
        title,
        detail,
        paths: task.paths,
        dependsOn: task.blockedBy,
        ...(task.phase ? { payload: { phase: task.phase } } : {}),
      })
      if (reopening) {
        db.prepare("UPDATE protocol_runs SET status = 'running' WHERE id = ?").run(identity.runId)
        insertEventSync(db, {
          version: AGENT_PROTOCOL_VERSION,
          runId: identity.runId,
          agentId: identity.agentId,
          type: 'run.status',
          summary: `Run reopened: the lead added ${task.id} during synthesis`,
          payload: { status: 'running' },
        })
      }
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(nowIso(), identity.runId)
      db.exec('COMMIT')
      return externalMutationResultSync(db, identity.runId, identity.agentId, task)
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(identity.runId)
  return result
}

export async function claimExternalProtocolTask(
  identity: ExternalProtocolIdentity,
  taskId?: string,
): Promise<ExternalProtocolClaimResult> {
  const initialDb = await getDatabase()
  const agent = requireExternalParticipantSync(initialDb, identity)
  // A failed snapshot must not silently degrade into an empty baseline —
  // that would make every pre-existing dirty file look like task work and
  // reject the eventual completion far from the real cause. Mark it so the
  // gate fails open (with an audit event) instead of failing confusing.
  const baseline = await worktreeChangeSnapshot(agent.worktreePath)
    .catch(() => ({ __baselineUnavailable: '1' } as Record<string, string>))
  const baselineFailed = baseline.__baselineUnavailable === '1'
  const result = await enqueueWrite((db) => {
    requireExternalParticipantSync(db, identity)
    db.exec('BEGIN IMMEDIATE')
    try {
      // A crashed participant's task should be claimable by whoever asks next,
      // not only after someone happens to long-poll.
      recoverStaleExternalParticipantsSync(db, identity.runId)
      const task = claimTaskSync(db, identity.runId, identity.agentId, taskId)
      if (!task) throw new Error(describeClaimFailureSync(db, identity.runId, taskId))
      db.prepare(`
        INSERT OR REPLACE INTO protocol_task_baselines
          (run_id, task_id, agent_id, snapshot_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(identity.runId, task.id, identity.agentId, JSON.stringify(baseline), nowIso())
      if (baselineFailed) {
        insertEventSync(db, {
          version: AGENT_PROTOCOL_VERSION,
          runId: identity.runId,
          agentId: identity.agentId,
          type: 'learning',
          taskId: task.id,
          summary: `Worktree baseline could not be captured at claim of ${task.id}; the outside-paths completion gate is disabled for this task`,
        })
      }
      db.exec('COMMIT')
      return { ...externalMutationResultSync(db, identity.runId, identity.agentId, task), task }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(identity.runId)
  return result
}

/** Human-actionable reason a claim produced nothing. */
function describeClaimFailureSync(db: SqliteDatabase, runId: string, taskId?: string): string {
  if (!taskId) return 'No claimable task: every pending task is owned or blocked by incomplete dependencies'
  const row = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?').get(runId, taskId) as Row | undefined
  if (!row) return `No claimable task: ${taskId} does not exist`
  const task = rowToTask(row)
  if (task.ownerAgentId) return `No claimable task: ${taskId} is already owned by ${task.ownerAgentId}`
  if (task.status !== 'pending') return `No claimable task: ${taskId} is ${task.status}`
  const tasksById = new Map(listTasksSync(db, runId).map((entry) => [entry.id, entry]))
  const unmet = task.blockedBy.filter((dep) => tasksById.get(dep)?.status !== 'completed')
  if (unmet.length > 0) return `No claimable task: ${taskId} is blocked by incomplete dependencies: ${unmet.join(', ')}`
  return `No claimable task: ${taskId}`
}

export async function readExternalProtocolInbox(
  identity: ExternalProtocolIdentity,
  params: { after?: string; limit?: number; acknowledge?: boolean } = {},
): Promise<ExternalProtocolInboxResult> {
  return enqueueWrite((db) => {
    requireExternalParticipantSync(db, identity)
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200))
    let rows: Row[]
    if (params.after) {
      const cursor = db.prepare(
        'SELECT created_at FROM protocol_messages WHERE run_id = ? AND id = ? AND to_agent_id = ?',
      ).get(identity.runId, params.after, identity.agentId) as Row | undefined
      if (cursor) {
        rows = db.prepare(`
          SELECT * FROM protocol_messages
          WHERE run_id = ? AND to_agent_id = ?
            AND (delivered_at IS NULL OR created_at > ? OR (created_at = ? AND id > ?))
          ORDER BY created_at ASC, id ASC
          LIMIT ?
        `).all(identity.runId, identity.agentId, cursor.created_at, cursor.created_at, params.after, limit) as Row[]
      } else {
        rows = []
      }
    } else {
      rows = db.prepare(`
        SELECT * FROM protocol_messages
        WHERE run_id = ? AND to_agent_id = ? AND delivered_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `).all(identity.runId, identity.agentId, limit) as Row[]
    }
    const readyStatusGroups = readyStatusMessageGroups(rows)
    rows = rows.filter((row) => (
      (row.priority !== 'status' && row.kind !== 'status') || readyStatusGroups.has(statusMessageGroupKey(row))
    ))
    const rawMessages = rows.map(rowToMessage)
    if (params.acknowledge !== false && rawMessages.length > 0) {
      const acknowledgedAt = nowIso()
      const acknowledge = db.prepare(
        'UPDATE protocol_messages SET delivered_at = COALESCE(delivered_at, ?) WHERE run_id = ? AND id = ? AND to_agent_id = ?',
      )
      for (const message of rawMessages) {
        acknowledge.run(acknowledgedAt, identity.runId, message.id, identity.agentId)
      }
    }
    return {
      messages: batchStatusMessages(rawMessages),
      nextCursor: rawMessages.at(-1)?.id ?? params.after ?? null,
    }
  })
}

function batchStatusMessages(messages: ProtocolMessage[]): ProtocolMessage[] {
  const groups = new Map<string, ProtocolMessage[]>()
  for (const message of messages) {
    if (message.priority !== 'status' && message.kind !== 'status') continue
    const key = `${message.fromAgentId}\0${message.correlationId ?? ''}`
    const group = groups.get(key) ?? []
    group.push(message)
    groups.set(key, group)
  }
  const emitted = new Set<string>()
  const result: ProtocolMessage[] = []
  for (const message of messages) {
    if (message.priority !== 'status' && message.kind !== 'status') {
      result.push(message)
      continue
    }
    const key = `${message.fromAgentId}\0${message.correlationId ?? ''}`
    if (emitted.has(key)) continue
    emitted.add(key)
    const group = groups.get(key) ?? [message]
    const latest = group.at(-1)!
    result.push({
      ...message,
      id: `status-summary:${latest.id}`,
      kind: 'status_summary',
      priority: 'normal',
      body: group.length === 1
        ? message.body
        : `[${group.length} status updates]\n${group.map((entry) => `- ${entry.body}`).join('\n')}`,
      createdAt: latest.createdAt,
      batchedMessageIds: group.map((entry) => entry.id),
    })
  }
  return result
}

export async function sendExternalProtocolMessage(
  identity: ExternalProtocolIdentity,
  params: {
    to: string
    body: string
    kind?: ProtocolMessageKind
    priority?: ProtocolMessagePriority
    replyRequired?: boolean
    correlationId?: string
    inReplyTo?: string
  },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  requireExternalParticipantSync(db, identity)
  const body = params.body.trim()
  if (!body) throw new Error('message body is required')
  const recipients = resolveRecipientsSync(db, identity.runId, identity.agentId, params.to)
  if (recipients.length === 0) {
    throw new Error(`Coordinator message recipient not found: ${params.to}`)
  }
  if (params.inReplyTo && recipients.length !== 1) {
    throw new Error('A correlated reply must address exactly one participant')
  }
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: 'message',
    to: params.to,
    summary: body,
    payload: {
      kind: params.kind ?? 'request',
      priority: params.priority ?? (params.kind === 'status' ? 'status' : 'normal'),
      replyRequired: params.replyRequired === true,
      correlationId: params.correlationId,
      inReplyTo: params.inReplyTo,
    },
  })
  return externalMutationResult(identity)
}

export async function requestExternalProtocolLocks(
  identity: ExternalProtocolIdentity,
  paths: string[],
): Promise<ExternalProtocolLockResult> {
  const requested = paths.map((entry) => entry.trim()).filter(Boolean)
  if (requested.length === 0) throw new Error('at least one lock path is required')
  const result = await enqueueWrite((db) => {
    const agent = requireExternalParticipantSync(db, identity)
    db.exec('BEGIN IMMEDIATE')
    try {
      const requestedAt = Date.now()
      const activeLocks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND status = 'active'")
        .all(identity.runId) as Row[]).map(rowToLock)
      const allRenewals = requested.every((entry) => {
        const requestedPath = normalizeLockPath(entry)
        return activeLocks.some((lock) => lock.agentId === identity.agentId
          && lock.taskId === agent.taskId
          && lock.path === requestedPath
          && lock.mode === 'write'
          && new Date(lock.leaseExpiresAt).getTime() > requestedAt)
      })
      if (!allRenewals) {
        insertEventSync(db, {
          version: AGENT_PROTOCOL_VERSION,
          runId: identity.runId,
          agentId: identity.agentId,
          type: 'lock.requested',
          taskId: agent.taskId,
          paths: requested,
          summary: `Requested write access for ${requested.join(', ')}`,
        })
      }
      const locks = requested.map((entry) => acquireLockSync(db, {
        runId: identity.runId,
        agentId: identity.agentId,
        taskId: agent.taskId,
        path: entry,
        mode: 'write',
      }))
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(nowIso(), identity.runId)
      db.exec('COMMIT')
      return {
        ...externalMutationResultSync(db, identity.runId, identity.agentId),
        granted: locks.filter((lock) => lock.status === 'active')
          .map((lock) => ({ lockId: lock.id, path: lock.path })),
        denied: locks.filter((lock) => lock.status === 'denied')
          .map((lock) => ({
            path: lock.path,
            reason: lock.conflict
              ? `conflicts with an active lock held by ${lock.conflict.agentId} on ${lock.conflict.path}`
              : 'conflicts with an active lock',
          })),
      }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(identity.runId)
  return result
}

export async function reportExternalProtocolProgress(
  identity: ExternalProtocolIdentity,
  params: {
    status: 'ready' | 'working' | 'idle' | 'blocked' | 'heartbeat'
    taskId?: string
    summary?: string
    detail?: string
  },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const type: AgentProtocolEvent['type'] = params.status === 'working'
    ? 'agent.start_work'
    : params.status === 'idle'
      ? 'agent.stop_work'
      : params.status === 'blocked'
        ? 'agent.blocked'
        : params.status === 'heartbeat'
          ? 'agent.heartbeat'
          : 'agent.ready'
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type,
    taskId: params.taskId ?? agent.taskId,
    summary: params.summary,
    detail: params.detail,
  })
  return externalMutationResult(identity)
}

export async function publishExternalProtocolFinding(
  identity: ExternalProtocolIdentity,
  params: { kind: 'finding' | 'learning' | 'handoff' | 'review.requested'; summary: string; detail?: string; taskId?: string },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const summary = params.summary.trim()
  if (!summary) throw new Error('finding summary is required')
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: params.kind,
    taskId: params.taskId ?? agent.taskId,
    summary,
    detail: params.detail?.trim() || undefined,
  })
  return externalMutationResult(identity)
}

export async function submitExternalProtocolPlan(
  identity: ExternalProtocolIdentity,
  params: { taskId: string; summary: string; detail?: string },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const task = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
    .get(identity.runId, params.taskId) as Row | undefined
  if (!task || rowToTask(task).ownerAgentId !== agent.id) throw new Error('You do not own that task')
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: 'task.planned',
    taskId: params.taskId,
    summary: params.summary.trim(),
    detail: params.detail?.trim() || undefined,
  })
  return externalMutationResult(identity)
}

export async function reviewExternalProtocolPlan(
  identity: ExternalProtocolIdentity,
  params: { taskId: string; approved: boolean; summary?: string; detail?: string },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  if (agent.role !== 'lead') throw new Error('Only the Coordinator lead can review plans')
  const task = db.prepare('SELECT 1 FROM protocol_tasks WHERE run_id = ? AND id = ?')
    .get(identity.runId, params.taskId)
  if (!task) throw new Error('Coordinator task not found')
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: params.approved ? 'plan.approved' : 'plan.rejected',
    taskId: params.taskId,
    summary: params.summary?.trim() || undefined,
    detail: params.detail?.trim() || undefined,
  })
  return externalMutationResult(identity)
}

async function rejectExternalCompletion(
  identity: ExternalProtocolIdentity,
  taskId: string,
  reason: string,
): Promise<ExternalProtocolCompletionResult> {
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: 'agent.blocked',
    taskId,
    summary: 'task.completed rejected',
    detail: reason,
  })
  return { accepted: false, reason, ...await externalMutationResult(identity) }
}

async function maybeStartExternalSynthesis(runId: string): Promise<void> {
  if (controllers.has(runId)) return
  await enqueueWrite((db) => {
    const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
    if (!runRow) return
    const run = rowToRun(runRow)
    if (run.status !== 'running') return
    const tasks = listTasksSync(db, runId)
    if (tasks.length === 0 || tasks.some((task) => !['completed', 'failed', 'cancelled'].includes(task.status))) return
    const ts = nowIso()
    db.prepare("UPDATE protocol_runs SET status = 'synthesizing', updated_at = ? WHERE id = ?").run(ts, runId)
    // Status transitions must land in the event log — waiters wake on events,
    // and a run that goes synthesizing silently strands every long-poll until
    // its timeout.
    insertEventSync(db, {
      version: AGENT_PROTOCOL_VERSION,
      runId,
      agentId: run.leadAgentId ?? 'coordinator',
      type: 'run.status',
      summary: 'All tasks are terminal; the run is synthesizing',
      payload: { status: 'synthesizing' },
      timestamp: ts,
    })
    if (run.leadAgentId) {
      insertMessageSync(db, {
        runId,
        fromAgentId: 'coordinator',
        toAgentId: run.leadAgentId,
        body: 'All tasks are terminal. Review the board and call coord_finalize_run with the final synthesis.',
        ts,
      })
    }
  })
  notifyRunChanged(runId)
}

export async function completeExternalProtocolTask(
  identity: ExternalProtocolIdentity,
  params: { taskId: string; summary: string; detail?: string },
): Promise<ExternalProtocolCompletionResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
    .get(identity.runId, params.taskId) as Row | undefined
  if (!taskRow) throw new Error('Coordinator task not found')
  const task = rowToTask(taskRow)
  if (task.ownerAgentId !== agent.id) throw new Error('You do not own that task')
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(identity.runId) as Row | undefined
  if (!runRow) throw new Error('Coordinator run not found')
  const run = rowToRun(runRow)
  if (run.requirePlanApproval && !taskPlanApprovedSync(db, identity.runId, task.id)) {
    return rejectExternalCompletion(identity, task.id, 'This run requires lead plan approval before completion.')
  }
  const uncovered = await completionGateFailure(identity.runId, identity.agentId, agent.worktreePath, task.id)
  if (uncovered) {
    return rejectExternalCompletion(
      identity,
      task.id,
      `Changes outside granted paths: ${uncovered.slice(0, 12).join(', ')}`,
    )
  }
  if (run.gateCommand) {
    const failure = await runGateCommand(run.gateCommand, agent.worktreePath)
    if (failure) return rejectExternalCompletion(identity, task.id, `Quality gate failed:\n${failure}`)
  }
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: 'task.completed',
    taskId: task.id,
    summary: params.summary.trim() || `${task.id} completed`,
    detail: params.detail?.trim() || undefined,
  })
  await maybeStartExternalSynthesis(identity.runId)
  return { accepted: true, ...await externalMutationResult(identity) }
}

/**
 * Return a task to the board without failing it: the owner hands back work it
 * cannot finish, or the lead repairs a wedged/failed task so another
 * participant can claim it. Claim is otherwise a one-way door.
 */
export async function releaseExternalProtocolTask(
  identity: ExternalProtocolIdentity,
  params: { taskId: string; reason?: string },
): Promise<ExternalProtocolReleaseResult> {
  const result = await enqueueWrite((db) => {
    const agent = requireExternalParticipantSync(db, identity)
    const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
      .get(identity.runId, params.taskId) as Row | undefined
    if (!taskRow) throw new Error('Coordinator task not found')
    const task = rowToTask(taskRow)
    if (task.ownerAgentId !== agent.id && agent.role !== 'lead') {
      throw new Error('Only the task owner or the Coordinator lead can release a task')
    }
    if (['completed', 'cancelled'].includes(task.status)) {
      throw new Error(`Coordinator task is already ${task.status}`)
    }
    const ts = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, identity.runId, task.id)
      if (task.ownerAgentId) {
        db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
          .run(ts, identity.runId, task.ownerAgentId, task.id)
        db.prepare("UPDATE protocol_agents SET task_id = NULL, status = CASE WHEN status IN ('working', 'blocked') THEN 'idle' ELSE status END, updated_at = ? WHERE run_id = ? AND id = ? AND task_id = ?")
          .run(ts, identity.runId, task.ownerAgentId, task.id)
      }
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId: identity.runId,
        agentId: identity.agentId,
        type: 'task.released',
        taskId: task.id,
        summary: params.reason?.trim() || `${task.id} returned to the board`,
        timestamp: ts,
      })
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, identity.runId)
      db.exec('COMMIT')
      const updated = rowToTask(db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
        .get(identity.runId, task.id) as Row)
      return {
        ...externalMutationResultSync(db, identity.runId, identity.agentId, updated),
        task: updated,
      }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(identity.runId)
  return result
}

/**
 * Persist a clean checkpoint and atomically return work to the board after a
 * provider-level failure. Unlike task failure, handoff preserves the task as
 * pending so a different CLI can resume it from the durable event/mailbox note.
 */
export async function handoffExternalProtocolTask(
  identity: ExternalProtocolIdentity,
  params: {
    taskId: string
    summary: string
    detail?: string
    failureClass: ProtocolFailureClass
  },
): Promise<ExternalProtocolReleaseResult> {
  const delivery: { ids: string[] } = { ids: [] }
  const result = await enqueueWrite((db) => {
    const agent = requireExternalParticipantSync(db, identity)
    const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
      .get(identity.runId, params.taskId) as Row | undefined
    if (!taskRow) throw new Error('Coordinator task not found')
    const task = rowToTask(taskRow)
    if (task.ownerAgentId !== agent.id) throw new Error('You do not own that task')
    const summary = params.summary.trim() || `${task.id} checkpointed for handoff`
    const detail = params.detail?.trim() || undefined
    const ts = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, identity.runId, task.id)
      db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
        .run(ts, identity.runId, agent.id, task.id)
      db.prepare("UPDATE protocol_agents SET task_id = NULL, status = 'blocked', last_seen_at = ?, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, ts, identity.runId, agent.id)
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId: identity.runId,
        agentId: agent.id,
        type: 'handoff',
        taskId: task.id,
        summary,
        detail,
        payload: { failureClass: params.failureClass, provider: agent.provider, checkpoint: true },
        timestamp: ts,
      })
      for (const leadId of resolveRecipientsSync(db, identity.runId, agent.id, 'lead')) {
        delivery.ids.push(insertMessageSync(db, {
          runId: identity.runId,
          fromAgentId: agent.id,
          toAgentId: leadId,
          body: [summary, detail, `Failure class: ${params.failureClass}`, `${task.id} is available for reassignment.`]
            .filter(Boolean).join('\n\n'),
          kind: 'handoff',
          priority: 'urgent',
          ts,
        }))
      }
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, identity.runId)
      db.exec('COMMIT')
      const updated = rowToTask(db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
        .get(identity.runId, task.id) as Row)
      return { ...externalMutationResultSync(db, identity.runId, identity.agentId, updated), task: updated }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(identity.runId)
  if (delivery.ids.length > 0) void deliverMessagesLive(identity.runId, delivery.ids).catch(() => {})
  return result
}

export async function failExternalProtocolTask(
  identity: ExternalProtocolIdentity,
  params: { taskId: string; summary: string; detail?: string },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
    .get(identity.runId, params.taskId) as Row | undefined
  if (!taskRow || rowToTask(taskRow).ownerAgentId !== agent.id) throw new Error('You do not own that task')
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: 'task.failed',
    taskId: params.taskId,
    summary: params.summary.trim() || `${params.taskId} failed`,
    detail: params.detail?.trim() || undefined,
  })
  await maybeStartExternalSynthesis(identity.runId)
  return externalMutationResult(identity)
}

export async function finalizeExternalProtocolRun(
  identity: ExternalProtocolIdentity,
  summary: string,
): Promise<ProtocolRunSnapshot> {
  const result = await enqueueWrite((db) => {
    const agent = requireExternalParticipantSync(db, identity)
    if (agent.role !== 'lead') throw new Error('Only the Coordinator lead can finalize a run')
    const finalSummary = summary.trim()
    if (!finalSummary) throw new Error('final synthesis is required')
    const unfinished = listTasksSync(db, identity.runId).filter((task) => (
      !['completed', 'failed', 'cancelled'].includes(task.status)
    ))
    if (unfinished.length > 0) throw new Error(`Coordinator run still has ${unfinished.length} unfinished task(s)`)
    const ts = nowIso()
    db.prepare("UPDATE protocol_runs SET status = 'completed', summary = ?, updated_at = ? WHERE id = ?")
      .run(finalSummary, ts, identity.runId)
    db.prepare("UPDATE protocol_agents SET status = 'done', updated_at = ? WHERE run_id = ? AND status NOT IN ('failed', 'stopped')")
      .run(ts, identity.runId)
    db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND status = 'active'")
      .run(ts, identity.runId)
    // Wake every waiting participant so their CLIs exit near-realtime instead
    // of on the long-poll timeout.
    insertEventSync(db, {
      version: AGENT_PROTOCOL_VERSION,
      runId: identity.runId,
      agentId: identity.agentId,
      type: 'run.status',
      summary: 'Run finalized by the lead',
      payload: { status: 'completed' },
      timestamp: ts,
    })
    return externalSnapshotSync(db, identity.runId, identity.agentId)
  })
  notifyRunChanged(identity.runId)
  return result
}

// ---------------------------------------------------------------------------
// Playbook storage — the coordinator analog of .claude/workflows/: reusable
// run definitions live in the repo at .agent-viewer/playbooks/<name>.json so
// everyone who clones the checkout can run them.

function playbooksDir(cwd: string): string {
  return path.join(path.resolve(cwd), '.agent-viewer', 'playbooks')
}

export async function loadRunPlaybook(cwd: string, name: string): Promise<RunPlaybook> {
  if (!isValidPlaybookName(name)) {
    throw new Error('playbook name must be a lowercase slug (a-z, 0-9, hyphens, max 64 chars)')
  }
  const file = path.join(playbooksDir(cwd), `${name}.json`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    throw new Error(`Playbook not found: ${name} (looked in ${playbooksDir(cwd)})`)
  }
  try {
    return parseRunPlaybook(JSON.parse(raw))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid playbook'
    throw new Error(`Playbook "${name}" (${file}) is invalid: ${reason}`)
  }
}

export type RunPlaybookListing = {
  playbooks: PlaybookSummary[]
  /** Files present but unusable — surfaced so a typo'd playbook doesn't silently vanish. */
  invalid: Array<{ file: string; error: string }>
}

export async function listRunPlaybooks(cwd: string): Promise<RunPlaybookListing> {
  const dir = playbooksDir(cwd)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return { playbooks: [], invalid: [] }
  }
  const playbooks: PlaybookSummary[] = []
  const invalid: Array<{ file: string; error: string }> = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    const file = path.join(dir, entry)
    try {
      const playbook = parseRunPlaybook(JSON.parse(await readFile(file, 'utf8')))
      playbooks.push({
        name: playbook.name,
        description: playbook.description,
        argsHint: playbook.argsHint,
        path: file,
        phaseCount: playbook.phases.length,
        taskCount: playbook.phases.reduce((total, phase) => total + phase.tasks.length, 0),
      })
    } catch (error) {
      invalid.push({ file, error: error instanceof Error ? error.message : 'invalid playbook' })
    }
  }
  return { playbooks, invalid }
}

/**
 * Snapshot a run's board into a reusable playbook (the doc's save-for-reuse):
 * tasks grouped by phase in board order, task ids becoming stable keys.
 * Explicit dependencies are preserved; phase barriers re-derive on replay.
 */
export async function saveExternalProtocolPlaybook(
  identity: ExternalProtocolIdentity,
  params: { name: string; description?: string; argsHint?: string },
): Promise<{ playbook: RunPlaybook; path: string }> {
  if (!isValidPlaybookName(params.name)) {
    throw new Error('playbook name must be a lowercase slug (a-z, 0-9, hyphens, max 64 chars)')
  }
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  if (agent.role !== 'lead') throw new Error('Only the Coordinator lead can save a playbook')
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(identity.runId) as Row | undefined
  if (!runRow) throw new Error('Coordinator run not found')
  const run = rowToRun(runRow)
  const tasks = listTasksSync(db, identity.runId)
  if (tasks.length === 0) throw new Error('Nothing to save: the run has no tasks')
  const phaseOrder: string[] = []
  const grouped = new Map<string, ProtocolTask[]>()
  for (const task of tasks) {
    const phase = task.phase ?? UNPHASED_GROUP
    let bucket = grouped.get(phase)
    if (!bucket) {
      bucket = []
      grouped.set(phase, bucket)
      phaseOrder.push(phase)
    }
    bucket.push(task)
  }
  const playbook = parseRunPlaybook({
    name: params.name,
    description: params.description?.trim() || run.prompt.slice(0, 200),
    argsHint: params.argsHint?.trim() || undefined,
    maxAgents: run.maxAgents,
    gateCommand: run.gateCommand,
    requirePlanApproval: run.requirePlanApproval || undefined,
    phases: phaseOrder.map((title) => ({
      title,
      tasks: grouped.get(title)!.map((task) => ({
        key: task.id,
        title: task.title,
        detail: task.prompt,
        paths: task.paths.length > 0 ? task.paths : undefined,
        dependsOn: task.blockedBy.length > 0 ? task.blockedBy : undefined,
      })),
    })),
  })
  const dir = playbooksDir(run.baseCwd)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${playbook.name}.json`)
  await writeFile(file, `${JSON.stringify(playbook, null, 2)}\n`, 'utf8')
  return { playbook, path: file }
}

// ---------------------------------------------------------------------------
// Locks

function normalizeLockPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed || trimmed === '.') return '**'
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/')
  return normalized || '**'
}

function pathHasGlob(value: string): boolean {
  return value.includes('*') || value.includes('?') || value.includes('[')
}

function globPrefix(value: string): string {
  const idx = value.search(/[*?[]/)
  const prefix = idx === -1 ? value : value.slice(0, idx)
  return prefix.replace(/\/+$/, '')
}

function lockPathsOverlap(aRaw: string, bRaw: string): boolean {
  const a = normalizeLockPath(aRaw)
  const b = normalizeLockPath(bRaw)
  if (a === '**' || b === '**') return true
  if (a === b) return true
  if (!pathHasGlob(a) && !pathHasGlob(b)) {
    return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  }
  const ap = globPrefix(a)
  const bp = globPrefix(b)
  if (!ap || !bp) return true
  return ap === bp || ap.startsWith(`${bp}/`) || bp.startsWith(`${ap}/`)
}

function writeLocksConflict(existing: ProtocolLock, requestedPath: string, requesterAgentId: string): boolean {
  if (existing.agentId === requesterAgentId) return false
  if (existing.status !== 'active') return false
  if (new Date(existing.leaseExpiresAt).getTime() <= Date.now()) return false
  return lockPathsOverlap(existing.path, requestedPath)
}

function acquireLockSync(db: SqliteDatabase, params: {
  runId: string
  agentId: string
  taskId?: string
  path: string
  mode: 'read' | 'write'
}): ProtocolLock & { conflict?: ProtocolLock } {
  const requestedPath = normalizeLockPath(params.path)
  const expiredAt = nowIso()
  db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND status = 'active' AND lease_expires_at <= ?")
    .run(expiredAt, params.runId, expiredAt)
  const activeRows = db.prepare('SELECT * FROM protocol_locks WHERE run_id = ? AND status = ?').all(params.runId, 'active') as Row[]
  const active = activeRows.map(rowToLock)
  const equivalent = active
    .filter((lock) => lock.agentId === params.agentId
      && lock.taskId === params.taskId
      && lock.path === requestedPath
      && lock.mode === params.mode
      && new Date(lock.leaseExpiresAt).getTime() > Date.now())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  if (equivalent.length > 0) {
    const [keeper, ...duplicates] = equivalent
    const ts = nowIso()
    const leaseExpiresAt = leaseIso()
    db.prepare('UPDATE protocol_locks SET lease_expires_at = ?, updated_at = ? WHERE id = ?')
      .run(leaseExpiresAt, ts, keeper.id)
    if (duplicates.length > 0) {
      const release = db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE id = ?")
      for (const duplicate of duplicates) release.run(ts, duplicate.id)
    }
    return { ...keeper, leaseExpiresAt, updatedAt: ts }
  }
  const conflict = params.mode === 'write'
    ? active.find((lock) => writeLocksConflict(lock, requestedPath, params.agentId))
    : undefined
  const id = randomUUID()
  const ts = nowIso()
  const status: ProtocolLockStatus = conflict ? 'denied' : 'active'
  const lock: ProtocolLock = {
    id,
    runId: params.runId,
    agentId: params.agentId,
    taskId: params.taskId,
    path: requestedPath,
    mode: params.mode,
    status,
    leaseExpiresAt: leaseIso(),
    createdAt: ts,
    updatedAt: ts,
  }
  db.prepare(`
    INSERT INTO protocol_locks (
      id, run_id, agent_id, task_id, path, mode, status, lease_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lock.id, lock.runId, lock.agentId, lock.taskId ?? null, lock.path, lock.mode, lock.status, lock.leaseExpiresAt, lock.createdAt, lock.updatedAt)
  insertEventSync(db, {
    version: AGENT_PROTOCOL_VERSION,
    runId: params.runId,
    agentId: params.agentId,
    type: conflict ? 'lock.denied' : 'lock.granted',
    taskId: params.taskId,
    lockId: id,
    paths: [requestedPath],
    summary: conflict ? `Lock denied; conflicts with ${conflict.agentId} on ${conflict.path}` : `Lock granted for ${requestedPath}`,
    timestamp: ts,
  })
  return conflict ? { ...lock, conflict } : lock
}

// ---------------------------------------------------------------------------
// Event application

function insertEventSync(db: SqliteDatabase, event: AgentProtocolEvent): void {
  const ts = event.timestamp ?? nowIso()
  db.prepare(`
    INSERT INTO protocol_events (
      id, run_id, agent_id, type, task_id, lock_id, summary, detail,
      paths_json, payload_json, timestamp, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    event.runId,
    event.agentId,
    event.type,
    event.taskId ?? null,
    event.lockId ?? null,
    event.summary ?? null,
    event.detail ?? null,
    JSON.stringify(event.paths ?? []),
    event.payload ? JSON.stringify(event.payload) : null,
    ts,
    ts,
  )
}

function setAgentStatusSync(db: SqliteDatabase, runId: string, agentId: string, status: ProtocolAgentStatus, ts: string): void {
  db.prepare('UPDATE protocol_agents SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
    .run(status, ts, agentId, runId)
}

function listAgentsSync(db: SqliteDatabase, runId: string): ProtocolAgent[] {
  return (db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Row[]).map(rowToAgent)
}

function listTasksSync(db: SqliteDatabase, runId: string): ProtocolTask[] {
  return (db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Row[]).map(rowToTask)
}

function taskDepsCompleted(task: ProtocolTask, tasksById: Map<string, ProtocolTask>): boolean {
  return task.blockedBy.every((dep) => tasksById.get(dep)?.status === 'completed')
}

type TaskPlanState = 'none' | 'awaiting' | 'approved' | 'rejected'

function taskPlanStateSync(db: SqliteDatabase, runId: string, taskId: string): TaskPlanState {
  const row = db.prepare(`
    SELECT type FROM protocol_events
    WHERE run_id = ?
      AND task_id = ?
      AND type IN ('task.planned', 'plan.approved', 'plan.rejected')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(runId, taskId) as Row | undefined
  if (!row) return 'none'
  if (row.type === 'plan.approved') return 'approved'
  if (row.type === 'plan.rejected') return 'rejected'
  return 'awaiting'
}

function taskPlanApprovedSync(db: SqliteDatabase, runId: string, taskId: string): boolean {
  return taskPlanStateSync(db, runId, taskId) === 'approved'
}

function shouldPlanTaskSync(db: SqliteDatabase, run: RunController, task: ProtocolTask): boolean {
  return run.requirePlanApproval && !taskPlanApprovedSync(db, run.runId, task.id)
}

/** Atomic claim: only a pending task with completed deps and no owner can be taken. */
function claimTaskSync(db: SqliteDatabase, runId: string, agentId: string, taskId?: string): ProtocolTask | null {
  const tasks = listTasksSync(db, runId)
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const candidates = taskId
    ? tasks.filter((task) => task.id === taskId)
    : tasks
  const claimable = candidates.find((task) =>
    task.status === 'pending'
    && !task.ownerAgentId
    && taskDepsCompleted(task, tasksById))
  if (!claimable) return null
  const ts = nowIso()
  db.prepare("UPDATE protocol_tasks SET status = 'claimed', owner_agent_id = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status = 'pending' AND owner_agent_id IS NULL")
    .run(agentId, ts, claimable.id, runId)
  db.prepare('UPDATE protocol_agents SET task_id = ?, updated_at = ? WHERE id = ? AND run_id = ?')
    .run(claimable.id, ts, agentId, runId)
  insertEventSync(db, {
    version: AGENT_PROTOCOL_VERSION,
    runId,
    agentId,
    type: 'task.claimed',
    taskId: claimable.id,
    summary: `${agentId} claimed ${claimable.id}`,
    timestamp: ts,
  })
  for (const lockPath of claimable.paths) {
    acquireLockSync(db, { runId, agentId, taskId: claimable.id, path: lockPath, mode: 'write' })
  }
  return { ...claimable, status: 'claimed', ownerAgentId: agentId }
}

function insertTaskSync(db: SqliteDatabase, runId: string, params: {
  title: string
  prompt: string
  paths: string[]
  blockedBy: string[]
  phase?: string
}): ProtocolTask {
  const count = Number((db.prepare('SELECT COUNT(*) AS n FROM protocol_tasks WHERE run_id = ?').get(runId) as Row | undefined)?.n) || 0
  const ts = nowIso()
  const task: ProtocolTask = {
    id: `task-${count + 1}`,
    runId,
    title: params.title,
    prompt: params.prompt,
    status: 'pending',
    paths: params.paths.map(normalizeLockPath).filter((entry) => entry !== '**' || params.paths.length === 1),
    blockedBy: params.blockedBy,
    phase: params.phase,
    createdAt: ts,
    updatedAt: ts,
  }
  db.prepare(`
    INSERT INTO protocol_tasks (
      id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, phase, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, runId, task.title, task.prompt, 'pending', null, JSON.stringify(task.paths), JSON.stringify(task.blockedBy), task.phase ?? null, ts, ts)
  return task
}

/** Resolve a `message.to` target ('all', 'lead', a name, or an agent id) to agent ids. */
function resolveRecipientsSync(db: SqliteDatabase, runId: string, fromAgentId: string, to: string | undefined): string[] {
  const agents = listAgentsSync(db, runId)
  const target = (to ?? 'lead').trim().toLowerCase()
  if (target === 'all') {
    return agents.filter((agent) => agent.id !== fromAgentId).map((agent) => agent.id)
  }
  if (target === 'lead') {
    return agents.filter((agent) => agent.role === 'lead' && agent.id !== fromAgentId).map((agent) => agent.id)
  }
  const match = agents.find((agent) => agent.name.toLowerCase() === target || agent.id.toLowerCase() === target)
  return match && match.id !== fromAgentId ? [match.id] : []
}

function insertMessageSync(db: SqliteDatabase, params: {
  runId: string
  fromAgentId: string
  toAgentId: string
  body: string
  ts: string
  kind?: ProtocolMessageKind
  priority?: ProtocolMessagePriority
  replyRequired?: boolean
  correlationId?: string
  inReplyTo?: string
}): string {
  const id = randomUUID()
  let correlationId = params.correlationId
  if (params.inReplyTo) {
    const original = db.prepare(`
      SELECT * FROM protocol_messages
      WHERE id = ? AND run_id = ? AND to_agent_id = ? AND from_agent_id = ?
    `).get(params.inReplyTo, params.runId, params.fromAgentId, params.toAgentId) as Row | undefined
    if (!original) throw new Error(`Reply target not found or not addressed to this participant: ${params.inReplyTo}`)
    correlationId ||= typeof original.correlation_id === 'string' ? original.correlation_id : String(original.id)
    db.prepare('UPDATE protocol_messages SET resolved_at = COALESCE(resolved_at, ?) WHERE id = ?')
      .run(params.ts, params.inReplyTo)
  }
  const kind = params.kind ?? 'request'
  const priority = params.priority ?? (kind === 'status' ? 'status' : 'normal')
  db.prepare(`
    INSERT INTO protocol_messages (
      id, run_id, from_agent_id, to_agent_id, body, kind, priority, reply_required,
      correlation_id, in_reply_to, created_at, delivered_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(
    id, params.runId, params.fromAgentId, params.toAgentId, params.body,
    kind, priority, params.replyRequired ? 1 : 0, correlationId ?? (params.replyRequired ? id : null),
    params.inReplyTo ?? null, params.ts,
  )
  return id
}

/**
 * Apply one protocol event to the ledger. All state effects (agent status,
 * task lifecycle, claims, locks, mailbox rows) happen in one transaction;
 * newly created undelivered messages are then pushed live (steered into the
 * recipient's running turn) outside the transaction.
 */
export async function appendProtocolEvent(event: AgentProtocolEvent): Promise<ProtocolRunSnapshot | null> {
  const result = await enqueueWrite((db) => {
    const ts = event.timestamp ?? nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      insertEventSync(db, { ...event, timestamp: ts })
      db.prepare('UPDATE protocol_agents SET last_seen_at = ?, updated_at = ? WHERE id = ? AND run_id = ?')
        .run(ts, ts, event.agentId, event.runId)
      if (event.type === 'agent.heartbeat') {
        db.prepare(`
          UPDATE protocol_locks SET lease_expires_at = ?, updated_at = ?
          WHERE run_id = ? AND agent_id = ? AND status = 'active'
        `).run(leaseIso(), ts, event.runId, event.agentId)
      }
      const newMessageIds: string[] = []

      if (event.type === 'agent.ready') {
        setAgentStatusSync(db, event.runId, event.agentId, 'ready', ts)
      } else if (event.type === 'agent.start_work') {
        setAgentStatusSync(db, event.runId, event.agentId, 'working', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'in_progress', owner_agent_id = ?, updated_at = ? WHERE id = ? AND run_id = ?")
            .run(event.agentId, ts, event.taskId, event.runId)
        }
      } else if (event.type === 'agent.stop_work') {
        setAgentStatusSync(db, event.runId, event.agentId, 'idle', ts)
      } else if (event.type === 'agent.blocked') {
        setAgentStatusSync(db, event.runId, event.agentId, 'blocked', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'blocked', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
        }
      } else if (event.type === 'agent.unblocked') {
        setAgentStatusSync(db, event.runId, event.agentId, 'working', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
        }
      } else if (event.type === 'task.created') {
        insertTaskSync(db, event.runId, {
          title: event.title ?? event.summary ?? 'Untitled task',
          prompt: event.detail ?? event.summary ?? 'No prompt provided.',
          paths: event.paths ?? [],
          blockedBy: event.dependsOn ?? [],
        })
      } else if (event.type === 'task.planned') {
        const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(event.runId) as Row | undefined
        const run = runRow ? rowToRun(runRow) : null
        const taskRow = event.taskId
          ? db.prepare('SELECT * FROM protocol_tasks WHERE id = ? AND run_id = ?').get(event.taskId, event.runId) as Row | undefined
          : undefined
        if (taskRow && run?.requirePlanApproval) {
          const task = rowToTask(taskRow)
          db.prepare("UPDATE protocol_tasks SET status = 'planned', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, task.id, event.runId)
          setAgentStatusSync(db, event.runId, event.agentId, 'idle', ts)
          const body = [
            `${task.id} plan is ready for approval.`,
            event.summary,
            event.detail,
            'Lead: approve with `plan.approved` or reject with `plan.rejected`.',
          ].filter(Boolean).join('\n\n')
          for (const recipient of resolveRecipientsSync(db, event.runId, event.agentId, 'lead')) {
            newMessageIds.push(insertMessageSync(db, {
              runId: event.runId,
              fromAgentId: event.agentId,
              toAgentId: recipient,
              body,
              ts,
            }))
          }
        } else if (!event.taskId) {
          insertTaskSync(db, event.runId, {
            title: event.title ?? event.summary ?? 'Untitled task',
            prompt: event.detail ?? event.summary ?? 'No prompt provided.',
            paths: event.paths ?? [],
            blockedBy: event.dependsOn ?? [],
          })
        }
      } else if (event.type === 'task.claim') {
        const claimed = claimTaskSync(db, event.runId, event.agentId, event.taskId)
        if (!claimed) {
          insertEventSync(db, {
            version: AGENT_PROTOCOL_VERSION,
            runId: event.runId,
            agentId: event.agentId,
            type: 'lock.denied',
            taskId: event.taskId,
            summary: `Claim denied for ${event.taskId ?? 'next task'} (not pending, owned, or blocked by dependencies)`,
            timestamp: ts,
          })
        }
      } else if (event.type === 'task.completed') {
        setAgentStatusSync(db, event.runId, event.agentId, 'idle', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'completed', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
          db.prepare('UPDATE protocol_agents SET task_id = NULL, updated_at = ? WHERE id = ? AND run_id = ? AND task_id = ?')
            .run(ts, event.agentId, event.runId, event.taskId)
          db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
            .run(ts, event.runId, event.agentId, event.taskId)
        }
      } else if (event.type === 'task.failed') {
        // A failed task must not pin its locks or its owner: release both so
        // the paths free up immediately and the participant can claim other
        // work. External CLIs outlive a single failed task (idle); internal
        // teammates are retired by the work loop (failed).
        const agentRow = db.prepare('SELECT session_id FROM protocol_agents WHERE run_id = ? AND id = ?')
          .get(event.runId, event.agentId) as Row | undefined
        const isExternal = String(agentRow?.session_id ?? '').startsWith('external:')
        setAgentStatusSync(db, event.runId, event.agentId, isExternal ? 'idle' : 'failed', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'failed', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
          db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
            .run(ts, event.runId, event.agentId, event.taskId)
          db.prepare('UPDATE protocol_agents SET task_id = NULL, updated_at = ? WHERE id = ? AND run_id = ? AND task_id = ?')
            .run(ts, event.agentId, event.runId, event.taskId)
        }
      } else if (event.type === 'task.released' && event.taskId) {
        const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
          .get(event.runId, event.taskId) as Row | undefined
        const task = taskRow ? rowToTask(taskRow) : null
        if (task && !['completed', 'cancelled'].includes(task.status)) {
          db.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
            .run(ts, event.runId, task.id)
          if (task.ownerAgentId) {
            db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
              .run(ts, event.runId, task.ownerAgentId, task.id)
            db.prepare("UPDATE protocol_agents SET task_id = NULL, status = CASE WHEN status IN ('working', 'blocked') THEN 'idle' ELSE status END, updated_at = ? WHERE run_id = ? AND id = ? AND task_id = ?")
              .run(ts, event.runId, task.ownerAgentId, task.id)
          }
        }
      } else if (event.type === 'lock.requested' && event.paths && event.paths.length > 0) {
        for (const requested of event.paths) {
          acquireLockSync(db, {
            runId: event.runId,
            agentId: event.agentId,
            taskId: event.taskId,
            path: requested,
            mode: 'write',
          })
        }
      } else if (event.type === 'lock.released' && event.lockId) {
        db.prepare('UPDATE protocol_locks SET status = ?, updated_at = ? WHERE id = ? AND run_id = ? AND agent_id = ?')
          .run('released', ts, event.lockId, event.runId, event.agentId)
      } else if (event.type === 'message') {
        const body = [event.summary, event.detail].filter(Boolean).join(' — ') || '(empty message)'
        const messageKind = typeof event.payload?.kind === 'string' ? event.payload.kind as ProtocolMessageKind : 'request'
        const messagePriority = typeof event.payload?.priority === 'string' ? event.payload.priority as ProtocolMessagePriority : undefined
        const recipients = resolveRecipientsSync(db, event.runId, event.agentId, event.to)
        const target = (event.to ?? 'lead').trim()
        if (recipients.length === 0 && target.toLowerCase() !== 'all') {
          // A typo'd or stale teammate name must not vanish a message with no
          // trace — tell the sender delivery failed instead of silently
          // dropping it (the external send path already throws on this).
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: 'coordinator',
            toAgentId: event.agentId,
            body: `Delivery failed: no teammate named "${target}" in this run. Check the roster and resend.`,
            ts,
            kind: 'status',
          }))
        }
        for (const recipient of recipients) {
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: event.agentId,
            toAgentId: recipient,
            body,
            ts,
            kind: messageKind,
            priority: messagePriority,
            replyRequired: event.payload?.replyRequired === true,
            correlationId: typeof event.payload?.correlationId === 'string' ? event.payload.correlationId : undefined,
            inReplyTo: typeof event.payload?.inReplyTo === 'string' ? event.payload.inReplyTo : undefined,
          }))
        }
      } else if (event.type === 'plan.approved' || event.type === 'plan.rejected') {
        const taskRow = event.taskId
          ? db.prepare('SELECT * FROM protocol_tasks WHERE id = ? AND run_id = ?').get(event.taskId, event.runId) as Row | undefined
          : undefined
        const task = taskRow ? rowToTask(taskRow) : null
        if (task?.ownerAgentId) {
          db.prepare('UPDATE protocol_tasks SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
            .run('claimed', ts, task.id, event.runId)
          setAgentStatusSync(db, event.runId, task.ownerAgentId, 'idle', ts)
          const body = event.type === 'plan.approved'
            ? [`${task.id} plan approved. Begin implementation now.`, event.summary, event.detail].filter(Boolean).join('\n\n')
            : [`${task.id} plan rejected. Revise the plan before editing.`, event.summary, event.detail].filter(Boolean).join('\n\n')
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: event.agentId,
            toAgentId: task.ownerAgentId,
            body,
            ts,
          }))
        }
      } else if (event.type === 'shutdown.requested') {
        setAgentStatusSync(db, event.runId, event.agentId, 'done', ts)
      }

      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, event.runId)
      db.exec('COMMIT')
      return { snapshot: readSnapshotSync(db, event.runId), newMessageIds }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(event.runId)
  if (result.newMessageIds.length > 0) {
    void deliverMessagesLive(event.runId, result.newMessageIds).catch(() => {})
  }
  // Terminal task events can arrive from outside the work loop (board's
  // manual task repair, API posts) — they may have just finished the board.
  if (event.type === 'task.completed' || event.type === 'task.failed') {
    const controller = controllers.get(event.runId)
    if (controller) void maybeStartSynthesis(controller).catch(() => {})
  }
  return result.snapshot
}

// ---------------------------------------------------------------------------
// Mailbox delivery: steer live turns; anything undelivered rides the
// recipient's next dispatched turn (marked delivered at dispatch).

function formatMailboxDelivery(from: ProtocolAgent | undefined, body: string): string {
  return `[team message from ${from?.name ?? 'coordinator'}] ${body}`
}

async function deliverMessagesLive(runId: string, messageIds: string[]): Promise<void> {
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const controller = controllers.get(runId)
  const wake = new Set<string>()
  for (const id of messageIds) {
    const row = db.prepare('SELECT * FROM protocol_messages WHERE id = ?').get(id) as Row | undefined
    if (!row) continue
    const message = rowToMessage(row)
    if (message.deliveredAt) continue
    const recipient = agentsById.get(message.toAgentId)
    if (!recipient) continue
    const sessionId = controller?.sessionIds.get(recipient.id) ?? recipient.sessionId
    const text = formatMailboxDelivery(agentsById.get(message.fromAgentId), message.body)
    // External MCP participants do not have a native provider session for the
    // coordinator to steer. Their mailbox stays queued until coord_read_inbox
    // acknowledges it in that CLI's bridge process.
    const delivered = sessionId.startsWith('external:')
      ? false
      : await steerRunningSession(sessionId, text).catch(() => false)
    if (delivered) {
      await enqueueWrite((tx) => {
        tx.prepare('UPDATE protocol_messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL').run(nowIso(), id)
      })
    } else {
      wake.add(recipient.id)
    }
  }
  // A message WAKES an idle recipient (doc: a message from the lead or another
  // teammate wakes a teammate) — dispatch a turn that carries the inbox.
  // Without this, mail to an agent between turns is a dead letter until the
  // work loop happens to re-dispatch it, and a blocked teammate never hears
  // the advice that would unblock it.
  if (!controller || controller.stopped) return
  for (const agentId of wake) {
    if (controller.turnInFlight.has(agentId)) continue
    const recipient = agentsById.get(agentId)
    if (!recipient || recipient.status === 'stopped' || recipient.status === 'failed') continue
    if (recipient.role === 'lead') {
      void dispatchLeadIntervention(controller)
    } else {
      // Fresh advice deserves fresh patience: reset the stall counter so the
      // woken teammate gets its continuation nudge again.
      for (const key of [...controller.nudges.keys()]) {
        if (key.startsWith(`${agentId}:`)) controller.nudges.delete(key)
      }
      void dispatchTeammateWork(controller, agentId)
    }
  }
}

/**
 * A message nobody has answered gets exactly one fresh, visible nudge: a
 * reminder to the original recipient plus a status ping to the run's lead.
 * `escalated_at` is stamped up front so a message is only ever escalated
 * once — this is a safety net for mail that was handed off (delivered) but
 * never actually acted on (recipient crashed, forgot, or its CLI process
 * was compacted before it replied), not a repeating nag loop.
 */
async function escalateStaleReplyRequiredMessages(runId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - REPLY_ESCALATION_MS).toISOString()
  const newMessageIds: string[] = []
  await enqueueWrite((db) => {
    const stale = db.prepare(`
      SELECT * FROM protocol_messages
      WHERE run_id = ? AND reply_required = 1 AND resolved_at IS NULL
        AND escalated_at IS NULL AND delivered_at IS NOT NULL AND created_at < ?
    `).all(runId, cutoff) as Row[]
    if (stale.length === 0) return
    const agents = listAgentsSync(db, runId)
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
    const lead = agents.find((agent) => agent.role === 'lead')
    const ts = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of stale) {
        const message = rowToMessage(row)
        db.prepare('UPDATE protocol_messages SET escalated_at = ? WHERE id = ?').run(ts, message.id)
        const recipient = agentsById.get(message.toAgentId)
        if (!recipient) continue
        newMessageIds.push(insertMessageSync(db, {
          runId,
          fromAgentId: 'coordinator',
          toAgentId: recipient.id,
          body: `Reminder: reply required — you have not answered "${message.body.slice(0, 160)}" (sent ${message.createdAt}).`,
          ts,
          kind: 'request',
          priority: 'urgent',
          replyRequired: true,
          correlationId: message.correlationId ?? message.id,
        }))
        if (lead && lead.id !== recipient.id) {
          const fromName = agentsById.get(message.fromAgentId)?.name ?? 'a teammate'
          newMessageIds.push(insertMessageSync(db, {
            runId,
            fromAgentId: 'coordinator',
            toAgentId: lead.id,
            body: `${recipient.name} has not replied to a reply-required message from ${fromName} in over ${Math.round(REPLY_ESCALATION_MS / 60_000)}m.`,
            ts,
            kind: 'status',
          }))
        }
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  if (newMessageIds.length > 0) notifyRunChanged(runId)
  return newMessageIds
}

/**
 * The mailbox's only durability guarantee: every active run gets retried
 * delivery attempts and reply-required escalation for its whole lifetime,
 * independent of whether the original insert's fire-and-forget delivery
 * succeeded. Cheap when idle (one indexed query per run, no active runs is
 * one query total) so it just runs for the life of the process.
 */
async function sweepMailboxes(): Promise<void> {
  const db = await getDatabase()
  const runs = db.prepare(`
    SELECT id FROM protocol_runs WHERE status IN ('planning', 'running', 'synthesizing', 'blocked')
  `).all() as Row[]
  for (const row of runs) {
    const runId = String(row.id)
    const undelivered = db.prepare('SELECT id FROM protocol_messages WHERE run_id = ? AND delivered_at IS NULL')
      .all(runId) as Row[]
    if (undelivered.length > 0) {
      await deliverMessagesLive(runId, undelivered.map((entry) => String(entry.id))).catch(() => {})
    }
    const escalated = await escalateStaleReplyRequiredMessages(runId).catch(() => [] as string[])
    if (escalated.length > 0) await deliverMessagesLive(runId, escalated).catch(() => {})
  }
}

let mailSweepTimer: ReturnType<typeof setInterval> | null = null

function ensureMailSweep(): void {
  if (mailSweepTimer) return
  mailSweepTimer = setInterval(() => { void sweepMailboxes().catch(() => {}) }, MAIL_SWEEP_INTERVAL_MS)
  mailSweepTimer.unref?.()
}

ensureMailSweep()

/**
 * Wake the lead mid-run to unstick the team. Budgeted (MAX_LEAD_INTERVENTIONS)
 * so lead↔teammate loops terminate; past the budget, stuck tasks are
 * auto-failed by the work loop instead.
 */
async function dispatchLeadIntervention(controller: RunController): Promise<void> {
  if (controller.stopped || controller.synthesisStarted) return
  const db = await getDatabase()
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(controller.runId) as Row | undefined
  if (!runRow || rowToRun(runRow).status !== 'running') return
  const agents = listAgentsSync(db, controller.runId)
  const lead = agents.find((agent) => agent.role === 'lead')
  if (!lead || controller.turnInFlight.has(lead.id)) return
  const tasks = listTasksSync(db, controller.runId)
  const reviewingPlans = controller.requirePlanApproval && tasks.some((task) => task.status === 'planned')
  if (!reviewingPlans && controller.interventionsUsed >= MAX_LEAD_INTERVENTIONS) return
  if (!reviewingPlans) controller.interventionsUsed += 1
  const inbox = await enqueueWrite((tx) => takeInboxSync(tx, controller.runId, lead.id))
  const message = buildLeadInterventionPreamble({
    runId: controller.runId,
    agent: lead,
    roster: agents,
    tasks,
    inbox,
    agentsById: new Map(agents.map((agent) => [agent.id, agent])),
    interventionsLeft: MAX_LEAD_INTERVENTIONS - controller.interventionsUsed,
    requirePlanApproval: controller.requirePlanApproval,
    reviewingPlans,
  })
  void dispatchAgentTurn(controller, lead.id, message)
}

function takeInboxSync(db: SqliteDatabase, runId: string, agentId: string): ProtocolMessage[] {
  const rows = db.prepare('SELECT * FROM protocol_messages WHERE run_id = ? AND to_agent_id = ? AND delivered_at IS NULL ORDER BY created_at ASC')
    .all(runId, agentId) as Row[]
  const messages = rows.map(rowToMessage)
  if (messages.length > 0) {
    const ts = nowIso()
    for (const message of messages) {
      db.prepare('UPDATE protocol_messages SET delivered_at = ? WHERE id = ?').run(ts, message.id)
    }
  }
  return messages
}

// ---------------------------------------------------------------------------
// Turn plumbing: dispatch a turn to an agent's session, drain its stream for
// protocol events, and feed the work loop when the stream ends.

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return
  if (typeof value === 'string') {
    if (value.includes('agent-protocol')) out.push(value)
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1)
    return
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStrings(item, out, depth + 1)
  }
}

function parseProtocolEventsFromWire(text: string): AgentProtocolEvent[] {
  const events = [...parseAgentProtocolEvents(text)]
  if (!text.includes('data:')) return events
  const strings: string[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice('data:'.length).trim()
    if (!raw || raw === '[DONE]') continue
    try {
      collectStrings(JSON.parse(raw), strings)
    } catch {
      // Incomplete SSE frame; the next chunk will retry with a larger buffer.
    }
  }
  for (const value of strings) {
    events.push(...parseAgentProtocolEvents(value))
  }
  return events
}

const SESSION_EVENT_RE = /event: session\s*\ndata: (\{[^\n]*\})/

/** Completion gate: reject a task.completed whose worktree changed paths outside the agent's locks. */
async function completionGateFailure(
  runId: string,
  agentId: string,
  worktreePath: string,
  taskId?: string,
): Promise<string[] | null> {
  const db = await getDatabase()
  const runRow = db.prepare('SELECT use_worktrees FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  // A shared checkout cannot reliably attribute concurrent file changes to a
  // specific participant. Task path locks still prevent conflicting claims,
  // while the configured gate command validates the combined checkout.
  if (runRow && !Boolean(Number(runRow.use_worktrees ?? 1))) return null
  const locks = (db.prepare(`
    SELECT * FROM protocol_locks
    WHERE run_id = ? AND agent_id = ? AND status = 'active' AND lease_expires_at > ?
  `).all(runId, agentId, nowIso()) as Row[]).map(rowToLock)
  if (locks.some((lock) => lock.path === '**' && lock.mode === 'write')) return null
  let files = await changedPaths(worktreePath).catch(() => [] as string[])
  if (taskId) {
    const row = db.prepare(`
      SELECT snapshot_json FROM protocol_task_baselines
      WHERE run_id = ? AND task_id = ? AND agent_id = ?
    `).get(runId, taskId, agentId) as Row | undefined
    if (typeof row?.snapshot_json === 'string') {
      let baseline: Record<string, string> = {}
      try { baseline = JSON.parse(row.snapshot_json) as Record<string, string> } catch { /* fall back to all changes */ }
      // Baseline capture failed at claim (recorded with an audit event then):
      // fail open rather than rejecting completions for pre-existing changes.
      if (baseline.__baselineUnavailable === '1') return null
      const current = await worktreeChangeSnapshot(worktreePath).catch(() => ({} as Record<string, string>))
      const changedSinceClaim = Object.keys(current)
        .filter((file) => file !== '__head__' && current[file] !== baseline[file])
      const baselineHead = baseline.__head__
      const currentHead = current.__head__
      if (baselineHead && currentHead && baselineHead !== currentHead) {
        const committed = await changedPathsBetween(worktreePath, baselineHead, currentHead).catch(() => [] as string[])
        changedSinceClaim.push(...committed)
      }
      files = [...new Set(changedSinceClaim)]
    }
  }
  const uncovered = files.filter((file) => !locks.some((lock) => lock.mode === 'write' && lockPathsOverlap(lock.path, file)))
  return uncovered.length > 0 ? uncovered : null
}

async function drainAgentStream(controller: RunController, agent: ProtocolAgent, response: Response): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  let realized = false
  const seen = new Set<string>()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 250_000) buffer = buffer.slice(-120_000)

      // Pending sessions realize their real id mid-turn — later steers and
      // interrupts must target it.
      if (!realized) {
        const match = buffer.match(SESSION_EVENT_RE)
        if (match) {
          realized = true
          try {
            const sessionId = (JSON.parse(match[1]!) as { sessionId?: unknown }).sessionId
            if (typeof sessionId === 'string' && sessionId && sessionId !== agent.sessionId) {
              controller.sessionIds.set(agent.id, sessionId)
              await enqueueWrite((db) => {
                db.prepare('UPDATE protocol_agents SET session_id = ?, updated_at = ? WHERE id = ? AND run_id = ?')
                  .run(sessionId, nowIso(), agent.id, controller.runId)
              })
            }
          } catch {
            // malformed session frame — keep the draft id
          }
        }
      }

      const events = parseProtocolEventsFromWire(buffer)
      for (const event of events) {
        const key = JSON.stringify(event)
        if (seen.has(key)) continue
        seen.add(key)
        if (event.runId !== controller.runId || event.agentId !== agent.id) continue
        await applyAgentEvent(controller, agent, event)
      }
    }
  } catch (err) {
    await appendProtocolEvent({
      version: AGENT_PROTOCOL_VERSION,
      runId: controller.runId,
      agentId: agent.id,
      type: 'agent.blocked',
      summary: err instanceof Error ? err.message : 'Worker stream failed',
    }).catch(() => {})
  }
}

/** Event application with coordinator-side gating (doc: TaskCompleted hook semantics). */
async function applyAgentEvent(controller: RunController, agent: ProtocolAgent, event: AgentProtocolEvent): Promise<void> {
  if (event.type === 'task.completed' && agent.role === 'teammate' && event.taskId) {
    if (controller.requirePlanApproval) {
      const db = await getDatabase()
      if (!taskPlanApprovedSync(db, controller.runId, event.taskId)) {
        const note = `Completion of ${event.taskId} was REJECTED: this run requires lead plan approval before implementation. Emit \`task.planned\` with your approach and wait for \`plan.approved\` before completing.`
        controller.dispatchNotes.set(agent.id, note)
        await appendProtocolEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId: controller.runId,
          agentId: agent.id,
          type: 'agent.blocked',
          taskId: event.taskId,
          summary: `task.completed rejected — plan approval required`,
          detail: note,
        })
        return
      }
    }
    const uncovered = await completionGateFailure(controller.runId, agent.id, agent.worktreePath)
    if (uncovered) {
      const note = `Completion of ${event.taskId} was REJECTED: your worktree has changes outside your locked paths (${uncovered.slice(0, 6).join(', ')}). Request the locks with \`lock.requested\` or revert those files, then complete again.`
      controller.dispatchNotes.set(agent.id, note)
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: agent.id,
        type: 'agent.blocked',
        taskId: event.taskId,
        paths: uncovered,
        summary: `task.completed rejected — changes outside granted locks`,
        detail: note,
      })
      return
    }
    // Run-level quality gate (the doc's TaskCompleted hook): the configured
    // command must pass in the teammate's worktree or the completion bounces
    // back with the failure output.
    if (controller.gateCommand) {
      const failure = await runGateCommand(controller.gateCommand, agent.worktreePath)
      if (failure) {
        const note = `Completion of ${event.taskId} was REJECTED by the quality gate \`${controller.gateCommand}\`:\n${failure}\nFix the failures, re-run the gate yourself, then complete again.`
        controller.dispatchNotes.set(agent.id, note)
        await appendProtocolEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId: controller.runId,
          agentId: agent.id,
          type: 'agent.blocked',
          taskId: event.taskId,
          summary: `task.completed rejected — quality gate failed`,
          detail: note,
        })
        return
      }
    }
  }
  await appendProtocolEvent(event)
}

/** Run the gate in a worktree; null = pass, otherwise the failure output tail. */
function runGateCommand(command: string, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], {
      cwd,
      encoding: 'utf8',
      timeout: 5 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (!err) {
        resolve(null)
        return
      }
      const output = `${String(stdout ?? '')}\n${String(stderr ?? '')}`.trim()
      resolve(output.slice(-1500) || (err instanceof Error ? err.message : 'gate command failed'))
    })
  })
}

async function dispatchAgentTurn(
  controller: RunController,
  agentId: string,
  message: string,
  opts: { permissionMode?: 'plan' } = {},
): Promise<void> {
  if (controller.stopped || controller.turnInFlight.has(agentId)) return
  controller.turnInFlight.add(agentId)
  try {
    const db = await getDatabase()
    const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE id = ? AND run_id = ?').get(agentId, controller.runId) as Row | undefined
    if (!agentRow) return
    const agent = rowToAgent(agentRow)
    const sessionId = controller.sessionIds.get(agent.id) ?? agent.sessionId
    const isPending = controller.pendingSessions.has(agent.id)
    controller.pendingSessions.delete(agent.id)
    const response = await streamViewSessionTurn({
      sessionId,
      signal: new AbortController().signal,
      provider: agent.provider,
      body: {
        message,
        provider: agent.provider,
        cwd: agent.worktreePath,
        isPendingSession: isPending ? true : undefined,
        model: controller.model,
        effort: controller.effort,
        detachOnClientAbort: true,
        ...(opts.permissionMode && agent.provider === 'claude' ? { permissionMode: opts.permissionMode } : {}),
      },
    })
    if (!response.ok) {
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: agent.id,
        type: 'agent.blocked',
        taskId: agent.taskId,
        summary: `Failed to start turn: HTTP ${response.status}`,
      })
      return
    }
    await drainAgentStream(controller, agent, response)
  } finally {
    controller.turnInFlight.delete(agentId)
  }
  await handleAgentTurnEnd(controller, agentId).catch(() => {})
}

/** Compose and dispatch a teammate turn from current ledger state. */
async function dispatchTeammateWork(controller: RunController, agentId: string): Promise<void> {
  const db = await getDatabase()
  const agents = listAgentsSync(db, controller.runId)
  const agentsById = new Map(agents.map((entry) => [entry.id, entry]))
  const agent = agentsById.get(agentId)
  if (!agent) return
  const tasks = listTasksSync(db, controller.runId)
  // Blocked tasks stay dispatchable: a woken teammate resumes the task its
  // inbox advice is about, rather than being told to claim something else.
  const task = tasks.find((entry) =>
    entry.id === agent.taskId
    && (entry.status === 'claimed' || entry.status === 'planning' || entry.status === 'planned' || entry.status === 'in_progress' || entry.status === 'blocked')) ?? null
  const note = controller.dispatchNotes.get(agentId)

  if (task && shouldPlanTaskSync(db, controller, task)) {
    const planState = taskPlanStateSync(db, controller.runId, task.id)
    if (planState === 'awaiting' || task.status === 'planned') return
    const inbox = await enqueueWrite((tx) => takeInboxSync(tx, controller.runId, agentId))
    controller.dispatchNotes.delete(agentId)
    await enqueueWrite((tx) => {
      const ts = nowIso()
      tx.prepare("UPDATE protocol_tasks SET status = 'planning', updated_at = ? WHERE id = ? AND run_id = ?")
        .run(ts, task.id, controller.runId)
      setAgentStatusSync(tx, controller.runId, agent.id, 'working', ts)
    })
    const message = buildTeammatePlanPreamble({
      runId: controller.runId,
      agent,
      roster: agents,
      task,
      allTasks: tasks,
      inbox,
      agentsById,
      note,
      useWorktrees: controller.useWorktrees,
    })
    void dispatchAgentTurn(controller, agentId, message, { permissionMode: 'plan' })
    return
  }

  const inbox = await enqueueWrite((tx) => takeInboxSync(tx, controller.runId, agentId))
  controller.dispatchNotes.delete(agentId)
  const message = buildTeammateTurnPreamble({
    runId: controller.runId,
    agent,
    roster: agents,
    task,
    allTasks: tasks,
    inbox,
    agentsById,
    note,
    gateCommand: controller.gateCommand,
    requirePlanApproval: controller.requirePlanApproval,
    useWorktrees: controller.useWorktrees,
  })
  void dispatchAgentTurn(controller, agentId, message)
}

/**
 * Work loop: when a teammate's turn ends — finished mid-task (nudge once, then
 * block + tell the lead), or between tasks (self-claim the next unblocked one)
 * — and kick off synthesis when the whole board is terminal.
 */
async function handleAgentTurnEnd(controller: RunController, agentId: string): Promise<void> {
  if (controller.stopped) return
  const db = await getDatabase()
  const agents = listAgentsSync(db, controller.runId)
  const agent = agents.find((entry) => entry.id === agentId)
  if (!agent) return

  if (agent.role === 'lead') {
    await handleLeadTurnEnd(controller)
    return
  }

  const tasks = listTasksSync(db, controller.runId)
  const owned = tasks.find((task) =>
    task.ownerAgentId === agentId
    && (task.status === 'claimed' || task.status === 'planning' || task.status === 'in_progress' || task.status === 'blocked'))

  if (owned) {
    const nudgeKey = `${agentId}:${owned.id}`
    const used = controller.nudges.get(nudgeKey) ?? 0
    if (used < MAX_TURN_NUDGES) {
      controller.nudges.set(nudgeKey, used + 1)
      if (!controller.dispatchNotes.has(agentId)) {
        controller.dispatchNotes.set(agentId, `Your previous turn ended while ${owned.id} was still open. Continue the task, or emit task.failed / agent.blocked with the reason.`)
      }
      await dispatchTeammateWork(controller, agentId)
      return
    }
    if (controller.interventionsUsed >= MAX_LEAD_INTERVENTIONS) {
      // Intervention budget spent — fail the task so the run can still reach
      // synthesis instead of stalling forever on one stuck teammate.
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId,
        type: 'task.failed',
        taskId: owned.id,
        summary: `${owned.id} auto-failed: ${agent.name} stalled and the lead intervention budget is exhausted`,
      })
      await maybeStartSynthesis(controller)
      return
    }
    // Out of nudges: surface it (doc: idle teammates notify the lead). The
    // message wakes the lead for an intervention turn.
    await appendProtocolEvent({
      version: AGENT_PROTOCOL_VERSION,
      runId: controller.runId,
      agentId,
      type: 'agent.blocked',
      taskId: owned.id,
      summary: `${agent.name} stalled on ${owned.id} after ${MAX_TURN_NUDGES + 1} turns`,
    })
    await appendProtocolEvent({
      version: AGENT_PROTOCOL_VERSION,
      runId: controller.runId,
      agentId,
      type: 'message',
      to: 'lead',
      summary: `${agent.name} is stuck on ${owned.id} and needs help or reassignment.`,
    })
    return
  }

  const awaitingPlanApproval = tasks.find((task) =>
    task.ownerAgentId === agentId
    && task.status === 'planned'
    && controller.requirePlanApproval)
  if (awaitingPlanApproval) {
    await dispatchLeadIntervention(controller)
    return
  }

  // Between tasks: self-claim the next pending unblocked task.
  const claimed = await enqueueWrite((tx) => claimTaskSync(tx, controller.runId, agentId))
  if (claimed) {
    await dispatchTeammateWork(controller, agentId)
    return
  }

  // Nothing left for this teammate.
  await enqueueWrite((tx) => {
    setAgentStatusSync(tx, controller.runId, agentId, 'done', nowIso())
  })
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: controller.runId,
    agentId,
    type: 'message',
    to: 'lead',
    summary: `${agent.name} finished — no claimable tasks remain.`,
  })
  await maybeStartSynthesis(controller)
}

async function maybeStartSynthesis(controller: RunController): Promise<void> {
  if (controller.stopped || controller.synthesisStarted) return
  const db = await getDatabase()
  const tasks = listTasksSync(db, controller.runId)
  const unfinished = tasks.some((task) => task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')
  if (tasks.length === 0 || unfinished) return
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(controller.runId) as Row | undefined
  if (!runRow) return
  const run = rowToRun(runRow)
  const lead = listAgentsSync(db, controller.runId).find((agent) => agent.role === 'lead')
  if (!lead) return
  controller.synthesisStarted = true
  await enqueueWrite((tx) => {
    tx.prepare('UPDATE protocol_runs SET status = ?, updated_at = ? WHERE id = ?').run('synthesizing', nowIso(), controller.runId)
  })
  const agents = listAgentsSync(db, controller.runId)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const knowledgeRows = db.prepare(
    "SELECT * FROM protocol_events WHERE run_id = ? AND type IN ('finding', 'learning') ORDER BY created_at ASC LIMIT 120",
  ).all(controller.runId) as Row[]
  const message = buildLeadSynthesisPreamble({
    runId: controller.runId,
    agent: lead,
    prompt: run.prompt,
    tasks,
    knowledge: knowledgeRows.map((row) => ({
      agentId: String(row.agent_id),
      type: String(row.type),
      summary: typeof row.summary === 'string' ? row.summary : undefined,
      detail: typeof row.detail === 'string' ? row.detail : undefined,
    })),
    agentsById,
    useWorktrees: controller.useWorktrees,
  })
  void dispatchAgentTurn(controller, lead.id, message)
}

async function handleLeadTurnEnd(controller: RunController): Promise<void> {
  const db = await getDatabase()
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(controller.runId) as Row | undefined
  if (!runRow) return
  const run = rowToRun(runRow)

  if (run.status === 'planning') {
    await beginExecutionPhase(controller)
    return
  }

  if (run.status === 'running') {
    // An intervention turn ended: the lead goes back to standby, and its
    // decisions (task.failed / task.created) may have finished the board.
    await enqueueWrite((tx) => {
      setAgentStatusSync(tx, controller.runId, run.leadAgentId ?? 'lead', 'idle', nowIso())
    })
    await maybeStartSynthesis(controller)
    return
  }

  if (run.status === 'synthesizing') {
    // The lead's final `finding` is the run summary.
    const findingRow = db.prepare(
      "SELECT * FROM protocol_events WHERE run_id = ? AND agent_id = ? AND type = 'finding' ORDER BY created_at DESC LIMIT 1",
    ).get(controller.runId, run.leadAgentId ?? 'lead') as Row | undefined
    const summary = findingRow
      ? [findingRow.summary, findingRow.detail].filter((part) => typeof part === 'string' && part).join('\n\n')
      : undefined
    await enqueueWrite((tx) => {
      const ts = nowIso()
      tx.prepare('UPDATE protocol_runs SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
        .run('completed', summary ?? null, ts, controller.runId)
      tx.prepare("UPDATE protocol_agents SET status = 'done', updated_at = ? WHERE run_id = ? AND status NOT IN ('failed', 'stopped')")
        .run(ts, controller.runId)
    })
    controllers.delete(controller.runId)
    void cleanupProtocolRunWorktrees(controller.runId).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Run lifecycle

/** Spawn teammates against the (lead-authored or fallback) task board and start the loop. */
async function beginExecutionPhase(controller: RunController): Promise<void> {
  if (controller.stopped) return
  const db = await getDatabase()
  let tasks = listTasksSync(db, controller.runId)
  if (tasks.length === 0) {
    // Lead produced nothing usable — fall back to role lanes so the run still works.
    await enqueueWrite((tx) => {
      for (const template of fallbackTaskTemplates(controller.prompt, Math.max(1, controller.maxAgents - 1))) {
        insertTaskSync(tx, controller.runId, { ...template, blockedBy: [] })
      }
    })
    tasks = listTasksSync(db, controller.runId)
  }

  const teammateCount = Math.max(1, Math.min(controller.maxAgents - 1, tasks.length))
  const ts = nowIso()
  for (let index = 0; index < teammateCount; index += 1) {
    if (controller.stopped) return
    const name = TEAMMATE_NAMES[index % TEAMMATE_NAMES.length]!
    let workspace: { path: string; branch: string }
    let session: Awaited<ReturnType<typeof createNewViewSession>>
    try {
      workspace = controller.useWorktrees
        ? await createWorktreeTask(controller.baseCwd, `${controller.title ?? 'coord'}-${name}`)
        : { path: controller.baseCwd, branch: '' }
      session = await createNewViewSession({
        provider: controller.teammateProviders[index % controller.teammateProviders.length] ?? controller.provider,
        cwd: workspace.path,
        title: `${controller.title ?? 'Coordinated run'} · ${name}`,
      })
    } catch (err) {
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: 'lead',
        type: 'agent.blocked',
        summary: `Failed to spawn teammate ${name}: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => {})
      continue
    }
    const agentId = `agent-${index + 1}`
    await enqueueWrite((tx) => {
      tx.prepare(`
        INSERT INTO protocol_agents (
          id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, task_id, status, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'teammate', ?, ?, ?, ?, NULL, 'idle', NULL, ?, ?)
      `).run(agentId, controller.runId, name, session.provider, session.sessionId, workspace.path, workspace.branch, ts, ts)
      claimTaskSync(tx, controller.runId, agentId)
    })
    if (session.isPending) controller.pendingSessions.add(agentId)
    controller.sessionIds.set(agentId, session.sessionId)
  }

  await enqueueWrite((tx) => {
    tx.prepare('UPDATE protocol_runs SET status = ?, updated_at = ? WHERE id = ?').run('running', nowIso(), controller.runId)
  })
  // Planning is over — the lead stands by for interventions and synthesis.
  await enqueueWrite((tx) => {
    setAgentStatusSync(tx, controller.runId, 'lead', 'idle', nowIso())
  })
  const spawned = listAgentsSync(db, controller.runId).filter((agent) => agent.role === 'teammate')
  for (const agent of spawned) {
    await dispatchTeammateWork(controller, agent.id)
  }
}

/**
 * Start a coordinated run: create the LEAD session immediately (returned so
 * the UI can open its tab), then asynchronously run the phases — lead plans
 * the task board, teammates spawn into their configured checkouts and work the claim loop,
 * lead synthesizes when the board is done.
 */
export async function startProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  const prompt = params.prompt.trim()
  if (!prompt) throw new Error('prompt is required')
  const runId = randomUUID()
  const ts = nowIso()
  const maxAgents = Math.max(2, Math.min(params.maxAgents, 6))
  const teammateProviders = [...new Set(params.teammateProviders?.filter(Boolean) ?? [])]
  if (teammateProviders.length === 0) teammateProviders.push(params.provider)

  const leadSession = await createNewViewSession({
    provider: params.provider,
    cwd: params.baseCwd,
    title: `${params.title ?? 'Coordinated run'} · lead`,
  })

  const controller: RunController = {
    runId,
    prompt,
    provider: params.provider,
    teammateProviders,
    baseCwd: params.baseCwd,
    maxAgents,
    title: params.title,
    model: params.model,
    effort: params.effort,
    gateCommand: params.gateCommand?.trim() || undefined,
    requirePlanApproval: params.requirePlanApproval === true,
    useWorktrees: params.useWorktrees !== false,
    stopped: false,
    synthesisStarted: false,
    interventionsUsed: 0,
    turnInFlight: new Set(),
    sessionIds: new Map([['lead', leadSession.sessionId]]),
    pendingSessions: new Set(leadSession.isPending ? ['lead'] : []),
    nudges: new Map(),
    dispatchNotes: new Map(),
  }
  controllers.set(runId, controller)

  const snapshot = await enqueueWrite((db) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO protocol_runs (
          id, prompt, status, provider, base_cwd, max_agents, lead_agent_id, summary,
          gate_command, require_plan_approval, use_worktrees, created_at, updated_at
        )
        VALUES (?, ?, 'planning', ?, ?, ?, 'lead', NULL, ?, ?, ?, ?, ?)
      `).run(
        runId,
        prompt,
        params.provider,
        params.baseCwd,
        maxAgents,
        controller.gateCommand ?? null,
        controller.requirePlanApproval ? 1 : 0,
        controller.useWorktrees ? 1 : 0,
        ts,
        ts,
      )
      db.prepare(`
        INSERT INTO protocol_agents (
          id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, task_id, status, last_seen_at, created_at, updated_at
        ) VALUES ('lead', ?, 'lead', 'lead', ?, ?, ?, '', NULL, 'working', NULL, ?, ?)
      `).run(runId, leadSession.provider, leadSession.sessionId, params.baseCwd, ts, ts)
      db.exec('COMMIT')
      const next = readSnapshotSync(db, runId)
      if (!next) throw new Error('Failed to read created run')
      return next
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })

  const planMessage = buildLeadPlanPreamble({
    runId,
    agent: { id: 'lead', name: 'lead' },
    prompt,
    teammateCount: maxAgents - 1,
    useWorktrees: controller.useWorktrees,
  })
  void dispatchAgentTurn(controller, 'lead', planMessage).catch(async (err) => {
    await appendProtocolEvent({
      version: AGENT_PROTOCOL_VERSION,
      runId,
      agentId: 'lead',
      type: 'agent.blocked',
      summary: err instanceof Error ? err.message : 'Failed to launch lead',
    }).catch(() => {})
  })

  return {
    snapshot,
    sessions: [{
      sessionId: leadSession.sessionId,
      provider: leadSession.provider,
      cwd: leadSession.cwd,
      summary: 'Team lead',
      isPending: leadSession.isPending,
    }],
  }
}

/** Stop the run: halt the loop, interrupt every agent's live turn, release locks. */
export async function stopProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  const controller = controllers.get(runId)
  if (controller) controller.stopped = true
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  await Promise.allSettled(agents.flatMap((agent) => {
    const ids = new Set([agent.sessionId, controller?.sessionIds.get(agent.id)].filter((id): id is string => Boolean(id)))
    return [...ids].map((id) => interruptRunningSession(id).catch(() => {}))
  }))
  controllers.delete(runId)
  return enqueueWrite((tx) => {
    const ts = nowIso()
    tx.prepare('UPDATE protocol_runs SET status = ?, updated_at = ? WHERE id = ?').run('stopped', ts, runId)
    tx.prepare("UPDATE protocol_agents SET status = ?, updated_at = ? WHERE run_id = ? AND status NOT IN ('done', 'failed', 'stopped')")
      .run('stopped', ts, runId)
    tx.prepare("UPDATE protocol_locks SET status = ?, updated_at = ? WHERE run_id = ? AND status = 'active'")
      .run('released', ts, runId)
    return readSnapshotSync(tx, runId)
  })
}

/**
 * Delete a run outright: halt its loop, interrupt live turns, sweep worktrees
 * (force-removing only clean/retired ones — worktrees with uncommitted agent
 * work are KEPT and reported, since deleting them silently would destroy the
 * only copy; they remain manageable as ordinary worktree tasks), then
 * cascade-delete the ledger rows (agents/tasks/locks/events/messages).
 */
export async function deleteProtocolRun(runId: string): Promise<{ deleted: boolean; keptWorktrees: string[] }> {
  const controller = controllers.get(runId)
  if (controller) controller.stopped = true
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  await Promise.allSettled(agents.flatMap((agent) => {
    const ids = new Set([agent.sessionId, controller?.sessionIds.get(agent.id)].filter((id): id is string => Boolean(id)))
    return [...ids].map((id) => interruptRunningSession(id).catch(() => {}))
  }))
  controllers.delete(runId)
  // Sweep worktrees regardless of agent status, but only remove pristine ones
  // (no dirty files, no unmerged commits) — never destroy the only copy of an
  // agent's work as a side effect of tidying the board.
  const keptWorktrees: string[] = []
  for (const agent of agents) {
    if (agent.role !== 'teammate' || !agent.worktreePath || !agent.worktreeBranch) continue
    const worktree = await findWorktreeTaskForCwd(agent.worktreePath).catch(() => null)
    if (!worktree) continue
    if (worktree.dirtyFiles === 0 && worktree.aheadCommits === 0) {
      await removeWorktreeTask(worktree, { force: true }).catch(() => keptWorktrees.push(worktree.path))
    } else {
      keptWorktrees.push(worktree.path)
    }
  }
  const deleted = await enqueueWrite((tx) => {
    const result = tx.prepare('DELETE FROM protocol_runs WHERE id = ?').run(runId) as { changes?: number | bigint } | undefined
    return Number(result?.changes ?? 0) > 0
  })
  return { deleted, keptWorktrees }
}

// ---------------------------------------------------------------------------
// Worktree merge gate (used by the worktree merge flow)

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr ?? '') || (err instanceof Error ? err.message : String(err))))
        return
      }
      resolve(String(stdout ?? '').trim())
    })
  })
}

async function changedPaths(cwd: string): Promise<string[]> {
  const out = await new Promise<string>((resolve, reject) => {
    execFile('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr ?? '') || (err instanceof Error ? err.message : String(err))))
      else resolve(String(stdout ?? ''))
    })
  })
  if (!out) return []
  const entries = out.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const status = entry.slice(0, 2)
    const file = entry.slice(3)
    if (file) paths.push(normalizeLockPath(file.includes(' -> ') ? file.split(' -> ').at(-1) ?? file : file))
    if (status.includes('R') || status.includes('C')) index += 1
  }
  return paths
}

async function pathFingerprint(cwd: string, file: string): Promise<string> {
  const absolute = path.join(cwd, file)
  try {
    const stats = await lstat(absolute)
    if (stats.isSymbolicLink()) return `symlink:${await readFile(absolute, 'utf8').catch(() => '')}`
    if (!stats.isFile()) return `other:${stats.mode}:${stats.size}:${stats.mtimeMs}`
    return `file:${createHash('sha256').update(await readFile(absolute)).digest('hex')}`
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : `error:${String(error)}`
  }
}

async function worktreeChangeSnapshot(cwd: string): Promise<Record<string, string>> {
  const files = await changedPaths(cwd)
  const snapshot = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await pathFingerprint(cwd, file)])))
  snapshot.__head__ = await execGit(cwd, ['rev-parse', 'HEAD'])
  return snapshot
}

async function changedPathsBetween(cwd: string, from: string, to: string): Promise<string[]> {
  const output = await execGit(cwd, ['diff', '--name-only', '-z', `${from}..${to}`])
  return output.split('\0').map(normalizeLockPath).filter(Boolean)
}

export async function cleanupProtocolRunWorktrees(
  runId: string,
  opts: { force?: boolean } = {},
): Promise<{ results: ProtocolWorktreeCleanupResult[]; snapshot: ProtocolRunSnapshot | null }> {
  const db = await getDatabase()
  const snapshot = readSnapshotSync(db, runId)
  if (!snapshot) return { results: [], snapshot: null }
  const teammateAgents = snapshot.agents.filter((agent) =>
    agent.role === 'teammate'
    && (agent.status === 'done' || (opts.force && (agent.status === 'stopped' || agent.status === 'failed'))))
  const results: ProtocolWorktreeCleanupResult[] = []
  for (const agent of teammateAgents) {
    const base = {
      agentId: agent.id,
      agentName: agent.name,
      path: agent.worktreePath,
      branch: agent.worktreeBranch,
    }
    if (!agent.worktreeBranch) {
      results.push({ ...base, status: 'skipped', reason: 'agent used the shared checkout' })
      continue
    }
    const task = await findWorktreeTaskForCwd(agent.worktreePath).catch(() => null)
    if (!task) {
      results.push({ ...base, status: 'missing', reason: 'worktree already removed' })
      continue
    }
    if (!opts.force && task.dirtyFiles !== 0) {
      results.push({
        ...base,
        status: 'skipped',
        reason: 'worktree has uncommitted changes',
        dirtyFiles: task.dirtyFiles,
        aheadCommits: task.aheadCommits,
      })
      continue
    }
    if (!opts.force && task.aheadCommits !== 0) {
      results.push({
        ...base,
        status: 'skipped',
        reason: 'branch has unmerged commits',
        dirtyFiles: task.dirtyFiles,
        aheadCommits: task.aheadCommits,
      })
      continue
    }
    try {
      await removeWorktreeTask(task, { force: opts.force })
      results.push({
        ...base,
        status: 'removed',
        dirtyFiles: task.dirtyFiles,
        aheadCommits: task.aheadCommits,
      })
    } catch (err) {
      results.push({
        ...base,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
        dirtyFiles: task.dirtyFiles,
        aheadCommits: task.aheadCommits,
      })
    }
  }

  const removed = results.filter((result) => result.status === 'removed')
  if (removed.length > 0) {
    await enqueueWrite((tx) => {
      const ts = nowIso()
      for (const result of removed) {
        insertEventSync(tx, {
          version: AGENT_PROTOCOL_VERSION,
          runId,
          agentId: result.agentId,
          type: 'handoff',
          summary: `Cleaned up worktree ${result.branch}`,
          detail: result.path,
          timestamp: ts,
        })
      }
      tx.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, runId)
    })
  }
  return { results, snapshot: await readProtocolRun(runId) }
}

export async function validateWorktreeTaskLocks(task: WorktreeTask): Promise<{ ok: true } | { ok: false; message: string; paths: string[] }> {
  const db = await getDatabase()
  const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE worktree_path = ? ORDER BY created_at DESC LIMIT 1').get(task.path) as Row | undefined
  if (!agentRow) return { ok: true }
  const agent = rowToAgent(agentRow)
  const locks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND agent_id = ? AND status = 'active'")
    .all(agent.runId, agent.id) as Row[]).map(rowToLock)
  if (locks.some((lock) => lock.path === '**' && lock.mode === 'write')) return { ok: true }
  const files = await changedPaths(task.path)
  const uncovered = files.filter((file) => !locks.some((lock) => lock.mode === 'write' && lockPathsOverlap(lock.path, file)))
  if (uncovered.length === 0) return { ok: true }
  return {
    ok: false,
    paths: uncovered,
    message: `Worktree has changes outside ${agent.name}'s granted protocol locks: ${uncovered.slice(0, 6).join(', ')}`,
  }
}
