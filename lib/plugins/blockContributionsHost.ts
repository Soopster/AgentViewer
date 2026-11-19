// The catalog-backed installer, for processes that hold the whole plugin catalog
// (the Web page, the TUI process). Idempotent; call once at boot.
import { allPluginManifests, subscribeLocalPlugins } from './catalog'
import { subscribePluginEnablement } from './enablement'
import { syncBlocksFrom } from './blockContributions'

let installed = false
const sync = () => syncBlocksFrom(allPluginManifests())

export function installPluginBlocks(): void {
  if (installed) return
  installed = true
  subscribeLocalPlugins(sync)
  subscribePluginEnablement(sync)
  sync()
}
