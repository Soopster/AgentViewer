import type { PluginManifest } from './types'
import type { ProviderPlugin } from './providerPlugins'
import { isLocalManifest } from './localManifest'

export const PLUGIN_ENABLEMENT_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'enabled', label: 'Enabled' },
  { id: 'disabled', label: 'Disabled' },
] as const
export type PluginEnablementFilter = typeof PLUGIN_ENABLEMENT_FILTERS[number]['id']
const NO_DISABLED: ReadonlySet<string> = new Set()

export function matchesPluginSearch(query: string, fields: readonly (string | undefined | null)[]): boolean {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  return tokens.every(token => text.includes(token))
}

/** Search metadata only; never activate a plugin to find it. */
export function filterPluginManagerEntries<T extends PluginManifest | ProviderPlugin>(entries: readonly T[], query: string, filter: PluginEnablementFilter = 'all', disabled: ReadonlySet<string> = NO_DISABLED): T[] {
  return entries.filter(entry => (filter === 'all' || disabled.has(entry.id) === (filter === 'disabled')) && matchesPluginSearch(query, [
    entry.id, entry.title, entry.description,
    ...('renderers' in entry ? [
      ...entry.renderers,
      isLocalManifest(entry) ? 'local mod' : 'bundled',
      ...entry.commands.flatMap(command => [command.id, command.label, ...(command.keywords ?? [])]),
    ] : ['provider', entry.providerId]),
  ])).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}
