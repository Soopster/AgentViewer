import type { PluginSessionRef } from './bookmarks'

export type ActivityStatus = 'needs-input' | 'error' | 'running' | 'waiting' | 'success' | 'info'
export type ActivityKind = 'approval' | 'question' | 'plan' | 'team' | 'repo' | 'checks' | 'health' | 'task' | 'session'
/** An in-process closure the island runs for a row. Never serialized, so it stays out of the fingerprint. */
export type ActivityAction = {
  readonly id: string
  readonly label: string
  readonly tone?: 'primary' | 'danger'
  /** The terminal's one-character shortcut. */
  readonly key?: string
  /** Needs a second press: it ends work or widens what the agent may do. */
  readonly confirm?: boolean
  /** Goes somewhere else, so the list closes before it runs. */
  readonly leaves?: boolean
  /** What to say once it has run, when the list stays open and the row looks the same. */
  readonly done?: string
  readonly run: () => Promise<void> | void
}
/** What a row is about, as data: enough for the list to offer the actions that fit it. */
export type ActivityContext = {
  readonly turn?: 'running' | 'needs-input' | 'waiting' | 'ended'
  /** A finished Proof run with failing or stale checks, and the configuration to rerun them under. */
  readonly checks?: { readonly cwd: string; readonly ids: readonly string[]; readonly version: string; readonly failing: readonly string[] }
  /** A background task of the target session. */
  readonly taskId?: string
}
export type AppActivity = {
  readonly context?: ActivityContext
  readonly kind?: ActivityKind
  /** What a dismissal answers. Wording, titles and counts that merely drift must not revive a dismissed row; absent means any change does. */
  readonly dismissKey?: string
  readonly actions?: readonly ActivityAction[]
  readonly id: string
  readonly source: string
  readonly title: string
  readonly status: ActivityStatus
  readonly detail?: string
  readonly progress?: number
  readonly target?: PluginSessionRef
  readonly messageUuid?: string
  readonly updatedAt: number
  readonly expiresAt?: number
}
export type ActivityDismissal = { readonly id: string; readonly key: string; readonly at: number }
/** Where a host keeps dismissals between launches. Synchronous: it holds a handful of short rows. */
export type ActivityDismissalStore = { load(): readonly ActivityDismissal[]; save(rows: readonly ActivityDismissal[]): void }
const DISMISSAL_GRACE_MS = 60_000
const DISMISSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000
const DISMISSAL_LIMIT = 200
export type ActivityInput = Omit<AppActivity, 'updatedAt'> & { readonly updatedAt?: number }
const PRIORITY: Record<ActivityStatus, number> = { 'needs-input': 0, error: 1, running: 2, waiting: 3, success: 4, info: 4 }
/** Within one status, what the person must decide outranks what merely informs. */
const KIND_PRIORITY: Record<ActivityKind, number> = { approval: 0, question: 0, team: 1, plan: 1, checks: 2, repo: 3, health: 4, task: 5, session: 6 }
const kindRank = (item: AppActivity) => KIND_PRIORITY[item.kind ?? 'session']
const EMPTY: readonly AppActivity[] = []

