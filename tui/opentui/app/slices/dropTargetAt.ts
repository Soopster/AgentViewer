/** @jsxImportSource @opentui/react */
import type { CliRenderer } from '@opentui/core'
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { WindowLayout } from '../../windowLayout'
import React from 'react'
import { type WindowSplitTree } from '../../windowSplitTree'
import { clampFloatingRect, defaultFloatingRect, removeFromStack, type FloatingRect, type WindowStack } from '../../windowTabs'
import { surfaceWindowKey } from '../../windowOrder'
import { type WindowGroupKey, windowDropZone, type WindowArrangement, type WindowDropZone } from '../../windowLayout'
import { type WindowLayoutAction } from '../../WindowLayoutPicker'
import { type SavedWindowLayout } from '../../windowLayoutStore'
import { type BoxRenderable } from '@opentui/core'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type WindowItem, type NoticeTone } from '../types'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'
import { runNestedDropPlan } from '../actions/windows'
import { runProjectedWindowGeometry } from '../derived/windowGeometry'

export type UseDropTargetAtGroupContext = {
  visibleSplitPaneCount: number
  renderer: CliRenderer
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  inside: (rect: { x: number; y: number; width: number; height: number; }, point: { x: number; y: number; }) => boolean
  windowAreaRef: React.RefObject<BoxRenderable | null>
  checkpointWindowLayout: () => void
  selectTabSession: (session: Session) => void
  selectSidebarSession: (session: Session) => void
  splitFocusIndex: number | null
  windowItems: WindowItem[]
  hasPrimaryFrame: boolean
  floatWindowKey: (key: string, session?: Session) => void
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  windowZoom: number | 'reader' | null
  fullscreenMode: boolean
  orderedWindowKeys: string[]
  fittedWindowKeys: string[]
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
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  openTabByKey: Map<string, Session>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  commitWindowKeys: (keys: string[], tree?: WindowSplitTree) => void
  setOverviewPendingTarget: React.Dispatch<React.SetStateAction<string | null>>
  sessionDrag: { session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title?: boolean; x: number; y: number; } | null
  windowPickerOpen: boolean
  windowLayoutPreview: string | null
  primaryLeaf: boolean
  splitArrangement: WindowArrangement
  splitPaneCount: number
  splitReaderShare: number
  splitSecondaryShare: number
  splitBottomShare: number
  splitWeights: Partial<Record<WindowGroupKey, number[]>>
  windowSurfaces: string[]
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  selectedSessionKey: string | null
  pinIndexOfWindow: (index: number) => number
  splitPinnedKeys: string[]
  savedWindowLayouts: SavedWindowLayout[]
  sessions: Session[]
  openTabSessions: Session[]
  surfaceRestorable: (surface: string) => boolean
  planPaneArrangement: (action: WindowLayoutAction) => WindowSplitTree | null
  windowBudgetHeight: number
}

