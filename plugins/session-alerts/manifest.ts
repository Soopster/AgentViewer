import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Session alerts: a desktop notification when a session you walked away from
// needs an answer or finishes a long turn, and an in-app notice when you are
// here but looking at another session. The watching is a host effect that
// checks this plugin is on; the view is the switch (desktop / in-app / off).
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'session-alerts',
  title: 'Session alerts',
  description: 'Notify when a session needs your input or finishes a long turn while the terminal is in the background.',
  renderers: ['tui'],
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
    requires: null,
    renderers: ['tui'],
    keywords: ['notify', 'notification', 'bell', 'alert', 'finished', 'approval', 'blurred'],
  }],
} as const satisfies PluginManifest
