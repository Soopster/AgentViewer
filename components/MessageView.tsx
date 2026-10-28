'use client'

import { beginProviderLoading } from '@/lib/providerLoading'

import { VoiceInput } from './VoiceInput'

import ContextComposer, { type ContextComposerHandle } from './ContextComposer'
import { contextReference, contextReferences, createContextAttachment, projectComposerContext, readComposerContext, restoreContextAttachments, referencedComposerAttachments, removeContextReference } from '@/lib/composerContext'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { ProtocolAgent } from '@/lib/agentProtocol'
import Link from 'next/link'
import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, useDeferredValue, useSyncExternalStore } from 'react'
import type {
  ApiMessage,
  SendState,
  ContextUsage,
  SessionInfo,
  SessionModelInfo,
  SessionComposerOptions,
  SessionDiagnosticSection,
  SendAttachment,
  ReasoningEffortLevel,
} from '@/lib/types'
import { readJsonResponse, readOptionalJsonResponse } from '@/lib/httpResponse'
import { buildThreadedMessages, buildThreadedMessagesIncremental, computeTurnDurationsMs, stripToolCallBlocks, type IncrementalThreadingCache, type ThreadedMessage } from '@/lib/threading'
import { measureSync, recordClientPerf } from '@/lib/clientPerf'
import { createStreamHistoryMetadataBuilder } from '@/lib/streamHistoryMetadata'
import { messageToCopyText } from '@/lib/threadedMessageText'
import { downloadHtml } from '@/lib/downloadHtml'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import {
  applyClaudeLiveToolResults,
  extractClaudeStreamToolResults,
  extractClaudeStreamToolInputDelta,
  normalizeClaudeStreamThreadedMessage,
  parseClaudeStreamToolInput,
} from '@/lib/claudeMapper'
import { normalizeCodexStreamArtifactMessage } from '@/lib/codexMapper'
import { getSlashCommandSuggestions, filterSlashCommands, normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '@/lib/slashCommands'
import { getProviderComposer } from '@/lib/providerComposer'
import { isPendingRequestGone, PENDING_REQUEST_GONE_NOTICE } from '@/lib/pendingRequestGone'
import { extractCopilotPushedAttachments, extractPendingPermission, extractPendingPermissions, extractPermissionReply, permissionMcpServerLabel, type PendingPermission, type PendingQuestionAnswers } from '@/lib/permissions'
import { parseClaudeCommandLifecycle } from '@/lib/claudeCommandLifecycle'
import { isResumeDropsTurnRefusal, isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs, TransientAwareSendError, type UsageLimitKind } from '@/lib/transientError'
import { respondToChannelPermission, readBridgeConfigFromEnv, type ChannelPermissionRequestEvent } from '@/lib/channelBridge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { getPluginCommand, getPluginSurface, isPluginSurfaceId, type PluginSurfaceId } from '@/lib/plugins/catalog'
import { dispatchPluginCommand, subscribePluginCommands } from '@/lib/plugins/commandBus'
import { isPluginEnabled } from '@/lib/plugins/enablement'
import { useDisabledPlugins } from '@/lib/plugins/useDisabledPlugins'
import { sameUserMessage } from '@/lib/composerTranscript'
import { createComposerSessions, useComposerSessionState } from '@/lib/composerSessions'
import { sessionIdentityKey } from '@/lib/sessionIdentity'
import type { WebPluginServices } from './shell/pluginTypes'
import { ArrowUp, BookOpen, ChartNetwork, ChevronDown, CircleAlert, CircleCheck, Clock3, FileCode2, Filter, Fullscreen, GitBranch, LoaderCircle, Maximize2, Minimize2, MonitorUp, PanelRight, Paperclip, Plug, Radio, RotateCcw, Search, Square, Terminal, TriangleAlert, X } from 'lucide-react'
import MessageItem, { MessageDensityProvider, ViewModeProvider, DiffStyleProvider, DiffOptionsProvider, type MessageDensity, type WebViewMode } from './MessageItem'
import { useChannelBridge } from './useChannelBridge'
import { useIdeBridge } from './useIdeBridge'
import type { PierreDiffStyle } from './PierreDiffView'
import { DEFAULT_DIFF_OPTIONS, QuestionAnswerComposerContext, DiffCommentComposerContext, LiveSubagentTextContext, TaskActiveFormsContext, buildTaskActiveFormsForWeb, streamMessageHasContent, type DiffOptions } from './messageItemShared'
import { TaskRail } from './TaskRail'
import ProviderIcon from './ProviderIcon'
import BranchSwitcher from './BranchSwitcher'
import { buildTaskRegistry, buildTaskRegistryFromCodexPlan, buildTaskRegistryFromTodos } from '@/lib/taskRegistry'
import MessageSessionVisualizer, { type MessageVisualizerRow } from './MessageSessionVisualizer'
import StreamHistoryRail, { type StreamHistoryItem } from './StreamHistoryRail'
import { getContinueInCliCommand } from '@/lib/cliContinue'
import { commandResultExpectsTranscript, isNativeComposerCommandText } from '@/lib/composerCommands'
import { deliverComposerSteer } from '@/lib/composerSteering'
import { type WebComposerQueueDurability } from '@/lib/webComposerQueue'
import { deriveComposerRuntimeState } from '@/lib/composerRuntimeState'
import type { GitSummary } from '@/lib/gitProvider'
import {
  clearComposerQueueTarget,
  createComposerQueueItemId,
  mergeComposerAttachments,
  removeComposerQueueItem,
  restoreComposerDraftPayload,
  selectComposerQueueTarget,
} from '@/lib/composerAttachments'
import CodeThemeToggle from './CodeThemeToggle'
import RenderFontToggle from './RenderFontToggle'
import {
  applyColorTreatment,
  DEFAULT_COLOR_TREATMENT,
  getCurrentColorTreatment,
  subscribeColorTreatment,
  type ColorTreatment,
} from '@/lib/colorTreatment'
import TabBar from './TabBar'
import {
  appendTimelineRowLayout,
  buildTimelineRowLayout,
  computeTimelineScrollCompensation,
  findTimelineScrollAnchor,
  getVirtualTimelineWindow,
  resolveTimelineRenderedHeight,
  type TimelineMeasurementChange,
  type TimelineRowLayout,
  type TimelineScrollAnchor,
} from '@/lib/timelineVirtualizer'
import type { ComposerDraft, QueuedWebSend, PendingMessageBaseline, TimelineRow, TimelineEstimateBucket, TimelineEstimateCalibration, ActiveTranscriptFilter, Props, CopilotContextTier, FailedSend, RewindPreview, RollbackPreview, SteeredSendEntry, LiveToolActivity, MentionResult, TimelineEstimateSample } from './message-view/types'
import { writeLocalStorageValue, readLocalStorageValue, TIMELINE_SCROLL_COMMIT_PX, readPersistedSentHistory, COMPOSER_GIT_SUMMARY_POLL_MS, COMPOSER_DRAFT_SAVE_DEBOUNCE_MS, SCROLL_IDLE_MS, WHEEL_SCROLL_COMPENSATION_MS, PROGRAMMATIC_SCROLL_SUPPRESSION_MS, TIMELINE_BOTTOM_GUTTER_PX, FAST_SCROLL_ENTER_PX_PER_S, FAST_SCROLL_EXIT_PX_PER_S, TIMELINE_TARGET_TOP_GUTTER_PX, AWAITING_PERSISTED_TURN_TIMEOUT_MS, REATTACH_POLL_MS, SENT_HISTORY_MAX, writePersistedSentHistory, STREAM_STALL_SENTINEL, CLAUDE_STREAM_STALL_MS, TIMELINE_OVERSCAN_PX, TRANSCRIPT_FILTERS, TRANSCRIPT_FILTER_LABELS } from './message-view/constants'
import { assistantDisplayName, extractSseFrames, extractLiveToolStart, upsertThreadedMessage, updateLiveToolThreadInput, extractCompletedToolKey, completeLiveToolThread, extractLiveToolStopIndex, extractStreamingAssistantText, shouldReplaceLiveAssistantText, extractStreamingReasoningText, extractTextContent } from './message-view/liveStream'
import { withProviderQuery, isDurableSessionMessage, sessionMessageFingerprint, messagesChangedSinceBaseline, buildPendingMessageBaseline, retargetPendingMessageBaseline, threadedMessageKey, threadedMessageEqual } from './message-view/threadedCompare'
import { estimateTimelineRowHeight, timelineEstimateBucket, calibratedTimelineRowHeight } from './message-view/heightEstimate'
import { timelineRowMatchesTranscriptFilters, timelineRowSearchText, groupAgentsToolRows, decorateStreamTurnLandmarks, resolveTimelineTargetMessageId, rowContainsMessage } from './message-view/timelineRows'
import { OpenCodeTodosBanner } from './message-view/OpenCodeTodosBanner'
import { VirtualTimelineRow } from './message-view/VirtualTimelineRow'
import { PlanApprovalCard } from './message-view/PlanApprovalCard'
import { AskUserQuestionPicker } from './message-view/AskUserQuestionPicker'
import { normalizeSelectValue, gitSummariesMatch, detectMentionAtCursor, LiveSpinner, ComposerStatusBanner, effortLabel, composerPopoverStyle, composerPopoverHintStyle, composerPopoverItemStyle, ComposerContextUsageRing } from './message-view/composerUi'
import { getWebComposerQueueStore, composerDraftStorageKey, readComposerDraft, writeComposerDraft, permissionDenialReason, attachmentImagePreviewSrc, attachmentDisplayName } from './message-view/composerStorage'
import { claudeDiagnosticActionNotice, WEB_TOOLBAR_PLUGIN_COMMANDS, DiffReviewMode, CLAUDE_DIAGNOSTIC_ACTIONS, compactNativeSelectClassName, PierrePatchDiffView, PromptLibrary, ChannelBridgePanel, IdeBridgePanel, PluginSurfaceHost } from './message-view/lazyPanels'
import { ComposerShell } from './message-view/ComposerShell'
import { CollapsedComposerBar } from './message-view/CollapsedComposerBar'
import { TimelineBody } from './message-view/TimelineBody'
import { MessageViewTopBar } from './message-view/MessageViewTopBar'
import { runSendMessage } from './message-view/actions/sendMessage'
import { runHandleKeyDown, runCancelSend, runIngestFileAttachments, runPrewarmComposer, runInsertMention, runInsertPromptText } from './message-view/actions/composer'
import { runRespondToPermission, runRespondToQuestion } from './message-view/actions/permissions'
import { runHandleExport, runHandleRewind, runHandleRollbackPreview, runHandleApplyRewind, runHandleApplyRollback, runHandleForkFromMessage, runHandleDeleteSession, runRunSessionAction, runRunClaudeSessionAction, runToggleBookmark, runHandleJumpToMessage, runHandleVisualizerSelectMessage } from './message-view/actions/sessionActions'
import { runSearchClaudeHookEvents, runApplyClaudeMcpPermissionMode, runBackgroundClaudeTasks, runAddClaudeMcpServer, runToggleDiagnostics } from './message-view/actions/claude'
import { runBridgePersistEffect, runBridgeLoadEffect, runBridgePermissionsEffect, runBridgeEntriesEffect } from './message-view/effects/bridge'
import { runMentionSearchEffect, runSlashCommandsEffect, runQueuedSendsEffect, runDraftFlushEffect, runComposerOptionsEffect, runQueueHydrateEffect } from './message-view/effects/composer'
import { runReattachRunningEffect, runOptimisticTextTimeoutEffect, runOptimisticTextEffect, runSessionResetEffect, runGitSummaryEffect, runPanelPreferencesEffect } from './message-view/effects/session'
import { useTimelineRowsGroup } from './message-view/slices/timelineRows'
import { useActiveToolCountGroup } from './message-view/slices/activeToolCount'
import { useIngestFileAttachmentsGroup } from './message-view/slices/ingestFileAttachments'
import { useRemoveQueuedSendGroup } from './message-view/slices/removeQueuedSend'
import { useMarkProgrammaticTimelineScrollGroup } from './message-view/slices/markProgrammaticTimelineScroll'
import { useBuildBookmarkMetaGroup } from './message-view/slices/buildBookmarkMeta'
import { useFlushLiveAssistantTextGroup } from './message-view/slices/flushLiveAssistantText'
import { useAutoFollowRefGroup } from './message-view/slices/autoFollowRef'
import { useScrollRafRefGroup } from './message-view/slices/scrollRafRef'
import { useTurnProducedOutputRefGroup } from './message-view/slices/turnProducedOutputRef'
import { useBridgeTranscriptEntriesGroup } from './message-view/slices/bridgeTranscriptEntries'
import { useIdeBridgeOpenGroup } from './message-view/slices/ideBridgeOpen'
import { useHistoryIndexGroup } from './message-view/slices/historyIndex'
import { useLiveAssistantTextGroup } from './message-view/slices/liveAssistantText'

// Compact thinking-token estimate for the live preview (e.g. 12345 → "12.3k").
function formatLiveThinkingTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
}

function useLazyRef<T>(create: () => T): { current: T } {
  const [ref] = useState(() => ({ current: create() }))
  return ref
}

