/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { WorkspaceContextValue } from '../../workspaceContext'
import type { RefObject } from 'react'
import type { WindowLayout } from '../../windowLayout'
import type { SplitRect } from '../../windowSplitTree'
import type { SplitDivider } from '../../windowSplitTree'
import React, { useState } from 'react'
import { splitPath, updateSplitRatio, type WindowSplitTree } from '../../windowSplitTree'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { moveWorkspaceWindow } from '../../workspaceWindowMove'
import { reassignShell } from '../../shellStore'
import { reassignProcess } from '../../processStore'
import { type PopoverWindowKind } from '../../popoverWindows'
import { type ContextMenuItem } from '../../ContextMenu'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { type RemoteCoordinatorTarget } from '../../../../lib/tui/remoteCoordinator'
import { type PendingPermission } from '../../../../lib/permissions'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type ChordMap } from '../../chordHelp'
import { type PaneFocus, type NoticeTone } from '../types'
import { type TranscriptDiffNoteDraft } from '../transcriptDiffSelection'
import { runSplitFocusedWindow } from '../actions/windows'

export type UseOpenMoveWorkspaceMenuGroupContext = {
  width: number
  setWindowSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>
  workspaceContext: WorkspaceContextValue
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; title: string; items: ContextMenuItem[]; } | null>>
  splitFocusIndex: number | null
  orderedWindowKeys: string[]
  windowZoom: number | 'reader' | null
  fullscreenMode: boolean
  visibleSplitPaneCount: number
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  splitCandidateSessions: Session[]
  parkedWindowKeysRef: React.RefObject<Set<string>>
  windowSurfaces: string[]
  popoverTabs: string[]
  fittedWindows: WindowLayout
  readerAreaWidth: number
  windowAreaHeight: number
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  reconciledSplitTree: WindowSplitTree | null
  primaryLeaf: boolean
  popoverHostSlot: number
  splitTreeLimits: { paneWidth: number; paneRows: number; readerWidth: number; readerRows: number; }
  checkpointWindowLayout: () => void
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  splitPinnedSessions: Session[]
  splitPaneCount: number
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  pendingSurfaceFocusRef: React.RefObject<string | null>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  treeDividerActivePathRef: React.RefObject<string | null>
  treeDividerCheckpointedRef: React.RefObject<boolean>
  pluginOverlay: 'terminal' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  dailySummaryOpen: boolean
  playbookManagerOpen: boolean
  attentionOpen: boolean
  promptLibraryOpen: boolean
  handoffBriefOpen: boolean
  fileHistoryPath: string | null
  gitRepoCwd: string
  teammatesModalOpen: boolean
  windowedPopoverKinds: Set<WindowSurfaceKind>
  pendingPermissions: PendingPermission[]
  contextMenu: { x: number; y: number; title: string; items: ContextMenuItem[]; } | null
  windowPickerOpen: boolean
  windowSwitcherOpen: boolean
  windowBroadcastOpen: boolean
  spacesMenuOpen: boolean
  exitConfirmOpen: boolean
  worktreeConfirm: 'merge' | 'discard' | null
  worktreeModalOpen: boolean
  coordModalOpen: boolean
  remoteCoordinatorTarget: RemoteCoordinatorTarget | null
  commandPaletteOpen: boolean
  newSessionModalOpen: boolean
  providerMenuOpen: boolean
  modelPickerOpen: boolean
  themeMenuOpen: boolean
  transcriptViewMenuOpen: boolean
  renameSessionKey: string | null
  bookmarksOverlayOpen: boolean
  composerHistoryOpen: boolean
  composerStashOpen: boolean
  searchMode: boolean
  sessionSearchMode: boolean
  folderPickerForNewSession: boolean
  pluginManagerOpen: boolean
  transcriptDiffDraft: TranscriptDiffNoteDraft | null
  chordHelp: { map: ChordMap; dismissOnKey: boolean; } | null
  windowResizeGroupRef: React.RefObject<boolean>
  windowResizeCheckpointRef: React.RefObject<boolean>
  setWindowControlMode: React.Dispatch<React.SetStateAction<'identify' | 'manage' | null>>
}

