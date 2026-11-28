'use client'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ProofService, ProofSnapshot } from './proof'
type State = { snapshot: ProofSnapshot | null; error: string | null }
type Entry = ReturnType<typeof createEntry>
const sources = new WeakMap<ProofService, Map<string, Entry>>()
const EMPTY: State = { snapshot: null, error: null }
function createEntry(service: ProofService, cwd: string) {
  let state = EMPTY, timer: ReturnType<typeof setInterval> | undefined, controller: AbortController | null = null
  let pending: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const refresh = () => {
    if (pending && !controller?.signal.aborted) return pending
    const request = new AbortController(); controller = request
    pending = service.read(cwd, request.signal).then(snapshot => {
      if (!request.signal.aborted) state = { snapshot, error: null }
    }).catch(error => {
      if (!request.signal.aborted) {
        const message = String(error instanceof Error ? error.message : error)
        state = { snapshot: state.snapshot ? { ...state.snapshot, fingerprint: null, fingerprintError: message } : null, error: message }
      }
    }).finally(() => {
      if (controller !== request) return
      pending = null
      if (!request.signal.aborted) for (const listener of listeners) listener()
    })
    return pending
  }
  return {
    read: () => state,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) { void refresh(); timer = setInterval(() => { void refresh() }, 5000) }
      return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); controller?.abort(); state = EMPTY } }
    },
  }
}
export function useProof(service: ProofService | undefined, cwd: string | null) {
  const entry = useMemo(() => {
    if (!service || !cwd) return null
    let repos = sources.get(service)
    if (!repos) { repos = new Map(); sources.set(service, repos) }
    let next = repos.get(cwd)
    if (!next) { next = createEntry(service, cwd); repos.set(cwd, next) }
    return next
  }, [service, cwd])
  const subscribe = useCallback((listener: () => void) => entry?.subscribe(listener) ?? (() => {}), [entry])
  const read = useCallback(() => entry?.read() ?? EMPTY, [entry])
  const state = useSyncExternalStore(subscribe, read, () => EMPTY)
  return { ...state, refresh: entry?.refresh ?? (() => Promise.resolve()) }
}
