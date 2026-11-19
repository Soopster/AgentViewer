import type { ProtocolRun, ProtocolRunRollup, ProtocolTask, ProtocolUsageReceipt } from './agentProtocol'

/** A budget at or past this share of its limit is worth saying so before it stops the run. */
export const BUDGET_WARN_FRACTION = 0.8

/** A task must hold up at least this many others to be worth naming. */
const HOLD_UP_MIN = 2
export const MAX_HOLD_UP_LINES = 3

/**
 * An unfinished run that has shown no sign of life this long is probably not
 * working: a teammate is wedged, or the server that was driving it restarted
 * (a server-managed run is not re-driven, and reads as running with nothing
 * moving). Long enough that one slow turn is not a false alarm.
 */
export const IDLE_WARN_MS = Math.max(60_000, Number(process.env.AGENT_VIEWER_COORD_IDLE_WARN_MINUTES || 30) * 60_000)

const TERMINAL: ReadonlySet<ProtocolTask['status']> = new Set(['completed', 'failed', 'cancelled'])

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/').replace(/\/$/, '')
}

/** Whole-tree grants (`**`, `.`) say nothing about where work lands, so they never count as overlap. */
function isWholeTree(value: string): boolean {
  const normalized = normalizePath(value)
  return normalized === '' || normalized === '**' || normalized === '*'
}

/** `a` contains `b` when they are the same path or `a` is a directory above it. */
function covers(a: string, b: string): boolean {
  return a === b || b.startsWith(`${a}/`)
}

function globRoot(value: string): string {
  const index = value.search(/[*?[]/)
  return normalizePath(index < 0 ? value : value.slice(0, index))
}

function pathsOverlap(a: string, b: string): boolean {
  const left = globRoot(a)
  const right = globRoot(b)
  if (!left || !right) return false
  return covers(left, right) || covers(right, left)
}

/**
 * Where a task's work lands: the files it reported changing once it has
 * finished, otherwise the paths it was granted. A finished task's grant is
 * usually wider than what it touched, and reporting overlap on the grant would
 * cry wolf about work that never collided.
 */
function footprint(task: ProtocolTask): string[] {
  const reported = task.receipt?.filesChanged ?? []
  const source = task.status === 'completed' && reported.length > 0 ? reported : task.paths
  return source.filter((entry) => !isWholeTree(entry)).map(normalizePath)
}

function add(target: ProtocolUsageReceipt, usage?: ProtocolUsageReceipt): void {
  if (!usage) return
  for (const key of ['totalTokens', 'costUsd'] as const) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) target[key] = (target[key] ?? 0) + value
  }
}

/**
 * The numbers an engineer wants at a glance on a multi-agent run: how far along
 * it is, what it has spent against its budgets, and whether two tasks are
 * about to edit the same files — the thing that turns parallel work into a
 * merge conflict nobody sees until the end. Pure so the server and both UIs
 * agree, and so every rule here can be asserted.
 *
 * `usage` is passed in rather than derived: the ledger counts observed SDK
 * usage and submitted receipts differently, and that count is already the one
 * the budget gate enforces.
 */
