import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The terminal's View Studio: a panel for composing a transcript view from every
// choice a built-in view makes. The transcript behind it draws with the draft, so
// the host keeps the draft and the stored views; this plugin is the editing UI.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'view-studio',
  title: 'View Studio',
  description: 'Compose, edit and reset transcript views in the terminal, with a live specimen and the open conversation as the preview.',
  group: 'Interface',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'view-studio', title: '◫ View Studio', pin: null, single: true, windowLabel: 'View Studio',
    // It owns every key while open, as the editor does.
    keys: 'capture', placements: ['overlay'], services: ['view-studio'],
  }],
  commands: [],
  transcriptViews: [
    { id: 'nerd-font', name: 'Nerd Font', base: 'scrollback', overrides: { iconSet: 'nerd-font', tabStyle: 'pills' } },
    { id: 'powerline', name: 'Powerline', base: 'scrollback', overrides: { iconSet: 'powerline', tabStyle: 'powerline', tabAccent: 'active' } },
    // After Oh My Posh's segment families: atomic/bubbles, blue-owl, slimfat, nu4a.
    { id: 'diamond', name: 'Diamond', base: 'scrollback', overrides: { iconSet: 'diamond', tabStyle: 'bubbles', tabAccent: 'active' } },
    { id: 'slanted', name: 'Slanted', base: 'scrollback', overrides: { iconSet: 'slant', tabStyle: 'slant', tabAccent: 'active' } },
    { id: 'pixelated', name: 'Pixelated', base: 'scrollback', overrides: { iconSet: 'pixel', tabStyle: 'pixel', tabAccent: 'active' } },
    { id: 'flame', name: 'Flame', base: 'scrollback', overrides: { iconSet: 'flame', tabStyle: 'flame', tabAccent: 'active' } },
  ],
} as const satisfies PluginManifest
