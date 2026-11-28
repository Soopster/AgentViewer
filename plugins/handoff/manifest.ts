import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Handoff brief: a markdown note for whoever picks a session up next — what it
// was asked, what it changed, where the checkout stands and what is
// bookmarked. Built from the session's transcript plus the `handoff` service
// (git state, bookmarks), which each host reads its own way.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'handoff',
  title: 'Handoff brief',
  description: "A copyable brief of a session for whoever picks it up next: its goal, changes, checkout state and bookmarks.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    // The id predates the plugin: it is a window id in saved layouts.
    id: 'handoff',
    title: '⇢ Handoff brief',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Handoff brief in a window',
    services: ['session', 'session-transcript', 'handoff'],
    optionalServices: ['clipboard', 'notices'],
    scrim: true,
  }],
  commands: [{
    id: 'handoff-brief',
    label: 'Handoff brief',
    category: 'Session',
    opens: 'handoff',
    requires: 'session',
    renderers: ['web', 'tui'],
    tuiKey: { name: 'h', shift: true },
    tuiKeyLabel: '⇧H',
    tuiKeyContext: 'navigation',
    keywords: ['handoff', 'brief', 'summary', 'pick up', 'notes'],
  }],
} as const satisfies PluginManifest
