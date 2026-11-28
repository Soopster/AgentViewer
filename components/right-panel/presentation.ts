import { surfaceKindLabel, type RightPanelSurface } from '@/lib/rightPanel'

export function panelSurfaceTitle(surface: RightPanelSurface): string {
  if (surface.kind !== 'browser') return surfaceKindLabel(surface.kind)
  if (!surface.url) return 'Browser'
  try { return new URL(surface.url).host || 'Browser' } catch { return 'Browser' }
}
