import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Session diagnostics (⇧D, /mcp, /hooks, /permissions, /status): what a
// session's runtime reports about itself, and its MCP/hook/reload controls.
// It reads once per open, never as the selection moves: a read can activate a
// session (Copilot), so following the selection would do that per keystroke.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'diagnostics',
  title: 'Session diagnostics',
  description: "A session's runtime status, context, permission rules, hooks and MCP servers, with their controls.",
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'diagnostics',
    title: '⚕ Diagnostics',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Diagnostics in a window',
    services: ['session', 'session-diagnostics'],
    optionalServices: ['composer'],
  }],
  commands: [{
    id: 'diagnostics',
    label: 'Session diagnostics',
    category: 'Session',
    opens: 'diagnostics',
    requires: 'session',
    renderers: ['tui'],
    tuiKey: { name: 'd', shift: true },
    tuiKeyLabel: '⇧D',
    keywords: ['diagnostics', 'mcp', 'hooks', 'permissions', 'status', 'context'],
  }],
} as const satisfies PluginManifest
