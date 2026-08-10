// Coordinator for A2A 1.0 multi-agent runs, modeled on Claude Code agent teams:
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
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  AGENT_PROTOCOL_VERSION,
  EXTERNAL_COORD_PROTOCOL_VERSION,
  MIN_EXTERNAL_COORD_PROTOCOL_VERSION,
  buildLeadInterventionPreamble,
  buildLeadPlanPreamble,
  buildLeadSynthesisPreamble,
  buildSdkToolsTickPrompt,
  buildTeammatePlanPreamble,
  buildTeammateTurnPreamble,
  fallbackTaskTemplates,
  formatInbox,
  interpolatePlaybookText,
  isValidPlaybookName,
  parseAgentProtocolEvents,
  parseRunPlaybook,
  playbookExpectsArgs,
  taskStateFromStatus,
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
  type ExternalProtocolMessageResult,
  type ExternalProtocolMutationResult,
  type ExternalProtocolParticipant,
  type ExternalProtocolParticipantResult,
  type ExternalProtocolReleaseResult,
  type ExternalProtocolStatusResult,
  type ExternalProtocolContextResult,
  type ExternalProtocolTaskCreateResult,
  type ExternalProtocolWaitResult,
  type JoinExternalProtocolRunParams,
  type PlaybookSummary,
  type ProtocolAgent,
  type ProtocolAgentLivenessStatus,
  type ProtocolAgentRespondToMode,
  type ProtocolAgentStatus,
  type ProtocolContextMatch,
  type ProtocolDeliveryHint,
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
  type ProtocolTaskTargetRole,
  type ProtocolWorktreeCleanupResult,
  type RunPlaybook,
  type StartProtocolRunParams,
  type StartProtocolRunResult,
} from './agentProtocol'
import {
  registerCoordinatorMcpServer,
  unregisterCoordinatorMcpServer,
  registerCoordinatorPiTools,
  unregisterCoordinatorPiTools,
  registerCoordinatorCopilotTools,
  unregisterCoordinatorCopilotTools,
  registerCoordinatorCodexTools,
  unregisterCoordinatorCodexTools,
  buildCoordinatorCodexDynamicTools,
  registerCoordinatorOpenCodeTools,
  unregisterCoordinatorOpenCodeTools,
} from './agentCoordinationSdkTools'

// Providers whose SDK supports registering real in-process tools for a
// pooled session (see lib/agentCoordinationSdkTools.ts) — presence in
// controller.sdkIdentities is the switch that sends the short
// buildSdkToolsTickPrompt instead of the old fenced ```a2a preamble. OpenCode
// only gets these tools when this app is hosting its own managed OpenCode
// server (lib/opencodeClient.ts's startManagedServer path) — a session
// attached to an externally-managed `opencode serve` never has the
// coordinator plugin loaded, so it silently falls back to the fenced-block
// protocol working exactly as before (no coord_* tools available).
const IN_PROCESS_TOOL_PROVIDERS = new Set<ProtocolRun['provider']>(['claude', 'pi', 'copilot', 'codex', 'opencode'])

function registerCoordinatorToolsForProvider(provider: ProtocolRun['provider'], sessionId: string, identity: ExternalProtocolIdentity): void {
  if (provider === 'claude') registerCoordinatorMcpServer(sessionId, identity)
  else if (provider === 'pi') registerCoordinatorPiTools(sessionId, identity)
  else if (provider === 'copilot') registerCoordinatorCopilotTools(sessionId, identity)
  else if (provider === 'codex') registerCoordinatorCodexTools(sessionId, identity)
  else if (provider === 'opencode') registerCoordinatorOpenCodeTools(sessionId, identity)
}

function unregisterCoordinatorToolsForProvider(provider: ProtocolRun['provider'], sessionId: string): void {
  if (provider === 'claude') unregisterCoordinatorMcpServer(sessionId)
  else if (provider === 'pi') unregisterCoordinatorPiTools(sessionId)
  else if (provider === 'copilot') unregisterCoordinatorCopilotTools(sessionId)
  else if (provider === 'codex') unregisterCoordinatorCodexTools(sessionId)
  else if (provider === 'opencode') unregisterCoordinatorOpenCodeTools(sessionId)
}

// stopProtocolRun/deleteProtocolRun only know session ids, not the provider
// each belonged to (a failed-over agent may have started as one provider and
// ended as another) — unregister from every provider's registry to be safe;
// the ones a given session id was never registered in are cheap no-ops.
function unregisterCoordinatorToolsForSession(sessionId: string): void {
  for (const provider of IN_PROCESS_TOOL_PROVIDERS) unregisterCoordinatorToolsForProvider(provider, sessionId)
}

// OpenCode's coordinator plugin only loads on a server this app spawns and
// owns (lib/opencodeClient.ts) — an attached externally-managed `opencode
// serve` never has it, so an opencode agent there must stay on the
// fenced-block path instead of being minted a token for tools that don't
// exist on that server.
async function inProcessToolsAvailable(provider: ProtocolRun['provider']): Promise<boolean> {
  if (!IN_PROCESS_TOOL_PROVIDERS.has(provider)) return false
  if (provider === 'opencode') return isOpenCodeManagedServer()
  return true
}
import { createNewViewSession, streamViewSessionTurn } from './sessionBackend'
import { isOpenCodeManagedServer } from './opencodeClient'
import { getRunningSessionInfo, interruptRunningSession, steerRunningSession } from './sessionRuntime'
import { createWorktreeTask, findRepoRoot, findWorktreeTaskForCwd, removeWorktreeTask, type WorktreeTask } from './worktreeTasks'
import type { AgentProvider } from './types'

type SqliteDatabase = any
type Row = Record<string, unknown>

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination')
const DB_FILE = path.join(DATA_DIR, 'coordination.sqlite')
const LOCK_LEASE_MS = 20 * 60_000
// v11 → v12: protocol_push_configs table (A2A tasks/pushNotificationConfig/*)
// — a new IF-NOT-EXISTS table needs no ALTER migration, but the version bump
// keeps the meta row honest for anyone diagnosing schema drift.
// v15 → v16: last_report_at (reply guard — has this participant told the
// team anything since claiming its current task?), cancel_requested_at (lead
// can cancel a teammate's in-flight turn without releasing the task), and
// respond_to_mode/respond_to_allowlist_json (per-participant mailbox sender
// gating, mirroring buzz-acp's respond-to modes).
const SCHEMA_VERSION = 16
const EVENT_WINDOW = 300
const LOCK_HISTORY_WINDOW = 200
// Non-terminal tasks (pending/claimed/blocked) are always returned in full —
// that's exactly what claim eligibility and dependency display need. Terminal
// tasks (completed/failed/cancelled) are audit trail, windowed the same way
// LOCK_HISTORY_WINDOW bounds inactive locks, so a run that stays open for a
// long time (heavy discovered-work reuse, an autonomous loop that never
// finalizes) doesn't grow every coord_status/coord_wait payload — and the
// per-call DB/serialization cost with it — for the rest of its life.
const TERMINAL_TASK_HISTORY_WINDOW = 300
// Idempotency is a retry window, not an audit log. Bound it per participant so
// long-lived autonomous workers cannot retain an unbounded series of compact
// response snapshots while still leaving ample room for delayed retries.
const IDEMPOTENCY_WINDOW_PER_PARTICIPANT = Math.max(
  8,
  Number(process.env.AGENT_VIEWER_COORD_IDEMPOTENCY_WINDOW) || 512,
)
const LIVE_NOISE_WINDOW = Math.max(
  8,
  Number(process.env.AGENT_VIEWER_COORD_LIVE_NOISE_WINDOW) || 512,
)
const RUN_PRUNE_INTERVAL_MS = Math.max(
  100,
  Number(process.env.AGENT_VIEWER_COORD_PRUNE_INTERVAL_MS) || 60 * 60_000,
)
const PUSH_NOTIFICATION_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.AGENT_VIEWER_COORD_PUSH_TIMEOUT_MS) || 5_000,
)
const GIT_OPERATION_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.AGENT_VIEWER_COORD_GIT_TIMEOUT_MS) || 30_000,
)
const DATABASE_BUSY_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.AGENT_VIEWER_COORD_DB_BUSY_TIMEOUT_MS) || 5_000,
)
const SESSION_INTERRUPT_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.AGENT_VIEWER_COORD_SESSION_INTERRUPT_TIMEOUT_MS) || 5_000,
)
// In-process turns (lead/teammate sessions the TUI/web app hosts directly, as
// opposed to an external `coord worker` CLI) stream through drainAgentStream
// below. Unlike the external worker — which has always paired its provider
// tick with PROVIDER_TURN_TIMEOUT_MS/PROVIDER_INACTIVITY_TIMEOUT_MS — this
// path had no watchdog: a wedged pool subprocess that stops emitting chunks
// without closing its stream left turnInFlight set forever, and
// sweepIdleTeammates treats turnInFlight as "busy," so nothing ever reaped
// it. Same env vars as bin/agent-viewer-coord-worker.mjs so one setting
// governs both spawn paths.
const AGENT_TURN_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.AGENT_VIEWER_COORD_PROVIDER_TURN_TIMEOUT_MS) || 30 * 60_000,
)
const AGENT_TURN_INACTIVITY_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.AGENT_VIEWER_COORD_PROVIDER_INACTIVITY_TIMEOUT_MS) || 10 * 60_000,
)
const EXTERNAL_AGENT_STALE_MS = Math.max(60_000, Number(process.env.AGENT_VIEWER_COORD_STALE_MS) || 5 * 60_000)
// Interactive CLI participants (an MCP-bridged chat session, not a `coord
// worker`) only reach the board between their own turns, so a single long tool
// call — a full typecheck or test suite — can outlast the worker reap window
// while the agent is very much alive and mid-task. Reaping on the worker timer
// releases its claimed task underneath running work; hold them to a longer one.
const INTERACTIVE_AGENT_STALE_MS = Math.max(
  EXTERNAL_AGENT_STALE_MS,
  Number(process.env.AGENT_VIEWER_COORD_INTERACTIVE_STALE_MS) || 20 * 60_000,
)
// Below this age (or an in-flight turn) an agent counts as "fresh" for
// message delivery hints; above EXTERNAL_AGENT_STALE_MS it's "dead" — same
// two-threshold shape as murmur's classify(), reusing the reap cutoff above
// as the dead boundary so the two notions of staleness stay in lockstep.
const DELIVERY_HINT_FRESH_MS = 90_000
const MAIL_SWEEP_INTERVAL_MS = 5_000
const REPLY_ESCALATION_MS = 3 * 60_000
const STATUS_BATCH_THRESHOLD = 3
const STATUS_BATCH_MAX_WAIT_MS = 15_000
const SUPERVISION_CHECKPOINT_MS = Math.max(30_000, Number(process.env.AGENT_VIEWER_COORD_SUPERVISION_MS) || 90_000)
// One automatic re-dispatch when a teammate's turn ends mid-task; after that
// the teammate is marked blocked and the lead is notified (doc: teammates may
// stop on errors; the lead/user nudges or replaces them).
const MAX_TURN_NUDGES = 1
// Mid-run lead intervention turns (woken by teammate messages / stuck tasks).
// Bounded so a stuck teammate ↔ lead exchange can't ping-pong tokens forever;
// once exhausted, stuck tasks are auto-failed so the run reaches synthesis.
const MAX_LEAD_INTERVENTIONS = 3
// The whole team going idle with unfinished work on the board (see
// sweepIdleTeammates) is not a ping-pong risk — it happens at most once per
// genuine stall, and resolving it is the entire point of having a lead — so
// it draws from this small, separate budget instead of MAX_LEAD_INTERVENTIONS.
// Once this is also exhausted, the sweep fails the remaining tasks itself so
// the run always reaches synthesis instead of hanging forever.
const MAX_FORCED_INTERVENTIONS = 2
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
  /** Highest finding rowid visible when synthesis began; older findings are not final summaries. */
  synthesisFindingFloorRowid: number
  interventionsUsed: number
  /** Separate, small budget for forced whole-team-idle wakes (see sweepIdleTeammates) — never blocked by unrelated stall/plan-review spend. */
  forcedInterventionsUsed: number
  turnInFlight: Set<string>
  /** agentId → latest (realized) session id for steering/interrupting. */
  sessionIds: Map<string, string>
  /** agentId → session still pending its first turn. */
  pendingSessions: Set<string>
  /** `${agentId}:${taskId}` → nudges used. */
  nudges: Map<string, number>
  /** agentId → coordinator note to prepend to the next dispatched turn. */
  dispatchNotes: Map<string, string>
  /** Providers that failed durably for each agent; prevents failover loops. */
  failedProviders: Map<string, Set<ProtocolRun['provider']>>
  /**
   * agentId → Coordinator identity for agents dispatched with real coord_*
   * tool calls (lib/agentCoordinationSdkTools.ts) instead of the fenced
   * ```a2a text protocol. Currently Claude-provider agents only — other
   * providers' in-process SDKs don't support in-process MCP servers, so they
   * keep using the fenced-block path. Presence in this map is the switch:
   * dispatch sends a short tick prompt instead of the full board/roster/inbox
   * preamble, and drainAgentStream's fenced-block parsing simply finds
   * nothing to parse (the agent already applied every mutation directly).
   */
  sdkIdentities: Map<string, ExternalProtocolIdentity>
  /**
   * Set once beginExecutionPhase has been entered for this run. SDK-tool
   * leads can flip protocol_runs.status from 'planning' to 'running' mid-turn
   * (createExternalProtocolTask does this on the lead's first coord_create_task
   * call, a behavior kept for external MCP leads whose turn-end isn't hooked
   * to handleLeadTurnEnd). Gating teammate spawn on this flag instead of a
   * status read means handleLeadTurnEnd still spawns teammates even when the
   * status already reads 'running' by the time the lead's first turn ends.
   */
  executionStarted: boolean
  /** agentId → same-provider retries used since its last successful turn or failover. Reset on either. */
  sameProviderRetries: Map<string, number>
}

declare global {
  // Every other stateful singleton in this codebase (piSessionPool,
  // copilotSessionPool, the OpenCode/Codex clients, etc.) is preserved
  // across Next.js dev-mode module reloads via globalThis — this one wasn't,
  // and it is the single most consequential state in the whole coordinator
  // feature: a RunController holds every in-flight run's live session
  // bindings, turnInFlight tracking, and dispatch state, with no persistence
  // or recovery path if it's lost. A dev-mode Fast Refresh reload of this
  // module (or anything importing it) silently re-initializes `controllers`
  // to an empty Map, orphaning every in-flight run with no error surfaced
  // anywhere — the run's DB rows just stop progressing forever. Confirmed
  // via two live runs where the lead never resumed after teammates finished
  // even though nothing in the dispatch logic itself was at fault.
  // eslint-disable-next-line no-var
  var __agentViewerCoordinatorControllers: Map<string, RunController> | undefined
}

const controllers = globalThis.__agentViewerCoordinatorControllers
  ?? (globalThis.__agentViewerCoordinatorControllers = new Map<string, RunController>())

// In-process change signal so coord_wait wakes in milliseconds instead of on
// its fallback poll. All ledger writes flow through this process (web routes,
// MCP bridge HTTP, internal work loop), so an emitter is sufficient; the
// fallback poll in waitForExternalProtocolChange covers anything missed.
const runNotifier = new EventEmitter()
runNotifier.setMaxListeners(0)

function notifyRunChanged(runId: string): void {
  runNotifier.emit(`run:${runId}`)
  runNotifier.emit('run:changed', runId)
}

/**
 * Subscribe to durable Coordinator ledger changes made in this process.
 * Consumers must still reconcile periodically because another process can
 * write the shared SQLite ledger without touching this emitter.
 */
export function subscribeProtocolRunChanges(listener: (runId: string) => void): () => void {
  runNotifier.on('run:changed', listener)
  return () => { runNotifier.off('run:changed', listener) }
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
    PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS};
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
      target_role TEXT NOT NULL DEFAULT 'teammate',
      role_name TEXT,
      role_description TEXT,
      paths_json TEXT NOT NULL,
      blocked_by_json TEXT NOT NULL,
      phase TEXT,
      result_summary TEXT,
      result_detail TEXT,
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

    CREATE TABLE IF NOT EXISTS protocol_push_configs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES protocol_runs(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      url TEXT NOT NULL,
      token TEXT,
      auth_scheme TEXT,
      auth_credentials TEXT,
      last_task_updated_at TEXT,
      created_at TEXT NOT NULL,
      fired_at TEXT
    );

    CREATE INDEX IF NOT EXISTS protocol_push_configs_task_idx ON protocol_push_configs(run_id, task_id);
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
// v10 → v11: persist each task's terminal result so supervision and final
// synthesis do not depend on a bounded event-history window.
// v12 → v13: task role affinity keeps leads on supervision/integration lanes
// and teammates on execution lanes without relying on prompt interpretation.
// v13 → v14: A2A 1.0 separates a webhook verification token from HTTP
// authentication scheme/credentials.
// v14 → v15: remember the task revision last delivered to each webhook so
// every observed status change can be pushed, not only terminal completion.
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
  for (const statement of [
    'ALTER TABLE protocol_tasks ADD COLUMN result_summary TEXT',
    'ALTER TABLE protocol_tasks ADD COLUMN result_detail TEXT',
    'ALTER TABLE protocol_tasks ADD COLUMN role_name TEXT',
    'ALTER TABLE protocol_tasks ADD COLUMN role_description TEXT',
  ]) {
    try {
      db.exec(statement)
    } catch {
      // column already exists
    }
  }
  try {
    db.exec("ALTER TABLE protocol_tasks ADD COLUMN target_role TEXT NOT NULL DEFAULT 'teammate'")
  } catch {
    // column already exists
  }
  for (const statement of [
    'ALTER TABLE protocol_push_configs ADD COLUMN auth_scheme TEXT',
    'ALTER TABLE protocol_push_configs ADD COLUMN auth_credentials TEXT',
    'ALTER TABLE protocol_push_configs ADD COLUMN last_task_updated_at TEXT',
  ]) {
    try {
      db.exec(statement)
    } catch {
      // column already exists
    }
  }
  for (const statement of [
    'ALTER TABLE protocol_agents ADD COLUMN last_report_at TEXT',
    'ALTER TABLE protocol_agents ADD COLUMN cancel_requested_at TEXT',
    'ALTER TABLE protocol_agents ADD COLUMN respond_to_mode TEXT',
    'ALTER TABLE protocol_agents ADD COLUMN respond_to_allowlist_json TEXT',
  ]) {
    try {
      db.exec(statement)
    } catch {
      // column already exists
    }
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
  let DatabaseCtor: new (file: string, options?: { timeout?: number }) => SqliteDatabase
  let nodeSqlite = false
  try {
    const sqliteMod = await (0, eval)('import("node:sqlite")') as typeof import('node:sqlite')
    DatabaseCtor = sqliteMod.DatabaseSync as new (file: string, options?: { timeout?: number }) => SqliteDatabase
    nodeSqlite = true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/node:sqlite|No such built-in module|Cannot find/i.test(message)) throw err
    const bunSqlite = await (0, eval)('import("bun:sqlite")') as { Database: new (file: string) => SqliteDatabase }
    DatabaseCtor = bunSqlite.Database
  }
  await ensureDirs()
  const db = nodeSqlite
    ? new DatabaseCtor(DB_FILE, { timeout: DATABASE_BUSY_TIMEOUT_MS })
    : new DatabaseCtor(DB_FILE)
  try {
    configureDatabase(db)
    initializeSchema(db)
    pruneExpiredRunsSync(db)
    lastRunPruneAt = Date.now()
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
let lastRunPruneAt = 0

function pruneExpiredRunsSync(db: SqliteDatabase): void {
  try {
    const cutoff = new Date(Date.now() - RUN_RETENTION_MS).toISOString()
    db.prepare("DELETE FROM protocol_runs WHERE status IN ('completed', 'failed', 'stopped') AND updated_at < ?").run(cutoff)
  } catch {
    // Best-effort: a partially migrated schema must not block opening.
  }
}

function maybePruneExpiredRunsSync(db: SqliteDatabase): void {
  if (Date.now() - lastRunPruneAt < RUN_PRUNE_INTERVAL_MS) return
  lastRunPruneAt = Date.now()
  pruneExpiredRunsSync(db)
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
  const run = async () => {
    const db = await getDatabase()
    maybePruneExpiredRunsSync(db)
    return fn(db)
  }
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
    lastReportAt: typeof row.last_report_at === 'string' ? row.last_report_at : undefined,
    cancelRequestedAt: typeof row.cancel_requested_at === 'string' ? row.cancel_requested_at : undefined,
    respondTo: isRespondToMode(row.respond_to_mode)
      ? { mode: row.respond_to_mode, allowlist: parseJsonArray(row.respond_to_allowlist_json) }
      : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function isRespondToMode(value: unknown): value is ProtocolAgentRespondToMode {
  return value === 'owner-only' || value === 'allowlist' || value === 'anyone' || value === 'nobody'
}

const SEARCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were',
  'be', 'with', 'this', 'that', 'it', 'as', 'at', 'by', 'from', 'not', 'but', 'has', 'have',
])

function searchTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token))
}

/** Symmetric 0..1 overlap between two token sets — used for near-duplicate task detection. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Asymmetric relevance score for a search query against a longer document — used by coord_query_context. */
function queryOverlapScore(queryTokens: Set<string>, docTokens: Set<string>): number {
  if (!queryTokens.size || !docTokens.size) return 0
  let hits = 0
  for (const token of queryTokens) if (docTokens.has(token)) hits += 1
  return hits === 0 ? 0 : hits / Math.sqrt(docTokens.size)
}

const SIMILAR_TASK_THRESHOLD = 0.3

function findSimilarTasksSync(
  db: SqliteDatabase,
  runId: string,
  title: string,
  detail: string,
  excludeTaskId?: string,
): Array<{ taskId: string; title: string; similarity: number }> {
  const queryTokens = new Set(searchTokens(`${title} ${detail}`))
  if (!queryTokens.size) return []
  const existing = listTasksSync(db, runId).filter((task) => task.id !== excludeTaskId)
  return existing
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      similarity: jaccardSimilarity(queryTokens, new Set(searchTokens(`${task.title} ${task.prompt}`))),
    }))
    .filter((match) => match.similarity >= SIMILAR_TASK_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
}

