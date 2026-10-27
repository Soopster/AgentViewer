/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type WindowItem, type NoticeTone } from '../types'

export type WindowSurfaceFocusEffectContext = {
  pendingSurfaceFocusRef: React.RefObject<string | null>
  windowItems: WindowItem[]
  windowSurfaces: string[]
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
}

export function runWindowSurfaceFocusEffect(ctx: WindowSurfaceFocusEffectContext) {
  const {
    pendingSurfaceFocusRef, windowItems, windowSurfaces, setWindowSurfacePeek, setSplitFocusIndex,
    setSurfacePanelFocused, showNotice, setWindowZoom,
  } = ctx
  const pending = pendingSurfaceFocusRef.current
  if (!pending) return
  const index = windowItems.findIndex((item) => item.kind === 'surface' && item.surface === pending)
  if (index < 0) {
    if (!windowSurfaces.includes(pending)) return
    pendingSurfaceFocusRef.current = null
    setWindowSurfacePeek(pending)
    setSplitFocusIndex(-1)
    setSurfacePanelFocused(false)
    showNotice('info', 'Hidden window · Esc or ⌃B m restores the layout')
    return
  }
  pendingSurfaceFocusRef.current = null
  setWindowZoom(null)
  setSplitFocusIndex(index)
}
