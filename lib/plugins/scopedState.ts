// Plugin view state, scoped to one plugin and one view instance. It lives
// outside React so a view keeps its state when it moves between placements
// (overlay → window → tab): those moves unmount one component and mount
// another, and component state would start over.
//
// An instance is disposed when nothing has held it for a tick, so a move that
// unmounts and remounts in one commit keeps it, while a closed view releases it
// and its cleanups (timers, subscriptions a view registered) run then.
import { isPluginEnabled, readDisabledPlugins, subscribePluginEnablement } from './enablement'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

type Instance = {
  values: Map<string, unknown>
  listeners: Set<() => void>
  cleanups: Set<() => void>
  holds: number
  disposeTimer: ReturnType<typeof setTimeout> | null
}

/** Persisted shape. Unknown plugins and other state versions are kept verbatim. */
export type PluginStateSnapshot = {
  version: 1
  plugins: Record<string, { stateVersion: number; instances: Record<string, Record<string, unknown>> }>
}

export type PluginStateStore = ReturnType<typeof createPluginStateStore>

// Weak ownership: the lifecycle listener must not retain closed workspaces.
const liveStores = new Set<WeakRef<{ disposePlugin(id: string): void }>>()
subscribePluginEnablement(() => {
  for (const reference of liveStores) {
    const store = reference.deref()
    if (!store) { liveStores.delete(reference); continue }
    for (const id of readDisabledPlugins()) store.disposePlugin(id)
  }
})

export function createPluginStateStore(options: { disposeDelayMs?: number } = {}) {
  const delay = options.disposeDelayMs ?? 0
  const instances = new Map<string, Instance>()
  // State read from a snapshot that no bundled plugin claims, or whose version
  // no longer matches: carried through every later snapshot so a missing or
  // downgraded plugin does not cost the user what it had saved.
  let retained: PluginStateSnapshot['plugins'] = {}
  const restored = new Map<string, Map<string, unknown>>()

  const keyOf = (pluginId: string, instanceId: string) => `${pluginId}\u0000${instanceId}`
  const ensure = (pluginId: string, instanceId: string): Instance => {
    const key = keyOf(pluginId, instanceId)
    let instance = instances.get(key)
    if (!instance) {
      instance = { values: restored.get(key) ?? new Map(), listeners: new Set(), cleanups: new Set(), holds: 0, disposeTimer: null }
      restored.delete(key)
      instances.set(key, instance)
    }
    return instance
  }
  const dispose = (key: string) => {
    const instance = instances.get(key)
    if (!instance) return
    if (instance.disposeTimer) clearTimeout(instance.disposeTimer)
    instances.delete(key)
    for (const cleanup of instance.cleanups) {
      try { cleanup() } catch (error) { console.error('Plugin cleanup failed:', error) }
    }
    instance.cleanups.clear()
  }

  const store = {
    get<T>(pluginId: string, instanceId: string, name: string, initial: T): T {
      const instance = instances.get(keyOf(pluginId, instanceId))
      if (instance?.values.has(name)) return instance.values.get(name) as T
      const pending = restored.get(keyOf(pluginId, instanceId))
      return pending?.has(name) ? pending.get(name) as T : initial
    },
    set(pluginId: string, instanceId: string, name: string, value: unknown): void {
      if (!isPluginEnabled(pluginId)) return
      const instance = ensure(pluginId, instanceId)
      if (Object.is(instance.values.get(name), value)) return
      instance.values.set(name, value)
      for (const listener of instance.listeners) listener()
    },
    subscribe(pluginId: string, instanceId: string, listener: () => void): () => void {
      if (!isPluginEnabled(pluginId)) return () => {}
      const instance = ensure(pluginId, instanceId)
      instance.listeners.add(listener)
      return () => { instance.listeners.delete(listener) }
    },
    /** Register work to undo when the instance is disposed. */
    onDispose(pluginId: string, instanceId: string, cleanup: () => void): () => void {
      if (!isPluginEnabled(pluginId)) {
        try { cleanup() } catch (error) { console.error('Plugin cleanup failed:', error) }
        return () => {}
      }
      const instance = ensure(pluginId, instanceId)
      instance.cleanups.add(cleanup)
      return () => { instance.cleanups.delete(cleanup) }
    },
    /** A mounted view holds its instance; the returned release lets it go. */
    hold(pluginId: string, instanceId: string): () => void {
      if (!isPluginEnabled(pluginId)) return () => {}
      const key = keyOf(pluginId, instanceId)
      const instance = ensure(pluginId, instanceId)
      instance.holds += 1
      if (instance.disposeTimer) { clearTimeout(instance.disposeTimer); instance.disposeTimer = null }
      let released = false
      return () => {
        if (released) return
        released = true
        const current = instances.get(key)
        if (current !== instance) return
        current.holds -= 1
        if (current.holds > 0) return
        current.disposeTimer = setTimeout(() => {
          current.disposeTimer = null
          if (instances.get(key) === current && current.holds === 0) dispose(key)
        }, delay)
      }
    },
    has(pluginId: string, instanceId: string): boolean {
      return instances.has(keyOf(pluginId, instanceId))
    },
    /** Release active and parked view caches, leaving retained unknown snapshot data intact. */
    disposePlugin(pluginId: string): void {
      const prefix = `${pluginId}\u0000`
      for (const key of instances.keys()) if (key.startsWith(prefix)) dispose(key)
      for (const key of restored.keys()) if (key.startsWith(prefix)) restored.delete(key)
    },
    disposeNow(pluginId: string, instanceId: string): void {
      dispose(keyOf(pluginId, instanceId))
    },
    /** Copy values only during an explicit layout relocation, never resource ownership. */
    copyOwner(from: string, to: string, onlyPluginId?: string): void {
      const source = `${from}:`, destination = `${to}:`
      const values = new Map<string, Map<string, unknown>>()
      for (const [key, instance] of instances) values.set(key, instance.values)
      for (const [key, pending] of restored) if (!values.has(key)) values.set(key, pending)
      for (const [key, fields] of values) {
        const [pluginId, instanceId] = key.split('\u0000') as [string, string]
        if ((!onlyPluginId || pluginId === onlyPluginId) && instanceId.startsWith(source)) {
          const target = ensure(pluginId, destination + instanceId.slice(source.length))
          target.values = new Map(fields)
          for (const listener of target.listeners) listener()
        }
      }
    },
    snapshot(stateVersions: Readonly<Record<string, number>>): PluginStateSnapshot {
      const plugins: PluginStateSnapshot['plugins'] = structuredClone(retained)
      const write = (key: string, values: Map<string, unknown>) => {
        const [pluginId, instanceId] = key.split('\u0000') as [string, string]
        const stateVersion = stateVersions[pluginId]
        if (stateVersion === undefined || !values.size) return
        const entry = plugins[pluginId]?.stateVersion === stateVersion ? plugins[pluginId]! : (plugins[pluginId] = { stateVersion, instances: {} })
        entry.instances[instanceId] = Object.fromEntries(values)
      }
      for (const [key, values] of restored) write(key, values)
      for (const [key, instance] of instances) write(key, instance.values)
      return { version: 1, plugins }
    },
    restore(raw: unknown, stateVersions: Readonly<Record<string, number>>): void {
      retained = {}
      restored.clear()
      const snapshot = decodePluginStateSnapshot(raw)
      for (const [pluginId, entry] of Object.entries(snapshot.plugins)) {
        if (stateVersions[pluginId] !== entry.stateVersion) { retained[pluginId] = entry; continue }
        for (const [instanceId, values] of Object.entries(entry.instances)) {
          restored.set(keyOf(pluginId, instanceId), new Map(Object.entries(values)))
        }
      }
    },
  }
  liveStores.add(new WeakRef(store))
  return store
}

