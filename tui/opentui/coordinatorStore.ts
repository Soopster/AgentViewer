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
import { readCoordinatorReviewed } from '../../lib/tui/coordinatorReviewed'
import { coordinatorRequestScope } from '../../lib/tui/coordinatorRequests'
import { coordinatorAttention } from '../../lib/coordinatorAttention'
import { listWatchedMachines, readMachineRoster, subscribeMachineRunChanges, type MachineRoster } from '../../lib/tui/machines'
import { isDateBucketCollapsedByDefault, sidebarDateBucket } from '../../lib/sessionSidebarModel'
import {
  COORDINATOR_PICKER_FILTERS,
  coordinatorPickerState,
  type CoordinatorPickerFilter,
  type CoordinatorPickerState,
} from '../../lib/coordinatorSignals'

/** Where a run lives: this process's ledger (no machine) or another machine's daemon. */
export type CoordinatorMachineRef = { name: string; baseUrl: string }

export type CoordinatorSidebarEntry =
  | { type: 'machine'; key: string; machine: CoordinatorMachineRef; agentCount: number; error: string | null }
  | { type: 'run'; key: string; runId: string; run: ProtocolRun; agentCount: number; machine?: CoordinatorMachineRef
      /** A finished run with nobody waiting on the user starts folded; a click or `e` changes it. */
      defaultFolded: boolean; folded: boolean }
  | { type: 'group'; key: string; label: string; count: number }
  /** Today / Yesterday / … over runs by when they started, as the sessions rail buckets sessions. */
  | { type: 'date'; key: string; label: string; count: number; defaultFolded: boolean; folded: boolean }
  | { type: 'agent'; key: string; runId: string; agent: ProtocolAgent; isLast: boolean; taskTitle: string | null; state: CoordinatorPickerState; machine?: CoordinatorMachineRef }

export type CoordinatorState = {
  readonly runs: readonly ProtocolRun[]
  readonly snapshots: ReadonlyMap<string, ProtocolRunSnapshot>
  readonly selectedKey: string | null
  /** Other machines' teams (herdr's combined list across machines), each with its own read status. */
  readonly machines: readonly MachineRoster[]
  /** Herdr's Goto-picker filter: only agents in this state are listed. */
  readonly filter: CoordinatorPickerFilter
  /** The rail's search: a run whose title matches keeps its agents, otherwise only agents whose name or task matches. */
  readonly query: string
  /** Runs whose fold the user flipped from its default (a run key, local or `machine/`-scoped). */
  readonly foldToggles: ReadonlySet<string>
  /** Every agent's state before filtering, so the header can say what is hidden. */
  readonly stateCounts: Readonly<Record<CoordinatorPickerState, number>>
  /** Derived here so `getSnapshot` is stable and every reader agrees. */
  readonly entries: readonly CoordinatorSidebarEntry[]
  readonly agentEntries: readonly Extract<CoordinatorSidebarEntry, { type: 'agent' }>[]
}

const RUN_LIMIT = 20
const PUSH_DEBOUNCE_MS = 25
const RECONCILE_MS = 30_000
const FALLBACK_POLL_MS = 2_000
// Another machine's change stream fires per ledger write; one re-read covers a burst.
const MACHINE_PUSH_DEBOUNCE_MS = 150

/** Sidebar analogue of buildSidebarEntries: one header per run, lead first then
 * teammates in roster order — mirrors the topology tree already used in
 * CoordinationControlCenter, flattened for a linear list like project groups
 * flatten into session rows. */
export function buildCoordinatorEntries(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
  filter: CoordinatorPickerFilter = 'all',
  reviewedFor: (snapshot: ProtocolRunSnapshot) => readonly string[] = reviewedForRun,
  machines: readonly MachineRoster[] = [],
  query = '',
  foldToggles: ReadonlySet<string> = new Set(),
): CoordinatorSidebarEntry[] {
  return shapeEntries(buildListedEntries(runs, snapshots, filter, reviewedFor, machines, query), filter, query, foldToggles)
}

