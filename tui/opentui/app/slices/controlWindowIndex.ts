/** @jsxImportSource @opentui/react */
import type { CliRenderer } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import type { WindowLayout } from '../../windowLayout'
import type { SplitRect } from '../../windowSplitTree'
import type { SplitDivider } from '../../windowSplitTree'
import { type WindowPresentation } from '../../windowPresentation'
import React from 'react'
import { type WindowSplitTree } from '../../windowSplitTree'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { type WindowControlAction, type ControlWindow } from '../../windowControls'
import { type SurfaceMeta } from '../../popoverWindows'
import { type WindowStack } from '../../windowTabs'
import { surfaceWindowKey } from '../../windowOrder'
import { type WindowGroupKey, type WindowArrangement, type WindowDirection } from '../../windowLayout'
import { type ContextMenuItem } from '../../ContextMenu'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { type PendingPermission } from '../../../../lib/permissions'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type ChordMap } from '../../chordHelp'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { type WindowSurfaceId } from '../SplitTranscriptPane'
import { runRunWindowControlAction, runOpenWindowControlMenu } from '../actions/windows'

export type UseControlWindowIndexGroupContext = {
  shownPopoverTab: string | null
  floatingKey: string | null
  windowItems: WindowItem[]
  windowItemKey: (item: WindowItem) => string
  splitFocusIndex: number | null
  selectedSessionKey: string | null
  focusedWindowItem: WindowItem | null
  renderer: CliRenderer
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  width: number
  height: number
  popoverHostSlot: number
  windowSurfaceTitle: (surface: WindowSurfaceId) => string
  visibleSplitPaneCount: number
  windowNumberOffset: 1 | 2
  windowKeyTitle: (key: string) => string
  floatingItem: WindowItem | null
  windowPresentation: WindowPresentation | null
  windowZoom: number | 'reader' | null
  windowSurfacePeek: string | null
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  focusReaderFromSplit: () => void
  focusSplitPane: (paneIndex: number) => void
  endWindowResizeGroup: () => void
  windowControlMode: 'identify' | 'manage' | null
  leaveWindowControls: () => void
  pendingPermissions: PendingPermission[]
  windowControlsBlocked: boolean
  contextMenu: { x: number; y: number; title: string; items: ContextMenuItem[]; } | null
  commandPaletteOpen: boolean
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; title: string; items: ContextMenuItem[]; } | null>>
  setControlMenuTarget: React.Dispatch<React.SetStateAction<string | null>>
  setChordHelp: React.Dispatch<React.SetStateAction<{ map: ChordMap; dismissOnKey: boolean; } | null>>
  setSplitChordPending: React.Dispatch<React.SetStateAction<boolean>>
  setCommandChordPending: React.Dispatch<React.SetStateAction<boolean>>
  setWindowControlMode: React.Dispatch<React.SetStateAction<'identify' | 'manage' | null>>
  windowResizeGroupRef: React.RefObject<boolean>
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  tabFocusedWindow: (target?: number | null) => void
  floatWindowKey: (key: string, session?: Session) => void
  openPopoverTabMoveMenu: (id: WindowSurfaceId) => void
  openMoveWorkspaceMenu: (sourceId: string, target: string, singleTab?: boolean, point?: { x: number; y: number; }) => void
  workspaceId: string
  toggleFullscreenMode: (forced?: boolean) => void
  toggleWindowZoom: (target?: number | null) => void
  resizeFocusedWindow: (direction: 1 | -1, focus?: number | null) => void
  resizeSecondaryDivider: (direction: 1 | -1) => void
  checkpointWindowLayout: () => void
  reconciledSplitTree: WindowSplitTree | null
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  setSplitBottomShare: React.Dispatch<React.SetStateAction<number>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
  splitArrangement: WindowArrangement
  splitReaderLast: boolean
  undoWindowLayout: () => void
  swapWindowInDirection: (direction: WindowDirection, target?: number | null) => void
  breakOutWindowTab: (key: string) => void
  toggleFloatingFocused: (target?: number | null) => void
  windowStackFor: (key: string) => WindowStack | null
  closeWindowTab: (key: string, remember?: boolean) => void
  closeFloatingWindow: (remember?: boolean) => void
  closeSurfaceWindow: (surface: WindowSurfaceId, moving?: boolean) => void
  closeSplitPane: (paneIndex?: number) => void
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  splitFocusedWindow: (orientation: SplitPaneOrientation, target?: number | null) => void
  selectedWindowIndex: number
  selectedSession: Session | null
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  fittedWindows: WindowLayout
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  popoverTabToWindow: (id: WindowSurfaceId) => void
  popoverTabToFullScreen: (id: WindowSurfaceId) => void
  returnPopoverWindow: (surface: WindowSurfaceId) => void
  windowSurfaceMeta: Record<string, SurfaceMeta>
  returningPopoverRef: React.RefObject<boolean>
  openPopoverTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  openPopoverInNewTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  setPopoverOpen: (kind: WindowSurfaceKind, open: boolean, pin?: SurfaceMeta) => void
  moveSurfaceToPanel: (surface: WindowSurfaceId) => void
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
}

