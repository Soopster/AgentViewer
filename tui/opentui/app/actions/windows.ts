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
