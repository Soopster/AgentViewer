// The Web app's widget loaders: static specifiers, one chunk per plugin.
import { PLUGIN_MANIFESTS } from '../../lib/plugins/catalog'
import { createPluginWidgetRegistry } from '../../lib/plugins/widgetHost'
import type { WebPluginWidget } from './pluginTypes'

export const webPluginWidgets = createPluginWidgetRegistry<WebPluginWidget>('web', PLUGIN_MANIFESTS, {
  'dynamic-island': async () => (await import('../../plugins/dynamic-island/web')).widgets,
  'pi-activity': async () => (await import('../../plugins/pi-activity/web')).widgets,
})