export function computeRunRollup(input: {
  run: Pick<ProtocolRun, 'createdAt' | 'budget' | 'status'>
  tasks: readonly ProtocolTask[]
  agentNames: ReadonlyMap<string, string>
  usage: ProtocolUsageReceipt
  /** Newest sign of life anywhere in the run: an event, or an agent seen. */
  lastActivityAt?: string
  now?: number
}): ProtocolRunRollup {
  const { run, tasks, usage } = input
  const now = input.now ?? Date.now()
  const counts = { total: tasks.length, done: 0, failed: 0, active: 0, pending: 0, blocked: 0 }
  for (const task of tasks) {
    if (task.status === 'completed') counts.done += 1
    else if (task.status === 'failed') counts.failed += 1
    else if (task.status === 'blocked') counts.blocked += 1
    else if (task.status === 'pending') counts.pending += 1
    else if (task.status !== 'cancelled') counts.active += 1
  }

  const spent = { totalTokens: usage.totalTokens ?? 0, costUsd: usage.costUsd ?? 0 }
  const elapsedMs = Math.max(0, now - Date.parse(run.createdAt))
  const fractions: Array<{ label: string; fraction: number }> = []
  const budget = run.budget
  if (budget?.maxTokens) fractions.push({ label: 'token', fraction: spent.totalTokens / budget.maxTokens })
  if (budget?.maxCostUsd) fractions.push({ label: 'cost', fraction: spent.costUsd / budget.maxCostUsd })
  if (budget?.maxDurationMinutes) fractions.push({ label: 'time', fraction: elapsedMs / (budget.maxDurationMinutes * 60_000) })
  const worst = fractions.sort((a, b) => b.fraction - a.fraction)[0]
  const budgetWarning = worst && worst.fraction >= BUDGET_WARN_FRACTION && !['completed', 'failed', 'cancelled', 'stopped'].includes(run.status)
    ? `${Math.min(999, Math.round(worst.fraction * 100))}% of the ${worst.label} budget is used`
    : undefined

  const unfinished = counts.active + counts.pending
  const lastActivity = input.lastActivityAt ? Date.parse(input.lastActivityAt) : NaN
  const idleMs = Number.isFinite(lastActivity) ? now - lastActivity : 0
  // `blocked` is a run waiting on a human, which can legitimately sit for a long time.
  const idleWarning = unfinished > 0 && idleMs >= IDLE_WARN_MS && ['planning', 'running', 'synthesizing'].includes(run.status)
    ? `nothing has happened for ${formatIdle(idleMs)} with ${unfinished} task${unfinished === 1 ? '' : 's'} unfinished — a teammate may be stuck, or the server driving this run restarted`
    : undefined

  // Overlap between two different, still-relevant tasks. Cancelled and failed
  // work will not land, so it cannot collide with anything.
  //
  // Indexed by path rather than compared pairwise: a run with hundreds of tasks
  // made the pairwise form the single hottest thing the Coordinator did, on every
  // snapshot and every lead mutation. Each path is looked up against its own
  // ancestors only, so the cost follows the number of paths and their depth.
  const relevant = tasks.filter((task) => task.status !== 'cancelled' && task.status !== 'failed')
  const byRoot = new Map<string, Set<string>>()
  const byId = new Map<string, ProtocolTask>()
  for (const task of relevant) {
    byId.set(task.id, task)
    for (const entry of footprint(task)) {
      const root = globRoot(entry)
      if (!root) continue
      const ids = byRoot.get(root) ?? new Set<string>()
      ids.add(task.id)
      byRoot.set(root, ids)
    }
  }
  const overlaps: ProtocolRunRollup['overlaps'] = []
  for (const [root, here] of byRoot) {
    // Every ancestor directory of `root` that some task also claims. The pair is
    // found from its narrower side, which is also the path reported.
    const involved = new Set(here)
    for (let cut = root.lastIndexOf('/'); cut > 0; cut = root.lastIndexOf('/', cut - 1)) {
      for (const id of byRoot.get(root.slice(0, cut)) ?? []) involved.add(id)
    }
    if (involved.size < 2) continue
    const owners = new Set<string>()
    let live = false
    for (const id of involved) {
      const task = byId.get(id)!
      const owner = task.ownerAgentId ? input.agentNames.get(task.ownerAgentId) : undefined
      if (owner) owners.add(owner)
      live ||= !TERMINAL.has(task.status)
    }
    overlaps.push({ path: root, taskIds: [...involved].sort(), owners: [...owners].sort(), live })
  }
  overlaps.sort((a, b) => Number(b.live) - Number(a.live) || a.path.localeCompare(b.path))

  // Who is holding the board up. In a dependency graph the task to look at is
  // not the one that failed loudly but the unfinished one with the most work
  // stacked behind it, directly or through other tasks.
  const dependents = new Map<string, string[]>()
  const open = tasks.filter((task) => !TERMINAL.has(task.status))
  for (const task of open) for (const dependency of task.blockedBy) dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.id])
  const holdUps: ProtocolRunRollup['holdUps'] = []
  for (const task of open) {
    if (!dependents.has(task.id)) continue
    const seen = new Set<string>()
    const queue = [...dependents.get(task.id)!]
    // `seen` makes a malformed cycle terminate rather than spin; validation rejects them on the way in.
    while (queue.length) {
      const next = queue.pop()!
      if (seen.has(next) || next === task.id) continue
      seen.add(next)
      queue.push(...(dependents.get(next) ?? []))
    }
    if (seen.size >= HOLD_UP_MIN) {
      holdUps.push({ taskId: task.id, title: task.title, status: task.status, owner: task.ownerAgentId ? input.agentNames.get(task.ownerAgentId) : undefined, holdsUp: seen.size })
    }
  }
  holdUps.sort((a, b) => b.holdsUp - a.holdsUp || a.taskId.localeCompare(b.taskId))

  const touched = new Set<string>()
  for (const task of tasks) for (const file of task.receipt?.filesChanged ?? []) touched.add(normalizePath(file))

  return { elapsedMs, tasks: counts, usage: spent, usageAvailability: { tokens: usage.totalTokens !== undefined, cost: usage.costUsd !== undefined }, budgetWarning, idleWarning, filesTouched: touched.size, overlaps, holdUps: holdUps.slice(0, MAX_HOLD_UP_LINES) }
}

