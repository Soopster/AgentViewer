// The TUI's plugin view loaders. Static specifiers so Bun can resolve each
// one; nothing here is evaluated until a surface is first shown.
import { createPluginViewRegistry } from '../../../lib/plugins/activation'
import type { PluginServiceId } from '../../../lib/plugins/types'
import type { TuiPluginView } from './pluginTypes'

export const TUI_PLUGIN_SERVICES: readonly PluginServiceId[] = ['session-transcript', 'repository', 'composer', 'clipboard', 'open-file', 'directory-picker', 'scroll-preferences']

export const tuiPluginViews = createPluginViewRegistry<TuiPluginView>('tui', {
  analytics: async () => (await import('../../../plugins/analytics/tui')).module,
  git: async () => (await import('../../../plugins/git/tui')).module,
  files: async () => (await import('../../../plugins/files/tui')).module,
}, TUI_PLUGIN_SERVICES)