function buildListedEntries(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
  filter: CoordinatorPickerFilter,
  reviewedFor: (snapshot: ProtocolRunSnapshot) => readonly string[],
  machines: readonly MachineRoster[],
  query: string,
): CoordinatorSidebarEntry[] {
  const entries = buildRunEntries(runs, snapshots, filter, reviewedFor, undefined, query)
  for (const roster of machines) {
    const machine = { name: roster.name, baseUrl: roster.baseUrl }
    const remote = buildRunEntries(roster.runs, roster.snapshots, filter, reviewedFor, machine, query)
    const agentCount = remote.filter((entry) => entry.type === 'agent').length
    // A machine that cannot be read is always shown: a list that silently
    // drops a machine answers "nobody there needs you" when it does not know.
    if ((filter !== 'all' || query.trim()) && agentCount === 0 && !roster.error) continue
    entries.push({ type: 'machine', key: `machine:${roster.name}`, machine, agentCount, error: roster.error }, ...remote)
  }
  return entries
}

const ENDED_RUN_STATUSES = new Set(['completed', 'failed', 'stopped'])
const STALE_RUN_MS = 24 * 60 * 60 * 1000
export const NEEDS_YOU_GROUP_KEY = 'group:needs-you'

/**
 * The sessions rail's shape, applied to agents.
 *
 * - Anyone waiting on the user is lifted into a NEEDS YOU group at the top (its own key, `needs:` + the agent's,
 *   since a key names one row) and leaves its run's tree, as a lifted session leaves its project. Under a state
 *   filter the list is already that state, so nothing is lifted.
 * - Runs fall into the sessions rail's date buckets by when they started, and This month and Older start folded
 *   as they do there. Nobody waiting is hidden by that: anyone waiting is already in NEEDS YOU.
 * - A run starts folded to its heading once it has ended, or once nothing has happened in it
 *   for `STALE_RUN_MS`: a run nothing ever finalized still says "running" weeks later.
 *
 * A search unfolds everything: a match hidden in a folded run is not a match anyone can see.
 */
function shapeEntries(
  entries: readonly CoordinatorSidebarEntry[],
  filter: CoordinatorPickerFilter,
  query: string,
  foldToggles: ReadonlySet<string>,
  now = new Date(),
): CoordinatorSidebarEntry[] {
  const lifted = filter === 'all'
    ? entries.filter((entry): entry is Extract<CoordinatorSidebarEntry, { type: 'agent' }> => entry.type === 'agent' && entry.state === 'blocked')
    : []
  const liftedKeys = new Set(lifted.map((entry) => entry.key))
  const searching = Boolean(query.trim())
  const isFolded = (key: string, byDefault: boolean) => !searching && (foldToggles.has(key) ? !byDefault : byDefault)
  const bucketKeyOf = new Map<string, string>()
  const buckets = new Map<string, { label: string; count: number }>()
  for (const entry of entries) {
    if (entry.type !== 'run') continue
    const label = sidebarDateBucket(Date.parse(entry.run.createdAt) || 0, now)
    const key = `date:${entry.machine ? `${entry.machine.name}/` : ''}${label}`
    bucketKeyOf.set(entry.key, key)
    const bucket = buckets.get(key) ?? { label, count: 0 }
    bucket.count += 1
    buckets.set(key, bucket)
  }
  const rest: CoordinatorSidebarEntry[] = []
  let currentBucket: string | null = null
  let bucketFolded = false
  let runFolded = false
  for (const entry of entries) {
    if (entry.type === 'machine') {
      currentBucket = null
      bucketFolded = runFolded = false
      rest.push(entry)
    } else if (entry.type === 'run') {
      const bucketKey = bucketKeyOf.get(entry.key)!
      if (bucketKey !== currentBucket) {
        currentBucket = bucketKey
        const bucket = buckets.get(bucketKey)!
        const defaultFolded = isDateBucketCollapsedByDefault(bucket.label)
        bucketFolded = isFolded(bucketKey, defaultFolded)
        rest.push({ type: 'date', key: bucketKey, label: bucket.label, count: bucket.count, defaultFolded, folded: bucketFolded })
      }
      runFolded = isFolded(entry.key, entry.defaultFolded)
      if (!bucketFolded) rest.push({ ...entry, folded: runFolded })
    } else if (entry.type === 'agent') {
      if (!bucketFolded && !runFolded && !liftedKeys.has(entry.key)) rest.push(entry)
    } else {
      rest.push(entry)
    }
  }
  // Removing lifted agents can leave a tree whose last row is not marked last.
  const shaped = rest.map((entry, index) => {
    if (entry.type !== 'agent') return entry
    const next = rest[index + 1]
    const isLast = !(next?.type === 'agent' && next.runId === entry.runId)
    return entry.isLast === isLast ? entry : { ...entry, isLast }
  })
  if (lifted.length === 0) return shaped
  return [
    { type: 'group', key: NEEDS_YOU_GROUP_KEY, label: 'NEEDS YOU', count: lifted.length },
    ...lifted.map((entry, index) => ({ ...entry, key: `needs:${entry.key}`, isLast: index === lifted.length - 1 })),
    ...shaped,
  ]
}