function rowToTask(row: Row): ProtocolTask {
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
    resultSummary: typeof row.result_summary === 'string' && row.result_summary ? row.result_summary : undefined,
    resultDetail: typeof row.result_detail === 'string' && row.result_detail ? row.result_detail : undefined,
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
 * Mark agents whose turn is streaming right now (best-effort, process-local —
 * accurate in the process that runs the work loop, where web routes and the
 * in-process TUI read from) and attach each agent's fresh/stale/dead liveness
 * classification, so a lead can see who is actually reachable directly from
 * coord_status/coord_wait instead of sending a probe message first.
 */
function annotateLiveTurns(runId: string, agents: ProtocolAgent[]): ProtocolAgent[] {
  const controller = controllers.get(runId)
  return agents.map((agent) => {
    const sessionId = controller?.sessionIds.get(agent.id) ?? agent.sessionId
    const turnActive = controller?.turnInFlight.has(agent.id) === true
      || getRunningSessionInfo(sessionId).running
    const withTurn = turnActive ? { ...agent, turnActive } : agent
    return { ...withTurn, liveness: classifyAgentLiveness(withTurn) }
  })
}

function classifyAgentLiveness(agent: ProtocolAgent): { status: ProtocolAgentLivenessStatus; ageSeconds: number | null } {
  if (agent.turnActive) return { status: 'fresh', ageSeconds: 0 }
  if (!agent.lastSeenAt) return { status: 'dead', ageSeconds: null }
  const ageMs = Date.now() - new Date(agent.lastSeenAt).getTime()
  const ageSeconds = Math.max(0, Math.round(ageMs / 1000))
  if (ageMs <= DELIVERY_HINT_FRESH_MS) return { status: 'fresh', ageSeconds }
  if (ageMs <= EXTERNAL_AGENT_STALE_MS) return { status: 'stale', ageSeconds }
  return { status: 'dead', ageSeconds }
}

/** Delivery hints for coord_send_message: each resolved recipient's liveness at send time. */
function deliveryHintsSync(db: SqliteDatabase, runId: string, recipientIds: string[]): ProtocolDeliveryHint[] {
  if (recipientIds.length === 0) return []
  const placeholders = recipientIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM protocol_agents WHERE run_id = ? AND id IN (${placeholders})`)
    .all(runId, ...recipientIds) as Row[]
  const agents = annotateLiveTurns(runId, rows.map(rowToAgent))
  return agents.map((agent) => ({ name: agent.name, ...(agent.liveness ?? classifyAgentLiveness(agent)) }))
}

function readSnapshotSync(db: SqliteDatabase, runId: string): ProtocolRunSnapshot | null {
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) return null
  const agents = annotateLiveTurns(runId, db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? ORDER BY created_at ASC').all(runId).map(rowToAgent))
  const activeTasks = db.prepare(`
    SELECT * FROM protocol_tasks WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at ASC
  `).all(runId).map(rowToTask)
  const recentTerminalTasks = (db.prepare(`
    SELECT * FROM protocol_tasks WHERE run_id = ? AND status IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at DESC LIMIT ?
  `).all(runId, TERMINAL_TASK_HISTORY_WINDOW) as Row[]).map(rowToTask).reverse()
  const tasks = [...recentTerminalTasks, ...activeTasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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

export async function listProtocolTasksForFacade(params: {
  runId?: string
  statuses?: ProtocolTaskStatus[]
  updatedAfter?: string
  offset: number
  limit: number
}): Promise<{ tasks: ProtocolTask[]; total: number }> {
  const db = await getDatabase()
  const where: string[] = []
  const values: Array<string | number> = []
  if (params.runId) {
    where.push('run_id = ?')
    values.push(params.runId)
  }
  if (params.statuses?.length) {
    where.push(`status IN (${params.statuses.map(() => '?').join(', ')})`)
    values.push(...params.statuses)
  }
  if (params.updatedAfter) {
    where.push('updated_at >= ?')
    values.push(params.updatedAfter)
  }
  const predicate = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM protocol_tasks${predicate}`)
    .get(...values) as Row | undefined
  const offset = Math.max(0, Math.trunc(params.offset))
  const limit = Math.max(1, Math.min(100, Math.trunc(params.limit)))
  const rows = db.prepare(
    `SELECT * FROM protocol_tasks${predicate} ORDER BY updated_at DESC, run_id DESC, id DESC LIMIT ? OFFSET ?`,
  ).all(...values, limit, offset) as Row[]
  return { tasks: rows.map(rowToTask), total: Number(totalRow?.count) || 0 }
}

export async function listProtocolRuns(limit = 20): Promise<ProtocolRun[]> {
  const db = await getDatabase()
  const rows = db.prepare('SELECT * FROM protocol_runs ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(limit, 100))) as Row[]
  return rows.map(rowToRun)
}

export async function listProtocolRunsPage(offset: number, limit: number): Promise<ProtocolRun[]> {
  const db = await getDatabase()
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 101))
  const rows = db.prepare(
    'SELECT * FROM protocol_runs ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(safeLimit, safeOffset) as Row[]
  return rows.map(rowToRun)
}

