// Lazy activation of a renderer's plugin views. Listing commands, restoring a
// layout or switching sessions reads manifests only; a view module loads the
// first time one of its surfaces is shown, once per isolate, with concurrent
// loads deduplicated and a failed load or validation evicted so Retry works.
import { createLazyRegistry } from '../extensions/lazyRegistry'
import { PLUGIN_MANIFESTS, type PluginId } from './catalog'
import { PLUGIN_API_VERSION, type PluginManifest, type PluginRenderer, type PluginServiceId, type PluginViewModule } from './types'

export function createPluginViewRegistry<View>(
  renderer: PluginRenderer,
  loaders: Readonly<Partial<Record<PluginId, () => Promise<PluginViewModule<View>>>>>,
  hostServices: readonly PluginServiceId[],
  manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS,
) {
  const supported = manifests.filter(manifest => manifest.renderers.includes(renderer))
  for (const manifest of supported) {
    if (!loaders[manifest.id as PluginId]) throw new Error(`Plugin ${manifest.id} declares the ${renderer} renderer but has no ${renderer} loader`)
  }
  const registry = createLazyRegistry<string, PluginViewModule<View>>(
    loaders as Record<string, () => Promise<PluginViewModule<View>>>,
    (id, module) => validatePluginViewModule(renderer, manifests.find(manifest => manifest.id === id), module, hostServices),
  )
  return {
    load: registry.get,
    peek: registry.peek,
    /** True once a plugin's views are in memory: a smoke's proof of laziness. */
    isLoaded: (id: string) => registry.peek(id) !== undefined,
  }
}

/** API mismatches are rejected before a view mounts, never inside it. */
export function validatePluginViewModule<View>(renderer: PluginRenderer, manifest: PluginManifest | undefined, module: PluginViewModule<View>, hostServices: readonly PluginServiceId[]): void {
  if (!manifest) throw new Error('Unknown plugin')
  if (!module || module.apiVersion !== PLUGIN_API_VERSION || manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`Plugin ${manifest.id} targets API ${String(module?.apiVersion)}; this host supports ${PLUGIN_API_VERSION}`)
  }
  if (module.pluginId !== manifest.id) throw new Error(`Plugin module identity mismatch: ${manifest.id} / ${module.pluginId}`)
  for (const surface of manifest.surfaces) {
    const view = module.views[surface.id] as unknown
    // A component is a function, or an object for memo/forwardRef wrappers.
    if (!view || (typeof view !== 'function' && typeof view !== 'object')) throw new Error(`Plugin ${manifest.id} has no ${renderer} view for surface ${surface.id}`)
    const missing = surface.services.filter(service => !hostServices.includes(service))
    if (missing.length) throw new Error(`Plugin ${manifest.id} needs services this host lacks: ${missing.join(', ')}`)
  }
}

export function pluginStateVersions(manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS): Record<string, number> {
  return Object.fromEntries(manifests.map(manifest => [manifest.id, manifest.stateVersion]))
}

/** Resolve the capabilities actually offered to one mounted view. Optional services stay optional. */
export function resolvePluginServices<T extends object>(surface: { id: string; services: readonly PluginServiceId[]; optionalServices?: readonly PluginServiceId[] }, offered: T): { services: T; error: Error | null } {
  const declared = new Set<string>([...surface.services, ...(surface.optionalServices ?? [])])
  const services = Object.fromEntries(Object.entries(offered).filter(([id, value]) => declared.has(id) && value != null)) as T
  const missing = surface.services.filter(id => !(id in services))
  return { services, error: missing.length ? new Error(`Surface ${surface.id} needs services this view lacks: ${missing.join(', ')}`) : null }
}
