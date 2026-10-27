/** @jsxImportSource @opentui/react */
import { presentationIndex, type WindowPresentation } from './windowPresentation'
import { VerticalTabs, verticalTabRailWidth } from './VerticalTabs'
import { tabStripName, tabStripActivity, tabStripWidth, HORIZONTAL_TAB_BAR_HEIGHT } from './tabStrip'
import { panelSurfaceAvailability } from '../../lib/rightPanel'
import { indexComposerMessages, visibleComposerMessages } from '../../lib/composerTranscript'
import { createComposerSessions, useComposerSessionState } from '../../lib/composerSessions'
import { SessionTabConnection } from './SessionTabConnection'
import { liveMessageSessionKey, upsertThreadedMessage } from './liveTranscriptState'
import { formatAsyncQuestionAnswers } from '../../lib/asyncQuestions'
import { createSidebarSessionSearch } from './sidebarSessionSearch'
import { hideScratchSessions } from './scratchSessions'

import { composerProjectLabel, cycleTranscriptWidth } from './engineeringLayout'

import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, startTransition, useState, useSyncExternalStore } from 'react'
import { recordVoice } from './voiceRecorder'
import { lazyComponent } from './lazyComponent'
import { PluginSurfaceHost } from './shell/PluginSurfaceHost'
import type { TuiPluginCapture, TuiProvidedPluginServices } from './shell/pluginTypes'
import { applyPluginSettings, isPluginEnabled } from '../../lib/plugins/enablement'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'
import { isProviderEnabled } from '../../lib/plugins/providerPlugins'
import { readPluginSettingsFile } from '../../lib/plugins/settingsFile'
import { getPluginCommand, getPluginSurface, isPluginPanelSurfaceId, isPluginSurfaceId, listPluginCommands, type PluginSurfaceId, type ResolvedPluginCommand } from '../../lib/plugins/catalog'
import type { PluginKeyChord, PluginServiceId } from '../../lib/plugins/types'
import { NewSessionModal, enabledNewSessionProviders } from './NewSessionModal'
import { HandoffBriefPopover } from './HandoffBriefPopover'
import { readBridgeConfigFromEnv, subscribeToChannelEvents, type ChannelEvent } from '../../lib/channelBridge'
import {
  createChannelBridgeMessageId,
  flushChannelBridgeOutbox,
  sendDurableChannelMessage,
} from '../../lib/channelBridgeOutbox'
import { readIdeBridgeConfigFromEnv, sendIdeAtMention } from '../../lib/ideBridge'
import { ToastOverlay, toastExtraRows, toastStackTop, useToasts } from './ToastOverlay'
import { PiActivityPopover } from './PiActivityPopover'
import { toast } from './toastStore'
import { toBmpSafe } from './bmp'
import { loadBridgeMessagesForSession, addBridgeMessage, channelBridgeFileOutboxStorage } from '../../lib/bridgeMessages'
import { isAgentProvider } from '../../lib/provider'
import { TaskSidePanel } from './TaskSidePanel'
import { openExternalUrl } from './terminalBrowser'
import { parseTuiLinkTarget } from '../../lib/tuiLinkTargets'
import { SurfacePanel } from './SurfacePanel'
import { WindowButton } from './WindowButton'
import { useTranscriptWindowPositions } from './transcriptWindowState'
import { swapPaneSlots, placePaneSlot, adoptPrimaryWindow, arrangePaneTree, movePaneToEdge, replacePrimaryWindow, removePrimaryWindow, placeWindowSplit, validWindowSplitTree, reconcileWindowSplitTree, computeWindowSplitTree, splitTreeFromRects, splitWindowLeaf, splitPath, updateSplitRatio, evenWindowSplitTree, rotateWindowSplitTree, type WindowSplitTree, type WindowSplitNode } from './windowSplitTree'
import { WINDOW_SURFACE_TITLES, surfaceKindOf, surfaceTitle, type WindowSurfaceKind } from './windowSurfaceNames'
import { copySurfaceViewState, migratePanelViewState, surfaceViewNamespace } from './windowViewState'
import { WorkspaceOverview } from './WorkspaceOverview'
import { moveWorkspaceWindow } from './workspaceWindowMove'
import { reassignShell } from './shellStore'
import { reassignProcess } from './processStore'
import type { OverviewNode, OverviewWindow } from './workspaceOverviewData'
import { WindowControlOverlay } from './WindowControlOverlay'
import { focusAfterWindowClose, WINDOW_CONTROL_ACTIONS, WINDOW_MENU_ACTIONS, WINDOW_RESIZE_ACTIONS, windowManagementKey, type WindowControlAction, type WindowControlContext, type ControlWindow } from './windowControls'
import { findPopoverWindow, isPopoverWindowKind, nextSurfaceId, pinFor, POPOVER_WINDOWS, readSurfaceMeta, type PopoverWindowKind, type SurfaceMeta } from './popoverWindows'
import { addToStack, clampFloatingRect, defaultFloatingRect, liveStacks, removeFromStack, replaceWindowKey, stackNeighbour, stackOf, stackSuccessor, type FloatingRect, type WindowStack } from './windowTabs'

import { fitWindows, isSurfaceWindowKey, moveWindowBeside, orderWindows, surfaceIdOfKey, surfaceWindowKey, swapWindowSlots } from './windowOrder'
import { computeResponsiveWindowLayout, type WindowGroupKey, type WindowWeights, windowLayoutRects, windowPreviewLines, readerShareAt, windowDropZone, windowDropZoneRect, windowInDirection, type WindowArrangement, type WindowDirection, type WindowDropZone } from './windowLayout'
import type { WindowLayoutAction } from './WindowLayoutPicker'
import type { ContextMenuItem } from './ContextMenu'
import { startSpacesBackground } from './spacesBackground'
import { SpacesController, canonicalSpacePath } from './spacesStore'
import { WorkspaceContext, WorkspaceViewContext, useWorkspaceContext, useWorkspaceState, useQuietWorkspaceState, useAppState, useWorkspaceRef, workspaceStorageKey } from './workspaceContext'
import { SpacesRail, WorkspaceTabs, WorkspaceLauncher, SpacesManager } from './SpacesNavigation'
import { LIGHT_THEME } from '../theme'
import { WindowHistory } from './windowHistory'
import { windowSessionTarget, type WindowTarget } from './windowTargets'
import type { BroadcastDelivery } from './windowBroadcast'
import { nextWindowNeedingAttention, observeWindowAttention, readWindowAttention, windowAttentionBadge, type WindowAttention } from './windowAttention'
import { planWindowSessionDrop, type WindowSessionDrop } from './windowOperations'
import { coordinatorWindowBadges, planCoordinatorWorkspace } from './coordinatorWorkspace'
import { useCoordinatorWorkspace } from './useCoordinatorWorkspace'
import { deleteWindowLayout, describeSavedLayout, listSavedWindowLayouts, saveWindowLayout, updateWindowLayout, type SavedWindowLayout } from './windowLayoutStore'
import {
  EMPTY_SURFACE_PANEL,
  activeSurface,
  closeSurface as closeSurfaceIn,
  cycleSurface as cycleSurfaceIn,
  openSurface as openSurfaceIn,
  type TuiSurface,
} from './surfacePanelState'
import type { RightPanelSurfaceKind } from '../../lib/rightPanel'
import {
  appendComposerSentHistory,
  flushComposerStashWrites,
  readComposerDraft,
  readComposerDraftParts,
  readComposerQueue,
  readComposerSentHistory,
  readComposerStash,
  scheduleWriteComposerStash,
} from '../../lib/tuiComposerState'
import { frecencyKey, frecencyPrefix, readFrecencyScores, recordFrecencyUse } from '../../lib/tuiFrecency'
import { registerExtraTreeSitterParsers } from './treeSitterParsers'
import { startTuiMetricsLogger, noteRenderFrame, noteTuiComposerLatency, noteTuiNavLatency, registerTuiMetricsGauge, logCardRecompute } from './metricsLogger'


import type { SelectedLineRange } from '@pierre/diffs'
import { LayoutEvents, RGBA, TextAttributes } from '@opentui/core'
import type { BoxRenderable, MouseEvent, ScrollBoxRenderable, SelectOption, TabSelectOption, TabSelectRenderable, TextareaRenderable } from '@opentui/core'


import { TranscriptDetailCache } from './transcriptDetailCache'
import { mainTranscriptBudget } from './sessionCacheBudget'


import { useKeyboard, usePaste, useRenderer, useSelectionHandler, useTerminalDimensions } from '@opentui/react'
import {
  formatProviderLabel,
  formatSessionProject,
  formatSessionTitle,
  buildTaskActiveForms,
  formatTranscriptCard,
  formatTranscriptExpandedText,
  type TuiTranscriptCard,
} from '../format'
import { editTextInEditor, openTranscriptInPager } from './transcriptPager'
import { computeTurnDurationsMs, stripToolCallBlocks, type ThreadedMessage } from '../../lib/threading'
import { buildTaskRegistry } from '../../lib/taskRegistry'
import { buildDiffCommentComposerPrompt } from '../../lib/diffCommentComposer'
import {
  clearComposerQueueTarget,
  createComposerQueueItemId,
  mergeComposerAttachments,
  rekeyComposerQueueTarget,
  removeComposerQueueItem,
  restoreComposerDraftPayload,
  selectComposerQueueTarget,
} from '../../lib/composerAttachments'
import { getProviderAccent, getThemePalette, setTerminalPaletteTheme, terminalPaletteTheme, type TerminalReportedColors, setActiveTheme, type TuiDensity, type TuiThemeMode, type TuiTranscriptView } from '../theme'
import { patchTuiSession, readTuiDensity, readTuiDiffLayout, readTuiFocusMode, readTuiStickyHeaders, readTuiLightweightWindows, readTuiProvider, readTuiProviderInstances, readTuiRailVisible, readTuiSessionDiagnostics, readTuiSessionReaderState, readTuiSessionMetadata, readTuiSidebarSort, readTuiHideScratchSessions, readTuiShowSettledSessions, writeTuiShowSettledSessions, updateTuiSessionInbox, readTuiSidebarWidth, readTuiShowToolCalls, readTuiTabsEnabled, readTuiTabOrientation, readTuiSplitPanes, readTuiSplitOrientation, readTuiSplitReaderShare, readTuiDaemonWarning, readTuiTheme, readTuiThemeFollow, readTuiTranscriptView, readTuiTranscriptWidth, readTuiVelocityScroll, readTuiSurfacePanelPlacement, readTuiWindowArrangement, readTuiSessionBookmarkIds, readTuiAllBookmarks, readTuiPrompts, readTuiPrompt, saveTuiPrompt, deleteTuiPrompt, toggleTuiSessionBookmark, runTuiSessionAction, streamTuiSessionTurn, sendTuiCrossSessionMessage, interruptTuiSessionTurn, listTuiRunningSessions, listTuiAddressableSessions, readTuiRuntimeActivity, dismissTuiViewerAttention, createTuiSession, forkTuiSession, rewindTuiSession, listTuiCheckpoints, restoreTuiCheckpoint, readTuiComposerOptions, listTuiProtocolRuns, listTuiRunPlaybooks, readTuiProtocolRun, startTuiProtocolRun, stopTuiProtocolRun, cleanupTuiProtocolRunWorktrees, createTuiWorktreeTask, findTuiWorktreeTask, mergeTuiWorktreeTask, removeTuiWorktreeTask, type WorktreeTask, prewarmTuiSession, writeTuiDensity, writeTuiDiffLayout, writeTuiFocusMode, writeTuiStickyHeaders, writeTuiLightweightWindows, writeTuiProvider, writeTuiRailVisible, writeTuiSessionReaderState, writeTuiShowToolCalls, writeTuiSidebarSort, writeTuiHideScratchSessions, writeTuiSidebarWidth, writeTuiTabsEnabled, writeTuiTabOrientation, writeTuiSplitPanes, writeTuiSplitOrientation, writeTuiSplitReaderShare, writeTuiTheme, writeTuiThemeFollow, writeTuiThemeSync, writeTuiTranscriptView, writeTuiTranscriptWidth, writeTuiVelocityScroll, writeTuiSurfacePanelPlacement, writeTuiWindowArrangement, type TuiSessionDetail, type TuiProviderInstanceChoice, type TuiDiffLayout, type TuiSidebarSort, type TuiTranscriptWidth } from '../../lib/tui/service'
import { peekTuiClaudePlanLimits, readTuiClaudePlanLimits, readTuiLineHistory } from '../../lib/tui/service'
import { buildSelectionAskPrompt, type SelectionAskInput } from '../../lib/selectionAsk'
import { type ClaudePlanLimits } from '../../lib/claudePlanLimits'
import type { MessageBookmark } from '../../lib/messageBookmarks'
import type { PlaybookSummary, ProtocolAgent, ProtocolAutonomy, ProtocolRunSnapshot } from '../../lib/agentProtocol'
import {
  extractClaudeStreamToolInputDelta,
  extractClaudeStreamToolResults,
  extractClaudeStreamToolUse,
  normalizeClaudeStreamThreadedMessage,
  parseClaudeStreamToolInput,
} from '../../lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '../../lib/codexMapper'
import { readTuiSessionMetadataAsync } from './metadataWorkerClient'
import { shouldPrewarmTuiRuntime } from './sessionPrewarm'
import { useTranscriptSessionLoader } from './useTranscriptSessionLoader'
import { RetainedWindow } from './windowActivity'

import { useStableEvent } from './useStableEvent'
import { useTranscriptWindowChromeHost, type WindowChrome } from './windowChrome'
import { transcriptWindowCommand } from './transcriptWindowInput'




import { sessionTranscriptUpdatedAt } from './sessionRefreshPolicy'
import { filterComposerMentionFilesAsync } from './composerMentionWorkerClient'
import {
  attachedTranscriptCardsForVariant,
  readTuiSessionsAsync,
  readTuiSubagentSummariesAsync,
  readTuiSubagentTranscriptAsync,
  formatTranscriptCardsAsync,
  readTuiComposerAffordancesAsync,
  getTranscriptCardsSync,
  warmTranscriptAsync,
} from './sessionDetailWorkerClient'
import type { TuiSessionReaderState } from '../../lib/tuiState'
import type { AgentProvider, ContextUsage, ProviderSelection, RunningSessionRef, SendAttachment, SendState, Session, SessionComposerAgentOption, SubagentSummary } from '../../lib/types'
import { fitText, joinMeta } from './textLayout'
import { Slot } from './slots'
import { peekGitSummaryCached, readGitSummaryCached } from './gitSummaryCache'
import './slotRegistrations'
import { coordinatorSidebarHeaderText } from './CoordinatorSidebar'
import {
  getCoordinatorState,
  setCoordinatorSelectedKey,
  subscribeCoordinator,
  cycleCoordinatorFilter,
} from './coordinatorStore'
import { getTeamAttention, startTeamAttentionFeed, subscribeTeamAttention } from './teamAttentionStore'
import type { CoordinatorPickerFilter } from '../../lib/coordinatorSignals'
import { AttentionInboxPopover, attentionItemNeedsInput, type AttentionItem } from './AttentionInboxPopover'
import type { RemoteCoordinatorTarget } from '../../lib/tui/remoteCoordinator'
import { MODAL_CONTENT_Z_INDEX, MODAL_SCRIM_Z_INDEX, paintModalScrim } from './layers'
import { TeammatesAttention } from './TeammatesAttention'
import { coordinatorAlertDelivery } from '../../lib/coordinatorSignals'
import {
  closeInteractiveCoordinator,
  isInteractiveCoordinatorOpen,
  openInteractiveCoordinator,
  subscribeInteractiveCoordinator,
  subscribeInteractiveCoordinatorNotifications,
  getInteractiveCoordinatorNotifications,
} from './interactiveCoordinatorStore'
import { getContinueInCliCommand } from '../../lib/cliContinue'
import { commandResultExpectsTranscript, isNativeComposerCommandText } from '../../lib/composerCommands'
import { deliverComposerSteer } from '../../lib/composerSteering'
import { checkpointForPrompt } from '../../lib/rewindCheckpoint'
import { buildContextHandoffPrompt } from '../../lib/contextHandoff'
import { buildHandoffBriefMarkdown } from '../../lib/handoffBrief'
import { recordContextTransfer } from '../../lib/contextTransfers'
import { forkPointBefore, rewindCandidates, type RewindCandidate } from './rewindTargets'
import { parseClaudeCommandLifecycle } from '../../lib/claudeCommandLifecycle'
import { isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs, TransientAwareSendError, type UsageLimitKind } from '../../lib/transientError'
import { listProjectFiles } from '../../lib/projectFiles'
import type { GitSummary } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import { getSlashCommandSuggestions, filterSlashCommands, normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '../../lib/slashCommands'
import { parseCrossSessionComposerCommand } from '../../lib/crossSessionCommands'
import { getProviderComposer, pickProviderExample } from '../../lib/providerComposer'
import { isPendingRequestGone, PENDING_REQUEST_GONE_NOTICE } from '../../lib/pendingRequestGone'
import { initialQuestionState, defaultPermissionOptionIndex, extractPendingPermission, permissionMcpServerLabel, extractPendingPermissions, extractPermissionReply, permissionOptionsFor, type PendingPermission, type PendingQuestionAnswers, type PendingQuestionOption, type PermissionOption, type PermissionResponse } from '../../lib/permissions'
import type { readViewSessionComposerOptions } from '../../lib/sessionBackend'
import {
  sessionMessageFingerprint,
  sessionMessageSequenceFingerprint,
  summarizeDurableSessionMessages,
} from './messageFingerprint'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { adjustSplitReaderShare, calculateSplitPaneLayout, evenSplitReaderShare, groupItemsBySplitPaneKey, isComposerTargetReady, removeSplitPaneKey, resolveComposerTargetSession, resolveCoordinationTranscriptTarget, resolveSelectedSession, resolveSelectedSessionIndex, runComposerSessionPreparation, SPLIT_SHARE_EVEN, SPLIT_SHARE_MAX, SPLIT_SHARE_MIN, SPLIT_SHARE_STEP, type SplitPaneOrientation, planTeammateWatch } from './splitPaneState'
import {
  CHORD_HELP_REVEAL_MS,
  CHORD_PENDING_TIMEOUT_MS,
  chordHelpKeyWidth,
  chordHelpRows,
  chordHintText,
  chordUnknownKeyNotice,
  COMMAND_CHORD_MAP,
  SPLIT_CHORD_MAP,
  type ChordMap,
} from './chordHelp'
import { isAltKey, isCtrlKey, isCtrlShiftKey, isShiftedKey, PORTABLE_COMMAND_CHORDS, portableCommandChord } from './shortcutKeys'
import { type RunningRegistryEntry, type MenuPoint, type WindowItem, type ComposerPromptPart, type QueuedComposerSend, type ComposerDraftSnapshot, type ClipboardImage, type SseFrame, type TuiLiveToolActivity, type PendingInboxEdit, type SidebarEntry, type SidebarSubagentEntry, type ModelPickerOption, type TuiEffort, type PaneFocus, type TuiMentionResult, type SteeredComposerSend, type TuiPermissionMode, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier, type ModelPickerFocus, type ComposerPromptPartRange, type ComposerSubmission, CLAUDE_PERMISSION_MODE_ORDER, type PaletteRow, type NoticeTone } from './app/types'
import { NATIVE_OSC_ENABLED, RECENT_WRITE_ACTIVE_MS, SYNC_FORMAT_CARD_LIMIT, AWAITING_PERSISTED_TURN_TIMEOUT_MS, COMPOSER_GIT_SUMMARY_POLL_MS, COMPOSER_GIT_SUMMARY_IDLE_POLL_MS, COMPOSER_AFFORDANCES_CACHE_MAX, COMPOSER_AFFORDANCES_TTL_MS, DETAIL_OPEN_DELAY_MS, CLAUDE_METADATA_REFRESH_MS, DEFAULT_METADATA_REFRESH_MS, CLAUDE_BACKGROUND_METADATA_REFRESH_MS, DEFAULT_BACKGROUND_METADATA_REFRESH_MS, METADATA_REQUEST_TIMEOUT_MS, ATTACHED_DAEMON_HOST, EXIT_CLEANUP_TIMEOUT_MS, ATTENTION_DONE_LIMIT, LIVE_TEXT_FLUSH_MS, STREAM_STALL_SENTINEL, CLAUDE_STREAM_STALL_MS, NOTIFY_AFTER_MS, NOTIFY_PREVIEW_CHARS, REATTACH_POLL_MS, DETAIL_OPEN_CACHED_DELAY_MS, NEIGHBOR_PREFETCH_RADIUS, NEIGHBOR_PREFETCH_DELAY_MS, SESSION_REFRESH_MS, DETAIL_REFRESH_MS, IS_WINDOWS, SEARCH_MAX_CHARS } from './app/timing'
import { FLOATING_PANE_INDEX, READER_CARD_WINDOW, DEFAULT_SIDEBAR_WIDTH, TASK_PANEL_DEFAULT_WIDTH, SURFACE_PANEL_DEFAULT_WIDTH, SURFACE_PANEL_DEFAULT_ROWS, SUBAGENT_SUMMARY_CACHE_LIMIT, COMPOSER_DOCK_CHROME_HEIGHT, CHAT_COMPOSER_MIN_HEIGHT, CHAT_COMPOSER_CHROME_HEIGHT, COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT, SURFACE_PANEL_MIN_ROWS, SURFACE_PANEL_READER_MIN_ROWS, TASK_PANEL_MIN_WIDTH, MIN_READER_WIDTH, SURFACE_PANEL_MIN_WIDTH, MIN_SIDEBAR_WIDTH, SPLIT_TREE_LIMITS, ZOOM_TREE_LIMITS, SPLIT_PANE_MAX, SPLIT_PANE_ARRANGED_MAX, SPLIT_PANE_MIN_WIDTH, SPLIT_PANE_MIN_ROWS, MIN_READER_ROWS, FULLSCREEN_PANE_INDEX, COMPOSER_WINDOW_MAX_WIDTH, COMPOSER_WINDOW_MAX_HEIGHT, VELOCITY_SCROLL_RESET_MS, VELOCITY_SCROLL_RAMP_MS, VELOCITY_SCROLL_MAX_STEP, WORKTREE_TASK_CWD_SEGMENT, TASK_PANEL_RESIZE_STEP, TERMINAL_SELECTION_COPY_WINDOW_MS, MULTI_INSTANCE_SURFACES, SURFACE_POPOVER_KINDS, SIDEBAR_RESIZE_STEP, SURFACE_PANEL_ROW_STEP, SURFACE_PANEL_RESIZE_STEP, SURFACE_PANEL_MAX_WIDTH, COMPOSER_SHELL_CURSOR, COMPOSER_PROMPT_CURSOR } from './app/layoutConstants'
import { clamp } from './app/util'
import { PERF_LOG, PERF_LOG_PATH, CARD_PROFILE, noteRootRender, FRAME_TIMING_NEEDED, recordFramePerf, sameJson } from './app/perf'
import { type ThemeMenuGroup, THEMES, isLightThemeMode, OMZ_MODES, TERMINAL_PALETTE_MODE, THEME_GROUPS, filterThemeModes, themeGroupModes, THEME_LABELS, THEME_DESCRIPTIONS } from './app/themes'
import { pastedImageDisplayName, isComposerDraftSnapshot, isQueuedComposerSend, type ComposerDraftShape, composerDraftLineCount, activeMentionAttachments, composerSnapshotText, attachmentCountLabel, computeComposerDraftShape, sameComposerDraftShape, detectMentionAtCursor, imageAttachmentCount, pasteImageMimeType, inferPastedImageMimeType, composerKeyBindings, compactComposerEntryText, composerEntryLineCount } from './app/composerInput'
import { cardClipboardText, writeClipboard, normalizePastedFilePath, pastedFileMimeTypeForPath, readClipboardImage, readClipboardText, isWslRuntime } from './app/clipboard'
import { type InlineTextSegment, renderInlineTextSegments, renderInlineMarkdownSpans, LIVE_PREVIEW_HEIGHT, wrapLivePreviewTail, LIVE_PREVIEW_BODY_LINES, inlineSegmentIndexAt, inlineSegmentActionAt, composerSendingHintSegments, DraftLengthSpans, LivePreviewCard } from './app/inlineText'
import { contextBarColor, formatContextUsageChip, planLimitSegment, formatLiveOutputTokens, fmtTokens, footerDockStatsReserve, formatTuiComposerIdleHint, fitHintText, contextBarSegments } from './app/contextMeter'
import { formatModelChipValue, timeAgo } from './app/format'
import { Spinner, TAB_SPINNER_FRAMES, TAB_SPINNER_INTERVAL_MS, ComposerWaitingStatus, IdleTicker } from './app/chrome'
import { isDurableSessionMessage, isLiveAssistantTextMessage, hasLiveAssistantMessage, persistedTurnSettled, hasPersistedAssistantAfterBaseline, hasPersistedUserAfterBaseline, completeCodexQuestionLiveMessage, makeLiveUserMessage, codexQuestionLiveMessage, streamEventIndex, updateLiveToolThreadInput, applyLiveToolResult, extractOpenCodeLiveToolThread, extractOpenCodeLiveSubagent, extractCodexLiveToolActivity, applyLiveToolActivity, appendCodexLiveToolOutput, extractCopilotFinalAssistantMessage, extractStreamingAssistantText, extractStreamingReasoningText, shouldReplaceLiveAssistantText, makeLiveAssistantTextMessage, extractCodexVisibleAssistantText, shouldReplaceCodexVisibleAssistantText, liveAssistantTextKey, extractSseFrames } from './app/liveStream'
import { sessionKey, sessionActivityMs, buildSidebarEntries, sidebarEntrySession, withPendingInboxEdits, sessionsShallowEqual, sessionDetailOwnerKeys, sidebarEntrySessionKey, isSessionRecentlyTouched, createSidebarRowElements, PENDING_INBOX_EDIT_MS } from './app/sessionList'
import { mixHexColor, buildComposerSyntaxStyle, densityConfig, buildSyntaxStyle, registerTurnSummaryOpener } from './app/transcriptStyle'


import { cardDiffText, filePathFromDiffText, agentToolCardsFor, agentToolCardIsExpanded, nestedAgentToolDisplay, visibleCardsForTranscriptView, resolveExpandedCardKeys } from './app/transcriptRows'

import { type TranscriptDiffNoteDraft, type TranscriptDiffNote, transcriptDiffCardNamespace, transcriptDiffSelectionKey, transcriptDiffSelectionLineLabel, transcriptDiffSelectionSpanFromRowRange, nextTranscriptDiffRowIndex } from './app/transcriptDiffSelection'
import { type CoordModalFocus, sessionProviderLabel, filterModelPickerOptions, effortPickerOptions, PERMISSION_MODE_GLYPH, PERMISSION_MODE_LABEL, QUESTION_PREVIEW_MAX_LINES, QUESTION_PICKER_MIN_TRANSCRIPT_ROWS, QUESTION_PICKER_MIN_ROWS, QUESTION_PREVIEW_MIN_ROWS, providerOptionIndex, providerSelectOptions, parseCoordContractLines, moveCoordModalFocus, cycleCoordProvider, coordRunProviders, cycleCoordAutonomy, TUI_PROVIDER_TAG } from './app/pickers'
import { FLEET_PAGE_SIZE, TRANSCRIPT_VIEWS, COMMANDS, COMMAND_CATEGORY_ORDER, tuiCommandEquivalent, RUNNING_INSIDE_TMUX, TRANSCRIPT_VIEW_LABELS, TRANSCRIPT_VIEW_DESCRIPTIONS } from './app/commands'
import { createLazyTranscriptIndexLookup } from './app/transcriptIndex'
import { type TranscriptCardSelectionVariants, selectTranscriptCardVariants } from './app/TranscriptCard'

import { type WindowSurfaceId, isDoubleClick, SPLIT_PANE_EMPTY_LIVE, PinnedSessionDetail, type SplitPaneHandle, type TranscriptDiffControls, SplitTranscriptPane } from './app/SplitTranscriptPane'
import { terminalSelectionCopyDestination } from './app/terminalSelection'
import { keepEmpty, keepFiltered, sameKeys, touchMapEntry, pruneSessionCaches } from './app/collections'
import { ExitConfirmOverlay } from './app/overlays/ExitConfirmOverlay'
import { QuestionPickerOverlay } from './app/overlays/QuestionPickerOverlay'
import { WorktreeModalOverlay } from './app/overlays/WorktreeModalOverlay'
import { WorktreeConfirmOverlay } from './app/overlays/WorktreeConfirmOverlay'
import { TranscriptSearchBar } from './app/overlays/TranscriptSearchBar'
import { SessionSearchBar } from './app/overlays/SessionSearchBar'
import { SurfacePanelResizeLayer } from './app/overlays/SurfacePanelResizeLayer'
import { CoordRunModal } from './app/overlays/CoordRunModal'
import { SessionDragOverlay } from './app/overlays/SessionDragOverlay'
import { SplitDividerLabel } from './app/overlays/SplitDividerLabel'
import { ComposerStatusMessage } from './app/overlays/ComposerStatusMessage'
import { FloatingWindowLayer } from './app/overlays/FloatingWindowLayer'
import { ThemeMenuOverlay } from './app/overlays/ThemeMenuOverlay'
import { CommandPaletteOverlay } from './app/overlays/CommandPaletteOverlay'
import { ChordHelpOverlay } from './app/overlays/ChordHelpOverlay'
import { TranscriptViewMenuOverlay } from './app/overlays/TranscriptViewMenuOverlay'
import { BookmarksOverlay } from './app/overlays/BookmarksOverlay'
import { SelectMenusOverlay } from './app/overlays/SelectMenusOverlay'
import { SessionRail } from './app/overlays/SessionRail'
import { TaskSidePanelFrame } from './app/overlays/TaskSidePanelFrame'
import { cycleDensityValue, currentProjectName } from './app/viewHelpers'
import { TUI_HANDOFF_COMMAND, CODEX_LIVE_ASSISTANT_UUID, CLAUDE_LIVE_ASSISTANT_UUID_PREFIX, TUI_SLASH_HINTS } from './app/composerConstants'
import { pluginSurfaceWants, TUI_KEYED_PLUGIN_COMMANDS } from './app/pluginCommands'
import { PluginManagerPopover, PromptLibraryPopover, ContextMenu, WindowBroadcastPopover, WindowLayoutPicker, DailySummaryPopover, RemoteCoordinatorPopover, PlaybookManagerPopover } from './app/lazyOverlays'
import { handleLetterShortcutKeys } from './app/keys/letterShortcuts'
import { handleReaderKeys } from './app/keys/readerKeys'
import { handleWindowAndTabKeys } from './app/keys/windowTabKeys'
import { handleSidebarKeys } from './app/keys/sidebarKeys'
import { handleGlobalChordKeys } from './app/keys/globalChordKeys'
import { handleComposerKeys } from './app/keys/composerKeys'
import { handleAskAndShortcutKeys } from './app/keys/askKeys'
import { handleOverlayAndMenuKeys } from './app/keys/overlayKeys'
import { handleModalDialogKeys } from './app/keys/dialogKeys'
import { handleWindowControlKeys } from './app/keys/windowControlKeys'
import { openModelPicker as openModelPickerAction } from './app/actions/modelPicker'
import { cancelComposerSend as cancelComposerSendAction, runPasteFilePathToComposer, runInsertMentionAtCursor, runPrepareComposerSubmission, runActiveComposerPromptPartRanges, runMoveComposerHistory, runReuseLastPrompt, runRestoreComposerPromptPartExtmarks, runInsertComposerPasteMarker, runBuildComposerStatsSegments, runFetchComposerAffordances } from './app/actions/composer'
import { runSendComposerMessage } from './app/actions/sendComposerMessage'
import { runExecuteCommandPalette, runRunTuiLocalCommand, runRunPluginCommand } from './app/actions/commandPalette'
import { runRefreshSelectedSessionDetail, runRefreshSessionMetadata, runRefreshSessions, runReconcileSelectedRunningRegistry, runPersistReaderState, runStartFreshSession, runChooseProvider, runPrepareCreatedSessionForComposer, runForkIntoNewSession, runToggleSelectedSessionSettled } from './app/actions/sessionData'
import { runPickWindowTarget, runApplySavedWindowLayout, runRunWindowControlAction, runOpenWindowControlMenu, runRestoreWindowSnapshot, runApplySplitPaneCount, runOpenSurfaceWindow, runCloseWindowSessionTab, runSplitFocusedWindow, runTabWindowOnto, runReopenClosedWindow, runDropSessionOnSurfaceWindow, runDragSplitDivider, runResizeSplitReader, runCancelPointerGesture, runNestedDropPlan, runMoveFloatGesture, runCycleSplitPaneSession, runOpenPopoverWindow, runResizeFocusedWindow, runCloseSplitPane, runBreakOutWindowTab, runRequestWindowPanes, runSwapWindowInDirection, runEndFloatGesture } from './app/actions/windows'
import { runSubmitCoordinatedRun, runWatchCoordinationAgentSessions, runWatchCoordinatorRun, runOpenTeammatesPanel } from './app/actions/coordination'
import { runSubmitTuiQuestion, runRespondToTuiPermission, runToggleExpansion, runCommitRename, runConfirmExit, runRewindConversationToPrompt, runHandoffToProvider, runToggleBookmarkForCursor, runCopySelectedMessage, runSubmitWorktreeTask, runSelectSidebarSession, runReplySelectedMessage, runMoveAgentToolCursor, runToggleVoice, runRespondToAttentionItem } from './app/actions/interaction'
import { runBuildSidebarRow } from './app/actions/sidebarRow'
import { runRenderSurfaceBodyInner, runRenderSplitPane, runRenderSurfaceWindow, runRenderSurfaceLayer, runRenderWindowTabs } from './app/actions/windowRender'
import { runRenderComposerSlashPanel, runRenderComposerHistoryPanel, runRenderComposerStashPanel, runRenderComposerMentionPanel, runRenderComposerQueuePanel, runRenderComposerRewindPanel, runRenderComposerTextarea } from './app/actions/composerPanels'
import { runWindowSurfaceFocusEffect, runOpenTabsOrderEffect, runSplitPinnedFillEffect, runWindowAttentionEffect } from './app/effects/windows'
import { runSurfacePlacementEffect, runThemeFollowEffect, runRendererListenersEffect, runWorktreeTaskSelectionEffect, runExitConfirmOpenEffect, runExitDelayEffect, runMetricsGaugeEffect } from './app/effects/app'
import { runOptionsEffect, runTranscriptScrollSyncEffect, runExpansionResetEffect, runTranscriptCursorEffect, runSessionPollIntervalEffect, runDetailRefreshIntervalEffect, runOverlaySettleEffect, runSessionDetailLoadEffect, runRunningRegistryEffect, runProviderSubagentSummariesEffect } from './app/effects/session'
import { runComposerPreferredTargetEffect, runDraftRestoreEffect, runQueuedSendDrainEffect, runComposerDraftPersistEffect, runPlanLimitsEffect, runComposerMentionSearchEffect, runComposerPrewarmEffect, runComposerAffordancesClearEffect, runComposerGitSummaryEffect } from './app/effects/composer'
import { runCoordWatchEffect } from './app/effects/coordination'
import { runTranscriptCardsSyncEffect, runLiveOverlayTimeoutEffect, runLiveTranscriptOverlayEffect } from './app/effects/liveTranscript'
import { runPersistBridgeMessagesEffect, runLoadBridgeMessagesEffect, runBridgeSubscribeEffect } from './app/effects/bridge'
import { runFooterSegments } from './app/derived/footer'
import { runAttentionItems } from './app/derived/attention'
import { runQuestionPickerPlan } from './app/derived/questionPicker'
import { runFleetEntries } from './app/derived/fleet'
import { runComposerKnobSegments, runComposerStatusBlockHeight } from './app/derived/composerStatus'
import { runTranscriptCards, runBaseTranscriptCards } from './app/derived/transcriptCards'
import { runTabOptions } from './app/derived/tabs'
import { runSidebarSessionActivity } from './app/derived/sidebar'
import { useNavigationRefs } from './app/state/navigationRefs'
import { useSessionCaches } from './app/state/sessionCaches'
import { useSelectionRefs } from './app/state/selectionRefs'
import { useModelState } from './app/state/modelState'
import { useLiveTurnState } from './app/state/liveTurnState'
import { useQuestionPickerState } from './app/state/questionPickerState'
import { useComposerListState } from './app/state/composerListState'
import { useComposerInputState } from './app/state/composerInputState'
import { useBookmarkScrollState } from './app/state/bookmarkScrollState'
import { useBridgeAttentionState } from './app/state/bridgeAttentionState'
import { useMenuState } from './app/state/menuState'
import { useSidebarPreferenceState } from './app/state/sidebarPreferenceState'
import { useWindowGestureState } from './app/state/windowGestureState'
import { useWindowLayoutState } from './app/state/windowLayoutState'
import { useWindowOverlayState } from './app/state/windowOverlayState'
import { useWindowPanesState } from './app/state/windowPanesState'
import { useProviderThemeState } from './app/state/providerThemeState'
import { WindowGroupDividers } from './app/overlays/WindowGroupDividers'
import { GridSecondDivider } from './app/overlays/GridSecondDivider'
import { ComposerWindow } from './app/overlays/ComposerWindow'
import { PluginOverlayHost } from './app/overlays/PluginOverlayHost'
import { ComposerDock } from './app/overlays/ComposerDock'
import { ComposerStatusStack } from './app/overlays/ComposerStatusStack'
import { runReaderHeaderChrome, runEmbeddedComposerChrome, runReaderFooterChrome, runSurfacePanelElement } from './app/derived/readerChrome'
import { runProjectedWindowGeometry } from './app/derived/windowGeometry'
import { WorkspaceBody } from './app/overlays/WorkspaceBody'
import { useRenderSurfaceLayerGroup } from './app/slices/renderSurfaceLayer'
import { useSubmitComposerFromDockGroup } from './app/slices/submitComposerFromDock'
import { useComposerDockStatsForGroup } from './app/slices/composerDockStatsFor'
import { useStatusLabelGroup } from './app/slices/statusLabel'
import { useControlWindowIndexGroup } from './app/slices/controlWindowIndex'
import { useOpenMoveWorkspaceMenuGroup } from './app/slices/openMoveWorkspaceMenu'
import { useDragSplitDividerGroup } from './app/slices/dragSplitDivider'
import { useDropTargetAtGroup } from './app/slices/dropTargetAt'
import { useRegisterTeammatesKeysGroup } from './app/slices/registerTeammatesKeys'
import { usePluginSessionForGroup } from './app/slices/pluginSessionFor'
import { useCopySelectedMessageGroup } from './app/slices/copySelectedMessage'
import { useToggleVoiceGroup } from './app/slices/toggleVoice'
import { useInsertComposerPasteMarkerGroup } from './app/slices/insertComposerPasteMarker'
import { useFooterSegmentsGroup } from './app/slices/footerSegments'
import { useRefreshSelectedSessionDetailGroup } from './app/slices/refreshSelectedSessionDetail'
import { useActiveStripIndexGroup } from './app/slices/activeStripIndex'
import { useTranscriptViewportRowsGroup } from './app/slices/transcriptViewportRows'
import { useLiveAssistantPreviewLinesGroup } from './app/slices/liveAssistantPreviewLines'
import { useSplitPaneRunningKeysGroup } from './app/slices/splitPaneRunningKeys'
import { useFloatingItemGroup } from './app/slices/floatingItem'
import { useStackedPanesVisibleGroup } from './app/slices/stackedPanesVisible'
import { usePopoverTakesWindowGroup } from './app/slices/popoverTakesWindow'
import { useComposerKeysTargetTurnGroup } from './app/slices/composerKeysTargetTurn'
import { useComposerMentionVisibleCountGroup } from './app/slices/composerMentionVisibleCount'
import { useComposerWaitingStatusSeedGroup } from './app/slices/composerWaitingStatusSeed'
import { useModelPickerFocusedDescriptionGroup } from './app/slices/modelPickerFocusedDescription'
import { useComposerHeightGroup } from './app/slices/composerHeight'
import { useToggleSidebarSortGroup } from './app/slices/toggleSidebarSort'
import { useTaskPanelMessagesGroup } from './app/slices/taskPanelMessages'
import { useComposerProviderGroup } from './app/slices/composerProvider'
import { useRecentlyWrittenKeysGroup } from './app/slices/recentlyWrittenKeys'
import { useTranscriptDiffHoverScrollTopRefGroup } from './app/slices/transcriptDiffHoverScrollTopRef'
export { readRootRenderCount } from './app/perf'
export { TAB_SPINNER_FRAMES, IDLE_TICKER_PHRASES } from './app/chrome'
export { createSidebarRowElements } from './app/sessionList'
export { buildSyntaxStyle } from './app/transcriptStyle'
export { terminalSelectionCopyDestination, type TerminalSelectionCopyDestination } from './app/terminalSelection'
export { isPlainMarkdownParagraph, selectTranscriptCardVariants, type TranscriptCardSelectionVariants } from './app/TranscriptCard'
export { inlineSegmentActionAt, inlineSegmentIndexAt, renderInlineMarkdownSpans } from './app/inlineText'

// Plugin commands with a TUI binding, matched by the global key router.
// The plugin choice of this workspace, before the first frame offers any command.
applyPluginSettings(readPluginSettingsFile())

registerExtraTreeSitterParsers()
startTuiMetricsLogger()

if (PERF_LOG) {
  try { mkdirSync(dirname(PERF_LOG_PATH), { recursive: true }) } catch { /* logging is best-effort */ }
}

export default function OpenTuiApp() {
  const [controller] = useState(() => new SpacesController())
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => startSpacesBackground(controller), [controller])
  const space = controller.activeSpace()
  const workspace = controller.activeWorkspace()
  useEffect(() => {
    const save = () => { try { controller.flush() } catch { /* leave previous generation intact */ } }
    process.on('exit', save)
    return () => { process.off('exit', save); save() }
  }, [controller])
  const { width, height } = useTerminalDimensions()
  const welcomeKey = useRef<((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => boolean) | null>(null)
  useKeyboard(key => { if (!workspace) { if (welcomeKey.current?.(key)) key.preventDefault(); key.stopPropagation() } })
  const contextValue = useMemo(() => space && workspace ? { controller, runtime: controller.runtime(workspace), space } : null, [controller, workspace, space])
  if (!space || !workspace || !contextValue) return <box width={width} height={height}><SpacesManager controller={controller} theme={LIGHT_THEME} width={width} height={height} onClose={() => {}} onKeyHandlerReady={handler => { welcomeKey.current = handler }} /></box>
  return <WorkspaceContext.Provider value={contextValue}><OpenTuiWorkspace key={workspace.id} /></WorkspaceContext.Provider>
}

function OpenTuiWorkspace() {
  const workspaceContext = useWorkspaceContext()!
  const workspaceId = workspaceContext.runtime.workspace.id
  const workspaceCwd = workspaceContext.space.cwd
  const spacesState = useSyncExternalStore(workspaceContext.controller.subscribe, workspaceContext.controller.getSnapshot, workspaceContext.controller.getSnapshot)
  const workspacesEnabled = spacesState.workspacesEnabled !== false
  const toggleWorkspaces = () => {
    const next = !workspacesEnabled
    workspaceContext.controller.setWorkspacesEnabled(next)
    if (!next) { setSpacesMenuOpen(false); setWorkspaceLaunched(true) }
    toast.info(`Workspaces ${next ? 'enabled' : 'disabled'}`)
  }
  const [workspaceLaunched, setWorkspaceLaunched] = useWorkspaceState('workspaceLaunched', false)
  const [workspaceHasSession, setWorkspaceHasSession] = useWorkspaceState('workspaceHasSession', false)
  const [spacesMenuOpen, setSpacesMenuOpen] = useState(false)
  const [spacesMenuSelection, setSpacesMenuSelection] = useState<string | undefined>()
  const [spacesCloseId, setSpacesCloseId] = useState<string | undefined>()
  const spacesKeyRef = useRef<((key: { name: string; sequence: string; ctrl: boolean; shift: boolean }) => boolean) | null>(null)
  const openSpaces = (id?: string, close = false) => {
    if (!workspacesEnabled) { toast.info('Enable workspaces with Ctrl+B, Shift+W'); return }
    setSpacesMenuSelection(id)
    setSpacesCloseId(close ? id : undefined)
    setSpacesMenuOpen(true)
  }
  const [allProjects, setAllProjects] = useWorkspaceState('allProjects', false)
  const draftKey = (key: string) => workspaceStorageKey(workspaceId, key)
  const readWorkspaceDraft = (key: string) => {
    const value = workspaceContext.runtime.values.get(`draft:${key}`)
    return typeof value === 'string' ? value : readComposerDraft(draftKey(key)) || (workspaceContext.runtime.values.get('legacyInitialWorkspace') === true ? readComposerDraft(key) : '')
  }
  const writeWorkspaceDraft = (key: string, text: string) => {
    workspaceContext.runtime.persistent.add(`draft:${key}`)
    workspaceContext.runtime.set(`draft:${key}`, text)
  }
  const readWorkspaceDraftParts = (key: string): unknown[] => {
    const existing = workspaceContext.runtime.values.get(`draftparts:${key}`)
    if (Array.isArray(existing)) return existing
    const parts = readComposerDraftParts(draftKey(key))
    return parts.length || workspaceContext.runtime.values.get('legacyInitialWorkspace') !== true ? parts : readComposerDraftParts(key)
  }
  const writeWorkspaceDraftParts = (key: string, parts: unknown[]) => {
    workspaceContext.runtime.persistent.add(`draftparts:${key}`)
    workspaceContext.runtime.set(`draftparts:${key}`, parts)
  }

  noteRootRender()
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()

  // Frame-timing canary (no-op unless AGENT_VIEWER_PERF=1). Stamp at the top of
  // every render; the effect below reads it after commit.
  const renderStartedAt = FRAME_TIMING_NEEDED ? performance.now() : 0
  useEffect(() => {
    if (!FRAME_TIMING_NEEDED) return
    const durationMs = performance.now() - renderStartedAt
    if (PERF_LOG) recordFramePerf(durationMs)
    noteRenderFrame(durationMs)
  })
  useEffect(() => {
    const clearTranscriptDiffHover = () => setHoveredTranscriptDiffAnchor(null)
    renderer.on('blur', clearTranscriptDiffHover)
    return () => {
      renderer.off('blur', clearTranscriptDiffHover)
    }
  }, [renderer])
  const {
    provider, setProvider, providerInstanceId, setProviderInstanceId, providerInstanceIdRef,
    providerInstances, setProviderInstances, themeMode, setThemeMode, themeFollowsTerminal,
    setThemeFollowsTerminal, terminalPaletteEpoch, setTerminalPaletteEpoch,
    themeFollowsTerminalRef, themeSlotsRef, density, setDensity, diffLayout, setDiffLayout,
    transcriptDiffNotes, setTranscriptDiffNotes, transcriptDiffDraft, setTranscriptDiffDraft,
    pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt, hoveredTranscriptDiffAnchor,
    setHoveredTranscriptDiffAnchor, transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys,
    transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, transcriptView, setTranscriptView,
  } = useProviderThemeState()
  // Chat reuses stream's chronological, borderless card grouping — the two views
  // diverge only in composer placement (docked vs. inline-with-transcript).
  const isCopilotView = transcriptView === 'copilot'
  const isOpenCodeView = transcriptView === 'opencode'
  const isChatLikeView = transcriptView === 'stream' || transcriptView === 'chat' || transcriptView === 'transcript' || transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || transcriptView === 'copilot' || transcriptView === 'opencode'
  // SCROLLBACK is STREAM read the way a terminal scrollback is: the same rows,
  // but no card cursor — keys and the wheel move the text by lines, and nothing
  // is ever highlighted as "selected". The cursor key survives as an invisible
  // position (kept on the top visible message) so jumps and search still have
  // somewhere to start from.
  const isScrollbackView = transcriptView === 'scrollback' || transcriptView === 'codex' || transcriptView === 'claude-code' || isCopilotView || isOpenCodeView
  // Both draw the pane as bare stream: no reader header, no thinking preview.
  const isStreamView = transcriptView === 'stream' || isScrollbackView
  // With no cursor there is no card for `e` to act on, so SCROLLBACK expands
  // or folds everything at once, as Claude Code's ⌃O does.
  const [scrollbackExpanded, setScrollbackExpanded] = useWorkspaceState('scrollbackExpanded', false)
  const embeddedComposer = transcriptView === 'chat' || transcriptView === 'agents'
  // TRANSCRIPT is STREAM without the per-line markers, and with the role rule
  // on every message rather than only on user prompts. Modelled on opencode's
  // session view, where one left rule per message is the only chrome there is.
  const isContinuousView = transcriptView === 'transcript' || isOpenCodeView
  const [transcriptWidth, setTranscriptWidth] = useAppState<TuiTranscriptWidth>('transcriptWidth', 'readable')
  const [focusMode, setFocusMode] = useAppState('focusMode', false)
  const [stickyHeaders, setStickyHeaders] = useAppState('stickyHeaders', false)
  const [lightweightWindows, setLightweightWindows] = useAppState('lightweightWindows', false)
  // Prompt card pinned under the reader's top edge while its turn scrolls past.
  // Temporary presentation mode, deliberately separate from the persisted
  // focus preference: fullscreen can be entered and restored without changing
  // the user's normal rail/header layout.
  const [windowPresentation, setWindowPresentation] = useWorkspaceState<WindowPresentation | null>('windowPresentation', null, false)
  const fullscreenMode = windowPresentation?.mode === 'fullscreen'
  const presentationResolverRef = useRef<(index?: number | 'reader' | null) => string | null>(() => null)
  const setFullscreenMode: React.Dispatch<React.SetStateAction<boolean>> = useStableEvent(action => {
    const next = typeof action === 'function' ? action(fullscreenMode) : action
    const target = windowPresentation?.target ?? presentationResolverRef.current()
    setWindowPresentation(next && target ? { mode: 'fullscreen', target } : null)
  })
  const {
    railVisible, setRailVisible, tabsEnabled, setTabsEnabled, tabOrientation, setTabOrientation,
    splitPaneCount, setSplitPaneCount, splitPinnedKeys, setSplitPinnedKeys, splitOrientation,
    setSplitOrientation, splitReaderShare, setSplitReaderShare, splitArrangement,
    setSplitArrangement, splitReaderLast, setSplitReaderLast, windowSplitTree, setWindowSplitTree,
    treeDividerDrag, setTreeDividerDrag, treeDividerCheckpointedRef, treeDividerActivePathRef,
    coordinatorWorkspace, setCoordinatorWorkspace, coordinatorWorkspaceRunId,
    setCoordinatorWorkspaceRunId, watchedRosterRef,
  } = useWindowPanesState()
  const watchedCoordinator = useCoordinatorWorkspace(coordinatorWorkspace, coordinatorWorkspaceRunId)
  const coordinatorBadges = useMemo(() => watchedCoordinator ? coordinatorWindowBadges(watchedCoordinator) : new Map<string, string>(), [watchedCoordinator])
  const {
    windowPickerOpen, setWindowPickerOpen, windowSwitcherOpen, setWindowSwitcherOpen,
    overviewPendingTarget, setOverviewPendingTarget, windowBroadcastOpen, setWindowBroadcastOpen,
    windowSurfacePeek, setWindowSurfacePeek, windowSwitcherKeyRef, windowBroadcastKeyRef,
    windowLayoutRestoreRequestRef, windowLayoutPreview, setWindowLayoutPreview, windowAttention,
    setWindowAttention, windowObservedFocusRef, savedWindowLayouts, setSavedWindowLayouts,
    windowSurfaces, setWindowSurfaces, windowSurfaceMeta, setWindowSurfaceMeta, popoverTabs,
    setPopoverTabs, popoverTabFrameRef, activePopoverTab, setActivePopoverTab,
  } = useWindowOverlayState()
  // The reader's place shows a popover tab instead of the transcript.
  const shownPopoverTab = activePopoverTab && popoverTabs.includes(activePopoverTab) ? activePopoverTab : null
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
  // When the composer is opened from a focused pane it talks to THAT session:
  // typing while looking at a pane should reach the agent you're looking at.
  // Declared here (not derived from splitPaneSessions, which the layout
  // computes much later) so the composer target memo can read it.
  const [composerPaneTargetKey, setComposerPaneTargetKey] = useWorkspaceState<string | null>('composerPaneTargetKey', null)
  // Retain the explicit creation target while its session is being prepared.
  const [composerPreferredTargetKey, setComposerPreferredTargetKey] = useWorkspaceState<string | null>('composerPreferredTargetKey', null)
  const [composerPreparingTargetKey, setComposerPreparingTargetKey] = useState<string | null>(null)
  const composerPreparingTargetKeyRef = useRef<string | null>(null)
  // Stable predicate the panes poll through, so none of them re-subscribes
  // when the reader's load state flips.
  const splitPaneShouldYield = useCallback(
    () => foregroundLoadInFlightRef.current || pendingForegroundLoadRef.current !== null,
    [],
  )
  const splitPaneHandlesRef = useRef(new Map<number, SplitPaneHandle>())
  const registerSplitPaneHandle = useStableEvent((paneIndex: number, handle: SplitPaneHandle | null, expected?: SplitPaneHandle) => {
    if (handle) splitPaneHandlesRef.current.set(paneIndex, handle)
    else if (!expected || splitPaneHandlesRef.current.get(paneIndex) === expected) splitPaneHandlesRef.current.delete(paneIndex)
  })
  const {
    showToolCalls, setShowToolCalls, velocityScrollEnabled, setVelocityScrollEnabled, sidebarSort,
    setSidebarSort, hideScratch, setHideScratch, showSettled, setShowSettled, pendingInboxEditsRef,
    sidebarView, setSidebarView, sidebarWidthPreference, setSidebarWidthPreference, taskPanelWidth,
    setTaskPanelWidth, taskPanelExpanded, setTaskPanelExpanded, surfacePanelOpen,
    setSurfacePanelOpen, surfacePanelFocused, setSurfacePanelFocused, surfacePanelWidth,
    setSurfacePanelWidth, surfacePanelPlacement, setSurfacePanelPlacement, surfacePanelRows,
    setSurfacePanelRows, surfacePanelResizing, setSurfacePanelResizing, surfacePanelResizeFromRef,
    surfacePanelExpanded, setSurfacePanelExpanded, surfacePanel, setSurfacePanel,
    surfaceBrowserRecent, setSurfaceBrowserRecent, surfacePanelKeyHandlerRef, surfacePluginKeyRef,
    surfacePluginKeyCaptureRef, sessions, setSessions, sessionsRef, runningSessions,
    setRunningSessions, waitingSessions, setWaitingSessions, viewerAttentionNotes,
    setViewerAttentionNotes, selectedSessionKey, setSelectedSessionKeyState,
  } = useSidebarPreferenceState()
  const setSelectedSessionKey = setSelectedSessionKeyState
  const [sessionDetail, setSessionDetail] = useWorkspaceState<TuiSessionDetail | null>('sessionDetail', null, false)
  const sessionDetailRef = useRef<TuiSessionDetail | null>(sessionDetail)
  useLayoutEffect(() => {
    sessionDetailRef.current = sessionDetail
  }, [sessionDetail])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toasts = useToasts()
  const {
    focusedPane, setFocusedPane, providerMenuOpen, setProviderMenuOpen, providerMenuIndex,
    setProviderMenuIndex, themeMenuOpen, setThemeMenuOpen, themeMenuIndex, setThemeMenuIndex,
    themeMenuGroup, setThemeMenuGroup, themeMenuQuery, setThemeMenuQuery, transcriptViewMenuOpen,
    setTranscriptViewMenuOpen, transcriptViewMenuIndex, setTranscriptViewMenuIndex,
    commandPaletteOpen, setCommandPaletteOpen, commandPaletteQuery, setCommandPaletteQuery,
    commandPaletteIndex, setCommandPaletteIndex, exitConfirmOpen, setExitConfirmOpen,
    exitCleanupInProgress, setExitCleanupInProgress, folderPickerKeyHandlerRef, editorInitialPath,
    setEditorInitialPath, editorInitialLine, setEditorInitialLine, newSessionModalOpen,
    setNewSessionModalOpen, newSessionProvider, setNewSessionProvider, newSessionCwd,
    setNewSessionCwd, newSessionBusy, setNewSessionBusy, folderPickerForNewSession,
    setFolderPickerForNewSession, newSessionKeyHandlerRef, pluginOverlay, setPluginOverlay,
    pluginOpenRequests, setPluginOpenRequests, pluginManagerOpen, setPluginManagerOpen,
    pluginManagerKeyHandlerRef,
  } = useMenuState({
    workspaceCwd,
  })
  const disabledPlugins = useDisabledPlugins()
  const pluginOverlayKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  const [handoffBriefOpen, setHandoffBriefOpen] = useState(false)
  const handoffBriefKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const promptLibraryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  // The bridge panels are the bridges plugin's; the bridges and routing are the composer's.
  const channelBridgeOpen = pluginOverlay === 'channel-bridge'
  // Global Channel Bridge binding: when on, the main composer's send routes to
  // the live `claude` CLI session instead of the active provider (mirrors the
  // web "route composer through bridge" toggle).
  const [routeComposerToBridge, setRouteComposerToBridge] = useState(false)
  const routeComposerToBridgeRef = useRef(false)
  // IDE bridge — third Claude composer flow (agentViewer hosts a Claude Code IDE
  // endpoint a `claude` CLI connects to; see channels/agentviewer-ide.ts).
  // When on, the main composer pushes its line as an @file mention into the
  // connected `claude` session instead of sending a provider turn.
  const [routeComposerToIde, setRouteComposerToIde] = useState(false)
  const routeComposerToIdeRef = useRef(false)
  useLayoutEffect(() => {
    routeComposerToBridgeRef.current = routeComposerToBridge
    routeComposerToIdeRef.current = routeComposerToIde
  }, [routeComposerToBridge, routeComposerToIde])
  const {
    lastBridgeChatIdRef, bridgeTranscriptEntries, setBridgeTranscriptEntries,
    persistedBridgeCountRef, attentionOpen, setAttentionOpen, attentionKeyHandlerRef,
    backgroundPrompts, setBackgroundPrompts, attentionDone, setAttentionDone,
    attentionRespondingId, setAttentionRespondingId, attentionNotifiedRef, worktreeModalOpen,
    setWorktreeModalOpen, worktreeDraft, setWorktreeDraft, worktreeBusy, setWorktreeBusy,
    selectedWorktreeTask, setSelectedWorktreeTask, selectedWorktreeTaskCacheRef, worktreeConfirm,
    setWorktreeConfirm, worktreeSubmitInFlightRef, coordModalOpen, setCoordModalOpen, coordDraft,
    setCoordDraft, coordAcceptanceDraft, setCoordAcceptanceDraft, coordNonGoalsDraft,
    setCoordNonGoalsDraft, coordManualQaDraft, setCoordManualQaDraft, coordEscalationDraft,
    setCoordEscalationDraft, coordPlaybooks, setCoordPlaybooks, coordPlaybookName,
    setCoordPlaybookName, coordPlaybookArgsDraft, setCoordPlaybookArgsDraft, playbookManagerOpen,
    setPlaybookManagerOpen, playbookManagerKeyHandlerRef, coordMaxAgents, setCoordMaxAgents,
    coordGateDraft, setCoordGateDraft, coordRequirePlanApproval, setCoordRequirePlanApproval,
    coordAutonomy, setCoordAutonomy, coordRequireReview, setCoordRequireReview, coordMaxTokens,
    setCoordMaxTokens, coordMaxDurationMinutes, setCoordMaxDurationMinutes, coordUseWorktrees,
    setCoordUseWorktrees, coordProviderOverride, setCoordProviderOverride,
    coordTeammateProviderOverride, setCoordTeammateProviderOverride, coordProviderPoolIndex,
    setCoordProviderPoolIndex, coordModalFocus, setCoordModalFocus, coordTextareaRef,
    coordWatchIds, setCoordWatchIds, coordWatchStateRef, coordBusy, setCoordBusy, coordBoardRunId,
    setCoordBoardRunId, coordError, setCoordError, coordStartInFlightRef, fleetStripEnabled,
    setFleetStripEnabled, fleetPage, setFleetPage, checkpointFocusPrompt, setCheckpointFocusPrompt,
    fileHistoryPath, setFileHistoryPath, dailySummaryOpen, setDailySummaryOpen,
    dailySummaryKeyHandlerRef, fileHistoryKeyHandlerRef, taskPanelOpen, setTaskPanelOpen,
    taskPanelTab, setTaskPanelTab, composerSessions,
  } = useBridgeAttentionState()
  const composerOwnerKey = composerPaneTargetKey ?? selectedSessionKey ?? (sessions[0] ? sessionKey(sessions[0]) : 'unselected')
  const ownsComposerStream = useCallback((key: string) => Boolean(composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current), [composerSessions])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useComposerSessionState(composerSessions, composerOwnerKey, 'awaitingPersistedTurn', false)
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useWorkspaceState('searchQuery', '')
  const [searchMatchIndex, setSearchMatchIndex] = useWorkspaceState('searchMatchIndex', 0)
  const [sessionSearchMode, setSessionSearchMode] = useState(false)
  const [sessionSearchQuery, setSessionSearchQuery] = useWorkspaceState('sessionSearchQuery', '')

  // The selected window's cursor, for the root's key handlers and the saved
  // reader position. It lives in the workspace runtime and the root does not
  // subscribe to it: a window reports every j/k here, and as root state each
  // report re-rendered the whole app with nothing on screen depending on it.
  const cursorRuntime = workspaceContext.runtime
  const readTranscriptCursorKey = () => cursorRuntime.get<string | null>('transcriptCursorKey', null, true)
  const setTranscriptCursorKey = useStableEvent((action: string | null | ((previous: string | null) => string | null)) => {
    readTranscriptCursorKey()
    cursorRuntime.set('transcriptCursorKey', action)
  })
  const [expandedCardKeys, setExpandedCardKeys] = useWorkspaceState<Set<string>>('expandedCardKeys', () => new Set())
  const [collapsedCardKeys, setCollapsedCardKeys] = useWorkspaceState<Set<string>>('collapsedCardKeys', () => new Set())
  // Bookmarked message uuids (== card keys) for the active session. The ref
  // keeps the toggle handler stable across renders.
  const [bookmarkKeys, setBookmarkKeys] = useState<Set<string>>(() => new Set())
  const bookmarkKeysRef = useRef<Set<string>>(bookmarkKeys)
  useLayoutEffect(() => {
    bookmarkKeysRef.current = bookmarkKeys
  }, [bookmarkKeys])
  const {
    bookmarksOverlayOpen, setBookmarksOverlayOpen, bookmarksOverlay, setBookmarksOverlay,
    bookmarksOverlayIndex, setBookmarksOverlayIndex, pendingBookmarkCursorRef, followTail,
    setFollowTail, pendingNewCount, setPendingNewCount, unreadBoundaryKey, setUnreadBoundaryKey,
    resumeMarkerKey, setResumeMarkerKey, bootstrapped, setBootstrapped, restoredReaderState,
    setRestoredReaderState, contextUsage, setContextUsage, contextUsageStatus,
    setContextUsageStatus, renameSessionKey, setRenameSessionKey, renameDraft, setRenameDraft,
    renameDraftRef, composerActive, setComposerActive, composerWindowOpen, setComposerWindowOpen,
    composerHidden, setComposerHidden, composerDraftState,
  } = useBookmarkScrollState()
  const composerDraft = composerDraftState.read()
  const setComposerDraft = useStableEvent((action: React.SetStateAction<string>) => {
    const next = typeof action === 'function' ? action(composerDraftState.read()) : action
    composerDraftRef.current = next
    composerDraftState.write(next, true)
  })
  const {
    composerDraftStorageKeyRef, composerLiveTodos, setComposerLiveTodos, composerMention,
    setComposerMention, composerMentionResults, setComposerMentionResults, composerAgentOptions,
    setComposerAgentOptions, composerMentionAgents, setComposerMentionAgents, composerMentionIndex,
    setComposerMentionIndex, composerMentionDismissedStart, setComposerMentionDismissedStart,
    composerMentionAttachments, setComposerMentionAttachments, composerPromptParts,
    setComposerPromptParts, composerMentionAttachmentsRef, composerPromptPartsRef,
  } = useComposerInputState({
    composerSessions, composerOwnerKey,
  })
  useEffect(() => { composerMentionAttachmentsRef.current = composerMentionAttachments }, [composerMentionAttachments])
  useEffect(() => { composerPromptPartsRef.current = composerPromptParts }, [composerPromptParts])
  const {
    composerStash, setComposerStash, composerStashOpen, setComposerStashOpen, composerRewindItems,
    setComposerRewindItems, composerRewindIndex, setComposerRewindIndex, composerStashIndex,
    setComposerStashIndex, composerSlashIndex, setComposerSlashIndex, composerSlashDismissed,
    setComposerSlashDismissed, composerHistoryOpen, setComposerHistoryOpen, composerHistoryIndex,
    setComposerHistoryIndex, composerLiveSlashCommands, setComposerLiveSlashCommands,
    composerSendState, setComposerSendState, composerActivitySessionKey,
    setComposerActivitySessionKey, composerSendStartedAt, setComposerSendStartedAt,
    interruptPressActive, setInterruptPressActive, backgroundingTasks, setBackgroundingTasks,
  } = useComposerListState({
    composerSessions, composerOwnerKey,
  })
  const interruptPressTimeoutRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'interruptPressTimeoutRef', null)
  // Pending tool-approval requests surfaced from the live SSE stream (Claude
  // canUseTool, Copilot/OpenCode permission events, Codex approvals). The
  // overlay below the composer lets the user allow/reject them, matching native.
  const [nativePendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [asyncQuestionPrompt, setAsyncQuestionPrompt] = useState<PendingPermission | null>(null)
  const pendingPermissions = useMemo(() => asyncQuestionPrompt
    ? [...nativePendingPermissions, asyncQuestionPrompt] : nativePendingPermissions,
  [nativePendingPermissions, asyncQuestionPrompt])
  const [permissionActionLoading, setPermissionActionLoading] = useState<string | null>(null)
  const [permissionOptionIndex, setPermissionOptionIndex] = useState(0)
  // Which permission `permissionOptionIndex` was last moved for. The index is
  // reset to 0 from several places (a turn starting, an answer landing, an
  // interrupt); that is the wrong opening cursor for a `defaultToDeny` ask, and
  // chasing every reset site would leave the next one to get it wrong. Reading
  // the owner instead means an index only counts as the user's choice while the
  // card it was made on is still the one on screen.
  const permissionOptionOwnerRef = useRef<string | null>(null)
  const resolvePermissionOptionIndex = useStableEvent((permission: PendingPermission, options: PermissionOption[]): number => {
    if (permissionOptionOwnerRef.current !== permission.id) return defaultPermissionOptionIndex(permission, options)
    return Math.min(permissionOptionIndex, options.length - 1)
  })
  const movePermissionOptionIndex = useStableEvent((permission: PendingPermission, options: PermissionOption[], delta: number) => {
    const from = resolvePermissionOptionIndex(permission, options)
    permissionOptionOwnerRef.current = permission.id
    setPermissionOptionIndex(Math.max(0, Math.min(options.length - 1, from + delta)))
  })
  // A turn is running for the selected session that this composer does not own
  // a stream for — the send stream died but the turn survived (turns are
  // decoupled from their stream), or a turn from another view is still
  // finishing. Detected by polling the in-process running registry while idle;
  // mirrors the web composer's reattach flow.
  const [reattachedRunning, setReattachedRunning] = useComposerSessionState(composerSessions, composerOwnerKey, 'reattachedRunning', false)
  const reattachedRunningRef = composerSessions.ref(composerOwnerKey, 'reattachedRunningRef', false)
  useEffect(() => { reattachedRunningRef.current = reattachedRunning }, [reattachedRunning])
  // Session key the registry poll currently reports as running-but-unowned.
  // The detail poll consults this to keep refreshing a session whose leftover
  // live baseline would otherwise pause background polls (the dead-stream case).
  const reattachedRunningKeyRef = composerSessions.ref<string | null>(composerOwnerKey, 'reattachedRunningKeyRef', null)
  // Sidebar running marks added by the registry poll (as opposed to the send
  // loop's own mark), so the poll only clears marks it added itself.
  const reattachMarksRef = useRef(new Map<string, RunningSessionRef>())
  // Session key of the turn the local send stream currently owns; the registry
  // poll never treats that session as reattached.
  const ownedTurnKeyRef = composerSessions.ref<string | null>(composerOwnerKey, 'ownedTurnKeyRef', null)
  const {
    questionFocusIndex, setQuestionFocusIndex, questionOptionIndex, setQuestionOptionIndex,
    questionSelections, setQuestionSelections, questionFreeformAnswers, setQuestionFreeformAnswers,
    questionFreeformEditing, setQuestionFreeformEditing, questionPermissionIdRef,
    composerWaitingSeed, setComposerWaitingSeed, composerError, setComposerError, composerLiveText,
    setComposerLiveText, composerLiveReasoning, setComposerLiveReasoning, composerThinkingTokens,
    setComposerThinkingTokens, liveTranscriptMessages, setLiveTranscriptMessages,
    localCommandOutputs, setLocalCommandOutputs, queuedComposerSends, setQueuedComposerSends,
    queuedComposerSendsRef, composerQueueDurable, setComposerQueueDurable, runningRegistryReady,
    setRunningRegistryReady,
  } = useQuestionPickerState({
    composerSessions, composerOwnerKey, workspaceContext,
  })
  // Follow-up queue mutations must be crash-safe before the next render. Keep
  // the transient ref and atomic queue file in lockstep in the originating
  // interaction; relying only on effects leaves immediate-exit windows where
  // the newest enqueue/cancel state can be lost or replayed.
  const commitQueuedComposerSends = useStableEvent((next: QueuedComposerSend[]) => {
    queuedComposerSendsRef.current = next
    setQueuedComposerSends(next)
    try { workspaceContext.controller.flush(); setComposerQueueDurable(true) } catch { setComposerQueueDurable(false) }
  })
  const activeComposerTurnRequestIdRef = composerSessions.ref<string | null>(composerOwnerKey, 'activeComposerTurnRequestIdRef', null)
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredSendNotice, setSteeredSendNotice] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'steeredSendNotice', null)
  const steeredEchoCounterRef = useRef(0)
  const steeredComposerSendsRef = composerSessions.ref<SteeredComposerSend[]>(composerOwnerKey, 'steeredComposerSendsRef', [])
  const {
    livePromptSuggestion, setLivePromptSuggestion, liveStatus, setLiveStatus, liveSubagentText,
    setLiveSubagentText, liveOutputTokens, setLiveOutputTokens, liveToolActivities,
    setLiveToolActivities, taskBudgetTokens, composerEnableWorkflow, setComposerEnableWorkflow,
    tuiEffort, setTuiEffort, tuiPermissionModeByKey, setTuiPermissionModeByKey,
    tuiPermissionModeByKeyRef, tuiCodexApprovalByKey, setTuiCodexApprovalByKey, tuiAddedDirsByKey,
    setTuiAddedDirsByKey, tuiAddedDirsByKeyRef,
  } = useLiveTurnState({
    composerSessions, composerOwnerKey,
  })
  tuiAddedDirsByKeyRef.current = tuiAddedDirsByKey
  const [tuiCodexModeByKey, setTuiCodexModeByKey] = useState<Record<string, 'plan' | 'default'>>({})
  const tuiCodexModeByKeyRef = useRef(tuiCodexModeByKey)
  const setCodexCollaborationMode = useCallback((target: Session, mode: 'plan' | 'default') => {
    const next = { ...tuiCodexModeByKeyRef.current, [sessionKey(target)]: mode }
    tuiCodexModeByKeyRef.current = next
    setTuiCodexModeByKey(next)
  }, [])
  const {
    tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey, tuiCopilotContextTierByKey,
    setTuiCopilotContextTierByKey, tuiCopilotMode, setTuiCopilotMode, tuiOpenCodeAgent,
    setTuiOpenCodeAgent, tuiModelOverride, setTuiModelOverride, tuiReportedModelByKey,
    setTuiReportedModelByKey, modelPickerOpen, setModelPickerOpen, modelPickerTarget,
    setModelPickerTarget, modelPickerFocus, setModelPickerFocus, modelPickerOptions,
    setModelPickerOptions, modelPickerPermissionOptions, setModelPickerPermissionOptions,
    modelPickerQuery, setModelPickerQuery, modelPickerIndex, setModelPickerIndex,
    modelPickerEffortIndex, setModelPickerEffortIndex, modelPickerPermissionIndex,
    setModelPickerPermissionIndex, modelPickerLoading, setModelPickerLoading, modelPickerError,
    setModelPickerError, sentHistory, setSentHistory, historyIndex, setHistoryIndex,
    draftBeforeHistory, setDraftBeforeHistory, thinkingMode, setThinkingMode, openTabSessions,
    setOpenTabSessions, sidebarScrollRef, measuredWindowAreaHeight, setMeasuredWindowAreaHeight,
    scrollbackSyncedCursorKeyRef,
  } = useModelState()
  const tabReaderPositionsRef = useTranscriptWindowPositions()
  const {
    velocityScrollStateRef, tabSelectRef, syncingTabSelectionRef, sessionRequestRef,
    detailRequestRef, backgroundMetadataCursorRef, providerSwitchRef, readerStateWriteTimeoutRef,
    readerStatePersistSignatureRef, expandedKeysRevisionRef, collapsedKeysRevisionRef,
    previousTranscriptRef,
  } = useSelectionRefs()
  const loader = useTranscriptSessionLoader()
  const {
    sessionDetailCacheRef, sessionContextUsageCacheRef, sessionMetadataFetchedAtRef,
    sessionMetadataInFlightRef,
  } = useSessionCaches()
  const composerAbortRef = composerSessions.ref<AbortController | null>(composerOwnerKey, 'composerAbortRef', null)
  const activeComposerSendCleanupRef = composerSessions.ref<Promise<void> | null>(composerOwnerKey, 'activeComposerSendCleanupRef', null)
  // Transient auto-retry bookkeeping (mirrors the web composer): only retry a
  // turn that streamed no output yet, bounded attempts, timer cleared on cancel.
  const composerTurnProducedOutputRef = composerSessions.ref(composerOwnerKey, 'composerTurnProducedOutputRef', false)
  const composerRetryCountRef = composerSessions.ref(composerOwnerKey, 'composerRetryCountRef', 0)
  const composerRetryTimerRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'composerRetryTimerRef', null)
  useEffect(() => () => {
    for (const key of composerSessions.keys()) {
      composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current?.abort()
      for (const name of ['composerRetryTimerRef', 'liveTextFlushTimerRef', 'interruptPressTimeoutRef']) {
        const timer = composerSessions.peekRef<ReturnType<typeof setTimeout> | null>(key, name)
        if (timer?.current) { clearTimeout(timer.current); timer.current = null }
      }
    }
  }, [composerSessions])
  // Set by cancelComposerSend so the send's AbortError handler transitions into
  // the awaitingPersistedTurn 'Syncing…' reconcile (confirmed interrupt) rather
  // than discarding the interrupted turn's partial output outright.
  const composerInterruptPendingRef = composerSessions.ref(composerOwnerKey, 'composerInterruptPendingRef', false)
  const composerTextareaRef = useRef<TextareaRenderable | null>(null)
  const composerPastePartTypeIdRef = useRef<number | null>(null)
  const composerCursorOffsetRef = useRef<number | null>(null)
  const terminalSelectionRef = useRef<{ text: string; capturedAt: number } | null>(null)
  const liveToolIndexesRef = composerSessions.ref<Map<number, string>>(composerOwnerKey, 'liveToolIndexesRef', new Map())
  const liveToolInputJsonRef = composerSessions.ref<Map<number, string>>(composerOwnerKey, 'liveToolInputJsonRef', new Map())
  const liveTranscriptBaselineRef = useRef(new Map<string, {
    count: number
    lastFingerprint: string | null
    sequenceFingerprint: string
    startedAt: number
  }>())
  const liveTranscriptMessagesRef = useRef<ThreadedMessage[]>([])
  const awaitingPersistedTurnRef = composerSessions.ref(composerOwnerKey, 'awaitingPersistedTurnRef', false)
  const liveTextFlushTimerRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'liveTextFlushTimerRef', null)
  const pendingLiveTextRef = composerSessions.ref(composerOwnerKey, 'pendingLiveTextRef', '')
  const pendingLiveReasoningRef = composerSessions.ref(composerOwnerKey, 'pendingLiveReasoningRef', '')
  const liveTextTargetSessionRef = composerSessions.ref<Session | null>(composerOwnerKey, 'liveTextTargetSessionRef', null)
  const {
    loadingDetailRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, navSelectStartRef,
    navPaintedKeyRef, navDetailSetAtRef, backgroundRefreshInFlightRef, sessionDetailMtimeRef,
    selectedSessionKeyRef, openTabSessionsRef, runningSessionsRef, tabsEnabledRef,
    themeMenuOriginRef, transcriptViewMenuOriginRef, currentThemeRef, exitConfirmOpenRef,
    exitInProgressRef, densityRef, showToolCallsRef, transcriptDiffHoverTimeoutRef,
    composerActiveRef, composerDraftRef, searchModeRef, sessionSearchModeRef,
  } = useNavigationRefs()
  // Whether the session-scoped Teammates panel is up. The panel holds its own
  // state in interactiveCoordinatorStore, so this selector is the root's only
  // subscription to it: a coordinator refresh repaints the panel and never
  // reaches this component, and only opening or closing re-renders the root.
  const teammatesOpen = useSyncExternalStore(
    subscribeInteractiveCoordinator,
    isInteractiveCoordinatorOpen,
    () => false,
  )
  const teammatesKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // Popover kinds that are windows now (laid out, a background tab, or floating).
  // A store-backed popover stays "open" while it is a window — its feed must
  // run — so its modal is suppressed instead of closed.
  const windowedPopoverKinds = new Set([
    ...windowSurfaces,
    ...popoverTabs,
    ...windowStacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey),
    ...(floatingWindow && isSurfaceWindowKey(floatingWindow.key) ? [surfaceIdOfKey(floatingWindow.key)] : []),
  ].map(surfaceKindOf))
  const teammatesModalOpen = teammatesOpen && !windowedPopoverKinds.has('teammates')
  const [remoteCoordinatorTarget, setRemoteCoordinatorTarget] = useState<RemoteCoordinatorTarget | null>(null)
  const remoteCoordinatorKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)

  const composerFocusBlocked = Boolean(
    spacesMenuOpen
    || exitConfirmOpen
    || searchMode
    || sessionSearchMode
    || pluginOverlay !== null
    || pluginManagerOpen
    || windowSwitcherOpen
    || windowBroadcastOpen
    || handoffBriefOpen
    || promptLibraryOpen
    || bookmarksOverlayOpen
    || coordModalOpen
    || teammatesModalOpen
    || remoteCoordinatorTarget
    || renameSessionKey
    || surfacePanelFocused
    || newSessionModalOpen
    || providerMenuOpen
    || modelPickerOpen
    || themeMenuOpen
    || transcriptViewMenuOpen
    || commandPaletteOpen
    || transcriptDiffDraft,
  )
  useEffect(() => { densityRef.current = density }, [density])
  useEffect(() => { showToolCallsRef.current = showToolCalls }, [showToolCalls])
  useEffect(() => { composerActiveRef.current = composerActive }, [composerActive])
  useEffect(() => { composerDraftRef.current = composerDraft })
  useEffect(() => { tuiPermissionModeByKeyRef.current = tuiPermissionModeByKey }, [tuiPermissionModeByKey])
  useEffect(() => { liveTranscriptMessagesRef.current = liveTranscriptMessages }, [liveTranscriptMessages])
  useEffect(() => { searchModeRef.current = searchMode }, [searchMode])
  useEffect(() => { sessionSearchModeRef.current = sessionSearchMode }, [sessionSearchMode])
  useEffect(() => { exitConfirmOpenRef.current = exitConfirmOpen }, [exitConfirmOpen])
  // No-op unless AGENT_VIEWER_TUI_METRICS=1: reports the sizes of the
  // session-keyed maps/sets most likely to grow unbounded, alongside the
  // process-level memory/GC/loop-delay samples in metricsLogger.ts.
  useEffect(() => runMetricsGaugeEffect({
    sessions, runningSessionsRef, sessionDetail, sessionDetailCacheRef, loader,
    sessionContextUsageCacheRef, sessionMetadataFetchedAtRef, sessionMetadataInFlightRef,
    liveToolIndexesRef, liveToolInputJsonRef, liveTranscriptBaselineRef,
    backgroundRefreshInFlightRef, sessionDetailMtimeRef,
  }), [sessions.length, sessionDetail])
  useEffect(() => {
    if (!composerActive && composerWindowOpen) setComposerWindowOpen(false)
  }, [composerActive, composerWindowOpen])
  useLayoutEffect(() => {
    if (!composerActive || composerFocusBlocked) return
    const renderable = composerTextareaRef.current
    if (!renderable) return
    const offset = composerCursorOffsetRef.current
    if (offset != null) {
      renderable.cursorOffset = Math.min(offset, renderable.plainText.length)
      composerCursorOffsetRef.current = null
    }
    if (renderer.currentFocusedRenderable !== renderable) renderable.focus()
  }, [composerActive, composerFocusBlocked, composerWindowOpen, renderer])
  // Overlay pickers (theme menu, transcript-view menu, etc.) own a search
  // <input> that unmounts when the overlay closes, and the renderer hands
  // focus to whatever else declares `focused` (the transcript scrollbox) as
  // part of that same unmount — after the layout effect above already ran,
  // so its focus() call loses the race. Defer one tick past that fallback
  // and reclaim focus for the composer whenever the last blocking overlay
  // closes.
  useEffect(() => {
    if (!composerActive || composerFocusBlocked) return
    const renderable = composerTextareaRef.current
    if (!renderable) return
    const timer = setTimeout(() => {
      if (renderer.currentFocusedRenderable !== renderable) renderable.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [composerActive, composerFocusBlocked, renderer])
  useEffect(() => { awaitingPersistedTurnRef.current = awaitingPersistedTurn }, [awaitingPersistedTurn])
  useEffect(() => {
    setActiveTheme(themeMode)
  }, [themeMode, terminalPaletteEpoch])

  useEffect(() => {
    loadingDetailRef.current = loadingDetail
  }, [loadingDetail])

  useEffect(() => {
    selectedSessionKeyRef.current = selectedSessionKey
  }, [selectedSessionKey])

  useEffect(() => {
    openTabSessionsRef.current = openTabSessions
  }, [openTabSessions])

  useEffect(() => {
    runningSessionsRef.current = runningSessions
  }, [runningSessions])

  useEffect(() => {
    tabsEnabledRef.current = tabsEnabled
  }, [tabsEnabled])

  useEffect(() => {
    expandedKeysRevisionRef.current += 1
  }, [expandedCardKeys])

  useEffect(() => {
    collapsedKeysRevisionRef.current += 1
  }, [collapsedCardKeys])

  useEffect(() => {
    if (!composerActive) return
    setFocusedPane('messages')
    // A focused panel owns keys ahead of the composer and its inputs would
    // take the one focus slot, so engaging the composer (e.g. by mouse) blurs it.
    setSurfacePanelFocused(false)
  }, [composerActive])

  useEffect(() => {
    if (!selectedSessionKey) {
      setContextUsage(null)
      setContextUsageStatus('idle')
    } else {
      const cachedUsage = sessionContextUsageCacheRef.current.get(selectedSessionKey) ?? null
      setContextUsage(cachedUsage)
      setContextUsageStatus(cachedUsage ? 'ready' : 'idle')
    }
    setRenameSessionKey(null)
    setRenameDraft('')
  }, [selectedSessionKey])

  useEffect(() => {
    const pinnedKeys = new Set([
      selectedSessionKey,
      ...openTabSessions.map((session) => sessionKey(session)),
    ].filter((key): key is string => Boolean(key)))
    pruneSessionCaches(
      sessionDetailCacheRef.current,
      sessionContextUsageCacheRef.current,
      sessionMetadataFetchedAtRef.current,
      pinnedKeys,
    )
  }, [openTabSessions, selectedSessionKey])

  // The epoch is what changes the terminal theme's colours.
  const theme = useMemo(() => getThemePalette(themeMode), [themeMode, terminalPaletteEpoch])
  const composerSyntaxStyle = useMemo(() => buildComposerSyntaxStyle(theme, renderer.nativeScene), [theme, renderer])
  const densityState = useMemo(() => densityConfig(density), [density])
  const presentationFocusMode = focusMode || fullscreenMode
  const showRail = railVisible && !fullscreenMode
  const effectiveFocus: PaneFocus = showRail ? focusedPane : 'messages'
  const selectedIndex = useMemo(
    () => resolveSelectedSessionIndex(selectedSessionKey, sessions, sessionKey),
    [selectedSessionKey, sessions],
  )
  // Latest sessions list keyed for ref-time lookups. refreshSelectedSessionDetail
  // receives identity-stable SKELETON sessions ({sessionId, provider} — see
  // selectedSessionTarget), so it must resolve list-level metadata like
  // transcript update time here; reading it off the passed session disabled the
  // mtime guards (typeof undefined !== 'number') and made every 2s poll and
  // every scrub settle re-read the full session file.
  const sessionsByKeyRef = useRef(new Map<string, Session>())
  useEffect(() => {
    sessionsRef.current = sessions
    const byKey = new Map<string, Session>()
    for (const session of sessions) byKey.set(sessionKey(session), session)
    sessionsByKeyRef.current = byKey
  }, [sessions])
  // Fall back to openTabSessions when the key doesn't match anything in
  // `sessions` — that's the case for freshly created pending provider sessions
  // (added to openTabSessions immediately, but only appears in `sessions` once
  // the SDK materialises it on first send).
  // Read from the workspace runtime each render rather than subscribed: it is
  // written after every selection, which has rendered already, and as state
  // that write cost the root a second render per switch.
  const workspaceReaderSession = workspaceContext.runtime.get<Session | null>('readerSession', null, true)
  const setWorkspaceReaderSession = useStableEvent((session: Session | null) => { workspaceContext.runtime.set('readerSession', session) })
  const selectedSession = useMemo<Session | null>(
    () => !workspaceHasSession ? null : resolveSelectedSession(
      selectedSessionKey,
      selectedIndex,
      sessions,
      workspaceReaderSession && sessionKey(workspaceReaderSession) === selectedSessionKey ? [...openTabSessions, workspaceReaderSession] : openTabSessions,
      sessionKey,
      (session) => Boolean(session.isPending),
    ),
    [openTabSessions, selectedIndex, selectedSessionKey, sessions, workspaceHasSession, workspaceReaderSession],
  )
  useEffect(() => { if (selectedSession && selectedSession !== workspaceReaderSession) setWorkspaceReaderSession(selectedSession) }, [selectedSession])
  // Every session is shown in a window, and the selected session is whichever
  // one the focused window shows. A popover tab is the one frame drawn outside
  // the windows, in the slot the split tree keeps for it.
  const hasPrimaryFrame = Boolean(shownPopoverTab)
  const selectedSessionIdentity = selectedSession ? sessionKey(selectedSession) : null
  useEffect(() => {
    setTranscriptDiffDraft(null)
    setHoveredTranscriptDiffAnchor(null)
  }, [selectedSessionIdentity])
  // Reflect the active session in the terminal tab/window title so users with
  // several terminals can tell them apart, with a ● prefix while its turn runs.
  // Gated like the other native-OSC features (off on Windows); the computed
  // string is memoized so setTerminalTitle only fires when the title changes.
  const selectedSessionBusy = useMemo(() => {
    if (!selectedSession) return false
    const sid = selectedSession.sessionId
    const prov = selectedSession.provider ?? 'claude'
    return runningSessions.some((running) => running.sessionId === sid && running.provider === prov)
  }, [runningSessions, selectedSession])
  const terminalTitle = useMemo(() => {
    if (!selectedSession) return 'agent-viewer'
    const label = sessionProviderLabel(selectedSession)
    const name = formatSessionTitle(selectedSession).slice(0, 48)
    return toBmpSafe(`${selectedSessionBusy ? '● ' : ''}agent-viewer · ${label} · ${name}`)
  }, [selectedSession, selectedSessionBusy])
  useEffect(() => {
    if (!NATIVE_OSC_ENABLED) return
    try {
      renderer.setTerminalTitle(terminalTitle)
    } catch {
      // terminal doesn't support OSC title sequences — ignore
    }
  }, [renderer, terminalTitle])
  useEffect(() => () => {
    if (transcriptDiffHoverTimeoutRef.current) clearTimeout(transcriptDiffHoverTimeoutRef.current)
  }, [])
  const {
    activateTranscriptDiffHover, openScopedTranscriptDiffNote, openTranscriptDiffNote,
    deleteTranscriptDiffNote, toggleTranscriptDiffCardSet, clearTranscriptDiffSelectionForCard,
    setTranscriptDiffSelectionAnchorForCard, setTranscriptDiffRowCursorForCard,
    selectedSessionTarget, transcriptSession, committedSessionKey, focusedSplitPaneSession,
    composerTargetSession, composerTargetSessionIdentity, activeQueuedComposerSends,
    composerTargetTurnKnownRunning, composerTargetSessionRef,
  } = useTranscriptDiffHoverScrollTopRefGroup({
    transcriptDiffHoverTimeoutRef, setHoveredTranscriptDiffAnchor, transcriptDiffNotes,
    setTranscriptDiffDraft, setTranscriptDiffNotes, setTranscriptDiffSelectionAnchorByCardKey,
    setTranscriptDiffRowCursorByCardKey, selectedSession, selectedSessionIdentity, sessionDetail,
    runningSessions, provider, splitFocusIndex, windowOrder, splitPinnedKeys, splitPaneCount,
    windowSurfaces, floatingWindow, openTabSessions, composerPaneTargetKey,
    composerPreferredTargetKey, sessions, queuedComposerSends,
  })
  useLayoutEffect(() => { composerTargetSessionRef.current = composerTargetSession }, [composerTargetSession])
  const canUseChannelBridge = Boolean(
    selectedSessionTarget
    && (selectedSessionTarget.provider ?? 'claude') === 'claude'
    && composerTargetSession
    && (composerTargetSession.provider ?? 'claude') === 'claude',
  )
  // The IDE bridge shares the channel bridge's Claude-only availability gate.
  const canUseIdeBridge = canUseChannelBridge
  const composerAutoTargetingRunning = Boolean(
    composerTargetSession
    && selectedSession
    && (
      composerTargetSession.sessionId !== selectedSession.sessionId
      || composerTargetSession.provider !== selectedSession.provider
    ),
  )
  // Unified attention list: prompts blocking any running turn (selected
  // session's from pendingPermissions, others' from the registry poll), then
  // background turn completions. Prompt order is arrival order within each
  // source; needs-input always sorts above finished.
  const attentionItems = useMemo(() => runAttentionItems({
    pendingPermissions, backgroundPrompts, composerTargetSession, sessionsByKeyRef,
    waitingSessions, viewerAttentionNotes, attentionDone,
  }), [pendingPermissions, backgroundPrompts, waitingSessions, viewerAttentionNotes, attentionDone, sessions, composerTargetSession])
  const attentionNeedsInputCount = useMemo(
    () => attentionItems.filter(attentionItemNeedsInput).length,
    [attentionItems],
  )

  // Keep the sidebar's activity marker aligned with the fleet strip. Running
  // sessions are actively receiving transcript events; attention takes
  // precedence so a blocked turn is visible even while its runtime is live.
  // Teams needing the user in any conversation, not just observed ones. The
  // store commits only on a changed mark, so this subscription re-renders the
  // root on a change and never on its 5s poll.
  useEffect(() => startTeamAttentionFeed(), [])
  const teamAttention = useSyncExternalStore(subscribeTeamAttention, getTeamAttention, getTeamAttention)

  // A session another process is writing right now — a native CLI, a second
  // agent-viewer — never reaches the running registry, which only knows turns
  // this host started. Its transcript's mtime is the evidence, so a write in
  // the last RECENT_WRITE_ACTIVE_MS marks the row as active. The set keeps its
  // identity while its members do, and the only timer is the one that retires
  // the next mark, so an idle rail never re-renders the root.
  const [recentWriteClock, setRecentWriteClock] = useState(0)
  const recentlyWrittenRef = useRef<{ keys: ReadonlySet<string>; signature: string; nextExpiry: number | null }>({
    keys: new Set(), signature: '', nextExpiry: null,
  })
  const recentlyWrittenSessions = useMemo(() => {
    void recentWriteClock
    const now = Date.now()
    const keys: string[] = []
    let nextExpiry: number | null = null
    for (const session of sessions) {
      const activityMs = sessionActivityMs(session)
      if (activityMs <= 0 || activityMs < now - RECENT_WRITE_ACTIVE_MS) continue
      keys.push(sessionKey(session))
      const expiry = activityMs + RECENT_WRITE_ACTIVE_MS
      if (nextExpiry === null || expiry < nextExpiry) nextExpiry = expiry
    }
    const signature = keys.sort().join('\n')
    const previous = recentlyWrittenRef.current
    const next = signature === previous.signature
      ? { ...previous, nextExpiry }
      : { keys: new Set(keys), signature, nextExpiry }
    recentlyWrittenRef.current = next
    return next.keys === previous.keys && next.nextExpiry === previous.nextExpiry ? previous : next
  }, [sessions, recentWriteClock])
  useEffect(() => {
    const { nextExpiry } = recentlyWrittenSessions
    if (nextExpiry === null) return
    const timer = setTimeout(() => setRecentWriteClock((tick) => tick + 1), Math.max(nextExpiry - Date.now(), 0) + 50)
    return () => clearTimeout(timer)
  }, [recentlyWrittenSessions])
  const {
    recentlyWrittenKeys, sidebarSessionActivity, fleetViewShown, fleetAlerts, fleetStripVisible,
    fleetPageCount, activeFleetPage, visibleFleetEntries,
  } = useRecentlyWrittenKeysGroup({
    recentlyWrittenSessions, attentionItems, runningSessions, waitingSessions,
    viewerAttentionNotes, pluginOverlay, windowedPopoverKinds, sessionsByKeyRef, attentionDone,
    sessions, fleetStripEnabled, presentationFocusMode, fleetPage,
  })
  useEffect(() => {
    if (fleetPage !== activeFleetPage) setFleetPage(activeFleetPage)
  }, [activeFleetPage, fleetPage])
  const fleetStripSegments = useMemo<InlineTextSegment[]>(() => {
    if (!fleetStripVisible) return []
    const pageLabel = fleetPageCount > 1 ? ` ${activeFleetPage + 1}/${fleetPageCount}` : ''
    const segs: InlineTextSegment[] = [{ text: `FLEET${pageLabel}  `, fg: theme.dim }]
    visibleFleetEntries.forEach((entry, index) => {
      const selected = entry.key === selectedSessionKey
      const accent = getProviderAccent(entry.provider)
      const glyph = entry.status === 'needs-input' ? '⚠' : entry.status === 'running' ? '●' : entry.status === 'waiting' ? '◌' : '✓'
      const glyphColor = entry.status === 'needs-input' ? theme.amber : entry.status === 'running' ? accent : entry.status === 'waiting' ? theme.cyan : theme.green
      if (index > 0) segs.push({ text: '   ', fg: theme.dim })
      segs.push({ text: `${index + 1} `, fg: selected ? accent : theme.dim })
      segs.push({ text: `${glyph} `, fg: glyphColor })
      segs.push({
        text: entry.title.length > 18 ? `${entry.title.slice(0, 17)}…` : entry.title,
        fg: selected ? theme.text : theme.muted,
      })
    })
    if (fleetPageCount > 1) segs.push({ text: '  { } pages', fg: theme.dim })
    return segs
  }, [activeFleetPage, fleetPageCount, fleetStripVisible, selectedSessionKey, theme, visibleFleetEntries])

  // Viewing a session resolves its "turn finished" notice.
  useEffect(() => {
    if (!selectedSessionKey) return
    setAttentionDone((prev) => {
      const next = prev.filter((done) => done.sessionKey !== selectedSessionKey)
      return next.length === prev.length ? prev : next
    })
  }, [selectedSessionKey])
  const {
    composerProvider, composerPermissionMode, composerCodexApproval, composerCodexMode,
    composerCopilotPermissionMode, composerCopilotContextTier, composerConfig, composerExample,
    composerAccentColor,
  } = useComposerProviderGroup({
    composerTargetSession, selectedSession, tuiPermissionModeByKey, tuiCodexApprovalByKey,
    tuiCodexModeByKey, tuiCopilotPermissionModeByKey, tuiCopilotContextTierByKey, theme,
  })

  useEffect(() => {
    if (canUseChannelBridge) return
    setRouteComposerToBridge(false)
    setBridgeTranscriptEntries(keepEmpty)
    persistedBridgeCountRef.current = 0
    lastBridgeChatIdRef.current = undefined
  }, [canUseChannelBridge])

  useEffect(() => {
    if (canUseIdeBridge) return
    setRouteComposerToIde(false)
  }, [canUseIdeBridge])

  // Subscribe only while a Claude session can actively use the bridge.
  useEffect(() => runBridgeSubscribeEffect({
    canUseChannelBridge, channelBridgeOpen, routeComposerToBridge, setBridgeTranscriptEntries,
    selectedSessionTarget, showNotice,
  }), [canUseChannelBridge, channelBridgeOpen, routeComposerToBridge, selectedSessionTarget?.sessionId])

  // Load persisted bridge messages when selected session changes
  useEffect(() => runLoadBridgeMessagesEffect({
    canUseChannelBridge, selectedSessionTarget, setBridgeTranscriptEntries,
    persistedBridgeCountRef,
  }), [canUseChannelBridge, selectedSessionTarget?.provider, selectedSessionTarget?.sessionId])

  // Persist new bridge messages to disk when they arrive
  useEffect(() => runPersistBridgeMessagesEffect({
    canUseChannelBridge, selectedSessionTarget, bridgeTranscriptEntries, persistedBridgeCountRef,
  }), [canUseChannelBridge, selectedSessionTarget?.provider, selectedSessionTarget?.sessionId, bridgeTranscriptEntries.length])

  const liveTranscriptMessagesCacheRef = useRef<ThreadedMessage[] | null>(null)
  const persistedComposerMessages = useMemo(() => {
    const key = selectedSessionTarget ? sessionKey(selectedSessionTarget) : ''
    const baseline = liveTranscriptBaselineRef.current.get(key)
    let durableIndex = 0
    const recentUsers = new Set((sessionDetail?.rawMessages ?? []).filter(message => {
      if (!isDurableSessionMessage(message)) return false
      return durableIndex++ >= (baseline?.count ?? Number.POSITIVE_INFINITY) && message.type === 'user'
    }).map(message => message.uuid))
    return indexComposerMessages(sessionDetail?.threadedMessages ?? [], recentUsers)
  }, [sessionDetail, selectedSessionIdentity, composerSendStartedAt])
  const liveTranscriptMessagesForSession = useMemo(() => {
    if (!selectedSessionTarget) return []
    const key = sessionKey(selectedSessionTarget)
    const live = [
      ...liveTranscriptMessages.filter((message) => liveMessageSessionKey(message) === key),
      ...localCommandOutputs.filter((message) => liveMessageSessionKey(message) === key),
    ]
    const filtered = visibleComposerMessages(live, persistedComposerMessages)
    const prev = liveTranscriptMessagesCacheRef.current
    if (prev && prev.length === filtered.length && prev.every((m, i) => m === filtered[i])) {
      return prev
    }
    return filtered
  }, [liveTranscriptMessages, localCommandOutputs, selectedSessionTarget, persistedComposerMessages])
  useLayoutEffect(() => {
    liveTranscriptMessagesCacheRef.current = liveTranscriptMessagesForSession
  }, [liveTranscriptMessagesForSession])
  const {
    taskPanelMessages, liveAssistantTextCardVisible, setWorkerCardCacheVersion,
    baseAndBridgeTranscriptCards, transcriptCards, groupedToolView, visibleTranscriptCards,
  } = useTaskPanelMessagesGroup({
    sessionDetail, liveTranscriptMessagesForSession, transcriptSession, density, showToolCalls,
    bridgeTranscriptEntries, selectedSessionTarget, liveTranscriptBaselineRef, transcriptView,
    isChatLikeView,
  })

  useLayoutEffect(() => runLiveTranscriptOverlayEffect({
    selectedSessionTarget, sessionDetail, liveTranscriptBaselineRef, composerLiveText,
    liveTranscriptMessagesForSession, awaitingPersistedTurn, ownsComposerStream,
    setLiveTranscriptMessages, persistedComposerMessages, liveToolIndexesRef, liveToolInputJsonRef,
    setComposerLiveText, setAwaitingPersistedTurn,
  }), [awaitingPersistedTurn, composerLiveText, liveTranscriptMessagesForSession, selectedSessionIdentity, selectedSessionTarget, sessionDetail])

  // Escape hatch mirroring the web composer: if the persisted rows for a
  // completed turn never arrive, force-reveal the polled transcript after a
  // bounded wait so the live overlay / "Syncing…" state can't stick forever.
  useEffect(() => runLiveOverlayTimeoutEffect({
    awaitingPersistedTurn, composerActivitySessionKey, liveTranscriptBaselineRef,
    setLiveTranscriptMessages, liveToolIndexesRef, liveToolInputJsonRef, setComposerLiveText,
    setAwaitingPersistedTurn,
  }), [awaitingPersistedTurn, composerActivitySessionKey])

  // (Auto-open of the composer on a pending session was removed: with
  // composerActive=true, the global key handler's `N` / `c` / `q` shortcuts
  // were intercepted by the composer-active branch. The welcome banner +
  // explicit `c` keypress is the native model here.)

  // Warm the worker + client caches when the user toggles density/showToolCalls
  // to a variant that isn't yet cached. The synchronous fallback above keeps the
  // UI responsive in the meantime; this effect just ensures subsequent toggles
  // hit the cache instead of running a main-thread format every time.
  useEffect(() => runTranscriptCardsSyncEffect({
    sessionDetail, transcriptSession, density, showToolCalls, setError, setWorkerCardCacheVersion,
  }), [density, sessionDetail, transcriptSession, showToolCalls])
  const baseTranscriptIndexByKey = useMemo(
    () => createLazyTranscriptIndexLookup(baseAndBridgeTranscriptCards),
    [baseAndBridgeTranscriptCards],
  )
  const stableVisiblePrefixLength = (
    visibleTranscriptCards === transcriptCards
    && baseAndBridgeTranscriptCards.length <= visibleTranscriptCards.length
    && (
      baseAndBridgeTranscriptCards.length === 0
      || (
        visibleTranscriptCards[0] === baseAndBridgeTranscriptCards[0]
        && visibleTranscriptCards[baseAndBridgeTranscriptCards.length - 1]
          === baseAndBridgeTranscriptCards[baseAndBridgeTranscriptCards.length - 1]
      )
    )
  ) ? baseAndBridgeTranscriptCards.length : null
  const transcriptIndexByKey = useMemo(
    () => createLazyTranscriptIndexLookup(
      visibleTranscriptCards,
      stableVisiblePrefixLength == null
        ? undefined
        : { length: stableVisiblePrefixLength, lookup: baseTranscriptIndexByKey },
    ),
    [baseTranscriptIndexByKey, stableVisiblePrefixLength, visibleTranscriptCards],
  )

  const selectedWindowHandleRef = useRef<(() => SplitPaneHandle | undefined) | null>(null)
  // The selected transcript's window reports its cursor here; a null one
  // (following, nothing chosen) leaves the reader's as it is.
  const reportSelectedWindowCursor = useCallback((cardKey: string | null) => {
    if (cardKey) setTranscriptCursorKey((current) => (current === cardKey ? current : cardKey))
  }, [])
  const jumpToTranscriptIndex = useStableEvent((index: number) => {
    if (visibleTranscriptCards.length === 0) return
    const nextIndex = clamp(index, 0, visibleTranscriptCards.length - 1)
    const nextCard = visibleTranscriptCards[nextIndex]
    if (!nextCard) return
    // An explicit jump must be revealed, even to the card scrolling left the
    // cursor on.
    scrollbackSyncedCursorKeyRef.current = null
    setTranscriptCursorKey(nextCard.key)
    const atTail = nextIndex === visibleTranscriptCards.length - 1
    setFollowTail(atTail)
    // A window drawing the selected transcript takes the jump.
    selectedWindowHandleRef.current?.()?.jumpToKey(nextCard.key, atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  })


  const selectSidebarSession = useStableEvent((session: Session) => runSelectSidebarSession({
    setSidebarSubagentCursor, windowItems, focusSplitPane, floatingItem, splitFocusIndex,
    checkpointWindowLayout, setWorkspaceLaunched, setOpenTabSessions, focusedWindowItem,
    windowItemKey, orderedWindowKeys, floatingWindow, setFloatingWindow, commitWindowKeys,
    setWindowSplitTree, reconciledSplitTree, setWindowStacks, liveWindowStacks,
    setComposerPaneTargetKey, setOverviewPendingTarget, setFocusedPane, setActivePopoverTab,
    setWorkspaceHasSession, setSelectedSessionKey, setError,
  }, session))

  const toggleHideScratch = useCallback(() => {
    setHideScratch((current) => {
      const next = !current
      showToggleOutcome('Scratch sessions', next ? 'hidden' : 'shown')
      void writeTuiHideScratchSessions(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store scratch visibility'))
      return next
    })
  }, [])
  const toggleShowSettled = useCallback(() => {
    setShowSettled((current) => {
      const next = !current
      showToggleOutcome('Settled sessions', next ? 'shown' : 'hidden')
      void writeTuiShowSettledSessions(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store settled visibility'))
      return next
    })
  }, [])
  useEffect(() => {
    void readTuiShowSettledSessions().then(setShowSettled).catch(() => {})
  }, [])
  const {
    toggleSidebarSort, resolvedExpandedKeys, normalizedSearchQuery, deferredSearchQuery,
    searchMatches, readCursorIndex, unreadBoundaryIndex, readerTitle, readerModel, gitRepoCwd,
    gitSessionId, shouldEnableSyntaxHighlighting, syntaxStyle, handoffBriefSyntaxStyle,
    normalizedSessionQuery, spaceSessions, scratchFilter, settledFilter,
    filteredSessionsForSidebar, setCollapsedSubagentParents, collapsedSubagentSet,
    subagentTranscriptSelection, setSubagentTranscriptSelection, toggleSidebarSubagents,
    providerSubagentSummaries, setProviderSubagentSummaries, subagentSummariesReadRef,
  } = useToggleSidebarSortGroup({
    setSidebarSort, setError, visibleTranscriptCards, transcriptView, isChatLikeView,
    expandedCardKeys, collapsedCardKeys, searchQuery, followTail, readTranscriptCursorKey,
    transcriptIndexByKey, unreadBoundaryKey, sessionDetail, selectedSession,
    focusedSplitPaneSession, workspaceCwd, sessions, composerSendState, composerLiveText, theme,
    renderer, sessionSearchQuery, allProjects, hideScratch, selectedSessionKey,
    sidebarSessionActivity, recentlyWrittenSessions, teamAttention, showSettled,
  })
  useEffect(() => runProviderSubagentSummariesEffect({
    selectedSessionTarget, subagentSummariesReadRef, setProviderSubagentSummaries,
  }), [selectedSessionTarget])

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, SidebarSubagentEntry[]>()
    for (const session of filteredSessionsForSidebar) {
      if (!session.parentSessionId) continue
      const parentKey = sessionKey({ sessionId: session.parentSessionId, provider: session.provider, providerInstanceId: session.providerInstanceId })
      const siblings = map.get(parentKey)
      const entry: SidebarSubagentEntry = { kind: 'session', session }
      if (siblings) siblings.push(entry)
      else map.set(parentKey, [entry])
    }
    for (const [parentKey, summaries] of providerSubagentSummaries) {
      if (summaries.length === 0) continue
      const parentSession = filteredSessionsForSidebar.find((session) => sessionKey(session) === parentKey)
      if (!parentSession) continue
      const entries: SidebarSubagentEntry[] = summaries.map((summary) => ({ kind: 'summary', summary }))
      const existing = map.get(parentKey)
      if (existing) existing.push(...entries)
      else map.set(parentKey, entries)
    }
    return map
  }, [filteredSessionsForSidebar, providerSubagentSummaries])

  const sidebarEntries = useMemo(() => {
    const entries = buildSidebarEntries(filteredSessionsForSidebar, sidebarSort, childrenByParentId, collapsedSubagentSet)
    if (filteredSessionsForSidebar === sessions) return entries
    const originalIndex = new Map<string, number>()
    sessions.forEach((s, i) => { originalIndex.set(sessionKey(s), i) })
    return entries.map((entry) => {
      if (entry.type !== 'session') return entry
      const idx = originalIndex.get(sessionKey(entry.session))
      return idx === undefined ? entry : { ...entry, absoluteIndex: idx }
    })
  }, [filteredSessionsForSidebar, sessions, sidebarSort, childrenByParentId, collapsedSubagentSet])
  // Keep keyboard navigation and neighbour prefetch on the same flattened
  // session order as the rendered sidebar. Rebuilding this array inside every
  // j/k handler was needlessly allocating one wrapper array per keypress.
  const sidebarSessionEntries = useMemo(() => {
    const sessionsInOrder: Session[] = []
    for (const entry of sidebarEntries) {
      const session = sidebarEntrySession(entry)
      if (session) sessionsInOrder.push(session)
    }
    return sessionsInOrder
  }, [sidebarEntries])
  // Ref mirror for the neighbour-prefetch effect: it needs the current sidebar
  // order at fire time without re-triggering on every 5s sessions poll (the
  // entries array gets a fresh identity each refresh).
  const sidebarEntriesRef = useRef<SidebarEntry[]>([])
  const sidebarSessionEntriesRef = useRef<Session[]>([])
  useEffect(() => {
    sidebarEntriesRef.current = sidebarEntries
    sidebarSessionEntriesRef.current = sidebarSessionEntries
  }, [sidebarEntries, sidebarSessionEntries])
  const sidebarSortLabel = sidebarSort === 'project' ? 'PROJECT' : 'TIME'
  const [sidebarSubagentCursor, setSidebarSubagentCursor] = useState<string | null>(null)
  useEffect(() => { setSidebarSubagentCursor(null) }, [selectedSessionKey])
  useEffect(() => { if (sidebarSubagentCursor && !sidebarEntries.some(entry => entry.key === sidebarSubagentCursor)) setSidebarSubagentCursor(null) }, [sidebarEntries, sidebarSubagentCursor])
  const selectedSidebarEntryIndex = useMemo(() => {
    if (sidebarSubagentCursor) { const child = sidebarEntries.findIndex(entry => entry.key === sidebarSubagentCursor); if (child >= 0) return child }
    const selected = selectedIndex >= 0 ? sessions[selectedIndex] : null
    const idx = selected
      ? sidebarEntries.findIndex((entry) => {
          const entrySession = sidebarEntrySession(entry)
          return entrySession ? sessionKey(entrySession) === sessionKey(selected) : false
        })
      : -1
    return idx >= 0 ? idx : 0
  }, [sidebarEntries, selectedIndex, sessions, sidebarSubagentCursor])


  // The rail owns this state now (coordinatorStore). The root needs only the
  // header counts, for the rail's box title — a string prop, so it cannot come
  // from a memoized child. Key handlers read the store imperatively instead, so
  // this is the root's ONLY coordinator subscription, and a refresh that
  // changes rows without changing counts never reaches this component.
  const coordinatorHeaderCounts = useSyncExternalStore(
    subscribeCoordinator,
    () => {
      const { agentEntries, runs, filter, stateCounts } = getCoordinatorState()
      const total = Object.values(stateCounts).reduce((sum, count) => sum + count, 0)
      return `${agentEntries.length}/${runs.length}/${filter}/${stateCounts.blocked}/${stateCounts.done}/${total}`
    },
    () => '0/0/all/0/0/0',
  )
  const moveCoordinatorSelection = useStableEvent((delta: number) => {
    const { agentEntries, selectedKey } = getCoordinatorState()
    if (agentEntries.length === 0) return
    const currentPos = agentEntries.findIndex((entry) => entry.key === selectedKey)
    const nextPos = clamp((currentPos >= 0 ? currentPos : 0) + delta, 0, agentEntries.length - 1)
    setCoordinatorSelectedKey(agentEntries[nextPos]?.key ?? null)
  })
  const jumpCoordinatorSelection = useStableEvent((edge: 'first' | 'last') => {
    const { agentEntries } = getCoordinatorState()
    const target = edge === 'first' ? agentEntries[0] : agentEntries.at(-1)
    if (target) setCoordinatorSelectedKey(target.key)
  })
  const openSelectedCoordinatorAgent = useStableEvent(() => {
    const { agentEntries, selectedKey: coordinatorSelectedKey } = getCoordinatorState()
    const selected = agentEntries.find((entry) => entry.key === coordinatorSelectedKey)
    if (selected?.machine) {
      setRemoteCoordinatorTarget({ machine: selected.machine, runId: selected.runId, agentId: selected.agent.id, sessionId: selected.agent.sessionId, provider: selected.agent.provider })
      return
    }
    if (selected) openCoordinationAgentSession(selected.agent)
  })
  const composerDraftShapeRef = useRef<ComposerDraftShape | null>(null)
  const composerDraftLines = composerDraftLineCount(composerDraft, composerTextareaRef.current?.plainText === composerDraft ? composerTextareaRef.current.editorView.getTotalVirtualLineCount() : null)
  const composerDockChromeHeight = fullscreenMode ? 1 : COMPOSER_DOCK_CHROME_HEIGHT
  const {
    presentationHidesComposer, composerDockHeight, composerDockTextareaHeight,
    composerTargetSessionInfo, composerCurrentModel, composerModelLookupSettled,
    filteredModelPickerOptions,
  } = useComposerHeightGroup({
    embeddedComposer, composerDraftLines, height, fullscreenMode, composerDockChromeHeight,
    windowPresentation, composerTargetSessionIdentity, composerWindowOpen, composerHidden,
    composerTargetSession, sessionDetail, selectedSessionKey, sessionDetailCacheRef,
    tuiModelOverride, tuiReportedModelByKey, contextUsage, modelPickerOptions, modelPickerQuery,
  })
  const highlightedModelPickerOption = filteredModelPickerOptions[modelPickerIndex]
  const modelPickerEffortOptions = useMemo(
    () => effortPickerOptions(modelPickerTarget?.provider, highlightedModelPickerOption),
    [highlightedModelPickerOption, modelPickerTarget?.provider],
  )
  const modelPickerPermissionLabel = modelPickerTarget?.provider === 'codex' ? 'APPROVALS' : 'PERMISSIONS'
  const modelPickerPermissionValue = modelPickerTarget?.provider === 'claude'
    ? tuiPermissionModeByKey[sessionKey(modelPickerTarget)] ?? 'default'
    : modelPickerTarget?.provider === 'codex'
      ? tuiCodexApprovalByKey[sessionKey(modelPickerTarget)] ?? 'auto'
      : modelPickerTarget?.provider === 'copilot'
        ? tuiCopilotPermissionModeByKey[sessionKey(modelPickerTarget)] ?? 'off'
        : 'native'
  const compactModelPickerEffortOptions = useMemo(
    () => modelPickerEffortOptions.map((option) => ({ name: option.name, value: option.value, description: '' })),
    [modelPickerEffortOptions],
  )
  const compactModelPickerPermissionOptions = useMemo(
    () => modelPickerPermissionOptions.map((option) => ({ name: option.name, value: option.value, description: '' })),
    [modelPickerPermissionOptions],
  )
  const modelPickerFocusedOption = modelPickerFocus === 'model'
    ? highlightedModelPickerOption
    : modelPickerFocus === 'effort'
      ? modelPickerEffortOptions[modelPickerEffortIndex]
      : modelPickerPermissionOptions[modelPickerPermissionIndex]
  const modelPickerFocusedLabel = modelPickerFocus === 'model'
    ? 'MODEL'
    : modelPickerFocus === 'effort'
      ? 'EFFORT'
      : modelPickerPermissionLabel
  const {
    modelPickerFocusedDescription, setComposerPlanLimits, composerKnobSegments,
    composerWorkingDirectory, composerGitBranch, composerGitSummary, setComposerGitSummary,
  } = useModelPickerFocusedDescriptionGroup({
    modelPickerFocusedOption, composerTargetSession, selectedSessionKey, contextUsage,
    sessionContextUsageCacheRef, composerPermissionMode, theme, composerCurrentModel,
    composerAccentColor, composerModelLookupSettled, tuiEffort, tuiOpenCodeAgent,
    composerCodexMode, composerCodexApproval, tuiCopilotMode, composerCopilotPermissionMode,
    composerCopilotContextTier, composerEnableWorkflow, composerTargetSessionInfo,
  })
  useEffect(() => runComposerGitSummaryEffect({
    composerWorkingDirectory, setComposerGitSummary,
  }), [composerWorkingDirectory])
  const composerLocationSegments = useMemo<InlineTextSegment[]>(() => {
    const parts: InlineTextSegment[] = []
    if (composerWorkingDirectory) parts.push({ text: `${composerWorkingDirectory}  `, fg: theme.dim, action: 'path' })
    const branch = composerGitSummary?.branch ?? composerGitBranch
    if (branch) parts.push({ text: branch, fg: theme.green, action: 'git' })
    if (composerGitSummary?.modified) parts.push({ text: `  ~${composerGitSummary.modified}`, fg: theme.amber, action: 'git' })
    if (composerGitSummary?.untracked) parts.push({ text: `  ?${composerGitSummary.untracked}`, fg: theme.dim, action: 'git' })
    if (composerGitSummary?.stashes) parts.push({ text: `  *${composerGitSummary.stashes}`, fg: theme.amber, action: 'git' })
    if (selectedWorktreeTask) {
      const counts = [
        selectedWorktreeTask.dirtyFiles > 0 ? `${selectedWorktreeTask.dirtyFiles} dirty` : null,
        selectedWorktreeTask.aheadCommits > 0 ? `+${selectedWorktreeTask.aheadCommits}` : null,
      ].filter(Boolean).join(' ')
      parts.push({ text: ` · ⧉ worktree task${counts ? ` · ${counts}` : ''}`, fg: theme.amber })
    }
    return parts
  }, [composerGitBranch, composerGitSummary, composerWorkingDirectory, selectedWorktreeTask, theme.amber, theme.dim, theme.green])
  const buildComposerStatsSegments = (lineCount: number, draftLength: number) => runBuildComposerStatsSegments({
    composerConfig, theme, composerAccentColor, composerAttachmentLabel, composerKnobSegments,
    composerLocationSegments, composerWorkingDirectory,
  }, lineCount, draftLength)
  const canBackgroundClaudeCommand = composerTargetSession?.provider === 'claude'
    && composerSendState === 'sending'
    && liveToolActivities.some(activity => activity.status === 'running' && /^(Bash|Agent|Task)$/.test(activity.label))
  const composerWaitingSuffix = useMemo(() => {
    const parts: string[] = []
    // Model, context, and effort already live in the dock footer.
    if (composerSendState === 'sending' && liveOutputTokens > 0) {
      parts.push(`↓ ${formatLiveOutputTokens(liveOutputTokens)} tokens`)
    }
    // Native CLIs keep the interrupt affordance inside the live status line,
    // not only in the footer — the user's eye is on the spinner, not the hint
    // bar. Mirrors the two-press arm/confirm the ⌃C handler implements.
    if (composerSendState === 'sending') {
      parts.push(interruptPressActive ? '⌃C again to interrupt' : '⌃C cancel')
    }
    if (canBackgroundClaudeCommand) parts.push('⌃B ⌃B background')
    return parts.length > 0 ? parts.join(' · ') : null
  }, [canBackgroundClaudeCommand, composerSendState, interruptPressActive, liveOutputTokens])

  useEffect(() => {
    if (!modelPickerOpen) return
    const index = modelPickerEffortOptions.findIndex((option) => option.value === tuiEffort)
    setModelPickerEffortIndex(index >= 0 ? index : 0)
  }, [modelPickerEffortOptions, modelPickerOpen, tuiEffort])
  useEffect(() => {
    if (!modelPickerOpen) return
    const index = modelPickerPermissionOptions.findIndex((option) => option.value === modelPickerPermissionValue)
    setModelPickerPermissionIndex(index >= 0 ? index : 0)
  }, [modelPickerOpen, modelPickerPermissionOptions, modelPickerPermissionValue])
  useEffect(() => {
    if (!modelPickerOpen) return
    setModelPickerIndex((current) => Math.min(current, Math.max(filteredModelPickerOptions.length - 1, 0)))
  }, [filteredModelPickerOptions.length, modelPickerOpen])
  const {
    composerWaitingStatusSeed, composerFirstLine, composerSlashOpen, composerSlashCommands,
    composerAffordancesCacheRef, committedSessionKeyRef,
  } = useComposerWaitingStatusSeedGroup({
    composerWaitingSeed, composerTargetSession, composerDraft, composerSlashDismissed,
    selectedSession, composerLiveSlashCommands,
  })
  useEffect(() => { committedSessionKeyRef.current = committedSessionKey }, [committedSessionKey])
  const composerAffordancesInFlightRef = useRef(new Set<string>())
  const clearComposerAffordances = useCallback(() => {
    setComposerLiveSlashCommands(keepEmpty)
    setComposerAgentOptions(keepEmpty)
    setComposerMentionAgents(keepEmpty)
    setTuiOpenCodeAgent('')
  }, [])
  const applyComposerAffordances = useCallback((
    target: Session,
    commands: SlashCommandSuggestion[],
    composerOptions: Awaited<ReturnType<typeof readViewSessionComposerOptions>>,
  ) => {
    setComposerLiveSlashCommands(commands)
    const agentOptions = composerOptions.agents ?? []
    setComposerAgentOptions(agentOptions)
    setComposerMentionAgents(composerOptions.mentionAgents ?? [])
    if (target.provider === 'opencode') {
      const currentAgent = composerOptions.currentAgent
      setTuiOpenCodeAgent(
        currentAgent && agentOptions.some((agent) => agent.value === currentAgent)
          ? currentAgent
          : agentOptions[0]?.value ?? '',
      )
    } else {
      setTuiOpenCodeAgent('')
    }
  }, [])
  const fetchComposerAffordances = useCallback(async (target: Session, key: string) => runFetchComposerAffordances({
    composerAffordancesInFlightRef, composerAffordancesCacheRef, committedSessionKeyRef,
    applyComposerAffordances, clearComposerAffordances,
  }, target, key), [applyComposerAffordances, clearComposerAffordances])
  useEffect(() => runComposerAffordancesClearEffect({
    transcriptSession, committedSessionKey, clearComposerAffordances, composerAffordancesCacheRef,
    applyComposerAffordances, composerActiveRef, fetchComposerAffordances,
  }), [committedSessionKey, fetchComposerAffordances])
  // Composer engagement: warm the send path while the user types, then fetch
  // the deferred Claude affordances. Prewarm spawns the pool Query the send
  // will attach to (removing the ~1-3s CLI boot from first-token latency) or
  // resumes the Codex thread; running the affordances fetch AFTER it lets the
  // Claude branch reuse the warm Query instead of spawning a second CLI.
  const composerPrewarmInFlightRef = useRef(new Set<string>())
  useEffect(() => runComposerPrewarmEffect({
    transcriptSession, committedSessionKey, sessionsByKeyRef, composerActive,
    composerAffordancesCacheRef, composerPrewarmInFlightRef, tuiModelOverride, tuiEffort,
    fetchComposerAffordances,
  }), [committedSessionKey, composerActive, fetchComposerAffordances, tuiEffort, tuiModelOverride])
  const composerSlashHint = useMemo(() => {
    if (!composerSlashOpen) return ''
    const provider = selectedSession?.provider ?? 'claude'
    const suggestions = TUI_SLASH_HINTS[provider] ?? TUI_SLASH_HINTS.claude
    return `slash · ${suggestions.join(' · ')}`
  }, [composerSlashOpen, selectedSession?.provider])

  const composerMentionSourceSession = composerTargetSession ?? selectedSession
  const composerMentionSearchSession = useMemo(() => {
    if (!composerMentionSourceSession) return null
    const parentSessionId = composerMentionSourceSession.parentSessionId
    if (!parentSessionId) return composerMentionSourceSession
    const parentSession = sessions.find((session) =>
      session.sessionId === parentSessionId
      && session.provider === composerMentionSourceSession.provider,
    ) ?? openTabSessions.find((session) => session.sessionId === parentSessionId)
      ?? sessions.find((session) => session.sessionId === parentSessionId)
    return parentSession ?? composerMentionSourceSession
  }, [composerMentionSourceSession, openTabSessions, sessions])
  const composerMentionProvider = composerMentionSourceSession?.provider ?? 'claude'
  const composerMentionCwd = composerMentionSearchSession?.cwd ?? composerMentionSourceSession?.cwd ?? null

  useEffect(() => runComposerMentionSearchEffect({
    composerMention, setComposerMentionResults, composerMentionProvider, composerMentionAgents,
    composerMentionCwd, setComposerMentionIndex,
  }), [composerMention, composerMentionAgents, composerMentionCwd, composerMentionProvider])

  const ensureComposerPastePartTypeId = useStableEvent((renderable: TextareaRenderable): number => {
    let typeId = composerPastePartTypeIdRef.current
    if (typeId == null) {
      typeId = renderable.extmarks.registerType('composer-paste')
      composerPastePartTypeIdRef.current = typeId
    }
    return typeId
  })

  const restoreComposerPromptPartExtmarks = useStableEvent((parts: ComposerPromptPart[], text: string) => runRestoreComposerPromptPartExtmarks({
    composerTextareaRef, ensureComposerPastePartTypeId,
  }, parts, text))

  const makeComposerSnapshot = useStableEvent((): ComposerDraftSnapshot => ({
    text: composerTextareaRef.current?.plainText ?? composerDraft,
    attachments: [...composerMentionAttachments],
    promptParts: [...composerPromptParts],
    cursorOffset: composerTextareaRef.current?.cursorOffset,
  }))

  const applyComposerSnapshot = useStableEvent((snapshot: ComposerDraftSnapshot) => {
    const text = snapshot.text
    composerTextareaRef.current?.setText(text)
    if (composerTextareaRef.current) composerTextareaRef.current.cursorOffset = snapshot.cursorOffset ?? text.length
    setComposerDraft(text)
    setComposerMentionAttachments(snapshot.attachments)
    setComposerPromptParts(snapshot.promptParts)
    restoreComposerPromptPartExtmarks(snapshot.promptParts, text)
  })

  // `trailing` follows the prompt, and the cursor lands after it: a prompt that
  // ends on the line the user is meant to finish passes ''.
  const appendDiffCommentPromptToComposer = useStableEvent((prompt: string, trailing = '\n\n') => {
    const trimmed = trailing ? prompt.trim() : prompt.trimStart()
    if (!trimmed.trim()) return
    const existing = composerTextareaRef.current?.plainText ?? composerDraft
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : ''
    const next = `${existing}${separator}${trimmed}${trailing}`
    applyComposerSnapshot({
      text: next,
      attachments: [...composerMentionAttachments],
      promptParts: [...composerPromptParts],
      cursorOffset: next.length,
    })
    setComposerActive(true)
  })

  // A "why" with no history of its own asks the provenance index and git
  // blame who wrote the lines; every other intent goes straight in.
  const askAgentAboutSelection = useStableEvent(async (input: SelectionAskInput) => {
    let request = input
    if (input.intent === 'why' && !input.history && gitRepoCwd) {
      showNotice('info', 'Looking up who wrote these lines…')
      const history = await readTuiLineHistory(gitRepoCwd, input.filePath, input.startLine, input.endLine).catch(() => [])
      request = { ...input, history }
    }
    appendDiffCommentPromptToComposer(buildSelectionAskPrompt(request), request.intent === 'ask' ? '' : '\n\n')
    showNotice('info', `${request.filePath.split('/').pop()} ${request.startLine === request.endLine ? `L${request.startLine}` : `L${request.startLine}-${request.endLine}`} added to composer`)
  })

  const sendTranscriptDiffNoteToComposer = useStableEvent((
    card: TuiTranscriptCard,
    note: TranscriptDiffNote,
    label: string,
    diffText: string | null,
  ) => {
    if (committedSessionKey) sendScopedTranscriptDiffNote(committedSessionKey, card, note, label, diffText)
  })

  const sendScopedTranscriptDiffNote = useStableEvent((namespace: string, card: TuiTranscriptCard, note: TranscriptDiffNote, label: string, diffText: string | null) => {
    setPendingTranscriptDiffPrompt({ target: namespace, prompt: buildDiffCommentComposerPrompt({
      filePath: filePathFromDiffText(diffText, card.label), range: note.range, comment: note.text,
      context: diffText ?? cardClipboardText(card), source: `Transcript diff card ${label}`,
    }) })
    setComposerPaneTargetKey(namespace)
  })

  const activeComposerPromptPartRanges = useStableEvent((text: string, parts: ComposerPromptPart[]) => runActiveComposerPromptPartRanges({
    composerTextareaRef, composerPastePartTypeIdRef,
  }, text, parts))

  const prepareComposerSubmission = useStableEvent((visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]) => runPrepareComposerSubmission({
    activeComposerPromptPartRanges,
  }, visibleText, attachments, parts))

  const insertMentionAtCursor = useStableEvent((entry: TuiMentionResult) => runInsertMentionAtCursor({
    composerTextareaRef, composerMention, composerMentionCwd, setComposerDraft,
    setComposerMentionAttachments, setComposerMention, setComposerMentionResults,
  }, entry))

  const insertSlashAtCursor = useCallback((command: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable) return
    const text = renderable.plainText
    const newlineIdx = text.indexOf('\n')
    const after = newlineIdx === -1 ? '' : text.slice(newlineIdx)
    const insertion = `${command} `
    const next = `${insertion}${after}`
    renderable.setText(next)
    renderable.cursorOffset = insertion.length
    setComposerDraft(next)
    setComposerSlashIndex(0)
  }, [])

  const selectComposerHistoryEntry = useStableEvent((displayIndex: number) => {
    if (sentHistory.length === 0) return
    const nextDisplayIndex = clamp(displayIndex, 0, sentHistory.length - 1)
    const sourceIndex = sentHistory.length - 1 - nextDisplayIndex
    const replacement = sentHistory[sourceIndex] ?? { text: '', attachments: [], promptParts: [] }
    setComposerHistoryIndex(nextDisplayIndex)
    setHistoryIndex(sourceIndex)
    applyComposerSnapshot(replacement)
  })

  const openComposerHistory = useStableEvent((displayIndex = 0) => {
    if (sentHistory.length === 0) return
    if (!composerHistoryOpen && historyIndex === -1) {
      setDraftBeforeHistory(makeComposerSnapshot())
    }
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
    setComposerStashOpen(false)
    setComposerHistoryOpen(true)
    selectComposerHistoryEntry(displayIndex)
  })

  // ⌃R, as in the native CLIs: the newest earlier prompt containing what was
  // typed; pressed again, the next older match.
  const searchComposerHistory = useStableEvent(() => {
    const query = (composerHistoryOpen ? composerSnapshotText(draftBeforeHistory) : composerDraft).trim().toLowerCase()
    for (let display = composerHistoryOpen ? composerHistoryIndex + 1 : 0; display < sentHistory.length; display += 1) {
      const entry = sentHistory[sentHistory.length - 1 - display]
      if (entry && (!query || composerSnapshotText(entry).toLowerCase().includes(query))) {
        openComposerHistory(display)
        return
      }
    }
    showNotice('info', query ? `No earlier prompt contains "${query}"` : 'No earlier prompts yet')
  })

  // ⌃G, as in Claude Code and Codex: write the prompt in $VISUAL/$EDITOR.
  const editComposerInExternalEditor = useStableEvent(() => {
    const current = composerTextareaRef.current?.plainText ?? composerDraft
    void editTextInEditor(renderer, current).then((result) => {
      if (!result.ok) {
        showNotice('error', `${result.command}: ${result.error}`)
        return
      }
      composerTextareaRef.current?.setText(result.text)
      setComposerDraft(result.text)
    }, (err) => {
      showNotice('error', `Could not hand the terminal to the editor: ${err instanceof Error ? err.message : String(err)}`)
    })
  })

  const commitComposerHistory = useCallback(() => {
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  }, [])

  const cancelComposerHistory = useStableEvent(() => {
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    applyComposerSnapshot(draftBeforeHistory)
    setHistoryIndex(-1)
  })

  const moveComposerHistory = useStableEvent((delta: number) => runMoveComposerHistory({
    sentHistory, composerHistoryOpen, historyIndex, openComposerHistory, cancelComposerHistory,
    composerHistoryIndex, selectComposerHistoryEntry,
  }, delta))

  const handleComposerContentChange = useStableEvent(() => {
    const renderable = composerTextareaRef.current
    const text = renderable?.plainText ?? ''
    const cursor = renderable?.cursorOffset ?? text.length
    // Typing writes the draft quietly. The root re-renders only when something it draws from the
    // draft changed (see ComposerDraftShape).
    const virtualLines = renderable ? renderable.editorView.getTotalVirtualLineCount() : null
    const attachments = composerPromptParts.length > 0 || composerMentionAttachments.length > 0
      ? attachmentCountLabel(prepareComposerSubmission(text, composerMentionAttachments, composerPromptParts).attachments) ?? ''
      : ''
    const nextShape = { ...computeComposerDraftShape(text, textareaInnerWidth, composerWindowTextareaWidth, null), lines: composerDraftLineCount(text, virtualLines), attachments }
    composerDraftRef.current = text
    composerDraftState.write(text, !sameComposerDraftShape(composerDraftShapeRef.current, nextShape))
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, text)
    if (historyIndex !== -1 && text !== (sentHistory[historyIndex]?.text ?? '')) setHistoryIndex(-1)
    if (composerError) setComposerError(null)
    if (composerSendState === 'error') setComposerSendState('idle')
    const mention = detectMentionAtCursor(text, cursor)
    const dismissedStart = composerMentionDismissedStart
    if (!mention || (dismissedStart !== null && mention.start !== dismissedStart)) {
      if (dismissedStart !== null) setComposerMentionDismissedStart(null)
    }
    const nextMention = !mention || (dismissedStart !== null && mention.start === dismissedStart)
      ? null
      : mention
    if (nextMention && (!composerMention || composerMention.start !== nextMention.start || composerMention.query !== nextMention.query)) {
      setComposerMentionIndex(0)
    }
    setComposerMention((current) => {
      if (!nextMention) return current ? null : current
      return current && current.start === nextMention.start && current.query === nextMention.query ? current : nextMention
    })
    const firstLine = text.split('\n')[0] ?? ''
    if (!firstLine.startsWith('/')) {
      setComposerSlashIndex(0)
      if (composerSlashDismissed) setComposerSlashDismissed(false)
    }
  })
  const {
    composerMentionVisibleCount, composerSlashVisibleCount, composerHistoryVisibleCount,
    composerStashVisibleCount, composerRewindVisibleCount, composerPopoverHeight, hasSubagentTail,
    activeRunningToolCount, composerActivityVisible, visibleComposerSending,
  } = useComposerMentionVisibleCountGroup({
    composerMentionResults, composerSlashCommands, sentHistory, composerStash, composerRewindItems,
    presentationHidesComposer, composerWindowOpen, composerActive, composerMention,
    composerSlashOpen, composerHistoryOpen, composerStashOpen, liveSubagentText,
    liveToolActivities, composerActivitySessionKey, selectedSessionIdentity, composerSendState,
  })
  const composerTurnStatusInBorder = visibleComposerSending && !embeddedComposer && !fullscreenMode && !composerWindowOpen && !composerHidden && !presentationHidesComposer
  const visibleAwaitingPersistedTurn = composerActivityVisible && awaitingPersistedTurn
  const visibleComposerLiveText = composerActivityVisible ? composerLiveText : ''
  const visibleComposerError = composerActivityVisible ? composerError : null
  const visibleLiveToolActivities = composerActivityVisible ? liveToolActivities : []
  const visibleRunningToolCount = composerActivityVisible ? activeRunningToolCount : 0
  // A stalled owned stream can drop composerSendState to idle while the turn
  // continues server-side. Treat reconciliation and reattachment as running
  // everywhere that reserves or renders the live-turn status row. Owned state
  // is visible only on its origin tab; reattachedRunning is already scoped to
  // the selected session by reconcileSelectedRunningRegistry.
  // A turn blocked on the user must say so, not keep cycling "Warming the
  // context…" while a question or an approval waits to be answered.
  const composerPendingAsk = pendingPermissions.find((entry) => entry.sessionId === composerTargetSession?.sessionId) ?? null
  const composerWaitingOnUser = composerPendingAsk
    ? (composerPendingAsk.questions?.length ?? 0) > 0 ? 'Waiting for your answer' : 'Waiting for your approval'
    : null
  const turnRunningForComposer = visibleComposerSending || reattachedRunning || visibleAwaitingPersistedTurn
  // Plan limits are re-read between turns (a turn is what spends them) and as
  // the composer engages, through the session's warm entry — never a spawn.
  useEffect(() => runPlanLimitsEffect({
    composerTargetSession, setComposerPlanLimits, composerActive, turnRunningForComposer,
  }), [composerActive, composerTargetSession?.provider, composerTargetSession?.providerInstanceId, composerTargetSession?.sessionId, turnRunningForComposer])
  const {
    composerKeysTargetTurn, questionPickerPlan, composerStatusBlockHeight, statusBarInDock,
    surfacePanelVisible, surfacePanelOnRight, surfacePanelAtBottom, surfacePanelMaxRows,
    effectiveSurfacePanelRows, mainContentHeight, taskPanelVisible, maxTaskPanelWidth,
    effectiveTaskPanelWidth, surfacePanelMaxWidth, effectiveSurfacePanelWidth, rightPanelsWidth,
    maxSidebarWidth, sidebarWidth, verticalTabsWidth, readerAreaWidth, splitCandidateSessions,
    splitPinnedSessions, splitAxisStacked, windowBudgetHeight, pinnedWindowSessions, sessionsByKey,
    orderedWindowKeys, windowZoom,
  } = useComposerKeysTargetTurnGroup({
    visibleComposerSending, reattachedRunning, visibleComposerError, visibleAwaitingPersistedTurn,
    embeddedComposer, activeQueuedComposerSends, visibleComposerLiveText, steeredSendNotice,
    pendingPermissions, questionFocusIndex, questionOptionIndex, height, workspacesEnabled,
    searchMode, sessionSearchMode, composerDockHeight, composerPopoverHeight,
    presentationHidesComposer, composerTurnStatusInBorder, composerActivityVisible,
    hasSubagentTail, visibleLiveToolActivities, visibleRunningToolCount, livePromptSuggestion,
    composerSendState, isChatLikeView, liveAssistantTextCardVisible, liveStatus,
    composerLiveReasoning, isStreamView, composerTargetSession, sessionDetail, width,
    composerWindowOpen, composerHidden, fullscreenMode, surfacePanelOpen, surfacePanelPlacement,
    surfacePanelExpanded, surfacePanelRows, taskPanelOpen, showRail, sidebarWidthPreference,
    taskPanelExpanded, taskPanelWidth, surfacePanelWidth, openTabSessions, popoverTabs,
    selectedSession, tabsEnabled, tabOrientation, splitPinnedKeys, selectedSessionKey,
    splitOrientation, measuredWindowAreaHeight, splitPaneCount, windowOrder, windowSurfaces,
    windowPresentation, floatingWindow, shownPopoverTab,
  })
  presentationIndexRef.current = windowZoom
  const {
    primaryLeaf, legacyReaderSlot, reconciledSplitTree, splitTreeLimits, baseTreeGeometry,
    treeOverflowRows, popoverHostSlot, resolvedPopoverHostKey,
  } = usePopoverTakesWindowGroup({
    hasPrimaryFrame, orderedWindowKeys, splitOrientation, windowSplitTree, selectedSessionKey,
    windowZoom, readerAreaWidth, windowBudgetHeight, fullscreenMode, popoverTabHostKey,
  })
  useEffect(() => {
    if (resolvedPopoverHostKey && popoverTabHostKey !== resolvedPopoverHostKey && !(popoverTabHostKey && orderedWindowKeys.includes(popoverTabHostKey))) setPopoverTabHostKey(resolvedPopoverHostKey)
  }, [resolvedPopoverHostKey, popoverTabHostKey, orderedWindowKeys, setPopoverTabHostKey])
  // Windows are numbered in order; a popover tab in a slot of its own is 1,
  // one that took a window has that window's number.
  const windowNumberOffset = primaryLeaf ? 2 : 1
  const treeGeometry = useMemo(() => {
    if (!baseTreeGeometry || popoverHostSlot < 0) return baseTreeGeometry
    const host = baseTreeGeometry.rects.get(popoverHostSlot)!
    return { ...baseTreeGeometry, rects: new Map(baseTreeGeometry.rects).set(-1, host), layout: { ...baseTreeGeometry.layout, reader: { width: host.width, height: host.height } } }
  }, [baseTreeGeometry, popoverHostSlot])
  const splitTreeSignature = JSON.stringify(reconciledSplitTree)
  useEffect(() => {
    if (windowSplitTree && splitTreeSignature !== JSON.stringify(windowSplitTree)) setWindowSplitTree(reconciledSplitTree)
  }, [splitTreeSignature])
  const responsiveWindows = treeGeometry ? { layout: treeGeometry.layout, overflowRows: treeOverflowRows } : computeResponsiveWindowLayout({
    arrangement: splitArrangement,
    orientation: splitOrientation,
    width: readerAreaWidth,
    height: windowBudgetHeight,
    requestedCount: splitPaneCount + windowSurfaces.length,
    availableCount: Math.min(splitPinnedSessions.length, splitPaneCount) + windowSurfaces.length,
    maxPanes: splitArrangement === 'split' ? SPLIT_PANE_MAX : SPLIT_PANE_ARRANGED_MAX,
    readerShare: splitReaderShare,
    secondaryShare: splitSecondaryShare,
    bottomShare: splitBottomShare,
    weights: splitWeights,
    minPaneWidth: windowZoom === null ? SPLIT_PANE_MIN_WIDTH : 0,
    minPaneRows: windowZoom === null ? SPLIT_PANE_MIN_ROWS : 0,
    minReaderWidth: windowZoom === null ? MIN_READER_WIDTH : 0,
    minReaderRows: windowZoom === null ? MIN_READER_ROWS : 0,
  })
  const windowOverflowRows = fullscreenMode || windowZoom !== null ? 0 : responsiveWindows.overflowRows
  const windowAreaHeight = Math.max(1, windowBudgetHeight - windowOverflowRows)
  const fittedWindows = responsiveWindows.layout
  const splitLayout = {
    visibleCount: fittedWindows.visibleCount,
    paneExtent: splitAxisStacked ? fittedWindows.panes[0]?.height ?? 0 : fittedWindows.panes[0]?.width ?? 0,
    readerExtent: splitAxisStacked ? fittedWindows.reader.height : fittedWindows.reader.width,
  }
  const arrangedLayout = treeGeometry || splitArrangement === 'split' || fullscreenMode ? null : fittedWindows
  const arrangedVisible = arrangedLayout !== null && arrangedLayout.visibleCount > 0
  // The split's own axis only applies to the split arrangement; the others lay
  // the reader out side by side with whatever is beside it.
  const stackedSplit = !treeGeometry && splitAxisStacked && !arrangedVisible
  const visibleSplitPaneCount = fittedWindows.visibleCount
  const {
    stackedPanesVisible, fittedWindowKeys, openTabByKey, windowItemFor, windowItems,
    laidOutWindowKeys, floatingKey, liveWindowStacks,
  } = useStackedPanesVisibleGroup({
    stackedSplit, visibleSplitPaneCount, treeGeometry, orderedWindowKeys, pinnedWindowSessions,
    openTabSessions, sessionsByKey, floatingWindow, windowSurfaces, popoverTabs, windowStacks,
  })
  parkedWindowKeysRef.current = new Set([
    ...liveWindowStacks.flat().filter((key) => !laidOutWindowKeys.has(key)),
    ...(floatingKey ? [floatingKey] : []),
  ])
  const {
    floatingItem, windowStackFor, windowItemKey, pinIndexOfWindow, splitPaneSessions,
    visibleWindowSurfaces, lastFocusedSplitPaneRef, selectedWindowIndex,
  } = useFloatingItemGroup({
    floatingKey, windowItemFor, liveWindowStacks, windowItems, splitPinnedKeys, selectedSessionKey,
  })
  // The window showing the selected session, if any.
  selectedWindowHandleRef.current = () => (selectedWindowIndex !== -1 ? splitPaneHandlesRef.current.get(selectedWindowIndex) : undefined)
  const focusedWindowItem = splitFocusIndex === null ? null
    : splitFocusIndex === FLOATING_PANE_INDEX ? floatingItem
    : splitFocusIndex === FULLSCREEN_PANE_INDEX ? (fullscreenMode && selectedSession ? { kind: 'session' as const, session: selectedSession } : null)
    : windowItems[splitFocusIndex] ?? null
  presentationResolverRef.current = (index = splitFocusIndex) => index === 'reader' || index === null
    ? (shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : selectedSessionKey)
    : index === FLOATING_PANE_INDEX ? floatingKey
    : windowItems[index] ? windowItemKey(windowItems[index]!) : null
  const focusedSessionPaneKey = focusedWindowItem?.kind === 'session' ? sessionKey(focusedWindowItem.session) : null
  // The selection follows the focused window, however focus got there — but
  // a selection made in the same commit wins (returning a pinned popover
  // selects its session while closing its window moves focus). Following it
  // anyway undid that selection, the selected session was put back in the
  // focused window, and the two effects swapped sessions forever.
  const followedSelectionRef = useRef(selectedSessionKey)
  useEffect(() => {
    const selectionMoved = followedSelectionRef.current !== selectedSessionKey
    followedSelectionRef.current = selectedSessionKey
    if (!focusedSessionPaneKey || selectionMoved) return
    setComposerPaneTargetKey(focusedSessionPaneKey)
    setSelectedSessionKey(focusedSessionPaneKey)
  }, [focusedSessionPaneKey, selectedSessionKey])
  // `w` closes a window's tab and shows the next one there — the nearest tab
  // no other window shows — or closes the window when every tab is on screen.
  const closeWindowSessionTab = useStableEvent((session: Session) => runCloseWindowSessionTab({
    openTabSessions, orderedWindowKeys, liveWindowStacks, floatingKey, windowStackFor,
    closeWindowTab, setOpenTabSessions, floatingWindow, checkpointWindowLayout, setFloatingWindow,
    setSelectedSessionKey, closeFloatingWindow, windowItems, closeSplitPane, commitWindowKeys,
    setWindowStacks,
  }, session))
  // The selected session is always on screen: in the focused session window,
  // else the one focused last, else a new window. Browsing the rail is
  // debounced, or every j would remount a window.
  const showSelectedSessionInWindow = useStableEvent(() => {
    if (!selectedSession || !selectedSessionKey || shownPopoverTab) return
    const key = selectedSessionKey
    if (laidOutWindowKeys.has(key) || floatingKey === key || windowStackFor(key)) return
    if (legacyReaderSlot && reconciledSplitTree) {
      const tree = adoptPrimaryWindow(reconciledSplitTree, key)
      commitWindowKeys(tree.keys, tree)
      setWorkspaceHasSession(true); setWorkspaceLaunched(true)
      return
    }
    const targetIndex = splitFocusIndex ?? lastFocusedSplitPaneRef.current
    const target = targetIndex === FLOATING_PANE_INDEX ? null : windowItems[targetIndex] ?? null
    const old = target?.kind === 'session' ? windowItemKey(target) : null
    const nextKeys = old ? orderedWindowKeys.map(entry => entry === old ? key : entry) : [...orderedWindowKeys, key]
    commitWindowKeys(nextKeys)
    setWindowSplitTree(reconciledSplitTree ? reconcileWindowSplitTree(reconciledSplitTree, nextKeys, false) : arrangePaneTree(nextKeys, false, 'columns'))
    if (old) setWindowStacks(liveWindowStacks.map(stack => stack.map(entry => entry === old ? key : entry)))
    setWorkspaceHasSession(true); setWorkspaceLaunched(true)
  })
  useEffect(() => {
    if (effectiveFocus !== 'sessions') { showSelectedSessionInWindow(); return }
    const timer = setTimeout(showSelectedSessionInWindow, DETAIL_OPEN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [selectedSessionIdentity, shownPopoverTab])
  // Focus with no window under it lands on the window showing the selection.
  useEffect(() => {
    if (effectiveFocus !== 'messages' || splitFocusIndex !== null || hasPrimaryFrame || composerActive) return
    if (selectedWindowIndex === FLOATING_PANE_INDEX) { focusSplitPane(FLOATING_PANE_INDEX); return }
    if (!windowItems.length) { if (showRail && !floatingKey) setFocusedPane('sessions'); return }
    const shown = windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === selectedSessionKey)
    focusSplitPane(shown >= 0 ? shown : Math.min(lastFocusedSplitPaneRef.current, windowItems.length - 1))
  })
  // A popover tab in the reader's place takes the keys while the reader is focused.
  const popoverTabFocused = Boolean(shownPopoverTab) && splitFocusIndex === null && !windowSurfacePeek && effectiveFocus === 'messages'
  const focusedWindowSurface: WindowSurfaceId | null = windowSurfacePeek ?? (focusedWindowItem?.kind === 'surface' ? focusedWindowItem.surface : null) ?? (popoverTabFocused ? shownPopoverTab : null)
  const focusedWindowSurfaceKind: WindowSurfaceKind | null = focusedWindowSurface ? surfaceKindOf(focusedWindowSurface) : null
  const describeCoordinatorWindow = (target: WindowTarget): WindowTarget => {
    const agent = watchedCoordinator?.agents.find(entry => entry.sessionId && sessionKey({ ...entry, sessionId: entry.sessionId! }) === target.key)
    if (!agent) return target
    const task = watchedCoordinator?.tasks.find(entry => entry.ownerAgentId === agent.id && !['completed', 'failed', 'cancelled'].includes(entry.status))
    return { ...target, title: `${agent.name} · ${target.title}`, detail: `${agent.role}${task ? ` · ${task.title}` : ''} · ${target.detail}` }
  }
  const windowTargets: WindowTarget[] = [
    ...splitPinnedSessions.slice(0, splitPaneCount).map((session) => describeCoordinatorWindow(windowSessionTarget(session, !splitPaneSessions.some((visible) => sessionKey(visible) === sessionKey(session))))),
    ...windowSurfaces.map((surface) => ({ key: surfaceWindowKey(surface), title: surfaceTitle(surface), detail: `${gitRepoCwd || process.cwd()} · surface${visibleWindowSurfaces.includes(surface) ? '' : ' · hidden'}`, hidden: !visibleWindowSurfaces.includes(surface), surface })),
  ]
  for (const id of popoverTabs) windowTargets.push({ key: surfaceWindowKey(id), title: surfaceTitle(id), detail: 'workspace tab', surface: id, hidden: shownPopoverTab !== id })
  // Background tabs and the floating window are windows too, for the switcher.
  for (const key of parkedWindowKeysRef.current) {
    const item = windowItemFor(key)
    if (item.kind === 'session' && !item.session) continue
    windowTargets.push(item.kind === 'session'
      ? { ...describeCoordinatorWindow(windowSessionTarget(item.session, true)), detail: `${key === floatingKey ? 'floating window' : 'background tab'} · ${windowSessionTarget(item.session, false).detail}` }
      : { key, title: surfaceTitle(item.surface), detail: key === floatingKey ? 'floating window' : 'background tab', hidden: true, surface: item.surface })
  }
  const overflowWindowItems: WindowItem[] = orderedWindowKeys
    .filter((key) => !fittedWindowKeys.includes(key))
    .map(windowItemFor)
  const focusedWindowKey = splitFocusIndex === null ? null
    : focusedWindowItem?.kind === 'session' ? sessionKey(focusedWindowItem.session) : null
  useLayoutEffect(() => { windowObservedFocusRef.current = focusedWindowKey }, [focusedWindowKey])
  const reportWindowActivity = useCallback((key: string, version: string, errorVersion: string | null) => {
    setWindowAttention((previous) => {
      const before = previous.get(key)
      const next = observeWindowAttention(before, 'transcript', version, errorVersion, key === windowObservedFocusRef.current)
      if (next === before) return previous
      return new Map(previous).set(key, next)
    })
  }, [])
  const windowNeedsInputKeys = useMemo(() => new Set(attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey)), [attentionItems])
  const windowPinSignature = splitPinnedKeys.join('\u0000')
  useEffect(() => runWindowAttentionEffect({
    setWindowAttention, selectedSessionKey, splitPinnedKeys, sessionsByKeyRef, focusedWindowKey,
    openTabSessions,
  }), [sessions, windowPinSignature, selectedSessionKey, focusedWindowKey, openTabSessions])
  const badgeForWindow = (key: string, compact = false) => [coordinatorBadges.get(key) ? (compact ? '?' : coordinatorBadges.get(key)) : null, windowAttentionBadge({ ...windowAttention.get(key), needsInput: windowNeedsInputKeys.has(key) }, compact)].filter(Boolean).join(' · ') || null
  // The window holding the transcript being read, whichever renderer draws it:
  // the reader's own chrome (composer bar, status widths) is sized to it.
  const transcriptWindowIndex = selectedWindowIndex
  const transcriptWindowFloating = transcriptWindowIndex === FLOATING_PANE_INDEX
  // Where the reader's chrome goes when panes draw the transcript: the window
  // showing the selected session, else the focused (or last focused) one.
  const chromeWindowIndex = selectedWindowIndex !== -1 ? selectedWindowIndex : splitFocusIndex ?? lastFocusedSplitPaneRef.current
  const treeReaderRect = transcriptWindowFloating && floatingWindow && !fullscreenMode
    ? clampFloatingRect(floatingWindow.rect, { width: readerAreaWidth, height: windowAreaHeight })
    : treeGeometry
    ? (transcriptWindowIndex >= 0 ? treeGeometry.rects.get(transcriptWindowIndex) : treeGeometry.rects.get(-1)) ?? { x: 0, y: 0, ...treeGeometry.layout.reader }
    : transcriptWindowIndex >= 0 && !transcriptWindowFloating && !fullscreenMode && fittedWindows.panes[transcriptWindowIndex]
    ? { x: 0, y: 0, ...fittedWindows.panes[transcriptWindowIndex]! }
    : null
  const activeTranscriptWidth = treeReaderRect ? treeReaderRect.width : arrangedVisible ? arrangedLayout.reader.width : stackedSplit ? readerAreaWidth : splitLayout.readerExtent
  const openCodeContextWidth = isOpenCodeView && visibleSplitPaneCount === 0
    ? Math.min(Math.max(24, Math.floor(activeTranscriptWidth * 0.22)), Math.max(activeTranscriptWidth - MIN_READER_WIDTH, 0))
    : 0
  const rightPaneWidth = activeTranscriptWidth - openCodeContextWidth
  // Row budget the reader column actually gets. Stacked panes take theirs out
  // of it, so every downstream height (transcript viewport included) must be
  // measured from this rather than from the whole frame. In the grid the
  // reader has the top row only.
  const readerRowBudget = treeReaderRect ? treeReaderRect.height + (mainContentHeight - windowBudgetHeight)
    : arrangedVisible && arrangedLayout.reader.height < windowAreaHeight
    ? arrangedLayout.reader.height + (mainContentHeight - windowBudgetHeight)
    : stackedPanesVisible ? splitLayout.readerExtent + (mainContentHeight - windowBudgetHeight) : mainContentHeight - windowOverflowRows
  const splitPaneKeys = splitPaneSessions.map((pane) => sessionKey(pane))
  const splitPaneKeysSignature = splitPaneKeys.join('\u0000')
  // Live slices for the split panes. The app-wide live list is already tagged
  // by session, so a pane needs no second subscription — but each slice keeps
  // its array identity across polls (the same trick the reader uses) so an idle
  // pane's card pipeline bails out instead of reformatting every 2s.
  const splitPaneLiveCacheRef = useRef(new Map<string, ThreadedMessage[]>())
  const splitPaneLiveMessages = useMemo(() => {
    const cache = splitPaneLiveCacheRef.current
    return groupItemsBySplitPaneKey(
      splitPaneKeys,
      liveTranscriptMessages,
      liveMessageSessionKey,
      cache,
    )
  }, [liveTranscriptMessages, splitPaneKeysSignature])
  useEffect(() => {
    splitPaneLiveCacheRef.current = splitPaneLiveMessages
  }, [splitPaneLiveMessages])
  const {
    splitPaneRunningKeys, textareaInnerWidth, rightSidePanelVisible, composerAreaOffset,
    composerAreaWidth, composerDockTextareaWidth, composerWindowWidth, composerWindowHeight,
    composerWindowLeft, composerWindowTop, composerWindowContentWidth, composerWindowTextareaWidth,
    composerLineCounts,
  } = useSplitPaneRunningKeysGroup({
    runningSessions, rightPaneWidth, taskPanelVisible, surfacePanelOnRight, showRail, sidebarWidth,
    readerAreaWidth, width, fullscreenMode, height, composerDraft,
  })
  composerDraftShapeRef.current = { ...composerLineCounts, lines: composerDraftLines, attachments: '' }
  const composerVisualLineCount = composerLineCounts.dock
  const composerWindowVisualLineCount = composerLineCounts.window
  const composerWindowSuggestionHeight = (composerActive && composerMention && composerMentionVisibleCount > 0)
    ? composerMentionVisibleCount + 3
    : (composerActive && composerSlashOpen && composerSlashVisibleCount > 0 && !composerMention && !composerHistoryOpen && !composerStashOpen)
    ? composerSlashVisibleCount + 3
    : (composerActive && composerHistoryOpen && composerHistoryVisibleCount > 0 && !composerMention)
    ? composerHistoryVisibleCount + 3
    : (composerActive && composerStashOpen && composerStashVisibleCount > 0 && !composerMention)
    ? composerStashVisibleCount + 3
    : (composerActive && composerRewindVisibleCount > 0)
    ? composerRewindVisibleCount + 3
    : 0
  const composerWindowHeaderHeight = 2
  const composerWindowFooterHeight = 2
  const composerWindowEditorHeight = Math.max(
    4,
    composerWindowHeight - composerWindowHeaderHeight - composerWindowFooterHeight - composerWindowSuggestionHeight - 2,
  )
  const livePreviewContentWidth = Math.max(width - 8, 14)
  const {
    liveAssistantPreviewLines, liveReasoningPreviewLines, isPreviewMode, visibleTabSessions,
    showTabs, showHorizontalTabs,
  } = useLiveAssistantPreviewLinesGroup({
    composerLiveText, livePreviewContentWidth, composerLiveReasoning, selectedSessionKey,
    laidOutWindowKeys, openTabSessions, selectedSession, fullscreenMode, tabsEnabled, popoverTabs,
    verticalTabsWidth,
  })
  const showPreviewBar = false
  const TAB_BAR_HEIGHT = HORIZONTAL_TAB_BAR_HEIGHT
  // SCROLLBACK has no card for these actions to apply to, and its own keys are
  // already in the status bar.
  const streamActionFooterRows = isChatLikeView && !isScrollbackView && !embeddedComposer && visibleTranscriptCards.length > 0 ? 1 : 0
  const chatTurnStatusRows = embeddedComposer && turnRunningForComposer && visibleTranscriptCards.length > 0 ? 1 : 0
  // Two-row "new messages" banner above the transcript; see where it renders.
  const tailBannerRows = !followTail && (!isScrollbackView || pendingNewCount > 0) ? 2 : 0
  // Frame, header, context row and the ticker-or-banner pair. The stream views
  // draw only the frame and the banner, and were handing the transcript's rows
  // to chrome they never render.
  const readerChromeRows = isStreamView ? 1 + tailBannerRows + (!presentationFocusMode && isCopilotView ? 1 : 0) : 7
  const estimatedTranscriptViewportRows = Math.max(
    readerRowBudget
    // Sticky headers sit directly beneath the pane title; reclaim its inset.
    + (stickyHeaders ? 1 : 0)
    // Fullscreen removes the two-row reader frame, leaving only the compact
    // restore affordance plus the transcript's top/bottom content insets.
    - (fullscreenMode ? 3 : focusMode ? 4 : readerChromeRows)
    - (fullscreenMode && !presentationFocusMode && isCopilotView ? 1 : 0)
    - (showHorizontalTabs || showPreviewBar ? TAB_BAR_HEIGHT : 0)
    // Fleet strip is one header row when visible.
    - (fleetStripVisible ? 1 : 0)
    - streamActionFooterRows
    - (showToolCalls ? 0 : 1)
    // Pin Chat's live-turn status directly above its composer. Keeping this
    // outside the scrollbox prevents a short transcript from leaving the
    // spinner at the top of an otherwise empty full-height viewport.
    - chatTurnStatusRows
    // The chat-mode composer bar lives inside this same bordered box, below
    // the scrollbox, so its rows come out of the viewport budget here.
    - (embeddedComposer && !composerWindowOpen && !composerHidden && !presentationHidesComposer ? composerDockHeight : 0),
    8,
  )
  const {
    transcriptViewportRows, activeTabIndex, runningTabKeys, tabWidth, tabOptions,
  } = useTranscriptViewportRowsGroup({
    estimatedTranscriptViewportRows, selectedSessionKey, visibleTabSessions,
    sidebarSessionActivity, attentionDone, recentlyWrittenKeys, verticalTabsWidth, readerAreaWidth,
    popoverTabs, splitPinnedKeys, splitPaneCount, teamAttention, coordinatorBadges, isPreviewMode,
    windowSurfaceMeta, openTabByKey, sessions,
  })
  const {
    activeStripIndex, tabStripLength, surfacePanelHeight, sidebarExtraRows, sidebarRowBudget,
    sidebarInnerWidth, showProviderInSessionRows, sidebarProviderBadgeText,
    sidebarHeaderPrefixWidth, sidebarHeaderBaseText, sidebarProviderAccent,
    coordinatorSidebarHeader, imessageStyle, transcriptDiffControls, selectAgentTool,
    refreshSessions, markSessionRunning, clearSessionRunning, refreshSessionMetadata,
  } = useActiveStripIndexGroup({
    shownPopoverTab, visibleTabSessions, popoverTabs, activeTabIndex, mainContentHeight,
    effectiveSurfacePanelRows, composerStatusBlockHeight, composerPopoverHeight, embeddedComposer,
    composerDockHeight, fullscreenMode, rightSidePanelVisible, workspacesEnabled, spacesState,
    sidebarWidth, provider, sessions, normalizedSessionQuery, scratchFilter, settledFilter,
    filteredSessionsForSidebar, spaceSessions, providerInstances, providerInstanceId,
    sidebarSortLabel, sessionSearchQuery, coordinatorHeaderCounts, themeMode, transcriptDiffNotes,
    transcriptDiffDraft, hoveredTranscriptDiffAnchor, activateTranscriptDiffHover,
    openScopedTranscriptDiffNote, sendScopedTranscriptDiffNote, transcriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, transcriptDiffHiddenHunkHeaderCardKeys,
    transcriptDiffRowCursorByCardKey, transcriptDiffSelectionAnchorByCardKey,
    setTranscriptDiffRowCursorForCard, setTranscriptDiffSelectionAnchorForCard,
    setAgentToolCursorByGroupKey, sessionRequestRef, setLoadingSessions, setRefreshingSessions,
    providerSwitchRef, setError, providerInstanceIdRef, pendingInboxEditsRef,
    selectedSessionKeyRef, sessionsRef, setSessions, setSelectedSessionKey, openTabSessionsRef,
    setRunningSessions, runningSessionsRef, tabsEnabledRef, composerTargetSessionRef,
    sessionContextUsageCacheRef, sessionMetadataFetchedAtRef, sessionDetailCacheRef,
    sessionMetadataInFlightRef, setContextUsageStatus, setTuiReportedModelByKey, setContextUsage,
    setSessionDetail,
  })

  // The composer can explicitly target another window's session. Resolve
  // metadata for that actual target
  // instead of waiting for a reader-detail load that may never happen.
  useEffect(() => {
    const targetKey = composerTargetSessionIdentity
    if (!bootstrapped || !targetKey || composerCurrentModel || composerModelLookupSettled) return
    const target = composerTargetSessionRef.current
    if (!target || sessionKey(target) !== targetKey) return
    if (target.provider === 'claude-acp' || target.provider === 'codex-acp' || target.provider === 'acp') return
    const cached = sessionDetailCacheRef.current.get(targetKey) ?? null
    refreshSessionMetadata(target, false, cached ?? undefined, cached, false)
  }, [bootstrapped, composerCurrentModel, composerModelLookupSettled, composerTargetSessionIdentity, refreshSessionMetadata])
  const {
    refreshSelectedSessionDetail, prefetchSessionDetail, jumpToTranscriptTail,
    jumpToUnreadBoundary, jumpToResumeMarker, focusSidebarEntry, moveSelection, moveCursor,
    moveAgentToolCursor, velocityScrollStep, moveViewport, jumpToMatchingCard, jumpToSearchMatch,
    toggleExpansion, openProviderMenu, closeProviderMenu, openThemeMenu, closeThemeMenu,
    chooseTheme, applyTerminalThemeMode,
  } = useRefreshSelectedSessionDetailGroup({
    sessionsByKeyRef, reattachedRunningKeyRef, runningSessionsRef, loadingDetailRef,
    backgroundRefreshInFlightRef, liveTranscriptBaselineRef, awaitingPersistedTurnRef,
    sessionDetailMtimeRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, loader, densityRef,
    showToolCallsRef, sessionDetailCacheRef, navDetailSetAtRef, setSessionDetail, setLoadingDetail,
    selectedSessionKeyRef, setContextUsage, setContextUsageStatus, refreshSessionMetadata,
    setError, detailRequestRef, openTabSessionsRef, sessionContextUsageCacheRef,
    sessionMetadataFetchedAtRef, pendingLiveTextRef, liveTranscriptMessagesRef, ownsComposerStream,
    setLiveTranscriptMessages, liveToolIndexesRef, liveToolInputJsonRef, setComposerLiveText,
    setAwaitingPersistedTurn, sessionDetailRef, visibleTranscriptCards, jumpToTranscriptIndex,
    setFollowTail, setPendingNewCount, setUnreadBoundaryKey, unreadBoundaryIndex, resumeMarkerKey,
    transcriptIndexByKey, setSidebarSubagentCursor, setSelectedSessionKey,
    setComposerPaneTargetKey, sidebarEntries, sidebarSubagentCursor, selectedSession,
    readCursorIndex, setTranscriptCursorKey, groupedToolView, resolvedExpandedKeys,
    agentToolCursorByGroupKey, setAgentToolCursorByGroupKey, velocityScrollEnabled,
    velocityScrollStateRef, height, focusMode, searchMatches, searchMatchIndex,
    setSearchMatchIndex, transcriptView, isChatLikeView, expandedCardKeys, collapsedCardKeys,
    setCollapsedCardKeys, setExpandedCardKeys, setProviderMenuIndex, providerInstances, provider,
    providerInstanceId, setProviderMenuOpen, setProviderInstances, themeMenuOriginRef, themeMode,
    setThemeMenuIndex, setThemeMenuGroup, setThemeMenuQuery, setThemeMenuOpen, setThemeMode,
    themeSlotsRef, themeFollowsTerminalRef, setThemeFollowsTerminal,
  })

  useEffect(() => {
    const onThemeMode = (mode: 'light' | 'dark') => applyTerminalThemeMode(mode)
    renderer.on('theme_mode', onThemeMode)
    return () => { renderer.off('theme_mode', onThemeMode) }
  }, [renderer])

  // With a listener attached the renderer re-reads the palette itself when the
  // terminal's appearance changes, and reports only a palette that differs.
  useEffect(() => {
    const onPalette = (colors: TerminalReportedColors) => {
      setTerminalPaletteTheme(terminalPaletteTheme(colors))
      setTerminalPaletteEpoch((epoch) => epoch + 1)
    }
    renderer.on('palette', onPalette)
    return () => { renderer.off('palette', onPalette) }
  }, [renderer])

  // Asking costs a round of OSC queries, so it waits until the theme is used —
  // chosen, restored, or passed over while browsing the theme menu. OpenTUI
  // caches the answer, so coming back to the theme does not ask again.
  useEffect(() => {
    if (themeMode !== TERMINAL_PALETTE_MODE) return
    void renderer.getPalette({ size: 16 }).then((colors) => {
      const built = terminalPaletteTheme(colors)
      setTerminalPaletteTheme(built)
      setTerminalPaletteEpoch((epoch) => epoch + 1)
      if (!built) showNotice('info', 'This terminal did not report its colours; showing the dark theme instead')
    }).catch(() => {
      showNotice('info', 'This terminal did not report its colours; showing the dark theme instead')
    })
  }, [renderer, themeMode])

  const toggleThemeFollowsTerminal = useStableEvent(() => {
    const next = !themeFollowsTerminalRef.current
    themeFollowsTerminalRef.current = next
    setThemeFollowsTerminal(next)
    void writeTuiThemeFollow({ follow: next }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    })
    if (!next) return
    if (renderer.themeMode) {
      applyTerminalThemeMode(renderer.themeMode)
      setThemeMenuGroup(renderer.themeMode === 'light' ? 'light' : 'dark')
    } else {
      showNotice('info', 'This terminal has not reported a light or dark background; the theme stays as it is')
    }
  })

  const openTranscriptViewMenu = useStableEvent(() => {
    transcriptViewMenuOriginRef.current = transcriptView
    setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(transcriptView), 0))
    setTranscriptViewMenuOpen(true)
  })

  const closeTranscriptViewMenu = useStableEvent(() => {
    const originView = transcriptViewMenuOriginRef.current
    setTranscriptViewMenuOpen(false)
    if (originView) {
      setTranscriptView(originView)
      setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(originView), 0))
    } else {
      setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(transcriptView), 0))
    }
    transcriptViewMenuOriginRef.current = null
  })

  const chooseTranscriptView = useCallback((nextView: TuiTranscriptView) => {
    setTranscriptView(nextView)
    setTranscriptViewMenuIndex(Math.max(TRANSCRIPT_VIEWS.indexOf(nextView), 0))
    transcriptViewMenuOriginRef.current = null
    void writeTuiTranscriptView(nextView).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store transcript view')
    })
    setTranscriptViewMenuOpen(false)
  }, [])

  // Lightweight windows apply to whichever view is chosen, like the old pane did.
  const toggleLightweightWindows = useStableEvent(() => {
    const next = !lightweightWindows
    setLightweightWindows(next)
    showToggleOutcome('Lightweight windows', next)
    void writeTuiLightweightWindows(next).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store lightweight windows')
    })
  })

  const persistTheme = useCallback(() => {
    try { writeTuiThemeSync(currentThemeRef.current, themeFollowsTerminalRef.current) } catch { /* best-effort */ }
  }, [])

  const confirmExit = useStableEvent(() => runConfirmExit({
    exitInProgressRef, setExitCleanupInProgress, setQueuedComposerSends, queuedComposerSendsRef,
    workspaceContext, activeComposerSendCleanupRef, composerAbortRef,
    activeComposerTurnRequestIdRef, composerTargetSessionRef, runningSessionsRef, composerSessions,
    persistTheme, renderer,
  }))

  const requestExit = useCallback(() => {
    setExitConfirmOpen(true)
  }, [])

  const cancelExit = useCallback(() => {
    if (exitInProgressRef.current) return
    setExitConfirmOpen(false)
  }, [])

  // Open the composer settings overlay. Model metadata stays provider-owned;
  // the TUI only filters the reported effort levels to values each backend
  // accepts, then applies both settings to the next send.
  const openModelPicker = useStableEvent(async () => openModelPickerAction({
    composerTargetSession, selectedSession, showNotice, setModelPickerTarget, setModelPickerFocus,
    setModelPickerError, setModelPickerOptions, setModelPickerPermissionOptions,
    setModelPickerQuery, setModelPickerIndex, setModelPickerPermissionIndex, setModelPickerLoading,
    setModelPickerOpen, setTuiCopilotPermissionModeByKey, tuiModelOverride,
    setTuiCopilotContextTierByKey,
  }))

  const applyModelPickerOption = useStableEvent((selectedOption?: ModelPickerOption) => {
    const option = selectedOption ?? filteredModelPickerOptions[modelPickerIndex]
    const target = modelPickerTarget ?? composerTargetSession ?? selectedSession
    const value = typeof option?.value === 'string' ? option.value : ''
    if (!target || !value) return
    setTuiModelOverride((prev) => ({ ...prev, [sessionKey(target)]: value }))
    pushClaudeControl(target, { action: 'setModel', model: value })
    if (effortPickerOptions(target.provider, option).length > 1) {
      setModelPickerFocus('effort')
    } else if (modelPickerPermissionOptions.length > 0) {
      setTuiEffort('auto')
      setModelPickerFocus('permissions')
    } else {
      setTuiEffort('auto')
      setModelPickerOpen(false)
    }
  })

  const switchComposerModel = useStableEvent(async (target: Session, requested: string) => {
    let models: Array<{ value?: unknown; displayName?: string }> = []
    try {
      models = (await readTuiSessionMetadata(target)).models
    } catch {
      // Claude takes aliases itself; the others need a listed model below.
    }
    const needle = requested.toLowerCase()
    const listed = models.filter((m): m is { value: string; displayName?: string } => typeof m.value === 'string' && m.value.length > 0)
    const found = listed.find((m) => m.value.toLowerCase() === needle || m.displayName?.toLowerCase() === needle)
      ?? listed.find((m) => m.value.toLowerCase().includes(needle) || m.displayName?.toLowerCase().includes(needle))
    // Claude resolves its own aliases (haiku, opus[1m], …), as its CLI does.
    const value = found?.value ?? (target.provider === 'claude' ? requested : null)
    if (!value) {
      showNotice('error', `No model matches "${requested}" — /model lists them`, 6000)
      return
    }
    setTuiModelOverride((prev) => ({ ...prev, [sessionKey(target)]: value }))
    pushClaudeControl(target, { action: 'setModel', model: value })
    showNotice('info', `Model set to ${found?.displayName || value}`, 4000)
  })

  const applyModelPickerEffort = useStableEvent((value: string | undefined) => {
    if (value) setTuiEffort(value as TuiEffort)
    if (modelPickerPermissionOptions.length > 0) setModelPickerFocus('permissions')
    else setModelPickerOpen(false)
  })

  const applyModelPickerPermission = useStableEvent((value: string | undefined) => {
    const target = modelPickerTarget ?? composerTargetSession ?? selectedSession
    if (!target || !value) return
    if (target.provider === 'claude' && CLAUDE_PERMISSION_MODE_ORDER.includes(value as TuiPermissionMode)) {
      setClaudeComposerPermissionMode(target, value as TuiPermissionMode)
    } else if (target.provider === 'codex' && (value === 'auto' || value === 'untrusted' || value === 'on-request' || value === 'never')) {
      setTuiCodexApprovalByKey((prev) => ({ ...prev, [sessionKey(target)]: value }))
    } else if (target.provider === 'copilot' && (value === 'off' || value === 'auto' || value === 'on')) {
      setTuiCopilotPermissionModeByKey((prev) => ({ ...prev, [sessionKey(target)]: value }))
      if (!target.isPending) {
        void runTuiSessionAction(target, {
          action: 'setPermissionMode',
          permissionMode: value,
        }).catch(() => { /* next send carries permissionMode */ })
      }
    }
    setModelPickerOpen(false)
  })

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteIndex(0)
  }, [])

  const filteredCommands = useMemo(() => {
    const enabledCommands = disabledPlugins.size
      ? COMMANDS.filter((cmd) => { const plugin = getPluginCommand(cmd.id)?.pluginId; return !plugin || !disabledPlugins.has(plugin) })
      : COMMANDS
    const bridgeFiltered = canUseChannelBridge
      ? enabledCommands
      : enabledCommands.filter((cmd) => cmd.id !== 'channel-bridge' && cmd.id !== 'channel-bridge-route')
    const availableCommands = canUseIdeBridge
      ? bridgeFiltered
      : bridgeFiltered.filter((cmd) => cmd.id !== 'ide-bridge' && cmd.id !== 'ide-bridge-route')
    const q = commandPaletteQuery.toLowerCase()
    if (!q) {
      // Keyboard selection indexes this array, so keep it in the exact same
      // category order used by the rendered palette rows.
      return COMMAND_CATEGORY_ORDER.flatMap((category) => (
        availableCommands.filter((cmd) => cmd.category === category)
      ))
    }
    return availableCommands.filter((cmd) => `${cmd.label} ${cmd.key} ${cmd.category}`.toLowerCase().includes(q))
  }, [canUseChannelBridge, canUseIdeBridge, commandPaletteQuery, disabledPlugins])

  useEffect(() => runExitConfirmOpenEffect({
    currentThemeRef, themeMode,
  }), [themeMode])

  useEffect(() => runExitDelayEffect({
    exitConfirmOpenRef, confirmExit, setExitConfirmOpen, persistTheme,
  }), [confirmExit, persistTheme])

  const paletteDisplayRows = useMemo((): PaletteRow[] => {
    if (commandPaletteQuery) {
      return filteredCommands.map((cmd, cmdIndex) => ({ kind: 'cmd', cmd, cmdIndex }))
    }
    const rows: PaletteRow[] = []
    COMMAND_CATEGORY_ORDER.forEach((category) => {
      const commands = filteredCommands
        .map((cmd, cmdIndex) => ({ cmd, cmdIndex }))
        .filter((entry) => entry.cmd.category === category)
      if (commands.length === 0) return
      rows.push({ kind: 'header', label: category })
      commands.forEach((entry) => rows.push({ kind: 'cmd', ...entry }))
    })
    return rows
  }, [commandPaletteQuery, filteredCommands])
  const commandPaletteTopOffset = presentationFocusMode ? 2 : 4
  const commandPaletteBodyRows = Math.max(1, Math.min(
    paletteDisplayRows.length || 1,
    mainContentHeight - commandPaletteTopOffset - 8,
  ))

  const chooseProvider = useStableEvent(async (nextProvider: ProviderSelection, targetSession: Session | null = null, nextInstanceId: string | null = null) => runChooseProvider({
    provider, providerInstanceIdRef, closeProviderMenu, setComposerPaneTargetKey,
    setSelectedSessionKey, providerSwitchRef, setProviderInstanceId, setProvider, setSessionDetail,
    setTranscriptCursorKey, setExpandedCardKeys, setCollapsedCardKeys, setFollowTail,
    setPendingNewCount, setUnreadBoundaryKey, setResumeMarkerKey, setSearchMode, setSearchQuery,
    setSearchMatchIndex, setRestoredReaderState, setError, refreshSessions,
  }, nextProvider, targetSession, nextInstanceId))

  // Select a session that is already an open tab. If the tab belongs to a
  // different provider than the one currently active, transparently switch
  // providers first (carrying the target session through) so cross-provider
  // tab navigation works without losing the tab's context.
  // Close a tab in the strip, and its window if it has one.
  const closeSessionTab = useStableEvent((session: Session) => {
    const key = sessionKey(session)
    const pane = windowItems.findIndex(item => windowItemKey(item) === key)
    if (windowStackFor(key)) closeWindowTab(key)
    else if (floatingKey === key) closeFloatingWindow()
    else if (pane >= 0) closeSplitPane(pane)
    setOpenTabSessions(current => current.filter(tab => sessionKey(tab) !== key))
    // Closing a view never opens an unrelated session to fill its place.
    if (key === selectedSessionKey) { setWorkspaceHasSession(false); setWorkspaceReaderSession(null) }
  })

  const selectTabSession = useStableEvent((session: Session) => {
    setActivePopoverTab(null)
    const key = sessionKey(session)
    setComposerPaneTargetKey(key)
    const existing = windowItems.findIndex(item => windowItemKey(item) === key)
    if (existing >= 0) { focusSplitPane(existing); return }
    if (floatingKey === key) { focusSplitPane(FLOATING_PANE_INDEX); return }
    if (windowStackFor(key)) { activateWindowTab(key); setOverviewPendingTarget(key); return }
    setWorkspaceHasSession(true); setWorkspaceLaunched(true)
    const targetProvider: ProviderSelection = session.provider ?? 'claude'
    // A tab from another instance than the one the list is narrowed to is not
    // in that list either; widen to the whole provider.
    const outsideInstance = providerInstanceId !== null && (session.providerInstanceId ?? targetProvider) !== providerInstanceId
    if (provider !== 'all' && (targetProvider !== provider || outsideInstance)) {
      void chooseProvider(targetProvider, session)
      return
    }
    setSelectedSessionKey(sessionKey(session))
  })

  // Diagnostics is the diagnostics plugin's; every opener names the session to read.
  const openDiagnostics = useStableEvent((session?: Session | null) => { runPluginCommandId('diagnostics', session ?? selectedSession) })

  // Fire-and-forget push of model/permission changes through the actions
  // route, mirroring MessageView.tsx. For warm Claude sessions the server's
  // claudePool applies these live via setModel/setPermissionMode on the
  // persistent Query; otherwise the change still rides on the next send's
  // body. Skips when no Claude target, or when the target is still pending.
  const pushClaudeControl = useCallback((
    target: Session | null | undefined,
    body: Record<string, unknown>,
  ): void => {
    if (!target || target.provider !== 'claude' || target.isPending) return
    void runTuiSessionAction(target, body).catch(() => { /* swallow */ })
  }, [])

  const setClaudeComposerPermissionMode = useStableEvent((target: Session | null | undefined, nextMode: TuiPermissionMode) => {
    if (!target || target.provider !== 'claude') return
    const targetKey = sessionKey(target)
    const current = tuiPermissionModeByKeyRef.current
    const next = current[targetKey] === nextMode ? current : { ...current, [targetKey]: nextMode }
    tuiPermissionModeByKeyRef.current = next
    setTuiPermissionModeByKey(next)
    pushClaudeControl(target, { action: 'setPermissionMode', permissionMode: nextMode })
  })

  const cycleClaudeComposerPermissionMode = useStableEvent((target: Session | null | undefined) => {
    if (!target || target.provider !== 'claude') return
    const current = tuiPermissionModeByKeyRef.current[sessionKey(target)] ?? 'default'
    const currentIndex = CLAUDE_PERMISSION_MODE_ORDER.indexOf(current)
    const next = CLAUDE_PERMISSION_MODE_ORDER[(currentIndex + 1) % CLAUDE_PERMISSION_MODE_ORDER.length]!
    showToggleOutcome('Claude permission mode:', next)
    setClaudeComposerPermissionMode(target, next)
  })

  const cancelComposerSend = useStableEvent(() => cancelComposerSendAction({
    composerTargetSession, activeComposerTurnRequestIdRef, steeredComposerSendsRef,
    setLiveTranscriptMessages, composerTextareaRef, composerDraft, setComposerDraft,
    composerRetryTimerRef, composerRetryCountRef, liveTranscriptBaselineRef,
    composerInterruptPendingRef, composerAbortRef, reattachedRunningKeyRef, reattachedRunningRef,
    setReattachedRunning, reattachMarksRef, clearSessionRunning, setInterruptPressActive,
    interruptPressTimeoutRef, setPendingPermissions, setPermissionOptionIndex,
    queuedComposerSendsRef, commitQueuedComposerSends, composerMentionAttachmentsRef,
    composerPromptPartsRef, setComposerMentionAttachments, setComposerPromptParts,
    restoreComposerPromptPartExtmarks, setComposerSendState, setAwaitingPersistedTurn,
    setLiveStatus, setComposerLiveText, setComposerLiveReasoning, setComposerThinkingTokens,
    pendingLiveReasoningRef, liveToolIndexesRef, liveToolInputJsonRef, liveTextFlushTimerRef,
    pendingLiveTextRef, liveTextTargetSessionRef, setLiveSubagentText, setLiveToolActivities,
  }))

  const backgroundComposerTasks = useStableEvent(async () => {
    const target = composerTargetSession
    if (!target || target.provider !== 'claude' || target.isPending || backgroundingTasks) return
    setBackgroundingTasks(true)
    try {
      const result = await runTuiSessionAction(target, { action: 'backgroundTasks', provider: 'claude' })
      const backgrounded = result.backgrounded === true
      showNotice('info', backgrounded ? 'Claude task moved to background' : 'No foreground Claude task to background', 3500)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to background Claude task')
    } finally {
      setBackgroundingTasks(false)
    }
  })

  // Cancel a running Claude SDK background task via query.stopTask(). Routed at
  // the live warm pool entry (a fresh control query wouldn't know the task), so
  // it only works while the session is warm — the backend reports stopped:false
  // otherwise.
  const stopComposerTask = useStableEvent(async (taskId: string) => {
    const target = composerTargetSession
    if (!target || target.provider !== 'claude' || target.isPending) return
    try {
      const result = await runTuiSessionAction(target, { action: 'stopTask', taskId, provider: 'claude' })
      const stopped = result.stopped === true
      showNotice(stopped ? 'info' : 'error', stopped ? `Stopped task #${taskId}` : 'No running task to stop (session not warm)', 3500)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to stop task')
    }
  })

  const respondToTuiPermission = useStableEvent(async (permission: PendingPermission, response: PermissionResponse, permissionMode?: TuiPermissionMode) => runRespondToTuiPermission({
    setAsyncQuestionPrompt, composerTargetSession, permissionActionLoading,
    setPermissionActionLoading, setLiveTranscriptMessages, setPendingPermissions,
    setPermissionOptionIndex, showNotice,
  }, permission, response, permissionMode))

  // Respond to an ExitPlanMode plan-approval. Approving allows the tool (the SDK
  // exits plan mode for this turn) and switches the composer + warm query to the
  // chosen mode so subsequent turns aren't back in plan mode. Reject keeps planning.
  const respondToTuiPlan = useStableEvent(async (permission: PendingPermission, decision: 'acceptEdits' | 'default' | 'reject') => {
    if (decision === 'reject') {
      await respondToTuiPermission(permission, 'reject')
      return
    }
    const target = composerTargetSession
    if (target) setClaudeComposerPermissionMode(target, decision)
    // The mode rides the approval itself (see claudePermissionDecision), or
    // the CLI's exit from plan mode restores the old mode over it.
    await respondToTuiPermission(permission, 'once', decision)
  })

  // Toggle an AskUserQuestion option for the focused question. Single-select
  // replaces; multi-select adds/removes.
  const toggleTuiQuestionOption = useStableEvent((qi: number, multiSelect: boolean, label: string) => {
    if (!multiSelect) {
      setQuestionFreeformAnswers((prev) => prev[qi] ? { ...prev, [qi]: '' } : prev)
    }
    setQuestionSelections((prev) => {
      const current = prev[qi] ?? []
      const next = multiSelect
        ? (current.includes(label) ? current.filter((l) => l !== label) : [...current, label])
        : [label]
      return { ...prev, [qi]: next }
    })
  })

  // Submit the AskUserQuestion answers back into the running turn (allows the
  // tool with the user's selections merged into its input).
  const submitTuiQuestion = useStableEvent(async (permission: PendingPermission) => runSubmitTuiQuestion({
    composerTargetSession, permissionActionLoading, questionSelections, questionFreeformAnswers,
    setQuestionFocusIndex, setQuestionOptionIndex, setAsyncQuestionPrompt, showNotice,
    composerTextareaRef, composerDraft, setComposerDraft, setComposerActive, setFocusedPane,
    setPermissionActionLoading, setLiveTranscriptMessages, setPendingPermissions,
    setQuestionSelections, setQuestionFreeformAnswers, setQuestionFreeformEditing,
  }, permission))

  // Desktop-notify that a background turn is blocked on a prompt the user
  // can't see (mirrors the slow-send OSC notification; BMP-sanitized).
  const notifyAttention = useStableEvent((title: string, sessionId: string, sessionProvider: AgentProvider) => {
    const key = sessionKey({ sessionId, provider: sessionProvider })
    const session = sessionsByKeyRef.current.get(key)
    const sessionTitle = session ? formatSessionTitle(session) : sessionId.slice(-8)
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
      try {
        renderer.triggerNotification(
          toBmpSafe(title),
          toBmpSafe(`agent-viewer · needs input · ${sessionTitle}`),
        )
      } catch {
        // terminal doesn't support OSC notifications — silently ignore
      }
    }
  })

  // A turn finished on a session the user wasn't viewing — record it in the
  // attention inbox (one entry per session, newest first) and notify.
  const recordAttentionTurnDone = useStableEvent((ref: RunningSessionRef) => {
    const key = sessionKey({ sessionId: ref.sessionId, provider: ref.provider })
    const session = sessionsByKeyRef.current.get(key)
    const title = session ? formatSessionTitle(session) : ref.sessionId.slice(-8)
    setAttentionDone((prev) => [
      { key: `done:${key}:${Date.now()}`, sessionId: ref.sessionId, provider: ref.provider, sessionKey: key, title, createdAt: Date.now() },
      ...prev.filter((item) => item.sessionKey !== key),
    ].slice(0, ATTENTION_DONE_LIMIT))
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
      try {
        renderer.triggerNotification(
          toBmpSafe('Turn finished'),
          toBmpSafe(`agent-viewer · ${title}`),
        )
      } catch {
        // terminal doesn't support OSC notifications — silently ignore
      }
    }
  })

  // Answer a plain tool permission straight from the inbox. Questions and plan
  // approvals need their full pickers — those route through openAttentionSession.
  const respondToAttentionItem = useStableEvent(async (item: AttentionItem, response: PermissionResponse) => runRespondToAttentionItem({
    attentionRespondingId, setAttentionRespondingId, setPendingPermissions, setBackgroundPrompts,
    showNotice,
  }, item, response))

  const openAttentionSession = useStableEvent((item: AttentionItem) => {
    setAttentionOpen(false)
    if (item.kind === 'turn-done') {
      setAttentionDone((prev) => keepFiltered(prev, (done) => done.key !== item.key))
    }
    if (item.kind === 'viewer-note' && item.attentionId) {
      setViewerAttentionNotes((prev) => keepFiltered(prev, (note) => note.id !== item.attentionId))
      void dismissTuiViewerAttention(item.attentionId)
    }
    if (!item.sessionId) return
    if (item.sessionKey === selectedSessionKeyRef.current) {
      setFocusedPane('messages')
      return
    }
    const session = sessionsByKeyRef.current.get(item.sessionKey)
      ?? ({ sessionId: item.sessionId, provider: item.provider } as Session)
    selectTabSession(session)
    setFocusedPane('messages')
  })

  const dismissAttentionItem = useStableEvent((item: AttentionItem) => {
    if (item.kind === 'turn-done') {
      setAttentionDone((prev) => keepFiltered(prev, (done) => done.key !== item.key))
    } else if (item.kind === 'viewer-note' && item.attentionId) {
      setViewerAttentionNotes((prev) => keepFiltered(prev, (note) => note.id !== item.attentionId))
      void dismissTuiViewerAttention(item.attentionId)
    }
  })

  // ⌃N: jump straight to whatever needs a human next — prefer prompts over
  // completions, and another session over the one already on screen.
  const jumpToNextAttention = useStableEvent(() => {
    const needing = attentionItems.filter(attentionItemNeedsInput)
    const pool = needing.length > 0 ? needing : attentionItems
    if (pool.length === 0) {
      showNotice('info', 'Nothing needs attention', 2500)
      return
    }
    const target = pool.find((item) => item.sessionKey !== selectedSessionKeyRef.current) ?? pool[0]!
    openAttentionSession(target)
  })

  const reuseLastPrompt = useStableEvent(() => runReuseLastPrompt({
    sessionDetail, setComposerActive, composerTextareaRef, setComposerDraft,
  }))

  // Digits 1-9 jump straight to a fleet cell on the visible page.
  const jumpToFleetEntry = useStableEvent((index: number) => {
    const entry = visibleFleetEntries[index]
    if (!entry || entry.key === selectedSessionKeyRef.current) return
    const session = sessionsByKeyRef.current.get(entry.key)
      ?? ({ sessionId: entry.sessionId, provider: entry.provider } as Session)
    selectTabSession(session)
    setFocusedPane('messages')
  })

  // Resolve whether the selected session lives in an agent worktree — drives
  // the composer badge and the merge/discard affordances.
  const selectedSessionCwdForWorktree = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? null
  useEffect(() => runWorktreeTaskSelectionEffect({
    selectedSessionCwdForWorktree, setSelectedWorktreeTask, selectedWorktreeTaskCacheRef,
  }), [selectedSessionCwdForWorktree])

  // Name → isolated worktree + branch + fresh session cwd'd into it, composer
  // focused for the first prompt. The task then runs without touching the main
  // checkout until the user merges it back.
  const submitWorktreeTask = useStableEvent(async () => runSubmitWorktreeTask({
    worktreeDraft, worktreeSubmitInFlightRef, selectedSession, sessionDetail, setWorktreeBusy,
    provider, setOpenTabSessions, setSelectedSessionKey, setComposerPaneTargetKey,
    setComposerPreferredTargetKey, prepareCreatedSessionForComposer, setWorktreeModalOpen,
    setWorktreeDraft, setComposerActive, showNotice,
  }))

  // Adopt the task's work: commit whatever the agent left uncommitted, then
  // squash-merge into the main checkout, leaving the result STAGED for review.
  const mergeSelectedWorktreeTask = useStableEvent(async () => {
    const task = selectedWorktreeTask
    if (!task || worktreeBusy) return
    setWorktreeBusy(true)
    try {
      const result = await mergeTuiWorktreeTask(task)
      showNotice(
        'info',
        result.staged
          ? `Merged ${task.branch} — changes are staged in the main checkout`
          : `${task.branch} has no changes to merge`,
        5000,
      )
      const refreshedTask = await findTuiWorktreeTask(task.path).catch(() => null)
      selectedWorktreeTaskCacheRef.current.set(task.path, refreshedTask)
      setSelectedWorktreeTask(refreshedTask)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Merge failed — resolve in the main checkout')
    } finally {
      setWorktreeBusy(false)
    }
  })

  const discardSelectedWorktreeTask = useStableEvent(async () => {
    const task = selectedWorktreeTask
    if (!task || worktreeBusy) return
    setWorktreeBusy(true)
    try {
      await removeTuiWorktreeTask(task, { force: true })
      selectedWorktreeTaskCacheRef.current.set(task.path, null)
      setSelectedWorktreeTask(null)
      showNotice('info', `Discarded worktree and branch ${task.branch}`, 5000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to remove worktree')
    } finally {
      setWorktreeBusy(false)
    }
  })

  // The control center loads and polls its own data; a command opens it on the latest run.
  const openCoordinationBoard = useStableEvent(() => runPluginCommandId('coord-board'))

  const openSelectedTranscriptInPager = useStableEvent(() => {
    const persisted = sessionDetail?.threadedMessages ?? []
    if (!selectedSession || persisted.length + liveTranscriptMessagesForSession.length === 0) {
      showNotice('info', 'Open a conversation to page its transcript', 3500)
      return
    }
    const seen = new Set(persisted.map((m) => m.uuid))
    const messages = [...persisted, ...liveTranscriptMessagesForSession.filter((m) => !seen.has(m.uuid))]
    void openTranscriptInPager(renderer, formatTranscriptExpandedText(messages)).then((result) => {
      if (!result.ok) showNotice('error', `Could not open ${result.command}: ${result.error}`, 5000)
    }, (err) => {
      showNotice('error', `Could not hand the terminal to the pager: ${err instanceof Error ? err.message : String(err)}`, 5000)
    })
  })

  const openTeammatesPanel = useStableEvent(() => runOpenTeammatesPanel({
    showNotice, selectedSession,
  }))

  const selectCoordPlaybook = useStableEvent((name: string | null, available = coordPlaybooks) => {
    setCoordPlaybookName(name)
    setCoordPlaybookArgsDraft('')
    if (!name) return
    const selected = available.find((entry) => entry.name === name)
    if (!selected) return
    if (selected.maxAgents) setCoordMaxAgents(Math.min(6, Math.max(2, selected.maxAgents)))
    if (selected.gateCommand !== undefined) setCoordGateDraft(selected.gateCommand)
    if (selected.requirePlanApproval !== undefined) setCoordRequirePlanApproval(selected.requirePlanApproval)
    if (selected.autonomy) setCoordAutonomy(selected.autonomy)
    if (selected.requireReview !== undefined) setCoordRequireReview(selected.requireReview)
    if (selected.budget?.maxTokens !== undefined) setCoordMaxTokens(String(selected.budget.maxTokens))
    if (selected.budget?.maxDurationMinutes !== undefined) setCoordMaxDurationMinutes(String(selected.budget.maxDurationMinutes))
  })

  const loadCoordPlaybooks = useStableEvent(async (cwd: string, preferredName?: string) => {
    try {
      const listing = await listTuiRunPlaybooks(cwd)
      setCoordPlaybooks(listing.playbooks)
      if (preferredName && listing.playbooks.some((entry) => entry.name === preferredName)) {
        selectCoordPlaybook(preferredName, listing.playbooks)
      } else if (coordPlaybookName && !listing.playbooks.some((entry) => entry.name === coordPlaybookName)) {
        selectCoordPlaybook(null, listing.playbooks)
      }
      if (listing.invalid.length > 0) setCoordError(`${listing.invalid.length} invalid playbook file${listing.invalid.length === 1 ? '' : 's'} — open Manage to inspect them`)
    } catch (err) {
      setCoordError(err instanceof Error ? err.message : 'Failed to load playbooks')
    }
  })

  const handleCoordPlaybooksChanged = useStableEvent((playbooks: PlaybookSummary[], preferredName?: string) => {
    setCoordPlaybooks(playbooks)
    if (preferredName && playbooks.some((entry) => entry.name === preferredName)) {
      selectCoordPlaybook(preferredName, playbooks)
    } else if (coordPlaybookName && !playbooks.some((entry) => entry.name === coordPlaybookName)) {
      selectCoordPlaybook(null, playbooks)
    }
  })

  const openNewWorkflowModal = useStableEvent(() => {
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    setCoordDraft(composerDraft.trim() || selectedSession?.firstPrompt || '')
    setCoordAcceptanceDraft('')
    setCoordNonGoalsDraft('')
    setCoordManualQaDraft('')
    setCoordEscalationDraft('')
    setCoordMaxTokens('')
    setCoordMaxDurationMinutes('')
    setCoordError(null)
    setCoordPlaybookName(null)
    setCoordPlaybookArgsDraft('')
    setPlaybookManagerOpen(false)
    setCoordProviderOverride(null)
    setCoordTeammateProviderOverride(null)
    setCoordProviderPoolIndex(0)
    setCoordModalFocus('prompt')
    setCoordModalOpen(true)
    void loadCoordPlaybooks(baseCwd)
  })

  // Turning the selected provider off in the plugin manager moves the list to all providers still on.
  useEffect(() => {
    if (provider !== 'all' && !isProviderEnabled(provider)) void chooseProvider('all')
  }, [provider, disabledPlugins, chooseProvider])

  // A click on the composer's status row acts on the segment under the pointer:
  // model and effort open the model picker, the folder shows its full path, and
  // the branch and change counts open the Git view for the composer's session.
  const [composerStatusHover, setComposerStatusHover] = useState<{ site: 'chat' | 'dock'; index: number } | null>(null)
  const hoverComposerStatus = useStableEvent((site: 'chat' | 'dock', event: { x: number; currentTarget: { x: number } | null }, segments: InlineTextSegment[], width: number) => {
    const index = inlineSegmentIndexAt(segments, width, event.x - (event.currentTarget?.x ?? 0))
    const next = index !== null && segments[index]?.action ? { site, index } : null
    setComposerStatusHover(current => current?.site === next?.site && current?.index === next?.index ? current : next)
  })
  const clickComposerStatus = useStableEvent((event: { button: number; x: number; currentTarget: { x: number } | null; stopPropagation: () => void }, segments: InlineTextSegment[], width: number) => {
    if (event.button !== 0) return
    const action = inlineSegmentActionAt(segments, width, event.x - (event.currentTarget?.x ?? 0))
    if (!action) return
    event.stopPropagation()
    if (action === 'model') void openModelPicker()
    else if (action === 'path') showNotice('info', composerWorkingDirectory ?? 'No working directory', 10_000)
    else runPluginCommandId('git', composerTargetSession)
  })

  const openNewSessionModal = useStableEvent(() => {
    const defaultProvider: AgentProvider = provider === 'all'
      ? (selectedSession?.provider ?? 'claude')
      : provider
    const choices = enabledNewSessionProviders()
    setNewSessionProvider(choices.includes(defaultProvider) ? defaultProvider : (choices[0] ?? 'claude'))
    setNewSessionCwd(selectedSession?.cwd ?? process.cwd())
    setNewSessionBusy(false)
    setFolderPickerForNewSession(false)
    setNewSessionModalOpen(true)
  })

  const cycleNewSessionProvider = useStableEvent((direction: 1 | -1) => {
    setNewSessionProvider((current) => {
      const choices = enabledNewSessionProviders()
      const index = Math.max(0, choices.indexOf(current))
      return choices[(index + direction + choices.length) % choices.length] ?? current
    })
  })

  const openNewSessionFolderPicker = useStableEvent(() => {
    if (!isPluginEnabled('files')) {
      showNotice('info', 'Folder browsing needs Files · turn it on in Plugins')
      return
    }
    setFolderPickerForNewSession(true)
  })

  const handleNewSessionFolderSelected = useStableEvent((path: string) => {
    setNewSessionCwd(path)
    setFolderPickerForNewSession(false)
  })

  const prepareCreatedSessionForComposer = useStableEvent(async (draft: Session) => runPrepareCreatedSessionForComposer({
    composerPreparingTargetKeyRef, setComposerPreparingTargetKey, refreshSessions, provider,
    tuiModelOverride, tuiEffort, refreshSelectedSessionDetail, fetchComposerAffordances,
  }, draft))

  const submitNewSession = useStableEvent(() => {
    if (newSessionBusy) return
    void startFreshSession(newSessionProvider, newSessionCwd.trim() || workspaceCwd)
  })

  const pendingForkSendRef = useRef<{ key: string; text: string } | null>(null)
  const openCreatedSession = useStableEvent(async (draft: Session) => {
    setOpenTabSessions((prev) => prev.some((s) => sessionKey(s) === sessionKey(draft)) ? prev : [...prev, draft])
    setSelectedSessionKey(sessionKey(draft))
    setComposerPaneTargetKey(sessionKey(draft))
    setComposerPreferredTargetKey(sessionKey(draft))
    await prepareCreatedSessionForComposer(draft)
    setComposerActive(true)
  })

  // /rewind: return the conversation to just before an earlier prompt and put
  // that prompt back in the composer, as Claude Code's rewind and Codex's
  // backtrack do. Codex and OpenCode rewind in place; the Claude SDK has no
  // in-place conversation rewind, so Claude continues in a fork taken just
  // before the prompt. Files are left as they are — ⇧U's checkpoints restore code.
  const rewindConversationToPrompt = useStableEvent(async (chosen: RewindCandidate) => runRewindConversationToPrompt({
    composerTargetSession, sessionDetail, composerTextareaRef, setComposerDraft, setComposerActive,
    sessionDetailMtimeRef, loader, refreshSelectedSessionDetail, showNotice, startFreshSession,
    writeWorkspaceDraft, openCreatedSession,
  }, chosen))

  // Rewind the conversation, and with `restoreFiles` the working tree too: the
  // checkpoint taken as that prompt's turn began is the file state to return to.
  const rewindToPrompt = useStableEvent(async (chosen: RewindCandidate, options?: { restoreFiles?: boolean }) => {
    const target = composerTargetSession
    const checkpoints = options?.restoreFiles && target?.cwd
      ? await listTuiCheckpoints(target.cwd).catch(() => [])
      : []
    const checkpoint = target
      ? checkpointForPrompt(checkpoints, { sessionId: target.sessionId, text: chosen.text, timestamp: chosen.timestamp })
      : null
    if (!(await rewindConversationToPrompt(chosen)) || !options?.restoreFiles || !target?.cwd) return
    if (!checkpoint) {
      showNotice('info', 'Rewound the conversation — no checkpoint was taken at that prompt, so files are unchanged', 7000)
      return
    }
    try {
      const result = await restoreTuiCheckpoint(target.cwd, checkpoint.sha, undefined, { sessionId: target.sessionId, provider: target.provider, providerInstanceId: target.providerInstanceId })
      showNotice('info', `Rewound conversation and files — ${result.restored} restored, ${result.deleted} removed`, 7000)
    } catch (err) {
      showNotice('error', `Rewound the conversation, but restoring files failed: ${err instanceof Error ? err.message : String(err)}`, 8000)
    }
  })

  // /fork: continue in a copy of this conversation, leaving the original as it is.
  const forkIntoNewSession = useStableEvent(async (target: Session, sendInFork?: string) => runForkIntoNewSession({
    showNotice, pendingForkSendRef, openCreatedSession,
  }, target, sendInFork))

  // Create a session and open it with the composer focused — the New Session
  // dialog's action, and what /clear and /new do, as in the native CLIs.
  const startFreshSession = useStableEvent(async (targetProvider: AgentProvider, cwd: string) => runStartFreshSession({
    setWorkspaceHasSession, setWorkspaceLaunched, newSessionBusy, setNewSessionBusy,
    selectedSession, provider, providerInstances, providerInstanceId, openCreatedSession,
    setNewSessionModalOpen, showNotice, setError,
  }, targetProvider, cwd))

  // /handoff <provider>: continue this conversation on another provider. A new
  // session opens in the same folder with the handoff — the brief plus the recent
  // exchange — as its draft, so the user reads it (and edits it) before it is sent.
  const handoffToProvider = useStableEvent(async (target: Session, providerName: string) => runHandoffToProvider({
    showNotice, newSessionBusy, sessionDetail, setNewSessionBusy, writeWorkspaceDraft,
    openCreatedSession,
  }, target, providerName))

  // CLI built-ins that are TUI views rather than agent requests. The Claude SDK
  // answers these "isn't available in this environment" (or, for /todos, not at
  // all — it went to the model as prompt text); the native CLIs show them.
  const runTuiLocalCommand = useStableEvent((target: Session, text: string) => runRunTuiLocalCommand({
    startFreshSession, setCodexCollaborationMode, sendComposerMessage, showNotice,
    setComposerActive, executeCommandPalette, editComposerInExternalEditor, sessionDetailMtimeRef,
    loader, refreshSelectedSessionDetail, forkIntoNewSession, composerSendState,
    reattachedRunningRef, sessionDetail, setComposerRewindIndex, setComposerRewindItems,
    handoffToProvider, composerTextareaRef, setComposerDraft, runPluginCommandId, openDiagnostics,
    setFocusedPane, setSessionSearchMode, setExitConfirmOpen, renderer, openModelPicker,
    switchComposerModel, composerCurrentModel, contextUsage, composerPermissionMode,
    tuiAddedDirsByKeyRef, setTuiAddedDirsByKey, composerLiveSlashCommands, setLocalCommandOutputs,
    openEditorAt,
  }, target, text))

  const copyCoordinationJoinCommand = useStableEvent((runId: string) => {
    const attachUrl = process.env.AGENT_VIEWER_ATTACH?.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3000'
    const command = `agent-viewer coord worker --join ${runId} --name <name> --provider codex --attach ${attachUrl}`
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.osc52 !== false) {
      renderer.copyToClipboardOSC52(command)
      showNotice('info', 'External CLI join command copied', 4000)
    } else {
      showNotice('info', command, 8000)
    }
  })

  // Jump from an Agent Operations row straight into that agent's transcript.
  // External MCP participants carry a synthetic `external:` session id with no
  // transcript behind it — refuse those with an honest notice instead of
  // letting the reader fall back to an unrelated session. Sessions the
  // sidebar has not indexed yet (other provider, or not materialised) are
  // pinned as open tabs BEFORE selecting, so resolveSelectedSession can never
  // fall through to sessions[0] and open the wrong agent's transcript.
  const openCoordinationAgentSession = useStableEvent((agent: ProtocolAgent) => {
    const target = resolveCoordinationTranscriptTarget(agent, sessionsByKeyRef.current, Date.now())
    if (target.kind === 'unreadable') {
      showNotice('info', target.reason, 5000)
      return
    }
    if (!target.indexed) {
      setOpenTabSessions((prev) => prev.some((tab) => sessionKey(tab) === target.sessionKey)
        ? prev
        : [...prev, target.session])
    }
    if (windowTargets.some(entry => entry.key === target.sessionKey)) pickWindowTarget(target.sessionKey)
    else { selectTabSession(target.session); setFocusedPane('messages') }
  })

  const watchCoordinatorRun = useStableEvent((snapshot: ProtocolRunSnapshot) => runWatchCoordinatorRun({
    sessionsByKeyRef, showNotice, checkpointWindowLayout, watchedRosterRef,
    setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, setOpenTabSessions, selectTabSession,
    setSplitPinnedKeys, setSplitPaneCount, setWindowOrder, setWindowSplitTree, setWindowSurfaces,
    setWindowZoom, setWindowSurfacePeek, setFullscreenMode, setSplitFocusIndex, setFocusedPane,
  }, snapshot))

  // Herdr's everyday view: the lead's chat in the reader and teammates live
  // beside it. Each watched teammate becomes an open tab pinned to a split
  // pane, first in the order given (the panel passes attention order), so the
  // teammate that needs the user is the one that gets a pane when there are
  // more teammates than panes.
  const watchCoordinationAgentSessions = useStableEvent((agents: ProtocolAgent[]) => runWatchCoordinationAgentSessions({
    sessionsByKeyRef, selectedSessionKey, splitPinnedKeys, splitPaneCount, showNotice,
    setOpenTabSessions, setSplitPinnedKeys, setSplitPaneCount, setError, splitOrientation,
    mainContentHeight, readerAreaWidth, splitReaderShare,
  }, agents))

  const handleCoordContentChange = useStableEvent(() => {
    setCoordDraft(coordTextareaRef.current?.plainText ?? '')
    if (coordError) setCoordError(null)
  })

  const submitCoordinatedRun = useStableEvent(async () => runSubmitCoordinatedRun({
    coordTextareaRef, coordDraft, coordPlaybookName, coordPlaybooks, coordPlaybookArgsDraft,
    coordStartInFlightRef, setCoordBusy, setCoordError, provider, selectedSession,
    coordProviderOverride, coordTeammateProviderOverride, sessionDetail, coordMaxAgents,
    tuiModelOverride, selectedSessionKey, tuiEffort, coordGateDraft, coordRequirePlanApproval,
    coordAutonomy, coordRequireReview, coordAcceptanceDraft, coordNonGoalsDraft,
    coordManualQaDraft, coordEscalationDraft, coordMaxTokens, coordMaxDurationMinutes,
    coordUseWorktrees, setOpenTabSessions, setSelectedSessionKey, setCoordModalOpen,
    setCoordBoardRunId, setPluginOverlay, showNotice, setCoordDraft, setCoordAcceptanceDraft,
    setCoordNonGoalsDraft, setCoordManualQaDraft, setCoordEscalationDraft, setCoordPlaybookName,
    setCoordPlaybookArgsDraft, setCoordGateDraft, setCoordMaxTokens, setCoordMaxDurationMinutes,
    setCoordProviderOverride, setCoordTeammateProviderOverride, setCoordProviderPoolIndex,
    setCoordModalFocus, coordWatchStateRef, setCoordWatchIds, refreshSessions,
  }))

  // Desktop-notify a team event (run finished, teammate blocked) — the whole
  // point of a team is walking away while it works.
  const notifyTeamEvent = useStableEvent((title: string, body: string) => {
    if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
      try {
        renderer.triggerNotification(toBmpSafe(body), toBmpSafe(`agent-viewer · ${title}`))
      } catch {
        // terminal doesn't support OSC notifications — silently ignore
      }
    }
  })

  // Interactive teammates notify on transitions, not on what a read already
  // held (the store baselines each conversation's first read). Herdr's rule for
  // quiet: the user is looking at that team AND the terminal is not known to be
  // blurred — focus is unknown until the terminal reports it, which counts as
  // focused so a terminal without focus reporting is not spammed.
  const terminalFocusedRef = useRef<boolean | null>(null)
  useEffect(() => runRendererListenersEffect({
    terminalFocusedRef, renderer, showNotice, notifyTeamEvent,
  }), [renderer])

  // Watch active runs started this session: notify on terminal status and on
  // newly blocked teammates, then drop finished runs from the watch list.
  useEffect(() => runCoordWatchEffect({
    coordWatchIds, coordWatchStateRef, setCoordWatchIds, showNotice, notifyTeamEvent,
  }), [coordWatchIds])

  // Palette actions resolve the latest run on demand — the interactive board
  // (CoordinationPopover) has its own run-scoped stop/cleanup keys.
  const stopActiveCoordinatedRun = useStableEvent(async () => {
    if (coordBusy) return
    setCoordBusy(true)
    try {
      const runs = await listTuiProtocolRuns(1)
      const runId = runs[0]?.id
      if (!runId) {
        showNotice('info', 'No coordinated run to stop', 3000)
        return
      }
      await stopTuiProtocolRun(runId)
      showNotice('info', 'Stopped coordinated run', 4000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to stop coordinated run')
    } finally {
      setCoordBusy(false)
    }
  })

  const cleanupCompletedCoordinatedRunWorktrees = useStableEvent(async () => {
    if (coordBusy) return
    setCoordBusy(true)
    try {
      const runs = await listTuiProtocolRuns(1)
      const runId = runs[0]?.id
      if (!runId) {
        showNotice('info', 'No coordinated run to clean up', 3000)
        return
      }
      const result = await cleanupTuiProtocolRunWorktrees(runId)
      const removed = result.results.filter((entry) => entry.status === 'removed').length
      const skipped = result.results.filter((entry) => entry.status === 'skipped').length
      const failed = result.results.filter((entry) => entry.status === 'failed').length
      showNotice('info', `Cleaned ${removed} worktree${removed === 1 ? '' : 's'}${skipped || failed ? ` · skipped ${skipped} · failed ${failed}` : ''}`, 5000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to clean up worktrees')
    } finally {
      setCoordBusy(false)
    }
  })

  // Reset picker state whenever the active question prompt changes.
  useEffect(() => {
    const active = pendingPermissions[0]
    const qid = active?.questions && active.questions.length > 0 ? active.id : null
    if (questionPermissionIdRef.current !== qid) {
      questionPermissionIdRef.current = qid
      const initial = initialQuestionState(active?.questions ?? [])
      setQuestionSelections(initial.selections)
      setQuestionFreeformAnswers(initial.freeformAnswers)
      setQuestionFreeformEditing(false)
      setQuestionFocusIndex(0)
      setQuestionOptionIndex(0)
    }
  }, [pendingPermissions])

  // Keep the ref in sync on every render so commitRename always reads the latest draft,
  // regardless of which version of the callback is held by onSubmit or the keyboard handler.
  useLayoutEffect(() => {
    renameDraftRef.current = renameDraft
  }, [renameDraft])

  const commitRename = useStableEvent(async () => runCommitRename({
    renameSessionKey, selectedSession, renameDraftRef, setRenameSessionKey, setRenameDraft,
    setSessions, setOpenTabSessions, setSessionDetail, sessionDetailCacheRef, refreshSessions,
    provider,
  }))

  // Build the sidebar row elements once per relevant-state change instead of
  // on every App render. The per-row formatting (fitText/timeAgo/joinMeta/
  // formatSessionTitle/getProviderAccent) is O(sessions) and previously re-ran
  // on every 2s poll, keystroke, and live-stream RAF flush; a stable element
  // array also lets OpenTUI's reconciler bail on the whole subtree when nothing
  // here changed. `timeAgo` output refreshes whenever sidebarEntries does (the
  // 5s sessions poll produces a new array), which is frequent enough.
  const firstSidebarEntryKey = sidebarEntries[0]?.key ?? null
  const buildSidebarRow = useCallback((entry: typeof sidebarEntries[number], selected: boolean) => runBuildSidebarRow({
    sidebarEntries, sidebarInnerWidth, firstSidebarEntryKey, theme, sidebarSessionActivity,
    showProviderInSessionRows, selectSidebarSession, setSidebarSubagentCursor,
    setSubagentTranscriptSelection, setPluginOverlay, recentlyWrittenKeys, teamAttention, density,
    renameSessionKey, childrenByParentId, splitPaneActions, sessionDragHandlers, renameDraft,
    setRenameDraft, commitRename, toggleSidebarSubagents, collapsedSubagentSet,
  }, entry, selected), [collapsedSubagentSet, childrenByParentId, toggleSidebarSubagents, theme, density, sidebarInnerWidth, firstSidebarEntryKey, renameSessionKey, renameDraft, commitRename, selectSidebarSession, showProviderInSessionRows, sidebarSessionActivity, recentlyWrittenKeys, teamAttention, sessionDragHandlers, splitPaneActions])


  // Per-row element cache. Moving the selection highlight only changes TWO rows
  // (the de-selected and newly-selected), but the memo re-runs on every
  // selectedIndex change. Rebuilding all N rows — each doing getProviderAccent /
  // timeAgo / fitText / formatSessionTitle — was O(sessions) per scrub step;
  // fast scrubbing through a large list backed the render queue up and got
  // progressively slower. Reuse the cached element for any row whose inputs are
  // unchanged so only the two flipped rows actually rebuild.
  const sidebarRowCacheRef = useRef<ReturnType<typeof createSidebarRowElements<SidebarEntry, React.ReactNode>> | null>(null)
  if (!sidebarRowCacheRef.current) sidebarRowCacheRef.current = createSidebarRowElements(sidebarEntrySessionKey)
  const sidebarRowElements = useMemo(() => {
    const selectedSession = selectedIndex >= 0 ? sessions[selectedIndex] : null
    return sidebarRowCacheRef.current!(sidebarEntries, sidebarSubagentCursor ?? (selectedSession ? sessionKey(selectedSession) : null), buildSidebarRow)
  }, [sidebarEntries, selectedIndex, sessions, sidebarSubagentCursor, buildSidebarRow])


  // Stable scrollbar config objects so the two long-lived <scrollbox>
  // renderables don't see a fresh prop reference on every render.
  const sidebarScrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface } }),
    [theme.muted, theme.surface],
  )
  const transcriptScrollbarOptions = useMemo(
    () => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }),
    [theme.muted, theme.surface2],
  )
  const flushLiveText = useCallback(() => {
    liveTextFlushTimerRef.current = null
    const text = pendingLiveTextRef.current
    const session = liveTextTargetSessionRef.current
    if (!session) return
    setComposerLiveText(text)
    setComposerLiveReasoning(pendingLiveReasoningRef.current)
  }, [liveTextFlushTimerRef, pendingLiveTextRef, liveTextTargetSessionRef, pendingLiveReasoningRef, setComposerLiveText, setComposerLiveReasoning])

  const composerViewActions = { setComposerDraft, setComposerMentionAttachments, setComposerPromptParts, setComposerMention, setComposerMentionResults, setComposerMentionDismissedStart, setComposerSlashIndex, setComposerSlashDismissed, setComposerHistoryIndex, setComposerHistoryOpen, setDraftBeforeHistory, setFollowTail, setPendingNewCount, setUnreadBoundaryKey, setHistoryIndex, setPermissionOptionIndex, setContextUsage, setSessionDetail, setTuiCopilotMode }
  const composerViewRefs = { textarea: composerTextareaRef, storage: composerDraftStorageKeyRef, attachments: composerMentionAttachmentsRef, parts: composerPromptPartsRef }
  const sendComposerMessage = useStableEvent(async (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) => runSendComposerMessage({
    composerTargetSessionRef, composerTargetSession, composerSessions, composerViewActions,
    composerViewRefs, showNotice, composerDraft, prepareComposerSubmission,
    composerMentionAttachments, composerPromptParts, composerPaneTargetKey,
    composerPreparingTargetKeyRef, composerSendState, reattachedRunningRef,
    commitQueuedComposerSends, queuedComposerSendsRef, sendComposerMessage, runTuiLocalCommand,
    canUseChannelBridge, selectedSessionTarget, routeComposerToBridgeRef, lastBridgeChatIdRef,
    setBridgeTranscriptEntries, canUseIdeBridge, routeComposerToIdeRef, composerAbortRef,
    composerRetryTimerRef, activeComposerTurnRequestIdRef, setSteeredSendNotice,
    steeredEchoCounterRef, steeredComposerSendsRef, setLiveTranscriptMessages,
    composerRetryCountRef, composerTurnProducedOutputRef, writeWorkspaceDraft,
    activeComposerSendCleanupRef, setComposerSendState, setComposerSendStartedAt,
    setComposerWaitingSeed, setComposerError, flushLiveText, pendingLiveTextRef,
    pendingLiveReasoningRef, liveTextTargetSessionRef, liveTextFlushTimerRef, setComposerLiveText,
    setComposerLiveReasoning, setComposerThinkingTokens, setLivePromptSuggestion, setLiveStatus,
    setLiveSubagentText, setLiveOutputTokens, setLiveToolActivities, setPendingPermissions,
    markSessionRunning, ownedTurnKeyRef, setComposerActivitySessionKey, selectedSessionKeyRef,
    sessionDetail, sessionDetailCacheRef, liveTranscriptBaselineRef, liveToolIndexesRef,
    liveToolInputJsonRef, setLocalCommandOutputs, tuiModelOverride, taskBudgetTokens,
    composerEnableWorkflow, tuiOpenCodeAgent, tuiEffort, tuiCopilotMode,
    composerCopilotContextTier, composerPermissionMode, composerCopilotPermissionMode,
    tuiAddedDirsByKeyRef, tuiCodexModeByKeyRef, composerCodexApproval, sessionContextUsageCacheRef,
    tuiPermissionModeByKeyRef, setTuiPermissionModeByKey, setOpenTabSessions, setSessions,
    setComposerPaneTargetKey, setSelectedSessionKey, setComposerLiveTodos, openModelPicker,
    setTuiModelOverride, openCreatedSession, setComposerLiveSlashCommands, reattachedRunningKeyRef,
    setReattachedRunning, setSentHistory, setInterruptPressActive, interruptPressTimeoutRef,
    setAwaitingPersistedTurn, refreshSessions, provider, refreshSelectedSessionDetail, renderer,
    composerInterruptPendingRef, readWorkspaceDraft, writeWorkspaceDraftParts,
    readWorkspaceDraftParts, restoreComposerPromptPartExtmarks, clearSessionRunning,
    exitInProgressRef,
  }, draftOverride, attachmentsOverride, isRetry, promptPartsOverride, retryTurnRequestId))

  // Flush queued prompt once the active turn lands (CLI-style queueing).
  // Gate on === 'idle' (not !== 'sending'): the prior turn can settle into
  // 'error', and auto-firing a queued follow-up after a failed turn is a
  // surprise-send. On error we clear the queue (see the error branch above),
  // so the only state that reaches here with a queued send is a clean idle.
  useEffect(() => runQueuedSendDrainEffect({
    activeQueuedComposerSends, runningRegistryReady, composerSendState, composerAbortRef,
    composerRetryTimerRef, reattachedRunning, composerTargetTurnKnownRunning,
    queuedComposerSendsRef, commitQueuedComposerSends, sendComposerMessage,
  }), [activeQueuedComposerSends, composerSendState, composerTargetTurnKnownRunning, reattachedRunning, runningRegistryReady, sendComposerMessage])

  // Reattach to turns this composer doesn't own a stream for. In-process the
  // running registry is a cheap synchronous read; remotely attached it's the
  // daemon's /api/sessions/running (same shape). Reconcile sidebar running
  // marks for every live session, flag the selected session as reattached
  // when its turn runs unowned, and re-surface any pending Claude prompts the
  // turn is blocked on (the stream that delivered them is gone after a stream
  // death; answering still resolves them server-side by id).
  const registryPollInFlightRef = useRef(false)
  const runningRegistryByKeyRef = useRef(new Map<string, RunningRegistryEntry>())
  const reconcileSelectedRunningRegistry = useCallback((runningByKey: Map<string, RunningRegistryEntry>, ownedKey: string | null) => runReconcileSelectedRunningRegistry({
    selectedSessionKeyRef, ownsComposerStream, awaitingPersistedTurnRef, reattachedRunningKeyRef,
    setReattachedRunning, setPendingPermissions, sessionsByKeyRef,
  }, runningByKey, ownedKey), [])
  useEffect(() => runRunningRegistryEffect({
    registryPollInFlightRef, setRunningRegistryReady, setWaitingSessions, setViewerAttentionNotes,
    runningRegistryByKeyRef, composerAbortRef, ownedTurnKeyRef, ownsComposerStream,
    reattachMarksRef, markSessionRunning, clearSessionRunning, selectedSessionKeyRef,
    recordAttentionTurnDone, setBackgroundPrompts, attentionNotifiedRef, notifyAttention,
    reconcileSelectedRunningRegistry,
  }), [markSessionRunning, clearSessionRunning, reconcileSelectedRunningRegistry])

  useEffect(() => {
    reconcileSelectedRunningRegistry(
      runningRegistryByKeyRef.current,
      composerAbortRef.current ? ownedTurnKeyRef.current : null,
    )
  }, [reconcileSelectedRunningRegistry, selectedSessionKey])

  // Pull the most-recently queued message back into the composer to edit it
  // (cancels that one send). Any current draft is preserved by prepending it,
  // mirroring the interrupt-restore ordering. Attachments restore too.
  const popNewestQueuedComposerSend = useStableEvent(() => {
    const targetKey = composerTargetSessionIdentity
    const queue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
    if (queue.length === 0) return
    const item = queue[queue.length - 1]!
    commitQueuedComposerSends(removeComposerQueueItem(queuedComposerSendsRef.current, item.id))
    const currentDraft = (composerTextareaRef.current?.plainText ?? composerDraft).trim()
    const restored = [currentDraft, item.text].filter(Boolean).join('\n\n')
    const restoredAttachments = mergeComposerAttachments(composerMentionAttachmentsRef.current, item.attachments)
    const restoredParts = [...item.promptParts, ...composerPromptPartsRef.current]
    composerTextareaRef.current?.setText(restored)
    setComposerDraft(restored)
    composerMentionAttachmentsRef.current = restoredAttachments
    composerPromptPartsRef.current = restoredParts
    setComposerMentionAttachments(restoredAttachments)
    setComposerPromptParts(restoredParts)
    restoreComposerPromptPartExtmarks(restoredParts, restored)
    setComposerActive(true)
  })

  // Cancel every queued message at once without firing any of them.
  const clearQueuedComposerSends = useStableEvent(() => {
    const targetKey = composerTargetSessionIdentity
    if (!targetKey || !queuedComposerSendsRef.current.some((entry) => entry.targetKey === targetKey)) return
    commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
  })

  useEffect(() => runThemeFollowEffect({
    showNotice, themeSlotsRef, themeFollowsTerminalRef, setThemeFollowsTerminal, renderer,
    setThemeMode, workspaceContext, provider, providerInstanceId, providerInstanceIdRef,
    setProviderInstanceId, setProviderInstances, setProvider, setRailVisible, setFocusMode,
    setStickyHeaders, setLightweightWindows, setDensity, setDiffLayout, setTranscriptView,
    setTranscriptWidth, setTabsEnabled, setTabOrientation, setSidebarSort, setHideScratch,
    setSidebarWidthPreference, setShowToolCalls, setVelocityScrollEnabled, setSplitPaneCount,
    setSplitOrientation, setSplitReaderShare, setFocusedPane, refreshSessions, setError,
    setLoadingSessions, setBootstrapped,
  }), [refreshSessions])

  useEffect(() => runSessionDetailLoadEffect({
    bootstrapped, selectedSessionTarget, selectedSession, setSessionDetail, setLoadingDetail,
    setError, navSelectStartRef, sessionsByKeyRef, loader, densityRef, showToolCallsRef,
    sessionDetailMtimeRef, sessionDetailCacheRef, awaitingPersistedTurnRef,
    liveTranscriptBaselineRef, refreshSelectedSessionDetail,
  }), [bootstrapped, loader, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

  // Close the nav-latency sample: this effect runs after the commit that put the
  // newly-selected session's transcript on screen, so it measures what the user
  // feels — keypress to new transcript visible.
  useEffect(() => {
    const pending = navSelectStartRef.current
    if (!pending || pending.key !== committedSessionKey) return
    if (navPaintedKeyRef.current === committedSessionKey) return
    navPaintedKeyRef.current = committedSessionKey
    navSelectStartRef.current = null
    const now = performance.now()
    const detailSet = navDetailSetAtRef.current
    if (detailSet?.key === committedSessionKey) noteTuiNavLatency('detail-to-paint', now - detailSet.at)
    noteTuiNavLatency('select-to-paint', now - pending.at)
  }, [committedSessionKey, sessionDetail])

  // Neighbour prefetch: once a session settles (committedSessionKey catches up
  // to the selection), warm the threading worker for the sessions around it in
  // sidebar order — nearest first, alternating below/above — so scrubbing one
  // step in either direction reads from warm worker caches instead of paying
  // the first-visit read, threading and formatting in full. Keyed on the
  // SETTLED key so it never fires mid-scrub, and
  // each step re-checks that no real open is (or is about to be) running —
  // the threading worker is serial, so a prefetch posted ahead of a real open
  // would delay it.
  useEffect(() => runOverlaySettleEffect({
    bootstrapped, committedSessionKey, sidebarSessionEntriesRef, foregroundLoadInFlightRef,
    pendingForegroundLoadRef, selectedSessionKeyRef, prefetchSessionDetail,
  }), [bootstrapped, committedSessionKey, prefetchSessionDetail])

  // Clear stale live todos on session switch
  useEffect(() => {
    setComposerLiveTodos((current) => current.length === 0 ? current : [])
  }, [selectedSessionIdentity])

  // Drafts follow the effective send target, not merely the primary reader.
  // A pane-targeted composer must never inherit or clear another session's
  // draft just because that session remains selected behind the overlay.
  useEffect(() => runDraftRestoreEffect({
    composerTargetSessionIdentity, composerDraftStorageKeyRef, composerTextareaRef,
    composerDraftRef, writeWorkspaceDraft, writeWorkspaceDraftParts, composerPromptPartsRef,
    setComposerMentionAttachments, readWorkspaceDraft, readWorkspaceDraftParts,
    setComposerPromptParts, setComposerDraft, restoreComposerPromptPartExtmarks,
  }), [composerTargetSessionIdentity])

  useEffect(() => {
    if (!pendingTranscriptDiffPrompt || composerTargetSessionIdentity !== pendingTranscriptDiffPrompt.target) return
    appendDiffCommentPromptToComposer(pendingTranscriptDiffPrompt.prompt)
    setPendingTranscriptDiffPrompt(null)
  }, [pendingTranscriptDiffPrompt, composerTargetSessionIdentity])

  // Persist the placeholder content with the draft whenever it changes.
  useEffect(() => {
    const key = composerDraftStorageKeyRef.current
    if (key) writeWorkspaceDraftParts(key, composerPromptParts)
  }, [composerPromptParts])

  useEffect(() => {
    if (selectedSession || sessions.length === 0) return
    setSelectedSessionKey(sessionKey(sessions[0]))
  }, [selectedSession, sessions])

  useEffect(() => {
    if (!bootstrapped) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || loadingSessions || providerSwitchRef.current) return
      void refreshSessions(provider, true, false)
    }, SESSION_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, loadingSessions, provider, refreshSessions])

  useEffect(() => runDetailRefreshIntervalEffect({
    bootstrapped, selectedSessionTarget, selectedSession, providerSwitchRef, composerActiveRef,
    composerDraftRef, searchModeRef, sessionSearchModeRef, refreshSelectedSessionDetail,
  }), [bootstrapped, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

  useEffect(() => runSessionPollIntervalEffect({
    bootstrapped, tabsEnabled, openTabSessions, providerSwitchRef, selectedSessionKeyRef,
    openTabSessionsRef, backgroundMetadataCursorRef,
  }), [bootstrapped, openTabSessions.length, refreshSessionMetadata, tabsEnabled])


  useEffect(() => runTranscriptCursorEffect({
    committedSessionKey, tabReaderPositionsRef, setTranscriptCursorKey, setExpandedCardKeys,
    setCollapsedCardKeys, setFollowTail, setPendingNewCount, setUnreadBoundaryKey,
    setResumeMarkerKey, setSearchMode, setScrollbackExpanded, setSearchQuery, setSearchMatchIndex,
    setRestoredReaderState, workspaceId,
  }), [committedSessionKey])

  useEffect(() => runExpansionResetEffect({
    transcriptCards, setExpandedCardKeys, setCollapsedCardKeys,
  }), [transcriptCards])

  useEffect(() => runTranscriptScrollSyncEffect({
    transcriptCards, previousTranscriptRef, committedSessionKey, setTranscriptCursorKey,
    setPendingNewCount, setUnreadBoundaryKey, restoredReaderState, transcriptIndexByKey,
    visibleTranscriptCards, setFollowTail, setResumeMarkerKey, setComposerLiveTodos, followTail,
    readCursorIndex,
  }), [
    followTail,
    restoredReaderState,
    committedSessionKey,
    transcriptCards,
    visibleTranscriptCards,
    transcriptIndexByKey,
  ])

  // Load bookmarks for the session whose transcript is actually displayed.
  // Keyed on the committed (debounced) session, not the live selection, so
  // scrubbing doesn't fire a fetch — and a stale resolve doesn't churn
  // bookmarkKeys (a transcriptChildren dep) while an older transcript shows.
  useEffect(() => {
    const target = transcriptSession
    if (!target) { setBookmarkKeys(keepEmpty); return }
    let cancelled = false
    void readTuiSessionBookmarkIds({ sessionId: target.sessionId, provider: target.provider } as Session)
      .then((ids) => { if (!cancelled) setBookmarkKeys((current) => sameKeys(current, ids) ? current : new Set(ids)) })
      .catch(() => { if (!cancelled) setBookmarkKeys(keepEmpty) })
    return () => { cancelled = true }
  }, [committedSessionKey])

  // Land on a bookmark target once its session transcript has loaded. Runs
  // after the cursor-reconcile effect above, so it wins the final cursor state.
  useEffect(() => {
    const pending = pendingBookmarkCursorRef.current
    if (!pending || pending.sessionKey !== selectedSessionKey) return
    const idx = transcriptIndexByKey.get(pending.uuid)
    if (idx === undefined || idx < 0) return
    pendingBookmarkCursorRef.current = null
    setTranscriptCursorKey(visibleTranscriptCards[idx].key)
    setFollowTail(false)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  }, [selectedSessionKey, visibleTranscriptCards, transcriptIndexByKey])


  // Saves the reader position, debounced. Run when its inputs change, and when
  // the cursor moves (the cursor is not root state, so it is subscribed to).
  const persistReaderState = useStableEvent(() => runPersistReaderState({
    readerStateWriteTimeoutRef, selectedSessionKey, restoredReaderState, readTranscriptCursorKey,
    followTail, expandedKeysRevisionRef, collapsedKeysRevisionRef, readerStatePersistSignatureRef,
    transcriptCards, expandedCardKeys, collapsedCardKeys, workspaceId, setError,
  }))
  useEffect(() => { persistReaderState() }, [
    collapsedCardKeys,
    expandedCardKeys,
    followTail,
    restoredReaderState,
    selectedSessionKey,
    transcriptCards,
  ])
  useEffect(() => {
    const unsubscribe = cursorRuntime.subscribe('transcriptCursorKey', persistReaderState)
    return () => {
      unsubscribe()
      if (readerStateWriteTimeoutRef.current) clearTimeout(readerStateWriteTimeoutRef.current)
    }
  }, [cursorRuntime])

  useEffect(() => {
    if (searchMatches.length === 0) {
      setSearchMatchIndex(0)
      return
    }
    setSearchMatchIndex((current) => clamp(current, 0, searchMatches.length - 1))
  }, [searchMatches.length])

  // Promote the currently-previewed session to a real open tab.
  // We use the full `selectedSession` object so tabs retain provider context
  // even when the user later switches to a different provider.
  const promotePreviewToTab = useStableEvent(() => {
    if (!selectedSession) return
    const key = sessionKey(selectedSession)
    setOpenTabSessions((current) => {
      if (current.some((s) => sessionKey(s) === key)) return current
      return [...current, selectedSession]
    })
  })

  // Entering the composer cancels an outgoing reader chord. A fresh Ctrl+B
  // while editing can still open the workspace switcher or window commands.
  useEffect(() => {
    if (!composerActive) return
    if (splitChordPending) setSplitChordPending(false)
    if (commandChordPending) setCommandChordPending(false)
  }, [composerActive])

  // Prefix chords allow time to read the pop-up. A dropped key event (remote
  // shell, terminal multiplexer, focus change) must not leave the next ordinary
  // key trapped as a command indefinitely.
  useEffect(() => {
    if (!splitChordPending && !commandChordPending) return
    const timeout = setTimeout(() => {
      setSplitChordPending(false)
      setCommandChordPending(false)
    }, CHORD_PENDING_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [commandChordPending, splitChordPending])

  // Hesitate on a prefix and its keys appear on their own — the behaviour
  // which-key is named for, and the only part of the help that reaches someone
  // who does not already know `?` exists. It closes with the chord, so pressing
  // the key you were reaching for resolves the chord and takes the panel with
  // it; a self-revealed panel never consumes that key (see the dismiss branch).
  useEffect(() => {
    const pending = splitChordPending ? SPLIT_CHORD_MAP : commandChordPending ? COMMAND_CHORD_MAP : null
    if (!pending) {
      setChordHelp((current) => (current && !current.dismissOnKey ? null : current))
      return
    }
    const timeout = setTimeout(() => {
      // An overlay the user opened deliberately is left alone: it is already
      // showing what they asked for, and replacing it would reset its state.
      setChordHelp((current) => (current ? current : { map: pending, dismissOnKey: false }))
    }, CHORD_HELP_REVEAL_MS)
    return () => clearTimeout(timeout)
  }, [commandChordPending, splitChordPending])

  // Focus can outlive the pane that held it: closing a pane, a narrower
  // terminal, or a closed tab all shrink visibleSplitPaneCount. Opening the
  // composer also hands the keys back — the composer branch runs first, so a
  // pane left "focused" would only be a lie in the frame.
  useEffect(() => {
    if (splitFocusIndex === null) return
    // Leaving full screen hands the keys to the selected session's window.
    if (splitFocusIndex === FULLSCREEN_PANE_INDEX && !fullscreenMode) { focusReaderFromSplit(); return }
    const floatingFocused = splitFocusIndex === FLOATING_PANE_INDEX && floatingKey !== null
    const fullscreenFocused = splitFocusIndex === FULLSCREEN_PANE_INDEX && fullscreenMode
    if (composerActive || (splitFocusIndex >= visibleSplitPaneCount && !floatingFocused && !fullscreenFocused)) setSplitFocusIndex(null)
  }, [composerActive, floatingKey, splitFocusIndex, visibleSplitPaneCount, fullscreenMode])

  // Track the window area's real height. Reads after every commit (cheap
  // property read) and only setStates when it actually changed, so a resize
  // settles in one extra frame and idle renders don't loop.
  // No dependency list, deliberately: the area moves with the dock, the tab bar
  // and the status rows as well as with the terminal. Yoga lays out on the
  // frame after a commit, so the reading taken at commit can itself be one
  // layout behind; the timer picks up the settled value.
  useLayoutEffect(() => {
    const measure = () => {
      const area = (windowAreaRef.current?.height ?? 0) + (windowOverflowRef.current?.height ?? 0)
      if (area > 0) setMeasuredWindowAreaHeight((current) => (current === area ? current : area))
    }
    // Absolute split frames settle on the renderer's next layout pass;
    // measuring them synchronously feeds the previous geometry back into React.
    if (!treeGeometry) measure()
    const timer = setTimeout(measure, 50)
    return () => clearTimeout(timer)
  })


  useEffect(() => runComposerPreferredTargetEffect({
    composerPreferredTargetKey, selectedSessionKey, composerActive, composerPreparingTargetKey,
    newSessionModalOpen, worktreeModalOpen, setComposerPreferredTargetKey,
  }), [composerActive, composerPreferredTargetKey, composerPreparingTargetKey, newSessionModalOpen, selectedSessionKey, worktreeModalOpen])

  // Reconcile window pins against the open tabs:
  //   · a pin whose tab was closed is dropped (the previewed session excepted)
  //   · short lists fill from the remaining tabs in tab order
  useEffect(() => runSplitPinnedFillEffect({
    splitPaneCount, setSplitPinnedKeys, parkedWindowKeysRef, openTabSessions, selectedSessionKey,
  }), [openTabSessions, selectedSessionKey, splitPaneCount])

  // New participants append once; gates/status polls never reorder or focus.
  // Explicitly closed panes stay closed on subsequent refreshes.
  const updateWatchedRoster = useStableEvent((watchedCoordinator: ProtocolRunSnapshot | null) => {
    if (!watchedCoordinator) { watchedRosterRef.current = null; return }
    const previous = watchedRosterRef.current
    if (!previous || previous.runId !== watchedCoordinator.run.id) {
      watchedRosterRef.current = { runId: watchedCoordinator.run.id, keys: new Set(planCoordinatorWorkspace(watchedCoordinator, sessionsByKeyRef.current).targets.map(target => target.sessionKey)) }
      return
    }
    const readable = planCoordinatorWorkspace(watchedCoordinator, sessionsByKeyRef.current).targets
    const added = readable.filter(target => !previous.keys.has(target.sessionKey))
    for (const target of readable) previous.keys.add(target.sessionKey)
    const targets = added.filter(target => target.sessionKey !== selectedSessionKey && !splitPinnedKeys.includes(target.sessionKey))
    if (!targets.length) return
    setOpenTabSessions(current => {
      const keys = new Set(current.map(sessionKey))
      return [...current, ...targets.filter(target => !keys.has(target.sessionKey)).map(target => target.session)]
    })
    setSplitPinnedKeys(current => [...current, ...targets.map(target => target.sessionKey)])
    setSplitPaneCount(current => current + targets.length)
  })
  useEffect(() => { updateWatchedRoster(watchedCoordinator) }, [watchedCoordinator])

  // Keep open-tab metadata in sync when the current provider's sessions list
  // refreshes (e.g. title updates from polling). Tabs for *other* providers
  // are left untouched — they retain whatever snapshot was captured when the
  // user last visited them.
  useEffect(() => runOpenTabsOrderEffect({
    sessions, setOpenTabSessions,
  }), [sessions])

  // Sync tab-select visual position when active tab changes
  useEffect(() => {
    if (!tabSelectRef.current || activeStripIndex < 0) return
    syncingTabSelectionRef.current = true
    try { tabSelectRef.current.setSelectedIndex(activeStripIndex) }
    finally { syncingTabSelectionRef.current = false }
  }, [activeStripIndex, showHorizontalTabs])

  // Animate the running tabs' spinner IMPERATIVELY, through the renderable's
  // own setOptions. Driving it from state would re-render the root — and the
  // mounted transcript with it — ten times a second for a one-glyph change;
  // the root's render is the most expensive thing in this app (see the nav
  // perf notes). setOptions keeps the selected index and emits nothing, so
  // this cannot move the active tab.
  //
  // React owns the `options` prop, so a root render repaints the plain names;
  // the next tick puts the frame back. Applying one immediately is what keeps
  // that invisible.
  useEffect(() => runOptionsEffect({
    tabSelectRef, runningTabKeys, tabOptions, tabWidth,
  }), [runningTabKeys, tabOptions, showHorizontalTabs, tabWidth])

  useEffect(() => {
    const entry = sidebarEntries[selectedSidebarEntryIndex]
    if (!entry) return
    const prev = sidebarEntries[selectedSidebarEntryIndex - 1]
    const scrollKey = prev?.type === 'project' ? prev.key : entry.key
    const timer = setTimeout(() => {
      sidebarScrollRef.current?.scrollChildIntoView(`sidebar:${scrollKey}`)
    }, 0)
    return () => clearTimeout(timer)
  }, [selectedSidebarEntryIndex, sidebarEntries])

  // When switching to a filtered/grouped transcript mode the cursor may be on a
  // hidden technical card. Snap it to the last visible card so navigation stays coherent.
  useEffect(() => {
    if (transcriptView !== 'continue' && !isStreamView && transcriptView !== 'agents') return
    if (visibleTranscriptCards.length === 0) return
    const cursorKey = readTranscriptCursorKey()
    const isVisible = cursorKey
      ? visibleTranscriptCards.some((c) => c.key === cursorKey)
      : false
    if (!isVisible) {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptView])
  const {
    footerSegments, composerStatusMessage, composerTargetMessage, composerIdleFooterHint,
    resizeSidebar, resizeTaskPanel, showNotice, toggleSelectedSessionSettled, openTurnCheckpoint,
  } = useFooterSegmentsGroup({
    composerActive, composerKeysTargetTurn, effectiveFocus, sidebarView, isScrollbackView,
    scrollbackExpanded, commandChordPending, theme, splitChordPending, attentionNeedsInputCount,
    width, statusBarInDock, composerDockTextareaWidth, splitFocusIndex, visibleComposerError,
    activeQueuedComposerSends, composerQueueDurable, visibleAwaitingPersistedTurn,
    embeddedComposer, turnRunningForComposer, steeredSendNotice, visibleComposerSending,
    visibleComposerLiveText, composerPaneTargetKey, composerTargetSession,
    composerAutoTargetingRunning, composerConfig, sentHistory, sidebarWidth, maxSidebarWidth,
    setSidebarWidthPreference, setError, taskPanelOpen, taskPanelWidth, maxTaskPanelWidth,
    setTaskPanelExpanded, setTaskPanelWidth, selectedSession, setSessions, pendingInboxEditsRef,
    showSettled, gitRepoCwd, sessionDetail, setCheckpointFocusPrompt, setPluginOverlay,
  })
  useEffect(() => registerTurnSummaryOpener(openTurnCheckpoint), [])

  // Clicking a link in the transcript.
  //
  // `renderer.getLinkAt(x, y)` reads the link id out of the painted cell, so the
  // handler needs no idea which card or row was hit — the renderer already knows,
  // cell-precisely, which is why this is one handler rather than one per row.
  //
  // It fires on mouse UP and only when the pointer has not moved since the
  // press. Opening on mouse DOWN would hijack the start of a text selection that
  // happens to begin on a URL, and selecting a line containing a path is a far
  // more common thing to want than following it.
  const linkPressRef = useRef<{ x: number; y: number } | null>(null)
  const noteTranscriptLinkPress = useStableEvent((event: MouseEvent) => {
    linkPressRef.current = event.button === 0 ? { x: event.x, y: event.y } : null
  })
  const openCardAsyncQuestions = useStableEvent((session: Session, card: TuiTranscriptCard) => {
    if (!card.asyncQuestions?.length) return
    setAsyncQuestionPrompt({ id: `async:${card.key}`, sessionId: session.sessionId,
      provider: session.provider, providerInstanceId: session.providerInstanceId, asyncQuestion: true, title: 'Follow-up questions', questions: card.asyncQuestions })
  })
  const openTranscriptLinkAt = useStableEvent((event: MouseEvent): boolean => {
    const press = linkPressRef.current
    linkPressRef.current = null
    if (event.button !== 0 || !press) return false
    if (press.x !== event.x || press.y !== event.y) return false
    const url = renderer.getLinkAt(event.x, event.y)
    if (!url) return false
    const target = parseTuiLinkTarget(url)
    if (!target) return false
    if (target.kind === 'url') {
      void openExternalUrl(target.url).catch((err) => {
        showNotice('error', err instanceof Error ? err.message : `Open this URL in a browser: ${target.url}`)
      })
      return true
    }
    // A file target opens in the project editor rather than externally — the
    // editor is already the TUI's file surface, and handing the path to the OS
    // would bounce the user out of the terminal.
    openEditorAt(target.path, target.line ?? null)
    return true
  })

  // SCROLLBACK folds with the mouse: a click on a folded tool row or group
  // expands it. Like a link it acts on mouse UP with the pointer unmoved, so a
  // drag is still a text selection. Folding again takes a click on the item's
  // first row only — an expanded diff has its own click targets below it.
  const openSelectedAsyncQuestionsOrFold = useStableEvent(() => {
    const cursorKey = readTranscriptCursorKey()
    const index = cursorKey ? transcriptIndexByKey.get(cursorKey) : undefined
    const card = index == null ? null : visibleTranscriptCards[index]
    if (card?.asyncQuestions?.length && selectedSession) {
      setAsyncQuestionPrompt({ id: `async:${card.key}`, sessionId: selectedSession.sessionId,
        provider: selectedSession.provider, providerInstanceId: selectedSession.providerInstanceId,
        asyncQuestion: true, title: 'Follow-up questions', questions: card.asyncQuestions })
    } else toggleExpansion('parent')
  })


  const toggleSurfacePanelPlacement = useStableEvent(() => {
    const next = surfacePanelPlacement === 'right' ? 'bottom' : 'right'
    setSurfacePanelPlacement(next)
    showNotice('info', next === 'bottom' ? 'Panel under the panes · | moves it back beside' : 'Panel beside the panes · | moves it under')
    void writeTuiSurfacePanelPlacement(next).catch(() => {})
  })

  useEffect(() => runSurfacePlacementEffect({
    workspaceContext, setSurfacePanelPlacement, setSplitArrangement, setSplitReaderLast,
    setSplitSecondaryShare, setSplitBottomShare, setSplitWeights,
  }), [])

  const showToggleOutcome = useStableEvent((label: string, outcome: string | boolean) => {
    const state = typeof outcome === 'boolean' ? (outcome ? 'enabled' : 'disabled') : outcome
    showNotice('info', `${label} ${state}`)
  })

  const presentationReturnFocus = useWorkspaceRef<{ key: string | null; pane: PaneFocus; composer: boolean } | null>('presentationReturnFocus', null)
  const restoreWindowPresentation = useStableEvent(() => {
    const previous = presentationReturnFocus.current
    presentationReturnFocus.current = null
    setWindowPresentation(null)
    setWindowSurfacePeek(null)
    if (previous) {
      if (previous.key) {
        if (popoverTabs.includes(surfaceIdOfKey(previous.key))) setActivePopoverTab(surfaceIdOfKey(previous.key))
        const stack = windowStackFor(previous.key)
        const active = stack?.find(key => laidOutWindowKeys.has(key))
        if (active && active !== previous.key) commitWindowKeys(replaceWindowKey(shownFirstWindowKeys(), active, previous.key))
        const index = previous.key === floatingKey ? FLOATING_PANE_INDEX : orderedWindowKeys.indexOf(active ?? previous.key)
        setSplitFocusIndex(index >= 0 ? index : null)
        if (!isSurfaceWindowKey(previous.key) && openTabByKey.has(previous.key)) {
          setSelectedSessionKey(previous.key)
          setComposerPaneTargetKey(previous.key)
        }
      }
      setFocusedPane(previous.pane)
      setComposerActive(previous.composer)
    }
    showNotice('info', 'Layout restored')
  })
  const presentWindow = useStableEvent((mode: 'zoom' | 'fullscreen', target = presentationResolverRef.current()) => {
    if (!target) { showNotice('info', 'Focus a window first'); return }
    if (!windowPresentation) presentationReturnFocus.current = {
      key: presentationResolverRef.current(), pane: focusedPane, composer: composerActive,
    }
    setWindowSurfacePeek(null)
    setWindowPresentation({ mode, target })
    setFocusedPane('messages')
    setSplitChordPending(false)
    setCommandChordPending(false)
    setSessionSearchMode(false)
    if (isSurfaceWindowKey(target)) setComposerActive(false)
  })
  const toggleFullscreenMode = useStableEvent((forced?: boolean) => {
    if (forced === false || (forced === undefined && fullscreenMode)) restoreWindowPresentation()
    else presentWindow('fullscreen', windowPresentation?.target ?? presentationResolverRef.current())
  })

  const rememberComposerCursor = useCallback(() => {
    composerCursorOffsetRef.current = composerTextareaRef.current?.cursorOffset ?? null
  }, [])

  const openComposerWindow = useStableEvent(() => {
    rememberComposerCursor()
    setComposerActive(true)
    setComposerWindowOpen(true)
  })

  const toggleComposerWindow = useStableEvent(() => {
    rememberComposerCursor()
    setComposerActive(true)
    setComposerWindowOpen((open) => !open)
  })

  const toggleComposerHidden = useStableEvent(() => {
    const next = !composerHidden
    setComposerHidden(next)
    if (next) setComposerActive(false)
    showToggleOutcome('Composer', next ? 'hidden' : 'shown')
  })
  const {
    attachComposerImage, insertCompactPastedText, pasteFilePathToComposer,
    insertComposerTextAtCursor, voiceStatus, setVoiceStatus, voiceJob,
  } = useInsertComposerPasteMarkerGroup({
    composerTextareaRef, ensureComposerPastePartTypeId, setComposerDraft,
    composerDraftStorageKeyRef, writeWorkspaceDraft, setComposerHistoryOpen,
    setComposerHistoryIndex, composerPromptParts, setComposerMentionAttachments,
    setComposerPromptParts, showNotice, composerDraft, prepareComposerSubmission,
    composerMentionAttachments, composerTargetSession, selectedSession,
  })
  useEffect(() => () => {
    voiceJob.current?.controller.abort()
    voiceJob.current = null
    setVoiceStatus('')
  }, [composerTargetSession?.provider, composerTargetSession?.sessionId])
  const {
    toggleVoice, pasteTextToComposer, pasteSystemClipboardToComposer, stashComposerPrompt,
    popComposerStash, openComposerStashList, selectComposerStashEntry, commitComposerStashEntry,
  } = useToggleVoiceGroup({
    voiceJob, setVoiceStatus, setComposerActive, insertComposerTextAtCursor,
    pasteFilePathToComposer, insertCompactPastedText, attachComposerImage, showNotice,
    composerTextareaRef, setComposerDraft, setComposerMentionAttachments, setComposerPromptParts,
    setComposerMention, setComposerMentionResults, setComposerMentionDismissedStart,
    setComposerSlashIndex, setComposerSlashDismissed, setComposerHistoryOpen,
    setComposerHistoryIndex, setComposerStashOpen, setComposerStashIndex,
    composerDraftStorageKeyRef, writeWorkspaceDraft, setComposerStash, makeComposerSnapshot,
    composerStash, applyComposerSnapshot, composerStashIndex,
  })

  useSelectionHandler((selection) => {
    const text = selection.getSelectedText()
    if (!text.trim()) return
    terminalSelectionRef.current = { text, capturedAt: Date.now() }
    // Copy only after mouse-up. During a drag OpenTUI emits every intermediate
    // range, and spawning a Windows clipboard process for each frame makes
    // selection lag badly. Non-Windows terminals keep the OSC 52 path. Native
    // Windows deliberately avoids that renderer FFI path (opentui.dll has
    // faulted there), so use the host clipboard command instead; WSL uses the
    // same bridge when OSC 52 is unavailable. Text stays verbatim rather than
    // BMP-sanitized so selections keep their exact Unicode contents.
    const windowsClipboard = IS_WINDOWS || isWslRuntime()
    const destination = terminalSelectionCopyDestination({
      isDragging: selection.isDragging,
      nativeOscEnabled: NATIVE_OSC_ENABLED,
      osc52Supported: renderer.capabilities?.osc52 !== false,
      windowsClipboard,
    })
    if (destination === 'osc52') {
      const copied = renderer.copyToClipboardOSC52(text)
      if (copied || !windowsClipboard) return
    }
    if (destination === 'host' || windowsClipboard) {
      // Keep the selection usable even if the automatic bridge fails: `y`
      // still retries through copySelectedMessage and reports the real error.
      void writeClipboard(text, renderer).catch(() => {})
    }
  })

  usePaste((event) => {
    if (windowControlMode && pendingPermissions.length === 0) { event.preventDefault(); event.stopPropagation(); return }
    if (spacesMenuOpen || windowPickerOpen || windowSwitcherOpen || windowBroadcastOpen) return // the focused window input owns bracketed paste
    // A shell with the keyboard takes the paste too, bracketed if it asked.
    const pasteKey = { name: 'paste', ctrl: false, shift: false, sequence: Buffer.from(event.bytes).toString('utf8') }
    if (pendingPermissions.length === 0 && focusedWindowSurface && focusedWindowSurfaceKind && isPluginSurfaceId(focusedWindowSurfaceKind) && windowSurfaceCaptureRef.current.get(focusedWindowSurface) === 'terminal') {
      event.preventDefault()
      event.stopPropagation()
      windowSurfaceKeysRef.current.get(focusedWindowSurface)?.(pasteKey)
      return
    }
    const pastePanelKind = activeSurface(surfacePanel)?.kind
    if (pendingPermissions.length === 0 && surfacePluginKeyCaptureRef.current === 'terminal' && surfacePanelOpen && surfacePanelFocused && pastePanelKind && isPluginSurfaceId(pastePanelKind)) {
      event.preventDefault()
      event.stopPropagation()
      surfacePluginKeyRef.current?.(pasteKey)
      return
    }
    if (isInteractiveCoordinatorOpen()) {
      event.preventDefault()
      event.stopPropagation()
      if (!pasteImageMimeType(event.metadata?.mimeType) && !inferPastedImageMimeType(event.bytes)) {
        teammatesKeyHandlerRef.current?.({ name: 'paste', ctrl: false, shift: false, sequence: Buffer.from(event.bytes).toString('utf8') })
      }
      return
    }
    if (questionFreeformEditing) {
      const activePermission = pendingPermissions[0]
      const questions = activePermission?.questions ?? []
      const qi = Math.min(questionFocusIndex, questions.length - 1)
      const question = questions[qi]
      if (question?.allowFreeform) {
        event.preventDefault()
        event.stopPropagation()
        const text = Buffer.from(event.bytes).toString('utf8')
        setQuestionFreeformAnswers((prev) => ({ ...prev, [qi]: `${prev[qi] ?? ''}${text}` }))
        if (!question.multiSelect) setQuestionSelections((prev) => ({ ...prev, [qi]: [] }))
        return
      }
    }
    if (!composerActiveRef.current) return
    if (!composerTextareaRef.current) return
    const imageMimeType = pasteImageMimeType(event.metadata?.mimeType) ?? inferPastedImageMimeType(event.bytes)
    if (imageMimeType) {
      event.preventDefault()
      event.stopPropagation()
      attachComposerImage({
        data: Buffer.from(event.bytes).toString('base64'),
        mimeType: imageMimeType,
        displayName: pastedImageDisplayName(imageMimeType),
      })
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const text = Buffer.from(event.bytes).toString('utf8')
    void pasteTextToComposer(text)
  })
  const {
    copySelectedMessage, replySelectedMessage, toggleBookmarkForCursor, jumpToBookmark,
    openBookmarksOverlay, openHandoffBrief, openPromptLibrary, toggleComposerBridgeRoute,
    toggleComposerIdeRoute, insertComposerPromptText, openBookmarkRecord, copyCliCommand,
    captureWindowLayout, windowHistory, checkpointWindowLayout, restoreWindowSnapshot,
  } = useCopySelectedMessageGroup({
    terminalSelectionRef, renderer, showNotice, readCursorIndex, visibleTranscriptCards,
    composerTextareaRef, composerDraft, applyComposerSnapshot, composerMentionAttachments,
    composerPromptParts, setComposerActive, selectedSessionTarget, bookmarkKeysRef,
    setBookmarkKeys, readerTitle, jumpToTranscriptIndex, setBookmarksOverlayOpen,
    setBookmarksOverlayIndex, setBookmarksOverlay, setHandoffBriefOpen, rememberComposerCursor,
    setPromptLibraryOpen, canUseChannelBridge, setRouteComposerToBridge, canUseIdeBridge,
    setRouteComposerToIde, insertComposerTextAtCursor, selectedSessionKeyRef, transcriptIndexByKey,
    pendingBookmarkCursorRef, setFocusedPane, selectTabSession, selectedSession, sessionDetail,
    splitArrangement, splitOrientation, splitReaderLast, splitReaderShare, splitSecondaryShare,
    splitBottomShare, splitWeights, reconciledSplitTree, splitPaneCount, splitPinnedKeys,
    windowSurfaces, windowOrder, popoverTabs, activePopoverTab, windowStacks, floatingWindow,
    windowSurfaceMeta, selectedSessionKey, windowZoom, fullscreenMode, windowPresentation,
    coordinatorWorkspaceRunId, coordinatorWorkspace, openTabSessions, splitFocusIndex,
    surfacePanel, surfacePanelOpen, windowResizeGroupRef, windowResizeCheckpointRef,
    setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, liveWindowStacks, floatingKey,
    workspaceContext, setWindowSurfacePeek, setOpenTabSessions, setWorkspaceHasSession,
    setWorkspaceReaderSession, setSelectedSessionKey, setSplitPinnedKeys, setSplitPaneCount,
    setWindowSplitTree, setSplitArrangement, setSplitOrientation, setSplitReaderLast,
    setSplitReaderShare, setSplitSecondaryShare, setSplitBottomShare, setSplitWeights,
    setWindowSurfaces, setWindowOrder, setPopoverTabs, setActivePopoverTab, setWindowStacks,
    setFloatingWindow, setWindowSurfaceMeta, setWindowZoom, setFullscreenMode, setSplitFocusIndex,
    setSurfacePanel, setSurfacePanelOpen, setSurfacePanelFocused, setError, setWindowPresentation,
  })
  const undoWindowLayout = useStableEvent(() => {
    const previous = windowHistory.undo(captureWindowLayout())
    if (!previous) { showNotice('info', 'No window changes to undo'); return }
    restoreWindowSnapshot(previous)
    showNotice('info', 'Window change undone · Ctrl+B U to redo')
  })
  const redoWindowLayout = useStableEvent(() => {
    const next = windowHistory.redo(captureWindowLayout())
    if (!next) { showNotice('info', 'No window changes to redo'); return }
    restoreWindowSnapshot(next)
    showNotice('info', 'Window change redone')
  })
  const currentPaneTree = (): WindowSplitTree => reconciledSplitTree ?? {
    keys: orderedWindowKeys,
    root: splitTreeFromRects(windowLayoutRects(fittedWindows, { width: readerAreaWidth, height: windowAreaHeight, orientation: splitOrientation, readerLast: splitReaderLast }).map((rect, index) => ({ ...rect, slot: index - 1 }))),
  }
  const [closedWindows, setClosedWindows] = useWorkspaceState<Array<{ key: string; snapshot: ReturnType<typeof captureWindowLayout> }>>('closedWindows', [], false)
  const rememberClosedWindow = useStableEvent((key: string) => {
    setClosedWindows(previous => [...previous.slice(-19), { key, snapshot: captureWindowLayout() }])
  })
  const reopenClosedWindow = useStableEvent(() => runReopenClosedWindow({
    closedWindows, showNotice, orderedWindowKeys, liveWindowStacks, floatingKey, setClosedWindows,
    checkpointWindowLayout, setOpenTabSessions, setPopoverTabs, setWindowSurfaceMeta,
    setActivePopoverTab, setSplitFocusIndex, teammatesOpen, openTeammatesPanel, setWindowStacks,
    commitWindowKeys, setFloatingWindow, setWindowSplitTree, setOverviewPendingTarget,
  }))

  // Split panes are driven by a tmux-style prefix chord (⌃B then a command key),
  // so the reader's single-key namespace stays free. applySplitPaneCount is the
  // one writer of the count — it persists and narrates every change.
  const applySplitPaneCount = useStableEvent((next: number, label?: string, orientation?: SplitPaneOrientation) => runApplySplitPaneCount({
    checkpointWindowLayout, setSplitPaneCount, setError, windowSplitTree, showNotice,
    splitOrientation, mainContentHeight, readerAreaWidth, splitCandidateSessions, splitReaderShare,
  }, next, label, orientation))

  // tmux shape: % splits the focused frame right; " splits it below.
  // Existing branches retain their orientation, allowing mixed layouts.
  const addSplitPane = useStableEvent((orientation: SplitPaneOrientation) => splitFocusedWindow(orientation))

  const closeSplitPane = useStableEvent((paneIndex?: number) => runCloseSplitPane({
    splitFocusIndex, closeFloatingWindow, checkpointWindowLayout, splitPaneCount, showNotice,
    windowItems, windowStackFor, windowItemKey, closeWindowTab, pinIndexOfWindow, splitPinnedKeys,
    rememberClosedWindow, setSplitPinnedKeys, setSplitFocusIndex, lastFocusedSplitPaneRef,
    applySplitPaneCount,
  }, paneIndex))

  // ── Window layouts ─────────────────────────────────────────────────────────
  const setWindowArrangement = useStableEvent((arrangement: WindowArrangement, readerLast: boolean) => {
    checkpointWindowLayout()
    setWindowSplitTree(null)
    setSplitArrangement(arrangement)
    setSplitReaderLast(readerLast)
    void writeTuiWindowArrangement({ arrangement, readerLast, secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights: splitWeights }).catch(() => {})
  })

  // Ask for `wanted` panes from the open tabs; say so when there are not enough.
  const requestWindowPanes = useStableEvent((wanted: number, label: string) => runRequestWindowPanes({
    splitCandidateSessions, openTabSessions, selectedSessionKey, sessions, setOpenTabSessions,
    showNotice, setSplitPaneCount, setError,
  }, wanted, label))

  // What a right-click on a session offers, depending on where it is now.
  const openSessionMenu = useStableEvent((session: Session, source: 'rail' | 'tab' | 'pane', point: { x: number; y: number }, paneIndex?: number) => {
    const key = sessionKey(session)
    if (source === 'pane') { openWindowControlMenu(paneIndex === undefined ? 'reader' : key, point); return }
    const title = fitText(formatSessionTitle(session), 34).trimEnd()
    const items: ContextMenuItem[] = []
    items.push(
      { label: 'Open session', run: () => (source === 'tab' ? selectTabSession(session) : selectSidebarSession(session)) },
      { label: 'Open as a pane on the right', run: () => dropSessionInWindow(session, 'right', null) },
      { label: 'Open as a pane below', run: () => dropSessionInWindow(session, 'bottom', null) },
    )
    if (source === 'tab') items.push({ label: 'Close tab', hint: '×', danger: true, run: () => closeSessionTab(session) })
    setContextMenu({ ...point, title, items })
  })
  const openSurfaceWindowMenu = useStableEvent((surface: WindowSurfaceId, _index: number, point: { x: number; y: number }) => {
    openWindowControlMenu(surfaceWindowKey(surface), point)
  })

  const windowLayoutProject = gitRepoCwd || process.cwd()
  // Diff, files and pull requests need a repository; the rest open anywhere.
  const surfaceRestorable = (surface: string) => Object.hasOwn(WINDOW_SURFACE_TITLES, surfaceKindOf(surface)) && (Boolean(gitRepoCwd) || !['diff', 'files', 'pull-request'].includes(surfaceKindOf(surface)))
  useEffect(() => {
    if (!windowPickerOpen) return
    try { setSavedWindowLayouts(listSavedWindowLayouts(windowLayoutProject)) } catch { setSavedWindowLayouts(keepEmpty) }
  }, [windowLayoutProject, windowPickerOpen])

  const currentWindowLayoutContents = useStableEvent(() => ({
    primaryOpen: false,
    splitTree: reconciledSplitTree ?? undefined,
    arrangement: splitArrangement, orientation: splitOrientation,
    readerLast: splitReaderLast, readerShare: splitReaderShare,
    secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights: splitWeights,
    reader: null,
    coordinatorRunId: coordinatorWorkspaceRunId ?? undefined,
    panes: splitPinnedSessions.slice(0, splitPaneCount).map((pane) => sessionKey(pane)),
    surfaces: windowSurfaces,
    order: orderedWindowKeys,
    popoverTabs, activePopoverTab,
    floating: floatingWindow,
    stacks: liveWindowStacks,
    surfaceMeta: windowSurfaceMeta,
  }))
  const saveCurrentWindowLayout = useStableEvent((name?: string) => {
    try {
      const saved = saveWindowLayout(windowLayoutProject, currentWindowLayoutContents(), name)
      setSavedWindowLayouts(listSavedWindowLayouts(windowLayoutProject))
      showNotice('info', `Saved ${saved.name} · ${describeSavedLayout(saved)}`)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Could not save the layout')
    }
  })
  const editSavedWindowLayout = useStableEvent((id: string, name?: string) => {
    try {
      const saved = updateWindowLayout(windowLayoutProject, id, name === undefined
        ? { layout: currentWindowLayoutContents() } : { name })
      setSavedWindowLayouts(listSavedWindowLayouts(windowLayoutProject))
      showNotice('info', `${name === undefined ? 'Updated' : 'Renamed'} ${saved.name}`)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Could not edit the layout')
    }
  })

  // Put a saved layout back. Sessions that no longer exist are skipped and said so.
  const restoreWindowLayout = useStableEvent(async (id: string) => {
    const saved = savedWindowLayouts.find(entry => entry.id === id)
    if (!saved) return
    const request = ++windowLayoutRestoreRequestRef.current
    const project = windowLayoutProject
    let snapshot: ProtocolRunSnapshot | null = null
    if (saved.coordinatorRunId) {
      try { snapshot = await readTuiProtocolRun(saved.coordinatorRunId) } catch { /* Restore known tabs if the ledger is unavailable. */ }
    }
    applySavedWindowLayout(id, snapshot, request, project)
  })
  const applySavedWindowLayout = useStableEvent((id: string, snapshot: ProtocolRunSnapshot | null, request: number, project: string) => runApplySavedWindowLayout({
    windowLayoutRestoreRequestRef, windowLayoutProject, windowPickerOpen, setWindowSurfacePeek,
    checkpointWindowLayout, setCoordinatorWorkspace, savedWindowLayouts,
    setCoordinatorWorkspaceRunId, setWindowPickerOpen, sessions, openTabSessions,
    setWindowArrangement, applySplitOrientation, setSplitReaderShare, setSplitSecondaryShare,
    setSplitBottomShare, setSplitWeights, setOpenTabSessions, setSplitPinnedKeys,
    setSplitPaneCount, setWindowSurfaces, surfaceRestorable, setWindowOrder, setPopoverTabs,
    setActivePopoverTab, setWindowSplitTree, setWindowStacks, setWindowSurfaceMeta,
    setFloatingWindow, setSplitFocusIndex, setSurfacePanelFocused, setFocusedPane, setWindowZoom,
    selectedSessionKey, setWorkspaceHasSession, setWorkspaceReaderSession, setSelectedSessionKey,
    showNotice,
  }, id, snapshot, request, project))

  const deleteSavedWindowLayout = useStableEvent((id: string) => {
    try {
      deleteWindowLayout(windowLayoutProject, id)
      setSavedWindowLayouts(listSavedWindowLayouts(windowLayoutProject))
    } catch { /* the list stays as it was */ }
  })

  // A surface into the layout: out of the side panel, into a window, focused.
  // `another` opens a further window of a kind that can have several; otherwise
  // a kind already in a window is focused there rather than opened twice.
  const openSurfaceWindow = useStableEvent((kind: WindowSurfaceKind, options: { another?: boolean; fromPanelId?: string } = {}) => runOpenSurfaceWindow({
    showNotice, surfacePanel, windowSurfaces, pendingSurfaceFocusRef, setFocusedPane,
    setWindowSurfaces, popoverTabs, parkedWindowKeysRef, checkpointWindowLayout, pluginOverlay,
    workspaceContext, windowShellSelectionRef, setSurfacePanel, setSurfacePanelOpen,
    setSurfacePanelFocused, setWindowSurfaceMeta, gitRepoCwd, windowSplitTree, splitArrangement,
    splitPaneCount, setWindowArrangement, splitReaderLast,
  }, kind, options))
  const returningPopoverRef = useRef(false)
  const closeSurfaceWindow = useStableEvent((surface: WindowSurfaceId, moving = false) => {
    if (!moving && !returningPopoverRef.current) {
      if (surfaceKindOf(surface) === 'teammates' && teammatesOpen) closeInteractiveCoordinator()
    }
    if (floatingKey === surfaceWindowKey(surface)) { closeFloatingWindow(!moving); return }
    if (windowStackFor(surfaceWindowKey(surface))) { closeWindowTab(surfaceWindowKey(surface), !moving); return }
    if (windowSurfacePeek === surface) setWindowSurfacePeek(null)
    if (!moving) rememberClosedWindow(surfaceWindowKey(surface))
    checkpointWindowLayout()
    setWindowSurfaces((current) => keepFiltered(current, (entry) => entry !== surface))
    setWindowSurfaceMeta((current) => { if (!(surface in current)) return current; const next = { ...current }; delete next[surface]; return next })
    windowSurfaceKeysRef.current.delete(surface)
    windowSurfaceCaptureRef.current.delete(surface)
    setSplitFocusIndex(focusAfterWindowClose(splitFocusIndex, windowItems.findIndex(item => item.kind === 'surface' && item.surface === surface), windowItems.length))
  })
  // A window's title, naming what it is pinned to.
  const windowSurfaceTitle = (surface: WindowSurfaceId): string => {
    const meta = windowSurfaceMeta[surface]
    const base = WINDOW_SURFACE_TITLES[surfaceKindOf(surface)] ?? surface
    if (meta?.session) {
      const session = openTabByKey.get(meta.session) ?? sessions.find((entry) => sessionKey(entry) === meta.session)
      return `${base} · ${session ? fitText(formatSessionTitle(session), 32).trimEnd() : 'session gone'}`
    }
    if (meta?.path) return `${base} · ${meta.path}`
    return surfaceTitle(surface)
  }
  const pinnedSessionOf = (surface: WindowSurfaceId): Session | null => {
    const key = windowSurfaceMeta[surface]?.session
    if (!key) return null
    return openTabByKey.get(key) ?? sessions.find((entry) => sessionKey(entry) === key) ?? null
  }
  // The popover of a kind, open or closed: what a window of it replaces.
  // `pin` reopens a path-pinned popover (file history) on its path.
  const setPopoverOpen = (kind: WindowSurfaceKind, open: boolean, pin?: SurfaceMeta) => {
    // File history has an overlay slot of its own, above the plugin overlay.
    if (kind === 'file-history') setFileHistoryPath(open ? pin?.path ?? null : null)
    // Teammates stay open while windowed (below); every other plugin surface is the overlay.
    else if (isPluginSurfaceId(kind) && kind !== 'teammates') setPluginOverlay((current) => open ? kind : current === kind ? null : current)
    else if (kind === 'daily-summary') setDailySummaryOpen(open)
    else if (kind === 'attention') setAttentionOpen(open)
    else if (kind === 'prompt-library') setPromptLibraryOpen(open)
    else if (kind === 'playbooks') setPlaybookManagerOpen(open)
    else if (kind === 'handoff') setHandoffBriefOpen(open)
    // Teammates and diagnostics stay open while windowed (their modal is
    // suppressed), so moving between the two forms changes nothing here.
  }
  // The popover open now, if it can become a window. Order is the popovers' own
  // key-routing order, so ⌃⇧W takes the one that is taking the keys.
  const openPopoverKind = (): PopoverWindowKind | null => (
    fileHistoryPath && gitRepoCwd ? 'file-history'
    : pluginOverlay && isPopoverWindowKind(pluginOverlay) ? pluginOverlay : dailySummaryOpen ? 'daily-summary'
    : playbookManagerOpen ? 'playbooks' : attentionOpen ? 'attention' : promptLibraryOpen ? 'prompt-library'
    : handoffBriefOpen ? 'handoff'
    : teammatesModalOpen ? 'teammates' : null)
  const readerPin = () => ({ session: selectedSessionKey, path: fileHistoryPath })
  // A popover into a window, pinned to the reader's session (or nothing),
  // focused. A window already showing it for that pin is focused instead.
  // `placement`: beside the reader (a window in the layout), filling this tab's
  // window area (that window zoomed; ⌃B m restores the layout), or a new
  // workspace tab of its own.
  const openPopoverWindow = useStableEvent((kind: PopoverWindowKind, pin: SurfaceMeta = pinFor(kind, readerPin()), placement: 'beside' | 'fill' | 'tab' = 'beside') => runOpenPopoverWindow({
    readerPin, teammatesOpen, openTeammatesPanel, setPopoverOpen, openPopoverInNewTab,
    openPopoverTab, parkedWindowKeysRef, windowSurfaces, windowSurfaceMeta, activateWindowTab,
    pendingSurfaceFocusRef, setFocusedPane, setWindowSurfaces, checkpointWindowLayout,
    workspaceContext, setWindowSurfaceMeta, windowSplitTree, splitArrangement, splitPaneCount,
    setWindowArrangement, splitReaderLast, showNotice,
  }, kind, pin, placement))
  // A popover in a new workspace tab: the tab's layout is that one window,
  // filling the area — split, tab or float it there like any other.
  const openPopoverInNewTab = useStableEvent((kind: WindowSurfaceKind, pin: SurfaceMeta) => {
    const controller = workspaceContext.controller
    const pinned = pin.session ? openTabByKey.get(pin.session) ?? sessions.find((entry) => sessionKey(entry) === pin.session) ?? null : null
    const workspace = controller.addWorkspace(workspaceContext.space.id)
    if (!workspace) { showNotice('error', 'Could not open a new tab'); return }
    const runtime = controller.runtime(workspace)
    // Persisted like any workspace state (workspaceWindowMove writes the same way).
    const write = (key: string, value: unknown) => { runtime.persistent.add(key); runtime.set(key, value) }
    write('workspaceLaunched', true)
    write('windowSurfaces', [kind])
    write('windowSurfaceMeta', { [kind]: pin })
    runtime.set('windowPresentation', { mode: 'zoom', target: surfaceWindowKey(kind) })
    write('splitFocusIndex', 0)
    if (pinned) {
      write('openTabSessions', [pinned])
      write('selectedSessionKey', sessionKey(pinned))
    }
    controller.rename(workspace.id, WINDOW_SURFACE_TITLES[kind].slice(2))
  })
  // A popover as a tab of this workspace's tab strip, shown in the reader's place.
  const showPopoverTab = useStableEvent((id: WindowSurfaceId) => {
    if (windowPresentation) setWindowPresentation({ ...windowPresentation, target: surfaceWindowKey(id) })
    const focused = splitFocusIndex !== null && splitFocusIndex >= 0 ? windowItems[splitFocusIndex] : null
    setPopoverTabHostKey(focused?.kind === 'session' ? sessionKey(focused.session) : selectedSessionKey ?? null)
    setActivePopoverTab(id)
    setSplitFocusIndex(null)
    setWindowSurfacePeek(null)
    setFocusedPane('messages')
  })
  const openPopoverTab = useStableEvent((kind: WindowSurfaceKind, pin: SurfaceMeta) => {
    setPopoverOpen(kind, false)
    const existing = isPopoverWindowKind(kind)
      ? findPopoverWindow(popoverTabs, windowSurfaceMeta, kind, pin)
      : popoverTabs.find((id) => surfaceKindOf(id) === kind) ?? null
    if (existing) { showPopoverTab(existing); return }
    const parked = [...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)
    const id = nextSurfaceId(kind, new Set([...windowSurfaces, ...parked, ...popoverTabs]))
    if (isPluginSurfaceId(kind) && (!isPopoverWindowKind(kind) || !POPOVER_WINDOWS[kind].single)) copySurfaceViewState(workspaceContext.runtime, 'root', surfaceViewNamespace(kind, id), getPluginSurface(kind).pluginId)
    setWindowSurfaceMeta((current) => ({ ...current, [id]: pin }))
    setPopoverTabs((current) => [...current, id])
    showPopoverTab(id)
  })
  // `keep` leaves a store-backed popover open (it is moving, not closing).
  const closePopoverTab = useStableEvent((id: WindowSurfaceId, keep = false) => {
    if (!keep) { checkpointWindowLayout(); rememberClosedWindow(surfaceWindowKey(id)) }
    const kind = surfaceKindOf(id)
    if (!keep) {
      if (kind === 'teammates' && teammatesOpen) closeInteractiveCoordinator()
    }
    setPopoverTabs((current) => keepFiltered(current, (entry) => entry !== id))
    if (!keep) setWindowSurfaceMeta((current) => { if (!(id in current)) return current; const next = { ...current }; delete next[id]; return next })
    windowSurfaceKeysRef.current.delete(id)
    windowSurfaceCaptureRef.current.delete(id)
    if (activePopoverTab === id) setActivePopoverTab(null)
  })
  // A popover tab back to full screen, or out into a window.
  const popoverTabToFullScreen = useStableEvent((id: WindowSurfaceId) => {
    const kind = surfaceKindOf(id)
    if (!isPopoverWindowKind(kind) && !SURFACE_POPOVER_KINDS.has(kind)) return
    const meta = windowSurfaceMeta[id]
    const pinned = pinnedSessionOf(id)
    closePopoverTab(id, true)
    if (pinned && sessionKey(pinned) !== selectedSessionKey) {
      if (!openTabByKey.has(sessionKey(pinned))) setOpenTabSessions((current) => [...current, pinned])
      selectTabSession(pinned)
    }
    setPopoverOpen(kind, true, meta)
  })
  const popoverTabToWindow = useStableEvent((id: WindowSurfaceId) => {
    const kind = surfaceKindOf(id)
    const meta = windowSurfaceMeta[id] ?? {}
    closePopoverTab(id, true)
    if (isPopoverWindowKind(kind)) openPopoverWindow(kind, meta)
    else openSurfaceWindow(kind as RightPanelSurfaceKind)
  })
  const openPopoverTabMenu = useStableEvent((id: WindowSurfaceId, point: { x: number; y: number }) => {
    setContextMenu({ ...point, title: windowSurfaceTitle(id), items: [
      { label: 'Open as a window', run: () => popoverTabToWindow(id) },
      { label: 'Open full screen', hint: '⌃⇧W', run: () => popoverTabToFullScreen(id) },
      { label: 'Close tab', hint: '×', danger: true, run: () => closePopoverTab(id) },
    ] })
  })
  // A popover tab into another workspace, as a window of its layout.
  const openPopoverTabMoveMenu = useStableEvent((id: WindowSurfaceId) => {
    openMoveWorkspaceMenu(workspaceId, surfaceWindowKey(id), true)
  })

  // The strip's entry at `index`: a session tab or a popover tab.
  const selectStripIndex = useStableEvent((index: number) => {
    if (syncingTabSelectionRef.current) return
    if (index < visibleTabSessions.length) { const tab = visibleTabSessions[index]; if (tab) selectTabSession(tab); return }
    const id = popoverTabs[index - visibleTabSessions.length]
    if (id) showPopoverTab(id)
  })

  // Where the ⧉ button puts a popover: one menu for every popover — Git, Files
  // and pull requests included, which are side-panel surface kinds as well.
  // A plugin command opens its surface: in the window already showing it for
  // this pin when there is one (the open-popover effect routes it), else as an overlay.
  // `session` is the one the command is for (a pane's, a slash command's
  // target); by default the selected one.
  const runPluginCommand = useStableEvent((command: ResolvedPluginCommand, session: Session | null = selectedSession) => runRunPluginCommand({
    selectedSession, showNotice, pluginServiceGaps, gitRepoCwd, setEditorInitialPath,
    setEditorInitialLine, setCheckpointFocusPrompt, setCoordBoardRunId, openTeammatesPanel,
    setSurfacePanelOpen, setSurfacePanelFocused, setSurfacePanel, setPluginOpenRequests,
    setPluginOverlay,
  }, command, session))
  const runPluginCommandId = useStableEvent((id: string, session?: Session | null) => {
    const command = getPluginCommand(id)
    if (command) runPluginCommand(command, session === undefined ? selectedSession : session)
  })
  // What a plugin view's runCommand reaches: another plugin's command, or a host
  // command a plugin may ask for by id. Plugins never import each other.
  const runCommandForPlugin = useStableEvent((id: string): boolean => {
    const command = getPluginCommand(id)
    if (command) { runPluginCommand(command); return true }
    return false
  })
  const toggleVelocityScroll = useStableEvent(() => {
    setVelocityScrollEnabled((v) => {
      const next = !v
      showToggleOutcome('Velocity scroll', next)
      void writeTuiVelocityScroll(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store velocity scroll'))
      return next
    })
  })
  // Declared further down, with the render helpers; a plugin calls it on a key press.
  const newCoordinationRun = useStableEvent(() => startCoordinationRun())
  const choosePluginTheme = useStableEvent((mode: TuiThemeMode) => chooseTheme(mode))
  const jumpToTaskCard = useStableEvent((uuid: string) => {
    const idx = visibleTranscriptCards.findIndex((card) => card.key === uuid)
    if (idx >= 0) jumpToTranscriptIndex(idx)
  })
  // Only a warm Claude session can stop its background tasks (query.stopTask()).
  const composerCanStopTasks = composerTargetSession?.provider === 'claude'
  // What the root offers plugin views. Each surface receives only the services it declares.
  const pluginServices = useMemo((): TuiProvidedPluginServices => ({
    ...(subagentTranscriptSelection ? { 'subagent-transcript': {
      label: subagentTranscriptSelection.agent.taskDescription || subagentTranscriptSelection.agent.agentId,
      agentId: subagentTranscriptSelection.agent.agentId,
      load: (signal: AbortSignal) => readTuiSubagentTranscriptAsync(subagentTranscriptSelection.parent, subagentTranscriptSelection.agent.agentId, density, signal),
    } } : {}),
    composer: {
      appendDiffNote: (prompt: string, notice?: string) => {
        appendDiffCommentPromptToComposer(prompt)
        showNotice('info', notice ?? 'Diff comment added to composer')
      },
      askAboutSelection: (request: SelectionAskInput) => { void askAgentAboutSelection(request) },
      insertText: (text: string, notice?: string) => {
        insertComposerTextAtCursor(text)
        setComposerActive(true)
        showNotice('info', notice ?? 'Added to composer')
      },
      appendPrompt: (prompt: string, notice: string) => {
        appendDiffCommentPromptToComposer(prompt)
        setSurfacePanelFocused(false)
        showNotice('info', notice)
      },
    },
    clipboard: { write: (text: string) => writeClipboard(text, renderer), read: readClipboardText },
    'open-file': { open: (path: string, line?: number | null) => openEditorAt(path, line ?? null) },
    notices: { show: (kind: 'info' | 'error', text: string, durationMs?: number) => showNotice(kind, text, durationMs) },
    'browser-location': {
      recent: surfaceBrowserRecent,
      opened: (url: string) => setSurfaceBrowserRecent((current) => [url, ...current.filter((entry) => entry !== url)].slice(0, 12)),
    },
    ...(gitRepoCwd ? { 'file-history': { open: (path: string, where?: 'overlay' | 'window') => openFileHistory(path, where) } } : {}),
    'scroll-preferences': { velocity: velocityScrollEnabled, toggleVelocity: toggleVelocityScroll },
    coordination: {
      initialRunId: coordBoardRunId,
      openAgentSession: openCoordinationAgentSession,
      watchAgentSessions: watchCoordinationAgentSessions,
      watchRun: watchCoordinatorRun,
      newRun: newCoordinationRun,
      copyJoinCommand: copyCoordinationJoinCommand,
    },
    themes: { mode: themeMode, light: isLightThemeMode(themeMode), choose: choosePluginTheme },
    'task-control': {
      jumpTo: jumpToTaskCard,
      ...(composerCanStopTasks ? { stop: (taskId: string) => { void stopComposerTask(taskId) } } : {}),
    },
    'session-diagnostics': {
      read: async (session: Session) => (await readTuiSessionDiagnostics(session)).sections ?? [],
      run: (session: Session, action: string, extra: Record<string, unknown>) => runTuiSessionAction(session, { action, ...extra }),
      hasControls: (session: Session) => session.provider === 'claude',
    },
    // The bridges are offered only while a Claude session can use one (pluginServiceGaps says so otherwise).
    ...(canUseChannelBridge ? { 'channel-bridge': { routed: routeComposerToBridge, toggleRoute: toggleComposerBridgeRoute, accentColor: composerAccentColor } } : {}),
    ...(canUseIdeBridge ? { 'ide-bridge': { routed: routeComposerToIde, toggleRoute: toggleComposerIdeRoute, accentColor: composerAccentColor, sendComment: (text: string) => insertComposerPromptText(text) } } : {}),
  // The callbacks are the root's stable events and setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [subagentTranscriptSelection, density, renderer, velocityScrollEnabled, Boolean(gitRepoCwd), composerCanStopTasks, canUseChannelBridge, canUseIdeBridge, routeComposerToBridge, routeComposerToIde, composerAccentColor, surfaceBrowserRecent, coordBoardRunId, themeMode])
  // The session fleet changes on every poll, so only a view that asks for it is
  // handed a bag holding it; the rest keep the stable one above.
  const fleetDetailOwned = Boolean(sessionDetail && selectedSession && transcriptSession
    && sessionKey(transcriptSession) === sessionKey(selectedSession))
  const fleetPluginServices = useMemo((): TuiProvidedPluginServices => (fleetViewShown ? {
    ...pluginServices,
    'session-fleet': {
      sessions,
      activity: sidebarSessionActivity,
      alerts: fleetAlerts,
      selected: selectedSession,
      // The selected session's transcript counts only once the detail on screen is that session's.
      selectedCards: fleetDetailOwned ? transcriptCards : null,
      selectedContext: fleetDetailOwned ? sessionDetail?.contextUsage ?? null : null,
      selectedModel: fleetDetailOwned ? sessionDetail?.info?.currentModel ?? null : null,
      selectedMessageCount: fleetDetailOwned ? sessionDetail?.rawMessages.length ?? null : null,
      select: (session: Session) => selectTabSession(session),
      open: (session: Session) => {
        selectTabSession(session)
        setFocusedPane('messages')
      },
      openAlert: (alertKey: string) => {
        const item = attentionItems.find((candidate) => candidate.key === alertKey)
        if (!item) return false
        openAttentionSession(item)
        return true
      },
    },
  } : pluginServices), [fleetViewShown, pluginServices, sessions, sidebarSessionActivity, fleetAlerts, selectedSession, fleetDetailOwned, transcriptCards, sessionDetail, attentionItems])
  const pluginServicesFor = (surfaceId: PluginSurfaceId): TuiProvidedPluginServices => (
    pluginSurfaceWants(surfaceId, 'session-fleet') ? fleetPluginServices : pluginServices
  )
  // Why a service the root offers only sometimes is missing right now.
  const pluginServiceGaps = useMemo((): Partial<Record<PluginServiceId, string>> => ({
    ...(canUseChannelBridge ? {} : { 'channel-bridge': 'Select a Claude session to use the channel bridge' }),
    ...(canUseIdeBridge ? {} : { 'ide-bridge': 'Select a Claude session to use the IDE bridge' }),
  }), [canUseChannelBridge, canUseIdeBridge])
  // An overlay whose service went away closes, as the bridge panels did when the session stopped being Claude's.
  useEffect(() => {
    if (pluginOverlay && getPluginSurface(pluginOverlay).services.some((id) => pluginServiceGaps[id])) setPluginOverlay(null)
  }, [pluginOverlay, pluginServiceGaps])
  const {
    pluginSessionFor, pluginLiveTranscript, windowPluginServices, closeFolderPicker,
    folderPickerServices, registerFolderPickerKeys, surfacePluginCaptureChange, closePluginOverlay,
    openFileHistory, closeFileHistory, registerFileHistoryKeys, fileHistoryServices, openEditorAt,
  } = usePluginSessionForGroup({
    pinnedSessionOf, selectedSession, pluginOpenRequests, selectedSessionKey,
    liveTranscriptMessagesForSession, pluginServices, windowShellSelectionRef,
    setFolderPickerForNewSession, handleNewSessionFolderSelected, folderPickerKeyHandlerRef,
    surfacePluginKeyCaptureRef, pluginOverlay, setEditorInitialPath, setEditorInitialLine,
    setCheckpointFocusPrompt, setPluginOverlay, showNotice, openPopoverWindow, setFileHistoryPath,
    fileHistoryKeyHandlerRef, askAgentAboutSelection,
  })
  // Turning a plugin off closes its overlay; its windows say it is off.
  useEffect(() => {
    if (pluginOverlay && disabledPlugins.has(getPluginSurface(pluginOverlay).pluginId)) setPluginOverlay(null)
    if (fileHistoryPath && disabledPlugins.has('file-history')) setFileHistoryPath(null)
  }, [pluginOverlay, fileHistoryPath, disabledPlugins])
  // The teammates panel is the store's, so any opener (⌃K t, the attention
  // badge) can raise it: with its plugin off it closes again and says why. The
  // team is untouched — closing the panel never stops a teammate.
  useEffect(() => {
    if (!teammatesModalOpen || !disabledPlugins.has(getPluginSurface('teammates').pluginId)) return
    showNotice('info', 'Teammates are off · turn Coordination on in Plugins (⌃K palette)')
    closeInteractiveCoordinator()
  }, [teammatesModalOpen, disabledPlugins])
  const {
    registerTeammatesKeys, offerTeammatesPlacement, registerPluginOverlayKeys,
    pluginSelectedDetail, offerPopoverPlacement, returnPopoverWindow, moveSurfaceToPanel,
    currentWindowLayoutAction,
  } = useRegisterTeammatesKeysGroup({
    teammatesKeyHandlerRef, pluginOverlayKeyHandlerRef, selectedSessionKey, sessionDetail,
    openPopoverWindow, setPopoverOpen, openSurfaceWindow, setContextMenu, width, openPopoverTab,
    openPopoverInNewTab, readerPin, pinnedSessionOf, windowSurfaceMeta, workspaceContext,
    returningPopoverRef, closeSurfaceWindow, openTabByKey, setOpenTabSessions, selectTabSession,
    surfacePanel, gitRepoCwd, setSurfacePanelOpen, setSurfacePanelFocused, setSurfacePanel,
    reconciledSplitTree, visibleSplitPaneCount, splitArrangement, stackedSplit, splitReaderLast,
  })

  const planPaneArrangement = (action: WindowLayoutAction) => {
    const focused = splitFocusIndex ?? 0
    if (action.startsWith('reader-')) return movePaneToEdge(currentPaneTree(), focused, action.slice(7) as 'left' | 'right' | 'top' | 'bottom')
    const wanted = action === 'two' ? 2 : action === 'grid-six' ? 6 : action === 'grid' ? 4 : 3
    const keys = [...orderedWindowKeys]
    const candidates = [...openTabSessions, ...sessions].filter((session, index, all) => all.findIndex(entry => sessionKey(entry) === sessionKey(session)) === index)
    if (keys.some(key => !isSurfaceWindowKey(key))) for (const candidate of candidates) {
      if (keys.length >= wanted) break
      const key = sessionKey(candidate)
      if (!keys.includes(key) && !parkedWindowKeysRef.current.has(key)) keys.push(key)
    }
    return arrangePaneTree(keys, false, action === 'main-stack' ? 'stack' : action === 'grid' || action === 'grid-six' ? 'grid' : 'columns', focused)
  }
  const applyWindowLayout = useStableEvent((action: WindowLayoutAction) => {
    setWindowSurfacePeek(null)
    setWindowPickerOpen(false)
    if (action === 'fullscreen') { presentWindow('fullscreen'); return }
    if (action === 'fill') { presentWindow('zoom'); return }
    const next = planPaneArrangement(action)
    if (!next) { showNotice('info', 'Open a pane before choosing a layout'); return }
    checkpointWindowLayout()
    setWindowZoom(null)
    const additions = [...openTabSessions, ...sessions].filter(session => next.keys.includes(sessionKey(session)))
    setOpenTabSessions(current => [...current, ...additions.filter(session => !current.some(tab => sessionKey(tab) === sessionKey(session)))])
    commitWindowKeys(next.keys, next)
  })

  const applyWindowSessionDrop = useStableEvent((session: Session, drop: WindowSessionDrop) => {
    const key = sessionKey(session)
    const plan = planWindowSessionDrop({
      arrangement: splitArrangement, orientation: splitOrientation,
      readerLast: splitReaderLast, count: splitPaneCount, pins: splitPinnedKeys,
    }, key, drop)
    if (!plan) { showNotice('info', 'The layout is full · drop on a pane’s middle to replace it'); return }
    checkpointWindowLayout()
    setOpenTabSessions((prev) => prev.some((tab) => sessionKey(tab) === key) ? prev : [...prev, session])
    setSplitPinnedKeys(plan.pins)
    setWindowArrangement(plan.arrangement, plan.readerLast)
    applySplitOrientation(plan.orientation, true)
    setSplitPaneCount(plan.count)
    void writeTuiSplitPanes(plan.count).catch(() => {})
    showNotice('info', `${fitText(formatSessionTitle(session), 40).trimEnd()} · window moved`)
  })

  // Replace window `index` with `session`; a session already in another pane swaps with it.
  // Drop plans work on the pins, so a window index becomes its session's pin index.
  const dropSessionOnPane = useStableEvent((session: Session, index: number, fromPane: number | null) => {
    const pin = pinIndexOfWindow(index)
    if (fromPane !== index && pin >= 0) applyWindowSessionDrop(session, { kind: 'replace', index: pin })
  })
  const insertSessionBesidePane = useStableEvent((session: Session, index: number, edge: WindowDropZone) => {
    const pin = pinIndexOfWindow(index)
    if (pin >= 0) applyWindowSessionDrop(session, { kind: 'insert', index: pin, edge })
  })

  // Lay out exactly `keys` (every window in display order): the pins, the
  // surface windows and the slot order all follow from it. Tabs and floating
  // windows are moved by handing this a list with them in or out.
  const commitWindowKeys = useStableEvent((keys: string[], tree?: WindowSplitTree) => {
    const sessionKeys = keys.filter((key) => !isSurfaceWindowKey(key))
    setWindowOrder(keys)
    setWindowSurfaces(keys.filter(isSurfaceWindowKey).map(surfaceIdOfKey))
    setSplitPinnedKeys(sessionKeys)
    setSplitPaneCount(sessionKeys.length)
    void writeTuiSplitPanes(sessionKeys.length).catch(() => {})
    if (tree) setWindowSplitTree(tree)
    else if (!windowSplitTree && splitArrangement === 'split' && keys.length > SPLIT_PANE_MAX) setWindowArrangement('main-stack', splitReaderLast)
  })
  const windowKeyTitle = (key: string) => (isSurfaceWindowKey(key)
    ? surfaceTitle(surfaceIdOfKey(key))
    : (() => { const session = openTabByKey.get(key) ?? sessions.find((entry) => sessionKey(entry) === key); return session ? formatSessionTitle(session) : key })())
  // `key` becomes a tab of `anchor`'s frame, and the frame shows it.
  const tabWindowOnto = useStableEvent((key: string, anchor: string, session?: Session) => runTabWindowOnto({
    shownPopoverTab, checkpointWindowLayout, liveWindowStacks, laidOutWindowKeys, currentPaneTree,
    closePopoverTab, setWindowZoom, setWindowStacks, orderedWindowKeys, commitWindowKeys,
    setOverviewPendingTarget, openTabByKey, setOpenTabSessions, floatingKey, setFloatingWindow,
    shownFirstWindowKeys, showNotice, windowKeyTitle,
  }, key, anchor, session))
  // Show tab `key` in its frame.
  const activateWindowTab = useStableEvent((key: string) => {
    const stack = windowStackFor(key)
    const frame = stack?.find((member) => laidOutWindowKeys.has(member))
    if (!stack || !frame || frame === key) return
    checkpointWindowLayout()
    if (windowPresentation) setWindowPresentation({ ...windowPresentation, target: key })
    commitWindowKeys(replaceWindowKey(shownFirstWindowKeys(), frame, key))
    if (!isSurfaceWindowKey(key)) {
      setComposerPaneTargetKey(key)
      setSelectedSessionKey(key)
      const index = windowItems.findIndex(item => windowItemKey(item) === frame)
      if (index >= 0) setSplitFocusIndex(index)
      setFocusedPane('messages')
    }
  })
  const stepWindowTab = useStableEvent((delta: number) => {
    const item = focusedWindowItem
    const key = item ? windowItemKey(item) : null
    const stack = key ? windowStackFor(key) : null
    const next = key && stack ? stackNeighbour(stack, key, delta) : null
    if (!next) { showNotice('info', 'This window has no other tabs · ⌃B t makes it a tab of the one before'); return }
    activateWindowTab(next)
  })
  const dropWindowSurfaceState = (key: string) => {
    if (!isSurfaceWindowKey(key)) return
    windowSurfaceKeysRef.current.delete(surfaceIdOfKey(key))
    windowSurfaceCaptureRef.current.delete(surfaceIdOfKey(key))
  }
  // Close one tab: the frame goes on showing the next one.
  const closeWindowTab = useStableEvent((key: string, remember = true) => {
    const stack = windowStackFor(key)
    if (!stack) return
    if (remember) rememberClosedWindow(key)
    checkpointWindowLayout()
    setWindowStacks(removeFromStack(liveWindowStacks, key))
    if (laidOutWindowKeys.has(key)) {
      const successor = stackSuccessor(stack, key)
      if (successor) commitWindowKeys(replaceWindowKey(shownFirstWindowKeys(), key, successor))
    }
    dropWindowSurfaceState(key)
  })
  // ⌃B ! — the tab leaves its frame and becomes a window of its own beside it.
  const breakOutWindowTab = useStableEvent((key: string) => runBreakOutWindowTab({
    windowStackFor, showNotice, laidOutWindowKeys, currentPaneTree, readerAreaWidth,
    windowAreaHeight, splitTreeLimits, checkpointWindowLayout, setWindowStacks, liveWindowStacks,
    setWindowZoom, commitWindowKeys, setOverviewPendingTarget, floatWindowKey,
  }, key))
  // ⌃B t — the focused window becomes a tab of the window before it.
  const tabFocusedWindow = useStableEvent((target: number | null = splitFocusIndex) => {
    if (target === null && shownPopoverTab && windowItems[0]) {
      const id = shownPopoverTab
      checkpointWindowLayout(); closePopoverTab(id, true)
      tabWindowOnto(surfaceWindowKey(id), windowItemKey(windowItems[0]))
      return
    }
    if (target === FLOATING_PANE_INDEX && floatingKey && windowItems[0]) { tabWindowOnto(floatingKey, windowItemKey(windowItems[0])); return }
    if (target === null || target === FLOATING_PANE_INDEX || !windowItems[target]) {
      showNotice('info', 'Open another pane to create a tab group')
      return
    }
    const anchor = windowItems[target === 0 ? 1 : target - 1]
    if (!anchor) { showNotice('info', 'No other window to join'); return }
    const key = windowItemKey(windowItems[target]!)
    tabWindowOnto(key, windowItemKey(anchor))
    setSplitFocusIndex(Math.max(0, target === 0 ? 0 : target - 1))
  })

  // ⌃B f — the focused window floats over the layout; again, it docks back.
  const floatWindowKey = useStableEvent((key: string, session?: Session) => {
    checkpointWindowLayout()
    const area = windowAreaRect() ?? { width: readerAreaWidth, height: windowAreaHeight }
    let keys = shownFirstWindowKeys()
    if (floatingKey) keys = [...keys, floatingKey]
    const stack = windowStackFor(key)
    if (stack) {
      setWindowStacks(removeFromStack(liveWindowStacks, key))
      const successor = laidOutWindowKeys.has(key) ? stackSuccessor(stack, key) : null
      if (successor) keys = replaceWindowKey(keys, key, successor)
    }
    if (session && !openTabByKey.has(key)) setOpenTabSessions((prev) => prev.some(tab => sessionKey(tab) === sessionKey(session)) ? prev : [...prev, session])
    const slot = keys.indexOf(key)
    commitWindowKeys(keys.filter((entry) => entry !== key))
    setFloatingWindow({ key, slot: slot < 0 ? fittedWindowKeys.length : slot, rect: floatingWindow?.key === key ? clampFloatingRect(floatingWindow.rect, area) : defaultFloatingRect(area) })
    setWindowZoom(null)
    setFocusedPane('messages')
    setSplitFocusIndex(FLOATING_PANE_INDEX)
    showNotice('info', `${fitText(windowKeyTitle(key), 40).trimEnd()} floats · drag its title, ◢ resizes · ⌃B f docks it`)
  })
  const dockFloatingWindow = useStableEvent(() => {
    if (!floatingKey) return
    checkpointWindowLayout()
    // Back in its old slot, and among the windows shown: past them it would dock out of sight.
    const keys = shownFirstWindowKeys()
    keys.splice(Math.min(floatingWindow?.slot ?? keys.length, fittedWindowKeys.length), 0, floatingKey)
    commitWindowKeys(keys)
    setFloatingWindow(null)
    if (isSurfaceWindowKey(floatingKey)) pendingSurfaceFocusRef.current = surfaceIdOfKey(floatingKey)
    else setSplitFocusIndex(null)
    setOverviewPendingTarget(floatingKey)
  })
  const closeFloatingWindow = useStableEvent((remember = true) => {
    if (!floatingKey) return
    if (remember) rememberClosedWindow(floatingKey)
    checkpointWindowLayout()
    dropWindowSurfaceState(floatingKey)
    setFloatingWindow(null)
    if (splitFocusIndex === FLOATING_PANE_INDEX) setSplitFocusIndex(hasPrimaryFrame ? null : windowItems.length ? 0 : null)
  })
  const toggleFloatingFocused = useStableEvent((target: number | null = splitFocusIndex) => {
    if (target === null && shownPopoverTab) {
      const id = shownPopoverTab
      checkpointWindowLayout(); closePopoverTab(id, true); floatWindowKey(surfaceWindowKey(id)); return
    }
    if (target === FLOATING_PANE_INDEX && floatingKey) { dockFloatingWindow(); return }
    const item = target === null ? null : windowItems[target]
    if (!item) {
      if (floatingKey) { setFocusedPane('messages'); setSplitFocusIndex(FLOATING_PANE_INDEX); return }
      showNotice('info', 'Focus a pane to float it')
      return
    }
    floatWindowKey(windowItemKey(item))
  })
  // A shell straight into a floating window, like tmux's popup.
  const floatNewShell = useStableEvent(() => {
    let surface: WindowSurfaceId = 'terminal'
    const taken = new Set([...windowSurfaces, ...popoverTabs, ...[...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)])
    for (let instance = 2; taken.has(surface); instance += 1) surface = `terminal#${instance}`
    floatWindowKey(surfaceWindowKey(surface))
  })
  const startFloatGesture = (mode: 'move' | 'resize', event: { x: number; y: number }) => {
    if (!floatingWindow || floatGestureRef.current || windowPresentation) return
    floatGestureRef.current = { mode, x: event.x, y: event.y, rect: clampFloatingRect(floatingWindow.rect, { width: readerAreaWidth, height: windowAreaHeight }) }
    setFloatGesturing(true)
  }
  // Where a floating window let go here would dock: a window's title row
  // makes it a tab there, the window area's outer edge puts it back in the layout.
  const floatDockTarget = (point: { x: number; y: number }): { kind: 'tab'; pane: number } | { kind: 'edge' } | null => {
    const area = windowAreaRect()
    if (!area) return null
    const target = dropTargetAt(point)
    // A title row, not a window's middle: a float is moved over windows all the
    // time, and letting go there must leave it floating where it was put.
    if (target.pane !== null && target.title) return { kind: 'tab', pane: target.pane }
    if (point.x <= area.x || point.x >= area.x + area.width - 1 || point.y >= area.y + area.height - 1) return { kind: 'edge' }
    return null
  }
  const [floatDockHint, setFloatDockHint] = useState<{ label: string; rect: { x: number; y: number; width: number; height: number }; x: number; y: number } | null>(null)
  const moveFloatGesture = (event: { x: number; y: number }) => runMoveFloatGesture({
    floatGestureRef, floatingWindow, checkpointWindowLayout, floatDockTarget, windowAreaRect,
    rectOf, dropTargetAt, nestedDropPlan, setFloatDockHint, windowNumberOffset, readerAreaWidth,
    windowAreaHeight, setFloatingWindow,
  }, event)
  floatGestureImplRef.current = { start: (event) => startFloatGesture('move', event), move: (event) => moveFloatGesture(event), end: (event) => endFloatGesture(event) }
  const endFloatGesture = (event?: { x: number; y: number }) => runEndFloatGesture({
    floatGestureRef, setFloatGesturing, setFloatDockHint, floatingKey, dropTargetAt,
    nestedDropPlan, setFloatingWindow, applyNestedDrop, floatDockTarget, windowItems,
    tabWindowOnto, windowItemKey, dockFloatingWindow,
  }, event)
  // Esc during a drag puts everything back as it was when the drag started.
  const cancelPointerGesture = () => runCancelPointerGesture({
    treeDividerDrag, setTreeDividerDrag, treeDividerActivePathRef, treeDividerCheckpointedRef,
    undoWindowLayout, floatGestureRef, setFloatGesturing, setFloatDockHint, setFloatingWindow,
    sessionPressRef, setSessionPressing, setSessionDrag, splitDividerDragging, splitDividerPoint,
    setSplitDividerDragging, setSplitDividerPoint,
  })

  // Set the window order and keep the pins in the same order: sessions fill
  // their slots in pin order, so a pin order that disagreed would undo the move.
  // Visible sessions lead the pins, so a move among them never changes which
  // sessions fit; the hidden ones keep their pin order behind them.
  const applyWindowOrder = useStableEvent((next: string[]) => {
    setWindowOrder(next)
    const shown = new Set(fittedWindowKeys)
    const sessionsInOrder = next.filter((key) => !isSurfaceWindowKey(key) && shown.has(key))
    setSplitPinnedKeys((current) => [...sessionsInOrder, ...current.filter((key) => !sessionsInOrder.includes(key))])
  })
  // The windows on screen, then the hidden ones: every move is made on this,
  // so a hidden session's slot between two visible windows cannot pull a
  // visible session into the place another window was moved to.
  const shownFirstWindowKeys = () => [...fittedWindowKeys, ...orderedWindowKeys.filter((key) => !fittedWindowKeys.includes(key))]
  // Exchange two windows (by window index); either may be a surface.
  const swapWindows = useStableEvent((a: number, b: number) => {
    const keyA = windowItems[a] ? windowItemKey(windowItems[a]!) : null
    const keyB = windowItems[b] ? windowItemKey(windowItems[b]!) : null
    if (!keyA || !keyB || keyA === keyB) return
    checkpointWindowLayout()
    const base = shownFirstWindowKeys()
    applyWindowOrder(swapWindowSlots(base, base.indexOf(keyA), base.indexOf(keyB)))
  })
  // A surface window dragged by its title: the middle of another window swaps
  // the two, an edge puts it beside that window, the reader cannot take it.
  const dropSurfaceWindow = useStableEvent((fromPane: number, target: { zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null }, point?: { x: number; y: number }) => {
    if (target.pane === null) {
      // Only a session can be in the reader; a surface let go over it floats there.
      const moving = windowItems[fromPane]
      if (target.zone && point && moving?.kind === 'surface') floatSurfaceAt(moving.surface, point)
      return
    }
    if (target.pane === fromPane) return
    if (!target.insert) { swapWindows(fromPane, target.pane); setSplitFocusIndex(target.pane); return }
    const moving = windowItems[fromPane]
    const anchor = windowItems[target.pane]
    if (!moving || !anchor) return
    checkpointWindowLayout()
    const before = target.insert === 'left' || target.insert === 'top'
    applyWindowOrder(moveWindowBeside(shownFirstWindowKeys(), windowItemKey(moving), windowItemKey(anchor), before))
    pendingSurfaceFocusRef.current = moving.kind === 'surface' ? moving.surface : null
  })
  // A session dropped on a surface window: a session already in a pane trades
  // places with it; one from the rail or a tab becomes a pane beside it.
  const dropSessionOnSurfaceWindow = useStableEvent((session: Session, index: number, edge: WindowDropZone | null, fromPane: number | null) => runDropSessionOnSurfaceWindow({
    windowItems, swapWindows, checkpointWindowLayout, applyWindowOrder, shownFirstWindowKeys,
    splitPinnedKeys, splitPaneCount, splitArrangement, splitOrientation, splitReaderLast,
    stackedSplit, showNotice, setOpenTabSessions, setWindowArrangement, applySplitOrientation,
    setSplitPaneCount, setWindowOrder, setSplitPinnedKeys,
  }, session, index, edge, fromPane))

  const rectOf = (id: string) => {
    // A popover tab holds the reader's place, so the reader's frame is the tab's
    // (the transcript behind it is hidden and has no size of its own).
    const box = renderer.root.findDescendantById(id === 'transcript-reader' && shownPopoverTab ? 'popover-tab-frame' : id) as unknown as { x: number; y: number; width: number; height: number } | null
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }
  const inside = (rect: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }) =>
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  const {
    dropTargetAt, windowAreaRect, dropSessionInWindow, floatSurfaceAt, nestedDropPlan,
    applyNestedDrop, nestedDragPreview, projectedWindowGeometry,
  } = useDropTargetAtGroup({
    visibleSplitPaneCount, renderer, rectOf, inside, windowAreaRef, checkpointWindowLayout,
    selectTabSession, selectSidebarSession, splitFocusIndex, windowItems, hasPrimaryFrame,
    floatWindowKey, setFloatingWindow, windowZoom, fullscreenMode, orderedWindowKeys,
    fittedWindowKeys, windowItemKey, fittedWindows, readerAreaWidth, windowAreaHeight,
    splitOrientation, splitReaderLast, reconciledSplitTree, windowStackFor, shownPopoverTab,
    splitTreeLimits, showNotice, openTabByKey, setOpenTabSessions, setWindowStacks,
    liveWindowStacks, floatingKey, commitWindowKeys, setOverviewPendingTarget, sessionDrag,
    windowPickerOpen, windowLayoutPreview, primaryLeaf, splitArrangement, splitPaneCount,
    splitReaderShare, splitSecondaryShare, splitBottomShare, splitWeights, windowSurfaces,
    floatingWindow, selectedSessionKey, pinIndexOfWindow, splitPinnedKeys, savedWindowLayouts,
    sessions, openTabSessions, surfaceRestorable, planPaneArrangement, windowBudgetHeight,
  })

  splitPaneActionsRef.current = {
    close: (paneIndex) => closeSplitPane(paneIndex),
    promote: (session) => { const index = windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === sessionKey(session)); if (index >= 0) toggleWindowZoom(index) },
    fullscreen: () => toggleFullscreenMode(),
    sessionMenu: (session, source, point, paneIndex) => openSessionMenu(session, source, point, paneIndex),
  }
  sessionDragImplRef.current = {
    press: (session, fromPane, event, onClick) => {
      // A floating window's title moves the window rather than dragging its session.
      if (fromPane === FLOATING_PANE_INDEX) { startFloatGesture('move', event); return }
      sessionPressRef.current = { session, fromPane, x: event.x, y: event.y, dragging: false, onClick }
      setSessionPressing(true)
    },
    pressSurface: (surface, fromPane, event) => {
      sessionPressRef.current = { session: null, surface, fromPane, x: event.x, y: event.y, dragging: false }
      setSessionPressing(true)
    },
    pressTab: (key, fromPane, event, onClick) => {
      sessionPressRef.current = { session: null, tab: key, fromPane, x: event.x, y: event.y, dragging: false, onClick }
      setSessionPressing(true)
    },
    pressReader: (session, event) => {
      sessionPressRef.current = { session, reader: true, fromPane: null, x: event.x, y: event.y, dragging: false }
      setSessionPressing(true)
    },
    move: (event) => {
      const press = sessionPressRef.current
      if (!press) return
      // Two cells of travel make it a drag, so a slightly shaky click is still a click.
      if (!press.dragging && Math.abs(event.x - press.x) + Math.abs(event.y - press.y) < 2) return
      press.dragging = true
      const target = dropTargetAt(event)
      setSessionDrag({ session: press.session, surface: press.surface, tab: press.tab, reader: press.reader, fromPane: press.fromPane, ...target, x: event.x, y: event.y })
    },
    release: (event) => {
      const press = sessionPressRef.current
      sessionPressRef.current = null
      setSessionPressing(false)
      if (!press) return
      if (!press.dragging) {
        press.onClick?.()
        return
      }
      setSessionDrag(null)
      const target = dropTargetAt(event)
      const targetKey = target.pane !== null && windowItems[target.pane] ? windowItemKey(windowItems[target.pane]!) : null
      const movingKey = press.tab ?? (press.session ? sessionKey(press.session) : press.surface ? surfaceWindowKey(press.surface) : null)
      const sameFrame = (key: string | null) => key !== null && movingKey !== null && (key === movingKey || Boolean(windowStackFor(key)?.includes(movingKey)))
      if (press.reader && movingKey) {
        const edge = target.pane === null ? target.zone : target.insert
        if (edge && edge !== 'center' && !target.title) applyNestedDrop(movingKey, target, press.session ?? undefined)
        else if (targetKey) tabWindowOnto(movingKey, targetKey, press.session ?? undefined)
        return
      }
      const primaryKey = shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null
      if (movingKey && primaryKey && target.pane === null && target.zone === 'center') {
        tabWindowOnto(movingKey, primaryKey, press.session ?? undefined)
        return
      }
      const edge = target.pane === null ? target.zone : target.insert
      if (movingKey && edge && edge !== 'center' && !target.title) {
        applyNestedDrop(movingKey, target, press.session ?? undefined)
        return
      }
      if (movingKey && targetKey && !target.insert) {
        if (!sameFrame(targetKey)) tabWindowOnto(movingKey, targetKey, press.session ?? undefined)
        return
      }
      // A tab dragged out of its strip: onto another window it joins that
      // window's tabs, anywhere else it becomes a window of its own.
      if (press.tab) {
        if (sameFrame(targetKey)) return
        if (targetKey) tabWindowOnto(press.tab, targetKey)
        else breakOutWindowTab(press.tab)
        return
      }
      // Onto a window's title row: a tab of that window.
      if (target.title && targetKey && movingKey) {
        if (!sameFrame(targetKey)) tabWindowOnto(movingKey, targetKey, press.session ?? undefined)
        return
      }
      if (!press.session) {
        if (press.surface && press.fromPane !== null) dropSurfaceWindow(press.fromPane, target, event)
        return
      }
      if (target.pane !== null && windowItems[target.pane]?.kind === 'surface') {
        dropSessionOnSurfaceWindow(press.session, target.pane, target.insert, press.fromPane)
        return
      }
      if (target.pane !== null && target.insert) insertSessionBesidePane(press.session, target.pane, target.insert)
      else if (target.pane !== null) dropSessionOnPane(press.session, target.pane, press.fromPane)
      else if (target.zone) dropSessionInWindow(press.session, target.zone, press.fromPane)
    },
  }
  const {
    dragSplitDivider, endSplitDividerDrag, toggleSplitPanes, applySplitOrientation,
    rotateSplitOrientation,
  } = useDragSplitDividerGroup({
    splitDividerPoint, checkpointWindowLayout, windowAreaRect, setSplitDividerPoint,
    splitDividerDragging, fittedWindows, rectOf, setSplitWeights, splitSecondaryShare,
    setSplitSecondaryShare, stackedSplit, splitReaderLast, splitReaderShare, setSplitReaderShare,
    setSplitDividerDragging, splitArrangement, splitBottomShare, splitWeights, splitPaneCount,
    applySplitPaneCount, splitCandidateSessions, showNotice, splitOrientation, setSplitOrientation,
    setError, reconciledSplitTree, splitFocusIndex, setWindowSplitTree,
  })

  const resizeSplitReader = useStableEvent((direction: 1 | -1 | 0) => runResizeSplitReader({
    reconciledSplitTree, checkpointWindowLayout, setWindowSplitTree, resizeTreeWindow,
    visibleSplitPaneCount, showNotice, splitReaderShare, setSplitReaderShare, setError,
    splitOrientation,
  }, direction))

  // ── Split pane focus ───────────────────────────────────────────────────────
  // Focus is a third keyboard owner alongside the sidebar and the reader. It is
  // an index rather than a session key so a pane keeps focus when its pinned
  // session changes under it (⌃B n).
  const focusSplitPane = useStableEvent((paneIndex: number) => {
    const nextTarget = paneIndex === popoverHostSlot && shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : presentationResolverRef.current(paneIndex)
    if (windowPresentation && nextTarget) {
      setWindowPresentation({ ...windowPresentation, target: nextTarget })
      if (isSurfaceWindowKey(nextTarget)) setComposerActive(false)
    }
    // The window a popover tab took shows the tab: focusing it focuses the tab.
    if (paneIndex >= 0 && paneIndex === popoverHostSlot) { setWindowSurfacePeek(null); setSplitFocusIndex(null); setFocusedPane('messages'); return }
    if (paneIndex < 0 || (paneIndex >= visibleSplitPaneCount && !(paneIndex === FLOATING_PANE_INDEX && floatingKey))) return
    setWindowSurfacePeek(null)
    lastFocusedSplitPaneRef.current = paneIndex
    setSplitFocusIndex(paneIndex)
    const focused = paneIndex === FLOATING_PANE_INDEX ? floatingItem : windowItems[paneIndex]
    if (focused?.kind === 'session') {
      const key = sessionKey(focused.session)
      setComposerPaneTargetKey(key)
      setSelectedSessionKey(key)
      // Entering a previewed session's window keeps it: it becomes a tab.
      setOpenTabSessions(current => current.some(tab => sessionKey(tab) === key) ? current : [...current, focused.session])
    }
    // The reader keeps its own cursor, but the sidebar must not look focused
    // while a pane owns the keys.
    setFocusedPane('messages')
  })

  const focusReaderFromSplit = useStableEvent(() => {
    setWindowSurfacePeek(null)
    if (!hasPrimaryFrame && selectedWindowIndex === FLOATING_PANE_INDEX) { focusSplitPane(FLOATING_PANE_INDEX); return }
    if (!hasPrimaryFrame && windowItems.length) { focusSplitPane(Math.max(selectedWindowIndex, 0)); return }
    setSplitFocusIndex(null)
  })

  // Every visible window participates, including a floating window and a tool tab.
  const cycleSplitFocus = useStableEvent((direction: 1 | -1) => {
    const stops: Array<number | null> = [
      ...(hasPrimaryFrame ? [null] : []),
      ...Array.from({ length: visibleSplitPaneCount }, (_, index) => index).filter((index) => index !== popoverHostSlot),
      ...(floatingKey ? [FLOATING_PANE_INDEX] : []),
    ]
    if (!stops.length) {
      showNotice('info', 'No windows open')
      return
    }
    const current = stops.indexOf(splitFocusIndex)
    const start = current < 0 ? (direction === 1 ? -1 : 0) : current
    const next = stops[(start + direction + stops.length) % stops.length]!
    if (next === null) { if (windowPresentation && shownPopoverTab) setWindowPresentation({ ...windowPresentation, target: surfaceWindowKey(shownPopoverTab) }); setWindowSurfacePeek(null); setSplitFocusIndex(null); setFocusedPane('messages') }
    else focusSplitPane(next)
  })
  // Tab moves between the rail and the transcript, as it always did from the
  // reader; ⌃B o cycles windows. Without a rail it cycles windows.
  const tabFromSplitPane = useStableEvent(() => {
    if (showRail) {
      setSplitFocusIndex(null)
      setFocusedPane('sessions')
      return
    }
    cycleSplitFocus(1)
  })
  // The rail's Tab returns to the reader, or to a pane when it is closed.
  const tabFromRail = useStableEvent(() => {
    if (floatingKey && (lastFocusedSplitPaneRef.current === FLOATING_PANE_INDEX || (!hasPrimaryFrame && !windowItems.length))) {
      focusSplitPane(FLOATING_PANE_INDEX)
      return
    }
    if (!hasPrimaryFrame && windowItems.length) {
      focusSplitPane(Math.min(lastFocusedSplitPaneRef.current, windowItems.length - 1))
      return
    }
    promotePreviewToTab()
    setFocusedPane('messages')
  })

  // Opening a popover that already has a window for this pin goes to the window:
  // a singleton must not exist twice, and two copies of one view is a surprise.
  useEffect(() => {
    const kind = openPopoverKind()
    if (!kind) return
    const parked = [...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)
    const pin = pinFor(kind, readerPin())
    const tab = findPopoverWindow(popoverTabs, windowSurfaceMeta, kind, pin)
    if (tab) { setPopoverOpen(kind, false); showPopoverTab(tab); return }
    if (!findPopoverWindow([...windowSurfaces, ...parked], windowSurfaceMeta, kind, pin)) return
    openPopoverWindow(kind, pin)
  }, [pluginOverlay, dailySummaryOpen, attentionOpen, promptLibraryOpen, playbookManagerOpen,
    handoffBriefOpen, fileHistoryPath])
  // Closed from inside its window (D, ⌃C, the panel's own close): the window goes too.
  useEffect(() => {
    if (!teammatesOpen && windowedPopoverKinds.has('teammates')) closeSurfaceWindow('teammates')
  }, [teammatesOpen, windowSurfaces])

  // A surface window just opened takes focus once it has a place in the layout.
  useEffect(() => runWindowSurfaceFocusEffect({
    pendingSurfaceFocusRef, windowItems, windowSurfaces, setWindowSurfacePeek, setSplitFocusIndex,
    setSurfacePanelFocused, showNotice, setWindowZoom: windowPresentation ? () => {} : setWindowZoom,
  }))

  // A zoom ends when the window it names goes away.
  useEffect(() => {
    if (!windowPresentation) return
    if (windowZoom === null) {
      // The target closed. Keep the close operation's nearest surviving focus.
      setWindowPresentation(null)
      presentationReturnFocus.current = null
      return
    }
    const index = windowZoom === 'reader' ? null : windowZoom
    if (splitFocusIndex !== index) setSplitFocusIndex(index)
  }, [windowPresentation?.target, windowZoom])

  const toggleWindowZoom = useStableEvent((target: number | null = splitFocusIndex) => {
    if (windowSurfacePeek) { setWindowSurfacePeek(null); setSplitFocusIndex(null); return }
    if (windowPresentation) { restoreWindowPresentation(); return }
    presentWindow('zoom', presentationResolverRef.current(target))
  })

  // ⌃B +/-: the second divider, from the keyboard.
  const resizeSecondaryDivider = useStableEvent((direction: 1 | -1) => {
    if (reconciledSplitTree && treeGeometry) {
      const divider = treeGeometry.dividers.find(entry => entry.axis === 'y')
      if (!divider) { showNotice('info', 'This layout has no horizontal divider'); return }
      const extent = divider.rect.height
      const first = Math.max(divider.minFirst, Math.min(extent - divider.minSecond, divider.firstExtent + direction * 2))
      if (first === divider.firstExtent) { showNotice('info', 'The neighbouring pane is at its minimum height'); return }
      checkpointWindowLayout()
      setWindowSplitTree({ ...reconciledSplitTree, root: updateSplitRatio(reconciledSplitTree.root, divider.path, first / extent) })
      return
    }
    checkpointWindowLayout()
    if (!arrangedVisible || splitArrangement !== 'grid' || !arrangedLayout.secondary) {
      showNotice('info', 'No row split here · it is the grid\'s · a pane resizes in its row or column with ⌃B [ ]')
      return
    }
    const base = splitSecondaryShare === SPLIT_SHARE_EVEN ? 0.5 : splitSecondaryShare
    const next = Math.min(0.8, Math.max(0.2, Math.round((base + direction * SPLIT_SHARE_STEP) * 100) / 100))
    setSplitSecondaryShare(next)
    void writeTuiWindowArrangement({ arrangement: splitArrangement, readerLast: splitReaderLast, secondaryShare: next, bottomShare: splitBottomShare, weights: splitWeights }).catch(() => {})
    showNotice('info', `Top row ${Math.round(next * 100)}% of the height`)
  })

  // ⌃B [ ]: shrink or grow the focused pane within its row or column, against its neighbour.
  const resizeFocusedWindow = useStableEvent((direction: 1 | -1, focus: number | null = splitFocusIndex) => runResizeFocusedWindow({
    splitFocusIndex, reconciledSplitTree, resizeTreeWindow, fittedWindows, showNotice,
    checkpointWindowLayout, splitWeights, setSplitWeights, splitArrangement, splitReaderLast,
    splitSecondaryShare, splitBottomShare,
  }, direction, focus))

  // ⌃B ⇧arrows: swap the focused window with the one that way; focus moves with it.
  const swapWindowInDirection = useStableEvent((direction: WindowDirection, target: number | null = splitFocusIndex) => runSwapWindowInDirection({
    splitFocusIndex, checkpointWindowLayout, visibleSplitPaneCount, showNotice, rectOf,
    setWindowSplitTree, currentPaneTree, focusReaderFromSplit, focusSplitPane,
  }, direction, target))

  // ⌃B arrows: the window in that direction, by where the frames actually are.
  const focusWindowInDirection = useStableEvent((direction: WindowDirection) => {
    if (visibleSplitPaneCount === 0) {
      showNotice('error', 'No split panes open (⌃B % to split)')
      return
    }
    const windows: Array<{ id: number | null; rect: { x: number; y: number; width: number; height: number } }> = []
    const reader = rectOf('transcript-reader')
    if (reader) windows.push({ id: null, rect: reader })
    for (let index = 0; index < visibleSplitPaneCount; index += 1) {
      const pane = rectOf(`split-pane:${index}`)
      if (pane) windows.push({ id: index, rect: pane })
    }
    // The reader goes in as -1: the helper answers null for "nothing that way".
    const found = windowInDirection(windows.map((window) => ({ id: window.id ?? -1, rect: window.rect })), splitFocusIndex ?? -1, direction)
    const next = found === -1 ? null : found
    if (found === null) {
      showNotice('info', `No window ${direction === 'up' ? 'above' : direction === 'down' ? 'below' : `to the ${direction}`}`)
      return
    }
    if (next === null) focusReaderFromSplit()
    else focusSplitPane(next)
  })

  // ⌃B ; — flip between the reader and the pane you were last in.
  const toggleSplitFocus = useStableEvent(() => {
    if (splitFocusIndex !== null) {
      focusReaderFromSplit()
      return
    }
    if (visibleSplitPaneCount === 0) {
      showNotice('error', 'No split panes open (⌃B % to split)')
      return
    }
    focusSplitPane(Math.min(lastFocusedSplitPaneRef.current, visibleSplitPaneCount - 1))
  })

  // Aim the composer at a pane's session. The override is explicit (not implied
  // by focus) so a send can never be misdirected by where the cursor happens to
  // be; it clears when the composer closes.
  const composeToSplitPaneSession = useStableEvent((target: Session) => {
    const retargeted = sessionKey(target) !== composerTargetSessionIdentity
    setComposerPaneTargetKey(sessionKey(target))
    setComposerActive(true)
    // Said only when it changes where the composer sends.
    if (retargeted) showNotice('info', `Composer → ${formatSessionTitle(target)}`)
  })

  // Session-scoped overlays, opened for a pane. Git is cwd-scoped and
  // diagnostics takes a target.
  const openSplitPaneOverlay = useStableEvent((kind: 'git' | 'diagnostics', target: Session | null) => {
    if (!target) return
    if (kind === 'git') { runPluginCommandId('git'); return }
    openDiagnostics(target)
  })

  // Promote the focused pane's session to the active tab. The pin reconciler
  // then hands that pane the session the reader just left, so the pair swaps
  // rather than both showing the same transcript.
  const openFocusedSplitPane = useStableEvent(() => {
    toggleWindowZoom(splitFocusIndex)
  })

  // Advance the FOCUSED pane (or the first, from the reader) to the next tab no
  // pane is already showing. Only that pane moves — the others keep their
  // pinned sessions, so cycling reads as "flip through the rest" instead of
  // scrambling every pane.
  const cycleSplitPaneSession = useStableEvent(() => runCycleSplitPaneSession({
    checkpointWindowLayout, splitPaneCount, showNotice, splitCandidateSessions, splitFocusIndex,
    pinIndexOfWindow, setSplitPinnedKeys: action => {
      const next = typeof action === 'function' ? action(splitPinnedKeys) : action
      const pin = splitFocusIndex === null ? 0 : pinIndexOfWindow(splitFocusIndex)
      if (windowPresentation && next[pin] && next[pin] !== splitPinnedKeys[pin]) setWindowPresentation({ ...windowPresentation, target: next[pin]! })
      setSplitPinnedKeys(next)
    },
  }))

  const jumpToNextWindowAttention = useStableEvent(() => {
    const order = [...(selectedSessionKey ? [selectedSessionKey] : []), ...splitPinnedKeys]
    const target = nextWindowNeedingAttention(order, focusedWindowKey, (key) => Boolean(badgeForWindow(key)))
    if (!target) { showNotice('info', 'No windows need attention'); return }
    pickWindowTarget(target)
  })

  const pickWindowTarget = useStableEvent((key: string) => {
    if (windowPresentation && windowTargets.some(target => target.key === key)) setWindowPresentation({ ...windowPresentation, target: key })
    runPickWindowTarget({
    windowTargets, showNotice, floatingKey, setWindowSwitcherOpen, setFocusedPane,
    setSplitFocusIndex, parkedWindowKeysRef, activateWindowTab, pendingSurfaceFocusRef,
    popoverTabs, showPopoverTab, setWindowZoom: windowPresentation ? () => {} : setWindowZoom, setWindowSurfacePeek, setSurfacePanelFocused,
    windowItems, focusSplitPane, splitPinnedKeys, watchedCoordinator, splitPaneSessions,
    selectedSessionKey, checkpointWindowLayout, setSplitPinnedKeys, setWindowOrder,
    selectedSession, setOpenTabSessions, selectTabSession, focusReaderFromSplit,
  }, key)
  })
  const sendBroadcastPrompt = useStableEvent(async (session: Session, text: string, requestId: string): Promise<BroadcastDelivery> => {
    const key = sessionKey(session)
    const permissionMode = session.provider === 'claude' ? tuiPermissionModeByKey[key] ?? 'auto'
      : session.provider === 'copilot' ? tuiCopilotPermissionModeByKey[key] ?? 'off' : undefined
    const { sendWindowBroadcastPrompt } = await import('./windowBroadcastDelivery')
    return sendWindowBroadcastPrompt(session, text, requestId, {
      model: tuiModelOverride[key] || undefined,
      effort: tuiEffort === 'auto' ? undefined : tuiEffort,
      permissionMode,
      manualPermissions: session.provider === 'copilot' || (session.provider === 'claude' && permissionMode !== 'bypassPermissions' && permissionMode !== 'plan') ? true : undefined,
      additionalDirectories: session.provider === 'claude' ? tuiAddedDirsByKeyRef.current[key] : undefined,
      collaborationMode: session.provider === 'codex' ? tuiCodexModeByKey[key] : undefined,
      approvalPolicy: session.provider === 'codex' && tuiCodexApprovalByKey[key] !== 'auto' ? tuiCodexApprovalByKey[key] : undefined,
      agent: session.provider === 'opencode' ? tuiOpenCodeAgent || undefined : undefined,
      mode: session.provider === 'copilot' ? tuiCopilotMode : undefined,
      contextTier: session.provider === 'copilot' && tuiCopilotContextTierByKey[key] !== 'default' ? tuiCopilotContextTierByKey[key] : undefined,
    })
  })

  const executeCommandPalette = useStableEvent((id: string) => runExecuteCommandPalette({
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
  }, id))

  const [recentWindowVisits, setRecentWindowVisits] = useAppState<Array<{ workspaceId: string; target: string }>>('recentWindowVisits', [])
  const [recentWindowsOnly, setRecentWindowsOnly] = useState(false)
  const [windowFocusTrail, setWindowFocusTrail] = useWorkspaceState<string[]>('windowFocusTrail', [], false)
  const currentVisitKey = splitFocusIndex === null ? (shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null) : splitFocusIndex === FLOATING_PANE_INDEX ? floatingKey : windowItems[splitFocusIndex] ? windowItemKey(windowItems[splitFocusIndex]!) : null
  useEffect(() => {
    if (!currentVisitKey) return
    setWindowFocusTrail(previous => previous[0] === currentVisitKey ? previous : [currentVisitKey, ...previous.filter(key => key !== currentVisitKey)].slice(0, 32))
    setRecentWindowVisits(previous => previous[0]?.workspaceId === workspaceId && previous[0]?.target === currentVisitKey ? previous : [{ workspaceId, target: currentVisitKey }, ...previous.filter(visit => visit.workspaceId !== workspaceId || visit.target !== currentVisitKey)].slice(0, 50))
  }, [currentVisitKey, workspaceId])
  const focusPreviousWindow = useStableEvent(() => {
    const previous = windowFocusTrail.find(key => key !== currentVisitKey && controlWindowIndex(key) !== undefined)
    if (previous) focusControlWindow(previous)
    else showNotice('info', 'No previous visible pane')
  })
  const openRecentWindows = useStableEvent(() => { setRecentWindowsOnly(true); setWindowSwitcherOpen(true) })

  const overviewTargets = new Map(windowTargets.map(target => [target.key, target]))
  const describeOverviewWindow = (key: string, tab = false): OverviewWindow => {
    const target = overviewTargets.get(key)
    const mark = windowAttention.get(key)
    const visible = windowPresentation ? windowPresentation.target === key : shownPopoverTab && key === surfaceWindowKey(shownPopoverTab) ? windowZoom === null || windowZoom === 'reader' 
      : key === floatingKey || (fittedWindowKeys.includes(key) && (windowZoom === null || fittedWindowKeys.indexOf(key) === windowZoom))
    return { key,
      title: target?.title ?? windowKeyTitle(key), detail: tab ? `tab · ${target?.detail ?? ''}` : target?.detail ?? 'window',
      hidden: !visible, badge: windowNeedsInputKeys.has(key) ? '?' : mark?.error ? '!' : mark?.unread ? '●' : undefined,
      tabs: tab ? undefined : liveWindowStacks.find(stack => stack.includes(key))?.map(member => describeOverviewWindow(member, true)),
    }
  }
  const overviewSignature = JSON.stringify([
    ...popoverTabs.map(id => describeOverviewWindow(surfaceWindowKey(id))),
    ...orderedWindowKeys.map(key => describeOverviewWindow(key)),
    ...(floatingKey ? [describeOverviewWindow(floatingKey)] : []),
  ])
  useEffect(() => { workspaceContext.runtime.set('windowOverviewWindows', JSON.parse(overviewSignature)) }, [workspaceContext.runtime, overviewSignature])
  const pickOverviewNode = useStableEvent((node: OverviewNode) => {
    setWindowSwitcherOpen(false)
    const space = workspaceContext.controller.getSnapshot().spaces.find(space => space.id === node.spaceId)
    const workspace = space?.workspaces.find(workspace => workspace.id === node.workspaceId)
    if (workspace && node.target) workspaceContext.controller.runtime(workspace).set('windowOverviewPendingTarget', node.target)
    workspaceContext.controller.activate(node.spaceId, node.workspaceId)
  })
  useEffect(() => {
    if (!overviewPendingTarget) return
    if (overviewTargets.has(overviewPendingTarget)) { pickWindowTarget(overviewPendingTarget); setOverviewPendingTarget(null) }
  }, [overviewPendingTarget, overviewSignature, workspaceId])
  const {
    openMoveWorkspaceMenu, splitFocusedWindow, resizeTreeWindow, dragTreeDivider,
    controlMenuTarget, setControlMenuTarget, windowControlsBlocked, endWindowResizeGroup,
    leaveWindowControls,
  } = useOpenMoveWorkspaceMenuGroup({
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
  })
  useEffect(() => {
    if (windowControlsBlocked) {
      leaveWindowControls()
      setSplitChordPending(false)
      setCommandChordPending(false)
      if (pendingPermissions.length) { setContextMenu(null); setControlMenuTarget(null) }
    }
  }, [windowControlsBlocked, windowControlMode, pendingPermissions.length])
  useEffect(() => {
    leaveWindowControls()
    setControlMenuTarget(null)
    setContextMenu(null)
  }, [workspaceId])
  useEffect(() => {
    if (windowControlMode !== 'identify') return
    const timer = setTimeout(() => setWindowControlMode(null), 3000)
    return () => clearTimeout(timer)
  }, [windowControlMode])
  const {
    controlWindowIndex, focusedControlKey, readControlWindows, focusControlWindow,
    pickControlWindow, enterWindowControls, runWindowControlAction, openWindowControlMenu,
  } = useControlWindowIndexGroup({
    shownPopoverTab, floatingKey, windowItems, windowItemKey, splitFocusIndex, selectedSessionKey,
    focusedWindowItem, renderer, rectOf, width, height, popoverHostSlot, windowSurfaceTitle,
    visibleSplitPaneCount, windowNumberOffset, windowKeyTitle, floatingItem, windowPresentation,
    windowZoom, windowSurfacePeek, setSurfacePanelFocused, setFocusedPane, focusReaderFromSplit,
    focusSplitPane, endWindowResizeGroup, windowControlMode, leaveWindowControls,
    pendingPermissions, windowControlsBlocked, contextMenu, commandPaletteOpen, setContextMenu,
    setControlMenuTarget, setChordHelp, setSplitChordPending, setCommandChordPending,
    setWindowControlMode, windowResizeGroupRef, closePopoverTab, tabFocusedWindow, floatWindowKey,
    openPopoverTabMoveMenu, openMoveWorkspaceMenu, workspaceId, toggleFullscreenMode,
    toggleWindowZoom, resizeFocusedWindow, resizeSecondaryDivider, checkpointWindowLayout,
    reconciledSplitTree, setWindowSplitTree, setSplitReaderShare, setSplitSecondaryShare,
    setSplitBottomShare, setSplitWeights, splitArrangement, splitReaderLast, undoWindowLayout,
    swapWindowInDirection, breakOutWindowTab, toggleFloatingFocused, windowStackFor,
    closeWindowTab, closeFloatingWindow, closeSurfaceWindow, closeSplitPane, setWindowPickerOpen,
    splitFocusedWindow, selectedWindowIndex, selectedSession, treeGeometry, fittedWindows,
    showNotice, popoverTabToWindow, popoverTabToFullScreen, returnPopoverWindow, windowSurfaceMeta,
    returningPopoverRef, openPopoverTab, openPopoverInNewTab, setPopoverOpen, moveSurfaceToPanel,
    openSurfaceWindow,
  })
  useEffect(() => {
    if (!contextMenu) { if (controlMenuTarget) setControlMenuTarget(null); return }
    if (controlMenuTarget && controlWindowIndex(controlMenuTarget) === undefined) { setContextMenu(null); setControlMenuTarget(null) }
  })

  useKeyboard((key) => {
    if (key.eventType === 'release') return
    const sequence = key.sequence || ''
    const isShifted = (char: string): boolean => isShiftedKey(key, char)
    const isCtrl = (char: string): boolean => isCtrlKey(key, char)
    const isCtrlShift = (char: string): boolean => isCtrlShiftKey(key, char)
    const isKeyRepeat = key.eventType === 'repeat' || key.repeated === true
    const isModelEffortShortcut = isAltKey(key, 'm') || sequence === 'µ'
    const handled = (action: () => void): void => {
      key.preventDefault()
      key.stopPropagation()
      action()
    }
    if (handleWindowControlKeys({
      windowControlsBlocked, windowControlMode, handled, key, isCtrl, leaveWindowControls,
      sequence, readControlWindows, pickControlWindow, endWindowResizeGroup,
      runWindowControlAction, focusedControlKey, focusWindowInDirection, commandChordPending,
      setCommandChordPending, executeCommandPalette, setChordHelp, showNotice,
      setSplitChordPending, cancelPointerGesture, isCtrlShift, openPopoverKind, openPopoverWindow,
      pluginOverlay, gitRepoCwd, setPluginOverlay, openSurfaceWindow, focusedWindowSurfaceKind,
      focusedWindowSurface, popoverTabs, popoverTabToFullScreen, returnPopoverWindow,
      spacesMenuOpen, spacesKeyRef, workspacesEnabled, workspaceLaunched, setWorkspaceLaunched,
      setWindowPickerOpen, setWorkspaceHasSession, setFocusedPane, setNewSessionCwd, workspaceCwd,
      setNewSessionModalOpen, splitChordPending, composerActive, composerTargetSession,
      composerSendState, reattachedRunning, isKeyRepeat, backgroundComposerTasks,
      enterWindowControls, openWindowControlMenu, toggleWorkspaces, openSpaces, addSplitPane,
      rotateSplitOrientation, resizeFocusedWindow, resizeSplitReader, shownPopoverTab,
      splitFocusIndex, closePopoverTab, closeSurfaceWindow, closeSplitPane, undoWindowLayout,
      redoWindowLayout, reopenClosedWindow, openRecentWindows, jumpToNextWindowAttention,
      setRecentWindowsOnly, setWindowSwitcherOpen, setWindowBroadcastOpen, toggleSplitPanes,
      cycleSplitFocus, swapWindowInDirection, toggleWindowZoom, tabFocusedWindow, stepWindowTab,
      focusedWindowItem, breakOutWindowTab, windowItemKey, toggleFloatingFocused,
      resizeSecondaryDivider, focusPreviousWindow, primaryLeaf, focusReaderFromSplit,
      windowNumberOffset, windowItems, focusSplitPane, focusControlWindow, cycleSplitPaneSession,
      toggleVoice,
    })) return
    const cursorIndex = readCursorIndex()
    const selectedTranscriptCard = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    // cardDisplayData is window-relative (preview cap while browsing, sliding
    // window while reading); shift the absolute cursor index into window space.
    const mountedOutput = selectedWindowHandleRef.current?.()?.mountedOutput() ?? { start: 0, cardDisplayData: [], scrollbackExpandedKeys: null }
    const selectedTranscriptCardDisplay = cursorIndex >= mountedOutput.start
      ? mountedOutput.cardDisplayData[cursorIndex - mountedOutput.start] ?? null
      : null
    const selectedAgentToolCards = groupedToolView
      && selectedTranscriptCard
      && resolvedExpandedKeys.has(selectedTranscriptCard.key)
      ? agentToolCardsFor(selectedTranscriptCard)
      : []
    const selectedAgentToolKey = selectedTranscriptCard
      ? agentToolCursorByGroupKey[selectedTranscriptCard.key] ?? null
      : null
    const selectedAgentToolCard = selectedAgentToolKey
      ? selectedAgentToolCards.find((toolCard) => toolCard.key === selectedAgentToolKey) ?? null
      : null
    const selectedAgentToolExpanded = selectedAgentToolCard
      ? agentToolCardIsExpanded(selectedAgentToolCard, expandedCardKeys, collapsedCardKeys)
      : false
    const selectedInteractiveTranscriptCard = selectedAgentToolCard ?? selectedTranscriptCard
    const selectedInteractiveTranscriptCardDisplay = selectedAgentToolCard
      ? nestedAgentToolDisplay(
          selectedAgentToolCard,
          selectedAgentToolCard.provider,
          selectedAgentToolExpanded,
          densityState.bodyLines,
          Boolean(syntaxStyle),
          thinkingMode,
        )
      : selectedTranscriptCardDisplay
    if (handleModalDialogKeys({
      exitConfirmOpen, key, handled, confirmExit, cancelExit, worktreeConfirm, setWorktreeConfirm,
      mergeSelectedWorktreeTask, discardSelectedWorktreeTask, worktreeModalOpen,
      setWorktreeModalOpen, setWorktreeDraft, submitWorktreeTask, playbookManagerOpen,
      playbookManagerKeyHandlerRef, coordModalOpen, setCoordModalOpen, setCoordDraft,
      setCoordAcceptanceDraft, setCoordNonGoalsDraft, setCoordManualQaDraft,
      setCoordEscalationDraft, setCoordPlaybookName, setCoordPlaybookArgsDraft, setCoordGateDraft,
      setCoordMaxTokens, setCoordMaxDurationMinutes, setCoordProviderOverride,
      setCoordTeammateProviderOverride, setCoordProviderPoolIndex, setCoordModalFocus,
      setCoordError, isCtrl, setCoordMaxAgents, setCoordRequirePlanApproval, showToggleOutcome,
      coordModalFocus, coordPlaybooks, coordPlaybookName, selectCoordPlaybook,
      setPlaybookManagerOpen, provider, selectedSession, coordProviderPoolIndex,
      coordProviderOverride, setCoordUseWorktrees, setCoordAutonomy, setCoordRequireReview,
      submitCoordinatedRun, remoteCoordinatorTarget, remoteCoordinatorKeyHandlerRef,
      teammatesModalOpen, teammatesKeyHandlerRef, searchMode, setSearchMode, sessionSearchMode,
      setSessionSearchMode, setSessionSearchQuery, fileHistoryPath, fileHistoryKeyHandlerRef,
      dailySummaryOpen, dailySummaryKeyHandlerRef, contextMenu, contextMenuKeyHandlerRef,
      windowSwitcherOpen, windowSwitcherKeyRef, windowBroadcastOpen, windowBroadcastKeyRef,
      windowPickerOpen, windowPickerKeyHandlerRef, pluginOverlay, pluginOverlayKeyHandlerRef,
      folderPickerForNewSession, folderPickerKeyHandlerRef,
    })) return
    if (handleOverlayAndMenuKeys({
      focusedWindowSurface, windowSurfaceCaptureRef, windowSurfaceKeysRef, pendingPermissions,
      focusedWindowSurfaceKind, splitChordPending, key, handled, focusReaderFromSplit,
      surfacePanel, surfacePanelVisible, surfacePanelFocused, surfacePluginKeyCaptureRef,
      surfacePluginKeyRef, sequence, setSurfacePanelExpanded, surfacePanelAtBottom,
      setSurfacePanelRows, surfacePanelMaxRows, setSurfacePanelWidth, surfacePanelMaxWidth,
      toggleSurfacePanelPlacement, isShifted, setSurfacePanelOpen, setSurfacePanelFocused,
      surfacePanelKeyHandlerRef, pluginManagerOpen, pluginManagerKeyHandlerRef,
      newSessionModalOpen, newSessionKeyHandlerRef, handoffBriefOpen, handoffBriefKeyHandlerRef,
      promptLibraryOpen, promptLibraryKeyHandlerRef, chordHelp, setChordHelp, bookmarksOverlayOpen,
      isCtrl, setBookmarksOverlayOpen, bookmarksOverlay, setBookmarksOverlayIndex,
      bookmarksOverlayIndex, openBookmarkRecord, attentionOpen, attentionKeyHandlerRef,
      renameSessionKey, setRenameSessionKey, setRenameDraft, commitRename, providerMenuOpen,
      closeProviderMenu, requestExit, modelPickerOpen, isModelEffortShortcut, setModelPickerOpen,
      modelPickerFocus, setModelPickerFocus, setModelPickerIndex, filteredModelPickerOptions,
      modelPickerTarget, modelPickerOptions, modelPickerIndex, setTuiCopilotContextTierByKey,
      themeMenuOpen, themeMenuGroup, setThemeMenuGroup, themeMenuQuery, themeMenuOriginRef,
      setThemeMenuIndex, setThemeMode, themeMenuIndex, chooseTheme, closeThemeMenu,
      toggleThemeFollowsTerminal, transcriptViewMenuOpen, closeTranscriptViewMenu,
      toggleLightweightWindows, commandPaletteOpen, closeCommandPalette, setCommandPaletteIndex,
      filteredCommands, commandPaletteIndex, executeCommandPalette, setCommandPaletteQuery,
      transcriptDiffDraft, setTranscriptDiffDraft, setTranscriptDiffNotes, openModelPicker,
    })) return
    if (handleAskAndShortcutKeys({
      pendingPermissions, permissionActionLoading, questionFocusIndex, key,
      questionFreeformEditing, handled, questionOptionIndex, setQuestionFreeformEditing,
      setQuestionFreeformAnswers, setQuestionSelections, setQuestionOptionIndex,
      setQuestionFocusIndex, sequence, toggleTuiQuestionOption, questionFreeformAnswers,
      submitTuiQuestion, respondToTuiPermission, permissionOptionIndex, setPermissionOptionIndex,
      respondToTuiPlan, movePermissionOptionIndex, resolvePermissionOptionIndex,
      composerTargetSession, selectedSession, cycleClaudeComposerPermissionMode,
      executeCommandPalette, composerActive, isShifted, surfacePanelOpen, setSurfacePanelOpen,
      setSurfacePanelFocused, surfacePanelFocused, fullscreenMode, composerTextareaRef,
      composerDraft, toggleFullscreenMode,
    })) return
    if (handleComposerKeys({
      composerActive, isCtrl, handled, pasteSystemClipboardToComposer, key, composerMention,
      composerMentionResults, setComposerMentionDismissedStart, setComposerMention,
      setComposerMentionResults, composerSlashOpen, composerSlashCommands,
      setComposerSlashDismissed, setComposerSlashIndex, composerHistoryOpen, cancelComposerHistory,
      composerStashOpen, setComposerStashOpen, setComposerStashIndex, composerRewindItems,
      setComposerRewindItems, composerSendState, reattachedRunning, rememberComposerCursor,
      setComposerWindowOpen, setComposerActive, composerWindowOpen, isKeyRepeat,
      interruptPressActive, cancelComposerSend, setInterruptPressActive, interruptPressTimeoutRef,
      toggleComposerWindow, activeQueuedComposerSends, clearQueuedComposerSends,
      popNewestQueuedComposerSend, canUseChannelBridge, routeComposerToBridge,
      toggleComposerBridgeRoute, searchComposerHistory, editComposerInExternalEditor,
      pluginOverlay, closePluginOverlay, runPluginCommandId, composerTargetSession,
      setComposerEnableWorkflow, showToggleOutcome, commitComposerHistory, moveComposerHistory,
      selectComposerHistoryEntry, sentHistory, sequence, setComposerHistoryOpen,
      setComposerHistoryIndex, setHistoryIndex, composerRewindIndex, rewindToPrompt,
      setComposerRewindIndex, commitComposerStashEntry, selectComposerStashEntry,
      composerStashIndex, composerStash, composerMentionIndex, insertMentionAtCursor,
      setComposerMentionIndex, composerSlashIndex, insertSlashAtCursor, livePromptSuggestion,
      composerTextareaRef, setComposerDraft, setLivePromptSuggestion, composerDraft, historyIndex,
    })) return
    if (!windowControlsBlocked && windowPresentation && key.name === 'escape') { handled(restoreWindowPresentation); return }
    if (handleGlobalChordKeys({
      commandChordPending, windowControlsBlocked, handled, setCommandChordPending, key, isCtrl,
      showNotice, sequence, executeCommandPalette, setChordHelp, setSplitChordPending, isShifted,
      toggleFullscreenMode, focusedWindowSurface, popoverTabFocused, focusReaderFromSplit,
      windowSurfaceKeysRef, focusedWindowItem, composeToSplitPaneSession, openComposerWindow,
      selectedSessionKey, selectedInteractiveTranscriptCard,
      selectedInteractiveTranscriptCardDisplay, splitFocusIndex, effectiveFocus,
      splitPaneHandlesRef, searchMatches, fleetStripVisible, fleetPageCount,
      transcriptViewportRows, hasPrimaryFrame, velocityScrollStep, jumpToSearchMatch,
      jumpToMatchingCard, jumpToBookmark, visibleTabSessions, selectStripIndex, activeStripIndex,
      tabStripLength, setSearchMode, jumpToUnreadBoundary, jumpToResumeMarker, copySelectedMessage,
      replySelectedMessage, setThinkingMode, showToggleOutcome, openFocusedSplitPane,
      tabFromSplitPane, closeWindowSessionTab, openSplitPaneOverlay, openCoordinationBoard,
      splitPaneRunningKeys, requestExit, setComposerActive, pasteSystemClipboardToComposer,
      showRail, focusedPane, tabFromRail, setFocusedPane, isCtrlShift, openNewWorkflowModal,
      runPluginCommand, setAttentionOpen, jumpToNextAttention, fleetStripEnabled,
      setFleetStripEnabled, jumpToFleetEntry, setFleetPage, openHandoffBrief, setWorktreeDraft,
      setWorktreeModalOpen, openPromptLibrary, taskPanelOpen, setTaskPanelOpen, setTaskPanelTab,
      taskPanelTab, resizeTaskPanel, setTaskPanelExpanded, toggleComposerHidden,
      openBookmarksOverlay, selectedSession, setRenameSessionKey, setRenameDraft,
    })) return
    if (handleSidebarKeys({
      effectiveFocus, sidebarSubagentCursor, key, handled, showNotice, setSidebarView,
      showToggleOutcome, sidebarView, moveCoordinatorSelection, jumpCoordinatorSelection,
      isShifted, openSelectedCoordinatorAgent, moveSelection, sidebarEntries, focusSidebarEntry,
      toggleHideScratch, toggleSelectedSessionSettled, toggleSidebarSort, sidebarSort,
    })) return
    if (handleWindowAndTabKeys({
      effectiveFocus, sequence, handled, jumpToBookmark, showRail, resizeSidebar, key,
      workspaceContext, sidebarView, selectedSession, childrenByParentId,
      setCollapsedSubagentParents, sidebarEntries, selectedSidebarEntryIndex,
      setSubagentTranscriptSelection, setPluginOverlay, promotePreviewToTab, setFocusedPane,
      showTabs, selectStripIndex, activeStripIndex, tabStripLength, shownPopoverTab,
      closePopoverTab, closeWindowSessionTab,
    })) return
    if (handleReaderKeys({
      effectiveFocus, key, handled, moveAgentToolCursor, moveCursor, velocityScrollStep,
      jumpToTranscriptIndex, isShifted, jumpToTranscriptTail, transcriptViewportRows, isCtrl,
      moveViewport, openSelectedAsyncQuestionsOrFold, toggleExpansion, transcriptView,
      jumpToUnreadBoundary, selectedInteractiveTranscriptCard,
      selectedInteractiveTranscriptCardDisplay, jumpToResumeMarker, toggleBookmarkForCursor,
      replySelectedMessage, diffLayout, transcriptDiffHiddenHunkHeaderCardKeys,
      transcriptDiffRowCursorByCardKey, setTranscriptDiffSelectionAnchorByCardKey,
      setTranscriptDiffRowCursorForCard, committedSessionKey,
      transcriptDiffSelectionAnchorByCardKey, transcriptDiffNotes, toggleTranscriptDiffCardSet,
      setTranscriptDiffPlainCardKeys, clearTranscriptDiffSelectionForCard,
      setTranscriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys,
      showNotice, openTranscriptDiffNote, deleteTranscriptDiffNote,
      sendTranscriptDiffNoteToComposer, selectedAgentToolCard, selectedAgentToolExpanded,
      resolvedExpandedKeys, sequence, setSearchMode, setSessionSearchMode, copySelectedMessage,
      setDiffLayout, showToggleOutcome, setError, searchMatches, jumpToSearchMatch,
      jumpToMatchingCard,
    })) return
    if (handleLetterShortcutKeys({
      sequence, composerActive, handled, setComposerHidden, setComposerActive,
      normalizedSearchQuery, openNewSessionModal, reuseLastPrompt, setThinkingMode,
      showToggleOutcome, setShowToolCalls, setError, toggleVelocityScroll, setCommandPaletteIndex,
      setCommandPaletteQuery, setCommandPaletteOpen, key, openProviderMenu, openThemeMenu,
      stickyHeaders, setStickyHeaders, tabsEnabled, setTabsEnabled, railVisible, setRailVisible,
      focusedPane, setFocusedPane, focusMode, setFocusMode, density, setDensity, isShifted,
      transcriptWidth, setTranscriptWidth, openTranscriptViewMenu, refreshSessions, provider,
      selectedSessionTarget, refreshSelectedSessionDetail,
    })) return
  })
  const {
    readerContextMeta, previewBarText, providerOptions, providerAccent, composerPlaceholder,
    composerAttachmentLabel,
  } = useStatusLabelGroup({
    loadingSessions, refreshingSessions, followTail, pendingNewCount, selectedSession, readerModel,
    rightPaneWidth, providerInstances, disabledPlugins, provider, composerTargetSession,
    visibleComposerSending, composerExample, composerConfig, prepareComposerSubmission,
    composerDraft, composerMentionAttachments, composerPromptParts,
  })
  if (composerDraftShapeRef.current) composerDraftShapeRef.current.attachments = composerAttachmentLabel ?? ''
  const {
    composerDockStatsFor, composerWindowMetaSegments, composerWindowDraftFor,
    composerBaseTextareaStyle, composerDockTextareaStyle, chatComposerFocused,
    composerDockBackground, composerChatTextareaStyle, composerDockTitleWidth, composerDockRouted,
    composerDockEmphasized, composerDockBorderTitle, composerWindowBorderTitle,
    composerDockFooterHint, composerDockSendingHintSegments, dockShowsStatusBar,
    dockFooterStatsFor, composerDockFooterHintWidth, composerDockFooterStatsWidth,
    composerWindowFooterHint, composerWindowSendingHintSegments, chatComposerStatusWidth,
    chatComposerStatsWidth, chatComposerHintFitted, chatComposerHintWidth,
    composerWindowFooterHintWidth, composerWindowFooterStatsWidth, pickSlashInsteadOfSubmit,
  } = useComposerDockStatsForGroup({
    buildComposerStatsSegments, composerVisualLineCount, composerDraft, composerKnobSegments,
    theme, composerLocationSegments, composerWindowVisualLineCount, composerAttachmentLabel,
    composerActive, composerFocusBlocked, fullscreenMode, composerAccentColor,
    routeComposerToBridge, routeComposerToIde, visibleComposerSending, reattachedRunning,
    composerDockTextareaWidth, composerWindowWidth, interruptPressActive, composerConfig,
    composerTargetSession, visibleRunningToolCount, canUseChannelBridge, canUseIdeBridge,
    composerKeysTargetTurn, composerIdleFooterHint, statusBarInDock, commandChordPending,
    splitChordPending, attentionNeedsInputCount, footerSegments, rightPaneWidth, composerSlashHint,
    composerWindowContentWidth, composerRewindItems, composerRewindIndex, setComposerRewindItems,
    rewindToPrompt, composerSlashOpen, composerSlashCommands, composerFirstLine,
    composerSlashIndex, insertSlashAtCursor,
  })
  // Codex /side: send the aside once the fork is the ready composer target.
  useEffect(() => {
    const pending = pendingForkSendRef.current
    if (!pending || composerTargetSessionIdentity !== pending.key || composerPreparingTargetKey) return
    pendingForkSendRef.current = null
    void sendComposerMessage(pending.text)
  }, [composerTargetSessionIdentity, composerPreparingTargetKey, sendComposerMessage])
  const {
    submitComposerFromDock, submitComposerFromWindow, renderComposerTextarea,
    renderComposerMentionPanel, renderComposerSlashPanel, renderComposerHistoryPanel,
    renderComposerRewindPanel, renderComposerStashPanel, renderComposerQueuePanel,
    readerHeaderChrome, readerFooterChrome,
  } = useSubmitComposerFromDockGroup({
    pickSlashInsteadOfSubmit, sendComposerMessage, composerTextareaRef, composerDraft,
    composerTargetSession, rememberComposerCursor, setComposerWindowOpen, composerActive,
    windowControlMode, composerPlaceholder, composerSyntaxStyle, theme,
    handleComposerContentChange, composerChatTextareaStyle, composerBaseTextareaStyle,
    composerDockTextareaStyle, composerMention, composerMentionVisibleCount,
    composerMentionResults, composerMentionIndex, composerAccentColor, composerConfig,
    composerProvider, composerSlashOpen, composerSlashVisibleCount, composerSlashCommands,
    composerSlashIndex, composerHistoryOpen, composerHistoryVisibleCount, sentHistory,
    composerHistoryIndex, composerRewindItems, composerRewindVisibleCount, composerRewindIndex,
    composerStashOpen, composerStashVisibleCount, composerStash, composerStashIndex,
    activeQueuedComposerSends, composerQueueDurable, composerWindowOpen, composerHidden,
    presentationHidesComposer, embeddedComposer, composerDockHeight, chatComposerFocused,
    setComposerActive, composerDockTextareaHeight, chatComposerStatusWidth, chatComposerStatsWidth,
    composerSlashHint, clickComposerStatus, composerDockStatsFor, composerDraftState,
    hoverComposerStatus, setComposerStatusHover, composerStatusHover, chatComposerHintWidth,
    visibleComposerSending, composerDockSendingHintSegments, chatComposerHintFitted,
    presentationFocusMode, isStreamView, contextUsage, selectedSession, contextUsageStatus,
    followTail, isScrollbackView, pendingNewCount, isCopilotView, fleetStripVisible, error,
    showToolCalls, normalizedSearchQuery, providerAccent, showTabs, transcriptView, readerTitle,
    readerContextMeta, fleetStripSegments, setShowToolCalls, setError, searchQuery, searchMatches,
    searchMatchIndex, visibleTranscriptCards, turnRunningForComposer, chatTurnStatusRows,
    densityState, composerSendStartedAt, composerWaitingStatusSeed, composerWaitingSuffix,
    composerWaitingOnUser, visibleAwaitingPersistedTurn, selectedSessionKey,
  })
  // A window drawing the selected transcript as a pane takes it from here.
  useTranscriptWindowChromeHost(readerHeaderChrome, readerFooterChrome)

  // The frame drawn outside the windows: a popover tab, when one is shown.
  const readerFrameNode = () => shownPopoverTab ? popoverTabFrameRef.current?.() ?? null : null

  // Zoom hides the other windows rather than unmounting them, so nothing
  // reloads on the way in or out: every window keeps its parent, and the
  // zoomed one (and its row or column) is given the whole area.
  const zooming = windowZoom !== null && !windowSurfacePeek
  const zoomedIndex = zooming && typeof windowZoom === 'number' ? windowZoom : null
  const windowHiddenByZoom = (index: number) => zooming && index !== zoomedIndex
  const zoomAware = (index: number, size: { width: number; height: number; boxHeight: number | undefined }) => (
    zoomedIndex === index ? { width: readerAreaWidth, height: windowAreaHeight, boxHeight: windowAreaHeight } : size
  )

  // A surface in the layout: the side panel's view of it, in a window frame.
  // `place` puts the frame in the surface layer (absolute, over its slot's
  // placeholder, which keeps the `split-pane:i` id) rather than in the flow.
  const renderSurfaceWindow = (surface: WindowSurfaceId, index: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden = false, place?: { x: number; y: number; zIndex: number }) => runRenderSurfaceWindow({
    splitFocusIndex, moveFloatGesture, endFloatGesture, sessionDragHandlers, theme,
    windowSurfaceTitle, openSurfaceWindowMenu, surfacePanelFocused, setSurfacePanelFocused,
    focusSplitPane, renderer, startFloatGesture, surfaceTitleClicksRef, toggleWindowZoom,
    sessionDragImplRef, renderWindowTabs, openWindowControlMenu, moveSurfaceToPanel,
    closeSurfaceWindow, renderSurfaceBody, composerActive,
  }, surface, index, size, hidden, place)

  // A surface window in the flow is only its slot: the frame itself is drawn by
  // the surface layer, so moving it between rows, tabbing it or floating it
  // never remounts what it is showing.
  const renderWindowItem = (item: WindowItem, index: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden = false) => (
    item.kind === 'session' ? renderSplitPane(item.session, index, size, hidden) : (
      <box key={`surface-slot:${item.surface}`} id={`split-pane:${index}`} visible={!hidden} width={size.width} height={size.boxHeight} flexShrink={0} />
    )
  )

  // Every surface the windows own, in one parent keyed by id: laid out over its
  // slot, hidden while it is a background tab or past what fits, or floating.
  // React keeps a child mounted while its key stays under the same parent, and
  // a mounted surface keeps its view — the file shown, the diff's cursor, the PR.
  const [, setSurfaceGeometryEpoch] = useState(0)
  useLayoutEffect(() => {
    let signature = ''
    const measure = () => {
      const area = rectOf('window-area')
      const slots = Array.from({ length: visibleSplitPaneCount }, (_, index) => rectOf(`split-pane:${index}`))
      const next = JSON.stringify([area, slots])
      if (next === signature) return
      signature = next
      setSurfaceGeometryEpoch(epoch => epoch + 1)
    }
    renderer.root.on(LayoutEvents.LAYOUT_CHANGED, measure)
    return () => { renderer.root.off(LayoutEvents.LAYOUT_CHANGED, measure) }
  }, [renderer, visibleSplitPaneCount])
  const {
    renderSurfaceLayer, renderSplitPane, renderWindowTabs, resizeSurfacePanelBy, tabCloseHit,
    popoverTabAt, tabAt,
  } = useRenderSurfaceLayerGroup({
    readerAreaWidth, windowAreaHeight, treeGeometry, visibleSplitPaneCount, fittedWindows,
    splitOrientation, splitReaderLast, fittedWindowKeys, zoomedIndex, rectOf, windowSurfaces,
    liveWindowStacks, floatingKey, windowSurfacePeek, renderSurfaceWindow, floatingWindow,
    fullscreenMode, windowStackFor, zooming, selectedSessionKey, chromeWindowIndex,
    windowNumberOffset, primaryLeaf, effectiveFocus, splitFocusIndex, composerActive,
    reportSelectedWindowCursor, setFollowTail, deferredSearchQuery, searchMatches,
    visibleTranscriptCards, searchMatchIndex, registerSplitPaneHandle, theme, densityState,
    density, showToolCalls, syntaxStyle, shouldEnableSyntaxHighlighting, transcriptDiffControls,
    agentToolCursorByGroupKey, selectAgentTool, thinkingMode, diffLayout, imessageStyle,
    transcriptWidth, transcriptView, splitPaneLiveMessages, liveTranscriptBaselineRef,
    splitPaneRunningKeys, badgeForWindow, watchedCoordinator, reportWindowActivity,
    composerSendState, composerLiveText, composerActivitySessionKey, focusSplitPane,
    splitPaneActions, stickyHeaders, lightweightWindows, noteTranscriptLinkPress,
    openTranscriptLinkAt, openCardAsyncQuestions, floatGestureHandlers, sessionDragHandlers,
    splitPaneShouldYield, sessionDragImplRef, activateWindowTab, windowKeyTitle, closeWindowTab,
    setSurfacePanelExpanded, surfacePanelAtBottom, setSurfacePanelRows, surfacePanelExpanded,
    effectiveSurfacePanelRows, surfacePanelMaxRows, setSurfacePanelWidth,
    effectiveSurfacePanelWidth, surfacePanelMaxWidth, tabSelectRef, tabWidth, visibleTabSessions,
    popoverTabs,
  })

  useLayoutEffect(() => runComposerDraftPersistEffect({
    composerTextareaRef, composerDraftRef, composerDraftStorageKeyRef, writeWorkspaceDraft,
    writeWorkspaceDraftParts, composerPromptPartsRef, setComposerDraft, surfacePluginKeyCaptureRef,
    windowSurfaceCaptureRef, composerSessions, workspaceContext,
  }))

  // One surface's content, for the side panel or a window in the layout.
  // The control center's "new run": the same setup from its popover and its window.
  const startCoordinationRun = () => {
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    setCoordDraft('')
    setCoordError(null)
    setCoordPlaybookName(null)
    setCoordPlaybookArgsDraft('')
    setCoordProviderOverride(null)
    setCoordTeammateProviderOverride(null)
    setCoordProviderPoolIndex(0)
    setCoordModalFocus('prompt')
    setCoordModalOpen(true)
    void loadCoordPlaybooks(baseCwd)
  }
  // `slot` is the window id when the surface is a window: its key handler and
  // capture are then that window's own, not the side panel's.
  const renderSurfaceBodyInner = (kind: WindowSurfaceKind, box: { width: number; height: number }, close: () => void, focused: boolean, slot?: WindowSurfaceId, panelCwd?: string) => runRenderSurfaceBodyInner({
    windowSurfaceMeta, gitRepoCwd, popoverTabs, focusReaderFromSplit, windowSurfaceKeysRef,
    windowSurfaceCaptureRef, pluginSessionFor, pluginSelectedDetail, pluginLiveTranscript,
    pluginOpenRequests, density, showToolCalls, splitPaneShouldYield, gitSessionId,
    windowPluginServices, fileHistoryServices, pluginServicesFor, handoffBriefSyntaxStyle,
    fileHistoryPath, editorInitialPath, editorInitialLine, theme, composerAccentColor,
    surfacePluginKeyRef, surfacePluginCaptureChange, runCommandForPlugin, taskPanelMessages,
    composerLiveTodos, selectedSession, visibleTranscriptCards, jumpToTranscriptIndex,
    liveSubagentText, attentionItems, attentionRespondingId, respondToAttentionItem,
    openAttentionSession, dismissAttentionItem, selectedSessionTarget, insertComposerPromptText,
    showNotice, sessionDetail, handleCoordPlaybooksChanged, pinnedSessionOf, bookmarkKeys,
    renderer, appendDiffCommentPromptToComposer,
  }, kind, box, close, focused, slot, panelCwd)

  // A single popover kind keeps the root's state namespace, so its window and its
  // full-screen form are one view (the editor's buffers survive either move).
  const renderSurfaceBody = (kind: WindowSurfaceKind, box: { width: number; height: number }, close: () => void, focused: boolean, slot?: WindowSurfaceId, panelId?: string, panelCwd?: string) => <WorkspaceViewContext.Provider key={`${kind}:${slot ?? panelId ?? 'panel'}`} value={isPopoverWindowKind(kind) && POPOVER_WINDOWS[kind].single ? 'root' : surfaceViewNamespace(kind, slot, panelId)}>{renderSurfaceBodyInner(kind, box, close, focused, slot, panelCwd)}</WorkspaceViewContext.Provider>

  // The popover tab in the reader's place, reached by readerFrameNode through a
  // ref: that function is declared before renderSurfaceBody exists.
  popoverTabFrameRef.current = () => {
    if (!shownPopoverTab) return null
        // A popover tab in the reader's place: the reader stays mounted, hidden.
        const kind = surfaceKindOf(shownPopoverTab)
        const tabWidthCells = Math.max(1, windowZoom === 'reader' ? readerAreaWidth : fittedWindows.reader.width)
        const tabHeightCells = Math.max(1, windowZoom === 'reader' ? windowAreaHeight : fittedWindows.reader.height)
        return (
          <box id="popover-tab-frame" flexGrow={1} width={tabWidthCells} height={tabHeightCells} flexShrink={0} flexDirection="column"
            border borderStyle="single" borderColor={popoverTabFocused ? theme.cyan : theme.border}
            backgroundColor={theme.surface} title={` ${windowSurfaceTitle(shownPopoverTab)} `} titleColor={popoverTabFocused ? theme.cyan : theme.dim}
            onMouseDrag={(event) => sessionDragHandlers.move(event)}
            onMouseUp={(event) => sessionDragHandlers.release(event)}
            onMouseDown={(event) => {
              if (event.button === 2) { event.stopPropagation(); openWindowControlMenu('reader', event); return }
              if (event.button !== 0) return
              if (splitFocusIndex !== null) focusReaderFromSplit()
              setFocusedPane('messages')
              const frame = rectOf('transcript-reader')
              if (frame && event.y === frame.y) {
                if (isDoubleClick(readerTitleClickRef, event)) toggleWindowZoom(null)
                else sessionDragImplRef.current.pressSurface(shownPopoverTab, -1, event)
              }
            }}
          >
            {/* The reader's title controls: this tab holds the reader's place. */}
            <box id="popover-tab-controls" position="absolute" top={-1} right={1} height={1} flexDirection="row" zIndex={3}>
              <WindowButton id="popover-tab-menu" label=" ≡ " theme={theme} onPress={(point) => openWindowControlMenu('reader', point)} />
              <WindowButton id="popover-tab-layout" label=" ⊞ layout " theme={theme} onPress={splitPaneActions.openLayout} />
              <WindowButton id="popover-tab-fullscreen" label=" ⤢ " theme={theme} onPress={() => toggleWindowZoom(null)} />
              <WindowButton id="popover-tab-close" label=" × " theme={theme} tone="danger" onPress={() => closePopoverTab(shownPopoverTab)} />
            </box>
            <box flexGrow={1} overflow="hidden">
              {renderSurfaceBody(kind, { width: tabWidthCells - 2, height: tabHeightCells - 2 }, () => closePopoverTab(shownPopoverTab), popoverTabFocused && !composerActive, shownPopoverTab)}
            </box>
          </box>
        )
  }

  // One element for both placements, so the panel keeps its state when it moves.
  const panelViewSignature = surfacePanel.surfaces.map(entry => `${entry.id}:${entry.kind}`).join('|')
  useLayoutEffect(() => { migratePanelViewState(workspaceContext.runtime, surfacePanel.surfaces, surfacePanel.activeId) }, [workspaceContext.runtime, panelViewSignature])
  const surfacePanelElement = runSurfacePanelElement({
    surfacePanelVisible, surfacePanel, theme, surfacePanelAtBottom, readerAreaWidth,
    effectiveSurfacePanelWidth, surfacePanelExpanded, surfacePanelPlacement,
    effectiveSurfacePanelRows, surfacePanelHeight, surfacePanelFocused, gitRepoCwd,
    liveSubagentText, setSurfacePanel, setSurfacePanelFocused, toggleSurfacePanelPlacement,
    openSurfaceWindow, setSurfacePanelExpanded, setSurfacePanelOpen, surfacePanelResizeFromRef,
    setSurfacePanelResizing, surfacePanelKeyHandlerRef, surfacePluginKeyRef, renderSurfaceBody,
  })

  // Popovers that take the whole screen from its top row, which the spaces bars must not paint over.
  const fullScreenPopoverOpen = Boolean(pluginOverlay && getPluginSurface(pluginOverlay).fullScreen) || folderPickerForNewSession
  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
      {spacesMenuOpen ? <SpacesManager controller={workspaceContext.controller} theme={theme} width={width} height={height} initialId={spacesMenuSelection} closeId={spacesCloseId} onClose={() => setSpacesMenuOpen(false)} onKeyHandlerReady={handler => { spacesKeyRef.current = handler }} /> : null}
      {workspacesEnabled && !fullscreenMode ? <WorkspaceTabs theme={theme} width={width} onManage={openSpaces} under={fullScreenPopoverOpen} /> : null}
      <FloatingWindowLayer presentationActive={Boolean(windowPresentation)} maximized={windowZoom === FLOATING_PANE_INDEX} floatingItem={floatingItem} floatingWindow={floatingWindow} fullscreenMode={fullscreenMode} windowSurfacePeek={windowSurfacePeek} readerAreaWidth={readerAreaWidth} windowAreaHeight={windowAreaHeight} windowAreaRef={windowAreaRef} sidebarWidth={sidebarWidth} verticalTabsWidth={verticalTabsWidth} tabsEnabled={tabsEnabled} theme={theme} rectOf={rectOf} startFloatGesture={startFloatGesture} moveFloatGesture={moveFloatGesture} endFloatGesture={endFloatGesture} renderSplitPane={renderSplitPane} dockFloatingWindow={dockFloatingWindow} />
          {windowPresentation ? <box id="presentation-restore" position="absolute" top={windowAreaRef.current?.y ?? 0} right={rightPanelsWidth} height={1} zIndex={60} backgroundColor={theme.surface2}
            onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); restoreWindowPresentation() } }}>
            <text fg={theme.cyan} selectable={false} wrapMode="none">{fullscreenMode ? ' FULLSCREEN · Shift+Z restore ' : ' ZOOM · Ctrl+B m restore '}</text>
          </box> : null}
      <WorkspaceBody
        surfacePanelAtBottom={surfacePanelAtBottom}
        mainContentHeight={mainContentHeight}
        theme={theme}
        showRail={showRail}
        sidebarWidth={sidebarWidth}
        sidebarExtraRows={sidebarExtraRows}
        sidebarView={sidebarView}
        effectiveFocus={effectiveFocus}
        coordinatorSidebarHeader={coordinatorSidebarHeader}
        sidebarHeaderBaseText={sidebarHeaderBaseText}
        toggleSidebarSort={toggleSidebarSort}
        showToggleOutcome={showToggleOutcome}
        sidebarSort={sidebarSort}
        sidebarHeaderPrefixWidth={sidebarHeaderPrefixWidth}
        sidebarProviderBadgeText={sidebarProviderBadgeText}
        sidebarProviderAccent={sidebarProviderAccent}
        workspacesEnabled={workspacesEnabled}
        openSpaces={openSpaces}
        fullScreenPopoverOpen={fullScreenPopoverOpen}
        setAllProjects={setAllProjects}
        allProjects={allProjects}
        sidebarInnerWidth={sidebarInnerWidth}
        sidebarRowBudget={sidebarRowBudget}
        density={density}
        sidebarScrollbarOptions={sidebarScrollbarOptions}
        loadingSessions={loadingSessions}
        sessions={sessions}
        sidebarEntries={sidebarEntries}
        sidebarScrollRef={sidebarScrollRef}
        sidebarRowElements={sidebarRowElements}
        showTabs={showTabs}
        verticalTabsWidth={verticalTabsWidth}
        tabOptions={tabOptions}
        activeStripIndex={activeStripIndex}
        runningTabKeys={runningTabKeys}
        visibleTabSessions={visibleTabSessions}
        closeSessionTab={closeSessionTab}
        popoverTabs={popoverTabs}
        closePopoverTab={closePopoverTab}
        setTabOrientation={setTabOrientation}
        setError={setError}
        splitPaneActions={splitPaneActions}
        openPopoverTabMenu={openPopoverTabMenu}
        sessionDragHandlers={sessionDragHandlers}
        selectStripIndex={selectStripIndex}
        readerAreaWidth={readerAreaWidth}
        showHorizontalTabs={showHorizontalTabs}
        TAB_BAR_HEIGHT={TAB_BAR_HEIGHT}
        tabSelectRef={tabSelectRef}
        tabWidth={tabWidth}
        popoverTabAt={popoverTabAt}
        tabCloseHit={tabCloseHit}
        showPopoverTab={showPopoverTab}
        tabAt={tabAt}
        selectTabSession={selectTabSession}
        showPreviewBar={showPreviewBar}
        selectedSession={selectedSession}
        previewBarText={previewBarText}
        windowOverflowRows={windowOverflowRows}
        windowOverflowRef={windowOverflowRef}
        overflowWindowItems={overflowWindowItems}
        badgeForWindow={badgeForWindow}
        pickWindowTarget={pickWindowTarget}
        showNotice={showNotice}
        windowAreaRef={windowAreaRef}
        workspaceLaunched={workspaceLaunched}
        workspaceCwd={workspaceCwd}
        setWorkspaceLaunched={setWorkspaceLaunched}
        setWorkspaceHasSession={setWorkspaceHasSession}
        setFocusedPane={setFocusedPane}
        setNewSessionCwd={setNewSessionCwd}
        setNewSessionModalOpen={setNewSessionModalOpen}
        openSurfaceWindow={openSurfaceWindow}
        setWindowPickerOpen={setWindowPickerOpen}
        windowSurfacePeek={windowSurfacePeek}
        readerFrameNode={readerFrameNode}
        hasPrimaryFrame={hasPrimaryFrame}
        orderedWindowKeys={orderedWindowKeys}
        treeGeometry={treeGeometry}
        windowItems={windowItems}
        windowHiddenByZoom={windowHiddenByZoom}
        popoverHostSlot={popoverHostSlot}
        windowItemKey={windowItemKey}
        zoomedIndex={zoomedIndex}
        windowAreaHeight={windowAreaHeight}
        renderWindowItem={renderWindowItem}
        zoomAware={zoomAware}
        windowZoom={windowZoom}
        zooming={zooming}
        renderSurfaceLayer={renderSurfaceLayer}
        selectedWindowHandleRef={selectedWindowHandleRef}
        selectedSessionKey={selectedSessionKey}
        windowControlsBlocked={windowControlsBlocked}
        shownPopoverTab={shownPopoverTab}
        taskPanelVisible={taskPanelVisible}
        effectiveTaskPanelWidth={effectiveTaskPanelWidth}
        effectiveSurfacePanelWidth={effectiveSurfacePanelWidth}
        surfacePanelHeight={surfacePanelHeight}
        taskPanelMessages={taskPanelMessages}
        composerLiveTodos={composerLiveTodos}
        visibleTranscriptCards={visibleTranscriptCards}
        jumpToTranscriptIndex={jumpToTranscriptIndex}
        taskPanelTab={taskPanelTab}
        liveSubagentText={liveSubagentText}
        surfacePanelOnRight={surfacePanelOnRight}
        surfacePanelElement={surfacePanelElement}
        themeMode={themeMode}
        providerMenuOpen={providerMenuOpen}
        presentationFocusMode={presentationFocusMode}
        providerOptions={providerOptions}
        providerMenuIndex={providerMenuIndex}
        setProviderMenuIndex={setProviderMenuIndex}
        chooseProvider={chooseProvider}
        modelPickerOpen={modelPickerOpen}
        width={width}
        height={height}
        composerAccentColor={composerAccentColor}
        modelPickerTarget={modelPickerTarget}
        modelPickerPermissionLabel={modelPickerPermissionLabel}
        modelPickerOptions={modelPickerOptions}
        modelPickerIndex={modelPickerIndex}
        composerCopilotContextTier={composerCopilotContextTier}
        modelPickerFocus={modelPickerFocus}
        filteredModelPickerOptions={filteredModelPickerOptions}
        modelPickerLoading={modelPickerLoading}
        modelPickerError={modelPickerError}
        modelPickerQuery={modelPickerQuery}
        setModelPickerQuery={setModelPickerQuery}
        setModelPickerIndex={setModelPickerIndex}
        applyModelPickerOption={applyModelPickerOption}
        compactModelPickerEffortOptions={compactModelPickerEffortOptions}
        modelPickerEffortIndex={modelPickerEffortIndex}
        setModelPickerEffortIndex={setModelPickerEffortIndex}
        applyModelPickerEffort={applyModelPickerEffort}
        compactModelPickerPermissionOptions={compactModelPickerPermissionOptions}
        modelPickerPermissionIndex={modelPickerPermissionIndex}
        setModelPickerPermissionIndex={setModelPickerPermissionIndex}
        applyModelPickerPermission={applyModelPickerPermission}
        modelPickerFocusedLabel={modelPickerFocusedLabel}
        modelPickerFocusedOption={modelPickerFocusedOption}
        modelPickerFocusedDescription={modelPickerFocusedDescription}
        themeMenuOpen={themeMenuOpen}
        themeMenuOriginRef={themeMenuOriginRef}
        themeMenuGroup={themeMenuGroup}
        themeMenuQuery={themeMenuQuery}
        themeMenuIndex={themeMenuIndex}
        focusMode={focusMode}
        setThemeMenuQuery={setThemeMenuQuery}
        setThemeMenuIndex={setThemeMenuIndex}
        setThemeMode={setThemeMode}
        chooseTheme={chooseTheme}
        themeFollowsTerminal={themeFollowsTerminal}
        transcriptViewMenuOpen={transcriptViewMenuOpen}
        transcriptViewMenuOriginRef={transcriptViewMenuOriginRef}
        transcriptViewMenuIndex={transcriptViewMenuIndex}
        setTranscriptViewMenuIndex={setTranscriptViewMenuIndex}
        setTranscriptView={setTranscriptView}
        chooseTranscriptView={chooseTranscriptView}
        lightweightWindows={lightweightWindows}
        commandPaletteOpen={commandPaletteOpen}
        filteredCommands={filteredCommands}
        paletteDisplayRows={paletteDisplayRows}
        commandPaletteIndex={commandPaletteIndex}
        commandPaletteBodyRows={commandPaletteBodyRows}
        commandPaletteTopOffset={commandPaletteTopOffset}
        commandPaletteQuery={commandPaletteQuery}
        chordHelp={chordHelp}
        composerDockHeight={composerDockHeight}
        composerStatusBlockHeight={composerStatusBlockHeight}
        toasts={toasts}
        bookmarksOverlayOpen={bookmarksOverlayOpen}
        bookmarksOverlay={bookmarksOverlay}
        bookmarksOverlayIndex={bookmarksOverlayIndex}
      />

      {/* Under the reader the panel takes these rows in flow. The main row above
          keeps to its height (it would otherwise grow into them, and the
          reader's frame with it), and the panel must be laid out here rather
          than positioned out of the main row: a renderable outside its parent's
          bounds is painted but takes no mouse events. */}
      {surfacePanelAtBottom ? (
        <box
          id="surface-panel-frame"
          height={effectiveSurfacePanelRows}
          width={readerAreaWidth}
          marginLeft={sidebarWidth + verticalTabsWidth}
          flexShrink={0}
          overflow="hidden"
        >
          {surfacePanelElement}
        </box>
      ) : null}

      <TranscriptSearchBar searchMode={searchMode} width={width} theme={theme} searchMatches={searchMatches} searchMatchIndex={searchMatchIndex} searchQuery={searchQuery} setSearchQuery={setSearchQuery} jumpToTranscriptIndex={jumpToTranscriptIndex} setSearchMode={setSearchMode} />

      <SessionSearchBar sessionSearchMode={sessionSearchMode} width={width} theme={theme} filteredSessionsForSidebar={filteredSessionsForSidebar} sessions={sessions} sessionSearchQuery={sessionSearchQuery} setSessionSearchQuery={setSessionSearchQuery} sidebarEntries={sidebarEntries} setSelectedSessionKey={setSelectedSessionKey} setSessionSearchMode={setSessionSearchMode} />

      <QuestionPickerOverlay pendingPermissions={pendingPermissions} width={width} questionPickerPlan={questionPickerPlan} questionFocusIndex={questionFocusIndex} theme={theme} questionSelections={questionSelections} questionOptionIndex={questionOptionIndex} questionFreeformAnswers={questionFreeformAnswers} questionFreeformEditing={questionFreeformEditing} permissionActionLoading={permissionActionLoading} permissionOptionIndex={permissionOptionIndex} resolvePermissionOptionIndex={resolvePermissionOptionIndex} />

      <ComposerStatusStack
        presentationHidesComposer={presentationHidesComposer}
        liveStatus={liveStatus}
        visibleComposerSending={visibleComposerSending}
        theme={theme}
        width={width}
        composerLiveReasoning={composerLiveReasoning}
        isStreamView={isStreamView}
        composerProvider={composerProvider}
        tuiEffort={tuiEffort}
        composerThinkingTokens={composerThinkingTokens}
        liveReasoningPreviewLines={liveReasoningPreviewLines}
        embeddedComposer={embeddedComposer}
        composerTurnStatusInBorder={composerTurnStatusInBorder}
        isChatLikeView={isChatLikeView}
        densityState={densityState}
        composerSendStartedAt={composerSendStartedAt}
        composerWaitingStatusSeed={composerWaitingStatusSeed}
        composerWaitingSuffix={composerWaitingSuffix}
        composerWaitingOnUser={composerWaitingOnUser}
        reattachedRunning={reattachedRunning}
        visibleAwaitingPersistedTurn={visibleAwaitingPersistedTurn}
        composerTargetSession={composerTargetSession}
        sessionDetail={sessionDetail}
        visibleLiveToolActivities={visibleLiveToolActivities}
        visibleRunningToolCount={visibleRunningToolCount}
        composerActivityVisible={composerActivityVisible}
        liveSubagentText={liveSubagentText}
        livePromptSuggestion={livePromptSuggestion}
        composerSendState={composerSendState}
        composerStatusMessage={composerStatusMessage}
        visibleComposerLiveText={visibleComposerLiveText}
        visibleComposerError={visibleComposerError}
        liveAssistantTextCardVisible={liveAssistantTextCardVisible}
        liveAssistantPreviewLines={liveAssistantPreviewLines}
        composerAccentColor={composerAccentColor}
      />

      {!composerWindowOpen && !composerHidden && !presentationHidesComposer ? renderComposerMentionPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden && !presentationHidesComposer && !composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden && !presentationHidesComposer ? renderComposerHistoryPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden && !presentationHidesComposer ? renderComposerStashPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden && !presentationHidesComposer ? renderComposerRewindPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden && !presentationHidesComposer && !composerHistoryOpen && !composerStashOpen ? renderComposerQueuePanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}

      <ComposerDock
        composerWindowOpen={composerWindowOpen}
        composerHidden={composerHidden}
        presentationHidesComposer={presentationHidesComposer}
        embeddedComposer={embeddedComposer}
        composerAreaOffset={composerAreaOffset}
        composerAreaWidth={composerAreaWidth}
        composerDockBackground={composerDockBackground}
        fullscreenMode={fullscreenMode}
        composerDockRouted={composerDockRouted}
        isChatLikeView={isChatLikeView}
        composerDockEmphasized={composerDockEmphasized}
        composerAccentColor={composerAccentColor}
        theme={theme}
        composerTurnStatusInBorder={composerTurnStatusInBorder}
        composerTargetMessage={composerTargetMessage}
        composerDockTitleWidth={composerDockTitleWidth}
        composerDockBorderTitle={composerDockBorderTitle}
        composerDockHeight={composerDockHeight}
        surfacePanelFocused={surfacePanelFocused}
        setSurfacePanelFocused={setSurfacePanelFocused}
        composerActive={composerActive}
        setComposerActive={setComposerActive}
        composerTextareaRef={composerTextareaRef}
        composerDockTextareaWidth={composerDockTextareaWidth}
        composerSendStartedAt={composerSendStartedAt}
        composerWaitingStatusSeed={composerWaitingStatusSeed}
        composerWaitingSuffix={composerWaitingSuffix}
        composerWaitingOnUser={composerWaitingOnUser}
        renderComposerTextarea={renderComposerTextarea}
        submitComposerFromDock={submitComposerFromDock}
        composerDockTextareaHeight={composerDockTextareaHeight}
        composerDockFooterStatsWidth={composerDockFooterStatsWidth}
        voiceStatus={voiceStatus}
        composerSlashHint={composerSlashHint}
        clickComposerStatus={clickComposerStatus}
        dockFooterStatsFor={dockFooterStatsFor}
        composerDraftState={composerDraftState}
        hoverComposerStatus={hoverComposerStatus}
        setComposerStatusHover={setComposerStatusHover}
        composerStatusHover={composerStatusHover}
        dockShowsStatusBar={dockShowsStatusBar}
        selectedSession={selectedSession}
        composerDockFooterHintWidth={composerDockFooterHintWidth}
        visibleComposerSending={visibleComposerSending}
        footerSegments={footerSegments}
        composerDockSendingHintSegments={composerDockSendingHintSegments}
        composerDockFooterHint={composerDockFooterHint}
      />

      {!searchMode && !fullscreenMode && !statusBarInDock ? (
        <box backgroundColor={theme.surface2} paddingX={1} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
          <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <text wrapMode="none">{renderInlineTextSegments(footerSegments, Math.max(width - 2, 20), theme.dim)}</text>
          </box>
          <TeammatesAttention inline theme={theme} width={Math.floor(width / 3)} session={selectedSession} />
        </box>
      ) : null}


      {folderPickerForNewSession ? (
        <PluginSurfaceHost
          surfaceId="files"
          placement="overlay"
          cwd={newSessionCwd || gitRepoCwd}
          provided={folderPickerServices}
          theme={theme}
          syntaxStyle={handoffBriefSyntaxStyle}
          width={width}
          height={height}
          focused
          onClose={closeFolderPicker}
          onKeyHandlerReady={registerFolderPickerKeys}
        />
      ) : null}

      {newSessionModalOpen && !folderPickerForNewSession ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={51}
        />
      ) : null}

      {newSessionModalOpen && !folderPickerForNewSession ? (
        <NewSessionModal
          theme={theme}
          width={width}
          height={height}
          provider={newSessionProvider}
          cwd={newSessionCwd}
          busy={newSessionBusy}
          onCycleProvider={cycleNewSessionProvider}
          onBrowseFolder={openNewSessionFolderPicker}
          onCreate={submitNewSession}
          onClose={() => setNewSessionModalOpen(false)}
          onKeyHandlerReady={(handler) => { newSessionKeyHandlerRef.current = handler }}
        />
      ) : null}

      <PluginOverlayHost
        pluginOverlay={pluginOverlay}
        pluginSessionFor={pluginSessionFor}
        pluginSelectedDetail={pluginSelectedDetail}
        pluginLiveTranscript={pluginLiveTranscript}
        pluginOpenRequests={pluginOpenRequests}
        density={density}
        showToolCalls={showToolCalls}
        splitPaneShouldYield={splitPaneShouldYield}
        gitRepoCwd={gitRepoCwd}
        gitSessionId={gitSessionId}
        pluginServicesFor={pluginServicesFor}
        handoffBriefSyntaxStyle={handoffBriefSyntaxStyle}
        editorInitialPath={editorInitialPath}
        editorInitialLine={editorInitialLine}
        checkpointFocusPrompt={checkpointFocusPrompt}
        runCommandForPlugin={runCommandForPlugin}
        theme={theme}
        composerAccentColor={composerAccentColor}
        width={width}
        height={height}
        closePluginOverlay={closePluginOverlay}
        offerPopoverPlacement={offerPopoverPlacement}
        registerPluginOverlayKeys={registerPluginOverlayKeys}
      />

      {attentionOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={49}
        />
      ) : null}

      {attentionOpen ? (
        <AttentionInboxPopover
          items={attentionItems}
          theme={theme}
          width={width}
          height={height}
          respondingId={attentionRespondingId}
          onRespond={(item, response) => { void respondToAttentionItem(item, response) }}
          onOpenSession={openAttentionSession}
          onDismiss={dismissAttentionItem}
          onClose={() => setAttentionOpen(false)}
          onKeyHandlerReady={(handler) => { attentionKeyHandlerRef.current = handler }}
          onDetach={() => offerPopoverPlacement('attention')}
        />
      ) : null}

      {fileHistoryPath && gitRepoCwd ? (
        <PluginSurfaceHost
          surfaceId="file-history"
          placement="overlay"
          cwd={gitRepoCwd}
          repositorySessionId={gitSessionId}
          path={fileHistoryPath}
          provided={fileHistoryServices}
          runCommand={runCommandForPlugin}
          theme={theme}
          accent={composerAccentColor}
          width={width}
          height={height}
          focused
          // Above whichever overlay opened it; the root's modal scrim dims what is beneath.
          zIndex={MODAL_CONTENT_Z_INDEX}
          scrim={false}
          onClose={closeFileHistory}
          onDetach={() => offerPopoverPlacement('file-history')}
          onKeyHandlerReady={registerFileHistoryKeys}
        />
      ) : null}

      {dailySummaryOpen ? (
        <DailySummaryPopover
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          waiting={attentionItems.map((item) => ({ provider: item.provider, sessionId: item.sessionId, kind: item.kind, text: item.title }))}
          onClose={() => setDailySummaryOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { dailySummaryKeyHandlerRef.current = handler }}
          onDetach={() => offerPopoverPlacement('daily-summary')}
          onCopy={(text) => { void writeClipboard(text, renderer) }}
          onSendToComposer={(text) => {
            appendDiffCommentPromptToComposer(text)
            setDailySummaryOpen(false)
          }}
        />
      ) : null}

      {handoffBriefOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={49}
        />
      ) : null}

      {handoffBriefOpen ? (
        <HandoffBriefPopover
          session={selectedSessionTarget}
          detail={sessionDetail}
          bookmarkIds={bookmarkKeys}
          theme={theme}
          syntaxStyle={handoffBriefSyntaxStyle}
          width={width}
          height={height}
          onClose={() => setHandoffBriefOpen(false)}
          onCopy={async (text) => {
            try {
              await writeClipboard(text, renderer)
              showNotice('info', 'Copied handoff brief to clipboard')
            } catch (err) {
              showNotice('error', err instanceof Error ? err.message : 'Failed to copy handoff brief')
            }
          }}
          onKeyHandlerReady={(handler) => { handoffBriefKeyHandlerRef.current = handler }}
          onDetach={() => offerPopoverPlacement('handoff')}
        />
      ) : null}

      {promptLibraryOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={49}
        />
      ) : null}

      {promptLibraryOpen ? (
        <PromptLibraryPopover
          theme={theme}
          accentColor={composerAccentColor}
          width={width}
          height={height}
          activeProvider={selectedSessionTarget?.provider}
          loadPrompts={readTuiPrompts}
          loadPrompt={readTuiPrompt}
          savePrompt={saveTuiPrompt}
          deletePrompt={deleteTuiPrompt}
          onInsert={insertComposerPromptText}
          onClose={() => setPromptLibraryOpen(false)}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { promptLibraryKeyHandlerRef.current = handler }}
          onDetach={() => offerPopoverPlacement('prompt-library')}
        />
      ) : null}


      {composerWindowOpen && !presentationHidesComposer ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={59}
        />
      ) : null}

      <ComposerWindow
        composerWindowOpen={composerWindowOpen}
        presentationHidesComposer={presentationHidesComposer}
        composerWindowTop={composerWindowTop}
        composerWindowLeft={composerWindowLeft}
        composerWindowWidth={composerWindowWidth}
        composerWindowHeight={composerWindowHeight}
        composerAccentColor={composerAccentColor}
        theme={theme}
        composerWindowBorderTitle={composerWindowBorderTitle}
        composerTextareaRef={composerTextareaRef}
        composerWindowHeaderHeight={composerWindowHeaderHeight}
        composerWindowMetaSegments={composerWindowMetaSegments}
        composerWindowContentWidth={composerWindowContentWidth}
        composerWindowEditorHeight={composerWindowEditorHeight}
        renderComposerTextarea={renderComposerTextarea}
        submitComposerFromWindow={submitComposerFromWindow}
        composerWindowTextareaWidth={composerWindowTextareaWidth}
        renderComposerMentionPanel={renderComposerMentionPanel}
        composerHistoryOpen={composerHistoryOpen}
        composerStashOpen={composerStashOpen}
        renderComposerSlashPanel={renderComposerSlashPanel}
        renderComposerHistoryPanel={renderComposerHistoryPanel}
        renderComposerStashPanel={renderComposerStashPanel}
        renderComposerRewindPanel={renderComposerRewindPanel}
        renderComposerQueuePanel={renderComposerQueuePanel}
        composerWindowFooterHeight={composerWindowFooterHeight}
        composerWindowFooterStatsWidth={composerWindowFooterStatsWidth}
        composerSlashHint={composerSlashHint}
        composerDraftState={composerDraftState}
        composerWindowDraftFor={composerWindowDraftFor}
        composerWindowFooterHintWidth={composerWindowFooterHintWidth}
        composerWindowSendingHintSegments={composerWindowSendingHintSegments}
        composerWindowFooterHint={composerWindowFooterHint}
      />


      <GridSecondDivider
        arrangedVisible={arrangedVisible}
        fullscreenMode={fullscreenMode}
        windowZoom={windowZoom}
        splitArrangement={splitArrangement}
        arrangedLayout={arrangedLayout!}
        rectOf={rectOf}
        windowAreaRect={windowAreaRect}
        setSecondaryDividerHovered={setSecondaryDividerHovered}
        setSplitDividerDragging={setSplitDividerDragging}
        secondaryDividerHovered={secondaryDividerHovered}
        splitDividerDragging={splitDividerDragging}
        theme={theme}
      />

      {/* Every border between neighbouring panes: the frame before it, its
          right or bottom border, redrawn so it is hittable, and dragged. */}
      <WindowGroupDividers fullscreenMode={fullscreenMode} windowZoom={windowZoom} windowSurfacePeek={windowSurfacePeek} fittedWindows={fittedWindows} rectOf={rectOf} hoveredWindowBorder={hoveredWindowBorder} splitDividerDragging={splitDividerDragging} setHoveredWindowBorder={setHoveredWindowBorder} setSplitDividerDragging={setSplitDividerDragging} theme={theme} />

      {treeGeometry && !fullscreenMode && windowZoom === null && !windowSurfacePeek ? treeGeometry.dividers.map(divider => {
        const area = rectOf('window-area')
        if (!area) return null
        const vertical = divider.axis === 'x'
        return <box key={`tree-divider:${divider.path}`} id={`tree-divider:${divider.path}`} position="absolute"
          left={area.x + divider.rect.x + (vertical ? divider.firstExtent - 1 : 1)}
          top={area.y + divider.rect.y + (vertical ? 1 : divider.firstExtent - 1)}
          width={vertical ? 1 : Math.max(1, divider.rect.width - 2)} height={vertical ? Math.max(1, divider.rect.height - 2) : 1}
          zIndex={40} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); treeDividerActivePathRef.current = divider.path; treeDividerCheckpointedRef.current = false; setTreeDividerDrag(divider.path) } }}
          onMouseDrag={event => { event.stopPropagation(); dragTreeDivider(divider.path, event) }}
          onMouseUp={event => { event.stopPropagation(); dragTreeDivider(divider.path, event); treeDividerActivePathRef.current = null; treeDividerCheckpointedRef.current = false; setTreeDividerDrag(null) }}>
          <text fg={treeDividerDrag === divider.path ? theme.cyan : theme.border} selectable={false} wrapMode="none">{vertical ? Array(Math.max(1, divider.rect.height - 2)).fill('│').join('\n') : '─'.repeat(Math.max(1, divider.rect.width - 2))}</text>
        </box>
      }) : null}
      {treeDividerDrag !== null ? <box id="tree-divider-drag" position="absolute" left={0} top={0} width={width} height={height}
        backgroundColor={RGBA.fromValues(0, 0, 0, 0)} zIndex={58}
        onMouseDrag={event => { event.stopPropagation(); dragTreeDivider(treeDividerDrag, event) }}
        onMouseUp={event => { event.stopPropagation(); dragTreeDivider(treeDividerDrag, event); treeDividerActivePathRef.current = null; treeDividerCheckpointedRef.current = false; setTreeDividerDrag(null) }} /> : null}
      {treeDividerDrag !== null ? (() => {
        const divider = treeGeometry?.dividers.find(entry => entry.path === treeDividerDrag)
        const area = rectOf('window-area')
        if (!divider || !area) return null
        const vertical = divider.axis === 'x'
        const extent = vertical ? divider.rect.width : divider.rect.height
        return <box id="tree-divider-readout" position="absolute"
          left={Math.max(0, Math.min(width - 26, area.x + divider.rect.x + (vertical ? divider.firstExtent + 1 : 2)))}
          top={Math.max(0, Math.min(height - 1, area.y + divider.rect.y + (vertical ? 1 : divider.firstExtent)))}
          width={Math.min(26, width)} height={1} zIndex={901} backgroundColor={theme.cyan}>
          <text fg={theme.bg} selectable={false} wrapMode="none">{` ${divider.firstExtent} / ${extent - divider.firstExtent} ${vertical ? 'cols' : 'rows'} `}</text>
        </box>
      })() : null}
      {splitDividerDragging ? (
        // The divider drag, held by a full-screen layer for the same reason as the panel's.
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          zIndex={1000}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          onMouseDrag={(event: { x: number; y: number }) => dragSplitDivider(event)}
          onMouseUp={() => endSplitDividerDrag()}
        />
      ) : null}

      {floatGesturing ? (
        <box
          id="float-gesture-layer"
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          zIndex={1000}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          onMouseDrag={(event: { x: number; y: number }) => moveFloatGesture(event)}
          onMouseUp={(event: { x: number; y: number }) => endFloatGesture(event)}
        />
      ) : null}
      {sessionPressing ? (
        // Takes the gesture from the press onward (see sessionPressing). Before
        // the first frame it exists, the row itself still gets the release.
        <box
          id="session-press-layer"
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          zIndex={1000}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          onMouseDrag={(event: { x: number; y: number }) => sessionDragHandlers.move(event)}
          onMouseUp={(event: { x: number; y: number }) => sessionDragHandlers.release(event)}
        />
      ) : null}

      {projectedWindowGeometry ? (() => {
        const area = windowAreaRect()
        if (!area) return null
        const top = area.y - windowOverflowRows + projectedWindowGeometry.overflowRows
        return projectedWindowGeometry.rects.map((rect, index) => (
          <box key={index} id={`window-preview:${index}`} position="absolute"
            left={area.x + rect.x} top={top + rect.y} width={rect.width} height={rect.height}
            zIndex={sessionDrag ? 899 : MODAL_CONTENT_Z_INDEX - 2}
            border borderStyle="double" borderColor={theme.cyan}
            title={` ${index + 1} `} titleColor={theme.cyan} />
        ))
      })() : null}
      {floatDockHint ? (
        <>
          <box id="float-dock-zone" position="absolute" top={floatDockHint.rect.y} left={floatDockHint.rect.x} width={floatDockHint.rect.width} height={floatDockHint.rect.height} zIndex={900} border borderStyle="double" borderColor={theme.cyan} />
          <box id="float-dock-ghost" position="absolute" top={Math.min(Math.max(0, floatDockHint.y + 1), height - 1)} left={Math.min(Math.max(0, floatDockHint.x + 2), Math.max(0, width - floatDockHint.label.length - 5))} height={1} zIndex={901} backgroundColor={theme.surface3}>
            <text fg={theme.cyan} wrapMode="none" selectable={false}>{` ⠿ ${floatDockHint.label} `}</text>
          </box>
        </>
      ) : null}
      <SessionDragOverlay sessionDrag={sessionDrag} rectOf={rectOf} windowAreaRect={windowAreaRect} nestedDragPreview={nestedDragPreview} windowNumberOffset={windowNumberOffset} windowKeyTitle={windowKeyTitle} windowItems={windowItems} hasPrimaryFrame={hasPrimaryFrame} theme={theme} height={height} width={width} />
      <SplitDividerLabel splitDividerDragging={splitDividerDragging} splitDividerPoint={splitDividerPoint} width={width} theme={theme} fittedWindows={fittedWindows} splitSecondaryShare={splitSecondaryShare} arrangedLayout={arrangedLayout} splitReaderShare={splitReaderShare} rightPaneWidth={rightPaneWidth} readerRowBudget={readerRowBudget} />

      {windowControlMode && !windowControlsBlocked ? <WindowControlOverlay mode={windowControlMode} theme={theme} width={width} height={height}
        readWindows={readControlWindows} onPick={pickControlWindow} onMenu={openWindowControlMenu} /> : null}
      {contextMenu ? (
        <box
          id="context-menu-backdrop"
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          zIndex={MODAL_CONTENT_Z_INDEX}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          onMouseDown={() => setContextMenu(null)}
        />
      ) : null}
      {contextMenu ? (
        <ContextMenu
          key={`${controlMenuTarget ?? ''}:${contextMenu.title}:${contextMenu.x}:${contextMenu.y}`}
          theme={theme}
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.title}
          items={contextMenu.items}
          screenWidth={width}
          screenHeight={height}
          onClose={() => setContextMenu(null)}
          onKeyHandlerReady={(handler) => { contextMenuKeyHandlerRef.current = handler }}
        />
      ) : null}

      {windowSwitcherOpen || windowBroadcastOpen ? (
        <box position="absolute" top={0} left={0} width={width} height={height} zIndex={MODAL_CONTENT_Z_INDEX - 1} backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)} />
      ) : null}
      {windowSwitcherOpen ? (
        <WorkspaceOverview recent={recentWindowsOnly ? recentWindowVisits : undefined} controller={workspaceContext.controller} theme={theme} width={width} height={height}
          onMove={node => { if (node.workspaceId && node.target) openMoveWorkspaceMenu(node.workspaceId, node.target, node.id.includes(':tab:')) }}
          onPick={pickOverviewNode} onClose={() => setWindowSwitcherOpen(false)}
          onKeyHandlerReady={(handler) => { windowSwitcherKeyRef.current = handler }} />
      ) : null}
      {windowBroadcastOpen ? (
        <WindowBroadcastPopover targets={windowTargets.filter((target) => Boolean(target.session))} theme={theme} width={width} height={height}
          onSend={sendBroadcastPrompt} onClose={() => setWindowBroadcastOpen(false)}
          onKeyHandlerReady={(handler) => { windowBroadcastKeyRef.current = handler }} />
      ) : null}
      {windowPickerOpen ? (
        // A click anywhere outside the menu closes it, as a menu does. At the
        // menu's own layer and before it in the tree: one layer down is the
        // scrim's, which is later in the tree and would take the click.
        <box
          id="window-layout-backdrop"
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          zIndex={MODAL_CONTENT_Z_INDEX}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
          onMouseDown={() => setWindowPickerOpen(false)}
        />
      ) : null}
      {windowPickerOpen ? (
        <WindowLayoutPicker
          theme={theme}
          width={width}
          height={height}
          current={currentWindowLayoutAction}
          fullscreen={fullscreenMode}
          saved={savedWindowLayouts.map((entry) => ({ id: entry.id, name: entry.name, detail: describeSavedLayout(entry) }))}
          onSave={(name) => saveCurrentWindowLayout(name)}
          onRename={(id, name) => editSavedWindowLayout(id, name)}
          onUpdate={(id) => editSavedWindowLayout(id)}
          onPreview={setWindowLayoutPreview}
          previewLines={projectedWindowGeometry?.lines}
          previewDetail={projectedWindowGeometry?.detail}
          onRestore={(id) => restoreWindowLayout(id)}
          onDelete={(id) => deleteSavedWindowLayout(id)}
          onPick={(action) => applyWindowLayout(action)}
          onClose={() => { windowLayoutRestoreRequestRef.current += 1; setWindowPickerOpen(false) }}
          onKeyHandlerReady={(handler) => { windowPickerKeyHandlerRef.current = handler }}
        />
      ) : null}

      <SurfacePanelResizeLayer surfacePanelResizing={surfacePanelResizing} width={width} height={height} surfacePanelResizeFromRef={surfacePanelResizeFromRef} surfacePanelAtBottom={surfacePanelAtBottom} resizeSurfacePanelBy={resizeSurfacePanelBy} setSurfacePanelResizing={setSurfacePanelResizing} />

      <ToastOverlay toasts={toasts} theme={theme} width={width} height={height} zIndex={remoteCoordinatorTarget || contextMenu || windowSwitcherOpen || windowControlMode ? MODAL_SCRIM_Z_INDEX - 3 : undefined} />

      {worktreeModalOpen || worktreeConfirm || coordModalOpen || pluginOverlay === 'coordination' || teammatesModalOpen || remoteCoordinatorTarget || (fileHistoryPath && gitRepoCwd) || dailySummaryOpen || windowPickerOpen || pluginManagerOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          renderAfter={paintModalScrim}
          zIndex={MODAL_SCRIM_Z_INDEX}
        />
      ) : null}

      {pluginManagerOpen ? (
        <PluginManagerPopover
          theme={theme}
          width={width}
          height={height}
          onClose={() => setPluginManagerOpen(false)}
          onKeyHandlerReady={(handler) => { pluginManagerKeyHandlerRef.current = handler }}
          onNotice={showNotice}
        />
      ) : null}

      <WorktreeModalOverlay worktreeModalOpen={worktreeModalOpen} width={width} height={height} theme={theme} worktreeDraft={worktreeDraft} setWorktreeDraft={setWorktreeDraft} submitWorktreeTask={submitWorktreeTask} worktreeBusy={worktreeBusy} />

      <WorktreeConfirmOverlay worktreeConfirm={worktreeConfirm} selectedWorktreeTask={selectedWorktreeTask} width={width} height={height} theme={theme} />

      <CoordRunModal coordModalOpen={coordModalOpen} width={width} height={height} coordError={coordError} provider={provider} selectedSession={selectedSession} coordProviderOverride={coordProviderOverride} coordTeammateProviderOverride={coordTeammateProviderOverride} sessionDetail={sessionDetail} coordPlaybookName={coordPlaybookName} coordPlaybooks={coordPlaybooks} coordPlaybookArgsDraft={coordPlaybookArgsDraft} coordDraft={coordDraft} coordModalFocus={coordModalFocus} theme={theme} coordTextareaRef={coordTextareaRef} handleCoordContentChange={handleCoordContentChange} submitCoordinatedRun={submitCoordinatedRun} composerBaseTextareaStyle={composerBaseTextareaStyle} coordAcceptanceDraft={coordAcceptanceDraft} setCoordAcceptanceDraft={setCoordAcceptanceDraft} coordNonGoalsDraft={coordNonGoalsDraft} setCoordNonGoalsDraft={setCoordNonGoalsDraft} coordManualQaDraft={coordManualQaDraft} setCoordManualQaDraft={setCoordManualQaDraft} coordEscalationDraft={coordEscalationDraft} setCoordEscalationDraft={setCoordEscalationDraft} setCoordPlaybookArgsDraft={setCoordPlaybookArgsDraft} setCoordModalFocus={setCoordModalFocus} coordProviderPoolIndex={coordProviderPoolIndex} coordMaxAgents={coordMaxAgents} coordMaxTokens={coordMaxTokens} setCoordMaxTokens={setCoordMaxTokens} coordMaxDurationMinutes={coordMaxDurationMinutes} setCoordMaxDurationMinutes={setCoordMaxDurationMinutes} coordUseWorktrees={coordUseWorktrees} coordGateDraft={coordGateDraft} setCoordGateDraft={setCoordGateDraft} coordRequirePlanApproval={coordRequirePlanApproval} coordAutonomy={coordAutonomy} coordRequireReview={coordRequireReview} coordBusy={coordBusy} />

      {playbookManagerOpen ? (
        <PlaybookManagerPopover
          theme={theme}
          width={width}
          height={height}
          cwd={selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()}
          onClose={() => {
            setPlaybookManagerOpen(false)
            setCoordModalFocus('playbook')
          }}
          onChanged={handleCoordPlaybooksChanged}
          onNotice={showNotice}
          onKeyHandlerReady={(handler) => { playbookManagerKeyHandlerRef.current = handler }}
          onDetach={() => offerPopoverPlacement('playbooks')}
        />
      ) : null}

      {teammatesModalOpen ? (
        // Its state is the interactive coordinator store's: open while that is,
        // and closing it closes the panel, not the team.
        <PluginSurfaceHost
          surfaceId="teammates"
          placement="overlay"
          scrim={false}
          provided={pluginServices}
          runCommand={runCommandForPlugin}
          theme={theme}
          width={width}
          height={height}
          focused
          onClose={closeInteractiveCoordinator}
          onDetach={offerTeammatesPlacement}
          onKeyHandlerReady={registerTeammatesKeys}
        />
      ) : null}

      {remoteCoordinatorTarget ? (
        <RemoteCoordinatorPopover
          key={JSON.stringify(remoteCoordinatorTarget)}
          target={remoteCoordinatorTarget}
          theme={theme}
          width={width}
          height={height}
          onClose={() => setRemoteCoordinatorTarget(null)}
          onKeyHandlerReady={(handler) => { remoteCoordinatorKeyHandlerRef.current = handler }}
        />
      ) : null}

      {!fullscreenMode ? <PiActivityPopover theme={theme} width={width} height={height} /> : null}

      {exitConfirmOpen ? (
        <box
          position="absolute"
          top={0}
          left={0}
          width={width}
          height={height}
          backgroundColor={RGBA.fromValues(0, 0, 0, 0.35)}
          zIndex={89}
        />
      ) : null}

      <ExitConfirmOverlay exitConfirmOpen={exitConfirmOpen} width={width} composerSendState={composerSendState} runningSessions={runningSessions} exitCleanupInProgress={exitCleanupInProgress} height={height} theme={theme} />
    </box>
  )
}
