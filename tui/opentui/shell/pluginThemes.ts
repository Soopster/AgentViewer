// Keeps the terminal theme registry in step with the plugins that contribute
// a `tui` theme: registered while the plugin is enabled, removed when it is
// disabled, unloaded or stops declaring one. The Web's twin is
// lib/plugins/themeContributions.ts.
import { allPluginManifests, subscribeLocalPlugins } from '../../../lib/plugins/catalog'
import { isPluginEnabled, subscribePluginEnablement } from '../../../lib/plugins/enablement'
import type { PluginThemeSpec } from '../../../lib/plugins/types'
import { registerTuiPluginTheme } from '../app/themes'

const registered = new Map<string, () => void>()
const registeredSpecs = new Map<string, PluginThemeSpec>()
let installed = false

export function syncTuiPluginThemes(): void {
  const wanted = new Map<string, PluginThemeSpec & { tui: NonNullable<PluginThemeSpec['tui']> }>()
  for (const manifest of allPluginManifests()) {
    if (!manifest.themes || !isPluginEnabled(manifest.id)) continue
    for (const theme of manifest.themes) if (theme.tui) wanted.set(theme.id, theme as PluginThemeSpec & { tui: NonNullable<PluginThemeSpec['tui']> })
  }
  for (const [id, unregister] of registered) {
    if (!wanted.has(id)) { unregister(); registered.delete(id); registeredSpecs.delete(id) }
  }
  for (const [id, theme] of wanted) {
    if (registeredSpecs.get(id) === theme) continue
    registered.get(id)?.()
    try { registered.set(id, registerTuiPluginTheme({ id, label: theme.label, category: theme.category, ...theme.tui, ...(theme.tui.label ? { menuLabel: theme.tui.label } : {}) })); registeredSpecs.set(id, theme) }
    catch { registered.delete(id); registeredSpecs.delete(id) }
  }
}

/** Idempotent: call once at TUI boot. */
export function installTuiPluginThemes(): void {
  if (installed) return
  installed = true
  subscribeLocalPlugins(syncTuiPluginThemes)
  subscribePluginEnablement(syncTuiPluginThemes)
  syncTuiPluginThemes()
}
