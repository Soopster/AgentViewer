// Whether any plugin could present tool cards at all: a synchronous, cheap
// answer for the read path, which runs on every poll and must not load the
// behavior host (or anything else) when no plugin declares the hook.
import { PLUGIN_MANIFESTS } from './catalog'
import { localPluginDiscovery } from './localPlugins'
import type { PluginManifest } from './types'

export function pluginsMayPresentToolCards(): boolean {
  if ((PLUGIN_MANIFESTS as readonly PluginManifest[]).some(manifest => manifest.behavior?.hooks.includes('toolCard'))) return true
  try { return localPluginDiscovery().plugins.some(plugin => plugin.manifest.behavior?.hooks.includes('toolCard')) } catch { return false }
}
