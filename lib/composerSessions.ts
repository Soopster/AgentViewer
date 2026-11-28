import { useCallback, useSyncExternalStore } from 'react'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'

/** Session-owned cells keep stream callbacks bound to their original conversation. */
export function createComposerSessions() {
  const aliases = new Map<string, string>()
  const canonical = (key: string): string => { while (aliases.has(key)) key = aliases.get(key)!; return key }
  const sessions = new Map<string, Map<string, { value: unknown; listeners: Set<() => void> }>>()
  const cell = <T,>(key: string, name: string, initial: T | (() => T)) => {
    key = canonical(key)
    let fields = sessions.get(key)
    if (!fields) sessions.set(key, fields = new Map())
    let entry = fields.get(name)
    if (!entry) fields.set(name, entry = { value: typeof initial === 'function' ? (initial as () => T)() : initial, listeners: new Set() })
    return entry
  }
  return {
    get<T>(key: string, name: string, initial: T | (() => T)): T { return cell(key, name, initial).value as T },
    set<T>(key: string, name: string, initial: T | (() => T), action: SetStateAction<T>) {
      const entry = cell(key, name, initial)
      const next = typeof action === 'function' ? (action as (value: T) => T)(entry.value as T) : action
      if (Object.is(entry.value, next)) return
      entry.value = next
      for (const listener of entry.listeners) listener()
    },
    subscribe(key: string, name: string, listener: () => void) {
      const entry = cell(key, name, undefined)
      entry.listeners.add(listener)
      return () => { entry.listeners.delete(listener) }
    },
    ref<T>(key: string, name: string, initial: T): MutableRefObject<T> { return cell(key, `ref:${name}`, () => ({ current: initial })).value as MutableRefObject<T> },
    peekRef<T>(key: string, name: string): MutableRefObject<T> | undefined { return sessions.get(canonical(key))?.get(`ref:${name}`)?.value as MutableRefObject<T> | undefined },
    same(a: string, b: string) { return canonical(a) === canonical(b) },
    rekey(from: string, to: string) {
      from = canonical(from); to = canonical(to)
      if (from === to) return
      const fields = sessions.get(from)
      if (fields) { sessions.set(to, fields); sessions.delete(from) }
      aliases.set(from, to)
    },
    keys() { return [...sessions.keys()] },
  }
}
export type ComposerSessions = ReturnType<typeof createComposerSessions>

export function useComposerSessionState<T>(store: ComposerSessions, key: string, name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const read = () => store.get(key, name, initial)
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, name, listener), [store, key, name])
  const value = useSyncExternalStore(subscribe, read, read)
  const set = useCallback((action: SetStateAction<T>) => store.set(key, name, initial, action), [store, key, name])
  return [value, set]
}
