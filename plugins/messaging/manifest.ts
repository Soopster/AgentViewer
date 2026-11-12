import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Cross-session messaging: find the sessions this one can reach and hand one
// of them a message, steered into its live turn or starting a new one.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'messaging',
  title: 'Cross-session messaging',
  description: 'Send a message from one session to another, steering a live turn or starting one.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  dashboards: [{ id: 'messaging', title: 'Messaging', glyph: '✉', launcherLabel: 'Open cross-session messaging', command: 'open-cross-session-messaging', surface: 'messaging' }],
  surfaces: [{
    id: 'messaging',
    title: '✉ Messaging',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Cross-session messaging in a window',
    services: ['session', 'messaging'],
    optionalServices: ['notices', 'page-location'],
  }],
  commands: [{
    id: 'messaging',
    label: 'Cross-session messaging',
    category: 'Session',
    opens: 'messaging',
    // It opens with no session too: the sender is then the TUI itself.
    requires: null,
    renderers: ['tui'],
    tuiKey: { name: 'm', shift: true },
    tuiKeyLabel: '⇧M',
    keywords: ['message', 'send', 'handoff', 'steer', 'agents'],
  }, {
    id: 'open-cross-session-messaging', label: 'Cross-session messaging', category: 'Session',
    opens: 'messaging', requires: null, scope: 'application', renderers: ['web'],
    webDashboard: 'messaging', keywords: ['message', 'send', 'handoff', 'steer', 'agents'],
  }],
} as const satisfies PluginManifest
