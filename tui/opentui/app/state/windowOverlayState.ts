/** @jsxImportSource @opentui/react */
import React, { useRef, useState } from 'react'
import { type SurfaceMeta } from '../../popoverWindows'
import { useWorkspaceState } from '../../workspaceContext'
import { type WindowAttention } from '../../windowAttention'
import { type SavedWindowLayout } from '../../windowLayoutStore'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export function useWindowOverlayState() {
  const [windowPickerOpen, setWindowPickerOpen] = useState(false)
  const [windowSwitcherOpen, setWindowSwitcherOpen] = useState(false)
  const [overviewPendingTarget, setOverviewPendingTarget] = useWorkspaceState<string | null>('windowOverviewPendingTarget', null, false)
  const [windowBroadcastOpen, setWindowBroadcastOpen] = useState(false)
  const [windowSurfacePeek, setWindowSurfacePeek] = useState<WindowSurfaceId | null>(null)
  const windowSwitcherKeyRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  const windowBroadcastKeyRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  const windowLayoutRestoreRequestRef = useRef(0)
  const [windowLayoutPreview, setWindowLayoutPreview] = useState<string | null>(null)
  const [windowAttention, setWindowAttention] = useWorkspaceState<Map<string, WindowAttention>>('windowAttention', () => new Map())
  const windowObservedFocusRef = useRef<string | null>(null)
  // This project's saved layouts, read when the menu opens.
  const [savedWindowLayouts, setSavedWindowLayouts] = useState<SavedWindowLayout[]>([])
  // Surfaces (a shell, the diff, files) open as windows in the layout, after
  // the session panes. A kind lives in one place: here or in the side panel,
  // because both would hand the same key-handler refs to two mounted views.
  const [windowSurfaces, setWindowSurfaces] = useWorkspaceState<WindowSurfaceId[]>('windowSurfaces', [])
  // What each popover window is pinned to (popoverWindows.ts), by window id.
  const [windowSurfaceMeta, setWindowSurfaceMeta] = useWorkspaceState<Record<WindowSurfaceId, SurfaceMeta>>('windowSurfaceMeta', {})
  // Popovers opened as tabs of this workspace's tab strip ("Fill this tab"), by
  // surface id, and the one shown in the reader's place (null: the reader).
  const [popoverTabs, setPopoverTabs] = useWorkspaceState<WindowSurfaceId[]>('popoverTabs', [])
  const popoverTabFrameRef = useRef<(() => React.ReactNode) | null>(null)
  const [activePopoverTab, setActivePopoverTab] = useWorkspaceState<WindowSurfaceId | null>('activePopoverTab', null)

  return {
    windowPickerOpen, setWindowPickerOpen, windowSwitcherOpen, setWindowSwitcherOpen,
    overviewPendingTarget, setOverviewPendingTarget, windowBroadcastOpen, setWindowBroadcastOpen,
    windowSurfacePeek, setWindowSurfacePeek, windowSwitcherKeyRef, windowBroadcastKeyRef,
    windowLayoutRestoreRequestRef, windowLayoutPreview, setWindowLayoutPreview, windowAttention,
    setWindowAttention, windowObservedFocusRef, savedWindowLayouts, setSavedWindowLayouts,
    windowSurfaces, setWindowSurfaces, windowSurfaceMeta, setWindowSurfaceMeta, popoverTabs,
    setPopoverTabs, popoverTabFrameRef, activePopoverTab, setActivePopoverTab,
  }
}
