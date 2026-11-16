import { getPluginSurface, listPluginCommands, type PluginSurfaceId, type ResolvedPluginCommand } from '../../../lib/plugins/catalog'
import { type PluginKeyChord, type PluginServiceId } from '../../../lib/plugins/types'

// Whether a plugin surface declares a service, required or optional.
export function pluginSurfaceWants(id: PluginSurfaceId, service: PluginServiceId): boolean {
  const surface = getPluginSurface(id)
  return surface.services.includes(service) || (surface.optionalServices?.includes(service) ?? false)
}
/** A composer-context key must be a ⌃ chord: a bare letter bound there would swallow typing. */
export function pluginKeyIsBindable(command: { tuiKey?: PluginKeyChord; tuiKeyContext?: string }): boolean {
  return command.tuiKeyContext !== 'composer' || Boolean(command.tuiKey?.ctrl || command.tuiKey?.meta)
}

export type PluginKeyContext = NonNullable<ResolvedPluginCommand['tuiKeyContext']>
/** Whether a plugin key bound for `context` is live in the current pane and mode. */
export function pluginKeyContextLive(context: PluginKeyContext | undefined, state: { composerActive: boolean; effectiveFocus: string }): boolean {
  switch (context) {
    case 'navigation': return !state.composerActive
    case 'rail': return !state.composerActive && state.effectiveFocus === 'sessions'
    case 'transcript': return !state.composerActive && state.effectiveFocus !== 'sessions'
    case 'composer': return state.composerActive
    default: return true
  }
}
// Shifted chords first: a terminal that cannot report Shift sends ⌃⇧A as ⌃A,
// but one that can must reach ⌃⇧A's command, not ⌃A's.
export const TUI_KEYED_PLUGIN_COMMANDS = listPluginCommands('tui').filter((command): command is ResolvedPluginCommand & { tuiKey: PluginKeyChord } => Boolean(command.tuiKey) && pluginKeyIsBindable(command))
  .sort((a, b) => Number(Boolean(b.tuiKey.shift)) - Number(Boolean(a.tuiKey.shift)))