export async function countProtocolRuns(): Promise<number> {
  const db = await getDatabase()
  const row = db.prepare('SELECT COUNT(*) AS count FROM protocol_runs').get() as Row | undefined
  return Number(row?.count) || 0
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
  const ahpClientId = capabilities?.ahpClientId?.trim().slice(0, 200) || undefined
  return {
    client: {
      name: client?.name.trim().slice(0, 80) || 'legacy-mcp-client',
      version: client?.version?.trim().slice(0, 80) || undefined,
      protocolVersion,
    },
    capabilities: {
      ...(ahpClientId === undefined ? {} : { ahpClientId }),
      ...(capabilities?.unattended === true ? { unattended: true } : {}),
      ...(capabilities?.sessionResume === true ? { sessionResume: true } : {}),
      ...(capabilities?.midTurnSteer === true ? { midTurnSteer: true } : {}),
      ...(capabilities?.filesystemWrite === true ? { filesystemWrite: true } : {}),
      ...(capabilities?.git === true ? { git: true } : {}),
      ...(capabilities?.browser === true ? { browser: true } : {}),
      ...(maxParallelTasks === undefined ? {} : { maxParallelTasks }),
      ...(tools === undefined ? {} : { tools }),
    },
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
const EXTERNAL_FINDING_WINDOW = 100

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
  const visibleEvents = snapshot.events
    .filter((event) => event.type !== 'message' || event.agentId === agentId)
  const retainedEvents = new Set([
    ...visibleEvents.filter((event) => event.type === 'finding').slice(-EXTERNAL_FINDING_WINDOW),
    ...visibleEvents.slice(-EXTERNAL_EVENT_WINDOW),
  ])
  return {
    ...snapshot,
    // Mail is consumed through the cursor-aware inbox API. Repeating up to 200
    // historical bodies on every status/wait response made context scale with
    // run age without helping the next decision.
    messages: [],
    // Keep other agents' direct message text out of the shared event timeline.
    // Findings are durable audit evidence rather than live noise. Preserve a
    // larger bounded finding window alongside the normal recent-event window
    // so verification lanes can actually inspect every reported issue.
    events: visibleEvents.filter((event) => retainedEvents.has(event)),
  }
}

function externalActionableSync(db: SqliteDatabase, runId: string, agentId: string): ExternalProtocolActionable {
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) throw new Error('Coordinator run not found')
  const run = rowToRun(runRow)
  const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?')
    .get(runId, agentId) as Row | undefined
  const agent = agentRow ? rowToAgent(agentRow) : null
  const agents = listAgentsSync(db, runId)
  const tasks = listTasksSync(db, runId)
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const claimable = tasks.filter((task) => (
    task.status === 'pending' && !task.ownerAgentId && taskDepsCompleted(task, tasksById)
      && Boolean(agent && taskClaimableByAgent(task, agent, agents))
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
  const replyGuard = agent && myTaskRow ? replyGuardCheckSync(db, runId, agent, myTaskRow.id) : null
  return {
    runStatus: run.status,
    claimableTasks: claimable.map((task) => ({ id: task.id, title: task.title, targetRole: task.targetRole })),
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
    replyGuardDue: replyGuard?.due ?? false,
    replyGuardReminder: replyGuard?.reminder,
  }
}

// How long a participant may hold a task while working without telling the
// team anything before the reply guard fires. Long enough that one slow
// provider tick isn't a false positive; short enough to catch a genuinely
// silent worker within a couple of tick cycles.
const REPLY_GUARD_SILENCE_MS = 3 * 60_000
// Cap consecutive reminders — advisory, not a trap, mirroring buzz-agent's
// reply guard: nag a couple of times, then let the participant work in
// peace rather than nag every single tick forever.
const REPLY_GUARD_MAX_REMINDERS = 2

/**
 * Reply guard: has this participant told the team anything (an explicit
 * report, or any event that queued a message to the lead — see
 * REPLY_GUARD_REPORT_EVENT_TYPES / appendProtocolEvent) since it claimed its
 * current task? Claim time comes from protocol_task_baselines, written at
 * claim (claimExternalProtocolTask) — the same row the outside-paths
 * completion gate already relies on, so no extra bookkeeping is needed.
 */
function replyGuardCheckSync(
  db: SqliteDatabase,
  runId: string,
  agent: ProtocolAgent,
  taskId: string,
): { due: boolean; reminder?: string } | null {
  if (agent.status !== 'working') return null
  const baselineRow = db.prepare(
    'SELECT created_at FROM protocol_task_baselines WHERE run_id = ? AND task_id = ? AND agent_id = ?',
  ).get(runId, taskId, agent.id) as Row | undefined
  const claimedAt = typeof baselineRow?.created_at === 'string' ? new Date(baselineRow.created_at).getTime() : NaN
  if (!Number.isFinite(claimedAt)) return null
  if (Date.now() - claimedAt < REPLY_GUARD_SILENCE_MS) return null
  const reportedAt = agent.lastReportAt ? new Date(agent.lastReportAt).getTime() : NaN
  const reportedSinceClaim = Number.isFinite(reportedAt) && reportedAt >= claimedAt
  if (reportedSinceClaim) return null
  const remindersSoFar = Math.floor((Date.now() - claimedAt) / REPLY_GUARD_SILENCE_MS)
  if (remindersSoFar > REPLY_GUARD_MAX_REMINDERS) return { due: false }
  return {
    due: true,
    reminder: `Reply guard: you have been working on ${taskId} for a while without telling the team anything (no coord_progress, coord_send_message, or coord_publish_finding since you claimed it). If you have made real progress, report it now with coord_progress or coord_send_message — your reasoning and tool output are invisible to teammates until you do. If you have genuinely made no progress yet, this reminder can be ignored.`,
  }
}

function externalParticipantInstructions(participant: ExternalProtocolParticipant, projectMemoryTail?: string | null): string {
  const roleInstructions = participant.role === 'lead'
    ? [
        'You are the lead: decompose the objective, seed independent teammate lanes, supervise the roster, resolve blockers, and finalize only after reviewing durable task results.',
        'Do not claim a teammate lane merely because it is unblocked. Claim only an explicit lead integration/review task, or work the board yourself when no teammate is available.',
      ]
    : [
        'You are a teammate: claim one unblocked teammate task, request locks before editing, and stay inside the returned task paths.',
        'Complete, release, or hand off owned work before going idle; do not take over the lead\'s integration or synthesis role.',
      ]
  const parts = [
    `You are ${participant.name} (${participant.role}) in Coordinator run ${participant.runId}.`,
    'Read the board before acting.',
    ...roleInstructions,
    'Use Coordinator tools for plans, messages, findings, blocking, completion, and heartbeats. Read your inbox between work steps.',
    'Reply to any reply-required inbox message before other work — silence reads as dropped, not busy — and call coord_progress(status="heartbeat") every ~2 minutes on tasks that run long.',
    'Narrate every mailbox exchange to your own terminal: "<- <sender>: <message>" on receipt, "-> <recipient>: <message>" after sending — your human is watching this terminal, not the board.',
    'If a Coordinator tool call throws (network error, timeout, daemon unreachable), wait ~2s and retry the same call — never give up after one failure, and keep this same identity rather than re-joining.',
    `Work from ${participant.cwd}. If another participant uses the same checkout, coordinate non-overlapping paths before editing.`,
    'Record genuinely durable facts (architecture decisions, gotchas, established patterns — not routine progress) with coord_remember so future runs in this project start with them in view; search past ones with coord_query_context.',
  ]
  const instructions = parts.join(' ')
  return projectMemoryTail
    ? `${instructions}\n\nProject memory (persists across runs):\n${projectMemoryTail}`
    : instructions
}

async function participantWorktree(cwd: string): Promise<{ cwd: string; branch: string }> {
  const resolved = path.resolve(cwd.trim() || process.cwd())
  const worktree = await findWorktreeTaskForCwd(resolved).catch(() => null)
  return { cwd: worktree?.path ?? resolved, branch: worktree?.branch ?? '' }
}

/**
 * Mint (and persist) a Coordinator participant capability token for an
 * EXISTING protocol_agents row — the same token mechanism issueParticipant
 * uses for a freshly-joined external participant, factored out so an
 * in-process agent (real session id, inserted by beginExecutionPhase/
 * startProtocolRun, not the synthetic `external:*` session id an external
 * join assigns) can get a real identity without going through the whole
 * external-join flow.
 */
function issueParticipantTokenSync(
  db: SqliteDatabase,
  runId: string,
  agentId: string,
  token: string = randomBytes(32).toString('base64url'),
  ts: string = nowIso(),
): string {
  db.prepare(`
    INSERT INTO protocol_participant_tokens (run_id, agent_id, token_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(runId, agentId, hashParticipantToken(token).toString('hex'), ts)
  return token
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
    /** Which senders' mailbox messages reach this participant — see ProtocolAgentRespondToMode. Omitted/undefined means `anyone` (today's behavior). */
    respondTo?: { mode: ProtocolAgentRespondToMode; allowlist?: string[] }
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
      capabilities_json, respond_to_mode, respond_to_allowlist_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    params.respondTo?.mode ?? null,
    params.respondTo?.mode ? JSON.stringify(params.respondTo.allowlist ?? []) : null,
    ts,
    ts,
  )
  issueParticipantTokenSync(db, params.runId, agentId, token, ts)
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
/** Pure planning output for one playbook task — see planPlaybookTasks. */
type PlaybookTaskPlan = {
  /** Deterministic `task-${n}` id this task will get when actually inserted (see insertTaskSync/nextTaskIdSync) — reliable because planning and insertion both run inside the same open transaction, so no other insert can land between them. */
  id: string
  key?: string
  title: string
  prompt: string
  paths: string[]
  blockedBy: string[]
  phase: string
  targetRole: ProtocolTaskTargetRole
}

/**
 * Pure decision logic for playbook seeding — no DB access. Interpolates
 * `{{args}}`, resolves phase-barrier + explicit key dependencies, and
 * predicts each task's id. Two callers apply this differently (the seam
 * buzz-workflow's ActionSink models, adapted to this codebase's synchronous
 * SQL style rather than an async trait object): seedPlaybookTasksSync
 * actually inserts the rows; previewExternalProtocolPlaybook returns the
 * plan as-is for a dry-run coord_preview_playbook call, so a caller can sanity-check
 * a playbook + args combination before committing to coord_create_run.
 */
function planPlaybookTasks(playbook: RunPlaybook, args: unknown, startCount: number): PlaybookTaskPlan[] {
  const argumentContext = args === undefined
    ? ''
    : `\n\nPlaybook arguments:\n${typeof args === 'string' ? args : JSON.stringify(args, null, 2)}`
  // Pre-assign every task id in insertion order so key references resolve
  // regardless of declaration order within a phase. (Later-phase references
  // are rejected at parse time — they would deadlock against the barrier.)
  const keyToId = new Map<string, string>()
  let assigned = startCount
  for (const phase of playbook.phases) {
    for (const entry of phase.tasks) {
      assigned += 1
      if (entry.key) keyToId.set(entry.key, `task-${assigned}`)
    }
  }
  const plans: PlaybookTaskPlan[] = []
  let previousPhaseIds: string[] = []
  let nextId = startCount
  for (const phase of playbook.phases) {
    const phaseIds: string[] = []
    for (const entry of phase.tasks) {
      nextId += 1
      const id = `task-${nextId}`
      const explicitDeps = (entry.dependsOn ?? []).map((key) => {
        const depId = keyToId.get(key)
        if (!depId) throw new Error(`playbook task "${entry.title}" depends on unknown key: ${key}`)
        return depId
      })
      plans.push({
        id,
        key: entry.key,
        title: interpolatePlaybookText(entry.title, args),
        prompt: `${interpolatePlaybookText(entry.detail, args)}${argumentContext}`,
        paths: (entry.paths ?? []).map((lockPath) => interpolatePlaybookText(lockPath, args)),
        blockedBy: [...new Set([...previousPhaseIds, ...explicitDeps])],
        phase: phase.title,
        targetRole: entry.role ?? 'teammate',
      })
      phaseIds.push(id)
    }
    previousPhaseIds = phaseIds
  }
  return plans
}

/**
 * Dry-run playbook seeding: computes exactly what seedPlaybookTasksSync would
 * create (task ids, titles, prompts, dependency graph) without touching the
 * database or requiring a run to exist. Same planPlaybookTasks the real
 * seeding path uses — this function just doesn't apply the plan.
 */
export async function previewExternalProtocolPlaybook(
  params: { cwd: string; playbookName?: string; playbook?: RunPlaybook; args?: unknown },
): Promise<{ tasks: PlaybookTaskPlan[] }> {
  const playbook = params.playbookName
    ? await loadRunPlaybook(params.cwd, params.playbookName)
    : params.playbook
  if (!playbook) throw new Error('playbookName or playbook is required')
  if (params.args === undefined && playbookExpectsArgs(playbook)) {
    throw new Error(
      `Playbook "${playbook.name}" expects args (${playbook.argsHint ?? 'see the {{args}} placeholders in its task text'}) — pass args to preview it`,
    )
  }
  return { tasks: planPlaybookTasks(playbook, params.args, 0) }
}

function seedPlaybookTasksSync(
  db: SqliteDatabase,
  runId: string,
  agentId: string,
  playbook: RunPlaybook,
  args: unknown,
): void {
  const startCount = Number((db.prepare('SELECT COUNT(*) AS n FROM protocol_tasks WHERE run_id = ?').get(runId) as Row | undefined)?.n) || 0
  const plans = planPlaybookTasks(playbook, args, startCount)
  const keyToId = new Map<string, string>()
  for (const plan of plans) {
    const task = insertTaskSync(db, runId, {
      title: plan.title,
      prompt: plan.prompt,
      paths: plan.paths,
      // blockedBy was computed from predicted ids (see planPlaybookTasks);
      // resolve any that were themselves re-keyed by an earlier iteration of
      // this same loop, same as the pre-refactor keyToId overwrite did.
      blockedBy: plan.blockedBy.map((depId) => keyToId.get(depId) ?? depId),
      phase: plan.phase,
      targetRole: plan.targetRole,
    })
    if (plan.key) keyToId.set(plan.key, task.id)
    keyToId.set(plan.id, task.id)
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
      payload: { phase: task.phase, playbook: playbook.name, targetRole: task.targetRole },
    })
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
  const runId = params.runId?.trim() || randomUUID()
  if (!/^[A-Za-z0-9._~-]{1,200}$/.test(runId)) {
    throw new Error('run id must be a URI-safe identifier of 200 characters or fewer')
  }
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
        respondTo: params.respondTo,
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
  const memoryTail = await readProjectMemoryTail(await projectRepoRoot(worktree.cwd))
  return { ...result, instructions: externalParticipantInstructions(result.participant, memoryTail) }
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
      "SELECT COUNT(*) AS n FROM protocol_agents WHERE run_id = ? AND status NOT IN ('done', 'failed', 'stopped')",
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
        "SELECT COUNT(*) AS count FROM protocol_agents WHERE run_id = ? AND status NOT IN ('done', 'failed', 'stopped')",
      ).get(run.id) as Row | undefined)?.count) || 0
      if (participantCount >= run.maxAgents) throw new Error('Coordinator run has reached its participant limit')
      const duplicate = db.prepare("SELECT 1 FROM protocol_agents WHERE run_id = ? AND lower(name) = lower(?) AND status NOT IN ('done', 'failed', 'stopped')")
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
        respondTo: params.respondTo,
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
  const memoryTail = await readProjectMemoryTail(joinerRoot ?? path.resolve(worktree.cwd))
  return { ...result, instructions: externalParticipantInstructions(result.participant, memoryTail) }
}

export async function resumeExternalProtocolParticipant(
  identity: ExternalProtocolIdentity,
  negotiation?: {
    client?: ExternalProtocolClient
    capabilities?: ExternalProtocolCapabilities
    provider?: AgentProvider
  },
): Promise<ExternalProtocolParticipantResult> {
  const db = await getDatabase()
  let agent = requireExternalParticipantSync(db, identity)
  if (negotiation?.client || negotiation?.capabilities || negotiation?.provider) {
    const negotiated = negotiateExternalClient(negotiation.client, negotiation.capabilities)
    await enqueueWrite((writeDb) => {
      requireExternalParticipantSync(writeDb, identity)
      writeDb.prepare(`
        UPDATE protocol_agents
        SET client_name = ?, client_version = ?, protocol_version = ?, capabilities_json = ?,
            provider = COALESCE(?, provider), updated_at = ?
        WHERE run_id = ? AND id = ?
      `).run(
        negotiated.client.name,
        negotiated.client.version ?? null,
        negotiated.client.protocolVersion,
        JSON.stringify(negotiated.capabilities),
        negotiation.provider ?? null,
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

/**
 * Retire an external supervisor that is intentionally exiting without owned
 * work. Keeping it `ready` until stale recovery consumes a participant slot,
 * suppresses replacement workers, and makes the roster claim an executor is
 * still available. Leads are terminal infrastructure: losing one fails the
 * run explicitly instead of leaving teammates working toward synthesis that
 * can never happen.
 */
export async function leaveExternalProtocolRun(
  identity: ExternalProtocolIdentity,
  reason?: string,
): Promise<ExternalProtocolMutationResult> {
  const result = await enqueueWrite((db) => {
    const agent = requireExternalParticipantSync(db, identity)
    if (agent.taskId) throw new Error(`Cannot leave while owning ${agent.taskId}; hand off or release it first`)
    const ts = nowIso()
    const summary = reason?.trim() || `${agent.name} left the Coordinator run`
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("UPDATE protocol_agents SET status = 'stopped', task_id = NULL, last_seen_at = ?, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, ts, identity.runId, identity.agentId)
      db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND status = 'active'")
        .run(ts, identity.runId, identity.agentId)
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId: identity.runId,
        agentId: identity.agentId,
        type: 'shutdown.requested',
        summary,
        timestamp: ts,
      })
      if (agent.role === 'lead') {
        db.prepare("UPDATE protocol_runs SET status = 'failed', summary = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'failed', 'stopped')")
          .run(`Coordinator lead exited: ${summary}`, ts, identity.runId)
        db.prepare("UPDATE protocol_agents SET status = 'stopped', updated_at = ? WHERE run_id = ? AND id != ? AND status NOT IN ('done', 'failed', 'stopped')")
          .run(ts, identity.runId, identity.agentId)
        db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND status = 'active'")
          .run(ts, identity.runId)
        insertEventSync(db, {
          version: AGENT_PROTOCOL_VERSION,
          runId: identity.runId,
          agentId: identity.agentId,
          type: 'run.status',
          summary: `Coordinator lead exited: ${summary}`,
          payload: { status: 'failed' },
          timestamp: ts,
        })
      } else {
        db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, identity.runId)
      }
      db.exec('COMMIT')
      return externalMutationResultSync(db, identity.runId, identity.agentId)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
  notifyRunChanged(identity.runId)
  return result
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
    // Rolled up from the full unbounded task list (a cheap DB read), not
    // snapshot.tasks — that field is windowed for terminal tasks (see
    // readSnapshotSync) and would silently undercount completed/failed once
    // old terminal tasks age out of the window.
    phases: phaseRollups(listTasksSync(db, identity.runId)),
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
  const interactiveCutoff = new Date(Date.now() - INTERACTIVE_AGENT_STALE_MS).toISOString()
  const stale = db.prepare(`
    SELECT * FROM protocol_agents
    WHERE run_id = ? AND session_id LIKE 'external:%'
      AND status IN ('ready', 'idle', 'working', 'blocked')
      AND COALESCE(last_seen_at, updated_at) < ?
  `).all(runId, interactiveCutoff > cutoff ? interactiveCutoff : cutoff) as Row[]
  for (const row of stale) {
    const agent = rowToAgent(row)
    // An unattended worker polls constantly, so silence really means dead. An
    // interactive CLI participant only touches the board between its own turns
    // and can legitimately go quiet through one long tool call (a typecheck or
    // full test suite), so reaping it on the worker timer yanks a task out from
    // under work that is actively running. Give it a longer rope.
    const staleAfter = agent.capabilities?.unattended === true
      ? EXTERNAL_AGENT_STALE_MS
      : INTERACTIVE_AGENT_STALE_MS
    const lastSeen = Date.parse(agent.lastSeenAt ?? agent.updatedAt)
    if (Number.isFinite(lastSeen) && Date.now() - lastSeen < staleAfter) continue
    const ts = nowIso()
    db.prepare(`
      UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, result_summary = NULL, result_detail = NULL, updated_at = ?
      WHERE run_id = ? AND owner_agent_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
    `).run(ts, runId, agent.id)
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
    if (agent.role === 'lead') {
      const summary = `Coordinator lead ${agent.name} heartbeat expired`
      db.prepare("UPDATE protocol_runs SET status = 'failed', summary = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'failed', 'stopped')")
        .run(summary, ts, runId)
      db.prepare("UPDATE protocol_agents SET status = 'stopped', task_id = NULL, updated_at = ? WHERE run_id = ? AND status NOT IN ('done', 'failed', 'stopped')")
        .run(ts, runId)
      db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND status = 'active'")
        .run(ts, runId)
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: agent.id,
        type: 'run.status',
        summary,
        payload: { status: 'failed', stale: true },
        timestamp: ts,
      })
      break
    }
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
      SET last_seen_at = ?, updated_at = ?, status = CASE
        WHEN status = 'stopped' AND EXISTS (
          SELECT 1 FROM protocol_runs
          WHERE id = protocol_agents.run_id
            AND status IN ('planning', 'running', 'synthesizing', 'blocked')
        ) THEN 'ready'
        ELSE status
      END
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

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCoordinatorExternalIdempotencyInFlight: Map<string, Promise<unknown>> | undefined
}

const externalIdempotencyInFlight = globalThis.__agentViewerCoordinatorExternalIdempotencyInFlight
  ?? (globalThis.__agentViewerCoordinatorExternalIdempotencyInFlight = new Map<string, Promise<unknown>>())

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
      db.prepare(`
        DELETE FROM protocol_idempotency
        WHERE rowid IN (
          SELECT rowid FROM protocol_idempotency
          WHERE run_id = ? AND agent_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT -1 OFFSET ?
        )
      `).run(identity.runId, identity.agentId, IDEMPOTENCY_WINDOW_PER_PARTICIPANT)
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
  params: {
    title: string
    detail: string
    paths?: string[]
    dependsOn?: string[]
    phase?: string
    targetRole?: ProtocolTaskTargetRole
    roleName?: string
    roleDescription?: string
  },
): Promise<ExternalProtocolTaskCreateResult> {
  const result = await enqueueWrite(async (db) => {
    const agent = requireExternalParticipantSync(db, identity)
    const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(identity.runId) as Row | undefined
    if (!runRow) throw new Error('Coordinator run not found')
    // Any participant may add discovered work while the run is live. The lead
    // may also add tasks during synthesis — its review found follow-up work —
    // which reopens the board. The lead may also create tasks during planning
    // (external MCP lead driving the planning turn), which advances to running.
    const reopening = runRow.status === 'synthesizing' && agent.role === 'lead'
    const planning = runRow.status === 'planning' && agent.role === 'lead'
    if (runRow.status !== 'running' && !reopening && !planning) throw new Error('Coordinator run is not accepting tasks')
    const title = params.title.trim()
    const detail = params.detail.trim()
    if (!title || !detail) throw new Error('task title and detail are required')
    const roleName = params.roleName?.trim() || undefined
    let roleDescription = roleName ? params.roleDescription?.trim() || undefined : undefined
    // A role_name with no inline description falls back to a saved template
    // (coord_save_role) — reuse a lane's persona instead of re-authoring it.
    if (roleName && !roleDescription) {
      const saved = await readSavedRole(await projectRepoRoot(agent.worktreePath), roleName)
      roleDescription = saved?.description
      // Persona-pack-style default nudge (see SavedRoleTemplate) — surfaced
      // in the task text itself since we cannot mechanically switch an
      // external CLI worker's provider/model mid-run; the claiming agent
      // decides whether to act on it.
      if (saved?.defaultProvider || saved?.defaultModel) {
        const suggestion = [saved.defaultProvider, saved.defaultModel].filter(Boolean).join(' / ')
        roleDescription = `${roleDescription ? `${roleDescription}\n\n` : ''}Suggested provider/model for this role: ${suggestion}.`
      }
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const blockedBy = [...new Set((params.dependsOn ?? []).map((entry) => entry.trim()).filter(Boolean))]
      validateTaskDependenciesSync(db, identity.runId, nextTaskIdSync(db, identity.runId), blockedBy)
      const similarTasks = findSimilarTasksSync(db, identity.runId, title, detail)
      const task = insertTaskSync(db, identity.runId, {
        title,
        prompt: detail,
        paths: params.paths ?? [],
        blockedBy,
        phase: params.phase?.trim() || undefined,
        targetRole: params.targetRole ?? (reopening ? 'lead' : 'teammate'),
        roleName,
        roleDescription,
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
        payload: {
          ...(task.phase ? { phase: task.phase } : {}),
          targetRole: task.targetRole,
          ...(task.roleName ? { roleName: task.roleName, roleDescription: task.roleDescription } : {}),
        },
      })
      if (reopening || planning) {
        db.prepare("UPDATE protocol_runs SET status = 'running' WHERE id = ?").run(identity.runId)
        insertEventSync(db, {
          version: AGENT_PROTOCOL_VERSION,
          runId: identity.runId,
          agentId: identity.agentId,
          type: 'run.status',
          summary: reopening
            ? `Run reopened: the lead added ${task.id} during synthesis`
            : `Run started: the lead added ${task.id} during planning`,
          payload: { status: 'running' },
        })
      }
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(nowIso(), identity.runId)
      db.exec('COMMIT')
      return {
        ...externalMutationResultSync(db, identity.runId, identity.agentId, task),
        ...(similarTasks.length ? { similarTasks } : {}),
      }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(identity.runId)
  return result
}

/** Sentinel agent id recorded on events/tasks created by an unauthenticated A2A caller. */
const A2A_CLIENT_AGENT_ID = 'a2a-client'

/**
 * Task creation for the A2A `message/send` and `message/stream` operations.
 * An A2A caller isn't a registered participant (no join/claim handshake) — it
 * addresses the run's task board as a whole, so this skips the identity
 * checks createExternalProtocolTask enforces for teammates.
 */
export async function createProtocolTaskAdmin(
  runId: string,
  params: { title: string; detail: string; paths?: string[] },
): Promise<ProtocolTask> {
  const result = await enqueueWrite((db) => {
    const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
    if (!runRow) throw new Error('Coordinator run not found')
    if (!['running', 'planning'].includes(String(runRow.status))) {
      throw new Error('Coordinator run is not accepting tasks')
    }
    const title = params.title.trim()
    const detail = params.detail.trim()
    if (!title || !detail) throw new Error('task title and detail are required')
    db.exec('BEGIN IMMEDIATE')
    try {
      const task = insertTaskSync(db, runId, {
        title,
        prompt: detail,
        paths: params.paths ?? [],
        blockedBy: [],
      })
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: A2A_CLIENT_AGENT_ID,
        type: 'task.created',
        taskId: task.id,
        title,
        detail,
        paths: task.paths,
      })
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(nowIso(), runId)
      db.exec('COMMIT')
      return task
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(runId)
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
      if (!task) throw new Error(describeClaimFailureSync(db, identity.runId, identity.agentId, taskId))
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
function describeClaimFailureSync(db: SqliteDatabase, runId: string, agentId: string, taskId?: string): string {
  const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow) return 'No claimable task: Coordinator run does not exist'
  if (['completed', 'failed', 'stopped'].includes(String(runRow.status))) {
    return `No claimable task: Coordinator run is ${runRow.status}`
  }
  const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?').get(runId, agentId) as Row | undefined
  const agent = agentRow ? rowToAgent(agentRow) : null
  const alreadyOwned = listTasksSync(db, runId).find((entry) => (
    entry.ownerAgentId === agentId && !['completed', 'failed', 'cancelled'].includes(entry.status)
  ))
  if (alreadyOwned) return `No claimable task: ${agent?.name ?? agentId} already owns ${alreadyOwned.id}`
  if (!taskId) return 'No claimable task: every pending task is owned or blocked by incomplete dependencies'
  const row = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?').get(runId, taskId) as Row | undefined
  if (!row) return `No claimable task: ${taskId} does not exist`
  const task = rowToTask(row)
  if (task.ownerAgentId) return `No claimable task: ${taskId} is already owned by ${task.ownerAgentId}`
  if (task.status !== 'pending') return `No claimable task: ${taskId} is ${task.status}`
  if (agent && !taskClaimableByAgent(task, agent, listAgentsSync(db, runId))) {
    return `No claimable task: ${taskId} targets the ${task.targetRole} role, but ${agent.name} is ${agent.role}`
  }
  const tasksById = new Map(listTasksSync(db, runId).map((entry) => [entry.id, entry]))
  const unmet = task.blockedBy.filter((dep) => tasksById.get(dep)?.status !== 'completed')
  if (unmet.length > 0) return `No claimable task: ${taskId} is blocked by incomplete dependencies: ${unmet.join(', ')}`
  const activeLocks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND status = 'active'")
    .all(runId) as Row[]).map(rowToLock)
  const conflict = task.paths.flatMap((lockPath) => (
    activeLocks.filter((lock) => writeLocksConflict(lock, lockPath, agentId))
  )).at(0)
  if (conflict) return `No claimable task: ${taskId} requires a path locked by ${conflict.agentId} on ${conflict.path}`
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
): Promise<ExternalProtocolMessageResult> {
  const db = await getDatabase()
  requireExternalParticipantSync(db, identity)
  const body = params.body.trim()
  if (!body) throw new Error('message body is required')
  const resolvedRecipients = resolveRecipientsSync(db, identity.runId, identity.agentId, params.to)
  if (resolvedRecipients.length === 0) {
    throw new Error(`Coordinator message recipient not found: ${params.to}`)
  }
  const recipients = resolvedRecipients.filter((recipientId) => respondToAllowsSync(db, identity.runId, recipientId, identity.agentId))
  if (recipients.length === 0) {
    throw new Error(`${params.to} is not accepting messages from you right now (respond-to gate)`)
  }
  if (params.inReplyTo && recipients.length !== 1) {
    throw new Error('A correlated reply must address exactly one participant')
  }
  // Computed before the send so a recipient's own delivered_at/last_seen
  // bump (if they happen to be polling this exact instant) can't flatter
  // its own liveness reading.
  const delivery = deliveryHintsSync(db, identity.runId, recipients)
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
  const result = await externalMutationResult(identity)
  return { ...result, delivery }
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
      const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(identity.runId) as Row | undefined
      if (!runRow || ['completed', 'failed', 'stopped'].includes(String(runRow.status))) {
        throw new Error(`Cannot request locks: Coordinator run is ${runRow?.status ?? 'missing'}`)
      }
      if (!agent.taskId) throw new Error('Cannot request locks without owning a Coordinator task')
      const taskRow = db.prepare('SELECT status, owner_agent_id FROM protocol_tasks WHERE run_id = ? AND id = ?')
        .get(identity.runId, agent.taskId) as Row | undefined
      if (!taskRow || taskRow.owner_agent_id !== agent.id || ['completed', 'failed', 'cancelled'].includes(String(taskRow.status))) {
        throw new Error(`Cannot request locks: ${agent.taskId} is not an active task owned by this participant`)
      }
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
  const taskId = params.taskId ?? agent.taskId
  if ((params.status === 'working' || params.status === 'blocked') && !taskId) {
    throw new Error(`Cannot report ${params.status} without owning a Coordinator task; claim the task first`)
  }
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
    taskId,
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

const CONTEXT_SEARCH_EVENT_TYPES = [
  'finding', 'learning', 'handoff', 'review.requested', 'task.completed', 'task.failed', 'plan.approved', 'plan.rejected',
] as const

/**
 * Lexical search over this run's findings/learnings/task outcomes plus task
 * title/prompt/result text — a lightweight substitute for a vector-search
 * knowledge base. No embedding model or external dependency: a growing
 * `coord_publish_finding` list is fine to skim at a dozen entries but not at
 * a hundred, so late-joining or reawoken agents can pull relevant context on
 * demand instead of scanning the full event log via coord_status.
 */
export async function queryExternalProtocolContext(
  identity: ExternalProtocolIdentity,
  params: { query: string; limit?: number },
): Promise<ExternalProtocolContextResult> {
  const db = await getDatabase()
  requireExternalParticipantSync(db, identity)
  const query = params.query.trim()
  if (!query) throw new Error('query is required')
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 20)
  const queryTokens = new Set(searchTokens(query))
  if (!queryTokens.size) return { results: [] }

  const matches: ProtocolContextMatch[] = []

  const eventRows = db.prepare(
    `SELECT * FROM protocol_events WHERE run_id = ? AND type IN (${CONTEXT_SEARCH_EVENT_TYPES.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 500`,
  ).all(identity.runId, ...CONTEXT_SEARCH_EVENT_TYPES) as Row[]
  for (const row of eventRows) {
    const event = rowToEvent(row)
    const docText = [event.summary, event.detail].filter(Boolean).join('\n')
    const score = queryOverlapScore(queryTokens, new Set(searchTokens(docText)))
    if (score > 0) {
      matches.push({
        kind: event.type as ProtocolContextMatch['kind'],
        taskId: event.taskId,
        agentId: event.agentId,
        summary: event.summary ?? '',
        detail: event.detail,
        timestamp: event.timestamp ?? row.created_at as string,
        score,
      })
    }
  }

  for (const task of listTasksSync(db, identity.runId)) {
    const docText = [task.title, task.prompt, task.resultSummary, task.resultDetail].filter(Boolean).join('\n')
    const score = queryOverlapScore(queryTokens, new Set(searchTokens(docText)))
    if (score > 0) {
      matches.push({
        kind: 'task',
        taskId: task.id,
        agentId: task.ownerAgentId,
        summary: task.title,
        detail: task.resultSummary ? `${task.prompt}\n\nResult: ${task.resultSummary}` : task.prompt,
        timestamp: task.updatedAt,
        score,
      })
    }
  }

  const runRow = db.prepare('SELECT base_cwd FROM protocol_runs WHERE id = ?').get(identity.runId) as Row | undefined
  if (runRow?.base_cwd) {
    const repoRoot = await projectRepoRoot(String(runRow.base_cwd))
    for (const section of await readProjectMemorySections(repoRoot)) {
      const score = queryOverlapScore(queryTokens, new Set(searchTokens(section.body)))
      if (score > 0) {
        matches.push({
          kind: 'project_memory',
          summary: section.heading,
          detail: section.body,
          timestamp: nowIso(),
          score,
        })
      }
    }
  }

  matches.sort((a, b) => b.score - a.score)
  return { results: matches.slice(0, limit) }
}

/**
 * Record a fact into this project's durable memory (.agent-viewer/memory.md)
 * — unlike coord_publish_finding, this outlives the run: every future
 * coordinator run in this project starts with it in view. Use sparingly for
 * genuinely durable context (architecture decisions, gotchas, established
 * patterns), not routine progress — that belongs in coord_publish_finding.
 */
export async function rememberExternalProtocolMemory(
  identity: ExternalProtocolIdentity,
  params: { summary: string; detail?: string },
): Promise<ExternalProtocolMutationResult> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const summary = params.summary.trim()
  if (!summary) throw new Error('summary is required')
  const repoRoot = await projectRepoRoot(agent.worktreePath)
  await appendProjectMemory(repoRoot, agent.name, summary, params.detail?.trim() || undefined)
  return externalMutationResult(identity)
}

export async function saveExternalProtocolRole(
  identity: ExternalProtocolIdentity,
  params: { name: string; description: string; defaultProvider?: AgentProvider; defaultModel?: string },
): Promise<{ role: SavedRoleTemplate }> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const name = params.name.trim()
  const description = params.description.trim()
  if (!name || !description) throw new Error('role name and description are required')
  const repoRoot = await projectRepoRoot(agent.worktreePath)
  const role = await writeSavedRole(repoRoot, agent.name, name, description, {
    provider: params.defaultProvider,
    model: params.defaultModel?.trim() || undefined,
  })
  return { role }
}

export async function listExternalProtocolRoles(identity: ExternalProtocolIdentity): Promise<{ roles: SavedRoleTemplate[] }> {
  const db = await getDatabase()
  const agent = requireExternalParticipantSync(db, identity)
  const repoRoot = await projectRepoRoot(agent.worktreePath)
  return { roles: await listSavedRoles(repoRoot) }
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
      db.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, result_summary = NULL, result_detail = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
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
 * Lead-only: interrupt a teammate's in-flight turn without releasing its
 * owned task — mirrors buzz-acp's owner `!cancel` (cancel only the current
 * turn, task/ownership untouched) rather than `!shutdown`/release, which
 * always relinquish work. Sets `cancel_requested_at`; the target's own
 * worker supervisor (bin/agent-viewer-coord-worker.mjs's runCheckTimer,
 * which already polls `wait` during a tick to detect a terminal run) picks
 * this up, kills the current provider turn, and starts a fresh one — task
 * ownership and status are untouched throughout. The flag is cleared as a
 * side effect of the target's next progress report (see
 * reportExternalProtocolProgress), not here, since only the target — having
 * actually observed and acted on it — can say it was handled.
 */
export async function cancelExternalProtocolTurn(
  identity: ExternalProtocolIdentity,
  params: { agentId: string },
): Promise<ExternalProtocolMutationResult> {
  const readDb = await getDatabase()
  const agent = requireExternalParticipantSync(readDb, identity)
  if (agent.role !== 'lead') throw new Error('Only the Coordinator lead can cancel another participant\'s turn')
  const targetId = resolveRecipientsSync(readDb, identity.runId, identity.agentId, params.agentId)[0]
    ?? listAgentsSync(readDb, identity.runId).find((entry) => entry.id === params.agentId)?.id
  if (!targetId) throw new Error(`Coordinator participant not found: ${params.agentId}`)
  if (targetId === identity.agentId) throw new Error('Cannot cancel your own turn — just stop and report')
  await enqueueWrite((db) => {
    const targetRow = db.prepare('SELECT status FROM protocol_agents WHERE run_id = ? AND id = ?')
      .get(identity.runId, targetId) as Row | undefined
    if (!targetRow || targetRow.status !== 'working') {
      throw new Error(`${params.agentId} has no in-flight turn to cancel (status: ${targetRow?.status ?? 'unknown'})`)
    }
    const ts = nowIso()
    db.prepare('UPDATE protocol_agents SET cancel_requested_at = ?, updated_at = ? WHERE run_id = ? AND id = ?')
      .run(ts, ts, identity.runId, targetId)
  })
  // Delivered through the standard message pipeline (appendProtocolEvent),
  // not a bare event row, so it actually lands in the target's inbox and can
  // steer a live session the same as any other urgent status message.
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: identity.runId,
    agentId: identity.agentId,
    type: 'message',
    to: targetId,
    summary: 'Lead cancelled your in-flight turn — you still own your task; start a fresh turn.',
    payload: { kind: 'status', priority: 'urgent' },
  })
  const result = await externalMutationResult(identity)
  notifyRunChanged(identity.runId)
  return result
}

/**
 * Administrative cancellation for the A2A `tasks/cancel` operation. Not
 * scoped to a registered participant for the same reason as
 * createProtocolTaskAdmin — an A2A client addresses the board, not a task
 * it owns as a named teammate.
 */
export async function cancelProtocolTask(runId: string, taskId: string, reason?: string): Promise<ProtocolTask> {
  const result = await enqueueWrite((db) => {
    const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
      .get(runId, taskId) as Row | undefined
    if (!taskRow) throw new Error('Coordinator task not found')
    const task = rowToTask(taskRow)
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      throw new Error(`Coordinator task is already ${task.status}`)
    }
    const ts = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare("UPDATE protocol_tasks SET status = 'cancelled', updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, runId, task.id)
      if (task.ownerAgentId) {
        db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
          .run(ts, runId, task.ownerAgentId, task.id)
        db.prepare("UPDATE protocol_agents SET task_id = NULL, status = CASE WHEN status IN ('working', 'blocked') THEN 'idle' ELSE status END, updated_at = ? WHERE run_id = ? AND id = ? AND task_id = ?")
          .run(ts, runId, task.ownerAgentId, task.id)
      }
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: A2A_CLIENT_AGENT_ID,
        type: 'task.cancelled',
        taskId: task.id,
        summary: reason?.trim() || `${task.id} cancelled via A2A tasks/cancel`,
        timestamp: ts,
      })
      failUnfulfillableDependentsSync(db, runId, A2A_CLIENT_AGENT_ID, ts)
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, runId)
      db.exec('COMMIT')
      return rowToTask(db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?').get(runId, task.id) as Row)
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(runId)
  return result
}

export type ProtocolPushConfig = {
  id: string
  runId: string
  taskId: string
  url: string
  token?: string
  authentication?: { scheme: string; credentials?: string }
  createdAt: string
}

function rowToPushConfig(row: Row): ProtocolPushConfig {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    taskId: String(row.task_id),
    url: String(row.url),
    token: typeof row.token === 'string' && row.token ? row.token : undefined,
    authentication: typeof row.auth_scheme === 'string' && row.auth_scheme
      ? {
          scheme: String(row.auth_scheme),
          credentials: typeof row.auth_credentials === 'string' && row.auth_credentials
            ? row.auth_credentials
            : undefined,
        }
      : undefined,
    createdAt: String(row.created_at),
  }
}

/** A2A `tasks/pushNotificationConfig/set`. */
export async function setProtocolPushConfig(
  runId: string,
  taskId: string,
  params: {
    url: string
    token?: string
    id?: string
    authentication?: { scheme: string; credentials?: string }
  },
): Promise<ProtocolPushConfig> {
  const db = await getDatabase()
  const taskRow = db.prepare('SELECT id FROM protocol_tasks WHERE run_id = ? AND id = ?').get(runId, taskId) as Row | undefined
  if (!taskRow) throw new Error('Coordinator task not found')
  const url = params.url.trim()
  if (!url) throw new Error('Push notification url is required')
  const id = params.id?.trim() || randomUUID()
  const ts = nowIso()
  db.prepare(`
    INSERT INTO protocol_push_configs (
      id, run_id, task_id, url, token, auth_scheme, auth_credentials, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      token = excluded.token,
      auth_scheme = excluded.auth_scheme,
      auth_credentials = excluded.auth_credentials,
      last_task_updated_at = NULL,
      fired_at = NULL
  `).run(
    id,
    runId,
    taskId,
    url,
    params.token?.trim() || null,
    params.authentication?.scheme.trim() || null,
    params.authentication?.credentials?.trim() || null,
    ts,
  )
  return rowToPushConfig(db.prepare('SELECT * FROM protocol_push_configs WHERE id = ?').get(id) as Row)
}

/** A2A `tasks/pushNotificationConfig/get`. */
export async function getProtocolPushConfig(
  runId: string,
  taskId: string,
  configId: string,
): Promise<ProtocolPushConfig | null> {
  const db = await getDatabase()
  const row = db.prepare('SELECT * FROM protocol_push_configs WHERE id = ? AND run_id = ? AND task_id = ?')
    .get(configId, runId, taskId) as Row | undefined
  return row ? rowToPushConfig(row) : null
}

/** A2A `tasks/pushNotificationConfig/list`. */
export async function listProtocolPushConfigs(runId: string, taskId: string): Promise<ProtocolPushConfig[]> {
  const db = await getDatabase()
  return (db.prepare('SELECT * FROM protocol_push_configs WHERE run_id = ? AND task_id = ? ORDER BY created_at ASC')
    .all(runId, taskId) as Row[]).map(rowToPushConfig)
}

/** A2A `tasks/pushNotificationConfig/delete`. */
export async function deleteProtocolPushConfig(runId: string, taskId: string, configId: string): Promise<boolean> {
  const db = await getDatabase()
  const result = db.prepare('DELETE FROM protocol_push_configs WHERE id = ? AND run_id = ? AND task_id = ?')
    .run(configId, runId, taskId) as { changes?: number }
  return (result?.changes ?? 0) > 0
}

/**
 * Fires each push config whenever its task's durable updated_at revision
 * changes. Piggybacks on the mailbox sweep
 * timer (see ensureMailSweep below) rather than adding a second process-wide
 * interval, and polls like the A2A SSE streams do rather than hooking every
 * task-status call site — task status changes happen across ~8 functions
 * (claim/complete/fail/release/handoff/cancel/…) with no single reducer
 * chokepoint in this schema.
 */
async function sweepPushNotifications(): Promise<void> {
  const db = await getDatabase()
  const pending = db.prepare('SELECT * FROM protocol_push_configs').all() as Row[]
  if (pending.length === 0) return
  const deliveries: Promise<void>[] = []
  for (const row of pending) {
    const config = rowToPushConfig(row)
    const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
      .get(config.runId, config.taskId) as Row | undefined
    if (!taskRow) continue
    const task = rowToTask(taskRow)
    if (row.last_task_updated_at === task.updatedAt) continue
    const payload = {
      statusUpdate: {
        taskId: `${task.runId}:${task.id}`,
        contextId: task.runId,
        status: { state: taskStateFromStatus(task.status), timestamp: task.updatedAt },
      },
    }
    deliveries.push((async () => {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/a2a+json',
          ...(config.authentication
            ? { Authorization: `${config.authentication.scheme}${config.authentication.credentials ? ` ${config.authentication.credentials}` : ''}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(PUSH_NOTIFICATION_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`Push target returned HTTP ${response.status}`)
      db.prepare('UPDATE protocol_push_configs SET fired_at = ?, last_task_updated_at = ? WHERE id = ?')
        .run(nowIso(), task.updatedAt, config.id)
    })())
  }
  await Promise.allSettled(deliveries)
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
      db.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, result_summary = NULL, result_detail = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, identity.runId, task.id)
      db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
        .run(ts, identity.runId, agent.id, task.id)
      const nextAgentStatus = params.failureClass === 'supervisor_stopped' ? 'stopped' : 'blocked'
      db.prepare('UPDATE protocol_agents SET task_id = NULL, status = ?, last_seen_at = ?, updated_at = ? WHERE run_id = ? AND id = ?')
        .run(nextAgentStatus, ts, ts, identity.runId, agent.id)
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
// Cross-run project memory + role templates — unlike protocol_findings
// (scoped to one run_id, gone once the run ends), these live as files at the
// repo root under .agent-viewer/ so every future coordinator run in this
// project — and every worktree checkout any participant works from — reads
// the same durable state. Resolved via findRepoRoot (git-common-dir), not
// the caller's raw cwd, because teammates run from separate `git worktree`
// checkouts that would otherwise each see their own on-disk copy.

async function projectRepoRoot(cwd: string): Promise<string> {
  return (await findRepoRoot(cwd).catch(() => null)) ?? path.resolve(cwd)
}

function projectMemoryFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.agent-viewer', 'memory.md')
}

const PROJECT_MEMORY_HEADER = '# Coordinator project memory\n\nDurable facts, decisions, and gotchas coordinator agents have recorded for this project. Persists across every run — edit freely.\n'
// Bounds how much of the file rides into a fresh participant's initial
// instructions; the full file is still readable (and, once query_context
// searches it too, findable) even past this tail.
const PROJECT_MEMORY_INJECT_CHARS = 3000

async function readProjectMemoryTail(repoRoot: string): Promise<string | null> {
  let content: string
  try {
    content = await readFile(projectMemoryFilePath(repoRoot), 'utf8')
  } catch {
    return null
  }
  const body = content.trim()
  if (!body) return null
  if (body.length <= PROJECT_MEMORY_INJECT_CHARS) return body
  return `…(truncated; read .agent-viewer/memory.md for the full history)\n${body.slice(-PROJECT_MEMORY_INJECT_CHARS)}`
}

async function appendProjectMemory(repoRoot: string, authorName: string, summary: string, detail?: string): Promise<void> {
  const file = projectMemoryFilePath(repoRoot)
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    existing = PROJECT_MEMORY_HEADER
  }
  const entry = `\n## ${nowIso()} — ${authorName}\n${summary}\n${detail ? `\n${detail}\n` : ''}`
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${existing.replace(/\s+$/, '')}\n${entry}`, 'utf8')
}

/** Parse memory.md into its `## <date> — <author>` sections for query_context search. */
async function readProjectMemorySections(repoRoot: string): Promise<Array<{ heading: string; body: string }>> {
  let content: string
  try {
    content = await readFile(projectMemoryFilePath(repoRoot), 'utf8')
  } catch {
    return []
  }
  const sections: Array<{ heading: string; body: string }> = []
  const parts = content.split(/^## /m).slice(1)
  for (const part of parts) {
    const newline = part.indexOf('\n')
    if (newline === -1) continue
    sections.push({ heading: part.slice(0, newline).trim(), body: part.slice(newline + 1).trim() })
  }
  return sections
}

function slugifyRoleName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

function rolesDir(repoRoot: string): string {
  return path.join(repoRoot, '.agent-viewer', 'roles')
}

/**
 * Persona-pack-style defaults: a role can suggest a provider/model a task in
 * that role is best worked by (mirrors buzz's Persona Pack `defaults` object
 * — model/temperature/triggers a persona inherits and can override). We have
 * no "pack" grouping to inherit from, so this is single-level: a role either
 * sets its own defaults or doesn't, no fallback chain. Applied as a nudge in
 * the task prompt text (see createExternalProtocolTask), not a mechanical
 * override — an external CLI worker's provider/model is fixed for its
 * process lifetime, so the claiming agent (human or automated) is the one
 * who decides whether to act on the suggestion, e.g. by running its own
 * native model-switch command.
 */
type SavedRoleTemplate = {
  name: string
  description: string
  defaultProvider?: AgentProvider
  defaultModel?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

async function readSavedRole(repoRoot: string, name: string): Promise<SavedRoleTemplate | null> {
  const slug = slugifyRoleName(name)
  if (!slug) return null
  try {
    const raw = await readFile(path.join(rolesDir(repoRoot), `${slug}.json`), 'utf8')
    return JSON.parse(raw) as SavedRoleTemplate
  } catch {
    return null
  }
}

async function writeSavedRole(
  repoRoot: string,
  authorName: string,
  name: string,
  description: string,
  defaults: { provider?: AgentProvider; model?: string } = {},
): Promise<SavedRoleTemplate> {
  const slug = slugifyRoleName(name)
  if (!slug) throw new Error('role name must contain at least one letter or digit')
  const existing = await readSavedRole(repoRoot, name)
  const ts = nowIso()
  const template: SavedRoleTemplate = {
    name: name.trim(),
    description,
    // Omitting provider/model on an update keeps the existing defaults
    // rather than clearing them — matches how updating description alone
    // shouldn't silently drop a previously-set persona default.
    defaultProvider: defaults.provider ?? existing?.defaultProvider,
    defaultModel: defaults.model ?? existing?.defaultModel,
    createdBy: existing?.createdBy ?? authorName,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  }
  const dir = rolesDir(repoRoot)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${slug}.json`), `${JSON.stringify(template, null, 2)}\n`, 'utf8')
  return template
}

async function listSavedRoles(repoRoot: string): Promise<SavedRoleTemplate[]> {
  let entries: string[]
  try {
    entries = await readdir(rolesDir(repoRoot))
  } catch {
    return []
  }
  const templates: SavedRoleTemplate[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) continue
    try {
      templates.push(JSON.parse(await readFile(path.join(rolesDir(repoRoot), entry), 'utf8')) as SavedRoleTemplate)
    } catch {
      // Skip a corrupt file rather than failing the whole listing.
    }
  }
  return templates
}

// ---------------------------------------------------------------------------
// Lifecycle webhooks — observer-only external notification, human-configured
// (not a coord_* tool: like playbooks/roles, this is infra a lead sets up
// once, not something an agent calls). A project opts in by creating
// .agent-viewer/hooks.json:
//   { "webhooks": [ { "url": "https://...", "events"?: [...], "secret"?: "..." } ] }
// Omitting `events` subscribes to every kind below. Delivery is fire-and-
// forget with no retry — a broken webhook must never affect coordinator
// correctness, so failures are swallowed. Driven by a single global cursor
// over protocol_events (not per-run) on the existing mailbox sweep timer, so
// a run transitioning to a terminal status still gets its final event even
// though sweepMailboxes itself stops polling that run afterward.

type ProjectWebhookConfig = { url: string; events?: string[]; secret?: string }

function webhooksFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.agent-viewer', 'hooks.json')
}

async function readProjectWebhooks(repoRoot: string): Promise<ProjectWebhookConfig[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(webhooksFilePath(repoRoot), 'utf8'))
  } catch {
    return []
  }
  const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).webhooks)
    ? (parsed as Record<string, unknown>).webhooks as unknown[]
    : []
  return list.filter((entry): entry is ProjectWebhookConfig => (
    Boolean(entry) && typeof entry === 'object' && typeof (entry as Record<string, unknown>).url === 'string'
    && ((entry as Record<string, unknown>).url as string).trim().length > 0
  ))
}

/** Event kinds a webhook may subscribe to — a curated subset of protocol_events types, not every event. */
const WEBHOOK_EVENT_KINDS = new Set(['run.completed', 'run.failed', 'task.completed', 'task.failed', 'handoff', 'review.requested'])

async function dispatchProjectWebhook(webhook: ProjectWebhookConfig, payload: Record<string, unknown>): Promise<void> {
  if (webhook.events && !webhook.events.includes(String(payload.kind))) return
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (webhook.secret) {
      headers['x-agent-viewer-signature'] = createHash('sha256').update(`${webhook.secret}.${JSON.stringify(payload)}`).digest('hex')
    }
    await fetch(webhook.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) })
  } catch {
    // Best-effort, no retry — see the section comment above.
  }
}

let lastWebhookEventCursor: number | null = null

async function dispatchNewProjectWebhookEvents(): Promise<void> {
  const db = await getDatabase()
  if (lastWebhookEventCursor === null) {
    // First tick after (re)start: start from "now" rather than replaying
    // this project's entire event history through every configured webhook.
    const latest = db.prepare('SELECT COALESCE(MAX(rowid), 0) AS cursor FROM protocol_events').get() as Row
    lastWebhookEventCursor = Number(latest.cursor) || 0
    return
  }
  const rows = db.prepare('SELECT rowid AS cursor, * FROM protocol_events WHERE rowid > ? ORDER BY rowid ASC LIMIT 200')
    .all(lastWebhookEventCursor) as Row[]
  if (!rows.length) return
  lastWebhookEventCursor = Number(rows.at(-1)!.cursor)
  const repoRootByRun = new Map<string, string>()
  for (const row of rows) {
    const event = rowToEvent(row)
    let kind: string = event.type
    if (kind === 'run.status') {
      const status = (event.payload as Record<string, unknown> | undefined)?.status
      if (status === 'completed') kind = 'run.completed'
      else if (status === 'failed') kind = 'run.failed'
      else continue
    }
    if (!WEBHOOK_EVENT_KINDS.has(kind)) continue
    let repoRoot = repoRootByRun.get(event.runId)
    if (!repoRoot) {
      const runRow = db.prepare('SELECT base_cwd FROM protocol_runs WHERE id = ?').get(event.runId) as Row | undefined
      if (!runRow?.base_cwd) continue
      repoRoot = await projectRepoRoot(String(runRow.base_cwd))
      repoRootByRun.set(event.runId, repoRoot)
    }
    const webhooks = await readProjectWebhooks(repoRoot)
    if (!webhooks.length) continue
    const payload = {
      kind,
      runId: event.runId,
      agentId: event.agentId,
      taskId: event.taskId,
      summary: event.summary,
      detail: event.detail,
      timestamp: event.timestamp,
    }
    for (const webhook of webhooks) void dispatchProjectWebhook(webhook, payload)
  }
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
        expectsArgs: playbookExpectsArgs(playbook),
        maxAgents: playbook.maxAgents,
        gateCommand: playbook.gateCommand,
        requirePlanApproval: playbook.requirePlanApproval,
      })
    } catch (error) {
      invalid.push({ file, error: error instanceof Error ? error.message : 'invalid playbook' })
    }
  }
  return { playbooks, invalid }
}

export async function writeRunPlaybook(
  cwd: string,
  value: unknown,
  previousName?: string,
): Promise<{ playbook: RunPlaybook; path: string }> {
  const playbook = parseRunPlaybook(value)
  if (previousName !== undefined && !isValidPlaybookName(previousName)) {
    throw new Error('previous playbook name must be a lowercase slug (a-z, 0-9, hyphens, max 64 chars)')
  }
  const dir = playbooksDir(cwd)
  const file = path.join(dir, `${playbook.name}.json`)
  const previousFile = previousName ? path.join(dir, `${previousName}.json`) : null
  const targetExists = await lstat(file).then(() => true).catch(() => false)
  if (!previousName && targetExists) throw new Error(`Playbook already exists: ${playbook.name}`)
  if (previousName && previousName !== playbook.name && targetExists) {
    throw new Error(`Playbook already exists: ${playbook.name}`)
  }
  if (previousFile && !(await lstat(previousFile).then(() => true).catch(() => false))) {
    throw new Error(`Playbook not found: ${previousName}`)
  }
  await mkdir(dir, { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(playbook, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
    if (previousFile && previousFile !== file) await rm(previousFile, { force: true })
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  return { playbook, path: file }
}

export async function deleteRunPlaybook(cwd: string, name: string): Promise<{ deleted: true; name: string }> {
  if (!isValidPlaybookName(name)) {
    throw new Error('playbook name must be a lowercase slug (a-z, 0-9, hyphens, max 64 chars)')
  }
  const file = path.join(playbooksDir(cwd), `${name}.json`)
  if (!(await lstat(file).then(() => true).catch(() => false))) throw new Error(`Playbook not found: ${name}`)
  await rm(file)
  return { deleted: true, name }
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
    phases: phaseOrder.map((title, phaseIndex) => {
      const previousPhaseIds = new Set(
        phaseIndex > 0 ? grouped.get(phaseOrder[phaseIndex - 1])!.map((task) => task.id) : [],
      )
      return {
        title,
        tasks: grouped.get(title)!.map((task) => {
          // blockedBy contains both model-authored edges and the implicit
          // previous-phase barrier. Export only the former: replay derives the
          // barrier again, so serializing it as explicit dependsOn data makes
          // saved playbooks misleading and needlessly noisy.
          const explicitDependencies = task.blockedBy.filter((dependency) => !previousPhaseIds.has(dependency))
          return {
            key: task.id,
            title: task.title,
            detail: task.prompt,
            paths: task.paths.length > 0 ? task.paths : undefined,
            role: task.targetRole,
            dependsOn: explicitDependencies.length > 0 ? explicitDependencies : undefined,
          }
        }),
      }
    }),
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

function taskClaimableByAgent(task: ProtocolTask, agent: ProtocolAgent, agents: ProtocolAgent[]): boolean {
  if (task.targetRole === 'any' || task.targetRole === agent.role) return true
  if (agent.role !== 'lead' || task.targetRole !== 'teammate') return false
  // A lone lead can still execute a saved playbook end to end. Once a live
  // teammate exists, teammate lanes stay delegated and cannot be absorbed by
  // the lead merely because they are currently unclaimed.
  return !agents.some((entry) => (
    entry.role === 'teammate'
    && entry.status !== 'stopped'
    && entry.status !== 'failed'
    && (
      Boolean(entry.taskId)
      || ['working', 'blocked', 'idle'].includes(entry.status)
      || (
        entry.status === 'ready'
        && entry.capabilities?.unattended === true
        && Date.now() - Date.parse(entry.lastSeenAt ?? entry.updatedAt) < EXTERNAL_AGENT_STALE_MS
      )
    )
  ))
}

/** Atomic claim: only a role-compatible pending task with completed deps and no owner can be taken. */
function claimTaskSync(db: SqliteDatabase, runId: string, agentId: string, taskId?: string): ProtocolTask | null {
  const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?').get(runId, agentId) as Row | undefined
  if (!agentRow) return null
  const agent = rowToAgent(agentRow)
  const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(runId) as Row | undefined
  if (!runRow || ['completed', 'failed', 'stopped'].includes(String(runRow.status))) return null
  if (['done', 'failed', 'stopped'].includes(agent.status)) return null
  const agents = listAgentsSync(db, runId)
  const tasks = listTasksSync(db, runId)
  const alreadyOwned = tasks.find((task) => (
    task.ownerAgentId === agentId && !['completed', 'failed', 'cancelled'].includes(task.status)
  ))
  if (alreadyOwned) return null
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  const candidates = taskId
    ? tasks.filter((task) => task.id === taskId)
    : tasks
  const claimable = candidates.find((task) =>
    task.status === 'pending'
    && !task.ownerAgentId
    && taskDepsCompleted(task, tasksById)
    && taskClaimableByAgent(task, agent, agents))
  if (!claimable) return null
  const activeLocks = (db.prepare("SELECT * FROM protocol_locks WHERE run_id = ? AND status = 'active'")
    .all(runId) as Row[]).map(rowToLock)
  if (claimable.paths.some((lockPath) => activeLocks.some((lock) => writeLocksConflict(lock, lockPath, agentId)))) {
    return null
  }
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
  targetRole?: ProtocolTaskTargetRole
  roleName?: string
  roleDescription?: string
}): ProtocolTask {
  const ts = nowIso()
  const task: ProtocolTask = {
    id: nextTaskIdSync(db, runId),
    runId,
    title: params.title,
    prompt: params.prompt,
    status: 'pending',
    targetRole: params.targetRole ?? 'teammate',
    roleName: params.roleName,
    roleDescription: params.roleName ? params.roleDescription : undefined,
    paths: params.paths.map(normalizeLockPath).filter((entry) => entry !== '**' || params.paths.length === 1),
    blockedBy: params.blockedBy,
    phase: params.phase,
    createdAt: ts,
    updatedAt: ts,
  }
  db.prepare(`
    INSERT INTO protocol_tasks (
      id, run_id, title, prompt, status, owner_agent_id, target_role, role_name, role_description, paths_json, blocked_by_json, phase, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id, runId, task.title, task.prompt, 'pending', null, task.targetRole,
    task.roleName ?? null, task.roleDescription ?? null,
    JSON.stringify(task.paths), JSON.stringify(task.blockedBy), task.phase ?? null, ts, ts,
  )
  return task
}

function nextTaskIdSync(db: SqliteDatabase, runId: string): string {
  const rows = db.prepare('SELECT id FROM protocol_tasks WHERE run_id = ?').all(runId) as Row[]
  const max = rows.reduce((highest, row) => {
    const match = /^task-(\d+)$/.exec(String(row.id))
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `task-${max + 1}`
}

function validateTaskDependenciesSync(
  db: SqliteDatabase,
  runId: string,
  taskId: string,
  blockedBy: string[],
): void {
  const tasks = listTasksSync(db, runId)
  const graph = new Map(tasks.map((task) => [task.id, task.blockedBy]))
  graph.set(taskId, blockedBy)
  for (const dependency of blockedBy) {
    if (!graph.has(dependency) || dependency === taskId) {
      throw new Error(`Invalid dependency for ${taskId}: ${dependency} does not identify an existing task`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Invalid dependency graph for ${taskId}: cycle detected at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of graph.get(id) ?? []) {
      if (!graph.has(dependency)) {
        throw new Error(`Invalid dependency graph for ${taskId}: ${id} references missing task ${dependency}`)
      }
      visit(dependency)
    }
    visiting.delete(id)
    visited.add(id)
  }
  visit(taskId)
}

/**
 * A terminally unsuccessful prerequisite makes every pending dependent
 * impossible to claim. Fail that downstream chain atomically so the board can
 * synthesize; unlike cancellation, failed tasks remain explicitly releasable
 * by the lead if the prerequisite is later repaired/retried.
 */
function failUnfulfillableDependentsSync(
  db: SqliteDatabase,
  runId: string,
  actorAgentId: string,
  ts: string,
): string[] {
  const tasks = listTasksSync(db, runId)
  const statuses = new Map(tasks.map((task) => [task.id, task.status]))
  const failed: string[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) {
      if (['completed', 'failed', 'cancelled'].includes(statuses.get(task.id) ?? task.status)) continue
      const terminalDependency = task.blockedBy.find((dependency) => {
        const status = statuses.get(dependency)
        return status === 'failed' || status === 'cancelled'
      })
      if (!terminalDependency) continue
      const summary = `${task.id} cannot run because dependency ${terminalDependency} did not complete`
      db.prepare("UPDATE protocol_tasks SET status = 'failed', result_summary = ?, result_detail = ?, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(summary, 'Release the failed prerequisite and this task to retry the dependency chain.', ts, runId, task.id)
      if (task.ownerAgentId) {
        db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
          .run(ts, runId, task.ownerAgentId, task.id)
        db.prepare("UPDATE protocol_agents SET task_id = NULL, status = CASE WHEN status IN ('working', 'blocked') THEN 'idle' ELSE status END, updated_at = ? WHERE run_id = ? AND id = ? AND task_id = ?")
          .run(ts, runId, task.ownerAgentId, task.id)
      }
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: actorAgentId,
        type: 'task.failed',
        taskId: task.id,
        summary,
        payload: { dependencyTaskId: terminalDependency, cascaded: true },
        timestamp: ts,
      })
      statuses.set(task.id, 'failed')
      failed.push(task.id)
      changed = true
    }
  }
  return failed
}

/** Bound high-frequency, low-value live-run telemetry without discarding task,
 * finding, review, or ordinary mailbox evidence. Undelivered status mail is
 * retained; acknowledged status rows and their timeline events keep a recent
 * replay window for diagnostics. */
function pruneLiveNoiseSync(db: SqliteDatabase, runId: string): void {
  db.prepare(`
    DELETE FROM protocol_events WHERE rowid IN (
      SELECT rowid FROM protocol_events
      WHERE run_id = ? AND type = 'agent.heartbeat'
      ORDER BY rowid DESC LIMIT -1 OFFSET ?
    )
  `).run(runId, LIVE_NOISE_WINDOW)
  db.prepare(`
    DELETE FROM protocol_events WHERE rowid IN (
      SELECT rowid FROM protocol_events
      WHERE run_id = ? AND type = 'message' AND payload_json LIKE '%"priority":"status"%'
      ORDER BY rowid DESC LIMIT -1 OFFSET ?
    )
  `).run(runId, LIVE_NOISE_WINDOW)
  db.prepare(`
    DELETE FROM protocol_messages WHERE rowid IN (
      SELECT rowid FROM protocol_messages
      WHERE run_id = ? AND delivered_at IS NOT NULL
        AND (kind = 'status' OR priority = 'status')
      ORDER BY rowid DESC LIMIT -1 OFFSET ?
    )
  `).run(runId, LIVE_NOISE_WINDOW)
}

/** Resolve a `message.to` target ('all', 'lead', a name, or an agent id) to agent ids. */
function resolveRecipientsSync(db: SqliteDatabase, runId: string, fromAgentId: string, to: string | undefined): string[] {
  const agents = listAgentsSync(db, runId)
  const active = agents.filter((agent) => !['done', 'failed', 'stopped'].includes(agent.status))
  const target = (to ?? 'lead').trim().toLowerCase()
  if (target === 'all') {
    return active.filter((agent) => agent.id !== fromAgentId).map((agent) => agent.id)
  }
  if (target === 'lead') {
    return active.filter((agent) => agent.role === 'lead' && agent.id !== fromAgentId).map((agent) => agent.id)
  }
  // Names may be reused after a participant retires. Prefer the newest active
  // exact match so mail reaches the replacement rather than stale history.
  const match = active.findLast((agent) => agent.name.toLowerCase() === target || agent.id.toLowerCase() === target)
  return match && match.id !== fromAgentId ? [match.id] : []
}

/**
 * Respond-to gate (see ProtocolAgentRespondToMode) — mirrors buzz-acp's
 * owner-only/allowlist/anyone/nobody inbound author gate. `owner-only` means
 * only this run's lead; `allowlist` means the lead plus the recipient's own
 * allowlist (owner always implicitly included, same as buzz); unset/`anyone`
 * (today's default) and `nobody` are exactly what they say. Only used for
 * participant-to-participant sends — see appendProtocolEvent's 'message'
 * branch and sendExternalProtocolMessage.
 */
function respondToAllowsSync(db: SqliteDatabase, runId: string, recipientAgentId: string, fromAgentId: string): boolean {
  if (recipientAgentId === fromAgentId) return true
  const row = db.prepare('SELECT respond_to_mode, respond_to_allowlist_json FROM protocol_agents WHERE run_id = ? AND id = ?')
    .get(runId, recipientAgentId) as Row | undefined
  const mode = row?.respond_to_mode
  if (!isRespondToMode(mode)) return true // unset — today's default behavior
  if (mode === 'anyone') return true
  if (mode === 'nobody') return false
  const isLead = listAgentsSync(db, runId).find((agent) => agent.id === fromAgentId)?.role === 'lead'
  if (mode === 'owner-only') return isLead
  // allowlist: lead is always implicitly included, matching buzz's "owner is
  // always implicitly included even in allowlist mode".
  if (isLead) return true
  const allowlist = parseJsonArray(row?.respond_to_allowlist_json).map((entry) => entry.toLowerCase())
  const fromAgent = listAgentsSync(db, runId).find((agent) => agent.id === fromAgentId)
  return allowlist.includes(fromAgentId.toLowerCase()) || Boolean(fromAgent && allowlist.includes(fromAgent.name.toLowerCase()))
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

/** Event types that always count as "told the team something" for the reply guard, regardless of whether they happened to queue a message. */
const REPLY_GUARD_REPORT_EVENT_TYPES = new Set<AgentProtocolEvent['type']>([
  'message', 'finding', 'learning', 'handoff', 'review.requested',
])

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
      // Progress is descriptive, never an alternate claim primitive. Enforce
      // ownership inside the same transaction that applies the event so a
      // stale or racing participant cannot steal/reopen another agent's task.
      if ((event.type === 'agent.start_work' || event.type === 'agent.blocked') && event.taskId) {
        const taskRow = db.prepare('SELECT status, owner_agent_id FROM protocol_tasks WHERE id = ? AND run_id = ?')
          .get(event.taskId, event.runId) as Row | undefined
        if (!taskRow) throw new Error(`Coordinator task not found: ${event.taskId}`)
        if (taskRow.owner_agent_id !== event.agentId) {
          throw new Error(`Cannot report progress for ${event.taskId}: this participant does not own the task`)
        }
        if (['completed', 'failed', 'cancelled'].includes(String(taskRow.status))) {
          throw new Error(`Cannot report progress for ${event.taskId}: the task is already ${taskRow.status}`)
        }
      }
      const priorActorRow = db.prepare('SELECT status FROM protocol_agents WHERE id = ? AND run_id = ?')
        .get(event.agentId, event.runId) as Row | undefined
      const priorActorStatus = typeof priorActorRow?.status === 'string' ? priorActorRow.status : undefined
      // Empty heartbeats renew liveness/leases below; persisting one event per
      // worker every 45 seconds adds no decision evidence and grows the live
      // ledger forever. Descriptive heartbeats remain durable progress.
      if (event.type !== 'agent.heartbeat' || event.summary || event.detail) {
        insertEventSync(db, { ...event, timestamp: ts })
      }
      // Any event this agent produces (heartbeat included) proves it is
      // actively running a turn again, so a pending cancel_requested_at from
      // before that turn started has definitionally been observed and acted
      // on — clear it here rather than requiring a dedicated ack call.
      db.prepare('UPDATE protocol_agents SET last_seen_at = ?, updated_at = ?, cancel_requested_at = NULL WHERE id = ? AND run_id = ?')
        .run(ts, ts, event.agentId, event.runId)
      if (event.type === 'agent.heartbeat') {
        db.prepare(`
          UPDATE protocol_locks SET lease_expires_at = ?, updated_at = ?
          WHERE run_id = ? AND agent_id = ? AND status = 'active'
        `).run(leaseIso(), ts, event.runId, event.agentId)
      }
      const newMessageIds: string[] = []
      const queueLeadStatus = (body: string) => {
        for (const recipient of resolveRecipientsSync(db, event.runId, event.agentId, 'lead')) {
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: event.agentId,
            toAgentId: recipient,
            body,
            ts,
            kind: 'review_request',
          }))
        }
      }

      if (event.type === 'agent.heartbeat') {
        if (event.summary || event.detail) {
          queueLeadStatus([`Progress on ${event.taskId ?? 'current work'}: ${event.summary ?? 'heartbeat'}`, event.detail]
            .filter(Boolean).join('\n\n'))
        }
      } else if (event.type === 'agent.ready') {
        setAgentStatusSync(db, event.runId, event.agentId, 'ready', ts)
      } else if (event.type === 'agent.start_work') {
        setAgentStatusSync(db, event.runId, event.agentId, 'working', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND run_id = ? AND owner_agent_id = ?")
            .run(ts, event.taskId, event.runId, event.agentId)
        }
        if (priorActorStatus !== 'working' || event.summary || event.detail) {
          queueLeadStatus([`${event.taskId ?? 'Work'} started${event.summary ? `: ${event.summary}` : '.'}`, event.detail]
            .filter(Boolean).join('\n\n'))
        }
      } else if (event.type === 'agent.stop_work') {
        setAgentStatusSync(db, event.runId, event.agentId, 'idle', ts)
        if (priorActorStatus !== 'idle' || event.summary || event.detail) {
          queueLeadStatus([`${event.taskId ?? 'Work'} paused or stopped${event.summary ? `: ${event.summary}` : '.'}`, event.detail]
            .filter(Boolean).join('\n\n'))
        }
      } else if (event.type === 'agent.blocked') {
        setAgentStatusSync(db, event.runId, event.agentId, 'blocked', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'blocked', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
        }
        // Blocking is itself a coordination event. Relying on a separate
        // model-authored message can strand the run forever when it is omitted:
        // blocked agents count as active, so neither idle-recovery sweep wakes
        // the lead. Make
        // the state transition reliably actionable and let live delivery wake
        // the lead immediately. Teammates may still message a specific peer
        // when that peer is better placed to resolve the blocker.
        const blocker = [event.summary, event.detail].filter(Boolean).join(' — ') || 'No blocker detail was provided.'
        for (const recipient of resolveRecipientsSync(db, event.runId, event.agentId, 'lead')) {
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: event.agentId,
            toAgentId: recipient,
            body: `${event.taskId ? `${event.taskId} is blocked` : 'I am blocked'}: ${blocker}\nCoordinate an unblock, reassignment, or failure decision.`,
            ts,
            kind: 'request',
            priority: 'urgent',
          }))
        }
      } else if (event.type === 'agent.unblocked') {
        setAgentStatusSync(db, event.runId, event.agentId, 'working', ts)
        if (event.taskId) {
          db.prepare("UPDATE protocol_tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND run_id = ?")
            .run(ts, event.taskId, event.runId)
        }
        queueLeadStatus([`${event.taskId ?? 'Work'} resumed${event.summary ? `: ${event.summary}` : '.'}`, event.detail]
          .filter(Boolean).join('\n\n'))
      } else if (event.type === 'task.created') {
        const runRow = db.prepare('SELECT status, lead_agent_id FROM protocol_runs WHERE id = ?')
          .get(event.runId) as Row | undefined
        const reopening = runRow?.status === 'synthesizing'
          && String(runRow.lead_agent_id ?? 'lead') === event.agentId
        const blockedBy = [...new Set(event.dependsOn ?? [])]
        validateTaskDependenciesSync(db, event.runId, nextTaskIdSync(db, event.runId), blockedBy)
        insertTaskSync(db, event.runId, {
          title: event.title ?? event.summary ?? 'Untitled task',
          prompt: event.detail ?? event.summary ?? 'No prompt provided.',
          paths: event.paths ?? [],
          blockedBy,
          targetRole: reopening ? 'lead' : 'teammate',
        })
        // A lead may discover follow-up work during synthesis, or a terminal
        // event from earlier in this same streamed turn may race ahead of the
        // replacement task. In either case, task creation reopens the board;
        // otherwise handleLeadTurnEnd can mistake this intervention for the
        // synthesis turn and complete a run that still has pending work.
        if (reopening) {
          db.prepare("UPDATE protocol_runs SET status = 'running', updated_at = ? WHERE id = ?")
            .run(ts, event.runId)
          insertEventSync(db, {
            version: AGENT_PROTOCOL_VERSION,
            runId: event.runId,
            agentId: event.agentId,
            type: 'run.status',
            summary: `Run reopened: the lead added ${event.taskId ?? 'follow-up work'} during synthesis`,
            payload: { status: 'running' },
            timestamp: ts,
          })
        }
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
          const blockedBy = [...new Set(event.dependsOn ?? [])]
          validateTaskDependenciesSync(db, event.runId, nextTaskIdSync(db, event.runId), blockedBy)
          insertTaskSync(db, event.runId, {
            title: event.title ?? event.summary ?? 'Untitled task',
            prompt: event.detail ?? event.summary ?? 'No prompt provided.',
            paths: event.paths ?? [],
            blockedBy,
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
          const resultSummary = event.summary?.trim() || `${event.taskId} completed`
          const resultDetail = event.detail?.trim() || null
          db.prepare("UPDATE protocol_tasks SET status = 'completed', result_summary = ?, result_detail = ?, updated_at = ? WHERE id = ? AND run_id = ?")
            .run(resultSummary, resultDetail, ts, event.taskId, event.runId)
          db.prepare('UPDATE protocol_agents SET task_id = NULL, updated_at = ? WHERE id = ? AND run_id = ? AND task_id = ?')
            .run(ts, event.agentId, event.runId, event.taskId)
          db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
            .run(ts, event.runId, event.agentId, event.taskId)
          const unfinished = Number((db.prepare(`
            SELECT COUNT(*) AS n FROM protocol_tasks
            WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
          `).get(event.runId) as Row | undefined)?.n) || 0
          // Intermediate results are actionable supervision input. Wake the
          // lead exactly once with the durable result while other work remains;
          // the all-terminal path instead includes every persisted result in
          // the synthesis prompt and avoids racing an intervention turn.
          if (unfinished > 0) {
            for (const recipient of resolveRecipientsSync(db, event.runId, event.agentId, 'lead')) {
              newMessageIds.push(insertMessageSync(db, {
                runId: event.runId,
                fromAgentId: event.agentId,
                toAgentId: recipient,
                body: [`${event.taskId} completed: ${resultSummary}`, resultDetail].filter(Boolean).join('\n\n'),
                ts,
                kind: 'handoff',
              }))
            }
          }
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
          const resultSummary = event.summary?.trim() || `${event.taskId} failed`
          const resultDetail = event.detail?.trim() || null
          db.prepare("UPDATE protocol_tasks SET status = 'failed', result_summary = ?, result_detail = ?, updated_at = ? WHERE id = ? AND run_id = ?")
            .run(resultSummary, resultDetail, ts, event.taskId, event.runId)
          db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
            .run(ts, event.runId, event.agentId, event.taskId)
          db.prepare('UPDATE protocol_agents SET task_id = NULL, updated_at = ? WHERE id = ? AND run_id = ? AND task_id = ?')
            .run(ts, event.agentId, event.runId, event.taskId)
          failUnfulfillableDependentsSync(db, event.runId, event.agentId, ts)
          const unfinished = Number((db.prepare(`
            SELECT COUNT(*) AS n FROM protocol_tasks
            WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
          `).get(event.runId) as Row | undefined)?.n) || 0
          if (unfinished > 0) {
            for (const recipient of resolveRecipientsSync(db, event.runId, event.agentId, 'lead')) {
              newMessageIds.push(insertMessageSync(db, {
                runId: event.runId,
                fromAgentId: event.agentId,
                toAgentId: recipient,
                body: [`${event.taskId} failed: ${resultSummary}`, resultDetail, 'Review dependencies and reassign, replace, or accept the failure.'].filter(Boolean).join('\n\n'),
                ts,
                kind: 'handoff',
                priority: 'urgent',
              }))
            }
          }
        }
      } else if (event.type === 'task.released' && event.taskId) {
        const taskRow = db.prepare('SELECT * FROM protocol_tasks WHERE run_id = ? AND id = ?')
          .get(event.runId, event.taskId) as Row | undefined
        const task = taskRow ? rowToTask(taskRow) : null
        if (task && !['completed', 'cancelled'].includes(task.status)) {
          db.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, result_summary = NULL, result_detail = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
            .run(ts, event.runId, task.id)
          if (task.ownerAgentId) {
            db.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND task_id = ? AND status = 'active'")
              .run(ts, event.runId, task.ownerAgentId, task.id)
            db.prepare("UPDATE protocol_agents SET task_id = NULL, status = CASE WHEN status IN ('working', 'blocked') THEN 'idle' ELSE status END, updated_at = ? WHERE run_id = ? AND id = ? AND task_id = ?")
              .run(ts, event.runId, task.ownerAgentId, task.id)
          }
          const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(event.runId) as Row | undefined
          if (runRow?.status === 'synthesizing') {
            db.prepare("UPDATE protocol_runs SET status = 'running', updated_at = ? WHERE id = ?")
              .run(ts, event.runId)
            insertEventSync(db, {
              version: AGENT_PROTOCOL_VERSION,
              runId: event.runId,
              agentId: event.agentId,
              type: 'run.status',
              summary: `Run reopened: ${task.id} was requeued for another attempt`,
              payload: { status: 'running' },
              timestamp: ts,
            })
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
        const resolvedRecipients = resolveRecipientsSync(db, event.runId, event.agentId, event.to)
        const target = (event.to ?? 'lead').trim()
        // Respond-to gating (see ProtocolAgentRespondToMode) applies only to
        // participant-to-participant sends, not the coordinator-authored
        // system messages elsewhere in this function (cancel notices, blocked
        // alerts, plan reviews, ...) — those always reach their target.
        const recipients = resolvedRecipients.filter((recipientId) => respondToAllowsSync(db, event.runId, recipientId, event.agentId))
        const gatedOut = resolvedRecipients.filter((id) => !recipients.includes(id))
        if (recipients.length === 0 && target.toLowerCase() !== 'all') {
          // A typo'd or stale teammate name must not vanish a message with no
          // trace — tell the sender delivery failed instead of silently
          // dropping it (the external send path already throws on this).
          const reason = gatedOut.length > 0
            ? `${target} is not accepting messages from you right now (respond-to gate)`
            : `no teammate named "${target}" in this run. Check the roster and resend`
          newMessageIds.push(insertMessageSync(db, {
            runId: event.runId,
            fromAgentId: 'coordinator',
            toAgentId: event.agentId,
            body: `Delivery failed: ${reason}.`,
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
        setAgentStatusSync(db, event.runId, event.agentId, 'stopped', ts)
      }

      // Reply guard bookkeeping: this event counted as "telling the team
      // something" if it's an explicit report type, or if it queued at least
      // one message to the lead above (a heartbeat/start_work/stop_work with
      // real content, a blocked report, a submitted plan, ...). A bare
      // content-less heartbeat does neither and correctly does not count.
      if (REPLY_GUARD_REPORT_EVENT_TYPES.has(event.type) || newMessageIds.length > 0) {
        db.prepare('UPDATE protocol_agents SET last_report_at = ? WHERE id = ? AND run_id = ?')
          .run(ts, event.agentId, event.runId)
      }

      pruneLiveNoiseSync(db, event.runId)
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
  if ((event.type === 'task.created' || event.type === 'task.released') && result.snapshot?.run.status === 'running') {
    const controller = controllers.get(event.runId)
    if (controller?.synthesisStarted) {
      controller.synthesisStarted = false
      controller.synthesisFindingFloorRowid = 0
    }
  }
  if (event.type === 'task.released') {
    void sweepIdleTeammates(event.runId).catch(() => {})
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

function formatMailboxDelivery(messageId: string, from: ProtocolAgent | undefined, body: string): string {
  return `[team message ${messageId} from ${from?.name ?? 'coordinator'}] ${body}`
}

// Initial insert delivery, the mailbox sweep, and pending-session realization
// can race in the same process. Only one may steer a given durable message at
// a time; otherwise a slow successful steer can be duplicated before it gets
// a chance to stamp delivered_at. External participants are pull-based, so
// their cross-process durability remains in SQLite rather than this set.
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCoordinatorLiveDeliveryInFlight: Set<string> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCoordinatorInboxDispatchInFlight: Set<string> | undefined
}

const liveDeliveryInFlight = globalThis.__agentViewerCoordinatorLiveDeliveryInFlight
  ?? (globalThis.__agentViewerCoordinatorLiveDeliveryInFlight = new Set<string>())
const inboxDispatchInFlight = globalThis.__agentViewerCoordinatorInboxDispatchInFlight
  ?? (globalThis.__agentViewerCoordinatorInboxDispatchInFlight = new Set<string>())

async function deliverMessagesLive(runId: string, messageIds: string[]): Promise<void> {
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const controller = controllers.get(runId)
  const wake = new Set<string>()
  const supervisionWake = new Set<string>()
  for (const id of messageIds) {
    // A new provider turn already contains this message in its preamble. Do
    // not also steer it into that turn while startup is awaiting acceptance.
    if (liveDeliveryInFlight.has(id) || inboxDispatchInFlight.has(id)) continue
    liveDeliveryInFlight.add(id)
    try {
      const row = db.prepare('SELECT * FROM protocol_messages WHERE id = ?').get(id) as Row | undefined
      if (!row) continue
      const message = rowToMessage(row)
      if (message.deliveredAt) continue
      const recipient = agentsById.get(message.toAgentId)
      if (!recipient) continue
      const sessionId = controller?.sessionIds.get(recipient.id) ?? recipient.sessionId
      const text = formatMailboxDelivery(message.id, agentsById.get(message.fromAgentId), message.body)
      // External MCP participants do not have a native provider session for the
      // coordinator to steer. Their mailbox stays queued until coord_read_inbox
      // acknowledges it in that CLI's bridge process.
      const delivered = sessionId.startsWith('external:')
        ? false
        : await steerRunningSession(sessionId, text)
          .then((result) => result.delivered)
          .catch(() => false)
      if (delivered) {
        await enqueueWrite((tx) => {
          tx.prepare('UPDATE protocol_messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL').run(nowIso(), id)
        })
      } else {
        wake.add(recipient.id)
        if (message.kind === 'handoff' || message.kind === 'review_request' || message.kind === 'review_result') {
          supervisionWake.add(recipient.id)
        }
      }
    } finally {
      liveDeliveryInFlight.delete(id)
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
      void dispatchLeadIntervention(controller, { supervision: supervisionWake.has(agentId) })
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

async function deliverQueuedMessagesForAgent(runId: string, agentId: string): Promise<void> {
  const db = await getDatabase()
  const rows = db.prepare(`
    SELECT id FROM protocol_messages
    WHERE run_id = ? AND to_agent_id = ? AND delivered_at IS NULL
    ORDER BY created_at ASC
  `).all(runId, agentId) as Row[]
  if (rows.length > 0) {
    await deliverMessagesLive(runId, rows.map((row) => String(row.id)))
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
 * Self-healing task assignment: reunite an idle teammate with claimable work
 * the moment there is any, independent of whether its own turn-end happened
 * to run the self-claim check at the right moment. When NOBODY can claim
 * anything and the whole team has gone idle with unfinished work on the
 * board, force a bounded lead intervention — this is exactly the "lead
 * should be coordinating as tasks complete" gap: `dispatchLeadIntervention`
 * shares one small MAX_LEAD_INTERVENTIONS budget across every stall/plan
 * wake in the run, so a run with a few earlier nudges could exhaust it long
 * before the last teammate finishes, leaving the lead permanently unreachable
 * even though real work remains. `force` draws from the separate
 * MAX_FORCED_INTERVENTIONS budget so this can't happen; once that is also
 * spent, the remaining tasks are auto-failed so the run still reaches
 * synthesis instead of hanging forever with everyone idle.
 */
async function sweepIdleTeammates(runId: string): Promise<void> {
  const controller = controllers.get(runId)
  if (!controller || controller.stopped || controller.synthesisStarted) return
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  let claimedAny = false
  for (const agent of agents) {
    if (agent.role !== 'teammate' || agent.taskId || controller.turnInFlight.has(agent.id)) continue
    if (agent.status !== 'done' && agent.status !== 'idle' && agent.status !== 'ready') continue
    const claimed = await enqueueWrite((tx) => claimTaskSync(tx, runId, agent.id))
    if (claimed) {
      claimedAny = true
      void dispatchTeammateWork(controller, agent.id)
    }
  }
  if (claimedAny) return

  const tasks = listTasksSync(db, runId)
  const unfinished = tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
  if (unfinished.length === 0) return
  const teammatesActive = agents.some((agent) =>
    agent.role === 'teammate' && (agent.status === 'working' || agent.status === 'blocked' || controller.turnInFlight.has(agent.id)))
  if (teammatesActive) return

  if (controller.forcedInterventionsUsed < MAX_FORCED_INTERVENTIONS) {
    await dispatchLeadIntervention(controller, { force: true }).catch(() => {})
    return
  }
  for (const task of unfinished) {
    await appendProtocolEvent({
      version: AGENT_PROTOCOL_VERSION,
      runId,
      agentId: task.ownerAgentId ?? 'coordinator',
      type: 'task.failed',
      taskId: task.id,
      summary: `${task.id} auto-failed: the whole team went idle with unfinished work and the lead intervention budget is exhausted`,
    }).catch(() => {})
  }
  await maybeStartSynthesis(controller).catch(() => {})
}

const TEAM_IDLE_PING_PREFIX = 'Team idle:'
const TEAM_IDLE_PING_COOLDOWN_MS = 2 * 60_000
/**
 * Claiming a task is itself an async round-trip (join → ready → claim), and
 * this check runs on the 5s mailbox sweep — without a grace window, a team
 * that just reached `ready` reads as "idle with unfinished work" and gets
 * pinged before it has had a realistic chance to claim anything.
 */
const TEAM_IDLE_GRACE_MS = Math.max(0, Number(process.env.AGENT_VIEWER_COORD_TEAM_IDLE_GRACE_MS) || 20_000)
const SUPERVISION_PING_PREFIX = 'Supervision checkpoint:'

/**
 * sweepIdleTeammates only reaches internal (in-process) teammates — it needs
 * a live RunController to dispatch a turn. External CLI participants are
 * pull-based: their worker loop only wakes for a new provider tick when
 * `coord_wait`'s actionable digest shows inbox mail, a claimable task, or a
 * plan to review (`shouldTick` in bin/agent-viewer-coord-worker.mjs). If the
 * whole external team finishes and nobody happens to message the lead about
 * it (nothing in the protocol requires that — it's model discretion), the
 * lead's own digest stays quiet forever and its worker never ticks again,
 * even though the lead is the one who's supposed to notice, reassign, or
 * finalize. This is the run-agnostic half of the fix: purely DB-driven (no
 * controller needed), so it covers external and internal runs alike. A
 * cooldown avoids re-pinging every sweep tick while the lead catches up.
 */
async function pingLeadIfTeamIdle(runId: string): Promise<void> {
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  const lead = agents.find((agent) => agent.role === 'lead')
  if (!lead) return
  const teammates = agents.filter((agent) => agent.role === 'teammate')
  if (teammates.length === 0) return
  const anyActive = teammates.some((agent) => Boolean(agent.taskId) || agent.status === 'working' || agent.status === 'blocked')
  if (anyActive) return
  const mostRecentActivity = Math.max(
    ...teammates.map((agent) => Date.parse(agent.lastSeenAt ?? agent.updatedAt) || 0),
  )
  if (Date.now() - mostRecentActivity < TEAM_IDLE_GRACE_MS) return
  const tasks = listTasksSync(db, runId)
  const unfinished = tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
  if (unfinished.length === 0) return
  const cutoff = new Date(Date.now() - TEAM_IDLE_PING_COOLDOWN_MS).toISOString()
  const recentPing = db.prepare(`
    SELECT 1 FROM protocol_messages
    WHERE run_id = ? AND to_agent_id = ? AND from_agent_id = 'coordinator' AND body LIKE ? AND created_at > ?
    LIMIT 1
  `).get(runId, lead.id, `${TEAM_IDLE_PING_PREFIX}%`, cutoff) as Row | undefined
  if (recentPing) return
  const summary = unfinished.map((task) => `${task.id} "${task.title}" (${task.status})`).join(', ')
  const messageId = await enqueueWrite((tx) => insertMessageSync(tx, {
    runId,
    fromAgentId: 'coordinator',
    toAgentId: lead.id,
    body: `${TEAM_IDLE_PING_PREFIX} the whole team is idle with ${unfinished.length} task${unfinished.length === 1 ? '' : 's'} not yet complete (${summary}). Reassign, unblock, fail, or finalize.`,
    ts: nowIso(),
    kind: 'request',
    priority: 'urgent',
  }))
  notifyRunChanged(runId)
  await deliverMessagesLive(runId, [messageId]).catch(() => {})
}

/**
 * Keep a long-running lead informed even when every teammate is healthy and no
 * blocker/mailbox event would otherwise wake it. The checkpoint is durable,
 * rate-limited, and only exists while owned work is active. Internal leads get
 * a budget-free supervision turn; external lead workers wake through the same
 * event/inbox path and receive the latest authoritative snapshot.
 */
async function checkpointLeadSupervision(runId: string): Promise<void> {
  const db = await getDatabase()
  const agents = listAgentsSync(db, runId)
  const lead = agents.find((agent) => agent.role === 'lead')
  if (!lead) return
  const teammates = agents.filter((agent) => agent.role === 'teammate')
  const active = teammates.filter((agent) => (
    Boolean(agent.taskId)
    || agent.status === 'working'
    || agent.status === 'blocked'
    || controllers.get(runId)?.turnInFlight.has(agent.id) === true
  ))
  if (active.length === 0) return
  const tasks = listTasksSync(db, runId)
  if (!tasks.some((task) => !['completed', 'failed', 'cancelled'].includes(task.status))) return
  const cutoff = new Date(Date.now() - SUPERVISION_CHECKPOINT_MS).toISOString()
  const recent = db.prepare(`
    SELECT 1 FROM protocol_messages
    WHERE run_id = ? AND to_agent_id = ? AND from_agent_id = 'coordinator'
      AND body LIKE ? AND created_at > ?
    LIMIT 1
  `).get(runId, lead.id, `${SUPERVISION_PING_PREFIX}%`, cutoff) as Row | undefined
  if (recent) return
  const summary = active.map((agent) => {
    const task = agent.taskId ? ` on ${agent.taskId}` : ''
    const turn = controllers.get(runId)?.turnInFlight.has(agent.id) ? ', turn active' : ''
    return `${agent.name}: ${agent.status}${task}${turn}, last update ${agent.lastSeenAt ?? agent.updatedAt}`
  }).join('; ')
  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId,
    agentId: 'coordinator',
    type: 'message',
    to: lead.id,
    summary: `${SUPERVISION_PING_PREFIX} ${summary}. Review current status; leave healthy work running, and unblock or reassign only where the board requires it.`,
    payload: { kind: 'review_request', priority: 'normal' },
  })
}

/**
 * The mailbox's only durability guarantee: every active run gets retried
 * delivery attempts and reply-required escalation for its whole lifetime,
 * independent of whether the original insert's fire-and-forget delivery
 * succeeded. Cheap when idle (one indexed query per run, no active runs is
 * one query total) so it just runs for the life of the process. Also drives
 * pingLeadIfTeamIdle and sweepIdleTeammates — same interval, same "keep
 * trying for the run's whole lifetime" guarantee, for task assignment
 * instead of message delivery.
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
    await pingLeadIfTeamIdle(runId).catch(() => {})
    await checkpointLeadSupervision(runId).catch(() => {})
    await sweepIdleTeammates(runId).catch(() => {})
  }
}

/** Run one maintenance pass immediately (used by diagnostics and smokes). */
export async function runProtocolMaintenanceSweep(): Promise<void> {
  await sweepMailboxes()
  await sweepPushNotifications().catch(() => {})
  await dispatchNewProjectWebhookEvents().catch(() => {})
}

let mailSweepTimer: ReturnType<typeof setInterval> | null = null

function ensureMailSweep(): void {
  if (mailSweepTimer) return
  mailSweepTimer = setInterval(() => {
    void sweepMailboxes().catch(() => {})
    void sweepPushNotifications().catch(() => {})
    void dispatchNewProjectWebhookEvents().catch(() => {})
  }, MAIL_SWEEP_INTERVAL_MS)
  mailSweepTimer.unref?.()
}

ensureMailSweep()

/**
 * Wake the lead mid-run to unstick the team. Budgeted (MAX_LEAD_INTERVENTIONS)
 * so lead↔teammate loops terminate; past the budget, stuck tasks are
 * auto-failed by the work loop instead. `force` draws from the separate
 * MAX_FORCED_INTERVENTIONS budget instead (see sweepIdleTeammates) so a
 * whole-team stall isn't silently starved by unrelated stall/plan-review
 * spend earlier in the run.
 */
async function dispatchLeadIntervention(controller: RunController, opts: { force?: boolean; supervision?: boolean } = {}): Promise<void> {
  if (controller.stopped || controller.synthesisStarted) return
  const db = await getDatabase()
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(controller.runId) as Row | undefined
  if (!runRow || rowToRun(runRow).status !== 'running') return
  const agents = listAgentsSync(db, controller.runId)
  const lead = agents.find((agent) => agent.role === 'lead')
  if (!lead || controller.turnInFlight.has(lead.id)) return
  const tasks = listTasksSync(db, controller.runId)
  const reviewingPlans = controller.requirePlanApproval && tasks.some((task) => task.status === 'planned')
  if (opts.supervision) {
    // A finite, rate-limited status checkpoint/result handoff is not a stuck
    // agent ping-pong and must not exhaust the actual intervention budget.
  } else if (opts.force) {
    if (controller.forcedInterventionsUsed >= MAX_FORCED_INTERVENTIONS) return
    controller.forcedInterventionsUsed += 1
  } else {
    if (!reviewingPlans && controller.interventionsUsed >= MAX_LEAD_INTERVENTIONS) return
    if (!reviewingPlans) controller.interventionsUsed += 1
  }
  const inbox = await enqueueWrite((tx) => takeInboxSync(tx, controller.runId, lead.id))
  const message = controller.sdkIdentities.has(lead.id)
    ? buildSdkToolsTickPrompt({
        runId: controller.runId,
        agent: lead,
        cwd: lead.worktreePath,
        note: opts.supervision
          ? 'Routine supervision checkpoint — check coord_status for every teammate and unblock, reassign, or add work if the board shows a real need; otherwise stand by.'
          : `Woken mid-run — a teammate needs help, is stuck, or messaged you. ${reviewingPlans ? 'A submitted plan is waiting on coord_review_plan.' : ''} Check coord_status and your inbox and act.`,
      })
    : buildLeadInterventionPreamble({
        runId: controller.runId,
        agent: lead,
        cwd: lead.worktreePath,
        roster: agents,
        tasks,
        inbox,
        agentsById: new Map(agents.map((agent) => [agent.id, agent])),
        interventionsLeft: MAX_LEAD_INTERVENTIONS - controller.interventionsUsed,
        requirePlanApproval: controller.requirePlanApproval,
        reviewingPlans,
        supervisionUpdate: opts.supervision === true,
      })
  void dispatchAgentTurn(controller, lead.id, message, { inboxMessageIds: inbox.map((entry) => entry.id) })
}

function takeInboxSync(db: SqliteDatabase, runId: string, agentId: string): ProtocolMessage[] {
  const rows = db.prepare('SELECT * FROM protocol_messages WHERE run_id = ? AND to_agent_id = ? AND delivered_at IS NULL ORDER BY created_at ASC')
    .all(runId, agentId) as Row[]
  return rows.map(rowToMessage)
}

function acknowledgeInboxSync(db: SqliteDatabase, runId: string, agentId: string, messageIds: string[]): void {
  if (messageIds.length === 0) return
  const acknowledge = db.prepare(`
    UPDATE protocol_messages SET delivered_at = COALESCE(delivered_at, ?)
    WHERE id = ? AND run_id = ? AND to_agent_id = ?
  `)
  const ts = nowIso()
  for (const messageId of messageIds) acknowledge.run(ts, messageId, runId, agentId)
}

// ---------------------------------------------------------------------------
// Turn plumbing: dispatch a turn to an agent's session, drain its stream for
// protocol events, and feed the work loop when the stream ends.

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return
  if (typeof value === 'string') {
    if (value.includes('```a2a') || value.includes('agent-protocol')) out.push(value)
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

// Mirrors bin/agent-viewer-coord-worker.mjs's classifyProviderFailure: a
// richer failure taxonomy than a flat 'provider_failure' bucket lets
// handleProviderTurnFailure decide which failures are worth a same-provider
// retry (transient_transport, plain provider_failure) versus which never are
// (rate/auth/context exhaustion — retrying the identical provider/session
// cannot fix any of those).
type ProviderTurnFailure = {
  kind: 'rate_limited' | 'authentication_failed' | 'context_exhausted' | 'transient_transport' | 'provider_failure'
  detail: string
}

function classifyProviderTurnFailure(detail: string): ProviderTurnFailure {
  const normalized = detail.toLowerCase()
  const kind = /session limit|usage limit|rate.?limit|quota|insufficient (?:credits|balance)|too many requests|\b429\b/.test(normalized)
    ? 'rate_limited'
    : /authentication|not authenticated|unauthorized|invalid api key|expired (?:token|credential)|\b401\b|\b403\b/.test(normalized)
      ? 'authentication_failed'
      : /context (?:window|length)|maximum context|context.*exceed|too many tokens/.test(normalized)
        ? 'context_exhausted'
        : /econnreset|econnrefused|epipe|timed? out|temporar|network|socket|transport/.test(normalized)
          ? 'transient_transport'
          : 'provider_failure'
  return { kind, detail: detail.trim().slice(0, 1200) || 'Provider turn failed' }
}

/** Same-provider retry budget before handleProviderTurnFailure gives up and fails over to a different provider. Mirrors the worker's durableFailure thresholds (3 for generic failures, 5 for transient transport; rate/auth/context-exhaustion never retry). */
const SAME_PROVIDER_RETRY_LIMITS: Partial<Record<ProviderTurnFailure['kind'], number>> = {
  provider_failure: 3,
  transient_transport: 5,
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function allStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 8) return
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) allStrings(item, out, depth + 1)
    return
  }
  for (const item of Object.values(value as Record<string, unknown>)) allStrings(item, out, depth + 1)
}

/** Detect canonical SSE errors plus Claude quota/auth failures emitted as ordinary assistant text. */
function providerTurnFailureFromWire(text: string, provider: ProtocolRun['provider']): ProviderTurnFailure | null {
  for (const match of text.matchAll(/event: error\s*\ndata: ([^\n]+)/g)) {
    try {
      const parsed = JSON.parse(match[1]!) as { error?: unknown }
      const values: string[] = []
      allStrings(parsed.error, values)
      return classifyProviderTurnFailure(values.join(' ') || 'Provider turn failed')
    } catch {
      return classifyProviderTurnFailure(match[1]!)
    }
  }
  if (provider !== 'claude') return null
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice('data:'.length).trim()
    if (!raw || raw === '[DONE]') continue
    try {
      const record = JSON.parse(raw) as Record<string, unknown>
      const isAssistant = record.type === 'assistant'
      const isErrorResult = record.type === 'result' && record.is_error === true
      if (!isAssistant && !isErrorResult) continue
      const values: string[] = []
      allStrings(isAssistant ? record.message : record, values)
      const detail = values.join(' ')
      if (isErrorResult || /session limit|usage limit|rate.?limit|quota|insufficient (?:credits|balance)|too many requests|authentication|not authenticated|unauthorized|invalid api key|expired (?:token|credential)/i.test(detail)) {
        return classifyProviderTurnFailure(detail)
      }
    } catch {
      // An incomplete SSE line will be retried with the next accumulated chunk.
    }
  }
  return null
}

/**
 * Shared lookup for "does this real (non-`external:`) session id belong to a
 * live Coordinator agent right now" — used by observeCoordinatorSessionTurn
 * (write-back: parse ```a2a blocks the model emits) and the cooperative-join
 * functions below (read: drain the mailbox before the next send). Both need
 * the same answer so a session's write-back and read-drain never disagree
 * about which run currently governs it.
 */
function findActiveCoordinatorAgentBySessionSync(db: SqliteDatabase, sessionId: string): Row | undefined {
  return db.prepare(`
    SELECT a.* FROM protocol_agents a
    JOIN protocol_runs r ON r.id = a.run_id
    WHERE a.session_id = ?
      AND a.session_id NOT LIKE 'external:%'
      AND r.status IN ('planning', 'running', 'synthesizing', 'blocked')
    ORDER BY r.updated_at DESC
    LIMIT 1
  `).get(sessionId) as Row | undefined
}

/**
 * Bind a user-driven session turn back to its internal Coordinator agent.
 *
 * Controller-dispatched turns are drained below, but a user can also open the
 * lead or teammate session in the web/TUI composer and send a follow-up. That
 * stream used to bypass the protocol parser entirely: the model visibly
 * emitted `message` blocks, while the ledger and recipients never saw them.
 * Tee only active internal Coordinator sessions and consume the observation
 * branch asynchronously so the caller's SSE stream remains unchanged.
 */
export async function observeCoordinatorSessionTurn(sessionId: string, response: Response): Promise<Response> {
  if (!response.body) return response
  const db = await getDatabase()
  let row = findActiveCoordinatorAgentBySessionSync(db, sessionId)

  // A pending provider session can realize a new id before the durable agent
  // row is updated. The live controller already owns that alias, so use it as
  // the authoritative fallback during this narrow transition.
  if (!row) {
    for (const controller of controllers.values()) {
      const agentId = [...controller.sessionIds].find(([, id]) => id === sessionId)?.[0]
      if (!agentId) continue
      row = db.prepare('SELECT * FROM protocol_agents WHERE run_id = ? AND id = ?')
        .get(controller.runId, agentId) as Row | undefined
      if (row) break
    }
  }
  if (!row) return response

  const agent = rowToAgent(row)
  const [clientBody, observerBody] = response.body.tee()
  void (async () => {
    const reader = observerBody.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const seen = new Set<string>()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (buffer.length > 250_000) buffer = buffer.slice(-120_000)
        for (const event of parseProtocolEventsFromWire(buffer)) {
          const key = JSON.stringify(event)
          if (seen.has(key)) continue
          seen.add(key)
          if (event.runId !== agent.runId || event.agentId !== agent.id) continue
          const controller = controllers.get(agent.runId)
          if (controller) await applyAgentEvent(controller, agent, event)
          else await appendProtocolEvent(event)
        }
      }
    } catch {
      // Observation is best-effort and must never break the provider stream.
      await reader.cancel().catch(() => {})
    } finally {
      reader.releaseLock()
    }
  })()

  return new Response(clientBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export type CooperativeJoinResult = {
  runId: string
  agentId: string
  name: string
}

/**
 * Murmur-inspired "hi murmur" cooperative join: binds an ALREADY-EXISTING,
 * user-driven session (opened normally in the web/TUI composer, not spawned
 * by startProtocolRun) to a Coordinator run as a teammate — no worktree, no
 * capability token, no independent polling loop. The session keeps its real
 * `session_id`, so observeCoordinatorSessionTurn (already wired into both
 * message routes) picks up any ```a2a blocks the model emits in its normal
 * replies, exactly as it does for run-spawned agents; drainCooperativeInbox
 * below supplies the other half — injecting pending mail before the user's
 * next send, mirroring murmur's non-blocking poll-then-handle sequence.
 */
export async function joinSessionToCoordinatorRun(params: {
  runId: string
  sessionId: string
  provider: ProtocolRun['provider']
  cwd: string
  name: string
}): Promise<CooperativeJoinResult> {
  const result = await enqueueWrite((db) => {
    const runRow = db.prepare('SELECT status FROM protocol_runs WHERE id = ?').get(params.runId) as Row | undefined
    if (!runRow) throw new Error('Coordinator run not found')
    if (!['planning', 'running', 'synthesizing', 'blocked'].includes(String(runRow.status))) {
      throw new Error('Coordinator run is not accepting new participants')
    }
    const existing = db.prepare('SELECT id, name FROM protocol_agents WHERE run_id = ? AND session_id = ?')
      .get(params.runId, params.sessionId) as Row | undefined
    if (existing) return { runId: params.runId, agentId: String(existing.id), name: String(existing.name) }
    const requested = params.name.trim() || 'cooperative'
    const taken = new Set((db.prepare('SELECT name FROM protocol_agents WHERE run_id = ?').all(params.runId) as Row[])
      .map((row) => String(row.name).toLowerCase()))
    let name = requested
    for (let suffix = 2; taken.has(name.toLowerCase()); suffix += 1) name = `${requested}-${suffix}`
    const agentId = `coop-${randomUUID()}`
    const ts = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`
        INSERT INTO protocol_agents (
          id, run_id, name, role, provider, session_id, worktree_path, worktree_branch,
          task_id, status, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'teammate', ?, ?, ?, '', NULL, 'ready', ?, ?, ?)
      `).run(agentId, params.runId, name, params.provider, params.sessionId, params.cwd, ts, ts, ts)
      insertEventSync(db, {
        version: AGENT_PROTOCOL_VERSION,
        runId: params.runId,
        agentId,
        type: 'agent.ready',
        summary: `${name} joined cooperatively from an existing ${params.provider} session`,
        timestamp: ts,
      })
      db.prepare('UPDATE protocol_runs SET updated_at = ? WHERE id = ?').run(ts, params.runId)
      db.exec('COMMIT')
      return { runId: params.runId, agentId, name }
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(params.runId)
  return result
}

/** Leaves whatever Coordinator run this session is cooperatively bound to, if any (murmur's `leave murmur`). */
export async function leaveCoordinatorSession(sessionId: string): Promise<{ left: boolean; runId?: string }> {
  const db = await getDatabase()
  const row = findActiveCoordinatorAgentBySessionSync(db, sessionId)
  if (!row) return { left: false }
  const agent = rowToAgent(row)
  await enqueueWrite((tx) => {
    const ts = nowIso()
    tx.exec('BEGIN IMMEDIATE')
    try {
      if (agent.taskId) {
        tx.prepare("UPDATE protocol_tasks SET status = 'pending', owner_agent_id = NULL, updated_at = ? WHERE run_id = ? AND id = ? AND owner_agent_id = ?")
          .run(ts, agent.runId, agent.taskId, agent.id)
      }
      tx.prepare("UPDATE protocol_locks SET status = 'released', updated_at = ? WHERE run_id = ? AND agent_id = ? AND status = 'active'")
        .run(ts, agent.runId, agent.id)
      tx.prepare("UPDATE protocol_agents SET status = 'stopped', task_id = NULL, updated_at = ? WHERE run_id = ? AND id = ?")
        .run(ts, agent.runId, agent.id)
      insertEventSync(tx, {
        version: AGENT_PROTOCOL_VERSION,
        runId: agent.runId,
        agentId: agent.id,
        type: 'agent.stop_work',
        summary: `${agent.name} left cooperatively`,
        timestamp: ts,
      })
      tx.exec('COMMIT')
    } catch (err) {
      tx.exec('ROLLBACK')
      throw err
    }
  })
  notifyRunChanged(agent.runId)
  return { left: true, runId: agent.runId }
}

/**
 * Non-blocking mailbox drain for a cooperatively-joined session: returns a
 * compact text block to prepend to the user's next outgoing message, or ''
 * if the session isn't bound to a live run or has nothing pending — mirrors
 * murmur's `poll(timeout_ms=0)` cooperative-mode drain, done here server-side
 * since a normal chat session has no MCP tool access to poll the room itself.
 */
export async function drainCooperativeInbox(sessionId: string): Promise<string> {
  const db = await getDatabase()
  const row = findActiveCoordinatorAgentBySessionSync(db, sessionId)
  if (!row) return ''
  const agent = rowToAgent(row)
  const inbox = await enqueueWrite((tx) => {
    const messages = takeInboxSync(tx, agent.runId, agent.id)
    if (messages.length > 0) {
      acknowledgeInboxSync(tx, agent.runId, agent.id, messages.map((message) => message.id))
      tx.prepare('UPDATE protocol_agents SET last_seen_at = ? WHERE run_id = ? AND id = ?').run(nowIso(), agent.runId, agent.id)
    }
    return messages
  })
  if (inbox.length === 0) return ''
  const roster = listAgentsSync(db, agent.runId)
  const agentsById = new Map(roster.map((entry) => [entry.id, entry]))
  return [
    '',
    `--- Coordinator room (run ${agent.runId}, you are "${agent.name}") — messages since your last turn ---`,
    formatInbox(inbox, agentsById),
    'Reply here in chat as normal. If the room needs to hear something back, also emit a fenced ```a2a block '
      + '(operation "message", to the sender or "all") in this same reply — same format teammates use; it is parsed automatically.',
    '--- end Coordinator room ---',
    '',
  ].join('\n')
}

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
  // The run flag is not authoritative about where participants actually WORK:
  // a run created with worktrees enabled can still be staffed by workers that
  // joined with --shared, so every agent sits in one checkout. Detect that from
  // the roster and apply the same reasoning as an explicitly shared run —
  // otherwise each lane's dirt is blamed on whoever completes, which with two
  // concurrently dirty lanes deadlocks the board: neither can ever complete.
  if (sharesCheckoutWithAnotherAgentSync(db, runId, agentId, worktreePath)) return null
  const activeLocks = (db.prepare(`
    SELECT * FROM protocol_locks
    WHERE run_id = ? AND status = 'active' AND lease_expires_at > ?
  `).all(runId, nowIso()) as Row[]).map(rowToLock)
  const locks = activeLocks.filter((lock) => lock.agentId === agentId)
  // Files under another participant's active write lock are demonstrably their
  // lane, not unattributed drift by this agent. Excluding them keeps the gate
  // honest about THIS agent's footprint instead of forcing it to either cover
  // a teammate's paths or destroy their work to pass.
  const foreignLocks = activeLocks.filter((lock) => lock.agentId !== agentId && lock.mode === 'write')
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
      const baselineHead = baseline.__head__
      const currentHead = current.__head__
      const candidates = new Set(Object.keys(current).filter((file) => file !== '__head__'))
      if (baselineHead && currentHead && baselineHead !== currentHead) {
        const committed = await changedPathsBetween(worktreePath, baselineHead, currentHead).catch(() => [] as string[])
        for (const file of committed) candidates.add(file)
      }
      // A baseline records dirty paths only. If a pre-existing dirty file is
      // committed by another actor while this task is running, it disappears
      // from `git status` and its path appears in the HEAD range. Comparing the
      // live file fingerprint to the claim-time fingerprint distinguishes that
      // harmless cleanup from an actual task-local modification.
      const changedSinceClaim = await Promise.all([...candidates].map(async (file) => {
        const fingerprint = current[file] ?? await pathFingerprint(worktreePath, file)
        return fingerprint !== baseline[file] ? file : null
      }))
      files = changedSinceClaim.filter((file): file is string => file !== null)
    }
  }
  const uncovered = files.filter((file) => (
    !locks.some((lock) => lock.mode === 'write' && lockPathsOverlap(lock.path, file))
    && !foreignLocks.some((lock) => lockPathsOverlap(lock.path, file))
  ))
  return uncovered.length > 0 ? uncovered : null
}

/**
 * True when another live participant in this run works out of the same checkout
 * directory. Concurrent edits there cannot be attributed to one agent by git
 * status alone, so path-based completion gating would reject honest work.
 */
function sharesCheckoutWithAnotherAgentSync(
  db: SqliteDatabase,
  runId: string,
  agentId: string,
  worktreePath: string,
): boolean {
  const normalize = (value: string): string => value.replace(/\/+$/, '')
  const mine = normalize(worktreePath)
  if (!mine) return false
  const rows = db.prepare(
    'SELECT worktree_path FROM protocol_agents WHERE run_id = ? AND id != ?',
  ).all(runId, agentId) as Row[]
  return rows.some((row) => normalize(String(row.worktree_path ?? '')) === mine)
}

async function drainAgentStream(controller: RunController, agent: ProtocolAgent, response: Response): Promise<ProviderTurnFailure | null> {
  const reader = response.body?.getReader()
  if (!reader) return classifyProviderTurnFailure('Provider response had no stream body')
  const decoder = new TextDecoder()
  let buffer = ''
  let realized = false
  let failure: ProviderTurnFailure | null = null
  let terminalEventObserved = false
  const seen = new Set<string>()
  const turnStartedAt = Date.now()
  let lastActivityAt = turnStartedAt
  // External participants heartbeat via their own coord_progress('heartbeat')
  // calls (bin/agent-viewer-coord-worker.mjs), which recoverStaleExternalParticipantsSync
  // reads to distinguish "alive, mid-turn" from "actually dead." An in-process
  // turn had no equivalent — last_seen_at only moved at turn start/end — so a
  // long-running turn looked identical to a dead one to anything reading
  // last_seen_at (status displays, external tooling). Touch it periodically
  // here, throttled well below AGENT_TURN_INACTIVITY_TIMEOUT_MS so it reflects
  // genuine stream activity rather than papering over a real stall.
  let lastHeartbeatWriteAt = turnStartedAt
  const HEARTBEAT_WRITE_INTERVAL_MS = 15_000
  let stalled = false
  const stallReason = (): string => Date.now() - turnStartedAt >= AGENT_TURN_TIMEOUT_MS
    ? `turn exceeded the ${AGENT_TURN_TIMEOUT_MS}ms Coordinator turn deadline`
    : `turn produced no output for ${AGENT_TURN_INACTIVITY_TIMEOUT_MS}ms`
  try {
    for (;;) {
      const remaining = Math.min(
        AGENT_TURN_TIMEOUT_MS - (Date.now() - turnStartedAt),
        AGENT_TURN_INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivityAt),
      )
      if (remaining <= 0) { stalled = true; break }
      let timer: ReturnType<typeof setTimeout> | undefined
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) => {
          timer = setTimeout(() => resolve({ done: true, value: undefined }), remaining)
        }),
      ]).finally(() => { if (timer) clearTimeout(timer) })
      if (done) {
        if (Date.now() - lastActivityAt >= AGENT_TURN_INACTIVITY_TIMEOUT_MS || Date.now() - turnStartedAt >= AGENT_TURN_TIMEOUT_MS) stalled = true
        break
      }
      lastActivityAt = Date.now()
      if (lastActivityAt - lastHeartbeatWriteAt >= HEARTBEAT_WRITE_INTERVAL_MS) {
        lastHeartbeatWriteAt = lastActivityAt
        enqueueWrite((tx) => {
          tx.prepare('UPDATE protocol_agents SET last_seen_at = ? WHERE id = ? AND run_id = ?')
            .run(nowIso(), agent.id, controller.runId)
        }).catch(() => {})
      }
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
              // A lead message can land after the draft session starts but
              // before the provider reports its realized id. The initial
              // steer correctly fails against the draft id and stays queued;
              // flush it now that the running-session registry and controller
              // agree on the real target instead of waiting for the sweep.
              await deliverQueuedMessagesForAgent(controller.runId, agent.id)
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
        try {
          await applyAgentEvent(controller, agent, event)
        } catch (error) {
          // A malformed or out-of-order model control event is not a provider
          // outage. Reject that event and keep draining the healthy turn; the
          // normal work loop will redispatch the authoritative board state.
          await appendProtocolEvent({
            version: AGENT_PROTOCOL_VERSION,
            runId: controller.runId,
            agentId: agent.id,
            type: 'agent.blocked',
            summary: `Coordinator rejected ${event.type}`,
            detail: error instanceof Error ? error.message : String(error),
          }).catch(() => {})
          continue
        }
        if (event.type === 'task.completed' || event.type === 'task.failed' || event.type === 'finding') {
          terminalEventObserved = true
        }
      }
      failure ??= providerTurnFailureFromWire(buffer, agent.provider)
    }
  } catch (err) {
    failure = classifyProviderTurnFailure(err instanceof Error ? err.message : 'Worker stream failed')
  }
  if (stalled && !terminalEventObserved) {
    failure ??= classifyProviderTurnFailure(`Provider ${stallReason()}`)
    // The abandoned reader.read() may still resolve later against a stream
    // that never ends; cancel it so the underlying connection actually closes
    // instead of leaking. Race the session interrupt the same way
    // stopProtocolRun does — a wedged provider SDK/socket must not block
    // reporting the failure back to the work loop.
    await reader.cancel().catch(() => {})
    const sessionId = controller.sessionIds.get(agent.id) ?? agent.sessionId
    if (sessionId) {
      await Promise.race([
        interruptRunningSession(sessionId).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, SESSION_INTERRUPT_TIMEOUT_MS)),
      ])
    }
  }
  return terminalEventObserved ? null : failure
}

