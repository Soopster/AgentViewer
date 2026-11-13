// The TUI's plugin view loaders. Static specifiers so Bun can resolve each
// one; nothing here is evaluated until a surface is first shown.
import { createPluginViewRegistry } from '../../../lib/plugins/activation'
import type { PluginServiceId } from '../../../lib/plugins/types'
import type { TuiPluginView } from './pluginTypes'

export const TUI_PLUGIN_SERVICES: readonly PluginServiceId[] = ['run-launch', 'playbooks', 'daily-summary', 'subagent-transcript', 'session-transcript', 'repository', 'composer', 'clipboard', 'open-file', 'directory-picker', 'scroll-preferences', 'notices', 'file-history', 'session', 'live-transcript', 'task-control', 'session-diagnostics', 'messaging', 'channel-bridge', 'ide-bridge', 'browser-location', 'window-selection', 'coordination', 'session-fleet', 'themes']

export const tuiPluginViews = createPluginViewRegistry<TuiPluginView>('tui', {
  'prompt-library': async () => (await import('../../../plugins/prompt-library/tui')).module,
  subagents: async () => (await import('../../../plugins/subagents/tui')).module,
  analytics: async () => (await import('../../../plugins/analytics/tui')).module,
  git: async () => (await import('../../../plugins/git/tui')).module,
  files: async () => (await import('../../../plugins/files/tui')).module,
  editor: async () => (await import('../../../plugins/editor/tui')).module,
  'pull-requests': async () => (await import('../../../plugins/pull-requests/tui')).module,
  checkpoints: async () => (await import('../../../plugins/checkpoints/tui')).module,
  'file-history': async () => (await import('../../../plugins/file-history/tui')).module,
  messaging: async () => (await import('../../../plugins/messaging/tui')).module,
  tasks: async () => (await import('../../../plugins/tasks/tui')).module,
  bridges: async () => (await import('../../../plugins/bridges/tui')).module,
  diagnostics: async () => (await import('../../../plugins/diagnostics/tui')).module,
  terminal: async () => (await import('../../../plugins/terminal/tui')).module,
  browser: async () => (await import('../../../plugins/browser/tui')).module,
  coordination: async () => (await import('../../../plugins/coordination/tui')).module,
  desk: async () => (await import('../../../plugins/desk/tui')).module,
  github: async () => (await import('../../../plugins/github/tui')).module,
  'session-insights': async () => (await import('../../../plugins/session-insights/tui')).module,
  'tab-manager': async () => (await import('../../../plugins/tab-manager/tui')).module,
  'session-alerts': async () => (await import('../../../plugins/session-alerts/tui')).module,
  recaps: async () => (await import('../../../plugins/recaps/tui')).module,
  'daily-summary': async () => (await import('../../../plugins/daily-summary/tui')).module,
}, TUI_PLUGIN_SERVICES)
