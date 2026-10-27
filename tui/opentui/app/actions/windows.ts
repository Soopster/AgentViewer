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