/** Event application with coordinator-side gating (doc: TaskCompleted hook semantics). */
async function applyAgentEvent(controller: RunController, agent: ProtocolAgent, event: AgentProtocolEvent): Promise<void> {
  if (event.type === 'task.completed' && event.taskId) {
    if (agent.role === 'teammate' && controller.requirePlanApproval) {
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
    const uncovered = agent.role === 'teammate'
      ? await completionGateFailure(controller.runId, agent.id, agent.worktreePath)
      : null
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
    // command must pass in the assigned agent's checkout or completion bounces
    // back with the failure output. Explicit lead integration tasks run this
    // in the main checkout after teammate work has landed.
    if (controller.gateCommand) {
      const failure = await runGateCommand(controller.gateCommand, agent.worktreePath)
      if (failure) {
        const note = `Completion of ${event.taskId} was REJECTED by the quality gate \`${controller.gateCommand}\` in your checkout:\n${failure}\nFix the failures, re-run the gate yourself, then complete again.`
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

async function handleProviderTurnFailure(
  controller: RunController,
  agent: ProtocolAgent,
  failure: ProviderTurnFailure,
  opts: { allowSameProviderRetry?: boolean } = {},
): Promise<'retry' | 'terminal'> {
  // Same-provider retry resends the identical message text to the SAME
  // session — safe only when the turn never produced any output, since a
  // coord_* tool call already executes (mutates the board) the moment the
  // model calls it, independent of whether the turn later fails. A retry
  // after real output happened (a mid-drainAgentStream stall, or an
  // ambiguous exception that might be mid-turn) risks the model re-issuing a
  // non-idempotent call like coord_create_task a second time. Only the
  // turn-never-started path (HTTP failed to accept the turn at all) can
  // prove that didn't happen — every other call site defaults this off and
  // falls through to the pre-existing failover-with-a-fresh-session behavior.
  const retryLimit = opts.allowSameProviderRetry !== false ? SAME_PROVIDER_RETRY_LIMITS[failure.kind] : undefined
  if (retryLimit !== undefined) {
    const used = controller.sameProviderRetries.get(agent.id) ?? 0
    if (used < retryLimit) {
      controller.sameProviderRetries.set(agent.id, used + 1)
      const delayMs = Math.min(30_000, 1_000 * 2 ** used)
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: agent.id,
        type: 'learning',
        summary: `${agent.name} hit a ${failure.kind} error on ${agent.provider}; retrying the same provider (${used + 1}/${retryLimit}) in ${delayMs}ms`,
        detail: failure.detail,
        payload: { failureClass: failure.kind, provider: agent.provider, attempt: used + 1, retryLimit },
      }).catch(() => {})
      await sleep(delayMs)
      return 'retry'
    }
  }
  const failed = controller.failedProviders.get(agent.id) ?? new Set<ProtocolRun['provider']>()
  failed.add(agent.provider)
  controller.failedProviders.set(agent.id, failed)
  const candidates = [...new Set([...controller.teammateProviders, controller.provider])]
    .filter((provider) => provider !== agent.provider && !failed.has(provider))

  for (const provider of candidates) {
    try {
      const session = await createNewViewSession({
        provider,
        cwd: agent.worktreePath,
        title: `${controller.title ?? 'Coordinated run'} · ${agent.name} failover`,
        codexDynamicTools: provider === 'codex' ? buildCoordinatorCodexDynamicTools() : undefined,
      })
      // The old session's coord_* tool binding (if any) is dead the moment its
      // session id stops being used — candidates always exclude agent.provider,
      // so failover always lands on a different provider than whatever this
      // was bound for. Rebind for the new session below instead of leaving a
      // stale identity that would send a tool-calling tick prompt to a
      // provider with no coord_* tools actually registered.
      const oldSessionId = controller.sessionIds.get(agent.id)
      if (oldSessionId) unregisterCoordinatorToolsForProvider(agent.provider, oldSessionId)
      controller.sdkIdentities.delete(agent.id)
      controller.sessionIds.set(agent.id, session.sessionId)
      if (session.isPending) controller.pendingSessions.add(agent.id)
      else controller.pendingSessions.delete(agent.id)
      // Provider-specific model/effort identifiers are unsafe after a
      // cross-provider handoff. Let the replacement use its native defaults.
      controller.model = undefined
      controller.effort = undefined
      if (agent.role === 'lead') controller.provider = provider
      const canUseInProcessTools = await inProcessToolsAvailable(provider)
      const token = await enqueueWrite((tx) => {
        const ts = nowIso()
        tx.prepare('UPDATE protocol_agents SET provider = ?, session_id = ?, status = ?, updated_at = ? WHERE id = ? AND run_id = ?')
          .run(provider, session.sessionId, 'working', ts, agent.id, controller.runId)
        if (agent.role === 'lead') {
          tx.prepare('UPDATE protocol_runs SET provider = ?, updated_at = ? WHERE id = ?')
            .run(provider, ts, controller.runId)
        }
        insertEventSync(tx, {
          version: AGENT_PROTOCOL_VERSION,
          runId: controller.runId,
          agentId: agent.id,
          type: 'learning',
          summary: `${agent.name} failed over from ${agent.provider} to ${provider}`,
          detail: failure.detail,
          payload: { failureClass: failure.kind, fromProvider: agent.provider, toProvider: provider },
          timestamp: ts,
        })
        return canUseInProcessTools ? issueParticipantTokenSync(tx, controller.runId, agent.id, undefined, ts) : undefined
      })
      if (token) {
        const identity: ExternalProtocolIdentity = { runId: controller.runId, agentId: agent.id, token }
        registerCoordinatorToolsForProvider(provider, session.sessionId, identity)
        controller.sdkIdentities.set(agent.id, identity)
      }
      controller.sameProviderRetries.delete(agent.id)
      return 'retry'
    } catch (error) {
      failed.add(provider)
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: agent.id,
        type: 'learning',
        summary: `Provider failover to ${provider} could not start`,
        detail: error instanceof Error ? error.message : String(error),
        payload: { failureClass: 'provider_failure', fromProvider: agent.provider, toProvider: provider },
      }).catch(() => {})
    }
  }

  const detail = `${agent.provider} ${failure.kind}: ${failure.detail}`
  if (agent.role === 'lead') {
    controller.stopped = true
    await enqueueWrite((tx) => {
      const ts = nowIso()
      tx.prepare("UPDATE protocol_runs SET status = 'failed', summary = ?, updated_at = ? WHERE id = ?")
        .run(`Lead provider failed and no configured failover was available. ${detail}`, ts, controller.runId)
      tx.prepare("UPDATE protocol_agents SET status = CASE WHEN id = ? THEN 'failed' ELSE 'stopped' END, updated_at = ? WHERE run_id = ?")
        .run(agent.id, ts, controller.runId)
      insertEventSync(tx, {
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: agent.id,
        type: 'run.status',
        summary: 'Run failed: lead provider unavailable and failover exhausted',
        detail,
        payload: { status: 'failed', failureClass: failure.kind },
        timestamp: ts,
      })
    })
    controllers.delete(controller.runId)
    return 'terminal'
  }

  await appendProtocolEvent({
    version: AGENT_PROTOCOL_VERSION,
    runId: controller.runId,
    agentId: agent.id,
    type: 'agent.blocked',
    taskId: agent.taskId,
    summary: `${agent.name} provider failed and no configured failover was available`,
    detail,
    payload: { failureClass: failure.kind },
  })
  await dispatchLeadIntervention(controller, { force: true })
  return 'terminal'
}

async function dispatchAgentTurn(
  controller: RunController,
  agentId: string,
  message: string,
  opts: { permissionMode?: 'plan'; inboxMessageIds?: string[] } = {},
): Promise<void> {
  if (controller.stopped || controller.turnInFlight.has(agentId)) return
  controller.turnInFlight.add(agentId)
  let retryAfterFailover = false
  let providerFailureHandled = false
  let activeAgent: ProtocolAgent | null = null
  for (const messageId of opts.inboxMessageIds ?? []) inboxDispatchInFlight.add(messageId)
  try {
    const db = await getDatabase()
    const agentRow = db.prepare('SELECT * FROM protocol_agents WHERE id = ? AND run_id = ?').get(agentId, controller.runId) as Row | undefined
    if (!agentRow) return
    const agent = rowToAgent(agentRow)
    activeAgent = agent
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
      providerFailureHandled = true
      retryAfterFailover = await handleProviderTurnFailure(
        controller,
        agent,
        classifyProviderTurnFailure(`Failed to start turn: HTTP ${response.status} ${response.statusText}`),
      ) === 'retry'
      return
    }
    // The provider accepted the turn containing this exact inbox batch. Only
    // now is it safe to acknowledge those messages; a failed startup leaves
    // them durable for the next dispatch instead of silently losing them.
    if (opts.inboxMessageIds?.length) {
      await enqueueWrite((tx) => acknowledgeInboxSync(tx, controller.runId, agent.id, opts.inboxMessageIds!))
    }
    const failure = await drainAgentStream(controller, agent, response)
    if (failure) {
      providerFailureHandled = true
      retryAfterFailover = await handleProviderTurnFailure(controller, agent, failure, { allowSameProviderRetry: false }) === 'retry'
    } else {
      controller.sameProviderRetries.delete(agent.id)
    }
  } catch (error) {
    if (activeAgent && !providerFailureHandled) {
      providerFailureHandled = true
      try {
        retryAfterFailover = await handleProviderTurnFailure(
          controller,
          activeAgent,
          classifyProviderTurnFailure(error instanceof Error ? error.message : String(error)),
          // Ambiguous origin — could be a pre-stream setup failure (safe to
          // retry) or an exception thrown mid-drainAgentStream after real
          // output (unsafe). Default conservative; see the allowSameProviderRetry
          // doc comment on handleProviderTurnFailure.
          { allowSameProviderRetry: false },
        ) === 'retry'
      } catch (failoverError) {
        await appendProtocolEvent({
          version: AGENT_PROTOCOL_VERSION,
          runId: controller.runId,
          agentId,
          type: 'agent.blocked',
          summary: `Coordinator dispatch and failover failed: ${failoverError instanceof Error ? failoverError.message : String(failoverError)}`,
        }).catch(() => {})
      }
    }
  } finally {
    for (const messageId of opts.inboxMessageIds ?? []) inboxDispatchInFlight.delete(messageId)
    controller.turnInFlight.delete(agentId)
    if (retryAfterFailover && !controller.stopped) {
      void dispatchAgentTurn(controller, agentId, message, { permissionMode: opts.permissionMode })
    } else if (!providerFailureHandled) {
      await handleAgentTurnEnd(controller, agentId).catch(() => {})
    }
  }
}

