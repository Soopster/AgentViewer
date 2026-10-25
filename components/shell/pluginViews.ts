// The Web app's plugin view loaders. Each import() is a static specifier, so
// the bundler emits one chunk per plugin and loads it on first open.
import { createPluginViewRegistry } from '@/lib/plugins/activation'
import type { PluginServiceId } from '@/lib/plugins/types'
import type { WebPluginView } from './pluginTypes'

export const WEB_PLUGIN_SERVICES: readonly PluginServiceId[] = ['session-transcript']

export const webPluginViews = createPluginViewRegistry<WebPluginView>('web', {
  analytics: async () => (await import('@/plugins/analytics/web')).module,
}, WEB_PLUGIN_SERVICES)
