import { PLUGIN_MANIFESTS, type PluginSurfaceId } from './catalog'
import { isPluginEnabled } from './enablement'
import type { PluginManifest } from './types'

export type ReaderPluginRequest = { readonly serial: number; readonly action: 'open' | 'toggle' }
export type ReaderPluginPresentation = { readonly visible: boolean; readonly count?: number }
export type ReaderSlotService = {
  readonly request: ReaderPluginRequest
  readonly report: (presentation: ReaderPluginPresentation) => void
}
export function listReaderPlugins(manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS) {
  const ids = new Set<string>()
  return manifests.filter(manifest => manifest.renderers.includes('web')).flatMap(manifest => (manifest.reader ?? []).map(spec => {
    if (ids.has(spec.id) || !Number.isInteger(spec.width) || spec.width < 160 || spec.width > 800 || !manifest.surfaces.some(surface => surface.id === spec.surface && surface.placements.includes('panel'))) throw new Error(`Invalid reader contribution: ${spec.id}`)
    ids.add(spec.id)
    return { ...spec, pluginId: manifest.id, surface: spec.surface as PluginSurfaceId }
  })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}
const EMPTY_REQUEST: ReaderPluginRequest = { serial: 0, action: 'open' }
export function createReaderPluginController(specs: ReturnType<typeof listReaderPlugins>) {
  const listeners = new Set<() => void>()
  const presentations = new Map<string, { token: symbol; visible: boolean; count: number }>()
  const requests = new Map<string, ReaderPluginRequest>()
  let snapshot = { version: 0 }
  let live = true
  const notify = () => { snapshot = { version: snapshot.version + 1 }; for (const listener of listeners) listener() }
  return {
    specs,
    activate() { live = true },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    presentation: (id: string) => presentations.get(id),
    request: (id: string) => requests.get(id) ?? EMPTY_REQUEST,
    open(id: string, action: 'open' | 'toggle' = 'open') {
      const spec = specs.find(spec => spec.id === id)
      if (!live || !spec || !isPluginEnabled(spec.pluginId)) return false
      requests.set(id, { serial: (requests.get(id)?.serial ?? 0) + 1, action }); notify(); return true
    },
    report(id: string, token: symbol, value: ReaderPluginPresentation) {
      const spec = specs.find(spec => spec.id === id)
      if (!live || !spec || !isPluginEnabled(spec.pluginId)) return
      const previous = presentations.get(id)
      if (previous && previous.token !== token) return
      const count = Number.isFinite(value.count) ? Math.max(0, Math.floor(value.count!)) : 0
      if (previous?.visible === value.visible && previous.count === count) return
      presentations.set(id, { token, visible: value.visible, count }); notify()
    },
    remove(id: string, token: symbol) { if (presentations.get(id)?.token === token) { presentations.delete(id); notify() } },
    prune() { for (const spec of specs) if (!isPluginEnabled(spec.pluginId)) { presentations.delete(spec.id); requests.delete(spec.id) }; notify() },
    dispose() { if (!live) return; live = false; presentations.clear(); requests.clear(); notify(); listeners.clear() },
  }
}
export type ReaderPluginController = ReturnType<typeof createReaderPluginController>
