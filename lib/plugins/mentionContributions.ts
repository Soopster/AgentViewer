// The catalog-backed installer for declared `mentions` (the TUI process; the composer runs there).
import { allPluginManifests, subscribeLocalPlugins } from './catalog'
import { subscribePluginEnablement } from './enablement'
import { syncMentionsFrom } from './mentionProviders'

let installed = false
const sync = () => syncMentionsFrom(allPluginManifests())

export function installPluginMentions(): void {
  if (installed) return
  installed = true
  subscribeLocalPlugins(sync)
  subscribePluginEnablement(sync)
  sync()
}
