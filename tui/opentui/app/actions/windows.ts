/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React from 'react'
import { isSurfaceWindowKey, surfaceIdOfKey } from '../../windowOrder'
import { type WindowTarget } from '../../windowTargets'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { type Session } from '../../../../lib/types'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'
import { removePrimaryWindow, validWindowSplitTree, type WindowSplitTree } from '../../windowSplitTree'
import { readSurfaceMeta, type SurfaceMeta } from '../../popoverWindows'
import { type FloatingRect, type WindowStack } from '../../windowTabs'
import { type WindowGroupKey, type WindowArrangement } from '../../windowLayout'
import { planCoordinatorWorkspace } from '../../coordinatorWorkspace'
import { type SavedWindowLayout } from '../../windowLayoutStore'
import { writeTuiSplitPanes } from '../../../../lib/tui/service'
import { SPLIT_SHARE_EVEN, type SplitPaneOrientation } from '../../splitPaneState'
import { evenWindowSplitTree } from '../../windowSplitTree'
import { WINDOW_CONTROL_ACTIONS, type WindowControlAction } from '../../windowControls'
import { surfaceWindowKey } from '../../windowOrder'
import { type WindowDirection } from '../../windowLayout'
import { type ContextMenuItem } from '../../ContextMenu'
import { writeTuiSplitReaderShare, writeTuiWindowArrangement } from '../../../../lib/tui/service'
import { type WindowLayout } from '../../windowLayout'
import { type SplitRect, type SplitDivider } from '../../windowSplitTree'
import { type CliRenderer } from '@opentui/core'
import { WINDOW_SURFACE_TITLES, surfaceKindOf, type WindowSurfaceKind } from '../../windowSurfaceNames'
import { WINDOW_MENU_ACTIONS, WINDOW_RESIZE_ACTIONS, type WindowControlContext } from '../../windowControls'
import { isPopoverWindowKind } from '../../popoverWindows'
import { fitText } from '../../textLayout'
import { MULTI_INSTANCE_SURFACES, SURFACE_POPOVER_KINDS } from '../layoutConstants'
import { writeClipboard } from '../clipboard'
import { type SurfacePanelState } from '../../surfacePanelState'
import { type WorkspaceContextValue } from '../../workspaceContext'
import { copySurfaceViewState, surfaceViewNamespace } from '../../windowViewState'
import { writeTuiSplitOrientation } from '../../../../lib/tui/service'
import { calculateSplitPaneLayout } from '../../splitPaneState'
import { MIN_READER_WIDTH, SPLIT_PANE_MAX, SPLIT_PANE_MIN_WIDTH, SPLIT_PANE_MIN_ROWS, MIN_READER_ROWS } from '../layoutConstants'
import { RUNNING_INSIDE_TMUX } from '../commands'
import { activeSurface, closeSurface as closeSurfaceIn } from '../../surfacePanelState'
import { type MutableRefObject } from 'react'
import { isPluginEnabled } from '../../../../lib/plugins/enablement'
import { getPluginSurface, isPluginSurfaceId } from '../../../../lib/plugins/catalog'
import { surfaceTitle } from '../../windowSurfaceNames'
import { windowLayoutRects } from '../../windowLayout'
import { computeWindowSplitTree, splitTreeFromRects, splitWindowLeaf } from '../../windowSplitTree'
import { nextSurfaceId } from '../../popoverWindows'
import { formatSessionTitle } from '../../../format'
import { replacePrimaryWindow, reconcileWindowSplitTree } from '../../windowSplitTree'
import { addToStack, replaceWindowKey, stackOf } from '../../windowTabs'
import { orderWindows } from '../../windowOrder'
import { moveWindowBeside } from '../../windowOrder'
import { type WindowDropZone } from '../../windowLayout'
import { planWindowSessionDrop } from '../../windowOperations'
import { readerShareAt } from '../../windowLayout'
import { SPLIT_SHARE_MAX, SPLIT_SHARE_MIN } from '../../splitPaneState'
import { adjustSplitReaderShare, evenSplitReaderShare, SPLIT_SHARE_STEP } from '../../splitPaneState'
import { placePaneSlot, movePaneToEdge, placeWindowSplit } from '../../windowSplitTree'
import { stackSuccessor } from '../../windowTabs'
import { clampFloatingRect } from '../../windowTabs'
import { findPopoverWindow, pinFor, POPOVER_WINDOWS, type PopoverWindowKind } from '../../popoverWindows'
import { focusAfterWindowClose } from '../../windowControls'
import { removeSplitPaneKey } from '../../splitPaneState'
import { removeFromStack } from '../../windowTabs'
import { swapPaneSlots } from '../../windowSplitTree'
import { windowInDirection } from '../../windowLayout'

export type PickWindowTargetContext = {
  windowTargets: WindowTarget[]
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  floatingKey: string | null
  setWindowSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  parkedWindowKeysRef: React.RefObject<Set<string>>
  activateWindowTab: (key: string) => void
  pendingSurfaceFocusRef: React.RefObject<string | null>
  popoverTabs: string[]
  showPopoverTab: (id: WindowSurfaceId) => void
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  windowItems: WindowItem[]
  focusSplitPane: (paneIndex: number) => void
  splitPinnedKeys: string[]
  watchedCoordinator: ProtocolRunSnapshot | null
  splitPaneSessions: Session[]
  selectedSessionKey: string | null
  checkpointWindowLayout: () => void
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  selectedSession: Session | null
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  selectTabSession: (session: Session) => void
  focusReaderFromSplit: () => void
}

export function runPickWindowTarget(ctx: PickWindowTargetContext, key: string) {
  const {
    windowTargets, showNotice, floatingKey, setWindowSwitcherOpen, setFocusedPane,
    setSplitFocusIndex, parkedWindowKeysRef, activateWindowTab, pendingSurfaceFocusRef,
    popoverTabs, showPopoverTab, setWindowZoom, setWindowSurfacePeek, setSurfacePanelFocused,
    windowItems, focusSplitPane, splitPinnedKeys, watchedCoordinator, splitPaneSessions,
    selectedSessionKey, checkpointWindowLayout, setSplitPinnedKeys, setWindowOrder,
    selectedSession, setOpenTabSessions, selectTabSession, focusReaderFromSplit,
  } = ctx
  const target = windowTargets.find((entry) => entry.key === key)
  if (!target) { showNotice('info', 'That window is no longer open'); return }
  if (key === floatingKey) { setWindowSwitcherOpen(false); setFocusedPane('messages'); setSplitFocusIndex(FLOATING_PANE_INDEX); return }
  if (parkedWindowKeysRef.current.has(key)) {
    setWindowSwitcherOpen(false)
    activateWindowTab(key)
    if (isSurfaceWindowKey(key)) pendingSurfaceFocusRef.current = surfaceIdOfKey(key)
    return
  }
  setWindowSwitcherOpen(false)
  if (isSurfaceWindowKey(key) && popoverTabs.includes(surfaceIdOfKey(key))) { showPopoverTab(surfaceIdOfKey(key)); return }
  setWindowZoom(null)
  setWindowSurfacePeek(null)
  setSurfacePanelFocused(false)
  setFocusedPane('messages')
  if (target.session) {
    const pane = windowItems.findIndex((item) => item.kind === 'session' && sessionKey(item.session) === key)
    if (pane >= 0) focusSplitPane(pane)
    else {
      // A watched run keeps its lead's window (the first): a hidden teammate
      // trades places with the first teammate shown.
      const lead = splitPinnedKeys[0]
      const shownTeammate = watchedCoordinator ? splitPaneSessions.find((session) => sessionKey(session) !== lead) : undefined
      if (key !== selectedSessionKey && shownTeammate) {
        checkpointWindowLayout()
        const first = sessionKey(shownTeammate)
        const swap = (keys: string[]) => keys.map(entry => entry === key ? first : entry === first ? key : entry)
        setSplitPinnedKeys(swap)
        setWindowOrder(swap)
        focusSplitPane(windowItems.findIndex((item) => item.kind === 'session' && sessionKey(item.session) === first))
        return
      }
      if (key !== selectedSessionKey) {
        checkpointWindowLayout()
        // The hidden window trades places with the selected session's, so it
        // is shown and the order keeps every window; picking the other back
        // trades them again. The selection may be an unpinned preview tab:
        // keep it as a tab instead of letting reconciliation drop it.
        const current = selectedSession
        const currentKey = current ? sessionKey(current) : null
        setOpenTabSessions((tabs) => current && !tabs.some((tab) => sessionKey(tab) === currentKey) ? [...tabs, current] : tabs)
        if (currentKey) {
          const swap = (keys: string[]) => keys.map((entry) => entry === key ? currentKey : entry === currentKey ? key : entry)
          setSplitPinnedKeys(swap)
          setWindowOrder(swap)
        }
        selectTabSession(target.session)
      }
      focusReaderFromSplit()
    }
  } else if (target.surface) {
    const pane = windowItems.findIndex((item) => item.kind === 'surface' && item.surface === target.surface)
    if (pane >= 0) focusSplitPane(pane)
    else {
      // A hidden surface can be inspected at full size without changing the
      // logical layout or mounting it in the side panel at the same time.
      setWindowSurfacePeek(target.surface)
      setSplitFocusIndex(-1)
      showNotice('info', 'Hidden window · Esc or ⌃B m restores the layout')
    }
  }
}

