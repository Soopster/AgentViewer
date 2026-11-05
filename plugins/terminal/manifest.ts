import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Terminal: long-running processes and their output, and interactive shells.
// The processes and shells themselves are host services (tui/opentui/
// processStore.ts, shellStore.ts): closing this view, or turning the plugin
// off, leaves every one of them running.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'terminal',
  title: 'Terminal',
  description: 'Run dev servers and watchers with their logs, and interactive shells, beside the transcript.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    // `terminal` is the side-panel kind both hosts and saved layouts already use.
    id: 'terminal',
    title: '❯ Terminal',
    // Where new commands run: a window keeps the directory it was opened on.
    pin: 'cwd',
    single: false,
    keys: 'window',
    placements: ['window', 'panel'],
    windowLabel: 'Shell and processes in a window',
    services: [],
    optionalServices: ['repository', 'composer', 'open-file', 'notices', 'window-selection'],
  }],
  commands: [{
    id: 'processes',
    label: 'Processes and logs (dev server, watchers)',
    category: 'Session',
    opens: 'terminal',
    placement: 'panel',
    requires: null,
    renderers: ['tui'],
    // Bound through the ⌃K chord table (shortcutKeys.ts), which dispatches this id.
    tuiKeyLabel: '⌃K l',
    keywords: ['terminal', 'shell', 'process', 'logs', 'dev server', 'watch'],
  }],
} as const satisfies PluginManifest