/** Anything malformed reads as empty rather than throwing at boot. */
export function decodePluginStateSnapshot(raw: unknown): PluginStateSnapshot {
  const empty: PluginStateSnapshot = { version: 1, plugins: {} }
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return empty
  const plugins = (raw as { plugins?: unknown }).plugins
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return empty
  const result: PluginStateSnapshot['plugins'] = {}
  for (const [pluginId, entry] of Object.entries(plugins as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const { stateVersion, instances } = entry as { stateVersion?: unknown; instances?: unknown }
    if (typeof stateVersion !== 'number' || !instances || typeof instances !== 'object' || Array.isArray(instances)) continue
    const decoded: Record<string, Record<string, unknown>> = {}
    for (const [instanceId, values] of Object.entries(instances as Record<string, unknown>)) {
      if (values && typeof values === 'object' && !Array.isArray(values)) decoded[instanceId] = values as Record<string, unknown>
    }
    result[pluginId] = { stateVersion, instances: decoded }
  }
  return { version: 1, plugins: result }
}

/** The process's plugin state; both renderers' hosts use one store each. */
export const pluginState = createPluginStateStore()

/** React binding: `[value, setValue]` for one named value of one view instance. */
export function useScopedPluginState<T>(store: PluginStateStore, pluginId: string, instanceId: string, name: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const subscribe = useCallback((listener: () => void) => store.subscribe(pluginId, instanceId, listener), [store, pluginId, instanceId])
  // Defaults have React state semantics, including object and array literals.
  const defaultValue = useMemo(() => initial, [store, pluginId, instanceId, name])
  const read = () => store.get(pluginId, instanceId, name, defaultValue)
  const value = useSyncExternalStore(subscribe, read, read)
  const set = useCallback((next: T | ((previous: T) => T)) => {
    const previous = store.get(pluginId, instanceId, name, defaultValue)
    store.set(pluginId, instanceId, name, typeof next === 'function' ? (next as (previous: T) => T)(previous) : next)
    // `initial` is a default, not a dependency: a fresh literal per render must
    // not rebuild the setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, pluginId, instanceId, name])
  return [value, set]
}
