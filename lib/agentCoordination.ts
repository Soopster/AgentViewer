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
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  AGENT_PROTOCOL_VERSION,
  buildLeadInterventionPreamble,
  buildLeadPlanPreamble,
  buildLeadSynthesisPreamble,
  buildTeammatePlanPreamble,
  buildTeammateTurnPreamble,
  fallbackTaskTemplates,
  parseAgentProtocolEvents,
  type AgentProtocolEvent,
  type ProtocolAgent,
  type ProtocolAgentStatus,
  type ProtocolLock,
  type ProtocolLockStatus,
  type ProtocolMessage,
  type ProtocolRun,
  type ProtocolRunSnapshot,
  type ProtocolRunStatus,
  type ProtocolTask,
  type ProtocolTaskStatus,
  type ProtocolWorktreeCleanupResult,
  type StartProtocolRunParams,
  type StartProtocolRunResult,
} from './agentProtocol'
import { createNewViewSession, streamViewSessionTurn } from './sessionBackend'
import { interruptRunningSession, steerRunningSession } from './sessionRuntime'
import { createWorktreeTask, findWorktreeTaskForCwd, removeWorktreeTask, type WorktreeTask } from './worktreeTasks'

type SqliteDatabase = any
type Row = Record<string, unknown>

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination')
const DB_FILE = path.join(DATA_DIR, 'coordination.sqlite')
const LOCK_LEASE_MS = 20 * 60_000
const SCHEMA_VERSION = 4
const EVENT_WINDOW = 300
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
  baseCwd: string
  maxAgents: number
  title?: string
  model?: string
  effort?: string
  gateCommand?: string
  requirePlanApproval: boolean
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
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS protocol_messages_run_idx ON protocol_messages(run_id, to_agent_id, delivered_at);
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
    return db
  } catch (err) {
    db.close()
    throw err
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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToAgent(row: Row): ProtocolAgent {
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
  return {
    id: String(row.id),
    runId: String(row.run_id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    body: String(row.body),
    createdAt: String(row.created_at),
    deliveredAt: typeof row.delivered_at === 'string' ? row.delivered_at : undefined,
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

function readSnapshotSync(db: SqliteDatabase, runId: string): ProtocolRunSnapshot | null {
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) return null
  const agents = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? ORDER BY created_at ASC').all(runId).map(rowToAgent)
  const tasks = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? ORDER BY created_at ASC').all(runId).map(rowToTask)
  const locks = db.prepare('SELECT * FROM protocol_locks WHERE run_id = ? ORDER BY created_at ASC').all(runId).map(rowToLock)
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
}): ProtocolLock {
  const requestedPath = normalizeLockPath(params.path)
  const activeRows = db.prepare('SELECT * FROM protocol_locks WHERE run_id = ? AND status = ?').all(params.runId, 'active') as Row[]
  const active = activeRows.map(rowToLock)
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
  return lock
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
    createdAt: ts,
    updatedAt: ts,
  }
  db.prepare(`
    INSERT INTO protocol_tasks (
      id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, runId, task.title, task.prompt, 'pending', null, JSON.stringify(task.paths), JSON.stringify(task.blockedBy), ts, ts)
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
}): string {
  const id = randomUUID()
  db.prepare(`
    INSERT INTO protocol_messages (id, run_id, from_agent_id, to_agent_id, body, created_at, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(id, params.runId, params.fromAgentId, params.toAgentId, params.body, params.ts)
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
        setAgentStatusSync(db, event.runId, event.agentId, 'failed', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'failed', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
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
        for (const recipient of resolveRecipientsSync(db, event.runId, event.agentId, event.to)) {
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: event.agentId,
            toAgentId: recipient,
            body,
            ts,
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
    const delivered = await steerRunningSession(sessionId, text).catch(() => false)
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
async function completionGateFailure(runId: string, agentId: string, worktreePath: string): Promise<string[] | null> {
  const db = await getDatabase()
  const locks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND agent_id = ? AND status = 'active'")
    .all(runId, agentId) as Row[]).map(rowToLock)
  if (locks.some((lock) => lock.path === '**' && lock.mode === 'write')) return null
  const files = await changedPaths(worktreePath).catch(() => [] as string[])
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
      for (const template of fallbackTaskTemplates(controller.prompt, controller.maxAgents)) {
        insertTaskSync(tx, controller.runId, { ...template, blockedBy: [] })
      }
    })
    tasks = listTasksSync(db, controller.runId)
  }

  const teammateCount = Math.max(1, Math.min(controller.maxAgents, tasks.length))
  const ts = nowIso()
  for (let index = 0; index < teammateCount; index += 1) {
    if (controller.stopped) return
    const name = TEAMMATE_NAMES[index % TEAMMATE_NAMES.length]!
    let worktree: WorktreeTask
    let session: Awaited<ReturnType<typeof createNewViewSession>>
    try {
      worktree = await createWorktreeTask(controller.baseCwd, `${controller.title ?? 'coord'}-${name}`)
      session = await createNewViewSession({
        provider: controller.provider,
        cwd: worktree.path,
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
      `).run(agentId, controller.runId, name, session.provider, session.sessionId, worktree.path, worktree.branch, ts, ts)
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
 * the task board, teammates spawn into worktrees and work the claim loop,
 * lead synthesizes when the board is done.
 */
export async function startProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  const prompt = params.prompt.trim()
  if (!prompt) throw new Error('prompt is required')
  const runId = randomUUID()
  const ts = nowIso()
  const maxAgents = Math.max(1, Math.min(params.maxAgents, 6))

  const leadSession = await createNewViewSession({
    provider: params.provider,
    cwd: params.baseCwd,
    title: `${params.title ?? 'Coordinated run'} · lead`,
  })

  const controller: RunController = {
    runId,
    prompt,
    provider: params.provider,
    baseCwd: params.baseCwd,
    maxAgents,
    title: params.title,
    model: params.model,
    effort: params.effort,
    gateCommand: params.gateCommand?.trim() || undefined,
    requirePlanApproval: params.requirePlanApproval === true,
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
          gate_command, require_plan_approval, created_at, updated_at
        )
        VALUES (?, ?, 'planning', ?, ?, ?, 'lead', NULL, ?, ?, ?, ?)
      `).run(
        runId,
        prompt,
        params.provider,
        params.baseCwd,
        maxAgents,
        controller.gateCommand ?? null,
        controller.requirePlanApproval ? 1 : 0,
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
    teammateCount: maxAgents,
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
    if (agent.role !== 'teammate' || !agent.worktreePath) continue
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
  const out = await execGit(cwd, ['status', '--porcelain=v1', '-z'])
  if (!out) return []
  const entries = out.split('\0').filter(Boolean)
  const paths: string[] = []
  for (const entry of entries) {
    const file = entry.slice(3).trim()
    if (file) paths.push(normalizeLockPath(file.includes(' -> ') ? file.split(' -> ').at(-1) ?? file : file))
  }
  return paths
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
