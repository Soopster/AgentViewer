/** @jsxImportSource @opentui/react */
import { removePrimaryWindow, validWindowSplitTree, reconcileWindowSplitTree, computeWindowSplitTree, type WindowSplitTree, type WindowSplitNode } from '../../windowSplitTree'
import { clampFloatingRect, type FloatingRect } from '../../windowTabs'
import { isSurfaceWindowKey, orderWindows, surfaceIdOfKey } from '../../windowOrder'
import { computeResponsiveWindowLayout, type WindowGroupKey, type WindowWeights, windowLayoutRects, windowPreviewLines, type WindowArrangement, type WindowDropZone } from '../../windowLayout'
import { type WindowLayoutAction } from '../../WindowLayoutPicker'
import { planWindowSessionDrop, type WindowSessionDrop } from '../../windowOperations'
import { type SavedWindowLayout } from '../../windowLayoutStore'
import { type Session } from '../../../../lib/types'
import { SPLIT_SHARE_EVEN, type SplitPaneOrientation } from '../../splitPaneState'
import { type WindowItem } from '../types'
import { FLOATING_PANE_INDEX, MIN_READER_WIDTH, SPLIT_PANE_MAX, SPLIT_PANE_ARRANGED_MAX, SPLIT_PANE_MIN_WIDTH, SPLIT_PANE_MIN_ROWS, MIN_READER_ROWS } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export type ProjectedWindowGeometryContext = {
  windowPickerOpen: boolean
  windowLayoutPreview: string | null
  sessionDrag: { session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title?: boolean; x: number; y: number; } | null
  primaryLeaf: boolean
  splitArrangement: WindowArrangement
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  splitPaneCount: number
  splitReaderShare: number
  splitSecondaryShare: number
  splitBottomShare: number
  splitWeights: Partial<Record<WindowGroupKey, number[]>>
  windowSurfaces: string[]
  floatingKey: string | null
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  selectedSessionKey: string | null
  windowItems: WindowItem[]
  pinIndexOfWindow: (index: number) => number
  splitPinnedKeys: string[]
  savedWindowLayouts: SavedWindowLayout[]
  sessions: Session[]
  openTabSessions: Session[]
  surfaceRestorable: (surface: string) => boolean
  readerAreaWidth: number
  windowAreaHeight: number
  splitFocusIndex: number | null
  planPaneArrangement: (action: WindowLayoutAction) => WindowSplitTree | null
  windowBudgetHeight: number
  splitTreeLimits: { paneWidth: number; paneRows: number; readerWidth: number; readerRows: number; }
}

