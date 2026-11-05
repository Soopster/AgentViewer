import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The bridge panels: the live CLI channel bridge and the IDE bridge. Only the
// panels are here. Routing the composer through a bridge (⌃R, the palette's
// route toggles) and the bridges themselves are the composer's, so they keep
// working with this plugin off; the panels' services are offered only while a
// Claude session can use a bridge, and their commands say why otherwise.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'bridges',
  title: 'Bridge panels',
  description: 'The live CLI channel bridge and IDE bridge panels: activity, approvals and messages.',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'channel-bridge',
    title: '⇄ CLI bridge',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Live CLI bridge in a window',
    services: ['session', 'channel-bridge'],
    optionalServices: ['notices'],
  }, {
    id: 'ide-bridge',
    title: '⌨ IDE bridge',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'IDE bridge in a window',
    services: ['ide-bridge'],
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'channel-bridge',
    label: 'Channel bridge',
    category: 'Session',
    opens: 'channel-bridge',
    requires: 'session',
    renderers: ['tui'],
    tuiKey: { name: 'c', shift: true },
    tuiKeyLabel: '⇧C',
    keywords: ['bridge', 'channel', 'cli', 'claude', 'live'],
  }, {
    id: 'ide-bridge',
    label: 'IDE bridge',
    category: 'Session',
    opens: 'ide-bridge',
    requires: 'session',
    renderers: ['tui'],
    tuiKey: { name: 'i', shift: true },
    tuiKeyLabel: '⇧I',
    keywords: ['bridge', 'ide', 'diff', 'mention', 'claude'],
  }],
} as const satisfies PluginManifest
