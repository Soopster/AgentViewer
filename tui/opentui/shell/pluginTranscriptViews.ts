// Keeps the terminal's view registry in step with the plugins that contribute
// `transcriptViews`: offered while the plugin is enabled, withdrawn when it is
// disabled, unloaded or stops declaring them.
import { allPluginManifests, subscribeLocalPlugins } from '../../../lib/plugins/catalog'
import { isPluginEnabled, subscribePluginEnablement } from '../../../lib/plugins/enablement'
import { normalizePluginViews, setPluginViews } from '../../viewSpec'

const offered = new Set<string>()
let installed = false

export function syncTuiPluginTranscriptViews(): void {
  const current = new Set<string>()
  for (const manifest of allPluginManifests()) {
    if (!manifest.transcriptViews?.length || !isPluginEnabled(manifest.id)) continue
    current.add(manifest.id)
    setPluginViews(manifest.id, normalizePluginViews(manifest.id, manifest.transcriptViews))
  }
  for (const id of offered) if (!current.has(id)) setPluginViews(id, [])
  offered.clear()
  for (const id of current) offered.add(id)
}

/** Idempotent: call once at TUI boot. */
export function installTuiPluginTranscriptViews(): void {
  if (installed) return
  installed = true
  subscribeLocalPlugins(syncTuiPluginTranscriptViews)
  subscribePluginEnablement(syncTuiPluginTranscriptViews)
  syncTuiPluginTranscriptViews()
}
