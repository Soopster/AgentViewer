import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Pairing phones and second browsers, and revoking them. Trust enforcement
// (proxy.ts, lib/remoteAuth.ts) is the host's and runs whether or not this
// view exists; turning the plugin off hides the controls, never the guard.
// Both renderers drive the running daemon's pairing (the TUI through the
// `remote-access` service); `agent-viewer pair` is the headless path.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'remote-access',
  title: 'Remote access',
  description: 'Pair a phone on your network to view and drive sessions, and revoke paired devices.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'remote-access',
    title: '⌁ Remote access',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay'],
    windowLabel: 'Remote access',
    services: [],
    // The Web view reads its own route; the TUI is handed the daemon client.
    optionalServices: ['remote-access', 'clipboard', 'notices'],
  }],
  commands: [{
    id: 'open-remote-access',
    label: 'Remote access',
    category: 'View',
    opens: 'remote-access',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    keywords: ['remote', 'mobile', 'phone', 'pair', 'pairing', 'qr', 'lan', 'network', 'settings'],
  }],
} as const satisfies PluginManifest
