import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// What's new in Agent Viewer: the app's recent features and how to use each one,
// in the terminal and on the Web. The list is product copy kept in
// lib/featureGuide.ts, so the view needs no host service.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'feature-guide',
  title: "What's new in Agent Viewer",
  description: 'The latest Agent Viewer features, newest first, with how to use each one in the terminal and on the Web.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'feature-guide',
    title: "✦ What's new in Agent Viewer",
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: "What's new in Agent Viewer in a window",
    services: [],
    optionalServices: ['clipboard', 'notices'],
    scrim: true,
  }],
  commands: [{
    id: 'feature-guide',
    label: "What's new in Agent Viewer: latest features and how to use them",
    category: 'View',
    opens: 'feature-guide',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    keywords: ['whats new', 'features', 'release notes', 'changelog', 'help', 'guide', 'how to', 'tour', 'updates'],
  }],
} as const satisfies PluginManifest
