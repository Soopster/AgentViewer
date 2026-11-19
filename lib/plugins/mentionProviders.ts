// What a plugin offers in the composer's `@` menu. Files, agents and terminals
// are the host's; a plugin adds named things a person can mention (tickets,
// docs, environments): a mention inserts `@<insert> ` as plain text and carries
// no attachment, like a terminal handle, so what reaches the model is the text.
// Providers run on every keystroke while the menu is open: they are bounded.
import type { PluginManifest, PluginMentionSpec } from './types'
import { isPluginEnabled } from './enablement'

export type PluginMentionResult = { kind: 'plugin'; provider: string; name: string; detail?: string; insert: string }
export type MentionProvider = {
  /** Stable; a second registration with the same id replaces the first. */
  readonly id: string
  search(query: string): readonly PluginMentionResult[] | Promise<readonly PluginMentionResult[]>
}

export const MENTION_RESULTS_PER_PROVIDER = 8
const providers = new Map<string, MentionProvider>()

export function registerMentionProvider(provider: MentionProvider): () => void {
  providers.set(provider.id, provider)
  return () => { if (providers.get(provider.id) === provider) providers.delete(provider.id) }
}

const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max) : ''

/** Every provider's matches for the query, a failing provider contributing none. */
export async function searchMentionProviders(query: string): Promise<PluginMentionResult[]> {
  if (!providers.size) return []
  const settled = await Promise.all([...providers.values()].map(async (provider) => {
    try {
      return (await provider.search(query)).slice(0, MENTION_RESULTS_PER_PROVIDER).flatMap((entry): PluginMentionResult[] => {
        const name = clean(entry?.name, 60)
        const insert = clean(entry?.insert ?? entry?.name, 80).replace(/\s/g, '-')
        return name && insert ? [{ kind: 'plugin', provider: provider.id, name, ...(clean(entry.detail, 120) ? { detail: clean(entry.detail, 120) } : {}), insert }] : []
      })
    } catch { return [] }
  }))
  return settled.flat()
}

/** A declarative provider: a fixed list of items, matched by name (or detail) with the query as a substring. */
export function staticMentionProvider(id: string, spec: PluginMentionSpec): MentionProvider {
  return {
    id,
    search(query) {
      const needle = query.toLowerCase()
      return spec.items
        .filter(item => !needle || item.name.toLowerCase().includes(needle) || (item.detail?.toLowerCase().includes(needle) ?? false))
        .map(item => ({ kind: 'plugin' as const, provider: id, name: item.name, ...(item.detail ? { detail: item.detail } : {}), insert: item.insert ?? item.name }))
    },
  }
}

const declared = new Map<string, { spec: PluginMentionSpec; unregister: () => void }>()
/** Registers the declared `mentions` of exactly these manifests (enabled ones), dropping what they stopped declaring. */
export function syncMentionsFrom(manifests: readonly PluginManifest[]): void {
  const wanted = new Map<string, PluginMentionSpec>()
  for (const manifest of manifests) {
    if (!manifest.mentions?.length || !isPluginEnabled(manifest.id)) continue
    for (const spec of manifest.mentions) wanted.set(`${manifest.id}.${spec.id}`, spec)
  }
  for (const [id, entry] of declared) if (!wanted.has(id)) { entry.unregister(); declared.delete(id) }
  for (const [id, spec] of wanted) {
    if (declared.get(id)?.spec === spec) continue
    declared.get(id)?.unregister()
    declared.set(id, { spec, unregister: registerMentionProvider(staticMentionProvider(id, spec)) })
  }
}
