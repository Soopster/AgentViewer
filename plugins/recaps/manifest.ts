import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Session recaps: when a session goes quiet, a small model writes a one-line
// recap and, when the next step is obvious, a message the user could send.
// The engine, store and API are host services (lib/sessionRecap*.ts) because
// they run where turns settle, with no view open; the recap itself rides
// `session.recap` into the rows and the composer's suggestion slot, which the
// plugin contract has no contribution point for yet. This plugin owns the
// switch: turning it off in the plugin manager stops recaps from being
// written or shown, and the view is where they are turned on.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'recaps',
  title: 'Session recaps',
  description: 'A one-line recap and a suggested next message for sessions that have gone quiet. Sends recent transcript text to a model.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'recaps',
    title: '✦ Recaps',
    pin: 'session',
    single: true,
    keys: 'window',
    placements: ['overlay'],
    windowLabel: 'Session recaps',
    services: [],
    optionalServices: ['session', 'notices'],
  }],
  commands: [{
    id: 'recaps',
    label: 'Session recaps (idle summary + suggested next message)',
    category: 'Session',
    opens: 'recaps',
    requires: 'session',
    renderers: ['web', 'tui'],
    keywords: ['recap', 'summary', 'suggestion', 'idle', 'next', 'subtitle'],
  }],
} as const satisfies PluginManifest
