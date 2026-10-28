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
import { runHandleExport, runHandleRewind, runHandleRollbackPreview, runHandleApplyRewind, runHandleApplyRollback, runHandleForkFromMessage, runHandleDeleteSession, runRunSessionAction } from './message-view/actions/sessionActions'

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
  useEffect(() => {
    let cancelled = false
    composerQueueMountedRef.current = true
    const store = getWebComposerQueueStore()
    const sync = store.hydrateSync()
    queuedSendsRef.current = sync.entries
    setQueuedSends(sync.entries)
    setComposerQueueDurability(sync.durability)
    void store.hydrateAsync().then((restored) => {
      if (cancelled) return
      if (restored) {
        queuedSendsRef.current = restored.entries
        setQueuedSends(restored.entries)
        setComposerQueueDurability(restored.durability)
      }
      setComposerQueueStorageReady(true)
    })
    return () => {
      cancelled = true
      composerQueueMountedRef.current = false
    }
  }, [])
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
  useEffect(() => {
    const storedViewMode = readLocalStorageValue('agentViewer:viewMode')
    setShowVisualizer(readLocalStorageValue('agentViewer:messageVisualizer') === 'true')
    setShowReviewMode(readLocalStorageValue('agentViewer:diffReviewMode') === 'true')
    if (storedViewMode === 'full' || storedViewMode === 'continue' || storedViewMode === 'stream' || storedViewMode === 'agents') {
      setViewMode(storedViewMode)
    } else if (readLocalStorageValue('agentViewer:showTools') === 'false') {
      setViewMode('continue')
    }
    const storedDensity = readLocalStorageValue('agentViewer:density')
    if (storedDensity === 'comfortable' || storedDensity === 'dense') setDensity(storedDensity)
    setTimelineWidth(readLocalStorageValue('agentViewer:timelineWidth') === 'full' ? 'full' : 'centered')
    setStickyHeaders(readLocalStorageValue('agentViewer:stickyHeaders') === 'true')
    setDiffStyle(readLocalStorageValue('agentViewer:diffStyle') === 'split' ? 'split' : 'stacked')
    const changeStyle = readLocalStorageValue('agentViewer:diffChangeStyle')
    const inlineDiffStyle = readLocalStorageValue('agentViewer:diffInlineStyle')
    const showBackgrounds = readLocalStorageValue('agentViewer:diffShowBackgrounds')
    const wrap = readLocalStorageValue('agentViewer:diffWrap')
    const showLineNumbers = readLocalStorageValue('agentViewer:diffShowLineNumbers')
    const showHunkHeaders = readLocalStorageValue('agentViewer:diffShowHunkHeaders')
    setDiffOptions({
      changeStyle: changeStyle === 'bars' || changeStyle === 'classic' || changeStyle === 'none' ? changeStyle : DEFAULT_DIFF_OPTIONS.changeStyle,
      inlineDiffStyle: inlineDiffStyle === 'word-alt' || inlineDiffStyle === 'word' || inlineDiffStyle === 'char' || inlineDiffStyle === 'none' ? inlineDiffStyle : DEFAULT_DIFF_OPTIONS.inlineDiffStyle,
      showBackgrounds: showBackgrounds === null ? DEFAULT_DIFF_OPTIONS.showBackgrounds : showBackgrounds === 'true',
      wrap: wrap === null ? DEFAULT_DIFF_OPTIONS.wrap : wrap === 'true',
      showLineNumbers: showLineNumbers === null ? DEFAULT_DIFF_OPTIONS.showLineNumbers : showLineNumbers === 'true',
      showHunkHeaders: showHunkHeaders === null ? DEFAULT_DIFF_OPTIONS.showHunkHeaders : showHunkHeaders === 'true',
    })
    setComposerCollapsed(readLocalStorageValue('agentViewer:composerCollapsed') === 'true')
    setPreferencesHydrated(true)
  }, [])
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
  const [liveAssistantText, setLiveAssistantText] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveAssistantText', '')
  // Reasoning/thinking streams on its own channel so it renders as a distinct
  // dim block above the answer (like the native CLIs) instead of being folded
  // into the reply text.
  const [liveReasoningText, setLiveReasoningText] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveReasoningText', '')
  // Live estimate of thinking tokens for the current turn, streamed by the SDK
  // as `thinking_tokens` system messages. Surfaced on the THINKING preview only.
  const [liveThinkingTokens, setLiveThinkingTokens] = useComposerSessionState(composerSessions, composerOwnerKey, 'liveThinkingTokens', 0)
  const [liveToolActivities, setLiveToolActivities] = useComposerSessionState<LiveToolActivity[]>(composerSessions, composerOwnerKey, 'liveToolActivities', [])
  const [liveThreadedMessages, setLiveThreadedMessages] = useComposerSessionState<ThreadedMessage[]>(composerSessions, composerOwnerKey, 'liveThreadedMessages', [])
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useComposerSessionState(composerSessions, composerOwnerKey, 'awaitingPersistedTurn', false)
  const [autoFollow, setAutoFollow] = useState(false)
  // Approximate: may trail the live node.scrollTop by up to
  // TIMELINE_SCROLL_COMMIT_PX during user scrolls (see
  // commitTimelineScrollTopIfDrifted). Consumers needing the exact position
  // must read timelineRef.current.scrollTop.
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  // Last scrollTop actually committed to state. All commits flow through
  // commitTimelineScrollTop so quantized paths (RAF scroll handler, streaming
  // pin) can measure their drift against it. See TIMELINE_SCROLL_COMMIT_PX.
  const committedScrollTopRef = useRef(0)
  const commitTimelineScrollTop = useCallback((value: number) => {
    committedScrollTopRef.current = value
    setTimelineScrollTop(value)
  }, [])
  // Quantized commit for high-frequency paths (RAF scroll handler, streaming
  // pin): only re-render when the position has drifted far enough to matter
  // for the virtual window, which overscans well beyond the threshold.
  const commitTimelineScrollTopIfDrifted = useCallback((value: number) => {
    if (Math.abs(value - committedScrollTopRef.current) >= TIMELINE_SCROLL_COMMIT_PX) {
      commitTimelineScrollTop(value)
    }
  }, [commitTimelineScrollTop])
  // Fast-scroll mode: while the gesture outruns FAST_SCROLL_ENTER_PX_PER_S,
  // rows entering the window render as placeholders. See the constant's doc.
  const [fastScrolling, setFastScrolling] = useState(false)
  const fastScrollingRef = useRef(false)
  const scrollVelocitySampleRef = useRef<{ top: number; time: number } | null>(null)
  const setFastScrollingMode = useCallback((value: boolean) => {
    if (fastScrollingRef.current === value) return
    fastScrollingRef.current = value
    setFastScrolling(value)
  }, [])
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0)
  const [timelineHeightOverride, setTimelineHeightOverride] = useState<number | null>(null)
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  // Bumps only when a PERSISTED row's measured height changes (or rows reset),
  // never on live-row height growth. Keys the persisted base layout so a
  // streaming turn doesn't rebuild the whole transcript layout each frame.
  const [persistedMeasurementVersion, setPersistedMeasurementVersion] = useState(0)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<string[]>(readPersistedSentHistory)
  const sentHistoryRef = useRef(sentHistory)
  useLayoutEffect(() => {
    sentHistoryRef.current = sentHistory
  }, [sentHistory])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef<{ text: string; cursorPos: number }>({ text: '', cursorPos: 0 })
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([])
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const mentionAbortRef = useRef<AbortController | null>(null)
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const [channelBridgeOpen, setChannelBridgeOpen] = useState(false)
  const canUseChannelBridge = !projectView && !!session && (session.provider ?? 'claude') === 'claude'
  const channelBridge = useChannelBridge({
    open: channelBridgeOpen,
    available: canUseChannelBridge,
    sessionId: session?.sessionId,
  })
  const handledChannelBridgeOpenRequestRef = useRef(channelBridgeOpenRequest)
  const handledChannelBridgeRouteRequestRef = useRef(channelBridgeRouteToggleRequest)
  // Read the latest bridge controller from inside sendMessage without widening
  // its (already large) dependency array.
  const channelBridgeRef = useRef(channelBridge)
  useLayoutEffect(() => {
    channelBridgeRef.current = channelBridge
  }, [channelBridge])
  // IDE bridge — the third Claude composer flow (agentViewer hosts an IDE
  // endpoint an external `claude` connects to; see channels/agentviewer-ide.ts).
  // Shares the Claude-only availability gate with the channel bridge.
  const [ideBridgeOpen, setIdeBridgeOpen] = useState(false)
  const canUseIdeBridge = !projectView && !!session && (session.provider ?? 'claude') === 'claude'
  const ideBridge = useIdeBridge({ open: ideBridgeOpen, available: canUseIdeBridge })
  const handledIdeBridgeOpenRequestRef = useRef(ideBridgeOpenRequest)
  const handledIdeBridgeRouteRequestRef = useRef(ideBridgeRouteToggleRequest)
  const ideBridgeRef = useRef(ideBridge)
  useLayoutEffect(() => {
    ideBridgeRef.current = ideBridge
  }, [ideBridge])
  // Track bridge entries (sent + replies) with timestamps for inline transcript display
  const [bridgeTranscriptEntries, setBridgeTranscriptEntries] = useState<
    Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }>
  >([])
  const persistedBridgeCountRef = useRef(0)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [liveSlashCommands, setLiveSlashCommands] = useState<SlashCommandSuggestion[]>([])
  const textareaRef = composerSessions.ref<ContextComposerHandle | null>(composerOwnerKey, 'textareaRef', null)
  const composerPrewarmInFlightRef = useRef(new Set<string>())
  const isComposingRef = useRef(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const lastTimelineRowRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = composerSessions.ref<AbortController | null>(composerOwnerKey, 'abortControllerRef', null)
  const activeTurnRequestIdRef = composerSessions.ref<string | null>(composerOwnerKey, 'activeTurnRequestIdRef', null)
  const inputTextRef = composerSessions.ref(composerOwnerKey, 'inputTextRef', inputText)
  const suppressDraftSaveRef = useRef(false)
  const sendInFlightRef = composerSessions.ref(composerOwnerKey, 'sendInFlightRef', false)
  const awaitingPersistedTurnRef = composerSessions.ref(composerOwnerKey, 'awaitingPersistedTurnRef', false)
  const pushedCopilotAttachmentsRef = composerSessions.ref<SendAttachment[]>(composerOwnerKey, 'pushedCopilotAttachmentsRef', [])
  // Transient auto-retry bookkeeping. turnProducedOutputRef gates retries to
  // turns that streamed nothing yet (so a retry can't duplicate work);
  // transientRetryCountRef counts attempts within one logical send;
  // transientRetryTimerRef holds the pending backoff so cancel can clear it.
  const turnProducedOutputRef = composerSessions.ref(composerOwnerKey, 'turnProducedOutputRef', false)
  const transientRetryCountRef = composerSessions.ref(composerOwnerKey, 'transientRetryCountRef', 0)
  const transientRetryTimerRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'transientRetryTimerRef', null)
  // Set when a send was blocked because the model list hadn't resolved yet
  // (see the modelsLoading guard in sendMessage). The composer draft is left
  // untouched in that case — this just re-fires the send once the fetch
  // settles, so a cold custom-model connection reads as "sending" rather than
  // making the user notice the error and hit enter again.
  const pendingSendOnModelsReadyRef = composerSessions.ref<string | null>(composerOwnerKey, 'pendingSendOnModelsReadyRef', null)
  const pendingMessageBaselineRef = composerSessions.ref<PendingMessageBaseline | null>(composerOwnerKey, 'pendingMessageBaselineRef', null)
  const liveTurnSessionHandoffRef = composerSessions.ref<string | null>(composerOwnerKey, 'liveTurnSessionHandoffRef', null)
  const liveAssistantTextRef = composerSessions.ref(composerOwnerKey, 'liveAssistantTextRef', '')
  const pendingLiveAssistantTextRef = composerSessions.ref<string | null>(composerOwnerKey, 'pendingLiveAssistantTextRef', null)
  const liveAssistantFlushFrameRef = composerSessions.ref<number | null>(composerOwnerKey, 'liveAssistantFlushFrameRef', null)
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
  const scrollRafRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef<number>(0)
  const wheelScrollCompensationUntilRef = useRef<number>(0)
  const timelineHeightOverrideRef = useRef<number | null>(null)
  const activeTimelineScrollAnchorRef = useRef<TimelineScrollAnchor | null>(null)
  const pendingTimelineAnchorRestoreRef = useRef(false)
  // Set true on each scroll event, cleared SCROLL_IDLE_MS after the last
  // event. Direct scrollbar/touch scrubbing suppresses scrollTop adjustment;
  // wheel/trackpad input opts back in via wheelScrollCompensationUntilRef.
  const userScrollingRef = useRef(false)
  const userScrollingTimerRef = useRef<number | null>(null)
  const suppressFollowEvalUntilRef = useRef<number>(0)
  const autoFollowRef = useRef(false)
  const timelineRowsRef = useRef<TimelineRow[]>([])
  const handledTargetMessageRequestRef = useRef(0)
  const initialScrollDoneRef = useRef(false)
  const sessionCapabilities = sessionInfo?.capabilities ?? session?.capabilities
  const assistantName = assistantDisplayName(sessionInfo?.provider ?? session?.provider)
  const activeProvider = sessionInfo?.provider ?? session?.provider
  const cliCommand = useMemo(() => {
    if (!session) return null
    return getContinueInCliCommand(
      activeProvider ?? 'claude',
      session.sessionId,
      sessionInfo?.cwd ?? session.cwd,
    )
  }, [session, activeProvider, sessionInfo])
  const modelOptions = useMemo(() => {
    const filtered = availableModels.filter((model) => normalizeSelectValue(model.value))
    if (filtered.length > 0) return filtered

    const fallbackValue = normalizeSelectValue(selectedModel)
    return fallbackValue ? [{ value: fallbackValue, displayName: fallbackValue, description: '' }] : []
  }, [availableModels, selectedModel])
  const selectedModelValue = normalizeSelectValue(selectedModel)
  const selectedModelInfo = useMemo(
    () => modelOptions.find((model) => model.value === selectedModelValue) ?? null,
    [modelOptions, selectedModelValue],
  )
  const composerAgentOptions = useMemo(
    () => composerOptions.agents?.filter((agent) => normalizeSelectValue(agent.value)) ?? [],
    [composerOptions.agents],
  )
  const composerMentionAgentOptions = useMemo(
    () => composerOptions.mentionAgents?.filter((agent) => normalizeSelectValue(agent.value)) ?? [],
    [composerOptions.mentionAgents],
  )
  const composerModeOptions = useMemo(
    () => composerOptions.modes?.filter((mode) => normalizeSelectValue(mode.value)) ?? [],
    [composerOptions.modes],
  )
  const effortOptions = useMemo<ReasoningEffortLevel[]>(() => {
    if (!selectedModelInfo?.supportsEffort) return []
    if (activeProvider === 'opencode') return []
    const levels = selectedModelInfo.supportedEffortLevels?.filter((level) => {
      if (activeProvider === 'codex') return level === 'low' || level === 'medium' || level === 'high'
      if (activeProvider === 'copilot') return level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh'
      if (activeProvider === 'claude') return level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max'
      if (activeProvider === 'pi') return level === 'off' || level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max'
      return false
    }) ?? []
    if (levels.length > 0) return levels
    if (activeProvider === 'pi') return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    if (activeProvider === 'codex') return ['low', 'medium', 'high']
    return ['low', 'medium', 'high']
  }, [activeProvider, selectedModelInfo])
  const [loadedComposerDraftKey, setLoadedComposerDraftKey] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'loadedComposerDraftKey', null)
  const attachmentReadsRef = useRef(0)
  const composerDraftKey = useMemo(() => composerDraftStorageKey(session), [session])

  useEffect(() => {
    inputTextRef.current = inputText
  }, [inputText])

  useEffect(() => {
    awaitingPersistedTurnRef.current = awaitingPersistedTurn
  }, [awaitingPersistedTurn])

  const flushLiveAssistantText = useCallback(() => {
    liveAssistantFlushFrameRef.current = null
    const nextText = pendingLiveAssistantTextRef.current
    if (nextText != null) {
      pendingLiveAssistantTextRef.current = null
      setLiveAssistantText(nextText)
    }
    const nextReasoning = pendingLiveReasoningTextRef.current
    if (nextReasoning != null) {
      pendingLiveReasoningTextRef.current = null
      setLiveReasoningText(nextReasoning)
    }
  }, [pendingLiveAssistantTextRef, liveAssistantFlushFrameRef, pendingLiveReasoningTextRef, setLiveAssistantText, setLiveReasoningText])

  const flushLiveAssistantTextNow = useCallback(() => {
    if (liveAssistantFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveAssistantFlushFrameRef.current)
      liveAssistantFlushFrameRef.current = null
    }
    flushLiveAssistantText()
  }, [flushLiveAssistantText, liveAssistantFlushFrameRef])

  const clearLiveAssistantText = useCallback(() => {
    if (liveAssistantFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveAssistantFlushFrameRef.current)
      liveAssistantFlushFrameRef.current = null
    }
    liveAssistantTextRef.current = ''
    pendingLiveAssistantTextRef.current = null
    setLiveAssistantText('')
    liveReasoningTextRef.current = ''
    pendingLiveReasoningTextRef.current = null
    setLiveReasoningText('')
    setLiveThinkingTokens(0)
  }, [liveAssistantTextRef, pendingLiveAssistantTextRef, liveAssistantFlushFrameRef, liveReasoningTextRef, pendingLiveReasoningTextRef, setLiveAssistantText, setLiveReasoningText, setLiveThinkingTokens])

  const queueLiveAssistantText = useCallback((deltaText: string, replace: boolean) => {
    const nextText = replace ? deltaText : `${liveAssistantTextRef.current}${deltaText}`
    liveAssistantTextRef.current = nextText
    pendingLiveAssistantTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText, liveAssistantTextRef, pendingLiveAssistantTextRef, liveAssistantFlushFrameRef])

  // Reasoning is always append-only (no replace semantics like the codex
  // realtime answer transcript), and piggybacks on the assistant flush frame.
  const queueLiveReasoningText = useCallback((deltaText: string) => {
    const nextText = `${liveReasoningTextRef.current}${deltaText}`
    liveReasoningTextRef.current = nextText
    pendingLiveReasoningTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText, liveAssistantFlushFrameRef, liveReasoningTextRef, pendingLiveReasoningTextRef])

  const flushLiveSubagentText = useCallback(() => {
    liveSubagentFlushFrameRef.current = null
    // Snapshot the ref into a fresh object so context consumers see one new
    // identity per frame; the ref keeps mutating in place between flushes.
    setLiveSubagentText({ ...liveSubagentTextRef.current })
  }, [liveSubagentTextRef, liveSubagentFlushFrameRef, setLiveSubagentText])

  const scheduleLiveSubagentFlush = useCallback(() => {
    if (liveSubagentFlushFrameRef.current == null) {
      liveSubagentFlushFrameRef.current = window.requestAnimationFrame(flushLiveSubagentText)
    }
  }, [flushLiveSubagentText, liveSubagentFlushFrameRef])

  const queueLiveSubagentDelta = useCallback((parentId: string, delta: string) => {
    const map = liveSubagentTextRef.current
    map[parentId] = (map[parentId] ?? '') + delta
    scheduleLiveSubagentFlush()
  }, [scheduleLiveSubagentFlush, liveSubagentTextRef])

  const removeLiveSubagentEntry = useCallback((parentId: string) => {
    const map = liveSubagentTextRef.current
    if (!(parentId in map)) return
    delete map[parentId]
    scheduleLiveSubagentFlush()
  }, [scheduleLiveSubagentFlush, liveSubagentTextRef])

  const clearLiveSubagentText = useCallback(() => {
    if (liveSubagentFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveSubagentFlushFrameRef.current)
      liveSubagentFlushFrameRef.current = null
    }
    liveSubagentTextRef.current = {}
    setLiveSubagentText({})
  }, [liveSubagentTextRef, liveSubagentFlushFrameRef, setLiveSubagentText])

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

  useEffect(() => {
    if (!composerWorkingDirectory) {
      setComposerGitSummary(null)
      return
    }

    let cancelled = false
    let timer: number | null = null
    const controller = new AbortController()
    setComposerGitSummary(null)

    const refresh = async () => {
      try {
        const response = await fetch(`/api/git?action=summary&cwd=${encodeURIComponent(composerWorkingDirectory)}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await readJsonResponse(response) as { summary?: GitSummary | null }
        if (!cancelled) {
          const next = data.summary ?? null
          setComposerGitSummary((current) => gitSummariesMatch(current, next) ? current : next)
        }
      } catch {
        // Best-effort: session metadata remains the branch fallback.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => { void refresh() }, COMPOSER_GIT_SUMMARY_POLL_MS)
      }
    }

    void refresh()
    return () => {
      cancelled = true
      controller.abort()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [composerWorkingDirectory])

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

  // Build the metadata stored alongside a bookmark so the global browser can
  // render a useful row (title, snippet, role) without re-reading the session.
  const buildBookmarkMeta = useCallback((uuid: string) => {
    const row = timelineRowsRef.current.find((candidate) => candidate.message.uuid === uuid)
    const preview = row ? messageToCopyText(row.message).replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    const sessionTitle = sessionInfo?.customTitle || sessionInfo?.summary || session?.customTitle || session?.summary || session?.firstPrompt
    return {
      role: row?.message.role,
      label: row?.message.role === 'user' ? 'user' : 'assistant',
      preview: preview || undefined,
      sessionTitle: sessionTitle || undefined,
      messageTimestamp: row?.message.timestamp,
    }
  }, [session?.customTitle, session?.summary, session?.firstPrompt, sessionInfo?.customTitle, sessionInfo?.summary])

  const toggleBookmark = useCallback((uuid: string) => {
    if (!session) return
    const next = !bookmarkIdsRef.current.has(uuid)
    setBookmarkIds((prev) => {
      const updated = new Set(prev)
      if (next) updated.add(uuid)
      else updated.delete(uuid)
      return updated
    })
    const meta = next ? buildBookmarkMeta(uuid) : undefined
    fetch(`/api/sessions/${session.sessionId}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: session.provider, providerInstanceId: session.providerInstanceId, uuid, bookmarked: next, meta }),
    })
      .then(readJsonResponse)
      .then((data) => {
        if (Array.isArray(data?.ids)) setBookmarkIds(new Set(data.ids as string[]))
      })
      .catch(() => {
        // Revert the optimistic update on failure.
        setBookmarkIds((prev) => {
          const updated = new Set(prev)
          if (next) updated.delete(uuid)
          else updated.add(uuid)
          return updated
        })
      })
  }, [session, buildBookmarkMeta])

  // Fetches the live model list + current model from the active provider.
  // Used both on session change and after each turn — `/model X` slashes
  // change the SDK's current model and the dropdown should follow.
  const modelSessionId = session?.sessionId
  const modelSessionProvider = session?.provider
  const modelSessionProviderInstanceId = session?.providerInstanceId
  const refreshSessionModels = useCallback(({ preserveSelection }: { preserveSelection: boolean }) => {
    if (!modelSessionId) return
    setModelsLoading(true)
    fetch(withProviderQuery(`/api/sessions/${modelSessionId}/models`, modelSessionProvider, modelSessionProviderInstanceId))
      .then(readJsonResponse)
      .then(data => {
        if (data.error) return
        const nextModels = Array.isArray(data.models) ? data.models.filter((model: SessionModelInfo) => normalizeSelectValue(model.value)) : []
        setAvailableModels(nextModels)
        const live = normalizeSelectValue(data.currentModel)
        // Only a reported tier is a known tier; anything else leaves whatever
        // the user (or an earlier warm read) already established.
        if (data.currentContextTier === 'long_context' || data.currentContextTier === 'default') {
          setSelectedCopilotContextTier(data.currentContextTier)
        }
        setSelectedModel((prev) => {
          if (preserveSelection && prev && nextModels.some((m: SessionModelInfo) => normalizeSelectValue(m.value) === normalizeSelectValue(prev))) {
            // Keep user's pick if it is still valid; otherwise fall back.
            if (live && live !== normalizeSelectValue(prev)) return live
            return prev
          }
          return live ?? normalizeSelectValue(nextModels[0]?.value) ?? ''
        })
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false))
  }, [modelSessionId, modelSessionProvider, modelSessionProviderInstanceId, setAvailableModels, setModelsLoading, setSelectedModel, setSelectedCopilotContextTier])

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

  useEffect(() => {
    if (!session) {
      setComposerOptions({})
      setSelectedAgent('')
      setSelectedCopilotMode('interactive')
      return
    }

    const controller = new AbortController()
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}/composer`, session.provider, session.providerInstanceId), { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data: SessionComposerOptions | null) => {
        if (controller.signal.aborted || !data) return
        setComposerOptions(data)
        if (session.provider === 'opencode') {
          const agents = data.agents ?? []
          const current = normalizeSelectValue(data.currentAgent)
          setSelectedAgent(
            current && agents.some((agent) => normalizeSelectValue(agent.value) === current)
              ? current
              : normalizeSelectValue(agents[0]?.value) ?? '',
          )
        } else {
          setSelectedAgent('')
        }
        if (session.provider === 'copilot') {
          const modes = data.modes ?? []
          const current = normalizeSelectValue(data.currentMode) ?? 'interactive'
          setSelectedCopilotMode(
            modes.some((mode) => normalizeSelectValue(mode.value) === current)
              ? current
              : normalizeSelectValue(modes[0]?.value) ?? 'interactive',
          )
        } else {
          setSelectedCopilotMode('interactive')
        }
      })
      .catch(() => { /* ignore; provider defaults still apply on send */ })
    return () => controller.abort()
  }, [session?.provider, session?.sessionId])

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
  useEffect(() => {
    const handoffSessionId = liveTurnSessionHandoffRef.current
    if (
      handoffSessionId
      && session?.sessionId === handoffSessionId
      && (sendInFlightRef.current || awaitingPersistedTurnRef.current)
    ) {
      liveTurnSessionHandoffRef.current = null
      return
    }
    liveTurnSessionHandoffRef.current = null
    if (!sendInFlightRef.current && !awaitingPersistedTurnRef.current) {
      setContextUsage(null)
      setSessionActionError(null)
      setSessionActionNotice(null)
      setResumeFromMessageId(null)
      setRewindPreview(null)
      setRollbackPreview(null)
      setShowDiagnostics(false)
      setDiagnosticSections([])
      setAttachments([])
      setAttachmentPath('')
      setSelectedEffort('auto')
      setSelectedAgent('')
      setSelectedCopilotMode('interactive')
      setComposerOptions({})
      setPendingPermissions([])
      setOptimisticUserText(null)
      setSteeredUserTexts([])
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      clearLiveSubagentText()
      setAwaitingPersistedTurn(false)
      setSendState('idle')
      setSendError(null)
      setFailedSend(null)
    }
    setAutoFollow(false)
    commitTimelineScrollTop(0)
    setTimelineViewportHeight(0)
    rowHeightsRef.current.clear()
    timelineEstimateCalibrationRef.current.clear()
    timelineEstimateSamplesRef.current.clear()
    timelineEstimateCalibrationFrozenRef.current = false
    threadedCacheRef.current.clear()
    prevThreadingRef.current = null
    pendingRowMeasurementsRef.current.clear()
    pendingTimelineScrollCompensationRef.current = 0
    pendingMountedAnchorCaptureRef.current = false
    if (measurementFrameRef.current != null) {
      window.cancelAnimationFrame(measurementFrameRef.current)
      measurementFrameRef.current = null
    }
    timelineHeightOverrideRef.current = null
    wheelScrollCompensationUntilRef.current = 0
    activeTimelineScrollAnchorRef.current = null
    pendingTimelineAnchorRestoreRef.current = false
    setTimelineHeightOverride(null)
    setRowMeasurementVersion(0)
    setPersistedMeasurementVersion(0)
    if (!sendInFlightRef.current && !awaitingPersistedTurnRef.current) {
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
    }
    initialScrollDoneRef.current = false
  }, [clearLiveAssistantText, commitTimelineScrollTop, composerOwnerKey])

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

  useEffect(() => () => {
    for (const key of composerSessions.keys()) {
      composerSessions.peekRef<AbortController | null>(key, 'abortControllerRef')?.current?.abort()
      const retry = composerSessions.peekRef<ReturnType<typeof setTimeout> | null>(key, 'transientRetryTimerRef')?.current
      if (retry) clearTimeout(retry)
      for (const name of ['liveAssistantFlushFrameRef', 'liveSubagentFlushFrameRef']) {
        const frame = composerSessions.peekRef<number | null>(key, name)?.current
        if (frame != null) window.cancelAnimationFrame(frame)
      }
    }
    if (measurementFrameRef.current != null) {
      window.cancelAnimationFrame(measurementFrameRef.current)
    }
    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current)
    }
    if (liveAssistantFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveAssistantFlushFrameRef.current)
    }
    if (liveSubagentFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveSubagentFlushFrameRef.current)
    }
    if (userScrollingTimerRef.current != null) {
      window.clearTimeout(userScrollingTimerRef.current)
    }
    pendingTimelineScrollCompensationRef.current = 0
    pendingMountedAnchorCaptureRef.current = false
    timelineHeightOverrideRef.current = null
    wheelScrollCompensationUntilRef.current = 0
    activeTimelineScrollAnchorRef.current = null
    pendingTimelineAnchorRestoreRef.current = false
  }, [])

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

  const markProgrammaticTimelineScroll = useCallback((duration = PROGRAMMATIC_SCROLL_SUPPRESSION_MS) => {
    programmaticScrollUntilRef.current = Math.max(programmaticScrollUntilRef.current, performance.now() + duration)
  }, [])

  const restoreTimelineScrollAnchor = useCallback(() => {
    const node = timelineRef.current
    const anchor = activeTimelineScrollAnchorRef.current
    activeTimelineScrollAnchorRef.current = null
    if (!node || !anchor) return

    const layout = rowLayoutRef.current
    const index = layout.indexByKey.get(anchor.key)
    if (index == null) return

    const maxScrollTop = Math.max(node.scrollHeight - node.clientHeight, 0)
    const targetTop = Math.max(0, Math.min(layout.tops[index] + anchor.offset, maxScrollTop))
    if (Math.abs(node.scrollTop - targetTop) < 1) return

    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    commitTimelineScrollTop(node.scrollTop)
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = timelineRef.current
    if (!node) return
    const targetTop = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
    commitTimelineScrollTop(targetTop)
    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll(behavior === 'smooth' ? 700 : undefined)
    node.scrollTo({ top: targetTop, behavior })
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  const toggleLiveFollow = useCallback(() => {
    const next = !autoFollow
    setAutoFollow(next)
    if (next) {
      window.requestAnimationFrame(() => scrollTimelineToBottom())
    }
  }, [autoFollow, scrollTimelineToBottom])

  const alignLastTimelineRowToViewportBottom = useCallback(() => {
    const node = timelineRef.current
    const lastRow = lastTimelineRowRef.current
    if (!node || !lastRow) return
    const nodeRect = node.getBoundingClientRect()
    const rowRect = lastRow.getBoundingClientRect()
    const targetTop = Math.max(node.scrollTop + (rowRect.bottom - nodeRect.bottom), 0)
    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    commitTimelineScrollTop(targetTop)
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  const handleTimelineScroll = useCallback(() => {
    const isProgrammaticScroll = performance.now() < programmaticScrollUntilRef.current
    if (!isProgrammaticScroll) {
      markTimelineUserScrolling()
      pendingMountedAnchorCaptureRef.current = true
    }
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      const node = timelineRef.current
      if (!node) return
      scheduleTimelineMeasurementFlushRef.current()
      const now = performance.now()
      if (now < programmaticScrollUntilRef.current) {
        // A programmatic jump teleports scrollTop; reset the sample so the
        // jump doesn't read as fling velocity on the next real scroll.
        scrollVelocitySampleRef.current = { top: node.scrollTop, time: now }
      } else {
        const sample = scrollVelocitySampleRef.current
        scrollVelocitySampleRef.current = { top: node.scrollTop, time: now }
        if (sample && now > sample.time) {
          const velocity = (Math.abs(node.scrollTop - sample.top) / (now - sample.time)) * 1000
          if (velocity >= FAST_SCROLL_ENTER_PX_PER_S) setFastScrollingMode(true)
          else if (velocity <= FAST_SCROLL_EXIT_PX_PER_S) setFastScrollingMode(false)
        }
      }
      // Quantized: re-render only once the window has meaningfully moved.
      // The exact resting position is committed by the scroll-idle timer in
      // markTimelineUserScrolling.
      commitTimelineScrollTopIfDrifted(node.scrollTop)
      if (now < suppressFollowEvalUntilRef.current) return
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setAutoFollow(distanceFromBottom <= TIMELINE_BOTTOM_GUTTER_PX + 16)
    })
  }, [commitTimelineScrollTopIfDrifted, markTimelineUserScrolling, setFastScrollingMode])

  const scrollMountedTimelineRowIntoView = useCallback((messageId: string): boolean => {
    const node = timelineRef.current
    if (!node) return false

    let rowNode: HTMLElement | null = null
    for (const candidate of Array.from(node.querySelectorAll<HTMLElement>('.timeline-row[data-message-id]'))) {
      if (candidate.dataset.messageId === messageId) {
        rowNode = candidate
        break
      }
    }
    if (!rowNode) return false

    const nodeRect = node.getBoundingClientRect()
    const rowRect = rowNode.getBoundingClientRect()
    const targetTop = Math.max(node.scrollTop + rowRect.top - nodeRect.top - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
    suppressFollowEvalUntilRef.current = performance.now() + 300
    autoFollowRef.current = false
    setAutoFollow(false)
    if (Math.abs(node.scrollTop - targetTop) > 1) {
      markProgrammaticTimelineScroll()
      node.scrollTop = targetTop
      commitTimelineScrollTop(targetTop)
    }
    return true
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  useLayoutEffect(() => {
    if (!awaitingPersistedTurn || !session) return

    const baseline = pendingMessageBaselineRef.current
    if (!baseline || baseline.sessionId !== session.sessionId) return

    const durableMessages = messages.filter(isDurableSessionMessage)
    const currentLastMessage = durableMessages.at(-1)
    const currentLastUuid = currentLastMessage?.uuid ?? null
    const currentLastFingerprint = sessionMessageFingerprint(currentLastMessage)
    const changedMessages = messagesChangedSinceBaseline(durableMessages, baseline)
    const persistedTurnArrived =
      changedMessages.length > 0
      || durableMessages.length !== baseline.count
      || currentLastUuid !== baseline.lastUuid
      || currentLastFingerprint !== baseline.lastFingerprint
    const persistedAssistantArrived = changedMessages.some((message) => message.type === 'assistant')
    const liveAssistantVisible = liveAssistantTextRef.current.trim().length > 0 || liveThreadedMessages.length > 0

    if (persistedTurnArrived && (persistedAssistantArrived || !liveAssistantVisible)) {
      setOptimisticUserText(null)
      setSteeredUserTexts([])
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      clearLiveSubagentText()
      awaitingPersistedTurnRef.current = false
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
      if (autoFollow) {
        window.requestAnimationFrame(() => scrollTimelineToBottom())
      }
    }
  }, [autoFollow, awaitingPersistedTurn, clearLiveAssistantText, liveAssistantText, liveThreadedMessages.length, messages, scrollTimelineToBottom, session])

  // Escape hatch for a persisted row that never lands. Without this, a lost or
  // badly delayed write leaves the composer stuck on "Syncing transcript…"
  // indefinitely (the reconcile effect above only resolves on arrival). After a
  // bounded wait we tear down the live overlay and reveal whatever the poll has.
  useEffect(() => {
    if (!awaitingPersistedTurn) return
    const timer = window.setTimeout(() => {
      setOptimisticUserText(null)
      setSteeredUserTexts([])
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      clearLiveSubagentText()
      awaitingPersistedTurnRef.current = false
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
    }, AWAITING_PERSISTED_TURN_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [awaitingPersistedTurn, clearLiveAssistantText, clearLiveSubagentText])

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
  useEffect(() => {
    if (!session || projectView) {
      setReattachedRunning(false)
      setRunningProbeReadyKey(null)
      return
    }
    const sessionId = session.sessionId
    const sessionProvider = session.provider ?? 'claude'
    const probeKey = `${sessionProvider}:${sessionId}`
    setRunningProbeReadyKey(null)
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      if (cancelled) return
      // We own a live turn already — the stream renders it; don't double-track.
      if (sendInFlightRef.current || awaitingPersistedTurnRef.current) {
        if (reattachedRunningRef.current) setReattachedRunning(false)
        timer = setTimeout(poll, REATTACH_POLL_MS)
        return
      }
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/running`, { cache: 'no-store' })
        if (!cancelled && res.ok) {
          const info = (await res.json().catch(() => null)) as
            | {
                running?: boolean
                pendingPrompts?: Record<string, unknown>[]
                pendingPermissions?: Record<string, unknown>[]
              }
            | null
          if (cancelled) return
          const running = info?.running === true
          setReattachedRunning((prev) => (prev === running ? prev : running))
          setRunningProbeReadyKey(probeKey)
          // Re-surface any provider-native approval/question the turn is
          // blocked on. The original SSE may be gone after reload/navigation,
          // but the process-local resolver remains answerable by id.
          const permissionPayloads = Array.isArray(info?.pendingPermissions)
            ? info.pendingPermissions
            : (Array.isArray(info?.pendingPrompts) ? info.pendingPrompts : []).map((data) => ({
                type: 'claude_permission',
                event: { type: 'permission.requested', data },
              }))
          const reattached = extractPendingPermissions(permissionPayloads, {
            sessionId,
            provider: sessionProvider,
          })
          setPendingPermissions((prev) => {
            const others = prev.filter((p) => !(p.provider === sessionProvider && p.sessionId === sessionId))
            const nextIds = [...others, ...reattached].map((p) => p.id).join('|')
            const prevIds = prev.map((p) => p.id).join('|')
            return nextIds === prevIds ? prev : [...others, ...reattached]
          })
        }
      } catch {
        // best-effort; a failed probe just leaves the prior state
      }
      if (!cancelled) timer = setTimeout(poll, REATTACH_POLL_MS)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [projectView, session?.provider, session?.sessionId])

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

  const backgroundClaudeTasks = useCallback(async () => {
    if (!session || session.provider !== 'claude' || session.isPending || backgroundingTasks) return
    setBackgroundingTasks(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'claude', action: 'backgroundTasks' }),
      })
      const data = await readOptionalJsonResponse(res, {})
      if (data.error) throw new Error(data.error)
      const backgrounded = data.result?.backgrounded === true
      setSessionActionNotice(backgrounded ? 'Claude task moved to background.' : 'No foreground Claude task to background.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to background Claude task')
    } finally {
      setBackgroundingTasks(false)
      textareaRef.current?.focus()
    }
  }, [backgroundingTasks, session, textareaRef])

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
  useEffect(() => {
    if (activeQueuedSends.length === 0) return
    if (!composerQueueStorageReady || runningProbeReadyKey !== composerQueueTargetKey) return
    if (sendInFlightRef.current || awaitingPersistedTurnRef.current) return
    if (!composerQueueTargetKey) return
    // A turn we reattached to is still running server-side — flushing now would
    // start a second concurrent turn. Wait for the /running poll to clear.
    if (reattachedRunning) return
    // Gate on strict idle: flushing while sendState is 'error' would auto-fire
    // a queued send after a failed turn (and clobber the restored draft).
    if (sendState !== 'idle' || awaitingPersistedTurn) return
    const next = activeQueuedSends[0]!
    if (composerQueueClaimInFlightRef.current.has(next.id)) return
    composerQueueClaimInFlightRef.current.add(next.id)
    // Claim across browser tabs and persist the dequeue before provider I/O.
    // A stale tab that loses the claim updates to the authoritative queue and
    // never sends the same follow-up a second time.
    const claimedTargetKey = composerQueueTargetKey
    const store = getWebComposerQueueStore()
    void store.claim(claimedTargetKey, next.id).then((claim) => {
      composerQueueCommitCounterRef.current += 1
      queuedSendsRef.current = claim.entries
      if (composerQueueMountedRef.current) {
        setQueuedSends(claim.entries)
        setComposerQueueDurability(claim.durability)
      }
      if (!claim.claimed) return
      if (!composerQueueMountedRef.current || composerQueueTargetKeyRef.current !== claimedTargetKey) {
        // Navigation/session changes can occur while waiting for another tab's
        // lock. Put the unconsumed entry back instead of sending it through a
        // composer that now targets a different session.
        const restoredQueue = [next, ...claim.entries.filter((entry) => entry.id !== next.id)]
        if (composerQueueMountedRef.current) commitQueuedSends(restoredQueue)
        else store.commit(restoredQueue)
        return
      }
      setInputText(next.text)
      inputTextRef.current = next.text
      setAttachments(next.attachments)
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (ta) {
          ta.value = next.text
          ta.setSelectionRange(next.text.length, next.text.length)
        }
        resizeComposer()
        void sendMessage()
      })
    }).catch(() => {
      if (composerQueueMountedRef.current) setComposerQueueDurability('memory-only')
    }).finally(() => {
      composerQueueClaimInFlightRef.current.delete(next.id)
    })
  }, [activeQueuedSends, awaitingPersistedTurn, commitQueuedSends, composerQueueStorageReady, composerQueueTargetKey, reattachedRunning, resizeComposer, runningProbeReadyKey, sendMessage, sendState])

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

  // Remove a single queued message (× on its chip) without firing it.
  const removeQueuedSend = useCallback((id: string) => {
    commitQueuedSends(removeComposerQueueItem(queuedSendsRef.current, id))
  }, [commitQueuedSends])

  // Pull a queued message back into the composer to edit it. Its attachments
  // are still in memory so they restore too. The current draft is preserved by
  // prepending the edited text only when the composer is empty; otherwise the
  // queued text replaces the draft (matching ↑ history-recall behaviour).
  const editQueuedSend = useCallback((id: string) => {
    const item = queuedSendsRef.current.find((entry) => entry.id === id)
    if (!item) return
    commitQueuedSends(removeComposerQueueItem(queuedSendsRef.current, id))
    setInputText(item.text)
    inputTextRef.current = item.text
    setAttachments(item.attachments ?? [])
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.value = item.text
        ta.focus()
        ta.setSelectionRange(item.text.length, item.text.length)
      }
      resizeComposer()
    })
  }, [commitQueuedSends, resizeComposer, inputTextRef, textareaRef, setInputText, setAttachments])

  const updateComposerHints = useCallback((text: string, cursor: number) => {
    const mention = detectMentionAtCursor(text, cursor)
    const mentionChanged = mention
      ? !mentionQuery || mentionQuery.start !== mention.start || mentionQuery.query !== mention.query
      : mentionQuery !== null
    if (mentionChanged) {
      setMentionActiveIndex(0)
      setMentionQuery(mention)
    }
    const isSlash = text.startsWith('/') && !/\s/.test(text.split('\n')[0] ?? '')
    if (isSlash !== slashOpen) {
      if (isSlash) setSlashActiveIndex(0)
      setSlashOpen(isSlash)
    }
  }, [mentionQuery, slashOpen])

  const slashCommands = useMemo(() => {
    const baseline = getSlashCommandSuggestions(session?.provider)
    const merged = [...liveSlashCommands]
    const seen = new Set(merged.map((entry) => entry.command))
    for (const entry of baseline) {
      if (!seen.has(entry.command)) {
        merged.push(entry)
        seen.add(entry.command)
      }
    }
    const firstLine = inputText.split('\n')[0] ?? ''
    return filterSlashCommands(merged, firstLine.slice(1))
  }, [inputText, liveSlashCommands, session?.provider])

  const commandSessionId = session?.sessionId
  const commandSessionProvider = session?.provider

  useEffect(() => {
    if (!commandSessionId) {
      setLiveSlashCommands([])
      return
    }
    const controller = new AbortController()
    const url = `/api/sessions/${commandSessionId}/commands?provider=${encodeURIComponent(commandSessionProvider ?? 'claude')}`
    void fetch(url, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (controller.signal.aborted || !data || !Array.isArray(data.commands)) return
        setLiveSlashCommands(data.commands.map((entry: { command: string; description: string; argumentHint?: string }) => ({
          command: entry.command,
          description: entry.description ?? '',
          argumentHint: entry.argumentHint && entry.argumentHint.trim() ? entry.argumentHint.trim() : undefined,
        })))
      })
      .catch(() => { /* ignore */ })
    return () => controller.abort()
  }, [commandSessionId, commandSessionProvider])

  useEffect(() => {
    if (!mentionQuery) {
      mentionAbortRef.current?.abort()
      mentionAbortRef.current = null
      setMentionResults([])
      return
    }
    const agentMatches: MentionResult[] = activeProvider === 'opencode'
      ? composerMentionAgentOptions
          .filter((agent) => {
            const query = mentionQuery.query.toLowerCase()
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
    const cwd = session?.cwd
    if (!cwd) {
      setMentionResults(agentMatches)
      setMentionActiveIndex(0)
      return
    }
    const controller = new AbortController()
    mentionAbortRef.current?.abort()
    mentionAbortRef.current = controller
    const url = `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(mentionQuery.query)}`
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) return
        const data = await res.json() as { files?: Array<{ path: string; basename: string }> }
        if (controller.signal.aborted) return
        const fileMatches: MentionResult[] = (data.files ?? []).map((file) => ({ kind: 'file', ...file }))
        setMentionResults([...agentMatches, ...fileMatches])
        setMentionActiveIndex(0)
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return
      }
    }, 80)
    return () => {
      window.clearTimeout(handle)
      controller.abort()
    }
  }, [activeProvider, composerMentionAgentOptions, mentionQuery, session?.cwd])

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
  const ingestFileAttachments = useCallback(async (files: File[]) => runIngestFileAttachments({
    activeComposerDraftKeyRef, attachmentReadsRef, setSendError, insertContextAttachments,
  }, files), [insertContextAttachments, setSendError])

  const handleComposerPaste = useCallback(async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items
    if (!items || items.length === 0) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (files.length === 0) return
    event.preventDefault()
    await ingestFileAttachments(files)
  }, [ingestFileAttachments])

  const [composerDropActive, setComposerDropActive] = useState(false)
  const dropDepthRef = useRef(0)

  const handleComposerDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    dropDepthRef.current += 1
    setComposerDropActive(true)
  }, [])

  const handleComposerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleComposerDragLeave = useCallback(() => {
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
    if (dropDepthRef.current === 0) setComposerDropActive(false)
  }, [])

  const handleComposerDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dropDepthRef.current = 0
    setComposerDropActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) return
    await ingestFileAttachments(files)
  }, [ingestFileAttachments])

  const removeAttachment = useCallback((id: string | undefined, index: number) => {
    if (id) {
      const next = removeContextReference(inputTextRef.current, id)
      setInputText(next)
      inputTextRef.current = next
    }
    setAttachments((prev) => prev.filter((attachment, attachmentIndex) => (
      id ? attachment.id !== id : attachmentIndex !== index
    )))
  }, [inputTextRef, setInputText, setAttachments])

  const restoreFailedSend = useCallback(() => {
    if (!failedSend || sendInFlightRef.current || awaitingPersistedTurnRef.current) return
    setInputText(failedSend.text)
    inputTextRef.current = failedSend.text
    setAttachments(failedSend.attachments)
    setFailedSend(null)
    setSendError(null)
    window.requestAnimationFrame(() => {
      resizeComposer()
      textareaRef.current?.focus()
    })
  }, [failedSend, resizeComposer, inputTextRef, sendInFlightRef, awaitingPersistedTurnRef, textareaRef, setInputText, setSendError, setAttachments, setFailedSend])

  const handleDeleteSession = useCallback(async () => runHandleDeleteSession({
    session, deleting, sessionCapabilities, setDeleting, setSessionActionError,
    setSessionActionNotice, onDelete,
  }), [deleting, onDelete, session, sessionCapabilities?.deleteSession])

  const runSessionAction = useCallback(async (action: string) => runRunSessionAction({
    session, sessionActionLoading, setSessionActionLoading, setSessionActionError,
    setSessionActionNotice, setDiagnosticSections,
  }, action), [session, sessionActionLoading])

  const respondToPermission = useCallback(async (permission: PendingPermission, response: 'once' | 'always' | 'reject', permissionMode?: 'acceptEdits' | 'default') => runRespondToPermission({
    setSessionActionLoading, setSessionActionError, setPendingPermissions, session,
    sessionActionLoading,
  }, permission, response, permissionMode), [session, sessionActionLoading])

  // Submit answers to a structured question prompt. Codex keys answers by its
  // schema id; Claude falls back to question text. Arrays stay lossless for
  // Codex/MCP (including custom answers that contain commas).
  const respondToQuestion = useCallback(async (permission: PendingPermission, answers: PendingQuestionAnswers) => runRespondToQuestion({
    session, sessionActionLoading, setSessionActionLoading, setSessionActionError,
    setPendingPermissions,
  }, permission, answers), [session, sessionActionLoading])

  // Respond to an ExitPlanMode plan-approval. Approving allows the tool (the SDK
  // exits plan mode for this turn) AND switches the composer + warm query to the
  // chosen mode so subsequent turns aren't back in plan mode. Reject keeps planning.
  const respondToPlan = useCallback(async (
    permission: PendingPermission,
    decision: 'acceptEdits' | 'default' | 'reject',
  ) => {
    if (decision === 'reject') {
      await respondToPermission(permission, 'reject')
      return
    }
    commitClaudePermissionSelection(decision)
    // The mode rides the approval itself: allowing ExitPlanMode restores the
    // pre-plan mode, overwriting a mode change sent separately.
    await respondToPermission(permission, 'once', decision)
  }, [respondToPermission, commitClaudePermissionSelection])

  const handleFork = useCallback(async () => {
    if (!session || forking) return
    setForking(true)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider, providerInstanceId: session.providerInstanceId }),
      })
      const data = await readJsonResponse(res)
      if (data.error) throw new Error(data.error)
      onFork?.(data.sessionId)
    } catch (err) {
      console.error('Fork failed:', err)
    } finally {
      setForking(false)
    }
  }, [session, forking, onFork])

  const handleForkFromMessage = useCallback(async (messageId: string) => runHandleForkFromMessage({
    session, forkingMessageId, sessionCapabilities, setForkingMessageId, setSessionActionError,
    setSessionActionNotice, onFork,
  }, messageId), [forkingMessageId, onFork, session, sessionCapabilities?.messageFork])

  const toggleResumeFromMessage = useCallback((messageId: string) => {
    if (!sessionCapabilities?.resumeAtMessage) return
    setResumeFromMessageId((prev) => prev === messageId ? null : messageId)
    setSessionActionError(null)
    setSessionActionNotice(null)
  }, [sessionCapabilities?.resumeAtMessage])

  const focusComposer = useCallback(() => {
    setComposerCollapsed(false)
    window.requestAnimationFrame(() => {
      resizeComposer()
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }, [resizeComposer, textareaRef])

  const handleReusePrompt = useCallback((text: string) => {
    const restoredContext = readComposerContext(text)
    const trimmed = restoredContext.text.trim()
    if (!trimmed) return
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer, inputTextRef, setInputText, setAttachments])

  const handleQuoteMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const quoted = trimmed
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const existing = inputTextRef.current
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '' : '\n\n') : ''
    const next = `${existing}${separator}${quoted}\n\n`
    setInputText(next)
    inputTextRef.current = next
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer, inputTextRef, setInputText])

  const handleQuestionAnswerToComposer = useCallback((answer: string) => {
    const existing = inputTextRef.current
    const next = `${existing}${existing ? '\n\n' : ''}${answer}\n`
    setInputText(next)
    inputTextRef.current = next
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer, inputTextRef, setInputText])

  const handleDiffCommentToComposer = useCallback((prompt: string) => {
    if (!prompt.trim()) return
    const label = /File: (.*)/.exec(prompt)?.[1] || 'Diff comment'
    insertContextAttachments([createContextAttachment('diff', label, prompt)])
  }, [insertContextAttachments])

  const handleEditFromMessage = useCallback((messageId: string, text: string) => {
    const restoredContext = readComposerContext(text)
    const trimmed = restoredContext.text.trim()
    if (!trimmed) return
    setAttachments(prev => mergeComposerAttachments(prev, restoreContextAttachments(restoredContext.records)))
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    if (sessionCapabilities?.resumeAtMessage) {
      setResumeFromMessageId(messageId)
      setSessionActionNotice('Editing — safe resume armed; the next send will replace from this point in a guarded fork.')
    }
    focusComposer()
  }, [focusComposer, sessionCapabilities?.resumeAtMessage, inputTextRef, setInputText, setAttachments])

  const refreshDiagnostics = useCallback(async () => {
    if (!session) return
    setDiagnosticsLoading(true)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/diagnostics`, session.provider, session.providerInstanceId))
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDiagnosticSections(data.sections ?? [])
      const diagnosticsModel = normalizeSelectValue(data.currentModel)
      if (diagnosticsModel && !selectedModelValue) setSelectedModel(diagnosticsModel)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to refresh diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  }, [selectedModelValue, session, setSelectedModel])

  const [claudeMcpBusy, setClaudeMcpBusy] = useState<string | null>(null)
  const [claudeHookQuery, setClaudeHookQuery] = useState('')
  const [claudeHookSearching, setClaudeHookSearching] = useState(false)
  // Tracks only policies applied in this viewer. Absence is deliberately shown
  // as unknown rather than guessing the SDK's current per-server override.
  const [claudeMcpPermissionModes, setClaudeMcpPermissionModes] = useState<Record<string, 'default' | 'auto'>>({})
  const runClaudeSessionAction = useCallback(async (action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) => {
    if (!session) return null
    setClaudeMcpBusy(busyKey)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, provider: session.provider, providerInstanceId: session.providerInstanceId, ...extra }),
      })
      const data = await readOptionalJsonResponse(res, {})
      if (data.error) throw new Error(data.error)
      const result = data.result && typeof data.result === 'object' && !Array.isArray(data.result)
        ? data.result as Record<string, unknown>
        : data as Record<string, unknown>
      setSessionActionNotice(claudeDiagnosticActionNotice(action, successNotice, result))
      await refreshDiagnostics()
      return result
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Action failed')
      return null
    } finally {
      setClaudeMcpBusy(null)
    }
  }, [refreshDiagnostics, session])

  const applyClaudeMcpPermissionMode = useCallback(async (
    serverName: string,
    permissionModeKey: string,
    mode: 'default' | 'auto' | null,
    previous: 'default' | 'auto' | undefined,
  ) => {
    setClaudeMcpPermissionModes((current) => {
      const next = { ...current }
      if (mode === null) delete next[permissionModeKey]
      else next[permissionModeKey] = mode
      return next
    })
    const result = await runClaudeSessionAction(
      'setMcpPermissionModeOverride',
      { serverName, mode },
      `mcp:permission:${serverName}`,
      mode === null ? `${serverName} MCP policy cleared.` : `${serverName} MCP policy set to ${mode}.`,
    )
    if (!result) {
      setClaudeMcpPermissionModes((current) => {
        const next = { ...current }
        if (previous) next[permissionModeKey] = previous
        else delete next[permissionModeKey]
        return next
      })
    }
  }, [runClaudeSessionAction])

  const addClaudeMcpServer = useCallback(async () => {
    const serverName = window.prompt('MCP server name')?.trim()
    if (!serverName) return
    const rawConfig = window.prompt(
      'MCP configuration JSON',
      '{"type":"http","url":"https://example.com/mcp"}',
    )
    if (!rawConfig) return
    try {
      const config = JSON.parse(rawConfig) as unknown
      await runClaudeSessionAction(
        'setMcpServers',
        { operation: 'add', serverName, config },
        `mcp:add:${serverName}`,
        `Added dynamic MCP server ${serverName}.`,
      )
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Invalid MCP configuration JSON')
    }
  }, [runClaudeSessionAction])

  const searchClaudeHookEvents = useCallback(async () => {
    if (!session || session.provider !== 'claude') return
    setClaudeHookSearching(true)
    setSessionActionError(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listHookEvents', provider: 'claude', query: claudeHookQuery, limit: 100 }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json().catch(() => ({}))
      if (data.error) throw new Error(data.error)
      const result = data.result && typeof data.result === 'object' ? data.result as Record<string, unknown> : data
      const events = Array.isArray(result.events) ? result.events as Array<Record<string, unknown>> : []
      const items = events.map((event) => `${String(event.timestamp ?? '')} · ${String(event.summary ?? event.event ?? 'Hook')}`)
      setDiagnosticSections((sections) => sections.map((section) => section.id === 'hooks'
        ? { ...section, items: items.length > 0 ? items : ['None'] }
        : section))
      setSessionActionNotice(`Hook timeline · ${events.length} match${events.length === 1 ? '' : 'es'}`)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to search hook timeline')
    } finally {
      setClaudeHookSearching(false)
    }
  }, [claudeHookQuery, session])

  const toggleDiagnostics = useCallback(async () => {
    if (!session) return
    const nextOpen = !showDiagnostics
    setShowDiagnostics(nextOpen)
    if (!nextOpen || diagnosticSections.length > 0 || diagnosticsLoading) return

    setDiagnosticsLoading(true)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/diagnostics`, session.provider, session.providerInstanceId))
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setDiagnosticSections(data.sections ?? [])
      const diagnosticsModel = normalizeSelectValue(data.currentModel)
      if (diagnosticsModel && !selectedModelValue) setSelectedModel(diagnosticsModel)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to load diagnostics')
    } finally {
      setDiagnosticsLoading(false)
    }
  }, [diagnosticSections.length, diagnosticsLoading, selectedModelValue, session, showDiagnostics, setSelectedModel])

  const threadedFull = useMemo(() => measureSync('threading.build', () => {
    const prev = prevThreadingRef.current
    const nextMessages = (prev ? buildThreadedMessagesIncremental(messages, prev) : null)
      ?? buildThreadedMessages(messages)
    const previous = threadedCacheRef.current
    const stabilized = nextMessages.map((message) => {
      const cached = previous.get(threadedMessageKey(message))
      return cached && threadedMessageEqual(cached, message) ? cached : message
    })
    const nextCache = new Map<string, ThreadedMessage>()
    for (const message of stabilized) nextCache.set(threadedMessageKey(message), message)
    threadedCacheRef.current = nextCache
    prevThreadingRef.current = { messages, threaded: stabilized }
    return stabilized
  }), [messages])
  const threaded = useMemo(
    () => (showTools ? threadedFull : stripToolCallBlocks(threadedFull)),
    [threadedFull, showTools],
  )
  const turnDurations = useMemo(() => computeTurnDurationsMs(threadedFull), [threadedFull])

  // Merge bridge transcript messages into the main threaded view
  const threadedWithBridge = useMemo(() => {
    if (bridgeTranscriptEntries.length === 0) return threaded

    const bridgeMessages: ThreadedMessage[] = bridgeTranscriptEntries.map((entry, i) => ({
      role: entry.kind === 'sent' ? 'user' : 'assistant',
      uuid: `bridge-${i}`,
      timestamp: entry.timestamp,
      origin: { kind: 'bridge' },
      blocks: [{ type: 'text', text: entry.text } as any],
    }))

    // Merge chronologically by timestamp
    const allMessages = [...threaded, ...bridgeMessages]
    return allMessages.sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return aTime - bTime
    })
  }, [threaded, bridgeTranscriptEntries])

  // buildTaskActiveFormsForWeb returns a fresh Map every time `threaded`
  // changes identity (every poll that merges a delta), which would churn the
  // TaskActiveFormsContext value and re-render all mounted TaskCards even when
  // no task state changed. Reuse the prior Map instance when contents are
  // value-equal so idle polls don't propagate through the context. Value-aware
  // (not size/keys-only): a TaskUpdate reuses a taskId key with a new form.
  const taskActiveForms = useMemo(() => {
    const next = buildTaskActiveFormsForWeb(threadedWithBridge)
    const prev = taskActiveFormsRef.current
    let same = prev.size === next.size
    if (same) {
      for (const [key, value] of next) {
        if (prev.get(key) !== value) { same = false; break }
      }
    }
    const result = same ? prev : next
    taskActiveFormsRef.current = result
    return result
  }, [threadedWithBridge])
  const taskRegistry = useMemo(() => {
    const registry = buildTaskRegistry(threadedWithBridge)
    if (openCodeTodos && openCodeTodos.length > 0) {
      const todosRegistry = buildTaskRegistryFromTodos(openCodeTodos)
      for (const [id, task] of todosRegistry) {
        registry.set(id, task)
      }
    }
    if (codexPlan && codexPlan.plan.length > 0) {
      const planRegistry = buildTaskRegistryFromCodexPlan(codexPlan.plan)
      for (const [id, task] of planRegistry) {
        registry.set(id, task)
      }
    }
    return registry
  }, [threadedWithBridge, openCodeTodos, codexPlan])
  const [taskRailOpen, setTaskRailOpen] = useState(true)
  const isProject = !!projectView
  const dirName  = projectView?.key ?? (pathBasename(session?.cwd) || session?.sessionId) ?? ''

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
  useEffect(() => {
    const entries = channelBridge.entries.filter(
      (e): e is Extract<typeof e, { kind: 'sent' | 'reply' }> => e.kind === 'sent' || e.kind === 'reply'
    )
    setBridgeTranscriptEntries((prev) => {
      // Find entries we haven't already added
      const newEntries = entries.filter((entry) =>
        !prev.some((p) => p.kind === entry.kind && p.text === entry.text)
      )
      if (newEntries.length === 0) return prev
      return [
        ...prev,
        ...newEntries.map((e) => ({
          kind: e.kind,
          text: e.text,
          timestamp: new Date().toISOString(),
        })),
      ]
    })
  }, [channelBridge.entries.length])

  // Sync bridge permission requests into the permission composer
  useEffect(() => {
    const permissionEntries = channelBridge.entries.filter(
      (e): e is Extract<typeof e, { kind: 'permission' }> => e.kind === 'permission'
    )
    setPendingPermissions((prev) => {
      const newPerms = permissionEntries
        .filter((entry) => !prev.some((p) => p.id === entry.id))
        .map((entry) => ({
          id: entry.id,
          title: entry.request.tool_name || 'CLI bridge permission',
          detail: entry.request.description,
          toolName: entry.request.tool_name,
          reason: entry.request.input_preview,
        }))
      if (newPerms.length === 0) return prev
      return [...prev, ...newPerms]
    })
  }, [channelBridge.entries.length])

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
  useEffect(() => {
    if (!canUseChannelBridge || !session) {
      setBridgeTranscriptEntries([])
      persistedBridgeCountRef.current = 0
      return
    }
    let isMounted = true
    ;(async () => {
      try {
        const res = await fetch(`/api/bridge-messages?provider=${encodeURIComponent(session.provider ?? 'claude')}&sessionId=${encodeURIComponent(session.sessionId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { messages: Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }> }
        if (isMounted) {
          setBridgeTranscriptEntries(data.messages)
          persistedBridgeCountRef.current = data.messages.length
        }
      } catch (err) {
        console.error('[bridge-messages] Failed to load:', err)
      }
    })()
    return () => { isMounted = false }
  }, [canUseChannelBridge, session?.provider, session?.sessionId])

  // Persist new bridge messages to disk when they arrive
  useEffect(() => {
    if (!canUseChannelBridge || !session) return
    const newCount = bridgeTranscriptEntries.length
    const persistedCount = persistedBridgeCountRef.current
    if (newCount <= persistedCount) return

    // Persist only the new entries
    const newEntries = bridgeTranscriptEntries.slice(persistedCount)
    let cancelled = false
    ;(async () => {
      for (const entry of newEntries) {
        if (cancelled) return
        try {
          const res = await fetch('/api/bridge-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: session.provider,
              providerInstanceId: session.providerInstanceId,
              sessionId: session.sessionId,
              kind: entry.kind,
              text: entry.text,
              timestamp: entry.timestamp,
            }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } catch (err) {
          console.error('[bridge-messages] Failed to save:', err)
        }
      }
      if (!cancelled) {
        persistedBridgeCountRef.current = newCount
      }
    })()
    return () => { cancelled = true }
  }, [canUseChannelBridge, session?.provider, session?.sessionId, bridgeTranscriptEntries.length])

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
  const activeToolCount = liveToolActivities.filter((activity) => activity.status === 'running').length
  const modelsPending = modelsLoading && !selectedModel
  const sendBusy = sendState === 'sending' || awaitingPersistedTurn || modelsPending
  // A turn is live (whether we own its stream or reattached to it) — drives the
  // stop button and the "busy" composer presentation.
  const turnRunning = sendBusy || reattachedRunning
  const canSubmitMessage = Boolean(session && (inputText.trim() || referencedComposerAttachments(inputText, attachments).length > 0))
  const composerConfig = useMemo(() => getProviderComposer(session?.provider), [session?.provider])
  const composerPlaceholder = canUseChannelBridge && channelBridge.routeComposer
    ? 'Send to the live CLI bridge… (toggle off in the bridge panel)'
    : turnRunning
    ? composerConfig.placeholderStreaming
    : activeToolCount > 0
    ? `${composerConfig.label} is using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
    : 'Ask for changes, send follow-ups, or attach images'
  const composerRuntime = useMemo(() => deriveComposerRuntimeState({
    hasSession: Boolean(session),
    preparing: modelsPending,
    sendState,
    awaitingPersistedTurn,
    reattachedRunning,
    interrupting,
    liveStatus,
    hasLiveOutput: Boolean(liveAssistantText.trim() || liveThreadedMessages.length > 0),
    activeToolCount,
    queuedCount: activeQueuedSends.length,
    queueDurability: composerQueueDurability,
  }), [
    activeQueuedSends.length,
    activeToolCount,
    awaitingPersistedTurn,
    composerQueueDurability,
    interrupting,
    liveAssistantText,
    liveStatus,
    liveThreadedMessages.length,
    modelsPending,
    reattachedRunning,
    sendState,
    session?.sessionId,
  ])
  const composerStatus = canUseChannelBridge && channelBridge.routeComposer
    ? (channelBridge.sendError ? 'Bridge error' : 'Bridge · sends to live CLI')
    : steeredNotice && (sendState === 'sending' || reattachedRunning)
    ? 'Steered · delivered to the running turn'
    : composerRuntime.label
  const composerStatusDetail = canUseChannelBridge && channelBridge.routeComposer
    ? (channelBridge.sendError ?? 'Messages are routed directly to the attached CLI session.')
    : sendState === 'error' && sendError
    ? `${composerRuntime.detail} ${sendError}`
    : composerRuntime.detail
  const composerStatusColor = canUseChannelBridge && channelBridge.routeComposer
    ? (channelBridge.sendError ? 'var(--red, #f87171)' : `var(${composerConfig.cssAccentVar})`)
    : composerRuntime.tone === 'error'
    ? 'var(--red, #f87171)'
    : composerRuntime.tone === 'warning'
    ? 'var(--amber, #eaaa40)'
    : composerRuntime.tone === 'active'
    ? 'var(--cyan)'
    : 'var(--text-3)'
  const composerGitBranch = composerGitSummary?.branch ?? sessionInfo?.gitBranch ?? null
  const composerGitTitle = composerGitBranch
    ? [
        `Branch ${composerGitBranch}`,
        composerGitSummary?.modified ? `${composerGitSummary.modified} modified` : null,
        composerGitSummary?.untracked ? `${composerGitSummary.untracked} untracked` : null,
        composerGitSummary?.stashes ? `${composerGitSummary.stashes} stashes` : null,
      ].filter(Boolean).join(' · ')
    : null
  const composerGitHasDetails = Boolean(
    composerGitSummary?.modified || composerGitSummary?.untracked || composerGitSummary?.stashes,
  )
  const liveTurnTone: 'running' | 'syncing' = awaitingPersistedTurn ? 'syncing' : 'running'
  const liveTurnBadge = interrupting ? 'STOPPING' : awaitingPersistedTurn ? 'SYNCING' : 'RUNNING'
  const liveTurnActivityDetail = interrupting
    ? 'Interrupting turn; saving what the agent produced…'
    : awaitingPersistedTurn
    ? activeQueuedSends.length > 0
      ? 'Turn complete; syncing transcript. Next message queued.'
      : 'Turn complete; syncing transcript.'
    : liveStatus === 'retrying'
    ? 'Retrying after a transient error…'
    : liveStatus === 'compacting'
    ? 'Compacting conversation to free up context…'
    : session?.provider === 'claude' && liveToolActivities.some(activity => activity.status === 'running'
      && /^(Bash|Agent|Task)$/.test(activity.toolUse?.name ?? activity.label)
      && activity.toolUse?.input?.run_in_background !== true)
    ? 'Command running · Ctrl+B in composer to run in background'
    : activeToolCount > 0
    ? `Turn running; using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}.`
    : liveStatus === 'requesting' && !liveAssistantText.trim()
    ? 'Turn running; waiting for provider response.'
    : liveAssistantText.trim()
    ? 'Turn running; streaming assistant response.'
    : 'Turn running.'
  const showLiveTimelineOverlay = Boolean(
    !isProject
    && session
    && pendingMessageBaselineRef.current?.sessionId === session.sessionId,
  )
  const visiblePersistedMessageKeys = useMemo(() => {
    const baseline = pendingMessageBaselineRef.current
    if (!showLiveTimelineOverlay || !baseline || baseline.sessionId !== session?.sessionId) return null
    return new Set(baseline.keys)
  }, [messages, session?.sessionId, showLiveTimelineOverlay])
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
  const timelineRows = useMemo<TimelineRow[]>(() => {
    if (persistedTimelineRows.length === 0) return liveTimelineRows
    if (liveTimelineRows.length === 0) return persistedTimelineRows
    return [...persistedTimelineRows, ...liveTimelineRows]
  }, [liveTimelineRows, persistedTimelineRows])
  const normalizedTranscriptSearch = deferredTranscriptSearch.trim().toLowerCase()
  const transcriptTimelineRows = useMemo<TimelineRow[]>(() => {
    if (maximized) return timelineRows
    // Preserve referential identity with timelineRows when nothing is focused —
    // the scroll-anchor logic below relies on this equality.
    if (transcriptFilters.length === 0 && normalizedTranscriptSearch === '' && !bookmarksOnly) return timelineRows
    return timelineRows.filter((row) => {
      if (bookmarksOnly && !bookmarkIds.has(row.message.uuid)) return false
      if (!timelineRowMatchesTranscriptFilters(row, transcriptFilters)) return false
      if (!normalizedTranscriptSearch) return true
      return timelineRowSearchText(row).includes(normalizedTranscriptSearch)
    })
  }, [normalizedTranscriptSearch, timelineRows, transcriptFilters, bookmarksOnly, bookmarkIds, maximized])
  const renderedTimelineRows = useMemo<TimelineRow[]>(() => {
    if (viewMode === 'agents') return groupAgentsToolRows(transcriptTimelineRows)
    if (viewMode === 'stream') {
      // Rows whose message renders nothing in Stream view (no prose, no tool
      // calls) must be dropped, not just render null: the row wrapper's stream
      // padding and the virtual row's minimum height would otherwise paint
      // empty selectable ghost rows.
      const streamRows = decorateStreamTurnLandmarks(transcriptTimelineRows, !showLiveTimelineOverlay)
      return groupAgentsToolRows(streamRows).filter((row) => streamMessageHasContent(row.message))
    }
    return transcriptTimelineRows
  }, [showLiveTimelineOverlay, transcriptTimelineRows, viewMode])
  const hasTranscriptFocus = transcriptFilters.length > 0 || transcriptSearch.trim().length > 0 || bookmarksOnly
  const visualizerRows = useMemo<MessageVisualizerRow[]>(
    () => showVisualizer
      ? timelineRows.map((row) => ({
          key: row.key,
          message: row.message,
          dimmed: row.dimmed,
          previewBadge: row.previewBadge,
          showSession: row.showSession,
        }))
      : [],
    [showVisualizer, timelineRows],
  )
  const timelineTargetMessageId = useMemo(
    () => resolveTimelineTargetMessageId(targetMessageId, messages, timelineRows),
    [messages, targetMessageId, timelineRows],
  )
  const hasLiveTimeline = timelineRows.length > 0
  const hasTranscriptTimeline = renderedTimelineRows.length > 0
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

  const handleVisualizerSelectMessage = useCallback((messageId: string) => {
    setShowVisualizer(false)
    setTranscriptFilters([])
    setTranscriptSearch('')
    setHighlightedMessageId(messageId)
    autoFollowRef.current = false
    setAutoFollow(false)

    const scrollToMessage = () => {
      const node = timelineRef.current
      const rows = timelineRowsRef.current
      const layout = rowLayoutRef.current
      if (!node) return

      const rowIndex = rows.findIndex((row) => rowContainsMessage(row, messageId))
      if (rowIndex < 0) return

      const targetTop = Math.max(layout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
      suppressFollowEvalUntilRef.current = performance.now() + 300
      markProgrammaticTimelineScroll()
      node.scrollTop = targetTop
      commitTimelineScrollTop(targetTop)
    }

    window.requestAnimationFrame(() => {
      scrollToMessage()
      window.requestAnimationFrame(() => {
        if (!scrollMountedTimelineRowIntoView(messageId)) {
          scrollToMessage()
        }
      })
    })
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll, scrollMountedTimelineRowIntoView])

  // Used by TaskRail to scroll the transcript to a task's most recent event.
  // Same scroll/highlight behavior as the visualizer-select path but without
  // touching filters/search or the visualizer toggle.
  const handleJumpToMessage = useCallback((messageId: string) => {
    setHighlightedMessageId(messageId)
    autoFollowRef.current = false
    setAutoFollow(false)

    const scrollToMessage = () => {
      const node = timelineRef.current
      const rows = timelineRowsRef.current
      const layout = rowLayoutRef.current
      if (!node) return
      const rowIndex = rows.findIndex((row) => row.message.uuid === messageId)
      if (rowIndex < 0) return
      const targetTop = Math.max(layout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
      suppressFollowEvalUntilRef.current = performance.now() + 300
      markProgrammaticTimelineScroll()
      node.scrollTop = targetTop
      commitTimelineScrollTop(targetTop)
    }

    window.requestAnimationFrame(() => {
      scrollToMessage()
      window.requestAnimationFrame(() => {
        if (!scrollMountedTimelineRowIntoView(messageId)) scrollToMessage()
      })
    })
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll, scrollMountedTimelineRowIntoView])

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