export function useOpenMoveWorkspaceMenuGroup(ctx: UseOpenMoveWorkspaceMenuGroupContext) {
  const {
    width, setWindowSwitcherOpen, workspaceContext, showNotice, setContextMenu, splitFocusIndex,
    orderedWindowKeys, windowZoom, fullscreenMode, visibleSplitPaneCount, rectOf,
    splitCandidateSessions, parkedWindowKeysRef, windowSurfaces, popoverTabs, fittedWindows,
    readerAreaWidth, windowAreaHeight, splitOrientation, splitReaderLast, reconciledSplitTree,
    primaryLeaf, popoverHostSlot, splitTreeLimits, checkpointWindowLayout, setWindowSplitTree,
    setWindowOrder, splitPinnedSessions, splitPaneCount, setSplitPinnedKeys, setSplitPaneCount,
    setWindowSurfaces, pendingSurfaceFocusRef, setSurfacePanelFocused, setFocusedPane,
    setSplitFocusIndex, treeGeometry, treeDividerActivePathRef, treeDividerCheckpointedRef,
    pluginOverlay, dailySummaryOpen, playbookManagerOpen, attentionOpen, promptLibraryOpen,
    handoffBriefOpen, fileHistoryPath, gitRepoCwd, teammatesModalOpen, windowedPopoverKinds,
    pendingPermissions, contextMenu, windowPickerOpen, windowSwitcherOpen, windowBroadcastOpen,
    spacesMenuOpen, exitConfirmOpen, worktreeConfirm, worktreeModalOpen, coordModalOpen,
    remoteCoordinatorTarget, commandPaletteOpen, newSessionModalOpen, providerMenuOpen,
    modelPickerOpen, themeMenuOpen, transcriptViewMenuOpen, renameSessionKey, bookmarksOverlayOpen,
    composerHistoryOpen, composerStashOpen, searchMode, sessionSearchMode,
    folderPickerForNewSession, pluginManagerOpen, transcriptDiffDraft, chordHelp,
    windowResizeGroupRef, windowResizeCheckpointRef, setWindowControlMode,
  } = ctx

  const openMoveWorkspaceMenu = useStableEvent((sourceId: string, target: string, singleTab = false, point = { x: Math.floor(width / 3), y: 3 }) => {
    leaveWindowControls()
    setWindowSwitcherOpen(false)
    const controller = workspaceContext.controller
    const items = controller.getSnapshot().spaces.flatMap(space => space.workspaces.filter(workspace => workspace.id !== sourceId).map(workspace => ({
      label: `${space.name} / ${workspace.name}`,
      run: () => {
        try {
          const result = moveWorkspaceWindow(controller, sourceId, workspace.id, target, singleTab)
          for (const id of result.resourceIds) { reassignShell(id, sourceId, workspace.id); reassignProcess(id, sourceId, workspace.id) }
          controller.activate(space.id, workspace.id)
          showNotice('info', `Moved to ${space.name} / ${workspace.name}`)
        } catch (error) { showNotice('error', error instanceof Error ? error.message : String(error)) }
      },
    })))
    if (!items.length) { showNotice('info', 'Create another workspace first using the spaces menu'); return }
    setContextMenu({ ...point, title: 'Move to workspace…', items })
  })

  const splitFocusedWindow = useStableEvent((orientation: SplitPaneOrientation, target: number | null = splitFocusIndex) => runSplitFocusedWindow({
    splitFocusIndex, showNotice, orderedWindowKeys, windowZoom, fullscreenMode,
    visibleSplitPaneCount, rectOf, splitCandidateSessions, parkedWindowKeysRef, windowSurfaces,
    popoverTabs, fittedWindows, readerAreaWidth, windowAreaHeight, splitOrientation,
    splitReaderLast, reconciledSplitTree, primaryLeaf, popoverHostSlot, splitTreeLimits,
    checkpointWindowLayout, setWindowSplitTree, setWindowOrder, splitPinnedSessions,
    splitPaneCount, setSplitPinnedKeys, setSplitPaneCount, setWindowSurfaces,
    pendingSurfaceFocusRef, setSurfacePanelFocused, setFocusedPane, setSplitFocusIndex,
  }, orientation, target))
  const resizeTreeWindow = useStableEvent((slot: number, direction: 1 | -1) => {
    if (!reconciledSplitTree || !treeGeometry) return
    const path = splitPath(reconciledSplitTree.root, slot)
    if (!path) { showNotice('info', 'That window has no split divider'); return }
    const parent = path.slice(0, -1)
    const divider = treeGeometry.dividers.find(divider => divider.path === parent)
    if (!divider) return
    const extent = divider.axis === 'x' ? divider.rect.width : divider.rect.height
    const change = direction * (divider.axis === 'x' ? 4 : 2) * (path.endsWith('0') ? 1 : -1)
    const first = Math.max(divider.minFirst, Math.min(extent - divider.minSecond, divider.firstExtent + change))
    if (first === divider.firstExtent) { showNotice('info', 'The neighbouring window is at its minimum size'); return }
    checkpointWindowLayout()
    setWindowSplitTree({ ...reconciledSplitTree, root: updateSplitRatio(reconciledSplitTree.root, parent, first / extent) })
  })
  const dragTreeDivider = useStableEvent((path: string, point: { x: number; y: number }) => {
    if (treeDividerActivePathRef.current !== path || !reconciledSplitTree || !treeGeometry) return
    const divider = treeGeometry.dividers.find(divider => divider.path === path)
    const area = rectOf('window-area')
    if (!divider || !area) return
    const extent = divider.axis === 'x' ? divider.rect.width : divider.rect.height
    const offset = divider.axis === 'x' ? point.x - area.x - divider.rect.x + 1 : point.y - area.y - divider.rect.y + 1
    const first = Math.max(divider.minFirst, Math.min(extent - divider.minSecond, offset))
    if (first === divider.firstExtent) return
    if (!treeDividerCheckpointedRef.current) { checkpointWindowLayout(); treeDividerCheckpointedRef.current = true }
    setWindowSplitTree({ ...reconciledSplitTree, root: updateSplitRatio(reconciledSplitTree.root, path, first / extent) })
  })

  // Window controls are transient keyboard owners, never persisted workspace state.
  const [controlMenuTarget, setControlMenuTarget] = useState<string | null>(null)
  const blockingWindowPopover = Object.entries({
    ...(pluginOverlay ? { [pluginOverlay]: true } : {}), 'daily-summary': dailySummaryOpen,
    playbooks: playbookManagerOpen, attention: attentionOpen, 'prompt-library': promptLibraryOpen,
    handoff: handoffBriefOpen,
    'file-history': Boolean(fileHistoryPath && gitRepoCwd),
    teammates: teammatesModalOpen,
  }).some(([kind, open]) => open && !windowedPopoverKinds.has(kind as PopoverWindowKind))
  const windowControlsBlocked = Boolean(
    pendingPermissions.length || blockingWindowPopover || contextMenu || windowPickerOpen || windowSwitcherOpen || windowBroadcastOpen
    || spacesMenuOpen || exitConfirmOpen || worktreeConfirm || worktreeModalOpen || coordModalOpen || remoteCoordinatorTarget
    || commandPaletteOpen || newSessionModalOpen || providerMenuOpen || modelPickerOpen || themeMenuOpen || transcriptViewMenuOpen
    || renameSessionKey || bookmarksOverlayOpen || composerHistoryOpen || composerStashOpen || searchMode || sessionSearchMode
    || folderPickerForNewSession || pluginManagerOpen || transcriptDiffDraft || chordHelp?.dismissOnKey,
  )
  const endWindowResizeGroup = () => {
    windowResizeGroupRef.current = false
    windowResizeCheckpointRef.current = false
  }
  const leaveWindowControls = useStableEvent(() => {
    setWindowControlMode(null)
    endWindowResizeGroup()
  })

  return {
    openMoveWorkspaceMenu, splitFocusedWindow, resizeTreeWindow, dragTreeDivider,
    controlMenuTarget, setControlMenuTarget, windowControlsBlocked, endWindowResizeGroup,
    leaveWindowControls,
  }
}
