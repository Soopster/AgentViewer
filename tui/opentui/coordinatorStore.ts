// Coordinator sidebar state, outside the OpenTUI root.
//
// This was three `useState`s and a polling effect inside `App.tsx`. Because the
// root is one very large component, every coordinator refresh — a reconcile
// tick, or a pushed run change — re-rendered the whole app, transcript
// included, to update a list in the left rail. Holding the state here lets the
// sidebar subscribe on its own and the root read it imperatively from key
// handlers without subscribing at all.
//
// The feed is refcounted rather than started per mount: two subscribers (the
// sidebar and the root's header) must not each open their own poll and SSE
// subscription.
import type { ProtocolAgent, ProtocolRun, ProtocolRunSnapshot } from '../../lib/agentProtocol'
import { listTuiProtocolRuns, readTuiProtocolRun, subscribeTuiProtocolRunChanges } from '../../lib/tui/service'

export type CoordinatorSidebarEntry =
  | { type: 'run'; key: string; runId: string; run: ProtocolRun; agentCount: number }
  | { type: 'agent'; key: string; runId: string; agent: ProtocolAgent; isLast: boolean; taskTitle: string | null }

export type CoordinatorState = {
  readonly runs: readonly ProtocolRun[]
  readonly snapshots: ReadonlyMap<string, ProtocolRunSnapshot>
  readonly selectedKey: string | null
  /** Derived here so `getSnapshot` is stable and every reader agrees. */
  readonly entries: readonly CoordinatorSidebarEntry[]
  readonly agentEntries: readonly Extract<CoordinatorSidebarEntry, { type: 'agent' }>[]
}

const RUN_LIMIT = 20
const PUSH_DEBOUNCE_MS = 25
const RECONCILE_MS = 30_000
const FALLBACK_POLL_MS = 2_000

/** Sidebar analogue of buildSidebarEntries: one header per run, lead first then
 * teammates in roster order — mirrors the topology tree already used in
 * CoordinationControlCenter, flattened for a linear list like project groups
 * flatten into session rows. */
export function buildCoordinatorEntries(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
): CoordinatorSidebarEntry[] {
  const entries: CoordinatorSidebarEntry[] = []
  for (const run of runs) {
    const snapshot = snapshots.get(run.id)
    const agents = snapshot?.agents ?? []
    const tasksById = new Map((snapshot?.tasks ?? []).map((task) => [task.id, task]))
    const ordered = [
      ...agents.filter((agent) => agent.role === 'lead'),
      ...agents.filter((agent) => agent.role !== 'lead'),
    ]
    entries.push({ type: 'run', key: `run:${run.id}`, runId: run.id, run, agentCount: ordered.length })
    ordered.forEach((agent, index) => {
      entries.push({
        type: 'agent',
        key: `run-agent:${run.id}:${agent.id}`,
        runId: run.id,
        agent,
        isLast: index === ordered.length - 1,
        taskTitle: (agent.taskId ? tasksById.get(agent.taskId)?.title : undefined) ?? null,
      })
    })
  }
  return entries
}

const EMPTY_SNAPSHOTS: ReadonlyMap<string, ProtocolRunSnapshot> = new Map()

function derive(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
  selectedKey: string | null,
): CoordinatorState {
  const entries = buildCoordinatorEntries(runs, snapshots)
  return {
    runs,
    snapshots,
    selectedKey,
    entries,
    agentEntries: entries.filter(
      (entry): entry is Extract<CoordinatorSidebarEntry, { type: 'agent' }> => entry.type === 'agent',
    ),
  }
}

let state: CoordinatorState = derive([], EMPTY_SNAPSHOTS, null)
const listeners = new Set<() => void>()

function commit(next: CoordinatorState) {
  state = next
  for (const listener of listeners) listener()
}

export function getCoordinatorState(): CoordinatorState {
  return state
}

export function subscribeCoordinator(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setCoordinatorSelectedKey(key: string | null): void {
  if (state.selectedKey === key) return
  commit(derive(state.runs, state.snapshots, key))
}

/** Reset for tests; the app keeps one feed for the process lifetime. */
export function resetCoordinatorStore(): void {
  commit(derive([], EMPTY_SNAPSHOTS, null))
}

let feedHolders = 0
let stopFeed: (() => void) | null = null

/**
 * Start the run feed if it is not already running, and return a release
 * function. Local ledger writes and attached-daemon SSE frames push immediate
 * refreshes; the slow reconcile poll covers cross-process SQLite writes, and
 * drops to the old 2s cadence only if subscription setup fails.
 */
export function acquireCoordinatorFeed(): () => void {
  feedHolders += 1
  if (feedHolders === 1) stopFeed = startFeed()
  let released = false
  return () => {
    if (released) return
    released = true
    feedHolders -= 1
    if (feedHolders === 0) {
      stopFeed?.()
      stopFeed = null
    }
  }
}

function startFeed(): () => void {
  let cancelled = false
  let refreshInFlight = false
  let refreshQueued = false
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  const changedRunIds = new Set<string>()

  const refresh = async () => {
    if (refreshInFlight) {
      refreshQueued = true
      return
    }
    refreshInFlight = true
    try {
      do {
        refreshQueued = false
        const runs = await listTuiProtocolRuns(RUN_LIMIT).catch(() => [] as ProtocolRun[])
        if (cancelled) return
        const loaded = await Promise.all(runs.map((run) => readTuiProtocolRun(run.id).catch(() => null)))
        if (cancelled) return
        // Runs and snapshots are committed together: publishing runs first
        // would render every run with an agent count of zero for a frame.
        commit(derive(
          runs,
          new Map(loaded.flatMap((snapshot) => snapshot ? [[snapshot.run.id, snapshot] as const] : [])),
          state.selectedKey,
        ))
      } while (refreshQueued && !cancelled)
    } finally {
      refreshInFlight = false
    }
  }

  const refreshChangedRun = async (runId: string) => {
    const snapshot = await readTuiProtocolRun(runId).catch(() => undefined)
    if (cancelled || snapshot === undefined) return
    if (!snapshot) {
      const snapshots = new Map(state.snapshots)
      snapshots.delete(runId)
      commit(derive(state.runs.filter((run) => run.id !== runId), snapshots, state.selectedKey))
      return
    }
    const existingIndex = state.runs.findIndex((run) => run.id === runId)
    const runs = existingIndex >= 0
      ? state.runs.map((run, index) => (index === existingIndex ? snapshot.run : run))
      : [snapshot.run, ...state.runs]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RUN_LIMIT)
    const snapshots = new Map(state.snapshots)
    snapshots.set(runId, snapshot)
    commit(derive(runs, snapshots, state.selectedKey))
  }

  void refresh()
  const unsubscribe = subscribeTuiProtocolRunChanges((runId) => {
    if (runId === null) {
      void refresh()
      return
    }
    changedRunIds.add(runId)
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      const ids = [...changedRunIds]
      changedRunIds.clear()
      void Promise.all(ids.map(refreshChangedRun))
    }, PUSH_DEBOUNCE_MS)
  })
  const timer = setInterval(() => { void refresh() }, unsubscribe ? RECONCILE_MS : FALLBACK_POLL_MS)

  return () => {
    cancelled = true
    unsubscribe?.()
    if (pushTimer) clearTimeout(pushTimer)
    clearInterval(timer)
  }
}
