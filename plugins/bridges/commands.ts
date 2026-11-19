import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'

export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'bridges',
  handlers: {
    'toggle-channel-route': ({ signal, services }) => {
      signal.throwIfAborted()
      const bridge = services['bridge-routing']?.channel
      if (!bridge) throw new Error('Select a Claude session with a CLI bridge to route the composer')
      bridge.toggle()
    },
    'toggle-ide-route': ({ signal, services }) => {
      signal.throwIfAborted()
      const bridge = services['bridge-routing']?.ide
      if (!bridge) throw new Error('Select a Claude session with an IDE bridge to route the composer')
      bridge.toggle()
    },
  },
}
