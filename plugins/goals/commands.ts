import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'goals',
  handlers: { open: context => { context.services['composer-accessories']!.open('session-goal') } },
}