export function runProjectedWindowGeometry(ctx: ProjectedWindowGeometryContext) {
  const {
    windowPickerOpen, windowLayoutPreview, sessionDrag, primaryLeaf, splitArrangement,
    splitOrientation, splitReaderLast, splitPaneCount, splitReaderShare, splitSecondaryShare,
    splitBottomShare, splitWeights, windowSurfaces, floatingKey, floatingWindow,
    selectedSessionKey, windowItems, pinIndexOfWindow, splitPinnedKeys, savedWindowLayouts,
    sessions, openTabSessions, surfaceRestorable, readerAreaWidth, windowAreaHeight,
    splitFocusIndex, planPaneArrangement, windowBudgetHeight, splitTreeLimits,
  } = ctx
return (() => {
  if ((!windowPickerOpen || !windowLayoutPreview) && !sessionDrag) return null
  let previewSplitTree: WindowSplitTree | null = null
  let previewPrimary = primaryLeaf
  let plan = { arrangement: splitArrangement, orientation: splitOrientation, readerLast: splitReaderLast, count: splitPaneCount }
  let readerShare = splitReaderShare
  let secondaryShare = splitSecondaryShare
  let bottomShare = splitBottomShare
  let weights: WindowWeights = splitWeights
  let surfaces = windowSurfaces.length
  let missing = 0
  let previewFloating = floatingKey && floatingWindow ? floatingWindow.rect : null
  if (sessionDrag) {
    if (!sessionDrag.session || sessionDrag.title || sessionKey(sessionDrag.session) === selectedSessionKey) return null
    if (sessionDrag.pane !== null && windowItems[sessionDrag.pane]?.kind === 'surface') return null
    const dropPin = sessionDrag.pane !== null ? pinIndexOfWindow(sessionDrag.pane) : -1
    const drop: WindowSessionDrop | null = sessionDrag.pane !== null && dropPin >= 0
      ? sessionDrag.insert ? { kind: 'insert', index: dropPin, edge: sessionDrag.insert } : { kind: 'replace', index: dropPin }
      : sessionDrag.zone && sessionDrag.zone !== 'center' ? { kind: 'edge', zone: sessionDrag.zone } : null
    if (drop) {
      const next = planWindowSessionDrop({ ...plan, pins: splitPinnedKeys }, sessionKey(sessionDrag.session), drop)
      if (!next) return null
      plan = next
    } else if (sessionDrag.zone !== 'center') return null
  } else if (windowLayoutPreview?.startsWith('saved:')) {
    const saved = savedWindowLayouts.find((entry) => entry.id === windowLayoutPreview.slice(6))
    if (!saved) return null
    const known = new Set([...sessions, ...openTabSessions].map(sessionKey))
    const savedFloating = saved.floating
    previewFloating = savedFloating && (isSurfaceWindowKey(savedFloating.key) ? surfaceRestorable(surfaceIdOfKey(savedFloating.key)) : known.has(savedFloating.key)) ? savedFloating.rect : null
    previewPrimary = Boolean(saved.reader && known.has(saved.reader) && (saved.primaryOpen ?? saved.splitTree?.primary !== false)) || Boolean(saved.activePopoverTab && saved.popoverTabs?.includes(saved.activePopoverTab) && surfaceRestorable(saved.activePopoverTab))
    if (validWindowSplitTree(saved.splitTree)) {
      const restoredTree = previewPrimary ? saved.splitTree : removePrimaryWindow(saved.splitTree)
      previewSplitTree = restoredTree ? reconcileWindowSplitTree(restoredTree, restoredTree.keys.filter(key => isSurfaceWindowKey(key) ? surfaceRestorable(surfaceIdOfKey(key)) : known.has(key)), previewPrimary) : null
    } else if (!previewPrimary) {
      const keys = orderWindows(saved.order ?? [], saved.panes.filter(key => known.has(key)), saved.surfaces.filter(surfaceRestorable))
      if (keys.length) previewSplitTree = { primary: false, keys,
        root: keys.map((_, slot) => ({ slot })).reduce<import('../../windowSplitTree').WindowSplitNode>((root, node, index) => index === 0 ? node : ({ axis: saved.orientation === 'columns' ? 'x' : 'y', ratio: index / (index + 1), first: root, second: node }), { slot: 0 }) }
    }
    const available = saved.panes.filter((key) => known.has(key)).length
    missing = saved.panes.length - available + (saved.reader && !known.has(saved.reader) ? 1 : 0)
    if (savedFloating && !isSurfaceWindowKey(savedFloating.key) && !known.has(savedFloating.key)) missing++
    plan = { ...saved, count: available }
    readerShare = saved.readerShare
    secondaryShare = saved.secondaryShare
    bottomShare = saved.bottomShare ?? SPLIT_SHARE_EVEN
    weights = saved.weights ?? {}
    surfaces = saved.surfaces.filter(surfaceRestorable).length
  } else if (windowLayoutPreview?.startsWith('action:')) {
    const action = windowLayoutPreview.slice(7) as WindowLayoutAction
    if (action === 'fullscreen' || action === 'fill') {
      const area = { width: readerAreaWidth, height: windowAreaHeight }
      if (splitFocusIndex === FLOATING_PANE_INDEX && previewFloating) {
        const rects = [clampFloatingRect(previewFloating, area)]
        return { rects, overflowRows: 0, lines: windowPreviewLines(rects, area), detail: 'Floating window · dock it to use a tiled layout' }
      }
      const rects = [{ x: 0, y: 0, ...area }, ...(previewFloating ? [clampFloatingRect(previewFloating, area)] : [])]
      return { rects, overflowRows: 0, lines: windowPreviewLines(rects, area), detail: `Focused pane fills the workspace${previewFloating ? ' · 1 floating' : ' · other panes preserved'}` }
    }
    previewSplitTree = planPaneArrangement(action)
    if (!previewSplitTree) return null
    plan.count = previewSplitTree.keys.filter(key => !isSurfaceWindowKey(key)).length
    surfaces = previewSplitTree.keys.length - plan.count
  }

  const input = {
    ...plan, width: readerAreaWidth, height: windowBudgetHeight,
    requestedCount: plan.count + surfaces, availableCount: plan.count + surfaces,
    maxPanes: plan.arrangement === 'split' ? SPLIT_PANE_MAX : SPLIT_PANE_ARRANGED_MAX,
    readerShare, secondaryShare, bottomShare, weights,
    minPaneWidth: SPLIT_PANE_MIN_WIDTH, minPaneRows: SPLIT_PANE_MIN_ROWS,
    minReaderWidth: MIN_READER_WIDTH, minReaderRows: MIN_READER_ROWS,
  }
  let previewGeometry = previewSplitTree ? computeWindowSplitTree(previewSplitTree, input.width, input.height, splitTreeLimits) : null
  const previewOverflow = previewGeometry && previewGeometry.layout.visibleCount < previewSplitTree!.keys.length ? 1 : 0
  if (previewGeometry && previewOverflow) previewGeometry = computeWindowSplitTree(previewSplitTree!, input.width, Math.max(1, input.height - 1), splitTreeLimits)
  const result = previewGeometry ? { layout: previewGeometry.layout, overflowRows: previewOverflow } : computeResponsiveWindowLayout(input)
  const area = { width: input.width, height: Math.max(1, input.height - result.overflowRows) }
  const rects = previewGeometry ? [...(previewGeometry.rects.has(-1) ? [previewGeometry.rects.get(-1)!] : []), ...Array.from({ length: previewGeometry.layout.visibleCount }, (_, index) => previewGeometry!.rects.get(index)!)] : windowLayoutRects(result.layout, { ...input, ...area })
  if (!previewGeometry && !previewPrimary) rects.shift()
  const tiledCount = rects.length
  if (previewFloating) rects.push(clampFloatingRect(previewFloating, area))
  const hidden = input.availableCount - result.layout.visibleCount
  return {
    rects, overflowRows: result.overflowRows,
    lines: windowPreviewLines(rects, area),
    detail: `${area.width}×${area.height} · ${tiledCount} visible${previewFloating ? ' · 1 floating' : ''}${hidden ? ` · ${hidden} hidden` : ''}${missing ? ` · ${missing} missing` : ''}`,
  }
})()
}
