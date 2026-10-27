/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React from 'react'
import { isPluginPanelSurfaceId } from '../../../../lib/plugins/catalog'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { WINDOW_CONTROL_ACTIONS, windowManagementKey, type WindowControlAction, type ControlWindow } from '../../windowControls'
import { isPopoverWindowKind, type PopoverWindowKind, type SurfaceMeta } from '../../popoverWindows'
import { type WindowDirection } from '../../windowLayout'
import { type RightPanelSurfaceKind } from '../../../../lib/rightPanel'
import { type SendState, type Session } from '../../../../lib/types'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { chordUnknownKeyNotice, COMMAND_CHORD_MAP, SPLIT_CHORD_MAP, type ChordMap } from '../../chordHelp'
import { PORTABLE_COMMAND_CHORDS, portableCommandChord } from '../../shortcutKeys'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

/** Returns true when one of these branches handled the key. */
export function handleWindowControlKeys({ windowControlsBlocked, windowControlMode, handled, key, isCtrl, leaveWindowControls, sequence, readControlWindows, pickControlWindow, endWindowResizeGroup, runWindowControlAction, focusedControlKey, focusWindowInDirection, commandChordPending, setCommandChordPending, executeCommandPalette, setChordHelp, showNotice, setSplitChordPending, cancelPointerGesture, isCtrlShift, openPopoverKind, openPopoverWindow, pluginOverlay, gitRepoCwd, setPluginOverlay, openSurfaceWindow, focusedWindowSurfaceKind, focusedWindowSurface, popoverTabs, popoverTabToFullScreen, returnPopoverWindow, spacesMenuOpen, spacesKeyRef, workspacesEnabled, workspaceLaunched, setWorkspaceLaunched, setWindowPickerOpen, setWorkspaceHasSession, setFocusedPane, setNewSessionCwd, workspaceCwd, setNewSessionModalOpen, splitChordPending, composerActive, composerTargetSession, composerSendState, reattachedRunning, isKeyRepeat, backgroundComposerTasks, enterWindowControls, openWindowControlMenu, toggleWorkspaces, openSpaces, addSplitPane, rotateSplitOrientation, resizeFocusedWindow, resizeSplitReader, shownPopoverTab, splitFocusIndex, closePopoverTab, closeSurfaceWindow, closeSplitPane, undoWindowLayout, redoWindowLayout, reopenClosedWindow, openRecentWindows, jumpToNextWindowAttention, setRecentWindowsOnly, setWindowSwitcherOpen, setWindowBroadcastOpen, toggleSplitPanes, cycleSplitFocus, swapWindowInDirection, toggleWindowZoom, tabFocusedWindow, stepWindowTab, focusedWindowItem, breakOutWindowTab, windowItemKey, toggleFloatingFocused, resizeSecondaryDivider, focusPreviousWindow, primaryLeaf, focusReaderFromSplit, windowNumberOffset, windowItems, focusSplitPane, focusControlWindow, cycleSplitPaneSession, toggleVoice }: {
  windowControlsBlocked: boolean
  windowControlMode: 'identify' | 'manage' | null
  handled: (action: () => void) => void
  key: KeyEvent
  isCtrl: (char: string) => boolean
  leaveWindowControls: () => void
  sequence: string
  readControlWindows: () => ControlWindow[]
  pickControlWindow: (key: string) => void
  endWindowResizeGroup: () => void
  runWindowControlAction: (key: string, action: WindowControlAction, direction?: WindowDirection) => void
  focusedControlKey: () => string
  focusWindowInDirection: (direction: WindowDirection) => void
  commandChordPending: boolean
  setCommandChordPending: React.Dispatch<React.SetStateAction<boolean>>
  executeCommandPalette: (id: string) => void
  setChordHelp: React.Dispatch<React.SetStateAction<{ map: ChordMap; dismissOnKey: boolean; } | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setSplitChordPending: React.Dispatch<React.SetStateAction<boolean>>
  cancelPointerGesture: () => boolean
  isCtrlShift: (char: string) => boolean
  openPopoverKind: () => PopoverWindowKind | null
  openPopoverWindow: (kind: PopoverWindowKind, pin?: SurfaceMeta, placement?: 'beside' | 'fill' | 'tab') => void
  pluginOverlay: 'teammates' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'desk' | null
  gitRepoCwd: string
  setPluginOverlay: React.Dispatch<React.SetStateAction<'teammates' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'desk' | null>>
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
  focusedWindowSurfaceKind: WindowSurfaceKind | null
  focusedWindowSurface: string | null
  popoverTabs: string[]
  popoverTabToFullScreen: (id: WindowSurfaceId) => void
  returnPopoverWindow: (surface: WindowSurfaceId) => void
  spacesMenuOpen: boolean
  spacesKeyRef: React.RefObject<((key: { name: string; sequence: string; ctrl: boolean; shift: boolean; }) => boolean) | null>
  workspacesEnabled: boolean
  workspaceLaunched: boolean
  setWorkspaceLaunched: React.Dispatch<React.SetStateAction<boolean>>
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setNewSessionCwd: React.Dispatch<React.SetStateAction<string>>
  workspaceCwd: string
  setNewSessionModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  splitChordPending: boolean
  composerActive: boolean
  composerTargetSession: Session | null
  composerSendState: SendState
  reattachedRunning: boolean
  isKeyRepeat: boolean
  backgroundComposerTasks: () => Promise<void>
  enterWindowControls: (mode: 'identify' | 'manage') => void
  openWindowControlMenu: (key: string, point?: { x: number; y: number; }, section?: 'resize' | 'swap' | 'session') => void
  toggleWorkspaces: () => void
  openSpaces: (id?: string, close?: boolean) => void
  addSplitPane: (orientation: SplitPaneOrientation) => void
  rotateSplitOrientation: () => void
  resizeFocusedWindow: (direction: 1 | -1, focus?: number | null) => void
  resizeSplitReader: (direction: 1 | -1 | 0) => void
  shownPopoverTab: string | null
  splitFocusIndex: number | null
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  closeSurfaceWindow: (surface: WindowSurfaceId, moving?: boolean) => void
  closeSplitPane: (paneIndex?: number) => void
  undoWindowLayout: () => void
  redoWindowLayout: () => void
  reopenClosedWindow: () => void
  openRecentWindows: () => void
  jumpToNextWindowAttention: () => void
  setRecentWindowsOnly: React.Dispatch<React.SetStateAction<boolean>>
  setWindowSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWindowBroadcastOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggleSplitPanes: () => void
  cycleSplitFocus: (direction: 1 | -1) => void
  swapWindowInDirection: (direction: WindowDirection, target?: number | null) => void
  toggleWindowZoom: (target?: number | null) => void
  tabFocusedWindow: (target?: number | null) => void
  stepWindowTab: (delta: number) => void
  focusedWindowItem: WindowItem | null
  breakOutWindowTab: (key: string) => void
  windowItemKey: (item: WindowItem) => string
  toggleFloatingFocused: (target?: number | null) => void
  resizeSecondaryDivider: (direction: 1 | -1) => void
  focusPreviousWindow: () => void
  primaryLeaf: boolean
  focusReaderFromSplit: () => void
  windowNumberOffset: 1 | 2
  windowItems: WindowItem[]
  focusSplitPane: (paneIndex: number) => void
  focusControlWindow: (key: string) => boolean
  cycleSplitPaneSession: () => void
  toggleVoice: () => void
}): boolean {
    // Controls must precede captured shell/browser/editor input. Higher-priority
    // dialogs are excluded synchronously, before the cleanup effect runs.
    if (!windowControlsBlocked && windowControlMode) {
      handled(() => {
        if (windowControlMode === 'identify') {
          if (key.name === 'escape' || isCtrl('c') || isCtrl('g')) leaveWindowControls()
          else if (!key.ctrl && /^[0-9]$/.test(sequence)) {
            const target = readControlWindows().find(window => window.number === Number(sequence))
            if (target) pickControlWindow(target.key)
          }
          return
        }
        const command = windowManagementKey(key)
        if (command?.kind !== 'action' || !WINDOW_CONTROL_ACTIONS.find(action => action.id === command.action)?.resize) endWindowResizeGroup()
        if (!command) return
        if (command.kind === 'exit') leaveWindowControls()
        else if (command.kind === 'select') {
          const target = readControlWindows().find(window => window.number === command.number)
          if (target) pickControlWindow(target.key)
        } else if (command.kind === 'cycle') {
          const windows = readControlWindows()
          const at = windows.findIndex(window => window.focused)
          const next = windows[(at + command.direction + windows.length) % windows.length]
          if (next) pickControlWindow(next.key)
        } else if (command.kind === 'direction') {
          if (command.swap) runWindowControlAction(focusedControlKey(), 'swap', command.direction)
          else focusWindowInDirection(command.direction)
        } else runWindowControlAction(focusedControlKey(), command.action)
      })
      return true
    }
    if (!windowControlsBlocked && commandChordPending) {
      handled(() => {
        setCommandChordPending(false)
        if (key.name === 'escape' || isCtrl('c') || isCtrl('g')) return
        const chord = portableCommandChord(sequence || key.name)
        if (chord) executeCommandPalette(PORTABLE_COMMAND_CHORDS[chord].command)
        else if (sequence === '?') setChordHelp({ map: COMMAND_CHORD_MAP, dismissOnKey: true })
        else showNotice('info', chordUnknownKeyNotice(COMMAND_CHORD_MAP, sequence || key.name))
      })
      return true
    }
    if (!windowControlsBlocked && isCtrl('k')) {
      handled(() => { setSplitChordPending(false); setCommandChordPending(true) })
      return true
    }
    if (key.name === 'escape' && cancelPointerGesture()) { key.preventDefault(); key.stopPropagation(); showNotice('info', 'Drag cancelled'); return true }
    // ⌃⇧W: the open popover into a window, or a focused popover window back to full screen.
    if (isCtrlShift('w')) {
      const popover = openPopoverKind()
      if (popover) { handled(() => openPopoverWindow(popover)); return true }
      // Git, Files and pull requests already have window kinds of their own.
      const surfaceKind: WindowSurfaceKind | null = pluginOverlay && isPluginPanelSurfaceId(pluginOverlay) ? pluginOverlay : null
      if (surfaceKind && gitRepoCwd) {
        handled(() => {
          setPluginOverlay(null)
          openSurfaceWindow(surfaceKind as RightPanelSurfaceKind)
        })
        return true
      }
      if (focusedWindowSurfaceKind && isPopoverWindowKind(focusedWindowSurfaceKind) && focusedWindowSurface) {
        const surface = focusedWindowSurface
        handled(() => (popoverTabs.includes(surface) ? popoverTabToFullScreen(surface) : returnPopoverWindow(surface)))
        return true
      }
    }
    if (spacesMenuOpen) { if (spacesKeyRef.current?.(key) !== false) { key.preventDefault(); key.stopPropagation() } return true }
    if (workspacesEnabled && !workspaceLaunched && !windowControlsBlocked && !key.ctrl && (key.name === 'return' || /^[1-4]$/.test(sequence))) {
      handled(() => {
        setWorkspaceLaunched(true)
        if (sequence === '3') openSurfaceWindow('terminal')
        else if (sequence === '4') setWindowPickerOpen(true)
        else { setWorkspaceHasSession(true); setFocusedPane('sessions'); if (sequence === '2') { setNewSessionCwd(workspaceCwd); setNewSessionModalOpen(true) } }
      }); return true
    }
    if (splitChordPending && !windowControlsBlocked) {
      handled(() => {
        setSplitChordPending(false)
        if (key.name === 'escape' || isCtrl('c') || isCtrl('g')) {
          showNotice('info', 'Split chord cancelled')
          return
        }
        if (isCtrl('b') && composerActive && composerTargetSession?.provider === 'claude'
          && (composerSendState === 'sending' || reattachedRunning)) {
          if (!isKeyRepeat) void backgroundComposerTasks()
          return
        }
        // % and " are tmux's split keys; v/s are the vim-shaped aliases.
        if (sequence === 'q') { enterWindowControls('identify'); return }
        if (sequence === 'e') { enterWindowControls('manage'); return }
        if (key.name === 'return') { openWindowControlMenu(focusedControlKey()); return }
        if (sequence === 'W') { toggleWorkspaces(); return }
        if (sequence === 'S') { openSpaces(); return }
        if (sequence === '%' || sequence === 'v') { addSplitPane('columns'); return }
        if (sequence === '"' || sequence === 's') { addSplitPane('rows'); return }
        if (sequence === 'r') { rotateSplitOrientation(); return }
        // Ratio keys: < gives the reader less of the shared axis, > more, = even.
        if (sequence === '<') { resizeFocusedWindow(-1); return }
        if (sequence === '>') { resizeFocusedWindow(1); return }
        if (sequence === '=') { resizeSplitReader(0); return }
        if (sequence === 'x') { if (shownPopoverTab && splitFocusIndex === null) closePopoverTab(shownPopoverTab); else if (focusedWindowSurface) closeSurfaceWindow(focusedWindowSurface); else closeSplitPane(); return }
        if (sequence === 'u') { undoWindowLayout(); return }
        if (sequence === 'U') { redoWindowLayout(); return }
        if (sequence === 'X') { reopenClosedWindow(); return }
        if (sequence === 'L') { openRecentWindows(); return }
        if (sequence === 'a') { jumpToNextWindowAttention(); return }
        if (sequence === 'p') { setRecentWindowsOnly(false); setWindowSwitcherOpen(true); return }
        if (sequence === 'b') { setWindowBroadcastOpen(true); return }
        if (sequence === 'w') { setWindowPickerOpen(true); return }
        if (sequence === 'z') { toggleSplitPanes(); return }
        // Focus movement, tmux-shaped: o/→/tab walk forward, ← walks back,
        // ; flips reader↔last pane, digits jump straight to a pane.
        if (sequence === 'o' || key.name === 'tab') { cycleSplitFocus(1); return }
        if (key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') {
          if (key.shift) swapWindowInDirection(key.name)
          else focusWindowInDirection(key.name)
          return
        }
        if (sequence === 'm') { toggleWindowZoom(); return }
        if (sequence === 't') { tabFocusedWindow(); return }
        if (sequence === ',') { stepWindowTab(-1); return }
        if (sequence === '.') { stepWindowTab(1); return }
        if (sequence === '!') { if (focusedWindowItem) breakOutWindowTab(windowItemKey(focusedWindowItem)); else showNotice('info', 'Focus a window that has tabs first'); return }
        if (sequence === 'f') { toggleFloatingFocused(); return }
        if (sequence === '+') { resizeSecondaryDivider(1); return }
        if (sequence === '-' || sequence === '_') { resizeSecondaryDivider(-1); return }
        if (sequence === '[') { resizeFocusedWindow(-1); return }
        if (sequence === ']') { resizeFocusedWindow(1); return }
        if (sequence === ';') { focusPreviousWindow(); return }
        // A window's number is its place in the order, so ⌃B <n> reaches it even
        // while another window is peeked over it.
        if (/^[0-9]$/.test(sequence)) {
          const number = Number(sequence)
          if (primaryLeaf && number === 1) { focusReaderFromSplit(); return }
          const index = number - windowNumberOffset
          if (index >= 0 && index < windowItems.length) focusSplitPane(index)
          else { const target = readControlWindows().find(window => window.number === number); if (target) focusControlWindow(target.key) }
          return
        }
        if (sequence === 'n') { cycleSplitPaneSession(); return }
        if (sequence === '?') { setChordHelp({ map: SPLIT_CHORD_MAP, dismissOnKey: true }); return }
        showNotice('info', chordUnknownKeyNotice(SPLIT_CHORD_MAP, sequence || key.name))
      })
      return true
    }

    // The window prefix works from the composer, including during a turn.
    if (!windowControlsBlocked && composerActive && isCtrl('b')) {
      handled(() => {
        setCommandChordPending(false)
        setSplitChordPending(true)
      })
      return true
    }
    if (isCtrlShift('v') && composerActive && !isKeyRepeat) {
      handled(() => toggleVoice())
      return true
    }
  return false
}
