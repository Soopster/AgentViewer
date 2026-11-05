// Providers as switchable plugins. A provider keeps its own contract
// (lib/extensions/providers/); this only gives each one a plugin-manager row
// and an id in the same enablement store, `provider:<id>`, so one file
// (.agent-viewer-data/plugins.json) and one manager cover features and providers.
// Browser-safe: metadata and the in-memory store only.
import { PROVIDER_IDS, getProviderManifest, type RegisteredProvider } from '../extensions/providers/catalog'
import { isPluginEnabled } from './enablement'

const PREFIX = 'provider:'

export type ProviderPlugin = {
  readonly id: string
  readonly providerId: RegisteredProvider
  readonly title: string
  readonly description: string
}

export function providerPluginId(provider: string): string {
  return `${PREFIX}${provider}`
}

export const PROVIDER_PLUGINS: readonly ProviderPlugin[] = PROVIDER_IDS.map(providerId => ({
  id: providerPluginId(providerId),
  providerId,
  title: getProviderManifest(providerId).displayName,
  description: `Sessions, new chats and teammates for ${getProviderManifest(providerId).displayName}.`,
}))

export function isProviderPluginId(id: string): boolean {
  return PROVIDER_PLUGINS.some(plugin => plugin.id === id)
}

export function isProviderEnabled(provider: string): boolean {
  return isPluginEnabled(providerPluginId(provider))
}

/** Settings that would leave no provider on are refused: the app would have nothing to open. */
export function wouldDisableEveryProvider(disabled: ReadonlySet<string>): boolean {
  return PROVIDER_PLUGINS.every(plugin => disabled.has(plugin.id))
}
