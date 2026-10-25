// Which bundled feature plugins are turned off. Browser-safe: the Web client,
// the TUI root and the API route share this store; only where the choice is
// persisted differs (lib/plugins/settingsFile.ts on disk, /api/plugins on the web).
// No React here: the API route imports it; the hook is useDisabledPlugins.ts.
//
// A disabled plugin is not loaded: its commands are not offered or bound, and a
// surface left open in a window, panel or saved layout says it is off instead of
// activating. Disabling is a preference, not an uninstall, so an id that names
// no bundled plugin is kept — a build that drops a plugin and a later one that
// restores it must not lose the user's choice.
export const PLUGIN_SETTINGS_VERSION = 1

export type PluginSettings = { readonly version: typeof PLUGIN_SETTINGS_VERSION; readonly disabled: readonly string[] }

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = { version: PLUGIN_SETTINGS_VERSION, disabled: [] }

/** Anything malformed reads as the default: every plugin on. */
export function decodePluginSettings(value: unknown): PluginSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_PLUGIN_SETTINGS
  const { version, disabled } = value as { version?: unknown; disabled?: unknown }
  if (version !== PLUGIN_SETTINGS_VERSION || !Array.isArray(disabled)) return DEFAULT_PLUGIN_SETTINGS
  const ids = [...new Set(disabled.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64))].sort()
  return { version: PLUGIN_SETTINGS_VERSION, disabled: ids }
}

export function withPluginEnabled(settings: PluginSettings, id: string, enabled: boolean): PluginSettings {
  const disabled = new Set(settings.disabled)
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  return { version: PLUGIN_SETTINGS_VERSION, disabled: [...disabled].sort() }
}

let current: PluginSettings = DEFAULT_PLUGIN_SETTINGS
let disabledSet: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

export function applyPluginSettings(settings: PluginSettings): void {
  const next = decodePluginSettings(settings)
  if (next.disabled.join('\n') === current.disabled.join('\n')) return
  current = next
  disabledSet = new Set(next.disabled)
  for (const listener of [...listeners]) listener()
}

export function readPluginSettings(): PluginSettings {
  return current
}

export function isPluginEnabled(id: string): boolean {
  return !disabledSet.has(id)
}

export function subscribePluginEnablement(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The disabled set itself, for React's external-store hook (useDisabledPlugins.ts). */
export function readDisabledPlugins(): ReadonlySet<string> {
  return disabledSet
}