export type ApplySavedWindowLayoutContext = {
  windowLayoutRestoreRequestRef: React.RefObject<number>
  windowLayoutProject: string
  windowPickerOpen: boolean
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  checkpointWindowLayout: () => void
  setCoordinatorWorkspace: React.Dispatch<React.SetStateAction<ProtocolRunSnapshot | null>>
  savedWindowLayouts: SavedWindowLayout[]
  setCoordinatorWorkspaceRunId: React.Dispatch<React.SetStateAction<string | null>>
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  sessions: Session[]
  openTabSessions: Session[]
  setWindowArrangement: (arrangement: WindowArrangement, readerLast: boolean) => void
  applySplitOrientation: (next: SplitPaneOrientation, quiet?: boolean) => void
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  setSplitBottomShare: React.Dispatch<React.SetStateAction<number>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  surfaceRestorable: (surface: string) => boolean
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  setPopoverTabs: React.Dispatch<React.SetStateAction<string[]>>
  setActivePopoverTab: React.Dispatch<React.SetStateAction<string | null>>
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  setWindowSurfaceMeta: React.Dispatch<React.SetStateAction<Record<string, SurfaceMeta>>>
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  selectedSessionKey: string | null
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setWorkspaceReaderSession: (session: Session | null) => void
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

export function runApplySavedWindowLayout(ctx: ApplySavedWindowLayoutContext, id: string, snapshot: ProtocolRunSnapshot | null, request: number, project: string) {
  const {
    windowLayoutRestoreRequestRef, windowLayoutProject, windowPickerOpen, setWindowSurfacePeek,
    checkpointWindowLayout, setCoordinatorWorkspace, savedWindowLayouts,
    setCoordinatorWorkspaceRunId, setWindowPickerOpen, sessions, openTabSessions,
    setWindowArrangement, applySplitOrientation, setSplitReaderShare, setSplitSecondaryShare,
    setSplitBottomShare, setSplitWeights, setOpenTabSessions, setSplitPinnedKeys,
    setSplitPaneCount, setWindowSurfaces, surfaceRestorable, setWindowOrder, setPopoverTabs,
    setActivePopoverTab, setWindowSplitTree, setWindowStacks, setWindowSurfaceMeta,
    setFloatingWindow, setSplitFocusIndex, setSurfacePanelFocused, setFocusedPane, setWindowZoom,
    selectedSessionKey, setWorkspaceHasSession, setWorkspaceReaderSession, setSelectedSessionKey,
    showNotice,
  } = ctx
  if (request !== windowLayoutRestoreRequestRef.current || project !== windowLayoutProject || !windowPickerOpen) return
  setWindowSurfacePeek(null)
  checkpointWindowLayout()
  setCoordinatorWorkspace(snapshot)
  const saved = savedWindowLayouts.find((entry) => entry.id === id)
  if (!saved) return
  setCoordinatorWorkspaceRunId(saved.coordinatorRunId ?? null)
  setWindowPickerOpen(false)
  const known = new Map<string, Session>()
  for (const session of [...sessions, ...openTabSessions]) known.set(sessionKey(session), session)
  if (snapshot && snapshot.run.id === saved.coordinatorRunId) {
    for (const target of planCoordinatorWorkspace(snapshot, known).targets) known.set(target.sessionKey, target.session)
  }
  const panes = saved.panes.flatMap((key) => (known.has(key) ? [known.get(key)!] : []))
  const reader = saved.reader ? known.get(saved.reader) ?? null : null
  const floatingSession = saved.floating && !isSurfaceWindowKey(saved.floating.key) ? known.get(saved.floating.key) : null
  const missing = saved.panes.length - panes.length + (saved.reader && !reader ? 1 : 0) + (saved.floating && !isSurfaceWindowKey(saved.floating.key) && !floatingSession ? 1 : 0)
  setWindowArrangement(saved.arrangement, saved.readerLast)
  applySplitOrientation(saved.orientation, true)
  setSplitReaderShare(saved.readerShare)
  setSplitSecondaryShare(saved.secondaryShare)
  setSplitBottomShare(saved.bottomShare ?? SPLIT_SHARE_EVEN)
  setSplitWeights(saved.weights ?? {})
  setOpenTabSessions((prev) => {
    const next = [...prev]
    for (const session of [...(reader ? [reader] : []), ...(floatingSession ? [floatingSession] : []), ...panes]) {
      if (!next.some((tab) => sessionKey(tab) === sessionKey(session))) next.push(session)
    }
    return next
  })
  setSplitPinnedKeys(panes.map((pane) => sessionKey(pane)))
  setSplitPaneCount(panes.length)
  void writeTuiSplitPanes(panes.length).catch(() => {})
  setWindowSurfaces(saved.surfaces.filter(surfaceRestorable))
  setWindowOrder(saved.order ?? [])
  // Background tabs' sessions must be open tabs, or their tab has nothing to show.
  const tabSessions = (saved.stacks ?? []).flat().flatMap((key) => (known.has(key) && !panes.some((pane) => sessionKey(pane) === key) ? [known.get(key)!] : []))
  if (tabSessions.length > 0) setOpenTabSessions((prev) => [...prev, ...tabSessions.filter((session) => !prev.some((tab) => sessionKey(tab) === sessionKey(session)))])
  const restoredPrimaryOpen = Boolean(reader) && (saved.primaryOpen ?? saved.splitTree?.primary !== false)
  const restoredTree = validWindowSplitTree(saved.splitTree) ? saved.splitTree : null
  const restoredTabs = (saved.popoverTabs ?? []).filter(surfaceRestorable)
  setPopoverTabs(restoredTabs); setActivePopoverTab(saved.activePopoverTab && restoredTabs.includes(saved.activePopoverTab) ? saved.activePopoverTab : null)
  const restoredPrimaryFrame = restoredPrimaryOpen || Boolean(saved.activePopoverTab && restoredTabs.includes(saved.activePopoverTab))
  setWindowSplitTree(restoredTree ? restoredPrimaryFrame ? restoredTree : removePrimaryWindow(restoredTree) : null)
  setWindowStacks(saved.stacks ?? [])
  setWindowSurfaceMeta(readSurfaceMeta(saved.surfaceMeta))
  const restoredFloating = saved.floating && (isSurfaceWindowKey(saved.floating.key) ? surfaceRestorable(surfaceIdOfKey(saved.floating.key)) : Boolean(floatingSession)) ? saved.floating : null
  setFloatingWindow(restoredFloating)
  setSplitFocusIndex(restoredPrimaryFrame ? null : panes.length + saved.surfaces.filter(surfaceRestorable).length > 0 ? 0 : restoredFloating ? FLOATING_PANE_INDEX : null)
  setSurfacePanelFocused(false)
  setFocusedPane('messages')
  setWindowZoom(null)
  // Generic layouts store all transcripts in panes (or the floating window).
  // Restoring after an empty workspace must reactivate one of those sessions,
  // rather than depending on the legacy saved reader field.
  const restoredSession = reader ?? panes.find(pane => sessionKey(pane) === selectedSessionKey) ?? panes[0] ?? floatingSession
  setWorkspaceHasSession(Boolean(restoredSession))
  setWorkspaceReaderSession(restoredSession ?? null)
  if (restoredSession && sessionKey(restoredSession) !== selectedSessionKey) setSelectedSessionKey(sessionKey(restoredSession))
  showNotice('info', `${saved.name} restored${missing > 0 ? ` · ${missing} session${missing === 1 ? '' : 's'} no longer here` : ''}`)
}

export type RunWindowControlActionContext = {
  controlWindowIndex: (key: string) => number | null | undefined
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; title: string; items: ContextMenuItem[]; } | null>>
  windowControlMode: 'identify' | 'manage' | null
  endWindowResizeGroup: () => void
  windowResizeGroupRef: React.RefObject<boolean>
  shownPopoverTab: string | null
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  tabFocusedWindow: (target?: number | null) => void
  floatWindowKey: (key: string, session?: Session) => void
  openPopoverTabMoveMenu: (id: WindowSurfaceId) => void
  focusControlWindow: (key: string) => boolean
  openMoveWorkspaceMenu: (sourceId: string, target: string, singleTab?: boolean, point?: { x: number; y: number; }) => void
  workspaceId: string
  enterWindowControls: (mode: 'identify' | 'manage') => void
  visibleSplitPaneCount: number
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
  windowItems: WindowItem[]
  closeSurfaceWindow: (surface: WindowSurfaceId, moving?: boolean) => void
  closeSplitPane: (paneIndex?: number) => void
  leaveWindowControls: () => void
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  splitFocusedWindow: (orientation: SplitPaneOrientation, target?: number | null) => void
  openWindowControlMenu: (key: string, point?: { x: number; y: number; }, section?: 'resize' | 'swap' | 'session') => void
}

export function runRunWindowControlAction(ctx: RunWindowControlActionContext, key: string, action: WindowControlAction, direction?: WindowDirection) {
  const {
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
  } = ctx
  const index = controlWindowIndex(key)
  if (index === undefined) { setContextMenu(null); return }
  const spec = WINDOW_CONTROL_ACTIONS.find(entry => entry.id === action)!
  const grouped = windowControlMode === 'manage' && spec.resize
  if (!grouped) endWindowResizeGroup()
  windowResizeGroupRef.current = Boolean(grouped)
  // A popover tab in the reader's place: what moves is the popover, not the
  // session hidden behind it.
  if (index === null && shownPopoverTab && (action === 'float' || action === 'move-workspace' || action === 'close' || action === 'tab')) {
    const id = shownPopoverTab
    if (action === 'close') closePopoverTab(id)
    else if (action === 'tab') tabFocusedWindow(null)
    else if (action === 'float') { closePopoverTab(id, true); floatWindowKey(surfaceWindowKey(id)) }
    else openPopoverTabMoveMenu(id)
    return
  }
  try {
    switch (action) {
      case 'focus': focusControlWindow(key); break
      case 'move-workspace': openMoveWorkspaceMenu(workspaceId, key); break
      case 'manage': focusControlWindow(key); enterWindowControls('manage'); break
      case 'zoom': focusControlWindow(key); if (index === null && visibleSplitPaneCount === 0) toggleFullscreenMode(); else toggleWindowZoom(index); break
      case 'shrink': resizeFocusedWindow(-1, index); break
      case 'grow': resizeFocusedWindow(1, index); break
      case 'reader-shrink': resizeFocusedWindow(-1, index); break
      case 'reader-grow': resizeFocusedWindow(1, index); break
      case 'row-shrink': resizeSecondaryDivider(-1); break
      case 'row-grow': resizeSecondaryDivider(1); break
      case 'equalize':
        checkpointWindowLayout()
        if (reconciledSplitTree) setWindowSplitTree({ ...reconciledSplitTree, root: evenWindowSplitTree(reconciledSplitTree.root) })
        setSplitReaderShare(SPLIT_SHARE_EVEN)
        setSplitSecondaryShare(SPLIT_SHARE_EVEN)
        setSplitBottomShare(SPLIT_SHARE_EVEN)
        setSplitWeights({})
        void writeTuiSplitReaderShare(SPLIT_SHARE_EVEN).catch(() => {})
        void writeTuiWindowArrangement({ arrangement: splitArrangement, readerLast: splitReaderLast, secondaryShare: SPLIT_SHARE_EVEN, bottomShare: SPLIT_SHARE_EVEN, weights: {} }).catch(() => {})
        break
      case 'undo': undoWindowLayout(); break
      case 'swap': if (direction) swapWindowInDirection(direction, index); break
      case 'tab': tabFocusedWindow(index); break
      case 'detach': if (index !== null) breakOutWindowTab(key); break
      case 'float': toggleFloatingFocused(index); break
      case 'close':
        if (index === null) break
        if (windowStackFor(key)) closeWindowTab(key)
        else if (index === FLOATING_PANE_INDEX) closeFloatingWindow()
        else {
          const item = windowItems[index]
          if (item?.kind === 'surface') closeSurfaceWindow(item.surface)
          else closeSplitPane(index)
        }
        break
      case 'layout': focusControlWindow(key); leaveWindowControls(); setWindowPickerOpen(true); break
      case 'split-columns': splitFocusedWindow('columns', index); break
      case 'split-rows': splitFocusedWindow('rows', index); break
      case 'menu': openWindowControlMenu(key); break
      case 'resize': break
    }
  } finally { windowResizeGroupRef.current = false }
}

export type OpenWindowControlMenuContext = {
  controlWindowIndex: (key: string) => number | null | undefined
  leaveWindowControls: () => void
  setControlMenuTarget: React.Dispatch<React.SetStateAction<string | null>>
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  floatingItem: WindowItem | null
  windowItems: WindowItem[]
  selectedWindowIndex: number
  windowStackFor: (key: string) => WindowStack | null
  windowZoom: number | 'reader' | null
  shownPopoverTab: string | null
  selectedSession: Session | null
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  fittedWindows: WindowLayout
  splitArrangement: WindowArrangement
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  openWindowControlMenu: (key: string, point?: { x: number; y: number; }, section?: 'resize' | 'swap' | 'session') => void
  runWindowControlAction: (key: string, action: WindowControlAction, direction?: WindowDirection) => void
  focusControlWindow: (key: string) => boolean
  renderer: CliRenderer
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  popoverTabToWindow: (id: WindowSurfaceId) => void
  popoverTabToFullScreen: (id: WindowSurfaceId) => void
  returnPopoverWindow: (surface: WindowSurfaceId) => void
  windowSurfaceMeta: Record<string, SurfaceMeta>
  returningPopoverRef: React.RefObject<boolean>
  closeSurfaceWindow: (surface: WindowSurfaceId, moving?: boolean) => void
  openPopoverTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  openPopoverInNewTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  setPopoverOpen: (kind: WindowSurfaceKind, open: boolean, pin?: SurfaceMeta) => void
  moveSurfaceToPanel: (surface: WindowSurfaceId) => void
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; title: string; items: ContextMenuItem[]; } | null>>
  windowSurfaceTitle: (surface: WindowSurfaceId) => string
  windowKeyTitle: (key: string) => string
  selectedSessionKey: string | null
}

