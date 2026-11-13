import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Daily summary: what every agent did today, yesterday or this week, grouped by
// repository, as the markdown it copies. Reading is a host service
// (`daily-summary`): the TUI reads in process, the Web through
// /api/daily-summary, and each host files its own attention inbox under the
// sessions it belongs to.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'daily-summary',
  title: 'Daily summary',
  description: 'What every agent did today, yesterday or this week, grouped by repository, ready to copy into a standup.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'daily-summary',
    title: '☰ Daily summary',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Daily summary in a window',
    services: ['daily-summary'],
    optionalServices: ['clipboard', 'composer', 'notices'],
    scrim: true,
  }],
  commands: [{
    id: 'daily-summary',
    label: 'Daily summary of agent work',
    category: 'Session',
    opens: 'daily-summary',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    tuiKeyLabel: '⌃K s',
    keywords: ['standup', 'summary', 'today', 'yesterday', 'week', 'report', 'status'],
  }],
} as const satisfies PluginManifest
