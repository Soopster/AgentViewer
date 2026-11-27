/** @jsxImportSource @opentui/react */
import type { PluginSurfaceId } from '../../../../lib/plugins/catalog'
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
import { SPLIT_CHORD_MAP, type ChordMap, type ChordHelpState } from '../../chordHelp'
import { type WindowItem, type PaneFocus, type NoticeTone } from '../types'
import { TASK_PANEL_RESIZE_STEP, SIDEBAR_RESIZE_STEP } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { userCommandForChordId, shellQuoteArgv } from '../../userKeys'
import { addProcess, startProcess } from '../../processStore'
import { type WindowSurfaceId } from '../SplitTranscriptPane'
import { cycleDensityValue } from '../viewHelpers'
import { type MutableRefObject } from 'react'
import { type TranscriptSessionLoader } from '../../transcriptSessionLoader'
import { type CliRenderer, type TextareaRenderable } from '@opentui/core'
import { upsertThreadedMessage } from '../../liveTranscriptState'
import { formatTranscriptExpandedText } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type AgentProvider, type ContextUsage, type SendAttachment, type SendState } from '../../../../lib/types'
import { rewindCandidates, type RewindCandidate } from '../../rewindTargets'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { type ComposerPromptPart } from '../types'
import { writeClipboard } from '../clipboard'
import { tuiCommandEquivalent } from '../commands'
import { type SurfacePanelState, openSurface as openSurfaceIn } from '../../surfacePanelState'
import { isPluginEnabled } from '../../../../lib/plugins/enablement'
import { getPluginSurface, isPluginSurfaceId } from '../../../../lib/plugins/catalog'
import { type PluginServiceId } from '../../../../lib/plugins/types'
import { type RightPanelSurfaceKind } from '../../../../lib/rightPanel'

export type ExecuteCommandPaletteContext = {
  isolatedView?: boolean
  surfaceToTab: () => void
  openComposerTargetMenu: () => void
  focusedWindowItem: WindowItem | null
  composerTargetSession: Session | null
  closeCommandPalette: () => void
  runPrNextStep: (session: Session | null) => void
  togglePrWatch: (session: Session | null) => void
  openPopoverWindow: (kind: PopoverWindowKind, pin?: SurfaceMeta, placement?: 'beside' | 'fill' | 'tab') => void
  runPluginCommand: (command: ResolvedPluginCommand, session?: Session | null) => void
  selectedSession: Session | null
  openNewSessionModal: () => void
  openNewScratchSession: () => void
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
  toggleSurfacePanelPlacement: () => void
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; fromTab?: WindowSurfaceId; cwd?: string }) => void
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
  setChordHelp: React.Dispatch<React.SetStateAction<ChordHelpState | null>>
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
  setRenameSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
  copyCliCommand: () => Promise<void>
  toggleSidebarSort: () => void
  sidebarSort: TuiSidebarSort
  toggleHideScratch: () => void
  toggleLiftAcrossSpaces: () => void
  toggleSelectedSessionSettled: () => void
  toggleShowSettled: () => void
  setSidebarView: React.Dispatch<React.SetStateAction<'sessions' | 'coordinator'>>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
  provider: ProviderSelection
  selectedSessionTarget: Session | null
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
  requestExit: () => void
}

import { resolveHostCommand } from './hostCommands'
import './palette/windows'
import './palette/view'
import './palette/navigation'
import './palette/composer'
import './palette/sessions'
import './palette/coordination'

