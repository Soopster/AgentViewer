import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Open in IDE: every place that opens a file (transcript links, tool-card paths,
// the Engineering view, Files, changed files, Second Opinion) hands it to the
// person's own editor at the line, when they have chosen one. Off, or with the
// built-in editor chosen, files open where they always did.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'open-in-ide',
  title: 'Open in IDE',
  description: 'Open files from transcripts, diffs and panels in VS Code, Cursor, Zed, JetBrains, Sublime or $EDITOR, at the line.',
  renderers: ['web', 'tui'],
  application: { events: ['sessionActivity'], services: ['notifications', 'ide'] },
  stateVersion: 1,
  surfaces: [{
    id: 'open-in-ide',
    title: '↗ Open files in',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay'],
    windowLabel: 'Editor choice in a window',
    services: ['open-in-ide'],
    optionalServices: [],
  }],
  commands: [{
    id: 'open-in-ide',
    label: 'Open files in… — choose your IDE',
    category: 'View',
    opens: 'open-in-ide',
    scope: 'application',
    requires: null,
    renderers: ['web', 'tui'],
    keywords: ['ide', 'editor', 'vscode', 'vs code', 'cursor', 'zed', 'jetbrains', 'intellij', 'webstorm', 'sublime', 'open file', 'external editor'],
  }],
} as const satisfies PluginManifest