function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes >= 120 ? `${Math.floor(minutes / 60)}h` : `${minutes}m`
}

/** "3/7 done · 1 failed · 42k tok · $0.83 · 12m" — one line for a roster header. */
export function formatRunRollup(rollup: ProtocolRunRollup, budget?: ProtocolRun['budget']): string {
  const tokens = rollup.usage.totalTokens
  const tokenText = tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M tok` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k tok` : `${tokens} tok`
  const minutes = Math.floor(rollup.elapsedMs / 60_000)
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
  const cost = `$${rollup.usage.costUsd.toFixed(2)}${budget?.maxCostUsd ? ` / $${budget.maxCostUsd.toFixed(2)}` : ''}`
  return [
    `${rollup.tasks.done}/${rollup.tasks.total} done`,
    rollup.tasks.failed ? `${rollup.tasks.failed} failed` : '',
    rollup.tasks.blocked ? `${rollup.tasks.blocked} blocked` : '',
    rollup.usageAvailability ? rollup.usageAvailability.tokens ? `reported ${tokenText}` : 'tokens unavailable' : rollup.usage.totalTokens || rollup.usage.costUsd ? tokenText : '',
    rollup.usageAvailability ? rollup.usageAvailability.cost ? `reported ${cost}` : 'cost unavailable' : rollup.usage.costUsd ? cost : '',
    time,
  ].filter(Boolean).join(' · ')
}

export const MAX_OVERLAP_LINES = 3

/**
 * What a surface prints for a rollup, as text, so the TUI and the web say the
 * same thing and a rule here is asserted once. Only overlaps that can still
 * happen are listed: two finished tasks that touched one file are history.
 */
export function describeRunRollup(rollup: ProtocolRunRollup, budget?: ProtocolRun['budget']): {
  summary: string
  warning?: string
  /** Stall notice (idle run), shown beside the budget warning. */
  idleWarning?: string
  overlapLines: string[]
  hiddenOverlaps: number
  /** "task-7 “Parser” (bo, in progress) holds up 12 tasks" — where a stalled DAG is stuck. */
  holdUpLines: string[]
  /** Things worth interrupting the reader for: a budget nearly spent, and any live overlap. */
  attentionCount: number
} {
  const live = rollup.overlaps.filter((entry) => entry.live)
  const overlapLines = live.slice(0, MAX_OVERLAP_LINES).map((entry) => {
    const who = entry.owners.length > 1 ? entry.owners.join(' & ') : entry.taskIds.join(' & ')
    return `${entry.path} — ${who} both target it; separate checkouts will conflict at merge`
  })
  return {
    summary: formatRunRollup(rollup, budget),
    warning: rollup.budgetWarning,
    idleWarning: rollup.idleWarning,
    overlapLines,
    hiddenOverlaps: Math.max(0, live.length - overlapLines.length),
    holdUpLines: rollup.holdUps.map((entry) => `${entry.taskId} “${entry.title}” (${[entry.owner, entry.status.replace('_', ' ')].filter(Boolean).join(', ')}) holds up ${entry.holdsUp} task${entry.holdsUp === 1 ? '' : 's'}`),
    attentionCount: (rollup.budgetWarning ? 1 : 0) + (rollup.idleWarning ? 1 : 0) + (live.length > 0 ? 1 : 0),
  }
}
