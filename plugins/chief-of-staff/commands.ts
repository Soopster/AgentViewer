import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
import { seedChiefOfStaffRequest } from './seed'

export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'chief-of-staff',
  // `/cos <request>` opens the panel and has it hand the request to this repository's Chief of Staff.
  handlers: { open: ({ services, input }) => { seedChiefOfStaffRequest(input?.slash.arguments ?? ''); services.commands!.run('chief-of-staff-open') } },
}
