'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  EMPTY_RIGHT_PANEL_STATE,
  RIGHT_PANEL_STORAGE_KEY,
  isMultiInstanceSurface,
  nextSurfaceId,
  parseRightPanelState,
  type RightPanelState,
  type RightPanelSurfaceKind,
} from '@/lib/rightPanel'

/**
 * Owns the right panel's open surfaces, active tab and width.
 *
 * State is restored from localStorage after mount rather than during the
 * initial render: the server renders the panel closed, so reading storage in a
 * `useState` initialiser would produce a hydration mismatch on every reload
 * where the panel was left open.
 */
export function useRightPanel() {
  const [state, setState] = useState<RightPanelState>(EMPTY_RIGHT_PANEL_STATE)
  const hydrated = useRef(false)

  useEffect(() => {
    setState(parseRightPanelState(window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY)))
    hydrated.current = true
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    try {
      window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Private-mode / quota failures are not worth interrupting the UI for.
    }
  }, [state])

  const openSurface = useCallback((kind: RightPanelSurfaceKind) => {
    setState((current) => {
      // Singleton surfaces re-focus the one that is already open rather than
      // mounting a second copy of identical content.
      const existing = isMultiInstanceSurface(kind) ? null : current.surfaces.find((s) => s.kind === kind)
      if (existing) return { ...current, open: true, activeId: existing.id }
      const surface = { id: nextSurfaceId(kind), kind }
      return { ...current, open: true, surfaces: [...current.surfaces, surface], activeId: surface.id }
    })
  }, [])

  const close = useCallback((id: string) => {
    setState((current) => {
      const index = current.surfaces.findIndex((surface) => surface.id === id)
      if (index === -1) return current
      const surfaces = current.surfaces.filter((surface) => surface.id !== id)
      const activeId = current.activeId === id
        // Fall back to the neighbour on the left, matching every other tab strip.
        ? surfaces[Math.max(0, index - 1)]?.id ?? null
        : current.activeId
      return { ...current, surfaces, activeId }
    })
  }, [])

  const setBrowserUrl = useCallback((id: string, url: string) => {
    setState((current) => ({
      ...current,
      surfaces: current.surfaces.map((surface) => (surface.id === id ? { ...surface, url } : surface)),
    }))
  }, [])

  const actions = useMemo(() => ({
    openSurface,
    close,
    setBrowserUrl,
    toggle: () => setState((current) => ({ ...current, open: !current.open })),
    collapse: () => setState((current) => ({ ...current, open: false })),
    toggleExpanded: () => setState((current) => ({ ...current, expanded: !current.expanded })),
    expand: () => setState((current) => ({ ...current, open: true })),
    activate: (id: string) => setState((current) => ({ ...current, activeId: id })),
    closeAll: () => setState((current) => ({ ...current, surfaces: [], activeId: null })),
    setWidth: (width: number) => setState((current) => (current.width === width ? current : { ...current, width })),
  }), [close, openSurface, setBrowserUrl])

  return { ...state, ...actions }
}

export type UseRightPanel = ReturnType<typeof useRightPanel>
