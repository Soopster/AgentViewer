/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { WindowLayout } from '../../windowLayout'
import React, { useRef } from 'react'
import { splitPath, rotateWindowSplitTree, type WindowSplitTree } from '../../windowSplitTree'
import { type WindowGroupKey, type WindowArrangement } from '../../windowLayout'
import { writeTuiSplitOrientation, writeTuiSplitReaderShare, writeTuiWindowArrangement } from '../../../../lib/tui/service'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type NoticeTone } from '../types'
import { SPLIT_PANE_MAX } from '../layoutConstants'
import { runDragSplitDivider } from '../actions/windows'

export type UseDragSplitDividerGroupContext = {
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
  setSplitDividerDragging: React.Dispatch<React.SetStateAction<'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null>>
  splitArrangement: WindowArrangement
  splitBottomShare: number
  splitWeights: Partial<Record<WindowGroupKey, number[]>>
  splitPaneCount: number
  applySplitPaneCount: (next: number, label?: string, orientation?: SplitPaneOrientation) => void
  splitCandidateSessions: Session[]
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  splitOrientation: SplitPaneOrientation
  setSplitOrientation: React.Dispatch<React.SetStateAction<SplitPaneOrientation>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  reconciledSplitTree: WindowSplitTree | null
  splitFocusIndex: number | null
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
}

export function useDragSplitDividerGroup(ctx: UseDragSplitDividerGroupContext) {
  const {
    splitDividerPoint, checkpointWindowLayout, windowAreaRect, setSplitDividerPoint,
    splitDividerDragging, fittedWindows, rectOf, setSplitWeights, splitSecondaryShare,
    setSplitSecondaryShare, stackedSplit, splitReaderLast, splitReaderShare, setSplitReaderShare,
    setSplitDividerDragging, splitArrangement, splitBottomShare, splitWeights, splitPaneCount,
    applySplitPaneCount, splitCandidateSessions, showNotice, splitOrientation, setSplitOrientation,
    setError, reconciledSplitTree, splitFocusIndex, setWindowSplitTree,
  } = ctx

  // The divider between the reader and its panes, dragged to a new share.
  const dragSplitDivider = useStableEvent((event: { x: number; y: number }) => runDragSplitDivider({
    splitDividerPoint, checkpointWindowLayout, windowAreaRect, setSplitDividerPoint,
    splitDividerDragging, fittedWindows, rectOf, setSplitWeights, splitSecondaryShare,
    setSplitSecondaryShare, stackedSplit, splitReaderLast, splitReaderShare, setSplitReaderShare,
  }, event))
  const endSplitDividerDrag = useStableEvent(() => {
    const kind = splitDividerDragging
    setSplitDividerDragging(null)
    setSplitDividerPoint(null)
    if (kind === 'secondary' || (kind && typeof kind === 'object')) {
      void writeTuiWindowArrangement({ arrangement: splitArrangement, readerLast: splitReaderLast, secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights: splitWeights }).catch(() => {})
    } else {
      void writeTuiSplitReaderShare(splitReaderShare).catch(() => {})
    }
  })

  // ⌃B z is the quick on/off: it restores the pane count you last had open
  // rather than always coming back with a single pane.
  const lastSplitPaneCountRef = useRef(1)
  const toggleSplitPanes = useStableEvent(() => {
    if (splitPaneCount > 0) {
      lastSplitPaneCountRef.current = splitPaneCount
      applySplitPaneCount(0)
      return
    }
    if (splitCandidateSessions.length === 0) {
      showNotice('error', 'Open another tab to split the transcript view')
      return
    }
    const maxPanes = Math.min(SPLIT_PANE_MAX, splitCandidateSessions.length)
    applySplitPaneCount(Math.min(lastSplitPaneCountRef.current, maxPanes))
  })

  // Orientation and the reader/pane ratio are layout preferences, not per-pane
  // state: every pane shares them, and both persist so a split comes back the
  // shape you left it.
  const applySplitOrientation = useStableEvent((next: SplitPaneOrientation, quiet?: boolean) => {
    checkpointWindowLayout()
    if (next === splitOrientation) {
      if (!quiet) showNotice('info', next === 'rows' ? 'Split panes already stacked' : 'Split panes already side-by-side')
      return
    }
    setSplitOrientation(next)
    void writeTuiSplitOrientation(next).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store split orientation')
    })
    if (!quiet) showNotice('info', next === 'rows' ? 'Split panes: stacked' : 'Split panes: side-by-side')
  })

  const rotateSplitOrientation = useStableEvent(() => {
    if (reconciledSplitTree) {
      checkpointWindowLayout()
      const path = splitPath(reconciledSplitTree.root, splitFocusIndex ?? -1)
      if (path) setWindowSplitTree({ ...reconciledSplitTree, root: rotateWindowSplitTree(reconciledSplitTree.root, path.slice(0, -1)) })
      return
    }
    applySplitOrientation(splitOrientation === 'rows' ? 'columns' : 'rows')
  })

  return {
    dragSplitDivider, endSplitDividerDrag, toggleSplitPanes, applySplitOrientation,
    rotateSplitOrientation,
  }
}
