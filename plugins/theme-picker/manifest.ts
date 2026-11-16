import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The terminal's theme menu: grouped, searchable, previewing as you move and
// restoring on Escape. It reads and changes the theme through the `themes`
// service; the host owns where the choice is stored and the terminal-follow rule.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'theme-picker',
  title: 'Theme picker',
  description: 'Choose a terminal theme from a grouped, searchable list with a live preview.',
  group: 'Interface',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'theme-picker', title: '◐ Theme', pin: null, single: true, windowLabel: 'Theme picker',
    // Its search field and arrows are the menu's own, ahead of every global shortcut.
    keys: 'capture', placements: ['overlay'], services: ['themes'],
  }],
  commands: [],
} as const satisfies PluginManifest
