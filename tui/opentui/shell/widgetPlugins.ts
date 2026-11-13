// The TUI's widget loaders: static specifiers so Bun can resolve each one.
import { PLUGIN_MANIFESTS } from '../../../lib/plugins/catalog'
import { createPluginWidgetRegistry } from '../../../lib/plugins/widgetHost'
import type { TuiPluginWidget } from './pluginTypes'

export const tuiPluginWidgets = createPluginWidgetRegistry<TuiPluginWidget>('tui', PLUGIN_MANIFESTS, {
  'pi-activity': async () => (await import('../../../plugins/pi-activity/tui')).widgets,
})
