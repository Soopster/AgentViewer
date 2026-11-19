import type { PluginApplicationLoaders } from '../../lib/plugins/applicationHost'

export const webApplicationPlugins: PluginApplicationLoaders = {
  'dynamic-island': async () => (await import('../../plugins/dynamic-island/observer')).application,
  'session-alerts': async () => (await import('../../plugins/session-alerts/web/application')).application,
}
