// Surface-host registration for app inspection, never inferred from DOM structure.
import { useSyncExternalStore } from 'react'
const entries = new Map<string, { id: string; placement: string }>()
const listeners = new Set<() => void>()
let value: { focused: string | null; surfaces: readonly { id: string; placement: string }[] } = { focused: null, surfaces: [] }
const publish = () => { value = { focused: value.focused, surfaces: [...entries.values()] }; for (const listener of listeners) listener() }
export function trackModSurface(key: string, id: string, placement: string): () => void {
  entries.set(key, { id, placement }); publish()
  return () => { entries.delete(key); if (value.focused === id) value = { ...value, focused: null }; publish() }
}
export function focusModSurface(id: string): void { value = { ...value, focused: id }; publish() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useModSurfaces() { return useSyncExternalStore(subscribe, () => value, () => value) }
