// The TUI's widget loaders: static specifiers so Bun can resolve each one.
import { PLUGIN_MANIFESTS } from '../../../lib/plugins/catalog'
import { createPluginWidgetRegistry } from '../../../lib/plugins/widgetHost'
import type { TuiPluginWidget } from './pluginTypes'

export const tuiPluginWidgets = createPluginWidgetRegistry<TuiPluginWidget>('tui', PLUGIN_MANIFESTS, {
  'omni-bar': async () => (await import('../../../plugins/omni-bar/tui')).widgets,
  toasts: async () => (await import('../../../plugins/toasts/tui')).widgets,
  'dynamic-island': async () => (await import('../../../plugins/dynamic-island/tui')).widgets,
  'plan-review': async () => (await import('../../../plugins/plan-review/tui/widget')).widgets,
  proof: async () => (await import('../../../plugins/proof/tui')).widgets,
  schedules: async () => (await import('../../../plugins/schedules/tui/widget')).widgets,
  'pi-activity': async () => (await import('../../../plugins/pi-activity/tui')).widgets,
})
