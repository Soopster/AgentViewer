import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'better',
  handlers: { open: ({ services, input }) => { services['composer-accessories']!.open('better-prompt', input) } },
}
