import { createContext, useCallback, useContext, useRef, useState, useLayoutEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Space, SpacesController, WorkspaceRuntime } from './spacesStore'
export const WorkspaceViewContext = createContext('root')
export type WorkspaceContextValue = { controller: SpacesController; runtime: WorkspaceRuntime; space: Space }
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export function useWorkspaceContext() { return useContext(WorkspaceContext) }
/** Setters capture the owning runtime, so late callbacks cannot write into another tab. */
function useOwnedState<T>(runtime: WorkspaceRuntime | undefined, key: string, initial: T | (() => T), persist: boolean): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => ({ runtime, key, value: runtime ? runtime.get(key, initial, persist) : typeof initial === 'function' ? (initial as () => T)() : initial }))
  const value = state.runtime === runtime && state.key === key ? state.value : runtime ? runtime.get(key, initial, persist) : state.value
  useLayoutEffect(() => {
    if (!runtime) return
    const update = () => {
      const next = runtime.get(key, initial, persist)
      setState(previous => previous.runtime === runtime && previous.key === key && Object.is(previous.value, next) ? previous : { runtime, key, value: next })
    }
    update()
    return runtime.subscribe(key, update)
  }, [runtime, key])
  const set = useCallback((action: SetStateAction<T>) => {
    if (runtime) {
      runtime.set(key, action)
      const next = runtime.get(key, initial, persist)
      setState(previous => previous.runtime === runtime && previous.key === key && Object.is(previous.value, next) ? previous : { runtime, key, value: next })
    } else setState(previous => ({ runtime, key, value: typeof action === 'function' ? (action as (value: T) => T)(previous.value) : action }))
  }, [runtime, key])
  return [value, set]
}
export function useWorkspaceState<T>(key: string, initial: T | (() => T), persist = true): [T, Dispatch<SetStateAction<T>>] {
  const context = useWorkspaceContext()
  const namespace = useContext(WorkspaceViewContext)
  return useOwnedState(context?.runtime, namespace === 'root' ? key : `${namespace}:${key}`, initial, persist)
}
export function useAppState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  return useOwnedState(useWorkspaceContext()?.controller.preferences, key, initial, false)
}
export function useWorkspaceRef<T>(key: string, initial: T, persist = false): MutableRefObject<T> {
  const context = useWorkspaceContext()
  const local = useRef(initial)
  if (!context) return local
  return context.runtime.get(`ref:${key}`, () => ({ current: initial }), persist)
}
export function workspaceStorageKey(workspaceId: string | undefined, sessionKey: string): string { return workspaceId ? `workspace:${workspaceId}:${sessionKey}` : sessionKey }
