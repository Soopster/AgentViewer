import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Files: browse a project's tree, preview a file, and hand a path to the
// composer or the editor.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'files',
  title: 'Files',
  description: 'Browse the project tree, preview files, and send a path to the composer or the editor.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    // `files` is the side-panel kind both hosts and saved layouts already use.
    id: 'files',
    title: '▤ Files',
    pin: 'cwd',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window', 'panel'],
    windowLabel: 'Files in a window',
    services: ['repository'],
    optionalServices: ['composer', 'open-file', 'directory-picker', 'scroll-preferences'],
    fullScreen: true,
  }],
  commands: [{
    id: 'files',
    label: 'Browse project files',
    category: 'Session',
    opens: 'files',
    requires: null,
    renderers: ['web', 'tui'],
    tuiKey: { name: 'f', ctrl: true },
    tuiKeyLabel: '⌃F',
    keywords: ['files', 'tree', 'browse', 'preview', 'explorer'],
  }],
} as const satisfies PluginManifest