export function useControlWindowIndexGroup(ctx: UseControlWindowIndexGroupContext) {
  const {
    shownPopoverTab, floatingKey, windowItems, windowItemKey, splitFocusIndex, selectedSessionKey,
    focusedWindowItem, renderer, rectOf, width, height, popoverHostSlot, windowSurfaceTitle,
    visibleSplitPaneCount, windowNumberOffset, windowKeyTitle, floatingItem, windowPresentation,
    windowZoom, windowSurfacePeek, setSurfacePanelFocused, setFocusedPane, focusReaderFromSplit,
    focusSplitPane, endWindowResizeGroup, windowControlMode, leaveWindowControls,
    pendingPermissions, windowControlsBlocked, contextMenu, commandPaletteOpen, setContextMenu,
    setControlMenuTarget, setChordHelp, setSplitChordPending, setCommandChordPending,
    setWindowControlMode, windowResizeGroupRef, closePopoverTab, tabFocusedWindow, floatWindowKey,
    openPopoverTabMoveMenu, openMoveWorkspaceMenu, workspaceId, toggleFullscreenMode,
    toggleWindowZoom, resizeFocusedWindow, resizeSecondaryDivider, checkpointWindowLayout,
    reconciledSplitTree, setWindowSplitTree, setSplitReaderShare, setSplitSecondaryShare,
    setSplitBottomShare, setSplitWeights, splitArrangement, splitReaderLast, undoWindowLayout,
    swapWindowInDirection, breakOutWindowTab, toggleFloatingFocused, windowStackFor,
    closeWindowTab, closeFloatingWindow, closeSurfaceWindow, closeSplitPane, setWindowPickerOpen,
    splitFocusedWindow, selectedWindowIndex, selectedSession, treeGeometry, fittedWindows,
    showNotice, popoverTabToWindow, popoverTabToFullScreen, returnPopoverWindow, windowSurfaceMeta,
    returningPopoverRef, openPopoverTab, openPopoverInNewTab, setPopoverOpen, moveSurfaceToPanel,
    openSurfaceWindow,
  } = ctx

  const controlWindowIndex = (key: string): number | null | undefined => {
    if (shownPopoverTab && (key === 'reader' || key === surfaceWindowKey(shownPopoverTab))) return null
    if (floatingKey === key) return FLOATING_PANE_INDEX
    const index = windowItems.findIndex(item => windowItemKey(item) === key)
    return index < 0 ? undefined : index
  }
  const focusedControlKey = () => splitFocusIndex === null ? (shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : selectedSessionKey ?? 'empty')
    : focusedWindowItem ? windowItemKey(focusedWindowItem) : 'reader'
  const readControlWindows = useStableEvent((): ControlWindow[] => {
    const windows: ControlWindow[] = []
    const add = (key: string, number: number, title: string, id: string) => {
      const node = renderer.root.findDescendantById(id)
      if (!node) return
      for (let parent: typeof node | null = node; parent; parent = parent.parent) {
        if (!parent.visible) return
      }
      const rect = rectOf(id)
      if (!rect) return
      const x = Math.max(0, rect.x), y = Math.max(0, rect.y)
      const clippedWidth = Math.min(width, rect.x + rect.width) - x
      const clippedHeight = Math.min(height, rect.y + rect.height) - y
      if (clippedWidth < 3 || clippedHeight < 2) return
      windows.push({ key, number, title, focused: focusedControlKey() === key,
        rect: { x, y, width: clippedWidth, height: clippedHeight } })
    }
    if (shownPopoverTab) add(surfaceWindowKey(shownPopoverTab), popoverHostSlot >= 0 ? popoverHostSlot + 1 : 1, windowSurfaceTitle(shownPopoverTab), 'popover-tab-frame')
    windowItems.slice(0, visibleSplitPaneCount).forEach((item, index) => index !== popoverHostSlot && add(windowItemKey(item), index + windowNumberOffset, windowKeyTitle(windowItemKey(item)), `split-pane:${index}`))
    if (floatingItem && (!windowPresentation || windowZoom === FLOATING_PANE_INDEX) && !windowSurfacePeek) add(windowItemKey(floatingItem), visibleSplitPaneCount + windowNumberOffset, windowKeyTitle(windowItemKey(floatingItem)), 'floating-window')
    return windows
  })
  const focusControlWindow = useStableEvent((key: string) => {
    const index = controlWindowIndex(key)
    if (index === undefined) return false
    setSurfacePanelFocused(false)
    setFocusedPane('messages')
    if (index === null) focusReaderFromSplit()
    else focusSplitPane(index)
    return true
  })
  const pickControlWindow = useStableEvent((key: string) => {
    endWindowResizeGroup()
    if (!readControlWindows().some(window => window.key === key)) return
    focusControlWindow(key)
    if (windowControlMode === 'identify') leaveWindowControls()
  })
  const enterWindowControls = useStableEvent((mode: 'identify' | 'manage') => {
    if (pendingPermissions.length || (windowControlsBlocked && !contextMenu && !commandPaletteOpen)) return
    setContextMenu(null)
    setControlMenuTarget(null)
    setChordHelp(null)
    setSplitChordPending(false)
    setCommandChordPending(false)
    endWindowResizeGroup()
    const visible = readControlWindows()
    if (!visible.some(window => window.focused) && visible[0]) focusControlWindow(visible[0].key)
    setWindowControlMode(mode)
  })
  const runWindowControlAction = useStableEvent((key: string, action: WindowControlAction, direction?: WindowDirection) => runRunWindowControlAction({
    controlWindowIndex, setContextMenu, windowControlMode, endWindowResizeGroup,
    windowResizeGroupRef, shownPopoverTab, closePopoverTab, tabFocusedWindow, floatWindowKey,
    openPopoverTabMoveMenu, focusControlWindow, openMoveWorkspaceMenu, workspaceId,
    enterWindowControls, visibleSplitPaneCount, toggleFullscreenMode, toggleWindowZoom,
    resizeFocusedWindow, resizeSecondaryDivider, checkpointWindowLayout, reconciledSplitTree,
    setWindowSplitTree, setSplitReaderShare, setSplitSecondaryShare, setSplitBottomShare,
    setSplitWeights, splitArrangement, splitReaderLast, undoWindowLayout, swapWindowInDirection,
    breakOutWindowTab, toggleFloatingFocused, windowStackFor, closeWindowTab, closeFloatingWindow,
    windowItems, closeSurfaceWindow, closeSplitPane, leaveWindowControls, setWindowPickerOpen,
    splitFocusedWindow, openWindowControlMenu,
  }, key, action, direction))
  const openWindowControlMenu = useStableEvent((key: string, point?: { x: number; y: number }, section?: 'resize' | 'swap' | 'session') => runOpenWindowControlMenu({
    controlWindowIndex, leaveWindowControls, setControlMenuTarget, rectOf, floatingItem,
    windowItems, selectedWindowIndex, windowStackFor, windowZoom, shownPopoverTab, selectedSession,
    treeGeometry, fittedWindows, splitArrangement, closePopoverTab, openWindowControlMenu,
    runWindowControlAction, focusControlWindow, renderer, showNotice, popoverTabToWindow,
    popoverTabToFullScreen, returnPopoverWindow, windowSurfaceMeta, returningPopoverRef,
    closeSurfaceWindow, openPopoverTab, openPopoverInNewTab, setPopoverOpen, moveSurfaceToPanel,
    openSurfaceWindow, setContextMenu, windowSurfaceTitle, windowKeyTitle, selectedSessionKey,
  }, key, point, section))

  return {
    controlWindowIndex, focusedControlKey, readControlWindows, focusControlWindow,
    pickControlWindow, enterWindowControls, runWindowControlAction, openWindowControlMenu,
  }
}
