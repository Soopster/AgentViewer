import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Code provenance ("git blame for agents"): which sessions wrote a file, and
// what the current session's edits became. The index and its routes are host
// services; the view opens a session at the edit through session-navigation.
// The TUI answers the same question per line from the editor (⌃A then why).
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'provenance',
  title: 'Code provenance',
  description: 'See which agent sessions wrote a file, or what code traces back to the current session.',
  renderers: ['web'],
  stateVersion: 1,
  surfaces: [{
    id: 'provenance',
    title: '⌕ Provenance',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay'],
    windowLabel: 'Code provenance',
    services: ['session-navigation'],
    optionalServices: ['session', 'repository'],
  }],
  commands: [{
    id: 'open-provenance',
    label: 'Code provenance — agent blame',
    category: 'View',
    opens: 'provenance',
    requires: null,
    scope: 'application',
    renderers: ['web'],
    keywords: ['provenance', 'blame', 'who wrote', 'origin', 'trace', 'code', 'file', 'history', 'agent blame'],
  }],
} as const satisfies PluginManifest
