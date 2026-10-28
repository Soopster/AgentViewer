/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { type FloatingRect, type WindowStack } from '../../windowTabs'
import { type ContextMenuItem } from '../../ContextMenu'
import { useWorkspaceState, useWorkspaceRef } from '../../workspaceContext'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export function useWindowLayoutState() {
  // The window a shown popover tab takes over: the one focused when it was shown.
  const [popoverTabHostKey, setPopoverTabHostKey] = useWorkspaceState<string | null>('popoverTabHost', null)
  const pendingSurfaceFocusRef = useRef<WindowSurfaceId | null>(null)
  const surfaceTitleClicksRef = useRef(new Map<string, { current: { x: number; y: number; at: number } | null }>())
  // Where surface windows sit among the session panes (windowOrder.ts): the
  // session pins still decide the sessions and their order.
  const [windowOrder, setWindowOrder] = useWorkspaceState<string[]>('windowOrder', [])
  // Windows sharing a frame as tabs (windowTabs.ts), and the one floating over the layout.
  const [windowStacks, setWindowStacks] = useWorkspaceState<WindowStack[]>('windowStacks', [])
  // `slot` is where it sat in the layout, so docking puts it back there.
  const [floatingWindow, setFloatingWindow] = useWorkspaceState<{ key: string; rect: FloatingRect; slot: number } | null>('floatingWindow', null)
  const floatGestureRef = useRef<{ mode: 'move' | 'resize'; x: number; y: number; rect: FloatingRect; moved?: boolean } | null>(null)
  const [floatGesturing, setFloatGesturing] = useState(false)
  // Session keys held off the layout (background tabs, the floating window):
  // the pin reconciler must not fill a pane with one. Written each render.
  const parkedWindowKeysRef = useRef(new Set<string>())
  // Key handlers and input capture of surfaces open as windows, by window id.
  // The side panel keeps its own refs; a window must not share one with it,
  // or with another window of the same kind.
  const windowSurfaceKeysRef = useRef(new Map<WindowSurfaceId, (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => unknown>())
  const windowSurfaceCaptureRef = useRef(new Map<WindowSurfaceId, 'none' | 'input' | 'terminal' | boolean>())
  // The shell each terminal window shows, so moving it (a remount) keeps it.
  const windowShellSelectionRef = useWorkspaceRef('shellSelections', new Map<WindowSurfaceId, string | null>())
  const [windowControlMode, setWindowControlMode] = useState<'identify' | 'manage' | null>(null)
  const windowResizeGroupRef = useRef(false)
  const windowResizeCheckpointRef = useRef(false)
  // A right-click menu: where, and what it offers.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; title: string; items: ContextMenuItem[] } | null>(null)
  const contextMenuKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // Legacy layout actions still accept slots; convert them at the boundary.
  const presentationIndexRef = useRef<number | 'reader' | null>(null)

  return {
    popoverTabHostKey, setPopoverTabHostKey, pendingSurfaceFocusRef, surfaceTitleClicksRef,
    windowOrder, setWindowOrder, windowStacks, setWindowStacks, floatingWindow, setFloatingWindow,
    floatGestureRef, floatGesturing, setFloatGesturing, parkedWindowKeysRef, windowSurfaceKeysRef,
    windowSurfaceCaptureRef, windowShellSelectionRef, windowControlMode, setWindowControlMode,
    windowResizeGroupRef, windowResizeCheckpointRef, contextMenu, setContextMenu,
    contextMenuKeyHandlerRef, presentationIndexRef,
  }
}
