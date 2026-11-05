/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import { validWindowSplitTree, reconcileWindowSplitTree, computeWindowSplitTree, type WindowSplitTree, type WindowSplitNode } from '../../windowSplitTree'
import { isSurfaceWindowKey } from '../../windowOrder'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { SPLIT_TREE_LIMITS, ZOOM_TREE_LIMITS } from '../layoutConstants'

export type UsePopoverTakesWindowGroupContext = {
  hasPrimaryFrame: boolean
  orderedWindowKeys: string[]
  splitOrientation: SplitPaneOrientation
  windowSplitTree: WindowSplitTree | null
  selectedSessionKey: string | null
  windowZoom: number | 'reader' | null
  readerAreaWidth: number
  windowBudgetHeight: number
  fullscreenMode: boolean
  popoverTabHostKey: string | null
}

export function usePopoverTakesWindowGroup(ctx: UsePopoverTakesWindowGroupContext) {
  const {
    hasPrimaryFrame, orderedWindowKeys, splitOrientation, windowSplitTree, selectedSessionKey,
    windowZoom, readerAreaWidth, windowBudgetHeight, fullscreenMode, popoverTabHostKey,
  } = ctx

  // A shown popover tab takes over a session window — laid out in its place,
  // the transcript hidden (still mounted) behind it — and gets a slot of its
  // own only when there is no session window to take.
  const popoverTakesWindow = hasPrimaryFrame && orderedWindowKeys.some((key) => !isSurfaceWindowKey(key))
  const primaryLeaf = hasPrimaryFrame && !popoverTakesWindow
  // With no saved tree the windows sit in one row (or column), a popover tab's
  // own slot first.
  const fallbackPaneTree = useMemo((): WindowSplitTree | null => {
    const fallbackLeaves = [...(primaryLeaf ? [-1] : []), ...orderedWindowKeys.map((_, slot) => slot)]
    return fallbackLeaves.length ? {
    ...(primaryLeaf ? {} : { primary: false }), keys: orderedWindowKeys,
    root: fallbackLeaves.map((slot) => ({ slot })).reduce<import('../../windowSplitTree').WindowSplitNode>((root, node, index) => index === 0 ? node : ({ axis: splitOrientation === 'columns' ? 'x' : 'y', ratio: index / (index + 1), first: root, second: node }), { slot: fallbackLeaves[0]! }),
    } : null
  }, [primaryLeaf, orderedWindowKeys, splitOrientation])
  // A layout saved while the reader existed keeps its slot (-1) until the
  // selected session moves into it, so upgrading does not displace a pane.
  const legacyReaderSlot = !primaryLeaf && validWindowSplitTree(windowSplitTree) && windowSplitTree.primary !== false
    && Boolean(selectedSessionKey) && !orderedWindowKeys.includes(selectedSessionKey!)
  const reconciledSplitTree = useMemo(() => validWindowSplitTree(windowSplitTree) ? reconcileWindowSplitTree(windowSplitTree, orderedWindowKeys, primaryLeaf || legacyReaderSlot) : fallbackPaneTree,
    [windowSplitTree, orderedWindowKeys, primaryLeaf, legacyReaderSlot, fallbackPaneTree])
  // Zoomed neighbours are hidden, so their minimums must not evict the zoomed
  // frame or unmount its siblings when the terminal becomes smaller.
  const splitTreeLimits = SPLIT_TREE_LIMITS
  const splitTreeFitLimits = windowZoom === null ? SPLIT_TREE_LIMITS : ZOOM_TREE_LIMITS
  const { baseTreeGeometry, treeOverflowRows } = useMemo(() => {
    let geometry = reconciledSplitTree ? computeWindowSplitTree(reconciledSplitTree, readerAreaWidth, windowBudgetHeight, splitTreeFitLimits) : null
    const overflow = geometry && geometry.layout.visibleCount < orderedWindowKeys.length ? 1 : 0
    if (geometry && overflow) geometry = computeWindowSplitTree(reconciledSplitTree!, readerAreaWidth, Math.max(1, windowBudgetHeight - 1), SPLIT_TREE_LIMITS)
    return { baseTreeGeometry: geometry, treeOverflowRows: overflow }
  }, [reconciledSplitTree, fullscreenMode, readerAreaWidth, windowBudgetHeight, splitTreeFitLimits, orderedWindowKeys.length])
  const popoverHostSlot = (() => {
    if (!popoverTakesWindow || !baseTreeGeometry) return -1
    const shown = orderedWindowKeys.slice(0, baseTreeGeometry.layout.visibleCount)
    const slotOf = (key: string | null) => key && !isSurfaceWindowKey(key) ? shown.indexOf(key) : -1
    const slot = slotOf(popoverTabHostKey)
    if (slot >= 0) return slot
    const selected = slotOf(selectedSessionKey)
    if (selected >= 0) return selected
    return Math.max(shown.findIndex((key) => !isSurfaceWindowKey(key)), 0)
  })()
  // A tab shown without a recorded host (restored, or set as state) keeps the
  // window it first took, or it would follow the selection from window to window.
  const resolvedPopoverHostKey = popoverHostSlot >= 0 ? orderedWindowKeys[popoverHostSlot]! : null

  return {
    primaryLeaf, legacyReaderSlot, reconciledSplitTree, splitTreeLimits, baseTreeGeometry,
    treeOverflowRows, popoverHostSlot, resolvedPopoverHostKey,
  }
}
