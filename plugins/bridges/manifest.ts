import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The live CLI channel and IDE bridge presentations and routing commands.
// Long-lived transports and the composer's routing binding stay in the host,
// so an existing routed connection keeps working with this plugin off; the panels' services are offered only while a
// Claude session can use a bridge, and their commands say why otherwise.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'bridges',
  title: 'Bridge panels',
  description: 'The live CLI channel bridge and IDE bridge panels: activity, approvals and messages.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'channel-bridge',
    title: '⇄ CLI bridge',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Live CLI bridge in a window',
    services: ['session', 'channel-bridge'],
    optionalServices: ['notices', 'composer'],
  }, {
    id: 'ide-bridge',
    title: '⌨ IDE bridge',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'IDE bridge in a window',
    services: ['ide-bridge'],
    optionalServices: ['notices', 'composer'],
  }],
  commands: [{
    id: 'channel-bridge',
    label: 'Channel bridge',
    category: 'Session',
    opens: 'channel-bridge',
    requires: 'session', providers: ['claude'],
    renderers: ['tui'],
    tuiKey: { name: 'c', shift: true },
    tuiKeyLabel: '⇧C',
    keywords: ['bridge', 'channel', 'cli', 'claude', 'live'],
  }, {
    id: 'ide-bridge',
    label: 'IDE bridge',
    category: 'Session',
    opens: 'ide-bridge',
    requires: 'session', providers: ['claude'],
    renderers: ['tui'],
    tuiKey: { name: 'i', shift: true },
    tuiKeyLabel: '⇧I',
    keywords: ['bridge', 'ide', 'diff', 'mention', 'claude'],
  }, {
    id: 'open-channel-bridge', label: 'Open channel bridge', category: 'Session',
    opens: 'channel-bridge', requires: 'session', providers: ['claude'], scope: 'session', renderers: ['web'],
    webComposerLabel: 'CLI bridge', webComposerGlyph: '⇄',
    keywords: ['bridge', 'channel', 'cli', 'claude', 'live'],
  }, {
    id: 'open-ide-bridge', label: 'Open IDE bridge', category: 'Session',
    opens: 'ide-bridge', requires: 'session', providers: ['claude'], scope: 'session', renderers: ['web'],
    webComposerLabel: 'IDE bridge', webComposerGlyph: '⌨',
    keywords: ['bridge', 'ide', 'diff', 'mention', 'claude'],
  }, {
    id: 'toggle-channel-bridge-route', label: 'Toggle composer route through CLI bridge', category: 'Session',
    handler: 'toggle-channel-route', scope: 'session', requires: 'session', providers: ['claude'], renderers: ['web', 'tui'], services: ['bridge-routing'],
    keywords: ['route', 'bridge', 'channel', 'cli', 'claude'],
  }, {
    id: 'toggle-ide-bridge-route', label: 'Toggle composer route through IDE bridge', category: 'Session',
    handler: 'toggle-ide-route', scope: 'session', requires: 'session', providers: ['claude'], renderers: ['web', 'tui'], services: ['bridge-routing'],
    keywords: ['route', 'bridge', 'ide', 'claude'],
  }],
} as const satisfies PluginManifest
