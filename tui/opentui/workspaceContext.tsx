import { createContext, useCallback, useContext, useReducer, useRef, useState, useLayoutEffect } from 'react'
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

export type QuietWorkspaceState = {
  /** The current value, read from the workspace on every call. */
  read: () => string
  /** Store a value. The caller re-renders only when `render` is true. */
  write: (value: string, render: boolean) => void
  /** Notified (in a microtask) when the stored value changes; for external-store subscribers. */
  subscribe: (listener: () => void) => () => void
}
const NO_UNSUBSCRIBE = () => {}
/**
 * A workspace string that is read rather than subscribed to. useWorkspaceState re-renders its
 * owner on every change, which for the composer draft meant the whole root once per keystroke.
 * Here the owner decides: a keystroke that changes nothing it draws writes quietly, and the few
 * things that do change per key (the character count) subscribe on their own.
 * It is still read on every render, so a workspace switch or any other render shows the current value.
 */
export function useQuietWorkspaceState(key: string, initial: string): QuietWorkspaceState {
  const context = useWorkspaceContext()
  const namespace = useContext(WorkspaceViewContext)
  const runtime = context?.runtime
  const fullKey = namespace === 'root' ? key : `${namespace}:${key}`
  const local = useRef(initial)
  const [, rerender] = useReducer((count: number) => count + 1, 0)
  const read = useCallback(() => (runtime ? runtime.get(fullKey, initial, true) as string : local.current), [runtime, fullKey, initial])
  const write = useCallback((value: string, render: boolean) => {
    if (runtime) runtime.set(fullKey, value)
    else local.current = value
    if (render) rerender()
  }, [runtime, fullKey])
  const subscribe = useCallback((listener: () => void) => (runtime ? runtime.subscribe(fullKey, listener) : NO_UNSUBSCRIBE), [runtime, fullKey])
  return { read, write, subscribe }
}
