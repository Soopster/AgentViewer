// Server-only registration list. Metadata consumers must never import this file.
import { PLUGIN_MANIFESTS } from './catalog'
import { createPluginBehaviorHost } from './behaviorHost'
import { applyPluginSettings } from './enablement'
import { readPluginSettingsFile } from './settingsFile'
import type { PluginBeforeTurnContext } from './behavior'

const host = createPluginBehaviorHost(PLUGIN_MANIFESTS, {
  'composer-context': async () => (await import('../../plugins/composer-context/server')).behavior,
})

export async function applyPluginBeforeTurn(context: PluginBeforeTurnContext): Promise<Record<string, unknown>> {
  // Catch changes from another Web/TUI process before activating anything.
  applyPluginSettings(readPluginSettingsFile())
  return host.beforeTurn(context)
}
