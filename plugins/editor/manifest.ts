import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The project editor: buffers, language servers, search and syntax
// highlighting for the working tree. Buffers are a singleton, so the editor
// exists once — as an overlay or as a window, never both.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'editor',
  title: 'Editor',
  description: 'Edit project files with buffers, language servers, search and highlighting.',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'editor',
    title: '✎ Editor',
    pin: null,
    single: true,
    // Its letters belong to the buffer: every key but the ⌃B prefix.
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'Editor in a window',
    services: ['repository'],
    optionalServices: ['clipboard', 'composer', 'notices', 'file-history'],
    fullScreen: true,
  }],
  commands: [{
    id: 'editor',
    label: 'Open project editor',
    category: 'Session',
    opens: 'editor',
    requires: null,
    renderers: ['tui'],
    tuiKey: { name: 'e', ctrl: true },
    tuiKeyLabel: '⌃E',
    keywords: ['edit', 'code', 'buffer', 'lsp', 'files'],
  }],
} as const satisfies PluginManifest
