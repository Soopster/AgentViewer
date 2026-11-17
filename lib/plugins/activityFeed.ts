import type { PluginSessionRef } from './bookmarks'

export type ActivityStatus = 'needs-input' | 'error' | 'running' | 'waiting' | 'success' | 'info'
export type ActivityKind = 'approval' | 'question' | 'team' | 'repo' | 'checks' | 'health' | 'task' | 'session'
/** An in-process closure the island runs for a row. Never serialized, so it stays out of the fingerprint. */
export type ActivityAction = {
  readonly id: string
  readonly label: string
  readonly tone?: 'primary' | 'danger'
  readonly run: () => Promise<void> | void
}
export type AppActivity = {
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
export type ActivityInput = Omit<AppActivity, 'updatedAt'> & { readonly updatedAt?: number }
const PRIORITY: Record<ActivityStatus, number> = { 'needs-input': 0, error: 1, running: 2, waiting: 3, success: 4, info: 4 }
/** Within one status, what the person must decide outranks what merely informs. */
const KIND_PRIORITY: Record<ActivityKind, number> = { approval: 0, question: 0, team: 1, checks: 2, repo: 3, health: 4, task: 5, session: 6 }
const kindRank = (item: AppActivity) => KIND_PRIORITY[item.kind ?? 'session']
const EMPTY: readonly AppActivity[] = []

/** One feed per renderer host, containing data only. No SDK or presentation imports. */
export function createActivityFeed(clock: () => number = Date.now) {
  const entries = new Map<string, AppActivity>()
  const dismissed = new Map<string, string>()
  const listeners = new Set<() => void>()
  const presentationListeners = new Set<() => void>()
  let snapshot: readonly AppActivity[] = EMPTY
  let consumers = 0
  let holds = 0
  let heldOrder: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const fingerprint = (item: AppActivity) => JSON.stringify([item.source, item.kind, item.status, item.title, item.detail, item.progress, item.target, item.messageUuid, item.actions?.map(action => [action.id, action.label, action.tone])])
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
    snapshot = [...entries.values()].filter(item => dismissed.get(item.id) !== dismissal(item))
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
        entries.delete(id); dismissed.delete(id); changed = true
      }
    }
    if (changed) emit()
    else schedule()
  }
  const remove = (id: string) => {
    dismissed.delete(id)
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
      const previous = entries.get(input.id)
      const item: AppActivity = Object.freeze({ ...input, ...(input.target ? { target: Object.freeze({ ...input.target }) } : {}), progress: input.progress === undefined ? undefined : Math.max(0, Math.min(1, input.progress)), updatedAt: input.updatedAt ?? clock() })
      if (previous && fingerprint(previous) === fingerprint(item) && previous.expiresAt === item.expiresAt) return
      entries.set(item.id, item)
      // Bound transient notices without dropping ongoing work or unresolved errors.
      const transient = [...entries.values()].filter(row => row.expiresAt !== undefined)
      for (const old of transient.slice(0, Math.max(0, transient.length - 50))) { entries.delete(old.id); dismissed.delete(old.id) }
      emit()
    },
    remove,
    replaceSource(source: string, items: readonly ActivityInput[]) {
      const ids = new Set(items.map(item => item.id))
      let removed = false
      // Include dismissed entries: a source resolving an item resets its dismissal.
      for (const [id, item] of entries) if (item.source === source && !ids.has(id)) {
        entries.delete(id); dismissed.delete(id); removed = true
      }
      for (const item of items) feed.publish({ ...item, source })
      if (removed) emit()
    },
    removeSource(source: string) {
      let removed = false
      for (const [id, item] of entries) if (item.source === source) { entries.delete(id); dismissed.delete(id); removed = true }
      // Removing nothing must not mint a new snapshot: observers call this on every poll.
      if (removed) emit()
    },
    dismiss(id: string) {
      const item = entries.get(id)
      if (!item) return
      dismissed.set(id, dismissal(item)); emit()
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
        if (!consumers) { entries.clear(); dismissed.clear(); emit() }
        for (const listener of presentationListeners) listener()
      }
    },
    expire,
  }
  return feed
}
export type PluginActivityFeed = ReturnType<typeof createActivityFeed>
export const webActivityFeed = createActivityFeed()
export const tuiActivityFeed = createActivityFeed()
