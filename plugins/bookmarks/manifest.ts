import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The cross-session bookmark browser. Marking a message is the reader's own
// (`b`, `[`/`]` and the transcript's markers stay core); this plugin lists every
// saved bookmark and opens one through the host's session navigation.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'bookmarks',
  title: 'Bookmarks',
  description: 'Browse every bookmarked message across sessions and providers, and jump to one.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'bookmarks',
    title: '★ Bookmarks',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Bookmarks in a window',
    services: ['bookmarks', 'session-navigation'],
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'bookmark-all',
    label: 'Browse all bookmarks',
    category: 'Transcript',
    opens: 'bookmarks',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    tuiKey: { name: 'b', shift: true },
    tuiKeyLabel: '⇧B',
    tuiKeyContext: 'navigation',
    keywords: ['bookmark', 'saved', 'star', 'messages'],
  }],
} as const satisfies PluginManifest