/** Compose and dispatch an assigned work turn (teammate or explicit lead task). */
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

  if (task && agent.role === 'teammate' && shouldPlanTaskSync(db, controller, task)) {
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
    const message = controller.sdkIdentities.has(agentId)
      ? buildSdkToolsTickPrompt({
          runId: controller.runId,
          agent,
          cwd: agent.worktreePath,
          note: `THIS TURN IS PLAN-ONLY for ${task.id} — ${task.title}. Do not edit files. Study the repo read-only, then call coord_submit_plan with your approach; wait for lead approval before implementing.${note ? ` ${note}` : ''}`,
        })
      : buildTeammatePlanPreamble({
          runId: controller.runId,
          agent,
          cwd: agent.worktreePath,
          roster: agents,
          task,
          allTasks: tasks,
          inbox,
          agentsById,
          note,
          useWorktrees: controller.useWorktrees,
        })
    void dispatchAgentTurn(controller, agentId, message, {
      permissionMode: 'plan',
      inboxMessageIds: inbox.map((entry) => entry.id),
    })
    return
  }

  const inbox = await enqueueWrite((tx) => takeInboxSync(tx, controller.runId, agentId))
  controller.dispatchNotes.delete(agentId)
  const message = controller.sdkIdentities.has(agentId)
    ? buildSdkToolsTickPrompt({ runId: controller.runId, agent, cwd: agent.worktreePath, note })
    : buildTeammateTurnPreamble({
        runId: controller.runId,
        agent,
        cwd: agent.worktreePath,
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
  void dispatchAgentTurn(controller, agentId, message, { inboxMessageIds: inbox.map((entry) => entry.id) })
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
  await dispatchClaimableLeadTask(controller)
  await maybeStartSynthesis(controller)
}

/** Claim and run a playbook's explicit lead lane once its phase barrier opens. */
async function dispatchClaimableLeadTask(controller: RunController): Promise<boolean> {
  if (controller.stopped || controller.synthesisStarted || controller.turnInFlight.has('lead')) return false
  const db = await getDatabase()
  const lead = listAgentsSync(db, controller.runId).find((agent) => agent.role === 'lead')
  if (!lead) return false
  const task = await enqueueWrite((tx) => claimTaskSync(tx, controller.runId, lead.id))
  if (!task) return false
  await dispatchTeammateWork(controller, lead.id)
  return true
}

async function maybeStartSynthesis(controller: RunController): Promise<void> {
  if (controller.stopped || controller.synthesisStarted) return
  const db = await getDatabase()
  const lead = listAgentsSync(db, controller.runId).find((agent) => agent.role === 'lead')
  if (!lead) return
  // A lead can fail obsolete tasks and create replacements in one streamed
  // intervention. Starting synthesis between those events races the stream
  // and turns the intervention itself into a bogus final synthesis turn.
  if (controller.turnInFlight.has(lead.id)) return
  const tasks = listTasksSync(db, controller.runId)
  const unfinished = tasks.some((task) => task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled')
  if (tasks.length === 0 || unfinished) return
  const runRow = db.prepare('SELECT * FROM protocol_runs WHERE id = ?').get(controller.runId) as Row | undefined
  if (!runRow) return
  const run = rowToRun(runRow)
  const findingFloor = Number((db.prepare(
    "SELECT COALESCE(MAX(rowid), 0) AS rowid FROM protocol_events WHERE run_id = ? AND agent_id = ? AND type = 'finding'",
  ).get(controller.runId, lead.id) as Row | undefined)?.rowid) || 0
  controller.synthesisStarted = true
  controller.synthesisFindingFloorRowid = findingFloor
  await enqueueWrite((tx) => {
    tx.prepare('UPDATE protocol_runs SET status = ?, updated_at = ? WHERE id = ?').run('synthesizing', nowIso(), controller.runId)
  })
  const agents = listAgentsSync(db, controller.runId)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const knowledgeRows = db.prepare(
    "SELECT * FROM protocol_events WHERE run_id = ? AND type IN ('finding', 'learning') ORDER BY created_at ASC LIMIT 120",
  ).all(controller.runId) as Row[]
  const message = controller.sdkIdentities.has(lead.id)
    ? buildSdkToolsTickPrompt({
        runId: controller.runId,
        agent: lead,
        cwd: lead.worktreePath,
        note: `All tasks are terminal. Review coord_status (task results and every finding/learning) against the original objective — "${run.prompt}" — reconcile findings, run any final integration checks, then call coord_finalize_run with a concise synthesis: what was done, what was learned, what remains, and any risks.`,
      })
    : buildLeadSynthesisPreamble({
        runId: controller.runId,
        agent: lead,
        cwd: lead.worktreePath,
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

  if (run.status === 'planning' || (!controller.executionStarted && run.status === 'running')) {
    await beginExecutionPhase(controller)
    return
  }

  if (run.status === 'running') {
    const leadId = run.leadAgentId ?? 'lead'
    const owned = listTasksSync(db, controller.runId).find((task) => (
      task.ownerAgentId === leadId
      && ['claimed', 'in_progress', 'blocked'].includes(task.status)
    ))
    if (owned) {
      const nudgeKey = `${leadId}:${owned.id}`
      const used = controller.nudges.get(nudgeKey) ?? 0
      if (used < MAX_TURN_NUDGES) {
        controller.nudges.set(nudgeKey, used + 1)
        controller.dispatchNotes.set(leadId, `Your previous turn ended while explicit lead task ${owned.id} was still open. Complete it, or emit task.failed / agent.blocked with the exact reason.`)
        await dispatchTeammateWork(controller, leadId)
        return
      }
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: leadId,
        type: 'task.failed',
        taskId: owned.id,
        summary: `${owned.id} auto-failed: the lead integration task stalled after ${MAX_TURN_NUDGES + 1} turns`,
      })
    }
    if (await dispatchClaimableLeadTask(controller)) return
    // An intervention turn ended: the lead goes back to standby, and its
    // decisions (task.failed / task.created) may have finished the board.
    await enqueueWrite((tx) => {
      setAgentStatusSync(tx, controller.runId, run.leadAgentId ?? 'lead', 'idle', nowIso())
    })
    await maybeStartSynthesis(controller)
    return
  }

  if (run.status === 'synthesizing') {
    const tasks = listTasksSync(db, controller.runId)
    const unfinished = tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
    if (unfinished.length > 0) {
      // Completion is a last-line invariant, not an assumption inherited from
      // when synthesis was scheduled. Follow-up tasks may have landed while
      // the lead turn was in flight, so reopen instead of completing them out
      // from under their owners.
      await enqueueWrite((tx) => {
        const ts = nowIso()
        tx.prepare("UPDATE protocol_runs SET status = 'running', updated_at = ? WHERE id = ?")
          .run(ts, controller.runId)
        setAgentStatusSync(tx, controller.runId, run.leadAgentId ?? 'lead', 'idle', ts)
        insertEventSync(tx, {
          version: AGENT_PROTOCOL_VERSION,
          runId: controller.runId,
          agentId: run.leadAgentId ?? 'lead',
          type: 'run.status',
          summary: `Run reopened: ${unfinished.length} task${unfinished.length === 1 ? '' : 's'} remain unfinished after synthesis`,
          payload: { status: 'running' },
          timestamp: ts,
        })
      })
      controller.synthesisStarted = false
      controller.synthesisFindingFloorRowid = 0
      void sweepIdleTeammates(controller.runId).catch(() => {})
      return
    }
    // The lead's final `finding` is the run summary.
    const findingRow = db.prepare(
      "SELECT * FROM protocol_events WHERE run_id = ? AND agent_id = ? AND type = 'finding' AND rowid > ? ORDER BY rowid DESC LIMIT 1",
    ).get(controller.runId, run.leadAgentId ?? 'lead', controller.synthesisFindingFloorRowid) as Row | undefined
    const summary = findingRow
      ? [findingRow.summary, findingRow.detail].filter((part) => typeof part === 'string' && part).join('\n\n')
      : undefined
    const completed = Boolean(summary)
    const finalSummary = summary || 'Lead synthesis ended without a final finding; the run was not completed.'
    await enqueueWrite((tx) => {
      const ts = nowIso()
      tx.prepare('UPDATE protocol_runs SET status = ?, summary = ?, updated_at = ? WHERE id = ?')
        .run(completed ? 'completed' : 'failed', finalSummary, ts, controller.runId)
      if (completed) {
        tx.prepare("UPDATE protocol_agents SET status = 'done', updated_at = ? WHERE run_id = ? AND status NOT IN ('failed', 'stopped')")
          .run(ts, controller.runId)
      } else {
        tx.prepare("UPDATE protocol_agents SET status = CASE WHEN id = ? THEN 'failed' ELSE 'stopped' END, updated_at = ? WHERE run_id = ? AND status NOT IN ('failed', 'stopped')")
          .run(run.leadAgentId ?? 'lead', ts, controller.runId)
        insertEventSync(tx, {
          version: AGENT_PROTOCOL_VERSION,
          runId: controller.runId,
          agentId: run.leadAgentId ?? 'lead',
          type: 'run.status',
          summary: 'Run failed: lead synthesis produced no final finding',
          payload: { status: 'failed' },
          timestamp: ts,
        })
      }
    })
    controllers.delete(controller.runId)
    if (completed) void cleanupProtocolRunWorktrees(controller.runId).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Run lifecycle

/** Spawn teammates against the (lead-authored or fallback) task board and start the loop. */
async function beginExecutionPhase(controller: RunController): Promise<void> {
  if (controller.stopped || controller.executionStarted) return
  controller.executionStarted = true
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
    let workspace: WorktreeTask | { path: string; branch: string } | null = null
    let session: Awaited<ReturnType<typeof createNewViewSession>>
    try {
      workspace = controller.useWorktrees
        ? await createWorktreeTask(controller.baseCwd, `${controller.title ?? 'coord'}-${name}`)
        : { path: controller.baseCwd, branch: '' }
      const teammateProvider = controller.teammateProviders[index % controller.teammateProviders.length] ?? controller.provider
      session = await createNewViewSession({
        provider: teammateProvider,
        cwd: workspace.path,
        title: `${controller.title ?? 'Coordinated run'} · ${name}`,
        codexDynamicTools: teammateProvider === 'codex' ? buildCoordinatorCodexDynamicTools() : undefined,
      })
    } catch (err) {
      // Session creation happens after the isolated checkout is registered.
      // If the provider cannot create a session, tear that checkout back down
      // here because no protocol_agents row exists for the normal run cleanup
      // sweep to discover later.
      if (workspace && 'repoRoot' in workspace) {
        await removeWorktreeTask(workspace, { force: true }).catch(() => {})
      }
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId: controller.runId,
        agentId: 'lead',
        type: 'agent.blocked',
        summary: `Failed to spawn teammate ${name}: ${err instanceof Error ? err.message : String(err)}`,
      }).catch(() => {})
      continue
    }
    if (!workspace) continue
    const agentId = `agent-${index + 1}`
    const canUseInProcessTools = await inProcessToolsAvailable(session.provider)
    const token = await enqueueWrite((tx) => {
      tx.prepare(`
        INSERT INTO protocol_agents (
          id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, task_id, status, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'teammate', ?, ?, ?, ?, NULL, 'idle', NULL, ?, ?)
      `).run(agentId, controller.runId, name, session.provider, session.sessionId, workspace.path, workspace.branch, ts, ts)
      claimTaskSync(tx, controller.runId, agentId)
      return canUseInProcessTools ? issueParticipantTokenSync(tx, controller.runId, agentId, undefined, ts) : undefined
    })
    if (token) {
      const identity: ExternalProtocolIdentity = { runId: controller.runId, agentId, token }
      registerCoordinatorToolsForProvider(session.provider, session.sessionId, identity)
      controller.sdkIdentities.set(agentId, identity)
    }
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
  await dispatchClaimableLeadTask(controller)
}

/**
 * Start a coordinated run: create the LEAD session immediately (returned so
 * the UI can open its tab), then asynchronously run the phases — lead plans
 * the task board, teammates spawn into their configured checkouts and work the claim loop,
 * lead synthesizes when the board is done.
 */
export async function startProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  const playbook = params.playbookName ? await loadRunPlaybook(params.baseCwd, params.playbookName) : undefined
  if (playbook && params.playbookArgs === undefined && playbookExpectsArgs(playbook)) {
    throw new Error(
      `Playbook "${playbook.name}" expects args (${playbook.argsHint ?? 'see the {{args}} placeholders in its task text'})`,
    )
  }
  const prompt = params.prompt.trim() || (playbook ? `Playbook run: ${playbook.name}` : '')
  if (!prompt) throw new Error('prompt is required')
  const runId = randomUUID()
  const ts = nowIso()
  const maxAgents = Math.max(2, Math.min(params.maxAgents ?? playbook?.maxAgents ?? 3, 6))
  const teammateProviders = [...new Set(params.teammateProviders?.filter(Boolean) ?? [])]
  if (teammateProviders.length === 0) teammateProviders.push(params.provider)

  const leadSession = await createNewViewSession({
    provider: params.provider,
    cwd: params.baseCwd,
    title: `${params.title ?? playbook?.name ?? 'Coordinated run'} · lead`,
    codexDynamicTools: params.provider === 'codex' ? buildCoordinatorCodexDynamicTools() : undefined,
  })

  const controller: RunController = {
    runId,
    prompt,
    provider: params.provider,
    teammateProviders,
    baseCwd: params.baseCwd,
    maxAgents,
    title: params.title ?? playbook?.name,
    model: params.model,
    effort: params.effort,
    gateCommand: (params.gateCommand ?? playbook?.gateCommand)?.trim() || undefined,
    requirePlanApproval: (params.requirePlanApproval ?? playbook?.requirePlanApproval) === true,
    useWorktrees: params.useWorktrees !== false,
    stopped: false,
    synthesisStarted: false,
    synthesisFindingFloorRowid: 0,
    interventionsUsed: 0,
    forcedInterventionsUsed: 0,
    turnInFlight: new Set(),
    sessionIds: new Map([['lead', leadSession.sessionId]]),
    pendingSessions: new Set(leadSession.isPending ? ['lead'] : []),
    nudges: new Map(),
    dispatchNotes: new Map(),
    failedProviders: new Map(),
    sdkIdentities: new Map(),
    executionStarted: false,
    sameProviderRetries: new Map(),
  }
  controllers.set(runId, controller)

  // Claude/Pi/Copilot/Codex/OpenCode SDKs each support in-process (no
  // subprocess) custom tools — see lib/agentCoordinationSdkTools.ts.
  let leadToken: string | undefined
  const leadCanUseInProcessTools = await inProcessToolsAvailable(params.provider)
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
      if (playbook) seedPlaybookTasksSync(db, runId, 'lead', playbook, params.playbookArgs)
      if (leadCanUseInProcessTools) leadToken = issueParticipantTokenSync(db, runId, 'lead', undefined, ts)
      db.exec('COMMIT')
      const next = readSnapshotSync(db, runId)
      if (!next) throw new Error('Failed to read created run')
      return next
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  })

  if (leadToken) {
    const identity: ExternalProtocolIdentity = { runId, agentId: 'lead', token: leadToken }
    registerCoordinatorToolsForProvider(leadSession.provider, leadSession.sessionId, identity)
    controller.sdkIdentities.set('lead', identity)
  }

  if (playbook) {
    void beginExecutionPhase(controller).catch(async (err) => {
      await appendProtocolEvent({
        version: AGENT_PROTOCOL_VERSION,
        runId,
        agentId: 'lead',
        type: 'agent.blocked',
        summary: err instanceof Error ? err.message : 'Failed to launch playbook teammates',
      }).catch(() => {})
    })
  } else {
    const planMessage = leadToken
      ? buildSdkToolsTickPrompt({
          runId,
          agent: { id: 'lead', name: 'lead', role: 'lead' },
          cwd: leadSession.cwd,
          note: `THIS TURN IS PLAN-ONLY: decompose this objective into ${Math.max((maxAgents - 1) * 2, 4)}-${(maxAgents - 1) * 5} small, self-contained tasks with coord_create_task (non-overlapping write paths). Do not call coord_claim_task or implement anything yourself this turn — teammates are spawned right after this turn ends specifically to claim these tasks, and a task you grab now is one they can't. End your turn once the board is decomposed; you'll be dispatched again later for lead-only integration work. Objective: ${prompt}`,
        })
      : buildLeadPlanPreamble({
          runId,
          agent: { id: 'lead', name: 'lead' },
          cwd: leadSession.cwd,
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
  }

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
  controllers.delete(runId)
  if (controller) for (const sessionId of controller.sessionIds.values()) unregisterCoordinatorToolsForSession(sessionId)
  const snapshot = await enqueueWrite((tx) => {
    const ts = nowIso()
    const updated = tx.prepare('UPDATE protocol_runs SET status = ?, updated_at = ? WHERE id = ?').run('stopped', ts, runId) as { changes?: number | bigint } | undefined
    if (Number(updated?.changes ?? 0) === 0) return null
    tx.prepare("UPDATE protocol_agents SET status = ?, updated_at = ? WHERE run_id = ? AND status NOT IN ('done', 'failed', 'stopped')")
      .run('stopped', ts, runId)
    tx.prepare("UPDATE protocol_locks SET status = ?, updated_at = ? WHERE run_id = ? AND status = 'active'")
      .run('released', ts, runId)
    insertEventSync(tx, {
      version: AGENT_PROTOCOL_VERSION,
      runId,
      agentId: 'coordinator',
      type: 'run.status',
      summary: 'Coordinator run stopped',
      payload: { status: 'stopped' },
      timestamp: ts,
    })
    return readSnapshotSync(tx, runId)
  })
  notifyRunChanged(runId)
  // The durable terminal state is authoritative and must not wait behind a
  // provider SDK/socket that never resolves its interrupt call. Supervisors
  // wake from the event above; local session interrupts are bounded best effort.
  await Promise.allSettled(agents.flatMap((agent) => {
    const ids = new Set([agent.sessionId, controller?.sessionIds.get(agent.id)].filter((id): id is string => Boolean(id)))
    return [...ids].map((id) => Promise.race([
      interruptRunningSession(id).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, SESSION_INTERRUPT_TIMEOUT_MS)),
    ]))
  }))
  return snapshot
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
  controllers.delete(runId)
  if (controller) for (const sessionId of controller.sessionIds.values()) unregisterCoordinatorToolsForSession(sessionId)
  // Remove the durable run first. External supervisors treat the missing run
  // as terminal and can stop their provider process even when an in-process
  // SDK interrupt is wedged. Cleanup below remains bounded and best effort.
  const deleted = await enqueueWrite((tx) => {
    const result = tx.prepare('DELETE FROM protocol_runs WHERE id = ?').run(runId) as { changes?: number | bigint } | undefined
    return Number(result?.changes ?? 0) > 0
  })
  notifyRunChanged(runId)
  await Promise.allSettled(agents.flatMap((agent) => {
    const ids = new Set([agent.sessionId, controller?.sessionIds.get(agent.id)].filter((id): id is string => Boolean(id)))
    return [...ids].map((id) => Promise.race([
      interruptRunningSession(id).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, SESSION_INTERRUPT_TIMEOUT_MS)),
    ]))
  }))
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
  return { deleted, keptWorktrees }
}

// ---------------------------------------------------------------------------
// Worktree merge gate (used by the worktree merge flow)

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_OPERATION_TIMEOUT_MS,
    }, (err, stdout, stderr) => {
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
      timeout: GIT_OPERATION_TIMEOUT_MS,
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
