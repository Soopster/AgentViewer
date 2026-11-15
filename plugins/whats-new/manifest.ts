import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// What's new: the highlights of the repository's git history, revision by
// revision (a release per tag, otherwise a day per revision). Reading is a host
// service (`whats-new`): the TUI reads in process, the Web through /api/whats-new.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'whats-new',
  title: "What's new",
  description: "The highlights of the git history, release by release (or day by day), picked from the biggest changes and ready to copy.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'whats-new',
    title: "✦ What's new",
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: "What's new in a window",
    services: ['whats-new'],
    optionalServices: ['clipboard', 'composer', 'notices'],
    scrim: true,
  }],
  commands: [{
    id: 'whats-new',
    label: "What's new: highlights of the git history",
    category: 'Session',
    opens: 'whats-new',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    keywords: ['changelog', 'release', 'history', 'highlights', 'commits', 'revisions', 'updates'],
  }],
} as const satisfies PluginManifest
