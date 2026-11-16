// The plugin manager groups its list under headings. A plugin may name its own
// (`group` in the manifest); bundled plugins that predate it are placed by id
// below, so adding a plugin without a group lands under "Other" rather than
// breaking anything. Browser-safe: metadata only.
import type { PluginManifest } from './types'
import type { ProviderPlugin } from './providerPlugins'
import { isLocalManifest } from './localManifest'

export const PLUGIN_CATEGORIES = ['Providers', 'Agents & coordination', 'Code & repository', 'Composer', 'Sessions & history', 'Interface', 'Themes', 'Local mods', 'Other'] as const
export type PluginCategory = typeof PLUGIN_CATEGORIES[number]

const BY_ID: Readonly<Record<string, PluginCategory>> = {
  coordination: 'Agents & coordination', handoff: 'Agents & coordination', messaging: 'Agents & coordination', bridges: 'Agents & coordination',
  schedules: 'Agents & coordination', 'chief-of-staff': 'Agents & coordination', subagents: 'Agents & coordination', 'run-dashboard': 'Agents & coordination',
  'workflow-packs': 'Agents & coordination', 'session-alerts': 'Agents & coordination', tasks: 'Agents & coordination', 'plan-review': 'Agents & coordination', proof: 'Agents & coordination',
  git: 'Code & repository', files: 'Code & repository', editor: 'Code & repository', 'pull-requests': 'Code & repository', github: 'Code & repository',
  checkpoints: 'Code & repository', 'file-history': 'Code & repository', provenance: 'Code & repository', terminal: 'Code & repository', browser: 'Code & repository', diagnostics: 'Code & repository',
  better: 'Composer', goals: 'Composer', tips: 'Composer', 'composer-context': 'Composer', 'composer-tools': 'Composer', 'prompt-library': 'Composer',
  'skill-picker': 'Composer', 'skills-manager': 'Composer', 'instructions-manager': 'Composer', 'project-memory': 'Composer', 'adaptive-ui': 'Composer',
  analytics: 'Sessions & history', 'session-insights': 'Sessions & history', 'daily-summary': 'Sessions & history', recaps: 'Sessions & history', bookmarks: 'Sessions & history',
  'tab-manager': 'Sessions & history', desk: 'Sessions & history', 'whats-new': 'Sessions & history', 'remote-access': 'Sessions & history', 'pi-activity': 'Sessions & history',
  toasts: 'Interface', 'dynamic-island': 'Interface', 'omni-bar': 'Interface', 'mod-views': 'Interface',
}

/** A plugin that only contributes themes is a theme pack, wherever it came from. */
function isThemePack(entry: PluginManifest): boolean {
  return Boolean(entry.themes?.length) && !entry.commands.length && !entry.surfaces.length && !entry.behavior && !entry.widgets?.length
}

export function pluginCategory(entry: PluginManifest | ProviderPlugin): PluginCategory {
  if (!('renderers' in entry)) return 'Providers'
  const named = PLUGIN_CATEGORIES.find(category => category === entry.group)
  if (named) return named
  if (isThemePack(entry)) return 'Themes'
  if (isLocalManifest(entry)) return 'Local mods'
  return BY_ID[entry.id] ?? 'Other'
}

export type PluginCategoryGroup<T> = { readonly category: PluginCategory; readonly entries: T[] }

/** Entries under their headings, in heading order; each heading keeps the order it was given. Empty headings are dropped. */
export function groupPluginEntries<T extends PluginManifest | ProviderPlugin>(entries: readonly T[]): PluginCategoryGroup<T>[] {
  const buckets = new Map<PluginCategory, T[]>()
  for (const entry of entries) {
    const category = pluginCategory(entry)
    const bucket = buckets.get(category)
    if (bucket) bucket.push(entry); else buckets.set(category, [entry])
  }
  return PLUGIN_CATEGORIES.flatMap(category => buckets.has(category) ? [{ category, entries: buckets.get(category)! }] : [])
}
