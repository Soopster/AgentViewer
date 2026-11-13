import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Pi's loading progress — checking and installing configured extensions while
// a session is created — as a corner widget. Headless otherwise: no surface,
// no command. The progress feed (lib/piActivity.ts) is the Pi runtime's own
// and keeps running with the widget off.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'pi-activity',
  title: 'Pi activity',
  description: "Shows Pi's extension and package loading progress in a corner while a session starts.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [],
  commands: [],
  widgets: [{ id: 'pi-activity', slot: 'corner' }],
} as const satisfies PluginManifest