function buildRunEntries(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
  filter: CoordinatorPickerFilter,
  reviewedFor: (snapshot: ProtocolRunSnapshot) => readonly string[],
  machine?: CoordinatorMachineRef,
  query = '',
): CoordinatorSidebarEntry[] {
  // Run and agent ids are only unique within one ledger.
  const scope = machine ? `${machine.name}/` : ''
  const needle = query.trim().toLowerCase()
  const entries: CoordinatorSidebarEntry[] = []
  for (const run of runs) {
    const snapshot = snapshots.get(run.id)
    const agents = snapshot?.agents ?? []
    const tasksById = new Map((snapshot?.tasks ?? []).map((task) => [task.id, task]))
    const reviewed = snapshot ? reviewedFor(snapshot) : []
    const ordered = [
      ...agents.filter((agent) => agent.role === 'lead'),
      ...agents.filter((agent) => agent.role !== 'lead'),
    ]
    const attention = snapshot ? coordinatorAttention(snapshot) : []
    const stated = ordered.map((agent) => ({
      agent,
      state: snapshot ? coordinatorPickerState(agent, snapshot, reviewed, attention) : 'unknown' as const,
    }))
    const taskTitleOf = (agent: ProtocolAgent) => (agent.taskId ? tasksById.get(agent.taskId)?.title : undefined) ?? null
    const byState = filter === 'all' ? stated : stated.filter((entry) => entry.state === filter)
    const titleMatches = !needle || run.prompt.toLowerCase().includes(needle)
    const visible = titleMatches ? byState : byState.filter(({ agent }) =>
      agent.name.toLowerCase().includes(needle) || (taskTitleOf(agent) ?? '').toLowerCase().includes(needle))
    // A filtered list is a list of agents, as herdr's picker is; a run with
    // none of them is noise between the ones that matter. A search keeps a run
    // whose title matches even when it has no agents to show.
    if (filter !== 'all' && visible.length === 0) continue
    if (needle && !titleMatches && visible.length === 0) continue
    // Anyone waiting in a folded run is still listed: NEEDS YOU lifts them out of it.
    const defaultFolded = ENDED_RUN_STATUSES.has(run.status) || Date.now() - (Date.parse(run.updatedAt) || 0) > STALE_RUN_MS
    entries.push({ type: 'run', key: `run:${scope}${run.id}`, runId: run.id, run, agentCount: stated.length, defaultFolded, folded: defaultFolded, ...(machine ? { machine } : {}) })
    visible.forEach(({ agent, state }, index) => {
      entries.push({
        type: 'agent',
        key: `run-agent:${scope}${run.id}:${agent.id}`,
        runId: run.id,
        agent,
        isLast: index === visible.length - 1,
        taskTitle: taskTitleOf(agent),
        state,
        ...(machine ? { machine } : {}),
      })
    })
  }
  return entries
}

/**
 * The same reviewed markers the Teammates panel keeps for the lead's
 * conversation, so a result reviewed there is not still `done` here. Only an
 * active run is read: an ended run's results do not count as waiting anyway.
 */
function reviewedForRun(snapshot: ProtocolRunSnapshot): readonly string[] {
  if (['completed', 'failed', 'stopped'].includes(snapshot.run.status)) return []
  const lead = snapshot.agents.find((agent) => agent.id === snapshot.run.leadAgentId)
  return lead ? readCoordinatorReviewed(coordinatorRequestScope(lead.provider, lead.sessionId)) : []
}

