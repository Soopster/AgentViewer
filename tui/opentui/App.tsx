/** @jsxImportSource @opentui/react */
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
import { type MenuPoint, type WindowItem, type ComposerPromptPart, type QueuedComposerSend, type ComposerDraftSnapshot, type ClipboardImage, type SseFrame, type TuiLiveToolActivity, type PendingInboxEdit, type SidebarEntry, type SidebarSubagentEntry, type ModelPickerOption, type TuiEffort, type PaneFocus, type TuiMentionResult, type SteeredComposerSend, type TuiPermissionMode, type TuiCodexApproval, type TuiCopilotPermissionMode, type TuiCopilotContextTier, type ModelPickerFocus, type ComposerPromptPartRange, type ComposerSubmission, CLAUDE_PERMISSION_MODE_ORDER, type PaletteRow, type NoticeTone } from './app/types'
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

  const [provider, setProvider] = useWorkspaceState<ProviderSelection>('provider', 'claude')
  // One instance of `provider` (a second account, one ACP agent), or null for
  // all of them. The ref is what a refresh reads, so a poll already scheduled
  // lists what is selected now rather than what was selected when it was queued.
  const [providerInstanceId, setProviderInstanceId] = useWorkspaceState<string | null>('providerInstanceId', null)
  const providerInstanceIdRef = useRef<string | null>(null)
  const [providerInstances, setProviderInstances] = useState<TuiProviderInstanceChoice[]>([])
  const [themeMode, setThemeMode] = useAppState<TuiThemeMode>('themeMode', 'light')
  const [themeFollowsTerminal, setThemeFollowsTerminal] = useAppState('themeFollowsTerminal', false)
  // Bumped when the terminal's reported colours change, which is what the
  // terminal-palette theme is made of.
  const [terminalPaletteEpoch, setTerminalPaletteEpoch] = useState(0)
  const themeFollowsTerminalRef = useRef(false)
  // The theme last chosen from each side; following the terminal switches between them.
  const themeSlotsRef = useRef<{ light: TuiThemeMode; dark: TuiThemeMode }>({ light: 'light', dark: 'dark' })
  const [density, setDensity] = useAppState<TuiDensity>('density', 'balanced')
  const [diffLayout, setDiffLayout] = useAppState<TuiDiffLayout>('diffLayout', 'stack')
  const [transcriptDiffNotes, setTranscriptDiffNotes] = useWorkspaceState<Map<string, TranscriptDiffNote>>('transcriptDiffNotes', () => new Map())
  const [transcriptDiffDraft, setTranscriptDiffDraft] = useState<TranscriptDiffNoteDraft | null>(null)
  const [pendingTranscriptDiffPrompt, setPendingTranscriptDiffPrompt] = useState<{ target: string; prompt: string } | null>(null)
  const [hoveredTranscriptDiffAnchor, setHoveredTranscriptDiffAnchor] = useState<string | null>(null)
  const [transcriptDiffPlainCardKeys, setTranscriptDiffPlainCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenLineNumberCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffHiddenHunkHeaderCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys] = useState<Set<string>>(() => new Set())
  const [transcriptDiffRowCursorByCardKey, setTranscriptDiffRowCursorByCardKey] = useState<Record<string, number>>({})
  const [transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffSelectionAnchorByCardKey] = useState<Record<string, number>>({})
  const [agentToolCursorByGroupKey, setAgentToolCursorByGroupKey] = useState<Record<string, string>>({})
  const [transcriptView, setTranscriptView] = useAppState<TuiTranscriptView>('transcriptView', 'conversation')
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
  const [fullscreenMode, setFullscreenMode] = useWorkspaceState('fullscreenMode', false)
  const [railVisible, setRailVisible] = useAppState('railVisible', true)
  const [tabsEnabled, setTabsEnabled] = useState(true)
  const [tabOrientation, setTabOrientation] = useState<'horizontal' | 'vertical'>('horizontal')
  // Number of read-only split panes mounted beside the reader (0 = off), and
  // which of the other open tabs they start from.
  const [splitPaneCount, setSplitPaneCount] = useWorkspaceState('splitPaneCount', 0)
  // Panes are PINNED to explicit session keys, never derived positionally from
  // "the tabs that aren't active". A positional derivation reshuffles every
  // pane the moment the active tab changes (the candidate list reindexes), which
  // reads as panes randomly swapping while you navigate. The reconcile effect
  // below is the only thing that rewrites these keys.
  const [splitPinnedKeys, setSplitPinnedKeys] = useWorkspaceState<string[]>('splitPinnedKeys', [])
  // Which axis the split divides. Columns is the historical layout; rows is
  // what makes the split view reachable at all on a narrow terminal, where two
  // 46-column frames can never sit beside each other.
  const [splitOrientation, setSplitOrientation] = useWorkspaceState<SplitPaneOrientation>('splitOrientation', 'columns')
  // Reader's share of that axis. SPLIT_SHARE_EVEN keeps the even split every
  // layout had before the resize keys; anything else is a deliberate ⌃B < / >.
  const [splitReaderShare, setSplitReaderShare] = useWorkspaceState<number>('splitReaderShare', SPLIT_SHARE_EVEN)
  // Window arrangement of the reader and its panes (windowLayout.ts), and which
  // end of the split the reader sits at. Kept in tui.json beside the orientation.
  const [splitArrangement, setSplitArrangement] = useWorkspaceState<WindowArrangement>('splitArrangement', 'split')
  const [splitReaderLast, setSplitReaderLast] = useWorkspaceState('splitReaderLast', false)
  const [windowSplitTree, setWindowSplitTree] = useWorkspaceState<WindowSplitTree | null>('windowSplitTree', null)
  const [treeDividerDrag, setTreeDividerDrag] = useState<string | null>(null)
  const treeDividerCheckpointedRef = useRef(false)
  const treeDividerActivePathRef = useRef<string | null>(null)
  const [coordinatorWorkspace, setCoordinatorWorkspace] = useWorkspaceState<ProtocolRunSnapshot | null>('coordinatorWorkspace', null, false)
  const [coordinatorWorkspaceRunId, setCoordinatorWorkspaceRunId] = useWorkspaceState<string | null>('coordinatorWorkspaceRunId', null)
  const watchedRosterRef = useWorkspaceRef<{ runId: string; keys: Set<string> } | null>('watchedRoster', null, true)
  const watchedCoordinator = useCoordinatorWorkspace(coordinatorWorkspace, coordinatorWorkspaceRunId)
  const coordinatorBadges = useMemo(() => watchedCoordinator ? coordinatorWindowBadges(watchedCoordinator) : new Map<string, string>(), [watchedCoordinator])
  const [windowPickerOpen, setWindowPickerOpen] = useState(false)
  const [windowSwitcherOpen, setWindowSwitcherOpen] = useState(false)
  const [overviewPendingTarget, setOverviewPendingTarget] = useWorkspaceState<string | null>('windowOverviewPendingTarget', null, false)
  const [windowBroadcastOpen, setWindowBroadcastOpen] = useState(false)
  const [windowSurfacePeek, setWindowSurfacePeek] = useState<WindowSurfaceId | null>(null)
  const windowSwitcherKeyRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  const windowBroadcastKeyRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  const windowLayoutRestoreRequestRef = useRef(0)
  const [windowLayoutPreview, setWindowLayoutPreview] = useState<string | null>(null)
  const [windowAttention, setWindowAttention] = useWorkspaceState<Map<string, WindowAttention>>('windowAttention', () => new Map())
  const windowObservedFocusRef = useRef<string | null>(null)
  // This project's saved layouts, read when the menu opens.
  const [savedWindowLayouts, setSavedWindowLayouts] = useState<SavedWindowLayout[]>([])
  // Surfaces (a shell, the diff, files) open as windows in the layout, after
  // the session panes. A kind lives in one place: here or in the side panel,
  // because both would hand the same key-handler refs to two mounted views.
  const [windowSurfaces, setWindowSurfaces] = useWorkspaceState<WindowSurfaceId[]>('windowSurfaces', [])
  // What each popover window is pinned to (popoverWindows.ts), by window id.
  const [windowSurfaceMeta, setWindowSurfaceMeta] = useWorkspaceState<Record<WindowSurfaceId, SurfaceMeta>>('windowSurfaceMeta', {})
  // Popovers opened as tabs of this workspace's tab strip ("Fill this tab"), by
  // surface id, and the one shown in the reader's place (null: the reader).
  const [popoverTabs, setPopoverTabs] = useWorkspaceState<WindowSurfaceId[]>('popoverTabs', [])
  const popoverTabFrameRef = useRef<(() => React.ReactNode) | null>(null)
  const [activePopoverTab, setActivePopoverTab] = useWorkspaceState<WindowSurfaceId | null>('activePopoverTab', null)
  // The reader's place shows a popover tab instead of the transcript.
  const shownPopoverTab = activePopoverTab && popoverTabs.includes(activePopoverTab) ? activePopoverTab : null
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
  // ⌃B m: one window takes the whole area until it is pressed again ('reader' or a window index).
  const [windowZoom, setWindowZoom] = useWorkspaceState<'reader' | number | null>('windowZoom', null)
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
  const [showToolCalls, setShowToolCalls] = useAppState('showToolCalls', true)
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useAppState('velocityScrollEnabled', false)
  const [sidebarSort, setSidebarSort] = useState<TuiSidebarSort>('project')
  const [hideScratch, setHideScratch] = useState(false)
  const [showSettled, setShowSettled] = useState(false)
  const pendingInboxEditsRef = useRef<Map<string, PendingInboxEdit>>(new Map())
  const [sidebarView, setSidebarView] = useState<'sessions' | 'coordinator'>('sessions')
  const [sidebarWidthPreference, setSidebarWidthPreference] = useAppState('sidebarWidthPreference', DEFAULT_SIDEBAR_WIDTH)
  const [taskPanelWidth, setTaskPanelWidth] = useWorkspaceState('taskPanelWidth', TASK_PANEL_DEFAULT_WIDTH)
  const [taskPanelExpanded, setTaskPanelExpanded] = useWorkspaceState('taskPanelExpanded', false)
  // Surface panel: the terminal half of the web's right-hand panel. Open
  // surfaces live here; the panel is only *shown* when it is open, so the
  // reader keeps the full width until the user asks for it (⇧O).
  const [surfacePanelOpen, setSurfacePanelOpen] = useWorkspaceState('surfacePanelOpen', false)
  const [surfacePanelFocused, setSurfacePanelFocused] = useState(false)
  const [surfacePanelWidth, setSurfacePanelWidth] = useWorkspaceState('surfacePanelWidth', SURFACE_PANEL_DEFAULT_WIDTH)
  // Beside the reader (a column) or under it (a row), switched with `|` and kept in tui.json.
  const [surfacePanelPlacement, setSurfacePanelPlacement] = useWorkspaceState<'right' | 'bottom'>('surfacePanelPlacement', 'right')
  const [surfacePanelRows, setSurfacePanelRows] = useWorkspaceState('surfacePanelRows', SURFACE_PANEL_DEFAULT_ROWS)
  // A border drag in progress, and the last column/row the pointer was at.
  const [surfacePanelResizing, setSurfacePanelResizing] = useState(false)
  const surfacePanelResizeFromRef = useRef<number | null>(null)
  // Expanded: the panel takes everything the sidebar and the reader's minimum
  // leave. The reader stays mounted rather than being torn down — it keeps the
  // transcript's scroll position and its live-turn subscriptions alive, so
  // collapsing the panel again is instant instead of a full re-read.
  const [surfacePanelExpanded, setSurfacePanelExpanded] = useWorkspaceState('surfacePanelExpanded', false)
  const [surfacePanel, setSurfacePanel] = useWorkspaceState('surfacePanel', EMPTY_SURFACE_PANEL)
  const [surfaceBrowserRecent, setSurfaceBrowserRecent] = useWorkspaceState<string[]>('surfaceBrowserRecent', [])
  const surfacePanelKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // The side panel's plugin surface: its key handler and its claim on input
  // (TuiPluginCapture). The Terminal claims `input` while a command is typed
  // (keys reach its <input>) and `terminal` while a shell has the keyboard
  // (every key goes to the shell, the panel's own chords included, until ⌃]).
  const surfacePluginKeyRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  const surfacePluginKeyCaptureRef = useRef<TuiPluginCapture>(false)
  const [sessions, setSessions] = useWorkspaceState<Session[]>('sessions', [], false)
  const sessionsRef = useRef<Session[]>([])
  const [runningSessions, setRunningSessions] = useState<RunningSessionRef[]>([])
  const [waitingSessions, setWaitingSessions] = useState<Awaited<ReturnType<typeof readTuiRuntimeActivity>>['waiting']>([])
  const [viewerAttentionNotes, setViewerAttentionNotes] = useState<Awaited<ReturnType<typeof readTuiRuntimeActivity>>['attention']>([])
  const [selectedSessionKey, setSelectedSessionKeyState] = useWorkspaceState<string | null>('selectedSessionKey', null)
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
  const [focusedPane, setFocusedPane] = useWorkspaceState<PaneFocus>('focusedPane', 'sessions')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [themeMenuIndex, setThemeMenuIndex] = useState(0)
  const [themeMenuGroup, setThemeMenuGroup] = useState<ThemeMenuGroup>('dark')
  const [themeMenuQuery, setThemeMenuQuery] = useState('')
  const [transcriptViewMenuOpen, setTranscriptViewMenuOpen] = useState(false)
  const [transcriptViewMenuIndex, setTranscriptViewMenuIndex] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [exitCleanupInProgress, setExitCleanupInProgress] = useState(false)
  // The new-session folder picker: the Files plugin's view, asked to choose a directory.
  const folderPickerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  // The file the editor plugin opens on (its target), kept per workspace.
  const [editorInitialPath, setEditorInitialPath] = useWorkspaceState<string | null>('editorInitialPath', null)
  // 1-based, as every transcript reference and stack trace writes it; the editor
  // converts to its own 0-based cursor. Null means "no particular line", which
  // is not the same as line 1 — a file opened with no destination must restore
  // the reader's remembered place instead.
  const [editorInitialLine, setEditorInitialLine] = useWorkspaceState<number | null>('editorInitialLine', null)
  // New agent session modal: pick a folder (via the file picker in folder-select
  // mode) and provider before creating, instead of defaulting to the viewed cwd.
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false)
  const [newSessionProvider, setNewSessionProvider] = useState<AgentProvider>('claude')
  const [newSessionCwd, setNewSessionCwd] = useWorkspaceState<string>('newSessionCwd', workspaceCwd)
  const [newSessionBusy, setNewSessionBusy] = useState(false)
  const [folderPickerForNewSession, setFolderPickerForNewSession] = useState(false)
  const newSessionKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // The plugin surface open as an overlay, if any (lib/plugins/catalog.ts).
  const [pluginOverlay, setPluginOverlay] = useState<PluginSurfaceId | null>(null)
  // Each plugin surface's open requests: how many, and the session the latest named.
  const [pluginOpenRequests, setPluginOpenRequests] = useState<Partial<Record<PluginSurfaceId, { count: number; session: Session | null }>>>({})
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false)
  const pluginManagerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
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
  const lastBridgeChatIdRef = useRef<string | undefined>(undefined)
  // Track bridge sent/reply entries for inline display in the transcript
  const [bridgeTranscriptEntries, setBridgeTranscriptEntries] = useState<
    Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }>
  >([])
  // Track which bridge entries we've persisted to disk
  const persistedBridgeCountRef = useRef(0)
  // Attention inbox — cross-session triage of prompts blocked on a human and
  // background turns that finished while the user was elsewhere.
  const [attentionOpen, setAttentionOpen] = useState(false)
  const attentionKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // Pending Claude prompts from running sessions OTHER than the selected one
  // (the selected session's prompts live in pendingPermissions). Fed by the
  // registry poll.
  const [backgroundPrompts, setBackgroundPrompts] = useState<PendingPermission[]>([])
  // Turns that finished on sessions the user wasn't viewing; dismissed by
  // opening the session, pressing x in the inbox, or falling off the cap.
  const [attentionDone, setAttentionDone] = useState<Array<{
    key: string
    sessionId: string
    provider: AgentProvider
    sessionKey: string
    title: string
    createdAt: number
  }>>([])
  const [attentionRespondingId, setAttentionRespondingId] = useState<string | null>(null)
  // Prompt ids already announced via desktop notification (notify once each).
  const attentionNotifiedRef = useRef(new Set<string>())
  // Worktree task orchestration: ⇧F names a task, which spawns a session in an
  // isolated git worktree; merge/discard act on the selected session's task.
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false)
  const [worktreeDraft, setWorktreeDraft] = useState('')
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  // The selected session's worktree task (cwd inside .agent-viewer-worktrees),
  // or null. Drives the composer badge and gates merge/discard.
  const [selectedWorktreeTask, setSelectedWorktreeTask] = useState<WorktreeTask | null>(null)
  const selectedWorktreeTaskCacheRef = useRef(new Map<string, WorktreeTask | null>())
  const [worktreeConfirm, setWorktreeConfirm] = useState<'merge' | 'discard' | null>(null)
  const worktreeSubmitInFlightRef = useRef(false)
  const [coordModalOpen, setCoordModalOpen] = useState(false)
  const [coordDraft, setCoordDraft] = useState('')
  const [coordAcceptanceDraft, setCoordAcceptanceDraft] = useState('')
  const [coordNonGoalsDraft, setCoordNonGoalsDraft] = useState('')
  const [coordManualQaDraft, setCoordManualQaDraft] = useState('')
  const [coordEscalationDraft, setCoordEscalationDraft] = useState('')
  const [coordPlaybooks, setCoordPlaybooks] = useState<PlaybookSummary[]>([])
  const [coordPlaybookName, setCoordPlaybookName] = useState<string | null>(null)
  const [coordPlaybookArgsDraft, setCoordPlaybookArgsDraft] = useState('')
  const [playbookManagerOpen, setPlaybookManagerOpen] = useState(false)
  const playbookManagerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean) | null>(null)
  // Total agent budget for the next run, including the lead.
  const [coordMaxAgents, setCoordMaxAgents] = useState(3)
  // Quality gate command (TaskCompleted-hook equivalent) for the next run.
  const [coordGateDraft, setCoordGateDraft] = useState('')
  // Plan-approval guard: teammates must plan first and wait for lead approval.
  const [coordRequirePlanApproval, setCoordRequirePlanApproval] = useState(true)
  const [coordAutonomy, setCoordAutonomy] = useState<ProtocolAutonomy>('medium')
  const [coordRequireReview, setCoordRequireReview] = useState(true)
  const [coordMaxTokens, setCoordMaxTokens] = useState('')
  const [coordMaxDurationMinutes, setCoordMaxDurationMinutes] = useState('')
  // Isolate teammate edits by default, with an explicit shared-checkout mode.
  const [coordUseWorktrees, setCoordUseWorktrees] = useState(true)
  const [coordProviderOverride, setCoordProviderOverride] = useState<AgentProvider | null>(null)
  const [coordTeammateProviderOverride, setCoordTeammateProviderOverride] = useState<AgentProvider[] | null>(null)
  const [coordProviderPoolIndex, setCoordProviderPoolIndex] = useState(0)
  const [coordModalFocus, setCoordModalFocus] = useState<CoordModalFocus>('prompt')
  // Multiline prompt editor (composer-window treatment: ⏎ starts, ⇧⏎ newline).
  const coordTextareaRef = useRef<TextareaRenderable | null>(null)
  // Runs started this session being watched for terminal/blocked transitions.
  const [coordWatchIds, setCoordWatchIds] = useState<string[]>([])
  const coordWatchStateRef = useRef(new Map<string, { status: string; blockedAgents: Set<string> }>())
  const [coordBusy, setCoordBusy] = useState(false)
  // Run the board opens on (a just-started run); null = latest.
  const [coordBoardRunId, setCoordBoardRunId] = useState<string | null>(null)
  const [coordError, setCoordError] = useState<string | null>(null)
  const coordStartInFlightRef = useRef(false)
  // Fleet strip visibility preference (the strip only renders when it has
  // cells: running sessions or fresh background completions).
  const [fleetStripEnabled, setFleetStripEnabled] = useState(true)
  const [fleetPage, setFleetPage] = useState(0)
  // The turn the checkpoints plugin overlay (⇧U) opened on, when a turn summary opened it.
  const [checkpointFocusPrompt, setCheckpointFocusPrompt] = useState<{ sessionId: string; text: string; timestamp?: string } | null>(null)
  // The file-history plugin's overlay. It is a slot of its own rather than the
  // plugin overlay: it sits above whichever surface opened it (the editor, the
  // checkpoints overlay), which stay mounted beneath and get the keys back.
  const [fileHistoryPath, setFileHistoryPath] = useState<string | null>(null)
  const [dailySummaryOpen, setDailySummaryOpen] = useState(false)
  const dailySummaryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const fileHistoryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false)
  const [taskPanelTab, setTaskPanelTab] = useState<'tasks' | 'agents'>('tasks')
  const [composerSessions] = useState(createComposerSessions)
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
  // Global bookmarks overlay (cross-session/provider browser).
  const [bookmarksOverlayOpen, setBookmarksOverlayOpen] = useState(false)
  const [bookmarksOverlay, setBookmarksOverlay] = useState<MessageBookmark[]>([])
  const [bookmarksOverlayIndex, setBookmarksOverlayIndex] = useState(0)
  // When jumping to a bookmark in another session, remember where to land once
  // that session's transcript has loaded.
  const pendingBookmarkCursorRef = useRef<{ sessionKey: string; uuid: string } | null>(null)
  const [followTail, setFollowTail] = useWorkspaceState('followTail', true)
  // Absolute index (into visibleTranscriptCards) of the first mounted reader
  // card when the window is detached from the tail. null = pinned to the tail
  // (derived), which is also the followTail shape. See READER_CARD_WINDOW.
  const [pendingNewCount, setPendingNewCount] = useState(0)
  const [unreadBoundaryKey, setUnreadBoundaryKey] = useWorkspaceState<string | null>('unreadBoundaryKey', null)
  const [resumeMarkerKey, setResumeMarkerKey] = useWorkspaceState<string | null>('resumeMarkerKey', null)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [restoredReaderState, setRestoredReaderState] = useState<{
    sessionKey: string | null
    loaded: boolean
    state: TuiSessionReaderState | null
  }>({
    sessionKey: null,
    loaded: false,
    state: null,
  })
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [contextUsageStatus, setContextUsageStatus] = useState<'idle' | 'loading' | 'unavailable' | 'ready'>('idle')
  const [renameSessionKey, setRenameSessionKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const renameDraftRef = useRef(renameDraft)
  const [composerActive, setComposerActive] = useWorkspaceState('composerActive', false)
  const [composerWindowOpen, setComposerWindowOpen] = useWorkspaceState('composerWindowOpen', false)
  const [composerHidden, setComposerHidden] = useWorkspaceState('composerHidden', false)
  // The draft is read, not subscribed to: a keystroke must not re-render this root (see
  // useQuietWorkspaceState). `composerDraft` is its value as of this render; whatever changes
  // per key is drawn by a child that subscribes itself, or arrives through composerDraftShape.
  const composerDraftState = useQuietWorkspaceState('composerDraft', '')
  const composerDraft = composerDraftState.read()
  const setComposerDraft = useStableEvent((action: React.SetStateAction<string>) => {
    const next = typeof action === 'function' ? action(composerDraftState.read()) : action
    composerDraftRef.current = next
    composerDraftState.write(next, true)
  })
  const composerDraftStorageKeyRef = useRef<string | null>(null)
  const [composerLiveTodos, setComposerLiveTodos] = useComposerSessionState<import('../../lib/taskRegistry').OpenCodeTodo[]>(composerSessions, composerOwnerKey, 'composerLiveTodos', [])
  const [composerMention, setComposerMention] = useState<{ start: number; query: string } | null>(null)
  const [composerMentionResults, setComposerMentionResults] = useState<TuiMentionResult[]>([])
  const [composerAgentOptions, setComposerAgentOptions] = useState<SessionComposerAgentOption[]>([])
  const [composerMentionAgents, setComposerMentionAgents] = useState<SessionComposerAgentOption[]>([])
  const [composerMentionIndex, setComposerMentionIndex] = useState(0)
  const [composerMentionDismissedStart, setComposerMentionDismissedStart] = useState<number | null>(null)
  const [composerMentionAttachments, setComposerMentionAttachments] = useWorkspaceState<SendAttachment[]>('composerMentionAttachments', [])
  const [composerPromptParts, setComposerPromptParts] = useWorkspaceState<ComposerPromptPart[]>('composerPromptParts', [])
  const composerMentionAttachmentsRef = useRef<SendAttachment[]>([])
  const composerPromptPartsRef = useRef<ComposerPromptPart[]>([])
  useEffect(() => { composerMentionAttachmentsRef.current = composerMentionAttachments }, [composerMentionAttachments])
  useEffect(() => { composerPromptPartsRef.current = composerPromptParts }, [composerPromptParts])
  // Shelved drafts survive a restart: the whole point of stashing a prompt is
  // that you are not ready to send it, and "not ready" outlives one session.
  const [composerStash, setComposerStash] = useState<ComposerDraftSnapshot[]>(() =>
    readComposerStash(isComposerDraftSnapshot))
  const [composerStashOpen, setComposerStashOpen] = useState(false)
  // /rewind's prompt picker: the prompts it lists are frozen when it opens.
  const [composerRewindItems, setComposerRewindItems] = useState<RewindCandidate[] | null>(null)
  const [composerRewindIndex, setComposerRewindIndex] = useState(0)
  const [composerStashIndex, setComposerStashIndex] = useState(0)
  const [composerSlashIndex, setComposerSlashIndex] = useState(0)
  const [composerSlashDismissed, setComposerSlashDismissed] = useState(false)
  const [composerHistoryOpen, setComposerHistoryOpen] = useState(false)
  const [composerHistoryIndex, setComposerHistoryIndex] = useState(0)
  const [composerLiveSlashCommands, setComposerLiveSlashCommands] = useComposerSessionState<SlashCommandSuggestion[]>(composerSessions, composerOwnerKey, 'composerLiveSlashCommands', [])
  const [composerSendState, setComposerSendState] = useComposerSessionState<SendState>(composerSessions, composerOwnerKey, 'composerSendState', 'idle')
  // Transient stream UI belongs to the session that started the turn, not the
  // tab selected later. Keep the owner through persisted-transcript reconcile
  // so the final syncing spinner cannot jump across tabs either.
  const [composerActivitySessionKey, setComposerActivitySessionKey] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'composerActivitySessionKey', null)
  const [composerSendStartedAt, setComposerSendStartedAt] = useComposerSessionState<number | null>(composerSessions, composerOwnerKey, 'composerSendStartedAt', null)
  const [interruptPressActive, setInterruptPressActive] = useComposerSessionState(composerSessions, composerOwnerKey, 'interruptPressActive', false)
  const [backgroundingTasks, setBackgroundingTasks] = useState(false)
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
  // AskUserQuestion picker state (keyed off the active pending permission's id).
  const [questionFocusIndex, setQuestionFocusIndex] = useState(0)
  const [questionOptionIndex, setQuestionOptionIndex] = useState(0)
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({})
  const [questionFreeformAnswers, setQuestionFreeformAnswers] = useState<Record<number, string>>({})
  const [questionFreeformEditing, setQuestionFreeformEditing] = useState(false)
  const questionPermissionIdRef = useRef<string | null>(null)
  const [composerWaitingSeed, setComposerWaitingSeed] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerWaitingSeed', '')
  const [composerError, setComposerError] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'composerError', null)
  const [composerLiveText, setComposerLiveText] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerLiveText', '')
  // Reasoning streams on its own dim channel (see liveReasoning render below).
  const [composerLiveReasoning, setComposerLiveReasoning] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerLiveReasoning', '')
  // Live thinking-token estimate (SDK `thinking_tokens` messages); shown on the
  // THINKING preview header, reset each turn.
  const [composerThinkingTokens, setComposerThinkingTokens] = useComposerSessionState(composerSessions, composerOwnerKey, 'composerThinkingTokens', 0)
  const [liveTranscriptMessages, setLiveTranscriptMessages] = useState<ThreadedMessage[]>([])
  // Output of a Claude local slash command (/context, /usage, …). The CLI
  // persists it as a system row the SDK returns without content, so the
  // transcript re-read can never show it; it is held here — apart from the live
  // overlay the reconcile clears — until that session's next send.
  const [localCommandOutputs, setLocalCommandOutputs] = useState<ThreadedMessage[]>([])
  // Queued prompts waiting for the active turn to finish (CLI-style FIFO —
  // a single slot here used to silently overwrite the first queued message).
  const [queuedComposerSends, setQueuedComposerSends] = useWorkspaceState<QueuedComposerSend[]>('queuedComposerSends', () =>
    workspaceContext.runtime.values.get('legacyInitialWorkspace') === true ? readComposerQueue(isQueuedComposerSend) : [])
  const queuedComposerSendsRef = useRef<QueuedComposerSend[]>(queuedComposerSends)
  const [composerQueueDurable, setComposerQueueDurable] = useState(true)
  const [runningRegistryReady, setRunningRegistryReady] = useState(false)
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
  const [livePromptSuggestion, setLivePromptSuggestion] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'livePromptSuggestion', null)
  const [liveStatus, setLiveStatus] = useComposerSessionState<'requesting' | 'compacting' | 'retrying' | null>(composerSessions, composerOwnerKey, 'liveStatus', null)
  const [liveSubagentText, setLiveSubagentText] = useComposerSessionState<Record<string, string>>(composerSessions, composerOwnerKey, 'liveSubagentText', {})
  const [liveOutputTokens, setLiveOutputTokens] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveOutputTokens', 0)
  const [liveToolActivities, setLiveToolActivities] = useComposerSessionState<TuiLiveToolActivity[]>(composerSessions, composerOwnerKey, 'liveToolActivities', [])
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  const [composerEnableWorkflow, setComposerEnableWorkflow] = useState(false)
  // Provider-agnostic send knobs. Forwarded into the streamTuiSessionTurn
  // body so the TUI composer matches the web composer's send-time controls
  // (model / reasoning effort / provider permission mode). Defaults of `auto`
  // / `default` mean "let the SDK keep whatever the session was using".
  const [tuiEffort, setTuiEffort] = useState<TuiEffort>('auto')
  const [tuiPermissionModeByKey, setTuiPermissionModeByKey] = useState<Record<string, TuiPermissionMode>>({})
  const tuiPermissionModeByKeyRef = useRef<Record<string, TuiPermissionMode>>({})
  const [tuiCodexApprovalByKey, setTuiCodexApprovalByKey] = useState<Record<string, TuiCodexApproval>>({})
  // Codex's collaboration mode per session (the CLI's ⇧Tab Plan/Default). Read
  // through the ref at send time, so `/plan <goal>` sends in the mode it just set.
  // /add-dir roots per Claude session; sent with every turn (spawn-time option).
  const [tuiAddedDirsByKey, setTuiAddedDirsByKey] = useState<Record<string, string[]>>({})
  const tuiAddedDirsByKeyRef = useRef(tuiAddedDirsByKey)
  tuiAddedDirsByKeyRef.current = tuiAddedDirsByKey
  const [tuiCodexModeByKey, setTuiCodexModeByKey] = useState<Record<string, 'plan' | 'default'>>({})
  const tuiCodexModeByKeyRef = useRef(tuiCodexModeByKey)
  const setCodexCollaborationMode = useCallback((target: Session, mode: 'plan' | 'default') => {
    const next = { ...tuiCodexModeByKeyRef.current, [sessionKey(target)]: mode }
    tuiCodexModeByKeyRef.current = next
    setTuiCodexModeByKey(next)
  }, [])
  const [tuiCopilotPermissionModeByKey, setTuiCopilotPermissionModeByKey] = useState<Record<string, TuiCopilotPermissionMode>>({})
  // Mirrors web's CONTEXT selector (components/MessageView.tsx) — GitHub
  // Copilot's long-context tier. Toggled with ⌃L while the model picker is
  // open; only reachable when the selected model reports supportsLongContext.
  const [tuiCopilotContextTierByKey, setTuiCopilotContextTierByKey] = useState<Record<string, TuiCopilotContextTier>>({})
  const [tuiCopilotMode, setTuiCopilotMode] = useState<'interactive' | 'plan' | 'autopilot' | 'shell'>('interactive')
  const [tuiOpenCodeAgent, setTuiOpenCodeAgent] = useState('')
  const [tuiModelOverride, setTuiModelOverride] = useState<Record<string, string>>({})
  // Provider-reported models are separate from explicit overrides: using the
  // latter for discovery would silently force a model on the next send. Keep
  // null as a settled "provider default" result so the footer cannot claim it
  // is loading forever after a completed lookup with no concrete model.
  const [tuiReportedModelByKey, setTuiReportedModelByKey] = useState<Record<string, string | null>>({})
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerTarget, setModelPickerTarget] = useState<Session | null>(null)
  const [modelPickerFocus, setModelPickerFocus] = useState<ModelPickerFocus>('model')
  const [modelPickerOptions, setModelPickerOptions] = useState<ModelPickerOption[]>([])
  const [modelPickerPermissionOptions, setModelPickerPermissionOptions] = useState<SelectOption[]>([])
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerIndex, setModelPickerIndex] = useState(0)
  const [modelPickerEffortIndex, setModelPickerEffortIndex] = useState(0)
  const [modelPickerPermissionIndex, setModelPickerPermissionIndex] = useState(0)
  const [modelPickerLoading, setModelPickerLoading] = useState(false)
  const [modelPickerError, setModelPickerError] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<ComposerDraftSnapshot[]>(() =>
    readComposerSentHistory().map((text) => ({ text, attachments: [], promptParts: [] })),
  )
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<ComposerDraftSnapshot>({
    text: '',
    attachments: [],
    promptParts: [],
  })
  const [thinkingMode, setThinkingMode] = useState(false)

  // Store full Session objects so tabs retain provider context across
  // provider switches (looking them up in `sessions` loses other-provider tabs).
  const [openTabSessions, setOpenTabSessions] = useWorkspaceState<Session[]>('openTabSessions', [])

  const sidebarScrollRef = useRef<ScrollBoxRenderable>(null)
  // The window area's real height: the estimate from the content budget runs
  // a couple of rows short of what flex gives it.
  const [measuredWindowAreaHeight, setMeasuredWindowAreaHeight] = useState(0)
  // The cursor key SCROLLBACK last placed by scrolling. The reveal and recenter
  // effects skip a cursor that matches it: scrolling it back into view would
  // undo the scroll that moved it.
  const scrollbackSyncedCursorKeyRef = useRef<string | null>(null)
  const tabReaderPositionsRef = useTranscriptWindowPositions()
  const prevFollowTailRef = useRef(true)
  // Velocity scroll: ramps the per-tick cursor step up smoothly the longer j/k/↑/↓
  // is held, by tracking how recently the same-direction key keeps repeating.
  // A gap longer than VELOCITY_SCROLL_RESET_MS means the key was released (or
  // re-pressed deliberately), so the streak — and the speed — resets to base.
  const velocityScrollStateRef = useRef<{ direction: -1 | 1; streakStart: number; lastEventTime: number } | null>(null)
  const tabSelectRef = useRef<TabSelectRenderable>(null)
  const syncingTabSelectionRef = useRef(false)
  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const backgroundMetadataCursorRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const readerStateWriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readerStatePersistSignatureRef = useRef<string | null>(null)
  const expandedKeysRevisionRef = useRef(0)
  const collapsedKeysRevisionRef = useRef(0)
  const previousTranscriptRef = useRef<{ sessionKey: string | null; length: number; lastKey: string | null }>({
    sessionKey: null,
    length: 0,
    lastKey: null,
  })
  const loader = useTranscriptSessionLoader()
  const [ownedDetailCache] = useState(() => new TranscriptDetailCache())
  const sessionDetailCacheRef = useRef(ownedDetailCache)
  const sessionContextUsageCacheRef = useRef(new Map<string, ContextUsage | null>())
  const sessionMetadataFetchedAtRef = useRef(new Map<string, number>())
  const sessionMetadataInFlightRef = useRef(new Set<string>())
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
  const loadingDetailRef = useRef(false)
  // Single-flight coalescing for foreground detail loads. The threading worker
  // processes transcripts serially and can't cancel in-flight work, so firing a
  // load per settled session while scrubbing backs its queue up — opens start
  // fast then get progressively slower as the backlog grows. We run at most one
  // foreground load at a time and remember only the latest target requested
  // while it's busy; the in-flight load picks that up when it frees, skipping
  // every fly-by session in between.
  const foregroundLoadInFlightRef = useRef(false)
  const pendingForegroundLoadRef = useRef<Session | null>(null)
  // Open-path latency bookkeeping (metrics only — see noteTuiNavLatency).
  const navSelectStartRef = useRef<{ key: string; at: number } | null>(null)
  const navPaintedKeyRef = useRef<string | null>(null)
  const navDetailSetAtRef = useRef<{ key: string; at: number } | null>(null)
  const backgroundRefreshInFlightRef = useRef(new Set<string>())
  const sessionDetailMtimeRef = useRef(new Map<string, number>())
  const selectedSessionKeyRef = useRef<string | null>(null)
  const openTabSessionsRef = useRef<Session[]>([])
  const runningSessionsRef = useRef<RunningSessionRef[]>([])
  const tabsEnabledRef = useRef(true)
  const themeMenuOriginRef = useRef<TuiThemeMode | null>(null)
  const transcriptViewMenuOriginRef = useRef<TuiTranscriptView | null>(null)
  const currentThemeRef = useRef<TuiThemeMode>('light')
  const exitConfirmOpenRef = useRef(false)
  const exitInProgressRef = useRef(false)
  const densityRef = useRef<TuiDensity>('balanced')
  const showToolCallsRef = useRef(true)
  const transcriptDiffHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracked for the detail-poll skip path (proposal 6): the 2s background
  // refresh fires startTransition work that can interleave with keystroke
  // handling during active typing or searching, causing visible stutter.
  const composerActiveRef = useRef(false)
  const composerDraftRef = useRef('')
  const searchModeRef = useRef(false)
  const sessionSearchModeRef = useRef(false)
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
  useEffect(() => registerTuiMetricsGauge(() => ({
    sessions: sessions.length,
    runningSessions: runningSessionsRef.current.length,
    transcriptMessages: sessionDetail?.rawMessages.length ?? 0,
    threadedMessages: sessionDetail?.threadedMessages.length ?? 0,
    sessionDetailCache: sessionDetailCacheRef.current.size,
    transcriptEstimatedBytes: mainTranscriptBudget.bytes,
    transcriptBrokerObservers: loader.stats.pinned,
    transcriptBrokerTimer: loader.stats.timer ? 1 : 0,
    sessionContextUsageCache: sessionContextUsageCacheRef.current.size,
    sessionMetadataFetchedAt: sessionMetadataFetchedAtRef.current.size,
    sessionMetadataInFlight: sessionMetadataInFlightRef.current.size,
    liveToolIndexes: liveToolIndexesRef.current.size,
    liveToolInputJson: liveToolInputJsonRef.current.size,
    liveTranscriptBaseline: liveTranscriptBaselineRef.current.size,
    backgroundRefreshInFlight: backgroundRefreshInFlightRef.current.size,
    sessionDetailMtime: sessionDetailMtimeRef.current.size,
  })), [sessions.length, sessionDetail])
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
  // A hover caused by the transcript scrolling under a still pointer is not a
  // hover. The anchor is root state and an input to every mounted card, so
  // each diff row that passed beneath the pointer during a wheel scroll
  // re-rendered the root: 35 root commits of 8-15ms in one sustained scroll.
  // A hover is taken only at the scroll position the previous one was offered
  // at, which is true of a pointer moving over content that is standing still.
  const transcriptDiffHoverScrollTopRef = useRef(new Map<string, number | null>())
  const activateTranscriptDiffHover = useCallback((anchor: string, position?: { namespace: string; scrollTop: number | null }) => {
    const scrollTop = position ? position.scrollTop : null
    const namespace = position?.namespace ?? 'active'
    const offeredAt = transcriptDiffHoverScrollTopRef.current.get(namespace) ?? null
    transcriptDiffHoverScrollTopRef.current.set(namespace, scrollTop)
    if (offeredAt !== null && scrollTop !== offeredAt) return
    if (transcriptDiffHoverTimeoutRef.current) clearTimeout(transcriptDiffHoverTimeoutRef.current)
    setHoveredTranscriptDiffAnchor(anchor)
    transcriptDiffHoverTimeoutRef.current = setTimeout(() => {
      setHoveredTranscriptDiffAnchor(null)
      transcriptDiffHoverTimeoutRef.current = null
    }, 2000)
  }, [])
  // Sidebar selection changes on every scrub keypress. Read the latest note
  // state when invoked without invalidating all mounted card variants just
  // because the sidebar moved; this handler is passed to every transcript card.
  const openScopedTranscriptDiffNote = useStableEvent((namespace: string, selection: SelectedLineRange, cardKey?: string) => {
    const key = transcriptDiffSelectionKey(cardKey ? transcriptDiffCardNamespace(namespace, cardKey) : namespace, selection)
    const legacyKey = transcriptDiffSelectionKey(namespace, selection)
    const legacyAnchor = !transcriptDiffNotes.has(key) && transcriptDiffNotes.has(legacyKey) ? legacyKey : undefined
    setTranscriptDiffDraft({
      anchor: key, legacyAnchor,
      range: selection,
      lineLabel: transcriptDiffSelectionLineLabel(selection),
      text: (transcriptDiffNotes.get(key) ?? transcriptDiffNotes.get(legacyKey))?.text ?? '',
    })
  })
  const openTranscriptDiffNote = useStableEvent((selection: SelectedLineRange, cardKey?: string) => {
    openScopedTranscriptDiffNote(committedSessionKey ?? 'no-session', selection, cardKey)
  })
  const deleteTranscriptDiffNote = useCallback((selectionKey: string) => {
    setTranscriptDiffNotes((prev) => {
      const next = new Map(prev)
      next.delete(selectionKey)
      return next
    })
    setTranscriptDiffDraft((draft) => (draft?.anchor === selectionKey ? null : draft))
  }, [])
  const toggleTranscriptDiffCardSet = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, cardKey: string) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(cardKey)) next.delete(cardKey)
      else next.add(cardKey)
      return next
    })
  }, [])
  const clearTranscriptDiffSelectionForCard = useCallback((cardKey: string) => {
    setTranscriptDiffSelectionAnchorByCardKey((prev) => {
      if (!(cardKey in prev)) return prev
      const next = { ...prev }
      delete next[cardKey]
      return next
    })
  }, [])
  const setTranscriptDiffSelectionAnchorForCard = useCallback((cardKey: string, rowIndex: number) => {
    setTranscriptDiffSelectionAnchorByCardKey((prev) => ({ ...prev, [cardKey]: Math.max(0, rowIndex) }))
  }, [])
  const setTranscriptDiffRowCursorForCard = useCallback((cardKey: string, rowIndex: number, preserveSelection = false) => {
    setTranscriptDiffRowCursorByCardKey((prev) => ({ ...prev, [cardKey]: Math.max(0, rowIndex) }))
    if (!preserveSelection) clearTranscriptDiffSelectionForCard(cardKey)
  }, [clearTranscriptDiffSelectionForCard])
  const selectedSessionTarget = useMemo<Session | null>(() => (
    selectedSession
      ? {
          sessionId: selectedSession.sessionId,
          provider: selectedSession.provider,
        }
      : null
  ), [selectedSessionIdentity])
  // The session that the currently-loaded `sessionDetail` actually belongs to.
  // Memoized on `info` alone so its identity is stable as long as the detail is
  // — this is what keeps the transcript card cache from being busted mid-scrub.
  const detailSession = useMemo<Session | null>(() => {
    const info = sessionDetail?.info
    if (!info) return null
    return { sessionId: info.sessionId, provider: info.provider }
  }, [sessionDetail?.info])
  // Key the transcript off the session the detail belongs to, not the live
  // selection. While scrubbing quickly, `selectedSessionTarget` races ahead of
  // the debounced `sessionDetail` load; using it here would mismatch
  // `threadedMessages` and force a full uncached reformat of the (large) visible
  // transcript on every step. Falling back to `detailSession` keeps a stable
  // identity (cache hit) until the load we land on commits.
  const transcriptSession = useMemo<Session | null>(() => {
    if (!detailSession) return selectedSessionTarget
    if (
      selectedSessionTarget
      && selectedSessionTarget.sessionId === detailSession.sessionId
      && (selectedSessionTarget.provider ?? 'claude') === (detailSession.provider ?? 'claude')
    ) {
      return selectedSessionTarget
    }
    return detailSession
  }, [detailSession, selectedSessionTarget])
  // Key of the session whose transcript is actually on screen. Lags the live
  // `selectedSessionKey` by the open-debounce: while scrubbing it stays pinned
  // to the displayed session, so per-session effects (reader-state reset,
  // cursor reconcile, bookmark load) that would otherwise reset/rebuild the
  // transcript on every step simply don't fire until you settle. This is the
  // load-bearing guard against scrub jank on large sessions.
  const committedSessionKey = useMemo(
    () => (transcriptSession ? sessionKey(transcriptSession) : null),
    [transcriptSession],
  )
  const providerRunningSessions = useMemo(() => (
    runningSessions.filter((running) => provider === 'all' || running.provider === provider)
  ), [provider, runningSessions])
  // The session behind the focused pane, resolved from the pins rather than the
  // rendered pane list (which the layout computes much later). Session-scoped
  // features read this so they follow the pane you are looking at.
  const focusedSplitPaneSession = useMemo<Session | null>(() => {
    if (splitFocusIndex === null) return null
    const keys = orderWindows(windowOrder, splitPinnedKeys.slice(0, splitPaneCount), windowSurfaces)
    const key = splitFocusIndex === FLOATING_PANE_INDEX ? floatingWindow?.key : keys[splitFocusIndex]
    return key && !isSurfaceWindowKey(key) ? openTabSessions.find(tab => sessionKey(tab) === key) ?? null : null
  }, [splitFocusIndex, splitPinnedKeys, openTabSessions, windowOrder, splitPaneCount, windowSurfaces, floatingWindow])

  const composerTargetSession = useMemo<Session | null>(() => resolveComposerTargetSession({
    paneTargetKey: composerPaneTargetKey,
    preferredTargetKey: composerPreferredTargetKey,
    selectedSession,
    runningSessions: providerRunningSessions,
    sessions,
    openTabSessions,
    keyOf: sessionKey,
  }), [composerPaneTargetKey, composerPreferredTargetKey, openTabSessions, providerRunningSessions, selectedSession, sessions])
  const composerTargetSessionIdentity = composerTargetSession
    ? sessionKey(composerTargetSession)
    : null
  const activeQueuedComposerSends = useMemo(
    () => selectComposerQueueTarget(queuedComposerSends, composerTargetSessionIdentity),
    [composerTargetSessionIdentity, queuedComposerSends],
  )
  const composerTargetTurnKnownRunning = Boolean(
    composerTargetSessionIdentity
    && providerRunningSessions.some((running) => sessionKey(running) === composerTargetSessionIdentity),
  )
  const composerTargetSessionRef = useRef<Session | null>(null)
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
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    const seenPromptIds = new Set<string>()
    for (const prompt of [...pendingPermissions, ...backgroundPrompts]) {
      if (!prompt.id || seenPromptIds.has(prompt.id)) continue
      seenPromptIds.add(prompt.id)
      const promptProvider = prompt.provider ?? composerTargetSession?.provider ?? 'claude'
      // Stream-delivered prompts without a session id ride the composer's
      // current target — that is the turn that produced them.
      const sessionId = prompt.sessionId ?? composerTargetSession?.sessionId ?? ''
      const key = sessionKey({ sessionId, provider: promptProvider })
      const session = sessionsByKeyRef.current.get(key)
      items.push({
        key: `prompt:${prompt.id}`,
        kind: prompt.questions && prompt.questions.length > 0
          ? 'question'
          : prompt.toolName === 'ExitPlanMode'
          ? 'plan'
          : 'permission',
        sessionId,
        provider: promptProvider,
        sessionKey: key,
        sessionTitle: session ? formatSessionTitle(session) : sessionId.slice(-8) || 'unknown session',
        title: prompt.title,
        detail: prompt.detail ?? prompt.command ?? prompt.paths?.[0] ?? prompt.url,
        permission: prompt,
        createdAt: 0,
      })
    }
    for (const waiting of waitingSessions) {
      const key = sessionKey(waiting)
      const session = sessionsByKeyRef.current.get(key)
      const taskCount = waiting.backgroundTasks.length
      const cronCount = waiting.sessionCrons.length
      const details = [
        ...waiting.backgroundTasks.map((task) => task.description || `${task.type} ${task.status}`),
        ...waiting.sessionCrons.map((cron) => `scheduled ${cron.schedule}`),
      ]
      items.push({
        key: `waiting:${key}`,
        kind: 'waiting',
        sessionId: waiting.sessionId,
        provider: waiting.provider,
        sessionKey: key,
        sessionTitle: session ? formatSessionTitle(session) : waiting.sessionId.slice(-8),
        title: `${taskCount} background task${taskCount === 1 ? '' : 's'}, ${cronCount} scheduled wakeup${cronCount === 1 ? '' : 's'}`,
        detail: details.slice(0, 2).join(' · '),
        createdAt: waiting.updatedAt,
      })
    }
    for (const note of viewerAttentionNotes) {
      const key = sessionKey(note)
      const session = sessionsByKeyRef.current.get(key)
      items.push({
        key: `viewer:${note.id}`,
        kind: 'viewer-note',
        sessionId: note.sessionId,
        provider: note.provider,
        sessionKey: key,
        sessionTitle: session ? formatSessionTitle(session) : note.sessionId.slice(-8),
        title: note.title,
        detail: note.detail,
        attentionId: note.id,
        createdAt: note.createdAt,
      })
    }
    for (const done of attentionDone) {
      items.push({
        key: done.key,
        kind: 'turn-done',
        sessionId: done.sessionId,
        provider: done.provider,
        sessionKey: done.sessionKey,
        sessionTitle: done.title,
        title: 'Turn finished',
        createdAt: done.createdAt,
      })
    }
    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPermissions, backgroundPrompts, waitingSessions, viewerAttentionNotes, attentionDone, sessions, composerTargetSession])
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
  const recentlyWrittenKeys = recentlyWrittenSessions.keys

  const sidebarSessionActivityRef = useRef(new Map<string, 'needs-input' | 'running' | 'waiting'>())
  const sidebarSessionActivity = useMemo(() => {
    const needsInputKeys = new Set(
      attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey),
    )
    const activity = new Map<string, 'needs-input' | 'running' | 'waiting'>()
    for (const running of runningSessions) {
      const key = sessionKey(running)
      activity.set(key, needsInputKeys.has(key) ? 'needs-input' : 'running')
    }
    for (const waiting of waitingSessions) {
      const key = sessionKey(waiting)
      if (!activity.has(key)) activity.set(key, needsInputKeys.has(key) ? 'needs-input' : 'waiting')
    }
    for (const note of viewerAttentionNotes) {
      const key = sessionKey(note)
      if (!activity.has(key)) activity.set(key, 'needs-input')
    }
    // The same map when nothing changed: the attention items are rebuilt on
    // every selection (they name the composer's target), and a new map here
    // rebuilt every sidebar row.
    const previous = sidebarSessionActivityRef.current
    if (previous.size === activity.size && [...activity].every(([key, value]) => previous.get(key) === value)) return previous
    sidebarSessionActivityRef.current = activity
    return activity
  }, [attentionItems, runningSessions, waitingSessions, viewerAttentionNotes])

  // The session fleet a plugin view reads (the desk's alert book among it).
  // Derived only while such a view is shown, full screen or in a window:
  // nothing else reads it, and the attention items change on every registry poll.
  const fleetViewShown = [...(pluginOverlay ? [pluginOverlay] : []), ...windowedPopoverKinds]
    .some((id) => isPluginSurfaceId(id) && pluginSurfaceWants(id, 'session-fleet'))
  const fleetAlerts = useMemo(() => (fleetViewShown ? attentionItems.map((item) => ({
    key: item.key,
    sessionKey: item.sessionKey,
    provider: item.provider,
    sessionTitle: item.sessionTitle,
    title: item.title,
    detail: item.detail,
    needsInput: attentionItemNeedsInput(item),
    createdAt: item.createdAt,
  })) : []), [attentionItems, fleetViewShown])

  // Fleet strip: one cell per live session (running or blocked on input) plus
  // recent background completions — mission-control ambient awareness while
  // reading any single transcript. Digits 1-9 jump to a cell; ⇧A toggles.
  const fleetEntries = useMemo<Array<{
    key: string
    sessionId: string
    provider: AgentProvider
    title: string
    status: 'needs-input' | 'running' | 'waiting' | 'done'
  }>>(() => {
    const needsInputKeys = new Set(
      attentionItems.filter(attentionItemNeedsInput).map((item) => item.sessionKey),
    )
    const entries: Array<{
      key: string
      sessionId: string
      provider: AgentProvider
      title: string
      status: 'needs-input' | 'running' | 'waiting' | 'done'
    }> = runningSessions.map((ref) => {
      const key = sessionKey({ sessionId: ref.sessionId, provider: ref.provider })
      const session = sessionsByKeyRef.current.get(key)
      return {
        key,
        sessionId: ref.sessionId,
        provider: ref.provider,
        title: session ? formatSessionTitle(session) : ref.sessionId.slice(-8),
        status: needsInputKeys.has(key) ? 'needs-input' as const : 'running' as const,
      }
    })
    const liveKeys = new Set(entries.map((entry) => entry.key))
    for (const waiting of waitingSessions) {
      const key = sessionKey(waiting)
      if (liveKeys.has(key)) continue
      const session = sessionsByKeyRef.current.get(key)
      entries.push({
        key,
        sessionId: waiting.sessionId,
        provider: waiting.provider,
        title: session ? formatSessionTitle(session) : waiting.sessionId.slice(-8),
        status: needsInputKeys.has(key) ? 'needs-input' : 'waiting',
      })
      liveKeys.add(key)
    }
    for (const note of viewerAttentionNotes) {
      const key = sessionKey(note)
      if (liveKeys.has(key)) continue
      const session = sessionsByKeyRef.current.get(key)
      entries.push({
        key,
        sessionId: note.sessionId,
        provider: note.provider,
        title: session ? formatSessionTitle(session) : note.sessionId.slice(-8),
        status: 'needs-input',
      })
      liveKeys.add(key)
    }
    for (const done of attentionDone) {
      if (liveKeys.has(done.sessionKey)) continue
      entries.push({
        key: done.sessionKey,
        sessionId: done.sessionId,
        provider: done.provider,
        title: done.title,
        status: 'done' as const,
      })
    }
    // Blocked cells first — they are why the strip exists.
    return entries.sort((a, b) => {
      const rank = (status: string) => (status === 'needs-input' ? 0 : status === 'running' ? 1 : status === 'waiting' ? 2 : 3)
      return rank(a.status) - rank(b.status)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningSessions, waitingSessions, viewerAttentionNotes, attentionItems, attentionDone, sessions])
  const fleetStripVisible = fleetStripEnabled && !presentationFocusMode && fleetEntries.length > 0
  const fleetPageCount = Math.max(Math.ceil(fleetEntries.length / FLEET_PAGE_SIZE), 1)
  const activeFleetPage = Math.min(fleetPage, fleetPageCount - 1)
  const visibleFleetEntries = useMemo(
    () => fleetEntries.slice(activeFleetPage * FLEET_PAGE_SIZE, (activeFleetPage + 1) * FLEET_PAGE_SIZE),
    [activeFleetPage, fleetEntries],
  )
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

  const composerProvider = composerTargetSession?.provider ?? selectedSession?.provider ?? null
  const composerPermissionMode = useMemo<TuiPermissionMode>(() => {
    if (composerTargetSession?.provider !== 'claude') return 'default'
    return tuiPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'auto'
  }, [composerTargetSession, tuiPermissionModeByKey])
  const composerCodexApproval = composerTargetSession?.provider === 'codex'
    ? tuiCodexApprovalByKey[sessionKey(composerTargetSession)] ?? 'auto'
    : 'auto'
  const composerCodexMode = composerTargetSession?.provider === 'codex'
    ? tuiCodexModeByKey[sessionKey(composerTargetSession)] ?? 'default'
    : 'default'
  const composerCopilotPermissionMode = composerTargetSession?.provider === 'copilot'
    ? tuiCopilotPermissionModeByKey[sessionKey(composerTargetSession)] ?? 'off'
    : 'off'
  const composerCopilotContextTier = composerTargetSession?.provider === 'copilot'
    ? tuiCopilotContextTierByKey[sessionKey(composerTargetSession)] ?? 'default'
    : 'default'
  const composerConfig = useMemo(() => getProviderComposer(composerProvider), [composerProvider])
  const composerExampleSeed = useMemo(() => {
    const source = composerTargetSession?.sessionId ?? composerProvider ?? ''
    let hash = 0
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0
    return hash
  }, [composerTargetSession?.sessionId, composerProvider])
  const composerExample = useMemo(
    () => pickProviderExample(composerProvider, composerExampleSeed),
    [composerProvider, composerExampleSeed],
  )
  const composerAccentColor = useMemo(() => {
    const key = composerConfig.tuiAccentKey
    const value = (theme as unknown as Record<string, string>)[key]
    return value ?? theme.cyan
  }, [composerConfig.tuiAccentKey, theme])

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
  useEffect(() => {
    if (!canUseChannelBridge || (!channelBridgeOpen && !routeComposerToBridge)) return
    const config = readBridgeConfigFromEnv()
    let entrySeq = 0
    const unsubscribe = subscribeToChannelEvents(
      config,
      (event: ChannelEvent) => {
        if (event.type === 'reply') {
          const timestamp = new Date(Date.now() + entrySeq * 100).toISOString()
          setBridgeTranscriptEntries((prev) => [...prev, { kind: 'reply', text: event.text, timestamp }])
          entrySeq += 1
        }
      },
      (status) => {
        if (status !== 'connected' || !selectedSessionTarget) return
        void flushChannelBridgeOutbox(
          channelBridgeFileOutboxStorage,
          config,
          selectedSessionTarget.sessionId,
        ).then((result) => {
          if (result.error) showNotice('error', `Channel message remains queued: ${result.error.message}`)
        })
      },
    )
    return unsubscribe
  }, [canUseChannelBridge, channelBridgeOpen, routeComposerToBridge, selectedSessionTarget?.sessionId])

  // Load persisted bridge messages when selected session changes
  useEffect(() => {
    if (!canUseChannelBridge || !selectedSessionTarget) {
      setBridgeTranscriptEntries(keepEmpty)
      persistedBridgeCountRef.current = 0
      return
    }
    let isMounted = true
    ;(async () => {
      const persisted = await loadBridgeMessagesForSession(selectedSessionTarget.provider, selectedSessionTarget.sessionId)
      if (isMounted) {
        const entries = persisted.map((msg) => ({
          kind: msg.kind,
          text: msg.text,
          timestamp: msg.timestamp,
        }))
        setBridgeTranscriptEntries((current) => current.length === 0 && entries.length === 0 ? current : entries)
        persistedBridgeCountRef.current = entries.length
      }
    })().catch(console.error)
    return () => { isMounted = false }
  }, [canUseChannelBridge, selectedSessionTarget?.provider, selectedSessionTarget?.sessionId])

  // Persist new bridge messages to disk when they arrive
  useEffect(() => {
    if (!canUseChannelBridge || !selectedSessionTarget) return
    const newCount = bridgeTranscriptEntries.length
    const persistedCount = persistedBridgeCountRef.current
    if (newCount <= persistedCount) return

    // Persist only the new entries
    const newEntries = bridgeTranscriptEntries.slice(persistedCount)
    let cancelled = false
    ;(async () => {
      for (const entry of newEntries) {
        if (cancelled) return
        await addBridgeMessage(selectedSessionTarget.provider, selectedSessionTarget.sessionId, entry.kind, entry.text, entry.timestamp)
      }
      if (!cancelled) {
        persistedBridgeCountRef.current = newCount
      }
    })().catch(console.error)
    return () => { cancelled = true }
  }, [canUseChannelBridge, selectedSessionTarget?.provider, selectedSessionTarget?.sessionId, bridgeTranscriptEntries.length])

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

  const taskPanelMessages = useMemo(() => {
    const persisted = sessionDetail?.threadedMessages ?? []
    const live = liveTranscriptMessagesForSession
    if (live.length === 0) return persisted
    const seen = new Set(live.map((m) => m.uuid))
    return [...live, ...persisted.filter((m) => !seen.has(m.uuid))]
  }, [sessionDetail?.threadedMessages, liveTranscriptMessagesForSession])
  const liveAssistantTextCardVisible = useMemo(
    () => liveTranscriptMessagesForSession.some(isLiveAssistantTextMessage),
    [liveTranscriptMessagesForSession],
  )

  // Card formatting runs in the threading worker. The worker client keeps only
  // the most recent card variant; if it has been evicted, this render path can
  // still format synchronously from the already-threaded messages.
  // ── Base card computation — NOT dependent on live messages ────────────────
  // Separating base from the live overlay is the key perf fix: streaming deltas
  // change only liveTranscriptMessagesForSession, so this memo is stable for
  // the entire duration of a streaming turn. Before the split, every delta
  // triggered a full O(N_base) rebuild: buildTaskActiveForms/buildTaskRegistry
  // over all base messages + formatTranscriptCard × N_base on the main thread
  // (60–800ms per delta for a 63–136 card session). Now that work runs only
  // when sessionDetail/density/showToolCalls actually change.
  // Bumped when the warm-cache effect finishes an off-thread format, so the
  // memo below re-runs its (now-hitting) sync cache lookup. Only relevant for
  // sessions above SYNC_FORMAT_CARD_LIMIT, where the main-thread fallback is
  // skipped.
  const [workerCardCacheVersion, setWorkerCardCacheVersion] = useState(0)
  const baseTranscriptCards = useMemo<TuiTranscriptCard[]>(() => {
    const profileStart = CARD_PROFILE ? performance.now() : 0
    if (!transcriptSession || !sessionDetail) return []
    let cards: TuiTranscriptCard[]
    let recomputed = 0
    const attachedCards = attachedTranscriptCardsForVariant(sessionDetail, density, showToolCalls)
    const cachedSync = attachedCards ?? getTranscriptCardsSync(
      transcriptSession,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    )
    if (cachedSync) {
      cards = cachedSync
    } else if (sessionDetail.threadedMessages.length > SYNC_FORMAT_CARD_LIMIT) {
      // Too large to format on the render thread (this path is a multi-second
      // freeze on big sessions). The warm-cache effect below formats in the
      // worker and bumps workerCardCacheVersion when the cards are ready.
      cards = []
    } else {
      const filtered = showToolCalls
        ? sessionDetail.threadedMessages
        : stripToolCallBlocks(sessionDetail.threadedMessages)
      const activeForms = buildTaskActiveForms(filtered)
      const taskRegistry = buildTaskRegistry(filtered)
      const durations = computeTurnDurationsMs(filtered)
      cards = filtered.map((msg) => formatTranscriptCard(msg, density, activeForms, taskRegistry, durations.get(msg.uuid)))
      recomputed = cards.length
    }
    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'transcriptCards',
        totalCards: cards.length,
        recomputed,
        liveCards: 0,
        durationMs: performance.now() - profileStart,
      })
    }
    return cards
  }, [density, sessionDetail, transcriptSession, showToolCalls, workerCardCacheVersion])

  // ── Task context for live cards — stable across streaming deltas ───────────
  // buildTaskActiveForms and buildTaskRegistry scan the full base transcript.
  // Memoizing them separately ensures the O(N_base) scan runs at most once per
  // sessionDetail update (2s poll cadence), never per streamed token.
  // Live messages occasionally contain TaskCreate/TaskUpdate calls; their task
  // events appear in the persisted transcript (and therefore here) on the next
  // poll, which is the correct behaviour — the live overlay is ephemeral.
  // Only the live/bridge overlay cards consume this context (base cards are
  // formatted in the worker), so skip the two O(N_base) scans entirely when no
  // overlay exists — i.e. on every settled scrub/open of an idle session.
  const hasTranscriptOverlay = liveTranscriptMessagesForSession.length > 0 || bridgeTranscriptEntries.length > 0
  const baseTaskContext = useMemo(() => {
    if (!sessionDetail || !hasTranscriptOverlay) return { activeForms: new Map() as ReturnType<typeof buildTaskActiveForms>, taskRegistry: new Map() as ReturnType<typeof buildTaskRegistry> }
    const filtered = showToolCalls
      ? sessionDetail.threadedMessages
      : stripToolCallBlocks(sessionDetail.threadedMessages)
    return {
      activeForms: buildTaskActiveForms(filtered),
      taskRegistry: buildTaskRegistry(filtered),
    }
  }, [sessionDetail, hasTranscriptOverlay, showToolCalls])
  const liveTurnStartedAt = selectedSessionTarget
    ? liveTranscriptBaselineRef.current.get(sessionKey(selectedSessionTarget))?.startedAt
    : undefined

  // Bridge entries change rarely compared with streamed assistant deltas.
  // Format and interleave them with the persisted transcript separately so a
  // token update does not rebuild bridge cards or sort all N persisted cards.
  const baseAndBridgeTranscriptCards = useMemo<TuiTranscriptCard[]>(() => {
    if (bridgeTranscriptEntries.length === 0) return baseTranscriptCards
    const bridgeCards: TuiTranscriptCard[] = bridgeTranscriptEntries.map((entry, i) => {
      const bridgeMessage: ThreadedMessage = {
        role: entry.kind === 'sent' ? 'user' : 'assistant',
        uuid: `bridge-${i}`,
        timestamp: entry.timestamp,
        origin: { kind: 'bridge' },
        blocks: [{ type: 'text', text: entry.text }],
      }
      return {
        ...formatTranscriptCard(bridgeMessage, density, baseTaskContext.activeForms, baseTaskContext.taskRegistry),
        key: `bridge:${i}`,
      }
    })
    return [...baseTranscriptCards, ...bridgeCards]
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
  }, [baseTaskContext, baseTranscriptCards, bridgeTranscriptEntries, density])

  const latestBaseAndBridgeTimestamp = useMemo(
    () => baseAndBridgeTranscriptCards.reduce(
      (latest, card) => Math.max(latest, card.timestampMs ?? 0),
      0,
    ),
    [baseAndBridgeTranscriptCards],
  )

  // ── Live overlay — O(N_live) per delta, base cards always cache-hit ────────
  const transcriptCards = useMemo<TuiTranscriptCard[]>(() => {
    const profileStart = CARD_PROFILE ? performance.now() : 0
    // No live overlay (the common case while browsing/scrubbing): return the
    // stable persisted/bridge array as-is. Skipping the copy + sort keeps array
    // identity stable so every downstream per-card WeakMap cache keeps hitting.
    if (liveTranscriptMessagesForSession.length === 0) {
      if (CARD_PROFILE) {
        logCardRecompute({
          scope: 'transcriptCards',
          totalCards: baseAndBridgeTranscriptCards.length,
          recomputed: 0,
          liveCards: 0,
          durationMs: performance.now() - profileStart,
        })
      }
      return baseAndBridgeTranscriptCards
    }
    const liveMessages = showToolCalls
      ? liveTranscriptMessagesForSession
      : stripToolCallBlocks(liveTranscriptMessagesForSession)
    const liveTimestampBase = liveTurnStartedAt ?? latestBaseAndBridgeTimestamp + 1
    const liveCards = liveMessages.map((message, index) => {
      const timestampedMessage = message.timestamp
        ? message
        : { ...message, timestamp: new Date(liveTimestampBase + index).toISOString() }
      const formatted = formatTranscriptCard(
        timestampedMessage,
        density,
        baseTaskContext.activeForms,
        baseTaskContext.taskRegistry,
      )
      return {
        ...formatted,
        // Live prose changes every few milliseconds. Render its already-
        // formatted text lines synchronously while it grows; the markdown
        // renderer is intentionally restored when the durable card replaces
        // this overlay, avoiding a blank async-markdown frame per new block.
        markdownContent: isLiveAssistantTextMessage(message) ? undefined : formatted.markdownContent,
        key: `live:${message.uuid}`,
      }
    })

    // Live turns normally follow every persisted/bridge card. Preserve the
    // existing append order without scanning and sorting the live suffix on
    // every streamed token; the provider's live sequence is already ordered.
    const sortedCards = [...baseAndBridgeTranscriptCards, ...liveCards]

    if (CARD_PROFILE) {
      logCardRecompute({
        scope: 'transcriptCards',
        totalCards: sortedCards.length,
        recomputed: liveCards.length,
        liveCards: liveCards.length,
        durationMs: performance.now() - profileStart,
      })
    }
    return sortedCards
  }, [baseAndBridgeTranscriptCards, baseTaskContext, density, latestBaseAndBridgeTimestamp, liveTranscriptMessagesForSession, liveTurnStartedAt, showToolCalls])

  // Continue is prose-only. Stream mirrors native agent CLIs: conversation plus
  // compact operational rows, while low-level system bookkeeping stays hidden.
  const groupedToolView = transcriptView === 'agents' || isChatLikeView
  const visibleTranscriptCards = useMemo(
    () => visibleCardsForTranscriptView(transcriptCards, transcriptView),
    [transcriptCards, transcriptView],
  )

  useLayoutEffect(() => {
    if (!selectedSessionTarget || !sessionDetail) return
    const key = sessionKey(selectedSessionTarget)
    const baseline = liveTranscriptBaselineRef.current.get(key)
    if (!baseline) return
    const durableSummary = summarizeDurableSessionMessages(sessionDetail.rawMessages)
    const persistedTurnArrived =
      durableSummary.count > baseline.count
      || durableSummary.lastFingerprint !== baseline.lastFingerprint
      || durableSummary.sequenceFingerprint !== baseline.sequenceFingerprint
    if (!persistedTurnArrived) return
    const liveAssistantVisible = Boolean(composerLiveText.trim())
      || hasLiveAssistantMessage(liveTranscriptMessagesForSession, key)
    const turnLanded = awaitingPersistedTurn
      ? persistedTurnSettled(sessionDetail.rawMessages, baseline.count)
      : hasPersistedAssistantAfterBaseline(sessionDetail.rawMessages, baseline.count)
    // See refreshSelectedSessionDetail: never finalize under a live stream.
    const streamStillOwned = ownsComposerStream(key)
    if (streamStillOwned || (liveAssistantVisible && !turnLanded)) {
      // The assistant is still streaming. Swap the live user echo for the real
      // persisted row ONLY once that row has actually landed as a durable
      // message — `persistedTurnArrived` is a coarse change signal (count OR
      // fingerprint OR sequence), so removing the echo on any change can drop
      // the user's message before its persisted card exists, leaving a
      // poll-timed gap until the assistant finishes. Keep the echo until the
      // persisted user message is genuinely present (which also avoids a
      // duplicate, since echo and persisted row have different uuids).
      if (hasPersistedUserAfterBaseline(sessionDetail.rawMessages, baseline.count)) {
        setLiveTranscriptMessages((prev) => {
          const next = visibleComposerMessages(prev, persistedComposerMessages)
          return next.length === prev.length ? prev : next
        })
      }
      return
    }

    liveTranscriptBaselineRef.current.delete(key)
    setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== key))
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    setComposerLiveText('')
    setAwaitingPersistedTurn(false)
  }, [awaitingPersistedTurn, composerLiveText, liveTranscriptMessagesForSession, selectedSessionIdentity, selectedSessionTarget, sessionDetail])

  // Escape hatch mirroring the web composer: if the persisted rows for a
  // completed turn never arrive, force-reveal the polled transcript after a
  // bounded wait so the live overlay / "Syncing…" state can't stick forever.
  useEffect(() => {
    if (!awaitingPersistedTurn) return
    const timer = setTimeout(() => {
      const key = composerActivitySessionKey
      if (key) {
        liveTranscriptBaselineRef.current.delete(key)
        setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== key))
      }
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      setComposerLiveText('')
      setAwaitingPersistedTurn(false)
    }, AWAITING_PERSISTED_TURN_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [awaitingPersistedTurn, composerActivitySessionKey])

  // (Auto-open of the composer on a pending session was removed: with
  // composerActive=true, the global key handler's `N` / `c` / `q` shortcuts
  // were intercepted by the composer-active branch. The welcome banner +
  // explicit `c` keypress is the native model here.)

  // Warm the worker + client caches when the user toggles density/showToolCalls
  // to a variant that isn't yet cached. The synchronous fallback above keeps the
  // UI responsive in the meantime; this effect just ensures subsequent toggles
  // hit the cache instead of running a main-thread format every time.
  useEffect(() => {
    if (!sessionDetail || !transcriptSession) return
    const attachedCardsMatch = attachedTranscriptCardsForVariant(sessionDetail, density, showToolCalls) !== null
    const cachedSync = getTranscriptCardsSync(
      transcriptSession,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    )
    if (attachedCardsMatch || cachedSync) {
      setError((current) => current?.startsWith('Failed to format transcript') ? null : current)
      return
    }
    let cancelled = false
    setError((current) => current?.startsWith('Failed to format transcript') ? null : current)
    void formatTranscriptCardsAsync(
      transcriptSession,
      sessionDetail.threadedMessages,
      density,
      showToolCalls,
    ).then(() => {
      // Re-render so baseTranscriptCards picks the cards up from the sync
      // cache — required for over-SYNC_FORMAT_CARD_LIMIT sessions, which
      // render empty until this format lands.
      if (!cancelled) setWorkerCardCacheVersion((version) => version + 1)
    }).catch((cause) => {
      if (!cancelled) {
        setError(cause instanceof Error
          ? `Failed to format transcript: ${cause.message}`
          : 'Failed to format transcript')
      }
    })
    return () => {
      cancelled = true
    }
  }, [density, sessionDetail, transcriptSession, showToolCalls])
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


  const selectSidebarSession = useStableEvent((session: Session) => {
    setSidebarSubagentCursor(null)
    const existing = windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === sessionKey(session))
    if (existing >= 0) { focusSplitPane(existing); return }
    if (floatingItem?.kind === 'session' && sessionKey(floatingItem.session) === sessionKey(session)) { focusSplitPane(FLOATING_PANE_INDEX); return }
    const key = sessionKey(session)
    // A focused window takes the selection; otherwise selecting it is enough,
    // and the selected session is put in a window.
    if (splitFocusIndex !== null) {
      checkpointWindowLayout()
      setWorkspaceLaunched(true)
      setOpenTabSessions(current => current.some(tab => sessionKey(tab) === key) ? current : [...current, session])
      const old = focusedWindowItem?.kind === 'session' ? windowItemKey(focusedWindowItem) : null
      const nextKeys = old && splitFocusIndex !== FLOATING_PANE_INDEX ? orderedWindowKeys.map(entry => entry === old ? key : entry) : [...orderedWindowKeys, key]
      if (old && splitFocusIndex === FLOATING_PANE_INDEX && floatingWindow) setFloatingWindow({ ...floatingWindow, key })
      else {
        commitWindowKeys(nextKeys)
        setWindowSplitTree(reconciledSplitTree ? reconcileWindowSplitTree(reconciledSplitTree, nextKeys, false) : arrangePaneTree(nextKeys, false, 'columns'))
      }
      if (old) setWindowStacks(liveWindowStacks.map(stack => stack.map(entry => entry === old ? key : entry)))
      setComposerPaneTargetKey(key)
      setOverviewPendingTarget(key)
      setFocusedPane('messages')
      return
    }
    setActivePopoverTab(null)
    setComposerPaneTargetKey(key)
    setWorkspaceHasSession(true); setWorkspaceLaunched(true)
    setSelectedSessionKey(key)
    setError(null)
    setFocusedPane('sessions')
  })

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
  const toggleSidebarSort = useCallback(() => {
    setSidebarSort((current) => {
      const next: TuiSidebarSort = current === 'project' ? 'time' : 'project'
      void writeTuiSidebarSort(next).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store sidebar sort'))
      return next
    })
  }, [])

  const resolvedExpandedKeys = useMemo(
    () => resolveExpandedCardKeys(visibleTranscriptCards, transcriptView, isChatLikeView, expandedCardKeys, collapsedCardKeys),
    [collapsedCardKeys, expandedCardKeys, visibleTranscriptCards, transcriptView],
  )

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  // Deferred: search computation runs after user interactions, so typing stays instant.
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const searchMatches = useMemo(() => {
    if (!deferredSearchQuery) return []
    // Avoid allocating one short array per card while scanning a large
    // transcript. Search runs on every deferred query update, so a single
    // result array matters for 10,000-message sessions.
    const matches: number[] = []
    for (let index = 0; index < visibleTranscriptCards.length; index += 1) {
      if (visibleTranscriptCards[index].searchHaystackLower.includes(deferredSearchQuery)) {
        matches.push(index)
      }
    }
    return matches
  }, [deferredSearchQuery, visibleTranscriptCards])

  const readCursorIndex = () => {
    if (visibleTranscriptCards.length === 0) return -1
    if (followTail) return visibleTranscriptCards.length - 1
    const cursorKey = readTranscriptCursorKey()
    const index = cursorKey ? transcriptIndexByKey.get(cursorKey) ?? -1 : -1
    if (index >= 0) return index
    return 0
  }

  const unreadBoundaryIndex = useMemo(
    () => unreadBoundaryKey ? (transcriptIndexByKey.get(unreadBoundaryKey) ?? -1) : -1,
    [transcriptIndexByKey, unreadBoundaryKey],
  )

  const readerTitle = useMemo(() => (
    sessionDetail?.info?.customTitle
    ?? sessionDetail?.info?.summary
    ?? selectedSession?.customTitle
    ?? selectedSession?.summary
    ?? '(untitled session)'
  ), [selectedSession, sessionDetail?.info])

  // null (not 'unknown') so joinMeta drops it — a session whose model we can't
  // resolve shows just its project, never a dangling "· unknown".
  const readerModel = sessionDetail?.info?.currentModel ?? null

  // Git follows the focused split pane when there is one: the popover is
  // cwd-scoped, and the pane you are looking at is the repo you mean.
  const gitRepoCwd = focusedSplitPaneSession?.cwd ?? sessionDetail?.info?.cwd ?? selectedSession?.cwd ?? workspaceCwd
  // Scopes the git panel's turn list, and follows the same pane-then-selection
  // precedence as the cwd it is read alongside.
  const gitSessionId = focusedSplitPaneSession?.sessionId ?? sessionDetail?.info?.sessionId ?? selectedSession?.sessionId ?? null
  const projectCount = useMemo(
    () => new Set(sessions.map((session) => formatSessionProject(session))).size,
    [sessions],
  )
  const foldedTechnicalCount = useMemo(
    () => visibleTranscriptCards.filter((card) => card.autoFold && !resolvedExpandedKeys.has(card.key)).length,
    [resolvedExpandedKeys, visibleTranscriptCards],
  )
  // Split the live-stream fast path out of the O(transcript) scan so the
  // expensive `.some()` only recomputes when expanded keys or cards change —
  // not on every RAF flush that mutates composerLiveText while a turn streams.
  const liveSyntaxActive = composerSendState === 'sending' && Boolean(composerLiveText)
  const expandedSyntaxActive = useMemo(
    () => visibleTranscriptCards.some((card) => {
      if (!resolvedExpandedKeys.has(card.key)) return false
      return Boolean(card.markdownContent || (card.codeBlocks && card.codeBlocks.length > 0))
    }),
    [resolvedExpandedKeys, visibleTranscriptCards],
  )
  const shouldEnableSyntaxHighlighting = liveSyntaxActive || expandedSyntaxActive
  const syntaxStyle = useMemo(
    () => shouldEnableSyntaxHighlighting ? buildSyntaxStyle(theme, renderer.nativeScene) : null,
    [shouldEnableSyntaxHighlighting, theme, renderer],
  )
  const handoffBriefSyntaxStyle = useMemo(
    () => syntaxStyle ?? buildSyntaxStyle(theme, renderer.nativeScene),
    [syntaxStyle, theme, renderer],
  )
  const normalizedSessionQuery = sessionSearchQuery.trim().toLowerCase()
  const spaceSessions = useMemo(() => {
    if (allProjects) return sessions
    const paths = new Map<string, string>()
    const project = canonicalSpacePath(workspaceCwd)
    return sessions.filter(session => {
      if (!session.cwd) return false
      let cwd = paths.get(session.cwd)
      if (!cwd) { cwd = canonicalSpacePath(session.cwd); paths.set(session.cwd, cwd) }
      return cwd === project || cwd.startsWith(project + '/')
    })
  }, [sessions, allProjects, workspaceCwd])
  const searchSidebarSessions = useMemo(() => createSidebarSessionSearch(spaceSessions), [spaceSessions])
  const searchedSessionsForSidebar = useMemo(
    () => searchSidebarSessions(normalizedSessionQuery),
    [searchSidebarSessions, normalizedSessionQuery],
  )
  // A search looks at everything: hiding scratch is about the resting list,
  // and a query that names a hidden session should still find it.
  const scratchFilter = useMemo(() => {
    if (!hideScratch || normalizedSessionQuery) return { sessions: searchedSessionsForSidebar, hidden: 0 }
    return hideScratchSessions(searchedSessionsForSidebar, (session) => {
      const key = sessionKey(session)
      return key === selectedSessionKey
        || sidebarSessionActivity.has(key)
        || recentlyWrittenSessions.keys.has(key)
        || teamAttention.has(key)
    })
  }, [hideScratch, normalizedSessionQuery, searchedSessionsForSidebar, selectedSessionKey, sidebarSessionActivity, recentlyWrittenSessions, teamAttention])
  // Settled sessions are done: out of the resting list, like the web rail's ✓,
  // until shown again or found by a search. The selected one stays, so the row
  // just settled is still there to reopen with a second `x`; so do live ones.
  const settledFilter = useMemo(() => {
    const source = scratchFilter.sessions
    if (showSettled || normalizedSessionQuery) return { sessions: source, hidden: 0 }
    let hidden = 0
    const shown: Session[] = []
    for (const session of source) {
      const key = sessionKey(session)
      if (session.inbox?.settledAt && key !== selectedSessionKey && !sidebarSessionActivity.has(key) && !recentlyWrittenSessions.keys.has(key)) {
        hidden += 1
        continue
      }
      shown.push(session)
    }
    return hidden === 0 ? { sessions: source, hidden: 0 } : { sessions: shown, hidden }
  }, [normalizedSessionQuery, recentlyWrittenSessions, scratchFilter.sessions, selectedSessionKey, showSettled, sidebarSessionActivity])
  const filteredSessionsForSidebar = settledFilter.sessions
  // Some providers expose subagents inside a parent transcript instead of as
  // durable child sessions. Fetch their lightweight summaries lazily for the
  // currently open session. Providers with real children (OpenCode/Codex) are
  // already represented through parentSessionId and return no summaries here.
  // Read in the transcript worker, which already holds the provider graph. A
  // session that turns out to have none is remembered outside state: most have
  // none, and a new map per selection rebuilt every sidebar row.
  const [collapsedSubagentParents, setCollapsedSubagentParents] = useWorkspaceState<string[]>('collapsedSubagentParents', [])
  const collapsedSubagentSet = useMemo(() => new Set(collapsedSubagentParents), [collapsedSubagentParents])
  const [subagentTranscriptSelection, setSubagentTranscriptSelection] = useState<{ parent: Session; agent: SubagentSummary } | null>(null)
  const toggleSidebarSubagents = useStableEvent((parent: Session) => {
    const key = sessionKey(parent)
    setCollapsedSubagentParents(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key])
  })
  const [providerSubagentSummaries, setProviderSubagentSummaries] = useState<Map<string, SubagentSummary[]>>(new Map())
  const subagentSummariesReadRef = useRef(new Set<string>())
  useEffect(() => {
    const target = selectedSessionTarget
    if (!target) return
    const cacheKey = sessionKey(target)
    const read = subagentSummariesReadRef.current
    if (read.has(cacheKey)) return
    let cancelled = false
    void readTuiSubagentSummariesAsync(target).then((subagents) => {
      if (cancelled) return
      read.add(cacheKey)
      if (read.size > SUBAGENT_SUMMARY_CACHE_LIMIT) read.delete(read.values().next().value!)
      if (subagents.length === 0) return
      setProviderSubagentSummaries((previous) => {
        const next = new Map(previous).set(cacheKey, subagents)
        for (const key of next.keys()) if (next.size > SUBAGENT_SUMMARY_CACHE_LIMIT && key !== cacheKey) next.delete(key)
        return next
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedSessionTarget])

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
  const composerHeight = embeddedComposer
    ? Math.max(CHAT_COMPOSER_MIN_HEIGHT, Math.min(
        composerDraftLines + CHAT_COMPOSER_CHROME_HEIGHT,
        COMPOSER_MAX_HEIGHT,
        Math.floor(height * 0.35),
      ))
    : Math.max(
        fullscreenMode ? COMPOSER_MIN_HEIGHT - 1 : COMPOSER_MIN_HEIGHT,
        Math.min(
          fullscreenMode ? COMPOSER_MAX_HEIGHT - 2 : COMPOSER_MAX_HEIGHT,
          composerDraftLines + composerDockChromeHeight,
        ),
      )
  const composerDockHeight = composerWindowOpen || composerHidden ? 0 : composerHeight
  const composerDockTextareaHeight = embeddedComposer
    ? Math.max(1, composerDockHeight - CHAT_COMPOSER_CHROME_HEIGHT)
    : Math.max(2, composerDockHeight - composerDockChromeHeight)
  const composerTargetSessionInfo = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const activeDetail = sessionDetail?.info
    if (
      selectedSessionKey === targetKey
      && activeDetail
      && activeDetail.sessionId === composerTargetSession.sessionId
      && activeDetail.provider === composerTargetSession.provider
    ) {
      return activeDetail
    }
    return sessionDetailCacheRef.current.get(targetKey)?.info ?? null
  }, [composerTargetSession, selectedSessionKey, sessionDetail])
  const composerCurrentModel = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const modelOverride = tuiModelOverride[targetKey]
    const selectedDetailModel = composerTargetSessionInfo?.currentModel
    const reportedModel = tuiReportedModelByKey[targetKey]
    const contextModel = selectedSessionKey === targetKey ? contextUsage?.model : undefined
    const rawModel = modelOverride ?? selectedDetailModel ?? reportedModel ?? contextModel
    if (!rawModel) return null
    const model = formatModelChipValue(rawModel)
    return model && model.toLowerCase() !== 'unknown' ? model : null
  }, [composerTargetSession, composerTargetSessionInfo, contextUsage, selectedSessionKey, tuiModelOverride, tuiReportedModelByKey])
  const composerModelLookupSettled = Boolean(
    composerTargetSessionIdentity
    && Object.prototype.hasOwnProperty.call(tuiReportedModelByKey, composerTargetSessionIdentity),
  )
  const filteredModelPickerOptions = useMemo(
    () => filterModelPickerOptions(modelPickerOptions, modelPickerQuery),
    [modelPickerOptions, modelPickerQuery],
  )
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
  const modelPickerFocusedDescription = modelPickerFocusedOption?.description
    || String(modelPickerFocusedOption?.value ?? '')
  const composerContextUsage = useMemo(() => {
    if (!composerTargetSession) return null
    const targetKey = sessionKey(composerTargetSession)
    const usage = selectedSessionKey === targetKey
      ? contextUsage
      : sessionContextUsageCacheRef.current.get(targetKey) ?? null
    return usage ?? null
  }, [composerTargetSession, contextUsage, selectedSessionKey])
  const [composerPlanLimits, setComposerPlanLimits] = useState<ClaudePlanLimits | null>(null)
  // One-line chip summarising the active model, explicit effort, and any
  // provider-specific send knobs.
  const composerKnobSegments = useMemo<InlineTextSegment[]>(() => {
    const parts: InlineTextSegment[] = []
    // The mode lives here rather than on a row of its own above the dock, and
    // first: the border fits one or two settings at common widths, and a
    // hidden bypass is the one that matters. Its colour still warns.
    if (composerTargetSession?.provider === 'claude' && composerPermissionMode !== 'default') {
      parts.push({
        text: `${PERMISSION_MODE_GLYPH[composerPermissionMode] ?? ''} ${PERMISSION_MODE_LABEL[composerPermissionMode] ?? composerPermissionMode}`.trim(),
        fg: composerPermissionMode === 'bypassPermissions' ? theme.red : composerPermissionMode === 'plan' ? theme.dim : theme.amber,
      })
    }
    const afterMode = parts.length
    if (composerCurrentModel) {
      parts.push({ text: `model:${composerCurrentModel}`, fg: composerAccentColor, action: 'model' })
    } else if (composerTargetSession?.provider && composerTargetSession.provider !== 'claude-acp' && composerTargetSession.provider !== 'codex-acp' && composerTargetSession.provider !== 'acp') {
      // Custom-model providers (LM Studio, opencode/copilot custom endpoints,
      // Claude on a non-default deployment) can take a moment to report their
      // current model on a cold session. Show the in-flight state, then settle
      // on "auto" when the provider intentionally reports no concrete model.
      parts.push({ text: composerModelLookupSettled ? 'model:auto' : 'model:loading…', fg: theme.dim, action: 'model' })
    }
    // Context and plan limit are meters: quiet while there is room, and moved
    // ahead of the model once either needs attention, since the border cuts
    // off whatever does not fit.
    const meters: InlineTextSegment[] = []
    let metersUrgent = false
    if (composerContextUsage) {
      const pct = Number.isFinite(composerContextUsage.percentage) ? composerContextUsage.percentage : 0
      metersUrgent ||= pct >= 60
      meters.push({ text: `ctx:${formatContextUsageChip(composerContextUsage)}`, fg: contextBarColor(pct, theme) })
    }
    const limitSegment = planLimitSegment(composerPlanLimits, theme)
    if (limitSegment) {
      metersUrgent ||= limitSegment.fg !== theme.dim
      meters.push(limitSegment)
    }
    if (metersUrgent) parts.splice(afterMode, 0, ...meters)
    else parts.push(...meters)
    parts.push({ text: `effort:${tuiEffort}`, fg: theme.dim, action: 'model' })
    if (composerTargetSession?.provider === 'opencode' && tuiOpenCodeAgent) {
      parts.push({ text: `agent:${tuiOpenCodeAgent}`, fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'codex' && composerCodexMode === 'plan') {
      parts.push({ text: 'mode:plan', fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'codex' && composerCodexApproval !== 'auto') {
      parts.push({ text: `approvals:${composerCodexApproval}`, fg: theme.violet })
    }
    if (composerTargetSession?.provider === 'copilot' && tuiCopilotMode !== 'interactive') {
      parts.push({ text: `mode:${tuiCopilotMode}`, fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'copilot' && composerCopilotPermissionMode !== 'off') {
      parts.push({ text: `permissions:${composerCopilotPermissionMode}`, fg: composerCopilotPermissionMode === 'on' ? theme.red : theme.amber })
    }
    if (composerTargetSession?.provider === 'copilot' && composerCopilotContextTier === 'long_context') {
      parts.push({ text: 'context:long', fg: theme.cyan })
    }
    if (composerTargetSession?.provider === 'claude' && composerEnableWorkflow) {
      parts.push({ text: 'workflow:on', fg: theme.cyan })
    }
    return parts
  }, [composerAccentColor, composerCodexApproval, composerCodexMode, composerContextUsage, composerPlanLimits, theme, composerCopilotContextTier, composerCopilotPermissionMode, composerCurrentModel, composerEnableWorkflow, composerModelLookupSettled, composerPermissionMode, composerTargetSession?.provider, theme.amber, theme.cyan, theme.dim, theme.green, theme.red, theme.violet, tuiCopilotMode, tuiEffort, tuiOpenCodeAgent])
  const composerWorkingDirectory = composerTargetSessionInfo?.cwd ?? composerTargetSession?.cwd ?? null
  const composerGitBranch = composerTargetSessionInfo?.gitBranch ?? null
  const [composerGitSummary, setComposerGitSummary] = useState<GitSummary | null>(null)
  useEffect(() => {
    if (!composerWorkingDirectory) {
      setComposerGitSummary(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    // Only clear the indicator when this cwd has nothing cached. Blanking it on
    // every switch made the branch flicker off and back on when moving between
    // two sessions in the same repository.
    setComposerGitSummary(peekGitSummaryCached(composerWorkingDirectory))
    // Each poll is three `git` processes, one of them a full `status -u`; at a
    // fixed 5s an idle TUI spawned them all day, and they were a fifth of its
    // idle samples. An unchanged answer doubles the wait (to
    // COMPOSER_GIT_SUMMARY_IDLE_POLL_MS); any change — a turn editing files —
    // snaps it back, so the indicator is current exactly when it is moving.
    let delay = COMPOSER_GIT_SUMMARY_POLL_MS
    let lastSignature: string | null = null
    const refresh = async (force: boolean) => {
      const summary = await readGitSummaryCached(composerWorkingDirectory, { force })
      if (cancelled) return
      setComposerGitSummary(summary)
      const signature = JSON.stringify(summary)
      delay = signature === lastSignature ? Math.min(delay * 2, COMPOSER_GIT_SUMMARY_IDLE_POLL_MS) : COMPOSER_GIT_SUMMARY_POLL_MS
      lastSignature = signature
      timer = setTimeout(() => { void refresh(true) }, delay)
    }
    void refresh(false)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [composerWorkingDirectory])
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
  const buildComposerStatsSegments = (lineCount: number, draftLength: number): InlineTextSegment[] => {
    const segments: InlineTextSegment[] = []
    if (draftLength === 0) {
      segments.push({ text: ` ${composerConfig.label} `, fg: theme.surface, bg: composerAccentColor })
    } else {
      segments.push({ text: `${lineCount} line${lineCount === 1 ? '' : 's'}`, fg: composerAccentColor })
      segments.push({ text: ` · ${draftLength} chars`, fg: theme.text })
    }
    if (composerAttachmentLabel) {
      segments.push({ text: ' · ', fg: theme.dim })
      segments.push({ text: composerAttachmentLabel, fg: theme.cyan })
    }
    if (composerKnobSegments.length > 0) {
      segments.push({ text: ' · ', fg: theme.dim })
      composerKnobSegments.forEach((segment, index) => {
        if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
        segments.push(segment)
      })
    }
    if (composerLocationSegments.length > 0) {
      segments.push({ text: ' · ', fg: theme.dim })
      segments.push(...composerLocationSegments.map((segment) =>
        composerWorkingDirectory && segment.text === `${composerWorkingDirectory}  `
          ? { ...segment, text: `${composerProjectLabel(composerWorkingDirectory)}  ` }
          : segment,
      ))
    }
    return segments
  }
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
  const composerWaitingStatusSeed = composerWaitingSeed
    || `${composerTargetSession?.provider ?? 'unknown'}:${composerTargetSession?.sessionId ?? 'pending'}`
  // Only a slash command's first line matters here, and `composerDraftShape` makes the root
  // re-render per key only while one is being typed.
  const composerDraftFirstLine = composerDraft.slice(0, composerDraft.indexOf('\n') < 0 ? undefined : composerDraft.indexOf('\n'))
  const composerFirstLine = composerDraftFirstLine.startsWith('/') ? composerDraftFirstLine : ''
  const composerSlashOpen = composerFirstLine.startsWith('/') && !composerSlashDismissed
  const composerSlashCommands: SlashCommandSuggestion[] = useMemo(() => {
    if (!composerSlashOpen) return []
    const baseline = [...getSlashCommandSuggestions(selectedSession?.provider ?? 'claude'), TUI_HANDOFF_COMMAND]
    const merged: SlashCommandSuggestion[] = [...composerLiveSlashCommands]
    const seen = new Set(merged.map((entry) => entry.command))
    for (const entry of baseline) {
      if (!seen.has(entry.command)) {
        merged.push(entry)
        seen.add(entry.command)
      }
    }
    return filterSlashCommands(merged, composerFirstLine.slice(1))
  }, [composerSlashOpen, composerFirstLine, selectedSession?.provider, composerLiveSlashCommands])

  const composerAffordancesCacheRef = useRef(new Map<string, {
    commands: SlashCommandSuggestion[]
    options: Awaited<ReturnType<typeof readViewSessionComposerOptions>>
    ts: number
  }>())
  // Composer affordances (slash commands, agent pickers). For Claude,
  // readViewSessionSlashCommands SPAWNS a full `claude` CLI subprocess
  // (createSessionControlQuery → query({resume}), ~1–3s of a CPU core) — so:
  // - never track the live selection or a raw `selectedSession` object (one
  //   spawn per scrub step / per 5s sessions poll — the original progressive
  //   scrub slowdown);
  // - key on the SETTLED committedSessionKey with a per-session TTL cache so
  //   revisits spawn nothing;
  // - for Claude, DON'T fetch on settle at all. Scrubbing across N distinct
  //   sessions still spawned one CLI per settle, sustaining 3–5 concurrent
  //   node processes for the whole scrub — enough system CPU pressure to
  //   starve the render loop for seconds (measured: multi-second commit gaps
  //   mid-scrub). Slash commands and agent pickers only matter once the user
  //   actually engages the composer, so the Claude fetch is deferred to
  //   composerActive. Other providers answer over their SDK/server (no
  //   subprocess) and keep the eager fetch, e.g. for the OpenCode agent chip.
  const committedSessionKeyRef = useRef<string | null>(null)
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
  const fetchComposerAffordances = useCallback(async (target: Session, key: string) => {
    if (composerAffordancesInFlightRef.current.has(key)) return
    composerAffordancesInFlightRef.current.add(key)
    try {
      const { commands: live, options: composerOptions } = await readTuiComposerAffordancesAsync(target)
      const commands = live.map((entry) => ({
        command: entry.command,
        description: entry.description,
        argumentHint: entry.argumentHint && entry.argumentHint.trim() ? entry.argumentHint.trim() : undefined,
      }))
      // Cache even when the session has changed since — the work is done, and
      // the next visit to this session should not spawn again.
      touchMapEntry(composerAffordancesCacheRef.current, key, {
        commands,
        options: composerOptions,
        ts: Date.now(),
      })
      while (composerAffordancesCacheRef.current.size > COMPOSER_AFFORDANCES_CACHE_MAX) {
        const oldest = composerAffordancesCacheRef.current.keys().next().value
        if (oldest === undefined) break
        composerAffordancesCacheRef.current.delete(oldest)
      }
      if (committedSessionKeyRef.current === key) applyComposerAffordances(target, commands, composerOptions)
    } catch {
      if (committedSessionKeyRef.current === key) clearComposerAffordances()
    } finally {
      composerAffordancesInFlightRef.current.delete(key)
    }
  }, [applyComposerAffordances, clearComposerAffordances])
  useEffect(() => {
    const target = transcriptSession
    if (!target || !committedSessionKey) {
      clearComposerAffordances()
      return
    }
    const cached = composerAffordancesCacheRef.current.get(committedSessionKey)
    if (cached && Date.now() - cached.ts < COMPOSER_AFFORDANCES_TTL_MS) {
      applyComposerAffordances(target, cached.commands, cached.options)
      return
    }
    // Don't let the previous session's commands/agents linger while (or
    // whether) this session's fetch runs.
    clearComposerAffordances()
    if ((target.provider ?? 'claude') === 'claude' && !composerActiveRef.current) return
    void fetchComposerAffordances(target, committedSessionKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedSessionKey, fetchComposerAffordances])
  // Composer engagement: warm the send path while the user types, then fetch
  // the deferred Claude affordances. Prewarm spawns the pool Query the send
  // will attach to (removing the ~1-3s CLI boot from first-token latency) or
  // resumes the Codex thread; running the affordances fetch AFTER it lets the
  // Claude branch reuse the warm Query instead of spawning a second CLI.
  const composerPrewarmInFlightRef = useRef(new Set<string>())
  useEffect(() => {
    // Most providers can warm on selection without mutating the session.
    // Existing Claude sessions cannot: SDK resume rewrites the transcript and
    // moves its last-activity mtime, so their prewarm waits for composer use.
    const target = transcriptSession
    if (!target || !committedSessionKey) return
    const fullSession = sessionsByKeyRef.current.get(committedSessionKey)
    const isPending = fullSession?.isPending === true
    // Pi's ~19s cold open is what prewarm hides for a pending session
    // (createPiAgentSession is idempotent on the id). Claude also benefits:
    // prewarmViewSession forces the SDK to adopt the reserved id as its real
    // session id, so the first real send finds a warm pool entry instead of
    // cold-spawning. ACP sessions are also pool-owned and can start against the
    // reserved id. Pending Codex/Copilot sessions still have no resumable
    // identity yet, so prewarmViewSession no-ops them — skip the work here too.
    if (!shouldPrewarmTuiRuntime(target.provider, isPending, composerActive)) return
    const needsAffordances = !isPending && (() => {
      const cached = composerAffordancesCacheRef.current.get(committedSessionKey)
      return !cached || Date.now() - cached.ts >= COMPOSER_AFFORDANCES_TTL_MS
    })()
    let cancelled = false
    const prewarm = composerPrewarmInFlightRef.current.has(committedSessionKey)
      ? Promise.resolve()
      : (() => {
          composerPrewarmInFlightRef.current.add(committedSessionKey)
          return prewarmTuiSession(
            { ...target, cwd: fullSession?.cwd },
            {
              model: tuiModelOverride[committedSessionKey] || undefined,
              effort: tuiEffort === 'auto' ? undefined : tuiEffort,
              isPending,
            },
          ).catch(() => { /* best-effort: the send pays the usual cold cost */ })
            .finally(() => { composerPrewarmInFlightRef.current.delete(committedSessionKey) })
        })()
    if (needsAffordances) {
      void prewarm.then(() => {
        if (!cancelled) void fetchComposerAffordances(target, committedSessionKey)
      })
    }
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedSessionKey, composerActive, fetchComposerAffordances, tuiEffort, tuiModelOverride])
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

  useEffect(() => {
    if (!composerMention) {
      setComposerMentionResults(keepEmpty)
      return
    }
    const agentMatches: TuiMentionResult[] = composerMentionProvider === 'opencode'
      ? composerMentionAgents
          .filter((agent) => {
            const query = composerMention.query.toLowerCase()
            if (!query) return true
            return agent.value.toLowerCase().includes(query)
              || agent.label.toLowerCase().includes(query)
              || (agent.description?.toLowerCase().includes(query) ?? false)
          })
          .slice(0, 8)
          .map((agent) => ({
            kind: 'agent' as const,
            name: agent.value,
            description: agent.description,
            mode: agent.mode,
          }))
      : []
    const cwd = composerMentionCwd
    if (!cwd) {
      setComposerMentionResults(agentMatches)
      setComposerMentionIndex(0)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const all = await listProjectFiles(cwd, runGitCommand)
          if (cancelled) return
          // The substring + fuzzy-subsequence scan over `all` (up to 5 000
          // entries) is CPU-bound — run it off the render/input thread so a
          // large repo doesn't stall the composer while the user is typing.
          // Ranking happens in the worker, before the 12-result cap: a bare `@`
          // matches every file, so slicing first would leave frecency nothing
          // to order. Scores come from the in-process table, so this is a map
          // read rather than a file read per keystroke.
          const fileMatches = await filterComposerMentionFilesAsync(
            all,
            composerMention.query,
            12,
            Object.fromEntries(readFrecencyScores()),
            frecencyPrefix(cwd),
          )
          if (cancelled) return
          const matches: TuiMentionResult[] = [
            ...agentMatches,
            ...fileMatches.map((entry) => ({ kind: 'file' as const, ...entry })),
          ]
          setComposerMentionResults(matches)
          setComposerMentionIndex(0)
        } catch {
          if (!cancelled) setComposerMentionResults(agentMatches)
        }
      })()
    }, 60)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [composerMention, composerMentionAgents, composerMentionCwd, composerMentionProvider])

  const ensureComposerPastePartTypeId = useStableEvent((renderable: TextareaRenderable): number => {
    let typeId = composerPastePartTypeIdRef.current
    if (typeId == null) {
      typeId = renderable.extmarks.registerType('composer-paste')
      composerPastePartTypeIdRef.current = typeId
    }
    return typeId
  })

  const restoreComposerPromptPartExtmarks = useStableEvent((parts: ComposerPromptPart[], text: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable) return
    renderable.extmarks.clear()
    if (parts.length === 0) return
    const typeId = ensureComposerPastePartTypeId(renderable)
    const styleId = renderable.syntaxStyle?.getStyleId('extmark.paste') ?? undefined
    let cursor = 0
    for (const part of parts) {
      const start = text.indexOf(part.marker, cursor)
      if (start === -1) continue
      const end = start + part.marker.length
      renderable.extmarks.create({
        start,
        end,
        virtual: true,
        styleId,
        typeId,
        data: { partId: part.id },
      })
      cursor = end
    }
  })

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

  const activeComposerPromptPartRanges = useStableEvent((text: string, parts: ComposerPromptPart[]): ComposerPromptPartRange[] => {
    const renderable = composerTextareaRef.current
    const typeId = composerPastePartTypeIdRef.current
    const byId = new Map(parts.map((part) => [part.id, part]))
    if (renderable && typeId != null) {
      return renderable.extmarks
        .getAllForTypeId(typeId)
        .flatMap((extmark: { start: number; end: number; data?: { partId?: unknown } }) => {
          const partId = typeof extmark.data?.partId === 'string' ? extmark.data.partId : ''
          const part = byId.get(partId)
          if (!part) return []
          const marker = text.slice(extmark.start, extmark.end) || part.marker
          return [{ ...part, marker, start: extmark.start, end: extmark.end }]
        })
        .sort((a, b) => a.start - b.start)
    }

    let cursor = 0
    const ranges: ComposerPromptPartRange[] = []
    for (const part of parts) {
      const start = text.indexOf(part.marker, cursor)
      if (start === -1) continue
      const end = start + part.marker.length
      ranges.push({ ...part, start, end })
      cursor = end
    }
    return ranges
  })

  const prepareComposerSubmission = useStableEvent((visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]): ComposerSubmission => {
    // The ordinary typing path has no pasted prompt parts or attachments. Do
    // not walk extmarks, build maps, or sort ranges until the composer actually
    // contains one of those richer inputs.
    if (attachments.length === 0 && parts.length === 0) {
      return {
        visibleText,
        messageText: visibleText.trim(),
        attachments: [],
        promptParts: [],
      }
    }
    const promptPartRanges = activeComposerPromptPartRanges(visibleText, parts)
    let messageText = visibleText
    for (const part of [...promptPartRanges].sort((a, b) => b.start - a.start)) {
      if (part.kind !== 'text') continue
      messageText = `${messageText.slice(0, part.start)}${part.text}${messageText.slice(part.end)}`
    }
    const promptPartAttachments = promptPartRanges
      .filter((part): part is ComposerPromptPartRange & { kind: 'attachment' } => part.kind === 'attachment')
      .map((part) => ({ ...part.attachment, text: part.marker }))
    const promptAttachmentIds = new Set(promptPartAttachments.map((attachment) => attachment.id).filter(Boolean))
    const mentionAttachments = activeMentionAttachments(visibleText, attachments)
      .filter((attachment) => !attachment.id || !promptAttachmentIds.has(attachment.id))
    return {
      visibleText,
      messageText: messageText.trim(),
      attachments: [...mentionAttachments, ...promptPartAttachments],
      promptParts: promptPartRanges.map(({ start: _start, end: _end, ...part }) => part),
    }
  })

  const insertMentionAtCursor = useStableEvent((entry: TuiMentionResult) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !composerMention) return
    const text = renderable.plainText
    const cursor = renderable.cursorOffset
    const before = text.slice(0, composerMention.start)
    const after = text.slice(cursor)
    const insertion = entry.kind === 'agent'
      ? `@${entry.name} `
      : `@${entry.path} `
    // A file you mention is a file you are working in; the next `@` ranks by it.
    if (entry.kind === 'file' && composerMentionCwd) {
      recordFrecencyUse(frecencyKey(composerMentionCwd, entry.path))
    }
    const next = `${before}${insertion}${after}`
    renderable.setText(next)
    renderable.cursorOffset = before.length + insertion.length
    setComposerDraft(next)
    setComposerMentionAttachments((prev) => {
      if (entry.kind === 'agent') {
        if (prev.some((attachment) => attachment.type === 'agent' && attachment.displayName === entry.name)) return prev
        return [
          ...prev,
          {
            id: `agent-${entry.name}`,
            type: 'agent',
            displayName: entry.name,
            text: `@${entry.name}`,
          },
        ]
      }
      if (prev.some((attachment) => attachment.path === entry.path)) return prev
      return [
        ...prev,
        {
          id: `mention-${entry.path}`,
          type: 'mention',
          path: entry.path,
          displayName: entry.basename,
        },
      ]
    })
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
  })

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

  const moveComposerHistory = useStableEvent((delta: number) => {
    if (sentHistory.length === 0) return
    if (!composerHistoryOpen) {
      if (delta > 0) {
        const currentDisplayIndex = historyIndex === -1
          ? -1
          : sentHistory.length - 1 - historyIndex
        openComposerHistory(Math.max(currentDisplayIndex + 1, 0))
      } else if (historyIndex !== -1) {
        const currentDisplayIndex = sentHistory.length - 1 - historyIndex
        if (currentDisplayIndex <= 0) {
          cancelComposerHistory()
        } else {
          openComposerHistory(currentDisplayIndex - 1)
        }
      }
      return
    }

    const nextDisplayIndex = composerHistoryIndex + delta
    if (nextDisplayIndex < 0) {
      cancelComposerHistory()
      return
    }
    selectComposerHistoryEntry(nextDisplayIndex)
  })

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

  const composerMentionVisibleCount = Math.min(composerMentionResults.length, 5)
  const composerSlashVisibleCount = Math.min(composerSlashCommands.length, 5)
  const composerHistoryVisibleCount = Math.min(sentHistory.length, 6)
  const composerStashVisibleCount = Math.min(composerStash.length, 6)
  const composerRewindVisibleCount = Math.min(composerRewindItems?.length ?? 0, 6)
  const composerPopoverHeight = (!composerWindowOpen && composerActive && composerMention && composerMentionVisibleCount > 0)
    ? composerMentionVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerSlashOpen && composerSlashVisibleCount > 0 && !composerMention && !composerHistoryOpen && !composerStashOpen)
    ? composerSlashVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerHistoryOpen && composerHistoryVisibleCount > 0 && !composerMention)
    ? composerHistoryVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerStashOpen && composerStashVisibleCount > 0 && !composerMention)
    ? composerStashVisibleCount + 3
    : (!composerWindowOpen && composerActive && composerRewindVisibleCount > 0)
    ? composerRewindVisibleCount + 3
    : 0
  // Status indicators (requesting spinner, subagent tail, live-prompt
  // suggestion, composer status, auto-targeting note) render as siblings
  // *between* the scrollbox and the composer. They each take fixed rows when
  // visible — we must subtract them from mainContentHeight so the transcript
  // shrinks instead of pushing the composer off-screen.
  const hasSubagentTail = useMemo(
    () => Object.values(liveSubagentText).some((t) => t.trim().length > 0),
    [liveSubagentText],
  )
  const activeRunningToolCount = useMemo(
    () => liveToolActivities.reduce((n, a) => (a.status === 'running' ? n + 1 : n), 0),
    [liveToolActivities],
  )
  const composerActivityVisible = Boolean(
    composerActivitySessionKey
    && selectedSessionIdentity === composerActivitySessionKey,
  )
  const visibleComposerSending = composerActivityVisible && composerSendState === 'sending'
  const composerTurnStatusInBorder = visibleComposerSending && !embeddedComposer && !fullscreenMode && !composerWindowOpen && !composerHidden
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
  useEffect(() => {
    const target = composerTargetSession
    if (!target || target.provider !== 'claude') {
      setComposerPlanLimits(null)
      return
    }
    setComposerPlanLimits(peekTuiClaudePlanLimits(target))
    if (!composerActive || turnRunningForComposer) return
    let cancelled = false
    void readTuiClaudePlanLimits(target)
      .then((limits) => { if (!cancelled && limits) setComposerPlanLimits(limits) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [composerActive, composerTargetSession?.provider, composerTargetSession?.providerInstanceId, composerTargetSession?.sessionId, turnRunningForComposer])
  // What ⌃C and ⏎ actually do. The post-turn sync keeps the status row but
  // ends the turn: ⌃C cancels nothing and ⏎ sends at once, so the key hints
  // must not go on offering "cancel" and "queue" through it.
  const composerKeysTargetTurn = visibleComposerSending || reattachedRunning
  const hasComposerStatusMessage = Boolean(
    visibleComposerError
    // Embedded composers render turn activity in a compact in-frame row, so
    // the sync spinner must not also claim a sibling row here — two spinners
    // for one turn.
    || (visibleAwaitingPersistedTurn && !embeddedComposer)
    || activeQueuedComposerSends.length > 0
    || (visibleComposerSending && Boolean(visibleComposerLiveText))
    // Steered notices render while a turn runs, owned or reattached — count
    // them even before the turn streams any output.
    || (steeredSendNotice && (visibleComposerSending || reattachedRunning))
  )
  // The preview lines for one option, already sanitized and bounded. Returned
  // as an array so the plan can count rows and the render can draw exactly
  // those — the two must not derive it separately or the card's reserved height
  // stops matching what is drawn.
  const questionPreviewLines = useCallback((option: PendingQuestionOption | undefined): string[] => {
    const raw = option?.preview
    if (!raw) return []
    return raw
      .replace(/\r\n/g, '\n')
      .split('\n')
      // Control characters and stray ANSI in a model-authored preview would
      // corrupt the frame, so they are stripped the way transcript lines are.
      .map((line) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\t/g, '  '))
      .slice(0, QUESTION_PREVIEW_MAX_LINES)
  }, [])

  // AskUserQuestion picker layout.
  //
  // The picker used to reserve exactly as many rows as a full render needs —
  // one per question plus one per option — with no upper bound. On a short
  // terminal that exceeds what the layout can give it, yoga shrinks the card,
  // and the options that fall off the bottom are simply gone: invisible and
  // unanswerable, on every transcript view. A blocking prompt you cannot see
  // is worse than a cramped one, so when the full picker will not fit we keep
  // the FOCUSED question complete (its options are what the keys act on) and
  // collapse the others to a single row each, windowing the option list around
  // the cursor if even that overflows.
  //
  // The reservation below and the render both read this plan, so they cannot
  // disagree about how tall the card is.
  const questionPickerPlan = useMemo(() => {
    const permission = pendingPermissions[0]
    const questions = permission?.questions ?? []
    if (questions.length === 0) return null
    const focusIndex = Math.min(Math.max(questionFocusIndex, 0), questions.length - 1)
    const optionRowsFor = (index: number) => {
      const question = questions[index]!
      return question.options.length + (question.allowFreeform ? 1 : 0)
    }
    // border(2) + outer padding(1) + title(1) + hint(1), plus the blank
    // marginTop row each question after the first carries.
    const chrome = 5 + (questions.length - 1)
    const questionRows = questions.length + questions.filter((question) => question.externalUrl).length
    const optionRowTotal = questions.reduce((total, _, index) => total + optionRowsFor(index), 0)
    // The preview belongs to the option the cursor is on, in the focused
    // question. The freeform "Other" row has no preview, and neither does an
    // option that did not carry one — both yield zero rows.
    const focusedQuestion = questions[focusIndex]!
    const previewCursor = Math.min(Math.max(questionOptionIndex, 0), Math.max(optionRowsFor(focusIndex) - 1, 0))
    const previewLines = questionPreviewLines(focusedQuestion.options[previewCursor])
    // One label row above the content.
    const previewRows = previewLines.length > 0 ? previewLines.length + 1 : 0
    const fullRows = chrome + questionRows + optionRowTotal + previewRows
    // Budget derived from the SAME expression mainContentHeight uses, so it is
    // automatically correct per transcript view (Chat and Agents dock the
    // composer inside the reader box; the other views do not). mainContentHeight floors at
    // QUESTION_PICKER_MIN_TRANSCRIPT_ROWS, and anything the picker reserves
    // beyond that floor is rows the screen does not have — which is exactly
    // when yoga starts compositing the card's rows onto each other.
    const budget = Math.max(
      height
      - (workspacesEnabled ? 3 : 2)
      - (searchMode || sessionSearchMode ? 4 : 1)
      - (embeddedComposer ? 0 : composerDockHeight)
      - composerPopoverHeight
      - QUESTION_PICKER_MIN_TRANSCRIPT_ROWS,
      QUESTION_PICKER_MIN_ROWS,
    )
    if (fullRows <= budget) {
      return { questions, focusIndex, collapsed: false, optionStart: 0, optionCount: optionRowsFor(focusIndex), previewLines, rows: fullRows }
    }
    // Everything fits EXCEPT the preview: drop the preview rather than collapse
    // the questions. An option list you can act on is worth more than an
    // illustration of one of its entries.
    const withoutPreview = fullRows - previewRows
    if (previewRows > 0 && withoutPreview <= budget) {
      return { questions, focusIndex, collapsed: false, optionStart: 0, optionCount: optionRowsFor(focusIndex), previewLines: [], rows: withoutPreview }
    }
    // Collapsed: every question keeps its own row, only the focused one shows
    // options, so ←/→ still reaches all of them.
    const collapsedChrome = chrome + questionRows
    const optionCount = Math.max(Math.min(optionRowsFor(focusIndex), budget - collapsedChrome), 1)
    const cursor = Math.min(Math.max(questionOptionIndex, 0), Math.max(optionRowsFor(focusIndex) - 1, 0))
    // Window around the cursor so the option the keys act on is always drawn.
    const optionStart = Math.min(
      Math.max(cursor - Math.floor(optionCount / 2), 0),
      Math.max(optionRowsFor(focusIndex) - optionCount, 0),
    )
    const collapsedRows = collapsedChrome + optionCount
    // Once collapsed the card is already short of room, so a preview only
    // appears if the leftover budget genuinely holds one — and it is trimmed to
    // what is left rather than pushing options off the bottom.
    const previewBudget = budget - collapsedRows - 1
    const collapsedPreview = previewLines.length > 0 && previewBudget + 1 >= QUESTION_PREVIEW_MIN_ROWS
      ? previewLines.slice(0, Math.max(previewBudget, 0))
      : []
    return {
      questions,
      focusIndex,
      collapsed: true,
      optionStart,
      optionCount,
      previewLines: collapsedPreview,
      rows: collapsedRows + (collapsedPreview.length > 0 ? collapsedPreview.length + 1 : 0),
    }
  }, [
    composerDockHeight,
    composerPopoverHeight,
    height,
    pendingPermissions,
    questionFocusIndex,
    questionOptionIndex,
    questionPreviewLines,
    searchMode,
    sessionSearchMode,
    embeddedComposer,
  ])

  const composerStatusBlockHeight = (() => {
    let rows = 0
    // Keep in sync with the pinned turn-status row below (rendered for the
    // entire turn, not just the pre-output window).
    // Embedded composers own a compact status row in the reader, so it comes
    // out of transcriptViewportRows rather than this sibling-status budget.
    if (visibleComposerSending && !embeddedComposer && !composerTurnStatusInBorder) rows += 1
    if (composerActivityVisible && hasSubagentTail) rows += 2
    if (visibleLiveToolActivities.length > 0 && visibleRunningToolCount > 0) rows += 2
    if (livePromptSuggestion && composerSendState !== 'sending') rows += 2
    if (hasComposerStatusMessage) {
      const streamingResponse = visibleComposerSending && visibleComposerLiveText && !visibleComposerError
      rows += streamingResponse
        ? isChatLikeView || liveAssistantTextCardVisible ? 0 : LIVE_PREVIEW_HEIGHT
        : 2
    }
    if (visibleAwaitingPersistedTurn && !embeddedComposer) rows += 2
    if ((liveStatus === 'retrying' || liveStatus === 'compacting') && visibleComposerSending) rows += 2
    if (visibleComposerSending && composerLiveReasoning.trim() && !isStreamView) rows += LIVE_PREVIEW_HEIGHT
    // Reattached-turn banner (rendered when a turn runs without an owned stream).
    if (!visibleComposerSending && reattachedRunning && !visibleAwaitingPersistedTurn && !embeddedComposer) rows += 2
    // Codex external-writer banner — another Codex client owns the rollout,
    // so this transcript is a stale cached snapshot until it finishes.
    if (composerTargetSession?.provider === 'codex' && sessionDetail?.externalWriter) rows += 2
    if (pendingPermissions.length > 0) {
      const permission = pendingPermissions[0]!
      const questions = permission.questions ?? []
      if (questions.length > 0) {
        // Measured by questionPickerPlan, which the render reads too — a flat
        // budget leaves the card too few rows and the option lines composite
        // on top of the question line.
        rows += questionPickerPlan?.rows ?? 0
      } else {
        const permInnerWidth = Math.max(width - 8, 20)
        // border(2) + outer padding(1) + title(1) + options marginTop(1)
        // + options(1) + hint(1)
        let permRows = 7
        if (permission.toolName === 'ExitPlanMode') {
          const planLines = permission.plan ? permission.plan.split('\n') : []
          permRows += Math.min(planLines.length, 16)
          if (planLines.length > 16) permRows += 1
          if (permission.allowedPrompts && permission.allowedPrompts.length > 0) permRows += 1
        } else {
          // The reason renders with word wrap, so it can take several rows.
          if (permission.mcpServer) permRows += 1
          if (permission.reason) permRows += Math.max(Math.ceil(permission.reason.length / permInnerWidth), 1)
          if (permission.command) permRows += Math.min(permission.command.split('\n').length, 12)
          if (permission.url) permRows += 1
          if (permission.paths && permission.paths.length > 0) permRows += 1
          if (permission.diff) permRows += Math.min(permission.diff.split('\n').length, 12)
        }
        rows += permRows
      }
    }
    return rows
  })()
  // Chat and Agents render the composer bar as the reader box's own trailing child
  // (inside its border) rather than a sibling row below it, so its height comes
  // out of the scrollbox's budget (transcriptViewportRows), not this one.
  // With the composer dock on screen, the status bar's keys move into the
  // dock's bottom border and its row goes back to the transcript.
  const statusBarInDock = !composerWindowOpen && !composerHidden && !embeddedComposer && !fullscreenMode
    && !searchMode && !sessionSearchMode
  const surfacePanelVisible = surfacePanelOpen && !fullscreenMode
  const surfacePanelOnRight = surfacePanelVisible && surfacePanelPlacement === 'right'
  const surfacePanelAtBottom = surfacePanelVisible && surfacePanelPlacement === 'bottom'
  const fullContentHeight = Math.max(
    height - (workspacesEnabled ? 1 : 0)
    - (fullscreenMode ? 0 : 2)
    - (searchMode || sessionSearchMode ? 4 : fullscreenMode || statusBarInDock ? 0 : 1)
    - (embeddedComposer ? 0 : composerDockHeight)
    - composerPopoverHeight
    - composerStatusBlockHeight,
    8,
  )
  // Under the reader, the panel's rows come out of the reader's own budget. The
  // main row grows back into them (flexGrow), and the panel is laid over them.
  const surfacePanelMaxRows = Math.max(SURFACE_PANEL_MIN_ROWS, fullContentHeight - SURFACE_PANEL_READER_MIN_ROWS)
  const effectiveSurfacePanelRows = surfacePanelAtBottom
    ? (surfacePanelExpanded ? surfacePanelMaxRows : clamp(surfacePanelRows, SURFACE_PANEL_MIN_ROWS, surfacePanelMaxRows))
    : 0
  const mainContentHeight = Math.max(fullContentHeight - effectiveSurfacePanelRows, 8)
  const taskPanelVisible = taskPanelOpen && !fullscreenMode
  const maxTaskPanelWidth = Math.max(
    TASK_PANEL_MIN_WIDTH,
    width - 4 - (showRail ? sidebarWidthPreference : 0) - MIN_READER_WIDTH
      - (surfacePanelOnRight ? SURFACE_PANEL_MIN_WIDTH + 1 : 0) - 1,
  )
  const effectiveTaskPanelWidth = taskPanelVisible
    ? (taskPanelExpanded ? maxTaskPanelWidth : taskPanelWidth)
    : 0
  // Both right-hand panels can be open at once, so the surface panel's ceiling
  // has to leave the task panel its reservation as well as the reader's minimum.
  const surfacePanelMaxWidth = Math.max(
    SURFACE_PANEL_MIN_WIDTH,
    width - (showRail ? sidebarWidthPreference : 0) - MIN_READER_WIDTH - effectiveTaskPanelWidth,
  )
  const effectiveSurfacePanelWidth = surfacePanelOnRight
    ? (surfacePanelExpanded ? surfacePanelMaxWidth : Math.min(surfacePanelWidth, surfacePanelMaxWidth))
    : 0
  // Both right-hand panels come out of the same budget as the task panel, so
  // the reader keeps its minimum no matter how many are open.
  // The root row has no padding and no gap: neighbouring frames share the
  // screen edge and each other's borders, so the panes are the whole width.
  const rightPanelsWidth = effectiveTaskPanelWidth + effectiveSurfacePanelWidth
  const maxSidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, width - MIN_READER_WIDTH - rightPanelsWidth)
  const sidebarWidth = showRail ? clamp(sidebarWidthPreference, MIN_SIDEBAR_WIDTH, maxSidebarWidth) : 0
  const tabsHaveEntries = openTabSessions.length > 0 || popoverTabs.length > 0 || selectedSession !== null
  const verticalTabsWidth = verticalTabRailWidth(width - sidebarWidth - rightPanelsWidth,
    tabsEnabled && tabOrientation === 'vertical' && !fullscreenMode && tabsHaveEntries)
  const readerAreaWidth = Math.max(width - sidebarWidth - rightPanelsWidth - verticalTabsWidth, 40)
  // Split panes take their width out of the reader area, so `rightPaneWidth`
  // (the primary transcript's layout width, threaded through every card) keeps
  // being the single source of truth for the reader. Panes are dropped one at a
  // time until both they and the reader clear their minimum widths, so shrinking
  // the terminal degrades to fewer panes instead of unreadable ones.
  const splitCandidateSessions = openTabSessions
  // Resolve pins to live tab objects. A pin whose tab closed, or that the user
  // navigated into (it is now the reader), resolves to nothing and its pane
  // simply doesn't mount this frame — the reconcile effect repairs the list.
  const splitPinnedSessions = splitPinnedKeys.flatMap((pinnedKey) => {
    // A previewed session (selected from the rail, not yet a tab) is shown in a window too.
    const tab = openTabSessions.find((candidate) => sessionKey(candidate) === pinnedKey)
      ?? (pinnedKey === selectedSessionKey ? selectedSession : null)
    return tab ? [tab] : []
  })
  // Stacked splits divide the reader area's ROWS instead of its columns, so the
  // same drop-a-pane-before-shrinking rule runs against a different axis. The
  // reader area's inner height is the frame minus its own borders.
  const splitAxisStacked = splitOrientation === 'rows'
  // Measure the area plus its overflow row as one stable budget, so adding
  // the strip cannot make the next measurement oscillate across a fit boundary.
  const windowBudgetHeight = measuredWindowAreaHeight > 0
    ? measuredWindowAreaHeight
    : Math.max(mainContentHeight - (tabsEnabled && !fullscreenMode && !verticalTabsWidth ? HORIZONTAL_TAB_BAR_HEIGHT : 0), 1)
  const pinnedWindowSessions = splitPinnedSessions.slice(0, splitPaneCount)
  const sessionsByKey = new Map(pinnedWindowSessions.map((session) => [sessionKey(session), session]))
  const pinnedWindowKeys = pinnedWindowSessions.map(sessionKey)
  const pinnedWindowSignature = JSON.stringify(pinnedWindowKeys)
  const orderedWindowKeys = useMemo(() => orderWindows(windowOrder, pinnedWindowKeys, windowSurfaces), [windowOrder, pinnedWindowSignature, windowSurfaces])
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
    root: fallbackLeaves.map((slot) => ({ slot })).reduce<import('./windowSplitTree').WindowSplitNode>((root, node, index) => index === 0 ? node : ({ axis: splitOrientation === 'columns' ? 'x' : 'y', ratio: index / (index + 1), first: root, second: node }), { slot: fallbackLeaves[0]! }),
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
    let geometry = reconciledSplitTree && !fullscreenMode ? computeWindowSplitTree(reconciledSplitTree, readerAreaWidth, windowBudgetHeight, splitTreeFitLimits) : null
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
    requestedCount: fullscreenMode ? 0 : splitPaneCount + windowSurfaces.length,
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
  const stackedPanesVisible = stackedSplit && visibleSplitPaneCount > 0
  // Off-axis, a frame simply spans the reader area: stacked panes are full
  // width, side-by-side panes are full height.
  // Every window in display order — sessions in their slots, surfaces in
  // theirs — then those that fit; short of room, sessions go before surfaces.
  const fittedWindowKeys = treeGeometry ? orderedWindowKeys.slice(0, visibleSplitPaneCount) : visibleSplitPaneCount > 0 ? fitWindows(orderedWindowKeys, visibleSplitPaneCount, pinnedWindowSessions.map((session) => sessionKey(session))) : []
  // A parked session (a background tab, the floating window) is an open tab, not a pin.
  const openTabByKey = new Map(openTabSessions.map((session) => [sessionKey(session), session]))
  const windowItemFor = (key: string): WindowItem => (isSurfaceWindowKey(key)
    ? { kind: 'surface', surface: surfaceIdOfKey(key) }
    : { kind: 'session', session: sessionsByKey.get(key) ?? openTabByKey.get(key)! })
  const windowItems: WindowItem[] = fittedWindowKeys.map(windowItemFor)
  const laidOutWindowKeys = new Set(orderedWindowKeys)
  const floatingKey = floatingWindow
    && (isSurfaceWindowKey(floatingWindow.key) ? !windowSurfaces.includes(surfaceIdOfKey(floatingWindow.key))
      : openTabByKey.has(floatingWindow.key) && !laidOutWindowKeys.has(floatingWindow.key))
    ? floatingWindow.key : null
  // A tab still exists while its session is an open tab other than the reader,
  // or — a surface — while it is not open somewhere else.
  const windowKeyExists = (key: string) => key !== floatingKey && (isSurfaceWindowKey(key)
    ? Object.hasOwn(WINDOW_SURFACE_TITLES, surfaceKindOf(surfaceIdOfKey(key))) && !popoverTabs.includes(surfaceIdOfKey(key))
    : openTabByKey.has(key))
  const liveWindowStacks = liveStacks(windowStacks, windowKeyExists, (key) => laidOutWindowKeys.has(key))
  parkedWindowKeysRef.current = new Set([
    ...liveWindowStacks.flat().filter((key) => !laidOutWindowKeys.has(key)),
    ...(floatingKey ? [floatingKey] : []),
  ])
  const floatingItem: WindowItem | null = floatingKey ? windowItemFor(floatingKey) : null
  const windowStackFor = (key: string) => stackOf(liveWindowStacks, key)
  const windowItemKey = (item: WindowItem) => (item.kind === 'session' ? sessionKey(item.session) : surfaceWindowKey(item.surface))
  // The pin index of the session in window `index`, or -1 for a surface window.
  const pinIndexOfWindow = (index: number) => {
    const item = windowItems[index]
    return item?.kind === 'session' ? splitPinnedKeys.indexOf(sessionKey(item.session)) : -1
  }
  // The session panes on screen, in display order (live slices, running marks, handles).
  const splitPaneSessions = windowItems.flatMap((item) => (item.kind === 'session' ? [item.session] : []))
  const visibleWindowSurfaces = windowItems.flatMap((item) => (item.kind === 'surface' ? [item.surface] : []))
  // The window showing the selected session is drawn by the reader's own
  // pipeline (card window, view modes, every reader key); the rest are drawn
  // as panes. Selection follows focus, so that is the window in use.
  const lastFocusedSplitPaneRef = useRef(0)
  const selectedWindowIndex = fullscreenMode && selectedSession ? FULLSCREEN_PANE_INDEX
    : floatingItem?.kind === 'session' && sessionKey(floatingItem.session) === selectedSessionKey ? FLOATING_PANE_INDEX
    : windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === selectedSessionKey)
  // The window showing the selected session, if any.
  selectedWindowHandleRef.current = () => (selectedWindowIndex !== -1 ? splitPaneHandlesRef.current.get(selectedWindowIndex) : undefined)
  const focusedWindowItem = splitFocusIndex === null ? null
    : splitFocusIndex === FLOATING_PANE_INDEX ? floatingItem
    : splitFocusIndex === FULLSCREEN_PANE_INDEX ? (fullscreenMode && selectedSession ? { kind: 'session' as const, session: selectedSession } : null)
    : windowItems[splitFocusIndex] ?? null
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
  const closeWindowSessionTab = useStableEvent((session: Session) => {
    const key = sessionKey(session)
    const index = openTabSessions.findIndex(tab => sessionKey(tab) === key)
    const rest = openTabSessions.filter(tab => sessionKey(tab) !== key)
    const at = Math.min(Math.max(index, 0), rest.length)
    // A replacement must be unowned: taking a floating window or another
    // frame's background tab would make the same transcript appear twice.
    const onScreen = new Set([...orderedWindowKeys, ...liveWindowStacks.flat(), ...(floatingKey ? [floatingKey] : [])])
    const next = [...rest.slice(at), ...rest.slice(0, at).reverse()].find(tab => !onScreen.has(sessionKey(tab)))
    if (windowStackFor(key)) {
      closeWindowTab(key)
      setOpenTabSessions(rest)
      return
    }
    if (floatingKey === key) {
      if (next && floatingWindow) {
        checkpointWindowLayout()
        setFloatingWindow({ ...floatingWindow, key: sessionKey(next) })
        setSelectedSessionKey(sessionKey(next))
      } else {
        closeFloatingWindow()
        if (!windowItems.length) setSelectedSessionKey(null)
      }
      setOpenTabSessions(rest)
      return
    }
    const windowIndex = windowItems.findIndex(item => item.kind === 'session' && sessionKey(item.session) === key)
    if (!next || windowIndex < 0) {
      if (windowIndex >= 0) closeSplitPane(windowIndex)
      setOpenTabSessions(rest)
      return
    }
    checkpointWindowLayout()
    const nextKey = sessionKey(next)
    commitWindowKeys(orderedWindowKeys.map(entry => entry === key ? nextKey : entry))
    setWindowStacks(liveWindowStacks.map(stack => stack.map(entry => entry === key ? nextKey : entry)))
    setOpenTabSessions(rest)
    setSelectedSessionKey(nextKey)
  })
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
  useEffect(() => {
    setWindowAttention((previous) => {
      let next = previous
      const keys = new Set([...(selectedSessionKey ? [selectedSessionKey] : []), ...splitPinnedKeys])
      const replace = (key: string, value: WindowAttention) => {
        if (next === previous) next = new Map(previous)
        next.set(key, value)
      }
      for (const key of keys) {
        const session = sessionsByKeyRef.current.get(key)
        const revision = session ? sessionTranscriptUpdatedAt(session) : undefined
        const before = next.get(key)
        if (revision !== undefined) {
          const value = observeWindowAttention(before, 'metadata', String(revision), null, key === focusedWindowKey)
          if (value !== before) replace(key, value)
        } else if (key === focusedWindowKey && before) {
          const value = readWindowAttention(before)
          if (value !== before) replace(key, value)
        }
      }
      // Open tabs keep theirs, unobserved and so unchanged: switching between
      // tabs otherwise dropped and re-added an entry, a root render per switch.
      const retained = new Set([...keys, ...openTabSessions.map((session) => sessionKey(session))])
      for (const key of previous.keys()) {
        if (retained.has(key)) continue
        if (next === previous) next = new Map(previous)
        next.delete(key)
      }
      return next
    })
  }, [sessions, windowPinSignature, selectedSessionKey, focusedWindowKey, openTabSessions])
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

  // Which pane sessions have a turn in flight — drives the ◐ running glyph and
  // the working spinner, so a background agent's activity is visible without
  // switching to its tab.
  const splitPaneRunningKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const running of runningSessions) {
      keys.add(sessionKey(running))
    }
    return keys
  }, [runningSessions])

  const textareaInnerWidth = Math.max(rightPaneWidth - 4, 10)
  // When either right-hand panel is open, dock the composer under the reader
  // column so it sits beside the panel instead of running underneath it.
  const rightSidePanelVisible = taskPanelVisible || surfacePanelOnRight
  const composerAreaOffset = rightSidePanelVisible
    ? (showRail ? sidebarWidth : 0)
    : 0
  const composerAreaWidth = Math.max(
    30,
    rightSidePanelVisible ? readerAreaWidth : width,
  )
  const composerDockTextareaWidth = Math.max(composerAreaWidth - (fullscreenMode ? 2 : 4), 20)
  const composerWindowWidth = Math.max(
    20,
    Math.min(
      Math.max(width - 4, 20),
      Math.max(64, Math.min(COMPOSER_WINDOW_MAX_WIDTH, Math.floor(width * 0.78))),
    ),
  )
  const composerWindowHeight = Math.max(
    10,
    Math.min(
      Math.max(height - 4, 10),
      Math.max(14, Math.min(COMPOSER_WINDOW_MAX_HEIGHT, Math.floor(height * 0.62))),
    ),
  )
  const composerWindowLeft = Math.max(1, Math.floor((width - composerWindowWidth) / 2))
  const composerWindowTop = Math.max(1, Math.floor((height - composerWindowHeight) / 2))
  const composerWindowContentWidth = Math.max(composerWindowWidth - 4, 16)
  const composerWindowTextareaWidth = Math.max(composerWindowContentWidth - 2, 12)
  // What this render drew from the draft. The content-change handler compares each keystroke's
  // shape with it and re-renders the root only when they differ.
  const composerLineCounts = useMemo(
    () => computeComposerDraftShape(composerDraft, textareaInnerWidth, composerWindowTextareaWidth, null),
    [composerDraft, textareaInnerWidth, composerWindowTextareaWidth],
  )
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
  const liveAssistantPreviewLines = useMemo(
    () => wrapLivePreviewTail(composerLiveText, livePreviewContentWidth, LIVE_PREVIEW_BODY_LINES),
    [composerLiveText, livePreviewContentWidth],
  )
  const liveReasoningPreviewLines = useMemo(
    () => wrapLivePreviewTail(composerLiveReasoning, livePreviewContentWidth, LIVE_PREVIEW_BODY_LINES),
    [composerLiveReasoning, livePreviewContentWidth],
  )

  const isPreviewMode = !!selectedSessionKey && laidOutWindowKeys.has(selectedSessionKey) && !openTabSessions.some((s) => sessionKey(s) === selectedSessionKey)
  const visibleTabSessions = useMemo(() => (
    isPreviewMode && selectedSession
      ? [...openTabSessions, selectedSession]
      : openTabSessions
  ), [isPreviewMode, openTabSessions, selectedSession])
  const showTabs = !fullscreenMode && tabsEnabled && (visibleTabSessions.length > 0 || popoverTabs.length > 0)

  const showHorizontalTabs = showTabs && verticalTabsWidth === 0
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
    - (embeddedComposer && !composerWindowOpen && !composerHidden ? composerDockHeight : 0),
    8,
  )
  // Keep the scrollbox's explicit row budget inside its actual content area.
  // Window chrome (search results, notices, composer) can use more rows than
  // the estimate, especially in a small or floating window.
  const transcriptViewportRows = estimatedTranscriptViewportRows

  const activeTabIndex = useMemo(() => {
    if (!selectedSessionKey) return -1
    return visibleTabSessions.findIndex((s) => sessionKey(s) === selectedSessionKey)
  }, [selectedSessionKey, visibleTabSessions])

  // Which visible tabs have a turn in flight. `running` alone: a tab that is
  // blocked on an answer is not working, and spinning at the user while it
  // waits for them is the opposite of what the spinner says.
  const runningTabKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const s of visibleTabSessions) {
      if (sidebarSessionActivity.get(sessionKey(s)) === 'running') keys.add(sessionKey(s))
    }
    return keys
  }, [visibleTabSessions, sidebarSessionActivity])

  // The sidebar's state glyphs, on the tabs: whether each open conversation is
  // waiting on you, finished unread, or being written by a CLI elsewhere. A turn
  // in flight is not here — the spinner below paints that one.
  const tabStateGlyphs = useMemo(() => {
    const doneKeys = new Set(attentionDone.map((done) => done.sessionKey))
    const glyphs = new Map<string, string>()
    for (const s of visibleTabSessions) {
      const key = sessionKey(s)
      const activity = sidebarSessionActivity.get(key)
      const glyph = activity === 'needs-input' ? '⚠'
        : activity === 'waiting' ? '◌'
        : activity === 'running' ? null
        : recentlyWrittenKeys.has(key) ? '●'
        : doneKeys.has(key) ? '✓'
        : null
      if (glyph) glyphs.set(key, glyph)
    }
    return glyphs
  }, [attentionDone, recentlyWrittenKeys, sidebarSessionActivity, visibleTabSessions])

  const tabWidth = useMemo(() => {
    if (verticalTabsWidth > 0) return verticalTabsWidth + 8
    if (visibleTabSessions.length === 0) return 16
    // Fill available width proportionally so tabs look natural at any count,
    // capped to avoid very wide tabs when only a few sessions are open.
    // The strip spans the reader area (reader box plus any split panes), so
    // tabs get the full width instead of being squeezed into the reader column.
    const available = tabStripWidth(readerAreaWidth)
    const fill = Math.floor(available / Math.max(1, visibleTabSessions.length + popoverTabs.length))
    return Math.max(10, Math.min(fill, 40))
  }, [readerAreaWidth, visibleTabSessions.length, popoverTabs.length, verticalTabsWidth])
  const tabOptions = useMemo((): TabSelectOption[] => (
    visibleTabSessions.map((s) => {
      // Every open session can be on screen, so the strip marks none of them;
      // its description says which window shows it.
      const splitPosition = splitPinnedKeys.indexOf(sessionKey(s))
      const inSplit = splitPosition >= 0 && splitPosition < splitPaneCount
      // Herdr's rollup reaches the tab too. Leading, so a narrow tab's
      // truncation cuts the title rather than the mark.
      const team = teamAttention.get(sessionKey(s))
      const teamPrefix = (coordinatorBadges.has(sessionKey(s)) ? `${coordinatorBadges.get(sessionKey(s))} ` : '') + (team ? (team.waiting > 0 ? `!${team.waiting} ` : `✓${team.finished} `) : '')
      const stateGlyph = tabStateGlyphs.get(sessionKey(s))
      const label = (stateGlyph ? `${stateGlyph} ` : '') + teamPrefix + (isPreviewMode && selectedSessionKey === sessionKey(s)
        ? `PREVIEW · ${formatSessionTitle(s)}`
        : formatSessionTitle(s))
      return {
        // tab-select draws a name in tabWidth - 2 cells from its second column,
        // so a label padded to tabWidth - 4 puts the × at TAB_CLOSE_COLUMN.
        name: tabStripName(label, tabWidth),
        description: isPreviewMode && selectedSessionKey === sessionKey(s)
          ? 'Preview tab'
          : inSplit
            ? `in window ${splitPosition + 1}`
            : sessionProviderLabel(s),
        value: sessionKey(s),
      }
    })
  ).concat(popoverTabs.map((id) => {
    // Popover tabs follow the session tabs, each naming what it is pinned to.
    const pinned = windowSurfaceMeta[id]?.session
    const pinnedSession = pinned ? openTabByKey.get(pinned) ?? sessions.find((entry) => sessionKey(entry) === pinned) : null
    const label = `${surfaceTitle(id)}${pinnedSession ? ` · ${formatSessionTitle(pinnedSession)}` : ''}`
    return { name: tabStripName(label, tabWidth), description: 'popover tab', value: `popover:${id}` }
  })), [isPreviewMode, selectedSessionKey, visibleTabSessions, splitPinnedKeys, splitPaneCount, tabStateGlyphs, teamAttention, coordinatorBadges, tabWidth, popoverTabs, windowSurfaceMeta])
  // Index in the strip: session tabs, then popover tabs.
  const activeStripIndex = shownPopoverTab ? visibleTabSessions.length + popoverTabs.indexOf(shownPopoverTab) : activeTabIndex
  const tabStripLength = visibleTabSessions.length + popoverTabs.length

  // The right-hand panels share the full vertical column with the reader and
  // composer. Add back the rows the main content budget reserves for the
  // status block, composer popovers, and dock so the panel stays beside the
  // composer instead of leaving a blank block below itself.
  const surfacePanelHeight = Math.max(
    8,
    mainContentHeight + effectiveSurfacePanelRows + composerStatusBlockHeight + composerPopoverHeight
      + (embeddedComposer ? 0 : composerDockHeight) + (fullscreenMode ? 0 : 2),
  )

  // With a right-hand panel open the composer docks under the reader column
  // only, so the rail runs down beside it like the panel does — otherwise the
  // dock's rows under the rail are left empty.
  // A panel docked under the reader leaves the rail running down beside it too.
  const sidebarExtraRows = rightSidePanelVisible ? Math.max(surfacePanelHeight - mainContentHeight, 0) : effectiveSurfacePanelRows
  // Extended, the rail outgrows its row, so nothing clips the list to the
  // frame any more: budget the list to the frame's inside.
  const sidebarRowBudget = Math.max((sidebarExtraRows > 0 ? mainContentHeight + sidebarExtraRows - 2 : mainContentHeight) - (workspacesEnabled ? Math.min(4, spacesState.spaces.length) + 3 : 0), 4)
  const sidebarInnerWidth = Math.max(sidebarWidth - 5, 17)
  // A provider listed across several instances (ACP agents, accounts) is
  // several stores' sessions, and a row has to say whose it is.
  const showProviderInSessionRows = provider === 'all'
    || new Set(sessions.map((session) => session.providerInstanceId ?? session.provider)).size > 1
  const sidebarSessionCountLabel = normalizedSessionQuery || scratchFilter.hidden > 0 || settledFilter.hidden > 0
    ? `SESSIONS ${filteredSessionsForSidebar.length}/${spaceSessions.length}`
    : `SESSIONS ${spaceSessions.length}`
  const sidebarProviderLabel = provider === 'all'
    ? 'ALL'
    : providerInstances.find((instance) => instance.providerInstanceId === providerInstanceId)?.label.toUpperCase() ?? formatProviderLabel(provider)
  const sidebarHeaderWidth = Math.max(sidebarInnerWidth, 12)
  const sidebarProviderBadgeText = ` ${fitText(sidebarProviderLabel, Math.max(sidebarHeaderWidth - 11, 3)).trimEnd()} `
  const sidebarHeaderPrefix = `${sidebarSessionCountLabel} · `
  const sidebarHeaderPrefixWidth = Math.min(
    sidebarHeaderPrefix.length,
    Math.max(sidebarHeaderWidth - sidebarProviderBadgeText.length - 1, 8),
  )
  const sidebarHeaderSuffix = ` · ${joinMeta([
    `sort ${sidebarSortLabel}`,
    scratchFilter.hidden > 0 ? `${scratchFilter.hidden} scratch hidden` : null,
    settledFilter.hidden > 0 ? `${settledFilter.hidden} settled` : null,
    normalizedSessionQuery ? `/${sessionSearchQuery}` : '/ search',
    'a agents',
  ])}`
  const sidebarHeaderSuffixWidth = Math.max(
    sidebarHeaderWidth - sidebarHeaderPrefixWidth - sidebarProviderBadgeText.length,
    0,
  )
  const sidebarHeaderBaseText = `${fitText(sidebarHeaderPrefix, sidebarHeaderPrefixWidth)}${sidebarProviderBadgeText}${
    sidebarHeaderSuffixWidth >= sidebarHeaderSuffix.length ? sidebarHeaderSuffix : ''
  }`
  const sidebarProviderAccent = getProviderAccent(provider)
  const coordinatorSidebarHeader = useMemo(
    () => {
      const [agents, runs, filter, blocked, done, total] = coordinatorHeaderCounts.split('/')
      return fitText(
        coordinatorSidebarHeaderText(Number(agents) || 0, Number(runs) || 0, filter as CoordinatorPickerFilter, {
          blocked: Number(blocked) || 0,
          done: Number(done) || 0,
          total: Number(total) || 0,
        }),
        Math.max(sidebarInnerWidth - 2, 12),
      )
    },
    [sidebarInnerWidth, coordinatorHeaderCounts],
  )
  const imessageStyle = themeMode === 'imessage'
  const transcriptDiffControls = useMemo<TranscriptDiffControls>(() => ({
    diffNotes: transcriptDiffNotes, diffDraft: transcriptDiffDraft, hoveredDiffAnchor: hoveredTranscriptDiffAnchor,
    activateDiffHover: activateTranscriptDiffHover, openDiffNote: openScopedTranscriptDiffNote,
    sendDiffNoteToComposer: sendScopedTranscriptDiffNote,
    diffPlainCardKeys: transcriptDiffPlainCardKeys, diffHiddenLineNumberCardKeys: transcriptDiffHiddenLineNumberCardKeys,
    diffHiddenHunkHeaderCardKeys: transcriptDiffHiddenHunkHeaderCardKeys, diffRowCursorByCardKey: transcriptDiffRowCursorByCardKey,
    diffSelectionAnchorByCardKey: transcriptDiffSelectionAnchorByCardKey,
    setDiffRowCursor: setTranscriptDiffRowCursorForCard, setDiffSelectionAnchor: setTranscriptDiffSelectionAnchorForCard,
  }), [transcriptDiffNotes, transcriptDiffDraft, hoveredTranscriptDiffAnchor, activateTranscriptDiffHover,
    openScopedTranscriptDiffNote, sendScopedTranscriptDiffNote, transcriptDiffPlainCardKeys,
    transcriptDiffHiddenLineNumberCardKeys, transcriptDiffHiddenHunkHeaderCardKeys, transcriptDiffRowCursorByCardKey,
    transcriptDiffSelectionAnchorByCardKey, setTranscriptDiffRowCursorForCard, setTranscriptDiffSelectionAnchorForCard])
  const selectAgentTool = useCallback((groupKey: string, toolKey: string) => {
    setAgentToolCursorByGroupKey((current) => current[groupKey] === toolKey ? current : { ...current, [groupKey]: toolKey })
  }, [])
  const refreshSessions = useCallback(async (
    nextProvider: ProviderSelection,
    preserveSelection = true,
    foreground = true,
  ) => {
    const requestId = ++sessionRequestRef.current
    let refreshingIndicatorTimer: ReturnType<typeof setTimeout> | null = null
    if (foreground) {
      setLoadingSessions(true)
      setRefreshingSessions(false)
    } else {
      // Most background refreshes are cache-hot and resolve within a frame.
      // Rendering the status label on and immediately off made that harmless
      // five-second poll contend with input and split-pane commits. Preserve
      // feedback for a genuinely slow refresh without making the fast path a
      // guaranteed pair of root renders.
      refreshingIndicatorTimer = setTimeout(() => {
        if (requestId === sessionRequestRef.current) setRefreshingSessions(true)
      }, 150)
    }
    if (!providerSwitchRef.current) setError(null)

    try {
      const nextSessions = withPendingInboxEdits(
        await readTuiSessionsAsync(nextProvider, providerInstanceIdRef.current ?? undefined),
        pendingInboxEditsRef.current,
      )
      if (requestId !== sessionRequestRef.current) return
      // Avoid scheduling a transition at all when a background poll returns
      // the same list and the current selection is still valid. React will
      // usually bail out from the state setters below, but the transition
      // itself still walks the root and can collide with a held sidebar key.
      const currentSelectedKey = selectedSessionKeyRef.current
      const selectionStillValid = currentSelectedKey === null
        ? nextSessions.length === 0
        : nextSessions.some((session) => sessionKey(session) === currentSelectedKey)
      if (!foreground && sessionsShallowEqual(sessionsRef.current, nextSessions) && selectionStillValid) return
      startTransition(() => {
        setSessions((prev) => sessionsShallowEqual(prev, nextSessions) ? prev : nextSessions)
        setSelectedSessionKey((current) => {
          // Draft sessions (pending provider sessions after N, or any session that's
          // been opened as a tab but not yet materialised server-side) live
          // in openTabSessions, not `sessions`. If we clobber a draft
          // selection here, pressing N silently lands the user on the first
          // server session instead of the new welcome tab.
          const isDraftTab = (key: string | null) => Boolean(
            key && openTabSessionsRef.current.some((tab) => sessionKey(tab) === key)
          )
          if (nextSessions.length === 0) {
            return isDraftTab(current) ? current : null
          }
          if (preserveSelection && current) {
            const matched = nextSessions.find((session) => sessionKey(session) === current)
            if (matched) return sessionKey(matched)
            if (isDraftTab(current)) return current
          }
          return sessionKey(nextSessions[0])
        })
      })
    } catch (err) {
      if (requestId !== sessionRequestRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
      setSessions(keepEmpty)
      setSelectedSessionKey(null)
    } finally {
      if (refreshingIndicatorTimer) clearTimeout(refreshingIndicatorTimer)
      if (requestId === sessionRequestRef.current) {
        setLoadingSessions(false)
        setRefreshingSessions(false)
      }
    }
  }, [])

  const markSessionRunning = useCallback((ref: RunningSessionRef) => {
    setRunningSessions((prev) => {
      if (prev.some((entry) => entry.sessionId === ref.sessionId && entry.provider === ref.provider)) return prev
      return [...prev, ref]
    })
  }, [])

  const clearSessionRunning = useCallback((ref: RunningSessionRef) => {
    setRunningSessions((prev) => {
      const next = prev.filter((entry) => !(entry.sessionId === ref.sessionId && entry.provider === ref.provider))
      return next.length === prev.length ? prev : next
    })
  }, [])

  const refreshSessionMetadata = useCallback((
    session: Session,
    foreground = false,
    detailSnapshot?: TuiSessionDetail,
    cachedDetailSnapshot?: TuiSessionDetail | null,
    includeContextUsage = true,
  ) => {
    const cacheKey = sessionKey(session)
    const isSelectedTab = cacheKey === selectedSessionKeyRef.current
    const isRunningSession = runningSessionsRef.current.some((running) =>
      running.sessionId === session.sessionId && running.provider === (session.provider ?? 'claude'),
    )

    if (session.provider === 'claude') {
      const isPreviewingSession = tabsEnabledRef.current
        && !openTabSessionsRef.current.some((openSession) => sessionKey(openSession) === cacheKey)
      const activeComposerTarget = composerTargetSessionRef.current
      const isComposerTarget = Boolean(activeComposerTarget && sessionKey(activeComposerTarget) === cacheKey)
      if (isPreviewingSession && !isComposerTarget) return

      if (
        includeContextUsage
        && !isRunningSession
        && sessionContextUsageCacheRef.current.get(cacheKey)
      ) return
    }

    const metadataTtl = isSelectedTab
      ? (session.provider === 'claude' ? CLAUDE_METADATA_REFRESH_MS : DEFAULT_METADATA_REFRESH_MS)
      : (session.provider === 'claude' ? CLAUDE_BACKGROUND_METADATA_REFRESH_MS : DEFAULT_BACKGROUND_METADATA_REFRESH_MS)
    const lastMetadataFetch = sessionMetadataFetchedAtRef.current.get(cacheKey) ?? 0
    const hasCachedModel = Boolean(
      cachedDetailSnapshot?.info?.currentModel
      || detailSnapshot?.info?.currentModel
      || sessionDetailCacheRef.current.get(cacheKey)?.info?.currentModel
    )
    const hasCachedMetadata = hasCachedModel || (
      includeContextUsage && Boolean(sessionContextUsageCacheRef.current.get(cacheKey))
    )
    const metadataIsFresh = lastMetadataFetch > 0 && Date.now() - lastMetadataFetch < metadataTtl
    const shouldFetchMetadata = !sessionMetadataInFlightRef.current.has(cacheKey) && (
      !hasCachedMetadata && !metadataIsFresh
      || hasCachedMetadata && Date.now() - lastMetadataFetch >= metadataTtl
    )
    if (!shouldFetchMetadata) return

    sessionMetadataInFlightRef.current.add(cacheKey)
    if (includeContextUsage && foreground && isSelectedTab) {
      setContextUsageStatus('loading')
    }
    void Promise.race([
      readTuiSessionMetadataAsync(session),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), METADATA_REQUEST_TIMEOUT_MS)
      }),
    ])
      .then((metadata) => {
        // Metadata reads are session-scoped and may legitimately overlap (the
        // reader can show one session while the composer targets another pane).
        // A single global request id made the newer request discard the older
        // session's valid result, leaving that composer's chip on "loading".
        const isStillSelectedTab = cacheKey === selectedSessionKeyRef.current
        const pinnedKeys = new Set([
          ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
          selectedSessionKeyRef.current,
        ].filter((key): key is string => Boolean(key)))
        touchMapEntry(sessionMetadataFetchedAtRef.current, cacheKey, Date.now())
        const reportedModel = metadata?.currentModel ?? null
        setTuiReportedModelByKey((prev) => (
          Object.prototype.hasOwnProperty.call(prev, cacheKey) && prev[cacheKey] === reportedModel
            ? prev
            : { ...prev, [cacheKey]: reportedModel }
        ))
        if (!metadata) {
          pruneSessionCaches(
            sessionDetailCacheRef.current,
            sessionContextUsageCacheRef.current,
            sessionMetadataFetchedAtRef.current,
            pinnedKeys,
          )
          if (includeContextUsage && foreground && isStillSelectedTab) {
            startTransition(() => setContextUsageStatus('unavailable'))
          }
          return
        }
        startTransition(() => {
          if (includeContextUsage && metadata.contextUsage) {
            touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, metadata.contextUsage)
            if (isStillSelectedTab) {
              setContextUsage(metadata.contextUsage)
              setContextUsageStatus('ready')
            }
          }
          const currentModel = metadata.currentModel
          if (currentModel) {
            setSessionDetail((prev) => {
              if (!prev) return prev
              if (
                prev.info?.sessionId
                && prev.info.sessionId !== session.sessionId
              ) {
                return prev
              }
              if (!prev.info) return prev
              if (prev.info.currentModel === currentModel) return prev
              return {
                ...prev,
                info: {
                  ...prev.info,
                  currentModel,
                },
              }
            })
            const cached = sessionDetailCacheRef.current.get(cacheKey)
            if (cached?.info) {
              touchMapEntry(sessionDetailCacheRef.current, cacheKey, {
                ...cached,
                info: {
                  ...cached.info,
                  currentModel,
                },
              })
            }
          }
          pruneSessionCaches(
            sessionDetailCacheRef.current,
            sessionContextUsageCacheRef.current,
            sessionMetadataFetchedAtRef.current,
            pinnedKeys,
          )
          if (includeContextUsage && !metadata.contextUsage && isStillSelectedTab) {
            setContextUsageStatus('unavailable')
          }
        })
      })
      .catch(() => {
        setTuiReportedModelByKey((prev) => (
          Object.prototype.hasOwnProperty.call(prev, cacheKey) && prev[cacheKey] === null
            ? prev
            : { ...prev, [cacheKey]: null }
        ))
        if (includeContextUsage && foreground && cacheKey === selectedSessionKeyRef.current) {
          startTransition(() => setContextUsageStatus('unavailable'))
        }
      })
      .finally(() => {
        sessionMetadataInFlightRef.current.delete(cacheKey)
      })
  }, [])

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

  const refreshSelectedSessionDetail = useCallback(async (session: Session, foreground = true) => {
    const cacheKeyForGuards = sessionKey(session)
    // Callers pass identity-stable skeleton sessions; pull transcript update time from
    // the latest sessions list (see sessionsByKeyRef) or the guards below
    // never fire and every poll/settle re-reads the full session file.
    const sessionLastModified = sessionTranscriptUpdatedAt(session, sessionsByKeyRef.current.get(cacheKeyForGuards))
    const sessionIsRunning = reattachedRunningKeyRef.current === cacheKeyForGuards
      || runningSessionsRef.current.some(running => sessionKey(running) === cacheKeyForGuards)
    if (!foreground && (loadingDetailRef.current || backgroundRefreshInFlightRef.current.has(cacheKeyForGuards))) return
    // A live baseline normally means an owned stream is rendering the turn, so
    // background polls pause. Reattached turns have no stream — the poll is the
    // only way their progress lands, so keep polling those.
    if (
      !foreground
      && liveTranscriptBaselineRef.current.has(cacheKeyForGuards)
      && !awaitingPersistedTurnRef.current
      && reattachedRunningKeyRef.current !== cacheKeyForGuards
    ) return

    // Skip idle background polls when the provider hasn't changed since the
    // cached detail was populated — avoids re-reading and re-threading the
    // full message file every interval for idle sessions. Worst case the
    // sidebar's update time is stale and we skip one poll; the next sidebar
    // refresh catches us up.
    if (!foreground && !sessionIsRunning && !awaitingPersistedTurnRef.current && typeof sessionLastModified === 'number') {
      const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
      if (recordedMtime != null && recordedMtime >= sessionLastModified) return
    }
    // Cache-first for foreground loads — show the last-known detail immediately
    // rather than flashing a spinner while disk IO / JSON parsing runs. A
    // background refresh still fires below so the UI catches up.
    if (foreground) {
      // Coalesce FIRST, before touching the display: if a foreground load is
      // already running, the user is still scrubbing — just remember the latest
      // target and bail without rendering this fly-by session. The in-flight
      // load's finally runs the latest pending target when the worker frees, so
      // neither the worker queue nor the transcript view churns mid-scrub.
      if (foregroundLoadInFlightRef.current) {
        pendingForegroundLoadRef.current = session
        return
      }
      foregroundLoadInFlightRef.current = true

      // Worker idle → this is a settled open. Show the last-known detail
      // immediately (cache hit) rather than flashing a spinner while the
      // background refresh below runs.
      const shared = loader.peek(session, densityRef.current, showToolCallsRef.current)
      if (shared) {
        sessionDetailOwnerKeys.set(shared.detail, cacheKeyForGuards)
        touchMapEntry(sessionDetailCacheRef.current, cacheKeyForGuards, shared.detail)
        if (shared.revision !== undefined) sessionDetailMtimeRef.current.set(cacheKeyForGuards, shared.revision)
        else sessionDetailMtimeRef.current.delete(cacheKeyForGuards)
      }
      const cached = sessionDetailCacheRef.current.get(cacheKeyForGuards)
      if (cached) {
        navDetailSetAtRef.current = { key: cacheKeyForGuards, at: performance.now() }
        setSessionDetail(cached)
        setLoadingDetail(false)
        // A window that read this session first leaves its usage here too.
        if (cached.contextUsage && cacheKeyForGuards === selectedSessionKeyRef.current) {
          setContextUsage(cached.contextUsage)
          setContextUsageStatus('ready')
        }
        if (!cached.info?.currentModel) {
          setTimeout(() => {
            refreshSessionMetadata(session, false, cached, cached, false)
          }, 0)
        }
        // Session file unchanged since the cached detail was read → the worker
        // re-read would return identical content. Skip it entirely so settling
        // on a recently-visited session costs nothing (the same guard the
        // background poll uses; the next sessions-list refresh catches a stale
        // lastModified). Never skip while a live turn is in flight.
        const recordedMtime = sessionDetailMtimeRef.current.get(cacheKeyForGuards)
        if (
          typeof sessionLastModified === 'number'
          && recordedMtime != null
          && recordedMtime >= sessionLastModified
          && !awaitingPersistedTurnRef.current
          && !liveTranscriptBaselineRef.current.has(cacheKeyForGuards)
          && !sessionIsRunning
        ) {
          setError((current) => current?.startsWith('Failed to load session detail') ? null : current)
          foregroundLoadInFlightRef.current = false
          const next = pendingForegroundLoadRef.current
          if (next) {
            pendingForegroundLoadRef.current = null
            void refreshSelectedSessionDetail(next, true)
          }
          return
        }
      } else {
        setLoadingDetail(true)
      }
    }
    // Take the request id only once this call is actually going to read.
    // Taking it before the coalesce branch above meant every DEFERRED call
    // (each scrub settle while a load was running) bumped the counter and
    // invalidated the in-flight read — whose completed result was then thrown
    // away wholesale, cache fill included. Scrubbing through big sessions
    // degenerated into a chain of full reads that never displayed and never
    // cached, which read as the TUI getting progressively slower.
    const requestId = ++detailRequestRef.current
    if (!foreground) backgroundRefreshInFlightRef.current.add(cacheKeyForGuards)
    setError((current) => current?.startsWith('Failed to load session detail') ? null : current)

    try {
      const readStartedAt = performance.now()
      const detail = await loader.read(session, densityRef.current, showToolCallsRef.current, sessionLastModified)
      if (foreground) noteTuiNavLatency('open-to-detail', performance.now() - readStartedAt)
      // Cache the completed read BEFORE the staleness gate. A newer request
      // superseding this one only makes the result too old to display — the
      // read itself is still the freshest snapshot of this session, and
      // discarding it forced the next visit to pay the full read again.
      if (typeof sessionLastModified === 'number') {
        sessionDetailMtimeRef.current.set(cacheKeyForGuards, sessionLastModified)
      }
      const cacheKey = sessionKey(session)
      sessionDetailOwnerKeys.set(detail, cacheKey)
      const pinnedKeys = new Set([
        ...openTabSessionsRef.current.map((openSession) => sessionKey(openSession)),
        selectedSessionKeyRef.current,
      ].filter((key): key is string => Boolean(key)))
      touchMapEntry(sessionDetailCacheRef.current, cacheKey, detail)
      if (detail.contextUsage) {
        touchMapEntry(sessionContextUsageCacheRef.current, cacheKey, detail.contextUsage)
      }
      pruneSessionCaches(
        sessionDetailCacheRef.current,
        sessionContextUsageCacheRef.current,
        sessionMetadataFetchedAtRef.current,
        pinnedKeys,
      )
      // Still scrubbing — a newer settle queued while this read ran. Cache
      // only (above); the chained call in `finally` opens the latest target,
      // so fly-by sessions never pay a transcript mount.
      if (foreground && pendingForegroundLoadRef.current) return
      if (requestId !== detailRequestRef.current) return
      const liveBaseline = liveTranscriptBaselineRef.current.get(cacheKeyForGuards)
      let reconcileLiveOverlay: (() => void) | null = null
      if (liveBaseline) {
        const durableSummary = summarizeDurableSessionMessages(detail.rawMessages)
        const persistedTurnArrived =
          durableSummary.count > liveBaseline.count
          || durableSummary.lastFingerprint !== liveBaseline.lastFingerprint
          || durableSummary.sequenceFingerprint !== liveBaseline.sequenceFingerprint
        if (persistedTurnArrived) {
          const liveAssistantVisible = Boolean(pendingLiveTextRef.current.trim())
            || hasLiveAssistantMessage(liveTranscriptMessagesRef.current, cacheKeyForGuards)
          // Applied inside the transition below, with the detail that replaces
          // it: dropping the live overlay as an urgent update committed a frame
          // before the persisted rows, and the reply blinked out between them.
          const turnLanded = awaitingPersistedTurnRef.current
            ? persistedTurnSettled(detail.rawMessages, liveBaseline.count)
            : hasPersistedAssistantAfterBaseline(detail.rawMessages, liveBaseline.count)
          // While this client still streams the turn, a read can only ever be
          // ahead of the prompt, never past the reply: Codex persists the user
          // row at turn start, and finalizing on it dropped the baseline and
          // the live overlay mid-turn — so the stream's end had nothing left
          // to reconcile and sat in Syncing until the escape hatch.
          const streamStillOwned = ownsComposerStream(cacheKeyForGuards)
          reconcileLiveOverlay = streamStillOwned || (liveAssistantVisible && !turnLanded)
            ? () => {
                if (!hasPersistedUserAfterBaseline(detail.rawMessages, liveBaseline.count)) return
                setLiveTranscriptMessages((prev) => {
                  const next = prev.filter((message) => !(liveMessageSessionKey(message) === cacheKeyForGuards && message.role === 'user'))
                  return next.length === prev.length ? prev : next
                })
              }
            : () => {
                liveTranscriptBaselineRef.current.delete(cacheKeyForGuards)
                setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== cacheKeyForGuards))
                liveToolIndexesRef.current.clear()
                liveToolInputJsonRef.current.clear()
                setComposerLiveText('')
                setAwaitingPersistedTurn(false)
              }
        }
      }
      startTransition(() => {
        reconcileLiveOverlay?.()
        const displayedDetail = sessionDetailRef.current
        // Identity first: a fork's transcript is message-for-message its
        // parent's, so content alone called the fork "unchanged" and left the
        // parent on screen. An untagged detail (a local edit of one) re-sets
        // once, which is the safe direction.
        const unchanged = displayedDetail !== null
          && sessionDetailOwnerKeys.get(displayedDetail) === cacheKey
          && displayedDetail.rawMessages.length === detail.rawMessages.length
          && sessionMessageFingerprint(displayedDetail.rawMessages.at(-1)) === sessionMessageFingerprint(detail.rawMessages.at(-1))
          && sessionMessageSequenceFingerprint(displayedDetail.rawMessages) === sessionMessageSequenceFingerprint(detail.rawMessages)
          && displayedDetail.info?.currentModel === detail.info?.currentModel
          && displayedDetail.info?.customTitle === detail.info?.customTitle
        navDetailSetAtRef.current = { key: cacheKeyForGuards, at: performance.now() }
        if (unchanged) {
          // Keep the displayed and cached identities aligned so cache-first
          // revisits do not trigger a full transcript reformat on idle polls.
          touchMapEntry(sessionDetailCacheRef.current, cacheKey, displayedDetail)
        } else {
          setSessionDetail(detail)
        }
        if (detail.contextUsage && cacheKey === selectedSessionKeyRef.current) {
          setContextUsage(detail.contextUsage)
          setContextUsageStatus('ready')
        }
      })

      // Session detail is the transcript-critical path. If it could not report
      // a model, fill only that composer metadata in the background; context
      // usage remains disabled for open tabs.
      if (!detail.info?.currentModel) {
        setTimeout(() => {
          refreshSessionMetadata(session, false, detail, null, false)
        }, 0)
      }
    } catch (err) {
      if (requestId !== detailRequestRef.current) return
      // Only clear the view if we have nothing cached to fall back on — keeps
      // the last-known good detail visible during transient read failures.
      if (!sessionDetailCacheRef.current.has(cacheKeyForGuards)) setSessionDetail(null)
      setError(err instanceof Error ? `Failed to load session detail: ${err.message}` : 'Failed to load session detail')
    } finally {
      if (requestId === detailRequestRef.current && foreground) setLoadingDetail(false)
      if (!foreground) backgroundRefreshInFlightRef.current.delete(cacheKeyForGuards)
      if (foreground) {
        foregroundLoadInFlightRef.current = false
        // Run only the most-recent target requested while we were busy — every
        // session scrubbed past in between is skipped, so the worker never sees
        // a backlog.
        const next = pendingForegroundLoadRef.current
        if (next) {
          pendingForegroundLoadRef.current = null
          void refreshSelectedSessionDetail(next, true)
        }
      }
    }
  }, [refreshSessionMetadata, loader])

  // Worker-only warm for a sidebar neighbour. Never touches display state,
  // detailRequestRef, or loading/error flags — and, critically, never asks for
  // the transcript back. The threading worker reads, threads and formats the
  // session into its own caches; the payload stays there.
  //
  // Returning the transcript (as this used to) made a prefetch round several
  // times more expensive *in the worker*, which is the resource a real open
  // needs: delivering 8 first-visit sessions costs ~311ms of worker time
  // against ~47ms to warm the same eight. Since the worker is serial, every
  // one of those milliseconds is time a genuine open can spend queued behind a
  // prefetch — and the App cache the payload filled only ever paid off if the
  // user actually visited that neighbour.
  const prefetchSessionDetail = useCallback(async (session: Session): Promise<void> => {
    const key = sessionKey(session)
    if (backgroundRefreshInFlightRef.current.has(key)) return
    if (liveTranscriptBaselineRef.current.has(key)) return
    // Already displayable from the App's own cache and known fresh — the open
    // takes the cached fast path, so there is nothing for the worker to warm.
    const lastModified = sessionTranscriptUpdatedAt(session, sessionsByKeyRef.current.get(key))
    if (sessionDetailCacheRef.current.has(key) && typeof lastModified === 'number') {
      const recorded = sessionDetailMtimeRef.current.get(key)
      if (recorded != null && recorded >= lastModified) return
    }
    backgroundRefreshInFlightRef.current.add(key)
    try {
      await warmTranscriptAsync(session, densityRef.current, showToolCallsRef.current)
    } catch {
      // Best-effort: a failed warm just means the eventual open pays the
      // normal read (which surfaces its own error if it also fails).
    } finally {
      backgroundRefreshInFlightRef.current.delete(key)
    }
  }, [])

  const jumpToTranscriptTail = useStableEvent(() => {
    if (visibleTranscriptCards.length === 0) return
    const lastIndex = visibleTranscriptCards.length - 1
    jumpToTranscriptIndex(lastIndex)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
  })

  const jumpToUnreadBoundary = useStableEvent(() => {
    if (unreadBoundaryIndex >= 0) {
      jumpToTranscriptIndex(unreadBoundaryIndex)
      return
    }
    jumpToTranscriptTail()
  })

  const jumpToResumeMarker = useStableEvent(() => {
    const index = resumeMarkerKey ? (transcriptIndexByKey.get(resumeMarkerKey) ?? -1) : -1
    if (index >= 0) jumpToTranscriptIndex(index)
  })

  const focusSidebarEntry = useStableEvent((entry: SidebarEntry | undefined) => {
    if (!entry) return
    if (entry.type === 'subagent' && entry.entry.kind === 'summary') setSidebarSubagentCursor(entry.key)
    else {
      setSidebarSubagentCursor(null)
      const session = sidebarEntrySession(entry)
      if (session) { const key = sessionKey(session); setSelectedSessionKey(key); setComposerPaneTargetKey(key) }
    }
    setError(null)
  })
  const moveSelection = useStableEvent((delta: number) => {
    const rows = sidebarEntries.filter(entry => entry.type === 'session' || entry.type === 'subagent')
    if (!rows.length) return
    const current = sidebarSubagentCursor ?? (selectedSession ? sessionKey(selectedSession) : null)
    const at = rows.findIndex(entry => sidebarEntrySessionKey(entry) === current)
    const next = rows[clamp((at >= 0 ? at : 0) + delta, 0, rows.length - 1)]!
    focusSidebarEntry(next)
  })

  const moveCursor = useStableEvent((delta: number) => {
    if (visibleTranscriptCards.length === 0) return
    const cursorIndex = readCursorIndex()
    const nextIndex = clamp((cursorIndex >= 0 ? cursorIndex : 0) + delta, 0, visibleTranscriptCards.length - 1)
    setTranscriptCursorKey(visibleTranscriptCards[nextIndex].key)
    const atTail = nextIndex === visibleTranscriptCards.length - 1
    setFollowTail(atTail)
    if (atTail) {
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
    }
  })


  const moveAgentToolCursor = useStableEvent((delta: -1 | 1): boolean => {
    if (!groupedToolView) return false
    const cursorIndex = readCursorIndex()
    const groupCard = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!groupCard || !resolvedExpandedKeys.has(groupCard.key)) return false
    const toolCards = agentToolCardsFor(groupCard)
    if (toolCards.length === 0) return false
    const currentKey = agentToolCursorByGroupKey[groupCard.key] ?? null
    const currentIndex = currentKey
      ? toolCards.findIndex((toolCard) => toolCard.key === currentKey)
      : -1
    if (currentIndex === -1) {
      if (delta < 0) return false
      const first = toolCards[0]
      if (!first) return false
      setAgentToolCursorByGroupKey((current) => current[groupCard.key] === first.key ? current : { ...current, [groupCard.key]: first.key })
      return true
    }
    const nextIndex = currentIndex + delta
    if (nextIndex < 0 || nextIndex >= toolCards.length) return false
    const next = toolCards[nextIndex]
    if (!next) return false
    setAgentToolCursorByGroupKey((current) => current[groupCard.key] === next.key ? current : { ...current, [groupCard.key]: next.key })
    return true
  })

  // Returns the number of cards to move for one j/k/↑/↓ tick. With velocity
  // scroll off (or on a fresh tap) this is just 1; while the same direction
  // keeps repeating, the step eases from 1 up to VELOCITY_SCROLL_MAX_STEP over
  // VELOCITY_SCROLL_RAMP_MS — a quadratic ease-in so the ramp feels gradual
  // rather than snapping straight to top speed.
  const velocityScrollStep = useStableEvent((direction: -1 | 1): number => {
    if (!velocityScrollEnabled) return 1
    const now = performance.now()
    const state = velocityScrollStateRef.current
    if (!state || state.direction !== direction || now - state.lastEventTime > VELOCITY_SCROLL_RESET_MS) {
      velocityScrollStateRef.current = { direction, streakStart: now, lastEventTime: now }
      return 1
    }
    state.lastEventTime = now
    const t = clamp((now - state.streakStart) / VELOCITY_SCROLL_RAMP_MS, 0, 1)
    const eased = t * t
    return Math.max(1, Math.round(1 + (VELOCITY_SCROLL_MAX_STEP - 1) * eased))
  })

  const moveViewport = useStableEvent((direction: -1 | 1) => {
    const step = Math.max(Math.floor((height - (focusMode ? 5 : 7)) / 3), 1)
    moveCursor(direction * step)
  })

  const jumpToMatchingCard = useStableEvent((direction: -1 | 1, predicate: (card: TuiTranscriptCard) => boolean) => {
    if (visibleTranscriptCards.length === 0) return
    const cursorIndex = readCursorIndex()
    let index = cursorIndex >= 0 ? cursorIndex + direction : direction > 0 ? 0 : visibleTranscriptCards.length - 1
    while (index >= 0 && index < visibleTranscriptCards.length) {
      if (predicate(visibleTranscriptCards[index])) {
        jumpToTranscriptIndex(index)
        return
      }
      index += direction
    }
  })

  const jumpToSearchMatch = useStableEvent((matchOffset: number) => {
    if (searchMatches.length === 0) return
    const nextMatchIndex = (searchMatchIndex + matchOffset + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(nextMatchIndex)
    jumpToTranscriptIndex(searchMatches[nextMatchIndex] ?? 0)
  })

  const toggleExpansion = useStableEvent((scope: 'selected' | 'parent' = 'selected') => {
    const cursorIndex = readCursorIndex()
    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!card) return
    const agentToolCards = groupedToolView && resolvedExpandedKeys.has(card.key)
      ? agentToolCardsFor(card)
      : []
    const agentToolKey = agentToolCursorByGroupKey[card.key] ?? null
    const selectedAgentTool = scope === 'selected' && agentToolKey
      ? agentToolCards.find((toolCard) => toolCard.key === agentToolKey) ?? null
      : null
    const targetCard = selectedAgentTool ?? card
    const isAgentToolTarget = selectedAgentTool !== null
    const shouldAutoFold = (
      transcriptView === 'conversation'
      || isChatLikeView
      || transcriptView === 'agents'
    ) && targetCard.autoFold
    const isExpanded = isAgentToolTarget
      ? agentToolCardIsExpanded(targetCard, expandedCardKeys, collapsedCardKeys)
      : resolvedExpandedKeys.has(targetCard.key)

    if (!isAgentToolTarget && !isExpanded && card.key.startsWith('agents-tools:')) {
      const firstTool = agentToolCardsFor(card)[0]
      if (firstTool) {
        setAgentToolCursorByGroupKey((current) => (
          current[card.key] === firstTool.key
            ? current
            : { ...current, [card.key]: firstTool.key }
        ))
      }
    }

    if (shouldAutoFold) {
      setCollapsedCardKeys((current) => {
        if (!current.has(targetCard.key)) return current
        const next = new Set(current)
        next.delete(targetCard.key)
        return next
      })
      setExpandedCardKeys((current) => {
        const next = new Set(current)
        if (isExpanded) next.delete(targetCard.key)
        else next.add(targetCard.key)
        return next
      })
      return
    }

    setExpandedCardKeys((current) => {
      if (!current.has(targetCard.key)) return current
      const next = new Set(current)
      next.delete(targetCard.key)
      return next
    })
    setCollapsedCardKeys((current) => {
      const next = new Set(current)
      if (isExpanded) next.add(targetCard.key)
      else next.delete(targetCard.key)
      return next
    })
  })

  // The instance list is re-read on open: one added to provider-instances.json
  // while the TUI runs is offered without a restart.
  const openProviderMenu = useStableEvent(() => {
    setProviderMenuIndex(providerOptionIndex(providerSelectOptions(providerInstances), provider, providerInstanceId))
    setProviderMenuOpen(true)
    void readTuiProviderInstances().then(({ choices }) => {
      setProviderInstances((current) => (JSON.stringify(current) === JSON.stringify(choices) ? current : choices))
      setProviderMenuIndex(providerOptionIndex(providerSelectOptions(choices), provider, providerInstanceId))
    }).catch(() => {})
  })

  const closeProviderMenu = useCallback(() => {
    setProviderMenuOpen(false)
  }, [])

  const openThemeMenu = useStableEvent(() => {
    themeMenuOriginRef.current = themeMode
    setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    setThemeMenuGroup(
      isLightThemeMode(themeMode) ? 'light' : OMZ_MODES.includes(themeMode) ? 'omz' : 'dark',
    )
    setThemeMenuQuery('')
    setThemeMenuOpen(true)
  })

  const closeThemeMenu = useStableEvent(() => {
    const originTheme = themeMenuOriginRef.current
    setThemeMenuOpen(false)
    setThemeMenuQuery('')
    if (originTheme) {
      setThemeMode(originTheme)
      setThemeMenuIndex(Math.max(THEMES.indexOf(originTheme), 0))
    } else {
      setThemeMenuIndex(Math.max(THEMES.indexOf(themeMode), 0))
    }
    themeMenuOriginRef.current = null
  })

  const chooseTheme = useCallback((nextTheme: TuiThemeMode) => {
    setThemeMode(nextTheme)
    setThemeMenuIndex(Math.max(THEMES.indexOf(nextTheme), 0))
    themeMenuOriginRef.current = null
    // A theme picked by name is the choice; it is also what following the
    // terminal will switch to on that side once it is turned back on.
    const side = isLightThemeMode(nextTheme) ? 'light' : 'dark'
    themeSlotsRef.current = { ...themeSlotsRef.current, [side]: nextTheme }
    themeFollowsTerminalRef.current = false
    setThemeFollowsTerminal(false)
    void Promise.all([
      writeTuiTheme(nextTheme),
      writeTuiThemeFollow({ follow: false, [side]: nextTheme }),
    ]).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store theme')
    })
    setThemeMenuOpen(false)
  }, [])

  // The terminal reports its background as light or dark, and reports again
  // when the OS appearance flips. A terminal that never answers leaves the
  // theme where it was.
  const applyTerminalThemeMode = useStableEvent((mode: 'light' | 'dark' | null) => {
    if (!mode || !themeFollowsTerminalRef.current) return
    const target = themeSlotsRef.current[mode]
    // Mid-preview, closing the menu restores its origin: move that too.
    if (themeMenuOriginRef.current) themeMenuOriginRef.current = target
    setThemeMode(target)
    setThemeMenuIndex(Math.max(THEMES.indexOf(target), 0))
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

  const confirmExit = useStableEvent(() => {
    if (exitInProgressRef.current) return
    exitInProgressRef.current = true
    setExitCleanupInProgress(true)
    setQueuedComposerSends(queuedComposerSendsRef.current)
    try { workspaceContext.controller.flush() } catch { /* exit reports existing errors */ }

    const cleanupPromise = activeComposerSendCleanupRef.current
    const controller = composerAbortRef.current
    const activeTurnRequestId = activeComposerTurnRequestIdRef.current
    const activeTurnTarget = composerTargetSessionRef.current
    const runningRefs = [...runningSessionsRef.current]
    for (const key of composerSessions.keys()) composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current?.abort()

    void (async () => {
      const cleanupTasks: Promise<unknown>[] = []
      // Attached, the turns belong to the daemon: closing this window is a
      // detach, and interrupting them here would stop work in every other
      // client's view of it. Only the local stream above is dropped.
      if (!ATTACHED_DAEMON_HOST && activeTurnTarget && activeTurnRequestId) {
        cleanupTasks.push(interruptTuiSessionTurn({
          sessionId: activeTurnTarget.sessionId,
          provider: activeTurnTarget.provider,
          providerInstanceId: activeTurnTarget.providerInstanceId,
          turnRequestId: activeTurnRequestId,
        }).catch(() => undefined))
      }
      if (!ATTACHED_DAEMON_HOST && runningRefs.length > 0) {
        cleanupTasks.push(Promise.allSettled(runningRefs.map((running) => interruptTuiSessionTurn(running))))
      }
      for (const key of composerSessions.keys()) {
        const cleanup = composerSessions.peekRef<Promise<void> | null>(key, 'activeComposerSendCleanupRef')?.current
        if (cleanup) cleanupTasks.push(cleanup.catch(() => undefined))
      }
      if (cleanupTasks.length > 0) {
        await Promise.race([
          Promise.all(cleanupTasks).then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, EXIT_CLEANUP_TIMEOUT_MS)),
        ])
      }
      persistTheme()
      renderer.destroy()
      process.exit(0)
    })()
  })

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
  const openModelPicker = useStableEvent(async () => {
    const target = composerTargetSession ?? selectedSession
    if (!target) {
      showNotice('info', 'Pick a session first')
      return
    }
    setModelPickerTarget(target)
    setModelPickerFocus('model')
    setModelPickerError(null)
    setModelPickerOptions(keepEmpty)
    setModelPickerPermissionOptions(keepEmpty)
    setModelPickerQuery('')
    setModelPickerIndex(0)
    setModelPickerPermissionIndex(0)
    setModelPickerLoading(true)
    setModelPickerOpen(true)
    try {
      const [meta, composerOptions] = await Promise.all([
        readTuiSessionMetadata(target),
        readTuiComposerOptions(target.sessionId, target.provider),
      ])
      const permissionOptions = (composerOptions.permissionModes ?? []).map((mode): SelectOption => ({
        name: mode.label,
        value: mode.value,
        description: mode.description ?? '',
      }))
      setModelPickerPermissionOptions(permissionOptions)
      const reportedPermissionMode = composerOptions.currentPermissionMode
      if (target.provider === 'copilot' && (reportedPermissionMode === 'off' || reportedPermissionMode === 'auto' || reportedPermissionMode === 'on')) {
        setTuiCopilotPermissionModeByKey((prev) => ({ ...prev, [sessionKey(target)]: reportedPermissionMode }))
      }
      const options = meta.models
        .filter((m): m is { value: string; displayName?: string; description?: string } & typeof m =>
          typeof m.value === 'string' && m.value.length > 0)
        .map((m): ModelPickerOption => ({
          name: m.displayName || m.value,
          value: m.value,
          description: m.description ?? '',
          supportsEffort: m.supportsEffort,
          supportedEffortLevels: m.supportedEffortLevels,
          supportsLongContext: m.supportsLongContext,
        }))
      if (options.length === 0) {
        setModelPickerError('No models reported by provider')
        setModelPickerOptions(keepEmpty)
        setModelPickerIndex(0)
        return
      }
      const currentValue = tuiModelOverride[sessionKey(target)] ?? meta.currentModel ?? options[0]!.value
      const idx = Math.max(0, options.findIndex((o) => o.value === currentValue))
      setModelPickerOptions(options)
      setModelPickerIndex(idx >= 0 ? idx : 0)
      // The stored tier only means anything for a model that reports long-context
      // support — dropping to a model that doesn't clears a stale 'long_context'.
      if (target.provider === 'copilot' && !options[idx >= 0 ? idx : 0]?.supportsLongContext) {
        setTuiCopilotContextTierByKey((prev) => (
          prev[sessionKey(target)] ? { ...prev, [sessionKey(target)]: 'default' } : prev
        ))
      }
    } catch (err) {
      setModelPickerError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setModelPickerLoading(false)
    }
  })

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

  useEffect(() => {
    currentThemeRef.current = themeMode
  }, [themeMode])

  useEffect(() => {
    const onInterrupt = () => {
      if (exitConfirmOpenRef.current) {
        confirmExit()
        return
      }
      setExitConfirmOpen(true)
    }
    const onTerminate = () => {
      confirmExit()
    }
    process.on('exit', persistTheme)
    process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onTerminate)
    process.on('SIGHUP', onTerminate)
    return () => {
      process.off('exit', persistTheme)
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
      process.off('SIGHUP', onTerminate)
    }
  }, [confirmExit, persistTheme])

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

  const chooseProvider = useStableEvent(async (
    nextProvider: ProviderSelection,
    targetSession: Session | null = null,
    nextInstanceId: string | null = null,
  ) => {
    if (nextProvider === provider && nextInstanceId === providerInstanceIdRef.current) {
      closeProviderMenu()
      if (targetSession) { setComposerPaneTargetKey(sessionKey(targetSession)); setSelectedSessionKey(sessionKey(targetSession)) }
      return
    }

    closeProviderMenu()
    providerSwitchRef.current = true
    providerInstanceIdRef.current = nextInstanceId
    setProviderInstanceId(nextInstanceId)
    setProvider(nextProvider)
    setSessionDetail(null)
    setComposerPaneTargetKey(targetSession ? sessionKey(targetSession) : null)
    setSelectedSessionKey(targetSession ? sessionKey(targetSession) : null)
    setTranscriptCursorKey(null)
    setExpandedCardKeys(new Set())
    setCollapsedCardKeys(new Set())
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    setResumeMarkerKey(null)
    setSearchMode(false)
    setSearchQuery('')
    setSearchMatchIndex(0)
    setRestoredReaderState({ sessionKey: null, loaded: false, state: null })
    setError(null)

    try {
      await writeTuiProvider(nextProvider, nextInstanceId ?? undefined)
      await refreshSessions(nextProvider, targetSession !== null, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      providerSwitchRef.current = false
    }
  })

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

  const cancelComposerSend = useStableEvent(() => {
    const target = composerTargetSession
    // Turns are decoupled from the client connection (they survive disconnect),
    // so aborting the local fetch alone leaves the agent running on the server —
    // it would finish in the background and reappear on the next poll. Interrupt
    // the server-side turn too, matching the native CLI's Esc/Ctrl+C behavior.
    // A pending session included: its first turn registers under the id the
    // TUI already holds, and an interrupt that lands before registration is
    // held for the matching turn id — skipping it left the turn running.
    const interruptTurnRequestId = activeComposerTurnRequestIdRef.current ?? undefined
    if (target && (!target.isPending || interruptTurnRequestId)) {
      void interruptTuiSessionTurn({
        sessionId: target.sessionId,
        provider: target.provider,
        providerInstanceId: target.providerInstanceId,
        turnRequestId: interruptTurnRequestId,
      }).then((stillQueued) => {
        if (stillQueued) {
          const survivorUuids = new Set(stillQueued)
          const restoreEntries = steeredComposerSendsRef.current
            .filter((entry) => entry.state === 'queued' && !survivorUuids.has(entry.messageUuid))
          const restoreTexts = restoreEntries.map((entry) => entry.text)
          if (restoreTexts.length > 0) {
            const restoredMessageUuids = new Set(restoreEntries.map((entry) => entry.messageUuid))
            const restoredLiveUuids = new Set(restoreEntries.map((entry) => entry.liveMessageUuid))
            steeredComposerSendsRef.current = steeredComposerSendsRef.current
              .filter((entry) => !restoredMessageUuids.has(entry.messageUuid))
            setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => !restoredLiveUuids.has(message.uuid)))
            const currentDraft = composerTextareaRef.current?.plainText ?? composerDraft
            const restored = [currentDraft.trim(), ...restoreTexts].filter(Boolean).join('\n\n')
            composerTextareaRef.current?.setText(restored)
            setComposerDraft(restored)
          }
          if (stillQueued.length > 0) {
            toast.warning(`Interrupted · ${stillQueued.length} queued message${stillQueued.length === 1 ? '' : 's'} will still run`)
          } else if (restoreTexts.length > 0) {
            toast.info(`Interrupted · restored ${restoreTexts.length} cancelled queued message${restoreTexts.length === 1 ? '' : 's'}`)
          }
        }
      }).catch(() => { /* best effort */ })
    }
    // Cancel any pending transient auto-retry so it can't fire after an explicit stop.
    if (composerRetryTimerRef.current) {
      clearTimeout(composerRetryTimerRef.current)
      composerRetryTimerRef.current = null
    }
    composerRetryCountRef.current = 0
    const targetKey = target ? sessionKey(target) : null
    // Confirmed interrupt: if the turn had started (a live baseline exists),
    // keep what the agent produced visible and hand off to the awaitingPersistedTurn
    // 'Syncing…' reconcile so the partial output settles smoothly instead of
    // vanishing and reappearing on the next poll. The send's AbortError handler
    // checks composerInterruptPendingRef to avoid undoing this. The awaiting
    // timeout (AWAITING_PERSISTED_TURN_TIMEOUT_MS) is the escape hatch.
    const reconcileInterrupt = Boolean(targetKey && liveTranscriptBaselineRef.current.has(targetKey))
    composerInterruptPendingRef.current = reconcileInterrupt
    if (composerAbortRef.current) {
      composerAbortRef.current.abort()
    }
    composerAbortRef.current = null
    // Reattached turns have no local stream — the server interrupt above is
    // the whole cancel. Drop the flag and the poll's sidebar mark now; the
    // registry poll reconciles if the interrupt turns out to be a no-op.
    reattachedRunningKeyRef.current = null
    reattachedRunningRef.current = false
    setReattachedRunning(false)
    if (targetKey) {
      const reattachMark = reattachMarksRef.current.get(targetKey)
      if (reattachMark) {
        reattachMarksRef.current.delete(targetKey)
        clearSessionRunning(reattachMark)
      }
    }
    setInterruptPressActive(false)
    if (interruptPressTimeoutRef.current) {
      clearTimeout(interruptPressTimeoutRef.current)
      interruptPressTimeoutRef.current = null
    }
    setPendingPermissions(keepEmpty)
    setPermissionOptionIndex(0)
    // The user interrupted to change course — auto-firing queued follow-ups
    // would be a surprise-send. Pop their text back into the composer instead
    // (after any text typed since), so they can edit and re-send.
    const interruptQueue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
    if (interruptQueue.length > 0) {
      commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
      const currentDraft = composerTextareaRef.current?.plainText ?? composerDraft
      const restoredPayload = restoreComposerDraftPayload(
        { text: currentDraft, attachments: composerMentionAttachmentsRef.current },
        interruptQueue,
      )
      const restored = restoredPayload.text
      const restoredParts = [
        ...interruptQueue.flatMap((entry) => entry.promptParts),
        ...composerPromptPartsRef.current,
      ]
      composerTextareaRef.current?.setText(restored)
      setComposerDraft(restored)
      composerMentionAttachmentsRef.current = restoredPayload.attachments
      composerPromptPartsRef.current = restoredParts
      setComposerMentionAttachments(restoredPayload.attachments)
      setComposerPromptParts(restoredParts)
      restoreComposerPromptPartExtmarks(restoredParts, restored)
    }
    if (reconcileInterrupt) {
      // Keep committed partial cards (liveTranscriptMessages) + baseline for the
      // reconcile, but drop the transient streaming previews right away.
      setComposerSendState('idle')
      setAwaitingPersistedTurn(true)
      setLiveStatus(null)
      setComposerLiveText('')
      setComposerLiveReasoning('')
      setComposerThinkingTokens(0)
      pendingLiveReasoningRef.current = ''
      return
    }
    // Nothing started yet — clear cleanly.
    if (targetKey) {
      liveTranscriptBaselineRef.current.delete(targetKey)
      setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
    }
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    if (liveTextFlushTimerRef.current != null) {
      clearTimeout(liveTextFlushTimerRef.current)
      liveTextFlushTimerRef.current = null
    }
    pendingLiveTextRef.current = ''
    pendingLiveReasoningRef.current = ''
    liveTextTargetSessionRef.current = null
    setComposerSendState('idle')
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setComposerThinkingTokens(0)
    setLiveStatus(null)
    setLiveSubagentText({})
    setLiveToolActivities(keepEmpty)
  })

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

  const respondToTuiPermission = useStableEvent(async (permission: PendingPermission, response: PermissionResponse, permissionMode?: TuiPermissionMode) => {
    if (permission.asyncQuestion) { setAsyncQuestionPrompt(null); return }
    const target = composerTargetSession
    if (!target || permissionActionLoading) return
    setPermissionActionLoading(permission.id)
    try {
      if (response === 'once' && permission.elicitation?.mode === 'url' && permission.url) {
        await openExternalUrl(permission.url)
      }
      await runTuiSessionAction(
        { ...target, sessionId: permission.sessionId ?? target.sessionId },
        { action: 'respondPermission', permissionId: permission.id, response, provider: target.provider, ...(permissionMode ? { permissionMode } : {}) },
      )
      if (permission.provider === 'codex' && permission.questions?.length) {
        setLiveTranscriptMessages((prev) => completeCodexQuestionLiveMessage(prev, permission, null))
      }
      setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
      setPermissionOptionIndex(0)
    } catch (err) {
      if (isPendingRequestGone(err)) {
        setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
        setPermissionOptionIndex(0)
        showNotice('info', PENDING_REQUEST_GONE_NOTICE, 6000)
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Failed to respond to permission')
      }
    } finally {
      setPermissionActionLoading(null)
    }
  })

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
  const submitTuiQuestion = useStableEvent(async (permission: PendingPermission) => {
    const target = composerTargetSession
    if (!target || permissionActionLoading) return
    const questions = permission.questions ?? []
    const answers: PendingQuestionAnswers = {}
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i]!
      const selected = questionSelections[i] ?? []
      const freeform = questionFreeformAnswers[i]?.trim()
      const values = question.multiSelect && freeform
        ? [...selected, freeform]
        : freeform
        ? [freeform]
        : selected
      if (values.length === 0) {
        if (question.required === false) continue
        // Jump focus to the first unanswered question instead of submitting.
        setQuestionFocusIndex(i)
        setQuestionOptionIndex(0)
        return
      }
      answers[question.id ?? question.question] = values
    }
    if (permission.asyncQuestion) {
      if (permission.sessionId !== target.sessionId || permission.provider !== target.provider || permission.providerInstanceId !== target.providerInstanceId) {
        setAsyncQuestionPrompt(null)
        showNotice('info', 'Open the original session to answer these questions.')
        return
      }
      const answer = formatAsyncQuestionAnswers(questions, answers)
      const existing = composerTextareaRef.current?.plainText ?? composerDraft
      const next = `${existing}${existing ? '\n\n' : ''}${answer}\n`
      composerTextareaRef.current?.setText(next)
      setComposerDraft(next)
      setAsyncQuestionPrompt(null)
      setComposerActive(true)
      setFocusedPane('messages')
      return
    }
    setPermissionActionLoading(permission.id)
    try {
      await runTuiSessionAction(
        { ...target, sessionId: permission.sessionId ?? target.sessionId },
        { action: 'respondQuestion', permissionId: permission.id, answers, provider: target.provider },
      )
      setLiveTranscriptMessages((prev) => completeCodexQuestionLiveMessage(prev, permission, answers))
      setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
      setQuestionSelections({})
      setQuestionFreeformAnswers({})
      setQuestionFreeformEditing(false)
      setQuestionFocusIndex(0)
      setQuestionOptionIndex(0)
    } catch (err) {
      if (isPendingRequestGone(err)) {
        setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== permission.id))
        showNotice('info', PENDING_REQUEST_GONE_NOTICE, 6000)
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Failed to submit answer')
      }
    } finally {
      setPermissionActionLoading(null)
    }
  })

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
  const respondToAttentionItem = useStableEvent(async (item: AttentionItem, response: PermissionResponse) => {
    const permission = item.permission
    if (!permission || attentionRespondingId) return
    setAttentionRespondingId(permission.id)
    try {
      await runTuiSessionAction(
        { sessionId: item.sessionId, provider: item.provider } as Session,
        { action: 'respondPermission', permissionId: permission.id, response, provider: item.provider },
      )
      setPendingPermissions((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
      setBackgroundPrompts((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
    } catch (err) {
      if (isPendingRequestGone(err)) {
        setPendingPermissions((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
        setBackgroundPrompts((prev) => keepFiltered(prev, (p) => p.id !== permission.id))
        showNotice('info', PENDING_REQUEST_GONE_NOTICE, 6000)
      } else {
        showNotice('error', err instanceof Error ? err.message : 'Failed to respond to permission')
      }
    } finally {
      setAttentionRespondingId(null)
    }
  })

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

  const reuseLastPrompt = useStableEvent(() => {
    const messages = sessionDetail?.threadedMessages
    if (!messages || messages.length === 0) return
    let lastUserText = ''
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (msg.role !== 'user') continue
      const text = msg.blocks
        .map((block) => {
          if (block.type === 'text') return block.text ?? ''
          if (block.type === 'local_command_stdout' && 'stdout' in block && typeof block.stdout === 'string') return block.stdout
          return ''
        })
        .join('\n')
        .trim()
      if (text.length > 0) {
        lastUserText = text
        break
      }
    }
    if (!lastUserText) return
    setComposerActive(true)
    composerTextareaRef.current?.setText(lastUserText)
    setComposerDraft(lastUserText)
  })

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
  useEffect(() => {
    if (!selectedSessionCwdForWorktree || !selectedSessionCwdForWorktree.includes(WORKTREE_TASK_CWD_SEGMENT)) {
      setSelectedWorktreeTask(null)
      return
    }
    if (selectedWorktreeTaskCacheRef.current.has(selectedSessionCwdForWorktree)) {
      setSelectedWorktreeTask(selectedWorktreeTaskCacheRef.current.get(selectedSessionCwdForWorktree) ?? null)
      return
    }
    let cancelled = false
    void findTuiWorktreeTask(selectedSessionCwdForWorktree)
      .then((task) => {
        selectedWorktreeTaskCacheRef.current.set(selectedSessionCwdForWorktree, task)
        if (!cancelled) setSelectedWorktreeTask(task)
      })
      .catch(() => {
        selectedWorktreeTaskCacheRef.current.set(selectedSessionCwdForWorktree, null)
        if (!cancelled) setSelectedWorktreeTask(null)
      })
    return () => { cancelled = true }
  }, [selectedSessionCwdForWorktree])

  // Name → isolated worktree + branch + fresh session cwd'd into it, composer
  // focused for the first prompt. The task then runs without touching the main
  // checkout until the user merges it back.
  const submitWorktreeTask = useStableEvent(async () => {
    const name = worktreeDraft.trim()
    // Ref-guarded: Enter can arrive via both the input's onSubmit and the
    // keyboard branch in the same tick, before worktreeBusy state lands.
    if (!name || worktreeSubmitInFlightRef.current) return
    worktreeSubmitInFlightRef.current = true
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    setWorktreeBusy(true)
    try {
      const task = await createTuiWorktreeTask(baseCwd, name)
      const targetProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
      const result = await createTuiSession({ provider: targetProvider, cwd: task.path, title: name })
      const draft: Session = {
        sessionId: result.sessionId,
        provider: result.provider,
        cwd: result.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: name,
        isPending: result.isPending,
      }
      setOpenTabSessions((prev) => prev.some((s) => sessionKey(s) === sessionKey(draft)) ? prev : [...prev, draft])
      setSelectedSessionKey(sessionKey(draft))
      setComposerPaneTargetKey(sessionKey(draft))
      setComposerPreferredTargetKey(sessionKey(draft))
      await prepareCreatedSessionForComposer(draft)
      setWorktreeModalOpen(false)
      setWorktreeDraft('')
      setComposerActive(true)
      showNotice('info', `Worktree task on ${task.branch} — the session runs in an isolated checkout.`, 5000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to create worktree task')
    } finally {
      worktreeSubmitInFlightRef.current = false
      setWorktreeBusy(false)
    }
  })

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

  const openTeammatesPanel = useStableEvent(() => {
    if (!isPluginEnabled('coordination')) {
      showNotice('info', 'Teammates are off · turn Coordination on in Plugins (⌃K palette)')
      return
    }
    const session = selectedSession
    if (!session) {
      showNotice('info', 'Open a conversation before giving it teammates', 3500)
      return
    }
    if (session.isPending) {
      showNotice('info', 'Send a first message before giving this conversation teammates', 4000)
      return
    }
    // The attention badge observes this conversation without opening the panel.
    // Opening it here reuses that feed and preserves the reader's draft.
    openInteractiveCoordinator({
      sessionId: session.sessionId,
      provider: session.provider ?? 'claude',
      cwd: session.cwd,
      title: session.customTitle ?? session.summary ?? '(untitled session)',
    })
  })

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

  const prepareCreatedSessionForComposer = useStableEvent(async (draft: Session) => {
    const key = sessionKey(draft)
    composerPreparingTargetKeyRef.current = key
    setComposerPreparingTargetKey(key)
    try {
      await runComposerSessionPreparation({
        refreshSessions: () => refreshSessions(provider, true, false),
        prewarmRuntime: () => prewarmTuiSession(draft, {
          model: tuiModelOverride[key] || undefined,
          effort: tuiEffort === 'auto' ? undefined : tuiEffort,
          isPending: draft.isPending === true,
        }),
        loadDetail: () => draft.isPending
          ? Promise.resolve()
          : refreshSelectedSessionDetail(draft, true),
        // Provider commands, agents, modes, and permission controls can depend
        // on the warmed runtime (notably Claude), so load them after prewarm.
        loadAffordances: () => fetchComposerAffordances(draft, key),
      })
    } finally {
      if (composerPreparingTargetKeyRef.current === key) {
        composerPreparingTargetKeyRef.current = null
        setComposerPreparingTargetKey(null)
      }
    }
  })

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
  const rewindConversationToPrompt = useStableEvent(async (chosen: RewindCandidate): Promise<boolean> => {
    const target = composerTargetSession
    const raw = sessionDetail?.rawMessages ?? []
    if (!target) return false
    const restorePrompt = () => setTimeout(() => {
      composerTextareaRef.current?.setText(chosen.text)
      setComposerDraft(chosen.text)
      setComposerActive(true)
    }, 0)
    try {
      if (target.provider === 'codex' || target.provider === 'opencode') {
        const turnId = raw.find((message) => message.uuid === chosen.uuid)?.turnId
        if (target.provider === 'codex' && !turnId) throw new Error('Could not find that prompt\'s turn')
        const body = target.provider === 'codex' ? { beforeTurnId: turnId } : { userMessageId: chosen.uuid }
        await rewindTuiSession(target, body)
        // The cached detail predates the revert and the sidebar's lastModified
        // has not caught up, so the read would otherwise be skipped as unchanged.
        sessionDetailMtimeRef.current.delete(sessionKey(target))
        loader.invalidate(target)
        await refreshSelectedSessionDetail(target, true)
        restorePrompt()
        showNotice('info', 'Rewound — the prompt is back in the composer; files are unchanged', 6000)
        return true
      }
      if (target.provider === 'claude' || target.provider === 'pi') {
        const point = forkPointBefore(raw, chosen.uuid)
        if (point === undefined) throw new Error('Could not find that prompt in the transcript')
        if (point === null) {
          await startFreshSession(target.provider, target.cwd ?? process.cwd())
        } else {
          const forked = await forkTuiSession(target, point)
          const fork: Session = {
            ...target,
            sessionId: forked.sessionId,
            createdAt: Date.now(),
            lastModified: Date.now(),
            summary: `Rewind of ${target.customTitle?.trim() || target.summary?.trim() || 'session'}`,
            customTitle: undefined,
            isPending: false,
          }
          // Opening the fork restores its own draft, so the prompt goes there.
          writeWorkspaceDraft(sessionKey(fork), chosen.text)
          await openCreatedSession(fork)
        }
        if (point === null) restorePrompt()
        showNotice('info', 'Rewound in a fork — the original is unchanged; files are unchanged', 6000)
        return true
      }
      showNotice('info', `${formatProviderLabel(target.provider ?? 'claude')} sessions cannot be rewound`)
      return false
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Rewind failed')
      return false
    }
  })

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
  const forkIntoNewSession = useStableEvent(async (target: Session, sendInFork?: string) => {
    if (target.isPending) {
      showNotice('info', 'Nothing to fork yet — send a first message')
      return
    }
    try {
      const forked = await forkTuiSession(target)
      const fork: Session = {
        ...target,
        sessionId: forked.sessionId,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: `${sendInFork ? 'Side conversation from' : 'Fork of'} ${target.customTitle?.trim() || target.summary?.trim() || 'session'}`,
        customTitle: undefined,
        isPending: false,
      }
      // Codex /side: the aside is sent in the fork once it is the composer's target.
      if (sendInFork) pendingForkSendRef.current = { key: sessionKey(fork), text: sendInFork }
      await openCreatedSession(fork)
      showNotice('info', sendInFork
        ? 'Side conversation — a fork of this chat; the original is unchanged.'
        : 'Forked — you are now in the copy; the original is unchanged.')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Fork failed')
    }
  })

  // Create a session and open it with the composer focused — the New Session
  // dialog's action, and what /clear and /new do, as in the native CLIs.
  const startFreshSession = useStableEvent(async (targetProvider: AgentProvider, cwd: string) => {
    setWorkspaceHasSession(true); setWorkspaceLaunched(true)
    if (newSessionBusy) return
    setNewSessionBusy(true)
    {
      try {
        // A new chat goes to the instance the list is narrowed to, else to the
        // one the selected session belongs to.
        const fromAgent = selectedSession?.provider === targetProvider ? selectedSession : null
        const pickedInstance = targetProvider === provider ? providerInstances.find((instance) => instance.providerInstanceId === providerInstanceId) : undefined
        const result = await createTuiSession({ provider: targetProvider, cwd, providerInstanceId: pickedInstance?.providerInstanceId ?? fromAgent?.providerInstanceId })
        await openCreatedSession({
          sessionId: result.sessionId,
          provider: result.provider,
          ...(result.providerInstanceId ? { providerInstanceId: result.providerInstanceId } : {}),
          ...(pickedInstance?.providerInstanceId === result.providerInstanceId ? { providerDisplayName: pickedInstance?.label } : fromAgent && fromAgent.providerInstanceId === result.providerInstanceId ? { providerDisplayName: fromAgent.providerDisplayName } : {}),
          cwd: result.cwd,
          createdAt: Date.now(),
          lastModified: Date.now(),
          summary: 'New session',
          isPending: result.isPending,
        })
        setNewSessionModalOpen(false)
        showNotice('info', result.isPending
          ? `New ${formatProviderLabel(result.provider)} session ready — first message will create it.`
          : 'New session created.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create session')
      } finally {
        setNewSessionBusy(false)
      }
    }
  })

  // /handoff <provider>: continue this conversation on another provider. A new
  // session opens in the same folder with the handoff — the brief plus the recent
  // exchange — as its draft, so the user reads it (and edits it) before it is sent.
  const handoffToProvider = useStableEvent(async (target: Session, providerName: string) => {
    const nextProvider = providerName.trim().toLowerCase()
    if (!isAgentProvider(nextProvider)) {
      showNotice('info', 'Usage: /handoff <claude|codex|opencode|copilot|pi>', 5000)
      return
    }
    if (newSessionBusy) return
    const detail = sessionDetail && sessionDetail.info?.sessionId === target.sessionId ? sessionDetail : null
    if (!detail) {
      showNotice('info', 'Nothing to hand off yet — send a first message')
      return
    }
    setNewSessionBusy(true)
    try {
      const prompt = buildContextHandoffPrompt({
        fromProvider: target.provider ?? 'claude',
        brief: buildHandoffBriefMarkdown({ session: target, detail, git: null, bookmarkIds: new Set() }),
        raw: detail.rawMessages,
      })
      const created = await createTuiSession({ provider: nextProvider, cwd: target.cwd ?? process.cwd() })
      const next: Session = {
        sessionId: created.sessionId,
        provider: created.provider,
        cwd: created.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: `Handoff from ${target.customTitle?.trim() || target.summary?.trim() || 'session'}`,
        isPending: created.isPending,
      }
      recordContextTransfer({
        type: 'handoff',
        source: { provider: target.provider, sessionId: target.sessionId },
        target: { provider: created.provider, sessionId: created.sessionId },
        strategy: 'context_handoff',
      })
      writeWorkspaceDraft(sessionKey(next), prompt)
      await openCreatedSession(next)
      showNotice('info', `Continuing on ${formatProviderLabel(created.provider)} — the handoff is in the composer; the original is unchanged`, 6000)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Handoff failed')
    } finally {
      setNewSessionBusy(false)
    }
  })

  // CLI built-ins that are TUI views rather than agent requests. The Claude SDK
  // answers these "isn't available in this environment" (or, for /todos, not at
  // all — it went to the model as prompt text); the native CLIs show them.
  const runTuiLocalCommand = useStableEvent((target: Session, text: string): boolean => {
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
  })

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

  const watchCoordinatorRun = useStableEvent((snapshot: ProtocolRunSnapshot) => {
    const plan = planCoordinatorWorkspace(snapshot, sessionsByKeyRef.current)
    if (!plan.lead) { showNotice('info', 'This run has no readable lead transcript', 5000); return }
    checkpointWindowLayout()
    watchedRosterRef.current = { runId: snapshot.run.id, keys: new Set(plan.targets.map(target => target.sessionKey)) }
    setCoordinatorWorkspace(snapshot)
    setCoordinatorWorkspaceRunId(snapshot.run.id)
    const lead = plan.lead
    const panes = plan.targets.filter(target => target.sessionKey !== lead.sessionKey)
    setOpenTabSessions(current => {
      const keys = new Set(current.map(sessionKey))
      return [...current, ...plan.targets.filter(target => !keys.has(target.sessionKey)).map(target => target.session)]
    })
    selectTabSession(lead.session)
    // The lead's window on the left, teammates stacked beside it.
    const keys = [lead.sessionKey, ...panes.map(target => target.sessionKey)]
    const stack = (first: number, count: number): WindowSplitNode => count <= 1
      ? { slot: first } : { axis: 'y', ratio: 1 / count, first: { slot: first }, second: stack(first + 1, count - 1) }
    setSplitPinnedKeys(keys)
    setSplitPaneCount(keys.length)
    setWindowOrder(keys)
    setWindowSplitTree({ primary: false, keys, root: panes.length ? { axis: 'x', ratio: 0.55, first: { slot: 0 }, second: stack(1, panes.length) } : { slot: 0 } })
    setWindowSurfaces(keepEmpty)
    setWindowZoom(null)
    setWindowSurfacePeek(null)
    setFullscreenMode(false)
    setSplitFocusIndex(null)
    setFocusedPane('messages')
    showNotice('info', `Watching this run · lead + ${panes.length} teammate${panes.length === 1 ? '' : 's'} · ⌃B p switch · ⌃B a attention · ⌃B w save${plan.skipped.length ? ` · ${plan.skipped.length} unreadable participant(s) skipped` : ''}`, 7000)
  })

  // Herdr's everyday view: the lead's chat in the reader and teammates live
  // beside it. Each watched teammate becomes an open tab pinned to a split
  // pane, first in the order given (the panel passes attention order), so the
  // teammate that needs the user is the one that gets a pane when there are
  // more teammates than panes.
  const watchCoordinationAgentSessions = useStableEvent((agents: ProtocolAgent[]) => {
    const targets: Array<{ sessionKey: string; session: Session; name: string }> = []
    let refusal: string | null = null
    for (const agent of agents) {
      const target = resolveCoordinationTranscriptTarget(agent, sessionsByKeyRef.current, Date.now())
      if (target.kind === 'unreadable') refusal ??= target.reason
      else targets.push({ sessionKey: target.sessionKey, session: target.session, name: agent.name })
    }
    const plan = planTeammateWatch({
      targets,
      selectedSessionKey,
      currentPins: splitPinnedKeys,
      currentCount: splitPaneCount,
      maxPanes: SPLIT_PANE_MAX,
    })
    if (plan.watched.length === 0) {
      showNotice('info', refusal ?? 'That teammate is already in the reader', 5000)
      return
    }
    setOpenTabSessions((prev) => {
      const missing = plan.watched.filter((entry) => !prev.some((tab) => sessionKey(tab) === entry.sessionKey))
      return missing.length ? [...prev, ...missing.map((entry) => entry.session)] : prev
    })
    setSplitPinnedKeys(plan.pins)
    // Set directly rather than through applySplitPaneCount, which projects the
    // layout from this render's tab list — one that does not hold these tabs yet.
    if (plan.count !== splitPaneCount) {
      setSplitPaneCount(plan.count)
      void writeTuiSplitPanes(plan.count).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to store split view setting')
      })
    }
    // Say what will actually be on screen: a narrow terminal drops panes
    // before it squeezes the reader, and "watching" a teammate with no pane
    // would be a claim the frame does not back.
    const stacked = splitOrientation === 'rows'
    const visible = calculateSplitPaneLayout({
      availableExtent: stacked ? Math.max(mainContentHeight - 2, 8) : readerAreaWidth,
      requestedCount: plan.count,
      availableCount: plan.count,
      maxPanes: SPLIT_PANE_MAX,
      minPaneExtent: stacked ? SPLIT_PANE_MIN_ROWS : SPLIT_PANE_MIN_WIDTH,
      minReaderExtent: stacked ? MIN_READER_ROWS : MIN_READER_WIDTH,
      readerShare: splitReaderShare,
    }).visibleCount
    const shown = plan.watched.slice(0, Math.max(visible, 0))
    const hidden = plan.watched.length - shown.length + plan.skipped
    showNotice('info', shown.length
      ? `Watching ${shown.map((entry) => entry.name).join(', ')}${hidden > 0 ? ` · ${hidden} more need${hidden === 1 ? 's' : ''} room (${stacked ? 'taller terminal' : '⌃B " to stack'} or ←/→ tabs)` : ''} · ⌃B x close`
      : `Opened ${plan.watched.map((entry) => entry.name).join(', ')} as tabs · no room for a pane (${stacked ? 'taller terminal' : '⌃B " to stack'})`, 5000)
  })

  const handleCoordContentChange = useStableEvent(() => {
    setCoordDraft(coordTextareaRef.current?.plainText ?? '')
    if (coordError) setCoordError(null)
  })

  const submitCoordinatedRun = useStableEvent(async () => {
    // The textarea is the source of truth — onContentChange can lag onSubmit.
    const prompt = (coordTextareaRef.current?.plainText ?? coordDraft).trim()
    const selectedPlaybook = coordPlaybookName
      ? coordPlaybooks.find((entry) => entry.name === coordPlaybookName)
      : null
    const playbookArgsText = coordPlaybookArgsDraft.trim()
    if ((!prompt && !selectedPlaybook) || (selectedPlaybook?.expectsArgs && !playbookArgsText) || coordStartInFlightRef.current) return
    let playbookArgs: unknown = undefined
    if (playbookArgsText) {
      try { playbookArgs = JSON.parse(playbookArgsText) } catch { playbookArgs = playbookArgsText }
    }
    coordStartInFlightRef.current = true
    setCoordBusy(true)
    setCoordError(null)
    try {
      const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
      const targetProvider = coordProviderOverride ?? suggestedProvider
      const teammateProviders = coordTeammateProviderOverride ?? [targetProvider]
      const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
      const result = await startTuiProtocolRun({
        prompt,
        baseCwd,
        playbookName: selectedPlaybook?.name,
        playbookArgs,
        provider: targetProvider,
        teammateProviders,
        maxAgents: coordMaxAgents,
        title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
        model: tuiModelOverride[selectedSessionKey ?? ''] || undefined,
        effort: tuiEffort === 'auto' ? undefined : tuiEffort,
        gateCommand: coordGateDraft.trim() || undefined,
        requirePlanApproval: coordRequirePlanApproval,
        autonomy: coordAutonomy,
        requireReview: coordRequireReview,
        acceptanceContract: {
          goal: prompt || selectedPlaybook?.name || 'Complete the coordinated workflow',
          userVisibleAcceptance: parseCoordContractLines(coordAcceptanceDraft),
          nonGoals: parseCoordContractLines(coordNonGoalsDraft),
          verificationCommands: [coordGateDraft.trim()].filter(Boolean),
          manualQa: parseCoordContractLines(coordManualQaDraft),
          escalationTriggers: parseCoordContractLines(coordEscalationDraft),
        },
        budget: coordMaxTokens.trim() || coordMaxDurationMinutes.trim() ? {
          maxTokens: coordMaxTokens.trim() ? Number(coordMaxTokens) : undefined,
          maxDurationMinutes: coordMaxDurationMinutes.trim() ? Number(coordMaxDurationMinutes) : undefined,
        } : undefined,
        useWorktrees: coordUseWorktrees,
      })
      const drafts: Session[] = result.sessions.map((session) => ({
        sessionId: session.sessionId,
        provider: session.provider,
        cwd: session.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: session.summary,
        isPending: session.isPending,
      }))
      setOpenTabSessions((prev) => {
        const seen = new Set(prev.map((tab) => sessionKey(tab)))
        const next = [...prev]
        for (const draft of drafts) {
          if (!seen.has(sessionKey(draft))) next.push(draft)
        }
        return next
      })
      const first = drafts[0]
      if (first) setSelectedSessionKey(sessionKey(first))
      setCoordModalOpen(false)
      setCoordBoardRunId(result.snapshot.run.id)
      // The run is started either way; only its view may be off.
      if (isPluginEnabled('coordination')) setPluginOverlay('coordination')
      else showNotice('info', 'Run started · the control center is off (Plugins, ⌃K palette)')
      setCoordDraft('')
      setCoordAcceptanceDraft('')
      setCoordNonGoalsDraft('')
      setCoordManualQaDraft('')
      setCoordEscalationDraft('')
      setCoordPlaybookName(null)
      setCoordPlaybookArgsDraft('')
      setCoordGateDraft('')
      setCoordMaxTokens('')
      setCoordMaxDurationMinutes('')
      setCoordProviderOverride(null)
      setCoordTeammateProviderOverride(null)
      setCoordProviderPoolIndex(0)
      setCoordModalFocus('prompt')
      // Watch the run in the background: the engineer gets notified on
      // completion or newly blocked teammates even with the board closed.
      coordWatchStateRef.current.set(result.snapshot.run.id, {
        status: result.snapshot.run.status,
        blockedAgents: new Set(),
      })
      setCoordWatchIds((prev) => [...prev, result.snapshot.run.id])
      await refreshSessions(provider, true, false)
      showNotice(
        'info',
        selectedPlaybook
          ? `Playbook ${selectedPlaybook.name} started — task board seeded without a planning turn`
          : 'Coordinated run started — lead is planning the task board',
        5000,
      )
    } catch (err) {
      setCoordError(err instanceof Error ? err.message : 'Failed to start coordinated run')
      showNotice('error', err instanceof Error ? err.message : 'Failed to start coordinated run')
    } finally {
      coordStartInFlightRef.current = false
      setCoordBusy(false)
    }
  })

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
  useEffect(() => {
    const onFocus = () => { terminalFocusedRef.current = true }
    const onBlur = () => { terminalFocusedRef.current = false }
    renderer.on('focus', onFocus)
    renderer.on('blur', onBlur)
    const unsubscribe = subscribeInteractiveCoordinatorNotifications(({ session, signal, viewing }) => {
      // Herdr's delivery setting: read at delivery, so a change applies at once.
      const delivery = coordinatorAlertDelivery(getInteractiveCoordinatorNotifications(), viewing, terminalFocusedRef.current)
      if (delivery.notice) showNotice('info', `Teammates · ${signal.title} — ⌃K t in ${session.title}`, 6000)
      if (delivery.desktop) notifyTeamEvent(signal.kind === 'finished' ? 'teammate finished' : 'teammate needs attention', `${signal.title}: ${signal.detail}`.slice(0, 160))
    })
    return () => {
      unsubscribe()
      renderer.off('focus', onFocus)
      renderer.off('blur', onBlur)
    }
  }, [renderer])

  // Watch active runs started this session: notify on terminal status and on
  // newly blocked teammates, then drop finished runs from the watch list.
  useEffect(() => {
    if (coordWatchIds.length === 0) return
    let cancelled = false
    const tick = async () => {
      for (const runId of coordWatchIds) {
        const snapshot = await readTuiProtocolRun(runId).catch(() => null)
        if (cancelled) return
        const watch = coordWatchStateRef.current.get(runId)
        if (!snapshot || !watch) {
          coordWatchStateRef.current.delete(runId)
          setCoordWatchIds((prev) => keepFiltered(prev, (id) => id !== runId))
          continue
        }
        for (const agent of snapshot.agents) {
          if (agent.status === 'blocked' && !watch.blockedAgents.has(agent.id)) {
            watch.blockedAgents.add(agent.id)
            showNotice('info', `Team: ${agent.name} is blocked${agent.taskId ? ` on ${agent.taskId}` : ''} — ⌃K a to intervene`, 6000)
            notifyTeamEvent('teammate blocked', `${agent.name} is blocked${agent.taskId ? ` on ${agent.taskId}` : ''}`)
          }
        }
        const status = snapshot.run.status
        if (status !== watch.status) {
          watch.status = status
          if (status === 'completed' || status === 'failed' || status === 'stopped') {
            const headline = snapshot.run.summary?.split('\n')[0] ?? ''
            showNotice(status === 'completed' ? 'info' : 'error', `Team run ${status}${headline ? `: ${headline}` : ''} — ⌃K a for the board`, 8000)
            notifyTeamEvent(`team run ${status}`, headline || snapshot.run.prompt.slice(0, 80))
            coordWatchStateRef.current.delete(runId)
            setCoordWatchIds((prev) => keepFiltered(prev, (id) => id !== runId))
          }
        }
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [coordWatchIds])

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

  const commitRename = useStableEvent(async () => {
    if (!renameSessionKey || !selectedSession) return
    const trimmed = renameDraftRef.current.trim()
    setRenameSessionKey(null)
    setRenameDraft('')
    renameDraftRef.current = ''
    if (!trimmed) return
    setSessions((prev) => prev.map((session) => (
      sessionKey(session) === renameSessionKey
        ? { ...session, customTitle: trimmed, summary: trimmed }
        : session
    )))
    setOpenTabSessions((prev) => prev.map((session) => (
      sessionKey(session) === renameSessionKey
        ? { ...session, customTitle: trimmed, summary: trimmed }
        : session
    )))
    setSessionDetail((prev) => (
      prev && selectedSession && sessionKey(selectedSession) === renameSessionKey && prev.info
        ? {
            ...prev,
            info: {
              ...prev.info,
              customTitle: trimmed,
              summary: trimmed,
            },
          }
        : prev
    ))
    const cachedDetail = sessionDetailCacheRef.current.get(renameSessionKey)
    if (cachedDetail?.info) {
      touchMapEntry(sessionDetailCacheRef.current, renameSessionKey, {
        ...cachedDetail,
        info: {
          ...cachedDetail.info,
          customTitle: trimmed,
          summary: trimmed,
        },
      })
    }
    try {
      await patchTuiSession(selectedSession, { title: trimmed })
      void refreshSessions(provider, true, false)
    } catch {
      // rename failed silently — session list will show original title on next poll
    }
  })

  // Build the sidebar row elements once per relevant-state change instead of
  // on every App render. The per-row formatting (fitText/timeAgo/joinMeta/
  // formatSessionTitle/getProviderAccent) is O(sessions) and previously re-ran
  // on every 2s poll, keystroke, and live-stream RAF flush; a stable element
  // array also lets OpenTUI's reconciler bail on the whole subtree when nothing
  // here changed. `timeAgo` output refreshes whenever sidebarEntries does (the
  // 5s sessions poll produces a new array), which is frequent enough.
  const firstSidebarEntryKey = sidebarEntries[0]?.key ?? null
  const buildSidebarRow = useCallback((entry: typeof sidebarEntries[number], selected: boolean) => {
    if (entry.type === 'project') {
      const countLabel = `${entry.count}`
      const projectLabel = fitText(entry.projectName, Math.max(sidebarInnerWidth - countLabel.length - 5, 1)).trimEnd()
      return (
        <box
          key={entry.key}
          id={`sidebar:${entry.key}`}
          paddingX={1}
          // A blank row separates groups; the first has the rail's own title
          // above it and nothing to be separated from.
          marginTop={entry.key === firstSidebarEntryKey ? 0 : 1}
          backgroundColor={theme.surface}
        >
          <text fg={theme.dim} wrapMode="none">
            {fitText(`${projectLabel} / ${countLabel}`, sidebarInnerWidth - 2)}
          </text>
        </box>
      )
    }

    if (entry.type === 'subagent') {
      const subagentEntry = entry.entry
      const accent = getProviderAccent(
        subagentEntry.kind === 'session'
          ? (subagentEntry.session.provider ?? 'claude')
          : (subagentEntry.summary.provider ?? entry.parentSession.provider ?? 'claude'),
      )
      const label = subagentEntry.kind === 'session'
        ? formatSessionTitle(subagentEntry.session) || subagentEntry.session.sessionId.slice(-8)
        : (subagentEntry.summary.taskDescription?.trim() || subagentEntry.summary.agentId.slice(-8))
      const summaryTokens = subagentEntry.kind === 'summary'
        ? subagentEntry.summary.usage.totalTokens
          ?? (subagentEntry.summary.usage.inputTokens + subagentEntry.summary.usage.outputTokens)
        : 0
      const detail = subagentEntry.kind === 'session'
        ? (() => {
            const activity = sidebarSessionActivity.get(sessionKey(subagentEntry.session))
            const marker = activity === 'needs-input' ? '⚠'
              : activity === 'running' ? '●'
              : activity === 'waiting' ? '◌'
              : isSessionRecentlyTouched(subagentEntry.session) ? '·'
              : null
            return joinMeta([
              showProviderInSessionRows ? sessionProviderLabel(subagentEntry.session) : null,
              `${timeAgo(subagentEntry.session.lastModified ?? subagentEntry.session.createdAt)}${marker ? ` ${marker}` : ''}`,
            ])
          })()
        : joinMeta([
            showProviderInSessionRows
              ? formatProviderLabel(subagentEntry.summary.provider ?? entry.parentSession.provider)
              : null,
            `${subagentEntry.summary.messageCount} msgs`,
            summaryTokens > 0 ? `${fmtTokens(summaryTokens)} tokens` : null,
          ])
      return (
        <box
          key={entry.key}
          id={`sidebar:${entry.key}`}
          flexDirection="column"
          paddingLeft={Math.min(entry.depth + 1, 5)}
          backgroundColor={selected ? theme.surface3 : theme.surface}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            if (subagentEntry.kind === 'session') selectSidebarSession(subagentEntry.session)
            else {
              setSidebarSubagentCursor(entry.key)
              setSubagentTranscriptSelection({ parent: entry.parentSession, agent: subagentEntry.summary })
              setPluginOverlay('subagents')
            }
          }}
        >
          <text fg={selected ? accent : theme.muted} wrapMode="none">
            {fitText(`${selected ? '▎' : ' '} ${'↪'.repeat(Math.min(entry.depth, 3))} ${label}`, sidebarInnerWidth - 2)}
          </text>
          {detail && (
            <text fg={selected ? accent : theme.muted} wrapMode="none">
              {fitText(`${selected ? '▎' : ' '}   ${detail}`, sidebarInnerWidth - 2)}
            </text>
          )}
        </box>
      )
    }

    const sessionAccent = getProviderAccent(entry.session.provider ?? 'claude')
    const activityTime = entry.session.lastModified ?? entry.session.createdAt
    const recentlyTouched = isSessionRecentlyTouched(entry.session)
    const knownActivity = sidebarSessionActivity.get(sessionKey(entry.session))
    // Written to in the last couple of minutes by something this host is not
    // running — a native CLI in another terminal. Shown as working, in green
    // rather than the provider accent, so the two sources stay tellable apart.
    const activity = knownActivity ?? (recentlyWrittenKeys.has(sessionKey(entry.session)) ? 'active' : undefined)
    const ago = activity === 'running' ? 'now' : timeAgo(activityTime)
    const activityGlyph = activity === 'needs-input' ? '⚠'
      : activity === 'running' || activity === 'active' ? '●'
      : activity === 'waiting' ? '◌'
      : recentlyTouched ? '·'
      : null
    const activityColor = activity === 'needs-input' ? theme.amber
      : activity === 'running' ? sessionAccent
      : activity === 'active' ? theme.green
      : activity === 'waiting' ? theme.cyan
      : theme.dim
    // The selected row is tinted with its provider's accent across the full
    // rail width; surface3 alone sits too close to the rail's own surface in
    // most themes to find at a glance.
    const selectedRowBg = mixHexColor(sessionAccent, theme.surface, 0.22) ?? theme.surface3
    const rowBg = selected ? selectedRowBg : theme.surface

    const metaLine = joinMeta([
      activity === 'needs-input' ? 'Needs input'
        : activity === 'running' || activity === 'active' ? 'Working'
        : activity === 'waiting' ? 'Waiting' : null,
      showProviderInSessionRows ? sessionProviderLabel(entry.session) : null,
      ago,
    ])
    // Waiting outranks a result, as on the web row: a question blocks a
    // teammate, a result only waits to be read.
    const team = teamAttention.get(sessionKey(entry.session))
    const teamMark = team ? (team.waiting > 0 ? ` !${team.waiting}` : ` ✓${team.finished}`) : ''
    // Only the comfortable density spends a second row on the age. Otherwise it
    // rides the title's row, right-aligned, and the activity glyph stands in
    // for the word — twice the sessions in the same rail.
    const singleRow = density !== 'comfortable' && sessionKey(entry.session) !== renameSessionKey
    const rowMeta = joinMeta([
      showProviderInSessionRows ? sessionProviderLabel(entry.session) : null,
      ago,
    ])
    // "Recently touched" is the age itself on this row; only a turn's state
    // earns a glyph. Marks sit before the age so the ages stay one flush column.
    const settled = Boolean(entry.session.inbox?.settledAt)
    const rowGlyph = activity ? activityGlyph : settled ? '✓' : null
    const subagentDisclosureWidth = (childrenByParentId.get(sessionKey(entry.session))?.length ?? 0) > 0 ? 2 : 0
    const rowTitleWidth = Math.max(
      sidebarInnerWidth - 3 - subagentDisclosureWidth - (rowMeta ? rowMeta.length + 1 : 0) - teamMark.length - (rowGlyph ? 2 : 0),
      4,
    )

    return (
      <box
        key={entry.key}
        id={`sidebar:${entry.key}`}
        flexDirection="column"
        backgroundColor={rowBg}
        marginBottom={density === 'comfortable' ? 1 : 0}
        // Its text is not selectable: a press on selectable text starts a text
        // selection, which takes the drag away from the row.
        // Selects on release, not press: a press that moves is a drag onto the
        // window area, and selecting on press would put the session in the
        // reader before it could be dropped beside it.
        onMouseDown={(event) => {
          if (event.button === 2) {
            event.stopPropagation()
            splitPaneActions.sessionMenu(entry.session, 'rail', event)
            return
          }
          if (event.button !== 0) return
          event.stopPropagation()
          if (sessionKey(entry.session) === renameSessionKey) return
          sessionDragHandlers.press(entry.session, null, event, () => selectSidebarSession(entry.session))
        }}
        onMouseDrag={(event) => sessionDragHandlers.move(event)}
        onMouseUp={(event) => {
          if (event.button !== 0) return
          sessionDragHandlers.release(event)
        }}
      >
        {sessionKey(entry.session) === renameSessionKey ? (
          <box paddingX={1} backgroundColor={theme.surface3}>
            <input
              focused
              value={renameDraft}
              maxLength={80}
              onInput={(v: string) => setRenameDraft(v)}
              onSubmit={commitRename}
            />
          </box>
        ) : (
          <box paddingX={1} flexDirection="row" backgroundColor={rowBg}>
            <text fg={sessionAccent} wrapMode="none" selectable={false}>{selected ? '▎' : ' '}</text>
            {(childrenByParentId.get(sessionKey(entry.session))?.length ?? 0) > 0 ? <text
              id={`sidebar-subagents-toggle:${sessionKey(entry.session)}`} fg={sessionAccent} selectable={false}
              onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); toggleSidebarSubagents(entry.session) } }}
            >{collapsedSubagentSet.has(sessionKey(entry.session)) ? '▸ ' : '▾ '}</text> : null}
            {/* Keep the title readable; provider identity belongs to the rail. */}
            <text fg={settled && !activity ? theme.muted : theme.text} attributes={selected ? TextAttributes.BOLD : undefined} wrapMode="none" selectable={false}>
              {fitText(formatSessionTitle(entry.session), singleRow ? rowTitleWidth : sidebarInnerWidth - 3 - subagentDisclosureWidth)}
            </text>
            {singleRow ? (
              <>
                {teamMark ? <text fg={team!.waiting > 0 ? theme.amber : theme.green} wrapMode="none" selectable={false}>{teamMark}</text> : null}
                {rowGlyph ? <text fg={activity ? activityColor : theme.green} wrapMode="none" selectable={false}>{` ${rowGlyph}`}</text> : null}
                {rowMeta ? <text fg={activity === 'needs-input' ? theme.amber : theme.dim} wrapMode="none" selectable={false}>{` ${rowMeta}`}</text> : null}
              </>
            ) : null}
          </box>
        )}
        {singleRow ? null : (
        <box paddingX={1} flexDirection="row" backgroundColor={rowBg}>
          <text fg={sessionAccent} wrapMode="none" selectable={false}>{selected ? '▎' : ' '}</text>
          <text fg={activity === 'needs-input' ? theme.amber : theme.dim} wrapMode="none" selectable={false}>
            {fitText(metaLine, sidebarInnerWidth - 3 - (activityGlyph ? 2 : 0) - teamMark.length)}
          </text>
          {teamMark ? <text fg={team!.waiting > 0 ? theme.amber : theme.green} wrapMode="none" selectable={false}>{teamMark}</text> : null}
          {activityGlyph ? <text fg={activityColor} wrapMode="none" selectable={false}>{` ${activityGlyph}`}</text> : null}
        </box>
        )}
      </box>
    )
  }, [collapsedSubagentSet, childrenByParentId, toggleSidebarSubagents, theme, density, sidebarInnerWidth, firstSidebarEntryKey, renameSessionKey, renameDraft, commitRename, selectSidebarSession, showProviderInSessionRows, sidebarSessionActivity, recentlyWrittenKeys, teamAttention, sessionDragHandlers, splitPaneActions])


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
  const sendComposerMessage = useStableEvent(async function sendForSession(
    draftOverride?: string,
    attachmentsOverride?: SendAttachment[],
    isRetry?: boolean,
    promptPartsOverride?: ComposerPromptPart[],
    retryTurnRequestId?: string,
  ): Promise<void> {
    const isCurrentTarget = () => Boolean(composerTargetSessionRef.current && composerTargetSession && composerSessions.same(sessionKey(composerTargetSessionRef.current), sessionKey(composerTargetSession)))
    const project = <Args extends unknown[]>(action: (...args: Args) => void) => (...args: Args) => { if (isCurrentTarget()) action(...args) }
    const setComposerDraft = project(composerViewActions.setComposerDraft)
    const setComposerMentionAttachments = project(composerViewActions.setComposerMentionAttachments)
    const setComposerPromptParts = project(composerViewActions.setComposerPromptParts)
    const setComposerMention = project(composerViewActions.setComposerMention)
    const setComposerMentionResults = project(composerViewActions.setComposerMentionResults)
    const setComposerMentionDismissedStart = project(composerViewActions.setComposerMentionDismissedStart)
    const setComposerSlashIndex = project(composerViewActions.setComposerSlashIndex)
    const setComposerSlashDismissed = project(composerViewActions.setComposerSlashDismissed)
    const setComposerHistoryIndex = project(composerViewActions.setComposerHistoryIndex)
    const setComposerHistoryOpen = project(composerViewActions.setComposerHistoryOpen)
    const setDraftBeforeHistory = project(composerViewActions.setDraftBeforeHistory)
    const setFollowTail = project(composerViewActions.setFollowTail)
    const setPendingNewCount = project(composerViewActions.setPendingNewCount)
    const setUnreadBoundaryKey = project(composerViewActions.setUnreadBoundaryKey)
    const setHistoryIndex = project(composerViewActions.setHistoryIndex)
    const setPermissionOptionIndex = project(composerViewActions.setPermissionOptionIndex)
    const setContextUsage = project(composerViewActions.setContextUsage)
    const setSessionDetail = project(composerViewActions.setSessionDetail)
    const setTuiCopilotMode = project(composerViewActions.setTuiCopilotMode)
    const composerTextareaRef = { get current() { return isCurrentTarget() ? composerViewRefs.textarea.current : null } }
    const composerDraftStorageKeyRef = { current: composerViewRefs.storage.current }
    const scopedRef = <T,>(source: { current: T }) => {
      let saved = source.current
      return { get current() { return isCurrentTarget() ? source.current : saved }, set current(value: T) { saved = value; if (isCurrentTarget()) source.current = value } }
    }
    const composerMentionAttachmentsRef = scopedRef(composerViewRefs.attachments)
    const composerPromptPartsRef = scopedRef(composerViewRefs.parts)
    // Notices raised while a turn streams can land after the user has moved to
    // another session; name the session they are about so they are not misread.
    const showTurnNotice = (tone: NoticeTone, text: string, durationMs?: number) => {
      const target = composerTargetSession
      showNotice(tone, target && !isCurrentTarget() ? `${formatSessionTitle(target)}: ${text}` : text, durationMs)
    }
    const visibleText = draftOverride ?? composerDraft
    const submission = attachmentsOverride
      ? {
          visibleText,
          messageText: visibleText.trim(),
          attachments: attachmentsOverride,
          promptParts: promptPartsOverride ?? [],
        }
      : prepareComposerSubmission(visibleText, composerMentionAttachments, composerPromptParts)
    const trimmed = submission.messageText
    if (!trimmed && submission.attachments.length === 0) return
    if (!composerTargetSession) {
      // A pane-aimed composer refuses rather than retargeting, so this is the
      // one case where the send is deliberately blocked and must say why —
      // an unexplained dead Enter key is worse than the message it replaces.
      if (composerPaneTargetKey) {
        showNotice('error', 'That split pane\'s session is gone — press esc and reopen the composer to retarget')
      }
      return
    }
    const submissionTargetKey = sessionKey(composerTargetSession)
    if (!isRetry && !isComposerTargetReady({
      preparingTargetKey: composerPreparingTargetKeyRef.current,
      targetSession: composerTargetSession,
      keyOf: sessionKey,
    })) {
      showNotice('info', 'Session is still loading — send will be available when it is ready')
      return
    }

    // Codex's /btw: an aside that waits for the running turn rather than
    // steering into it; with nothing running it is simply the next prompt.
    const btwAside = !isRetry && composerTargetSession.provider === 'codex'
      ? /^\/btw\s+(\S[\s\S]*)$/.exec(visibleText.trim())
      : null
    if (btwAside) {
      if (composerSendState === 'sending' || reattachedRunningRef.current) {
        composerTextareaRef.current?.setText('')
        composerTextareaRef.current?.extmarks.clear()
        setComposerDraft('')
        setComposerMentionAttachments(keepEmpty)
        setComposerPromptParts(keepEmpty)
        commitQueuedComposerSends([...queuedComposerSendsRef.current, {
          id: createComposerQueueItemId(submissionTargetKey),
          targetKey: submissionTargetKey,
          text: btwAside[1]!,
          attachments: submission.attachments,
          promptParts: submission.promptParts,
        }])
        return
      }
      return sendComposerMessage(btwAside[1]!)
    }

    const crossSessionCommand = !isRetry && submission.attachments.length === 0
      ? parseCrossSessionComposerCommand(trimmed)
      : null
    if (crossSessionCommand) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      try {
        if (crossSessionCommand.kind === 'list') {
          const targets = await listTuiAddressableSessions(composerTargetSession.sessionId)
          const summary = targets.length === 0
            ? 'No other running or recently active sessions are reachable'
            : targets.map((target) => `${target.name} (${target.provider}${target.running ? ', running' : ''})`).join(' · ')
          showNotice('info', summary, 12_000)
          return
        }
        if (!crossSessionCommand.target || !crossSessionCommand.text) {
          showNotice('error', 'Usage: /message <session-name> <message>')
          return
        }
        const fromName = composerTargetSession.customTitle?.trim()
          || composerTargetSession.summary?.trim()
          || `session-${composerTargetSession.sessionId.slice(0, 6)}`
        const result = await sendTuiCrossSessionMessage({
          fromSessionId: composerTargetSession.sessionId,
          fromName,
          toName: crossSessionCommand.target,
          text: crossSessionCommand.text,
        })
        if (!result.delivered) {
          showNotice('error', result.error || 'The cross-session message was not delivered')
          return
        }
        showNotice('info', result.mode === 'steered'
          ? `Delivered to ${result.targetName ?? crossSessionCommand.target}`
          : `Started a turn for ${result.targetName ?? crossSessionCommand.target}`)
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : 'Cross-session messaging failed')
      }
      return
    }

    if (!isRetry && submission.attachments.length === 0 && trimmed.startsWith('/') && runTuiLocalCommand(composerTargetSession, trimmed)) {
      composerTextareaRef.current?.setText('')
      composerTextareaRef.current?.extmarks.clear()
      setComposerDraft('')
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      return
    }

    // Global Channel Bridge binding: divert the send to the live `claude` CLI
    // session instead of the active provider. The durable outbox retains failed
    // sends for reconnect replay; replies and permission prompts surface in the
    // bridge popover (⇧C). Never diverts an auto-retry and requires actual text.
    if (!isRetry && canUseChannelBridge && selectedSessionTarget && routeComposerToBridgeRef.current && trimmed) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      try {
        const timestamp = new Date().toISOString()
        const config = readBridgeConfigFromEnv()
        const chatId = lastBridgeChatIdRef.current ?? createChannelBridgeMessageId()
        lastBridgeChatIdRef.current = chatId
        const result = await sendDurableChannelMessage(channelBridgeFileOutboxStorage, config, {
          targetSessionId: selectedSessionTarget.sessionId,
          text: trimmed,
          chatId,
        })
        lastBridgeChatIdRef.current = result.response?.chat_id ?? chatId
        setBridgeTranscriptEntries((prev) => [...prev, { kind: 'sent', text: trimmed, timestamp }])
        showNotice('info', result.queued
          ? 'Queued for the live CLI bridge to reconnect'
          : 'Accepted by the live CLI bridge')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to reach the channel bridge')
      }
      return
    }

    // Global IDE Bridge binding: push the composer line as an @file mention into
    // the connected `claude` session instead of sending a provider turn. Accepts
    // "path" or "path:start-end". Tool calls / diffs surface in the IDE popover (⇧I).
    if (!isRetry && canUseIdeBridge && routeComposerToIdeRef.current && trimmed) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      try {
        const match = trimmed.match(/^(.*?):(\d+)(?:-(\d+))?$/)
        const filePath = match ? match[1] : trimmed
        const lineStart = match ? Number(match[2]) : undefined
        const lineEnd = match ? (match[3] ? Number(match[3]) : lineStart) : undefined
        const result = await sendIdeAtMention(readIdeBridgeConfigFromEnv(), filePath, lineStart, lineEnd)
        showNotice(result.delivered ? 'info' : 'error', result.delivered ? 'Pushed @mention to the IDE session' : 'No `claude` session is connected to the IDE host yet')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to reach the IDE host')
      }
      return
    }

    const sendAttachments = submission.attachments
    // Native CLIs queue a follow-up prompt while the active turn streams.
    // Mirror that here: when sending, stash this draft and flush it after. A
    // reattached turn (running server-side, no owned stream) counts as sending
    // — starting a fresh turn now would run two concurrently. A transient
    // auto-retry bypasses the queue — the prior (failed) turn already settled,
    // composerSendState just hasn't been cleared yet across the backoff.
    if (!isRetry && (composerAbortRef.current !== null || composerRetryTimerRef.current !== null || reattachedRunningRef.current)) {
      composerTextareaRef.current?.setText('')
      setComposerDraft('')
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      composerTextareaRef.current?.extmarks.clear()
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      // Native steering first: deliver the message INTO the running turn the
      // way the provider's own CLI does (Claude Code, Codex, Copilot, Pi, and
      // opencode all accept typed input mid-turn). Attachments can't ride a
      // steer; and if
      // the turn ends while the request is in flight the backend reports
      // delivered:false — both fall back to the client-side queue, which
      // sends as a fresh turn on idle.
      // Slash commands and `!` shell input never steer: steering would inject
      // them as literal prompt text mid-turn, whereas the native CLIs queue
      // them and execute them natively once the turn ends — the queue below
      // flushes into the send path, which does exactly that.
      const steerTarget = composerTargetSession
      if (trimmed && sendAttachments.length === 0 && steerTarget && !isNativeComposerCommandText(trimmed)) {
        try {
          const result = await deliverComposerSteer(
            (payload) => runTuiSessionAction(steerTarget, payload),
            {
              message: trimmed,
              provider: steerTarget.provider,
              turnRequestId: activeComposerTurnRequestIdRef.current ?? undefined,
            },
          )
          if (result.delivered === true) {
            setSteeredSendNotice(trimmed)
            // Echo the steered message into the live transcript immediately —
            // it's part of the running turn now, exactly like typing in the
            // native CLI. The persisted reconcile replaces this echo when the
            // turn lands.
            steeredEchoCounterRef.current += 1
            const liveMessageUuid = `live-user-steer-${steeredEchoCounterRef.current}`
            if (typeof result.messageUuid === 'string') {
              steeredComposerSendsRef.current = [
                ...steeredComposerSendsRef.current,
                { text: trimmed, messageUuid: result.messageUuid, liveMessageUuid },
              ]
            }
            setLiveTranscriptMessages((prev) => [
              ...prev,
              makeLiveUserMessage(steerTarget, trimmed, liveMessageUuid),
            ])
            return
          }
        } catch {
          // Steering is best-effort; the queue below is the reliable path.
        }
      }
      commitQueuedComposerSends([...queuedComposerSendsRef.current, {
        id: createComposerQueueItemId(submissionTargetKey),
        targetKey: submissionTargetKey,
        text: submission.visibleText,
        attachments: sendAttachments,
        promptParts: submission.promptParts,
      }])
      return
    }

    if (!isRetry) composerRetryCountRef.current = 0
    composerTurnProducedOutputRef.current = false

    // Atomically consume the submitted snapshot before starting I/O. The user
    // can immediately compose a distinct follow-up while the provider works;
    // a second Enter can never accidentally queue the just-submitted prompt.
    if (!isRetry) {
      composerTextareaRef.current?.setText('')
      composerTextareaRef.current?.extmarks.clear()
      setComposerDraft('')
      if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, '')
      setComposerMention(null)
      setComposerMentionResults(keepEmpty)
      setComposerMentionDismissedStart(null)
      composerMentionAttachmentsRef.current = []
      composerPromptPartsRef.current = []
      setComposerMentionAttachments(keepEmpty)
      setComposerPromptParts(keepEmpty)
      setComposerSlashIndex(0)
      setComposerSlashDismissed(false)
    }

    const targetSession = composerTargetSession
    const controller = new AbortController()
    const sendStartedAt = Date.now()
    const sendPerfStartedAt = performance.now()
    // Stable across automatic transport retries so Codex queue/add can
    // de-duplicate a prompt whose acknowledgement was lost in transit.
    const turnRequestId = retryTurnRequestId
      ?? globalThis.crypto?.randomUUID?.()
      ?? `${sendStartedAt}-${Math.random().toString(36).slice(2)}`
    let resolveTurnCleanup: () => void = () => {}
    const turnCleanupPromise = new Promise<void>((resolve) => {
      resolveTurnCleanup = resolve
    })
    activeComposerSendCleanupRef.current = turnCleanupPromise
    composerAbortRef.current = controller
    activeComposerTurnRequestIdRef.current = turnRequestId
    setComposerSendState('sending')
    setSteeredSendNotice(null)
    steeredComposerSendsRef.current = []
    setComposerSendStartedAt(sendStartedAt)
    setComposerWaitingSeed(`${targetSession.provider ?? 'claude'}:${targetSession.sessionId}:${sendStartedAt}:${trimmed}`)
    setComposerError(null)
    flushLiveText() // flush any stale pending text
    pendingLiveTextRef.current = ''
    pendingLiveReasoningRef.current = ''
    liveTextTargetSessionRef.current = targetSession
    if (liveTextFlushTimerRef.current != null) {
      clearTimeout(liveTextFlushTimerRef.current)
      liveTextFlushTimerRef.current = null
    }
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setComposerThinkingTokens(0)
    setLivePromptSuggestion(null)
    setLiveStatus(null)
    setLiveSubagentText({})
    setLiveOutputTokens(0)
    setLiveToolActivities(keepEmpty)
    setPendingPermissions(previous => keepFiltered(previous, entry => entry.sessionId !== targetSession.sessionId || (entry.provider ?? 'claude') !== (targetSession.provider ?? 'claude')))
    setPermissionOptionIndex(0)
    const runningRef: RunningSessionRef = {
      sessionId: targetSession.sessionId,
      providerInstanceId: targetSession.providerInstanceId,
      provider: targetSession.provider ?? 'claude',
    }
    markSessionRunning(runningRef)
    const targetKey = sessionKey(targetSession)
    // This send loop owns the turn's stream — the registry poll must not treat
    // the session as reattached while the stream is alive.
    ownedTurnKeyRef.current = targetKey
    setComposerActivitySessionKey(targetKey)
    // A new (pending) session has no history. Nor is the displayed detail
    // this session's just because this session is selected: a pending session
    // never loads one, so it still holds whatever was viewed before — and a
    // baseline of that transcript's length made the new session's rows never
    // count as "after" it, holding every first turn in Syncing until the 12s
    // escape hatch (Codex, every time).
    const displayedDetailIsTarget = selectedSessionKeyRef.current === targetKey
      && (sessionDetail?.rawMessages ?? []).every((message) => !message.session_id || message.session_id === targetSession.sessionId)
    const baselineDetail = targetSession.isPending
      ? null
      : sessionDetailCacheRef.current.get(targetKey) ?? (displayedDetailIsTarget ? sessionDetail : null)
    const baselineSummary = summarizeDurableSessionMessages(baselineDetail?.rawMessages ?? [])
    liveTranscriptBaselineRef.current.set(targetKey, {
      ...baselineSummary,
      startedAt: sendStartedAt,
    })
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    setLiveTranscriptMessages((prev) => [
      ...prev.filter((message) => liveMessageSessionKey(message) !== targetKey),
      makeLiveUserMessage(targetSession, trimmed),
    ])
    setLocalCommandOutputs((prev) => {
      const next = prev.filter((message) => liveMessageSessionKey(message) !== targetKey)
      return next.length === prev.length ? prev : next
    })
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let replyAccumulator = ''
    let codexLiveMessageAccumulator = ''
    const claudeLiveTextByIndex = new Map<number, string>()
    const providerLiveTextByKey = new Map<string, string>()
    let copilotFinalMessageSeen = false
    let commandResultWithoutTranscript = false

    try {
      const overrideModel = tuiModelOverride[sessionKey(targetSession)]
      const res = await streamTuiSessionTurn(
        targetSession,
        {
          message: trimmed,
          provider: targetSession.provider,
          taskBudgetTokens: taskBudgetTokens ?? undefined,
          enableWorkflow: targetSession.provider === 'claude' && composerEnableWorkflow ? true : undefined,
          isPendingSession: targetSession.isPending === true ? true : undefined,
          cwd: targetSession.cwd ?? undefined,
          attachments: sendAttachments.length > 0 ? sendAttachments : undefined,
          model: overrideModel || undefined,
          agent: targetSession.provider === 'opencode' && tuiOpenCodeAgent
            ? tuiOpenCodeAgent
            : undefined,
          effort: tuiEffort === 'auto' ? undefined : tuiEffort,
          mode: targetSession.provider === 'copilot'
            ? tuiCopilotMode
            : undefined,
          contextTier: targetSession.provider === 'copilot' && composerCopilotContextTier !== 'default'
            ? composerCopilotContextTier
            : undefined,
          permissionMode: targetSession.provider === 'claude'
            ? composerPermissionMode
            : targetSession.provider === 'copilot'
              ? composerCopilotPermissionMode
              : undefined,
          additionalDirectories: targetSession.provider === 'claude'
            ? tuiAddedDirsByKeyRef.current[sessionKey(targetSession)]
            : undefined,
          collaborationMode: targetSession.provider === 'codex'
            ? tuiCodexModeByKeyRef.current[sessionKey(targetSession)]
            : undefined,
          approvalPolicy: targetSession.provider === 'codex' && composerCodexApproval !== 'auto'
            ? composerCodexApproval
            : undefined,
          // Claude/Copilot only emit interactive tool-approval prompts when the
          // client opts in. OpenCode/Codex surface them automatically.
          // bypass/plan handle all tool decisions via permissionMode — no bridge.
          manualPermissions: targetSession.provider === 'copilot'
            || (targetSession.provider === 'claude' && composerPermissionMode !== 'bypassPermissions' && composerPermissionMode !== 'plan')
            ? true : undefined,
          nativeCommands: targetSession.provider === 'copilot' ? true : undefined,
          detachOnClientAbort: true,
          turnRequestId,
        },
        controller.signal,
      )
      noteTuiComposerLatency(
        targetSession.provider ?? 'claude',
        'send-to-ack',
        performance.now() - sendPerfStartedAt,
      )

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let sseBuffer = ''
      let firstOutputRecorded = false
      const noteFirstOutput = () => {
        if (firstOutputRecorded) return
        firstOutputRecorded = true
        noteTuiComposerLatency(
          targetSession.provider ?? 'claude',
          'first-output',
          performance.now() - sendPerfStartedAt,
        )
      }

      const activeSubagentIdRef = { current: '' }

      const handleFrame = (frame: SseFrame) => {
        // Liveness pulse only — receiving it already reset the stall race.
        if (frame.event === 'heartbeat') return
        // Transport-only receipt consumed by cross-session senders.
        if (frame.event === 'turn-accepted') return
        let parsed: unknown = null
        try {
          parsed = JSON.parse(frame.data)
        } catch {
          parsed = null
        }
        if (frame.event === 'error') {
          const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
          const message = record?.error
          const apiErrorStatus = typeof record?.apiErrorStatus === 'number' ? record.apiErrorStatus : undefined
          const usageLimit = typeof record?.usageLimit === 'string' ? record.usageLimit as UsageLimitKind : undefined
          throw new TransientAwareSendError(typeof message === 'string' ? message : 'Unknown agent error', apiErrorStatus, usageLimit)
        }
        if (frame.event === 'context-usage' && parsed) {
          const usage = parsed as ContextUsage
          touchMapEntry(sessionContextUsageCacheRef.current, sessionKey(targetSession), usage)
          setContextUsage(usage)
          return
        }
        if (frame.event === 'turn-usage' && parsed && typeof parsed === 'object') {
          const outputTokens = (parsed as { outputTokens?: unknown }).outputTokens
          if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
            setLiveOutputTokens(Math.max(0, outputTokens))
          }
          return
        }
        // Non-fatal turn notice (e.g. an MCP elicitation prompt). Surface it as a
        // transient banner without disturbing the live turn state.
        if (frame.event === 'turn-notice' && parsed) {
          const message = (parsed as { message?: unknown }).message
          if (typeof message === 'string' && message.trim()) {
            noteFirstOutput()
            showTurnNotice('info', message.trim())
          }
          return
        }
        if (frame.event === 'session' && parsed) {
          const evt = parsed as { sessionId?: unknown }
          if (typeof evt.sessionId === 'string' && evt.sessionId && targetSession.isPending) {
            const realId = evt.sessionId
            const oldKey = sessionKey(targetSession)
            const updated: Session = { ...targetSession, sessionId: realId, isPending: false }
            const newKey = sessionKey(updated)
            const baseline = liveTranscriptBaselineRef.current.get(oldKey)
            if (baseline) {
              liveTranscriptBaselineRef.current.delete(oldKey)
              liveTranscriptBaselineRef.current.set(newKey, baseline)
            }
            composerSessions.rekey(oldKey, newKey)
            if (ownedTurnKeyRef.current === oldKey) ownedTurnKeyRef.current = newKey
            setComposerActivitySessionKey((current) => current === oldKey ? newKey : current)
            commitQueuedComposerSends(rekeyComposerQueueTarget(queuedComposerSendsRef.current, oldKey, newKey))
            setLiveTranscriptMessages((prev) => prev.map((message) =>
              liveMessageSessionKey(message) === oldKey
                ? { ...message, sessionId: realId }
                : message
            ))
            const currentPermissionModes = tuiPermissionModeByKeyRef.current
            const pendingMode = currentPermissionModes[oldKey]
            if (pendingMode) {
              const next = { ...currentPermissionModes }
              delete next[oldKey]
              next[newKey] = pendingMode
              tuiPermissionModeByKeyRef.current = next
              setTuiPermissionModeByKey(next)
            }
            setOpenTabSessions((prev) => prev.map((s) => sessionKey(s) === oldKey ? updated : s))
            setSessions((prev) => prev.map((s) => sessionKey(s) === oldKey ? { ...s, sessionId: realId, isPending: false } : s))
            setComposerPaneTargetKey(current => current === oldKey ? newKey : current)
            if (selectedSessionKeyRef.current === oldKey) setSelectedSessionKey(newKey)
          }
          return
        }
        // A `!command` finished: show its output now, in the shape the
        // persisted entries thread into, in place of the plain echo.
        if (frame.event === 'bash-output' && parsed && typeof parsed === 'object') {
          const bash = parsed as { command?: unknown; stdout?: unknown; stderr?: unknown }
          noteFirstOutput()
          composerTurnProducedOutputRef.current = true
          const bashMessage: ThreadedMessage = {
            role: 'user',
            uuid: `live-bash:${sendStartedAt}`,
            sessionId: targetSession.sessionId,
            providerInstanceId: targetSession.providerInstanceId,
            provider: targetSession.provider ?? 'claude',
            blocks: [
              { type: 'bash_input', command: typeof bash.command === 'string' ? bash.command : trimmed.slice(1).trim() },
              { type: 'bash_output', stdout: typeof bash.stdout === 'string' ? bash.stdout.trim() : '', stderr: typeof bash.stderr === 'string' ? bash.stderr.trim() : '' },
            ],
          }
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(
            prev.filter((message) => !(liveMessageSessionKey(message) === targetKey && message.uuid === 'live-user')),
            bashMessage,
          ))
          return
        }
        if (frame.event === 'opencode-todos' && Array.isArray(parsed)) {
          setComposerLiveTodos(parsed as import('../../lib/taskRegistry').OpenCodeTodo[])
          return
        }
        if (frame.event === 'command-result' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          noteFirstOutput()
          const result = parsed as {
            message?: unknown
            mode?: unknown
            transcriptExpected?: unknown
            openSession?: unknown
            prefillInput?: unknown
            openModelPicker?: unknown
            model?: unknown
          }
          // A native command may hand work back to the composer: text to edit
          // (Copilot's add-timeline-entry), its model picker, or a model it set.
          if (typeof result.prefillInput === 'string' && result.prefillInput) {
            const prefill = result.prefillInput
            setTimeout(() => {
              composerTextareaRef.current?.setText(prefill)
              setComposerDraft(prefill)
            }, 0)
          }
          if (result.openModelPicker === true) void openModelPicker()
          if (typeof result.model === 'string' && result.model) {
            const pickedModel = result.model
            setTuiModelOverride((prev) => ({ ...prev, [sessionKey(targetSession)]: pickedModel }))
          }
          const opening = result.openSession as { sessionId?: unknown; title?: unknown } | undefined
          if (opening && typeof opening.sessionId === 'string') {
            // Codex /agent: switch to a sub-agent's own thread.
            void openCreatedSession({
              ...targetSession,
              sessionId: opening.sessionId,
              summary: typeof opening.title === 'string' ? opening.title : 'Sub-agent',
              customTitle: undefined,
              isPending: false,
            })
          }
          if (!commandResultExpectsTranscript(result)) commandResultWithoutTranscript = true
          if (
            result.mode === 'interactive'
            || result.mode === 'plan'
            || result.mode === 'autopilot'
            || result.mode === 'shell'
          ) {
            setTuiCopilotMode(result.mode)
          }
          if (typeof result.message === 'string' && result.message.trim()) {
            const message = result.message.trim()
            if (message.includes('\n')) {
              // A listing (/skills, /hooks, /ps …) is output, not a notice: a
              // notice is one line, and the native CLIs print it in the transcript.
              setLocalCommandOutputs((prev) => upsertThreadedMessage(prev, {
                role: 'user',
                uuid: `live-command-result:${sendStartedAt}`,
                sessionId: targetSession.sessionId,
                providerInstanceId: targetSession.providerInstanceId,
                provider: targetSession.provider,
                timestamp: new Date().toISOString(),
                blocks: [{ type: 'local_command_stdout', stdout: message }],
              }))
            } else {
              showTurnNotice('info', message)
            }
          }
          return
        }
        if (!parsed) return
        const parsedRecord = parsed as Record<string, unknown>

        const pendingPermission = extractPendingPermission(parsed)
        if (pendingPermission) {
          noteFirstOutput()
          const codexQuestionMessage = codexQuestionLiveMessage(pendingPermission, targetSession)
          if (codexQuestionMessage) {
            composerTurnProducedOutputRef.current = true
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, codexQuestionMessage))
          }
          setPermissionOptionIndex(0)
          setPendingPermissions((prev) => [...prev.filter((entry) => entry.id !== pendingPermission.id), pendingPermission])
        }
        const repliedPermissionId = extractPermissionReply(parsed)
        if (repliedPermissionId) {
          setPendingPermissions((prev) => keepFiltered(prev, (entry) => entry.id !== repliedPermissionId))
        }

        if (parsedRecord.type === 'prompt_suggestion' && typeof parsedRecord.suggestion === 'string') {
          setLivePromptSuggestion(parsedRecord.suggestion)
        }
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'commands_changed') {
          const commands = normalizeSlashCommandSuggestions(parsedRecord.commands)
          if (commands) setComposerLiveSlashCommands(commands)
        }
        const commandLifecycle = parseClaudeCommandLifecycle(parsedRecord)
        if (commandLifecycle) {
          const { commandUuid, state } = commandLifecycle
          const tracked = steeredComposerSendsRef.current.find((entry) => entry.messageUuid === commandUuid)
          if (tracked) {
            if (state === 'cancelled' || state === 'discarded') {
              steeredComposerSendsRef.current = steeredComposerSendsRef.current.filter((entry) => entry.messageUuid !== commandUuid)
              setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => message.uuid !== tracked.liveMessageUuid))
            } else {
              steeredComposerSendsRef.current = steeredComposerSendsRef.current.map((entry) =>
                entry.messageUuid === commandUuid ? { ...entry, state } : entry)
            }
          }
        }
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'status') {
          const status = parsedRecord.status === 'requesting' || parsedRecord.status === 'compacting' ? parsedRecord.status : null
          setLiveStatus(status)
        }
        // The Claude SDK auto-retries transient API errors and emits an api_retry
        // system message per attempt. Surface it as the live "Retrying…" status
        // (same as Pi's native retry); it clears on the next delta/result.
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'api_retry') {
          setLiveStatus('retrying')
        }
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'thinking_tokens') {
          if (typeof parsedRecord.estimated_tokens === 'number') {
            setComposerThinkingTokens(parsedRecord.estimated_tokens)
          }
        }
        // A model refusal fell back to another model — evict the refused partial
        // from the live overlay so it doesn't linger (the banner arrives via the
        // normal threaded path).
        if (parsedRecord.type === 'system' && parsedRecord.subtype === 'model_refusal_fallback') {
          const uuids = Array.isArray(parsedRecord.retracted_message_uuids)
            ? parsedRecord.retracted_message_uuids.filter((u): u is string => typeof u === 'string')
            : []
          if (uuids.length > 0) {
            const retracted = new Set(uuids)
            setLiveTranscriptMessages((prev) => keepFiltered(prev, (m) => !retracted.has(m.uuid)))
          }
          setComposerLiveText('')
          setComposerLiveReasoning('')
        }
        // Pi surfaces auto-retry / auto-compaction as non-fatal progress so the
        // turn doesn't look hung while it recovers (mirrors native Pi).
        if (parsedRecord.type === 'pi_status') {
          if (parsedRecord.status === 'retry_start') setLiveStatus('retrying')
          else if (parsedRecord.status === 'compaction_start' || parsedRecord.status === 'summarization_retry_start') setLiveStatus('compacting')
          else if (parsedRecord.status === 'retry_end' || parsedRecord.status === 'compaction_end' || parsedRecord.status === 'summarization_retry_end') setLiveStatus(null)
          else if (parsedRecord.status === 'title_changed' && typeof parsedRecord.name === 'string') {
            const name = parsedRecord.name
            setSessionDetail((prev) => prev ? { ...prev, info: prev.info ? { ...prev.info, customTitle: name } : prev.info } : prev)
          }
        }
        if (parsedRecord.type === 'stream_event' && typeof parsedRecord.parent_tool_use_id === 'string' && parsedRecord.parent_tool_use_id) {
          const event = parsedRecord.event as Record<string, unknown> | undefined
          if (event?.type === 'content_block_delta') {
            const eventDelta = event.delta as Record<string, unknown> | undefined
            if (eventDelta?.type === 'text_delta' && typeof eventDelta.text === 'string') {
              const parentId = parsedRecord.parent_tool_use_id
              const deltaText = eventDelta.text
              setLiveSubagentText((prev) => ({ ...prev, [parentId]: (prev[parentId] ?? '') + deltaText }))
            }
          }
        }
        if (parsedRecord.type === 'user' && typeof parsedRecord.parent_tool_use_id === 'string' && parsedRecord.parent_tool_use_id) {
          const parentId = parsedRecord.parent_tool_use_id
          setLiveSubagentText((prev) => {
            if (!(parentId in prev)) return prev
            const { [parentId]: _, ...rest } = prev
            return rest
          })
        }

        const claudeToolUse = extractClaudeStreamToolUse(parsed)
        if (claudeToolUse) {
          noteFirstOutput()
          // A tool call is a side effect — never blind-retry past this point.
          composerTurnProducedOutputRef.current = true
          const startIndex = streamEventIndex(parsed, 'content_block_start')
          if (startIndex != null) {
            liveToolIndexesRef.current.set(startIndex, claudeToolUse.id)
            liveToolInputJsonRef.current.set(startIndex, '')
          }
          setLiveToolActivities((prev) => [...prev, { key: claudeToolUse.id, label: claudeToolUse.name, status: 'running' }])
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, {
            role: 'assistant',
            uuid: `live-tool:${claudeToolUse.id}`,
            sessionId: targetSession.sessionId,
            providerInstanceId: targetSession.providerInstanceId,
            provider: targetSession.provider ?? 'claude',
            blocks: [{
              type: 'tool_thread',
              toolUse: claudeToolUse,
              result: null,
            }],
          }))
        }

        const toolInputDelta = extractClaudeStreamToolInputDelta(parsed)
        if (toolInputDelta) {
          const toolKey = liveToolIndexesRef.current.get(toolInputDelta.index)
          if (toolKey) {
            const accumulated = `${liveToolInputJsonRef.current.get(toolInputDelta.index) ?? ''}${toolInputDelta.partialJson}`
            liveToolInputJsonRef.current.set(toolInputDelta.index, accumulated)
            const input = parseClaudeStreamToolInput(accumulated)
            if (input) {
              setLiveTranscriptMessages((prev) => updateLiveToolThreadInput(prev, toolKey, input))
            }
          }
        }

        const stopIndex = streamEventIndex(parsed, 'content_block_stop')
        if (stopIndex != null) {
          const toolKey = liveToolIndexesRef.current.get(stopIndex)
          if (toolKey) {
            const accumulated = liveToolInputJsonRef.current.get(stopIndex)
            const finalInput = accumulated ? parseClaudeStreamToolInput(accumulated) : null
            if (finalInput) {
              setLiveTranscriptMessages((prev) => updateLiveToolThreadInput(prev, toolKey, finalInput))
            }
            // content_block_stop only means the call finished streaming — the
            // tool itself runs after this, so the card stays running until its
            // tool_result arrives below.
          }
          liveToolInputJsonRef.current.delete(stopIndex)
          liveToolIndexesRef.current.delete(stopIndex)
        }

        // Real tool output for a live Claude card: fills in exit code, line
        // counts, diffs and errors while the turn is still running.
        const claudeToolResults = extractClaudeStreamToolResults(parsed)
        if (claudeToolResults.length > 0) {
          setLiveTranscriptMessages((prev) => claudeToolResults.reduce(applyLiveToolResult, prev))
          setLiveToolActivities((prev) => prev.map((activity) => claudeToolResults.some((r) => r.tool_use_id === activity.key)
            ? { ...activity, status: 'done' }
            : activity))
        }

        const openCodeToolThread = extractOpenCodeLiveToolThread(parsed, targetSession)
        if (openCodeToolThread) {
          noteFirstOutput()
          composerTurnProducedOutputRef.current = true
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, openCodeToolThread))
        }

        const openCodeSubagent = extractOpenCodeLiveSubagent(parsed)
        if (openCodeSubagent) {
          noteFirstOutput()
          activeSubagentIdRef.current = openCodeSubagent.agentId
          setLiveSubagentText((prev) => ({
            ...prev,
            [openCodeSubagent.agentId]: `Agent: ${openCodeSubagent.name}`,
          }))
          const label = openCodeSubagent.type === 'agent'
            ? `Running agent: ${openCodeSubagent.name}`
            : `Running subtask: ${openCodeSubagent.name}`
          const agentCard: ThreadedMessage = {
            role: 'assistant',
            uuid: `live-subagent:${openCodeSubagent.agentId}`,
            sessionId: targetSession.sessionId,
            providerInstanceId: targetSession.providerInstanceId,
            provider: targetSession.provider ?? 'opencode',
            blocks: [{ type: 'text', text: label }],
          }
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, agentCard))
        }

        if (targetSession.provider === 'codex') {
          const codexToolActivity = extractCodexLiveToolActivity(parsedRecord)
          if (codexToolActivity) {
            noteFirstOutput()
            composerTurnProducedOutputRef.current = true
            setLiveToolActivities((prev) => applyLiveToolActivity(prev, codexToolActivity))
          }
          setLiveTranscriptMessages((prev) => appendCodexLiveToolOutput(prev, parsedRecord, targetSession))
        }

        const codexCompletionItem = parsedRecord.type === 'codex_item_completed' && parsedRecord.item && typeof parsedRecord.item === 'object'
          ? parsedRecord.item as Record<string, unknown>
          : null
        const codexCompletionIsText = codexCompletionItem?.type === 'agentMessage' || codexCompletionItem?.type === 'plan'

        if (targetSession.provider === 'claude' && trimmed.startsWith('/') && parsedRecord.type === 'assistant') {
          const synthetic = parsedRecord.message as { model?: unknown; id?: unknown; content?: unknown } | undefined
          if (synthetic?.model === '<synthetic>' && Array.isArray(synthetic.content)) {
            const stdout = synthetic.content
              .map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' ? String((block as { text?: unknown }).text ?? '') : ''))
              .join('\n')
              .trim()
            if (stdout) {
              noteFirstOutput()
              const outputMessage: ThreadedMessage = {
                role: 'user',
                uuid: `live-local-command:${typeof synthetic.id === 'string' ? synthetic.id : sendStartedAt}`,
                sessionId: targetSession.sessionId,
                providerInstanceId: targetSession.providerInstanceId,
                provider: 'claude',
                timestamp: new Date().toISOString(),
                blocks: [{ type: 'local_command_stdout', stdout }],
              }
              setLocalCommandOutputs((prev) => upsertThreadedMessage(prev, outputMessage))
              // A local command runs no model turn and may persist nothing the
              // SDK returns, so waiting for persisted rows only ever ended at
              // the 12s escape hatch.
              commandResultWithoutTranscript = true
            }
          }
        }
        if (targetSession.provider === 'claude') {
          const threaded = normalizeClaudeStreamThreadedMessage(parsed)
          if (threaded) {
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(prev, { ...threaded, providerInstanceId: targetSession.providerInstanceId }))
          }
        } else if (targetSession.provider === 'codex') {
          const threaded = normalizeCodexStreamThreadedMessage(parsed, targetSession.sessionId)
          if (threaded || codexCompletionIsText) {
            setLiveTranscriptMessages((prev) => {
              const withoutStreamingText = codexCompletionIsText
                ? prev.filter((message) => message.uuid !== CODEX_LIVE_ASSISTANT_UUID)
                : prev
              return threaded
                ? upsertThreadedMessage(withoutStreamingText, { ...threaded, providerInstanceId: targetSession.providerInstanceId })
                : withoutStreamingText
            })
          }
          if (codexCompletionIsText) {
            pendingLiveTextRef.current = ''
            setComposerLiveText('')
          }
        } else if (targetSession.provider === 'copilot') {
          const threaded = extractCopilotFinalAssistantMessage(parsed, targetSession)
          if (threaded) {
            noteFirstOutput()
            copilotFinalMessageSeen = true
            const finalText = extractStreamingAssistantText(parsed)
            if (finalText) replyAccumulator = finalText
            pendingLiveTextRef.current = ''
            setComposerLiveText('')
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(
              prev.filter((message) => (
                liveMessageSessionKey(message) !== targetKey
                || !isLiveAssistantTextMessage(message)
              )),
              threaded,
            ))
            return
          }
        }

        if (targetSession.provider === 'codex' && codexCompletionIsText) {
          const finalText = extractStreamingAssistantText(parsed)
          if (finalText) replyAccumulator = finalText
          return
        }

        // Reasoning streams on its own channel; capture it before the answer
        // bail-out so a thinking-only frame still updates the dim preview.
        const reasoningDelta = extractStreamingReasoningText(parsed)
        if (reasoningDelta) {
          noteFirstOutput()
          setLiveStatus(null)
          pendingLiveReasoningRef.current = `${pendingLiveReasoningRef.current}${reasoningDelta}`
          liveTextTargetSessionRef.current = targetSession
          if (liveTextFlushTimerRef.current == null) {
            liveTextFlushTimerRef.current = setTimeout(flushLiveText, LIVE_TEXT_FLUSH_MS)
          }
        }

        const delta = extractStreamingAssistantText(parsed)
        if (!delta) return
        noteFirstOutput()
        // Committed assistant output — this turn must not be blind-retried.
        composerTurnProducedOutputRef.current = true
        setLiveStatus(null)

        // Route agent/subtask text to liveSubagentText so it appears as ↪ subagent: <text>
        // in the status footer, visually distinct from the main model's text.
        const agentId = activeSubagentIdRef.current
        if (targetSession.provider === 'opencode' && agentId) {
          const replace = shouldReplaceLiveAssistantText(parsed)
          setLiveSubagentText((prev) => ({
            ...prev,
            [agentId]: replace ? delta : (prev[agentId] ?? '') + delta,
          }))
          return
        }

        const replace = shouldReplaceLiveAssistantText(parsed)
        replyAccumulator = replace ? delta : `${replyAccumulator}${delta}`
        if (targetSession.provider === 'claude') {
          const textBlockIndex = streamEventIndex(parsed, 'content_block_delta')
          if (textBlockIndex != null) {
            const blockText = `${claudeLiveTextByIndex.get(textBlockIndex) ?? ''}${delta}`
            claudeLiveTextByIndex.set(textBlockIndex, blockText)
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(
              prev,
              makeLiveAssistantTextMessage(
                targetSession,
                blockText,
                `${CLAUDE_LIVE_ASSISTANT_UUID_PREFIX}${textBlockIndex}`,
              ),
            ))
          }
        } else if (targetSession.provider === 'codex') {
          const visibleText = extractCodexVisibleAssistantText(parsed)
          if (visibleText) {
            codexLiveMessageAccumulator = shouldReplaceCodexVisibleAssistantText(parsed)
              ? visibleText
              : `${codexLiveMessageAccumulator}${visibleText}`
            setLiveTranscriptMessages((prev) => upsertThreadedMessage(
              prev,
              makeLiveAssistantTextMessage(
                targetSession,
                codexLiveMessageAccumulator,
                CODEX_LIVE_ASSISTANT_UUID,
              ),
            ))
          }
        } else {
          const liveMessageKey = liveAssistantTextKey(parsedRecord, targetSession.provider)
          const liveMessageText = replace
            ? delta
            : `${providerLiveTextByKey.get(liveMessageKey) ?? ''}${delta}`
          providerLiveTextByKey.set(liveMessageKey, liveMessageText)
          setLiveTranscriptMessages((prev) => upsertThreadedMessage(
            prev,
            makeLiveAssistantTextMessage(targetSession, liveMessageText, liveMessageKey),
          ))
        }
        pendingLiveTextRef.current = replace ? delta : `${pendingLiveTextRef.current}${delta}`
        liveTextTargetSessionRef.current = targetSession
        // One flush path for every provider: coalesce through a render-loop-
        // independent timer (see LIVE_TEXT_FLUSH_MS — must NOT be
        // requestAnimationFrame). opencode used to flush synchronously here, but
        // that was only a workaround for the OpenTUI RAF freeze the timer now
        // solves generically — so the provider split is gone.
        if (liveTextFlushTimerRef.current == null) {
          liveTextFlushTimerRef.current = setTimeout(flushLiveText, LIVE_TEXT_FLUSH_MS)
        }
      }

      // Stall watchdog: only Claude emits server heartbeats, so only Claude can
      // be confidently judged dead-vs-slow. Race each read against a timeout; on
      // a stall, stop owning the stream and fall through to the completion path
      // (awaitingPersistedTurn + a detail refresh) so the still-running turn keeps
      // rendering from the persisted log instead of a frozen "sending" spinner.
      const stallGuard = targetSession.provider === 'claude'
      let streamStalled = false
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>
        if (stallGuard) {
          const readPromise = reader.read()
          readPromise.catch(() => {}) // abandoned on stall; swallow its rejection
          let stallTimer: ReturnType<typeof setTimeout> | undefined
          const stallPromise = new Promise<typeof STREAM_STALL_SENTINEL>((resolve) => {
            stallTimer = setTimeout(() => resolve(STREAM_STALL_SENTINEL), CLAUDE_STREAM_STALL_MS)
          })
          const raced = await Promise.race([readPromise, stallPromise])
          if (stallTimer) clearTimeout(stallTimer)
          if (raced === STREAM_STALL_SENTINEL) { streamStalled = true; break }
          readResult = raced
        } else {
          readResult = await reader.read()
        }
        const { done, value } = readResult
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const { frames, remaining } = extractSseFrames(sseBuffer)
        sseBuffer = remaining
        for (const frame of frames) {
          handleFrame(frame)
        }
      }

      if (streamStalled) {
        showTurnNotice('info', 'Live stream stalled — turn still running; syncing transcript.')
        // The turn is still running server-side, but `finally` clears this
        // loop's running mark and the registry poll only re-marks it on its
        // next tick — in between, a queued follow-up would flush as a second
        // concurrent turn. Hold the queue as for a reattached turn; the poll
        // takes over the flag from here.
        if (selectedSessionKeyRef.current === targetKey) {
          reattachedRunningKeyRef.current = targetKey
          reattachedRunningRef.current = true
          setReattachedRunning(true)
        }
      }

      if (sseBuffer.trim()) {
        const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
        for (const frame of frames) {
          handleFrame(frame)
        }
      }

      if (targetSession.provider === 'copilot' && !copilotFinalMessageSeen && replyAccumulator.trim()) {
        setLiveTranscriptMessages((prev) => upsertThreadedMessage(
          prev.filter((message) => (
            liveMessageSessionKey(message) !== targetKey
            || !isLiveAssistantTextMessage(message)
          )),
          makeLiveAssistantTextMessage(
            targetSession,
            replyAccumulator,
            `live-copilot:fallback:${sendStartedAt}`,
          ),
        ))
      }

      setSentHistory((prev) => [...prev, {
        text: submission.visibleText.trim(),
        attachments: sendAttachments,
        promptParts: submission.promptParts,
      }])
      appendComposerSentHistory(submission.visibleText)
      setHistoryIndex(-1)
      setDraftBeforeHistory({ text: '', attachments: [], promptParts: [] })
      setComposerHistoryOpen(false)
      setComposerHistoryIndex(0)
      setComposerSendState('idle')
      setInterruptPressActive(false)
      if (interruptPressTimeoutRef.current) {
        clearTimeout(interruptPressTimeoutRef.current)
        interruptPressTimeoutRef.current = null
      }
      setComposerError(null)
      if (commandResultWithoutTranscript) {
        liveTranscriptBaselineRef.current.delete(targetKey)
        setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        setAwaitingPersistedTurn(false)
      } else {
        setAwaitingPersistedTurn(true)
      }
      setFollowTail(true)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      void refreshSessions(provider, true, false)
      void refreshSelectedSessionDetail(targetSession, true)
      if (targetSession.provider === 'codex' && tuiCodexModeByKeyRef.current[targetKey] === 'plan') {
        // Codex asks "Implement this plan?" here; Plan mode never edits, so say
        // how to leave it rather than leave the user waiting on nothing.
        showTurnNotice('info', 'Plan mode · ⇧Tab to Default, then ask Codex to implement the plan', 10_000)
      }

      if (liveTextFlushTimerRef.current != null) {
        clearTimeout(liveTextFlushTimerRef.current)
        liveTextFlushTimerRef.current = null
      }
      pendingLiveTextRef.current = ''
      liveTextTargetSessionRef.current = null

      const elapsedMs = Date.now() - sendStartedAt
      if (elapsedMs >= NOTIFY_AFTER_MS) {
        const firstLine = replyAccumulator.split('\n').find((line) => line.trim().length > 0) ?? ''
        const preview = firstLine.length > NOTIFY_PREVIEW_CHARS
          ? `${firstLine.slice(0, NOTIFY_PREVIEW_CHARS - 1)}…`
          : firstLine || 'Reply ready'
        // Native OSC FFI: off on Windows, and only when the terminal advertises
        // notification support (capabilities is null when unknown — try anyway).
        // BMP-sanitize the model-generated preview/title before the boundary.
        if (NATIVE_OSC_ENABLED && renderer.capabilities?.notifications !== false) {
          try {
            renderer.triggerNotification(
              toBmpSafe(preview),
              toBmpSafe(`agent-viewer · ${formatSessionTitle(targetSession)}`),
            )
          } catch {
            // terminal doesn't support OSC notifications — silently ignore
          }
        }
      }
    } catch (err) {
      // An interrupt aborts this controller, but the provider's reaction (Claude
      // sends an error frame for the cut-off turn) can land before the abort
      // does. Whatever error follows our own abort is the interrupt, not a
      // failed turn — treating it as one restored the old prompt and reattached
      // to the dying turn, delaying the next prompt ~30s.
      if ((err instanceof Error && err.name === 'AbortError') || controller.signal.aborted) {
        // Confirmed interrupt: cancelComposerSend already moved us into the
        // awaitingPersistedTurn reconcile and wants the partial output kept.
        // Don't tear it down here — just clean up the live-text frame plumbing.
        if (composerInterruptPendingRef.current) {
          composerInterruptPendingRef.current = false
          liveToolIndexesRef.current.clear()
          liveToolInputJsonRef.current.clear()
          if (liveTextFlushTimerRef.current != null) {
            clearTimeout(liveTextFlushTimerRef.current)
            liveTextFlushTimerRef.current = null
          }
          pendingLiveTextRef.current = ''
          liveTextTargetSessionRef.current = null
          return
        }
        liveTranscriptBaselineRef.current.delete(targetKey)
        setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
        setAwaitingPersistedTurn(false)
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        if (liveTextFlushTimerRef.current != null) {
          clearTimeout(liveTextFlushTimerRef.current)
          liveTextFlushTimerRef.current = null
        }
        pendingLiveTextRef.current = ''
        liveTextTargetSessionRef.current = null
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      const apiErrorStatus = err instanceof TransientAwareSendError ? err.apiErrorStatus : undefined
      const usageLimitKind = err instanceof TransientAwareSendError ? err.usageLimitKind : undefined
      // Visible auto-retry: ride out a transient API/network blip when the turn
      // produced no output yet (mirrors the web composer + Pi's native retry).
      // Keep the turn 'sending' with a 'retrying' status across the backoff,
      // then re-fire the same draft. The finally below preserves liveStatus
      // while a retry timer is armed (see the guarded setLiveStatus there).
      if (isTransientSendError(errorMessage, apiErrorStatus, usageLimitKind)
        && !composerTurnProducedOutputRef.current
        && composerRetryCountRef.current < MAX_TRANSIENT_SEND_RETRIES) {
        composerRetryCountRef.current += 1
        const attempt = composerRetryCountRef.current
        const retryDraft = submission.visibleText
        const retryAttachments = sendAttachments
        setLiveStatus('retrying')
        setComposerLiveText('')
        setLiveToolActivities(keepEmpty)
        liveTranscriptBaselineRef.current.delete(targetKey)
        setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        if (composerRetryTimerRef.current) clearTimeout(composerRetryTimerRef.current)
        composerRetryTimerRef.current = setTimeout(() => {
          composerRetryTimerRef.current = null
          void sendForSession(retryDraft, retryAttachments, true, submission.promptParts, turnRequestId)
        }, transientRetryBackoffMs(attempt))
        return
      }
      // The stream died but the turn survived in the running registry — hand
      // off to the reattach poll instead of surfacing a send error (the web
      // composer's stall recovery, in-process). Keep the live echo + baseline:
      // the detail poll reconciles them once persisted rows land. Queued sends
      // stay armed; the queue flush is gated on reattachedRunning.
      // A pending session's turn registers under the id it was sent with, so
      // its first turn is probed like any other. An error the server sent as a
      // frame is the turn's own outcome, not a lost stream: the registry can
      // still list the turn for a moment while it tears down, and "reattaching"
      // there hid the reason (`Agent not found`) behind a turn that then
      // quietly produced nothing.
      let turnStillRunning = false
      if (!(err instanceof TransientAwareSendError)) {
        try {
          turnStillRunning = (await listTuiRunningSessions()).some((entry) =>
            entry.sessionId === targetSession.sessionId
            && entry.provider === (targetSession.provider ?? 'claude'))
        } catch { /* registry probe is best-effort */ }
      }
      if (turnStillRunning) {
        setComposerSendState('idle')
        setComposerError(null)
        setLiveStatus(null)
        setLiveToolActivities(keepEmpty)
        if (selectedSessionKeyRef.current === targetKey) {
          reattachedRunningKeyRef.current = targetKey
          reattachedRunningRef.current = true
          setReattachedRunning(true)
        }
        showTurnNotice('info', 'Send stream lost — reattached to the running turn', 3500)
        return
      }
      const failedDraft = submission.visibleText
      setComposerSendState('error')
      setComposerError(err instanceof Error ? err.message : 'Failed to send message')
      setComposerLiveText('')
      setLiveStatus(null)
      setLiveToolActivities(keepEmpty)
      setAwaitingPersistedTurn(false)
      // Don't auto-fire queued follow-ups after a failed turn. Rebuild one
      // editable snapshot from the failed send, every queued follow-up, and the
      // newest draft typed while the turn ran—attachments and prompt parts too.
      const failedQueue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
      commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      if (!isCurrentTarget()) {
        const key = sessionKey(targetSession)
        const restored = restoreComposerDraftPayload({ text: readWorkspaceDraft(key), attachments: [] }, failedQueue, { text: failedDraft, attachments: sendAttachments })
        writeWorkspaceDraft(key, restored.text)
        writeWorkspaceDraftParts(key, [...submission.promptParts, ...failedQueue.flatMap(entry => entry.promptParts), ...readWorkspaceDraftParts(key)])
        showNotice('error', `${formatSessionTitle(targetSession)}: ${errorMessage}`)
        return
      }
      const restoredPayload = restoreComposerDraftPayload(
        {
          text: composerTextareaRef.current?.plainText ?? '',
          attachments: composerMentionAttachmentsRef.current,
        },
        failedQueue,
        { text: failedDraft, attachments: sendAttachments },
      )
      const restoredParts = [
        ...submission.promptParts,
        ...failedQueue.flatMap((entry) => entry.promptParts),
        ...composerPromptPartsRef.current,
      ]
      const restoredDraft = restoredPayload.text
      composerTextareaRef.current?.setText(restoredDraft)
      setComposerDraft(restoredDraft)
      composerMentionAttachmentsRef.current = restoredPayload.attachments
      composerPromptPartsRef.current = restoredParts
      setComposerMentionAttachments(restoredPayload.attachments)
      setComposerPromptParts(restoredParts)
      restoreComposerPromptPartExtmarks(restoredParts, restoredDraft)
    } finally {
      void reader?.cancel().catch(() => {})
      composerAbortRef.current = null
      if (activeComposerTurnRequestIdRef.current === turnRequestId) {
        activeComposerTurnRequestIdRef.current = null
      }
      if (liveTextFlushTimerRef.current != null) {
        clearTimeout(liveTextFlushTimerRef.current)
        liveTextFlushTimerRef.current = null
      }
      pendingLiveTextRef.current = ''
      liveTextTargetSessionRef.current = null
      setComposerLiveText('')
      // Preserve the 'retrying' status while a transient-retry backoff is armed;
      // the catch above left composerSendState 'sending' so the badge shows.
      if (composerRetryTimerRef.current == null) setLiveStatus(null)
      setLiveSubagentText({})
      setLiveOutputTokens(0)
      setLiveToolActivities(keepEmpty)
      setComposerSendStartedAt(null)
      clearSessionRunning(runningRef)
      // Ownership is scoped to this session, including pending-id aliases.
      ownedTurnKeyRef.current = null
      if (activeComposerSendCleanupRef.current === turnCleanupPromise) {
        activeComposerSendCleanupRef.current = null
      }
      resolveTurnCleanup()
      if (composerSessions.get<SendState>(targetKey, 'composerSendState', 'idle') === 'idle' && !reattachedRunningRef.current && !exitInProgressRef.current) {
        const next = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)[0]
        if (next) {
          commitQueuedComposerSends(removeComposerQueueItem(queuedComposerSendsRef.current, next.id))
          queueMicrotask(() => { void sendForSession(next.text, next.attachments, false, next.promptParts) })
        }
      }
    }
  })

  // Flush queued prompt once the active turn lands (CLI-style queueing).
  // Gate on === 'idle' (not !== 'sending'): the prior turn can settle into
  // 'error', and auto-firing a queued follow-up after a failed turn is a
  // surprise-send. On error we clear the queue (see the error branch above),
  // so the only state that reaches here with a queued send is a clean idle.
  useEffect(() => {
    if (activeQueuedComposerSends.length === 0) return
    if (!runningRegistryReady) return
    if (composerSendState !== 'idle' || composerAbortRef.current || composerRetryTimerRef.current) return
    // A turn we reattached to is still running server-side — flushing now
    // would start a second concurrent turn. The registry poll clears the flag
    // when the turn ends.
    if (reattachedRunning || composerTargetTurnKnownRunning) return
    const next = activeQueuedComposerSends[0]!
    const remaining = removeComposerQueueItem(queuedComposerSendsRef.current, next.id)
    // Persist dequeue before provider I/O so a process crash cannot replay a
    // prompt that may already have reached a tool-capable agent.
    commitQueuedComposerSends(remaining)
    void sendComposerMessage(next.text, next.attachments, false, next.promptParts)
  }, [activeQueuedComposerSends, composerSendState, composerTargetTurnKnownRunning, reattachedRunning, runningRegistryReady, sendComposerMessage])

  // Reattach to turns this composer doesn't own a stream for. In-process the
  // running registry is a cheap synchronous read; remotely attached it's the
  // daemon's /api/sessions/running (same shape). Reconcile sidebar running
  // marks for every live session, flag the selected session as reattached
  // when its turn runs unowned, and re-surface any pending Claude prompts the
  // turn is blocked on (the stream that delivered them is gone after a stream
  // death; answering still resolves them server-side by id).
  type RunningRegistryEntry = Awaited<ReturnType<typeof listTuiRunningSessions>>[number]
  const registryPollInFlightRef = useRef(false)
  const runningRegistryByKeyRef = useRef(new Map<string, RunningRegistryEntry>())
  const reconcileSelectedRunningRegistry = useCallback((
    runningByKey: Map<string, RunningRegistryEntry>,
    ownedKey: string | null,
  ) => {
    const selectedKey = selectedSessionKeyRef.current
    const selectedEntry = selectedKey ? runningByKey.get(selectedKey) : undefined
    const reattached = Boolean(selectedEntry) && !ownsComposerStream(selectedKey!) && !awaitingPersistedTurnRef.current
    reattachedRunningKeyRef.current = reattached && selectedKey ? selectedKey : null
    setReattachedRunning((prev) => (prev === reattached ? prev : reattached))

    if (!selectedKey || ownsComposerStream(selectedKey)) return
    if (selectedEntry) {
      // While idle for this session, the registry is authoritative for every
      // provider's still-answerable approvals/questions, not only Claude's.
      const permissionPayloads = selectedEntry.pendingPermissions.length > 0
        ? selectedEntry.pendingPermissions
        : selectedEntry.pendingPrompts.map((data) => ({
            type: 'claude_permission',
            event: { type: 'permission.requested', data },
          }))
      const prompts = extractPendingPermissions(permissionPayloads, selectedEntry)
      setPendingPermissions((prev) => {
        const others = prev.filter((p) => !(p.provider === selectedEntry.provider && p.sessionId === selectedEntry.sessionId))
        const next = [...others, ...prompts]
        return next.map((p) => p.id).join('|') === prev.map((p) => p.id).join('|') ? prev : next
      })
    } else if (!selectedEntry) {
      // No turn running for the selected session — drop any reattached prompt
      // left behind by a turn that ended or timed out unanswered.
      const selectedSessionForKey = sessionsByKeyRef.current.get(selectedKey)
      if (selectedSessionForKey) {
        setPendingPermissions((prev) => {
          const selectedProvider = selectedSessionForKey.provider ?? 'claude'
          const next = prev.filter((p) => !(p.provider === selectedProvider && p.sessionId === selectedSessionForKey.sessionId))
          return next.length === prev.length ? prev : next
        })
      }
    }
  }, [])
  useEffect(() => {
    const poll = async () => {
      if (registryPollInFlightRef.current) return
      registryPollInFlightRef.current = true
      let activity: Awaited<ReturnType<typeof readTuiRuntimeActivity>>
      try {
        activity = await readTuiRuntimeActivity()
      } catch {
        return // registry probe is best-effort
      } finally {
        registryPollInFlightRef.current = false
      }
      const entries = activity.running
      setRunningRegistryReady(true)
      // Every poll reads fresh arrays, and storing one re-renders the whole
      // root — every ~1.5s for as long as the app is open, whether or not
      // anything changed. They are small; keep the previous array when equal.
      setWaitingSessions((prev) => (sameJson(prev, activity.waiting) ? prev : activity.waiting))
      setViewerAttentionNotes((prev) => (sameJson(prev, activity.attention) ? prev : activity.attention))
      const runningByKey = new Map(entries.map((entry) => [
        sessionKey(entry),
        entry,
      ]))
      runningRegistryByKeyRef.current = runningByKey
      const ownedKey = composerAbortRef.current ? ownedTurnKeyRef.current : null
      const waitingKeys = new Set(activity.waiting.map((entry) => sessionKey(entry)))

      // Sidebar liveness for turns nobody owns (started before a session
      // switch, or surviving a dead stream).
      for (const [key, entry] of runningByKey) {
        if (ownsComposerStream(key) || reattachMarksRef.current.has(key)) continue
        const ref: RunningSessionRef = { sessionId: entry.sessionId, provider: entry.provider, providerInstanceId: entry.providerInstanceId }
        reattachMarksRef.current.set(key, ref)
        markSessionRunning(ref)
      }
      for (const [key, ref] of reattachMarksRef.current) {
        if (runningByKey.has(key)) continue
        reattachMarksRef.current.delete(key)
        clearSessionRunning(ref)
        // An unowned turn just finished — surface it in the attention inbox
        // unless the user is already looking at that session.
        if (key !== selectedSessionKeyRef.current && !waitingKeys.has(key)) recordAttentionTurnDone(ref)
      }

      const selectedKey = selectedSessionKeyRef.current

      // Prompts blocking running turns on OTHER sessions feed the attention
      // inbox (the selected session's prompts reconcile into
      // pendingPermissions below). Notify once per prompt — these are exactly
      // the "an agent is waiting on you and you can't see it" moments.
      const background: PendingPermission[] = []
      for (const [key, entry] of runningByKey) {
        if (ownsComposerStream(key) || key === selectedKey) continue
        const permissionPayloads = entry.pendingPermissions.length > 0
          ? entry.pendingPermissions
          : entry.pendingPrompts.map((data) => ({
              type: 'claude_permission',
              event: { type: 'permission.requested', data },
            }))
        background.push(...extractPendingPermissions(permissionPayloads, entry))
      }
      setBackgroundPrompts((prev) => {
        const nextIds = background.map((p) => p.id).join('|')
        return nextIds === prev.map((p) => p.id).join('|') ? prev : background
      })
      const liveIds = new Set(background.map((p) => p.id))
      for (const id of attentionNotifiedRef.current) {
        if (!liveIds.has(id)) attentionNotifiedRef.current.delete(id)
      }
      for (const prompt of background) {
        if (attentionNotifiedRef.current.has(prompt.id)) continue
        attentionNotifiedRef.current.add(prompt.id)
        notifyAttention(prompt.title, prompt.sessionId ?? '', prompt.provider ?? 'claude')
      }

      reconcileSelectedRunningRegistry(runningByKey, ownedKey)
    }
    void poll()
    const timer = setInterval(() => { void poll() }, REATTACH_POLL_MS)
    return () => clearInterval(timer)
  }, [markSessionRunning, clearSessionRunning, reconcileSelectedRunningRegistry])

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

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [
          configuredTheme,
          configuredProvider,
          configuredRailVisible,
          configuredFocusMode,
          configuredDensity,
          configuredDiffLayout,
          configuredTranscriptView,
          configuredTranscriptWidth,
          configuredTabsEnabled,
          configuredTabOrientation,
          configuredSidebarSort,
          configuredHideScratch,
          configuredSidebarWidth,
          configuredShowToolCalls,
          configuredVelocityScroll,
          configuredSplitPanes,
          configuredSplitOrientation,
          configuredSplitReaderShare,
          configuredStickyHeaders,
          configuredThemeFollow,
          configuredLightweightWindows,
        ] = await Promise.all([
          readTuiTheme(),
          readTuiProvider(),
          readTuiRailVisible(),
          readTuiFocusMode(),
          readTuiDensity(),
          readTuiDiffLayout(),
          readTuiTranscriptView(),
          readTuiTranscriptWidth(),
          readTuiTabsEnabled(),
          readTuiTabOrientation(),
          readTuiSidebarSort(),
          readTuiHideScratchSessions(),
          readTuiSidebarWidth(),
          readTuiShowToolCalls(),
          readTuiVelocityScroll(),
          readTuiSplitPanes(),
          readTuiSplitOrientation(),
          readTuiSplitReaderShare(),
          readTuiStickyHeaders(),
          readTuiThemeFollow(),
          readTuiLightweightWindows(),
        ])
        if (cancelled) return
        // Attached to a daemon that may be older than this client: say so once,
        // rather than letting each feature fail with its own HTTP error.
        void readTuiDaemonWarning().then((warning) => {
          if (!cancelled && warning) showNotice('error', warning, 10000)
        }).catch(() => {})
        themeSlotsRef.current = {
          light: configuredThemeFollow.light ?? 'light',
          dark: configuredThemeFollow.dark ?? 'dark',
        }
        themeFollowsTerminalRef.current = configuredThemeFollow.follow
        setThemeFollowsTerminal(configuredThemeFollow.follow)
        // Until the terminal has answered, the stored theme is the last one it
        // was seen in, which beats a guess.
        const bootTheme = (configuredThemeFollow.follow && renderer.themeMode
          ? themeSlotsRef.current[renderer.themeMode]
          : null) ?? configuredTheme
        setThemeMode(bootTheme)
        setActiveTheme(bootTheme)
        // Restore the instance the list was narrowed to, if it is still offered.
        const instanceState = await readTuiProviderInstances().catch(() => ({ selected: null, choices: [] as TuiProviderInstanceChoice[] }))
        if (cancelled) return
        const configuredInstanceId = instanceState.choices.some((choice) => choice.provider === configuredProvider && choice.providerInstanceId === instanceState.selected)
          ? instanceState.selected
          : null
        const bootProvider = workspaceContext.runtime.restoredKeys.has('provider') ? provider : configuredProvider
        const bootInstance = workspaceContext.runtime.restoredKeys.has('providerInstanceId') ? providerInstanceId : configuredInstanceId
        providerInstanceIdRef.current = bootInstance
        setProviderInstanceId(bootInstance)
        setProviderInstances(instanceState.choices)
        setProvider(bootProvider)
        setRailVisible(configuredRailVisible)
        setFocusMode(configuredFocusMode)
        setStickyHeaders(configuredStickyHeaders)
        setLightweightWindows(configuredLightweightWindows)
        setDensity(configuredDensity)
        setDiffLayout(configuredDiffLayout)
        setTranscriptView(configuredTranscriptView)
        setTranscriptWidth(configuredTranscriptWidth)
        setTabsEnabled(configuredTabsEnabled)
        setTabOrientation(configuredTabOrientation)
        setSidebarSort(configuredSidebarSort)
        setHideScratch(configuredHideScratch)
        setSidebarWidthPreference(configuredSidebarWidth)
        setShowToolCalls(configuredShowToolCalls)
        setVelocityScrollEnabled(configuredVelocityScroll)
        if (workspaceContext.runtime.values.get('legacyInitialWorkspace') === true && !workspaceContext.runtime.restoredKeys.has('splitPaneCount')) {
          setSplitPaneCount(configuredSplitPanes)
          setSplitOrientation(configuredSplitOrientation)
          setSplitReaderShare(configuredSplitReaderShare)
        }
        if (!configuredRailVisible || configuredFocusMode) setFocusedPane('messages')
        await refreshSessions(bootProvider, true, true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to initialize OpenTUI')
        setLoadingSessions(false)
      } finally {
        if (!cancelled) setBootstrapped(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [refreshSessions])

  useEffect(() => {
    if (!bootstrapped) return
    if (!selectedSessionTarget || selectedSession?.isPending) {
      setSessionDetail(null)
      setLoadingDetail(false)
      setError((current) => current?.startsWith('Failed to load session detail') ? null : current)
      return
    }

    // Debounce the actual open so rapid scrubbing through the sidebar doesn't
    // load + reformat a transcript for every session passed through. The
    // cleanup clears the pending timer when the selection changes again, so
    // only the session we land on (and hold for the delay chosen below) renders.
    // The previously-shown transcript stays visible during the wait — no flash.
    const target = selectedSessionTarget
    const navStartedAt = performance.now()
    const targetKey = sessionKey(target)
    navSelectStartRef.current = { key: targetKey, at: navStartedAt }
    const targetLastModified = sessionTranscriptUpdatedAt(target, sessionsByKeyRef.current.get(targetKey))
    const shared = loader.peek(target, densityRef.current, showToolCallsRef.current)
    const recordedMtime = shared?.revision ?? sessionDetailMtimeRef.current.get(targetKey)
    // Mirrors refreshSelectedSessionDetail's cached-and-unchanged fast path: if
    // that branch will fire, this open does no work and deserves no wait.
    const opensFromCache = (Boolean(shared) || sessionDetailCacheRef.current.has(targetKey))
      && typeof targetLastModified === 'number'
      && recordedMtime != null
      && recordedMtime >= targetLastModified
      && !awaitingPersistedTurnRef.current
      && !liveTranscriptBaselineRef.current.has(targetKey)
    const timer = setTimeout(() => {
      noteTuiNavLatency('select-to-open', performance.now() - navStartedAt)
      // Display is owned by refreshSelectedSessionDetail's cache-first branch,
      // which is single-flight-gated: if a load is already running (still
      // scrubbing) it defers without rendering this session, so intermediates
      // never open. The previously-shown transcript stays put until we settle.
      void refreshSelectedSessionDetail(target, true)
    }, opensFromCache ? DETAIL_OPEN_CACHED_DELAY_MS : DETAIL_OPEN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [bootstrapped, loader, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

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
  useEffect(() => {
    if (!bootstrapped || !committedSessionKey) return undefined
    let cancelled = false
    const run = async () => {
      const sessionEntries = sidebarSessionEntriesRef.current
      const idx = sessionEntries.findIndex((session) => sessionKey(session) === committedSessionKey)
      if (idx < 0) return
      const neighbors: Session[] = []
      for (let distance = 1; distance <= NEIGHBOR_PREFETCH_RADIUS; distance++) {
        const below = sessionEntries[idx + distance]
        if (below && !below.isPending) neighbors.push(below)
        const above = sessionEntries[idx - distance]
        if (above && !above.isPending) neighbors.push(above)
      }
      for (const neighbor of neighbors) {
        if (cancelled) return
        // Yield to real work: an open in flight (or queued), or the user has
        // already scrubbed off the settled session.
        if (foregroundLoadInFlightRef.current || pendingForegroundLoadRef.current) return
        if (selectedSessionKeyRef.current !== committedSessionKey) return
        await prefetchSessionDetail(neighbor)
      }
    }
    const timer = setTimeout(() => { void run() }, NEIGHBOR_PREFETCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [bootstrapped, committedSessionKey, prefetchSessionDetail])

  // Clear stale live todos on session switch
  useEffect(() => {
    setComposerLiveTodos((current) => current.length === 0 ? current : [])
  }, [selectedSessionIdentity])

  // Drafts follow the effective send target, not merely the primary reader.
  // A pane-targeted composer must never inherit or clear another session's
  // draft just because that session remains selected behind the overlay.
  useEffect(() => {
    if (!composerTargetSessionIdentity) return
    const key = composerTargetSessionIdentity
    const previousKey = composerDraftStorageKeyRef.current
    if (previousKey && previousKey !== key) {
      const outgoingDraft = composerTextareaRef.current?.plainText ?? composerDraftRef.current
      writeWorkspaceDraft(previousKey, outgoingDraft)
      writeWorkspaceDraftParts(previousKey, composerPromptPartsRef.current)
      // Attachments are not persisted, so clear them rather than leaking them
      // into a different session's composer.
      setComposerMentionAttachments(keepEmpty)
      composerTextareaRef.current?.extmarks.clear()
    }
    composerDraftStorageKeyRef.current = key
    const saved = readWorkspaceDraft(key)
    // The content behind the draft's placeholders, restored with it: text
    // alone brought back "[Pasted ~200 lines]" with nothing behind it.
    const savedParts = (readWorkspaceDraftParts(key) as ComposerPromptPart[])
      .filter((part) => part && typeof part.marker === 'string' && saved.includes(part.marker))
    composerPromptPartsRef.current = savedParts
    setComposerPromptParts((current) => current.length === 0 && savedParts.length === 0 ? current : savedParts)
    if (saved !== composerDraftRef.current) {
      composerDraftRef.current = saved
      setComposerDraft(saved)
      composerTextareaRef.current?.setText(saved)
    }
    if (savedParts.length > 0) restoreComposerPromptPartExtmarks(savedParts, saved)
  }, [composerTargetSessionIdentity])

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

  useEffect(() => {
    if (!bootstrapped || !selectedSessionTarget || selectedSession?.isPending) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      // Skip background polls during active typing/searching — the poll's
      // startTransition can interleave with input handling and cause stutter.
      // The next tick after the user stops typing picks up any new content
      // (and a focused refresh on entering search-mode already fires).
      if (composerActiveRef.current && composerDraftRef.current.length > 0) return
      if (searchModeRef.current || sessionSearchModeRef.current) return
      void refreshSelectedSessionDetail(selectedSessionTarget, false)
    }, DETAIL_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, refreshSelectedSessionDetail, selectedSession?.isPending, selectedSessionIdentity, selectedSessionTarget])

  useEffect(() => {
    if (!bootstrapped || !tabsEnabled || openTabSessions.length === 0) return undefined
    let active = true
    const interval = setInterval(() => {
      if (!active || providerSwitchRef.current) return
      const selectedKey = selectedSessionKeyRef.current
      const backgroundTabs = openTabSessionsRef.current.filter((tab) => sessionKey(tab) !== selectedKey)
      if (backgroundTabs.length === 0) return
      const cursor = backgroundMetadataCursorRef.current % backgroundTabs.length
      backgroundMetadataCursorRef.current = (backgroundMetadataCursorRef.current + 1) % backgroundTabs.length
      const target = backgroundTabs[cursor]
      if (!target) return
      // Context usage metadata is disabled for open tabs.
      // void refreshSessionMetadata(target, false)
    }, CLAUDE_BACKGROUND_METADATA_REFRESH_MS)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [bootstrapped, openTabSessions.length, refreshSessionMetadata, tabsEnabled])


  useEffect(() => {
    let cancelled = false
    const saved = committedSessionKey ? tabReaderPositionsRef.current.get(committedSessionKey) : undefined

    setTranscriptCursorKey(saved?.state.cursorKey ?? null)
    setExpandedCardKeys((current) => sameKeys(current, saved?.state.expandedKeys) ? current : new Set(saved?.state.expandedKeys))
    setCollapsedCardKeys((current) => sameKeys(current, saved?.state.collapsedKeys) ? current : new Set(saved?.state.collapsedKeys))
    setFollowTail(saved?.state.followTail ?? true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    setResumeMarkerKey(null)
    setSearchMode(false)
    setScrollbackExpanded(saved?.scrollbackExpanded ?? false)
    setSearchQuery(saved?.searchQuery ?? '')
    setSearchMatchIndex(saved?.searchMatchIndex ?? 0)
    setRestoredReaderState({
      sessionKey: committedSessionKey,
      loaded: saved !== undefined || committedSessionKey == null,
      state: saved?.state ?? null,
    })

    if (saved) {
      return () => { cancelled = true }
    }

    if (!committedSessionKey) {
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      try {
        const state = await readTuiSessionReaderState(workspaceStorageKey(workspaceId, committedSessionKey))
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: committedSessionKey,
          loaded: true,
          state,
        })
        if (state) {
          setExpandedCardKeys((current) => sameKeys(current, state.expandedKeys) ? current : new Set(state.expandedKeys))
          setCollapsedCardKeys((current) => sameKeys(current, state.collapsedKeys) ? current : new Set(state.collapsedKeys))
          if (state.followTail === false) {
            setTranscriptCursorKey(state.cursorKey)
            setFollowTail(false)
            setResumeMarkerKey(state.cursorKey)
          }
        }
      } catch {
        if (cancelled) return
        setRestoredReaderState({
          sessionKey: committedSessionKey,
          loaded: true,
          state: null,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [committedSessionKey])

  useEffect(() => {
    // Skip building the `allowed` Set when both sets are empty — the common
    // case on a freshly loaded session — otherwise every poll rebuilds an
    // O(n) Set from the transcript for nothing. We also build the allowed
    // Set at most once and share it between both state updates.
    const allowed = new Set(transcriptCards.map((card) => card.key))
    setExpandedCardKeys((current) => {
      if (current.size === 0) return current
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
    setCollapsedCardKeys((current) => {
      if (current.size === 0) return current
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (allowed.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
  }, [transcriptCards])

  useEffect(() => {
    const currentLength = transcriptCards.length
    const currentLastKey = transcriptCards.at(-1)?.key ?? null
    const previous = previousTranscriptRef.current
    const sameSession = previous.sessionKey === committedSessionKey

    if (currentLength === 0) {
      setTranscriptCursorKey(null)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: committedSessionKey, length: 0, lastKey: null }
      return
    }

    if (!sameSession) {
      if (restoredReaderState.sessionKey !== committedSessionKey || !restoredReaderState.loaded) return
      const restoredState = restoredReaderState.state
      if (restoredState?.followTail === false) {
        const restoredIndex = restoredState.cursorKey ? (transcriptIndexByKey.get(restoredState.cursorKey) ?? -1) : -1
        const targetIndex = restoredIndex >= 0 ? restoredIndex : 0
        setTranscriptCursorKey(visibleTranscriptCards[targetIndex]?.key ?? visibleTranscriptCards[0].key)
        setFollowTail(false)
        setPendingNewCount(0)
        setUnreadBoundaryKey(null)
        setResumeMarkerKey(restoredState.cursorKey)
      } else {
        setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    setComposerLiveTodos(keepEmpty)
    setFollowTail(true)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
        setResumeMarkerKey(null)
      }
      previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
      return
    }

    if (followTail) {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
      return
    }

    // Detached readers need append accounting, but do not allocate a second
    // full key array. The scan is limited to this paused-reader path; the
    // common tail-following live stream above remains O(1).
    const previousLastIndex = previous.lastKey
      ? transcriptCards.findIndex((card) => card.key === previous.lastKey)
      : -1
    const appendedCount = previousLastIndex >= 0
      ? currentLength - previousLastIndex - 1
      : 0

    if (appendedCount > 0) {
      setPendingNewCount(appendedCount)
      setUnreadBoundaryKey((current) => {
        if (current && transcriptCards.some((card) => card.key === current)) return current
        return transcriptCards[previousLastIndex + 1]?.key ?? null
      })
    }

    setTranscriptCursorKey((current) => {
      if (current && transcriptCards.some((card) => card.key === current)) return current
      return visibleTranscriptCards[Math.max(readCursorIndex(), 0)]?.key ?? visibleTranscriptCards[0].key
    })
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
    // cursorIndex is intentionally omitted from deps: the effect reconciles
    // cursor/pending state when transcriptCards changes, and the cursorIndex
    // fallback only fires when the current cursor key is missing from the new
    // card list. Re-running on every j/k keystroke would do O(n) indexOf +
    // includes work over the full transcript for a no-op setter result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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
  const persistReaderState = useStableEvent(() => {
    if (readerStateWriteTimeoutRef.current) {
      clearTimeout(readerStateWriteTimeoutRef.current)
      readerStateWriteTimeoutRef.current = null
    }
    if (!selectedSessionKey || !restoredReaderState.loaded || restoredReaderState.sessionKey !== selectedSessionKey) {
      return
    }
    const transcriptCursorKey = readTranscriptCursorKey()

    const persistSignature = [
      selectedSessionKey,
      followTail ? 'follow' : 'free',
      transcriptCursorKey ?? '',
      expandedKeysRevisionRef.current,
      collapsedKeysRevisionRef.current,
    ].join('|')
    if (readerStatePersistSignatureRef.current === persistSignature) return

    // Build the persist payload inside the debounce timer so the O(n) work
    // over transcriptCards + expanded/collapsed keys only runs once per pause
    // — not on every j/k keystroke. This was a visible hitch on large
    // sessions when rapidly navigating the cursor on Windows.
    readerStateWriteTimeoutRef.current = setTimeout(() => {
      const validKeys = new Set(transcriptCards.map((card) => card.key))
      const persistState: TuiSessionReaderState = {
        followTail,
        cursorKey: followTail ? null : (transcriptCursorKey && validKeys.has(transcriptCursorKey) ? transcriptCursorKey : null),
        topKey: null,
        expandedKeys: [...expandedCardKeys].filter((key) => validKeys.has(key)),
        collapsedKeys: [...collapsedCardKeys].filter((key) => validKeys.has(key)),
      }
      readerStatePersistSignatureRef.current = persistSignature
      void writeTuiSessionReaderState(workspaceStorageKey(workspaceId, selectedSessionKey), persistState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to store reader position')
      })
    }, 150)
  })
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


  useEffect(() => {
    if (
      composerPreferredTargetKey !== null
      && (
        selectedSessionKey !== composerPreferredTargetKey
        || (
          !composerActive
          && composerPreparingTargetKey !== composerPreferredTargetKey
          && !newSessionModalOpen
          && !worktreeModalOpen
        )
      )
    ) {
      setComposerPreferredTargetKey(null)
    }
  }, [composerActive, composerPreferredTargetKey, composerPreparingTargetKey, newSessionModalOpen, selectedSessionKey, worktreeModalOpen])

  // Reconcile window pins against the open tabs:
  //   · a pin whose tab was closed is dropped (the previewed session excepted)
  //   · short lists fill from the remaining tabs in tab order
  useEffect(() => {
    if (splitPaneCount === 0) {
      setSplitPinnedKeys((current) => (current.length === 0 ? current : []))
      return
    }
    setSplitPinnedKeys((current) => {
      const parked = parkedWindowKeysRef.current
      const candidateKeys = openTabSessions.map((tab) => sessionKey(tab)).filter((tabKey) => !parked.has(tabKey))
      // A previewed session is a window before it is a tab.
      const next = [...new Set(current)].filter((pinnedKey) => candidateKeys.includes(pinnedKey) || pinnedKey === selectedSessionKey)
      for (const candidateKey of candidateKeys) {
        if (next.length >= splitPaneCount) break
        if (!next.includes(candidateKey)) next.push(candidateKey)
      }
      const trimmed = next.slice(0, splitPaneCount)
      const unchanged = trimmed.length === current.length
        && trimmed.every((pinnedKey, i) => pinnedKey === current[i])
      return unchanged ? current : trimmed
    })
  }, [openTabSessions, selectedSessionKey, splitPaneCount])

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
  useEffect(() => {
    if (sessions.length === 0) return
    setOpenTabSessions((current) => {
      let changed = false
      const next = current.map((tab) => {
        const fresh = sessions.find((s) => sessionKey(s) === sessionKey(tab))
        if (fresh && fresh !== tab) {
          changed = true
          return fresh
        }
        return tab
      })
      return changed ? next : current
    })
  }, [sessions])

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
  useEffect(() => {
    const instance = tabSelectRef.current
    if (!instance) return undefined
    if (runningTabKeys.size === 0) {
      // Nothing is running: hand back exactly what React rendered, or the last
      // frame drawn stays frozen on a tab that has finished.
      instance.setOptions(tabOptions)
      return undefined
    }
    let frame = 0
    const paint = () => {
      const target = tabSelectRef.current
      if (!target) return
      target.setOptions(tabOptions.map((option) => (
        option.value != null && runningTabKeys.has(option.value as string)
          ? { ...option, name: tabStripActivity(option.name, tabWidth, TAB_SPINNER_FRAMES[frame % TAB_SPINNER_FRAMES.length]) }
          : option
      )))
    }
    paint()
    const id = setInterval(() => {
      frame += 1
      paint()
    }, TAB_SPINNER_INTERVAL_MS)
    return () => clearInterval(id)
  }, [runningTabKeys, tabOptions, showHorizontalTabs, tabWidth])

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

  // Status bar: grouped keybindings rendered as colored inline segments —
  // keys pop in the accent color, labels stay muted, groups split by a dim
  // divider so the bar scans at a glance instead of reading as one dim wall.
  const footerSegments = useMemo<InlineTextSegment[]>(() => {
    // ⇧⏎ newline / ⌃O expand are already advertised by the composer's own hint
    // row directly above this bar — repeating them here just duplicated text.
    const groups: Array<Array<[string, string]>> = composerActive
      ? [[['Esc', 'transcript'], ...(composerKeysTargetTurn
          ? [['⌃C', 'cancel'], ['↵', 'queue']] as Array<[string, string]>
          : [['↵', 'send']] as Array<[string, string]>)]]
      : [
          // Only what changes with the focused pane and view; the fixed keys
          // (v, f, h, ⇧W, tabs, y, z) are in `?` and the ⌃K palette. Discovery
          // comes first so it survives even the narrowest terminal.
          [['⌃K', 'commands'], ['?', 'help']],
          // The rail's own keys, in groups the bar drops whole from the end
          // when narrow — the least-reached last.
          ...(effectiveFocus === 'sessions'
            ? sidebarView === 'coordinator'
              ? [[['j/k', 'select'], ['↵', 'open'], ['tab', 'focus']], [['a', 'sessions']]] as Array<Array<[string, string]>>
              : [
                  [['j/k', 'select'], ['↵', 'open'], ['x', 'settle'], ['tab', 'focus']],
                  [['/', 'search'], ['⌃R', 'rename']],
                  [['⇧S', 'sort'], ['⇧Y', 'scratch'], ['a', 'agents']],
                  [['[/]', 'width']],
                ] as Array<Array<[string, string]>>
            : isScrollbackView
              ? [[['j/k', 'scroll'], ['e', scrollbackExpanded ? 'fold all' : 'expand all'], ['c', 'compose'], ['tab', 'focus']]] as Array<Array<[string, string]>>
              : [[['j/k', 'move'], ['e', 'fold'], ['c', 'compose'], ['tab', 'focus']]] as Array<Array<[string, string]>>),
        ]
    const segs: InlineTextSegment[] = []
    // A pending prefix takes over the bar: the chord is modal, so the only keys
    // that matter right now are its own.
    if (commandChordPending) {
      return [
        { text: COMMAND_CHORD_MAP.prefix, fg: theme.amber },
        { text: `  ${chordHintText(COMMAND_CHORD_MAP)}`, fg: theme.muted },
      ]
    }
    if (splitChordPending) {
      return [
        { text: SPLIT_CHORD_MAP.prefix, fg: theme.amber },
        { text: `  ${chordHintText(SPLIT_CHORD_MAP)}`, fg: theme.muted },
      ]
    }
    // Attention badge leads the bar whenever an agent is blocked on a human —
    // it must be visible regardless of which pane or mode has focus.
    if (attentionNeedsInputCount > 0) {
      segs.push({ text: `⚠ ${attentionNeedsInputCount}`, fg: theme.amber })
      segs.push({ text: ' ! inbox · ⌃N next', fg: theme.muted })
    }
    // Only include complete hints. A clipped key legend is both noisy and
    // misleading; the command palette retains the full shortcut registry.
    const hostLabel = ATTACHED_DAEMON_HOST
      ? fitText(`⇌ ${ATTACHED_DAEMON_HOST}`, Math.max(Math.floor(width / 4), 8)).trimEnd()
      : ''
    // In the dock border the bar shares its row with the dock's stats, which
    // keep at least FOOTER_DOCK_STATS_RESERVE columns.
    const budget = statusBarInDock ? Math.max(composerDockTextareaWidth - footerDockStatsReserve(composerDockTextareaWidth), 18) : width - 2
    let remaining = Math.max(budget - segs.reduce((n, segment) => n + segment.text.length, 0)
      - (hostLabel ? hostLabel.length + 3 : 0), 0)
    // Groups are in priority order: the first that does not fit ends the bar,
    // so a small late group never shows while a more useful one was dropped.
    let full = false
    groups.forEach((group) => {
      if (full) return
      const text = group.map(([key, label]) => `${key} ${label}`).join('  ')
      const separator = segs.length > 0 ? ' │ ' : ''
      if (text.length + separator.length > remaining) {
        full = true
        return
      }
      if (separator) segs.push({ text: separator, fg: theme.dim })
      group.forEach((binding, bi) => {
        if (bi > 0) segs.push({ text: '  ', fg: theme.dim })
        segs.push({ text: binding[0], fg: theme.text })
        segs.push({ text: ` ${binding[1]}`, fg: theme.muted })
      })
      remaining -= text.length + separator.length
    })
    if (hostLabel) {
      segs.push({ text: ' │ ', fg: theme.dim })
      segs.push({ text: hostLabel, fg: theme.cyan })
    }
    return segs
  }, [width, attentionNeedsInputCount, commandChordPending, composerActive, composerDockTextareaWidth, composerKeysTargetTurn, isScrollbackView, scrollbackExpanded, splitChordPending, splitFocusIndex, statusBarInDock, effectiveFocus, sidebarView, theme])

  const composerStatusMessage = visibleComposerError
    ? visibleComposerError
    : activeQueuedComposerSends.length > 0 && !composerQueueDurable
      ? 'Queue persistence failed · keep this TUI open or edit the message back into the composer.'
    // Embedded composers show this in the compact row above the draft.
    : visibleAwaitingPersistedTurn && !embeddedComposer
      ? 'Syncing transcript…'
      : activeQueuedComposerSends.length > 0 && turnRunningForComposer
        ? (activeQueuedComposerSends.length === 1
          ? `Queued · sends after current turn: "${activeQueuedComposerSends[0]!.text.slice(0, 60)}${activeQueuedComposerSends[0]!.text.length > 60 ? '…' : ''}"`
          : `${activeQueuedComposerSends.length} queued · send in order after current turn`)
        : steeredSendNotice && turnRunningForComposer
          ? `Steered · delivered to the running turn: "${steeredSendNotice.slice(0, 60)}${steeredSendNotice.length > 60 ? '…' : ''}"`
          : visibleComposerSending
          // "Using N tools" is not repeated here: the pinned turn-status row
          // and the tool-activity row above already carry it, and a third copy
          // just steals transcript rows.
          ? visibleComposerLiveText
            ? 'Streaming assistant response.'
            : null
          // Plain reattached state renders as its own banner row (counted in
          // composerStatusBlockHeight), not through this message slot.
          : null
  // An explicit pane target outranks the auto-targeting note: the user aimed
  // this composer at a split pane and must be able to see that before sending.
  const composerTargetMessage = composerPaneTargetKey && composerTargetSession
    ? `To: ${formatSessionTitle(composerTargetSession)}`
    : composerPaneTargetKey
    ? 'Session target is unavailable — select a session to retarget'
    : composerAutoTargetingRunning && composerTargetSession
      ? `To: ${formatSessionTitle(composerTargetSession)}`
      : composerTargetSession ? `To: ${formatSessionTitle(composerTargetSession)}` : null
  const composerIdleFooterHint = useMemo(
    () => formatTuiComposerIdleHint(composerConfig.footerHintIdle, sentHistory.length),
    [composerConfig.footerHintIdle, sentHistory.length],
  )

  const resizeSidebar = useStableEvent((delta: number) => {
    const nextWidth = clamp(sidebarWidth + delta, MIN_SIDEBAR_WIDTH, maxSidebarWidth)
    if (nextWidth === sidebarWidth) return
    setSidebarWidthPreference(nextWidth)
    void writeTuiSidebarWidth(nextWidth).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store sidebar width')
    })
  })

  const resizeTaskPanel = useStableEvent((delta: number) => {
    const nextWidth = taskPanelOpen
      ? clamp(taskPanelWidth + delta, TASK_PANEL_MIN_WIDTH, maxTaskPanelWidth)
      : TASK_PANEL_DEFAULT_WIDTH + delta
    setTaskPanelExpanded(false)
    setTaskPanelWidth(Math.round(nextWidth / TASK_PANEL_RESIZE_STEP) * TASK_PANEL_RESIZE_STEP)
  })

  // Adapter over the toast store, kept as the single feedback entry point (also
  // handed to popovers via their `onNotice` prop). info/error tones map to the
  // matching toast kinds; the store handles stacking and per-toast auto-dismiss.
  const showNotice = useCallback((tone: NoticeTone, text: string, durationMs?: number) => {
    const options = durationMs != null ? { durationMs } : undefined
    if (tone === 'error') toast.error(text, options)
    else toast.info(text, options)
  }, [])

  // `x` in the rail: settle the selected session, or reopen a settled one.
  // Optimistic — the row changes now and the next listing confirms it.
  const toggleSelectedSessionSettled = useStableEvent(() => {
    const target = selectedSession
    if (!target) return
    const action = target.inbox?.settledAt ? 'reopen' : 'settle'
    const key = sessionKey(target)
    const apply = (settledAt: number | undefined) => setSessions((current) => current.map((session) => {
      if (sessionKey(session) !== key) return session
      const inbox = { ...session.inbox, settledAt }
      if (settledAt === undefined) delete inbox.settledAt
      else delete inbox.snoozedUntil
      return { ...session, inbox }
    }))
    const settledAt = action === 'settle' ? Date.now() : undefined
    pendingInboxEditsRef.current.set(key, { settledAt, until: Date.now() + PENDING_INBOX_EDIT_MS })
    apply(settledAt)
    showNotice('info', action === 'settle'
      ? `Settled · ${showSettled ? 'marked ✓' : 'hidden once you move off it'} · x again to reopen`
      : 'Reopened')
    void updateTuiSessionInbox(target, action).catch((err) => {
      pendingInboxEditsRef.current.delete(key)
      apply(target.inbox?.settledAt)
      showNotice('error', err instanceof Error ? err.message : 'Failed to update the session')
    })
  })

  // A turn summary's click: the checkpoint popover, opened on that turn.
  const openTurnCheckpoint = useStableEvent((promptKey: string) => {
    if (!gitRepoCwd) {
      showNotice('info', 'Turn diffs need a git repository')
      return
    }
    const sessionId = sessionDetail?.info?.sessionId
    const prompt = rewindCandidates(sessionDetail?.rawMessages ?? []).find((candidate) => candidate.uuid === promptKey)
    if (!isPluginEnabled('checkpoints')) {
      showNotice('info', 'Checkpoints are off · turn them on in Plugins (⌃K palette)')
      return
    }
    setCheckpointFocusPrompt(sessionId && prompt ? { sessionId, text: prompt.text, timestamp: prompt.timestamp } : null)
    setPluginOverlay('checkpoints')
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

  useEffect(() => {
    let cancelled = false
    void readTuiSurfacePanelPlacement().then((placement) => { if (!cancelled && !workspaceContext.runtime.restoredKeys.has('surfacePanelPlacement')) setSurfacePanelPlacement(placement) }).catch(() => {})
    void readTuiWindowArrangement().then((stored) => {
      if (cancelled) return
      if (workspaceContext.runtime.restoredKeys.has('splitArrangement') || workspaceContext.runtime.values.get('legacyInitialWorkspace') !== true) return
      setSplitArrangement(stored.arrangement)
      setSplitReaderLast(stored.readerLast)
      setSplitSecondaryShare(stored.secondaryShare)
      setSplitBottomShare(stored.bottomShare)
      setSplitWeights(stored.weights ?? {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const showToggleOutcome = useStableEvent((label: string, outcome: string | boolean) => {
    const state = typeof outcome === 'boolean' ? (outcome ? 'enabled' : 'disabled') : outcome
    showNotice('info', `${label} ${state}`)
  })

  const toggleFullscreenMode = useStableEvent((forced?: boolean) => {
    const next = forced ?? !fullscreenMode
    setFullscreenMode(next)
    showToggleOutcome('Fullscreen transcript', next)
    if (next) {
      // Hidden windows keep their state; the keys go to the one full screen draws.
      setFocusedPane('messages')
      setSplitFocusIndex(FULLSCREEN_PANE_INDEX)
      setSplitChordPending(false)
      setCommandChordPending(false)
      setSessionSearchMode(false)
    }
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

  const insertComposerPasteMarker = useStableEvent((marker: string, partId: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !marker || !partId) return
    const textToInsert = `${marker} `
    const start = renderable.cursorOffset
    renderable.insertText(textToInsert)
    const end = start + marker.length
    const typeId = ensureComposerPastePartTypeId(renderable)
    const styleId = renderable.syntaxStyle?.getStyleId('extmark.paste') ?? undefined
    renderable.extmarks.create({
      start,
      end,
      virtual: true,
      styleId,
      typeId,
      data: { partId },
    })
    const next = renderable.plainText
    setComposerDraft(next)
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, next)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  })

  const attachComposerAttachment = useStableEvent((attachment: SendAttachment, marker: string, noticeText: string) => {
    const id = attachment.id || `paste-${Date.now()}-${composerPromptParts.length}`
    const nextAttachment = { ...attachment, id, text: marker }
    insertComposerPasteMarker(marker, id)
    setComposerMentionAttachments((prev) => [...prev, nextAttachment])
    setComposerPromptParts((prev) => [...prev, {
      id,
      kind: 'attachment',
      marker,
      attachment: nextAttachment,
    }])
    showNotice('info', noticeText)
  })

  const attachComposerImage = useStableEvent((image: ClipboardImage) => {
    const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
    const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
    const marker = `[Image ${imageAttachmentCount(activeAttachments) + 1}]`
    attachComposerAttachment({
      id: `paste-${Date.now()}-${composerPromptParts.length}`,
      type: 'blob',
      mimeType: image.mimeType,
      data: image.data,
      displayName: image.displayName,
    }, marker, `Attached ${image.displayName}`)
  })

  const insertCompactPastedText = useStableEvent((text: string, marker: string) => {
    const id = `paste-text-${Date.now()}-${composerPromptParts.length}`
    insertComposerPasteMarker(marker, id)
    setComposerPromptParts((prev) => [...prev, {
      id,
      kind: 'text',
      marker,
      text,
    }])
  })

  const pasteFilePathToComposer = useStableEvent(async (text: string): Promise<boolean> => {
    const cwd = composerTargetSession?.cwd ?? selectedSession?.cwd ?? null
    const filePath = normalizePastedFilePath(text, cwd)
    if (!filePath) return false
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return false
    } catch {
      return false
    }
    const mimeType = pastedFileMimeTypeForPath(filePath)
    const filename = basename(filePath)
    if (mimeType === 'image/svg+xml') {
      const content = await readFile(filePath, 'utf8').catch(() => null)
      if (!content) return false
      insertCompactPastedText(content, `[SVG: ${filename || 'image'}]`)
      return true
    }
    if (mimeType.startsWith('image/')) {
      const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
      const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
      const marker = `[Image ${imageAttachmentCount(activeAttachments) + 1}]`
      attachComposerAttachment({
        id: `paste-file-${Date.now()}-${composerPromptParts.length}`,
        type: 'image',
        path: filePath,
        displayName: filename,
        mimeType,
      }, marker, `Attached ${filename}`)
      return true
    }
    if (mimeType === 'application/pdf') {
      const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
      const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
      const pdfCount = activeAttachments.filter((attachment) => attachment.mimeType === 'application/pdf').length
      const marker = `[PDF ${pdfCount + 1}]`
      attachComposerAttachment({
        id: `paste-file-${Date.now()}-${composerPromptParts.length}`,
        type: 'file',
        path: filePath,
        displayName: filename,
        mimeType,
      }, marker, `Attached ${filename}`)
      return true
    }
    return false
  })

  const insertComposerTextAtCursor = useStableEvent((textToInsert: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !textToInsert) return
    const text = renderable.plainText
    const cursor = renderable.cursorOffset
    const next = `${text.slice(0, cursor)}${textToInsert}${text.slice(cursor)}`
    renderable.setText(next)
    renderable.cursorOffset = cursor + textToInsert.length
    setComposerDraft(next)
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, next)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  })

  const [voiceStatus, setVoiceStatus] = useState('')
  const voiceJob = useRef<{ controller: AbortController; stop?: () => void } | null>(null)
  useEffect(() => () => {
    voiceJob.current?.controller.abort()
    voiceJob.current = null
    setVoiceStatus('')
  }, [composerTargetSession?.provider, composerTargetSession?.sessionId])

  const toggleVoice = useStableEvent(() => {
    if (voiceJob.current) {
      if (voiceJob.current.stop) voiceJob.current.stop()
      else { voiceJob.current.controller.abort(); voiceJob.current = null; setVoiceStatus('Voice input cancelled') }
      return
    }
    const job: { controller: AbortController; stop?: () => void } = { controller: new AbortController() }
    voiceJob.current = job
    setComposerActive(true)
    setVoiceStatus('Opening microphone…')
    void recordVoice(job.controller.signal, (stop) => {
      job.stop = () => { stop(); job.stop = undefined; setVoiceStatus('Transcribing locally…') }
      setVoiceStatus('Listening… Ctrl+Shift+V to stop')
    }).then(text => {
      if (!job.controller.signal.aborted) insertComposerTextAtCursor(`${text} `)
    }).catch(error => {
      if (!job.controller.signal.aborted) setVoiceStatus(error instanceof Error ? error.message : 'Voice input failed')
    }).finally(() => {
      if (voiceJob.current === job) {
        voiceJob.current = null
        setVoiceStatus(current => /^(Opening|Listening|Transcribing)/.test(current) ? '' : current)
      }
    })
  })

  const pasteTextToComposer = useStableEvent(async (textToInsert: string) => {
    const normalizedText = textToInsert.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!normalizedText) return
    if (await pasteFilePathToComposer(normalizedText)) return
    const pastedContent = normalizedText.trim()
    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if (pastedContent && (lineCount >= 3 || pastedContent.length > 150)) {
      insertCompactPastedText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }
    insertComposerTextAtCursor(normalizedText)
  })

  const pasteSystemClipboardToComposer = useStableEvent(async () => {
    try {
      const image = await readClipboardImage()
      if (image) {
        attachComposerImage(image)
        return
      }
      const text = await readClipboardText()
      if (!text) {
        showNotice('error', 'Clipboard has no supported image or text')
        return
      }
      await pasteTextToComposer(text)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to paste from clipboard')
    }
  })

  const clearComposerDraft = useStableEvent(() => {
    composerTextareaRef.current?.setText('')
    composerTextareaRef.current?.extmarks.clear()
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
    setComposerMentionDismissedStart(null)
    setComposerSlashIndex(0)
    setComposerSlashDismissed(false)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    setComposerStashOpen(false)
    setComposerStashIndex(0)
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, '')
  })

  // The stash file is written the way the follow-up queue is: in the
  // originating interaction and flushed immediately, not from an effect. A
  // stash exists to survive leaving, and leaving includes an immediate exit.
  const commitComposerStash = useStableEvent((next: ComposerDraftSnapshot[]) => {
    scheduleWriteComposerStash(next)
    flushComposerStashWrites()
    setComposerStash(next)
  })

  const stashComposerPrompt = useStableEvent(() => {
    const snapshot = makeComposerSnapshot()
    if (!snapshot.text.trim() && snapshot.attachments.length === 0 && snapshot.promptParts.length === 0) {
      showNotice('info', 'Composer is empty')
      return
    }
    commitComposerStash([...composerStash, snapshot])
    clearComposerDraft()
    showNotice('info', 'Stashed composer prompt')
  })

  const popComposerStash = useStableEvent(() => {
    const popped = composerStash[composerStash.length - 1] ?? null
    if (!popped) {
      showNotice('info', 'Composer stash is empty')
      return
    }
    commitComposerStash(composerStash.slice(0, -1))
    setComposerActive(true)
    applyComposerSnapshot(popped)
    showNotice('info', 'Restored composer stash')
  })

  const openComposerStashList = useStableEvent(() => {
    if (composerStash.length === 0) {
      showNotice('info', 'Composer stash is empty')
      return
    }
    setComposerActive(true)
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
    setComposerHistoryOpen(false)
    setComposerStashOpen(true)
    setComposerStashIndex(0)
  })

  const selectComposerStashEntry = useStableEvent((displayIndex: number) => {
    if (composerStash.length === 0) return
    setComposerStashIndex(clamp(displayIndex, 0, composerStash.length - 1))
  })

  const commitComposerStashEntry = useStableEvent(() => {
    const sourceIndex = composerStash.length - 1 - composerStashIndex
    const entry = composerStash[sourceIndex]
    if (!entry) return
    commitComposerStash(composerStash.filter((_, index) => index !== sourceIndex))
    setComposerStashOpen(false)
    setComposerStashIndex(0)
    applyComposerSnapshot(entry)
    showNotice('info', 'Restored composer stash')
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

  const copySelectedMessage = useStableEvent(async (cardOverride?: TuiTranscriptCard) => {
    const terminalSelection = terminalSelectionRef.current
    if (
      terminalSelection
      && Date.now() - terminalSelection.capturedAt <= TERMINAL_SELECTION_COPY_WINDOW_MS
      && terminalSelection.text.trim()
    ) {
      try {
        await writeClipboard(terminalSelection.text, renderer)
        terminalSelectionRef.current = null
        showNotice('info', 'Copied terminal selection to clipboard')
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Failed to copy selection')
      }
      return
    }

    const cursorIndex = readCursorIndex()
    const card = cardOverride ?? (cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null)
    if (!card) {
      showNotice('error', 'No message selected')
      return
    }
    const text = cardClipboardText(card)
    if (!text) {
      showNotice('error', 'Selected message has no copyable text')
      return
    }
    try {
      await writeClipboard(text, renderer)
      showNotice('info', 'Copied selected message to clipboard')
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy to clipboard')
    }
  })

  const replySelectedMessage = useStableEvent((cardOverride?: TuiTranscriptCard) => {
    const cursorIndex = readCursorIndex()
    const card = cardOverride ?? (cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null)
    if (!card) {
      showNotice('error', 'No message selected')
      return
    }
    const text = cardClipboardText(card).trim()
    if (!text) {
      showNotice('error', 'Selected message has no reply text')
      return
    }

    const quoted = text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const existing = composerTextareaRef.current?.plainText ?? composerDraft
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '' : '\n\n') : ''
    const next = `${existing}${separator}${quoted}\n\n`

    applyComposerSnapshot({
      text: next,
      attachments: [...composerMentionAttachments],
      promptParts: [...composerPromptParts],
      cursorOffset: next.length,
    })
    setComposerActive(true)
  })

  // Toggle a bookmark on the card under the transcript cursor.
  const toggleBookmarkForCursor = useStableEvent(async () => {
    const target = selectedSessionTarget
    if (!target) { showNotice('error', 'No session selected'); return }
    const cursorIndex = readCursorIndex()
    const card = cursorIndex >= 0 ? visibleTranscriptCards[cursorIndex] : null
    if (!card) { showNotice('error', 'No message selected'); return }
    if (card.key.startsWith('live-')) { showNotice('error', 'Cannot bookmark a streaming message'); return }
    const uuid = card.key
    const next = !bookmarkKeysRef.current.has(uuid)
    setBookmarkKeys((prev) => {
      const updated = new Set(prev)
      if (next) updated.add(uuid)
      else updated.delete(uuid)
      return updated
    })
    try {
      const meta = next
        ? {
            role: card.role,
            label: card.role === 'user' ? 'user' : 'assistant',
            preview: (card.compactSummary || card.searchText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined,
            sessionTitle: readerTitle || undefined,
            messageTimestamp: card.timestamp,
          }
        : undefined
      const ids = await toggleTuiSessionBookmark(
        { sessionId: target.sessionId, provider: target.provider } as Session,
        uuid,
        next,
        meta,
      )
      setBookmarkKeys(new Set(ids))
      showNotice('info', next ? 'Bookmarked message' : 'Removed bookmark')
    } catch (err) {
      setBookmarkKeys((prev) => {
        const updated = new Set(prev)
        if (next) updated.delete(uuid)
        else updated.add(uuid)
        return updated
      })
      showNotice('error', err instanceof Error ? err.message : 'Failed to update bookmark')
    }
  })

  // Jump to the next/previous bookmarked card in the active session.
  const jumpToBookmark = useStableEvent((direction: 1 | -1) => {
    if (visibleTranscriptCards.length === 0) return
    const marks = bookmarkKeysRef.current
    if (marks.size === 0) { showNotice('info', 'No bookmarks in this session'); return }
    const cursorIndex = readCursorIndex()
    const start = cursorIndex >= 0 ? cursorIndex : 0
    const count = visibleTranscriptCards.length
    for (let step = 1; step <= count; step += 1) {
      const idx = (((start + direction * step) % count) + count) % count
      const card = visibleTranscriptCards[idx]
      if (card && marks.has(card.key)) {
        jumpToTranscriptIndex(idx)
        return
      }
    }
  })

  const openBookmarksOverlay = useStableEvent(async () => {
    setBookmarksOverlayOpen(true)
    setBookmarksOverlayIndex(0)
    try {
      const all = await readTuiAllBookmarks()
      setBookmarksOverlay(all)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to load bookmarks')
    }
  })

  const openHandoffBrief = useStableEvent(() => {
    if (!selectedSessionTarget) {
      showNotice('error', 'No session selected')
      return
    }
    setHandoffBriefOpen(true)
  })

  const openPromptLibrary = useStableEvent(() => {
    if (!selectedSessionTarget) {
      showNotice('error', 'No session selected')
      return
    }
    rememberComposerCursor()
    setComposerActive(true)
    setPromptLibraryOpen(true)
  })

  const toggleComposerBridgeRoute = useStableEvent(() => {
    if (!canUseChannelBridge) {
      showNotice('error', 'Select a Claude session to route the composer through the channel bridge')
      return
    }
    setRouteComposerToBridge((on) => {
      const next = !on
      showNotice('info', next ? 'Composer now routes to the live CLI bridge' : 'Composer back to the active provider')
      return next
    })
  })

  const toggleComposerIdeRoute = useStableEvent(() => {
    if (!canUseIdeBridge) {
      showNotice('error', 'Select a Claude session to route the composer through the IDE bridge')
      return
    }
    setRouteComposerToIde((on) => {
      const next = !on
      showNotice('info', next ? 'Composer now pushes @mentions to the IDE session' : 'Composer back to the active provider')
      return next
    })
  })

  const insertComposerPromptText = useStableEvent((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const renderable = composerTextareaRef.current
    const current = renderable?.plainText ?? composerDraft
    const cursor = renderable?.cursorOffset ?? current.length
    const before = current.slice(0, cursor)
    const insertion = before.length > 0 && !before.endsWith('\n') ? `\n${trimmed}` : trimmed
    insertComposerTextAtCursor(insertion)
    setComposerActive(true)
  })

  // Navigate to a bookmark from the global overlay — switching session (and
  // provider) when needed, then landing on the message once it has loaded.
  const openBookmarkRecord = useStableEvent((record: MessageBookmark) => {
    setBookmarksOverlayOpen(false)
    const targetSession = { sessionId: record.sessionId, provider: record.provider } as Session
    const targetKey = sessionKey(targetSession)
    if (targetKey === selectedSessionKeyRef.current) {
      const idx = transcriptIndexByKey.get(record.uuid)
      if (idx !== undefined && idx >= 0) jumpToTranscriptIndex(idx)
      else pendingBookmarkCursorRef.current = { sessionKey: targetKey, uuid: record.uuid }
      setFocusedPane('messages')
      return
    }
    pendingBookmarkCursorRef.current = { sessionKey: targetKey, uuid: record.uuid }
    selectTabSession(targetSession)
    setFocusedPane('messages')
  })

  const copyCliCommand = useStableEvent(async () => {
    const session = selectedSession
    if (!session) { showNotice('error', 'No session selected'); return }
    const cwd = sessionDetail?.info?.cwd ?? session.cwd
    const cmd = getContinueInCliCommand(session.provider ?? 'claude', session.sessionId, cwd)
    if (!cmd) { showNotice('error', `No CLI resume command for ${session.provider}`); return }
    try {
      await writeClipboard(cmd, renderer)
      showNotice('info', `Copied: ${cmd}`)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy')
    }
  })

  // Checkpoint user operations rather than renders: polling, focus changes,
  // startup hydration and terminal resizes must never fill the undo stack.
  const captureWindowLayout = useStableEvent(() => ({
    layout: {
      arrangement: splitArrangement, orientation: splitOrientation,
      readerLast: splitReaderLast, readerShare: splitReaderShare,
      secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights: splitWeights,
      splitTree: reconciledSplitTree,
      count: splitPaneCount, panes: [...splitPinnedKeys], surfaces: [...windowSurfaces], order: [...windowOrder],
      popoverTabs: [...popoverTabs], activePopoverTab, stacks: windowStacks.map((stack) => [...stack]), floating: floatingWindow, surfaceMeta: { ...windowSurfaceMeta },
      primaryOpen: false, reader: selectedSessionKey, zoom: windowZoom, fullscreen: fullscreenMode,
      coordinatorRunId: coordinatorWorkspaceRunId,
    },
    reader: selectedSession,
    workspace: coordinatorWorkspace,
    workspaceRunId: coordinatorWorkspaceRunId,
    tabs: openTabSessions,
    focus: splitFocusIndex,
    panel: surfacePanel,
    panelOpen: surfacePanelOpen,
  }))
  const [windowHistory] = useWorkspaceState('windowHistory', () => new WindowHistory<ReturnType<typeof captureWindowLayout>>(
    (snapshot) => JSON.stringify(snapshot.layout),
  ), false)
  const checkpointWindowLayout = useStableEvent(() => {
    if (windowResizeGroupRef.current) {
      if (windowResizeCheckpointRef.current) return
      windowResizeCheckpointRef.current = true
    } else windowResizeCheckpointRef.current = false
    windowHistory.checkpoint(captureWindowLayout())
  })
  const restoreWindowSnapshot = useStableEvent((previous: ReturnType<typeof captureWindowLayout>) => {
    const layout = previous.layout
    setCoordinatorWorkspace(previous.workspace)
    setCoordinatorWorkspaceRunId(previous.workspaceRunId)
    // Layout undo moves views back, carrying edits made after the relocation.
    const currentViews = new Set([...windowSurfaces, ...liveWindowStacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey), ...(floatingKey && isSurfaceWindowKey(floatingKey) ? [surfaceIdOfKey(floatingKey)] : [])])
    const previousViews = new Set([...layout.surfaces, ...layout.stacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey), ...(layout.floating && isSurfaceWindowKey(layout.floating.key) ? [surfaceIdOfKey(layout.floating.key)] : [])])
    for (const panel of previous.panel.surfaces) if (!surfacePanel.surfaces.some(entry => entry.id === panel.id)) {
      const source = [...currentViews].find(id => surfaceKindOf(id) === panel.kind && !previousViews.has(id))
      if (source) copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(panel.kind, source), surfaceViewNamespace(panel.kind, undefined, panel.id))
    }
    for (const id of previousViews) if (!currentViews.has(id)) {
      const panel = surfacePanel.surfaces.find(entry => entry.kind === surfaceKindOf(id) && !previous.panel.surfaces.some(previousPanel => previousPanel.id === entry.id))
      if (panel) copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(panel.kind, undefined, panel.id), surfaceViewNamespace(panel.kind, id))
    }
    setWindowSurfacePeek(null)
    setOpenTabSessions((current) => {
      const keys = new Set(current.map(sessionKey))
      return [...current, ...previous.tabs.filter((tab) => !keys.has(sessionKey(tab)))]
    })
    // Set the reader before restoring pins; its normal swap plan must not
    // overwrite the saved order. The reconciler will see valid pins next render.
    if (previous.reader && layout.reader !== selectedSessionKey) { setWorkspaceHasSession(true); setWorkspaceReaderSession(previous.reader); setSelectedSessionKey(layout.reader) }
    setSplitPinnedKeys(layout.panes)
    setSplitPaneCount(layout.count)
    setWindowSplitTree(layout.splitTree ?? null)
    setSplitArrangement(layout.arrangement)
    setSplitOrientation(layout.orientation)
    setSplitReaderLast(layout.readerLast)
    setSplitReaderShare(layout.readerShare)
    setSplitSecondaryShare(layout.secondaryShare)
    setSplitBottomShare(layout.bottomShare)
    setSplitWeights(layout.weights ?? {})
    setWindowSurfaces(layout.surfaces)
    setWindowOrder(layout.order ?? [])
    setPopoverTabs(layout.popoverTabs ?? []); setActivePopoverTab(layout.activePopoverTab ?? null)
    setWindowStacks(layout.stacks ?? [])
    setFloatingWindow(layout.floating ?? null)
    setWindowSurfaceMeta(layout.surfaceMeta ?? {})
    setWindowZoom(layout.zoom)
    setFullscreenMode(layout.fullscreen)
    setSplitFocusIndex(previous.focus)
    setSurfacePanel(previous.panel)
    setSurfacePanelOpen(previous.panelOpen)
    setSurfacePanelFocused(false)
    void Promise.all([
      writeTuiSplitPanes(layout.count),
      writeTuiSplitOrientation(layout.orientation),
      writeTuiSplitReaderShare(layout.readerShare),
      writeTuiWindowArrangement({ arrangement: layout.arrangement, readerLast: layout.readerLast, secondaryShare: layout.secondaryShare, bottomShare: layout.bottomShare, weights: layout.weights ?? {} }),
    ]).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store restored layout'))
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
  const reopenClosedWindow = useStableEvent(() => {
    const closed = closedWindows.at(-1)
    if (!closed) { showNotice('info', 'No closed panes to reopen'); return }
    const saved = closed.snapshot, key = closed.key
    const existing = new Set([...orderedWindowKeys, ...liveWindowStacks.flat(), floatingKey])
    setClosedWindows(previous => previous.slice(0, -1))
    if (existing.has(key)) { showNotice('info', 'That pane is already open'); return }
    checkpointWindowLayout()
    setOpenTabSessions(current => [...current, ...saved.tabs.filter(tab => !current.some(entry => sessionKey(entry) === sessionKey(tab)))])
    if (isSurfaceWindowKey(key) && (saved.layout.popoverTabs ?? []).includes(surfaceIdOfKey(key))) {
      const id = surfaceIdOfKey(key)
      setPopoverTabs(current => current.includes(id) ? current : [...current, id])
      setWindowSurfaceMeta(current => ({ ...current, [id]: saved.layout.surfaceMeta[id] ?? {} }))
      setActivePopoverTab(id); setSplitFocusIndex(null)
      if (surfaceKindOf(id) === 'teammates' && !teammatesOpen) openTeammatesPanel()
      showNotice('info', 'Closed tab reopened')
      return
    }
    const oldStack = saved.layout.stacks.find(stack => stack.includes(key))
    const anchor = oldStack?.find(member => existing.has(member))
    if (anchor) {
      setWindowStacks(addToStack(liveWindowStacks, anchor, key))
      const frame = liveWindowStacks.find(stack => stack.includes(anchor))?.find(member => orderedWindowKeys.includes(member)) ?? anchor
      commitWindowKeys(replaceWindowKey(orderedWindowKeys, frame, key))
    } else if (saved.layout.floating?.key === key && !floatingKey) setFloatingWindow(saved.layout.floating)
    else {
      const keys = [...orderedWindowKeys]
      const oldKeys = orderWindows(saved.layout.order, saved.layout.panes.slice(0, saved.layout.count), saved.layout.surfaces)
      keys.splice(Math.max(0, Math.min(oldKeys.indexOf(key), keys.length)), 0, key)
      commitWindowKeys(keys)
      if (saved.layout.splitTree && keys.length === oldKeys.length && keys.every((entry, index) => entry === oldKeys[index])) setWindowSplitTree(saved.layout.splitTree)
    }
    if (isSurfaceWindowKey(key) && saved.layout.surfaceMeta[surfaceIdOfKey(key)]) setWindowSurfaceMeta(current => ({ ...current, [surfaceIdOfKey(key)]: saved.layout.surfaceMeta[surfaceIdOfKey(key)]! }))
    setOverviewPendingTarget(key)
    showNotice('info', 'Closed pane reopened')
  })

  // Split panes are driven by a tmux-style prefix chord (⌃B then a command key),
  // so the reader's single-key namespace stays free. applySplitPaneCount is the
  // one writer of the count — it persists and narrates every change.
  const applySplitPaneCount = useStableEvent((next: number, label?: string, orientation?: SplitPaneOrientation) => {
    checkpointWindowLayout()
    setSplitPaneCount(next)
    void writeTuiSplitPanes(next).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store split view setting')
    })
    if (windowSplitTree) {
      showNotice('info', label ?? `${next} session pane${next === 1 ? '' : 's'} open`)
      return
    }
    if (next === 0) {
      showNotice('info', label ?? 'Split transcript view off')
      return
    }
    // Narrate the requested NEXT layout. Reading splitPaneWidth here would use
    // the previous render, which made the first successful split falsely claim
    // that even wide terminals were too narrow.
    // Project against the orientation being applied, not the one still in
    // state: an orientation change and a pane add land in the same keystroke,
    // and reading the rendered axis here told a working stacked split it had
    // no room.
    const nextStacked = (orientation ?? splitOrientation) === 'rows'
    const nextLayout = calculateSplitPaneLayout({
      availableExtent: nextStacked ? Math.max(mainContentHeight - 2, 8) : readerAreaWidth,
      requestedCount: next,
      availableCount: Math.min(next, splitCandidateSessions.length),
      maxPanes: SPLIT_PANE_MAX,
      minPaneExtent: nextStacked ? SPLIT_PANE_MIN_ROWS : SPLIT_PANE_MIN_WIDTH,
      minReaderExtent: nextStacked ? MIN_READER_ROWS : MIN_READER_WIDTH,
      readerShare: splitReaderShare,
    })
    if (nextLayout.visibleCount < next) {
      // Stacked is the escape hatch from a narrow terminal, so offer it rather
      // than only saying "widen the terminal".
      showNotice('info', nextStacked
        ? `Split panes: ${nextLayout.visibleCount}/${next} visible (terminal too short — ⌃B % for side-by-side)`
        : `Split panes: ${nextLayout.visibleCount}/${next} visible (⌃B " to stack instead, or hide the rail with h)`)
      return
    }
    showNotice('info', label ?? (
      RUNNING_INSIDE_TMUX
        ? `Split panes: ${next} · use ? palette (tmux captures ⌃B)`
        : `Split panes: ${next} · ⌃B o next pane · ⌃B x close`
    ))
  })

  // tmux shape: % splits the focused frame right; " splits it below.
  // Existing branches retain their orientation, allowing mixed layouts.
  const addSplitPane = useStableEvent((orientation: SplitPaneOrientation) => splitFocusedWindow(orientation))

  const closeSplitPane = useStableEvent((paneIndex?: number) => {
    const closeIndex = paneIndex ?? splitFocusIndex ?? null
    if (closeIndex === FLOATING_PANE_INDEX) { closeFloatingWindow(); return }
    checkpointWindowLayout()
    if (splitPaneCount === 0) {
      showNotice('info', 'No split panes open')
      return
    }
    // A tab closes into its frame's next tab, not the whole frame.
    const closing = closeIndex === null ? null : windowItems[closeIndex]
    if (closing && windowStackFor(windowItemKey(closing))) { closeWindowTab(windowItemKey(closing)); return }
    const nextCount = splitPaneCount - 1
    // Window indices count surfaces too; the pins count sessions only.
    const closePin = closeIndex === null ? Math.max(splitPaneCount - 1, 0) : pinIndexOfWindow(closeIndex)
    if (closePin < 0) return
    const closingKey = splitPinnedKeys[closePin]
    if (closingKey) rememberClosedWindow(closingKey)
    setSplitPinnedKeys((current) => removeSplitPaneKey(current, closePin))
    if (splitFocusIndex !== null) {
      const nextFocus = focusAfterWindowClose(splitFocusIndex, closeIndex ?? windowItems.length - 1, windowItems.length)
      setSplitFocusIndex(nextFocus)
      if (nextFocus !== null) lastFocusedSplitPaneRef.current = nextFocus
    }
    applySplitPaneCount(nextCount)
  })

  // ── Window layouts ─────────────────────────────────────────────────────────
  const setWindowArrangement = useStableEvent((arrangement: WindowArrangement, readerLast: boolean) => {
    checkpointWindowLayout()
    setWindowSplitTree(null)
    setSplitArrangement(arrangement)
    setSplitReaderLast(readerLast)
    void writeTuiWindowArrangement({ arrangement, readerLast, secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights: splitWeights }).catch(() => {})
  })

  // Ask for `wanted` panes from the open tabs; say so when there are not enough.
  const requestWindowPanes = useStableEvent((wanted: number, label: string) => {
    let available = splitCandidateSessions.length
    // Short of tabs, the layout fills from the rail's most recent sessions, as
    // a window manager tiles the windows it has rather than leaving holes.
    if (available < wanted) {
      const taken = new Set([...openTabSessions.map((tab) => sessionKey(tab)), selectedSessionKey])
      const extra = sessions.filter((session) => !taken.has(sessionKey(session))).slice(0, wanted - available)
      if (extra.length > 0) {
        setOpenTabSessions((prev) => [...prev, ...extra.filter((session) => !prev.some((tab) => sessionKey(tab) === sessionKey(session)))])
        available += extra.length
      }
    }
    if (available === 0) {
      showNotice('error', 'No other sessions to arrange · start one, or drag a session from the sidebar onto the reader')
      return
    }
    const count = Math.min(wanted, available)
    setSplitPaneCount(count)
    void writeTuiSplitPanes(count).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store split view setting')
    })
    showNotice('info', count < wanted ? `${label} · ${count} of ${wanted} panes (no more sessions to fill it)` : label)
  })

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
  const applySavedWindowLayout = useStableEvent((id: string, snapshot: ProtocolRunSnapshot | null, request: number, project: string) => {
    if (request !== windowLayoutRestoreRequestRef.current || project !== windowLayoutProject || !windowPickerOpen) return
    setWindowSurfacePeek(null)
    checkpointWindowLayout()
    setCoordinatorWorkspace(snapshot)
    const saved = savedWindowLayouts.find((entry) => entry.id === id)
    if (!saved) return
    setCoordinatorWorkspaceRunId(saved.coordinatorRunId ?? null)
    setWindowPickerOpen(false)
    const known = new Map<string, Session>()
    for (const session of [...sessions, ...openTabSessions]) known.set(sessionKey(session), session)
    if (snapshot && snapshot.run.id === saved.coordinatorRunId) {
      for (const target of planCoordinatorWorkspace(snapshot, known).targets) known.set(target.sessionKey, target.session)
    }
    const panes = saved.panes.flatMap((key) => (known.has(key) ? [known.get(key)!] : []))
    const reader = saved.reader ? known.get(saved.reader) ?? null : null
    const floatingSession = saved.floating && !isSurfaceWindowKey(saved.floating.key) ? known.get(saved.floating.key) : null
    const missing = saved.panes.length - panes.length + (saved.reader && !reader ? 1 : 0) + (saved.floating && !isSurfaceWindowKey(saved.floating.key) && !floatingSession ? 1 : 0)
    setWindowArrangement(saved.arrangement, saved.readerLast)
    applySplitOrientation(saved.orientation, true)
    setSplitReaderShare(saved.readerShare)
    setSplitSecondaryShare(saved.secondaryShare)
    setSplitBottomShare(saved.bottomShare ?? SPLIT_SHARE_EVEN)
    setSplitWeights(saved.weights ?? {})
    setOpenTabSessions((prev) => {
      const next = [...prev]
      for (const session of [...(reader ? [reader] : []), ...(floatingSession ? [floatingSession] : []), ...panes]) {
        if (!next.some((tab) => sessionKey(tab) === sessionKey(session))) next.push(session)
      }
      return next
    })
    setSplitPinnedKeys(panes.map((pane) => sessionKey(pane)))
    setSplitPaneCount(panes.length)
    void writeTuiSplitPanes(panes.length).catch(() => {})
    setWindowSurfaces(saved.surfaces.filter(surfaceRestorable))
    setWindowOrder(saved.order ?? [])
    // Background tabs' sessions must be open tabs, or their tab has nothing to show.
    const tabSessions = (saved.stacks ?? []).flat().flatMap((key) => (known.has(key) && !panes.some((pane) => sessionKey(pane) === key) ? [known.get(key)!] : []))
    if (tabSessions.length > 0) setOpenTabSessions((prev) => [...prev, ...tabSessions.filter((session) => !prev.some((tab) => sessionKey(tab) === sessionKey(session)))])
    const restoredPrimaryOpen = Boolean(reader) && (saved.primaryOpen ?? saved.splitTree?.primary !== false)
    const restoredTree = validWindowSplitTree(saved.splitTree) ? saved.splitTree : null
    const restoredTabs = (saved.popoverTabs ?? []).filter(surfaceRestorable)
    setPopoverTabs(restoredTabs); setActivePopoverTab(saved.activePopoverTab && restoredTabs.includes(saved.activePopoverTab) ? saved.activePopoverTab : null)
    const restoredPrimaryFrame = restoredPrimaryOpen || Boolean(saved.activePopoverTab && restoredTabs.includes(saved.activePopoverTab))
    setWindowSplitTree(restoredTree ? restoredPrimaryFrame ? restoredTree : removePrimaryWindow(restoredTree) : null)
    setWindowStacks(saved.stacks ?? [])
    setWindowSurfaceMeta(readSurfaceMeta(saved.surfaceMeta))
    const restoredFloating = saved.floating && (isSurfaceWindowKey(saved.floating.key) ? surfaceRestorable(surfaceIdOfKey(saved.floating.key)) : Boolean(floatingSession)) ? saved.floating : null
    setFloatingWindow(restoredFloating)
    setSplitFocusIndex(restoredPrimaryFrame ? null : panes.length + saved.surfaces.filter(surfaceRestorable).length > 0 ? 0 : restoredFloating ? FLOATING_PANE_INDEX : null)
    setSurfacePanelFocused(false)
    setFocusedPane('messages')
    setWindowZoom(null)
    // Generic layouts store all transcripts in panes (or the floating window).
    // Restoring after an empty workspace must reactivate one of those sessions,
    // rather than depending on the legacy saved reader field.
    const restoredSession = reader ?? panes.find(pane => sessionKey(pane) === selectedSessionKey) ?? panes[0] ?? floatingSession
    setWorkspaceHasSession(Boolean(restoredSession))
    setWorkspaceReaderSession(restoredSession ?? null)
    if (restoredSession && sessionKey(restoredSession) !== selectedSessionKey) setSelectedSessionKey(sessionKey(restoredSession))
    showNotice('info', `${saved.name} restored${missing > 0 ? ` · ${missing} session${missing === 1 ? '' : 's'} no longer here` : ''}`)
  })

  const deleteSavedWindowLayout = useStableEvent((id: string) => {
    try {
      deleteWindowLayout(windowLayoutProject, id)
      setSavedWindowLayouts(listSavedWindowLayouts(windowLayoutProject))
    } catch { /* the list stays as it was */ }
  })

  // A surface into the layout: out of the side panel, into a window, focused.
  // `another` opens a further window of a kind that can have several; otherwise
  // a kind already in a window is focused there rather than opened twice.
  const openSurfaceWindow = useStableEvent((kind: WindowSurfaceKind, options: { another?: boolean; fromPanelId?: string } = {}) => {
    if (isPluginSurfaceId(kind) && !isPluginEnabled(getPluginSurface(kind).pluginId)) {
      showNotice('info', `${getPluginSurface(kind).title.slice(2)} is off · turn its plugin on in Plugins (⌃K palette)`)
      return
    }
    const activePanel = activeSurface(surfacePanel)
    const movingPanel = options.fromPanelId ? surfacePanel.surfaces.find(entry => entry.id === options.fromPanelId && entry.kind === kind) : !options.another && activePanel?.kind === kind ? activePanel : null
    const existing = windowSurfaces.find((entry) => surfaceKindOf(entry) === kind)
    if (existing && !movingPanel && !(options.another && MULTI_INSTANCE_SURFACES.has(kind))) {
      pendingSurfaceFocusRef.current = existing
      setFocusedPane('messages')
      setWindowSurfaces((current) => [...current])
      return
    }
    let surface: WindowSurfaceId = kind
    // Ids held by background tabs and the floating window are taken too.
    const taken = new Set([...windowSurfaces, ...popoverTabs, ...[...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)])
    for (let instance = 2; taken.has(surface); instance += 1) surface = `${kind}#${instance}`
    checkpointWindowLayout()
    if (!movingPanel && pluginOverlay === kind) copySurfaceViewState(workspaceContext.runtime, 'root', surfaceViewNamespace(kind, surface), isPluginSurfaceId(kind) ? getPluginSurface(kind).pluginId : undefined)
    const remaining = surfacePanel.surfaces.filter((entry) => entry.id !== movingPanel?.id)
    if (movingPanel) {
      copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(kind, undefined, movingPanel.id), surfaceViewNamespace(kind, surface))
      const selected = workspaceContext.runtime.values.get(`${surfaceViewNamespace(kind, surface)}:process:selectedId`)
      if (typeof selected === 'string') windowShellSelectionRef.current.set(surface, selected)
      setSurfacePanel(current => closeSurfaceIn(current, movingPanel.id))
    }
    // A panel with nothing left in it would only take width from the windows.
    if (movingPanel && remaining.length === 0) setSurfacePanelOpen(false)
    setSurfacePanelFocused(false)
    setWindowSurfaces((current) => (current.includes(surface) ? current : [...current, surface]))
    setWindowSurfaceMeta(current => ({ ...current, [surface]: { ...current[surface], cwd: movingPanel?.cwd ?? gitRepoCwd } }))
    // A split holds two windows; a surface beyond that needs a stack or grid to appear.
    if (!windowSplitTree && splitArrangement === 'split' && splitPaneCount + windowSurfaces.length + 1 > SPLIT_PANE_MAX) setWindowArrangement('main-stack', splitReaderLast)
    // Focused once the layout has placed it: until then its index is unknown,
    // because opening it may drop a session pane to make room.
    pendingSurfaceFocusRef.current = surface
    setFocusedPane('messages')
    showNotice('info', `${surfaceTitle(surface)} in a window · ⇥ panel puts it back`)
  })
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
  const openPopoverWindow = useStableEvent((kind: PopoverWindowKind, pin: SurfaceMeta = pinFor(kind, readerPin()), placement: 'beside' | 'fill' | 'tab' = 'beside') => {
    // Store-backed panels stay open while windowed: opened as a window straight
    // from the palette, they must be opened first or their window closes at once.
    if (kind === 'teammates' && !teammatesOpen) openTeammatesPanel()
    setPopoverOpen(kind, false)
    if (placement === 'tab') { openPopoverInNewTab(kind, pin); return }
    if (placement === 'fill') { openPopoverTab(kind, pin); return }
    const parked = [...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)
    const existing = findPopoverWindow([...windowSurfaces, ...parked], windowSurfaceMeta, kind, pin)
    if (existing) {
      if (parked.includes(existing)) activateWindowTab(surfaceWindowKey(existing))
      pendingSurfaceFocusRef.current = existing
      setFocusedPane('messages')
      setWindowSurfaces((current) => [...current])
      return
    }
    const surface = nextSurfaceId(kind, new Set([...windowSurfaces, ...parked]))
    checkpointWindowLayout()
    if (isPluginSurfaceId(kind) && !POPOVER_WINDOWS[kind].single) copySurfaceViewState(workspaceContext.runtime, 'root', surfaceViewNamespace(kind, surface), isPluginSurfaceId(kind) ? getPluginSurface(kind).pluginId : undefined)
    setWindowSurfaceMeta((current) => ({ ...current, [surface]: pin }))
    setWindowSurfaces((current) => (current.includes(surface) ? current : [...current, surface]))
    if (!windowSplitTree && splitArrangement === 'split' && splitPaneCount + windowSurfaces.length + 1 > SPLIT_PANE_MAX) setWindowArrangement('main-stack', splitReaderLast)
    pendingSurfaceFocusRef.current = surface
    setFocusedPane('messages')
    showNotice('info', `${POPOVER_WINDOWS[kind].title.slice(2)} in a window · ⌃⇧W or ⤢ for full screen`)
  })
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
    write('windowZoom', 0)
    write('splitFocusIndex', 0)
    if (pinned) {
      write('openTabSessions', [pinned])
      write('selectedSessionKey', sessionKey(pinned))
    }
    controller.rename(workspace.id, WINDOW_SURFACE_TITLES[kind].slice(2))
  })
  // A popover as a tab of this workspace's tab strip, shown in the reader's place.
  const showPopoverTab = useStableEvent((id: WindowSurfaceId) => {
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
  const runPluginCommand = useStableEvent((command: ResolvedPluginCommand, session: Session | null = selectedSession) => {
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
    setPluginOverlay(opens)
  })
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
  // The session a surface shows: a session-pinned window its pin, otherwise the
  // one its latest open named, else the selection.
  const pluginSessionFor = (surfaceId: PluginSurfaceId, slot?: WindowSurfaceId): Session | null => {
    if (getPluginSurface(surfaceId).pin === 'session') return slot ? pinnedSessionOf(slot) : selectedSession
    return pluginOpenRequests[surfaceId]?.session ?? selectedSession
  }
  const pluginLiveTranscript = useMemo(() => ({ key: selectedSessionKey, messages: liveTranscriptMessagesForSession }), [selectedSessionKey, liveTranscriptMessagesForSession])
  // A window's plugin services: the shared ones, plus what that window showed
  // before a remount. Cached per window so a view's services keep their identity.
  const windowPluginServicesRef = useRef(new Map<WindowSurfaceId, { base: TuiProvidedPluginServices; value: TuiProvidedPluginServices }>())
  const windowPluginServices = (slot: WindowSurfaceId): TuiProvidedPluginServices => {
    const cached = windowPluginServicesRef.current.get(slot)
    if (cached?.base === pluginServices) return cached.value
    const value: TuiProvidedPluginServices = {
      ...pluginServices,
      'window-selection': {
        get initial() { return windowShellSelectionRef.current.get(slot) ?? null },
        changed: (id: string | null) => { windowShellSelectionRef.current.set(slot, id) },
      },
    }
    windowPluginServicesRef.current.set(slot, { base: pluginServices, value })
    return value
  }
  const closeFolderPicker = useStableEvent(() => setFolderPickerForNewSession(false))
  const folderPickerServices = useMemo((): TuiProvidedPluginServices => ({
    'directory-picker': { choose: (path: string) => handleNewSessionFolderSelected(path) },
    'scroll-preferences': pluginServices['scroll-preferences'],
  }), [pluginServices, handleNewSessionFolderSelected])
  const registerFolderPickerKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    folderPickerKeyHandlerRef.current = handler
  })
  const surfacePluginCaptureChange = useStableEvent((capture: TuiPluginCapture) => { surfacePluginKeyCaptureRef.current = capture })
  const closePluginOverlay = useStableEvent(() => {
    if (pluginOverlay === 'editor') { setEditorInitialPath(null); setEditorInitialLine(null) }
    if (pluginOverlay === 'checkpoints') setCheckpointFocusPrompt(null)
    setPluginOverlay(null)
  })
  // The file-history plugin, on a file: over the asking view, or as a window beside the layout.
  const openFileHistory = useStableEvent((path: string, where: 'overlay' | 'window' = 'overlay') => {
    if (!isPluginEnabled('file-history')) {
      showNotice('info', 'File history is off · turn it on in Plugins (⌃K palette)')
      return
    }
    if (where === 'window') openPopoverWindow('file-history', { path })
    else setFileHistoryPath(path)
  })
  const closeFileHistory = useStableEvent(() => setFileHistoryPath(null))
  const registerFileHistoryKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    fileHistoryKeyHandlerRef.current = handler
  })
  // Asking about a step leaves for the composer: the checkpoints overlay under
  // it goes too; the editor is left to its own close, which guards unsaved buffers.
  const fileHistoryServices = useMemo((): TuiProvidedPluginServices => ({
    ...pluginServices,
    composer: {
      ...pluginServices.composer!,
      askAboutSelection: (request: SelectionAskInput) => {
        void askAgentAboutSelection(request)
        setPluginOverlay((current) => (current === 'checkpoints' ? null : current))
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pluginServices])
  // Opens the editor on a file (1-based line, or null for its remembered place):
  // in its window when it has one (the open-popover effect routes it), else full screen.
  const openEditorAt = useStableEvent((path: string | null, line: number | null) => {
    if (!isPluginEnabled('editor')) {
      showNotice('info', 'The editor is off · turn it on in Plugins (⌃K palette)')
      return
    }
    setEditorInitialPath(path)
    setEditorInitialLine(line)
    setPluginOverlay('editor')
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
  const registerTeammatesKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    teammatesKeyHandlerRef.current = handler
  })
  const offerTeammatesPlacement = useStableEvent(() => offerPopoverPlacement('teammates'))
  const registerPluginOverlayKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    pluginOverlayKeyHandlerRef.current = handler
  })
  const pluginSelectedDetail = useMemo(() => ({ key: selectedSessionKey, detail: sessionDetail }), [selectedSessionKey, sessionDetail])
  const offerPopoverPlacement = useStableEvent((kind: WindowSurfaceKind) => {
    const beside = () => {
      if (isPopoverWindowKind(kind)) { openPopoverWindow(kind); return }
      setPopoverOpen(kind, false)
      openSurfaceWindow(kind)
    }
    setContextMenu({ x: Math.max(0, width - 34), y: 1, title: WINDOW_SURFACE_TITLES[kind], items: [
      { label: 'Beside the focused pane', hint: '⌃⇧W', run: beside },
      { label: 'As a tab in this workspace', run: () => (isPopoverWindowKind(kind) ? openPopoverWindow(kind, undefined, 'fill') : openPopoverTab(kind, {})) },
      { label: 'In a new workspace', run: () => { setPopoverOpen(kind, false); openPopoverInNewTab(kind, isPopoverWindowKind(kind) ? pinFor(kind, readerPin()) : {}) } },
    ] })
  })
  // A popover window back to full screen: on its pinned session, in the reader.
  const returnPopoverWindow = useStableEvent((surface: WindowSurfaceId) => {
    const kind = surfaceKindOf(surface)
    if (!isPopoverWindowKind(kind)) return
    const pinned = pinnedSessionOf(surface)
    const meta = windowSurfaceMeta[surface]
    if (isPluginSurfaceId(kind) && !POPOVER_WINDOWS[kind].single) copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(kind, surface), 'root', getPluginSurface(kind).pluginId)
    returningPopoverRef.current = true
    closeSurfaceWindow(surface, true)
    returningPopoverRef.current = false
    // Into the reader as a tab — never through the rail's path, which with this
    // (just closed, still focused this render) window would reopen the session
    // as a window and re-commit the window list it was closed from.
    if (pinned && sessionKey(pinned) !== selectedSessionKey) {
      if (!openTabByKey.has(sessionKey(pinned))) setOpenTabSessions((current) => [...current, pinned])
      selectTabSession(pinned)
    }
    setPopoverOpen(kind, true, meta)
  })
  const moveSurfaceToPanel = useStableEvent((surface: WindowSurfaceId) => {
    const kind = surfaceKindOf(surface)
    if (isPopoverWindowKind(kind)) { returnPopoverWindow(surface); return }
    const opened = openSurfaceIn(surfacePanel, kind)
    const nextPanel = { ...opened, surfaces: opened.surfaces.map(entry => entry.id === opened.activeId ? { ...entry, cwd: windowSurfaceMeta[surface]?.cwd ?? gitRepoCwd } : entry) }
    const panel = activeSurface(nextPanel)!
    copySurfaceViewState(workspaceContext.runtime, surfaceViewNamespace(kind, surface), surfaceViewNamespace(kind, undefined, panel.id))
    closeSurfaceWindow(surface, true)
    setSurfacePanelOpen(true)
    setSurfacePanelFocused(true)
    setSurfacePanel(nextPanel)
  })

  // The choice the window menu shows as current.
  const currentWindowLayoutAction: WindowLayoutAction | null = reconciledSplitTree ? null : visibleSplitPaneCount === 0
    ? 'fill'
    : splitArrangement === 'main-stack' ? 'main-stack'
    : splitArrangement === 'grid' ? (visibleSplitPaneCount > 3 ? 'grid-six' : 'grid')
    : stackedSplit ? (splitReaderLast ? 'reader-bottom' : 'reader-top')
    : splitReaderLast ? 'reader-right' : visibleSplitPaneCount === 1 ? 'two' : 'reader-left'

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
    if (action === 'fullscreen') { toggleWindowZoom(); return }
    if (action === 'fill') { toggleWindowZoom(); return }
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
  const tabWindowOnto = useStableEvent((key: string, anchor: string, session?: Session) => {
    if (key === anchor) return
    const primaryKey = shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null
    if (primaryKey && key === primaryKey) {
      checkpointWindowLayout()
      const frame = stackOf(liveWindowStacks, anchor)?.find(member => laidOutWindowKeys.has(member)) ?? anchor
      if (!laidOutWindowKeys.has(frame)) return
      const base = removePrimaryWindow(currentPaneTree())
      if (!base) return
      if (shownPopoverTab) closePopoverTab(shownPopoverTab, true)
      setWindowZoom(null)
      setWindowStacks(addToStack(liveWindowStacks, anchor, key))
      const keys = replaceWindowKey(orderedWindowKeys, frame, key)
      commitWindowKeys(keys, reconcileWindowSplitTree(base, keys, false))
      setOverviewPendingTarget(key)
      return
    }
    if (primaryKey && anchor === primaryKey) {
      checkpointWindowLayout()
      if (session && !openTabByKey.has(key)) setOpenTabSessions(current => [...current, session])
      const next = replacePrimaryWindow(currentPaneTree(), key)
      if (shownPopoverTab) closePopoverTab(shownPopoverTab, true)
      setWindowStacks(addToStack(liveWindowStacks, anchor, key))
      if (floatingKey === key) setFloatingWindow(null)
      commitWindowKeys(next.keys, next)
      setOverviewPendingTarget(key)
      return
    }
    const frame = stackOf(liveWindowStacks, anchor)?.find((member) => laidOutWindowKeys.has(member)) ?? anchor
    if (!laidOutWindowKeys.has(frame)) return
    checkpointWindowLayout()
    if (session && !openTabByKey.has(key)) setOpenTabSessions((prev) => prev.some(tab => sessionKey(tab) === sessionKey(session)) ? prev : [...prev, session])
    if (floatingKey === key) setFloatingWindow(null)
    setWindowStacks(addToStack(liveWindowStacks, anchor, key))
    commitWindowKeys(replaceWindowKey(shownFirstWindowKeys().filter((entry) => entry !== key), frame, key))
    showNotice('info', `${fitText(windowKeyTitle(key), 40).trimEnd()} · a tab of ${fitText(windowKeyTitle(anchor), 30).trimEnd()}`)
  })
  // Show tab `key` in its frame.
  const activateWindowTab = useStableEvent((key: string) => {
    const stack = windowStackFor(key)
    const frame = stack?.find((member) => laidOutWindowKeys.has(member))
    if (!stack || !frame || frame === key) return
    checkpointWindowLayout()
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
  const breakOutWindowTab = useStableEvent((key: string) => {
    const stack = windowStackFor(key)
    if (!stack) { showNotice('info', 'This window is not one of several tabs'); return }
    const frame = stack.find((member) => laidOutWindowKeys.has(member))!
    const anchor = frame === key ? stackSuccessor(stack, key)! : frame
    const base = { ...currentPaneTree() }
    if (frame === key) base.keys = base.keys.map(entry => entry === key ? anchor : entry)
    const geometry = computeWindowSplitTree(base, readerAreaWidth, windowAreaHeight, splitTreeLimits)
    const anchorRect = geometry.rects.get(base.keys.indexOf(anchor))
    for (const edge of ['right', 'bottom'] as const) {
      const enough = anchorRect && (edge === 'right' ? anchorRect.width >= 2 * SPLIT_PANE_MIN_WIDTH : anchorRect.height >= 2 * SPLIT_PANE_MIN_ROWS)
      if (!enough) continue
      const next = placeWindowSplit(base, key, anchor, edge)
      if (!next || computeWindowSplitTree(next, readerAreaWidth, windowAreaHeight, splitTreeLimits).layout.visibleCount !== next.keys.length) continue
      checkpointWindowLayout()
      setWindowStacks(removeFromStack(liveWindowStacks, key))
      setWindowZoom(null)
      commitWindowKeys(next.keys, next)
      setOverviewPendingTarget(key)
      return
    }
    // A tab must never detach into responsive overflow or squeeze its neighbours.
    floatWindowKey(key)
    showNotice('info', 'Detached into a floating window · no room beside this pane')
  })
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
    if (!floatingWindow || floatGestureRef.current) return
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
  const moveFloatGesture = (event: { x: number; y: number }) => {
    const gesture = floatGestureRef.current
    if (!gesture || !floatingWindow) return
    if (!gesture.moved) {
      if (Math.abs(event.x - gesture.x) + Math.abs(event.y - gesture.y) < 2) return
      checkpointWindowLayout()
      gesture.moved = true
    }
    if (gesture.mode === 'move') {
      const dock = floatDockTarget(event)
      const area = windowAreaRect()
      const pane = dock?.kind === 'tab' ? rectOf(`split-pane:${dock.pane}`) : null
      const target = dropTargetAt(event)
      const edge = target.pane === null ? target.zone : target.insert
      const plan = edge && edge !== 'center' && !target.title ? nestedDropPlan(floatingWindow.key, target) : null
      const splitRect = plan?.geometry.rects.get(plan.tree.keys.indexOf(floatingWindow.key))
      setFloatDockHint(splitRect && area
        ? { label: 'Split here', rect: { ...splitRect, x: splitRect.x + area.x, y: splitRect.y + area.y }, x: event.x, y: event.y }
        : dock && area
        ? { label: dock.kind === 'tab' ? `Add as a tab of window ${dock.pane + windowNumberOffset}` : 'Dock into the layout', rect: pane ? { ...pane, height: Math.min(pane.height, 3) } : area, x: event.x, y: event.y }
        : null)
    }
    const area = windowAreaRect() ?? { width: readerAreaWidth, height: windowAreaHeight }
    const dx = event.x - gesture.x
    const dy = event.y - gesture.y
    const rect = gesture.mode === 'move'
      ? { ...gesture.rect, x: gesture.rect.x + dx, y: gesture.rect.y + dy }
      : { ...gesture.rect, width: gesture.rect.width + dx, height: gesture.rect.height + dy }
    setFloatingWindow({ ...floatingWindow, rect: clampFloatingRect(rect, area) })
  }
  floatGestureImplRef.current = { start: (event) => startFloatGesture('move', event), move: (event) => moveFloatGesture(event), end: (event) => endFloatGesture(event) }
  const endFloatGesture = (event?: { x: number; y: number }) => {
    const gesture = floatGestureRef.current
    floatGestureRef.current = null
    setFloatGesturing(false)
    setFloatDockHint(null)
    if (!gesture?.moved || gesture.mode !== 'move' || !event || !floatingKey) return
    const target = dropTargetAt(event)
    const edge = target.pane === null ? target.zone : target.insert
    if (edge && edge !== 'center' && !target.title && nestedDropPlan(floatingKey, target)) {
      setFloatingWindow(current => current ? { ...current, rect: gesture.rect } : current)
      applyNestedDrop(floatingKey, target)
      return
    }
    const dock = floatDockTarget(event)
    if (dock?.kind === 'tab') {
      const target = windowItems[dock.pane]
      if (target) {
        // Back where it started, so undo returns it to the place it was dragged from.
        setFloatingWindow((current) => current ? { ...current, rect: gesture.rect } : current)
        tabWindowOnto(floatingKey, windowItemKey(target))
      }
    } else if (dock?.kind === 'edge') {
      setFloatingWindow((current) => current ? { ...current, rect: gesture.rect } : current)
      dockFloatingWindow()
    }
  }
  // Esc during a drag puts everything back as it was when the drag started.
  const cancelPointerGesture = (): boolean => {
    if (treeDividerDrag !== null) {
      setTreeDividerDrag(null)
      treeDividerActivePathRef.current = null
      if (treeDividerCheckpointedRef.current) undoWindowLayout()
      treeDividerCheckpointedRef.current = false
      return true
    }
    if (floatGestureRef.current) {
      const gesture = floatGestureRef.current
      floatGestureRef.current = null
      setFloatGesturing(false)
      setFloatDockHint(null)
      setFloatingWindow((current) => current ? { ...current, rect: gesture.rect } : current)
      return true
    }
    if (sessionPressRef.current?.dragging) {
      sessionPressRef.current = null
      setSessionPressing(false)
      setSessionDrag(null)
      return true
    }
    if (splitDividerDragging) {
      const moved = splitDividerPoint !== null
      setSplitDividerDragging(null)
      setSplitDividerPoint(null)
      if (moved) undoWindowLayout()
      return true
    }
    return false
  }

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
  const dropSessionOnSurfaceWindow = useStableEvent((session: Session, index: number, edge: WindowDropZone | null, fromPane: number | null) => {
    const key = sessionKey(session)
    const surface = windowItems[index]
    if (!surface || surface.kind !== 'surface') return
    if (fromPane !== null && windowItems[fromPane]?.kind === 'session') {
      if (!edge) { swapWindows(fromPane, index); return }
      checkpointWindowLayout()
      applyWindowOrder(moveWindowBeside(shownFirstWindowKeys(), key, surfaceWindowKey(surface.surface), edge === 'left' || edge === 'top'))
      return
    }
    if (splitPinnedKeys.slice(0, splitPaneCount).includes(key)) {
      checkpointWindowLayout()
      applyWindowOrder(moveWindowBeside(shownFirstWindowKeys(), key, surfaceWindowKey(surface.surface), edge === 'left' || edge === 'top'))
      return
    }
    const plan = planWindowSessionDrop({
      arrangement: splitArrangement, orientation: splitOrientation,
      readerLast: splitReaderLast, count: splitPaneCount, pins: splitPinnedKeys,
    }, key, { kind: 'edge', zone: splitReaderLast ? 'left' : stackedSplit ? 'bottom' : 'right' })
    if (!plan) { showNotice('info', 'The layout is full · drop on a session pane to replace it'); return }
    checkpointWindowLayout()
    setOpenTabSessions((prev) => prev.some((tab) => sessionKey(tab) === key) ? prev : [...prev, session])
    setWindowArrangement(plan.arrangement, plan.readerLast)
    applySplitOrientation(plan.orientation, true)
    setSplitPaneCount(plan.count)
    void writeTuiSplitPanes(plan.count).catch(() => {})
    const anchor = surfaceWindowKey(surface.surface)
    const withSession = [...shownFirstWindowKeys().filter((entry) => entry !== key), key]
    const nextOrder = moveWindowBeside(withSession, key, anchor, edge === 'left' || edge === 'top')
    setWindowOrder(nextOrder)
    const sessionsInOrder = nextOrder.filter((entry) => !isSurfaceWindowKey(entry))
    setSplitPinnedKeys([...sessionsInOrder, ...plan.pins.filter((pin) => !sessionsInOrder.includes(pin))])
    showNotice('info', `${fitText(formatSessionTitle(session), 40).trimEnd()} · beside ${surfaceTitle(surface.surface)}`)
  })

  const rectOf = (id: string) => {
    // A popover tab holds the reader's place, so the reader's frame is the tab's
    // (the transcript behind it is hidden and has no size of its own).
    const box = renderer.root.findDescendantById(id === 'transcript-reader' && shownPopoverTab ? 'popover-tab-frame' : id) as unknown as { x: number; y: number; width: number; height: number } | null
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }
  const inside = (rect: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }) =>
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  // What a drag would land on: a pane under the pointer, else an edge or the
  // middle of the reader (relative to the reader, so its edges stay reachable
  // when panes fill the rest of the area).
  const dropTargetAt = (point: { x: number; y: number }): { zone: WindowDropZone | null; pane: number | null; insert: WindowDropZone | null; title: boolean } => {
    for (let index = 0; index < visibleSplitPaneCount; index += 1) {
      const slot = renderer.root.findDescendantById(`split-pane:${index}`)
      if (!slot || !slot.visible) continue
      const pane = rectOf(`split-pane:${index}`)
      if (!pane || !inside(pane, point)) continue
      // The title row adds a tab; a pane's own edges insert beside it; its middle replaces it.
      if (point.y === pane.y) return { zone: null, pane: index, insert: null, title: true }
      const zone = windowDropZone(pane, point)
      return { zone: null, pane: index, insert: zone && zone !== 'center' ? zone : null, title: false }
    }
    const reader = rectOf('transcript-reader')
    return { zone: reader ? windowDropZone(reader, point) : null, pane: null, insert: null, title: false }
  }

  const windowAreaRect = () => {
    const box = windowAreaRef.current
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }

  // A session dropped on the window area: an edge makes it a pane on that
  // side, the middle opens it in the reader.
  const dropSessionInWindow = useStableEvent((session: Session, zone: WindowDropZone, fromPane: number | null) => {
    if (zone === 'center') {
      checkpointWindowLayout()
      if (fromPane !== null) selectTabSession(session)
      else selectSidebarSession(session)
      return
    }
    const pane = splitFocusIndex !== null && splitFocusIndex >= 0 && splitFocusIndex < windowItems.length ? splitFocusIndex : hasPrimaryFrame ? null : windowItems.length ? 0 : null
    applyNestedDrop(sessionKey(session), { pane, zone: pane === null ? zone : null, insert: pane === null ? null : zone }, session)
  })

  // A surface window dropped on the reader floats where it was let go.
  const floatSurfaceAt = useStableEvent((surface: WindowSurfaceId, point: { x: number; y: number }) => {
    const area = windowAreaRect()
    floatWindowKey(surfaceWindowKey(surface))
    if (!area) return
    const rect = defaultFloatingRect(area)
    setFloatingWindow((current) => current ? { ...current, rect: clampFloatingRect({ ...rect, x: point.x - area.x - 4, y: point.y - area.y }, area) } : current)
  })

  const nestedDropPlan = (movingKey: string, target: { pane: number | null; zone: WindowDropZone | null; insert: WindowDropZone | null; title?: boolean }) => {
    const edge = target.pane === null ? target.zone : target.insert
    if (!edge || edge === 'center' || target.title || windowZoom !== null || fullscreenMode) return null
    if (orderedWindowKeys.length !== fittedWindowKeys.length) return null
    const anchor = target.pane === null ? null : windowItems[target.pane] ? windowItemKey(windowItems[target.pane]!) : undefined
    if (anchor === undefined) return null
    const rects = windowLayoutRects(fittedWindows, { width: readerAreaWidth, height: windowAreaHeight, orientation: splitOrientation, readerLast: splitReaderLast })
    let base = reconciledSplitTree ?? { keys: orderedWindowKeys, root: splitTreeFromRects(rects.map((rect, index) => ({ ...rect, slot: index - 1 }))) }
    const stack = windowStackFor(movingKey)
    if (stack?.includes(anchor ?? '')) return null
    const successor = stack && orderedWindowKeys.includes(movingKey) ? stackSuccessor(stack, movingKey) : null
    if (successor) base = { ...base, keys: base.keys.map(key => key === movingKey ? successor : key) }
    const primaryKey = shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : null
    // Onto its own edge, a window moves to that side of the whole layout.
    const ownSlot = movingKey === anchor ? base.keys.indexOf(movingKey) : -1
    const next = primaryKey && movingKey === primaryKey ? placePaneSlot(base, -1, target.pane ?? -1, edge)
      : ownSlot >= 0 ? movePaneToEdge(base, ownSlot, edge)
      : movingKey === anchor ? null
      : placeWindowSplit(base, movingKey, anchor, edge)
    if (!next) return null
    const geometry = computeWindowSplitTree(next, readerAreaWidth, windowAreaHeight, splitTreeLimits)
    if (geometry.layout.visibleCount !== next.keys.length) return null
    // Refuse a new split that borrows minimum-size space from unrelated panes.
    if (!orderedWindowKeys.includes(movingKey) && movingKey !== primaryKey) {
      const frame = target.pane === null ? rectOf('transcript-reader') : rectOf(`split-pane:${target.pane}`)
      const horizontal = edge === 'left' || edge === 'right'
      const required = horizontal ? SPLIT_PANE_MIN_WIDTH + (target.pane === null ? MIN_READER_WIDTH : SPLIT_PANE_MIN_WIDTH) : SPLIT_PANE_MIN_ROWS + (target.pane === null ? MIN_READER_ROWS : SPLIT_PANE_MIN_ROWS)
      if (!frame || (horizontal ? frame.width : frame.height) < required) return null
    }
    return { tree: next, geometry, key: movingKey }
  }
  const applyNestedDrop = useStableEvent((movingKey: string, target: { pane: number | null; zone: WindowDropZone | null; insert: WindowDropZone | null; title?: boolean }, session?: Session) => {
    const plan = nestedDropPlan(movingKey, target)
    if (!plan) { showNotice('info', 'That split does not fit · enlarge the target pane first'); return }
    checkpointWindowLayout()
    if (session && !openTabByKey.has(movingKey)) setOpenTabSessions(current => [...current, session])
    const keys = plan.tree.keys
    if (windowStackFor(movingKey)) setWindowStacks(removeFromStack(liveWindowStacks, movingKey))
    if (floatingKey === movingKey) setFloatingWindow(null)
    commitWindowKeys(keys, plan.tree)
    setOverviewPendingTarget(movingKey)
  })
  const dragMovingKey = sessionDrag?.tab ?? (sessionDrag?.surface ? surfaceWindowKey(sessionDrag.surface) : sessionDrag?.session ? sessionKey(sessionDrag.session) : null)
  const nestedDragPreview = sessionDrag && dragMovingKey ? nestedDropPlan(dragMovingKey, sessionDrag) : null

  // Preview the same operation plan and geometry that applying it consumes.
  // This is read-only: hovering and dragging never rewrite the current layout.
  const projectedWindowGeometry = (() => {
    if ((!windowPickerOpen || !windowLayoutPreview) && !sessionDrag) return null
    let previewSplitTree: WindowSplitTree | null = null
    let previewPrimary = primaryLeaf
    let plan = { arrangement: splitArrangement, orientation: splitOrientation, readerLast: splitReaderLast, count: splitPaneCount }
    let readerShare = splitReaderShare
    let secondaryShare = splitSecondaryShare
    let bottomShare = splitBottomShare
    let weights: WindowWeights = splitWeights
    let surfaces = windowSurfaces.length
    let missing = 0
    let previewFloating = floatingKey && floatingWindow ? floatingWindow.rect : null
    if (sessionDrag) {
      if (!sessionDrag.session || sessionDrag.title || sessionKey(sessionDrag.session) === selectedSessionKey) return null
      if (sessionDrag.pane !== null && windowItems[sessionDrag.pane]?.kind === 'surface') return null
      const dropPin = sessionDrag.pane !== null ? pinIndexOfWindow(sessionDrag.pane) : -1
      const drop: WindowSessionDrop | null = sessionDrag.pane !== null && dropPin >= 0
        ? sessionDrag.insert ? { kind: 'insert', index: dropPin, edge: sessionDrag.insert } : { kind: 'replace', index: dropPin }
        : sessionDrag.zone && sessionDrag.zone !== 'center' ? { kind: 'edge', zone: sessionDrag.zone } : null
      if (drop) {
        const next = planWindowSessionDrop({ ...plan, pins: splitPinnedKeys }, sessionKey(sessionDrag.session), drop)
        if (!next) return null
        plan = next
      } else if (sessionDrag.zone !== 'center') return null
    } else if (windowLayoutPreview?.startsWith('saved:')) {
      const saved = savedWindowLayouts.find((entry) => entry.id === windowLayoutPreview.slice(6))
      if (!saved) return null
      const known = new Set([...sessions, ...openTabSessions].map(sessionKey))
      const savedFloating = saved.floating
      previewFloating = savedFloating && (isSurfaceWindowKey(savedFloating.key) ? surfaceRestorable(surfaceIdOfKey(savedFloating.key)) : known.has(savedFloating.key)) ? savedFloating.rect : null
      previewPrimary = Boolean(saved.reader && known.has(saved.reader) && (saved.primaryOpen ?? saved.splitTree?.primary !== false)) || Boolean(saved.activePopoverTab && saved.popoverTabs?.includes(saved.activePopoverTab) && surfaceRestorable(saved.activePopoverTab))
      if (validWindowSplitTree(saved.splitTree)) {
        const restoredTree = previewPrimary ? saved.splitTree : removePrimaryWindow(saved.splitTree)
        previewSplitTree = restoredTree ? reconcileWindowSplitTree(restoredTree, restoredTree.keys.filter(key => isSurfaceWindowKey(key) ? surfaceRestorable(surfaceIdOfKey(key)) : known.has(key)), previewPrimary) : null
      } else if (!previewPrimary) {
        const keys = orderWindows(saved.order ?? [], saved.panes.filter(key => known.has(key)), saved.surfaces.filter(surfaceRestorable))
        if (keys.length) previewSplitTree = { primary: false, keys,
          root: keys.map((_, slot) => ({ slot })).reduce<import('./windowSplitTree').WindowSplitNode>((root, node, index) => index === 0 ? node : ({ axis: saved.orientation === 'columns' ? 'x' : 'y', ratio: index / (index + 1), first: root, second: node }), { slot: 0 }) }
      }
      const available = saved.panes.filter((key) => known.has(key)).length
      missing = saved.panes.length - available + (saved.reader && !known.has(saved.reader) ? 1 : 0)
      if (savedFloating && !isSurfaceWindowKey(savedFloating.key) && !known.has(savedFloating.key)) missing++
      plan = { ...saved, count: available }
      readerShare = saved.readerShare
      secondaryShare = saved.secondaryShare
      bottomShare = saved.bottomShare ?? SPLIT_SHARE_EVEN
      weights = saved.weights ?? {}
      surfaces = saved.surfaces.filter(surfaceRestorable).length
    } else if (windowLayoutPreview?.startsWith('action:')) {
      const action = windowLayoutPreview.slice(7) as WindowLayoutAction
      if (action === 'fullscreen' || action === 'fill') {
        const area = { width: readerAreaWidth, height: windowAreaHeight }
        if (splitFocusIndex === FLOATING_PANE_INDEX && previewFloating) {
          const rects = [clampFloatingRect(previewFloating, area)]
          return { rects, overflowRows: 0, lines: windowPreviewLines(rects, area), detail: 'Floating window · dock it to use a tiled layout' }
        }
        const rects = [{ x: 0, y: 0, ...area }, ...(previewFloating ? [clampFloatingRect(previewFloating, area)] : [])]
        return { rects, overflowRows: 0, lines: windowPreviewLines(rects, area), detail: `Focused pane fills the workspace${previewFloating ? ' · 1 floating' : ' · other panes preserved'}` }
      }
      previewSplitTree = planPaneArrangement(action)
      if (!previewSplitTree) return null
      plan.count = previewSplitTree.keys.filter(key => !isSurfaceWindowKey(key)).length
      surfaces = previewSplitTree.keys.length - plan.count
    }

    const input = {
      ...plan, width: readerAreaWidth, height: windowBudgetHeight,
      requestedCount: plan.count + surfaces, availableCount: plan.count + surfaces,
      maxPanes: plan.arrangement === 'split' ? SPLIT_PANE_MAX : SPLIT_PANE_ARRANGED_MAX,
      readerShare, secondaryShare, bottomShare, weights,
      minPaneWidth: SPLIT_PANE_MIN_WIDTH, minPaneRows: SPLIT_PANE_MIN_ROWS,
      minReaderWidth: MIN_READER_WIDTH, minReaderRows: MIN_READER_ROWS,
    }
    let previewGeometry = previewSplitTree ? computeWindowSplitTree(previewSplitTree, input.width, input.height, splitTreeLimits) : null
    const previewOverflow = previewGeometry && previewGeometry.layout.visibleCount < previewSplitTree!.keys.length ? 1 : 0
    if (previewGeometry && previewOverflow) previewGeometry = computeWindowSplitTree(previewSplitTree!, input.width, Math.max(1, input.height - 1), splitTreeLimits)
    const result = previewGeometry ? { layout: previewGeometry.layout, overflowRows: previewOverflow } : computeResponsiveWindowLayout(input)
    const area = { width: input.width, height: Math.max(1, input.height - result.overflowRows) }
    const rects = previewGeometry ? [...(previewGeometry.rects.has(-1) ? [previewGeometry.rects.get(-1)!] : []), ...Array.from({ length: previewGeometry.layout.visibleCount }, (_, index) => previewGeometry!.rects.get(index)!)] : windowLayoutRects(result.layout, { ...input, ...area })
    if (!previewGeometry && !previewPrimary) rects.shift()
    const tiledCount = rects.length
    if (previewFloating) rects.push(clampFloatingRect(previewFloating, area))
    const hidden = input.availableCount - result.layout.visibleCount
    return {
      rects, overflowRows: result.overflowRows,
      lines: windowPreviewLines(rects, area),
      detail: `${area.width}×${area.height} · ${tiledCount} visible${previewFloating ? ' · 1 floating' : ''}${hidden ? ` · ${hidden} hidden` : ''}${missing ? ` · ${missing} missing` : ''}`,
    }
  })()

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

  // The divider between the reader and its panes, dragged to a new share.
  const dragSplitDivider = useStableEvent((event: { x: number; y: number }) => {
    if (splitDividerPoint === null) checkpointWindowLayout()
    const area = windowAreaRect()
    if (!area) return
    setSplitDividerPoint({ x: event.x, y: event.y })
    if (splitDividerDragging && typeof splitDividerDragging === 'object') {
      // A border inside a group: the cell under the pointer becomes the last
      // cell of the frame before it; the frame after it takes up the rest of the pair.
      const { group: groupKey, index } = splitDividerDragging
      const group = fittedWindows.groups.find((entry) => entry.key === groupKey)
      const rects = group?.members.map((member) => rectOf(`split-pane:${member}`)) ?? []
      if (!group || rects.some((rect) => !rect)) return
      const horizontal = group.axis === 'x'
      const extents = rects.map((rect) => (horizontal ? rect!.width : rect!.height))
      const before = rects[index]!
      const combined = extents[index]! + extents[index + 1]!
      const min = horizontal ? SPLIT_PANE_MIN_WIDTH : SPLIT_PANE_MIN_ROWS
      const first = Math.max(min, Math.min(combined - min, (horizontal ? event.x - before.x : event.y - before.y) + 1))
      if (first === extents[index]) return
      extents[index] = first
      extents[index + 1] = combined - first
      setSplitWeights((current) => ({ ...current, [groupKey]: extents }))
      return
    }
    if (splitDividerDragging === 'secondary') {
      // The row the pointer is on becomes the first frame's bottom border.
      const next = Math.min(0.8, Math.max(0.2, Math.round(((event.y - area.y + 1) / Math.max(1, area.height)) * 100) / 100))
      if (next !== splitSecondaryShare) setSplitSecondaryShare(next)
      return
    }
    const share = readerShareAt(area, stackedSplit ? event.y : event.x, stackedSplit ? 'y' : 'x', splitReaderLast)
    const next = Math.min(SPLIT_SHARE_MAX, Math.max(SPLIT_SHARE_MIN, Math.round(share * 100) / 100))
    if (next !== splitReaderShare) setSplitReaderShare(next)
  })
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

  const resizeSplitReader = useStableEvent((direction: 1 | -1 | 0) => {
    if (reconciledSplitTree) {
      if (direction === 0) { checkpointWindowLayout(); setWindowSplitTree({ ...reconciledSplitTree, root: evenWindowSplitTree(reconciledSplitTree.root) }) }
      else resizeTreeWindow(-1, direction)
      return
    }
    checkpointWindowLayout()
    if (visibleSplitPaneCount === 0) {
      showNotice('error', 'No split panes open (⌃B % to split)')
      return
    }
    const next = direction === 0
      ? SPLIT_SHARE_EVEN
      : adjustSplitReaderShare(
        splitReaderShare,
        direction * SPLIT_SHARE_STEP,
        evenSplitReaderShare(visibleSplitPaneCount),
      )
    if (next === splitReaderShare) {
      showNotice('info', direction === 0
        ? 'Split sizes are already even'
        : direction > 0 ? 'Reader is already at its widest' : 'Reader is already at its narrowest')
      return
    }
    setSplitReaderShare(next)
    void writeTuiSplitReaderShare(next).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store split ratio')
    })
    showNotice('info', next === SPLIT_SHARE_EVEN
      ? 'Split ratio: even'
      : `Reader ${Math.round(next * 100)}% of the ${splitOrientation === 'rows' ? 'height' : 'width'}`)
  })

  // ── Split pane focus ───────────────────────────────────────────────────────
  // Focus is a third keyboard owner alongside the sidebar and the reader. It is
  // an index rather than a session key so a pane keeps focus when its pinned
  // session changes under it (⌃B n).
  const focusSplitPane = useStableEvent((paneIndex: number) => {
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
    if (next === null) { setWindowSurfacePeek(null); setSplitFocusIndex(null); setFocusedPane('messages') }
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
  useEffect(() => {
    const pending = pendingSurfaceFocusRef.current
    if (!pending) return
    const index = windowItems.findIndex((item) => item.kind === 'surface' && item.surface === pending)
    if (index < 0) {
      if (!windowSurfaces.includes(pending)) return
      pendingSurfaceFocusRef.current = null
      setWindowSurfacePeek(pending)
      setSplitFocusIndex(-1)
      setSurfacePanelFocused(false)
      showNotice('info', 'Hidden window · Esc or ⌃B m restores the layout')
      return
    }
    pendingSurfaceFocusRef.current = null
    setWindowZoom(null)
    setSplitFocusIndex(index)
  })

  // A zoom ends when the window it names goes away.
  useEffect(() => {
    if (windowZoom === null) return
    if (windowZoom === 'reader' ? !hasPrimaryFrame : windowZoom >= windowItems.length) setWindowZoom(null)
  }, [hasPrimaryFrame, windowItems.length, windowZoom])

  const toggleWindowZoom = useStableEvent((target: number | null = splitFocusIndex) => {
    if (windowSurfacePeek) { setWindowSurfacePeek(null); setWindowZoom(null); setSplitFocusIndex(null); return }
    checkpointWindowLayout()
    if (windowZoom !== null) {
      setWindowZoom(null)
      showNotice('info', 'Layout restored')
      return
    }
    if (orderedWindowKeys.length === 0) {
      showNotice('info', 'The pane already fills the workspace')
      return
    }
    if (target === FLOATING_PANE_INDEX) { showNotice('info', 'A floating window is not in the layout · ⌃B f docks it'); return }
    setWindowZoom(target ?? 'reader')
    showNotice('info', 'Zoomed · ⌃B m restores the layout')
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
  const resizeFocusedWindow = useStableEvent((direction: 1 | -1, focus: number | null = splitFocusIndex) => {
    if (reconciledSplitTree) { resizeTreeWindow(focus ?? -1, direction); return }
    const group = focus === null ? undefined : fittedWindows.groups.find((entry) => entry.members.includes(focus))
    if (focus === null || !group) {
      showNotice('info', 'Focus a pane that shares a divider with another pane')
      return
    }
    const horizontal = group.axis === 'x'
    const extents = group.members.map((member) => (horizontal ? fittedWindows.panes[member]!.width : fittedWindows.panes[member]!.height))
    const at = group.members.indexOf(focus)
    const neighbour = at < group.members.length - 1 ? at + 1 : at - 1
    const min = horizontal ? SPLIT_PANE_MIN_WIDTH : SPLIT_PANE_MIN_ROWS
    const step = horizontal ? 4 : 2
    const pair = extents[at]! + extents[neighbour]!
    const next = Math.max(min, Math.min(pair - min, extents[at]! + direction * step))
    if (next === extents[at]) {
      showNotice('info', direction > 0 ? 'That pane is as large as its neighbour allows' : 'That pane is at its smallest')
      return
    }
    checkpointWindowLayout()
    extents[at] = next
    extents[neighbour] = pair - next
    const weights = { ...splitWeights, [group.key]: extents }
    setSplitWeights(weights)
    void writeTuiWindowArrangement({ arrangement: splitArrangement, readerLast: splitReaderLast, secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights }).catch(() => {})
  })

  // ⌃B ⇧arrows: swap the focused window with the one that way; focus moves with it.
  const swapWindowInDirection = useStableEvent((direction: WindowDirection, target: number | null = splitFocusIndex) => {
    checkpointWindowLayout()
    if (visibleSplitPaneCount === 0) {
      showNotice('error', 'No split panes open (⌃B % to split)')
      return
    }
    const windows: Array<{ id: number; rect: { x: number; y: number; width: number; height: number } }> = []
    const reader = rectOf('transcript-reader')
    if (reader) windows.push({ id: -1, rect: reader })
    for (let index = 0; index < visibleSplitPaneCount; index += 1) {
      const pane = rectOf(`split-pane:${index}`)
      if (pane) windows.push({ id: index, rect: pane })
    }
    const from = target ?? -1
    const to = windowInDirection(windows, from, direction)
    if (to === null) {
      showNotice('info', `No window ${direction === 'up' ? 'above' : direction === 'down' ? 'below' : `to the ${direction}`}`)
      return
    }
    setWindowSplitTree(swapPaneSlots(currentPaneTree(), from, to))
    if (from === -1) focusReaderFromSplit()
    else focusSplitPane(from)
  })

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
  const cycleSplitPaneSession = useStableEvent(() => {
    checkpointWindowLayout()
    if (splitPaneCount === 0) {
      showNotice('error', 'Split transcript view is off (⌃B % to split)')
      return
    }
    const candidateKeys = splitCandidateSessions.map((tab) => sessionKey(tab))
    if (candidateKeys.length <= splitPaneCount) {
      showNotice('info', 'No other open tab to swap into the split pane')
      return
    }
    const target = splitFocusIndex === null ? 0 : pinIndexOfWindow(splitFocusIndex)
    setSplitPinnedKeys((current) => {
      if (target < 0 || target >= current.length) return current
      const heldByOtherPanes = new Set(current.filter((_, i) => i !== target))
      const from = candidateKeys.indexOf(current[target]!)
      for (let step = 1; step <= candidateKeys.length; step += 1) {
        const nextKey = candidateKeys[(from + step) % candidateKeys.length]!
        if (nextKey !== current[target] && !heldByOtherPanes.has(nextKey)) {
          const next = [...current]
          next[target] = nextKey
          return next
        }
      }
      return current
    })
  })

  const jumpToNextWindowAttention = useStableEvent(() => {
    const order = [...(selectedSessionKey ? [selectedSessionKey] : []), ...splitPinnedKeys]
    const target = nextWindowNeedingAttention(order, focusedWindowKey, (key) => Boolean(badgeForWindow(key)))
    if (!target) { showNotice('info', 'No windows need attention'); return }
    pickWindowTarget(target)
  })

  const pickWindowTarget = useStableEvent((key: string) => {
    const target = windowTargets.find((entry) => entry.key === key)
    if (!target) { showNotice('info', 'That window is no longer open'); return }
    if (key === floatingKey) { setWindowSwitcherOpen(false); setFocusedPane('messages'); setSplitFocusIndex(FLOATING_PANE_INDEX); return }
    if (parkedWindowKeysRef.current.has(key)) {
      setWindowSwitcherOpen(false)
      activateWindowTab(key)
      if (isSurfaceWindowKey(key)) pendingSurfaceFocusRef.current = surfaceIdOfKey(key)
      return
    }
    setWindowSwitcherOpen(false)
    if (isSurfaceWindowKey(key) && popoverTabs.includes(surfaceIdOfKey(key))) { showPopoverTab(surfaceIdOfKey(key)); return }
    setWindowZoom(null)
    setWindowSurfacePeek(null)
    setSurfacePanelFocused(false)
    setFocusedPane('messages')
    if (target.session) {
      const pane = windowItems.findIndex((item) => item.kind === 'session' && sessionKey(item.session) === key)
      if (pane >= 0) focusSplitPane(pane)
      else {
        // A watched run keeps its lead's window (the first): a hidden teammate
        // trades places with the first teammate shown.
        const lead = splitPinnedKeys[0]
        const shownTeammate = watchedCoordinator ? splitPaneSessions.find((session) => sessionKey(session) !== lead) : undefined
        if (key !== selectedSessionKey && shownTeammate) {
          checkpointWindowLayout()
          const first = sessionKey(shownTeammate)
          const swap = (keys: string[]) => keys.map(entry => entry === key ? first : entry === first ? key : entry)
          setSplitPinnedKeys(swap)
          setWindowOrder(swap)
          focusSplitPane(windowItems.findIndex((item) => item.kind === 'session' && sessionKey(item.session) === first))
          return
        }
        if (key !== selectedSessionKey) {
          checkpointWindowLayout()
          // The hidden window trades places with the selected session's, so it
          // is shown and the order keeps every window; picking the other back
          // trades them again. The selection may be an unpinned preview tab:
          // keep it as a tab instead of letting reconciliation drop it.
          const current = selectedSession
          const currentKey = current ? sessionKey(current) : null
          setOpenTabSessions((tabs) => current && !tabs.some((tab) => sessionKey(tab) === currentKey) ? [...tabs, current] : tabs)
          if (currentKey) {
            const swap = (keys: string[]) => keys.map((entry) => entry === key ? currentKey : entry === currentKey ? key : entry)
            setSplitPinnedKeys(swap)
            setWindowOrder(swap)
          }
          selectTabSession(target.session)
        }
        focusReaderFromSplit()
      }
    } else if (target.surface) {
      const pane = windowItems.findIndex((item) => item.kind === 'surface' && item.surface === target.surface)
      if (pane >= 0) focusSplitPane(pane)
      else {
        // A hidden surface can be inspected at full size without changing the
        // logical layout or mounting it in the side panel at the same time.
        setWindowSurfacePeek(target.surface)
        setSplitFocusIndex(-1)
        showNotice('info', 'Hidden window · Esc or ⌃B m restores the layout')
      }
    }
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

  const executeCommandPalette = useStableEvent((id: string) => {
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
  })

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
    const visible = shownPopoverTab && key === surfaceWindowKey(shownPopoverTab) ? windowZoom === null || windowZoom === 'reader' 
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

  const splitFocusedWindow = useStableEvent((orientation: SplitPaneOrientation, target: number | null = splitFocusIndex) => {
    if (target === FLOATING_PANE_INDEX) { showNotice('info', 'Dock the floating window before splitting it'); return }
    if (orderedWindowKeys.length >= 31) { showNotice('info', 'This workspace has reached its 32-window limit'); return }
    if (windowZoom !== null || fullscreenMode) { showNotice('info', 'Restore the layout before splitting a window'); return }
    if (visibleSplitPaneCount !== orderedWindowKeys.length) { showNotice('info', 'Enlarge the terminal to show all windows before adding a split'); return }
    const axis = orientation === 'columns' ? 'x' : 'y'
    const targetRect = rectOf(target === null ? 'transcript-reader' : `split-pane:${target}`)
    const targetMinimum = axis === 'x' ? (target === null ? MIN_READER_WIDTH : SPLIT_PANE_MIN_WIDTH) : (target === null ? MIN_READER_ROWS : SPLIT_PANE_MIN_ROWS)
    const addedMinimum = axis === 'x' ? SPLIT_PANE_MIN_WIDTH : SPLIT_PANE_MIN_ROWS
    if (!targetRect || (axis === 'x' ? targetRect.width : targetRect.height) < targetMinimum + addedMinimum) {
      showNotice('info', `That window is too ${axis === 'x' ? 'narrow' : 'short'} to split · enlarge it first`); return
    }
    const candidate = splitCandidateSessions.find(session => !orderedWindowKeys.includes(sessionKey(session)) && !parkedWindowKeysRef.current.has(sessionKey(session)))
    const taken = new Set([...windowSurfaces, ...popoverTabs, ...[...parkedWindowKeysRef.current].filter(isSurfaceWindowKey).map(surfaceIdOfKey)])
    const surface = candidate ? null : nextSurfaceId('terminal', taken)
    const key = candidate ? sessionKey(candidate) : surfaceWindowKey(surface!)
    const keys = [...orderedWindowKeys, key]
    const rects = windowLayoutRects(fittedWindows, { width: readerAreaWidth, height: windowAreaHeight, orientation: splitOrientation, readerLast: splitReaderLast })
    const root = reconciledSplitTree?.root ?? splitTreeFromRects(rects.map((rect, index) => ({ ...rect, slot: index - 1 })))
    const next: WindowSplitTree = { ...(primaryLeaf ? {} : { primary: false }), keys, root: splitWindowLeaf(root, target ?? popoverHostSlot, orderedWindowKeys.length, axis) }
    const result = computeWindowSplitTree(next, readerAreaWidth, windowAreaHeight, splitTreeLimits)
    if (result.layout.visibleCount !== keys.length) { showNotice('info', `That window is too ${axis === 'x' ? 'narrow' : 'short'} to split · enlarge it first`); return }
    checkpointWindowLayout()
    setWindowSplitTree(next)
    setWindowOrder(keys)
    if (candidate) {
      const pins = [...splitPinnedSessions.slice(0, splitPaneCount).map(sessionKey), key]
      setSplitPinnedKeys(pins)
      setSplitPaneCount(pins.length)
      void writeTuiSplitPanes(pins.length).catch(() => {})
    } else {
      setWindowSurfaces(current => [...current, surface!])
      pendingSurfaceFocusRef.current = surface!
    }
    setSurfacePanelFocused(false)
    setFocusedPane('messages')
    setSplitFocusIndex(orderedWindowKeys.length)
    showNotice('info', `${orientation === 'columns' ? 'Split right' : 'Split below'} · ${candidate ? formatSessionTitle(candidate) : 'new shell window'}`)
  })
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

  const controlWindowIndex = (key: string): number | null | undefined => {
    if (shownPopoverTab && (key === 'reader' || key === surfaceWindowKey(shownPopoverTab))) return null
    if (floatingKey === key) return FLOATING_PANE_INDEX
    const index = windowItems.findIndex(item => windowItemKey(item) === key)
    return index < 0 ? undefined : index
  }
  const focusedControlKey = () => splitFocusIndex === null ? (shownPopoverTab ? surfaceWindowKey(shownPopoverTab) : selectedSessionKey ?? 'empty')
    : focusedWindowItem ? windowItemKey(focusedWindowItem) : 'reader'
  const readControlWindows = useStableEvent((): ControlWindow[] => {
    const windows: ControlWindow[] = []
    const add = (key: string, number: number, title: string, id: string) => {
      const node = renderer.root.findDescendantById(id)
      if (!node) return
      for (let parent: typeof node | null = node; parent; parent = parent.parent) {
        if (!parent.visible) return
      }
      const rect = rectOf(id)
      if (!rect) return
      const x = Math.max(0, rect.x), y = Math.max(0, rect.y)
      const clippedWidth = Math.min(width, rect.x + rect.width) - x
      const clippedHeight = Math.min(height, rect.y + rect.height) - y
      if (clippedWidth < 3 || clippedHeight < 2) return
      windows.push({ key, number, title, focused: focusedControlKey() === key,
        rect: { x, y, width: clippedWidth, height: clippedHeight } })
    }
    if (shownPopoverTab) add(surfaceWindowKey(shownPopoverTab), popoverHostSlot >= 0 ? popoverHostSlot + 1 : 1, windowSurfaceTitle(shownPopoverTab), 'popover-tab-frame')
    windowItems.slice(0, visibleSplitPaneCount).forEach((item, index) => index !== popoverHostSlot && add(windowItemKey(item), index + windowNumberOffset, windowKeyTitle(windowItemKey(item)), `split-pane:${index}`))
    if (floatingItem && !fullscreenMode && !windowSurfacePeek) add(windowItemKey(floatingItem), visibleSplitPaneCount + windowNumberOffset, windowKeyTitle(windowItemKey(floatingItem)), 'floating-window')
    return windows
  })
  const focusControlWindow = useStableEvent((key: string) => {
    const index = controlWindowIndex(key)
    if (index === undefined) return false
    setSurfacePanelFocused(false)
    setFocusedPane('messages')
    if (index === null) focusReaderFromSplit()
    else focusSplitPane(index)
    return true
  })
  const pickControlWindow = useStableEvent((key: string) => {
    endWindowResizeGroup()
    if (!readControlWindows().some(window => window.key === key)) return
    focusControlWindow(key)
    if (windowControlMode === 'identify') leaveWindowControls()
  })
  const enterWindowControls = useStableEvent((mode: 'identify' | 'manage') => {
    if (pendingPermissions.length || (windowControlsBlocked && !contextMenu && !commandPaletteOpen)) return
    setContextMenu(null)
    setControlMenuTarget(null)
    setChordHelp(null)
    setSplitChordPending(false)
    setCommandChordPending(false)
    endWindowResizeGroup()
    const visible = readControlWindows()
    if (!visible.some(window => window.focused) && visible[0]) focusControlWindow(visible[0].key)
    setWindowControlMode(mode)
  })
  const runWindowControlAction = useStableEvent((key: string, action: WindowControlAction, direction?: WindowDirection) => {
    const index = controlWindowIndex(key)
    if (index === undefined) { setContextMenu(null); return }
    const spec = WINDOW_CONTROL_ACTIONS.find(entry => entry.id === action)!
    const grouped = windowControlMode === 'manage' && spec.resize
    if (!grouped) endWindowResizeGroup()
    windowResizeGroupRef.current = Boolean(grouped)
    // A popover tab in the reader's place: what moves is the popover, not the
    // session hidden behind it.
    if (index === null && shownPopoverTab && (action === 'float' || action === 'move-workspace' || action === 'close' || action === 'tab')) {
      const id = shownPopoverTab
      if (action === 'close') closePopoverTab(id)
      else if (action === 'tab') tabFocusedWindow(null)
      else if (action === 'float') { closePopoverTab(id, true); floatWindowKey(surfaceWindowKey(id)) }
      else openPopoverTabMoveMenu(id)
      return
    }
    try {
      switch (action) {
        case 'focus': focusControlWindow(key); break
        case 'move-workspace': openMoveWorkspaceMenu(workspaceId, key); break
        case 'manage': focusControlWindow(key); enterWindowControls('manage'); break
        case 'zoom': focusControlWindow(key); if (index === null && visibleSplitPaneCount === 0) toggleFullscreenMode(); else toggleWindowZoom(index); break
        case 'shrink': resizeFocusedWindow(-1, index); break
        case 'grow': resizeFocusedWindow(1, index); break
        case 'reader-shrink': resizeFocusedWindow(-1, index); break
        case 'reader-grow': resizeFocusedWindow(1, index); break
        case 'row-shrink': resizeSecondaryDivider(-1); break
        case 'row-grow': resizeSecondaryDivider(1); break
        case 'equalize':
          checkpointWindowLayout()
          if (reconciledSplitTree) setWindowSplitTree({ ...reconciledSplitTree, root: evenWindowSplitTree(reconciledSplitTree.root) })
          setSplitReaderShare(SPLIT_SHARE_EVEN)
          setSplitSecondaryShare(SPLIT_SHARE_EVEN)
          setSplitBottomShare(SPLIT_SHARE_EVEN)
          setSplitWeights({})
          void writeTuiSplitReaderShare(SPLIT_SHARE_EVEN).catch(() => {})
          void writeTuiWindowArrangement({ arrangement: splitArrangement, readerLast: splitReaderLast, secondaryShare: SPLIT_SHARE_EVEN, bottomShare: SPLIT_SHARE_EVEN, weights: {} }).catch(() => {})
          break
        case 'undo': undoWindowLayout(); break
        case 'swap': if (direction) swapWindowInDirection(direction, index); break
        case 'tab': tabFocusedWindow(index); break
        case 'detach': if (index !== null) breakOutWindowTab(key); break
        case 'float': toggleFloatingFocused(index); break
        case 'close':
          if (index === null) break
          if (windowStackFor(key)) closeWindowTab(key)
          else if (index === FLOATING_PANE_INDEX) closeFloatingWindow()
          else {
            const item = windowItems[index]
            if (item?.kind === 'surface') closeSurfaceWindow(item.surface)
            else closeSplitPane(index)
          }
          break
        case 'layout': focusControlWindow(key); leaveWindowControls(); setWindowPickerOpen(true); break
        case 'split-columns': splitFocusedWindow('columns', index); break
        case 'split-rows': splitFocusedWindow('rows', index); break
        case 'menu': openWindowControlMenu(key); break
        case 'resize': break
      }
    } finally { windowResizeGroupRef.current = false }
  })
  const openWindowControlMenu = useStableEvent((key: string, point?: { x: number; y: number }, section?: 'resize' | 'swap' | 'session') => {
    const index = controlWindowIndex(key)
    if (index === undefined) return
    leaveWindowControls()
    setControlMenuTarget(key)
    const frame = rectOf(index === null ? 'transcript-reader' : index === FLOATING_PANE_INDEX ? 'floating-window' : `split-pane:${index}`)
    const targetItem = index === null ? null : index === FLOATING_PANE_INDEX ? floatingItem : windowItems[index]
    const button = rectOf(index === null || (targetItem?.kind === 'session' && index === selectedWindowIndex) ? 'reader-window-menu' : targetItem?.kind === 'surface' ? `surface-window-menu:${targetItem.surface}` : `split-pane-menu:${index}`)
    const anchor = point ?? { x: button?.x ?? frame?.x ?? 0, y: button?.y ?? frame?.y ?? 0 }
    const context: WindowControlContext = { floating: index === FLOATING_PANE_INDEX,
      tabbed: Boolean(windowStackFor(key)), canTab: index === null || index === FLOATING_PANE_INDEX ? windowItems.length > 0 : windowItems.length > 1, zoomed: windowZoom !== null }
    const wrap = (run: () => void) => () => { if (controlWindowIndex(key) !== undefined) run() }
    const item = index === null ? null : index === FLOATING_PANE_INDEX ? floatingItem : windowItems[index]
    // A popover tab holds the reader's place: the reader's menu is its menu.
    const popoverTab = index === null ? shownPopoverTab : null
    const session = index === null ? (popoverTab ? null : selectedSession) : item?.kind === 'session' ? item.session : null
    const actions = section === 'resize' ? WINDOW_RESIZE_ACTIONS : WINDOW_MENU_ACTIONS
    let items: ContextMenuItem[] = actions.flatMap(id => {
      const action = WINDOW_CONTROL_ACTIONS.find(entry => entry.id === id)!
      if (action.available && !action.available(context)) return []
      if (section === 'resize' && ((!treeGeometry && !fittedWindows.groups.some(group => index !== null && group.members.includes(index)) && ['shrink', 'grow'].includes(id)) || (!treeGeometry?.dividers.some(divider => divider.axis === 'y') && splitArrangement !== 'grid' && ['row-shrink', 'row-grow'].includes(id)))) return []
      return [{ label: id === 'close' ? (context.tabbed || popoverTab ? 'Close tab' : session ? 'Close pane' : 'Close window') : id === 'float' ? (context.floating ? 'Dock window' : 'Float window') : id === 'zoom' ? (context.zoomed ? 'Restore layout' : 'Zoom window') : action.label,
        hint: id === 'manage' ? action.keys : undefined, danger: id === 'close', run: wrap(() => {
          if (id === 'close' && popoverTab) closePopoverTab(popoverTab)
          else if (id === 'resize' || id === 'swap') openWindowControlMenu(key, anchor, id)
          else runWindowControlAction(key, id)
        }) }]
    })
    if (section === 'swap') items = (['left', 'right', 'up', 'down'] as const).map(direction => ({
      label: `Swap ${direction}`, run: wrap(() => runWindowControlAction(key, 'swap', direction)),
    }))
    if (section === 'session' && session) items = [
      ...(index === null ? [] : [{ label: 'Focus session', run: wrap(() => { focusControlWindow(key) }) }]),
      { label: 'Copy session ID', run: wrap(() => { void writeClipboard(session.sessionId, renderer).catch(err => showNotice('error', String(err))) }) },
    ]
    if (!section && session) items.push({ label: 'Session actions…', run: wrap(() => openWindowControlMenu(key, anchor, 'session')) })
    if (!section && popoverTab) items.push(
      { label: 'Open as a window', run: wrap(() => popoverTabToWindow(popoverTab)) },
      { label: 'Open full screen', hint: '⌃⇧W', run: wrap(() => popoverTabToFullScreen(popoverTab)) },
    )
    if (!section && item?.kind === 'surface') {
      const kind = surfaceKindOf(item.surface)
      if (isPopoverWindowKind(kind)) items.push(
        { label: 'Open full screen', run: wrap(() => returnPopoverWindow(item.surface)) },
        { label: 'Open as a tab here', run: wrap(() => { const pin = windowSurfaceMeta[item.surface] ?? {}; returningPopoverRef.current = true; closeSurfaceWindow(item.surface, true); returningPopoverRef.current = false; openPopoverTab(kind, pin) }) },
        { label: 'Move to a new workspace', run: wrap(() => { const pin = windowSurfaceMeta[item.surface] ?? {}; returningPopoverRef.current = true; closeSurfaceWindow(item.surface, true); returningPopoverRef.current = false; openPopoverInNewTab(kind, pin) }) },
      )
      else {
        if (SURFACE_POPOVER_KINDS.has(kind)) items.push(
          { label: 'Open full screen', run: wrap(() => { closeSurfaceWindow(item.surface, true); setPopoverOpen(kind, true) }) },
          { label: 'Open as a tab here', run: wrap(() => { closeSurfaceWindow(item.surface, true); openPopoverTab(kind, {}) }) },
        )
        items.push({ label: 'Move to side panel', run: wrap(() => moveSurfaceToPanel(item.surface)) })
        if (MULTI_INSTANCE_SURFACES.has(kind)) items.push({ label: `Open another ${WINDOW_SURFACE_TITLES[kind].slice(2)} window`, run: wrap(() => openSurfaceWindow(kind, { another: true })) })
      }
    }
    if (section) items.push({ label: 'Back…', run: wrap(() => openWindowControlMenu(key, anchor)) })
    setContextMenu({ ...anchor, title: section ? `Window ${section}` : popoverTab ? fitText(windowSurfaceTitle(popoverTab), 34).trimEnd() : fitText(windowKeyTitle(key === 'reader' ? selectedSessionKey ?? key : key), 34).trimEnd(), items })
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
    if (handleWindowControlKeys({ windowControlsBlocked, windowControlMode, handled, key, isCtrl, leaveWindowControls, sequence, readControlWindows, pickControlWindow, endWindowResizeGroup, runWindowControlAction, focusedControlKey, focusWindowInDirection, commandChordPending, setCommandChordPending, executeCommandPalette, setChordHelp, showNotice, setSplitChordPending, cancelPointerGesture, isCtrlShift, openPopoverKind, openPopoverWindow, pluginOverlay, gitRepoCwd, setPluginOverlay, openSurfaceWindow, focusedWindowSurfaceKind, focusedWindowSurface, popoverTabs, popoverTabToFullScreen, returnPopoverWindow, spacesMenuOpen, spacesKeyRef, workspacesEnabled, workspaceLaunched, setWorkspaceLaunched, setWindowPickerOpen, setWorkspaceHasSession, setFocusedPane, setNewSessionCwd, workspaceCwd, setNewSessionModalOpen, splitChordPending, composerActive, composerTargetSession, composerSendState, reattachedRunning, isKeyRepeat, backgroundComposerTasks, enterWindowControls, openWindowControlMenu, toggleWorkspaces, openSpaces, addSplitPane, rotateSplitOrientation, resizeFocusedWindow, resizeSplitReader, shownPopoverTab, splitFocusIndex, closePopoverTab, closeSurfaceWindow, closeSplitPane, undoWindowLayout, redoWindowLayout, reopenClosedWindow, openRecentWindows, jumpToNextWindowAttention, setRecentWindowsOnly, setWindowSwitcherOpen, setWindowBroadcastOpen, toggleSplitPanes, cycleSplitFocus, swapWindowInDirection, toggleWindowZoom, tabFocusedWindow, stepWindowTab, focusedWindowItem, breakOutWindowTab, windowItemKey, toggleFloatingFocused, resizeSecondaryDivider, focusPreviousWindow, primaryLeaf, focusReaderFromSplit, windowNumberOffset, windowItems, focusSplitPane, focusControlWindow, cycleSplitPaneSession, toggleVoice })) return
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
    if (handleModalDialogKeys({ exitConfirmOpen, key, handled, confirmExit, cancelExit, worktreeConfirm, setWorktreeConfirm, mergeSelectedWorktreeTask, discardSelectedWorktreeTask, worktreeModalOpen, setWorktreeModalOpen, setWorktreeDraft, submitWorktreeTask, playbookManagerOpen, playbookManagerKeyHandlerRef, coordModalOpen, setCoordModalOpen, setCoordDraft, setCoordAcceptanceDraft, setCoordNonGoalsDraft, setCoordManualQaDraft, setCoordEscalationDraft, setCoordPlaybookName, setCoordPlaybookArgsDraft, setCoordGateDraft, setCoordMaxTokens, setCoordMaxDurationMinutes, setCoordProviderOverride, setCoordTeammateProviderOverride, setCoordProviderPoolIndex, setCoordModalFocus, setCoordError, isCtrl, setCoordMaxAgents, setCoordRequirePlanApproval, showToggleOutcome, coordModalFocus, coordPlaybooks, coordPlaybookName, selectCoordPlaybook, setPlaybookManagerOpen, provider, selectedSession, coordProviderPoolIndex, coordProviderOverride, setCoordUseWorktrees, setCoordAutonomy, setCoordRequireReview, submitCoordinatedRun, remoteCoordinatorTarget, remoteCoordinatorKeyHandlerRef, teammatesModalOpen, teammatesKeyHandlerRef, searchMode, setSearchMode, sessionSearchMode, setSessionSearchMode, setSessionSearchQuery, fileHistoryPath, fileHistoryKeyHandlerRef, dailySummaryOpen, dailySummaryKeyHandlerRef, contextMenu, contextMenuKeyHandlerRef, windowSwitcherOpen, windowSwitcherKeyRef, windowBroadcastOpen, windowBroadcastKeyRef, windowPickerOpen, windowPickerKeyHandlerRef, pluginOverlay, pluginOverlayKeyHandlerRef, folderPickerForNewSession, folderPickerKeyHandlerRef })) return
    if (handleOverlayAndMenuKeys({ focusedWindowSurface, windowSurfaceCaptureRef, windowSurfaceKeysRef, pendingPermissions, focusedWindowSurfaceKind, splitChordPending, key, handled, focusReaderFromSplit, surfacePanel, surfacePanelVisible, surfacePanelFocused, surfacePluginKeyCaptureRef, surfacePluginKeyRef, sequence, setSurfacePanelExpanded, surfacePanelAtBottom, setSurfacePanelRows, surfacePanelMaxRows, setSurfacePanelWidth, surfacePanelMaxWidth, toggleSurfacePanelPlacement, isShifted, setSurfacePanelOpen, setSurfacePanelFocused, surfacePanelKeyHandlerRef, pluginManagerOpen, pluginManagerKeyHandlerRef, newSessionModalOpen, newSessionKeyHandlerRef, handoffBriefOpen, handoffBriefKeyHandlerRef, promptLibraryOpen, promptLibraryKeyHandlerRef, chordHelp, setChordHelp, bookmarksOverlayOpen, isCtrl, setBookmarksOverlayOpen, bookmarksOverlay, setBookmarksOverlayIndex, bookmarksOverlayIndex, openBookmarkRecord, attentionOpen, attentionKeyHandlerRef, renameSessionKey, setRenameSessionKey, setRenameDraft, commitRename, providerMenuOpen, closeProviderMenu, requestExit, modelPickerOpen, isModelEffortShortcut, setModelPickerOpen, modelPickerFocus, setModelPickerFocus, setModelPickerIndex, filteredModelPickerOptions, modelPickerTarget, modelPickerOptions, modelPickerIndex, setTuiCopilotContextTierByKey, themeMenuOpen, themeMenuGroup, setThemeMenuGroup, themeMenuQuery, themeMenuOriginRef, setThemeMenuIndex, setThemeMode, themeMenuIndex, chooseTheme, closeThemeMenu, toggleThemeFollowsTerminal, transcriptViewMenuOpen, closeTranscriptViewMenu, toggleLightweightWindows, commandPaletteOpen, closeCommandPalette, setCommandPaletteIndex, filteredCommands, commandPaletteIndex, executeCommandPalette, setCommandPaletteQuery, transcriptDiffDraft, setTranscriptDiffDraft, setTranscriptDiffNotes, openModelPicker })) return
    if (handleAskAndShortcutKeys({ pendingPermissions, permissionActionLoading, questionFocusIndex, key, questionFreeformEditing, handled, questionOptionIndex, setQuestionFreeformEditing, setQuestionFreeformAnswers, setQuestionSelections, setQuestionOptionIndex, setQuestionFocusIndex, sequence, toggleTuiQuestionOption, questionFreeformAnswers, submitTuiQuestion, respondToTuiPermission, permissionOptionIndex, setPermissionOptionIndex, respondToTuiPlan, movePermissionOptionIndex, resolvePermissionOptionIndex, composerTargetSession, selectedSession, cycleClaudeComposerPermissionMode, executeCommandPalette, composerActive, isShifted, surfacePanelOpen, setSurfacePanelOpen, setSurfacePanelFocused, surfacePanelFocused, fullscreenMode, composerTextareaRef, composerDraft, toggleFullscreenMode })) return
    if (handleComposerKeys({ composerActive, isCtrl, handled, pasteSystemClipboardToComposer, key, composerMention, composerMentionResults, setComposerMentionDismissedStart, setComposerMention, setComposerMentionResults, composerSlashOpen, composerSlashCommands, setComposerSlashDismissed, setComposerSlashIndex, composerHistoryOpen, cancelComposerHistory, composerStashOpen, setComposerStashOpen, setComposerStashIndex, composerRewindItems, setComposerRewindItems, composerSendState, reattachedRunning, rememberComposerCursor, setComposerWindowOpen, setComposerActive, composerWindowOpen, isKeyRepeat, interruptPressActive, cancelComposerSend, setInterruptPressActive, interruptPressTimeoutRef, toggleComposerWindow, activeQueuedComposerSends, clearQueuedComposerSends, popNewestQueuedComposerSend, canUseChannelBridge, routeComposerToBridge, toggleComposerBridgeRoute, searchComposerHistory, editComposerInExternalEditor, pluginOverlay, closePluginOverlay, runPluginCommandId, composerTargetSession, setComposerEnableWorkflow, showToggleOutcome, commitComposerHistory, moveComposerHistory, selectComposerHistoryEntry, sentHistory, sequence, setComposerHistoryOpen, setComposerHistoryIndex, setHistoryIndex, composerRewindIndex, rewindToPrompt, setComposerRewindIndex, commitComposerStashEntry, selectComposerStashEntry, composerStashIndex, composerStash, composerMentionIndex, insertMentionAtCursor, setComposerMentionIndex, composerSlashIndex, insertSlashAtCursor, livePromptSuggestion, composerTextareaRef, setComposerDraft, setLivePromptSuggestion, composerDraft, historyIndex })) return
    if (handleGlobalChordKeys({ commandChordPending, windowControlsBlocked, handled, setCommandChordPending, key, isCtrl, showNotice, sequence, executeCommandPalette, setChordHelp, setSplitChordPending, isShifted, toggleFullscreenMode, focusedWindowSurface, popoverTabFocused, focusReaderFromSplit, windowSurfaceKeysRef, focusedWindowItem, composeToSplitPaneSession, openComposerWindow, selectedSessionKey, selectedInteractiveTranscriptCard, selectedInteractiveTranscriptCardDisplay, splitFocusIndex, effectiveFocus, splitPaneHandlesRef, searchMatches, fleetStripVisible, fleetPageCount, transcriptViewportRows, hasPrimaryFrame, velocityScrollStep, jumpToSearchMatch, jumpToMatchingCard, jumpToBookmark, visibleTabSessions, selectStripIndex, activeStripIndex, tabStripLength, setSearchMode, jumpToUnreadBoundary, jumpToResumeMarker, copySelectedMessage, replySelectedMessage, setThinkingMode, showToggleOutcome, openFocusedSplitPane, tabFromSplitPane, closeWindowSessionTab, openSplitPaneOverlay, openCoordinationBoard, splitPaneRunningKeys, requestExit, setComposerActive, pasteSystemClipboardToComposer, showRail, focusedPane, tabFromRail, setFocusedPane, isCtrlShift, openNewWorkflowModal, runPluginCommand, setAttentionOpen, jumpToNextAttention, fleetStripEnabled, setFleetStripEnabled, jumpToFleetEntry, setFleetPage, openHandoffBrief, setWorktreeDraft, setWorktreeModalOpen, openPromptLibrary, taskPanelOpen, setTaskPanelOpen, setTaskPanelTab, taskPanelTab, resizeTaskPanel, setTaskPanelExpanded, toggleComposerHidden, openBookmarksOverlay, selectedSession, setRenameSessionKey, setRenameDraft })) return
    if (handleSidebarKeys({ effectiveFocus, sidebarSubagentCursor, key, handled, showNotice, setSidebarView, showToggleOutcome, sidebarView, moveCoordinatorSelection, jumpCoordinatorSelection, isShifted, openSelectedCoordinatorAgent, moveSelection, sidebarEntries, focusSidebarEntry, toggleHideScratch, toggleSelectedSessionSettled, toggleSidebarSort, sidebarSort })) return
    if (handleWindowAndTabKeys({ effectiveFocus, sequence, handled, jumpToBookmark, showRail, resizeSidebar, key, workspaceContext, sidebarView, selectedSession, childrenByParentId, setCollapsedSubagentParents, sidebarEntries, selectedSidebarEntryIndex, setSubagentTranscriptSelection, setPluginOverlay, promotePreviewToTab, setFocusedPane, showTabs, selectStripIndex, activeStripIndex, tabStripLength, shownPopoverTab, closePopoverTab, closeWindowSessionTab })) return
    if (handleReaderKeys({ effectiveFocus, key, handled, moveAgentToolCursor, moveCursor, velocityScrollStep, jumpToTranscriptIndex, isShifted, jumpToTranscriptTail, transcriptViewportRows, isCtrl, moveViewport, openSelectedAsyncQuestionsOrFold, toggleExpansion, transcriptView, jumpToUnreadBoundary, selectedInteractiveTranscriptCard, selectedInteractiveTranscriptCardDisplay, jumpToResumeMarker, toggleBookmarkForCursor, replySelectedMessage, diffLayout, transcriptDiffHiddenHunkHeaderCardKeys, transcriptDiffRowCursorByCardKey, setTranscriptDiffSelectionAnchorByCardKey, setTranscriptDiffRowCursorForCard, committedSessionKey, transcriptDiffSelectionAnchorByCardKey, transcriptDiffNotes, toggleTranscriptDiffCardSet, setTranscriptDiffPlainCardKeys, clearTranscriptDiffSelectionForCard, setTranscriptDiffHiddenLineNumberCardKeys, setTranscriptDiffHiddenHunkHeaderCardKeys, showNotice, openTranscriptDiffNote, deleteTranscriptDiffNote, sendTranscriptDiffNoteToComposer, selectedAgentToolCard, selectedAgentToolExpanded, resolvedExpandedKeys, sequence, setSearchMode, setSessionSearchMode, copySelectedMessage, setDiffLayout, showToggleOutcome, setError, searchMatches, jumpToSearchMatch, jumpToMatchingCard })) return
    if (handleLetterShortcutKeys({ sequence, composerActive, handled, setComposerHidden, setComposerActive, normalizedSearchQuery, openNewSessionModal, reuseLastPrompt, setThinkingMode, showToggleOutcome, setShowToolCalls, setError, toggleVelocityScroll, setCommandPaletteIndex, setCommandPaletteQuery, setCommandPaletteOpen, key, openProviderMenu, openThemeMenu, stickyHeaders, setStickyHeaders, tabsEnabled, setTabsEnabled, railVisible, setRailVisible, focusedPane, setFocusedPane, focusMode, setFocusMode, density, setDensity, isShifted, transcriptWidth, setTranscriptWidth, openTranscriptViewMenu, refreshSessions, provider, selectedSessionTarget, refreshSelectedSessionDetail })) return
  })

  const statusLabel = loadingSessions ? 'syncing' : refreshingSessions ? 'refreshing' : 'live'
  const readerMode = followTail ? null : pendingNewCount > 0 ? 'new content' : 'reading'
  const readerContextMeta = useMemo(
    () => fitText(
      joinMeta([
        currentProjectName(selectedSession),
        readerModel,
      ]),
      Math.min(Math.max(Math.floor(rightPaneWidth * 0.28), 18), 42),
    ),
    [selectedSession, readerModel, rightPaneWidth],
  )
  const previewBarText = useMemo(
    () => selectedSession
      ? fitText(
          `${formatSessionTitle(selectedSession)}  ·  preview  ·  ↵ open  ·  tab focus`,
          Math.max(rightPaneWidth - 2, 16),
        )
      : '',
    [rightPaneWidth, selectedSession],
  )

  const providerOptions = useMemo(() => providerSelectOptions(providerInstances), [providerInstances, disabledPlugins])
  const providerAccent = getProviderAccent(provider)
  const composerPlaceholder = composerTargetSession
    ? (visibleComposerSending
        ? 'Follow-up…'
        : composerExample)
    : composerConfig.placeholderNoSession
  const composerActiveAttachments = useMemo(
    () => prepareComposerSubmission(composerDraft, composerMentionAttachments, composerPromptParts).attachments,
    [composerDraft, composerMentionAttachments, composerPromptParts, prepareComposerSubmission],
  )
  const composerAttachmentLabel = attachmentCountLabel(composerActiveAttachments)
  if (composerDraftShapeRef.current) composerDraftShapeRef.current.attachments = composerAttachmentLabel ?? ''
  // The stats row shows the character count, which changes on every key; the rows that draw it
  // take a builder and subscribe to the length themselves (DraftLengthSpans), so a keystroke
  // repaints them without rendering the root. The array below is the draft as of this render, for
  // the widths and hit-tests that only need it when something else has already rendered.
  const composerDockStatsFor = (draftLength: number): InlineTextSegment[] => buildComposerStatsSegments(composerVisualLineCount, draftLength)
  const composerDockStatsSegments = composerDockStatsFor(composerDraft.length)
  const composerWindowMetaSegments = useMemo<InlineTextSegment[]>(() => {
    const segments: InlineTextSegment[] = []
    composerKnobSegments.forEach((segment, index) => {
      if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(segment)
    })
    if (composerLocationSegments.length > 0) {
      if (segments.length > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(...composerLocationSegments)
    }
    return segments
  }, [composerKnobSegments, composerLocationSegments, theme.dim])
  const composerWindowDraftFor = (draftLength: number): InlineTextSegment[] => {
    const segments: InlineTextSegment[] = [
      { text: `${composerWindowVisualLineCount} line${composerWindowVisualLineCount === 1 ? '' : 's'}`, fg: theme.dim },
      { text: ` · ${draftLength} chars`, fg: theme.dim },
    ]
    if (composerAttachmentLabel) {
      segments.push({ text: ' · ', fg: theme.dim })
      segments.push({ text: composerAttachmentLabel, fg: theme.cyan })
    }
    return segments
  }
  const composerBaseTextareaStyle = {
    backgroundColor: theme.surface,
    textColor: theme.text,
    focusedBackgroundColor: theme.surface,
    focusedTextColor: theme.text,
    placeholderColor: theme.dim,
  }
  const composerDockTextareaStyle = {
    ...composerBaseTextareaStyle,
    backgroundColor: theme.surface2,
    focusedBackgroundColor: theme.surface3,
    flexGrow: 1,
  }
  const chatComposerFocused = composerActive && !composerFocusBlocked
  // Fullscreen has no border to light up, so a focused composer is told apart
  // by its ground: a wash of its accent over the surface, dock and draft alike.
  const composerDockBackground = fullscreenMode && chatComposerFocused
    ? mixHexColor(composerAccentColor, theme.surface, 0.12) ?? theme.surface3
    : theme.surface
  // The textarea paints its own background over whatever the parent draws, so
  // chat mode's highlighted bar needs the textarea itself tinted to match —
  // otherwise the bar only shows through the "› " prefix and padding slivers.
  const composerChatTextareaStyle = {
    ...composerBaseTextareaStyle,
    // Focused, the draft area drops to the theme's own ground so it reads as a
    // well you can type into rather than another band of panel. Unfocused it
    // stays flush with the surrounding chat surface — the transcript's last
    // row, not a control. Neither state uses the theme's brighter
    // user-message background, which washes the whole input out.
    backgroundColor: chatComposerFocused ? theme.bg : theme.surface2,
    focusedBackgroundColor: theme.bg,
    flexGrow: 1,
  }
  const composerDockHeaderStatus = routeComposerToBridge
    ? 'BRIDGE'
    : routeComposerToIde
    ? 'IDE'
    : visibleComposerSending
    ? 'SENDING'
    : reattachedRunning
    ? 'REATTACHED'
    : composerActive
    ? 'FOCUSED'
    : 'READY'
  const composerDockTitleLeft = '◆ COMPOSER'
  const composerDockTitleWidth = Math.max(composerDockTextareaWidth - 2, 12)
  const composerDockTitleGap = composerDockTitleWidth - composerDockTitleLeft.length - composerDockHeaderStatus.length
  const composerDockRouted = routeComposerToBridge || routeComposerToIde
  // Lit only while the composer can actually take a key: an accent border on
  // an open-but-unfocused prompt reads as a second focused pane.
  const composerDockEmphasized = composerDockRouted || (composerActive && !composerFocusBlocked)
  const composerDockTitleRule = composerDockRouted ? '━' : '─'
  const composerDockBorderTitle = composerDockTitleGap > 0
    ? `${composerDockTitleLeft}${composerDockTitleRule.repeat(composerDockTitleGap)}${composerDockHeaderStatus}`
    : fitText(`${composerDockTitleLeft} · ${composerDockHeaderStatus}`, composerDockTitleWidth)
  const composerWindowHeaderStatus = visibleComposerSending
    ? 'SENDING'
    : reattachedRunning
    ? 'REATTACHED'
    : 'EXPANDED'
  const composerWindowTitleLeft = '◆ COMPOSER'
  const composerWindowTitleWidth = Math.max(composerWindowWidth - 4, 12)
  const composerWindowTitleGap = composerWindowTitleWidth - composerWindowTitleLeft.length - composerWindowHeaderStatus.length
  const composerWindowBorderTitle = composerWindowTitleGap > 0
    ? `${composerWindowTitleLeft}${'━'.repeat(composerWindowTitleGap)}${composerWindowHeaderStatus}`
    : fitText(`${composerWindowTitleLeft} · ${composerWindowHeaderStatus}`, composerWindowTitleWidth)
  const sendingHintBase = interruptPressActive
    ? composerConfig.footerHintSending.replace('⌃C cancel', '⌃C again to interrupt')
    : composerTargetSession?.provider === 'claude' && visibleRunningToolCount > 0
    ? `${composerConfig.footerHintSending} · ⌃B background`
    : composerConfig.footerHintSending
  const composerWorkflowFooterHint = composerTargetSession?.provider === 'claude' ? ' · ⌃W workflow' : ''
  const composerDockFooterHint = canUseChannelBridge && routeComposerToBridge
    ? '● → live CLI bridge · ⌃R off · ⇧C panel'
    : canUseIdeBridge && routeComposerToIde
    ? '● → IDE @mentions · ⇧I panel'
    : composerKeysTargetTurn
    ? sendingHintBase
    : `${composerIdleFooterHint}${composerWorkflowFooterHint} · ⌃R search · ⌃G editor · ⌃O expand`
  const composerDockSendingHintSegments = composerKeysTargetTurn
    ? composerSendingHintSegments(composerDockFooterHint, theme)
    : null
  // Size the hint box to exactly fit its text, capped by available width minus
  // 24 chars reserved for the stats side. Avoids the old proportional cap (62
  // chars) that truncated the full idle hint (~72 chars on most terminals).
  // The dock border carries the status bar whenever the composer is not what
  // the keys reach: the reader's keys, a pending chord, the attention badge.
  const dockShowsStatusBar = statusBarInDock
    && (commandChordPending || splitChordPending || (!composerActive && !composerKeysTargetTurn && !routeComposerToBridge && !routeComposerToIde))
  // The attention badge rides the stats while the composer holds the hint slot:
  // it must stay visible in every mode.
  const dockFooterStatsFor = (draftLength: number): InlineTextSegment[] => statusBarInDock && !dockShowsStatusBar && attentionNeedsInputCount > 0
    ? [{ text: `⚠ ${attentionNeedsInputCount} `, fg: theme.amber }, ...composerDockStatsFor(draftLength)]
    : composerDockStatsFor(draftLength)
  const dockStatusBarLength = dockShowsStatusBar ? footerSegments.reduce((n, segment) => n + segment.text.length, 0) : 0
  const composerDockFooterHintWidth = Math.max(
    18,
    Math.min((dockShowsStatusBar ? dockStatusBarLength : composerDockFooterHint.length) + 1, composerDockTextareaWidth - footerDockStatsReserve(composerDockTextareaWidth)),
  )
  const composerDockFooterStatsWidth = Math.max(composerDockTextareaWidth - composerDockFooterHintWidth - 1, 8)
  const composerWindowFooterHint = composerKeysTargetTurn
    ? `${sendingHintBase} · ⌃O dock`
    : `⏎ send · ⌥M settings · ⇧⏎ newline${composerWorkflowFooterHint} · ⌃O dock · Esc close`
  const composerWindowSendingHintSegments = composerKeysTargetTurn
    ? composerSendingHintSegments(composerWindowFooterHint, theme)
    : null
  const chatComposerFooterHint = chatComposerFocused
    ? composerKeysTargetTurn || composerDockRouted
      ? composerDockFooterHint
      : '⏎ send · ⇧⏎ newline · ⌥M settings'
    : 'c compose'
  // The chat composer's status row is painted into its bottom border, so its
  // budget is that border's horizontal run less a column of inset at each end —
  // the reader's frame, the chat dock's own border, and its padding.
  const chatComposerStatusWidth = Math.max(rightPaneWidth - 8, 12)
  // Both halves are sized to their own content rather than to a fixed share of
  // the row. Both renderers pad to the width they are given, so a fixed share
  // paints a blank band of panel background over the border — and the two
  // states have very different hints (`c compose` against the
  // full key list), so a fixed share left the unfocused hint stranded mid-row
  // instead of against the right end where the focused one sits.
  // Stats take what they need up to their old share of the row; the hint takes
  // what is left, so a long key list still truncates before it can crowd them.
  // `||`, not `??`: the render picks between these two by truthiness, so an
  // empty slash hint must fall through to the stats segments here as well.
  const chatComposerStatsText = composerSlashHint
    || composerDockStatsSegments.map((segment) => segment.text).join('')
  const chatComposerStatsWidth = Math.max(
    Math.min(chatComposerStatsText.length, Math.max(
      Math.floor(chatComposerStatusWidth * 0.55),
      chatComposerStatusWidth - chatComposerFooterHint.length - 2,
    )),
    8,
  )
  const chatComposerHintText = chatComposerFocused && composerDockSendingHintSegments
    ? composerDockSendingHintSegments.map((segment) => segment.text).join('')
    : chatComposerFooterHint
  // Fit once and measure the result: `fitHintText` pads to whatever width it is
  // given, so sizing the box from the raw length leaves a run of blank panel
  // background where the border should be whenever the hint had to truncate.
  const chatComposerHintFitted = fitHintText(
    chatComposerHintText,
    Math.max(chatComposerStatusWidth - chatComposerStatsWidth - 2, 0),
  ).trimEnd()
  const chatComposerHintWidth = chatComposerHintFitted.length
  const composerWindowFooterHintWidth = Math.max(
    18,
    Math.min(composerWindowFooterHint.length + 1, composerWindowContentWidth - 16),
  )
  const composerWindowFooterStatsWidth = Math.max(composerWindowContentWidth - composerWindowFooterHintWidth - 1, 8)
  // Enter on a partial command name picks the highlighted menu entry, as the
  // native menus do, instead of sending "/co" as an unknown command. A name
  // typed in full (with or without arguments) sends as usual. This lives in the
  // submit path because the textarea handles Enter before the app's key handler.
  const pickSlashInsteadOfSubmit = (): boolean => {
    // The textarea takes Enter before the key handler, so an open /rewind
    // picker is answered here.
    if (composerRewindItems && composerRewindItems.length > 0) {
      const chosen = composerRewindItems[composerRewindIndex]
      setComposerRewindItems(null)
      if (chosen) void rewindToPrompt(chosen)
      return true
    }
    if (!composerSlashOpen || composerSlashCommands.length === 0) return false
    const typed = composerFirstLine.trim().split(/\s/)[0]?.toLowerCase() ?? ''
    if (composerSlashCommands.some((entry) => entry.command.toLowerCase() === typed)) return false
    const entry = composerSlashCommands[composerSlashIndex] ?? composerSlashCommands[0]
    // Only a completion of what was typed: a full command the menu does not
    // list (a CLI built-in such as /status) must send as typed, not be swapped
    // for a fuzzy match like /codex:status.
    if (!entry || !entry.command.toLowerCase().startsWith(typed)) return false
    insertSlashAtCursor(entry.command)
    return true
  }
  // Codex /side: send the aside once the fork is the ready composer target.
  useEffect(() => {
    const pending = pendingForkSendRef.current
    if (!pending || composerTargetSessionIdentity !== pending.key || composerPreparingTargetKey) return
    pendingForkSendRef.current = null
    void sendComposerMessage(pending.text)
  }, [composerTargetSessionIdentity, composerPreparingTargetKey, sendComposerMessage])

  const submitComposerFromDock = () => {
    if (pickSlashInsteadOfSubmit()) return
    void sendComposerMessage(composerTextareaRef.current?.plainText ?? composerDraft)
  }
  const submitComposerFromWindow = () => {
    if (pickSlashInsteadOfSubmit()) return
    const draft = composerTextareaRef.current?.plainText ?? composerDraft
    if (draft.trim() && composerTargetSession) {
      rememberComposerCursor()
      setComposerWindowOpen(false)
    }
    void sendComposerMessage(draft)
  }
  // Same test the send path applies (`bangShell`).
  const composerShellDraft = composerDraft.startsWith('!')
  const renderComposerTextarea = (
    onSubmit: () => void,
    options?: { height?: number; width?: number; variant?: 'chat'; background?: string },
  ) => (
    <textarea
      id="composer-textarea"
      ref={composerTextareaRef}
      focused={composerActive && !windowControlMode}
      width={options?.width}
      height={options?.height}
      wrapMode="word"
      placeholder={composerPlaceholder}
      initialValue={composerDraft}
      keyBindings={composerKeyBindings}
      syntaxStyle={composerSyntaxStyle}
      // The default cursor is white whatever the theme, which is no cursor at
      // all on a light one.
      cursorColor={composerShellDraft ? theme.amber : theme.text}
      cursorStyle={composerShellDraft ? COMPOSER_SHELL_CURSOR : COMPOSER_PROMPT_CURSOR}
      onContentChange={handleComposerContentChange}
      onSubmit={onSubmit}
      style={options?.variant === 'chat'
        ? composerChatTextareaStyle
        : options?.background
        ? { ...composerBaseTextareaStyle, backgroundColor: options.background, focusedBackgroundColor: options.background }
        : options?.height ? composerBaseTextareaStyle : composerDockTextareaStyle}
    />
  )
  const renderComposerMentionPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerMention || composerMentionVisibleCount <= 0) return null
    const basenameWidth = Math.max(Math.min(28, Math.floor(rowWidth * 0.4)), 8)
    const pathWidth = Math.max(rowWidth - basenameWidth - 4, 4)
    const total = composerMentionResults.length
    const start = Math.max(0, Math.min(composerMentionIndex - Math.floor((composerMentionVisibleCount - 1) / 2), total - composerMentionVisibleCount))
    const end = Math.min(total, start + composerMentionVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    return (
      <box
        width={panelWidth}
        height={composerMentionVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`${composerConfig.label} ${composerProvider === 'opencode' ? 'files/agents' : 'files'} · ↑↓ select · tab insert · esc cancel  (${composerMentionIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerMentionResults.slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerMentionIndex
          const label = entry.kind === 'agent' ? `@${entry.name}` : entry.basename
          const detail = entry.kind === 'agent'
            ? [entry.mode, entry.description].filter(Boolean).join(' · ')
            : entry.path
          return (
            <box key={entry.kind === 'agent' ? `agent:${entry.name}` : `file:${entry.path}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(label, basenameWidth)}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(detail, pathWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerSlashPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerSlashOpen || composerSlashVisibleCount <= 0 || composerMention) return null
    const hasHint = composerSlashCommands.some((entry) => Boolean(entry.argumentHint))
    const commandRatio = hasHint ? 0.45 : 0.3
    const commandCap = hasHint ? 36 : 22
    const commandWidth = Math.max(Math.min(commandCap, Math.floor(rowWidth * commandRatio)), 8)
    const descWidth = Math.max(rowWidth - commandWidth - 4, 4)
    const total = composerSlashCommands.length
    const start = Math.max(0, Math.min(composerSlashIndex - Math.floor((composerSlashVisibleCount - 1) / 2), total - composerSlashVisibleCount))
    const end = Math.min(total, start + composerSlashVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    return (
      <box
        width={panelWidth}
        height={composerSlashVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`${composerConfig.label} commands · ↑↓ select · tab insert · esc cancel  (${composerSlashIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerSlashCommands.slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerSlashIndex
          const commandText = entry.argumentHint
            ? fitText(`${entry.command} ${entry.argumentHint}`, commandWidth)
            : fitText(entry.command, commandWidth)
          return (
            <box key={entry.command} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{commandText}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(entry.description, descWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerHistoryPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerHistoryOpen || composerHistoryVisibleCount <= 0 || composerMention) return null
    const total = sentHistory.length
    const start = Math.max(0, Math.min(composerHistoryIndex - Math.floor((composerHistoryVisibleCount - 1) / 2), total - composerHistoryVisibleCount))
    const end = Math.min(total, start + composerHistoryVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    const metaWidth = Math.max(Math.min(22, Math.floor(rowWidth * 0.28)), 10)
    const textWidth = Math.max(rowWidth - metaWidth - 4, 8)
    return (
      <box
        width={panelWidth}
        height={composerHistoryVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`history · ⌃P older · ⌃N newer · tab/enter use · esc cancel  (${composerHistoryIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {sentHistory.slice().reverse().slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerHistoryIndex
          const text = composerSnapshotText(entry)
          const compact = compactComposerEntryText(text)
          const lineCount = composerEntryLineCount(text)
          const attachmentLabel = attachmentCountLabel(entry.attachments)
          const meta = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${text.length} chars${attachmentLabel ? ` · ${attachmentLabel}` : ''}`
          return (
            <box key={`history:${total - 1 - index}:${text.length}:${offset}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compact, textWidth)}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(meta, metaWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerRewindPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerRewindItems || composerRewindVisibleCount <= 0) return null
    const total = composerRewindItems.length
    const start = Math.max(0, Math.min(composerRewindIndex - Math.floor((composerRewindVisibleCount - 1) / 2), total - composerRewindVisibleCount))
    const end = Math.min(total, start + composerRewindVisibleCount)
    return (
      <box
        width={panelWidth}
        height={composerRewindVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`rewind to before · ↑↓ choose · enter rewind · tab rewind + files · esc cancel  (${composerRewindIndex + 1}/${total})${start > 0 ? ' ↑' : ''}${end < total ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerRewindItems.slice(start, end).map((entry, offset) => {
          const active = start + offset === composerRewindIndex
          return (
            <box key={`rewind:${entry.uuid}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compactComposerEntryText(entry.text), Math.max(rowWidth - 2, 8))}</text>
            </box>
          )
        })}
      </box>
    )
  }
  const renderComposerStashPanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || !composerStashOpen || composerStashVisibleCount <= 0 || composerMention) return null
    const total = composerStash.length
    const start = Math.max(0, Math.min(composerStashIndex - Math.floor((composerStashVisibleCount - 1) / 2), total - composerStashVisibleCount))
    const end = Math.min(total, start + composerStashVisibleCount)
    const hasMoreBelow = end < total
    const hasMoreAbove = start > 0
    const metaWidth = Math.max(Math.min(22, Math.floor(rowWidth * 0.28)), 10)
    const textWidth = Math.max(rowWidth - metaWidth - 4, 8)
    return (
      <box
        width={panelWidth}
        height={composerStashVisibleCount + 3}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={theme.border2}
        flexDirection="column"
      >
        <text fg={composerAccentColor} wrapMode="none">
          {fitText(`stash · ⌃P older · ⌃N newer · tab/enter restore · esc close  (${composerStashIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
        </text>
        {composerStash.slice().reverse().slice(start, end).map((entry, offset) => {
          const index = start + offset
          const active = index === composerStashIndex
          const text = composerSnapshotText(entry)
          const compact = compactComposerEntryText(text)
          const lineCount = composerEntryLineCount(text)
          const attachmentLabel = attachmentCountLabel(entry.attachments)
          const meta = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${text.length} chars${attachmentLabel ? ` · ${attachmentLabel}` : ''}`
          return (
            <box key={`stash:${total - 1 - index}:${text.length}:${offset}`} flexDirection="row" height={1} width={rowWidth}>
              <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
              <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compact, textWidth)}</text>
              <text fg={theme.dim} wrapMode="none">  </text>
              <text fg={theme.dim} wrapMode="none">{fitText(meta, metaWidth)}</text>
            </box>
          )
        })}
      </box>
    )
  }
  // Always-visible queued-send list (no modal): shows what will fire after the
  // current turn, in order, with the ⌃Y edit / ⇧⌃Y clear hint.
  const renderComposerQueuePanel = (panelWidth: number, rowWidth: number) => {
    if (!composerActive || activeQueuedComposerSends.length === 0) return null
    const visible = Math.min(activeQueuedComposerSends.length, 4)
    const hiddenCount = activeQueuedComposerSends.length - visible
    return (
      <box
        width={panelWidth}
        height={visible + (hiddenCount > 0 ? 2 : 1) + 2}
        paddingX={1}
        backgroundColor={theme.surface2}
        border
        borderStyle="single"
        borderColor={composerQueueDurable ? (theme.amber ?? theme.border2) : theme.red}
        flexDirection="column"
      >
        <text fg={composerQueueDurable ? (theme.amber ?? composerAccentColor) : theme.red} wrapMode="none">
          {fitText(`${composerQueueDurable ? '' : 'memory only · '}queued (${activeQueuedComposerSends.length}) · sends in order after this turn · ⌃Y edit newest · ⇧⌃Y clear`, rowWidth)}
        </text>
        {activeQueuedComposerSends.slice(0, visible).map((entry, index) => {
          const compact = compactComposerEntryText(entry.text)
          const attachmentLabel = attachmentCountLabel(entry.attachments)
          const suffix = attachmentLabel ? `  ${attachmentLabel}` : ''
          return (
            <box key={entry.id} flexDirection="row" height={1} width={rowWidth}>
              <text fg={theme.dim} wrapMode="none">{`${index + 1}. `}</text>
              <text fg={theme.text} wrapMode="none">{fitText(compact, Math.max(rowWidth - 6 - suffix.length, 8))}</text>
              <text fg={theme.dim} wrapMode="none">{suffix}</text>
            </box>
          )
        })}
        {hiddenCount > 0 ? (
          <text fg={theme.dim} wrapMode="none">{fitText(`  +${hiddenCount} more queued`, rowWidth)}</text>
        ) : null}
      </box>
    )
  }


  // The active transcript uses the same controls in a tiled or floating window,
  // independently of the tool tab displayed elsewhere in the layout.
  // Chat and Agents: the composer is the transcript window's own trailing child
  // — a full-width highlighted bar in the same style as a user message row,
  // inside the same border as the transcript, so it reads as the next line of
  // the conversation rather than a docked control.
  const embeddedComposerChrome: WindowChrome | null = !composerWindowOpen && !composerHidden && embeddedComposer ? {
    rows: composerDockHeight,
    render: (chromeWidth: number) => (
        // Chat and Agents: the composer is the reader box's own trailing child —
        // a full-width highlighted bar in the same style as a user message
        // row, inside the same border as the transcript, so it reads as
        // the next line of the conversation rather than a docked control.
        <box
          id="composer-dock"
          width="100%"
          height={composerDockHeight}
          flexDirection="column"
          paddingX={1}
          backgroundColor={theme.surface2}
          border={['top', 'left', 'right']}
          borderStyle="single"
          borderColor={chatComposerFocused ? theme.border2 : theme.surface2}
        >
          <box
            flexGrow={1}
            overflow="hidden"
            paddingX={1}
            paddingBottom={1}
            // Matches the textarea so the well covers the prompt glyph and
            // the padding either side of it, not just the text.
            backgroundColor={chatComposerFocused ? theme.bg : theme.surface2}
            flexDirection="row"
            onMouseDown={(event) => {
              if (event.button !== 0) return
              if (!composerActive) setComposerActive(true)
              composerTextareaRef.current?.focus()
            }}
          >
            <text fg={chatComposerFocused ? theme.text : theme.dim} wrapMode="none">
              {chatComposerFocused ? '❯ ' : '› '}
            </text>
            <box flexGrow={1}>
              {renderComposerTextarea(submitComposerFromDock, {
                height: composerDockTextareaHeight,
                width: Math.max(chromeWidth - 8, 1),
                variant: 'chat',
              })}
            </box>
          </box>
          <box
            id="chat-composer-status"
            position="absolute"
            bottom={-1}
            left={1}
            width={chatComposerStatusWidth}
            height={1}
            overflow="hidden"
            flexDirection="row"
            alignItems="center"
          >
            <box width={chatComposerStatsWidth} overflow="hidden" backgroundColor={theme.surface2} onMouseDown={event => { if (!composerSlashHint) clickComposerStatus(event, composerDockStatsFor(composerDraftState.read().length), chatComposerStatsWidth) }} onMouseMove={event => { if (!composerSlashHint) hoverComposerStatus('chat', event, composerDockStatsFor(composerDraftState.read().length), chatComposerStatsWidth) }} onMouseOut={() => setComposerStatusHover(null)}>
              <text id="chat-composer-focus-state" fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none" selectable={false}>
                {composerSlashHint
                  ? fitText(composerSlashHint, chatComposerStatsWidth)
                  : <DraftLengthSpans draft={composerDraftState} build={composerDockStatsFor} width={chatComposerStatsWidth} padFg={theme.dim} hover={composerStatusHover?.site === 'chat' ? { index: composerStatusHover.index, bg: theme.surface3 } : null} />}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={chatComposerHintWidth} overflow="hidden" backgroundColor={theme.surface2}>
              <text fg={chatComposerFocused && !visibleComposerSending ? composerAccentColor : theme.dim} wrapMode="none">
                {chatComposerFocused && composerDockSendingHintSegments
                  ? renderInlineTextSegments(composerDockSendingHintSegments, chatComposerHintWidth, theme.dim)
                  : chatComposerHintFitted}
              </text>
            </box>
          </box>
        </box>
    ),
  } : null
  // The reader's chrome above and below the transcript, as rows the window
  // holding the transcript gives up (counted from the conditions that draw it).
  const contextRowShown = !presentationFocusMode && !isStreamView && (Boolean(contextUsage)
    || (selectedSession?.provider === 'claude' && (contextUsageStatus === 'loading' || contextUsageStatus === 'unavailable')))
  const tailBannerShown = !followTail && (!isScrollbackView || pendingNewCount > 0)
  const readerHeaderChrome: WindowChrome = {
    rows: (!presentationFocusMode && isCopilotView ? 1 : 0) + (!presentationFocusMode && !isStreamView ? 2 : 0)
      + (contextRowShown ? 1 : 0) + (fleetStripVisible ? 1 : 0) + (error ? 2 : 0) + (!showToolCalls ? 1 : 0)
      + (tailBannerShown ? 2 : 0) + (normalizedSearchQuery ? 2 : 0),
    render: (chromeWidth: number) => (
      <>
      {!presentationFocusMode && isCopilotView ? (
        <box height={1} paddingX={1} flexDirection="row" alignItems="center">
          {['Current', 'Sessions', 'Issues', 'Pull requests', 'Gists'].map((tab) => {
            const active = tab === 'Current'
            return (
              <box key={tab} paddingX={1} backgroundColor={active ? theme.cyan : theme.bg}>
                <text fg={active ? theme.bg : theme.muted} attributes={active ? TextAttributes.BOLD : undefined} wrapMode="none">{tab}</text>
              </box>
            )
          })}
        </box>
      ) : null}

      {!presentationFocusMode && !isStreamView ? (
        <box paddingX={2} paddingTop={1} flexDirection="row" alignItems="center">
          <text fg={providerAccent} wrapMode="none">{'● '}</text>
          <box flexGrow={1} overflow="hidden">
            <text fg={theme.muted} wrapMode="none">
              {fitText(showTabs
                ? `${TRANSCRIPT_VIEW_LABELS[transcriptView]} · ${followTail ? 'Following latest' : 'Reading history'}`
                : `${TRANSCRIPT_VIEW_LABELS[transcriptView]} · ${readerTitle}`, Math.max(chromeWidth - readerContextMeta.length - 10, 12))}
            </text>
          </box>
          <box width={readerContextMeta.length} overflow="hidden">
            <text fg={theme.dim} wrapMode="none">{readerContextMeta}</text>
          </box>
        </box>
      ) : null}

      {!presentationFocusMode && !isStreamView && contextUsage ? (
        <box paddingX={1}>
          <text wrapMode="none">
            {renderInlineTextSegments(
              contextBarSegments(contextUsage.totalTokens, contextUsage.maxTokens, contextUsage.percentage, theme),
              chromeWidth - 4,
              theme.dim,
            )}
          </text>
        </box>
      ) : !presentationFocusMode && !isStreamView && selectedSession?.provider === 'claude' && contextUsageStatus === 'loading' ? (
        <box paddingX={1}>
          <text fg={theme.dim}>{fitText('Loading context usage…', chromeWidth - 4)}</text>
        </box>
      ) : !presentationFocusMode && !isStreamView && selectedSession?.provider === 'claude' && contextUsageStatus === 'unavailable' ? (
        <box paddingX={1}>
          <text fg={theme.dim}>{fitText('Context usage unavailable', chromeWidth - 4)}</text>
        </box>
      ) : null}

      {fleetStripVisible ? (
        <box paddingX={1} flexDirection="row" overflow="hidden">
          <text wrapMode="none">
            {renderInlineTextSegments(fleetStripSegments, chromeWidth - 4, theme.dim)}
          </text>
        </box>
      ) : null}

      {error ? (
        <box paddingX={1} marginTop={1}>
          <text fg={theme.red}>{fitText(error, chromeWidth - 4)}</text>
        </box>
      ) : null}

      {!showToolCalls ? (
        <box
          id="show-tool-activity"
          height={1}
          paddingX={1}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            event.stopPropagation()
            setShowToolCalls(true)
            void writeTuiShowToolCalls(true).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
          }}
        >
          <text fg={theme.amber} wrapMode="none">{fitText('TOOLS HIDDEN · Click or Shift+X to show file and tool activity', chromeWidth - 4)}</text>
        </box>
      ) : null}

      {/* Reserved while reading history elsewhere; SCROLLBACK leaves the tail
          on every scroll, and two rows appearing above the text would jolt
          it, so there the banner exists only while it has something to say. */}
      {!followTail && (!isScrollbackView || pendingNewCount > 0) ? (
        <box paddingX={1} marginTop={1}>
          <text fg={theme.amber}>
            {pendingNewCount > 0
              ? fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, chromeWidth - 4)
              : ' '}
          </text>
        </box>
      ) : null}

      {normalizedSearchQuery ? (
        <box paddingX={1} marginTop={1}>
          <text fg={theme.dim}>
            {fitText(
              `/${searchQuery}  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}`,
              chromeWidth - 4,
            )}
          </text>
        </box>
      ) : null}

      </>
    ),
  }
  const idleTickerShown = followTail && visibleTranscriptCards.length > 0 && !turnRunningForComposer && !embeddedComposer && !isStreamView
  const readerFooterChrome: WindowChrome = {
    rows: chatTurnStatusRows + (idleTickerShown ? 2 : 0) + (embeddedComposerChrome?.rows ?? 0),
    render: (chromeWidth: number) => (
      <>
      {chatTurnStatusRows > 0 ? (
        <box
          id="chat-turn-status"
          height={1}
          flexShrink={0}
          paddingLeft={densityState.bodyIndent + 1}
          flexDirection="row"
        >
          <text fg={theme.cyan} wrapMode="none">{'● '}</text>
          <box flexGrow={1}>
            {visibleComposerSending ? (
              <ComposerWaitingStatus
                startedAt={composerSendStartedAt}
                seed={composerWaitingStatusSeed}
                suffix={composerWaitingSuffix}
                theme={theme}
                width={Math.max(chromeWidth - densityState.bodyIndent - 6, 16)}
                message={composerWaitingOnUser}
              />
            ) : (
              <Spinner
                label={fitText(
                  visibleAwaitingPersistedTurn
                    ? 'Syncing transcript…'
                    : 'Turn running · reattached — output syncs as it persists · ⌃C interrupt',
                  Math.max(chromeWidth - densityState.bodyIndent - 6, 16),
                )}
                fg={theme.cyan}
                labelFg={theme.dim}
              />
            )}
          </box>
        </box>
      ) : null}

      {/* The idle ticker means "nothing is happening — still watching". A
          running turn has its own pinned status row next to the composer
          (elapsed, tokens, interrupt hint), so showing both put a spinner
          reading "waiting patiently" directly above one reading "Shaping
          the next move… 2s". Exactly one spinner is on screen at a time,
          and which one tells you whether a turn is live.

          Chat and Agents omit the idle ticker. Their single activity row
          appears immediately above the composer only while a turn runs.
          Stream and Scrollback omit it too: they are the bare transcript,
          and two rows saying nothing is happening are two rows of it. */}
      {followTail && visibleTranscriptCards.length > 0
        && !turnRunningForComposer && !embeddedComposer && !isStreamView ? (
        <box paddingX={2} paddingBottom={1}>
          <IdleTicker seed={selectedSessionKey ?? ''} theme={theme} />
        </box>
      ) : null}

      {embeddedComposerChrome?.render(chromeWidth)}
      </>
    ),
  }
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
  const renderSurfaceWindow = (surface: WindowSurfaceId, index: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden = false, place?: { x: number; y: number; zIndex: number }) => {
    const focused = splitFocusIndex === index
    const height = size.boxHeight ?? size.height
    return (
      <box
        key={`surface-window:${surface}`}
        id={place ? `surface-frame:${surface}` : `split-pane:${index}`}
        visible={!hidden}
        width={size.width}
        height={size.boxHeight}
        {...(place ? { position: 'absolute' as const, left: place.x, top: place.y, zIndex: place.zIndex } : {})}
        {...(index === FLOATING_PANE_INDEX ? {
          onMouseDrag: (event: { x: number; y: number }) => moveFloatGesture(event),
          onMouseUp: (event: { x: number; y: number }) => endFloatGesture(event),
        } : {
          onMouseDrag: (event: { x: number; y: number }) => sessionDragHandlers.move(event),
          onMouseUp: (event: { x: number; y: number }) => sessionDragHandlers.release(event),
        })}
        flexShrink={0}
        flexDirection="column"
        // Not clipped here: the tab strip and the title buttons sit on the border,
        // and a clipping frame does not paint them. The body clips instead.
        border
        borderStyle="single"
        borderColor={focused ? theme.cyan : theme.border}
        backgroundColor={theme.surface}
        title={` ${windowSurfaceTitle(surface)} `}
        titleColor={focused ? theme.cyan : theme.dim}
        onMouseDown={(event) => {
          if (event.button === 2) {
            openSurfaceWindowMenu(surface, index, event)
            return
          }
          if (event.button !== 0) return
          if (surfacePanelFocused) setSurfacePanelFocused(false)
          focusSplitPane(index)
          // The title row is the handle: dragging it moves the window.
          const frame = renderer.root.findDescendantById(index === FLOATING_PANE_INDEX ? 'floating-window' : `split-pane:${index}`) as unknown as { y: number } | null
          if (index === FLOATING_PANE_INDEX) { if (frame && event.y === frame.y) startFloatGesture('move', event); return }
          if (index >= 0 && frame && event.y === frame.y) {
            let clicks = surfaceTitleClicksRef.current.get(surface)
            if (!clicks) { clicks = { current: null }; surfaceTitleClicksRef.current.set(surface, clicks) }
            if (isDoubleClick(clicks, event)) toggleWindowZoom(index)
            else sessionDragImplRef.current.pressSurface(surface, index, event)
          }
        }}
      >
        {renderWindowTabs(surfaceWindowKey(surface), index, size.width, -1, 1, 16)}
        <box position="absolute" top={-1} right={1} height={1} flexDirection="row" zIndex={3}>
          <WindowButton id={`surface-window-menu:${surface}`} label=" ≡ " theme={theme} onPress={point => openWindowControlMenu(surfaceWindowKey(surface), point)} />
          <WindowButton id={`surface-window-to-panel:${surface}`} label={isPopoverWindowKind(surfaceKindOf(surface)) ? ' ⤢ ' : ' ⇥ panel '} theme={theme} onPress={() => moveSurfaceToPanel(surface)} />
          <WindowButton id={`surface-window-close:${surface}`} label=" × " theme={theme} tone="danger" onPress={() => closeSurfaceWindow(surface)} />
        </box>
        <box flexGrow={1} overflow="hidden">
          <RetainedWindow visible={!hidden}>
          {renderSurfaceBody(surfaceKindOf(surface), { width: Math.max(10, size.width - 2), height: Math.max(3, height - 2) }, () => closeSurfaceWindow(surface), focused && !composerActive, surface)}
          </RetainedWindow>
        </box>
      </box>
    )
  }

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

  const renderSurfaceLayer = () => {
    const area = { width: readerAreaWidth, height: windowAreaHeight }
    const rects = treeGeometry ? [treeGeometry.rects.get(-1)!, ...Array.from({ length: visibleSplitPaneCount }, (_, index) => treeGeometry!.rects.get(index)!)] : windowLayoutRects(fittedWindows, { ...area, orientation: splitOrientation, readerLast: splitReaderLast })
    const frameOf = (key: string): { index: number; rect: { x: number; y: number; width: number; height: number } } | null => {
      const index = fittedWindowKeys.indexOf(key)
      if (index < 0) return null
      if (zoomedIndex === index) return { index, rect: { x: 0, y: 0, ...area } }
      const parent = rectOf('window-area')
      const slot = rectOf(`split-pane:${index}`)
      if (parent && slot && slot.width > 0 && slot.height > 0) {
        return { index, rect: { x: slot.x - parent.x, y: slot.y - parent.y, width: slot.width, height: slot.height } }
      }
      const rect = rects[index + 1]
      return rect ? { index, rect } : null
    }
    const owned = new Set<WindowSurfaceId>([
      ...windowSurfaces,
      ...liveWindowStacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey),
      ...(floatingKey && isSurfaceWindowKey(floatingKey) ? [surfaceIdOfKey(floatingKey)] : []),
    ])
    return [...owned].sort().map((surface) => {
      const key = surfaceWindowKey(surface)
      if (windowSurfacePeek === surface) {
        return renderSurfaceWindow(surface, -1, { ...area, boxHeight: area.height }, false, { x: 0, y: 0, zIndex: 5 })
      }
      if (key === floatingKey && floatingWindow) {
        const rect = clampFloatingRect(floatingWindow.rect, area)
        const shown = !fullscreenMode && !windowSurfacePeek
        return renderSurfaceWindow(surface, FLOATING_PANE_INDEX, { width: rect.width, height: rect.height, boxHeight: rect.height }, !shown, { x: rect.x, y: rect.y, zIndex: 41 })
      }
      const own = frameOf(key)
      // A background tab sits hidden at its frame, so showing it is a visibility change.
      const frameKey = own ? key : windowStackFor(key)?.find((member) => fittedWindowKeys.includes(member))
      const at = own ?? (frameKey ? frameOf(frameKey) : null)
      const rect = at?.rect ?? { x: 0, y: 0, width: Math.max(10, area.width), height: Math.max(3, area.height) }
      const hidden = !own || Boolean(windowSurfacePeek) || fullscreenMode || (zooming && zoomedIndex !== own.index)
      return renderSurfaceWindow(surface, own ? own.index : -2, { width: rect.width, height: rect.height, boxHeight: rect.height }, hidden, { x: rect.x, y: rect.y, zIndex: 5 })
    })
  }

  // One split pane's frame, at the size its arrangement gives it.
  const renderSplitPane = (splitSession: Session, splitIndex: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden = false) => (
    <box
      key={`split:${sessionKey(splitSession)}`}
      id={`split-pane:${splitIndex}`}
      visible={!hidden}
      width={size.width}
      // Stacked panes own a fixed row slice so the reader flex-grows into
      // exactly what is left; side-by-side panes fill the column height.
      height={size.boxHeight}
      flexShrink={0}
      flexDirection="column"
      overflow="hidden"
    >
      <RetainedWindow visible={!hidden} identity={`${splitIndex}:${sessionKey(splitSession) === selectedSessionKey}:${splitIndex === chromeWindowIndex}`}>
      <SplitTranscriptPane
        session={splitSession}
        paneIndex={splitIndex}
        paneNumber={splitIndex === FLOATING_PANE_INDEX ? visibleSplitPaneCount + windowNumberOffset : splitIndex + windowNumberOffset}
        paneCount={visibleSplitPaneCount + (primaryLeaf ? 1 : 0) + (floatingKey ? 1 : 0)}
        focused={effectiveFocus === 'messages' && splitFocusIndex === splitIndex && !composerActive}
        selected={sessionKey(splitSession) === selectedSessionKey}
        onCursorChange={sessionKey(splitSession) === selectedSessionKey ? reportSelectedWindowCursor : undefined}
        onFollowChange={sessionKey(splitSession) === selectedSessionKey ? setFollowTail : undefined}
        chromeHost={splitIndex === chromeWindowIndex}
        frameless={fullscreenMode}
        searchQuery={sessionKey(splitSession) === selectedSessionKey ? deferredSearchQuery : ''}
        activeSearchKey={searchMatches.length ? visibleTranscriptCards[searchMatches[searchMatchIndex] ?? -1]?.key ?? null : null}
        registerHandle={registerSplitPaneHandle}
        theme={theme}
        densityState={densityState}
        density={density}
        showToolCalls={showToolCalls}
        syntaxStyle={syntaxStyle}
        shouldEnableSyntaxHighlighting={shouldEnableSyntaxHighlighting}
        diffControls={transcriptDiffControls}
        agentToolCursorByGroupKey={agentToolCursorByGroupKey}
        onSelectAgentTool={selectAgentTool}
        thinkingMode={thinkingMode}
        diffLayout={diffLayout}
        imessageStyle={imessageStyle}
        transcriptWidth={transcriptWidth}
        transcriptView={transcriptView}
        width={size.width}
        height={size.height}
        liveMessages={splitPaneLiveMessages.get(sessionKey(splitSession)) ?? SPLIT_PANE_EMPTY_LIVE}
        liveBaselineCount={liveTranscriptBaselineRef.current.get(sessionKey(splitSession))?.count}
        running={splitPaneRunningKeys.has(sessionKey(splitSession))}
        attentionBadge={badgeForWindow(sessionKey(splitSession))}
        coordinatorLabel={watchedCoordinator?.agents.find(agent => agent.sessionId === splitSession.sessionId && (agent.provider ?? 'claude') === (splitSession.provider ?? 'claude'))?.name}
        onActivity={reportWindowActivity}
        // Streaming text belongs to whichever session the composer is
        // sending to; show it in the pane when that's this pane.
        liveText={
          composerSendState === 'sending'
          && composerLiveText
          && composerActivitySessionKey === sessionKey(splitSession)
          && !(splitPaneLiveMessages.get(sessionKey(splitSession)) ?? []).some(isLiveAssistantTextMessage)
            ? composerLiveText
            : null
        }
        onActivate={focusSplitPane}
        onClosePane={splitPaneActions.close}
        onPromotePane={splitPaneActions.promote}
        onOpenLayout={splitPaneActions.openLayout}
        onContextMenu={splitPaneActions.sessionMenu}
        stickyHeaders={stickyHeaders}
        lightweight={lightweightWindows}
        onTranscriptPress={noteTranscriptLinkPress}
        onTranscriptRelease={openTranscriptLinkAt}
        onOpenAsyncQuestions={openCardAsyncQuestions}
        floatGesture={floatGestureHandlers}
        sessionDrag={sessionDragHandlers}
        shouldYieldToForeground={splitPaneShouldYield}
      />
      </RetainedWindow>
      {renderWindowTabs(sessionKey(splitSession), splitIndex, size.width, 0, 1, 10)}
    </box>
  )

  // A frame's tab strip, over its title: one tab per member, the shown one lit.
  // A tab is clicked to show it and dragged to move it; × closes it.
  // `reserve` is the title bar's right end, where the frame's own buttons are.
  const renderWindowTabs = (key: string, index: number, frameWidth: number, top: number, left: number, reserve: number) => {
    const stack = windowStackFor(key)
    if (!stack) return null
    const available = Math.max(8, frameWidth - reserve - left)
    const each = Math.max(6, Math.floor(available / stack.length))
    return (
      <box id={`window-tabs:${index}`} position="absolute" top={top} left={left} width={available} height={1} flexDirection="row" zIndex={4} backgroundColor={theme.surface} overflow="hidden">
        {stack.map((member) => {
          const active = member === key
          return (
            <box key={member} id={`window-tab:${member}`} flexDirection="row" flexShrink={0} width={each} height={1} backgroundColor={active ? theme.surface3 : theme.surface}
              onMouseDown={(event) => {
                if (event.button !== 0) return
                // Inside a surface frame the frame's own title handler would take
                // the press over as a drag of the whole window.
                event.stopPropagation()
                sessionDragImplRef.current.pressTab(member, index, event, () => activateWindowTab(member))
              }}
              // Until the gesture layer exists, the tab itself gets the drag and the release.
              onMouseDrag={(event) => sessionDragHandlers.move(event)}
              onMouseUp={(event) => sessionDragHandlers.release(event)}
            >
              <text fg={active ? theme.cyan : theme.muted} wrapMode="none" selectable={false}>{fitText(` ${windowKeyTitle(member)}`, each - 2)}</text>
              <WindowButton id={`window-tab-close:${member}`} label="× " theme={theme} tone="danger" onPress={() => closeWindowTab(member)} />
            </box>
          )
        })}
      </box>
    )
  }

  // Dragging the panel's inner border by `delta` cells toward the reader (positive) or away.
  const resizeSurfacePanelBy = (delta: number) => {
    // A drag sets a size, so it ends an expansion.
    setSurfacePanelExpanded(false)
    if (surfacePanelAtBottom) {
      setSurfacePanelRows((current) => clamp(
        (surfacePanelExpanded ? effectiveSurfacePanelRows : current) + delta,
        SURFACE_PANEL_MIN_ROWS,
        surfacePanelMaxRows,
      ))
    } else {
      setSurfacePanelWidth((current) => clamp(
        (surfacePanelExpanded ? effectiveSurfacePanelWidth : current) + delta,
        SURFACE_PANEL_MIN_WIDTH,
        Math.min(SURFACE_PANEL_MAX_WIDTH, surfacePanelMaxWidth),
      ))
    }
  }

  // Whether a column of the tab strip is a tab's ×: the label's last cell,
  // tabWidth - 2 into the tab (one cell either side, a click is not that exact).
  const tabCloseHit = (x: number): boolean => {
    const instance = tabSelectRef.current
    if (!instance) return false
    const column = (x - instance.x) % tabWidth
    return column >= tabWidth - 3 && column <= tabWidth - 1
  }
  // The popover tab under a column of the tab strip, if that column is one.
  const popoverTabAt = (x: number): WindowSurfaceId | null => {
    const instance = tabSelectRef.current
    if (!instance) return null
    const scrollOffset = (instance as unknown as { scrollOffset: number }).scrollOffset ?? 0
    const index = scrollOffset + Math.floor((x - instance.x) / tabWidth) - visibleTabSessions.length
    return index >= 0 ? popoverTabs[index] ?? null : null
  }
  // The open tab under a column of the tab strip.
  const tabAt = (x: number): Session | null => {
    const instance = tabSelectRef.current
    if (!instance) return null
    const scrollOffset = (instance as unknown as { scrollOffset: number }).scrollOffset ?? 0
    return visibleTabSessions[scrollOffset + Math.floor((x - instance.x) / tabWidth)] ?? null
  }

  useLayoutEffect(() => {
    const capture = () => {
      const text = composerTextareaRef.current?.plainText ?? composerDraftRef.current
      if (composerDraftStorageKeyRef.current) {
        writeWorkspaceDraft(composerDraftStorageKeyRef.current, text)
        writeWorkspaceDraftParts(composerDraftStorageKeyRef.current, composerPromptPartsRef.current)
      }
      setComposerDraft(text)
    }
    const leave = () => {
      capture()
      // A shell gives the keys back on leaving; a view's own text input keeps its claim.
      if (typeof surfacePluginKeyCaptureRef.current === 'string') surfacePluginKeyCaptureRef.current = false
      windowSurfaceCaptureRef.current.clear()
      for (const key of composerSessions.keys()) {
        composerSessions.peekRef<AbortController | null>(key, 'composerAbortRef')?.current?.abort()
        composerSessions.set(key, 'composerSendState', 'idle', 'idle')
      }
      try { workspaceContext.controller.flush() } catch { /* next update retries */ }
    }
    workspaceContext.runtime.flushers.add(capture)
    workspaceContext.runtime.beforeLeave = leave
    return () => { workspaceContext.runtime.flushers.delete(capture); if (workspaceContext.runtime.beforeLeave === leave) workspaceContext.runtime.beforeLeave = null }
  })

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
  const renderSurfaceBodyInner = (kind: WindowSurfaceKind, box: { width: number; height: number }, close: () => void, focused: boolean, slot?: WindowSurfaceId, panelCwd?: string): React.ReactNode => {
    const surfaceCwd = slot ? windowSurfaceMeta[slot]?.cwd ?? gitRepoCwd : panelCwd ?? gitRepoCwd
    // A popover's own close (q, Esc) leaves a window but closes a popover tab.
    const leave = slot && popoverTabs.includes(slot) ? close : focusReaderFromSplit
    type SurfaceKeyHandler = (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => unknown
    // A popover's handler takes its own key type, a subset of what the root sends.
    const keysReady = (panelRef: { current: SurfaceKeyHandler | null }) => <K,>(handler: (key: K) => unknown) => {
      const surfaceHandler = handler as unknown as SurfaceKeyHandler
      if (slot) windowSurfaceKeysRef.current.set(slot, surfaceHandler)
      else panelRef.current = surfaceHandler
    }
    const captureChange = <T extends 'none' | 'input' | 'terminal' | boolean>(panelRef: { current: T }) => (capture: T) => {
      if (slot) windowSurfaceCaptureRef.current.set(slot, capture)
      else panelRef.current = capture
    }
    // Plugin surfaces in windows and the side panel. A popover kind's close
    // (Esc, q) leaves its window; a side-panel kind's closes it, as Files' does.
    if (isPluginSurfaceId(kind)) {
      const pinned = pluginSessionFor(kind, slot)
      // A file-pinned window shows its own file; the editor opens where it was asked to.
      const pathPinned = getPluginSurface(kind).pin === 'path'
      return (
        <PluginSurfaceHost
          surfaceId={kind}
          placement={slot ? 'window' : 'panel'}
          session={pinned}
          sessionKey={pinned ? sessionKey(pinned) : null}
          selected={pluginSelectedDetail}
          live={pluginLiveTranscript}
          request={pluginOpenRequests[kind]?.count}
          density={density}
          showToolCalls={showToolCalls}
          shouldYield={splitPaneShouldYield}
          cwd={surfaceCwd}
          repositorySessionId={gitSessionId}
          provided={slot && !pluginSurfaceWants(kind, 'session-fleet') ? windowPluginServices(slot) : kind === 'file-history' ? fileHistoryServices : pluginServicesFor(kind)}
          syntaxStyle={handoffBriefSyntaxStyle}
          path={pathPinned ? (slot ? windowSurfaceMeta[slot]?.path : fileHistoryPath) ?? null : editorInitialPath}
          line={pathPinned ? null : editorInitialLine}
          theme={theme}
          accent={composerAccentColor}
          width={box.width}
          height={box.height}
          focused={focused}
          onClose={isPluginPanelSurfaceId(kind) ? close : leave}
          onKeyHandlerReady={keysReady(surfacePluginKeyRef as { current: SurfaceKeyHandler | null })}
          onCaptureChange={slot ? captureChange<TuiPluginCapture>({ current: false }) : surfacePluginCaptureChange}
          runCommand={runCommandForPlugin}
        />
      )
    }
    switch (kind) {
      case 'agents':
        return (
          <TaskSidePanel
            messages={taskPanelMessages}
            todos={composerLiveTodos}
            session={selectedSession}
            theme={theme}
            width={box.width}
            height={box.height}
            onSelectTask={(uuid) => {
              const idx = visibleTranscriptCards.findIndex((c) => c.key === uuid)
              if (idx >= 0) jumpToTranscriptIndex(idx)
            }}
            tab="agents"
            liveSubagentText={liveSubagentText}
          />
        )
      // Popovers in windows: `close` there leaves the window (Esc, q), so the
      // popover's own close keys hand focus back rather than closing it.
      case 'attention':
        return (
          <AttentionInboxPopover docked items={attentionItems} theme={theme} width={box.width} height={box.height}
            respondingId={attentionRespondingId}
            onRespond={(item, response) => { void respondToAttentionItem(item, response) }}
            onOpenSession={openAttentionSession} onDismiss={dismissAttentionItem}
            onClose={leave} onKeyHandlerReady={keysReady({ current: null })} />
        )
      case 'prompt-library':
        return (
          <PromptLibraryPopover docked theme={theme} accentColor={composerAccentColor} width={box.width} height={box.height}
            activeProvider={selectedSessionTarget?.provider}
            loadPrompts={readTuiPrompts} loadPrompt={readTuiPrompt} savePrompt={saveTuiPrompt} deletePrompt={deleteTuiPrompt}
            onInsert={insertComposerPromptText} onClose={leave} onNotice={showNotice}
            onKeyHandlerReady={keysReady({ current: null })} />
        )
      case 'playbooks':
        return (
          <PlaybookManagerPopover docked theme={theme} width={box.width} height={box.height}
            cwd={selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()}
            onClose={leave} onChanged={handleCoordPlaybooksChanged} onNotice={showNotice}
            onKeyHandlerReady={keysReady({ current: null })} />
        )
      case 'handoff':
        return (
          <PinnedSessionDetail session={slot ? pinnedSessionOf(slot) : selectedSession} density={density} showToolCalls={showToolCalls} shouldYield={splitPaneShouldYield} theme={theme}>
            {(detail, session) => (
              <HandoffBriefPopover docked session={session} detail={detail} bookmarkIds={bookmarkKeys}
                theme={theme} syntaxStyle={handoffBriefSyntaxStyle} width={box.width} height={box.height}
                onClose={leave}
                onCopy={async (text) => {
                  try {
                    await writeClipboard(text, renderer)
                    showNotice('info', 'Copied handoff brief to clipboard')
                  } catch (err) {
                    showNotice('error', err instanceof Error ? err.message : 'Failed to copy handoff brief')
                  }
                }}
                onKeyHandlerReady={keysReady({ current: null })} />
            )}
          </PinnedSessionDetail>
        )
      case 'daily-summary':
        return (
          <DailySummaryPopover
            docked
            theme={theme}
            accentColor={composerAccentColor}
            width={box.width}
            height={box.height}
            waiting={attentionItems.map((item) => ({ provider: item.provider, sessionId: item.sessionId, kind: item.kind, text: item.title }))}
            onClose={leave}
            onNotice={showNotice}
            onKeyHandlerReady={keysReady({ current: null })}
            onCopy={(text) => { void writeClipboard(text, renderer) }}
            onSendToComposer={(text) => appendDiffCommentPromptToComposer(text)}
          />
        )
    }
  }

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
  const surfacePanelElement = surfacePanelVisible ? (
    <SurfacePanel
      state={surfacePanel}
      theme={theme}
      width={surfacePanelAtBottom ? readerAreaWidth : effectiveSurfacePanelWidth}
      expanded={surfacePanelExpanded}
      placement={surfacePanelPlacement}
      height={surfacePanelAtBottom ? effectiveSurfacePanelRows : surfacePanelHeight}
      focused={surfacePanelFocused}
      availability={panelSurfaceAvailability('tui', {
        browser: true,
        terminal: true,
        files: !!gitRepoCwd,
        diff: !!gitRepoCwd,
        'pull-request': !!gitRepoCwd,
        agents: true,
      })}
      unavailableHints={{
        files: 'Available when a project is open.',
        diff: 'Available for Git repositories.',
        'pull-request': 'Available when a project is open.',
      }}
      liveAgentCount={Object.values(liveSubagentText).filter((text) => text.trim().length > 0).length}
      onOpenSurface={(kind) => setSurfacePanel((current) => openSurfaceIn(current, kind))}
      onCloseSurface={(id) => setSurfacePanel((current) => closeSurfaceIn(current, id))}
      onCycleSurface={(delta) => setSurfacePanel((current) => cycleSurfaceIn(current, delta))}
      onBlur={() => setSurfacePanelFocused(false)}
      onFocus={() => setSurfacePanelFocused(true)}
      onActivateSurface={(id) => setSurfacePanel((current) => ({ ...current, activeId: id }))}
      onTogglePlacement={() => toggleSurfacePanelPlacement()}
      onMoveToWindow={(kind) => openSurfaceWindow(kind, { fromPanelId: activeSurface(surfacePanel)?.id })}
      onToggleExpand={() => setSurfacePanelExpanded((current) => !current)}
      onClosePanel={() => {
        setSurfacePanelOpen(false)
        setSurfacePanelFocused(false)
      }}
      onResizeStart={(position) => {
        surfacePanelResizeFromRef.current = position
        setSurfacePanelResizing(true)
      }}
      onKeyHandlerReady={(handler) => { surfacePanelKeyHandlerRef.current = handler }}
      surfaceKeyHandler={(key) => {
        const surface = activeSurface(surfacePanel)
        if (!surface) return
        if (isPluginSurfaceId(surface.kind)) surfacePluginKeyRef.current?.(key)
        // agents is read-only.
      }}
      renderSurface={(surface: TuiSurface, box) => renderSurfaceBody(surface.kind, box, () => setSurfacePanel((current) => closeSurfaceIn(current, surface.id)), surfacePanelFocused, undefined, surface.id, surface.cwd)}
    />
  ) : null

  // Popovers that take the whole screen from its top row, which the spaces bars must not paint over.
  const fullScreenPopoverOpen = Boolean(pluginOverlay && getPluginSurface(pluginOverlay).fullScreen) || folderPickerForNewSession
  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={theme.bg}>
      {spacesMenuOpen ? <SpacesManager controller={workspaceContext.controller} theme={theme} width={width} height={height} initialId={spacesMenuSelection} closeId={spacesCloseId} onClose={() => setSpacesMenuOpen(false)} onKeyHandlerReady={handler => { spacesKeyRef.current = handler }} /> : null}
      {workspacesEnabled ? <WorkspaceTabs theme={theme} width={width} onManage={openSpaces} under={fullScreenPopoverOpen} /> : null}
      <FloatingWindowLayer floatingItem={floatingItem} floatingWindow={floatingWindow} fullscreenMode={fullscreenMode} windowSurfacePeek={windowSurfacePeek} readerAreaWidth={readerAreaWidth} windowAreaHeight={windowAreaHeight} windowAreaRef={windowAreaRef} sidebarWidth={sidebarWidth} verticalTabsWidth={verticalTabsWidth} tabsEnabled={tabsEnabled} theme={theme} rectOf={rectOf} startFloatGesture={startFloatGesture} moveFloatGesture={moveFloatGesture} endFloatGesture={endFloatGesture} renderSplitPane={renderSplitPane} dockFloatingWindow={dockFloatingWindow} />
      <box
        flexGrow={surfacePanelAtBottom ? 0 : 1}
        flexShrink={surfacePanelAtBottom ? 0 : undefined}
        // No padding or gap: frames meet the screen edge and each other, and
        // the docked composer follows this row directly.
        height={mainContentHeight}
        flexDirection="row"
        backgroundColor={theme.bg}
      >
        <SessionRail showRail={showRail} sidebarWidth={sidebarWidth} sidebarExtraRows={sidebarExtraRows} mainContentHeight={mainContentHeight} sidebarView={sidebarView} effectiveFocus={effectiveFocus} theme={theme} coordinatorSidebarHeader={coordinatorSidebarHeader} sidebarHeaderBaseText={sidebarHeaderBaseText} toggleSidebarSort={toggleSidebarSort} showToggleOutcome={showToggleOutcome} sidebarSort={sidebarSort} sidebarHeaderPrefixWidth={sidebarHeaderPrefixWidth} sidebarProviderBadgeText={sidebarProviderBadgeText} sidebarProviderAccent={sidebarProviderAccent} workspacesEnabled={workspacesEnabled} openSpaces={openSpaces} fullScreenPopoverOpen={fullScreenPopoverOpen} setAllProjects={setAllProjects} allProjects={allProjects} sidebarInnerWidth={sidebarInnerWidth} sidebarRowBudget={sidebarRowBudget} density={density} sidebarScrollbarOptions={sidebarScrollbarOptions} loadingSessions={loadingSessions} sessions={sessions} sidebarEntries={sidebarEntries} sidebarScrollRef={sidebarScrollRef} sidebarRowElements={sidebarRowElements} />

        {showTabs && verticalTabsWidth > 0 ? <VerticalTabs
          options={tabOptions} activeIndex={activeStripIndex} running={runningTabKeys}
          width={verticalTabsWidth} height={mainContentHeight} theme={theme}
          onClose={index => {
            if (index < visibleTabSessions.length) closeSessionTab(visibleTabSessions[index])
            else { const id = popoverTabs[index - visibleTabSessions.length]; if (id) closePopoverTab(id) }
          }}
          onHorizontal={() => {
            setTabOrientation('horizontal')
            void writeTuiTabOrientation('horizontal').catch(err => setError(String(err)))
          }}
          onPress={(index, event) => {
            const session = visibleTabSessions[index]
            if (event.button === 2) {
              event.stopPropagation()
              if (session) splitPaneActions.sessionMenu(session, 'tab', event)
              else { const id = popoverTabs[index - visibleTabSessions.length]; if (id) openPopoverTabMenu(id, event) }
            } else if (event.button === 0) {
              if (session) sessionDragHandlers.press(session, null, event, () => selectStripIndex(index))
              else selectStripIndex(index)
            }
          }}
          onDrag={event => sessionDragHandlers.move(event)}
          onRelease={event => { if (event.button === 0) sessionDragHandlers.release(event) }}
        /> : null}
        <box width={readerAreaWidth} flexDirection="column">
          {showHorizontalTabs ? (
            <box
              id="session-tab-strip"
              height={TAB_BAR_HEIGHT}
              paddingTop={1}
              flexShrink={0}
              paddingX={1}
              overflow="hidden"
              backgroundColor={theme.bg}
            >
              <tab-select
                id="session-tabs"
                ref={tabSelectRef}
                options={tabOptions}
                width={tabStripWidth(readerAreaWidth)}
                height={1}
                tabWidth={tabWidth}
                backgroundColor={theme.bg}
                focusedBackgroundColor={theme.surface3}
                textColor={theme.muted}
                focusedTextColor={theme.text}
                selectedBackgroundColor={theme.surface}
                selectedTextColor={theme.cyan}
                selectedDescriptionColor={theme.dim}
                showDescription={false}
                showUnderline={false}
                showScrollArrows={true}
                wrapSelection={false}
                // A tab opens on release, and a press that moves drags it onto the
                // window area, as a rail row does.
                onMouseDown={(event) => {
                  const popoverTab = popoverTabAt(event.x)
                  if (popoverTab) {
                    event.stopPropagation()
                    if (event.button === 2) openPopoverTabMenu(popoverTab, event)
                    else if (event.button === 0 && tabCloseHit(event.x)) closePopoverTab(popoverTab)
                    else if (event.button === 0) showPopoverTab(popoverTab)
                    return
                  }
                  if (event.button === 2) {
                    const tab = tabAt(event.x)
                    if (tab) splitPaneActions.sessionMenu(tab, 'tab', event)
                    return
                  }
                  if (event.button !== 0) return
                  const tab = tabAt(event.x)
                  if (tab && tabCloseHit(event.x)) {
                    event.stopPropagation()
                    event.preventDefault()
                    closeSessionTab(tab)
                    return
                  }
                  if (tab) sessionDragHandlers.press(tab, null, event, () => selectTabSession(tab))
                }}
                onMouseDrag={(event) => sessionDragHandlers.move(event)}
                onMouseUp={(event) => {
                  if (event.button !== 0) return
                  sessionDragHandlers.release(event)
                }}
                onChange={(index: number) => selectStripIndex(index)}
              />
            </box>
          ) : showPreviewBar && selectedSession ? (
            <box paddingX={1} backgroundColor={theme.surface2}>
              <text fg={theme.cyan} wrapMode="none">{previewBarText}</text>
            </box>
          ) : null}

          {/* Reader + split panes share one frame area. Side-by-side lays it
              out as columns; stacked as rows, which is the only shape a split
              can take on a terminal too narrow for two 46-column frames. */}
          {/* Reader + split panes share one frame area, laid out by the
              window arrangement: along one axis (the tmux-style split, which
              is the only shape a narrow terminal can take), the reader beside
              a stack, or a grid. */}
          {windowOverflowRows > 0 ? (
            <box id="window-overflow" ref={windowOverflowRef} height={1} flexShrink={0} flexDirection="row" overflow="hidden" backgroundColor={theme.surface2}>
              <text fg={theme.amber} width={` +${overflowWindowItems.length} hidden · `.length} flexShrink={0} wrapMode="none">{` +${overflowWindowItems.length} hidden · `}</text>
              {overflowWindowItems.map((item, index) => {
                const title = fitText(item.kind === 'session' ? `${badgeForWindow(sessionKey(item.session)) ? `${badgeForWindow(sessionKey(item.session), true)} · ` : ''}${formatSessionTitle(item.session)}` : surfaceTitle(item.surface), 24).trimEnd()
                const label = `${index > 0 ? ' · ' : ''}${title}`
                return (
                  <box key={item.kind === 'session' ? sessionKey(item.session) : item.surface} width={label.length} flexShrink={0}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      if (item.kind === 'session') pickWindowTarget(sessionKey(item.session))
                      else showNotice('info', `${surfaceTitle(item.surface)} is preserved · enlarge the terminal to restore it`)
                    }}>
                    <text fg={theme.muted} wrapMode="none" selectable={false}>{label}</text>
                  </box>
                )
              })}
              <text fg={theme.dim} flexShrink={0} wrapMode="none"> · enlarge to restore</text>
            </box>
          ) : null}
          <box
            id="window-area"
            ref={windowAreaRef}
            flexDirection="row"
            flexGrow={1}
          >
          {workspacesEnabled && !workspaceLaunched ? (
            <WorkspaceLauncher theme={theme} cwd={workspaceCwd}
              onOpenSession={() => { setWorkspaceLaunched(true); setWorkspaceHasSession(true); setFocusedPane('sessions') }}
              onNewAgent={() => { setWorkspaceLaunched(true); setWorkspaceHasSession(true); setNewSessionCwd(workspaceCwd); setNewSessionModalOpen(true) }}
              onTerminal={() => { setWorkspaceLaunched(true); openSurfaceWindow('terminal') }}
              onLayout={() => { setWorkspaceLaunched(true); setWindowPickerOpen(true) }} />
          ) : windowSurfacePeek ? (
            // The surface layer draws the peeked window over the whole area.
            <box visible={false}>{readerFrameNode()}</box>
          ) : fullscreenMode && selectedSession ? (
            // Full screen is the selected transcript's window, filling the area
            // without its frame, under one row that says how to leave.
            <box flexDirection="column" flexGrow={1}>
              <box height={1} paddingX={1} flexDirection="row" alignItems="center" flexShrink={0}>
                <box flexGrow={1} />
                <box id="fullscreen-restore" paddingX={1} backgroundColor={theme.surface2}
                  onMouseDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); toggleFullscreenMode(false) }}>
                  <text fg={theme.dim} wrapMode="none" selectable={false}>FULLSCREEN  Shift+Z restore</text>
                </box>
              </box>
              {renderSplitPane(selectedSession, FULLSCREEN_PANE_INDEX, { width: readerAreaWidth, height: Math.max(windowAreaHeight - 1, 3), boxHeight: Math.max(windowAreaHeight - 1, 3) })}
            </box>
          ) : !hasPrimaryFrame && orderedWindowKeys.length === 0 ? (
            <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
              <text fg={theme.dim}>No panes open</text>
              <box onMouseDown={event => { if (event.button !== 0) return; event.stopPropagation(); setWorkspaceHasSession(true); setFocusedPane('sessions') }}><text fg={theme.cyan} selectable={false}>Open session from the sidebar</text></box>
            </box>
          ) : treeGeometry ? (
            <>
              {windowItems.map((item, index) => {
                const rect = treeGeometry!.rects.get(index)!
                // The reader draws this window (below, under the window's id).
                const hidden = windowHiddenByZoom(index) || index === popoverHostSlot
                return <box key={windowItemKey(item)} position="absolute" left={zoomedIndex === index ? 0 : rect.x} top={zoomedIndex === index ? 0 : rect.y}
                  width={zoomedIndex === index ? readerAreaWidth : rect.width} height={zoomedIndex === index ? windowAreaHeight : rect.height}
                  visible={!hidden} flexDirection="column">
                  {renderWindowItem(item, index, zoomAware(index, { width: rect.width, height: rect.height, boxHeight: rect.height }), hidden)}
                </box>
              })}
              {/* The window the reader draws carries that window's id, so anything that
                  finds a window by id (splits, drops, control mode) finds it here. */}
              {/* The popover tab, over the window it took (or in its own slot). */}
              <box key="tree-reader" position="absolute" left={windowZoom === 'reader' ? 0 : (treeGeometry.rects.get(-1)?.x ?? 0)} top={windowZoom === 'reader' ? 0 : (treeGeometry.rects.get(-1)?.y ?? 0)}
                width={windowZoom === 'reader' ? readerAreaWidth : treeGeometry.rects.get(-1)?.width ?? 0} height={windowZoom === 'reader' ? windowAreaHeight : treeGeometry.rects.get(-1)?.height ?? 0}
                visible={hasPrimaryFrame && (!zooming || windowZoom === 'reader')} flexDirection="row">{hasPrimaryFrame ? readerFrameNode() : null}</box>
            </>
          ) : (
            // Full screen with nothing selected: only a popover tab can be shown.
            readerFrameNode()
          )}
          {renderSurfaceLayer()}
          <SessionTabConnection tabs={tabSelectRef} readWindow={() => selectedWindowHandleRef.current?.()?.frame() ?? null}
            ownerKey={selectedSessionKey} enabled={showHorizontalTabs && !windowControlsBlocked && !fullScreenPopoverOpen && !shownPopoverTab}
            foreground={theme.cyan} background={theme.surface} />

          </box>
        </box>

        {/* Reserve the task-panel column in flow, then extend its frame through
            the docked composer so both share the right-hand column. */}
        {taskPanelVisible ? <box width={effectiveTaskPanelWidth} /> : null}
        <TaskSidePanelFrame taskPanelVisible={taskPanelVisible} effectiveSurfacePanelWidth={effectiveSurfacePanelWidth} effectiveTaskPanelWidth={effectiveTaskPanelWidth} surfacePanelHeight={surfacePanelHeight} taskPanelMessages={taskPanelMessages} composerLiveTodos={composerLiveTodos} selectedSession={selectedSession} theme={theme} visibleTranscriptCards={visibleTranscriptCards} jumpToTranscriptIndex={jumpToTranscriptIndex} taskPanelTab={taskPanelTab} liveSubagentText={liveSubagentText} />

        {/* Width reservation only — the panel itself is positioned absolutely
            below so it can share the full-height right-hand column. */}
        {surfacePanelOnRight ? (
          <box width={effectiveSurfacePanelWidth} />
        ) : null}

        {surfacePanelOnRight ? (
          // Beside the reader it spans the right-hand column, composer rows included.
          <box
            id="surface-panel-frame"
            position="absolute"
            top={0}
            right={0}
            width={effectiveSurfacePanelWidth}
            height={surfacePanelHeight}
            overflow="hidden"
            zIndex={5}
          >
            {surfacePanelElement}
          </box>
        ) : null}


        <SelectMenusOverlay themeMode={themeMode} theme={theme} providerMenuOpen={providerMenuOpen} presentationFocusMode={presentationFocusMode} providerOptions={providerOptions} providerMenuIndex={providerMenuIndex} setProviderMenuIndex={setProviderMenuIndex} chooseProvider={chooseProvider} modelPickerOpen={modelPickerOpen} width={width} height={height} composerAccentColor={composerAccentColor} modelPickerTarget={modelPickerTarget} modelPickerPermissionLabel={modelPickerPermissionLabel} modelPickerOptions={modelPickerOptions} modelPickerIndex={modelPickerIndex} composerCopilotContextTier={composerCopilotContextTier} modelPickerFocus={modelPickerFocus} filteredModelPickerOptions={filteredModelPickerOptions} modelPickerLoading={modelPickerLoading} modelPickerError={modelPickerError} modelPickerQuery={modelPickerQuery} setModelPickerQuery={setModelPickerQuery} setModelPickerIndex={setModelPickerIndex} applyModelPickerOption={applyModelPickerOption} compactModelPickerEffortOptions={compactModelPickerEffortOptions} modelPickerEffortIndex={modelPickerEffortIndex} setModelPickerEffortIndex={setModelPickerEffortIndex} applyModelPickerEffort={applyModelPickerEffort} compactModelPickerPermissionOptions={compactModelPickerPermissionOptions} modelPickerPermissionIndex={modelPickerPermissionIndex} setModelPickerPermissionIndex={setModelPickerPermissionIndex} applyModelPickerPermission={applyModelPickerPermission} modelPickerFocusedLabel={modelPickerFocusedLabel} modelPickerFocusedOption={modelPickerFocusedOption} modelPickerFocusedDescription={modelPickerFocusedDescription} />

        <ThemeMenuOverlay themeMenuOpen={themeMenuOpen} themeMenuOriginRef={themeMenuOriginRef} height={height} themeMenuGroup={themeMenuGroup} themeMenuQuery={themeMenuQuery} themeMenuIndex={themeMenuIndex} focusMode={focusMode} setThemeMenuQuery={setThemeMenuQuery} setThemeMenuIndex={setThemeMenuIndex} setThemeMode={setThemeMode} chooseTheme={chooseTheme} themeFollowsTerminal={themeFollowsTerminal} />

        <TranscriptViewMenuOverlay transcriptViewMenuOpen={transcriptViewMenuOpen} width={width} transcriptViewMenuOriginRef={transcriptViewMenuOriginRef} focusMode={focusMode} theme={theme} transcriptViewMenuIndex={transcriptViewMenuIndex} setTranscriptViewMenuIndex={setTranscriptViewMenuIndex} setTranscriptView={setTranscriptView} chooseTranscriptView={chooseTranscriptView} lightweightWindows={lightweightWindows} />

        <CommandPaletteOverlay commandPaletteOpen={commandPaletteOpen} width={width} filteredCommands={filteredCommands} paletteDisplayRows={paletteDisplayRows} commandPaletteIndex={commandPaletteIndex} commandPaletteBodyRows={commandPaletteBodyRows} commandPaletteTopOffset={commandPaletteTopOffset} theme={theme} commandPaletteQuery={commandPaletteQuery} />

        <ChordHelpOverlay chordHelp={chordHelp} width={width} height={height} composerDockHeight={composerDockHeight} composerStatusBlockHeight={composerStatusBlockHeight} toasts={toasts} theme={theme} />

        <BookmarksOverlay bookmarksOverlayOpen={bookmarksOverlayOpen} width={width} bookmarksOverlay={bookmarksOverlay} focusMode={focusMode} height={height} bookmarksOverlayIndex={bookmarksOverlayIndex} theme={theme} />

      </box>

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

      {(liveStatus === 'retrying' || liveStatus === 'compacting') && visibleComposerSending ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.amber} wrapMode="none">{'▌ '}</text>
          <text fg={theme.amber} wrapMode="none">
            {fitText(
              liveStatus === 'retrying'
                ? '● Retrying after a transient error…'
                : '● Compacting conversation to free up context…',
              Math.max(width - 6, 16),
            )}
          </text>
        </box>
      ) : null}

      {visibleComposerSending && composerLiveReasoning.trim() && !isStreamView ? (
        <LivePreviewCard
          title={`✻ THINKING · ${String(composerProvider ?? 'agent').toUpperCase()} · ${tuiEffort.toUpperCase()}${composerThinkingTokens > 0 ? ` · ~${composerThinkingTokens >= 1000 ? `${(composerThinkingTokens / 1000).toFixed(1)}k` : composerThinkingTokens} tok` : ''}`}
          lines={liveReasoningPreviewLines}
          accentColor={theme.violet}
          bodyColor={theme.muted}
          theme={theme}
        />
      ) : null}

      {/* Pinned for the whole turn — elapsed + token counter + interrupt hint
          must not vanish the moment the first delta or tool arrives, which is
          how the native Claude CLI status line behaves. */}
      {visibleComposerSending && !embeddedComposer && !composerTurnStatusInBorder ? (
        <box
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          paddingLeft={isChatLikeView ? densityState.bodyIndent : 1}
          height={1}
          flexShrink={0}
          flexDirection="row"
        >
          <text fg={theme.cyan} wrapMode="none">{isChatLikeView ? '● ' : '▌ '}</text>
          <box flexGrow={1}>
            <ComposerWaitingStatus
              startedAt={composerSendStartedAt}
              seed={composerWaitingStatusSeed}
              suffix={composerWaitingSuffix}
              theme={theme}
              width={Math.max(width - 6, 16)}
              message={composerWaitingOnUser}
            />
          </box>
        </box>
      ) : null}

      {!visibleComposerSending && reattachedRunning && !visibleAwaitingPersistedTurn && !embeddedComposer ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.cyan} wrapMode="none">{'▌ '}</text>
          <text fg={theme.muted} wrapMode="none">
            {fitText('● Turn running · reattached — output syncs as it persists · ⌃C interrupt', Math.max(width - 6, 16))}
          </text>
        </box>
      ) : null}

      {composerTargetSession?.provider === 'codex' && sessionDetail?.externalWriter ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.amber} wrapMode="none">{'▌ '}</text>
          <text fg={theme.muted} wrapMode="none">
            {fitText('● Open in another Codex client — transcript will lag until that turn finishes', Math.max(width - 6, 16))}
          </text>
        </box>
      ) : null}

      {visibleLiveToolActivities.length > 0 && visibleRunningToolCount > 0 ? (
        <box
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          paddingLeft={isChatLikeView ? densityState.bodyIndent : 1}
          paddingTop={isChatLikeView ? 0 : 1}
          flexDirection="row"
        >
          <text fg={theme.green} wrapMode="none">{isChatLikeView ? '● ' : '▌ '}</text>
          <text wrapMode="none">
            {renderInlineTextSegments([
              { text: 'tools  ', fg: theme.dim },
              ...visibleLiveToolActivities.flatMap((a, i): InlineTextSegment[] => [
                ...(i > 0 ? [{ text: '  ', fg: theme.dim }] : []),
                { text: a.label, fg: a.status === 'running' ? theme.text : theme.muted },
                { text: a.status === 'running' ? ' ●' : ' ✓', fg: a.status === 'running' ? theme.green : theme.dim },
              ]),
            ], Math.max(width - 6, 16), theme.dim)}
          </text>
        </box>
      ) : null}

      {composerActivityVisible ? (() => {
        const subagentEntries = Object.entries(liveSubagentText).filter(([, text]) => text.trim().length > 0)
        if (subagentEntries.length === 0) return null
        const [, latest] = subagentEntries[subagentEntries.length - 1]
        const tail = latest.replace(/\s+/g, ' ').trim().slice(-80)
        return (
          <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
            <text fg={theme.pink} wrapMode="none">{'▌ '}</text>
            <text fg={theme.dim} wrapMode="none">
              {fitText(`↪ subagent · ${tail}`, Math.max(width - 6, 16))}
            </text>
          </box>
        )
      })() : null}

      {livePromptSuggestion && composerSendState !== 'sending' ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text fg={theme.cyan} wrapMode="none">
            {fitText(`Tab → ${livePromptSuggestion}`, Math.max(width - 4, 20))}
          </text>
        </box>
      ) : null}

      <ComposerStatusMessage composerStatusMessage={composerStatusMessage} visibleComposerSending={visibleComposerSending} visibleComposerLiveText={visibleComposerLiveText} visibleComposerError={visibleComposerError} isChatLikeView={isChatLikeView} liveAssistantTextCardVisible={liveAssistantTextCardVisible} composerProvider={composerProvider} liveAssistantPreviewLines={liveAssistantPreviewLines} composerAccentColor={composerAccentColor} theme={theme} visibleAwaitingPersistedTurn={visibleAwaitingPersistedTurn} width={width} />

      {!composerWindowOpen && !composerHidden ? renderComposerMentionPanel(width, Math.max(width - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden && !composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden ? renderComposerHistoryPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden ? renderComposerStashPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden ? renderComposerRewindPanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}
      {!composerWindowOpen && !composerHidden && !composerHistoryOpen && !composerStashOpen ? renderComposerQueuePanel(composerAreaWidth, Math.max(composerAreaWidth - 4, 20)) : null}

      {!composerWindowOpen && !composerHidden && !embeddedComposer ? (
        <box
          id="composer-dock"
          marginLeft={composerAreaOffset}
          width={composerAreaWidth}
          paddingX={1}
          // The textarea paints theme.surface over its own cells; a dock in any
          // other shade showed as a padding stripe down each side and, with no
          // border in fullscreen, a band that did not match the draft.
          backgroundColor={composerDockBackground}
          border={fullscreenMode ? [] : ['top', 'left', 'right', 'bottom']}
          borderStyle={composerDockRouted ? 'heavy' : isChatLikeView ? 'single' : 'rounded'}
          borderColor={composerDockEmphasized ? composerAccentColor : theme.border}
          title={fullscreenMode || composerTurnStatusInBorder ? undefined : composerTargetMessage
            ? fitText(composerTargetMessage, composerDockTitleWidth)
            : isChatLikeView ? undefined : composerDockBorderTitle}
          titleColor={composerTargetMessage ? theme.cyan : composerDockEmphasized ? composerAccentColor : theme.dim}
          titleAlignment="left"
          height={composerDockHeight}
          flexDirection="column"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            if (surfacePanelFocused) setSurfacePanelFocused(false)
            if (!composerActive) setComposerActive(true)
            composerTextareaRef.current?.focus()
          }}
        >
          {composerTurnStatusInBorder ? (
            <box
              id="composer-dock-turn-status"
              position="absolute"
              top={-1}
              left={1}
              width={composerDockTextareaWidth}
              height={1}
              flexDirection="row"
              backgroundColor={composerDockBackground}
              overflow="hidden"
            >
              <box flexGrow={1} minWidth={0} overflow="hidden">
                <ComposerWaitingStatus
                  startedAt={composerSendStartedAt}
                  seed={composerWaitingStatusSeed}
                  suffix={composerWaitingSuffix}
                  theme={theme}
                  width={Math.max(1, composerDockTextareaWidth - (composerTargetMessage ? Math.min(36, Math.floor(composerDockTextareaWidth / 4)) + 3 : 0))}
                  message={composerWaitingOnUser}
                />
              </box>
              {composerTargetMessage ? (
                <text fg={theme.cyan} wrapMode="none" width={Math.min(36, Math.floor(composerDockTextareaWidth / 4)) + 3}>
                  {` · ${fitText(composerTargetMessage, Math.min(36, Math.floor(composerDockTextareaWidth / 4)))}`}
                </text>
              ) : null}
            </box>
          ) : null}
          {renderComposerTextarea(submitComposerFromDock, {
            height: composerDockTextareaHeight,
            width: composerDockTextareaWidth,
            background: composerDockBackground,
          })}
          {/* Stats and key hints sit *in* the bottom border rather than on a
              row above it — the same trick the top border's title uses, worth
              a whole row of draft back. Fullscreen has no border to sit in, so
              there it stays an ordinary flow row. */}
          <box
            id="composer-dock-status"
            {...(fullscreenMode
              // Out through the dock's padding, so the band meets both edges.
              ? { height: 1, backgroundColor: theme.surface3, marginLeft: -1, marginRight: -1, paddingX: 1 }
              : { position: 'absolute' as const, bottom: -1, left: 1, width: composerDockTextareaWidth, height: 1 })}
            flexDirection="row"
            alignItems="center"
          >
            <box width={composerDockFooterStatsWidth} overflow="hidden" backgroundColor={fullscreenMode ? undefined : theme.surface} onMouseDown={event => { if (!voiceStatus && !composerSlashHint) clickComposerStatus(event, dockFooterStatsFor(composerDraftState.read().length), composerDockFooterStatsWidth) }} onMouseMove={event => { if (!voiceStatus && !composerSlashHint) hoverComposerStatus('dock', event, dockFooterStatsFor(composerDraftState.read().length), composerDockFooterStatsWidth) }} onMouseOut={() => setComposerStatusHover(null)}>
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none" selectable={false}>
                {voiceStatus ? fitText(voiceStatus, composerDockFooterStatsWidth) : composerSlashHint
                  ? fitText(composerSlashHint, composerDockFooterStatsWidth)
                  : <DraftLengthSpans draft={composerDraftState} build={dockFooterStatsFor} width={composerDockFooterStatsWidth} padFg={theme.dim} hover={composerStatusHover?.site === 'dock' ? { index: composerStatusHover.index, bg: theme.surface3 } : null} />}
              </text>
            </box>
            {dockShowsStatusBar ? <TeammatesAttention inline theme={theme} width={Math.floor(composerDockTextareaWidth / 3)} session={selectedSession} /> : null}
            <box flexGrow={1} />
            <box width={composerDockFooterHintWidth} minWidth={0} flexShrink={1} overflow="hidden" backgroundColor={fullscreenMode ? undefined : theme.surface}>
              <text fg={composerActive && !visibleComposerSending ? composerAccentColor : theme.dim} wrapMode="none">
                {dockShowsStatusBar
                  ? renderInlineTextSegments(footerSegments, composerDockFooterHintWidth, theme.dim)
                  : composerDockSendingHintSegments
                  ? renderInlineTextSegments(composerDockSendingHintSegments, composerDockFooterHintWidth, theme.dim)
                  : fitHintText(composerDockFooterHint, composerDockFooterHintWidth)}
              </text>
            </box>
          </box>
        </box>
      ) : null}

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

      {pluginOverlay ? (
        <PluginSurfaceHost
          surfaceId={pluginOverlay}
          placement="overlay"
          session={pluginSessionFor(pluginOverlay)}
          sessionKey={pluginSessionFor(pluginOverlay) ? sessionKey(pluginSessionFor(pluginOverlay)!) : null}
          selected={pluginSelectedDetail}
          live={pluginLiveTranscript}
          request={pluginOpenRequests[pluginOverlay]?.count}
          density={density}
          showToolCalls={showToolCalls}
          shouldYield={splitPaneShouldYield}
          cwd={gitRepoCwd}
          repositorySessionId={gitSessionId}
          provided={pluginServicesFor(pluginOverlay)}
          syntaxStyle={handoffBriefSyntaxStyle}
          path={editorInitialPath}
          line={editorInitialLine}
          turn={pluginOverlay === 'checkpoints' ? checkpointFocusPrompt : null}
          runCommand={runCommandForPlugin}
          theme={theme}
          accent={composerAccentColor}
          width={width}
          height={height}
          focused
          // The control center is a modal: the root's modal scrim dims behind it.
          scrim={pluginOverlay !== 'coordination'}
          onClose={closePluginOverlay}
          onDetach={() => offerPopoverPlacement(pluginOverlay)}
          onKeyHandlerReady={registerPluginOverlayKeys}
        />
      ) : null}

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


      {composerWindowOpen ? (
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

      {composerWindowOpen ? (
        <box
          position="absolute"
          top={composerWindowTop}
          left={composerWindowLeft}
          width={composerWindowWidth}
          height={composerWindowHeight}
          border
          borderStyle="heavy"
          borderColor={composerAccentColor}
          backgroundColor={theme.surface2}
          zIndex={60}
          flexDirection="column"
          title={composerWindowBorderTitle}
          titleColor={composerAccentColor}
          titleAlignment="left"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            composerTextareaRef.current?.focus()
          }}
        >
          <box
            height={composerWindowHeaderHeight}
            paddingX={1}
            border={['bottom']}
            borderStyle="single"
            borderColor={theme.border}
            backgroundColor={theme.surface2}
            flexDirection="row"
            alignItems="center"
          >
            <text fg={theme.dim} wrapMode="none">
              {renderInlineTextSegments(composerWindowMetaSegments, composerWindowContentWidth, theme.dim)}
            </text>
          </box>

          <box
            height={composerWindowEditorHeight}
            paddingX={1}
            paddingY={1}
            flexDirection="column"
            overflow="hidden"
            backgroundColor={theme.surface}
          >
            {renderComposerTextarea(submitComposerFromWindow, {
              height: Math.max(composerWindowEditorHeight - 2, 2),
              width: composerWindowTextareaWidth,
            })}
          </box>

          {renderComposerMentionPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {!composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12)) : null}
          {renderComposerHistoryPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {renderComposerStashPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {renderComposerRewindPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {!composerHistoryOpen && !composerStashOpen ? renderComposerQueuePanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12)) : null}

          <box
            height={composerWindowFooterHeight}
            paddingX={1}
            border={['top']}
            borderStyle="single"
            borderColor={theme.border}
            backgroundColor={theme.surface2}
            flexDirection="row"
            alignItems="center"
          >
            <box width={composerWindowFooterStatsWidth} overflow="hidden">
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                {composerSlashHint
                  ? fitText(composerSlashHint, composerWindowFooterStatsWidth)
                  : <DraftLengthSpans draft={composerDraftState} build={composerWindowDraftFor} width={composerWindowFooterStatsWidth} padFg={theme.dim} />}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={composerWindowFooterHintWidth} overflow="hidden">
              <text fg={theme.dim} wrapMode="none">
                {composerWindowSendingHintSegments
                  ? renderInlineTextSegments(composerWindowSendingHintSegments, composerWindowFooterHintWidth, theme.dim)
                  : fitHintText(composerWindowFooterHint, composerWindowFooterHintWidth)}
              </text>
            </box>
          </box>
        </box>
      ) : null}


      {(() => {
        // The second divider: the grid's row split (the reader's bottom border).
        // Drawn at the root over that border, where it is inside its parent's
        // bounds. Borders between panes are the group handles below.
        if (!arrangedVisible || fullscreenMode || windowZoom !== null) return null
        const anchor = splitArrangement === 'grid' && arrangedLayout.secondary ? rectOf('transcript-reader') : null
        if (!anchor) return null
        const area = windowAreaRect()
        const left = area ? area.x : anchor.x
        const span = area ? area.width : anchor.width
        return (
          <box
            id="split-secondary-divider"
            position="absolute"
            top={anchor.y + anchor.height - 1}
            left={left + 1}
            width={Math.max(1, span - 2)}
            height={1}
            zIndex={40}
            onMouseOver={() => setSecondaryDividerHovered(true)}
            onMouseOut={() => setSecondaryDividerHovered(false)}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              setSplitDividerDragging('secondary')
            }}
          >
            <text fg={secondaryDividerHovered || splitDividerDragging === 'secondary' ? theme.cyan : theme.border} wrapMode="none" selectable={false}>
              {'─'.repeat(Math.max(1, span - 2))}
            </text>
          </box>
        )
      })()}

      {/* Every border between neighbouring panes: the frame before it, its
          right or bottom border, redrawn so it is hittable, and dragged. */}
      {!fullscreenMode && windowZoom === null && !windowSurfacePeek ? fittedWindows.groups.flatMap((group) => group.members.slice(0, -1).map((member, index) => {
        const rect = rectOf(`split-pane:${member}`)
        if (!rect) return null
        const id = `window-border:${group.key}:${index}`
        const lit = hoveredWindowBorder === id || (typeof splitDividerDragging === 'object' && splitDividerDragging?.group === group.key && splitDividerDragging.index === index)
        const vertical = group.axis === 'x'
        const length = Math.max(1, (vertical ? rect.height : rect.width) - 2)
        return (
          <box
            key={id}
            id={id}
            position="absolute"
            top={vertical ? rect.y + 1 : rect.y + rect.height - 1}
            left={vertical ? rect.x + rect.width - 1 : rect.x + 1}
            width={vertical ? 1 : length}
            height={vertical ? length : 1}
            zIndex={40}
            onMouseOver={() => setHoveredWindowBorder(id)}
            onMouseOut={() => setHoveredWindowBorder((current) => (current === id ? null : current))}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              setSplitDividerDragging({ group: group.key, index })
            }}
          >
            <text fg={lit ? theme.cyan : theme.border} wrapMode="none" selectable={false}>
              {vertical ? Array.from({ length }, () => '│').join('\n') : '─'.repeat(length)}
            </text>
          </box>
        )
      })) : null}

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