export function runOpenWindowControlMenu(ctx: OpenWindowControlMenuContext, key: string, point?: { x: number; y: number }, section?: 'resize' | 'swap' | 'session') {
  const {
    controlWindowIndex, leaveWindowControls, setControlMenuTarget, rectOf, floatingItem,
    windowItems, selectedWindowIndex, windowStackFor, windowZoom, shownPopoverTab, selectedSession,
    treeGeometry, fittedWindows, splitArrangement, closePopoverTab, openWindowControlMenu,
    runWindowControlAction, focusControlWindow, renderer, showNotice, popoverTabToWindow,
    popoverTabToFullScreen, returnPopoverWindow, windowSurfaceMeta, returningPopoverRef,
    closeSurfaceWindow, openPopoverTab, openPopoverInNewTab, setPopoverOpen, moveSurfaceToPanel,
    openSurfaceWindow, setContextMenu, windowSurfaceTitle, windowKeyTitle, selectedSessionKey,
  } = ctx
  const index = controlWindowIndex(key)
  if (index === undefined) return
  leaveWindowControls()
  setControlMenuTarget(key)
  const frame = rectOf(index === null ? 'transcript-reader' : index === FLOATING_PANE_INDEX ? 'floating-window' : `split-pane:${index}`)
  const targetItem = index === null ? null : index === FLOATING_PANE_INDEX ? floatingItem : windowItems[index]
  const button = rectOf(index === null || (targetItem?.kind === 'session' && index === selectedWindowIndex) ? 'reader-window-menu' : targetItem?.kind === 'surface' ? `surface-window-menu:${targetItem.surface}` : `split-pane-menu:${index}`)
  const anchor = point ?? { x: button?.x ?? frame?.x ?? 0, y: button?.y ?? frame?.y ?? 0 }
  const context: WindowControlContext = { floating: index === FLOATING_PANE_INDEX,
    tabbed: Boolean(windowStackFor(key)), canTab: index === null || index === FLOATING_PANE_INDEX ? windowItems.length > 0 : windowItems.length > 1, zoomed: windowZoom !== null }
  const wrap = (run: () => void) => () => { if (controlWindowIndex(key) !== undefined) run() }
  const item = index === null ? null : index === FLOATING_PANE_INDEX ? floatingItem : windowItems[index]
  // A popover tab holds the reader's place: the reader's menu is its menu.
  const popoverTab = index === null ? shownPopoverTab : null
  const session = index === null ? (popoverTab ? null : selectedSession) : item?.kind === 'session' ? item.session : null
  const actions = section === 'resize' ? WINDOW_RESIZE_ACTIONS : WINDOW_MENU_ACTIONS
  let items: ContextMenuItem[] = actions.flatMap(id => {
    const action = WINDOW_CONTROL_ACTIONS.find(entry => entry.id === id)!
    if (action.available && !action.available(context)) return []
    if (section === 'resize' && ((!treeGeometry && !fittedWindows.groups.some(group => index !== null && group.members.includes(index)) && ['shrink', 'grow'].includes(id)) || (!treeGeometry?.dividers.some(divider => divider.axis === 'y') && splitArrangement !== 'grid' && ['row-shrink', 'row-grow'].includes(id)))) return []
    return [{ label: id === 'close' ? (context.tabbed || popoverTab ? 'Close tab' : session ? 'Close pane' : 'Close window') : id === 'float' ? (context.floating ? 'Dock window' : 'Float window') : id === 'zoom' ? (context.zoomed ? 'Restore layout' : 'Zoom window') : action.label,
      hint: id === 'manage' ? action.keys : undefined, danger: id === 'close', run: wrap(() => {
        if (id === 'close' && popoverTab) closePopoverTab(popoverTab)
        else if (id === 'resize' || id === 'swap') openWindowControlMenu(key, anchor, id)
        else runWindowControlAction(key, id)
      }) }]
  })
  if (section === 'swap') items = (['left', 'right', 'up', 'down'] as const).map(direction => ({
    label: `Swap ${direction}`, run: wrap(() => runWindowControlAction(key, 'swap', direction)),
  }))
  if (section === 'session' && session) items = [
    ...(index === null ? [] : [{ label: 'Focus session', run: wrap(() => { focusControlWindow(key) }) }]),
    { label: 'Copy session ID', run: wrap(() => { void writeClipboard(session.sessionId, renderer).catch(err => showNotice('error', String(err))) }) },
  ]
  if (!section && session) items.push({ label: 'Session actions…', run: wrap(() => openWindowControlMenu(key, anchor, 'session')) })
  if (!section && popoverTab) items.push(
    { label: 'Open as a window', run: wrap(() => popoverTabToWindow(popoverTab)) },
    { label: 'Open full screen', hint: '⌃⇧W', run: wrap(() => popoverTabToFullScreen(popoverTab)) },
  )
  if (!section && item?.kind === 'surface') {
    const kind = surfaceKindOf(item.surface)
    if (isPopoverWindowKind(kind)) items.push(
      { label: 'Open full screen', run: wrap(() => returnPopoverWindow(item.surface)) },
      { label: 'Open as a tab here', run: wrap(() => { const pin = windowSurfaceMeta[item.surface] ?? {}; returningPopoverRef.current = true; closeSurfaceWindow(item.surface, true); returningPopoverRef.current = false; openPopoverTab(kind, pin) }) },
      { label: 'Move to a new workspace', run: wrap(() => { const pin = windowSurfaceMeta[item.surface] ?? {}; returningPopoverRef.current = true; closeSurfaceWindow(item.surface, true); returningPopoverRef.current = false; openPopoverInNewTab(kind, pin) }) },
    )
    else {
      if (SURFACE_POPOVER_KINDS.has(kind)) items.push(
        { label: 'Open full screen', run: wrap(() => { closeSurfaceWindow(item.surface, true); setPopoverOpen(kind, true) }) },
        { label: 'Open as a tab here', run: wrap(() => { closeSurfaceWindow(item.surface, true); openPopoverTab(kind, {}) }) },
      )
      items.push({ label: 'Move to side panel', run: wrap(() => moveSurfaceToPanel(item.surface)) })
      if (MULTI_INSTANCE_SURFACES.has(kind)) items.push({ label: `Open another ${WINDOW_SURFACE_TITLES[kind].slice(2)} window`, run: wrap(() => openSurfaceWindow(kind, { another: true })) })
    }
  }
  if (section) items.push({ label: 'Back…', run: wrap(() => openWindowControlMenu(key, anchor)) })
  setContextMenu({ ...anchor, title: section ? `Window ${section}` : popoverTab ? fitText(windowSurfaceTitle(popoverTab), 34).trimEnd() : fitText(windowKeyTitle(key === 'reader' ? selectedSessionKey ?? key : key), 34).trimEnd(), items })
}

export type RestoreWindowSnapshotContext = {
  captureWindowLayout: () => { layout: { arrangement: WindowArrangement; orientation: SplitPaneOrientation; readerLast: boolean; readerShare: number; secondaryShare: number; bottomShare: number; weights: Partial<Record<WindowGroupKey, number[]>>; splitTree: WindowSplitTree | null; count: number; panes: string[]; surfaces: string[]; order: string[]; popoverTabs: string[]; activePopoverTab: string | null; stacks: string[][]; floating: { key: string; rect: FloatingRect; slot: number; } | null; surfaceMeta: { [x: string]: SurfaceMeta; }; primaryOpen: boolean; reader: string | null; zoom: number | 'reader' | null; fullscreen: boolean; coordinatorRunId: string | null; }; reader: Session | null; workspace: ProtocolRunSnapshot | null; workspaceRunId: string | null; tabs: Session[]; focus: number | null; panel: SurfacePanelState; panelOpen: boolean; }
  setCoordinatorWorkspace: React.Dispatch<React.SetStateAction<ProtocolRunSnapshot | null>>
  setCoordinatorWorkspaceRunId: React.Dispatch<React.SetStateAction<string | null>>
  windowSurfaces: string[]
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  surfacePanel: SurfacePanelState
  workspaceContext: WorkspaceContextValue
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  selectedSessionKey: string | null
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setWorkspaceReaderSession: (session: Session | null) => void
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setSplitArrangement: React.Dispatch<React.SetStateAction<WindowArrangement>>
  setSplitOrientation: React.Dispatch<React.SetStateAction<SplitPaneOrientation>>
  setSplitReaderLast: React.Dispatch<React.SetStateAction<boolean>>
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  setSplitBottomShare: React.Dispatch<React.SetStateAction<number>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  setPopoverTabs: React.Dispatch<React.SetStateAction<string[]>>
  setActivePopoverTab: React.Dispatch<React.SetStateAction<string | null>>
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  setWindowSurfaceMeta: React.Dispatch<React.SetStateAction<Record<string, SurfaceMeta>>>
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  setFullscreenMode: React.Dispatch<React.SetStateAction<boolean>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  setSurfacePanel: React.Dispatch<React.SetStateAction<SurfacePanelState>>
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function runRestoreWindowSnapshot(ctx: RestoreWindowSnapshotContext, previous: { layout: { arrangement: WindowArrangement; orientation: SplitPaneOrientation; readerLast: boolean; readerShare: number; secondaryShare: number; bottomShare: number; weights: Partial<Record<WindowGroupKey, number[]>>; splitTree: WindowSplitTree | null; count: number; panes: string[]; surfaces: string[]; order: string[]; popoverTabs: string[]; activePopoverTab: string | null; stacks: string[][]; floating: { key: string; rect: FloatingRect; slot: number; } | null; surfaceMeta: { [x: string]: SurfaceMeta; }; primaryOpen: boolean; reader: string | null; zoom: number | 'reader' | null; fullscreen: boolean; coordinatorRunId: string | null; }; reader: Session | null; workspace: ProtocolRunSnapshot | null; workspaceRunId: string | null; tabs: Session[]; focus: number | null; panel: import("/Users/lukeryan/Documents/src/agentViewer/tui/opentui/surfacePanelState").SurfacePanelState; panelOpen: boolean; }) {
  const {
    captureWindowLayout, setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, windowSurfaces,
    liveWindowStacks, floatingKey, surfacePanel, workspaceContext, setWindowSurfacePeek,
    setOpenTabSessions, selectedSessionKey, setWorkspaceHasSession, setWorkspaceReaderSession,
    setSelectedSessionKey, setSplitPinnedKeys, setSplitPaneCount, setWindowSplitTree,
    setSplitArrangement, setSplitOrientation, setSplitReaderLast, setSplitReaderShare,
    setSplitSecondaryShare, setSplitBottomShare, setSplitWeights, setWindowSurfaces,
    setWindowOrder, setPopoverTabs, setActivePopoverTab, setWindowStacks, setFloatingWindow,
    setWindowSurfaceMeta, setWindowZoom, setFullscreenMode, setSplitFocusIndex, setSurfacePanel,
    setSurfacePanelOpen, setSurfacePanelFocused, setError,
  } = ctx
  const layout = previous.layout
  setCoordinatorWorkspace(previous.workspace)
  setCoordinatorWorkspaceRunId(previous.workspaceRunId)
  // Layout undo moves views back, carrying edits made after the relocation.
  const currentViews = new Set([...windowSurfaces, ...liveWindowStacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey), ...(floatingKey && isSurfaceWindowKey(floatingKey) ? [surfaceIdOfKey(floatingKey)] : [])])
  const previousViews = new Set([...layout.surfaces, ...layout.stacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey), ...(layout.floating && isSurfaceWindowKey(layout.floating.key) ? [surfaceIdOfKey(layout.floating.key)] : [])])
  for (const panel of previous.panel.surfaces) if (!surfacePanel.surfaces.some(entry => entry.id === panel.id)) {
    const source = [...currentViews].find(id => surfaceKindOf(id) === panel.kind && !previousViews.has(id))
    if (source) copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(panel.kind, source), surfaceViewNamespace(panel.kind, undefined, panel.id))
  }
  for (const id of previousViews) if (!currentViews.has(id)) {
    const panel = surfacePanel.surfaces.find(entry => entry.kind === surfaceKindOf(id) && !previous.panel.surfaces.some(previousPanel => previousPanel.id === entry.id))
    if (panel) copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(panel.kind, undefined, panel.id), surfaceViewNamespace(panel.kind, id))
  }
  setWindowSurfacePeek(null)
  setOpenTabSessions((current) => {
    const keys = new Set(current.map(sessionKey))
    return [...current, ...previous.tabs.filter((tab) => !keys.has(sessionKey(tab)))]
  })
  // Set the reader before restoring pins; its normal swap plan must not
  // overwrite the saved order. The reconciler will see valid pins next render.
  if (previous.reader && layout.reader !== selectedSessionKey) { setWorkspaceHasSession(true); setWorkspaceReaderSession(previous.reader); setSelectedSessionKey(layout.reader) }
  setSplitPinnedKeys(layout.panes)
  setSplitPaneCount(layout.count)
  setWindowSplitTree(layout.splitTree ?? null)
  setSplitArrangement(layout.arrangement)
  setSplitOrientation(layout.orientation)
  setSplitReaderLast(layout.readerLast)
  setSplitReaderShare(layout.readerShare)
  setSplitSecondaryShare(layout.secondaryShare)
  setSplitBottomShare(layout.bottomShare)
  setSplitWeights(layout.weights ?? {})
  setWindowSurfaces(layout.surfaces)
  setWindowOrder(layout.order ?? [])
  setPopoverTabs(layout.popoverTabs ?? []); setActivePopoverTab(layout.activePopoverTab ?? null)
  setWindowStacks(layout.stacks ?? [])
  setFloatingWindow(layout.floating ?? null)
  setWindowSurfaceMeta(layout.surfaceMeta ?? {})
  setWindowZoom(layout.zoom)
  setFullscreenMode(layout.fullscreen)
  setSplitFocusIndex(previous.focus)
  setSurfacePanel(previous.panel)
  setSurfacePanelOpen(previous.panelOpen)
  setSurfacePanelFocused(false)
  void Promise.all([
    writeTuiSplitPanes(layout.count),
    writeTuiSplitOrientation(layout.orientation),
    writeTuiSplitReaderShare(layout.readerShare),
    writeTuiWindowArrangement({ arrangement: layout.arrangement, readerLast: layout.readerLast, secondaryShare: layout.secondaryShare, bottomShare: layout.bottomShare, weights: layout.weights ?? {} }),
  ]).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store restored layout'))
}

