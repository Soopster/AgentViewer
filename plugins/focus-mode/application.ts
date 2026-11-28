import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginApplicationModule } from '../../lib/plugins/application'
import { bindFocusController, focusController } from './store'

// Shared by both renderers: install the gate while the plugin is on, announce the digest.
export const application: PluginApplicationModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'focus-mode',
  activate(context) {
    const controller = focusController(context.services.focus!)
    const notifications = context.services.notifications
    const release = controller.activate(title => {
      // The digest itself is never held: the block it reports on is already over.
      notifications?.show('info', title, { title: 'Focus Mode', durationMs: 0, urgent: true })
    })
    bindFocusController(controller)
    context.defer(() => { release(); bindFocusController(null) })
    return { onSessionActivity: () => controller.tick() }
  },
}
