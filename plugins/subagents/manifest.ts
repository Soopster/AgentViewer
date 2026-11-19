import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Subagent transcripts: the conversations a session's subagents had. The TUI
// opens one from the session rail; the Web lists a session's subagents and
// reads any of them. Each renderer's `subagent-transcript` service reads them.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'subagents', title: 'Subagent transcripts',
  description: 'Read captured subagent conversations from the session rail.', renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'subagents', title: '↪ Subagent transcript', pin: null, single: true, keys: 'window', placements: ['overlay'], windowLabel: 'Subagent transcript', services: ['subagent-transcript'], optionalServices: ['session'] }],
  commands: [{
    id: 'subagents',
    label: 'Subagent transcripts',
    category: 'Session',
    opens: 'subagents',
    requires: 'session',
    // The TUI opens a subagent from its rail row.
    renderers: ['web'],
    keywords: ['subagent', 'agent', 'task', 'spawned', 'child', 'transcript'],
  }],
} as const satisfies PluginManifest
