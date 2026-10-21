import type { RightPanelSurfaceKind } from '../../lib/rightPanel'
import { POPOVER_WINDOWS, type PopoverWindowKind } from './popoverWindows'

export type WindowSurfaceKind = RightPanelSurfaceKind | PopoverWindowKind
export const WINDOW_SURFACE_TITLES: Record<WindowSurfaceKind, string> = {
  terminal: '❯ Terminal', diff: '± Diff', files: '▤ Files', browser: '◍ Browser', 'pull-request': '⑂ Pull request', agents: '◆ Agents',
  ...Object.fromEntries(Object.entries(POPOVER_WINDOWS).map(([kind, spec]) => [kind, spec.title])) as Record<PopoverWindowKind, string>,
}
export const surfaceKindOf = (id: string): WindowSurfaceKind => id.split('#')[0] as WindowSurfaceKind
export function surfaceTitle(id: string): string {
  const instance = id.split('#')[1]
  return `${WINDOW_SURFACE_TITLES[surfaceKindOf(id)] ?? id}${instance ? ` ${instance}` : ''}`
}
