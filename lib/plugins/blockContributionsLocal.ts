// The TUI transcript worker threads transcripts but holds no plugin catalog, so
// it reads the user's mods directly: only mods can declare blocks there, and a
// reload re-registers them. Idempotent; call once at worker boot.
import { localPluginDiscovery, subscribeLocalPluginReload } from './localPlugins'
import { syncBlocksFrom } from './blockContributions'

let installed = false
const sync = () => syncBlocksFrom(localPluginDiscovery().plugins.map(plugin => plugin.manifest))

export function installLocalPluginBlocks(): void {
  if (installed) return
  installed = true
  subscribeLocalPluginReload(sync)
  sync()
}
