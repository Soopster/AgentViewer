// The TUI's half of local plugins: discover the user's mods and register them
// before the root loads (the ⌃K chord table and the command catalog are built
// from manifests at module load), and run their commands in this process.
import { registerLocalPluginManifests } from '../../../lib/plugins/catalog'
import { setLocalCommandRunner } from '../../../lib/plugins/localManifest'
import { localPluginDiscovery } from '../../../lib/plugins/localPlugins'

export function installTuiLocalPlugins(): void {
  const discovery = localPluginDiscovery()
  registerLocalPluginManifests(discovery.plugins.map(plugin => plugin.manifest))
  setLocalCommandRunner(async (request, signal) => {
    const { runLocalPluginCommand } = await import('../../../lib/plugins/localPluginRuntime')
    return runLocalPluginCommand(request, signal)
  })
}