export type ApplySplitPaneCountContext = {
  checkpointWindowLayout: () => void
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  windowSplitTree: WindowSplitTree | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  splitOrientation: SplitPaneOrientation
  mainContentHeight: number
  readerAreaWidth: number
  splitCandidateSessions: Session[]
  splitReaderShare: number
}

export function runApplySplitPaneCount(ctx: ApplySplitPaneCountContext, next: number, label?: string, orientation?: SplitPaneOrientation) {
  const {
    checkpointWindowLayout, setSplitPaneCount, setError, windowSplitTree, showNotice,
    splitOrientation, mainContentHeight, readerAreaWidth, splitCandidateSessions, splitReaderShare,
  } = ctx
  checkpointWindowLayout()
  setSplitPaneCount(next)
  void writeTuiSplitPanes(next).catch((err) => {
    setError(err instanceof Error ? err.message : 'Failed to store split view setting')
  })
  if (windowSplitTree) {
    showNotice('info', label ?? `${next} session pane${next === 1 ? '' : 's'} open`)
    return
  }
  if (next === 0) {
    showNotice('info', label ?? 'Split transcript view off')
    return
  }
  // Narrate the requested NEXT layout. Reading splitPaneWidth here would use
  // the previous render, which made the first successful split falsely claim
  // that even wide terminals were too narrow.
  // Project against the orientation being applied, not the one still in
  // state: an orientation change and a pane add land in the same keystroke,
  // and reading the rendered axis here told a working stacked split it had
  // no room.
  const nextStacked = (orientation ?? splitOrientation) === 'rows'
  const nextLayout = calculateSplitPaneLayout({
    availableExtent: nextStacked ? Math.max(mainContentHeight - 2, 8) : readerAreaWidth,
    requestedCount: next,
    availableCount: Math.min(next, splitCandidateSessions.length),
    maxPanes: SPLIT_PANE_MAX,
    minPaneExtent: nextStacked ? SPLIT_PANE_MIN_ROWS : SPLIT_PANE_MIN_WIDTH,
    minReaderExtent: nextStacked ? MIN_READER_ROWS : MIN_READER_WIDTH,
    readerShare: splitReaderShare,
  })
  if (nextLayout.visibleCount < next) {
    // Stacked is the escape hatch from a narrow terminal, so offer it rather
    // than only saying "widen the terminal".
    showNotice('info', nextStacked
      ? `Split panes: ${nextLayout.visibleCount}/${next} visible (terminal too short — ⌃B % for side-by-side)`
      : `Split panes: ${nextLayout.visibleCount}/${next} visible (⌃B " to stack instead, or hide the rail with h)`)
    return
  }
  showNotice('info', label ?? (
    RUNNING_INSIDE_TMUX
      ? `Split panes: ${next} · use ? palette (tmux captures ⌃B)`
      : `Split panes: ${next} · ⌃B o next pane · ⌃B x close`
  ))
}

export type OpenSurfaceWindowContext = {
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  surfacePanel: SurfacePanelState
  windowSurfaces: string[]
  pendingSurfaceFocusRef: React.RefObject<string | null>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  popoverTabs: string[]
  parkedWindowKeysRef: React.RefObject<Set<string>>
  checkpointWindowLayout: () => void
  pluginOverlay: 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  workspaceContext: WorkspaceContextValue
  windowShellSelectionRef: React.MutableRefObject<Map<string, string | null>>
  setSurfacePanel: React.Dispatch<React.SetStateAction<SurfacePanelState>>
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setWindowSurfaceMeta: React.Dispatch<React.SetStateAction<Record<string, SurfaceMeta>>>
  gitRepoCwd: string
  windowSplitTree: WindowSplitTree | null
  splitArrangement: WindowArrangement
  splitPaneCount: number
  setWindowArrangement: (arrangement: WindowArrangement, readerLast: boolean) => void
  splitReaderLast: boolean
}

export function runOpenSurfaceWindow(ctx: OpenSurfaceWindowContext, kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string }) {
  const {
    showNotice, surfacePanel, windowSurfaces, pendingSurfaceFocusRef, setFocusedPane,
    setWindowSurfaces, popoverTabs, parkedWindowKeysRef, checkpointWindowLayout, pluginOverlay,
    workspaceContext, windowShellSelectionRef, setSurfacePanel, setSurfacePanelOpen,
    setSurfacePanelFocused, setWindowSurfaceMeta, gitRepoCwd, windowSplitTree, splitArrangement,
    splitPaneCount, setWindowArrangement, splitReaderLast,
  } = ctx
  if (options === undefined) options = {}
  if (isPluginSurfaceId(kind) && !isPluginEnabled(getPluginSurface(kind).pluginId)) {
    showNotice('info', `${getPluginSurface(kind).title.slice(2)} is off · turn its plugin on in Plugins (⌃K palette)`)
    return
  }
  const activePanel = activeSurface(surfacePanel)
  const movingPanel = options.fromPanelId ? surfacePanel.surfaces.find(entry => entry.id === options.fromPanelId && entry.kind === kind) : !options.another && activePanel?.kind === kind ? activePanel : null
  const existing = windowSurfaces.find((entry) => surfaceKindOf(entry) === kind)
  if (existing && !movingPanel && !(options.another && MULTI_INSTANCE_SURFACES.has(kind))) {
    pendingSurfaceFocusRef.current = existing
    setFocusedPane('messages')
    setWindowSurfaces((current) => [...current])
    return
  }
  let surface: WindowSurfaceId = kind
  // Ids held by background tabs and the floating window are taken too.
  const taken = new Set([...windowSurfaces, ...popoverTabs, ...[...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)])
  for (let instance = 2; taken.has(surface); instance += 1) surface = `${kind}#${instance}`
  checkpointWindowLayout()
  if (!movingPanel && pluginOverlay === kind) copySurfaceViewState(workspaceContext.runtime, 'root', surfaceViewNamespace(kind, surface), isPluginSurfaceId(kind) ? getPluginSurface(kind).pluginId : undefined)
  const remaining = surfacePanel.surfaces.filter((entry) => entry.id !== movingPanel?.id)
  if (movingPanel) {
    copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(kind, undefined, movingPanel.id), surfaceViewNamespace(kind, surface))
    const selected = workspaceContext.runtime.values.get(`${surfaceViewNamespace(kind, surface)}:process:selectedId`)
    if (typeof selected === 'string') windowShellSelectionRef.current.set(surface, selected)
    setSurfacePanel(current => closeSurfaceIn(current, movingPanel.id))
  }
  // A panel with nothing left in it would only take width from the windows.
  if (movingPanel && remaining.length === 0) setSurfacePanelOpen(false)
  setSurfacePanelFocused(false)
  setWindowSurfaces((current) => (current.includes(surface) ? current : [...current, surface]))
  setWindowSurfaceMeta(current => ({ ...current, [surface]: { ...current[surface], cwd: movingPanel?.cwd ?? gitRepoCwd } }))
  // A split holds two windows; a surface beyond that needs a stack or grid to appear.
  if (!windowSplitTree && splitArrangement === 'split' && splitPaneCount + windowSurfaces.length + 1 > SPLIT_PANE_MAX) setWindowArrangement('main-stack', splitReaderLast)
  // Focused once the layout has placed it: until then its index is unknown,
  // because opening it may drop a session pane to make room.
  pendingSurfaceFocusRef.current = surface
  setFocusedPane('messages')
  showNotice('info', `${surfaceTitle(surface)} in a window · ⇥ panel puts it back`)
}

export type CloseWindowSessionTabContext = {
  openTabSessions: Session[]
  orderedWindowKeys: string[]
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  windowStackFor: (key: string) => WindowStack | null
  closeWindowTab: (key: string, remember?: boolean) => void
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  checkpointWindowLayout: () => void
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  closeFloatingWindow: (remember?: boolean) => void
  windowItems: WindowItem[]
  closeSplitPane: (paneIndex?: number) => void
  commitWindowKeys: (keys: string[], tree?: WindowSplitTree) => void
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
}

export function runCloseWindowSessionTab(ctx: CloseWindowSessionTabContext, session: Session) {
  const {
    openTabSessions, orderedWindowKeys, liveWindowStacks, floatingKey, windowStackFor,
    closeWindowTab, setOpenTabSessions, floatingWindow, checkpointWindowLayout, setFloatingWindow,
    setSelectedSessionKey, closeFloatingWindow, windowItems, closeSplitPane, commitWindowKeys,
    setWindowStacks,
  } = ctx
  const key = sessionKey(session)
  const index = openTabSessions.findIndex(tab => sessionKey(tab) === key)
  const rest = openTabSessions.filter(tab => sessionKey(tab) !== key)
  const at = Math.min(Math.max(index, 0), rest.length)
  // A replacement must be unowned: taking a floating window or another
  // frame's background tab would make the same transcript appear twice.
  const onScreen = new Set([...orderedWindowKeys, ...liveWindowStacks.flat(), ...(floatingKey ? [floatingKey] : [])])
  const next = [...rest.slice(at), ...rest.slice(0, at).reverse()].find(tab => !onScreen.has(sessionKey(tab)))
  if (windowStackFor(key)) {
    closeWindowTab(key)
    setOpenTabSessions(rest)
    return
  }
  if (floatingKey === key) {
    if (next && floatingWindow) {
      checkpointWindowLayout()
      setFloatingWindow({ ...floatingWindow, key: sessionKey(next) })
      setSelectedSessionKey(sessionKey(next))
    } else {
      closeFloatingWindow()
      if (!windowItems.length) setSelectedSessionKey(null)
    }
    setOpenTabSessions(rest)
    return
  }
  const windowIndex = windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === key)
  if (!next || windowIndex < 0) {
    if (windowIndex >= 0) closeSplitPane(windowIndex)
    setOpenTabSessions(rest)
    return
  }
  checkpointWindowLayout()
  const nextKey = sessionKey(next)
  commitWindowKeys(orderedWindowKeys.map(entry => entry === key ? nextKey : entry))
  setWindowStacks(liveWindowStacks.map(stack => stack.map(entry => entry === key ? nextKey : entry)))
  setOpenTabSessions(rest)
  setSelectedSessionKey(nextKey)
}

