import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  AGENT_PROTOCOL_VERSION,
  buildProtocolPreamble,
  parseAgentProtocolEvents,
  type AgentProtocolEvent,
  type ProtocolAgent,
  type ProtocolAgentStatus,
  type ProtocolLock,
  type ProtocolLockStatus,
  type ProtocolRun,
  type ProtocolRunSnapshot,
  type ProtocolRunStatus,
  type ProtocolTask,
  type ProtocolTaskStatus,
  type StartProtocolRunParams,
  type StartProtocolRunResult,
} from './agentProtocol'
import { createNewViewSession, streamViewSessionTurn } from './sessionBackend'
import { createWorktreeTask, type WorktreeTask } from './worktreeTasks'

type SqliteDatabase = any
type Row = Record<string, unknown>

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination')
const DB_FILE = path.join(DATA_DIR, 'coordination.sqlite')
const LOCK_LEASE_MS = 20 * 60_000
const SCHEMA_VERSION = 1

let database: SqliteDatabase | null = null
let databaseOpenPromise: Promise<SqliteDatabase> | null = null
let writeQueue: Promise<unknown> = Promise.resolve()

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocol_agents (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      worktree_branch TEXT NOT NULL,
      task_id TEXT,
      status TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS protocol_agents_run_idx ON protocol_agents(run_id);
    CREATE INDEX IF NOT EXISTS protocol_agents_session_idx ON protocol_agents(session_id);

    CREATE TABLE IF NOT EXISTS protocol_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_agent_id TEXT,
      paths_json TEXT NOT NULL,
      blocked_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
  `)
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
}

async function openDatabase(): Promise<SqliteDatabase> {
  const sqliteMod = await (0, eval)('import("node:sqlite")') as typeof import('node:sqlite')
  const { DatabaseSync } = sqliteMod
  await ensureDirs()
  const db = new DatabaseSync(DB_FILE)
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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function rowToAgent(row: Row): ProtocolAgent {
  return {
    id: String(row.id),
    runId: String(row.run_id),
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
  const events = db.prepare('SELECT * FROM protocol_events WHERE run_id = ? ORDER BY created_at ASC LIMIT 300').all(runId).map(rowToEvent)
  return { run: rowToRun(runRow), agents, tasks, locks, events }
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

export async function appendProtocolEvent(event: AgentProtocolEvent): Promise<ProtocolRunSnapshot | null> {
  return enqueueWrite((db) => {
    const ts = event.timestamp ?? nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      insertEventSync(db, { ...event, timestamp: ts })
      db.prepare('UPDATE protocol_agents SET last_seen_at = ?, updated_at = ? WHERE id = ? AND run_id = ?')
        .run(ts, ts, event.agentId, event.runId)
      if (event.type === 'agent.ready') {
        db.prepare('UPDATE protocol_agents SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
          .run('ready', ts, event.agentId, event.runId)
      } else if (event.type === 'agent.start_work') {
        db.prepare('UPDATE protocol_agents SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
          .run('working', ts, event.agentId, event.runId)
        if (event.taskId) {
          db.prepare('UPDATE protocol_tasks SET status = ?, owner_agent_id = ?, updated_at = ? WHERE id = ? AND run_id = ?')
            .run('in_progress', event.agentId, ts, event.taskId, event.runId)
        }
      } else if (event.type === 'agent.blocked') {
        db.prepare('UPDATE protocol_agents SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
          .run('blocked', ts, event.agentId, event.runId)
        if (event.taskId) {
          db.prepare('UPDATE protocol_tasks SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
            .run('blocked', ts, event.taskId, event.runId)
        }
      } else if (event.type === 'task.completed') {
        db.prepare('UPDATE protocol_agents SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
          .run('done', ts, event.agentId, event.runId)
        if (event.taskId) {
          db.prepare('UPDATE protocol_tasks SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
            .run('completed', ts, event.taskId, event.runId)
        }
      } else if (event.type === 'task.failed') {
        db.prepare('UPDATE protocol_agents SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
          .run('failed', ts, event.agentId, event.runId)
        if (event.taskId) {
          db.prepare('UPDATE protocol_tasks SET status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
            .run('failed', ts, event.taskId, event.runId)
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
      }
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, event.runId)
      db.exec('COMMIT')
      return readSnapshotSync(db, event.runId)
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
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

function taskTemplates(prompt: string, maxAgents: number): Array<{ title: string; prompt: string; paths: string[] }> {
  const capped = Math.max(1, Math.min(maxAgents, 6))
  const templates = [
    {
      title: 'Implementation worker',
      prompt: `Implement the requested change end to end. Coordinate through AVP/1 before touching new paths.\n\nOriginal prompt:\n${prompt}`,
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
  ]
  return templates.slice(0, capped)
}

function drainProtocolStream(params: {
  runId: string
  agentId: string
  response: Response
}): void {
  void (async () => {
    const reader = params.response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    const seen = new Set<string>()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 250_000) buffer = buffer.slice(-120_000)
        const events = parseProtocolEventsFromWire(buffer)
        for (const event of events) {
          const key = JSON.stringify(event)
          if (seen.has(key)) continue
          seen.add(key)
          if (event.runId === params.runId && event.agentId === params.agentId) {
            await appendProtocolEvent(event)
          }
        }
      }
    } catch (err) {
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: params.runId,
        agentId: params.agentId,
        type: 'agent.blocked',
        summary: err instanceof Error ? err.message : 'Worker stream failed',
      }).catch(() => {})
    }
  })()
}

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

async function launchWorkerTurn(params: {
  runId: string
  agent: ProtocolAgent
  task: ProtocolTask
  allTasks: ProtocolTask[]
  isPending: boolean
  model?: string
  effort?: string
}): Promise<void> {
  const message = buildProtocolPreamble({
    runId: params.runId,
    agentId: params.agent.id,
    taskId: params.task.id,
    taskTitle: params.task.title,
    taskPrompt: params.task.prompt,
    paths: params.task.paths,
    allTasks: params.allTasks,
  })
  const response = await streamViewSessionTurn({
    sessionId: params.agent.sessionId,
    signal: new AbortController().signal,
    provider: params.agent.provider,
    body: {
      message,
      provider: params.agent.provider,
      cwd: params.agent.worktreePath,
      isPendingSession: params.isPending ? true : undefined,
      model: params.model,
      effort: params.effort,
      detachOnClientAbort: true,
    },
  })
  if (!response.ok) {
    await appendProtocolEvent({
      version: AGENT_PROTOCOL_VERSION,
      runId: params.runId,
      agentId: params.agent.id,
      type: 'agent.blocked',
      taskId: params.task.id,
      summary: `Failed to start worker turn: HTTP ${response.status}`,
    })
    return
  }
  drainProtocolStream({ runId: params.runId, agentId: params.agent.id, response })
}

export async function startProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  const prompt = params.prompt.trim()
  if (!prompt) throw new Error('prompt is required')
  const runId = randomUUID()
  const ts = nowIso()
  const tasks = taskTemplates(prompt, params.maxAgents).map((task, index): ProtocolTask => ({
    id: `task-${index + 1}`,
    runId,
    title: task.title,
    prompt: task.prompt,
    status: 'pending',
    paths: task.paths,
    blockedBy: [],
    createdAt: ts,
    updatedAt: ts,
  }))

  const sessionResults: StartProtocolRunResult['sessions'] = []
  const agents: ProtocolAgent[] = []
  const worktrees: WorktreeTask[] = []
  for (const task of tasks) {
    const worktree = await createWorktreeTask(params.baseCwd, `${params.title ?? 'coord'}-${task.id}`)
    worktrees.push(worktree)
    const session = await createNewViewSession({
      provider: params.provider,
      cwd: worktree.path,
      title: `${params.title ?? 'Coordinated run'} · ${task.title}`,
    })
    const agent: ProtocolAgent = {
      id: `agent-${agents.length + 1}`,
      runId,
      provider: session.provider,
      sessionId: session.sessionId,
      worktreePath: worktree.path,
      worktreeBranch: worktree.branch,
      taskId: task.id,
      status: 'idle',
      createdAt: ts,
      updatedAt: ts,
    }
    agents.push(agent)
    sessionResults.push({
      sessionId: session.sessionId,
      provider: session.provider,
      cwd: session.cwd,
      summary: task.title,
      isPending: session.isPending,
    })
  }

  const snapshot = await enqueueWrite((db) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO protocol_runs (id, prompt, status, provider, base_cwd, max_agents, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(runId, prompt, 'running', params.provider, params.baseCwd, tasks.length, ts, ts)
      for (const task of tasks) {
        db.prepare(`
          INSERT INTO protocol_tasks (
            id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(task.id, runId, task.title, task.prompt, 'claimed', null, JSON.stringify(task.paths), JSON.stringify([]), ts, ts)
      }
      for (const agent of agents) {
        db.prepare(`
          INSERT INTO protocol_agents (
            id, run_id, provider, session_id, worktree_path, worktree_branch, task_id, status, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(agent.id, runId, agent.provider, agent.sessionId, agent.worktreePath, agent.worktreeBranch, agent.taskId ?? null, 'idle', null, ts, ts)
        if (agent.taskId) {
          db.prepare('UPDATE protocol_tasks SET owner_agent_id = ? WHERE id = ? AND run_id = ?').run(agent.id, agent.taskId, runId)
          insertEventSync(db, {
            version: AGENT_PROTOCOL_VERSION,
            runId,
            agentId: agent.id,
            type: 'task.claimed',
            taskId: agent.taskId,
            summary: `${agent.id} claimed ${agent.taskId}`,
            timestamp: ts,
          })
        }
      }
      for (const task of tasks) {
        const agent = agents.find((candidate) => candidate.taskId === task.id)
        if (!agent) continue
        for (const lockPath of task.paths) {
          acquireLockSync(db, {
            runId,
            agentId: agent.id,
            taskId: task.id,
            path: lockPath,
            mode: 'write',
          })
        }
      }
      db.exec('COMMIT')
      const next = readSnapshotSync(db, runId)
      if (!next) throw new Error('Failed to read created run')
      return next
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })

  for (const agent of agents) {
    const task = tasks.find((candidate) => candidate.id === agent.taskId)
    const session = sessionResults.find((candidate) => candidate.sessionId === agent.sessionId)
    if (!task || !session) continue
    void launchWorkerTurn({
      runId,
      agent,
      task,
      allTasks: tasks,
      isPending: session.isPending,
      model: params.model,
      effort: params.effort,
    }).catch((err) => {
      void appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: agent.id,
        type: 'agent.blocked',
        taskId: agent.taskId,
        summary: err instanceof Error ? err.message : 'Failed to launch worker',
      })
    })
  }

  return { snapshot, sessions: sessionResults }
}

export async function stopProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  return enqueueWrite((db) => {
    const ts = nowIso()
    db.prepare('UPDATE protocol_runs SET status = ?, updated_at = ? WHERE id = ?').run('stopped', ts, runId)
    db.prepare("UPDATE protocol_agents SET status = ?, updated_at = ? WHERE run_id = ? AND status NOT IN ('done', 'failed', 'stopped')")
      .run('stopped', ts, runId)
    db.prepare("UPDATE protocol_locks SET status = ?, updated_at = ? WHERE run_id = ? AND status = 'active'")
      .run('released', ts, runId)
    return readSnapshotSync(db, runId)
  })
}

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
    message: `Worktree has changes outside ${agent.id}'s granted protocol locks: ${uncovered.slice(0, 6).join(', ')}`,
  }
}
