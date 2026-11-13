// The Web app's plugin view loaders. Each import() is a static specifier, so
// the bundler emits one chunk per plugin and loads it on first open.
import { createPluginViewRegistry } from '@/lib/plugins/activation'
import type { PluginServiceId } from '@/lib/plugins/types'
import type { WebPluginView } from './pluginTypes'

export const WEB_PLUGIN_SERVICES: readonly PluginServiceId[] = ['run-launch', 'playbooks', 'daily-summary', 'handoff', 'channel-bridge', 'ide-bridge', 'reader-slot', 'live-transcript', 'task-control', 'messaging', 'page-location', 'session', 'session-diagnostics', 'session-transcript', 'repository', 'composer', 'browser-location', 'session-pull-request', 'coordination']

export const webPluginViews = createPluginViewRegistry<WebPluginView>('web', {
  'session-alerts': async () => (await import('@/plugins/session-alerts/web')).module,
  'prompt-library': async () => (await import('@/plugins/prompt-library/web')).module,
  bridges: async () => (await import('@/plugins/bridges/web')).module,
  tasks: async () => (await import('@/plugins/tasks/web')).module,
  messaging: async () => (await import('@/plugins/messaging/web')).module,
  diagnostics: async () => (await import('@/plugins/diagnostics/web')).module,
  analytics: async () => (await import('@/plugins/analytics/web')).module,
  git: async () => (await import('@/plugins/git/web')).module,
  files: async () => (await import('@/plugins/files/web')).module,
  'pull-requests': async () => (await import('@/plugins/pull-requests/web')).module,
  terminal: async () => (await import('@/plugins/terminal/web')).module,
  browser: async () => (await import('@/plugins/browser/web')).module,
  coordination: async () => (await import('@/plugins/coordination/web')).module,
  github: async () => (await import('@/plugins/github/web')).module,
  recaps: async () => (await import('@/plugins/recaps/web')).module,
  'daily-summary': async () => (await import('@/plugins/daily-summary/web')).module,
  handoff: async () => (await import('@/plugins/handoff/web')).module,
}, WEB_PLUGIN_SERVICES)