function MessageViewInner({
  hideCoordinator = false,
  onInspectTeammate,
  messages,
  loading,
  session,
  targetMessageId,
  targetMessageRequestId = 0,
  projectView,
  onFork,
  onDelete,
  openTabs,
  selectedTabId,
  onSelectTab,
  onCloseTab,
  onOpenSession,
  taskPanelOpenRequest = 0,
  promptLibraryOpenRequest = 0,
  channelBridgeOpenRequest = 0,
  channelBridgeRouteToggleRequest = 0,
  onChannelBridgeRoutingChange,
  ideBridgeOpenRequest = 0,
  ideBridgeRouteToggleRequest = 0,
  onIdeBridgeRoutingChange,
  composerInsertRequest,
  onComposerInsertConsumed,
  openCodeTodos,
  codexPlan,
  codexExternalWriter,
  onOpenGit,
  maximized = false,
  onToggleMaximized,
  onEnterFullscreen,
  rightPanelOpen,
  onToggleRightPanel,
}: Props) {
  const [teamAttention, setTeamAttention] = useState({ sessionId: '', count: 0 })
  const updateTeamAttention = useCallback((count: number) => setTeamAttention(previous => previous.sessionId === session?.sessionId && previous.count === count ? previous : { sessionId: session?.sessionId ?? '', count }), [session?.sessionId])
  const [composerDock, setComposerDock] = useState({ sessionId: '', tab: 'chat' })
  const composerTab = composerDock.sessionId === session?.sessionId ? composerDock.tab : 'chat'
  const returnToChat = useCallback(() => setComposerDock({ sessionId: session?.sessionId ?? '', tab: 'chat' }), [session?.sessionId])
  const [composerSessions] = useState(createComposerSessions)
  const composerOwnerKey = session ? sessionIdentityKey(session) : 'unselected'
  const activeWebComposerOwnerRef = useRef(composerOwnerKey)
  useLayoutEffect(() => { activeWebComposerOwnerRef.current = composerOwnerKey }, [composerOwnerKey])
  const [inputText, setInputText] = useComposerSessionState(composerSessions, composerOwnerKey, 'inputText', '')
  const [sendState, setSendState] = useComposerSessionState<SendState>(composerSessions, composerOwnerKey, 'sendState', 'idle')
  const [sendError, setSendError] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'sendError', null)
  const [livePromptSuggestion, setLivePromptSuggestion] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'livePromptSuggestion', null)
  const [liveStatus, setLiveStatus] = useComposerSessionState<'requesting' | 'compacting' | 'retrying' | null>(composerSessions, composerOwnerKey, 'liveStatus', null)
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  const [enableWorkflow, setEnableWorkflow] = useState(false)
  const [liveSubagentText, setLiveSubagentText] = useComposerSessionState<Record<string, string>>(composerSessions, composerOwnerKey, 'liveSubagentText', {})
  const [contextUsage, setContextUsage] = useComposerSessionState<ContextUsage | null>(composerSessions, composerOwnerKey, 'contextUsage', null)
  const [sessionInfo, setSessionInfo] = useComposerSessionState<SessionInfo | null>(composerSessions, composerOwnerKey, 'sessionInfo', null)
  const [composerGitSummary, setComposerGitSummary] = useState<GitSummary | null>(null)
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false)
  const [availableModels, setAvailableModels] = useComposerSessionState<SessionModelInfo[]>(composerSessions, composerOwnerKey, 'availableModels', [])
  const [modelsLoading, setModelsLoading] = useComposerSessionState(composerSessions, composerOwnerKey, 'modelsLoading', false)
  const [selectedModel, setSelectedModel] = useComposerSessionState(composerSessions, composerOwnerKey, 'selectedModel', '')
  const [selectedEffort, setSelectedEffort] = useComposerSessionState<'auto' | ReasoningEffortLevel>(composerSessions, composerOwnerKey, 'selectedEffort', 'auto')
  // null means "not known yet", not "default". A cold Copilot session answers
  // its model read from the event journal rather than starting its runtime
  // (lib/adapters/copilot.ts), and the journal does not record the context
  // tier — so the composer must not send a tier it never learned, or the first
  // send would quietly downgrade a long-context session to default.
  const [selectedCopilotContextTier, setSelectedCopilotContextTier] = useComposerSessionState<CopilotContextTier | null>(composerSessions, composerOwnerKey, 'selectedCopilotContextTier', null)
  const [composerOptions, setComposerOptions] = useComposerSessionState<SessionComposerOptions>(composerSessions, composerOwnerKey, 'composerOptions', {})
  const [selectedAgent, setSelectedAgent] = useComposerSessionState(composerSessions, composerOwnerKey, 'selectedAgent', '')
  const [selectedCopilotMode, setSelectedCopilotMode] = useComposerSessionState(composerSessions, composerOwnerKey, 'selectedCopilotMode', 'interactive')
  // Claude `/permissions` modes — passed through to body.permissionMode on send.
  const [selectedPermissionMode, setSelectedPermissionMode] = useComposerSessionState<'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions'>(composerSessions, composerOwnerKey, 'selectedPermissionMode', 'auto')
  // Codex `/approvals` policy — passed through to body.approvalPolicy on send.
  // 'auto' leaves the app-server's configured default untouched.
  const [selectedCodexApproval, setSelectedCodexApproval] = useComposerSessionState<'auto' | 'untrusted' | 'on-request' | 'never'>(composerSessions, composerOwnerKey, 'selectedCodexApproval', 'auto')
  // Mirrors the CLI "queue next prompt while streaming" behavior. When a send
  // fires while one is in flight, the draft is captured here and flushed by an
  // effect once the active turn finishes.
  // FIFO backlog of follow-up prompts typed while a turn is in flight. Native
  // CLIs queue an arbitrary number of follow-ups; a single overwritten slot
  // silently dropped all but the most recent draft.
  const [queuedSends, setQueuedSends] = useState<QueuedWebSend[]>([])
  const queuedSendsRef = useRef<QueuedWebSend[]>([])
  const [composerQueueStorageReady, setComposerQueueStorageReady] = useState(false)
  const [composerQueueDurability, setComposerQueueDurability] = useState<WebComposerQueueDurability>('saving')
  const composerQueueCommitCounterRef = useRef(0)
  const composerQueueClaimInFlightRef = useRef(new Set<string>())
  const composerQueueMountedRef = useRef(false)
  // Queue mutations are durability-sensitive: update the transient ref and
  // localStorage in the originating event before yielding back to React. An
  // effect-only write leaves a small page-close window where the newest queue
  // state has rendered but is neither in the ref nor on disk yet.
  const commitQueuedSends = useCallback((next: QueuedWebSend[]) => {
    queuedSendsRef.current = next
    setQueuedSends(next)
    composerQueueCommitCounterRef.current += 1
    const commitNumber = composerQueueCommitCounterRef.current
    const commit = getWebComposerQueueStore().commit(next)
    setComposerQueueDurability(commit.durability)
    void commit.settled.then((durability) => {
      if (composerQueueCommitCounterRef.current === commitNumber) setComposerQueueDurability(durability)
    })
  }, [setInputText, setSendState, setSendError, setLivePromptSuggestion, setLiveStatus, setLiveSubagentText, setContextUsage, setSessionInfo, setAvailableModels, setModelsLoading, setSelectedModel, setSelectedEffort, setSelectedCopilotContextTier, setComposerOptions, setSelectedAgent, setSelectedCopilotMode, setSelectedPermissionMode, setSelectedCodexApproval])
  useEffect(() => runQueueHydrateEffect({
    composerQueueMountedRef, queuedSendsRef, setQueuedSends, setComposerQueueDurability,
    setComposerQueueStorageReady,
  }), [])
  const composerQueueTargetKey = session
    ? sessionIdentityKey(session)
    : null
  const composerQueueTargetKeyRef = useRef(composerQueueTargetKey)
  useLayoutEffect(() => {
    composerQueueTargetKeyRef.current = composerQueueTargetKey
  }, [composerQueueTargetKey])
  const activeQueuedSends = useMemo(
    () => selectComposerQueueTarget(queuedSends, composerQueueTargetKey),
    [composerQueueTargetKey, queuedSends],
  )
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredNotice, setSteeredNotice] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'steeredNotice', null)
  const [attachments, setAttachments] = useComposerSessionState<SendAttachment[]>(composerSessions, composerOwnerKey, 'attachments', [])
  const [attachmentType, setAttachmentType] = useState<SendAttachment['type']>('file')
  const [attachmentPath, setAttachmentPath] = useState('')
  const [attachmentPanelOpen, setAttachmentPanelOpen] = useState(false)
  const [failedSend, setFailedSend] = useComposerSessionState<FailedSend | null>(composerSessions, composerOwnerKey, 'failedSend', null)
  const [rewindTargetId, setRewindTargetId] = useState('')
  const [rollbackTurns, setRollbackTurns] = useState(1)
  const [resumeFromMessageId, setResumeFromMessageId] = useState<string | null>(null)
  const [previewingRewind, setPreviewingRewind] = useState(false)
  const [applyingRewind, setApplyingRewind] = useState(false)
  const [rewindPreview, setRewindPreview] = useState<RewindPreview | null>(null)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [forking, setForking] = useState(false)
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [showVisualizer, setShowVisualizer] = useState(false)
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:messageVisualizer', showVisualizer ? 'true' : 'false')
  }, [preferencesHydrated, showVisualizer])
  const [showReviewMode, setShowReviewMode] = useState(false)
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:diffReviewMode', showReviewMode ? 'true' : 'false')
  }, [preferencesHydrated, showReviewMode])
  const [transcriptFilters, setTranscriptFilters] = useState<ActiveTranscriptFilter[]>([])
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const deferredTranscriptSearch = useDeferredValue(transcriptSearch)
  // Bookmarked message uuids for the active session (local-only, mirrored via
  // /api/sessions/[id]/bookmarks). bookmarkIdsRef keeps the toggle callback
  // stable without re-creating it on every bookmark change.
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(() => new Set())
  const bookmarkIdsRef = useRef<Set<string>>(bookmarkIds)
  useLayoutEffect(() => {
    bookmarkIdsRef.current = bookmarkIds
  }, [bookmarkIds])
  const [bookmarksOnly, setBookmarksOnly] = useState(false)
  const [viewMode, setViewMode] = useState<WebViewMode>('conversation')
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:viewMode', viewMode)
    rowHeightsRef.current.clear()
    timelineEstimateCalibrationRef.current.clear()
    timelineEstimateSamplesRef.current.clear()
    timelineEstimateCalibrationFrozenRef.current = false
    setRowMeasurementVersion((version) => version + 1)
    setPersistedMeasurementVersion((version) => version + 1)
  }, [preferencesHydrated, viewMode])
  const showTools = viewMode === 'conversation' || viewMode === 'full' || viewMode === 'stream' || viewMode === 'agents'
  const [density, setDensity] = useState<MessageDensity>('balanced')
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:density', density)
    rowHeightsRef.current.clear()
    timelineEstimateCalibrationRef.current.clear()
    timelineEstimateSamplesRef.current.clear()
    timelineEstimateCalibrationFrozenRef.current = false
    setRowMeasurementVersion((version) => version + 1)
    setPersistedMeasurementVersion((version) => version + 1)
  }, [density, preferencesHydrated])
  // Document-level preference (applies via [data-color-treatment] CSS in
  // globals.css, not component state) — same external-store pattern as
  // RenderFontToggle, just read inline here instead of a separate popover.
  const colorTreatment = useSyncExternalStore<ColorTreatment>(
    subscribeColorTreatment,
    getCurrentColorTreatment,
    () => DEFAULT_COLOR_TREATMENT,
  )
  const [timelineWidth, setTimelineWidth] = useState<'centered' | 'full'>('centered')
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:timelineWidth', timelineWidth)
    // Width changes rewrap every row: measured heights are stale.
    rowHeightsRef.current.clear()
    timelineEstimateCalibrationRef.current.clear()
    timelineEstimateSamplesRef.current.clear()
    timelineEstimateCalibrationFrozenRef.current = false
    setRowMeasurementVersion((version) => version + 1)
    setPersistedMeasurementVersion((version) => version + 1)
  }, [preferencesHydrated, timelineWidth])
  const [stickyHeaders, setStickyHeaders] = useState(false)
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:stickyHeaders', stickyHeaders ? 'true' : 'false')
  }, [preferencesHydrated, stickyHeaders])
  // Row index of the last user prompt scrolled above the viewport's top edge.
  // Set from the live scroll event (not the ≤600px-stale committed scrollTop)
  // and only when it changes, so scrolling does not re-render per frame.
  const [stickyHeaderIndex, setStickyHeaderIndex] = useState<number | null>(null)
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>('stacked')
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:diffStyle', diffStyle)
  }, [diffStyle, preferencesHydrated])
  const [diffOptions, setDiffOptions] = useState<DiffOptions>(DEFAULT_DIFF_OPTIONS)
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:diffChangeStyle', diffOptions.changeStyle)
    writeLocalStorageValue('agentViewer:diffInlineStyle', diffOptions.inlineDiffStyle)
    writeLocalStorageValue('agentViewer:diffShowBackgrounds', String(diffOptions.showBackgrounds))
    writeLocalStorageValue('agentViewer:diffWrap', String(diffOptions.wrap))
    writeLocalStorageValue('agentViewer:diffShowLineNumbers', String(diffOptions.showLineNumbers))
    writeLocalStorageValue('agentViewer:diffShowHunkHeaders', String(diffOptions.showHunkHeaders))
  }, [diffOptions, preferencesHydrated])
  const [composerCollapsed, setComposerCollapsed] = useState(false)
  useEffect(() => runPanelPreferencesEffect({
    setShowVisualizer, setShowReviewMode, setViewMode, setDensity, setTimelineWidth,
    setStickyHeaders, setDiffStyle, setDiffOptions, setComposerCollapsed, setPreferencesHydrated,
  }), [])
  useEffect(() => {
    if (!preferencesHydrated) return
    writeLocalStorageValue('agentViewer:composerCollapsed', composerCollapsed ? 'true' : 'false')
  }, [composerCollapsed, preferencesHydrated])
  // The plugin surface open as an overlay, if any (lib/plugins/catalog.ts).
  const [pluginOverlay, setPluginOverlay] = useState<PluginSurfaceId | null>(null)
  const disabledPlugins = useDisabledPlugins()
  // The conversation's Teammates tab is the Coordination plugin's view; with it
  // off the tab is gone and the team keeps running server-side.
  const teammatesTab = Boolean(session && !hideCoordinator && !disabledPlugins.has(getPluginSurface('teammates').pluginId))
  const teammatesServices = useMemo<WebPluginServices>(() => ({
    coordination: {
      provider: session?.provider ?? 'claude',
      selectedSession: session ?? null,
      openSession: onOpenSession ?? (() => {}),
      ...(onInspectTeammate ? { inspectTeammate: onInspectTeammate } : {}),
      returnToChat,
      attentionChanged: updateTeamAttention,
    },
  }), [session, onOpenSession, onInspectTeammate, returnToChat, updateTeamAttention])
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticSections, setDiagnosticSections] = useState<SessionDiagnosticSection[]>([])
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cliPopoverOpen, setCliPopoverOpen] = useState(false)
  const cliPopoverRef = useRef<HTMLDivElement>(null)
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const viewDropdownRef = useRef<HTMLDivElement>(null)
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false)
  const actionsDropdownRef = useRef<HTMLDivElement>(null)
  const [sessionActionLoading, setSessionActionLoading] = useState<string | null>(null)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionActionNotice, setSessionActionNotice] = useState<string | null>(null)
  const [optimisticContextText, setOptimisticContextText] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'optimisticContextText', null)
  const [optimisticUserText, setOptimisticUserText] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'optimisticUserText', null)
  // Messages steered INTO the running turn — echoed in the live overlay until
  // the persisted transcript reconciles (same lifecycle as optimisticUserText).
  // `messageUuid` is the server's uuid stamp; command_lifecycle frames
  // correlate on it and drive `state` (queued/started/completed) or drop the
  // entry entirely (cancelled/discarded).
  const [steeredUserTexts, setSteeredUserTexts] = useComposerSessionState<SteeredSendEntry[]>(composerSessions, composerOwnerKey, 'steeredUserTexts', [])
  const steeredUserTextsRef = composerSessions.ref<SteeredSendEntry[]>(composerOwnerKey, 'steeredUserTextsRef', [])
  useEffect(() => { steeredUserTextsRef.current = steeredUserTexts }, [steeredUserTexts])
  const [backgroundingTasks, setBackgroundingTasks] = useState(false)
  // True from when the user hits stop until the interrupted turn's partial
  // output reconciles (or the awaitingPersistedTurn escape hatch fires). Lets
  // the composer show a definite "Interrupting…" instead of snapping to idle
  // while the agent is still wrapping up server-side.
  const [interrupting, setInterrupting] = useComposerSessionState(composerSessions, composerOwnerKey, 'interrupting', false)
  // Reattach: a turn is running server-side that this client does NOT own (it
  // was started before a navigation/reload — turns keep running via
  // detachOnClientAbort). Detected by polling /running while we're otherwise
  // idle. When set, the composer reflects the live turn (stop button, steer on
  // send) and the persisted poll surfaces output until the turn finishes.
  const [reattachedRunning, setReattachedRunning] = useComposerSessionState(composerSessions, composerOwnerKey, 'reattachedRunning', false)
  const [runningProbeReadyKey, setRunningProbeReadyKey] = useState<string | null>(null)
  const reattachedRunningRef = composerSessions.ref(composerOwnerKey, 'reattachedRunningRef', false)
  useEffect(() => { reattachedRunningRef.current = reattachedRunning }, [reattachedRunning])
  const {
    liveAssistantText, setLiveAssistantText, liveReasoningText, setLiveReasoningText,
    liveThinkingTokens, setLiveThinkingTokens, liveToolActivities, setLiveToolActivities,
    liveThreadedMessages, setLiveThreadedMessages, pendingPermissions, setPendingPermissions,
    awaitingPersistedTurn, setAwaitingPersistedTurn, autoFollow, setAutoFollow, timelineScrollTop,
    commitTimelineScrollTop, commitTimelineScrollTopIfDrifted, fastScrolling,
    scrollVelocitySampleRef, setFastScrollingMode, timelineViewportHeight,
    setTimelineViewportHeight, timelineHeightOverride, setTimelineHeightOverride,
    rowMeasurementVersion, setRowMeasurementVersion, persistedMeasurementVersion,
    setPersistedMeasurementVersion, highlightedMessageId, setHighlightedMessageId, sentHistory,
    setSentHistory, sentHistoryRef,
  } = useLiveAssistantTextGroup({
    composerSessions, composerOwnerKey,
  })
  useLayoutEffect(() => {
    sentHistoryRef.current = sentHistory
  }, [sentHistory])
  const {
    historyIndex, setHistoryIndex, draftBeforeHistoryRef, mentionQuery, setMentionQuery,
    mentionResults, setMentionResults, mentionActiveIndex, setMentionActiveIndex, mentionAbortRef,
    mentionItemRefs, promptLibraryOpen, setPromptLibraryOpen, channelBridgeOpen,
    setChannelBridgeOpen, canUseChannelBridge, channelBridge, handledChannelBridgeOpenRequestRef,
    handledChannelBridgeRouteRequestRef, channelBridgeRef,
  } = useHistoryIndexGroup({
    projectView, session, channelBridgeOpenRequest, channelBridgeRouteToggleRequest,
  })
  useLayoutEffect(() => {
    channelBridgeRef.current = channelBridge
  }, [channelBridge])
  const {
    ideBridgeOpen, setIdeBridgeOpen, canUseIdeBridge, ideBridge, handledIdeBridgeOpenRequestRef,
    handledIdeBridgeRouteRequestRef, ideBridgeRef,
  } = useIdeBridgeOpenGroup({
    projectView, session, ideBridgeOpenRequest, ideBridgeRouteToggleRequest,
  })
  useLayoutEffect(() => {
    ideBridgeRef.current = ideBridge
  }, [ideBridge])
  const {
    bridgeTranscriptEntries, setBridgeTranscriptEntries, persistedBridgeCountRef, slashOpen,
    setSlashOpen, slashActiveIndex, setSlashActiveIndex, slashItemRefs, liveSlashCommands,
    setLiveSlashCommands, textareaRef, composerPrewarmInFlightRef, isComposingRef, timelineRef,
    timelineContentRef, lastTimelineRowRef, abortControllerRef, activeTurnRequestIdRef,
    inputTextRef, suppressDraftSaveRef, sendInFlightRef, awaitingPersistedTurnRef,
    pushedCopilotAttachmentsRef,
  } = useBridgeTranscriptEntriesGroup({
    composerSessions, composerOwnerKey, inputText,
  })
  const {
    turnProducedOutputRef, transientRetryCountRef, transientRetryTimerRef,
    pendingSendOnModelsReadyRef, pendingMessageBaselineRef, liveTurnSessionHandoffRef,
    liveAssistantTextRef, pendingLiveAssistantTextRef, liveAssistantFlushFrameRef,
  } = useTurnProducedOutputRefGroup({
    composerSessions, composerOwnerKey,
  })
  // Reasoning shares the assistant flush frame (one RAF flushes both buffers).
  const liveReasoningTextRef = composerSessions.ref(composerOwnerKey, 'liveReasoningTextRef', '')
  const pendingLiveReasoningTextRef = composerSessions.ref<string | null>(composerOwnerKey, 'pendingLiveReasoningTextRef', null)
  // Ref-backed source of truth for per-subagent streamed text. Deltas mutate
  // this ref and a single RAF flushes a fresh snapshot into state, so a burst
  // of subagent tokens collapses to one re-render per frame instead of one per
  // token re-rendering every mounted AgentCard via LiveSubagentTextContext.
  const liveSubagentTextRef = composerSessions.ref<Record<string, string>>(composerOwnerKey, 'liveSubagentTextRef', {})
  const liveSubagentFlushFrameRef = composerSessions.ref<number | null>(composerOwnerKey, 'liveSubagentFlushFrameRef', null)
  const liveToolIndexesRef = composerSessions.ref(composerOwnerKey, 'liveToolIndexesRef', new Map<number, string>())
  const liveToolInputJsonRef = composerSessions.ref(composerOwnerKey, 'liveToolInputJsonRef', new Map<number, string>())
  const rowHeightsRef = useLazyRef(() => new Map<string, number>())
  const timelineEstimateCalibrationRef = useLazyRef(
    () => new Map<TimelineEstimateBucket | 'all', TimelineEstimateCalibration>(),
  )
  const timelineEstimateSamplesRef = useLazyRef(() => new Map<string, TimelineEstimateSample>())
  // Recalibrate during initial settling, then keep estimates stable once the
  // user starts manipulating the scrollbar.
  const timelineEstimateCalibrationFrozenRef = useRef(false)
  const rowLayoutRef = useLazyRef<TimelineRowLayout>(() => (
    buildTimelineRowLayout([], new Map(), estimateTimelineRowHeight)
  ))
  const threadedCacheRef = useLazyRef(() => new Map<string, ThreadedMessage>())
  const prevThreadingRef = useRef<IncrementalThreadingCache | null>(null)
  // Last taskActiveForms Map, reused when contents are unchanged so the context
  // value identity stays stable across idle polls.
  const taskActiveFormsRef = useLazyRef(() => new Map<string, string>())
  const pendingRowMeasurementsRef = useLazyRef(() => new Map<string, number>())
  const measurementFrameRef = useRef<number | null>(null)
  const scheduleTimelineMeasurementFlushRef = useRef<() => void>(() => {})
  const pendingTimelineScrollCompensationRef = useRef(0)
  const pendingMountedAnchorCaptureRef = useRef(false)
  const {
    scrollRafRef, programmaticScrollUntilRef, wheelScrollCompensationUntilRef,
    timelineHeightOverrideRef, activeTimelineScrollAnchorRef, pendingTimelineAnchorRestoreRef,
    userScrollingRef, userScrollingTimerRef, suppressFollowEvalUntilRef,
  } = useScrollRafRefGroup()
  const {
    autoFollowRef, timelineRowsRef, handledTargetMessageRequestRef, initialScrollDoneRef,
    sessionCapabilities, activeProvider, cliCommand, modelOptions, selectedModelValue,
    selectedModelInfo, composerAgentOptions, composerMentionAgentOptions, composerModeOptions,
    effortOptions, loadedComposerDraftKey, setLoadedComposerDraftKey, attachmentReadsRef,
    composerDraftKey,
  } = useAutoFollowRefGroup({
    sessionInfo, session, availableModels, selectedModel, composerOptions, composerSessions,
    composerOwnerKey,
  })

  useEffect(() => {
    inputTextRef.current = inputText
  }, [inputText])

  useEffect(() => {
    awaitingPersistedTurnRef.current = awaitingPersistedTurn
  }, [awaitingPersistedTurn])
  const {
    flushLiveAssistantTextNow, clearLiveAssistantText, queueLiveAssistantText,
    queueLiveReasoningText, queueLiveSubagentDelta, removeLiveSubagentEntry, clearLiveSubagentText,
  } = useFlushLiveAssistantTextGroup({
    liveAssistantFlushFrameRef, pendingLiveAssistantTextRef, setLiveAssistantText,
    pendingLiveReasoningTextRef, setLiveReasoningText, liveAssistantTextRef, liveReasoningTextRef,
    setLiveThinkingTokens, liveSubagentFlushFrameRef, setLiveSubagentText, liveSubagentTextRef,
  })

  useEffect(() => {
    if (!cliPopoverOpen) return
    function onDown(e: MouseEvent) {
      if (cliPopoverRef.current && !cliPopoverRef.current.contains(e.target as Node))
        setCliPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [cliPopoverOpen])

  useEffect(() => {
    if (!viewDropdownOpen) return
    function onDown(e: MouseEvent) {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(e.target as Node))
        setViewDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [viewDropdownOpen])

  useEffect(() => {
    if (!actionsDropdownOpen) return
    function onDown(e: MouseEvent) {
      if (actionsDropdownRef.current && !actionsDropdownRef.current.contains(e.target as Node))
        setActionsDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [actionsDropdownOpen])

  const resizeComposer = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const next = Math.min(textarea.scrollHeight, 260)
    textarea.style.height = `${next}px`
    textarea.style.overflowY = textarea.scrollHeight > 260 ? 'auto' : 'hidden'
  }, [textareaRef])

  // Fire-and-forget push of model/permission changes through the actions
  // route. For warm Claude sessions the server's claudePool applies these
  // live via setModel/setPermissionMode on the persistent Query; for cold
  // sessions it's a no-op and the change still rides on body.{model,
  // permissionMode} of the next /messages/events POST. Either way the next
  // send is correct — this just makes the change visible immediately on
  // warm sessions instead of waiting for the next turn to start.
  const commitClaudeModelSelection = useCallback((nextModel: string) => {
    setSelectedModel(nextModel)
    if (!session || session.provider !== 'claude' || session.isPending) return
    if (!nextModel || nextModel === selectedModel) return
    void fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', action: 'setModel', model: nextModel }),
    }).catch(() => { /* swallow; next send carries body.model */ })
  }, [session, selectedModel, setSelectedModel])

  const commitClaudePermissionSelection = useCallback((nextMode: typeof selectedPermissionMode) => {
    setSelectedPermissionMode(nextMode)
    if (!session || session.provider !== 'claude' || session.isPending) return
    if (nextMode === selectedPermissionMode) return
    void fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', action: 'setPermissionMode', permissionMode: nextMode }),
    }).catch(() => { /* swallow; next send carries body.permissionMode */ })
  }, [session, selectedPermissionMode, setSelectedPermissionMode])

  const commitCopilotModeSelection = useCallback((nextMode: string) => {
    setSelectedCopilotMode(nextMode)
    if (!session || session.provider !== 'copilot' || session.isPending) return
    if (nextMode === selectedCopilotMode) return
    void fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'copilot', action: 'setMode', mode: nextMode }),
    }).catch(() => { /* swallow; next send carries body.mode */ })
  }, [session, selectedCopilotMode, setSelectedCopilotMode])

  useLayoutEffect(() => {
    resizeComposer()
  }, [inputText, resizeComposer])

  // Load session info (git branch, summary, etc.) when session changes
  useEffect(() => {
    if (!session) { setSessionInfo(null); return }
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}`, session.provider, session.providerInstanceId))
      .then(readJsonResponse)
      .then(data => { if (!data.error) setSessionInfo(data.info) })
      .catch(() => {})
  }, [session?.provider, session?.sessionId])

  const composerWorkingDirectory = sessionInfo?.cwd ?? session?.cwd ?? null
  useEffect(() => {
    setBranchSwitcherOpen(false)
  }, [composerWorkingDirectory])

  const handleComposerBranchSwitched = useCallback((summary: GitSummary) => {
    setComposerGitSummary(summary)
    setSessionInfo((current) => current ? { ...current, gitBranch: summary.branch } : current)
  }, [setSessionInfo])

  useEffect(() => runGitSummaryEffect({
    composerWorkingDirectory, setComposerGitSummary,
  }), [composerWorkingDirectory])

  const prewarmComposer = useCallback(() => runPrewarmComposer({
    session, selectedEffort, selectedModel, composerPrewarmInFlightRef,
  }), [selectedEffort, selectedModel, session?.cwd, session?.isPending, session?.provider, session?.sessionId])

  useEffect(() => {
    // Resuming an existing provider session can advance its activity timestamp
    // without a turn. Browsing must stay read-only; warm existing sessions only
    // when the user engages the composer. New sessions have no activity to move.
    if (session?.isPending) prewarmComposer()
  }, [prewarmComposer, session?.isPending])

  // Load message bookmarks for the active session. Reset the "bookmarks only"
  // filter on every session switch so a stale focus doesn't carry over.
  useEffect(() => {
    setBookmarksOnly(false)
    if (!session || session.isPending) { setBookmarkIds(new Set()); return }
    let cancelled = false
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}/bookmarks`, session.provider, session.providerInstanceId))
      .then(readJsonResponse)
      .then(data => {
        if (cancelled || !Array.isArray(data?.ids)) return
        setBookmarkIds(new Set(data.ids as string[]))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [session?.provider, session?.sessionId, session?.isPending])
  const {
    toggleBookmark, refreshSessionModels,
  } = useBuildBookmarkMetaGroup({
    timelineRowsRef, sessionInfo, session, bookmarkIdsRef, setBookmarkIds, setModelsLoading,
    setAvailableModels, setSelectedCopilotContextTier, setSelectedModel,
  })

  useEffect(() => {
    if (!session) {
      setAvailableModels([])
      setModelsLoading(false)
      setSelectedModel('')
      setSelectedEffort('auto')
      setSelectedCopilotContextTier(null)
      return
    }
    refreshSessionModels({ preserveSelection: false })
  }, [session?.provider, session?.sessionId, refreshSessionModels])

  // Claude's /models endpoint no longer resolves currentModel (that required
  // a ~1.4s getContextUsage() control RPC on every session switch — see the
  // comment on readViewSessionModels). Once the transcript we already fetch
  // for display finishes loading, pull the model straight off the last
  // assistant message instead — free, and it's the same data the backend
  // would have derived from a live RPC anyway. Applied once per session
  // switch (not on every later message-array update) so it can't stomp a
  // model the user just picked in the dropdown but hasn't sent yet.
  const appliedModelSessionKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (session?.provider !== 'claude' || !session.sessionId || messages.length === 0) return
    if (appliedModelSessionKeyRef.current === session.sessionId) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.type !== 'assistant') continue
      const model = (msg.message as Partial<ApiMessage> & { model?: unknown }).model
      if (typeof model === 'string' && model) {
        appliedModelSessionKeyRef.current = session.sessionId
        setSelectedModel(model)
      }
      break
    }
  }, [session?.provider, session?.sessionId, messages])

  useEffect(() => runComposerOptionsEffect({
    session, setComposerOptions, setSelectedAgent, setSelectedCopilotMode,
  }), [session?.provider, session?.sessionId])

  useEffect(() => {
    if (selectedEffort === 'auto') return
    if (!effortOptions.includes(selectedEffort)) {
      setSelectedEffort('auto')
    }
  }, [effortOptions, selectedEffort])

  useEffect(() => {
    if (activeProvider !== 'copilot') {
      if (selectedCopilotContextTier !== null) setSelectedCopilotContextTier(null)
      return
    }
    if (selectedCopilotContextTier === 'long_context' && !selectedModelInfo?.supportsLongContext) {
      setSelectedCopilotContextTier('default')
    }
  }, [activeProvider, selectedCopilotContextTier, selectedModelInfo])

  useEffect(() => {
    if (activeProvider !== 'opencode' && attachmentType === 'agent') {
      setAttachmentType('file')
    }
  }, [activeProvider, attachmentType])

  // Reset context usage when switching sessions
  useEffect(() => runSessionResetEffect({
    liveTurnSessionHandoffRef, session, sendInFlightRef, awaitingPersistedTurnRef, setContextUsage,
    setSessionActionError, setSessionActionNotice, setResumeFromMessageId, setRewindPreview,
    setRollbackPreview, setShowDiagnostics, setDiagnosticSections, setAttachments,
    setAttachmentPath, setSelectedEffort, setSelectedAgent, setSelectedCopilotMode,
    setComposerOptions, setPendingPermissions, setOptimisticUserText, setSteeredUserTexts,
    clearLiveAssistantText, setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    setAwaitingPersistedTurn, setSendState, setSendError, setFailedSend, setAutoFollow,
    commitTimelineScrollTop, setTimelineViewportHeight, rowHeightsRef,
    timelineEstimateCalibrationRef, timelineEstimateSamplesRef,
    timelineEstimateCalibrationFrozenRef, threadedCacheRef, prevThreadingRef,
    pendingRowMeasurementsRef, pendingTimelineScrollCompensationRef,
    pendingMountedAnchorCaptureRef, measurementFrameRef, timelineHeightOverrideRef,
    wheelScrollCompensationUntilRef, activeTimelineScrollAnchorRef,
    pendingTimelineAnchorRestoreRef, setTimelineHeightOverride, setRowMeasurementVersion,
    setPersistedMeasurementVersion, pendingMessageBaselineRef, liveToolIndexesRef,
    liveToolInputJsonRef, initialScrollDoneRef,
  }), [clearLiveAssistantText, commitTimelineScrollTop, composerOwnerKey])

  useEffect(() => {
    suppressDraftSaveRef.current = true
    const draft = loadedComposerDraftKey === composerDraftKey ? { text: inputTextRef.current, attachments } : readComposerDraft(composerDraftKey)
    setInputText(draft.text)
    inputTextRef.current = draft.text
    setAttachments(draft.attachments)
    setLoadedComposerDraftKey(composerDraftKey)

    window.requestAnimationFrame(() => {
      suppressDraftSaveRef.current = false
      resizeComposer()
    })
  }, [composerDraftKey, resizeComposer])

  const autoFocusedSessionsRef = useLazyRef(() => new Set<string>())

  // Draft saves are debounced: a synchronous localStorage write (plus
  // JSON.stringify) on every keystroke is measurable main-thread jank, and the
  // draft only needs to survive tab/session switches. The latest value sits in
  // pendingComposerDraftRef (with the key it belongs to, so a session switch
  // flushes under the OLD key); flushes happen at the trailing edge, on
  // draft-key change, on unmount, and on pagehide.
  const pendingComposerDraftRef = useRef<{ key: string | null; draft: ComposerDraft } | null>(null)
  const composerDraftTimerRef = useRef<number | null>(null)
  const flushComposerDraft = useCallback(() => {
    if (composerDraftTimerRef.current != null) {
      window.clearTimeout(composerDraftTimerRef.current)
      composerDraftTimerRef.current = null
    }
    const pending = pendingComposerDraftRef.current
    pendingComposerDraftRef.current = null
    if (pending) writeComposerDraft(pending.key, pending.draft)
  }, [])

  useEffect(() => {
    if (suppressDraftSaveRef.current) return
    pendingComposerDraftRef.current = { key: composerDraftKey, draft: { text: inputText, attachments } }
    // Trailing debounce: reset the timer on every change so the write lands
    // once typing pauses. Staleness is bounded by the flush-on-unmount /
    // key-change / pagehide paths below.
    if (composerDraftTimerRef.current != null) window.clearTimeout(composerDraftTimerRef.current)
    composerDraftTimerRef.current = window.setTimeout(() => {
      composerDraftTimerRef.current = null
      flushComposerDraft()
    }, COMPOSER_DRAFT_SAVE_DEBOUNCE_MS)
  }, [attachments, composerDraftKey, flushComposerDraft, inputText])

  useEffect(() => {
    // visibilitychange covers mobile tabs backgrounded then killed, which
    // never fire pagehide.
    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden') flushComposerDraft()
    }
    window.addEventListener('pagehide', flushComposerDraft)
    document.addEventListener('visibilitychange', flushIfHidden)
    return () => {
      window.removeEventListener('pagehide', flushComposerDraft)
      document.removeEventListener('visibilitychange', flushIfHidden)
      flushComposerDraft()
    }
  }, [composerDraftKey, flushComposerDraft])

  useEffect(() => runDraftFlushEffect({
    composerSessions, measurementFrameRef, scrollRafRef, liveAssistantFlushFrameRef,
    liveSubagentFlushFrameRef, userScrollingTimerRef, pendingTimelineScrollCompensationRef,
    pendingMountedAnchorCaptureRef, timelineHeightOverrideRef, wheelScrollCompensationUntilRef,
    activeTimelineScrollAnchorRef, pendingTimelineAnchorRestoreRef,
  }), [])

  const captureTimelineScrollAnchor = useCallback((): TimelineScrollAnchor | null => {
    const node = timelineRef.current
    const rows = timelineRowsRef.current
    const layout = rowLayoutRef.current
    if (!node) return findTimelineScrollAnchor(rows, layout, 0)

    const viewportTop = node.getBoundingClientRect().top
    let nearest: TimelineScrollAnchor | null = null
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const candidate of Array.from(node.querySelectorAll<HTMLElement>('.timeline-row[data-timeline-key]'))) {
      const key = candidate.dataset.timelineKey
      if (!key) continue
      const index = layout.indexByKey.get(key)
      if (index == null) continue

      const rect = candidate.getBoundingClientRect()
      if (rect.bottom <= viewportTop) continue
      const distance = Math.max(rect.top - viewportTop, 0)
      if (distance >= nearestDistance) continue

      nearestDistance = distance
      nearest = {
        index,
        key,
        offset: node.scrollTop - layout.tops[index],
      }
      if (distance === 0) break
    }

    return nearest ?? findTimelineScrollAnchor(rows, layout, node.scrollTop)
  }, [])

  const markTimelineUserScrolling = useCallback(() => {
    timelineEstimateCalibrationFrozenRef.current = true
    if (timelineHeightOverrideRef.current == null) {
      const stableHeight = rowLayoutRef.current.totalHeight
      timelineHeightOverrideRef.current = stableHeight
      activeTimelineScrollAnchorRef.current = captureTimelineScrollAnchor()
      setTimelineHeightOverride(stableHeight)
    }

    userScrollingRef.current = true
    if (userScrollingTimerRef.current != null) {
      window.clearTimeout(userScrollingTimerRef.current)
    }
    userScrollingTimerRef.current = window.setTimeout(() => {
      userScrollingRef.current = false
      userScrollingTimerRef.current = null
      // Capture fresh (not ??=): scroll commits are quantized, so an anchor
      // captured on the last commit can lag the real viewport by up to
      // TIMELINE_SCROLL_COMMIT_PX — restoring it would yank the scroll
      // position back. The viewport-top row is always mounted (overscan far
      // exceeds the commit threshold), so this capture is exact.
      activeTimelineScrollAnchorRef.current = captureTimelineScrollAnchor()
      timelineHeightOverrideRef.current = null
      pendingTimelineAnchorRestoreRef.current = true
      setTimelineHeightOverride(null)
      // The scroll handler quantizes its commits; settle the exact resting
      // position now that the gesture is over, and hydrate any placeholder
      // rows left over from a fast fling.
      scrollVelocitySampleRef.current = null
      setFastScrollingMode(false)
      const node = timelineRef.current
      if (node) commitTimelineScrollTop(node.scrollTop)
      scheduleTimelineMeasurementFlushRef.current()
    }, SCROLL_IDLE_MS)
  }, [captureTimelineScrollAnchor, commitTimelineScrollTop, setFastScrollingMode])

  useEffect(() => {
    const node = timelineRef.current
    if (!node) return

    const updateMetrics = () => {
      setTimelineViewportHeight(node.clientHeight)
      commitTimelineScrollTop(node.scrollTop)
    }

    updateMetrics()
    const observer = new ResizeObserver(() => updateMetrics())
    observer.observe(node)
    const handleWheel = (event: WheelEvent) => {
      // Real input takes ownership from programmatic alignment immediately.
      // Otherwise resize-driven tail alignment can keep extending scroll-event
      // suppression while an upward gesture is trying to leave the tail.
      programmaticScrollUntilRef.current = 0
      suppressFollowEvalUntilRef.current = 0
      if (event.deltaY < 0) {
        autoFollowRef.current = false
        setAutoFollow(false)
      }
      wheelScrollCompensationUntilRef.current = performance.now() + WHEEL_SCROLL_COMPENSATION_MS
      // Track the input event itself. Anchor compensation also writes
      // scrollTop and temporarily marks resulting scroll events programmatic;
      // relying only on those scroll events allowed the idle timer to expire
      // in the middle of a continuous wheel/trackpad gesture.
      markTimelineUserScrolling()
    }
    node.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      observer.disconnect()
      node.removeEventListener('wheel', handleWheel)
    }
  }, [commitTimelineScrollTop, markTimelineUserScrolling, showDiagnostics, showVisualizer, session?.sessionId])

  useEffect(() => {
    if (!rewindPreview || rewindPreview.userMessageId === rewindTargetId) return
    setRewindPreview(null)
  }, [rewindPreview, rewindTargetId])
  const {
    markProgrammaticTimelineScroll, restoreTimelineScrollAnchor, scrollTimelineToBottom,
    toggleLiveFollow, alignLastTimelineRowToViewportBottom, handleTimelineScroll,
    scrollMountedTimelineRowIntoView,
  } = useMarkProgrammaticTimelineScrollGroup({
    programmaticScrollUntilRef, timelineRef, activeTimelineScrollAnchorRef, rowLayoutRef,
    suppressFollowEvalUntilRef, commitTimelineScrollTop, autoFollow, setAutoFollow,
    lastTimelineRowRef, markTimelineUserScrolling, pendingMountedAnchorCaptureRef, scrollRafRef,
    scheduleTimelineMeasurementFlushRef, scrollVelocitySampleRef, setFastScrollingMode,
    commitTimelineScrollTopIfDrifted, autoFollowRef,
  })

  useLayoutEffect(() => runOptimisticTextEffect({
    awaitingPersistedTurn, session, pendingMessageBaselineRef, messages, liveAssistantTextRef,
    liveThreadedMessages, setOptimisticUserText, setSteeredUserTexts, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    awaitingPersistedTurnRef, setAwaitingPersistedTurn, liveToolIndexesRef, liveToolInputJsonRef,
    autoFollow, scrollTimelineToBottom,
  }), [autoFollow, awaitingPersistedTurn, clearLiveAssistantText, liveAssistantText, liveThreadedMessages.length, messages, scrollTimelineToBottom, session])

  // Escape hatch for a persisted row that never lands. Without this, a lost or
  // badly delayed write leaves the composer stuck on "Syncing transcript…"
  // indefinitely (the reconcile effect above only resolves on arrival). After a
  // bounded wait we tear down the live overlay and reveal whatever the poll has.
  useEffect(() => runOptimisticTextTimeoutEffect({
    awaitingPersistedTurn, setOptimisticUserText, setSteeredUserTexts, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText,
    awaitingPersistedTurnRef, setAwaitingPersistedTurn, pendingMessageBaselineRef,
    liveToolIndexesRef, liveToolInputJsonRef,
  }), [awaitingPersistedTurn, clearLiveAssistantText, clearLiveSubagentText])

  // 'Interrupting…' is only meaningful while we're waiting for the interrupted
  // turn to reconcile. Once awaitingPersistedTurn clears (the partial turn
  // landed, or the escape-hatch timeout fired), drop the interrupting flag.
  useEffect(() => {
    if (!awaitingPersistedTurn && interrupting) {
      setInterrupting(false)
    }
  }, [awaitingPersistedTurn, interrupting])

  // Poll for a server-side turn we don't own so we can reattach to it. Runs
  // only while this client is idle (no owned stream); pauses the moment we
  // start/own a turn, and clears as soon as the server reports the turn done.
  useEffect(() => runReattachRunningEffect({
    session, projectView, setReattachedRunning, setRunningProbeReadyKey, sendInFlightRef,
    awaitingPersistedTurnRef, reattachedRunningRef, setPendingPermissions,
  }), [projectView, session?.provider, session?.sessionId])

  const cancelSend = useCallback(() => runCancelSend({
    session, activeTurnRequestIdRef, steeredUserTextsRef, setSteeredUserTexts, inputTextRef,
    textareaRef, setInputText, resizeComposer, setSessionActionNotice, transientRetryTimerRef,
    transientRetryCountRef, abortControllerRef, sendInFlightRef, setSendError, setSendState,
    queuedSendsRef, composerQueueTargetKey, commitQueuedSends, setAttachments,
    pendingMessageBaselineRef, setInterrupting, awaitingPersistedTurnRef, setAwaitingPersistedTurn,
    setReattachedRunning, optimisticUserText, setOptimisticUserText, clearLiveAssistantText,
    setLiveToolActivities, setLiveThreadedMessages, clearLiveSubagentText, liveToolIndexesRef,
    liveToolInputJsonRef,
  }), [clearLiveAssistantText, clearLiveSubagentText, commitQueuedSends, composerQueueTargetKey, optimisticUserText, resizeComposer, session, abortControllerRef, activeTurnRequestIdRef, inputTextRef, sendInFlightRef, awaitingPersistedTurnRef, transientRetryCountRef, transientRetryTimerRef, pendingMessageBaselineRef, steeredUserTextsRef, textareaRef, liveToolIndexesRef, liveToolInputJsonRef, setInputText, setSendState, setSendError, setAttachments, setOptimisticUserText, setSteeredUserTexts, setReattachedRunning, setLiveThreadedMessages, setLiveToolActivities, setAwaitingPersistedTurn])

  const backgroundClaudeTasks = useCallback(async () => runBackgroundClaudeTasks({
    session, backgroundingTasks, setBackgroundingTasks, setSessionActionError,
    setSessionActionNotice, textareaRef,
  }), [backgroundingTasks, session, textareaRef])

  // Cancel a running Claude SDK background task via query.stopTask(). Routes at
  // the live warm pool entry server-side, so it only works while the session is
  // warm (the backend reports stopped:false otherwise).
  const stopClaudeTask = useCallback(async (taskId: string) => {
    if (!session || session.provider !== 'claude' || session.isPending) return
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude', action: 'stopTask', taskId }),
      })
      const data = await readOptionalJsonResponse(res, {})
      if (data.error) throw new Error(data.error)
      const stopped = data.result?.stopped === true
      setSessionActionNotice(stopped ? `Stopped task #${taskId}.` : 'No running task to stop (session not warm).')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to stop task')
    }
  }, [session])

  const sendMessage = useCallback(async (retryOverride?: {
    text: string
    attachments: SendAttachment[]
    turnRequestId?: string
  }) => runSendMessage({
    session, setSendError, modelsLoading, selectedModel, pendingSendOnModelsReadyRef, textareaRef,
    inputTextRef, attachments, attachmentReadsRef, channelBridgeRef, canUseChannelBridge,
    setInputText, setAttachments, resizeComposer, ideBridgeRef, canUseIdeBridge, sendInFlightRef,
    awaitingPersistedTurnRef, reattachedRunningRef, activeTurnRequestIdRef, setSteeredNotice,
    steeredUserTextsRef, setSteeredUserTexts, commitQueuedSends, queuedSendsRef,
    transientRetryCountRef, turnProducedOutputRef, setReattachedRunning,
    pushedCopilotAttachmentsRef, selectedEffort, sentHistoryRef, setSentHistory, setHistoryIndex,
    draftBeforeHistoryRef, setSendState, setFailedSend, setInterrupting, setOptimisticUserText,
    setOptimisticContextText, clearLiveAssistantText, setLiveToolActivities,
    setLiveThreadedMessages, setLivePromptSuggestion, setLiveStatus, clearLiveSubagentText,
    setAwaitingPersistedTurn, setAutoFollow, pendingMessageBaselineRef, messages,
    liveToolIndexesRef, liveToolInputJsonRef, abortControllerRef, resumeFromMessageId,
    selectedAgent, selectedCopilotMode, selectedCopilotContextTier, selectedPermissionMode,
    taskBudgetTokens, enableWorkflow, selectedCodexApproval, setContextUsage,
    liveTurnSessionHandoffRef, composerSessions, composerOwnerKey, onFork, setSessionActionNotice,
    setSelectedCopilotMode, setLiveSlashCommands, setSessionInfo, queueLiveSubagentDelta,
    removeLiveSubagentEntry, setPendingPermissions, composerQueueTargetKey, queueLiveAssistantText,
    queueLiveReasoningText, setLiveThinkingTokens, flushLiveAssistantTextNow, refreshSessionModels,
    setResumeFromMessageId, transientRetryTimerRef, activeWebComposerOwnerRef,
    composerQueueClaimInFlightRef, setQueuedSends,
  }, retryOverride), [attachments, canUseChannelBridge, canUseIdeBridge, clearLiveAssistantText, clearLiveSubagentText, commitQueuedSends, composerQueueTargetKey, enableWorkflow, flushLiveAssistantTextNow, messages, modelsLoading, onFork, queueLiveAssistantText, queueLiveReasoningText, refreshSessionModels, resizeComposer, resumeFromMessageId, selectedAgent, selectedCopilotContextTier, selectedCopilotMode, selectedCodexApproval, selectedEffort, selectedModel, selectedPermissionMode, session, taskBudgetTokens, abortControllerRef, activeTurnRequestIdRef, inputTextRef, sendInFlightRef, awaitingPersistedTurnRef, pushedCopilotAttachmentsRef, turnProducedOutputRef, transientRetryCountRef, transientRetryTimerRef, pendingSendOnModelsReadyRef, pendingMessageBaselineRef, liveTurnSessionHandoffRef, steeredUserTextsRef, textareaRef, liveToolIndexesRef, liveToolInputJsonRef, setInputText, setSendState, setSendError, setLivePromptSuggestion, setLiveStatus, setContextUsage, setSessionInfo, setSelectedCopilotMode, setSteeredNotice, setAttachments, setFailedSend, setOptimisticContextText, setOptimisticUserText, setSteeredUserTexts, setReattachedRunning, setLiveThinkingTokens, setLiveThreadedMessages, setLiveToolActivities, setAwaitingPersistedTurn])

  // Flush queued sends once the active turn finishes. Restores the queued
  // text into the composer so sendMessage picks it up and fires naturally.
  useEffect(() => runQueuedSendsEffect({
    activeQueuedSends, composerQueueStorageReady, runningProbeReadyKey, composerQueueTargetKey,
    sendInFlightRef, awaitingPersistedTurnRef, reattachedRunning, sendState, awaitingPersistedTurn,
    composerQueueClaimInFlightRef, composerQueueCommitCounterRef, queuedSendsRef,
    composerQueueMountedRef, setQueuedSends, setComposerQueueDurability, composerQueueTargetKeyRef,
    commitQueuedSends, setInputText, inputTextRef, setAttachments, textareaRef, resizeComposer,
    sendMessage,
  }), [activeQueuedSends, awaitingPersistedTurn, commitQueuedSends, composerQueueStorageReady, composerQueueTargetKey, reattachedRunning, resizeComposer, runningProbeReadyKey, sendMessage, sendState])

  // A send blocked on the model list (cold LM Studio / custom-endpoint
  // connection) re-fires automatically once the fetch settles, rather than
  // leaving the user staring at "Waiting for model list to load…" and having
  // to hit enter a second time themselves.
  useEffect(() => {
    if (modelsLoading) return
    if (!pendingSendOnModelsReadyRef.current || pendingSendOnModelsReadyRef.current !== session?.sessionId) return
    pendingSendOnModelsReadyRef.current = null
    setSendError(null)
    void sendMessage()
  }, [modelsLoading, sendMessage, session?.sessionId])
  const {
    removeQueuedSend, editQueuedSend, updateComposerHints, slashCommands, commandSessionId,
    commandSessionProvider,
  } = useRemoveQueuedSendGroup({
    commitQueuedSends, queuedSendsRef, setInputText, inputTextRef, setAttachments, textareaRef,
    resizeComposer, mentionQuery, setMentionActiveIndex, setMentionQuery, slashOpen,
    setSlashActiveIndex, setSlashOpen, session, liveSlashCommands, inputText,
  })

  useEffect(() => runSlashCommandsEffect({
    commandSessionId, setLiveSlashCommands, commandSessionProvider,
  }), [commandSessionId, commandSessionProvider])

  useEffect(() => runMentionSearchEffect({
    mentionQuery, mentionAbortRef, setMentionResults, activeProvider, composerMentionAgentOptions,
    session, setMentionActiveIndex,
  }), [activeProvider, composerMentionAgentOptions, mentionQuery, session?.cwd])

  useLayoutEffect(() => {
    const node = mentionItemRefs.current[mentionActiveIndex]
    node?.scrollIntoView({ block: 'nearest' })
  }, [mentionActiveIndex, mentionResults])

  useLayoutEffect(() => {
    const node = slashItemRefs.current[slashActiveIndex]
    node?.scrollIntoView({ block: 'nearest' })
  }, [slashActiveIndex, slashOpen])

  const insertContextAttachments = useCallback((incoming: SendAttachment[]) => {
    if (!incoming.length) return
    const editor = textareaRef.current
    const value = editor?.value ?? inputTextRef.current
    const start = editor?.selectionStart ?? value.length
    const end = editor?.selectionEnd ?? value.length
    const insertion = incoming.map(contextReference).join(' ') + ' '
    const next = value.slice(0, start) + insertion + value.slice(end)
    setAttachments(prev => mergeComposerAttachments(prev, incoming))
    setInputText(next)
    inputTextRef.current = next
    if (editor) editor.value = next
    setComposerCollapsed(false)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(start + insertion.length, start + insertion.length)
      resizeComposer()
    })
  }, [resizeComposer, inputTextRef, textareaRef, setInputText, setAttachments])

  useEffect(() => {
    const receive = (event: Event) => {
      const attachment = (event as CustomEvent<SendAttachment>).detail
      if (!session || projectView || !attachment?.contextKind) return
      insertContextAttachments([attachment])
    }
    window.addEventListener('agent-viewer:insert-context', receive)
    return () => window.removeEventListener('agent-viewer:insert-context', receive)
  }, [insertContextAttachments, session, projectView])

  const insertMention = useCallback((entry: MentionResult) => runInsertMention({
    mentionQuery, textareaRef, inputTextRef, insertContextAttachments, setMentionQuery,
    setMentionResults, setInputText, setAttachments, resizeComposer,
  }, entry), [mentionQuery, resizeComposer, insertContextAttachments, inputTextRef, textareaRef, setInputText, setAttachments])

  const insertPromptText = useCallback((text: string) => runInsertPromptText({
    textareaRef, inputTextRef, setInputText, resizeComposer,
  }, text), [resizeComposer, inputTextRef, textareaRef, setInputText])

  const handledComposerInsertRequestRef = useRef(0)
  useEffect(() => {
    if (!composerInsertRequest || composerInsertRequest.requestId <= handledComposerInsertRequestRef.current) return
    handledComposerInsertRequestRef.current = composerInsertRequest.requestId
    const text = composerInsertRequest.text
    if (text.startsWith('Please follow up on this diff comment.')) {
      insertContextAttachments([createContextAttachment('diff', /File: (.*)/.exec(text)?.[1] || 'Diff comment', text)])
    } else if (text.startsWith('@') && !text.trim().includes('\n')) {
      const path = text.trim().slice(1)
      insertContextAttachments([createContextAttachment('file', path.split('/').pop() || path, undefined, path)])
    } else insertPromptText(text)
    onComposerInsertConsumed?.(composerInsertRequest.requestId)
  }, [composerInsertRequest, insertPromptText, insertContextAttachments, onComposerInsertConsumed])

  const insertSlashCommand = useCallback((command: string) => {
    const remainder = inputText.split('\n').slice(1).join('\n')
    const next = remainder ? `${command} ${remainder}` : `${command} `
    setInputText(next)
    inputTextRef.current = next
    setSlashOpen(false)
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const caret = command.length + 1
      ta.setSelectionRange(caret, caret)
      ta.focus()
      resizeComposer()
    })
  }, [inputText, resizeComposer, inputTextRef, textareaRef, setInputText])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => runHandleKeyDown({
    isComposingRef, session, sendState, reattachedRunning, backgroundClaudeTasks, mentionQuery,
    mentionResults, setMentionActiveIndex, mentionActiveIndex, insertMention, setMentionQuery,
    slashOpen, slashCommands, setSlashActiveIndex, slashActiveIndex, insertSlashCommand,
    setSlashOpen, sendMessage, sentHistory, textareaRef, inputTextRef, historyIndex,
    draftBeforeHistoryRef, setHistoryIndex, setAttachments, setInputText, resizeComposer,
  }, e), [backgroundClaudeTasks, session?.provider, sendState, reattachedRunning, sendMessage, sentHistory, historyIndex, resizeComposer, mentionQuery, mentionResults, mentionActiveIndex, insertMention, slashOpen, slashCommands, slashActiveIndex, insertSlashCommand, inputTextRef, textareaRef, setInputText, setAttachments])

  const handleExport = useCallback(async () => runHandleExport({
    session, setExporting, messages, setSessionActionError,
  }), [session, messages])

  const addAttachment = useCallback(() => {
    const path = attachmentPath.trim()
    if (!path) return
    if (attachmentType === 'agent' || attachmentType === 'extension_context') {
      setAttachments(prev => [...prev, { id: crypto.randomUUID(), type: attachmentType, path, displayName: path, text: `@${path}` }])
    } else {
      insertContextAttachments([{ ...createContextAttachment(attachmentType === 'image' ? 'image' : 'file', path.split('/').pop() || path, undefined, path), type: attachmentType }])
    }
    setAttachmentPath('')
  }, [attachmentPath, attachmentType, insertContextAttachments, setAttachments])

  const activeComposerDraftKeyRef = useRef(composerDraftKey)
  useLayoutEffect(() => { activeComposerDraftKeyRef.current = composerDraftKey }, [composerDraftKey])
  const {
    handleComposerPaste, composerDropActive, handleComposerDragEnter, handleComposerDragOver,
    handleComposerDragLeave, handleComposerDrop, removeAttachment, restoreFailedSend,
    handleDeleteSession, runSessionAction, respondToPermission, respondToQuestion, respondToPlan,
    handleFork, handleForkFromMessage, toggleResumeFromMessage, handleReusePrompt,
    handleQuoteMessage, handleQuestionAnswerToComposer, handleDiffCommentToComposer,
    handleEditFromMessage, claudeMcpBusy, claudeHookQuery, setClaudeHookQuery, claudeHookSearching,
    claudeMcpPermissionModes, runClaudeSessionAction, applyClaudeMcpPermissionMode,
    addClaudeMcpServer, searchClaudeHookEvents, toggleDiagnostics, threadedFull, threaded,
    turnDurations, threadedWithBridge, taskActiveForms, taskRegistry, taskRailOpen,
    setTaskRailOpen, isProject, dirName,
  } = useIngestFileAttachmentsGroup({
    activeComposerDraftKeyRef, attachmentReadsRef, setSendError, insertContextAttachments,
    inputTextRef, setInputText, setAttachments, failedSend, sendInFlightRef,
    awaitingPersistedTurnRef, setFailedSend, resizeComposer, textareaRef, session, deleting,
    sessionCapabilities, setDeleting, setSessionActionError, setSessionActionNotice, onDelete,
    sessionActionLoading, setSessionActionLoading, setDiagnosticSections, setPendingPermissions,
    commitClaudePermissionSelection, forking, setForking, onFork, forkingMessageId,
    setForkingMessageId, setResumeFromMessageId, setComposerCollapsed, setHistoryIndex,
    draftBeforeHistoryRef, setDiagnosticsLoading, selectedModelValue, setSelectedModel,
    showDiagnostics, setShowDiagnostics, diagnosticSections, diagnosticsLoading, prevThreadingRef,
    messages, threadedCacheRef, showTools, bridgeTranscriptEntries, taskActiveFormsRef,
    openCodeTodos, codexPlan, projectView,
  })

  useEffect(() => {
    if (taskPanelOpenRequest <= 0) return
    setTaskRailOpen(true)
  }, [taskPanelOpenRequest])

  useEffect(() => {
    if (promptLibraryOpenRequest <= 0) return
    setPromptLibraryOpen(true)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }, [promptLibraryOpenRequest])

  useEffect(() => {
    if (channelBridgeOpenRequest <= handledChannelBridgeOpenRequestRef.current) return
    handledChannelBridgeOpenRequestRef.current = channelBridgeOpenRequest
    if (!canUseChannelBridge) return
    setChannelBridgeOpen(true)
  }, [canUseChannelBridge, channelBridgeOpenRequest])

  useEffect(() => {
    if (canUseChannelBridge) return
    setChannelBridgeOpen(false)
    setBridgeTranscriptEntries([])
    setPendingPermissions((prev) => prev.filter((permission) => permission.sessionId || permission.provider))
    persistedBridgeCountRef.current = 0
  }, [canUseChannelBridge])

  // Listen for new bridge sent/reply entries from the hook
  useEffect(() => runBridgeEntriesEffect({
    channelBridge, setBridgeTranscriptEntries,
  }), [channelBridge.entries.length])

  // Sync bridge permission requests into the permission composer
  useEffect(() => runBridgePermissionsEffect({
    channelBridge, setPendingPermissions,
  }), [channelBridge.entries.length])

  // The command palette toggles composer routing via a request counter (it lives
  // outside this component); flip the persisted binding when it bumps.
  useEffect(() => {
    if (channelBridgeRouteToggleRequest <= handledChannelBridgeRouteRequestRef.current) return
    handledChannelBridgeRouteRequestRef.current = channelBridgeRouteToggleRequest
    if (!canUseChannelBridge) return
    const bridge = channelBridgeRef.current
    bridge.setRouteComposer(!bridge.routeComposer)
  }, [canUseChannelBridge, channelBridgeRouteToggleRequest])

  // Mirror the current routing state up so the palette label can reflect it.
  useEffect(() => {
    onChannelBridgeRoutingChange?.(channelBridge.routeComposer)
  }, [channelBridge.routeComposer, onChannelBridgeRoutingChange])

  // IDE bridge: same open/route/mirror plumbing as the channel bridge above.
  useEffect(() => {
    if (ideBridgeOpenRequest <= handledIdeBridgeOpenRequestRef.current) return
    handledIdeBridgeOpenRequestRef.current = ideBridgeOpenRequest
    if (!canUseIdeBridge) return
    setIdeBridgeOpen(true)
  }, [canUseIdeBridge, ideBridgeOpenRequest])

  useEffect(() => {
    if (canUseIdeBridge) return
    setIdeBridgeOpen(false)
  }, [canUseIdeBridge])

  useEffect(() => {
    if (ideBridgeRouteToggleRequest <= handledIdeBridgeRouteRequestRef.current) return
    handledIdeBridgeRouteRequestRef.current = ideBridgeRouteToggleRequest
    if (!canUseIdeBridge) return
    const bridge = ideBridgeRef.current
    bridge.setRouteComposer(!bridge.routeComposer)
  }, [canUseIdeBridge, ideBridgeRouteToggleRequest])

  useEffect(() => {
    onIdeBridgeRoutingChange?.(ideBridge.routeComposer)
  }, [ideBridge.routeComposer, onIdeBridgeRoutingChange])

  // Load persisted bridge messages when session changes
  useEffect(() => runBridgeLoadEffect({
    canUseChannelBridge, session, setBridgeTranscriptEntries, persistedBridgeCountRef,
  }), [canUseChannelBridge, session?.provider, session?.sessionId])

  // Persist new bridge messages to disk when they arrive
  useEffect(() => runBridgePersistEffect({
    canUseChannelBridge, session, bridgeTranscriptEntries, persistedBridgeCountRef,
  }), [canUseChannelBridge, session?.provider, session?.sessionId, bridgeTranscriptEntries.length])

  // Auto-focus the composer for a brand-new pending session — same as opening
  // a CLI and landing at the prompt. Gated on `isPending` to avoid stealing
  // focus on every navigation back to an existing session.
  useEffect(() => {
    if (!session || session.isPending !== true) return
    if (isProject) return
    const key = sessionIdentityKey(session)
    if (autoFocusedSessionsRef.current.has(key)) return
    autoFocusedSessionsRef.current.add(key)
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }, [isProject, session])
  // Plugin commands from the palette, the toolbar or a shortcut target the
  // session this view shows; a project feed has no session to give them.
  useEffect(() => subscribePluginCommands((commandId) => {
    const command = getPluginCommand(commandId)
    if (!command || !command.renderers.includes('web') || !isPluginSurfaceId(command.opens)) return false
    if (getPluginSurface(command.opens).pin !== 'session' || !isPluginEnabled(command.pluginId)) return false
    if (command.requires === 'session' && (isProject || !session)) return false
    setPluginOverlay(command.opens)
    return true
  }), [isProject, session])
  const {
    activeToolCount, modelsPending, sendBusy, canSubmitMessage, composerConfig,
    composerPlaceholder, composerRuntime, composerStatus, composerStatusDetail,
    composerStatusColor, composerGitBranch, composerGitTitle, composerGitHasDetails, liveTurnTone,
    liveTurnBadge, liveTurnActivityDetail, showLiveTimelineOverlay, visiblePersistedMessageKeys,
  } = useActiveToolCountGroup({
    liveToolActivities, modelsLoading, selectedModel, sendState, awaitingPersistedTurn,
    reattachedRunning, session, inputText, attachments, canUseChannelBridge, channelBridge,
    interrupting, liveStatus, liveAssistantText, liveThreadedMessages, activeQueuedSends,
    composerQueueDurability, steeredNotice, sendError, composerGitSummary, sessionInfo, isProject,
    pendingMessageBaselineRef, messages,
  })
  const visibleThreaded = useMemo(() => {
    if (!visiblePersistedMessageKeys) return threadedWithBridge
    return threadedWithBridge.filter((msg) =>
      // Always include bridge messages (ephemeral, not in persisted set)
      msg.origin?.kind === 'bridge' || visiblePersistedMessageKeys.has(threadedMessageKey(msg))
    )
  }, [threadedWithBridge, visiblePersistedMessageKeys])
  const liveUserMessage = useMemo<ThreadedMessage | null>(() => (showLiveTimelineOverlay && optimisticUserText
    ? {
        role: 'user',
        uuid: 'live-user',
        sessionId: session?.sessionId,
        provider: session?.provider,
        providerInstanceId: session?.providerInstanceId,
        blocks: [{ type: 'text', text: optimisticContextText || optimisticUserText }],
      }
    : null), [optimisticUserText, optimisticContextText, session?.provider, session?.providerInstanceId, session?.sessionId, showLiveTimelineOverlay])
  const liveAssistantMessage = useMemo<ThreadedMessage | null>(() => (showLiveTimelineOverlay && (sendState === 'sending' || awaitingPersistedTurn)
    ? {
        role: 'assistant',
        uuid: 'live-assistant',
        sessionId: session?.sessionId,
        provider: session?.provider,
        blocks: [
          ...(liveReasoningText.trim()
            ? [{ type: 'thinking' as const, thinking: liveReasoningText.trim() }]
            : []),
          {
            type: 'text' as const,
            text: liveAssistantText.trim()
              || (activeToolCount > 0
                ? `Using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
                : liveReasoningText.trim()
                ? `Thinking…${liveThinkingTokens > 0 ? ` (~${formatLiveThinkingTokens(liveThinkingTokens)} tokens)` : ''}`
                : sendState === 'sending'
                ? `Working…${liveThinkingTokens > 0 ? ` (~${formatLiveThinkingTokens(liveThinkingTokens)} thinking tokens)` : ''}`
                : 'Waiting for saved response…'),
          },
        ],
      }
    : null), [
      activeToolCount,
      awaitingPersistedTurn,
      liveAssistantText,
      liveReasoningText,
      liveThinkingTokens,
      sendState,
      session?.provider,
      session?.sessionId,
      showLiveTimelineOverlay,
    ])
  const rewindCandidates = useMemo(() =>
    (sessionCapabilities?.fileRewind ? messages : [])
      .filter((msg) =>
        msg.type === 'user'
        && extractTextContent(msg.message.content).trim() !== ''
        && !extractTextContent(msg.message.content).trimStart().startsWith('<task-notification>')
      )
      .map((msg) => ({
        uuid: msg.uuid,
        content: extractTextContent(msg.message.content),
        timestamp: msg.timestamp,
      }))
 , [messages, sessionCapabilities?.fileRewind])
  const selectedRewindTarget = rewindCandidates.find((candidate) => candidate.uuid === rewindTargetId) ?? null
  const rollbackCandidates = useMemo(() => {
    if (!sessionCapabilities?.rollback) return []
    const turns = new Map<string, { turnId: string; preview: string }>()
    for (const msg of messages) {
      if (!msg.turnId || turns.has(msg.turnId)) continue
      const preview = typeof msg.message.content === 'string'
        ? msg.message.content.replace(/\s+/g, ' ').trim().slice(0, 120)
        : msg.type === 'assistant'
        ? 'Assistant output'
        : 'Turn'
      turns.set(msg.turnId, { turnId: msg.turnId, preview: preview || msg.turnId })
    }
    return Array.from(turns.values())
  }, [messages, sessionCapabilities?.rollback])
  const lastUserMessageUuid = useMemo(() => {
    for (let i = visibleThreaded.length - 1; i >= 0; i -= 1) {
      const msg = visibleThreaded[i]
      if (msg && msg.role === 'user') return msg.uuid
    }
    return null
  }, [visibleThreaded])

  const persistedTimelineRows = useMemo<TimelineRow[]>(() =>
    visibleThreaded.map((msg) => ({
      key: `persisted:${threadedMessageKey(msg)}`,
      message: msg,
      showSession: isProject,
      showForkControls: !isProject && (sessionCapabilities?.messageFork || (msg.role === 'assistant' && sessionCapabilities?.resumeAtMessage)),
      allowFork: !!sessionCapabilities?.messageFork,
      allowResume: msg.role === 'assistant' && !!sessionCapabilities?.resumeAtMessage,
      allowEdit: !isProject && msg.role === 'user' && msg.uuid === lastUserMessageUuid && !!sessionCapabilities?.resumeAtMessage,
    }))
  // highlightedMessageId / forkingMessageId / resumeFromMessageId are
  // intentionally NOT deps: they are delivered to rows as per-row booleans at
  // render time so an interaction doesn't rebuild this whole array (and the
  // timelineRows / transcriptTimelineRows / virtualTimeline cascade below it).
 , [
    isProject,
    lastUserMessageUuid,
    sessionCapabilities?.messageFork,
    sessionCapabilities?.resumeAtMessage,
    visibleThreaded,
  ])

  const liveThreadedVisible = useMemo(
    () => (showTools ? liveThreadedMessages : stripToolCallBlocks(liveThreadedMessages)),
    [liveThreadedMessages, showTools],
  )
  const liveTimelineRows = useMemo<TimelineRow[]>(() => {
    if (!showLiveTimelineOverlay) return []
    const rows: TimelineRow[] = []
    if (liveUserMessage && !liveThreadedVisible.some(message => sameUserMessage(message, liveUserMessage))) {
      rows.push({
        key: 'live:user',
        message: liveUserMessage,
        showSession: false,
        dimmed: true,
      })
    }

    if (liveAssistantMessage) {
      rows.push({
        key: 'live:assistant',
        message: liveAssistantMessage,
        showSession: false,
        dimmed: true,
        previewBadge: liveTurnBadge,
        activityDetail: liveTurnActivityDetail,
        activityTone: liveTurnTone,
        liveToolActivities: session?.provider !== 'claude' ? liveToolActivities : undefined,
      })
    }

    liveThreadedVisible.forEach((msg, index) => {
      rows.push({
        key: `live:threaded:${msg.provider ?? 'claude'}:${msg.uuid}`,
        message: msg,
        showSession: false,
        dimmed: true,
        previewBadge: index === 0 && !liveAssistantMessage ? liveTurnBadge : undefined,
        activityDetail: index === 0 && !liveAssistantMessage ? liveTurnActivityDetail : undefined,
        activityTone: index === 0 && !liveAssistantMessage ? liveTurnTone : undefined,
      })
    })

    // Messages steered into the running turn — newest input, shown last.
    steeredUserTexts.forEach((entry, index) => {
      rows.push({
        key: `live:steered:${index}`,
        message: {
          role: 'user',
          uuid: `live-user-steer-${index}`,
          sessionId: session?.sessionId,
          provider: session?.provider,
          blocks: [{ type: 'text', text: entry.text }],
        },
        showSession: false,
        dimmed: true,
        previewBadge: entry.state === 'queued'
          ? 'steered · queued'
          : entry.state === 'started'
          ? 'steered · running'
          : entry.state === 'completed'
          ? 'steered · done'
          : undefined,
      })
    })

    return rows
  }, [
    awaitingPersistedTurn,
    liveAssistantMessage,
    liveToolActivities,
    liveThreadedVisible,
    liveTurnActivityDetail,
    liveTurnBadge,
    liveTurnTone,
    liveUserMessage,
    session?.provider,
    session?.sessionId,
    showLiveTimelineOverlay,
    steeredUserTexts,
  ])
  const {
    timelineRows, renderedTimelineRows, hasTranscriptFocus, visualizerRows,
    timelineTargetMessageId, hasLiveTimeline, hasTranscriptTimeline,
  } = useTimelineRowsGroup({
    persistedTimelineRows, liveTimelineRows, deferredTranscriptSearch, maximized,
    transcriptFilters, bookmarksOnly, bookmarkIds, viewMode, showLiveTimelineOverlay,
    transcriptSearch, showVisualizer, targetMessageId, messages,
  })
  useLayoutEffect(() => {
    timelineRowsRef.current = renderedTimelineRows
  }, [renderedTimelineRows])

  // On the first completed load for a session, wait for rows to exist and then force the
  // viewport to the live edge so initial virtualization and measurement do not leave us at the top.
  useLayoutEffect(() => {
    if (loading || !session) return
    if (initialScrollDoneRef.current) return

    if (!hasLiveTimeline) {
      if (messages.length === 0) {
        initialScrollDoneRef.current = true
        setAutoFollow(true)
      }
      return
    }

    if (targetMessageId) {
      initialScrollDoneRef.current = true
      autoFollowRef.current = false
      setAutoFollow(false)
      return
    }

    initialScrollDoneRef.current = true
    setAutoFollow(true)

    const node = timelineRef.current
    if (node) {
      const targetTop = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
      suppressFollowEvalUntilRef.current = performance.now() + 200
      markProgrammaticTimelineScroll()
      node.scrollTop = targetTop
      commitTimelineScrollTop(targetTop)
    }
    alignLastTimelineRowToViewportBottom()

    let cancelled = false
    let frameId: number | null = null
    // Two passes cover the initial paint and the first ResizeObserver delivery.
    // The content observer below continues pinning while late rows settle, so
    // six forced layout reads here only delayed first interaction.
    const runInitialScrollPass = (pass: number) => {
      if (cancelled) return
      scrollTimelineToBottom()
      alignLastTimelineRowToViewportBottom()
      if (pass >= 2) return
      frameId = window.requestAnimationFrame(() => runInitialScrollPass(pass + 1))
    }

    frameId = window.requestAnimationFrame(() => runInitialScrollPass(1))

    return () => {
      cancelled = true
      if (frameId != null) window.cancelAnimationFrame(frameId)
    }
  }, [alignLastTimelineRowToViewportBottom, commitTimelineScrollTop, hasLiveTimeline, loading, markProgrammaticTimelineScroll, messages.length, scrollTimelineToBottom, session?.sessionId, targetMessageId])

  useEffect(() => {
    const activeKeys = new Set(renderedTimelineRows.map((row) => row.key))
    let changed = false
    let persistedChanged = false
    for (const key of rowHeightsRef.current.keys()) {
      if (activeKeys.has(key)) continue
      rowHeightsRef.current.delete(key)
      changed = true
      if (!key.startsWith('live:')) persistedChanged = true
    }
    if (changed) setRowMeasurementVersion((version) => version + 1)
    if (persistedChanged) setPersistedMeasurementVersion((version) => version + 1)
  }, [renderedTimelineRows])

  const setLastTimelineRow = useCallback((node: HTMLDivElement | null) => {
    lastTimelineRowRef.current = node
  }, [])

  const flushTimelineRowMeasurements = useCallback(() => {
    measurementFrameRef.current = window.requestAnimationFrame(() => {
      measurementFrameRef.current = null
      const pending = pendingRowMeasurementsRef.current
      if (pending.size === 0) return

      const node = timelineRef.current
      const layout = rowLayoutRef.current
      const rows = timelineRowsRef.current
      const isFollowing = autoFollowRef.current
      // Wheel/trackpad input is delta-based, so measurements can settle while
      // scrolling as long as their anchor compensation lands with the layout
      // commit. Direct scrollbar/touch scrubbing controls an absolute
      // scrollTop, so hold measurements above the viewport until the gesture
      // ends instead of moving every visible row underneath the pointer.
      const allowScrollAdjust = !userScrollingRef.current
        || performance.now() < wheelScrollCompensationUntilRef.current
      const anchor = node ? findTimelineScrollAnchor(rows, layout, node.scrollTop) : null
      const measurementChanges: TimelineMeasurementChange[] = []
      let changed = false
      let persistedChanged = false
      let calibrationChanged = false

      for (const [key, nextMeasuredHeight] of pending) {
        const index = layout.indexByKey.get(key)
        if (index == null) {
          pending.delete(key)
          continue
        }
        const row = rows[index]
        if (!row) {
          pending.delete(key)
          continue
        }
        if (!allowScrollAdjust && anchor && index < anchor.index) continue

        if (!key.startsWith('live:') && !timelineEstimateCalibrationFrozenRef.current) {
          const rawEstimate = estimateTimelineRowHeight(row, density, viewMode)
          const bucket = timelineEstimateBucket(row, viewMode)
          const previousSample = timelineEstimateSamplesRef.current.get(key)
          const sampleChanged = !previousSample
            || previousSample.bucket !== bucket
            || previousSample.estimatedHeight !== rawEstimate
            || previousSample.measuredHeight !== nextMeasuredHeight
          if (sampleChanged) {
            if (previousSample) {
              for (const calibrationKey of ['all', previousSample.bucket] as const) {
                const current = timelineEstimateCalibrationRef.current.get(calibrationKey)
                if (!current) continue
                current.estimatedTotal -= previousSample.estimatedHeight
                current.measuredTotal -= previousSample.measuredHeight
                current.sampleCount -= 1
                if (current.sampleCount <= 0) timelineEstimateCalibrationRef.current.delete(calibrationKey)
              }
            }
            for (const calibrationKey of ['all', bucket] as const) {
              const current = timelineEstimateCalibrationRef.current.get(calibrationKey)
                ?? { estimatedTotal: 0, measuredTotal: 0, sampleCount: 0 }
              current.estimatedTotal += rawEstimate
              current.measuredTotal += nextMeasuredHeight
              current.sampleCount += 1
              timelineEstimateCalibrationRef.current.set(calibrationKey, current)
            }
            timelineEstimateSamplesRef.current.set(key, {
              bucket,
              estimatedHeight: rawEstimate,
              measuredHeight: nextMeasuredHeight,
            })
            calibrationChanged = true
          }
        }

        const previousHeight = rowHeightsRef.current.get(key) ?? layout.heights[index]
        pending.delete(key)
        if (nextMeasuredHeight === previousHeight) continue

        rowHeightsRef.current.set(key, nextMeasuredHeight)
        changed = true
        if (!key.startsWith('live:')) persistedChanged = true
        measurementChanges.push({ index, previousHeight, nextHeight: nextMeasuredHeight })
      }

      const scrollDelta = allowScrollAdjust && !isFollowing
        ? computeTimelineScrollCompensation(measurementChanges, anchor)
        : 0
      if (scrollDelta !== 0) {
        pendingTimelineScrollCompensationRef.current += scrollDelta
      }

      if (changed || calibrationChanged) {
        setRowMeasurementVersion((version) => version + 1)
      }
      if (persistedChanged || calibrationChanged) {
        setPersistedMeasurementVersion((version) => version + 1)
      }
    })
  }, [density, viewMode])

  const scheduleTimelineMeasurementFlush = useCallback(() => {
    if (pendingRowMeasurementsRef.current.size === 0 || measurementFrameRef.current != null) return
    flushTimelineRowMeasurements()
  }, [flushTimelineRowMeasurements])
  useLayoutEffect(() => {
    scheduleTimelineMeasurementFlushRef.current = scheduleTimelineMeasurementFlush
  }, [scheduleTimelineMeasurementFlush])

  const handleTimelineRowMeasure = useCallback((key: string, height: number) => {
    pendingRowMeasurementsRef.current.set(key, Math.max(1, Math.ceil(height)))
    scheduleTimelineMeasurementFlush()
  }, [scheduleTimelineMeasurementFlush])

  useLayoutEffect(() => {
    if (!autoFollow || !hasTranscriptTimeline || loading) return
    scrollTimelineToBottom()
    alignLastTimelineRowToViewportBottom()
  }, [alignLastTimelineRowToViewportBottom, autoFollow, hasTranscriptTimeline, loading, renderedTimelineRows.length, rowMeasurementVersion, scrollTimelineToBottom])

  const estimateTimelineRowHeightForLayout = useCallback((row: TimelineRow) => {
    const rawEstimate = estimateTimelineRowHeight(row, density, viewMode)
    return calibratedTimelineRowHeight(
      row,
      rawEstimate,
      viewMode,
      timelineEstimateCalibrationRef.current,
    )
  }, [density, viewMode])

  // Layout for the persisted prefix only. Keyed on persistedMeasurementVersion
  // (not rowMeasurementVersion) so a streaming turn — which bumps the live
  // row's measured height every few frames — does NOT re-run the O(n) height
  // accumulation over the entire transcript. Rebuilds only on a real poll
  // delta (persistedTimelineRows identity) or a persisted-row resize.
  const baseLayout = useMemo(() => {
    return measureSync('timeline.baseLayout', () =>
      buildTimelineRowLayout(persistedTimelineRows, rowHeightsRef.current, estimateTimelineRowHeightForLayout))
  }, [estimateTimelineRowHeightForLayout, persistedMeasurementVersion, persistedTimelineRows])

  // Separate the expensive O(n) height accumulation from the scroll-reactive
  // visibility window. rowLayout only recomputes when rows or measurements
  // change; virtualTimeline re-runs on every scroll but only does a scan of
  // the visible window — no new objects for off-screen rows.
  const rowLayout = useMemo(() => {
    // transcriptTimelineRows returns the SAME reference as timelineRows exactly
    // when no filter/search applies (and timelineRows === [...persisted,
    // ...live]). Gate on that referential equality rather than hasTranscriptFocus
    // — the latter reads the IMMEDIATE search box while transcriptTimelineRows
    // is filtered from the DEFERRED value, so they desync during the
    // useDeferredValue lag (e.g. clearing the box) and would pair filtered rows
    // with a full-list layout. When they differ, a filter is genuinely active
    // and the base prefix can't be reused — rebuild the full layout.
    if (renderedTimelineRows !== timelineRows) {
      return measureSync('timeline.fullLayout', () =>
        buildTimelineRowLayout(renderedTimelineRows, rowHeightsRef.current, estimateTimelineRowHeightForLayout))
    }
    // Otherwise reuse baseLayout for the persisted prefix and append only the
    // live suffix.
    return measureSync('timeline.appendLayout', () =>
      appendTimelineRowLayout(baseLayout, liveTimelineRows, rowHeightsRef.current, estimateTimelineRowHeightForLayout))
  }, [baseLayout, estimateTimelineRowHeightForLayout, liveTimelineRows, renderedTimelineRows, rowMeasurementVersion, timelineRows])
  rowLayoutRef.current = rowLayout

  const buildStreamHistoryMetadata = useLazyRef(() => createStreamHistoryMetadataBuilder(messageToCopyText))
  const streamHistoryMetadata = useMemo(() => {
    if (viewMode !== 'stream') return []
    return measureSync('timeline.streamHistoryMetadata', () => buildStreamHistoryMetadata.current(renderedTimelineRows))
  }, [buildStreamHistoryMetadata, renderedTimelineRows, viewMode])

  // Rows carry only their layout-space geometry. The rail maps them onto the
  // scroll container's document itself, which totalHeight is not: the container
  // pads the list and renders blocks around it.
  const streamHistoryItems = useMemo<StreamHistoryItem[]>(() => {
    if (streamHistoryMetadata.length === 0) return []
    return streamHistoryMetadata.map((item, index) => ({
      ...item,
      top: rowLayout.tops[index],
      height: rowLayout.heights[index],
    }))
  }, [rowLayout, streamHistoryMetadata])

  useLayoutEffect(() => {
    const scrollDelta = pendingTimelineScrollCompensationRef.current
    pendingTimelineScrollCompensationRef.current = 0
    if (scrollDelta === 0 || autoFollowRef.current) return

    const node = timelineRef.current
    if (!node) return

    const maxScrollTop = Math.max(node.scrollHeight - node.clientHeight, 0)
    const targetTop = Math.max(0, Math.min(node.scrollTop + scrollDelta, maxScrollTop))
    if (Math.abs(node.scrollTop - targetTop) < 1) return

    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    commitTimelineScrollTop(node.scrollTop)
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll, rowLayout])

  useLayoutEffect(() => {
    if (timelineHeightOverride !== null || !pendingTimelineAnchorRestoreRef.current) return
    pendingTimelineAnchorRestoreRef.current = false
    restoreTimelineScrollAnchor()
  }, [restoreTimelineScrollAnchor, rowLayout, timelineHeightOverride])

  const handleVisualizerSelectMessage = useCallback((messageId: string) => runHandleVisualizerSelectMessage({
    setShowVisualizer, setTranscriptFilters, setTranscriptSearch, setHighlightedMessageId,
    autoFollowRef, setAutoFollow, timelineRef, timelineRowsRef, rowLayoutRef,
    suppressFollowEvalUntilRef, markProgrammaticTimelineScroll, commitTimelineScrollTop,
    scrollMountedTimelineRowIntoView,
  }, messageId), [commitTimelineScrollTop, markProgrammaticTimelineScroll, scrollMountedTimelineRowIntoView])

  // Used by TaskRail to scroll the transcript to a task's most recent event.
  // Same scroll/highlight behavior as the visualizer-select path but without
  // touching filters/search or the visualizer toggle.
  const handleJumpToMessage = useCallback((messageId: string) => runHandleJumpToMessage({
    setHighlightedMessageId, autoFollowRef, setAutoFollow, timelineRef, timelineRowsRef,
    rowLayoutRef, suppressFollowEvalUntilRef, markProgrammaticTimelineScroll,
    commitTimelineScrollTop, scrollMountedTimelineRowIntoView,
  }, messageId), [commitTimelineScrollTop, markProgrammaticTimelineScroll, scrollMountedTimelineRowIntoView])

  const handleReviewJumpToMessage = useCallback((messageId: string) => {
    setShowReviewMode(false)
    setShowVisualizer(false)
    setTranscriptFilters([])
    setTranscriptSearch('')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => handleJumpToMessage(messageId))
    })
  }, [handleJumpToMessage])

  useLayoutEffect(() => {
    if (!timelineTargetMessageId || loading) return
    if (targetMessageRequestId && handledTargetMessageRequestRef.current === targetMessageRequestId) return
    const node = timelineRef.current
    if (!node) return

    const rowIndex = renderedTimelineRows.findIndex((row) => rowContainsMessage(row, timelineTargetMessageId))
    if (rowIndex < 0) return

    handledTargetMessageRequestRef.current = targetMessageRequestId
    const targetTop = Math.max(rowLayout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
    suppressFollowEvalUntilRef.current = performance.now() + 300
    autoFollowRef.current = false
    setAutoFollow(false)
    commitTimelineScrollTop(targetTop)
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    setHighlightedMessageId(timelineTargetMessageId)
  }, [commitTimelineScrollTop, loading, markProgrammaticTimelineScroll, renderedTimelineRows, rowLayout, targetMessageRequestId, timelineTargetMessageId])

  useEffect(() => {
    if (!highlightedMessageId) return
    const timeout = window.setTimeout(() => {
      setHighlightedMessageId((current) => current === highlightedMessageId ? null : current)
    }, 3500)
    return () => window.clearTimeout(timeout)
  }, [highlightedMessageId])

  // Scroll commits flow through the drift-gated commitTimelineScrollTop (see
  // TIMELINE_SCROLL_COMMIT_PX). Feed the virtual WINDOW from a deferred copy so
  // a commit never forces a synchronous window recompute that blocks the paint
  // of the scrolled frame — the browser paints the overscanned window first and
  // React reconciles rows entering/leaving at transition priority. The urgent
  // committed value still drives anchor capture/restores. Safe under load
  // because the 2400px overscan far exceeds the ≤600px stale-window lag.
  const deferredTimelineScrollTop = useDeferredValue(timelineScrollTop)

  useEffect(() => {
    const node = timelineRef.current
    if (!stickyHeaders || !node) {
      setStickyHeaderIndex(null)
      return undefined
    }
    let frame = 0
    const update = () => {
      frame = 0
      const layout = rowLayoutRef.current
      const rows = timelineRowsRef.current
      // Row tops are layout-space; the container pads the list above them.
      const edge = node.scrollTop - TIMELINE_TARGET_TOP_GUTTER_PX
      let next: number | null = null
      for (let index = 0; index < rows.length; index += 1) {
        if (layout.tops[index] >= edge) break
        if (rows[index].message.role === 'user') next = index
      }
      setStickyHeaderIndex((prev) => (prev === next ? prev : next))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      node.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [stickyHeaders, renderedTimelineRows, rowLayout])

  const virtualTimeline = useMemo(() => {
    return getVirtualTimelineWindow({
      layout: rowLayout,
      rowCount: renderedTimelineRows.length,
      scrollTop: deferredTimelineScrollTop,
      viewportHeight: timelineViewportHeight || 800,
      overscanPx: TIMELINE_OVERSCAN_PX,
    })
  }, [renderedTimelineRows, rowLayout, deferredTimelineScrollTop, timelineViewportHeight])

  useLayoutEffect(() => {
    if (!pendingMountedAnchorCaptureRef.current) return
    pendingMountedAnchorCaptureRef.current = false
    activeTimelineScrollAnchorRef.current = captureTimelineScrollAnchor()
  }, [captureTimelineScrollAnchor, timelineScrollTop, virtualTimeline.endIndex, virtualTimeline.startIndex])

  const timelineRenderedHeight = useMemo(() => {
    const lastVisibleIndex = virtualTimeline.endIndex - 1
    const visibleBottom = lastVisibleIndex >= virtualTimeline.startIndex
      ? rowLayout.tops[lastVisibleIndex] + rowLayout.heights[lastVisibleIndex] + TIMELINE_BOTTOM_GUTTER_PX
      : 0
    return resolveTimelineRenderedHeight({
      measuredTotalHeight: virtualTimeline.totalHeight,
      activeScrollHeight: timelineHeightOverride,
      visibleBottom,
    })
  }, [rowLayout, timelineHeightOverride, virtualTimeline.endIndex, virtualTimeline.startIndex, virtualTimeline.totalHeight])

  // Memoized element array for the mounted window. JSX elements are plain
  // data — reusing the SAME array reference lets React bail out of the whole
  // timeline subtree (up to a few hundred VirtualTimelineRow memo compares)
  // when an unrelated part of this large component re-renders, most notably
  // every composer keystroke. Every handler below is a stable useCallback;
  // none depends on composer state.
  const fullRenderedRowKeysRef = useLazyRef(() => new Set<string>())
  const timelineRowElements = useMemo(() => {
    const lastRowKey = renderedTimelineRows.at(-1)?.key
    const streamMode = viewMode === 'stream' || viewMode === 'agents'
    // During fast scrolls, rows that were already rendered full keep their
    // cards (their subtrees are reused by key), but rows ENTERING the window
    // mount as cheap placeholders so the window always paints within a frame.
    // The set is rebuilt each pass from the rows rendered full, so it tracks
    // "currently mounted with content", not "ever seen".
    const prevFullKeys = fullRenderedRowKeysRef.current
    const nextFullKeys = new Set<string>()
    const elements = []
    for (let index = virtualTimeline.startIndex; index < virtualTimeline.endIndex; index += 1) {
      const row = renderedTimelineRows[index]
      const top = rowLayout.tops[index]
      const height = rowLayout.heights[index]
      const placeholder = fastScrolling && !prevFullKeys.has(row.key)
      if (!placeholder) nextFullKeys.add(row.key)
      elements.push(
        <VirtualTimelineRow
          key={row.key}
          row={row}
          top={top}
          isLast={row.key === lastRowKey}
          highlighted={rowContainsMessage(row, highlightedMessageId)}
          forking={forkingMessageId === row.message.uuid}
          resumeTarget={resumeFromMessageId === row.message.uuid}
          bookmarked={bookmarkIds.has(row.message.uuid) || row.groupedMessageIds?.some((id) => bookmarkIds.has(id)) === true}
          streamMode={streamMode}
          placeholder={placeholder}
          placeholderHeight={placeholder ? height : 0}
          onMeasure={handleTimelineRowMeasure}
          onLastRowRef={setLastTimelineRow}
          onForkFromMessage={handleForkFromMessage}
          onToggleResume={toggleResumeFromMessage}
          onToggleBookmark={toggleBookmark}
          onReusePrompt={handleReusePrompt}
          onQuoteMessage={handleQuoteMessage}
          onReplyMessage={handleQuoteMessage}
          onEditFromMessage={handleEditFromMessage}
        />
      )
    }
    fullRenderedRowKeysRef.current = nextFullKeys
    return elements
  }, [
    bookmarkIds,
    fastScrolling,
    forkingMessageId,
    handleEditFromMessage,
    handleForkFromMessage,
    handleQuoteMessage,
    handleReusePrompt,
    handleTimelineRowMeasure,
    highlightedMessageId,
    resumeFromMessageId,
    setLastTimelineRow,
    toggleBookmark,
    toggleResumeFromMessage,
    renderedTimelineRows,
    rowLayout,
    viewMode,
    virtualTimeline.endIndex,
    virtualTimeline.startIndex,
  ])

  useLayoutEffect(() => {
    if (!timelineTargetMessageId || highlightedMessageId !== timelineTargetMessageId || loading) return
    scrollMountedTimelineRowIntoView(timelineTargetMessageId)
  }, [
    highlightedMessageId,
    loading,
    rowMeasurementVersion,
    scrollMountedTimelineRowIntoView,
    timelineScrollTop,
    timelineTargetMessageId,
    virtualTimeline.endIndex,
    virtualTimeline.startIndex,
  ])

  useEffect(() => {
    autoFollowRef.current = autoFollow
  }, [autoFollow])

  // Pin to bottom synchronously via ResizeObserver — fires after layout but
  // before paint, so new content simply appears at the bottom of the viewport
  // without any visible scroll or shift.
  useEffect(() => {
    if (showVisualizer) return
    const node = timelineRef.current
    const content = timelineContentRef.current
    if (!node || !content) return
    const pin = () => {
      if (!autoFollowRef.current) return
      const target = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
      if (Math.abs(node.scrollTop - target) < 1) return
      suppressFollowEvalUntilRef.current = performance.now() + 200
      markProgrammaticTimelineScroll()
      node.scrollTop = target
      // Quantized: the DOM stays pinned every resize, but the state commit —
      // which re-renders the whole view — only needs to track growth at
      // window granularity. Streaming re-renders still happen through row
      // measurements; this avoids doubling them.
      commitTimelineScrollTopIfDrifted(target)
    }
    const observer = new ResizeObserver(() => pin())
    observer.observe(content)
    observer.observe(node)
    return () => observer.disconnect()
  }, [commitTimelineScrollTopIfDrifted, hasLiveTimeline, markProgrammaticTimelineScroll, session?.sessionId, showVisualizer])

  // When autoFollow is first enabled, pin once.
  useEffect(() => {
    if (!autoFollow) return
    const frame = window.requestAnimationFrame(() => {
      if (autoFollowRef.current) scrollTimelineToBottom()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [autoFollow, loading, scrollTimelineToBottom])

  useEffect(() => {
    const fallbackId = rewindCandidates.at(-1)?.uuid ?? ''
    setRewindTargetId((prev) => rewindCandidates.some((candidate) => candidate.uuid === prev) ? prev : fallbackId)
  }, [messages, session?.sessionId])

  const handleRewind = useCallback(async () => runHandleRewind({
    session, selectedRewindTarget, previewingRewind, applyingRewind, setPreviewingRewind,
    setSessionActionError, setSessionActionNotice, selectedModel, setRewindPreview,
  }), [applyingRewind, previewingRewind, selectedModel, selectedRewindTarget, session])

  const handleApplyRewind = useCallback(async () => runHandleApplyRewind({
    session, rewindPreview, applyingRewind, setApplyingRewind, setSessionActionError,
    setSessionActionNotice, selectedModel, setRewindPreview,
  }), [applyingRewind, rewindPreview, selectedModel, session])

  const handleRollbackPreview = useCallback(async () => runHandleRollbackPreview({
    session, previewingRewind, applyingRewind, rollbackTurns, setPreviewingRewind,
    setSessionActionError, setSessionActionNotice, setRollbackPreview,
  }), [applyingRewind, previewingRewind, rollbackTurns, session])

  const handleApplyRollback = useCallback(async () => runHandleApplyRollback({
    session, rollbackPreview, applyingRewind, setApplyingRewind, setSessionActionError,
    setSessionActionNotice, setRollbackPreview,
  }), [applyingRewind, rollbackPreview, session])

  if (!session && !projectView) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* Decorative orbital ring */}
        <div style={{ position: 'relative', width: 72, height: 72 }}>
          {/* Outer dashed orbit */}
          <div style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            border: '1px dashed var(--border)',
            animation: 'orbit-spin 18s linear infinite',
          }}>
            {/* Orbiting dot */}
            <div style={{
              position: 'absolute',
              top: -3, left: '50%',
              width: 5, height: 5,
              borderRadius: '50%',
              background: 'var(--violet)',
              transform: 'translateX(-50%)',
              boxShadow: '0 0 6px 2px var(--violet-glow)',
            }} />
          </div>
          {/* Inner circle */}
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            border: '1px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: colorTreatment === 'flat' ? 'var(--surface)' : 'linear-gradient(135deg, var(--surface-2), var(--surface))',
            boxShadow: colorTreatment === 'flat' ? 'none' : '0 0 40px 8px rgba(139,128,240,0.04) inset',
          }}>
            <div style={{
              width: 18, height: 18,
              borderRadius: '50%',
              background: 'var(--surface-3)',
              border: '1px solid var(--border-2)',
              boxShadow: colorTreatment === 'flat' ? 'none' : '0 0 8px 2px rgba(139,128,240,0.06)',
            }} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-2)',
            marginBottom: 8,
          }}>
            No session selected
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-3)',
          }}>
            Choose a session from the sidebar to get started
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: hideCoordinator ? '100%' : '100vh',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* ── Top bar ──────────────────────────────────── */}
      <MessageViewTopBar
        maximized={maximized}
        colorTreatment={colorTreatment}
        isProject={isProject}
        dirName={dirName}
        projectView={projectView!}
        session={session}
        sessionInfo={sessionInfo}
        contextUsage={contextUsage}
        disabledPlugins={disabledPlugins}
        loading={loading}
        threaded={threaded}
        messages={messages}
        viewDropdownRef={viewDropdownRef}
        setViewDropdownOpen={setViewDropdownOpen}
        setActionsDropdownOpen={setActionsDropdownOpen}
        viewDropdownOpen={viewDropdownOpen}
        setShowVisualizer={setShowVisualizer}
        setShowReviewMode={setShowReviewMode}
        showVisualizer={showVisualizer}
        showReviewMode={showReviewMode}
        taskRegistry={taskRegistry}
        setTaskRailOpen={setTaskRailOpen}
        taskRailOpen={taskRailOpen}
        setViewMode={setViewMode}
        viewMode={viewMode}
        setDensity={setDensity}
        density={density}
        setTimelineWidth={setTimelineWidth}
        timelineWidth={timelineWidth}
        setStickyHeaders={setStickyHeaders}
        stickyHeaders={stickyHeaders}
        setDiffStyle={setDiffStyle}
        diffStyle={diffStyle}
        setDiffOptions={setDiffOptions}
        diffOptions={diffOptions}
        onToggleMaximized={onToggleMaximized}
        onToggleRightPanel={onToggleRightPanel}
        rightPanelOpen={rightPanelOpen}
        onEnterFullscreen={onEnterFullscreen}
        actionsDropdownRef={actionsDropdownRef}
        actionsDropdownOpen={actionsDropdownOpen}
        handleFork={handleFork}
        forking={forking}
        cliCommand={cliCommand}
        cliPopoverRef={cliPopoverRef}
        setCliPopoverOpen={setCliPopoverOpen}
        cliPopoverOpen={cliPopoverOpen}
        handleExport={handleExport}
        exporting={exporting}
        toggleDiagnostics={toggleDiagnostics}
        showDiagnostics={showDiagnostics}
        activeProvider={activeProvider}
        sessionCapabilities={sessionCapabilities}
        runSessionAction={runSessionAction}
        sessionActionLoading={sessionActionLoading}
        handleDeleteSession={handleDeleteSession}
        deleting={deleting}
        toggleLiveFollow={toggleLiveFollow}
        autoFollow={autoFollow}
      />

      {/* ── Tab bar ──────────────────────────────────── */}
      {!maximized && openTabs && openTabs.length > 0 && (
        <TabBar
          tabs={openTabs}
          activeId={selectedTabId ?? null}
          onSelect={onSelectTab ?? (() => {})}
          onClose={onCloseTab ?? (() => {})}
        />
      )}

      {/* ── OpenCode todos (mirrors opencode-web's pinned task list) ──── */}
      {!maximized && !isProject && session?.provider === 'opencode' && openCodeTodos && openCodeTodos.length > 0 && (
        <OpenCodeTodosBanner todos={openCodeTodos} />
      )}

      {/* ── Timeline feed + optional right-rail task panel ── */}
      <TimelineBody
        maximized={maximized}
        onToggleMaximized={onToggleMaximized}
        showReviewMode={showReviewMode}
        session={session}
        isProject={isProject}
        threadedFull={threadedFull}
        diffStyle={diffStyle}
        diffOptions={diffOptions}
        handleReviewJumpToMessage={handleReviewJumpToMessage}
        setShowReviewMode={setShowReviewMode}
        showVisualizer={showVisualizer}
        visualizerRows={visualizerRows}
        messages={messages}
        loading={loading}
        handleVisualizerSelectMessage={handleVisualizerSelectMessage}
        hasLiveTimeline={hasLiveTimeline}
        transcriptSearch={transcriptSearch}
        setTranscriptSearch={setTranscriptSearch}
        transcriptFilters={transcriptFilters}
        setTranscriptFilters={setTranscriptFilters}
        bookmarksOnly={bookmarksOnly}
        bookmarkIds={bookmarkIds}
        setBookmarksOnly={setBookmarksOnly}
        renderedTimelineRows={renderedTimelineRows}
        hasTranscriptFocus={hasTranscriptFocus}
        timelineRows={timelineRows}
        viewMode={viewMode}
        streamHistoryItems={streamHistoryItems}
        timelineRef={timelineRef}
        timelineContentRef={timelineContentRef}
        handleJumpToMessage={handleJumpToMessage}
        stickyHeaders={stickyHeaders}
        stickyHeaderIndex={stickyHeaderIndex}
        timelineRowsRef={timelineRowsRef}
        handleTimelineScroll={handleTimelineScroll}
        showDiagnostics={showDiagnostics}
        runClaudeSessionAction={runClaudeSessionAction}
        claudeMcpBusy={claudeMcpBusy}
        diagnosticsLoading={diagnosticsLoading}
        diagnosticSections={diagnosticSections}
        addClaudeMcpServer={addClaudeMcpServer}
        claudeHookQuery={claudeHookQuery}
        setClaudeHookQuery={setClaudeHookQuery}
        searchClaudeHookEvents={searchClaudeHookEvents}
        claudeHookSearching={claudeHookSearching}
        claudeMcpPermissionModes={claudeMcpPermissionModes}
        applyClaudeMcpPermissionMode={applyClaudeMcpPermissionMode}
        composerConfig={composerConfig}
        colorTreatment={colorTreatment}
        handleReusePrompt={handleReusePrompt}
        hasTranscriptTimeline={hasTranscriptTimeline}
        timelineRenderedHeight={timelineRenderedHeight}
        timelineWidth={timelineWidth}
        density={density}
        onOpenSession={onOpenSession}
        turnDurations={turnDurations}
        handleQuestionAnswerToComposer={handleQuestionAnswerToComposer}
        handleDiffCommentToComposer={handleDiffCommentToComposer}
        liveSubagentText={liveSubagentText}
        taskActiveForms={taskActiveForms}
        timelineRowElements={timelineRowElements}
        autoFollow={autoFollow}
        setAutoFollow={setAutoFollow}
        scrollTimelineToBottom={scrollTimelineToBottom}
        taskRailOpen={taskRailOpen}
        taskRegistry={taskRegistry}
        setTaskRailOpen={setTaskRailOpen}
        stopClaudeTask={stopClaudeTask}
      />

      {/* ── Message input (single session only) ──────── */}
      <CollapsedComposerBar
        isProject={isProject}
        composerCollapsed={composerCollapsed}
        setComposerCollapsed={setComposerCollapsed}
      />
      <ComposerShell
        isProject={isProject}
        composerCollapsed={composerCollapsed}
        handleComposerDragEnter={handleComposerDragEnter}
        handleComposerDragOver={handleComposerDragOver}
        handleComposerDragLeave={handleComposerDragLeave}
        handleComposerDrop={handleComposerDrop}
        timelineWidth={timelineWidth}
        viewMode={viewMode}
        composerDropActive={composerDropActive}
        setComposerCollapsed={setComposerCollapsed}
        modelsPending={modelsPending}
        sendError={sendError}
        sessionActionError={sessionActionError}
        sessionActionNotice={sessionActionNotice}
        session={session}
        codexExternalWriter={codexExternalWriter}
        failedSend={failedSend}
        restoreFailedSend={restoreFailedSend}
        sendBusy={sendBusy}
        livePromptSuggestion={livePromptSuggestion}
        sendState={sendState}
        setInputText={setInputText}
        inputTextRef={inputTextRef}
        setLivePromptSuggestion={setLivePromptSuggestion}
        textareaRef={textareaRef}
        resizeComposer={resizeComposer}
        colorTreatment={colorTreatment}
        teammatesTab={teammatesTab}
        composerTab={composerTab}
        setComposerDock={setComposerDock}
        teamAttention={teamAttention}
        activeProvider={activeProvider}
        selectedModelValue={selectedModelValue}
        commitClaudeModelSelection={commitClaudeModelSelection}
        modelOptions={modelOptions}
        effortOptions={effortOptions}
        selectedEffort={selectedEffort}
        setSelectedEffort={setSelectedEffort}
        selectedCopilotContextTier={selectedCopilotContextTier}
        setSelectedCopilotContextTier={setSelectedCopilotContextTier}
        selectedModelInfo={selectedModelInfo}
        composerAgentOptions={composerAgentOptions}
        selectedAgent={selectedAgent}
        setSelectedAgent={setSelectedAgent}
        composerModeOptions={composerModeOptions}
        selectedCopilotMode={selectedCopilotMode}
        commitCopilotModeSelection={commitCopilotModeSelection}
        selectedPermissionMode={selectedPermissionMode}
        commitClaudePermissionSelection={commitClaudePermissionSelection}
        selectedCodexApproval={selectedCodexApproval}
        setSelectedCodexApproval={setSelectedCodexApproval}
        taskBudgetTokens={taskBudgetTokens}
        setTaskBudgetTokens={setTaskBudgetTokens}
        enableWorkflow={enableWorkflow}
        setEnableWorkflow={setEnableWorkflow}
        sessionCapabilities={sessionCapabilities}
        rewindCandidates={rewindCandidates}
        rewindTargetId={rewindTargetId}
        setRewindTargetId={setRewindTargetId}
        handleRewind={handleRewind}
        previewingRewind={previewingRewind}
        applyingRewind={applyingRewind}
        rollbackCandidates={rollbackCandidates}
        rollbackTurns={rollbackTurns}
        setRollbackTurns={setRollbackTurns}
        handleRollbackPreview={handleRollbackPreview}
        resumeFromMessageId={resumeFromMessageId}
        setResumeFromMessageId={setResumeFromMessageId}
        pendingPermissions={pendingPermissions}
        sessionActionLoading={sessionActionLoading}
        respondToQuestion={respondToQuestion}
        respondToPermission={respondToPermission}
        respondToPlan={respondToPlan}
        attachmentPanelOpen={attachmentPanelOpen}
        attachments={attachments}
        attachmentType={attachmentType}
        setAttachmentType={setAttachmentType}
        attachmentPath={attachmentPath}
        setAttachmentPath={setAttachmentPath}
        addAttachment={addAttachment}
        inputText={inputText}
        removeAttachment={removeAttachment}
        activeQueuedSends={activeQueuedSends}
        composerQueueDurability={composerQueueDurability}
        editQueuedSend={editQueuedSend}
        removeQueuedSend={removeQueuedSend}
        mentionQuery={mentionQuery}
        mentionResults={mentionResults}
        composerConfig={composerConfig}
        mentionActiveIndex={mentionActiveIndex}
        mentionItemRefs={mentionItemRefs}
        insertMention={insertMention}
        setMentionActiveIndex={setMentionActiveIndex}
        slashOpen={slashOpen}
        slashCommands={slashCommands}
        slashActiveIndex={slashActiveIndex}
        slashItemRefs={slashItemRefs}
        insertSlashCommand={insertSlashCommand}
        setSlashActiveIndex={setSlashActiveIndex}
        composerDraftKey={composerDraftKey}
        loadedComposerDraftKey={loadedComposerDraftKey}
        setAttachments={setAttachments}
        prewarmComposer={prewarmComposer}
        historyIndex={historyIndex}
        sentHistory={sentHistory}
        setHistoryIndex={setHistoryIndex}
        draftBeforeHistoryRef={draftBeforeHistoryRef}
        setSendError={setSendError}
        setSendState={setSendState}
        updateComposerHints={updateComposerHints}
        setMentionQuery={setMentionQuery}
        setSlashOpen={setSlashOpen}
        isComposingRef={isComposingRef}
        handleKeyDown={handleKeyDown}
        handleComposerPaste={handleComposerPaste}
        composerPlaceholder={composerPlaceholder}
        canUseChannelBridge={canUseChannelBridge}
        channelBridge={channelBridge}
        composerQueueTargetKey={composerQueueTargetKey}
        setAttachmentPanelOpen={setAttachmentPanelOpen}
        setPromptLibraryOpen={setPromptLibraryOpen}
        promptLibraryOpen={promptLibraryOpen}
        insertPromptText={insertPromptText}
        setChannelBridgeOpen={setChannelBridgeOpen}
        channelBridgeOpen={channelBridgeOpen}
        canUseIdeBridge={canUseIdeBridge}
        setIdeBridgeOpen={setIdeBridgeOpen}
        ideBridge={ideBridge}
        ideBridgeOpen={ideBridgeOpen}
        handleDiffCommentToComposer={handleDiffCommentToComposer}
        contextUsage={contextUsage}
        reattachedRunning={reattachedRunning}
        sendMessage={sendMessage}
        canSubmitMessage={canSubmitMessage}
        activeToolCount={activeToolCount}
        backgroundClaudeTasks={backgroundClaudeTasks}
        backgroundingTasks={backgroundingTasks}
        cancelSend={cancelSend}
        awaitingPersistedTurn={awaitingPersistedTurn}
        composerStatusColor={composerStatusColor}
        composerRuntime={composerRuntime}
        composerStatusDetail={composerStatusDetail}
        composerStatus={composerStatus}
        composerGitBranch={composerGitBranch}
        setBranchSwitcherOpen={setBranchSwitcherOpen}
        composerWorkingDirectory={composerWorkingDirectory}
        branchSwitcherOpen={branchSwitcherOpen}
        onOpenGit={onOpenGit}
        composerGitTitle={composerGitTitle}
        composerGitSummary={composerGitSummary}
        composerGitHasDetails={composerGitHasDetails}
        handleComposerBranchSwitched={handleComposerBranchSwitched}
        teammatesServices={teammatesServices}
        returnToChat={returnToChat}
        rewindPreview={rewindPreview}
        handleApplyRewind={handleApplyRewind}
        setRewindPreview={setRewindPreview}
        rollbackPreview={rollbackPreview}
        handleApplyRollback={handleApplyRollback}
        setRollbackPreview={setRollbackPreview}
      />
      {pluginOverlay && session ? (
        <PluginSurfaceHost
          surfaceId={pluginOverlay}
          placement="overlay"
          sessionKey={sessionIdentityKey(session)}
          services={{ 'session-transcript': { info: sessionInfo, threadedMessages: threadedFull, rawMessages: messages } }}
          onClose={() => setPluginOverlay(null)}
        />
      ) : null}
    </div>
  )
}

// Default comparison keeps parent (page) re-renders that don't touch any
// transcript-related prop from re-executing this ~10k-line tree. The page
// re-renders every 5s session list poll (openTabSessions map + selectedProject
// rebind) and on unrelated dashboard state; without memo that re-executed the
// entire component (threading, row layout, all hooks, the whole JSX tree) for
// nothing. Props are referentially stable across idle polls (see
// mergeMessages' identity bail-out in page.tsx and the threaded cache below),
// so a stable-compare memo succeeds on every idle tick.
const MemoMessageViewInner = memo(MessageViewInner)
const CoordinatorInspector = dynamic(() => import('./CoordinatorInspector'))

function MessageViewShell(props: Props) {
  const owner = props.session ? sessionIdentityKey(props.session) : 'unselected'
  const [inspection, setInspection] = useState<{ owner: string; agent: ProtocolAgent } | null>(null)
  const inspect = useCallback((agent: ProtocolAgent) => setInspection({ owner, agent }), [owner])
  const close = useCallback(() => setInspection(null), [])
  const agent = inspection?.owner === owner ? inspection.agent : null
  if (props.hideCoordinator) return <MemoMessageViewInner {...props} />
  return <div className="av-coord-reader-layout">
    <div className="av-coord-lead-reader"><MemoMessageViewInner {...props} onInspectTeammate={inspect} /></div>
    {agent ? <div className="av-coord-teammate-reader"><CoordinatorInspector key={agent.sessionId} agent={agent} onClose={close} /></div> : null}
  </div>
}
const MessageView = memo(MessageViewShell)
export default MessageView
