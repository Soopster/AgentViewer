/**
 * Surface-panel state for the OpenTUI app — the terminal half of the web's
 * right-hand panel. Kinds, labels, shortcuts and descriptions are shared with
 * the web from `lib/rightPanel.ts` so the two never drift apart; only the
 * reducer lives here, because the TUI keeps this in React state rather than
 * localStorage.
 */

import {
  isMultiInstanceSurface,
  type RightPanelSurfaceKind,
} from '../../lib/rightPanel'

export type TuiSurface = {
  id: string
  kind: RightPanelSurfaceKind
}

export type SurfacePanelState = {
  surfaces: TuiSurface[]
  activeId: string | null
}

export const EMPTY_SURFACE_PANEL: SurfacePanelState = { surfaces: [], activeId: null }

let counter = 0

export function openSurface(state: SurfacePanelState, kind: RightPanelSurfaceKind): SurfacePanelState {
  // Singleton surfaces re-focus the one already open rather than mounting a
  // second copy of identical content.
  if (!isMultiInstanceSurface(kind)) {
    const existing = state.surfaces.find((surface) => surface.kind === kind)
    if (existing) return { ...state, activeId: existing.id }
  }
  counter += 1
  const surface: TuiSurface = { id: `${kind}:${counter}`, kind }
  return { surfaces: [...state.surfaces, surface], activeId: surface.id }
}

export function closeSurface(state: SurfacePanelState, id: string): SurfacePanelState {
  const index = state.surfaces.findIndex((surface) => surface.id === id)
  if (index === -1) return state
  const surfaces = state.surfaces.filter((surface) => surface.id !== id)
  // Fall back to the neighbour on the left, matching every other tab strip.
  const activeId = state.activeId === id ? surfaces[Math.max(0, index - 1)]?.id ?? null : state.activeId
  return { surfaces, activeId }
}

export function cycleSurface(state: SurfacePanelState, delta: number): SurfacePanelState {
  if (state.surfaces.length === 0) return state
  const index = Math.max(0, state.surfaces.findIndex((surface) => surface.id === state.activeId))
  const next = (index + delta + state.surfaces.length) % state.surfaces.length
  return { ...state, activeId: state.surfaces[next]?.id ?? state.activeId }
}

export function activeSurface(state: SurfacePanelState): TuiSurface | null {
  return state.surfaces.find((surface) => surface.id === state.activeId) ?? state.surfaces[0] ?? null
}