function countStates(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
  machines: readonly MachineRoster[],
): Record<CoordinatorPickerState, number> {
  const counts: Record<CoordinatorPickerState, number> = { blocked: 0, working: 0, done: 0, idle: 0, unknown: 0 }
  // Every agent, whatever the filter, search or folding hides: the counts say what is there, not what is shown.
  for (const entry of buildListedEntries(runs, snapshots, 'all', reviewedForRun, machines, '')) if (entry.type === 'agent') counts[entry.state] += 1
  return counts
}

const EMPTY_SNAPSHOTS: ReadonlyMap<string, ProtocolRunSnapshot> = new Map()

function derive(
  runs: readonly ProtocolRun[],
  snapshots: ReadonlyMap<string, ProtocolRunSnapshot>,
  selectedKey: string | null,
  filter: CoordinatorPickerFilter = state?.filter ?? 'all',
  machines: readonly MachineRoster[] = state?.machines ?? [],
  query: string = state?.query ?? '',
  foldToggles: ReadonlySet<string> = state?.foldToggles ?? new Set(),
): CoordinatorState {
  const entries = buildCoordinatorEntries(runs, snapshots, filter, reviewedForRun, machines, query, foldToggles)
  return {
    runs,
    snapshots,
    // An agent lifted into NEEDS YOU (or put back) changes key; the selection follows it.
    selectedKey: followSelection(entries, selectedKey),
    machines,
    filter,
    query,
    foldToggles,
    stateCounts: countStates(runs, snapshots, machines),
    entries,
    agentEntries: entries.filter(
      (entry): entry is Extract<CoordinatorSidebarEntry, { type: 'agent' }> => entry.type === 'agent',
    ),
  }
}

function followSelection(entries: readonly CoordinatorSidebarEntry[], selectedKey: string | null): string | null {
  if (!selectedKey || entries.some((entry) => entry.key === selectedKey)) return selectedKey
  const other = selectedKey.startsWith('needs:') ? selectedKey.slice('needs:'.length) : `needs:${selectedKey}`
  return entries.some((entry) => entry.key === other) ? other : selectedKey
}

let state: CoordinatorState = derive([], EMPTY_SNAPSHOTS, null, 'all', [], '', new Set())
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
  // Selection is the only thing that changed: j/k must not re-derive every
  // row (and re-read every run's review markers) per keystroke.
  commit({ ...state, selectedKey: key })
}

/**
 * Cycle herdr's picker filter (all → blocked → working → done → idle). The
 * selection follows to the first visible agent when its row is filtered out,
 * so Enter never opens something the list no longer shows.
 */
export function cycleCoordinatorFilter(): CoordinatorPickerFilter {
  const next = COORDINATOR_PICKER_FILTERS[(COORDINATOR_PICKER_FILTERS.indexOf(state.filter) + 1) % COORDINATOR_PICKER_FILTERS.length]!
  setCoordinatorFilter(next)
  return next
}

export function setCoordinatorFilter(filter: CoordinatorPickerFilter): void {
  if (state.filter === filter) return
  const next = derive(state.runs, state.snapshots, state.selectedKey, filter)
  const selectionVisible = next.agentEntries.some((entry) => entry.key === next.selectedKey)
  commit(selectionVisible ? next : { ...next, selectedKey: next.agentEntries[0]?.key ?? null })
}

/** The rail's search. Like the filter, the selection follows to the first match when its row is searched away. */
export function setCoordinatorQuery(query: string): void {
  if (state.query === query) return
  const next = derive(state.runs, state.snapshots, state.selectedKey, state.filter, state.machines, query)
  const selectionVisible = next.agentEntries.some((entry) => entry.key === next.selectedKey)
  commit(selectionVisible ? next : { ...next, selectedKey: next.agentEntries[0]?.key ?? null })
}

/** Fold or unfold one run's agents, or one date bucket's runs, under its heading. */
export function toggleCoordinatorFold(runKey: string): void {
  const toggles = new Set(state.foldToggles)
  if (toggles.has(runKey)) toggles.delete(runKey)
  else toggles.add(runKey)
  commitFolds(toggles)
}

