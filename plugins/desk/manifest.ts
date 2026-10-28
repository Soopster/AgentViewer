import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The desk: a Bloomberg-Terminal-style workspace over every session, with
// colours of its own whatever the app's theme.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'desk',
  title: 'Desk',
  description: 'A Bloomberg-style workspace over every session: monitors, movers, alerts and a command line.',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'desk',
    title: '▣ Desk',
    pin: null,
    single: true,
    // The desk's letters belong to its command line, as the editor's do to its buffer.
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'Desk in a window',
    services: ['session-fleet'],
    optionalServices: ['themes'],
    fullScreen: true,
  }],
  commands: [{
    id: 'desk',
    label: 'Bloomberg-style desk',
    category: 'View',
    opens: 'desk',
    requires: null,
    renderers: ['tui'],
    tuiKeyLabel: '⌃K b',
    keywords: ['bloomberg', 'terminal', 'monitor', 'fleet', 'dashboard'],
  }],
} as const satisfies PluginManifest
