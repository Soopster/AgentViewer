import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Code provenance ("git blame for agents"): which sessions wrote a file, and
// what the current session's edits became. The index and its routes are host
// services; the view opens a session at the edit through session-navigation.
// Both renderers: the Web over its routes, the TUI over the in-process
// `provenance` service (the editor's ⌃A why answers it per line too).
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'provenance',
  title: 'Code provenance',
  description: 'See which agent sessions wrote a file, or what code traces back to the current session.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'provenance',
    title: '⌕ Provenance',
    pin: null,
    single: true,
    keys: 'window',
    windowLabel: 'Code provenance',
    services: ['session-navigation'],
    // The Web view reads its own routes; the TUI is handed the service.
    optionalServices: ['session', 'repository', 'provenance', 'notices'],
    placements: ['overlay', 'window'],
  }],
  commands: [{
    id: 'open-provenance',
    label: 'Code provenance — agent blame',
    category: 'View',
    opens: 'provenance',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    keywords: ['provenance', 'blame', 'who wrote', 'origin', 'trace', 'code', 'file', 'history', 'agent blame'],
  }],
} as const satisfies PluginManifest