/** `e`: unfold every run while any is folded, otherwise put every run back to its default. */
export function toggleAllCoordinatorFolds(): 'expanded' | 'defaults' {
  const anyFolded = state.entries.some((entry) => (entry.type === 'run' || entry.type === 'date') && entry.folded)
  if (!anyFolded) { commitFolds(new Set()); return 'defaults' }
  // Every default-folded heading flipped open, including runs a folded date bucket was hiding.
  const all = buildCoordinatorEntries(state.runs, state.snapshots, state.filter, reviewedForRun, state.machines, state.query, new Set())
  const opened = new Set(all.flatMap((entry) => entry.type === 'date' && entry.defaultFolded ? [entry.key] : []))
  const reopened = buildCoordinatorEntries(state.runs, state.snapshots, state.filter, reviewedForRun, state.machines, state.query, opened)
  for (const entry of reopened) if (entry.type === 'run' && entry.defaultFolded) opened.add(entry.key)
  commitFolds(opened)
  return 'expanded'
}

function commitFolds(toggles: ReadonlySet<string>) {
  const next = derive(state.runs, state.snapshots, state.selectedKey, state.filter, state.machines, state.query, toggles)
  const selectionVisible = next.agentEntries.some((entry) => entry.key === next.selectedKey)
  commit(selectionVisible ? next : { ...next, selectedKey: next.agentEntries[0]?.key ?? null })
}

/** Reset for tests; the app keeps one feed for the process lifetime. */
export function resetCoordinatorStore(): void {
  commit(derive([], EMPTY_SNAPSHOTS, null, 'all', [], '', new Set()))
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

  // Subscribe before the first read (herdr's bootstrap rule): a change landing
  // while that read is in flight then queues a refresh instead of being lost
  // until the 30s reconcile.
  const unsubscribe = subscribeTuiProtocolRunChanges((runId) => {
    if (runId === null) {
      void refresh()
      return
    }
    // A full refresh already reading would commit its older copy of this run
    // over a newer single-run read; have it read everything once more instead.
    if (refreshInFlight) {
      refreshQueued = true
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
  void refresh()
  const timer = setInterval(() => { void refresh() }, unsubscribe ? RECONCILE_MS : FALLBACK_POLL_MS)
  const stopMachines = startMachineFeeds(() => cancelled)

  return () => {
    cancelled = true
    unsubscribe?.()
    stopMachines()
    if (pushTimer) clearTimeout(pushTimer)
    clearInterval(timer)
  }
}

/**
 * One feed per added machine, independent of the local one and of each other,
 * so a machine that is slow or down never delays the local list. A failed read
 * keeps that machine's last good roster and says why beside it.
 */
function startMachineFeeds(isCancelled: () => boolean): () => void {
  const stops: Array<() => void> = []
  for (const machine of listWatchedMachines()) {
    let inFlight = false
    let queued = false
    let pushTimer: ReturnType<typeof setTimeout> | null = null
    const refreshMachine = async () => {
      if (inFlight) { queued = true; return }
      inFlight = true
      try {
        do {
          queued = false
          const roster = await readMachineRoster(machine, RUN_LIMIT)
          if (isCancelled()) return
          const previous = state.machines.find((entry) => entry.name === machine.name)
          const next = roster.error && previous ? { ...previous, error: roster.error } : roster
          const machines = state.machines.some((entry) => entry.name === machine.name)
            ? state.machines.map((entry) => (entry.name === machine.name ? next : entry))
            : [...state.machines, next]
          commit(derive(state.runs, state.snapshots, state.selectedKey, state.filter, machines))
        } while (queued && !isCancelled())
      } finally {
        inFlight = false
      }
    }
    // Subscribe before the first read, as the local feed does.
    const unsubscribe = subscribeMachineRunChanges(machine, () => {
      if (pushTimer) clearTimeout(pushTimer)
      pushTimer = setTimeout(() => { void refreshMachine() }, MACHINE_PUSH_DEBOUNCE_MS)
    })
    void refreshMachine()
    const timer = setInterval(() => { void refreshMachine() }, RECONCILE_MS)
    stops.push(() => {
      unsubscribe()
      if (pushTimer) clearTimeout(pushTimer)
      clearInterval(timer)
    })
  }
  return () => { for (const stop of stops) stop() }
}
