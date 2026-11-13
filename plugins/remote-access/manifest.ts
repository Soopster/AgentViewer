import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Pairing phones and second browsers, and revoking them. Trust enforcement
// (proxy.ts, lib/remoteAuth.ts) is the host's and runs whether or not this
// view exists; turning the plugin off hides the controls, never the guard.
// The TUI's headless path is `agent-viewer pair`.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'remote-access',
  title: 'Remote access',
  description: 'Pair a phone on your network to view and drive sessions, and revoke paired devices.',
  renderers: ['web'],
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
  }],
  commands: [{
    id: 'open-remote-access',
    label: 'Remote access',
    category: 'View',
    opens: 'remote-access',
    requires: null,
    scope: 'application',
    renderers: ['web'],
    keywords: ['remote', 'mobile', 'phone', 'pair', 'pairing', 'qr', 'lan', 'network', 'settings'],
  }],
} as const satisfies PluginManifest
