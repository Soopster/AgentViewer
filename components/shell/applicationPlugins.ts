import type { PluginApplicationLoaders } from '../../lib/plugins/applicationHost'

export const webApplicationPlugins: PluginApplicationLoaders = {
  'dynamic-island': async () => (await import('../../plugins/dynamic-island/observer')).application,
  'session-alerts': async () => (await import('../../plugins/session-alerts/web/application')).application,
  'focus-mode': async () => (await import('../../plugins/focus-mode/application')).application,
}