/** One feed per renderer host, containing data only. No SDK or presentation imports. */
export function createActivityFeed(clock: () => number = Date.now) {
  const entries = new Map<string, AppActivity>()
  // A dismissal outlives its row: it is forgotten only once its source has stopped raising the row
  // for DISMISSAL_GRACE_MS (a resolved item may recur), never because a poll skipped it for a moment
  // or the app restarted before the first poll.
  const dismissed = new Map<string, { key: string; at: number; absentSince?: number }>()
  let store: ActivityDismissalStore | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persist = () => {
    if (!store) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const cutoff = clock() - DISMISSAL_TTL_MS
      const rows = [...dismissed].filter(([, value]) => value.at >= cutoff).slice(-DISMISSAL_LIMIT)
      try { store?.save(rows.map(([id, value]) => ({ id, key: value.key, at: value.at }))) } catch { /* presentation state; a failed write only re-shows rows */ }
    }, 250)
    if (typeof saveTimer === 'object' && 'unref' in saveTimer) saveTimer.unref()
  }
  const retire = (id: string) => {
    const entry = dismissed.get(id)
    if (entry && entry.absentSince === undefined) entry.absentSince = clock()
  }
  const reap = () => {
    const now = clock()
    let changed = false
    for (const [id, entry] of dismissed) if (entry.absentSince !== undefined && now - entry.absentSince >= DISMISSAL_GRACE_MS) { dismissed.delete(id); changed = true }
    if (changed) persist()
  }
  const listeners = new Set<() => void>()
  const presentationListeners = new Set<() => void>()
  let snapshot: readonly AppActivity[] = EMPTY
  let consumers = 0
  let holds = 0
  let heldOrder: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const fingerprint = (item: AppActivity) => JSON.stringify([item.source, item.kind, item.status, item.title, item.detail, item.progress, item.target, item.messageUuid, item.context, item.actions?.map(action => [action.id, action.label, action.tone])])
  const dismissal = (item: AppActivity) => item.dismissKey ?? fingerprint(item)
  const schedule = () => {
    clearTimeout(timer)
    timer = undefined
    if (holds || !listeners.size) return
    const expiry = Math.min(...[...entries.values()].flatMap(item => item.expiresAt === undefined ? [] : [item.expiresAt]))
    if (Number.isFinite(expiry)) {
      timer = setTimeout(expire, Math.max(1, expiry - clock()))
      // Feed expiry should not hold a native process open.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    }
  }
  const emit = () => {
    reap()
    snapshot = [...entries.values()].filter(item => dismissed.get(item.id)?.key !== dismissal(item))
      .sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || kindRank(a) - kindRank(b) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    if (holds) {
      const positions = new Map(heldOrder.map((id, index) => [id, index]))
      snapshot = [...snapshot].sort((a, b) => (positions.get(a.id) ?? heldOrder.length) - (positions.get(b.id) ?? heldOrder.length))
      heldOrder = snapshot.map(item => item.id)
    }
    for (const listener of listeners) listener()
    schedule()
  }
  function expire() {
    if (holds) return
    let changed = false
    for (const [id, item] of entries) {
      if (item.expiresAt !== undefined && item.expiresAt <= clock()) {
        entries.delete(id); retire(id); changed = true
      }
    }
    if (changed) emit()
    else schedule()
  }
  const remove = (id: string) => {
    retire(id)
    if (entries.delete(id)) emit()
  }
  const feed = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    subscribe(listener: () => void) {
      listeners.add(listener); expire(); schedule()
      return () => { listeners.delete(listener); schedule() }
    },
    publish(input: ActivityInput) {
      // A dismissal whose row has been gone long enough is forgotten before this row can claim it.
      reap()
      const previous = entries.get(input.id)
      const item: AppActivity = Object.freeze({ ...input, ...(input.target ? { target: Object.freeze({ ...input.target }) } : {}), progress: input.progress === undefined ? undefined : Math.max(0, Math.min(1, input.progress)), updatedAt: input.updatedAt ?? clock() })
      if (previous && fingerprint(previous) === fingerprint(item) && previous.expiresAt === item.expiresAt) return
      entries.set(item.id, item)
      const back = dismissed.get(item.id)
      if (back) back.absentSince = undefined
      // Bound transient notices without dropping ongoing work or unresolved errors.
      const transient = [...entries.values()].filter(row => row.expiresAt !== undefined)
      for (const old of transient.slice(0, Math.max(0, transient.length - 50))) { entries.delete(old.id); retire(old.id) }
      emit()
    },
    remove,
    replaceSource(source: string, items: readonly ActivityInput[]) {
      const ids = new Set(items.map(item => item.id))
      let removed = false
      // Include dismissed entries: a source resolving an item resets its dismissal.
      for (const [id, item] of entries) if (item.source === source && !ids.has(id)) {
        entries.delete(id); retire(id); removed = true
      }
      for (const item of items) feed.publish({ ...item, source })
      if (removed) emit()
    },
    removeSource(source: string) {
      let removed = false
      for (const [id, item] of entries) if (item.source === source) { entries.delete(id); retire(id); removed = true }
      // Removing nothing must not mint a new snapshot: observers call this on every poll.
      if (removed) emit()
    },
    dismiss(id: string) {
      const item = entries.get(id)
      if (!item) return
      dismissed.set(id, { key: dismissal(item), at: clock() }); persist(); emit()
    },
    hold() {
      if (!holds) heldOrder = snapshot.map(item => item.id)
      holds++; schedule()
      let released = false
      return () => { if (!released) { released = true; holds--; expire(); if (!holds) { heldOrder = []; emit() } } }
    },
    isPresented: () => consumers > 0,
    subscribePresentation(listener: () => void) { presentationListeners.add(listener); return () => { presentationListeners.delete(listener) } },
    claimPresentation() {
      consumers++
      for (const listener of presentationListeners) listener()
      let released = false
      return () => {
        if (released) return
        released = true; consumers--
        if (!consumers) { for (const id of entries.keys()) retire(id); entries.clear(); emit() }
        for (const listener of presentationListeners) listener()
      }
    },
    /** Loads saved dismissals and saves each change. Returns the detach. */
    attachDismissals(next: ActivityDismissalStore) {
      store = next
      try {
        const cutoff = clock() - DISMISSAL_TTL_MS
        for (const row of next.load()) if (row.at >= cutoff && !dismissed.has(row.id)) dismissed.set(row.id, { key: row.key, at: row.at })
      } catch { /* unreadable saved state only re-shows rows */ }
      emit()
      return () => { if (store === next) store = undefined; clearTimeout(saveTimer) }
    },
    expire,
  }
  return feed
}
export type PluginActivityFeed = ReturnType<typeof createActivityFeed>
export const webActivityFeed = createActivityFeed()
export const tuiActivityFeed = createActivityFeed()
