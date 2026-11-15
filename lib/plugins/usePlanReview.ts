'use client'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { PlanReviewService, PlanSnapshot, PlanTarget } from './planReview'
type State = { snapshot: PlanSnapshot | null; error: string | null }
const EMPTY: State = { snapshot: null, error: null }
function createEntry(service: PlanReviewService, cwd: string, target?: PlanTarget) {
  let state = EMPTY, pending: Promise<void> | null = null, controller: AbortController | undefined, timer: ReturnType<typeof setInterval> | undefined
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  const refresh = () => {
    if (pending && !controller?.signal.aborted) return pending
    const current = new AbortController(); controller = current
    pending = service.read(cwd, target, current.signal).then(snapshot => {
      if (!current.signal.aborted && JSON.stringify(snapshot) !== JSON.stringify(state.snapshot)) { state = { snapshot, error: null }; notify() }
    }).catch(cause => { if (!current.signal.aborted) { state = { ...state, error: cause instanceof Error ? cause.message : String(cause) }; notify() } }).finally(() => { if (controller === current) pending = null })
    return pending
  }
  return {
    read: () => state,
    refresh,
    update(review: PlanSnapshot['reviews'][number]) {
      const reviews = state.snapshot?.reviews ?? []
      const previous = reviews.find(item => item.id === review.id)
      if (previous && previous.sequence > review.sequence) return
      state = { snapshot: { reviews: [review, ...reviews.filter(item => item.id !== review.id)] }, error: null }; notify()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) { void refresh(); timer = setInterval(() => { void refresh() }, 5000) }
      return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); controller?.abort() } }
    },
  }
}
const sources = new WeakMap<PlanReviewService, Map<string, ReturnType<typeof createEntry>>>()
export function usePlanReviews(service: PlanReviewService | undefined, cwd: string | null, target?: PlanTarget) {
  const entry = useMemo(() => {
    if (!service || !cwd) return null
    let entries = sources.get(service)
    if (!entries) { entries = new Map(); sources.set(service, entries) }
    const key = JSON.stringify([cwd, target?.provider, target?.providerInstanceId ?? target?.provider, target?.sessionId])
    let value = entries.get(key)
    if (!value) { value = createEntry(service, cwd, target); entries.set(key, value) }
    return value
  }, [service, cwd, target?.provider, target?.providerInstanceId, target?.sessionId])
  const subscribe = useCallback((listener: () => void) => entry?.subscribe(listener) ?? (() => {}), [entry])
  const read = useCallback(() => entry?.read() ?? EMPTY, [entry])
  const state = useSyncExternalStore(subscribe, read, () => EMPTY)
  return { ...state, refresh: entry?.refresh ?? (() => Promise.resolve()), update: entry?.update ?? (() => {}) }
}