export function runExecuteCommandPalette(ctx: ExecuteCommandPaletteContext, id: string) {
  const persistPreference = (write: () => Promise<unknown>) => ctx.isolatedView ? Promise.resolve() : write()
  const {
    focusedWindowItem, composerTargetSession, closeCommandPalette, openPopoverWindow,
    runPluginCommand, selectedSession, openNewSessionModal, openNewScratchSession, openProviderMenu,
    setAttentionOpen, jumpToNextAttention, setFocusedPane, setSessionSearchMode, setWorktreeDraft,
    setWorktreeModalOpen, selectedWorktreeTask, setWorktreeConfirm, showNotice,
    toggleSurfacePanelPlacement, setWindowPickerOpen,
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
    setTaskPanelOpen, setTaskPanelTab, setTaskPanelExpanded, resizeTaskPanel,
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
    setRenameSessionKey, setRenameDraft, copyCliCommand,
    toggleSidebarSort, sidebarSort,
    toggleHideScratch, toggleLiftAcrossSpaces, toggleSelectedSessionSettled, toggleShowSettled, setSidebarView,
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
  if (id.startsWith('panelwin:')) {
    const kind = id.slice('panelwin:'.length)
    if (!isPluginSurfaceId(kind)) return
    if (getPluginSurface(kind).pin === 'cwd' && !gitRepoCwd) { showNotice('info', `${getPluginSurface(kind).title.slice(2)} needs a git repository`); return }
    openSurfaceWindow(kind as never)
    return
  }
  const userCommand = userCommandForChordId(id)
  if (userCommand) {
    // A managed process in the Terminal view, in the focused session's folder.
    const cwd = (focusedSession ?? selectedSession)?.cwd || process.cwd()
    startProcess(addProcess({ name: userCommand.name, command: shellQuoteArgv(userCommand.run, process.platform === 'win32' ? 'cmd' : 'posix'), cwd }))
    openSurfaceWindow('terminal')
    return
  }
  const pluginCommand = getPluginCommand(id)
  if (pluginCommand) {
    // For the focused window's session, as the palette's own session commands are.
    runPluginCommand(pluginCommand, focusedSession ?? selectedSession)
    return
  }
  // The host's own palette commands register by group (./palette/*); a plugin's commands were resolved above.
  resolveHostCommand(id)?.(ctx, id, { persistPreference, focusedSession })
}

export type RunTuiLocalCommandContext = {
  startFreshSession: (targetProvider: AgentProvider, cwd: string) => Promise<void>
  setCodexCollaborationMode: (target: Session, mode: 'plan' | 'default') => void
  sendComposerMessage: (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) => Promise<void>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  executeCommandPalette: (id: string) => void
  editComposerInExternalEditor: () => void
  sessionDetailMtimeRef: React.RefObject<Map<string, number>>
  loader: TranscriptSessionLoader
  refreshSelectedSessionDetail: (session: Session, foreground?: boolean) => Promise<void>
  forkIntoNewSession: (target: Session, sendInFork?: string) => Promise<void>
  composerSendState: SendState
  reattachedRunningRef: React.MutableRefObject<boolean>
  sessionDetail: TuiSessionDetail | null
  setComposerRewindIndex: React.Dispatch<React.SetStateAction<number>>
  setComposerRewindItems: React.Dispatch<React.SetStateAction<RewindCandidate[] | null>>
  handoffToProvider: (target: Session, providerName: string) => Promise<void>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  runPluginCommandId: (id: string, session?: Session | null) => void
  openDiagnostics: (session?: Session | null) => void
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setSessionSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  setExitConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>
  renderer: CliRenderer
  openModelPicker: () => Promise<void>
  switchComposerModel: (target: Session, requested: string) => Promise<void>
  composerCurrentModel: string | null
  contextUsage: ContextUsage | null
  composerPermissionMode: 'plan' | 'default' | 'auto' | 'acceptEdits' | 'bypassPermissions'
  tuiAddedDirsByKeyRef: React.RefObject<Record<string, string[]>>
  setTuiAddedDirsByKey: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  composerLiveSlashCommands: SlashCommandSuggestion[]
  setLocalCommandOutputs: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  openEditorAt: (path: string | null, line: number | null) => void
}

export function runRunTuiLocalCommand(ctx: RunTuiLocalCommandContext, target: Session, text: string) {
  const {
    startFreshSession, setCodexCollaborationMode, sendComposerMessage, showNotice,
    setComposerActive, executeCommandPalette, editComposerInExternalEditor, sessionDetailMtimeRef,
    loader, refreshSelectedSessionDetail, forkIntoNewSession, composerSendState,
    reattachedRunningRef, sessionDetail, setComposerRewindIndex, setComposerRewindItems,
    handoffToProvider, composerTextareaRef, setComposerDraft, runPluginCommandId, openDiagnostics,
    setFocusedPane, setSessionSearchMode, setExitConfirmOpen, renderer, openModelPicker,
    switchComposerModel, composerCurrentModel, contextUsage, composerPermissionMode,
    tuiAddedDirsByKeyRef, setTuiAddedDirsByKey, composerLiveSlashCommands, setLocalCommandOutputs,
    openEditorAt,
  } = ctx
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
  if (!match) return false
  const command = match[1]!.toLowerCase()
  const targetProvider = target.provider ?? 'claude'
  if (command === 'clear' || command === 'new') {
    void startFreshSession(targetProvider, target.cwd ?? process.cwd())
    return true
  }
  // Views every native CLI has, mapped onto the TUI surface that shows them.
  if (command === 'plan' && targetProvider === 'codex') {
    setCodexCollaborationMode(target, 'plan')
    const goal = match[2]!.trim()
    if (goal) setTimeout(() => { void sendComposerMessage(goal) }, 0)
    else showNotice('info', 'Codex is in Plan mode — ⇧Tab returns to Default', 4000)
    return true
  }
  // Native terminal-UI commands answered by the TUI surface that does the
  // same job, or by why there is none — never "cannot run".
  const equivalent = tuiCommandEquivalent(targetProvider, command)
  if (equivalent) {
    if ('palette' in equivalent) {
      setComposerActive(false)
      executeCommandPalette(equivalent.palette)
    } else {
      showNotice('info', equivalent.notice, 8000)
    }
    return true
  }
  if (targetProvider === 'opencode' && command === 'editor') {
    // After the caller has cleared "/editor" from the composer.
    setTimeout(editComposerInExternalEditor, 0)
    return true
  }
  if (targetProvider === 'opencode' && command === 'redo') {
    // Restores what /undo (a revert) took back; nothing to redo is a no-op.
    void runTuiSessionAction(target, { action: 'unrevert' })
      .then(async () => {
        sessionDetailMtimeRef.current.delete(sessionKey(target))
        loader.invalidate(target)
        await refreshSelectedSessionDetail(target, true)
        showNotice('info', 'Restored the reverted messages', 4000)
      })
      .catch((err) => showNotice('error', err instanceof Error ? err.message : 'Redo failed'))
    return true
  }
  if (command === 'side' && targetProvider === 'codex') {
    void forkIntoNewSession(target, match[2]!.trim() || undefined)
    return true
  }
  if (command === 'rewind' || (command === 'undo' && targetProvider === 'opencode') || (command === 'tree' && targetProvider === 'pi')) {
    if (composerSendState === 'sending' || reattachedRunningRef.current) {
      showNotice('info', 'Wait for the turn to finish (or ⌃C it) before rewinding')
      return true
    }
    const detail = sessionDetail && sessionDetail.info?.sessionId === target.sessionId ? sessionDetail : null
    const items = rewindCandidates(detail?.rawMessages ?? [])
    if (items.length === 0) {
      showNotice('info', 'No earlier prompt to rewind to')
      return true
    }
    setComposerRewindIndex(0)
    setComposerRewindItems(items)
    return true
  }
  if (command === 'handoff') {
    void handoffToProvider(target, match[2]!)
    return true
  }
  if (command === 'fork') {
    void forkIntoNewSession(target)
    return true
  }
  if (command === 'mention') {
    // Codex's /mention starts a file mention; here that is the @ picker.
    setTimeout(() => {
      composerTextareaRef.current?.setText('@')
      setComposerDraft('@')
    }, 0)
    return true
  }
  if (command === 'diff') {
    setComposerActive(false)
    runPluginCommandId('git')
    return true
  }
  if (command === 'mcp') {
    setComposerActive(false)
    openDiagnostics(target)
    return true
  }
  if (command === 'resume') {
    setComposerActive(false)
    setFocusedPane('sessions')
    setSessionSearchMode(true)
    return true
  }
  if (command === 'exit' || command === 'quit') {
    setComposerActive(false)
    setExitConfirmOpen(true)
    return true
  }
  if (command === 'copy') {
    const lastReply = [...(sessionDetail?.threadedMessages ?? [])].reverse()
      .find((message) => message.role === 'assistant' && message.blocks.some((block) => block.type === 'text' && block.text.trim()))
    const text = lastReply?.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n\n').trim()
    if (!text) {
      showNotice('info', 'No reply to copy yet', 3500)
      return true
    }
    void writeClipboard(text, renderer)
      .then(() => showNotice('info', 'Copied the last reply', 3000))
      .catch((err) => showNotice('error', err instanceof Error ? err.message : 'Copy failed'))
    return true
  }
  if (command === 'export') {
    const persisted = sessionDetail?.threadedMessages ?? []
    if (persisted.length === 0) {
      showNotice('info', 'Nothing to export yet', 3500)
      return true
    }
    const file = match[2]!.trim() || `conversation-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    const destination = resolve(target.cwd ?? process.cwd(), file)
    try {
      writeFileSync(destination, formatTranscriptExpandedText(persisted), 'utf8')
      showNotice('info', `Exported the conversation to ${destination}`, 8000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Export failed')
    }
    return true
  }
  if (command === 'model') {
    // The composer sends its own model with every turn, so a switch made
    // inside the provider (the SDK's own /model) was undone by the next send.
    const requested = match[2]!.trim()
    if (!requested) {
      setComposerActive(false)
      void openModelPicker()
    } else {
      void switchComposerModel(target, requested)
    }
    return true
  }
  if (targetProvider !== 'claude') return false
  if (command === 'status') {
    // The same resolution the composer footer shows.
    const model = composerCurrentModel ?? 'auto'
    const usage = contextUsage ? ` · Context: ${Math.round(contextUsage.totalTokens / 1000)}k${contextUsage.maxTokens ? `/${Math.round(contextUsage.maxTokens / 1000)}k` : ''}` : ''
    showNotice('info', `Model: ${model} · Mode: ${composerPermissionMode} · Directory: ${target.cwd ?? process.cwd()} · Session: ${target.sessionId}${usage}`, 12_000)
    return true
  }
  if (command === 'add-dir') {
    const requested = match[2]!.trim()
    const key = sessionKey(target)
    const current = tuiAddedDirsByKeyRef.current[key] ?? []
    if (!requested) {
      showNotice('info', current.length ? `Added directories: ${current.join(', ')}` : 'Usage: /add-dir <path>', 8000)
      return true
    }
    const directory = resolve(target.cwd ?? process.cwd(), requested.replace(/^~(?=$|\/)/, homedir()))
    let isDirectory = false
    try { isDirectory = statSync(directory).isDirectory() } catch { /* reported below */ }
    if (!isDirectory) {
      showNotice('error', `Not a directory: ${directory}`)
      return true
    }
    if (!current.includes(directory)) {
      setTuiAddedDirsByKey((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), directory] }))
    }
    showNotice('info', `Added ${directory} — Claude can work there from the next message`, 6000)
    return true
  }
  if (command === 'skills') {
    // Anything Claude Code does not ship itself: skills, and user, project,
    // plugin and MCP commands — what the CLI's /skills lists.
    const skills = composerLiveSlashCommands.filter((entry) => !entry.builtin)
    const stdout = skills.length === 0
      ? 'No skills are available in this session.'
      : ['Skills:', ...skills.map((entry) => `  ${entry.command}${entry.description ? ` — ${entry.description}` : ''}`)].join('\n')
    setLocalCommandOutputs((prev) => upsertThreadedMessage(prev, {
      role: 'user',
      uuid: `live-local-skills:${Date.now()}`,
      sessionId: target.sessionId,
      provider: target.provider,
      timestamp: new Date().toISOString(),
      blocks: [{ type: 'local_command_stdout', stdout }],
    }))
    return true
  }
  if (command === 'hooks' || command === 'permissions') {
    // Diagnostics (⇧D) lists both, read from the session itself.
    setComposerActive(false)
    openDiagnostics(target)
    return true
  }
  // /bashes: background shells are SDK background tasks, listed with the todos.
  if (command === 'todos' || command === 'bashes') {
    runPluginCommandId('tasks-full')
    return true
  }
  if (command === 'memory') {
    const memoryPath = join(target.cwd ?? process.cwd(), 'CLAUDE.md')
    if (!existsSync(memoryPath)) {
      showNotice('info', 'This project has no CLAUDE.md yet — /init creates one', 6000)
      return true
    }
    openEditorAt(memoryPath, null)
    return true
  }
  return false
}

export type RunPluginCommandContext = {
  selectedSession: Session | null
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  pluginServiceGaps: Partial<Record<PluginServiceId, string>>
  gitRepoCwd: string
  setEditorInitialPath: React.Dispatch<React.SetStateAction<string | null>>
  setEditorInitialLine: React.Dispatch<React.SetStateAction<number | null>>
  setCheckpointFocusPrompt: React.Dispatch<React.SetStateAction<{ sessionId: string; text: string; timestamp?: string; } | null>>
  setCoordBoardRunId: React.Dispatch<React.SetStateAction<string | null>>
  openTeammatesPanel: () => void
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanel: React.Dispatch<React.SetStateAction<SurfacePanelState>>
  setPluginOpenRequests: React.Dispatch<React.SetStateAction<Partial<Record<PluginSurfaceId, { count: number; session: Session | null; }>>>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<PluginSurfaceId | null>>
}

export function runRunPluginCommand(ctx: RunPluginCommandContext, command: ResolvedPluginCommand, session?: Session | null) {
  const {
    selectedSession, showNotice, pluginServiceGaps, gitRepoCwd, setEditorInitialPath,
    setEditorInitialLine, setCheckpointFocusPrompt, setCoordBoardRunId, openTeammatesPanel,
    setSurfacePanelOpen, setSurfacePanelFocused, setSurfacePanel, setPluginOpenRequests,
    setPluginOverlay,
  } = ctx
  if (session === undefined) session = selectedSession
  if (!isPluginSurfaceId(command.opens)) return
  if (!isPluginEnabled(command.pluginId)) {
    showNotice('info', `${command.label} is off · turn its plugin on in Plugins (⌃K palette)`)
    return
  }
  // A service the host cannot offer right now says why, rather than opening an empty view.
  const gap = getPluginSurface(command.opens).services.map((id) => pluginServiceGaps[id]).find(Boolean)
  if (gap) { showNotice('error', gap); return }
  if (command.requires === 'session' && !session) { showNotice('info', `${command.label} needs a session`); return }
  if (command.requires === 'repository' && !gitRepoCwd) {
    showNotice('info', 'Selected session has no working directory', 3000)
    return
  }
  // A command names no file, so the editor opens where it was; nor a turn.
  if (command.opens === 'editor') { setEditorInitialPath(null); setEditorInitialLine(null) }
  if (command.opens === 'checkpoints') setCheckpointFocusPrompt(null)
  // A command opens the control center on the latest run.
  if (command.opens === 'coordination') setCoordBoardRunId(null)
  // Teammates are the store's: opening them is opening the conversation's team.
  if (command.opens === 'teammates') { openTeammatesPanel(); return }
  if (command.placement === 'panel') {
    // A side-panel tab: the one already open, or a new one. Several may exist
    // (shells); one in a window is its own and stays where it is.
    const kind = command.opens as RightPanelSurfaceKind
    setSurfacePanelOpen(true)
    setSurfacePanelFocused(true)
    setSurfacePanel((current) => {
      const existing = current.surfaces.find((surface) => surface.kind === kind)
      return existing ? { ...current, activeId: existing.id } : openSurfaceIn(current, kind)
    })
    return
  }
  const opens = command.opens
  setPluginOpenRequests((current) => ({ ...current, [opens]: { count: (current[opens]?.count ?? 0) + 1, session } }))
  setPluginOverlay(current => command.toggle && current === opens ? null : opens)
}
