import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Session alerts: a desktop notification when a session you walked away from
// needs an answer or finishes a long turn, and an in-app notice when you are
// here but looking at another session. Application observers own delivery;
// the view is the switch (desktop / in-app / off).
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'session-alerts',
  title: 'Session alerts',
  description: 'Notify when a session needs input or finishes a long turn, through in-app or desktop notifications.',
  renderers: ['web', 'tui'],
  application: { events: ['sessionActivity'], services: ['notifications'] },
  stateVersion: 1,
  surfaces: [{
    id: 'session-alerts',
    title: '♪ Alerts',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Session alerts in a window',
    services: [],
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'session-alerts',
    label: 'Session alerts (desktop / in-app / off)',
    category: 'Session',
    opens: 'session-alerts',
    scope: 'application',
    requires: null,
    renderers: ['web', 'tui'],
    keywords: ['notify', 'notification', 'bell', 'alert', 'finished', 'approval', 'blurred'],
  }],
} as const satisfies PluginManifest
