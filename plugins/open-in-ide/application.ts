import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginApplicationModule } from '../../lib/plugins/application'
import { ideController } from './store'

// One per renderer: install the file-open route while the plugin is on.
function create(renderer: 'web' | 'tui'): PluginApplicationModule {
  return {
    apiVersion: PLUGIN_API_VERSION, pluginId: 'open-in-ide',
    activate(context) {
      const controller = ideController(context.services.ide!)
      const notifications = context.services.notifications
      const release = controller.activate(renderer, (text, urgent) => notifications?.notice(text, { urgent }))
      context.defer(release)
      return { onSessionActivity: () => {} }
    },
  }
}

export const webApplication = create('web')
export const tuiApplication = create('tui')
