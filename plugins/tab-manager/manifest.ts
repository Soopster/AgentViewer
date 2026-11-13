import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Tab manager: pin tabs (kept first, protected from a stray close) and reorder
// them. The strip's ◆ mark, the pinned-first order, the close protection and the
// tab right-click items are host additions that check this plugin is on; the
// view is the list where all of it can be done from the keyboard.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'tab-manager',
  title: 'Tab manager',
  description: 'Pin tabs so they stay first and cannot be closed by accident, and reorder tabs from a list or the tab menu.',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'tab-manager',
    title: '◆ Tabs',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Pinned tabs and order in a window',
    services: ['session-fleet'],
  }],
  commands: [{
    id: 'tab-manager',
    label: 'Manage tabs (pin, reorder)',
    category: 'View',
    opens: 'tab-manager',
    requires: null,
    renderers: ['tui'],
    tuiChord: { key: 'm', short: 'tabs', label: 'Manage tabs (pin, reorder)', hint: false },
    tuiKeyLabel: '⌃K m',
    keywords: ['tabs', 'pin', 'reorder', 'move', 'close'],
  }],
} as const satisfies PluginManifest
