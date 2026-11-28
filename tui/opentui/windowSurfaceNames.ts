import { getPluginSurface, isPluginPanelSurfaceId } from '../../lib/plugins/catalog'
import { RIGHT_PANEL_SURFACE_KINDS, surfaceKindLabel, type RightPanelSurfaceKind } from '../../lib/rightPanel'
import { POPOVER_WINDOWS, type PopoverWindowKind } from './popoverWindows'

export type WindowSurfaceKind = RightPanelSurfaceKind | PopoverWindowKind
export const WINDOW_SURFACE_TITLES: Record<WindowSurfaceKind, string> = {
  // A plugin's panel surface is titled by its own manifest (windowTitle, else title); only the host's Agents panel is named here.
  ...Object.fromEntries(RIGHT_PANEL_SURFACE_KINDS.map(kind => [kind, isPluginPanelSurfaceId(kind) ? (getPluginSurface(kind).windowTitle ?? getPluginSurface(kind).title) : surfaceKindLabel(kind)])) as Record<RightPanelSurfaceKind, string>,
  agents: '◆ Agents',
  ...Object.fromEntries(Object.entries(POPOVER_WINDOWS).map(([kind, spec]) => [kind, spec.title])) as Record<PopoverWindowKind, string>,
}
export const surfaceKindOf = (id: string): WindowSurfaceKind => id.split('#')[0] as WindowSurfaceKind
export function surfaceTitle(id: string): string {
  const instance = id.split('#')[1]
  return `${WINDOW_SURFACE_TITLES[surfaceKindOf(id)] ?? id}${instance ? ` ${instance}` : ''}`
}
