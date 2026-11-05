import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Browser: open the page the agent is working on. The Web view frames it; a
// terminal cannot, so the TUI view hands the URL to a real browser.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'browser',
  title: 'Browser',
  description: 'Open a local dev server or any URL beside the transcript.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    // `browser` is the side-panel kind both hosts and saved layouts already use.
    id: 'browser',
    title: '◍ Browser',
    pin: null,
    single: false,
    // The address field takes typing; Escape and ⌃B stay the host's.
    keys: 'field',
    placements: ['window', 'panel'],
    windowLabel: 'Browser in a window',
    services: [],
    optionalServices: ['browser-location', 'composer'],
  }],
  commands: [],
} as const satisfies PluginManifest
