// Widget contributions: persistent plugin UI in named shell slots. Like the
// composer accessories, a widget is loaded by its renderer's static loader
// list; unlike a surface it has no opening command. A disabled plugin's widget
// module is evicted and its deactivate hook run, so turning a plugin off takes
// its widget off screen at once.
import { createLazyRegistry } from '../extensions/lazyRegistry'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { PLUGIN_API_VERSION, type PluginManifest, type PluginRenderer, type PluginWidgetModule, type PluginWidgetSlot } from './types'

export type PluginWidgetSpec = { readonly pluginId: string; readonly id: string; readonly slot: PluginWidgetSlot; readonly order: number }

export function listPluginWidgets(renderer: PluginRenderer, manifests: readonly PluginManifest[], slot?: PluginWidgetSlot): PluginWidgetSpec[] {
  const seen = new Set<string>()
  const specs: PluginWidgetSpec[] = []
  for (const manifest of manifests) {
    if (!manifest.renderers.includes(renderer)) continue
    for (const widget of manifest.widgets ?? []) {
      const key = `${manifest.id}:${widget.id}`
      if (seen.has(key)) throw new Error(`Duplicate plugin widget: ${key}`)
      seen.add(key)
      if (slot && widget.slot !== slot) continue
      specs.push({ pluginId: manifest.id, id: widget.id, slot: widget.slot, order: widget.order ?? 0 })
    }
  }
  return specs.sort((a, b) => a.order - b.order || a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id))
}

export function createPluginWidgetRegistry<Widget>(
  renderer: PluginRenderer,
  manifests: readonly PluginManifest[],
  loaders: Readonly<Record<string, () => Promise<PluginWidgetModule<Widget>>>>,
) {
  const contributors = manifests.filter(manifest => manifest.renderers.includes(renderer) && (manifest.widgets?.length ?? 0) > 0)
  for (const manifest of contributors) {
    if (!Object.hasOwn(loaders, manifest.id)) throw new Error(`Plugin ${manifest.id} declares ${renderer} widgets but has no ${renderer} widget loader`)
  }
  const registry = createLazyRegistry(loaders, (id, module) => {
    const manifest = contributors.find(entry => entry.id === id)
    if (!manifest || module?.apiVersion !== PLUGIN_API_VERSION || module.pluginId !== id) throw new Error(`Plugin ${id} widget API or identity mismatch`)
    for (const widget of manifest.widgets ?? []) {
      const view = module.widgets?.[widget.id] as unknown
      if (!view || (typeof view !== 'function' && typeof view !== 'object')) throw new Error(`Plugin ${id} has no ${renderer} widget ${widget.id}`)
    }
  })
  const deactivate = (id: string) => {
    const loaded = registry.peek(id)
    registry.evict(id)
    try { loaded?.deactivate?.() } catch (error) { console.error(`Plugin ${id} widget cleanup failed:`, error) }
  }
  subscribePluginEnablement(() => {
    for (const manifest of contributors) if (!isPluginEnabled(manifest.id)) deactivate(manifest.id)
  })
  return {
    load(id: string) {
      if (!isPluginEnabled(id)) {
        const error = new Error(`Plugin ${id} is disabled`)
        error.name = 'AbortError'
        return Promise.reject(error)
      }
      return registry.get(id)
    },
    peek: registry.peek,
    isLoaded: (id: string) => registry.peek(id) !== undefined,
  }
}
export type PluginWidgetRegistry<Widget> = ReturnType<typeof createPluginWidgetRegistry<Widget>>
