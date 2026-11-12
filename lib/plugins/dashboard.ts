import { PLUGIN_MANIFESTS, type PluginSurfaceId } from './catalog'
import type { PluginManifest } from './types'

type DashboardIds<M> = M extends { readonly dashboards: readonly { readonly id: infer Id }[] } ? Id : never
export type PluginDashboardId = DashboardIds<(typeof PLUGIN_MANIFESTS)[number]>

export function listPluginDashboards(manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS) {
  const ids = new Set(['sessions', 'agents'])
  return manifests.filter(manifest => manifest.renderers.includes('web')).flatMap(manifest => (manifest.dashboards ?? []).map(dashboard => {
    const command = manifest.commands.find(command => command.id === dashboard.command && command.renderers.includes('web'))
    if (ids.has(dashboard.id) || !dashboard.id.trim() || !manifest.surfaces.some(surface => surface.id === dashboard.surface && surface.placements.includes('window')) || !command || command.opens !== dashboard.surface || command.scope !== 'application' || command.requires !== null || command.webDashboard !== dashboard.id) throw new Error(`Invalid plugin dashboard: ${dashboard.id}`)
    ids.add(dashboard.id)
    return { ...dashboard, pluginId: manifest.id, surface: dashboard.surface as PluginSurfaceId }
  })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
}
export function isPluginDashboardId(value: string): value is PluginDashboardId {
  return listPluginDashboards().some(dashboard => dashboard.id === value)
}
