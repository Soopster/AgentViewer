// Keeps the Web theme registry (lib/themes.ts) in step with the plugins that
// contribute themes: bundled or local, registered while enabled, removed when
// the plugin is disabled, unloaded or stops declaring one. The terminal's twin
// is tui/opentui/shell/pluginThemes.ts.
import { registerTheme } from '../themes'
import { allPluginManifests, PLUGIN_MANIFESTS, subscribeLocalPlugins } from './catalog'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { isLocalManifest } from './localManifest'
import type { PluginManifest, PluginThemeSpec } from './types'

type WebTheme = PluginThemeSpec & { css: string }
const registered = new Map<string, { spec: WebTheme; trusted: boolean; unregister: () => void }>()
let installed = false

/** Every bundled theme that has Web CSS, regardless of enablement: the server renders these before first paint. */
export function bundledWebThemes(): readonly WebTheme[] {
  return (PLUGIN_MANIFESTS as readonly PluginManifest[]).flatMap(manifest => (manifest.themes ?? []).filter((theme): theme is WebTheme => Boolean(theme.css)))
}

/** Web: registers each enabled plugin's `css` themes into lib/themes.ts. Only what changed is touched. */
export function syncPluginThemes(): void {
  const wanted = new Map<string, { spec: WebTheme; trusted: boolean }>()
  for (const manifest of allPluginManifests()) {
    if (!manifest.themes || !isPluginEnabled(manifest.id)) continue
    for (const theme of manifest.themes) if (theme.css) wanted.set(theme.id, { spec: theme as WebTheme, trusted: !isLocalManifest(manifest) })
  }
  for (const [id, entry] of registered) {
    if (!wanted.has(id)) { entry.unregister(); registered.delete(id) }
  }
  for (const [id, { spec, trusted }] of wanted) {
    if (registered.get(id)?.spec === spec) continue
    try {
      const unregister = registerTheme({ id, label: spec.label, category: spec.category, icon: spec.icon ?? '◆', css: spec.css, ...(trusted && spec.rules ? { rules: spec.rules, trusted } : {}) })
      registered.set(id, { spec, trusted, unregister })
    } catch {
      // A refused theme (built-in id, unsafe css) is skipped; the plugin's other contributions still load.
    }
  }
}

/** Idempotent: call once per renderer at boot. */
export function installPluginThemes(): void {
  if (installed) return
  installed = true
  subscribeLocalPlugins(syncPluginThemes)
  subscribePluginEnablement(syncPluginThemes)
  syncPluginThemes()
}