export function useDropTargetAtGroup(ctx: UseDropTargetAtGroupContext) {
  const {
    visibleSplitPaneCount, renderer, rectOf, inside, windowAreaRef, checkpointWindowLayout,
    selectTabSession, selectSidebarSession, splitFocusIndex, windowItems, hasPrimaryFrame,
    floatWindowKey, setFloatingWindow, windowZoom, fullscreenMode, orderedWindowKeys,
    fittedWindowKeys, windowItemKey, fittedWindows, readerAreaWidth, windowAreaHeight,
    splitOrientation, splitReaderLast, reconciledSplitTree, windowStackFor, shownPopoverTab,
    splitTreeLimits, showNotice, openTabByKey, setOpenTabSessions, setWindowStacks,
    liveWindowStacks, floatingKey, commitWindowKeys, setOverviewPendingTarget, sessionDrag,
    windowPickerOpen, windowLayoutPreview, primaryLeaf, splitArrangement, splitPaneCount,
    splitReaderShare, splitSecondaryShare, splitBottomShare, splitWeights, windowSurfaces,
    floatingWindow, selectedSessionKey, pinIndexOfWindow, splitPinnedKeys, savedWindowLayouts,
    sessions, openTabSessions, surfaceRestorable, planPaneArrangement, windowBudgetHeight,
  } = ctx

  // What a drag would land on: a pane under the pointer, else an edge or the
  // middle of the reader (relative to the reader, so its edges stay reachable
  // when panes fill the rest of the area).
  const dropTargetAt = (point: { x: number; y: number }): { zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title: boolean } => {
    for (let index = 0; index < visibleSplitPaneCount; index += 1) {
      const slot = renderer.root.findDescendantById(`split-pane:${index}`)
      if (!slot || !slot.visible) continue
      const pane = rectOf(`split-pane:${index}`)
      if (!pane || !inside(pane, point)) continue
      // The title row adds a tab; a pane's own edges insert beside it; its middle replaces it.
      if (point.y === pane.y) return { zone: null, pane: index, insert: null, title: true }
      const zone = windowDropZone(pane, point)
      return { zone: null, pane: index, insert: zone && zone !== 'center' ? zone : null, title: false }
    }
    const reader = rectOf('transcript-reader')
    return { zone: reader ? windowDropZone(reader, point) : null, pane: null, insert: null, title: false }
  }

  const windowAreaRect = () => {
    const box = windowAreaRef.current
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }

  // A session dropped on the window area: an edge makes it a pane on that
  // side, the middle opens it in the reader.
  const dropSessionInWindow = useStableEvent((session: Session, zone: WindowDropZone, fromPane: number | null) => {
    if (zone === 'center') {
      checkpointWindowLayout()
      if (fromPane !== null) selectTabSession(session)
      else selectSidebarSession(session)
      return
    }
    const pane = splitFocusIndex !== null && splitFocusIndex >= 0 && splitFocusIndex < windowItems.length ? splitFocusIndex : hasPrimaryFrame ? null : windowItems.length ? 0 : null
    applyNestedDrop(sessionKey(session), { pane, zone: pane === null ? zone : null, insert: pane === null ? null : zone }, session)
  })

  // A surface window dropped on the reader floats where it was let go.
  const floatSurfaceAt = useStableEvent((surface: WindowSurfaceId, point: { x: number; y: number }) => {
    const area = windowAreaRect()
    floatWindowKey(surfaceWindowKey(surface))
    if (!area) return
    const rect = defaultFloatingRect(area)
    setFloatingWindow((current) => current ? { ...current, rect: clampFloatingRect({ ...rect, x: point.x - area.x - 4, y: point.y - area.y }, area) } : current)
  })

  const nestedDropPlan = (movingKey: string, target: { pane: number | null; zone: WindowDropZone | null; insert: WindowDropZone | null; title?: boolean }) => runNestedDropPlan({
    windowZoom, fullscreenMode, orderedWindowKeys, fittedWindowKeys, windowItems, windowItemKey,
    fittedWindows, readerAreaWidth, windowAreaHeight, splitOrientation, splitReaderLast,
    reconciledSplitTree, windowStackFor, shownPopoverTab, splitTreeLimits, rectOf,
  }, movingKey, target)
  const applyNestedDrop = useStableEvent((movingKey: string, target: { pane: number | null; zone: WindowDropZone | null; insert: WindowDropZone | null; title?: boolean }, session?: Session) => {
    const plan = nestedDropPlan(movingKey, target)
    if (!plan) { showNotice('info', 'That split does not fit · enlarge the target pane first'); return }
    checkpointWindowLayout()
    if (session && !openTabByKey.has(movingKey)) setOpenTabSessions(current => [...current, session])
    const keys = plan.tree.keys
    if (windowStackFor(movingKey)) setWindowStacks(removeFromStack(liveWindowStacks, movingKey))
    if (floatingKey === movingKey) setFloatingWindow(null)
    commitWindowKeys(keys, plan.tree)
    setOverviewPendingTarget(movingKey)
  })
  const dragMovingKey = sessionDrag?.tab ?? (sessionDrag?.surface ? surfaceWindowKey(sessionDrag.surface) : sessionDrag?.session ? sessionKey(sessionDrag.session) : null)
  const nestedDragPreview = sessionDrag && dragMovingKey ? nestedDropPlan(dragMovingKey, sessionDrag) : null

  // Preview the same operation plan and geometry that applying it consumes.
  // This is read-only: hovering and dragging never rewrite the current layout.
  const projectedWindowGeometry = runProjectedWindowGeometry({
    windowPickerOpen, windowLayoutPreview, sessionDrag, primaryLeaf, splitArrangement,
    splitOrientation, splitReaderLast, splitPaneCount, splitReaderShare, splitSecondaryShare,
    splitBottomShare, splitWeights, windowSurfaces, floatingKey, floatingWindow,
    selectedSessionKey, windowItems, pinIndexOfWindow, splitPinnedKeys, savedWindowLayouts,
    sessions, openTabSessions, surfaceRestorable, readerAreaWidth, windowAreaHeight,
    splitFocusIndex, planPaneArrangement, windowBudgetHeight, splitTreeLimits,
  })

  return {
    dropTargetAt, windowAreaRect, dropSessionInWindow, floatSurfaceAt, nestedDropPlan,
    applyNestedDrop, nestedDragPreview, projectedWindowGeometry,
  }
}
