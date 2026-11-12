import type { PluginApplicationLoaders } from '../../lib/plugins/applicationHost'

export const webApplicationPlugins: PluginApplicationLoaders = {
  'session-alerts': async () => (await import('../../plugins/session-alerts/web/application')).application,
}
