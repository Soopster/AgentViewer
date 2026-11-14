import { getPluginSurface, listPluginCommands, type PluginSurfaceId, type ResolvedPluginCommand } from '../../../lib/plugins/catalog'
import { type PluginKeyChord, type PluginServiceId } from '../../../lib/plugins/types'

// Whether a plugin surface declares a service, required or optional.
export function pluginSurfaceWants(id: PluginSurfaceId, service: PluginServiceId): boolean {
  const surface = getPluginSurface(id)
  return surface.services.includes(service) || (surface.optionalServices?.includes(service) ?? false)
}
// Shifted chords first: a terminal that cannot report Shift sends ⌃⇧A as ⌃A,
// but one that can must reach ⌃⇧A's command, not ⌃A's.
export const TUI_KEYED_PLUGIN_COMMANDS = listPluginCommands('tui').filter((command): command is ResolvedPluginCommand & { tuiKey: PluginKeyChord } => Boolean(command.tuiKey))
  .sort((a, b) => Number(Boolean(b.tuiKey.shift)) - Number(Boolean(a.tuiKey.shift)))