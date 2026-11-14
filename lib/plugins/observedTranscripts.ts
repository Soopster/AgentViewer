import { useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import type { PluginSessionRef } from './bookmarks'
import type { PluginLiveTranscript } from './tasks'
import type { ThreadedMessage } from '../threading'
import type { PluginRenderer } from './types'

export type ObservedTranscript = { readonly owner: string; readonly target: PluginSessionRef; readonly persisted: readonly ThreadedMessage[]; readonly live: PluginLiveTranscript }
function createObservedTranscripts() {
  let snapshot: readonly ObservedTranscript[] = []
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    set(owner: string, value: ObservedTranscript | null) {
      snapshot = [...snapshot.filter(entry => entry.owner !== owner), ...(value ? [value] : [])]
      for (const listener of listeners) listener()
    },
  }
}
const stores = { web: createObservedTranscripts(), tui: createObservedTranscripts() }

/** Publishes only data the reader already owns; no reads or provider lifetimes. */
export function usePublishObservedTranscript(renderer: PluginRenderer, target: PluginSessionRef | null, persisted: readonly ThreadedMessage[], live: PluginLiveTranscript) {
  const owner = useId()
  const store = stores[renderer]
  const value = useMemo(() => target ? { owner, target, persisted, live } : null,
    [owner, target?.provider, target?.providerInstanceId, target?.sessionId, persisted, live.messages, live.todos, live.plan])
  useEffect(() => { store.set(owner, value) }, [store, owner, value])
  useEffect(() => () => store.set(owner, null), [store, owner])
}

export function useObservedTranscripts(renderer: PluginRenderer) {
  const store = stores[renderer]
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