export type SplitFocusedWindowContext = {
  splitFocusIndex: number | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  orderedWindowKeys: string[]
  windowZoom: number | 'reader' | null
  fullscreenMode: boolean
  visibleSplitPaneCount: number
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  splitCandidateSessions: Session[]
  parkedWindowKeysRef: React.RefObject<Set<string>>
  windowSurfaces: string[]
  popoverTabs: string[]
  fittedWindows: WindowLayout
  readerAreaWidth: number
  windowAreaHeight: number
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  reconciledSplitTree: WindowSplitTree | null
  primaryLeaf: boolean
  popoverHostSlot: number
  splitTreeLimits: { paneWidth: number; paneRows: number; readerWidth: number; readerRows: number; }
  checkpointWindowLayout: () => void
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  splitPinnedSessions: Session[]
  splitPaneCount: number
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  pendingSurfaceFocusRef: React.RefObject<string | null>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
}

export function runSplitFocusedWindow(ctx: SplitFocusedWindowContext, orientation: SplitPaneOrientation, target?: number | null) {
  const {
    splitFocusIndex, showNotice, orderedWindowKeys, windowZoom, fullscreenMode,
    visibleSplitPaneCount, rectOf, splitCandidateSessions, parkedWindowKeysRef, windowSurfaces,
    popoverTabs, fittedWindows, readerAreaWidth, windowAreaHeight, splitOrientation,
    splitReaderLast, reconciledSplitTree, primaryLeaf, popoverHostSlot, splitTreeLimits,
    checkpointWindowLayout, setWindowSplitTree, setWindowOrder, splitPinnedSessions,
    splitPaneCount, setSplitPinnedKeys, setSplitPaneCount, setWindowSurfaces,
    pendingSurfaceFocusRef, setSurfacePanelFocused, setFocusedPane, setSplitFocusIndex,
  } = ctx
  if (target === undefined) target = splitFocusIndex
  if (target === FLOATING_PANE_INDEX) { showNotice('info', 'Dock the floating window before splitting it'); return }
  if (orderedWindowKeys.length >= 31) { showNotice('info', 'This workspace has reached its 32-window limit'); return }
  if (windowZoom !== null || fullscreenMode) { showNotice('info', 'Restore the layout before splitting a window'); return }
  if (visibleSplitPaneCount !== orderedWindowKeys.length) { showNotice('info', 'Enlarge the terminal to show all windows before adding a split'); return }
  const axis = orientation === 'columns' ? 'x' : 'y'
  const targetRect = rectOf(target === null ? 'transcript-reader' : `split-pane:${target}`)
  const targetMinimum = axis === 'x' ? (target === null ? MIN_READER_WIDTH : SPLIT_PANE_MIN_WIDTH) : (target === null ? MIN_READER_ROWS : SPLIT_PANE_MIN_ROWS)
  const addedMinimum = axis === 'x' ? SPLIT_PANE_MIN_WIDTH : SPLIT_PANE_MIN_ROWS
  if (!targetRect || (axis === 'x' ? targetRect.width : targetRect.height) < targetMinimum + addedMinimum) {
    showNotice('info', `That window is too ${axis === 'x' ? 'narrow' : 'short'} to split · enlarge it first`); return
  }
  const candidate = splitCandidateSessions.find(session => !orderedWindowKeys.includes(sessionKey(session)) && !parkedWindowKeysRef.current.has(sessionKey(session)))
  const taken = new Set([...windowSurfaces, ...popoverTabs, ...[...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)])
  const surface = candidate ? null : nextSurfaceId('terminal', taken)
  const key = candidate ? sessionKey(candidate) : surfaceWindowKey(surface!)
  const keys = [...orderedWindowKeys, key]
  const rects = windowLayoutRects(fittedWindows, { width: readerAreaWidth, height: windowAreaHeight, orientation: splitOrientation, readerLast: splitReaderLast })
  const root = reconciledSplitTree?.root ?? splitTreeFromRects(rects.map((rect, index) => ({ ...rect, slot: index - 1 })))
  const next: WindowSplitTree = { ...(primaryLeaf ? {} : { primary: false }), keys, root: splitWindowLeaf(root, target ?? popoverHostSlot, orderedWindowKeys.length, axis) }
  const result = computeWindowSplitTree(next, readerAreaWidth, windowAreaHeight, splitTreeLimits)
  if (result.layout.visibleCount !== keys.length) { showNotice('info', `That window is too ${axis === 'x' ? 'narrow' : 'short'} to split · enlarge it first`); return }
  checkpointWindowLayout()
  setWindowSplitTree(next)
  setWindowOrder(keys)
  if (candidate) {
    const pins = [...splitPinnedSessions.slice(0, splitPaneCount).map(sessionKey), key]
    setSplitPinnedKeys(pins)
    setSplitPaneCount(pins.length)
    void writeTuiSplitPanes(pins.length).catch(() => {})
  } else {
    setWindowSurfaces(current => [...current, surface!])
    pendingSurfaceFocusRef.current = surface!
  }
  setSurfacePanelFocused(false)
  setFocusedPane('messages')
  setSplitFocusIndex(orderedWindowKeys.length)
  showNotice('info', `${orientation === 'columns' ? 'Split right' : 'Split below'} · ${candidate ? formatSessionTitle(candidate) : 'new shell window'}`)
}

export type TabWindowOntoContext = {
  shownPopoverTab: string | null
  checkpointWindowLayout: () => void
  liveWindowStacks: WindowStack[]
  laidOutWindowKeys: Set<string>
  currentPaneTree: () => WindowSplitTree
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  orderedWindowKeys: string[]
  commitWindowKeys: (keys: string[], tree?: WindowSplitTree) => void
  setOverviewPendingTarget: React.Dispatch<React.SetStateAction<string | null>>
  openTabByKey: Map<string, Session>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  floatingKey: string | null
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  shownFirstWindowKeys: () => string[]
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  windowKeyTitle: (key: string) => string
}

export function runTabWindowOnto(ctx: TabWindowOntoContext, key: string, anchor: string, session?: Session) {
  const {
    shownPopoverTab, checkpointWindowLayout, liveWindowStacks, laidOutWindowKeys, currentPaneTree,
    closePopoverTab, setWindowZoom, setWindowStacks, orderedWindowKeys, commitWindowKeys,
    setOverviewPendingTarget, openTabByKey, setOpenTabSessions, floatingKey, setFloatingWindow,
    shownFirstWindowKeys, showNotice, windowKeyTitle,
  } = ctx
  if (key === anchor) return
  const primaryKey = shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null
  if (primaryKey && key === primaryKey) {
    checkpointWindowLayout()
    const frame = stackOf(liveWindowStacks, anchor)?.find(member => laidOutWindowKeys.has(member)) ?? anchor
    if (!laidOutWindowKeys.has(frame)) return
    const base = removePrimaryWindow(currentPaneTree())
    if (!base) return
    if (shownPopoverTab) closePopoverTab(shownPopoverTab, true)
    setWindowZoom(null)
    setWindowStacks(addToStack(liveWindowStacks, anchor, key))
    const keys = replaceWindowKey(orderedWindowKeys, frame, key)
    commitWindowKeys(keys, reconcileWindowSplitTree(base, keys, false))
    setOverviewPendingTarget(key)
    return
  }
  if (primaryKey && anchor === primaryKey) {
    checkpointWindowLayout()
    if (session && !openTabByKey.has(key)) setOpenTabSessions(current => [...current, session])
    const next = replacePrimaryWindow(currentPaneTree(), key)
    if (shownPopoverTab) closePopoverTab(shownPopoverTab, true)
    setWindowStacks(addToStack(liveWindowStacks, anchor, key))
    if (floatingKey === key) setFloatingWindow(null)
    commitWindowKeys(next.keys, next)
    setOverviewPendingTarget(key)
    return
  }
  const frame = stackOf(liveWindowStacks, anchor)?.find((member) => laidOutWindowKeys.has(member)) ?? anchor
  if (!laidOutWindowKeys.has(frame)) return
  checkpointWindowLayout()
  if (session && !openTabByKey.has(key)) setOpenTabSessions((prev) => prev.some(tab => sessionKey(tab) === sessionKey(session)) ? prev : [...prev, session])
  if (floatingKey === key) setFloatingWindow(null)
  setWindowStacks(addToStack(liveWindowStacks, anchor, key))
  commitWindowKeys(replaceWindowKey(shownFirstWindowKeys().filter((entry) => entry !== key), frame, key))
  showNotice('info', `${fitText(windowKeyTitle(key), 40).trimEnd()} · a tab of ${fitText(windowKeyTitle(anchor), 30).trimEnd()}`)
}

export type ReopenClosedWindowContext = {
  closedWindows: { key: string; snapshot: ReturnType<() => { layout: { arrangement: WindowArrangement; orientation: SplitPaneOrientation; readerLast: boolean; readerShare: number; secondaryShare: number; bottomShare: number; weights: Partial<Record<WindowGroupKey, number[]>>; splitTree: WindowSplitTree | null; count: number; panes: string[]; surfaces: string[]; order: string[]; popoverTabs: string[]; activePopoverTab: string | null; stacks: string[][]; floating: { key: string; rect: FloatingRect; slot: number; } | null; surfaceMeta: { [x: string]: SurfaceMeta; }; primaryOpen: boolean; reader: string | null; zoom: number | 'reader' | null; fullscreen: boolean; coordinatorRunId: string | null; }; reader: Session | null; workspace: ProtocolRunSnapshot | null; workspaceRunId: string | null; tabs: Session[]; focus: number | null; panel: SurfacePanelState; panelOpen: boolean; }>; }[]
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  orderedWindowKeys: string[]
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  setClosedWindows: React.Dispatch<React.SetStateAction<{ key: string; snapshot: ReturnType<() => { layout: { arrangement: WindowArrangement; orientation: SplitPaneOrientation; readerLast: boolean; readerShare: number; secondaryShare: number; bottomShare: number; weights: Partial<Record<WindowGroupKey, number[]>>; splitTree: WindowSplitTree | null; count: number; panes: string[]; surfaces: string[]; order: string[]; popoverTabs: string[]; activePopoverTab: string | null; stacks: string[][]; floating: { key: string; rect: FloatingRect; slot: number; } | null; surfaceMeta: { [x: string]: SurfaceMeta; }; primaryOpen: boolean; reader: string | null; zoom: number | 'reader' | null; fullscreen: boolean; coordinatorRunId: string | null; }; reader: Session | null; workspace: ProtocolRunSnapshot | null; workspaceRunId: string | null; tabs: Session[]; focus: number | null; panel: SurfacePanelState; panelOpen: boolean; }>; }[]>>
  checkpointWindowLayout: () => void
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setPopoverTabs: React.Dispatch<React.SetStateAction<string[]>>
  setWindowSurfaceMeta: React.Dispatch<React.SetStateAction<Record<string, SurfaceMeta>>>
  setActivePopoverTab: React.Dispatch<React.SetStateAction<string | null>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  teammatesOpen: boolean
  openTeammatesPanel: () => void
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  commitWindowKeys: (keys: string[], tree?: WindowSplitTree) => void
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setOverviewPendingTarget: React.Dispatch<React.SetStateAction<string | null>>
}

