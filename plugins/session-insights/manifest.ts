import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Session insights: what a session did, read at a glance. One switch for the
// views and the transcript/rail additions that answer "what changed, how long
// did it take, did it work":
//   views (this manifest)  Files touched (provenance index), Tool timing, Index search
//   host additions         rail badges (linked PR, branch/working-tree on the selected row),
//                          scroll-track markers, the pinned task strip, the `<` `>` `#` `$`
//                          jump keys — each checks `isPluginEnabled('session-insights')`.
// Turning the plugin off in the plugin manager removes all of it.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'session-insights',
  title: 'Session insights',
  description: 'Files touched, tool timing and facet search, plus rail badges, scroll markers, a pinned task strip and jump keys.',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'changed-files',
    title: '± Files touched',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Files touched in a window',
    services: ['session-transcript'],
    optionalServices: ['open-file', 'notices', 'session'],
  }, {
    id: 'tool-timing',
    title: '⏱ Tool timing',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Tool timing in a window',
    services: ['session-transcript'],
  }, {
    id: 'index-search',
    title: '⌕ Index search',
    pin: null,
    single: true,
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'Index search in a window',
    services: ['session-fleet'],
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'changed-files',
    label: 'Files touched by this session',
    category: 'Session',
    opens: 'changed-files',
    requires: 'session',
    renderers: ['tui'],
    tuiChord: { key: 'f', short: 'files', label: 'Files touched by this session' },
    tuiKeyLabel: '⌃K f',
    keywords: ['files', 'changed', 'edited', 'diff', 'touched', 'turn', 'provenance'],
  }, {
    id: 'tool-timing',
    label: 'Tool timing by turn (waterfall)',
    category: 'Session',
    opens: 'tool-timing',
    requires: 'session',
    renderers: ['tui'],
    tuiChord: { key: 'p', short: 'time', label: 'Tool timing by turn', hint: false },
    tuiKeyLabel: '⌃K p',
    keywords: ['slow', 'duration', 'waterfall', 'profile', 'timing', 'bash'],
  }, {
    id: 'index-search',
    label: 'Search the session index (facets: provider, date, errors, file)',
    category: 'Session',
    opens: 'index-search',
    requires: null,
    renderers: ['tui'],
    tuiChord: { key: 'h', short: 'find', label: 'Search the session index' },
    tuiKeyLabel: '⌃K h',
    keywords: ['search', 'find', 'history', 'index', 'facet', 'error', 'file'],
  }],
} as const satisfies PluginManifest
