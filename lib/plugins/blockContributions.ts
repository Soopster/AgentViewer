// Keeps the transcript block parsers (lib/blockRegistry.ts) in step with the
// enabled plugins that declare `blocks`. Threading runs in more than one place
// (the Web page, the TUI process and its transcript worker), and each knows its
// plugins differently, so this file takes a manifest supplier and imports no
// catalog: the TUI worker must not pay for every bundled manifest.
// See blockContributionsHost.ts (catalog-backed) and blockContributionsLocal.ts (mods only).
import { patternBlockParser, registerBlockParser } from '../blockRegistry'
import { isPluginEnabled } from './enablement'
import type { PluginBlockSpec, PluginManifest } from './types'

const registered = new Map<string, { spec: PluginBlockSpec; unregister: () => void }>()

/** Registers the parsers of exactly these manifests (and drops any registered earlier that they no longer declare). */
export function syncBlocksFrom(manifests: readonly PluginManifest[]): void {
  const wanted = new Map<string, { spec: PluginBlockSpec; pluginId: string }>()
  for (const manifest of manifests) {
    if (!manifest.blocks?.length || !isPluginEnabled(manifest.id)) continue
    for (const spec of manifest.blocks) wanted.set(`${manifest.id}.${spec.kind}`, { spec, pluginId: manifest.id })
  }
  for (const [id, entry] of registered) {
    if (!wanted.has(id)) { entry.unregister(); registered.delete(id) }
  }
  for (const [id, { spec, pluginId }] of wanted) {
    if (registered.get(id)?.spec === spec) continue
    registered.get(id)?.unregister()
    const parser = patternBlockParser(id, spec, pluginId)
    if (parser) registered.set(id, { spec, unregister: registerBlockParser(parser) })
  }
}
