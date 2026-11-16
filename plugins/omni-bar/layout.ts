import { useSyncExternalStore } from 'react'

/** Everything the bar can show, in its default order. `commands` is not here: it is the bar's way back to everything else, so it is always last and always on. */
export const OMNI_ITEMS = [
  { id: 'repository', label: 'Repository and Git status', on: true },
  { id: 'session', label: 'Selected session and activity', on: true },
  { id: 'new-session', label: 'New session', on: true },
  { id: 'files', label: 'Files', on: true },
  { id: 'processes', label: 'Terminal', on: true },
  { id: 'index-search', label: 'Search', on: true },
  { id: 'editor', label: 'Editor', on: false },
  { id: 'pull-requests', label: 'Pull requests', on: false },
  { id: 'github', label: 'GitHub', on: false },
  { id: 'checkpoints', label: 'Checkpoints', on: false },
  { id: 'analytics', label: 'Analytics', on: false },
  { id: 'attention', label: 'Running and needs-input counts', on: true },
] as const
export type OmniItemId = typeof OMNI_ITEMS[number]['id']
export type OmniLayoutItem = { readonly id: OmniItemId; readonly enabled: boolean }
export type OmniLayout = readonly OmniLayoutItem[]

export const DEFAULT_OMNI_LAYOUT: OmniLayout = OMNI_ITEMS.map(item => ({ id: item.id, enabled: item.on }))
const KNOWN = new Set<string>(OMNI_ITEMS.map(item => item.id))
export const omniItemLabel = (id: OmniItemId) => OMNI_ITEMS.find(item => item.id === id)!.label

/** Stored layouts outlive the code: unknown and repeated ids are dropped, and an item added since is appended with its default. */
export function normalizeLayout(raw: unknown): OmniLayout {
  const seen = new Set<string>()
  const kept: OmniLayoutItem[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined
      if (typeof id !== 'string' || !KNOWN.has(id) || seen.has(id)) continue
      seen.add(id)
      kept.push({ id: id as OmniItemId, enabled: (entry as { enabled?: unknown }).enabled !== false })
    }
  }
  return [...kept, ...DEFAULT_OMNI_LAYOUT.filter(item => !seen.has(item.id))]
}

export function toggleLayoutItem(layout: OmniLayout, index: number): OmniLayout {
  return layout.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item)
}

/** Moves one item by `delta` places, stopping at the ends. */
export function moveLayoutItem(layout: OmniLayout, index: number, delta: number): OmniLayout {
  const to = Math.max(0, Math.min(layout.length - 1, index + delta))
  if (to === index) return layout
  const next = [...layout]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item!)
  return next
}

export type OmniLayoutStorage = { read(): unknown; write(value: OmniLayout): void }
export type OmniLayoutStore = {
  get(): OmniLayout
  set(next: OmniLayout): void
  reset(): void
  subscribe(listener: () => void): () => void
}

/** One layout per renderer, shared by the bar and its settings view; storage is the renderer's own. */
export function createLayoutStore(storage: OmniLayoutStorage): OmniLayoutStore {
  let current: OmniLayout | null = null
  const listeners = new Set<() => void>()
  const load = () => {
    if (current) return current
    try { current = normalizeLayout(storage.read()) } catch { current = DEFAULT_OMNI_LAYOUT }
    return current
  }
  const set = (next: OmniLayout) => {
    current = normalizeLayout(next)
    try { storage.write(current) } catch { /* the layout still holds for this session */ }
    for (const listener of listeners) listener()
  }
  return {
    get: load,
    set,
    reset: () => set(DEFAULT_OMNI_LAYOUT),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

export function useOmniLayout(store: OmniLayoutStore): OmniLayout {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
