/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { type WindowGroupKey, type WindowWeights, type WindowDropZone } from '../../windowLayout'
import { useWorkspaceState } from '../../workspaceContext'
import { type BoxRenderable } from '@opentui/core'
import { type Session } from '../../../../lib/types'
import { SPLIT_SHARE_EVEN } from '../../splitPaneState'
import { type MenuPoint } from '../types'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export function useWindowGestureState() {
  const windowPickerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  // The reader-and-panes area, for drop zones and divider drags in screen cells.
  const windowAreaRef = useRef<BoxRenderable | null>(null)
  const windowOverflowRef = useRef<BoxRenderable | null>(null)
  // A session dragged from the rail or a pane title: what, and where it would land.
  // `pane` is a pane under the pointer (dropping there replaces it); otherwise `zone` is relative to the reader.
  // `insert` is set when the pointer is on a pane's edge: the drop goes beside that pane rather than over it.
  // A drag carries a session (from the rail, a tab or a pane title) or a
  // surface window (by its title). `pane` and `fromPane` are window indices.
  // `tab` is set when a tab is dragged out of a frame's tab strip; `title` when
  // the pointer is over a window's title row, where a drop adds a tab.
  const [sessionDrag, setSessionDrag] = useState<{ session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title?: boolean; x: number; y: number } | null>(null)
  const sessionPressRef = useRef<{ session: Session | null; surface?: WindowSurfaceId; tab?: string; reader?: boolean; fromPane: number | null; x: number; y: number; dragging: boolean; onClick?: () => void } | null>(null)
  // A press is under way: a full-screen layer takes the rest of the gesture, so
  // a drag that leaves a one-row tab or rail row on its first motion is not
  // captured by whatever it moved onto.
  const [sessionPressing, setSessionPressing] = useState(false)
  // The divider between the reader and its panes, while it is dragged.
  // Which divider is being dragged: the reader's, or the second one (the grid's rows, a stack's first pane).
  // The third, `bottom`, is between the grid's bottom-row panes.
  // `{ group, index }` is the border after member `index` of a group of panes.
  const [splitDividerDragging, setSplitDividerDragging] = useState<'primary' | 'secondary' | { group: WindowGroupKey; index: number } | null>(null)
  const [splitSecondaryShare, setSplitSecondaryShare] = useWorkspaceState<number>('splitSecondaryShare', SPLIT_SHARE_EVEN)
  const [splitBottomShare, setSplitBottomShare] = useWorkspaceState<number>('splitBottomShare', SPLIT_SHARE_EVEN)
  // Every shared border between panes: relative sizes per group (windowLayout.ts).
  const [splitWeights, setSplitWeights] = useWorkspaceState<WindowWeights>('splitWeights', {})
  const [hoveredWindowBorder, setHoveredWindowBorder] = useState<string | null>(null)

  const [secondaryDividerHovered, setSecondaryDividerHovered] = useState(false)
  const [splitDividerHovered, setSplitDividerHovered] = useState(false)
  const [splitDividerPoint, setSplitDividerPoint] = useState<{ x: number; y: number } | null>(null)
  const readerTitleClickRef = useRef<{ x: number; y: number; at: number } | null>(null)
  // Press, move, release — shared by every rail row and pane title, through
  // stable wrappers so the rail's row cache is not rebuilt per render. The
  // implementation is assigned further down, where what it calls exists.
  const sessionDragImplRef = useRef({
    press: (_session: Session, _fromPane: number | null, _event: { x: number; y: number }, _onClick?: () => void) => {},
    pressSurface: (_surface: WindowSurfaceId, _fromPane: number, _event: { x: number; y: number }) => {},
    pressTab: (_key: string, _fromPane: number, _event: { x: number; y: number }, _onClick?: () => void) => {},
    pressReader: (_session: Session, _event: { x: number; y: number }) => {},
    move: (_event: { x: number; y: number }) => {},
    release: (_event: { x: number; y: number }) => {},
  })
  // A pane's title buttons, stable across renders: the panes are memoized, and
  // a fresh function per render would re-render every pane with the root.
  const splitPaneActionsRef = useRef({
    close: (_paneIndex: number) => {},
    promote: (_session: Session) => {},
    fullscreen: () => {},
    sessionMenu: (_session: Session, _source: 'rail' | 'tab' | 'pane', _point: MenuPoint, _paneIndex?: number) => {},
  })

  return {
    windowPickerKeyHandlerRef, windowAreaRef, windowOverflowRef, sessionDrag, setSessionDrag,
    sessionPressRef, sessionPressing, setSessionPressing, splitDividerDragging,
    setSplitDividerDragging, splitSecondaryShare, setSplitSecondaryShare, splitBottomShare,
    setSplitBottomShare, splitWeights, setSplitWeights, hoveredWindowBorder,
    setHoveredWindowBorder, secondaryDividerHovered, setSecondaryDividerHovered, splitDividerPoint,
    setSplitDividerPoint, readerTitleClickRef, sessionDragImplRef, splitPaneActionsRef,
  }
}