export function runReopenClosedWindow(ctx: ReopenClosedWindowContext) {
  const {
    closedWindows, showNotice, orderedWindowKeys, liveWindowStacks, floatingKey, setClosedWindows,
    checkpointWindowLayout, setOpenTabSessions, setPopoverTabs, setWindowSurfaceMeta,
    setActivePopoverTab, setSplitFocusIndex, teammatesOpen, openTeammatesPanel, setWindowStacks,
    commitWindowKeys, setFloatingWindow, setWindowSplitTree, setOverviewPendingTarget,
  } = ctx
  const closed = closedWindows.at(-1)
  if (!closed) { showNotice('info', 'No closed panes to reopen'); return }
  const saved = closed.snapshot, key = closed.key
  const existing = new Set([...orderedWindowKeys, ...liveWindowStacks.flat(), floatingKey])
  setClosedWindows(previous => previous.slice(0, -1))
  if (existing.has(key)) { showNotice('info', 'That pane is already open'); return }
  checkpointWindowLayout()
  setOpenTabSessions(current => [...current, ...saved.tabs.filter(tab => !current.some(entry => sessionKey(entry) === sessionKey(tab)))])
  if (isSurfaceWindowKey(key) && (saved.layout.popoverTabs ?? []).includes(surfaceIdOfKey(key))) {
    const id = surfaceIdOfKey(key)
    setPopoverTabs(current => current.includes(id) ? current : [...current, id])
    setWindowSurfaceMeta(current => ({ ...current, [id]: saved.layout.surfaceMeta[id] ?? {} }))
    setActivePopoverTab(id); setSplitFocusIndex(null)
    if (surfaceKindOf(id) === 'teammates' && !teammatesOpen) openTeammatesPanel()
    showNotice('info', 'Closed tab reopened')
    return
  }
  const oldStack = saved.layout.stacks.find(stack => stack.includes(key))
  const anchor = oldStack?.find(member => existing.has(member))
  if (anchor) {
    setWindowStacks(addToStack(liveWindowStacks, anchor, key))
    const frame = liveWindowStacks.find(stack => stack.includes(anchor))?.find(member => orderedWindowKeys.includes(member)) ?? anchor
    commitWindowKeys(replaceWindowKey(orderedWindowKeys, frame, key))
  } else if (saved.layout.floating?.key === key && !floatingKey) setFloatingWindow(saved.layout.floating)
  else {
    const keys = [...orderedWindowKeys]
    const oldKeys = orderWindows(saved.layout.order, saved.layout.panes.slice(0, saved.layout.count), saved.layout.surfaces)
    keys.splice(Math.max(0, Math.min(oldKeys.indexOf(key), keys.length)), 0, key)
    commitWindowKeys(keys)
    if (saved.layout.splitTree && keys.length === oldKeys.length && keys.every((entry, index) => entry === oldKeys[index])) setWindowSplitTree(saved.layout.splitTree)
  }
  if (isSurfaceWindowKey(key) && saved.layout.surfaceMeta[surfaceIdOfKey(key)]) setWindowSurfaceMeta(current => ({ ...current, [surfaceIdOfKey(key)]: saved.layout.surfaceMeta[surfaceIdOfKey(key)]! }))
  setOverviewPendingTarget(key)
  showNotice('info', 'Closed pane reopened')
}

export type DropSessionOnSurfaceWindowContext = {
  windowItems: WindowItem[]
  swapWindows: (a: number, b: number) => void
  checkpointWindowLayout: () => void
  applyWindowOrder: (next: string[]) => void
  shownFirstWindowKeys: () => string[]
  splitPinnedKeys: string[]
  splitPaneCount: number
  splitArrangement: WindowArrangement
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  stackedSplit: boolean
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setWindowArrangement: (arrangement: WindowArrangement, readerLast: boolean) => void
  applySplitOrientation: (next: SplitPaneOrientation, quiet?: boolean) => void
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
}

export function runDropSessionOnSurfaceWindow(ctx: DropSessionOnSurfaceWindowContext, session: Session, index: number, edge: WindowDropZone | null, fromPane: number | null) {
  const {
    windowItems, swapWindows, checkpointWindowLayout, applyWindowOrder, shownFirstWindowKeys,
    splitPinnedKeys, splitPaneCount, splitArrangement, splitOrientation, splitReaderLast,
    stackedSplit, showNotice, setOpenTabSessions, setWindowArrangement, applySplitOrientation,
    setSplitPaneCount, setWindowOrder, setSplitPinnedKeys,
  } = ctx
  const key = sessionKey(session)
  const surface = windowItems[index]
  if (!surface || surface.kind !== 'surface') return
  if (fromPane !== null && windowItems[fromPane]?.kind === 'session') {
    if (!edge) { swapWindows(fromPane, index); return }
    checkpointWindowLayout()
    applyWindowOrder(moveWindowBeside(shownFirstWindowKeys(), key, surfaceWindowKey(surface.surface), edge === 'left' || edge === 'top'))
    return
  }
  if (splitPinnedKeys.slice(0, splitPaneCount).includes(key)) {
    checkpointWindowLayout()
    applyWindowOrder(moveWindowBeside(shownFirstWindowKeys(), key, surfaceWindowKey(surface.surface), edge === 'left' || edge === 'top'))
    return
  }
  const plan = planWindowSessionDrop({
    arrangement: splitArrangement, orientation: splitOrientation,
    readerLast: splitReaderLast, count: splitPaneCount, pins: splitPinnedKeys,
  }, key, { kind: 'edge', zone: splitReaderLast ? 'left' : stackedSplit ? 'bottom' : 'right' })
  if (!plan) { showNotice('info', 'The layout is full · drop on a session pane to replace it'); return }
  checkpointWindowLayout()
  setOpenTabSessions((prev) => prev.some((tab) => sessionKey(tab) === key) ? prev : [...prev, session])
  setWindowArrangement(plan.arrangement, plan.readerLast)
  applySplitOrientation(plan.orientation, true)
  setSplitPaneCount(plan.count)
  void writeTuiSplitPanes(plan.count).catch(() => {})
  const anchor = surfaceWindowKey(surface.surface)
  const withSession = [...shownFirstWindowKeys().filter((entry) => entry !== key), key]
  const nextOrder = moveWindowBeside(withSession, key, anchor, edge === 'left' || edge === 'top')
  setWindowOrder(nextOrder)
  const sessionsInOrder = nextOrder.filter((entry) => !isSurfaceWindowKey(entry))
  setSplitPinnedKeys([...sessionsInOrder, ...plan.pins.filter((pin) => !sessionsInOrder.includes(pin))])
  showNotice('info', `${fitText(formatSessionTitle(session), 40).trimEnd()} · beside ${surfaceTitle(surface.surface)}`)
}

export type DragSplitDividerContext = {
  splitDividerPoint: { x: number; y: number; } | null
  checkpointWindowLayout: () => void
  windowAreaRect: () => { x: number; y: number; width: number; height: number; } | null
  setSplitDividerPoint: React.Dispatch<React.SetStateAction<{ x: number; y: number; } | null>>
  splitDividerDragging: 'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null
  fittedWindows: WindowLayout
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
  splitSecondaryShare: number
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  stackedSplit: boolean
  splitReaderLast: boolean
  splitReaderShare: number
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
}

export function runDragSplitDivider(ctx: DragSplitDividerContext, event: { x: number; y: number }) {
  const {
    splitDividerPoint, checkpointWindowLayout, windowAreaRect, setSplitDividerPoint,
    splitDividerDragging, fittedWindows, rectOf, setSplitWeights, splitSecondaryShare,
    setSplitSecondaryShare, stackedSplit, splitReaderLast, splitReaderShare, setSplitReaderShare,
  } = ctx
  if (splitDividerPoint === null) checkpointWindowLayout()
  const area = windowAreaRect()
  if (!area) return
  setSplitDividerPoint({ x: event.x, y: event.y })
  if (splitDividerDragging && typeof splitDividerDragging === 'object') {
    // A border inside a group: the cell under the pointer becomes the last
    // cell of the frame before it; the frame after it takes up the rest of the pair.
    const { group: groupKey, index } = splitDividerDragging
    const group = fittedWindows.groups.find((entry) => entry.key === groupKey)
    const rects = group?.members.map((member) => rectOf(`split-pane:${member}`)) ?? []
    if (!group || rects.some((rect) => !rect)) return
    const horizontal = group.axis === 'x'
    const extents = rects.map((rect) => (horizontal ? rect!.width : rect!.height))
    const before = rects[index]!
    const combined = extents[index]! + extents[index + 1]!
    const min = horizontal ? SPLIT_PANE_MIN_WIDTH : SPLIT_PANE_MIN_ROWS
    const first = Math.max(min, Math.min(combined - min, (horizontal ? event.x - before.x : event.y - before.y) + 1))
    if (first === extents[index]) return
    extents[index] = first
    extents[index + 1] = combined - first
    setSplitWeights((current) => ({ ...current, [groupKey]: extents }))
    return
  }
  if (splitDividerDragging === 'secondary') {
    // The row the pointer is on becomes the first frame's bottom border.
    const next = Math.min(0.8, Math.max(0.2, Math.round(((event.y - area.y + 1) / Math.max(1, area.height)) * 100) / 100))
    if (next !== splitSecondaryShare) setSplitSecondaryShare(next)
    return
  }
  const share = readerShareAt(area, stackedSplit ? event.y : event.x, stackedSplit ? 'y' : 'x', splitReaderLast)
  const next = Math.min(SPLIT_SHARE_MAX, Math.max(SPLIT_SHARE_MIN, Math.round(share * 100) / 100))
  if (next !== splitReaderShare) setSplitReaderShare(next)
}

export type ResizeSplitReaderContext = {
  reconciledSplitTree: WindowSplitTree | null
  checkpointWindowLayout: () => void
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  resizeTreeWindow: (slot: number, direction: 1 | -1) => void
  visibleSplitPaneCount: number
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  splitReaderShare: number
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  splitOrientation: SplitPaneOrientation
}

export function runResizeSplitReader(ctx: ResizeSplitReaderContext, direction: 1 | -1 | 0) {
  const {
    reconciledSplitTree, checkpointWindowLayout, setWindowSplitTree, resizeTreeWindow,
    visibleSplitPaneCount, showNotice, splitReaderShare, setSplitReaderShare, setError,
    splitOrientation,
  } = ctx
  if (reconciledSplitTree) {
    if (direction === 0) { checkpointWindowLayout(); setWindowSplitTree({ ...reconciledSplitTree, root: evenWindowSplitTree(reconciledSplitTree.root) }) }
    else resizeTreeWindow(-1, direction)
    return
  }
  checkpointWindowLayout()
  if (visibleSplitPaneCount === 0) {
    showNotice('error', 'No split panes open (⌃B % to split)')
    return
  }
  const next = direction === 0
    ? SPLIT_SHARE_EVEN
    : adjustSplitReaderShare(
      splitReaderShare,
      direction * SPLIT_SHARE_STEP,
      evenSplitReaderShare(visibleSplitPaneCount),
    )
  if (next === splitReaderShare) {
    showNotice('info', direction === 0
      ? 'Split sizes are already even'
      : direction > 0 ? 'Reader is already at its widest' : 'Reader is already at its narrowest')
    return
  }
  setSplitReaderShare(next)
  void writeTuiSplitReaderShare(next).catch((err) => {
    setError(err instanceof Error ? err.message : 'Failed to store split ratio')
  })
  showNotice('info', next === SPLIT_SHARE_EVEN
    ? 'Split ratio: even'
    : `Reader ${Math.round(next * 100)}% of the ${splitOrientation === 'rows' ? 'height' : 'width'}`)
}

export type CancelPointerGestureContext = {
  treeDividerDrag: string | null
  setTreeDividerDrag: React.Dispatch<React.SetStateAction<string | null>>
  treeDividerActivePathRef: React.RefObject<string | null>
  treeDividerCheckpointedRef: React.RefObject<boolean>
  undoWindowLayout: () => void
  floatGestureRef: React.RefObject<{ mode: 'move' | 'resize'; x: number; y: number; rect: FloatingRect; moved?: boolean; } | null>
  setFloatGesturing: React.Dispatch<React.SetStateAction<boolean>>
  setFloatDockHint: React.Dispatch<React.SetStateAction<{ label: string; rect: { x: number; y: number; width: number; height: number; }; x: number; y: number; } | null>>
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  sessionPressRef: React.RefObject<{ session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; x: number; y: number; dragging: boolean; onClick?: () => void; } | null>
  setSessionPressing: React.Dispatch<React.SetStateAction<boolean>>
  setSessionDrag: React.Dispatch<React.SetStateAction<{ session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title?: boolean; x: number; y: number; } | null>>
  splitDividerDragging: 'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null
  splitDividerPoint: { x: number; y: number; } | null
  setSplitDividerDragging: React.Dispatch<React.SetStateAction<'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null>>
  setSplitDividerPoint: React.Dispatch<React.SetStateAction<{ x: number; y: number; } | null>>
}

