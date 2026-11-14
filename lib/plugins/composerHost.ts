import { createLazyRegistry } from '../extensions/lazyRegistry'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { PLUGIN_API_VERSION, type PluginManifest, type PluginRenderer } from './types'
import type { ComposerAccessoryKey, ComposerAccessoryKeyResult, ComposerAccessoryPresentation, PluginComposerModule } from './composer'

export function listComposerAccessories(renderer: PluginRenderer, manifests: readonly PluginManifest[]) {
  const ids = new Set<string>()
  return manifests.filter(manifest => manifest.renderers.includes(renderer)).flatMap(manifest => (manifest.composer ?? []).map(spec => {
    if (ids.has(spec.id) || !Number.isInteger(spec.maxRows) || spec.maxRows < 1 || spec.maxRows > 4) throw new Error(`Invalid composer accessory: ${spec.id}`)
    ids.add(spec.id)
    return { ...spec, pluginId: manifest.id }
  })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}

export function createPluginComposerRegistry<View>(renderer: PluginRenderer, manifests: readonly PluginManifest[], loaders: Readonly<Record<string, () => Promise<PluginComposerModule<View>>>>) {
  const specs = listComposerAccessories(renderer, manifests)
  for (const spec of specs) if (!Object.hasOwn(loaders, spec.pluginId)) throw new Error(`Plugin ${spec.pluginId} has no ${renderer} composer loader`)
  const registry = createLazyRegistry(loaders, (id, module) => {
    if (module?.apiVersion !== PLUGIN_API_VERSION || module.pluginId !== id || !manifests.some(m => m.id === id && m.apiVersion === PLUGIN_API_VERSION)) throw new Error(`Plugin ${id} composer API or identity mismatch`)
    for (const spec of specs.filter(spec => spec.pluginId === id)) {
      if (!Object.hasOwn(module.accessories ?? {}, spec.id) || !module.accessories[spec.id]) throw new Error(`Plugin ${id} has no composer accessory ${spec.id}`)
    }
  })
  const unsubscribe = subscribePluginEnablement(() => { for (const spec of specs) if (!isPluginEnabled(spec.pluginId)) registry.evict(spec.pluginId) })
  let disposed = false
  return {
    specs,
    load(id: string) {
      if (disposed || !isPluginEnabled(id)) { const error = new Error(`Plugin ${id} composer is disabled`); error.name = 'AbortError'; return Promise.reject(error) }
      return registry.get(id)
    },
    peek: registry.peek,
    dispose() { if (disposed) return; disposed = true; unsubscribe(); for (const spec of specs) registry.evict(spec.pluginId) },
  }
}

export function createComposerAccessoryController(specs: ReturnType<typeof listComposerAccessories>) {
  const listeners = new Set<() => void>()
  const entries = new Map<string, ComposerAccessoryPresentation & { token: symbol; keys?: (key: ComposerAccessoryKey) => ComposerAccessoryKeyResult }>()
  const requests = new Map<string, number>()
  let snapshot = { rows: 0, modal: false, summary: null as string | null, version: 0 }
  let live = true
  const notify = () => {
    let rows = 0, modal = false, summary: string | null = null
    for (const spec of specs) {
      if (!isPluginEnabled(spec.pluginId)) continue
      const entry = entries.get(spec.id)
      if (!entry) continue
      rows += entry.rows; modal ||= Boolean(entry.modal); if (entry.summary) summary = entry.summary
    }
    snapshot = { rows, modal, summary, version: snapshot.version + 1 }
    for (const listener of listeners) listener()
  }
  return {
    activate() { live = true },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    request: (id: string) => requests.get(id) ?? 0,
    open(id: string): boolean {
      const spec = specs.find(spec => spec.id === id)
      if (!live || !spec || !isPluginEnabled(spec.pluginId)) return false
      requests.set(id, (requests.get(id) ?? 0) + 1); notify(); return true
    },
    report(id: string, token: symbol, presentation: ComposerAccessoryPresentation) {
      const spec = specs.find(spec => spec.id === id)
      if (!live || !spec || !isPluginEnabled(spec.pluginId)) return
      const rows = Math.max(0, Math.min(spec.maxRows, Number.isFinite(presentation.rows) ? Math.floor(presentation.rows) : 0))
      const previous = entries.get(id)
      if (previous && previous.token !== token) return
      if (previous?.rows === rows && previous.modal === Boolean(presentation.modal) && previous.summary === (presentation.summary ?? null)) return
      entries.set(id, { ...previous, token, rows, modal: Boolean(presentation.modal), summary: presentation.summary ?? null }); notify()
    },
    keys(id: string, token: symbol, handler: ((key: ComposerAccessoryKey) => ComposerAccessoryKeyResult) | null) {
      const previous = entries.get(id)
      if (!live) return
      if (!previous) entries.set(id, { token, rows: 0, modal: false, summary: null, keys: handler ?? undefined })
      else if (previous.token === token) previous.keys = handler ?? undefined
    },
    remove(id: string, token: symbol) { if (entries.get(id)?.token === token) { entries.delete(id); notify() } },
    prune() { for (const spec of specs) if (!isPluginEnabled(spec.pluginId)) { entries.delete(spec.id); requests.delete(spec.id) }; notify() },
    handleKey(key: ComposerAccessoryKey): ComposerAccessoryKeyResult {
      if (!live) return false
      for (const spec of [...specs].reverse()) {
        const entry = entries.get(spec.id)
        if (isPluginEnabled(spec.pluginId) && entry?.modal) return entry.keys?.(key) || 'input'
      }
      return false
    },
    dispose() { if (!live) return; live = false; entries.clear(); requests.clear(); notify(); listeners.clear() },
  }
}
export type ComposerAccessoryController = ReturnType<typeof createComposerAccessoryController>
