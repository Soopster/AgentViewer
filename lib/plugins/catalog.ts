// The bundled feature plugins' manifests: metadata only, safe in Web clients,
// the TUI root and workers. Adding a plugin adds one line here and one line in
// each renderer's loader list (components/shell/pluginViews.ts,
// tui/opentui/shell/pluginViews.ts); no root, palette or window-kind union
// changes.
import { manifest as analytics } from '../../plugins/analytics/manifest'
import type { PluginCommandSpec, PluginManifest, PluginRenderer, PluginSurfaceSpec } from './types'

export const PLUGIN_MANIFESTS = [analytics] as const satisfies readonly PluginManifest[]

type BundledManifest = (typeof PLUGIN_MANIFESTS)[number]
export type PluginId = BundledManifest['id']
export type PluginSurfaceId = BundledManifest['surfaces'][number]['id']
export type PluginCommandId = BundledManifest['commands'][number]['id']

export type ResolvedPluginSurface = PluginSurfaceSpec & { readonly pluginId: PluginId; readonly stateVersion: number }
export type ResolvedPluginCommand = PluginCommandSpec & { readonly pluginId: PluginId }

const surfaces = new Map<string, ResolvedPluginSurface>()
const commands = new Map<string, ResolvedPluginCommand>()
for (const manifest of PLUGIN_MANIFESTS as readonly PluginManifest[]) {
  for (const surface of manifest.surfaces) {
    if (surfaces.has(surface.id)) throw new Error(`Duplicate plugin surface id: ${surface.id}`)
    surfaces.set(surface.id, { ...surface, pluginId: manifest.id as PluginId, stateVersion: manifest.stateVersion })
  }
  for (const command of manifest.commands) {
    if (commands.has(command.id)) throw new Error(`Duplicate plugin command id: ${command.id}`)
    if (!manifest.surfaces.some(surface => surface.id === command.opens)) throw new Error(`Plugin command ${command.id} opens an undeclared surface: ${command.opens}`)
    commands.set(command.id, { ...command, pluginId: manifest.id as PluginId })
  }
}

export function isPluginSurfaceId(id: string): id is PluginSurfaceId {
  return surfaces.has(id)
}

export function getPluginSurface(id: PluginSurfaceId): ResolvedPluginSurface {
  return surfaces.get(id)!
}

export function listPluginSurfaces(renderer: PluginRenderer): ResolvedPluginSurface[] {
  return [...surfaces.values()].filter(surface => PLUGIN_MANIFESTS.find(m => m.id === surface.pluginId)!.renderers.includes(renderer as never))
}

export function getPluginCommand(id: string): ResolvedPluginCommand | undefined {
  return commands.get(id)
}

export function listPluginCommands(renderer: PluginRenderer): ResolvedPluginCommand[] {
  return [...commands.values()].filter(command => command.renderers.includes(renderer))
}
