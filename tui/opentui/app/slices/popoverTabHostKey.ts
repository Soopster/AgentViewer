/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { type WindowPresentation } from '../../windowPresentation'
import React, { useMemo, useRef, useState } from 'react'
import { useWorkspaceState } from '../../workspaceContext'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { type ChordMap } from '../../chordHelp'
import { type MenuPoint } from '../types'
import { useWindowGestureState } from '../state/windowGestureState'
import { useWindowLayoutState } from '../state/windowLayoutState'

export type UsePopoverTabHostKeyGroupContext = {
  presentationResolverRef: React.RefObject<(index?: number | 'reader' | null) => string | null>
  setWindowPresentation: React.Dispatch<React.SetStateAction<WindowPresentation | null>>
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function usePopoverTabHostKeyGroup(ctx: UsePopoverTabHostKeyGroupContext) {
  const {
    presentationResolverRef, setWindowPresentation, setWindowPickerOpen,
  } = ctx

  const {
    popoverTabHostKey, setPopoverTabHostKey, pendingSurfaceFocusRef, surfaceTitleClicksRef,
    windowOrder, setWindowOrder, windowStacks, setWindowStacks, floatingWindow, setFloatingWindow,
    floatGestureRef, floatGesturing, setFloatGesturing, parkedWindowKeysRef, windowSurfaceKeysRef,
    windowSurfaceCaptureRef, windowShellSelectionRef, windowControlMode, setWindowControlMode,
    windowResizeGroupRef, windowResizeCheckpointRef, contextMenu, setContextMenu,
    contextMenuKeyHandlerRef, presentationIndexRef,
  } = useWindowLayoutState()
  // Compatibility adapter for layout actions; presentation itself always owns a stable key.
  const setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>> = useStableEvent(action => {
    const next = typeof action === 'function' ? action(presentationIndexRef.current) : action
    const target = next === null ? null : presentationResolverRef.current(next)
    setWindowPresentation(target ? { mode: 'zoom', target } : null)
  })
  const {
    windowPickerKeyHandlerRef, windowAreaRef, windowOverflowRef, sessionDrag, setSessionDrag,
    sessionPressRef, sessionPressing, setSessionPressing, splitDividerDragging,
    setSplitDividerDragging, splitSecondaryShare, setSplitSecondaryShare, splitBottomShare,
    setSplitBottomShare, splitWeights, setSplitWeights, hoveredWindowBorder,
    setHoveredWindowBorder, secondaryDividerHovered, setSecondaryDividerHovered, splitDividerPoint,
    setSplitDividerPoint, readerTitleClickRef, sessionDragImplRef, splitPaneActionsRef,
  } = useWindowGestureState()
  const splitPaneActions = useMemo(() => ({
    close: (paneIndex: number) => splitPaneActionsRef.current.close(paneIndex),
    promote: (session: Session) => splitPaneActionsRef.current.promote(session),
    openLayout: () => setWindowPickerOpen(true),
    fullscreen: () => splitPaneActionsRef.current.fullscreen(),
    /** A right-click on a rail row, a tab or a pane title. */
    sessionMenu: (session: Session, source: 'rail' | 'tab' | 'pane', point: MenuPoint, paneIndex?: number) =>
      splitPaneActionsRef.current.sessionMenu(session, source, point, paneIndex),
  }), [])
  // The floating window's move gesture, for a transcript window floating: the
  // drag is captured by the frame under the pointer, so it has to run it.
  const floatGestureImplRef = useRef({ start: (_event: { x: number; y: number }) => {}, move: (_event: { x: number; y: number }) => {}, end: (_event: { x: number; y: number }) => {} })
  const floatGestureHandlers = useMemo(() => ({
    start: (event: { x: number; y: number }) => floatGestureImplRef.current.start(event),
    move: (event: { x: number; y: number }) => floatGestureImplRef.current.move(event),
    end: (event: { x: number; y: number }) => floatGestureImplRef.current.end(event),
  }), [])
  const sessionDragHandlers = useMemo(() => ({
    /** `onClick` runs on a release that did not move: whichever of the row or the layer gets it. */
    press: (session: Session, fromPane: number | null, event: { x: number; y: number }, onClick?: () => void) => sessionDragImplRef.current.press(session, fromPane, event, onClick),
    move: (event: { x: number; y: number }) => sessionDragImplRef.current.move(event),
    release: (event: { x: number; y: number }) => sessionDragImplRef.current.release(event),
  }), [])
  // tmux-style prefix state: true between ⌃B and the command key that follows.
  const [splitChordPending, setSplitChordPending] = useState(false)
  // ⌃B ? opens the full chord reference. A toast can only ever show one
  // truncated line, and the chord namespace outgrew that.
  // Which chord's help is showing, and whether it was asked for. An overlay the
  // user opened deliberately is dismissed by the next key; one that revealed
  // itself while a chord is pending must NOT be, or it would swallow the very
  // keystroke it is advertising.
  const [chordHelp, setChordHelp] = useState<{ map: ChordMap; dismissOnKey: boolean } | null>(null)
  // Portable command prefix for actions whose Ctrl+Shift shortcuts cannot be
  // distinguished from Ctrl on legacy/raw terminals (notably on Windows).
  const [commandChordPending, setCommandChordPending] = useState(false)
  // Which split pane owns the keyboard (null = the reader does). Panes register
  // an imperative scroll handle here so the root dispatcher can drive the
  // focused one without every pane subscribing to the key stream.
  const [splitFocusIndex, setSplitFocusIndex] = useWorkspaceState<number | null>('splitFocusIndex', null)

  return {
    popoverTabHostKey, setPopoverTabHostKey, pendingSurfaceFocusRef, surfaceTitleClicksRef,
    windowOrder, setWindowOrder, windowStacks, setWindowStacks, floatingWindow, setFloatingWindow,
    floatGestureRef, floatGesturing, setFloatGesturing, parkedWindowKeysRef, windowSurfaceKeysRef,
    windowSurfaceCaptureRef, windowShellSelectionRef, windowControlMode, setWindowControlMode,
    windowResizeGroupRef, windowResizeCheckpointRef, contextMenu, setContextMenu,
    contextMenuKeyHandlerRef, presentationIndexRef, setWindowZoom, windowPickerKeyHandlerRef,
    windowAreaRef, windowOverflowRef, sessionDrag, setSessionDrag, sessionPressRef,
    sessionPressing, setSessionPressing, splitDividerDragging, setSplitDividerDragging,
    splitSecondaryShare, setSplitSecondaryShare, splitBottomShare, setSplitBottomShare,
    splitWeights, setSplitWeights, hoveredWindowBorder, setHoveredWindowBorder,
    secondaryDividerHovered, setSecondaryDividerHovered, splitDividerPoint, setSplitDividerPoint,
    readerTitleClickRef, sessionDragImplRef, splitPaneActionsRef, splitPaneActions,
    floatGestureImplRef, floatGestureHandlers, sessionDragHandlers, splitChordPending,
    setSplitChordPending, chordHelp, setChordHelp, commandChordPending, setCommandChordPending,
    splitFocusIndex, setSplitFocusIndex,
  }
}