export function runCancelPointerGesture(ctx: CancelPointerGestureContext) {
  const {
    treeDividerDrag, setTreeDividerDrag, treeDividerActivePathRef, treeDividerCheckpointedRef,
    undoWindowLayout, floatGestureRef, setFloatGesturing, setFloatDockHint, setFloatingWindow,
    sessionPressRef, setSessionPressing, setSessionDrag, splitDividerDragging, splitDividerPoint,
    setSplitDividerDragging, setSplitDividerPoint,
  } = ctx
  if (treeDividerDrag !== null) {
    setTreeDividerDrag(null)
    treeDividerActivePathRef.current = null
    if (treeDividerCheckpointedRef.current) undoWindowLayout()
    treeDividerCheckpointedRef.current = false
    return true
  }
  if (floatGestureRef.current) {
    const gesture = floatGestureRef.current
    floatGestureRef.current = null
    setFloatGesturing(false)
    setFloatDockHint(null)
    setFloatingWindow((current) => current ? { ...current, rect: gesture.rect } : current)
    return true
  }
  if (sessionPressRef.current?.dragging) {
    sessionPressRef.current = null
    setSessionPressing(false)
    setSessionDrag(null)
    return true
  }
  if (splitDividerDragging) {
    const moved = splitDividerPoint !== null
    setSplitDividerDragging(null)
    setSplitDividerPoint(null)
    if (moved) undoWindowLayout()
    return true
  }
  return false
}

export type NestedDropPlanContext = {
  windowZoom: number | 'reader' | null
  fullscreenMode: boolean
  orderedWindowKeys: string[]
  fittedWindowKeys: string[]
  windowItems: WindowItem[]
  windowItemKey: (item: WindowItem) => string
  fittedWindows: WindowLayout
  readerAreaWidth: number
  windowAreaHeight: number
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  reconciledSplitTree: WindowSplitTree | null
  windowStackFor: (key: string) => WindowStack | null
  shownPopoverTab: string | null
  splitTreeLimits: { paneWidth: number; paneRows: number; readerWidth: number; readerRows: number; }
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
}

export function runNestedDropPlan(ctx: NestedDropPlanContext, movingKey: string, target: { pane: number | null; zone: WindowDropZone | null; insert: WindowDropZone | null; title?: boolean }) {
  const {
    windowZoom, fullscreenMode, orderedWindowKeys, fittedWindowKeys, windowItems, windowItemKey,
    fittedWindows, readerAreaWidth, windowAreaHeight, splitOrientation, splitReaderLast,
    reconciledSplitTree, windowStackFor, shownPopoverTab, splitTreeLimits, rectOf,
  } = ctx
  const edge = target.pane === null ? target.zone : target.insert
  if (!edge || edge === 'center' || target.title || windowZoom !== null || fullscreenMode) return null
  if (orderedWindowKeys.length !== fittedWindowKeys.length) return null
  const anchor = target.pane === null ? null : windowItems[target.pane] ? windowItemKey(windowItems[target.pane]!) : undefined
  if (anchor === undefined) return null
  const rects = windowLayoutRects(fittedWindows, { width: readerAreaWidth, height: windowAreaHeight, orientation: splitOrientation, readerLast: splitReaderLast })
  let base = reconciledSplitTree ?? { keys: orderedWindowKeys, root: splitTreeFromRects(rects.map((rect, index) => ({ ...rect, slot: index - 1 }))) }
  const stack = windowStackFor(movingKey)
  if (stack?.includes(anchor ?? '')) return null
  const successor = stack && orderedWindowKeys.includes(movingKey) ? stackSuccessor(stack, movingKey) : null
  if (successor) base = { ...base, keys: base.keys.map(key => key === movingKey ? successor : key) }
  const primaryKey = shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null
  // Onto its own edge, a window moves to that side of the whole layout.
  const ownSlot = movingKey === anchor ? base.keys.indexOf(movingKey) : -1
  const next = primaryKey && movingKey === primaryKey ? placePaneSlot(base, -1, target.pane ?? -1, edge)
    : ownSlot >= 0 ? movePaneToEdge(base, ownSlot, edge)
    : movingKey === anchor ? null
    : placeWindowSplit(base, movingKey, anchor, edge)
  if (!next) return null
  const geometry = computeWindowSplitTree(next, readerAreaWidth, windowAreaHeight, splitTreeLimits)
  if (geometry.layout.visibleCount !== next.keys.length) return null
  // Refuse a new split that borrows minimum-size space from unrelated panes.
  if (!orderedWindowKeys.includes(movingKey) && movingKey !== primaryKey) {
    const frame = target.pane === null ? rectOf('transcript-reader') : rectOf(`split-pane:${target.pane}`)
    const horizontal = edge === 'left' || edge === 'right'
    const required = horizontal ? SPLIT_PANE_MIN_WIDTH + (target.pane === null ? MIN_READER_WIDTH : SPLIT_PANE_MIN_WIDTH) : SPLIT_PANE_MIN_ROWS + (target.pane === null ? MIN_READER_ROWS : SPLIT_PANE_MIN_ROWS)
    if (!frame || (horizontal ? frame.width : frame.height) < required) return null
  }
  return { tree: next, geometry, key: movingKey }
}

export type MoveFloatGestureContext = {
  floatGestureRef: React.RefObject<{ mode: 'move' | 'resize'; x: number; y: number; rect: FloatingRect; moved?: boolean; } | null>
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  checkpointWindowLayout: () => void
  floatDockTarget: (point: { x: number; y: number; }) => { kind: 'tab'; pane: number; } | { kind: 'edge'; } | null
  windowAreaRect: () => { x: number; y: number; width: number; height: number; } | null
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  dropTargetAt: (point: { x: number; y: number; }) => { zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title: boolean; }
  nestedDropPlan: (movingKey: string, target: { pane: number | null; zone: WindowDropZone | null; insert: WindowDropZone | null; title?: boolean; }) => { tree: WindowSplitTree; geometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; }; key: string; } | null
  setFloatDockHint: React.Dispatch<React.SetStateAction<{ label: string; rect: { x: number; y: number; width: number; height: number; }; x: number; y: number; } | null>>
  windowNumberOffset: 1 | 2
  readerAreaWidth: number
  windowAreaHeight: number
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
}

export function runMoveFloatGesture(ctx: MoveFloatGestureContext, event: { x: number; y: number }) {
  const {
    floatGestureRef, floatingWindow, checkpointWindowLayout, floatDockTarget, windowAreaRect,
    rectOf, dropTargetAt, nestedDropPlan, setFloatDockHint, windowNumberOffset, readerAreaWidth,
    windowAreaHeight, setFloatingWindow,
  } = ctx
  const gesture = floatGestureRef.current
  if (!gesture || !floatingWindow) return
  if (!gesture.moved) {
    if (Math.abs(event.x - gesture.x) + Math.abs(event.y - gesture.y) < 2) return
    checkpointWindowLayout()
    gesture.moved = true
  }
  if (gesture.mode === 'move') {
    const dock = floatDockTarget(event)
    const area = windowAreaRect()
    const pane = dock?.kind === 'tab' ? rectOf(`split-pane:${dock.pane}`) : null
    const target = dropTargetAt(event)
    const edge = target.pane === null ? target.zone : target.insert
    const plan = edge && edge !== 'center' && !target.title ? nestedDropPlan(floatingWindow.key, target) : null
    const splitRect = plan?.geometry.rects.get(plan.tree.keys.indexOf(floatingWindow.key))
    setFloatDockHint(splitRect && area
      ? { label: 'Split here', rect: { ...splitRect, x: splitRect.x + area.x, y: splitRect.y + area.y }, x: event.x, y: event.y }
      : dock && area
      ? { label: dock.kind === 'tab' ? `Add as a tab of window ${dock.pane + windowNumberOffset}` : 'Dock into the layout', rect: pane ? { ...pane, height: Math.min(pane.height, 3) } : area, x: event.x, y: event.y }
      : null)
  }
  const area = windowAreaRect() ?? { width: readerAreaWidth, height: windowAreaHeight }
  const dx = event.x - gesture.x
  const dy = event.y - gesture.y
  const rect = gesture.mode === 'move'
    ? { ...gesture.rect, x: gesture.rect.x + dx, y: gesture.rect.y + dy }
    : { ...gesture.rect, width: gesture.rect.width + dx, height: gesture.rect.height + dy }
  setFloatingWindow({ ...floatingWindow, rect: clampFloatingRect(rect, area) })
}

export type CycleSplitPaneSessionContext = {
  checkpointWindowLayout: () => void
  splitPaneCount: number
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  splitCandidateSessions: Session[]
  splitFocusIndex: number | null
  pinIndexOfWindow: (index: number) => number
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
}

export function runCycleSplitPaneSession(ctx: CycleSplitPaneSessionContext) {
  const {
    checkpointWindowLayout, splitPaneCount, showNotice, splitCandidateSessions, splitFocusIndex,
    pinIndexOfWindow, setSplitPinnedKeys,
  } = ctx
  checkpointWindowLayout()
  if (splitPaneCount === 0) {
    showNotice('error', 'Split transcript view is off (⌃B % to split)')
    return
  }
  const candidateKeys = splitCandidateSessions.map((tab) => sessionKey(tab))
  if (candidateKeys.length <= splitPaneCount) {
    showNotice('info', 'No other open tab to swap into the split pane')
    return
  }
  const target = splitFocusIndex === null ? 0 : pinIndexOfWindow(splitFocusIndex)
  setSplitPinnedKeys((current) => {
    if (target < 0 || target >= current.length) return current
    const heldByOtherPanes = new Set(current.filter((_, i) => i !== target))
    const from = candidateKeys.indexOf(current[target]!)
    for (let step = 1; step <= candidateKeys.length; step += 1) {
      const nextKey = candidateKeys[(from + step) % candidateKeys.length]!
      if (nextKey !== current[target] && !heldByOtherPanes.has(nextKey)) {
        const next = [...current]
        next[target] = nextKey
        return next
      }
    }
    return current
  })
}

export type OpenPopoverWindowContext = {
  readerPin: () => { session: string | null; path: string | null; }
  teammatesOpen: boolean
  openTeammatesPanel: () => void
  setPopoverOpen: (kind: WindowSurfaceKind, open: boolean, pin?: SurfaceMeta) => void
  openPopoverInNewTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  openPopoverTab: (kind: WindowSurfaceKind, pin: SurfaceMeta) => void
  parkedWindowKeysRef: React.RefObject<Set<string>>
  windowSurfaces: string[]
  windowSurfaceMeta: Record<string, SurfaceMeta>
  activateWindowTab: (key: string) => void
  pendingSurfaceFocusRef: React.RefObject<string | null>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  checkpointWindowLayout: () => void
  workspaceContext: WorkspaceContextValue
  setWindowSurfaceMeta: React.Dispatch<React.SetStateAction<Record<string, SurfaceMeta>>>
  windowSplitTree: WindowSplitTree | null
  splitArrangement: WindowArrangement
  splitPaneCount: number
  setWindowArrangement: (arrangement: WindowArrangement, readerLast: boolean) => void
  splitReaderLast: boolean
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
}

export function runOpenPopoverWindow(ctx: OpenPopoverWindowContext, kind: PopoverWindowKind, pin?: SurfaceMeta, placement?: 'beside' | 'fill' | 'tab') {
  const {
    readerPin, teammatesOpen, openTeammatesPanel, setPopoverOpen, openPopoverInNewTab,
    openPopoverTab, parkedWindowKeysRef, windowSurfaces, windowSurfaceMeta, activateWindowTab,
    pendingSurfaceFocusRef, setFocusedPane, setWindowSurfaces, checkpointWindowLayout,
    workspaceContext, setWindowSurfaceMeta, windowSplitTree, splitArrangement, splitPaneCount,
    setWindowArrangement, splitReaderLast, showNotice,
  } = ctx
  if (pin === undefined) pin = pinFor(kind, readerPin())
  if (placement === undefined) placement = 'beside'
  // Store-backed panels stay open while windowed: opened as a window straight
  // from the palette, they must be opened first or their window closes at once.
  if (kind === 'teammates' && !teammatesOpen) openTeammatesPanel()
  setPopoverOpen(kind, false)
  if (placement === 'tab') { openPopoverInNewTab(kind, pin); return }
  if (placement === 'fill') { openPopoverTab(kind, pin); return }
  const parked = [...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)
  const existing = findPopoverWindow([...windowSurfaces, ...parked], windowSurfaceMeta, kind, pin)
  if (existing) {
    if (parked.includes(existing)) activateWindowTab(surfaceWindowKey(existing))
    pendingSurfaceFocusRef.current = existing
    setFocusedPane('messages')
    setWindowSurfaces((current) => [...current])
    return
  }
  const surface = nextSurfaceId(kind, new Set([...windowSurfaces, ...parked]))
  checkpointWindowLayout()
  if (isPluginSurfaceId(kind) && !POPOVER_WINDOWS[kind].single) copySurfaceViewState(workspaceContext.runtime, 'root', surfaceViewNamespace(kind, surface), isPluginSurfaceId(kind) ? getPluginSurface(kind).pluginId : undefined)
  setWindowSurfaceMeta((current) => ({ ...current, [surface]: pin }))
  setWindowSurfaces((current) => (current.includes(surface) ? current : [...current, surface]))
  if (!windowSplitTree && splitArrangement === 'split' && splitPaneCount + windowSurfaces.length + 1 > SPLIT_PANE_MAX) setWindowArrangement('main-stack', splitReaderLast)
  pendingSurfaceFocusRef.current = surface
  setFocusedPane('messages')
  showNotice('info', `${POPOVER_WINDOWS[kind].title.slice(2)} in a window · ⌃⇧W or ⤢ for full screen`)
}

