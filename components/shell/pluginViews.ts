// The Web app's plugin view loaders. Each import() is a static specifier, so
// the bundler emits one chunk per plugin and loads it on first open.
import { createPluginViewRegistry } from '@/lib/plugins/activation'
import type { PluginServiceId } from '@/lib/plugins/types'
import type { WebPluginView } from './pluginTypes'

export const WEB_PLUGIN_SERVICES: readonly PluginServiceId[] = ['instructions-manager', 'project-memory', 'skills-manager', 'adaptive-ui', 'plan-review', 'proof', 'notifications', 'run-launch', 'playbooks', 'daily-summary', 'whats-new', 'handoff', 'checkpoints', 'session-insights', 'subagent-transcript', 'session-tabs', 'shell-overview', 'bookmarks', 'schedules', 'chief-of-staff', 'session-navigation', 'activity-control', 'session-fleet', 'channel-bridge', 'ide-bridge', 'reader-slot', 'live-transcript', 'task-control', 'messaging', 'page-location', 'session', 'session-diagnostics', 'session-transcript', 'repository', 'composer', 'browser-location', 'session-pull-request', 'coordination']

export const webPluginViews = createPluginViewRegistry<WebPluginView>('web', {
  'session-alerts': async () => (await import('@/plugins/session-alerts/web')).module,
  'dynamic-island': async () => (await import('../../plugins/dynamic-island/web')).module,
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
  'whats-new': async () => (await import('@/plugins/whats-new/web')).module,
  handoff: async () => (await import('@/plugins/handoff/web')).module,
  bookmarks: async () => (await import('@/plugins/bookmarks/web')).module,
  schedules: async () => (await import('@/plugins/schedules/web')).module,
  'chief-of-staff': async () => (await import('@/plugins/chief-of-staff/web')).module,
  'skill-picker': async () => (await import('@/plugins/skill-picker/web')).module,
  provenance: async () => (await import('@/plugins/provenance/web')).module,
  'run-dashboard': async () => (await import('@/plugins/run-dashboard/web')).module,
  'mod-views': async () => (await import('@/plugins/mod-views/web')).module,
  'instructions-manager': async () => (await import('../../plugins/instructions-manager/web')).module,
  'project-memory': async () => (await import('../../plugins/project-memory/web')).module,
  'workflow-packs': async () => (await import('../../plugins/workflow-packs/web')).module,
  'skills-manager': async () => (await import('../../plugins/skills-manager/web')).module,
  'adaptive-ui': async () => (await import('../../plugins/adaptive-ui/web')).module,
  'plan-review': async () => (await import('../../plugins/plan-review/web')).module,
  proof: async () => (await import('../../plugins/proof/web')).module,
  checkpoints: async () => (await import('@/plugins/checkpoints/web')).module,
  'file-history': async () => (await import('@/plugins/file-history/web')).module,
  'session-insights': async () => (await import('@/plugins/session-insights/web')).module,
  subagents: async () => (await import('@/plugins/subagents/web')).module,
  'tab-manager': async () => (await import('@/plugins/tab-manager/web')).module,
  desk: async () => (await import('@/plugins/desk/web')).module,
  editor: async () => (await import('@/plugins/editor/web')).module,
  'omni-bar': async () => (await import('@/plugins/omni-bar/web')).module,
  'remote-access': async () => (await import('@/plugins/remote-access/web')).module,
}, WEB_PLUGIN_SERVICES, undefined,
// A mod's views are its surfaces, drawn by the Mod views renderer pinned to each.
async (manifest) => (await import('@/plugins/mod-views/web')).modViewSurfaces(manifest))
