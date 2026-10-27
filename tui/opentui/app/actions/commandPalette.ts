/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import { cycleTranscriptWidth } from '../../engineeringLayout'
import React from 'react'
import { getPluginCommand, type ResolvedPluginCommand } from '../../../../lib/plugins/catalog'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { isPopoverWindowKind, type PopoverWindowKind, type SurfaceMeta } from '../../popoverWindows'
import { formatSessionTitle, type TuiTranscriptCard } from '../../../format'
import { type TuiDensity } from '../../../theme'
import { runTuiSessionAction, type WorktreeTask, writeTuiDensity, writeTuiDiffLayout, writeTuiFocusMode, writeTuiStickyHeaders, writeTuiRailVisible, writeTuiShowToolCalls, writeTuiTabsEnabled, writeTuiTabOrientation, writeTuiTranscriptWidth, type TuiDiffLayout, type TuiSidebarSort, type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { type ProviderSelection, type Session, type SessionComposerAgentOption } from '../../../../lib/types'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { SPLIT_CHORD_MAP, type ChordMap } from '../../chordHelp'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { TASK_PANEL_RESIZE_STEP, SIDEBAR_RESIZE_STEP } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'
import { cycleDensityValue } from '../viewHelpers'

export type ExecuteCommandPaletteContext = {
  focusedWindowItem: WindowItem | null
  composerTargetSession: Session | null
  closeCommandPalette: () => void
  openPopoverWindow: (kind: PopoverWindowKind, pin?: SurfaceMeta, placement?: 'beside' | 'fill' | 'tab') => void
  runPluginCommand: (command: ResolvedPluginCommand, session?: Session | null) => void
  selectedSession: Session | null
  openNewSessionModal: () => void
  reuseLastPrompt: () => void
  openProviderMenu: () => void
  setAttentionOpen: React.Dispatch<React.SetStateAction<boolean>>
  jumpToNextAttention: () => void
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setSessionSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  setWorktreeDraft: React.Dispatch<React.SetStateAction<string>>
  setWorktreeModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  selectedWorktreeTask: WorktreeTask | null
  setWorktreeConfirm: React.Dispatch<React.SetStateAction<'merge' | 'discard' | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  openNewWorkflowModal: () => void
  setDailySummaryOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggleSurfacePanelPlacement: () => void
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
  gitRepoCwd: string
  toggleFloatingFocused: (target?: number | null) => void
  floatNewShell: () => void
  openSelectedTranscriptInPager: () => void
  cleanupCompletedCoordinatedRunWorktrees: () => Promise<void>
  stopActiveCoordinatedRun: () => Promise<void>
  fleetStripEnabled: boolean
  setFleetStripEnabled: React.Dispatch<React.SetStateAction<boolean>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  fleetPageCount: number
  setFleetPage: React.Dispatch<React.SetStateAction<number>>
  openThemeMenu: () => void
  toggleLightweightWindows: () => void
  stickyHeaders: boolean
  setStickyHeaders: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  density: TuiDensity
  setDensity: React.Dispatch<React.SetStateAction<TuiDensity>>
  diffLayout: TuiDiffLayout
  setDiffLayout: React.Dispatch<React.SetStateAction<TuiDiffLayout>>
  railVisible: boolean
  setRailVisible: React.Dispatch<React.SetStateAction<boolean>>
  focusedPane: PaneFocus
  resizeSidebar: (delta: number) => void
  focusMode: boolean
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>
  toggleFullscreenMode: (forced?: boolean) => void
  setShowToolCalls: React.Dispatch<React.SetStateAction<boolean>>
  toggleVelocityScroll: () => void
  composerAgentOptions: SessionComposerAgentOption[]
  setTuiOpenCodeAgent: React.Dispatch<React.SetStateAction<string>>
  setTuiCopilotMode: React.Dispatch<React.SetStateAction<'shell' | 'interactive' | 'plan' | 'autopilot'>>
  tuiCodexModeByKeyRef: React.RefObject<Record<string, 'plan' | 'default'>>
  setCodexCollaborationMode: (target: Session, mode: 'plan' | 'default') => void
  cycleClaudeComposerPermissionMode: (target: Session | null | undefined) => void
  openModelPicker: () => Promise<void>
  openTranscriptViewMenu: () => void
  transcriptWidth: TuiTranscriptWidth
  setTranscriptWidth: React.Dispatch<React.SetStateAction<TuiTranscriptWidth>>
  effectiveFocus: PaneFocus
  sidebarView: 'sessions' | 'coordinator'
  moveCoordinatorSelection: (delta: number) => void
  moveSelection: (delta: number) => void
  moveAgentToolCursor: (delta: -1 | 1) => boolean
  moveCursor: (delta: number) => void
  jumpToTranscriptIndex: (index: number) => void
  jumpToTranscriptTail: () => void
  moveViewport: (direction: -1 | 1) => void
  tabFromRail: () => void
  jumpToUnreadBoundary: () => void
  jumpToResumeMarker: () => void
  setSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  searchMatches: number[]
  jumpToSearchMatch: (matchOffset: number) => void
  jumpToMatchingCard: (direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => void
  toggleExpansion: (scope?: 'selected' | 'parent') => void
  openSelectedAsyncQuestionsOrFold: () => void
  copySelectedMessage: (cardOverride?: TuiTranscriptCard) => Promise<void>
  replySelectedMessage: (cardOverride?: TuiTranscriptCard) => void
  toggleBookmarkForCursor: () => Promise<void>
  jumpToBookmark: (direction: 1 | -1) => void
  openBookmarksOverlay: () => Promise<void>
  setTaskPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTaskPanelTab: React.Dispatch<React.SetStateAction<'agents' | 'tasks'>>
  setTaskPanelExpanded: React.Dispatch<React.SetStateAction<boolean>>
  resizeTaskPanel: (delta: number) => void
  setTabOrientation: React.Dispatch<React.SetStateAction<'horizontal' | 'vertical'>>
  setTabsEnabled: React.Dispatch<React.SetStateAction<boolean>>
  tabsEnabled: boolean
  addSplitPane: (orientation: SplitPaneOrientation) => void
  rotateSplitOrientation: () => void
  resizeSplitReader: (direction: 1 | -1 | 0) => void
  jumpToNextWindowAttention: () => void
  enterWindowControls: (mode: 'identify' | 'manage') => void
  openWindowControlMenu: (key: string, point?: { x: number; y: number; }, section?: 'resize' | 'swap' | 'session') => void
  focusedControlKey: () => string
  setRecentWindowsOnly: React.Dispatch<React.SetStateAction<boolean>>
  setWindowSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWindowBroadcastOpen: React.Dispatch<React.SetStateAction<boolean>>
  coordinatorWorkspaceRunId: string | null
  checkpointWindowLayout: () => void
  setCoordinatorWorkspace: React.Dispatch<React.SetStateAction<ProtocolRunSnapshot | null>>
  setCoordinatorWorkspaceRunId: React.Dispatch<React.SetStateAction<string | null>>
  toggleWorkspaces: () => void
  openSpaces: (id?: string, close?: boolean) => void
  redoWindowLayout: () => void
  reopenClosedWindow: () => void
  openRecentWindows: () => void
  focusPreviousWindow: () => void
  undoWindowLayout: () => void
  setChordHelp: React.Dispatch<React.SetStateAction<{ map: ChordMap; dismissOnKey: boolean; } | null>>
  closeSplitPane: (paneIndex?: number) => void
  toggleSplitPanes: () => void
  cycleSplitFocus: (direction: 1 | -1) => void
  focusReaderFromSplit: () => void
  cycleSplitPaneSession: () => void
  selectStripIndex: (index: number) => void
  activeStripIndex: number
  tabStripLength: number
  shownPopoverTab: string | null
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  closeSessionTab: (session: Session) => void
  setComposerHidden: React.Dispatch<React.SetStateAction<boolean>>
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  openComposerWindow: () => void
  pasteSystemClipboardToComposer: () => Promise<void>
  toggleComposerHidden: () => void
  stashComposerPrompt: () => void
  popComposerStash: () => void
  openComposerStashList: () => void
  setThinkingMode: React.Dispatch<React.SetStateAction<boolean>>
  setComposerEnableWorkflow: React.Dispatch<React.SetStateAction<boolean>>
  setPluginManagerOpen: React.Dispatch<React.SetStateAction<boolean>>
  openHandoffBrief: () => void
  openPromptLibrary: () => void
  setRenameSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
  copyCliCommand: () => Promise<void>
  toggleComposerBridgeRoute: () => void
  toggleComposerIdeRoute: () => void
  toggleSidebarSort: () => void
  sidebarSort: TuiSidebarSort
  toggleHideScratch: () => void
  toggleSelectedSessionSettled: () => void
  toggleShowSettled: () => void
  setSidebarView: React.Dispatch<React.SetStateAction<'sessions' | 'coordinator'>>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
  provider: ProviderSelection
  selectedSessionTarget: Session | null
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
  requestExit: () => void
}

export function runExecuteCommandPalette(ctx: ExecuteCommandPaletteContext, id: string) {
  const {
    focusedWindowItem, composerTargetSession, closeCommandPalette, openPopoverWindow,
    runPluginCommand, selectedSession, openNewSessionModal, reuseLastPrompt, openProviderMenu,
    setAttentionOpen, jumpToNextAttention, setFocusedPane, setSessionSearchMode, setWorktreeDraft,
    setWorktreeModalOpen, selectedWorktreeTask, setWorktreeConfirm, showNotice,
    openNewWorkflowModal, setDailySummaryOpen, toggleSurfacePanelPlacement, setWindowPickerOpen,
    openSurfaceWindow, gitRepoCwd, toggleFloatingFocused, floatNewShell,
    openSelectedTranscriptInPager, cleanupCompletedCoordinatedRunWorktrees,
    stopActiveCoordinatedRun, fleetStripEnabled, setFleetStripEnabled, showToggleOutcome,
    fleetPageCount, setFleetPage, openThemeMenu, toggleLightweightWindows, stickyHeaders,
    setStickyHeaders, setError, density, setDensity, diffLayout, setDiffLayout, railVisible,
    setRailVisible, focusedPane, resizeSidebar, focusMode, setFocusMode, toggleFullscreenMode,
    setShowToolCalls, toggleVelocityScroll, composerAgentOptions, setTuiOpenCodeAgent,
    setTuiCopilotMode, tuiCodexModeByKeyRef, setCodexCollaborationMode,
    cycleClaudeComposerPermissionMode, openModelPicker, openTranscriptViewMenu, transcriptWidth,
    setTranscriptWidth, effectiveFocus, sidebarView, moveCoordinatorSelection, moveSelection,
    moveAgentToolCursor, moveCursor, jumpToTranscriptIndex, jumpToTranscriptTail, moveViewport,
    tabFromRail, jumpToUnreadBoundary, jumpToResumeMarker, setSearchMode, searchMatches,
    jumpToSearchMatch, jumpToMatchingCard, toggleExpansion, openSelectedAsyncQuestionsOrFold,
    copySelectedMessage, replySelectedMessage, toggleBookmarkForCursor, jumpToBookmark,
    openBookmarksOverlay, setTaskPanelOpen, setTaskPanelTab, setTaskPanelExpanded, resizeTaskPanel,
    setTabOrientation, setTabsEnabled, tabsEnabled, addSplitPane, rotateSplitOrientation,
    resizeSplitReader, jumpToNextWindowAttention, enterWindowControls, openWindowControlMenu,
    focusedControlKey, setRecentWindowsOnly, setWindowSwitcherOpen, setWindowBroadcastOpen,
    coordinatorWorkspaceRunId, checkpointWindowLayout, setCoordinatorWorkspace,
    setCoordinatorWorkspaceRunId, toggleWorkspaces, openSpaces, redoWindowLayout,
    reopenClosedWindow, openRecentWindows, focusPreviousWindow, undoWindowLayout, setChordHelp,
    closeSplitPane, toggleSplitPanes, cycleSplitFocus, focusReaderFromSplit, cycleSplitPaneSession,
    selectStripIndex, activeStripIndex, tabStripLength, shownPopoverTab, closePopoverTab,
    closeSessionTab, setComposerHidden, setComposerActive, openComposerWindow,
    pasteSystemClipboardToComposer, toggleComposerHidden, stashComposerPrompt, popComposerStash,
    openComposerStashList, setThinkingMode, setComposerEnableWorkflow, setPluginManagerOpen,
    openHandoffBrief, openPromptLibrary, setRenameSessionKey, setRenameDraft, copyCliCommand,
    toggleComposerBridgeRoute, toggleComposerIdeRoute, toggleSidebarSort, sidebarSort,
    toggleHideScratch, toggleSelectedSessionSettled, toggleShowSettled, setSidebarView,
    refreshSessions, provider, selectedSessionTarget, refreshSelectedSessionDetail, requestExit,
  } = ctx
  const focusedSession = focusedWindowItem?.kind === 'session' ? focusedWindowItem.session : composerTargetSession
  closeCommandPalette()
  // Popover windows, one palette entry per kind of the registry.
  if (id.startsWith('popwin:')) {
    const kind = id.slice('popwin:'.length)
    if (isPopoverWindowKind(kind)) openPopoverWindow(kind)
    return
  }
  const pluginCommand = getPluginCommand(id)
  if (pluginCommand) {
    // For the focused window's session, as the palette's own session commands are.
    runPluginCommand(pluginCommand, focusedSession ?? selectedSession)
    return
  }
  switch (id) {
    case 'new':
      openNewSessionModal()
      break
    case 'reuse':
      reuseLastPrompt()
      break
    case 'provider':
      openProviderMenu()
      break
    case 'attention':
      setAttentionOpen(true)
      break
    case 'next-attention':
      jumpToNextAttention()
      break
    case 'session-search':
      setFocusedPane('sessions')
      setSessionSearchMode(true)
      break
    case 'worktree-new':
      setWorktreeDraft('')
      setWorktreeModalOpen(true)
      break
    case 'worktree-merge':
      if (selectedWorktreeTask) setWorktreeConfirm('merge')
      else showNotice('info', 'Selected session is not a worktree task', 3500)
      break
    case 'worktree-discard':
      if (selectedWorktreeTask) setWorktreeConfirm('discard')
      else showNotice('info', 'Selected session is not a worktree task', 3500)
      break
    case 'coord-start':
      openNewWorkflowModal()
      break
    case 'daily-summary':
      setDailySummaryOpen(true)
      break
    case 'surface-placement':
      toggleSurfacePanelPlacement()
      break
    case 'window-layout':
      setWindowPickerOpen(true)
      break
    case 'window-terminal':
      openSurfaceWindow('terminal')
      break
    case 'window-diff':
      if (gitRepoCwd) openSurfaceWindow('diff')
      else showNotice('info', 'The diff needs a git repository')
      break
    case 'window-files':
      if (gitRepoCwd) openSurfaceWindow('files')
      else showNotice('info', 'Files need a git repository')
      break
    case 'window-terminal-new':
      openSurfaceWindow('terminal', { another: true })
      break
    case 'window-browser':
      openSurfaceWindow('browser')
      break
    case 'window-pull-request':
      if (gitRepoCwd) openSurfaceWindow('pull-request')
      else showNotice('info', 'Pull requests need a git repository')
      break
    case 'window-agents':
      openSurfaceWindow('agents')
      break
    case 'tab-coordination':
      openPopoverWindow('coordination', undefined, 'tab')
      break
    case 'tab-editor':
      openPopoverWindow('editor', undefined, 'tab')
      break
    case 'window-float':
      toggleFloatingFocused()
      break
    case 'window-float-shell':
      floatNewShell()
      break
    case 'transcript-pager':
      openSelectedTranscriptInPager()
      break
    case 'coord-cleanup':
      void cleanupCompletedCoordinatedRunWorktrees()
      break
    case 'coord-stop':
      void stopActiveCoordinatedRun()
      break
    case 'fleet': {
      const next = !fleetStripEnabled
      setFleetStripEnabled(next)
      showToggleOutcome('Fleet strip', next)
      break
    }
    case 'fleet-prev':
      if (fleetPageCount > 1) setFleetPage((current) => (current - 1 + fleetPageCount) % fleetPageCount)
      break
    case 'fleet-next':
      if (fleetPageCount > 1) setFleetPage((current) => (current + 1) % fleetPageCount)
      break
    case 'theme': {
      openThemeMenu()
      break
    }
    case 'lightweight-windows':
      toggleLightweightWindows()
      break
    case 'sticky-headers': {
      const next = !stickyHeaders
      setStickyHeaders(next)
      showToggleOutcome('Sticky headers', next)
      void writeTuiStickyHeaders(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sticky headers'))
      break
    }
    case 'density': {
      const next = cycleDensityValue(density)
      setDensity(next)
      showToggleOutcome('Density:', next)
      void writeTuiDensity(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store density'))
      break
    }
    case 'diff-layout': {
      const next: TuiDiffLayout = diffLayout === 'stack' ? 'split' : 'stack'
      setDiffLayout(next)
      showToggleOutcome('Diff layout:', next)
      void writeTuiDiffLayout(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store diff layout'))
      break
    }
    case 'rail': {
      const nextVisible = !railVisible
      setRailVisible(nextVisible)
      showToggleOutcome('Session rail', nextVisible)
      if (!nextVisible && focusedPane === 'sessions') setFocusedPane('messages')
      void writeTuiRailVisible(nextVisible).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store rail'))
      break
    }
    case 'rail-narrow':
      resizeSidebar(-SIDEBAR_RESIZE_STEP)
      break
    case 'rail-wide':
      resizeSidebar(SIDEBAR_RESIZE_STEP)
      break
    case 'focus': {
      const next = !focusMode
      setFocusMode(next)
      showToggleOutcome('Focus mode', next)
      if (next) setFocusedPane('messages')
      void writeTuiFocusMode(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store focus mode'))
      break
    }
    case 'fullscreen':
      toggleFullscreenMode()
      break
    case 'tools': {
      setShowToolCalls((v) => {
        const next = !v
        showToggleOutcome('Tool calls', next ? 'shown' : 'hidden')
        void writeTuiShowToolCalls(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
        return next
      })
      break
    }
    case 'velocity-scroll':
      toggleVelocityScroll()
      break
    case 'mode': {
      const target = composerTargetSession ?? selectedSession
      if (target?.provider === 'opencode') {
        if (composerAgentOptions.length === 0) break
        setTuiOpenCodeAgent((current) => {
          const index = Math.max(0, composerAgentOptions.findIndex((agent) => agent.value === current))
          const next = composerAgentOptions[(index + 1) % composerAgentOptions.length]?.value ?? current
          showToggleOutcome('OpenCode mode:', next)
          return next
        })
        break
      }
      if (target?.provider === 'copilot') {
        const order = ['interactive', 'plan', 'autopilot', 'shell'] as const
        setTuiCopilotMode((current) => {
          const next = order[(order.indexOf(current) + 1) % order.length]!
          showToggleOutcome('Copilot mode:', next)
          void runTuiSessionAction(target, {
            action: 'setMode',
            mode: next,
          }).catch(() => { /* swallow; next send carries body.mode */ })
          return next
        })
        break
      }
      if (target?.provider === 'codex') {
        const next = tuiCodexModeByKeyRef.current[sessionKey(target)] === 'plan' ? 'default' : 'plan'
        setCodexCollaborationMode(target, next)
        showToggleOutcome('Codex mode:', next)
        break
      }
      if (target?.provider === 'claude') {
        cycleClaudeComposerPermissionMode(target)
      }
      break
    }
    case 'model': {
      void openModelPicker()
      break
    }
    case 'view': {
      openTranscriptViewMenu()
      break
    }
    case 'width': {
      const next = cycleTranscriptWidth(transcriptWidth)
      setTranscriptWidth(next)
      showToggleOutcome('Transcript width:', next)
      void writeTuiTranscriptWidth(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store transcript width'))
      break
    }
    case 'move-prev':
      if (effectiveFocus === 'sessions') {
        if (sidebarView === 'coordinator') moveCoordinatorSelection(-1)
        else moveSelection(-1)
      } else {
        setFocusedPane('messages')
        if (!moveAgentToolCursor(-1)) moveCursor(-1)
      }
      break
    case 'move-next':
      if (effectiveFocus === 'sessions') {
        if (sidebarView === 'coordinator') moveCoordinatorSelection(1)
        else moveSelection(1)
      } else {
        setFocusedPane('messages')
        if (!moveAgentToolCursor(1)) moveCursor(1)
      }
      break
    case 'first':
      setFocusedPane('messages')
      jumpToTranscriptIndex(0)
      break
    case 'last':
      setFocusedPane('messages')
      jumpToTranscriptTail()
      break
    case 'page-prev':
      setFocusedPane('messages')
      moveViewport(-1)
      break
    case 'page-next':
      setFocusedPane('messages')
      moveViewport(1)
      break
    case 'focus-next':
      if (focusedPane === 'sessions') tabFromRail()
      else setFocusedPane('sessions')
      break
    case 'live':
      setFocusedPane('messages')
      jumpToTranscriptTail()
      break
    case 'unread':
      setFocusedPane('messages')
      jumpToUnreadBoundary()
      break
    case 'mark':
      setFocusedPane('messages')
      jumpToResumeMarker()
      break
    case 'search':
      setFocusedPane('messages')
      setSearchMode(true)
      break
    case 'search-prev':
      setFocusedPane('messages')
      if (searchMatches.length > 0) jumpToSearchMatch(-1)
      else setSearchMode(true)
      break
    case 'search-next':
      setFocusedPane('messages')
      if (searchMatches.length > 0) jumpToSearchMatch(1)
      else setSearchMode(true)
      break
    case 'conversation-prev':
      setFocusedPane('messages')
      jumpToMatchingCard(-1, (card) => card.category === 'conversation')
      break
    case 'conversation-next':
      setFocusedPane('messages')
      jumpToMatchingCard(1, (card) => card.category === 'conversation')
      break
    case 'technical-prev':
      setFocusedPane('messages')
      jumpToMatchingCard(-1, (card) => card.category !== 'conversation')
      break
    case 'technical-next':
      setFocusedPane('messages')
      jumpToMatchingCard(1, (card) => card.category !== 'conversation')
      break
    case 'fold':
      setFocusedPane('messages')
      toggleExpansion()
      break
    case 'fold-parent':
      setFocusedPane('messages')
      openSelectedAsyncQuestionsOrFold()
      break
    case 'copy':
      setFocusedPane('messages')
      void copySelectedMessage()
      break
    case 'reply':
      setFocusedPane('messages')
      replySelectedMessage()
      break
    case 'bookmark-toggle':
      setFocusedPane('messages')
      void toggleBookmarkForCursor()
      break
    case 'bookmark-prev':
      setFocusedPane('messages')
      jumpToBookmark(-1)
      break
    case 'bookmark-jump':
      setFocusedPane('messages')
      jumpToBookmark(1)
      break
    case 'bookmark-all':
      void openBookmarksOverlay()
      break
    case 'tasks':
      setTaskPanelOpen(true)
      setTaskPanelTab('tasks')
      break
    case 'tasks-expand':
      setTaskPanelExpanded((current) => !current)
      break
    case 'tasks-narrow':
      resizeTaskPanel(-TASK_PANEL_RESIZE_STEP)
      break
    case 'tasks-wide':
      resizeTaskPanel(TASK_PANEL_RESIZE_STEP)
      break
    case 'tabs-horizontal':
    case 'tabs-vertical': {
      const next = id === 'tabs-vertical' ? 'vertical' : 'horizontal'
      setTabOrientation(next)
      setTabsEnabled(true)
      void Promise.all([writeTuiTabOrientation(next), writeTuiTabsEnabled(true)]).catch(err => setError(String(err)))
      showNotice('info', `${next === 'vertical' ? 'Vertical' : 'Horizontal'} tabs enabled`)
      break
    }
    case 'tab-toggle': {
      const next = !tabsEnabled
      setTabsEnabled(next)
      showToggleOutcome('Tab bar', next)
      void writeTuiTabsEnabled(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tab setting'))
      break
    }
    case 'split-add':
      addSplitPane('columns')
      break
    case 'split-add-stacked':
      addSplitPane('rows')
      break
    case 'split-rotate':
      rotateSplitOrientation()
      break
    case 'split-grow-reader':
      resizeSplitReader(1)
      break
    case 'split-shrink-reader':
      resizeSplitReader(-1)
      break
    case 'split-even':
      resizeSplitReader(0)
      break
    case 'window-next-attention':
      jumpToNextWindowAttention()
      break
    case 'window-identify':
      enterWindowControls('identify')
      break
    case 'window-manage':
      enterWindowControls('manage')
      break
    case 'window-menu':
      openWindowControlMenu(focusedControlKey())
      break
    case 'window-switcher':
      setRecentWindowsOnly(false); setWindowSwitcherOpen(true)
      break
    case 'window-broadcast':
      setWindowBroadcastOpen(true)
      break
    case 'window-stop-coordinator':
      if (coordinatorWorkspaceRunId) {
        checkpointWindowLayout()
        setCoordinatorWorkspace(null)
        setCoordinatorWorkspaceRunId(null)
        showNotice('info', 'Stopped watching the run · windows remain open')
      } else showNotice('info', 'No Coordinator run is being watched')
      break
    case 'workspaces-toggle':
      toggleWorkspaces()
      break
    case 'spaces-switcher':
      openSpaces()
      break
    case 'window-redo': redoWindowLayout(); break
    case 'window-reopen': reopenClosedWindow(); break
    case 'window-recent': openRecentWindows(); break
    case 'window-previous': focusPreviousWindow(); break
    case 'window-undo':
      undoWindowLayout()
      break
    case 'split-help':
      setChordHelp({ map: SPLIT_CHORD_MAP, dismissOnKey: true })
      break
    case 'split-close':
      closeSplitPane()
      break
    case 'split-toggle':
      toggleSplitPanes()
      break
    case 'split-focus':
      cycleSplitFocus(1)
      break
    case 'split-focus-prev':
      cycleSplitFocus(-1)
      break
    case 'split-flip':
      focusPreviousWindow()
      break
    case 'split-focus-back':
      focusReaderFromSplit()
      break
    case 'split-cycle':
      cycleSplitPaneSession()
      break
    case 'tab-prev': {
      setFocusedPane('messages')
      selectStripIndex(Math.max(activeStripIndex - 1, 0))
      break
    }
    case 'tab-next': {
      setFocusedPane('messages')
      selectStripIndex(Math.min(activeStripIndex + 1, tabStripLength - 1))
      break
    }
    case 'tab-close': {
      if (shownPopoverTab) closePopoverTab(shownPopoverTab)
      else if (selectedSession) closeSessionTab(selectedSession)
      break
    }
    case 'composer':
      setComposerHidden(false)
      setComposerActive(true)
      break
    case 'composer-window':
      openComposerWindow()
      break
    case 'clipboard-paste':
      setComposerActive(true)
      void pasteSystemClipboardToComposer()
      break
    case 'composer-toggle':
      toggleComposerHidden()
      break
    case 'composer-stash':
      stashComposerPrompt()
      break
    case 'composer-stash-pop':
      popComposerStash()
      break
    case 'composer-stash-list':
      openComposerStashList()
      break
    case 'thinking':
      setThinkingMode((current) => {
        const next = !current
        showToggleOutcome('Thinking mode', next)
        return next
      })
      break
    case 'workflow':
      setComposerEnableWorkflow((current) => {
        const next = !current
        showToggleOutcome('Workflow tool (next send)', next)
        return next
      })
      break
    case 'plugins':
      setPluginManagerOpen(true)
      break
    case 'handoff-brief':
      openHandoffBrief()
      break
    case 'prompt-library':
      openPromptLibrary()
      break
    case 'rename':
      if (focusedSession) {
        setRenameSessionKey(sessionKey(focusedSession))
        setRenameDraft(formatSessionTitle(focusedSession))
      }
      break
    case 'cli':
      void copyCliCommand()
      break
    case 'channel-bridge-route':
      toggleComposerBridgeRoute()
      break
    case 'ide-bridge-route':
      toggleComposerIdeRoute()
      break
    case 'sort':
      toggleSidebarSort()
      showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
      break
    case 'scratch':
      toggleHideScratch()
      break
    case 'settle':
      toggleSelectedSessionSettled()
      break
    case 'settled':
      toggleShowSettled()
      break
    case 'sidebar-view':
      setSidebarView((current) => {
        const next = current === 'sessions' ? 'coordinator' : 'sessions'
        showToggleOutcome('Sidebar view:', next)
        return next
      })
      break
    case 'shortcut-guide':
      showNotice('info', 'Press ? at any time outside the composer to open this shortcut guide')
      break
    case 'refresh':
      void refreshSessions(provider)
      if (selectedSessionTarget) void refreshSelectedSessionDetail(selectedSessionTarget, false)
      break
    case 'quit':
      requestExit()
      break
  }
}
