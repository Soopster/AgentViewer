import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'subagents', title: 'Subagent transcripts',
  description: 'Read captured subagent conversations from the session rail.', renderers: ['tui'], stateVersion: 1,
  surfaces: [{ id: 'subagents', title: '↪ Subagent transcript', pin: null, single: true, keys: 'window', placements: ['overlay'], windowLabel: 'Subagent transcript', services: ['subagent-transcript'] }],
  commands: [],
} as const satisfies PluginManifest