export type ResizeFocusedWindowContext = {
  splitFocusIndex: number | null
  reconciledSplitTree: WindowSplitTree | null
  resizeTreeWindow: (slot: number, direction: 1 | -1) => void
  fittedWindows: WindowLayout
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  checkpointWindowLayout: () => void
  splitWeights: Partial<Record<WindowGroupKey, number[]>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
  splitArrangement: WindowArrangement
  splitReaderLast: boolean
  splitSecondaryShare: number
  splitBottomShare: number
}

export function runResizeFocusedWindow(ctx: ResizeFocusedWindowContext, direction: 1 | -1, focus?: number | null) {
  const {
    splitFocusIndex, reconciledSplitTree, resizeTreeWindow, fittedWindows, showNotice,
    checkpointWindowLayout, splitWeights, setSplitWeights, splitArrangement, splitReaderLast,
    splitSecondaryShare, splitBottomShare,
  } = ctx
  if (focus === undefined) focus = splitFocusIndex
  if (reconciledSplitTree) { resizeTreeWindow(focus ?? -1, direction); return }
  const group = focus === null ? undefined : fittedWindows.groups.find((entry) => entry.members.includes(focus))
  if (focus === null || !group) {
    showNotice('info', 'Focus a pane that shares a divider with another pane')
    return
  }
  const horizontal = group.axis === 'x'
  const extents = group.members.map((member) => (horizontal ? fittedWindows.panes[member]!.width : fittedWindows.panes[member]!.height))
  const at = group.members.indexOf(focus)
  const neighbour = at < group.members.length - 1 ? at + 1 : at - 1
  const min = horizontal ? SPLIT_PANE_MIN_WIDTH : SPLIT_PANE_MIN_ROWS
  const step = horizontal ? 4 : 2
  const pair = extents[at]! + extents[neighbour]!
  const next = Math.max(min, Math.min(pair - min, extents[at]! + direction * step))
  if (next === extents[at]) {
    showNotice('info', direction > 0 ? 'That pane is as large as its neighbour allows' : 'That pane is at its smallest')
    return
  }
  checkpointWindowLayout()
  extents[at] = next
  extents[neighbour] = pair - next
  const weights = { ...splitWeights, [group.key]: extents }
  setSplitWeights(weights)
  void writeTuiWindowArrangement({ arrangement: splitArrangement, readerLast: splitReaderLast, secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights }).catch(() => {})
}

export type CloseSplitPaneContext = {
  splitFocusIndex: number | null
  closeFloatingWindow: (remember?: boolean) => void
  checkpointWindowLayout: () => void
  splitPaneCount: number
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  windowItems: WindowItem[]
  windowStackFor: (key: string) => WindowStack | null
  windowItemKey: (item: WindowItem) => string
  closeWindowTab: (key: string, remember?: boolean) => void
  pinIndexOfWindow: (index: number) => number
  splitPinnedKeys: string[]
  rememberClosedWindow: (key: string) => void
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  lastFocusedSplitPaneRef: React.RefObject<number>
  applySplitPaneCount: (next: number, label?: string, orientation?: SplitPaneOrientation) => void
}

export function runCloseSplitPane(ctx: CloseSplitPaneContext, paneIndex?: number) {
  const {
    splitFocusIndex, closeFloatingWindow, checkpointWindowLayout, splitPaneCount, showNotice,
    windowItems, windowStackFor, windowItemKey, closeWindowTab, pinIndexOfWindow, splitPinnedKeys,
    rememberClosedWindow, setSplitPinnedKeys, setSplitFocusIndex, lastFocusedSplitPaneRef,
    applySplitPaneCount,
  } = ctx
  const closeIndex = paneIndex ?? splitFocusIndex ?? null
  if (closeIndex === FLOATING_PANE_INDEX) { closeFloatingWindow(); return }
  checkpointWindowLayout()
  if (splitPaneCount === 0) {
    showNotice('info', 'No split panes open')
    return
  }
  // A tab closes into its frame's next tab, not the whole frame.
  const closing = closeIndex === null ? null : windowItems[closeIndex]
  if (closing && windowStackFor(windowItemKey(closing))) { closeWindowTab(windowItemKey(closing)); return }
  const nextCount = splitPaneCount - 1
  // Window indices count surfaces too; the pins count sessions only.
  const closePin = closeIndex === null ? Math.max(splitPaneCount - 1, 0) : pinIndexOfWindow(closeIndex)
  if (closePin < 0) return
  const closingKey = splitPinnedKeys[closePin]
  if (closingKey) rememberClosedWindow(closingKey)
  setSplitPinnedKeys((current) => removeSplitPaneKey(current, closePin))
  if (splitFocusIndex !== null) {
    const nextFocus = focusAfterWindowClose(splitFocusIndex, closeIndex ?? windowItems.length - 1, windowItems.length)
    setSplitFocusIndex(nextFocus)
    if (nextFocus !== null) lastFocusedSplitPaneRef.current = nextFocus
  }
  applySplitPaneCount(nextCount)
}

export type BreakOutWindowTabContext = {
  windowStackFor: (key: string) => WindowStack | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  laidOutWindowKeys: Set<string>
  currentPaneTree: () => WindowSplitTree
  readerAreaWidth: number
  windowAreaHeight: number
  splitTreeLimits: { paneWidth: number; paneRows: number; readerWidth: number; readerRows: number; }
  checkpointWindowLayout: () => void
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  liveWindowStacks: WindowStack[]
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  commitWindowKeys: (keys: string[], tree?: WindowSplitTree) => void
  setOverviewPendingTarget: React.Dispatch<React.SetStateAction<string | null>>
  floatWindowKey: (key: string, session?: Session) => void
}

export function runBreakOutWindowTab(ctx: BreakOutWindowTabContext, key: string) {
  const {
    windowStackFor, showNotice, laidOutWindowKeys, currentPaneTree, readerAreaWidth,
    windowAreaHeight, splitTreeLimits, checkpointWindowLayout, setWindowStacks, liveWindowStacks,
    setWindowZoom, commitWindowKeys, setOverviewPendingTarget, floatWindowKey,
  } = ctx
  const stack = windowStackFor(key)
  if (!stack) { showNotice('info', 'This window is not one of several tabs'); return }
  const frame = stack.find((member) => laidOutWindowKeys.has(member))!
  const anchor = frame === key ? stackSuccessor(stack, key)! : frame
  const base = { ...currentPaneTree() }
  if (frame === key) base.keys = base.keys.map(entry => entry === key ? anchor : entry)
  const geometry = computeWindowSplitTree(base, readerAreaWidth, windowAreaHeight, splitTreeLimits)
  const anchorRect = geometry.rects.get(base.keys.indexOf(anchor))
  for (const edge of ['right', 'bottom'] as const) {
    const enough = anchorRect && (edge === 'right' ? anchorRect.width >= 2 * SPLIT_PANE_MIN_WIDTH : anchorRect.height >= 2 * SPLIT_PANE_MIN_ROWS)
    if (!enough) continue
    const next = placeWindowSplit(base, key, anchor, edge)
    if (!next || computeWindowSplitTree(next, readerAreaWidth, windowAreaHeight, splitTreeLimits).layout.visibleCount !== next.keys.length) continue
    checkpointWindowLayout()
    setWindowStacks(removeFromStack(liveWindowStacks, key))
    setWindowZoom(null)
    commitWindowKeys(next.keys, next)
    setOverviewPendingTarget(key)
    return
  }
  // A tab must never detach into responsive overflow or squeeze its neighbours.
  floatWindowKey(key)
  showNotice('info', 'Detached into a floating window · no room beside this pane')
}

export type RequestWindowPanesContext = {
  splitCandidateSessions: Session[]
  openTabSessions: Session[]
  selectedSessionKey: string | null
  sessions: Session[]
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}

export function runRequestWindowPanes(ctx: RequestWindowPanesContext, wanted: number, label: string) {
  const {
    splitCandidateSessions, openTabSessions, selectedSessionKey, sessions, setOpenTabSessions,
    showNotice, setSplitPaneCount, setError,
  } = ctx
  let available = splitCandidateSessions.length
  // Short of tabs, the layout fills from the rail's most recent sessions, as
  // a window manager tiles the windows it has rather than leaving holes.
  if (available < wanted) {
    const taken = new Set([...openTabSessions.map((tab) => sessionKey(tab)), selectedSessionKey])
    const extra = sessions.filter((session) => !taken.has(sessionKey(session))).slice(0, wanted - available)
    if (extra.length > 0) {
      setOpenTabSessions((prev) => [...prev, ...extra.filter((session) => !prev.some((tab) => sessionKey(tab) === sessionKey(session)))])
      available += extra.length
    }
  }
  if (available === 0) {
    showNotice('error', 'No other sessions to arrange · start one, or drag a session from the sidebar onto the reader')
    return
  }
  const count = Math.min(wanted, available)
  setSplitPaneCount(count)
  void writeTuiSplitPanes(count).catch((err) => {
    setError(err instanceof Error ? err.message : 'Failed to store split view setting')
  })
  showNotice('info', count < wanted ? `${label} · ${count} of ${wanted} panes (no more sessions to fill it)` : label)
}

export type SwapWindowInDirectionContext = {
  splitFocusIndex: number | null
  checkpointWindowLayout: () => void
  visibleSplitPaneCount: number
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  currentPaneTree: () => WindowSplitTree
  focusReaderFromSplit: () => void
  focusSplitPane: (paneIndex: number) => void
}

export function runSwapWindowInDirection(ctx: SwapWindowInDirectionContext, direction: WindowDirection, target?: number | null) {
  const {
    splitFocusIndex, checkpointWindowLayout, visibleSplitPaneCount, showNotice, rectOf,
    setWindowSplitTree, currentPaneTree, focusReaderFromSplit, focusSplitPane,
  } = ctx
  if (target === undefined) target = splitFocusIndex
  checkpointWindowLayout()
  if (visibleSplitPaneCount === 0) {
    showNotice('error', 'No split panes open (⌃B % to split)')
    return
  }
  const windows: Array<{ id: number; rect: { x: number; y: number; width: number; height: number } }> = []
  const reader = rectOf('transcript-reader')
  if (reader) windows.push({ id: -1, rect: reader })
  for (let index = 0; index < visibleSplitPaneCount; index += 1) {
    const pane = rectOf(`split-pane:${index}`)
    if (pane) windows.push({ id: index, rect: pane })
  }
  const from = target ?? -1
  const to = windowInDirection(windows, from, direction)
  if (to === null) {
    showNotice('info', `No window ${direction === 'up' ? 'above' : direction === 'down' ? 'below' : `to the ${direction}`}`)
    return
  }
  setWindowSplitTree(swapPaneSlots(currentPaneTree(), from, to))
  if (from === -1) focusReaderFromSplit()
  else focusSplitPane(from)
}
