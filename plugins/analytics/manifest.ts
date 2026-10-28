import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Per-session analytics: token, tool, timing and health views over one
// session's transcript. Domain computations stay in lib/analytics*.ts and
// lib/healthScore.ts, which both renderers' views share.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'analytics',
  title: 'Session analytics',
  description: "Token, tool, timing and health views over one session's transcript.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'analytics',
    title: '◔ Analytics',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Analytics in a window',
    services: ['session-transcript'],
  }],
  commands: [{
    id: 'analytics',
    label: 'Session analytics',
    category: 'Session',
    opens: 'analytics',
    requires: 'session',
    renderers: ['web', 'tui'],
    // Raw Ctrl+A is analytics; it must never be guessed to mean Ctrl+Shift+A on
    // terminals that cannot tell them apart.
    tuiKey: { name: 'a', ctrl: true },
    tuiKeyLabel: '⌃A',
    webToolbarLabel: 'Session stats',
    keywords: ['stats', 'tokens', 'cost', 'tools', 'health', 'timeline'],
  }],
} as const satisfies PluginManifest
