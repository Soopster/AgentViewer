import type { PluginApplicationLoaders } from '../../../lib/plugins/applicationHost'

// Application code is separate from views: enabling observation never imports its UI.
export const tuiApplicationPlugins: PluginApplicationLoaders = {
  'session-alerts': async () => (await import('../../../plugins/session-alerts/tui/application')).application,
}
