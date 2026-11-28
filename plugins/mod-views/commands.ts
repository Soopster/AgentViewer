import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'

/** Web: ask the daemon to reload mods; every open tab applies the new revision within seconds. */
export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'mod-views',
  handlers: {
    async reload({ services, signal }) {
      const response = await fetch('/api/plugins/reload', { method: 'POST', signal })
      const value = await response.json() as { loaded?: string[]; refused?: { id: string }[]; error?: string }
      if (!response.ok) throw new Error(value.error || 'Reload failed')
      services.notices?.show('info', `Reloaded ${value.loaded?.length ?? 0} mods${value.refused?.length ? `, ${value.refused.length} refused` : ''}`)
    },
  },
}
