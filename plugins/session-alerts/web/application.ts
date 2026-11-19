import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { PluginApplicationModule } from '../../../lib/plugins/application'
import { createAlertObserver } from '../domain/observer'
import { readSessionAlertMode } from './modeStore'

export const application: PluginApplicationModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'session-alerts',
  activate: context => createAlertObserver(context, readSessionAlertMode),
}
