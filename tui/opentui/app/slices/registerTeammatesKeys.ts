/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { WorkspaceContextValue } from '../../workspaceContext'
import type { SurfacePanelState } from '../../surfacePanelState'
import React, { useMemo } from 'react'
import { getPluginSurface, isPluginSurfaceId } from '../../../../lib/plugins/catalog'
import { type WindowSplitTree } from '../../windowSplitTree'
import { WINDOW_SURFACE_TITLES, surfaceKindOf, type WindowSurfaceKind } from '../../windowSurfaceNames'
import { copySurfaceViewState, surfaceViewNamespace } from '../../windowViewState'
import { isPopoverWindowKind, pinFor, POPOVER_WINDOWS, type PopoverWindowKind, type SurfaceMeta } from '../../popoverWindows'
import { type WindowArrangement } from '../../windowLayout'
import { type WindowLayoutAction } from '../../WindowLayoutPicker'
import { type ContextMenuItem } from '../../ContextMenu'
import { activeSurface, openSurface as openSurfaceIn } from '../../surfacePanelState'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export type UseRegisterTeammatesKeysGroupContext = {
  teammatesKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  pluginOverlayKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  selectedSessionKey: string | null
  sessionDetail: TuiSessionDetail | null
  openPopoverWindow: (kind: PopoverWindowKind, pin?: SurfaceMeta, placement?: 'beside' | 'fill' | 'tab') => void
  setPopoverOpen: (kind: WindowSurfaceKind, open: boolean, pin?: SurfaceMeta) => void
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; title: string; items: ContextMenuItem[]; } | null>>
  width: number
  openPopoverTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  openPopoverInNewTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  readerPin: () => { session: string | null; path: string | null; }
  pinnedSessionOf: (surface: WindowSurfaceId) => Session | null
  windowSurfaceMeta: Record<string, SurfaceMeta>
  workspaceContext: WorkspaceContextValue
  returningPopoverRef: React.RefObject<boolean>
  closeSurfaceWindow: (surface: WindowSurfaceId, moving?: boolean) => void
  openTabByKey: Map<string, Session>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  selectTabSession: (session: Session) => void
  surfacePanel: SurfacePanelState
  gitRepoCwd: string
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanel: React.Dispatch<React.SetStateAction<SurfacePanelState>>
  reconciledSplitTree: WindowSplitTree | null
  visibleSplitPaneCount: number
  splitArrangement: WindowArrangement
  stackedSplit: boolean
  splitReaderLast: boolean
}

export function useRegisterTeammatesKeysGroup(ctx: UseRegisterTeammatesKeysGroupContext) {
  const {
    teammatesKeyHandlerRef, pluginOverlayKeyHandlerRef, selectedSessionKey, sessionDetail,
    openPopoverWindow, setPopoverOpen, openSurfaceWindow, setContextMenu, width, openPopoverTab,
    openPopoverInNewTab, readerPin, pinnedSessionOf, windowSurfaceMeta, workspaceContext,
    returningPopoverRef, closeSurfaceWindow, openTabByKey, setOpenTabSessions, selectTabSession,
    surfacePanel, gitRepoCwd, setSurfacePanelOpen, setSurfacePanelFocused, setSurfacePanel,
    reconciledSplitTree, visibleSplitPaneCount, splitArrangement, stackedSplit, splitReaderLast,
  } = ctx

  const registerTeammatesKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    teammatesKeyHandlerRef.current = handler
  })
  const offerTeammatesPlacement = useStableEvent(() => offerPopoverPlacement('teammates'))
  const registerPluginOverlayKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    pluginOverlayKeyHandlerRef.current = handler
  })
  const pluginSelectedDetail = useMemo(() => ({ key: selectedSessionKey, detail: sessionDetail }), [selectedSessionKey, sessionDetail])
  const offerPopoverPlacement = useStableEvent((kind: WindowSurfaceKind) => {
    const beside = () => {
      if (isPopoverWindowKind(kind)) { openPopoverWindow(kind); return }
      setPopoverOpen(kind, false)
      openSurfaceWindow(kind)
    }
    setContextMenu({ x: Math.max(0, width - 34), y: 1, title: WINDOW_SURFACE_TITLES[kind], items: [
      { label: 'Beside the focused pane', hint: '⌃⇧W', run: beside },
      { label: 'As a tab in this workspace', run: () => (isPopoverWindowKind(kind) ? openPopoverWindow(kind, undefined, 'fill') : openPopoverTab(kind, {})) },
      { label: 'In a new workspace', run: () => { setPopoverOpen(kind, false); openPopoverInNewTab(kind, isPopoverWindowKind(kind) ? pinFor(kind, readerPin()) : {}) } },
    ] })
  })
  // A popover window back to full screen: on its pinned session, in the reader.
  const returnPopoverWindow = useStableEvent((surface: WindowSurfaceId) => {
    const kind = surfaceKindOf(surface)
    if (!isPopoverWindowKind(kind)) return
    const pinned = pinnedSessionOf(surface)
    const meta = windowSurfaceMeta[surface]
    if (isPluginSurfaceId(kind) && !POPOVER_WINDOWS[kind].single) copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(kind, surface), 'root', getPluginSurface(kind).pluginId)
    returningPopoverRef.current = true
    closeSurfaceWindow(surface, true)
    returningPopoverRef.current = false
    // Into the reader as a tab — never through the rail's path, which with this
    // (just closed, still focused this render) window would reopen the session
    // as a window and re-commit the window list it was closed from.
    if (pinned && sessionKey(pinned) !== selectedSessionKey) {
      if (!openTabByKey.has(sessionKey(pinned))) setOpenTabSessions((current) => [...current, pinned])
      selectTabSession(pinned)
    }
    setPopoverOpen(kind, true, meta)
  })
  const moveSurfaceToPanel = useStableEvent((surface: WindowSurfaceId) => {
    const kind = surfaceKindOf(surface)
    if (isPopoverWindowKind(kind)) { returnPopoverWindow(surface); return }
    const opened = openSurfaceIn(surfacePanel, kind)
    const nextPanel = { ...opened, surfaces: opened.surfaces.map(entry => entry.id === opened.activeId ? { ...entry, cwd: windowSurfaceMeta[surface]?.cwd ?? gitRepoCwd } : entry) }
    const panel = activeSurface(nextPanel)!
    copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(kind, surface), surfaceViewNamespace(kind, undefined, panel.id))
    closeSurfaceWindow(surface, true)
    setSurfacePanelOpen(true)
    setSurfacePanelFocused(true)
    setSurfacePanel(nextPanel)
  })

  // The choice the window menu shows as current.
  const currentWindowLayoutAction: WindowLayoutAction | null = reconciledSplitTree ? null : visibleSplitPaneCount === 0
    ? 'fill'
    : splitArrangement === 'main-stack' ? 'main-stack'
    : splitArrangement === 'grid' ? (visibleSplitPaneCount > 3 ? 'grid-six' : 'grid')
    : stackedSplit ? (splitReaderLast ? 'reader-bottom' : 'reader-top')
    : splitReaderLast ? 'reader-right' : visibleSplitPaneCount === 1 ? 'two' : 'reader-left'

  return {
    registerTeammatesKeys, offerTeammatesPlacement, registerPluginOverlayKeys,
    pluginSelectedDetail, offerPopoverPlacement, returnPopoverWindow, moveSurfaceToPanel,
    currentWindowLayoutAction,
  }
}
