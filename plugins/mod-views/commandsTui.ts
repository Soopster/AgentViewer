import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
import { isRemoteAttached, remoteJson } from '../../lib/tui/remote'

/** TUI: reload in process, or through the daemon this TUI is attached to (its mods run there). */
export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'mod-views',
  handlers: {
    async reload({ services }) {
      let loaded = 0, refused = 0
      if (isRemoteAttached()) {
        const value = await remoteJson<{ loaded: string[]; refused: unknown[] }>('/api/plugins/reload', { method: 'POST' })
        loaded = value.loaded.length; refused = value.refused.length
      } else {
        const { requestModReload, readModReloadRequest } = await import('../../lib/plugins/modReload')
        const { localPluginDiscovery } = await import('../../lib/plugins/localPlugins')
        requestModReload(readModReloadRequest().developmentDirs)
        const discovery = localPluginDiscovery()
        loaded = discovery.plugins.length; refused = discovery.refused.length
      }
      services.notices?.show('info', `Reloaded ${loaded} mods${refused ? `, ${refused} refused` : ''}`)
    },
  },
}
