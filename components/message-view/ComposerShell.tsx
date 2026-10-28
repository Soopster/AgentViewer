import type { DragEvent } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { Session } from '../../lib/types'
import type { MutableRefObject } from 'react'
import type { SessionComposerAgentOption } from '../../lib/types'
import type { SessionComposerModeOption } from '../../lib/types'
import type { SessionCapabilities } from '../../lib/types'
import type { ProviderComposerConfig } from '../../lib/providerComposer'
import type { RefObject } from 'react'
import type { KeyboardEvent } from 'react'
import type { ClipboardEvent } from 'react'
import type { ChannelBridge } from '../useChannelBridge'
import type { IdeBridge } from '../useIdeBridge'
import type { ComposerRuntimeState } from '../../lib/composerRuntimeState'
import { VoiceInput } from '../VoiceInput'
import ContextComposer, { type ContextComposerHandle } from '../ContextComposer'
import { contextReferences } from '@/lib/composerContext'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { type SendState, type ContextUsage, type SessionModelInfo, type SendAttachment, type ReasoningEffortLevel } from '@/lib/types'
import { type SlashCommandSuggestion } from '@/lib/slashCommands'
import { permissionMcpServerLabel, type PendingPermission, type PendingQuestionAnswers } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { sessionIdentityKey } from '@/lib/sessionIdentity'
import { type WebPluginServices } from '../shell/pluginTypes'
import { ArrowUp, BookOpen, ChevronDown, CircleAlert, CircleCheck, Clock3, GitBranch, LoaderCircle, Minimize2, MonitorUp, Paperclip, Plug, Radio, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { type WebViewMode } from '../MessageItem'
import ProviderIcon from '../ProviderIcon'
import BranchSwitcher from '../BranchSwitcher'
import { type WebComposerQueueDurability } from '@/lib/webComposerQueue'
import { type GitSummary } from '@/lib/gitProvider'
import { mergeComposerAttachments } from '@/lib/composerAttachments'
import { type ColorTreatment } from '@/lib/colorTreatment'
import { type QueuedWebSend, type CopilotContextTier, type FailedSend, type RewindPreview, type RollbackPreview, type MentionResult } from './types'
import { PlanApprovalCard } from './PlanApprovalCard'
import { AskUserQuestionPicker } from './AskUserQuestionPicker'
import { ComposerStatusBanner, effortLabel, composerPopoverStyle, composerPopoverHintStyle, composerPopoverItemStyle, ComposerContextUsageRing } from './composerUi'
import { attachmentImagePreviewSrc, attachmentDisplayName } from './composerStorage'
import { compactNativeSelectClassName, PierrePatchDiffView, PromptLibrary, ChannelBridgePanel, IdeBridgePanel, PluginSurfaceHost } from './lazyPanels'

type ComposerShellProps = {
  isProject: boolean
  composerCollapsed: boolean
  handleComposerDragEnter: (event: React.DragEvent<HTMLDivElement>) => void
  handleComposerDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  handleComposerDragLeave: () => void
  handleComposerDrop: (event: React.DragEvent<HTMLDivElement>) => Promise<void>
  timelineWidth: 'centered' | 'full'
  viewMode: WebViewMode
  composerDropActive: boolean
  setComposerCollapsed: Dispatch<SetStateAction<boolean>>
  modelsPending: boolean
  sendError: string | null
  sessionActionError: string | null
  sessionActionNotice: string | null
  session: Session | null
  codexExternalWriter: boolean | undefined
  failedSend: FailedSend | null
  restoreFailedSend: () => void
  sendBusy: boolean
  livePromptSuggestion: string | null
  sendState: SendState
  setInputText: Dispatch<SetStateAction<string>>
  inputTextRef: MutableRefObject<string>
  setLivePromptSuggestion: Dispatch<SetStateAction<string | null>>
  textareaRef: MutableRefObject<ContextComposerHandle | null>
  resizeComposer: () => void
  colorTreatment: ColorTreatment
  teammatesTab: boolean
  composerTab: string
  setComposerDock: Dispatch<SetStateAction<{ sessionId: string; tab: string; }>>
  teamAttention: { sessionId: string; count: number; }
  activeProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | undefined
  selectedModelValue: string | null
  commitClaudeModelSelection: (nextModel: string) => void
  modelOptions: SessionModelInfo[]
  effortOptions: ReasoningEffortLevel[]
  selectedEffort: ReasoningEffortLevel | 'auto'
  setSelectedEffort: Dispatch<SetStateAction<ReasoningEffortLevel | 'auto'>>
  selectedCopilotContextTier: CopilotContextTier | null
  setSelectedCopilotContextTier: Dispatch<SetStateAction<CopilotContextTier | null>>
  selectedModelInfo: SessionModelInfo | null
  composerAgentOptions: SessionComposerAgentOption[]
  selectedAgent: string
  setSelectedAgent: Dispatch<SetStateAction<string>>
  composerModeOptions: SessionComposerModeOption[]
  selectedCopilotMode: string
  commitCopilotModeSelection: (nextMode: string) => void
  selectedPermissionMode: 'auto' | 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  commitClaudePermissionSelection: (nextMode: 'auto' | 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions') => void
  selectedCodexApproval: 'auto' | 'untrusted' | 'on-request' | 'never'
  setSelectedCodexApproval: Dispatch<SetStateAction<'auto' | 'untrusted' | 'on-request' | 'never'>>
  taskBudgetTokens: number | null
  setTaskBudgetTokens: Dispatch<SetStateAction<number | null>>
  enableWorkflow: boolean
  setEnableWorkflow: Dispatch<SetStateAction<boolean>>
  sessionCapabilities: SessionCapabilities | undefined
  rewindCandidates: { uuid: string; content: string; timestamp: string | undefined; }[]
  rewindTargetId: string
  setRewindTargetId: Dispatch<SetStateAction<string>>
  handleRewind: () => Promise<void>
  previewingRewind: boolean
  applyingRewind: boolean
  rollbackCandidates: { turnId: string; preview: string; }[]
  rollbackTurns: number
  setRollbackTurns: Dispatch<SetStateAction<number>>
  handleRollbackPreview: () => Promise<void>
  resumeFromMessageId: string | null
  setResumeFromMessageId: Dispatch<SetStateAction<string | null>>
  pendingPermissions: PendingPermission[]
  sessionActionLoading: string | null
  respondToQuestion: (permission: PendingPermission, answers: PendingQuestionAnswers) => Promise<void>
  respondToPermission: (permission: PendingPermission, response: 'once' | 'always' | 'reject', permissionMode?: 'acceptEdits' | 'default') => Promise<void>
  respondToPlan: (permission: PendingPermission, decision: 'acceptEdits' | 'default' | 'reject') => Promise<void>
  attachmentPanelOpen: boolean
  attachments: SendAttachment[]
  attachmentType: 'file' | 'directory' | 'selection' | 'image' | 'mention' | 'skill' | 'blob' | 'agent' | 'extension_context'
  setAttachmentType: Dispatch<SetStateAction<'file' | 'directory' | 'selection' | 'image' | 'mention' | 'skill' | 'blob' | 'agent' | 'extension_context'>>
  attachmentPath: string
  setAttachmentPath: Dispatch<SetStateAction<string>>
  addAttachment: () => void
  inputText: string
  removeAttachment: (id: string | undefined, index: number) => void
  activeQueuedSends: QueuedWebSend[]
  composerQueueDurability: WebComposerQueueDurability
  editQueuedSend: (id: string) => void
  removeQueuedSend: (id: string) => void
  mentionQuery: { start: number; query: string; } | null
  mentionResults: MentionResult[]
  composerConfig: ProviderComposerConfig
  mentionActiveIndex: number
  mentionItemRefs: RefObject<(HTMLButtonElement | null)[]>
  insertMention: (entry: MentionResult) => void
  setMentionActiveIndex: Dispatch<SetStateAction<number>>
  slashOpen: boolean
  slashCommands: SlashCommandSuggestion[]
  slashActiveIndex: number
  slashItemRefs: RefObject<(HTMLButtonElement | null)[]>
  insertSlashCommand: (command: string) => void
  setSlashActiveIndex: Dispatch<SetStateAction<number>>
  composerDraftKey: string | null
  loadedComposerDraftKey: string | null
  setAttachments: Dispatch<SetStateAction<SendAttachment[]>>
  prewarmComposer: () => void
  historyIndex: number
  sentHistory: string[]
  setHistoryIndex: Dispatch<SetStateAction<number>>
  draftBeforeHistoryRef: RefObject<{ text: string; cursorPos: number; }>
  setSendError: Dispatch<SetStateAction<string | null>>
  setSendState: Dispatch<SetStateAction<SendState>>
  updateComposerHints: (text: string, cursor: number) => void
  setMentionQuery: Dispatch<SetStateAction<{ start: number; query: string; } | null>>
  setSlashOpen: Dispatch<SetStateAction<boolean>>
  isComposingRef: RefObject<boolean>
  handleKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void
  handleComposerPaste: (event: React.ClipboardEvent<HTMLDivElement>) => Promise<void>
  composerPlaceholder: string
  canUseChannelBridge: boolean
  channelBridge: ChannelBridge
  composerQueueTargetKey: string | null
  setAttachmentPanelOpen: Dispatch<SetStateAction<boolean>>
  setPromptLibraryOpen: Dispatch<SetStateAction<boolean>>
  promptLibraryOpen: boolean
  insertPromptText: (text: string) => void
  setChannelBridgeOpen: Dispatch<SetStateAction<boolean>>
  channelBridgeOpen: boolean
  canUseIdeBridge: boolean
  setIdeBridgeOpen: Dispatch<SetStateAction<boolean>>
  ideBridge: IdeBridge
  ideBridgeOpen: boolean
  handleDiffCommentToComposer: (prompt: string) => void
  contextUsage: ContextUsage | null
  reattachedRunning: boolean
  sendMessage: (retryOverride?: { text: string; attachments: SendAttachment[]; turnRequestId?: string; }) => Promise<void>
  canSubmitMessage: boolean
  activeToolCount: number
  backgroundClaudeTasks: () => Promise<void>
  backgroundingTasks: boolean
  cancelSend: () => void
  awaitingPersistedTurn: boolean
  composerStatusColor: string
  composerRuntime: ComposerRuntimeState
  composerStatusDetail: string
  composerStatus: string
  composerGitBranch: string | null
  setBranchSwitcherOpen: Dispatch<SetStateAction<boolean>>
  composerWorkingDirectory: string | null
  branchSwitcherOpen: boolean
  onOpenGit: (() => void) | undefined
  composerGitTitle: string | null
  composerGitSummary: GitSummary | null
  composerGitHasDetails: boolean
  handleComposerBranchSwitched: (summary: GitSummary) => void
  teammatesServices: WebPluginServices
  returnToChat: () => void
  rewindPreview: RewindPreview | null
  handleApplyRewind: () => Promise<void>
  setRewindPreview: Dispatch<SetStateAction<RewindPreview | null>>
  rollbackPreview: RollbackPreview | null
  handleApplyRollback: () => Promise<void>
  setRollbackPreview: Dispatch<SetStateAction<RollbackPreview | null>>
}

export function ComposerShell(props: ComposerShellProps) {
  const {
    isProject, composerCollapsed, handleComposerDragEnter, handleComposerDragOver,
    handleComposerDragLeave, handleComposerDrop, timelineWidth, viewMode, composerDropActive,
    setComposerCollapsed, modelsPending, sendError, sessionActionError, sessionActionNotice,
    session, codexExternalWriter, failedSend, restoreFailedSend, sendBusy, livePromptSuggestion,
    sendState, setInputText, inputTextRef, setLivePromptSuggestion, textareaRef, resizeComposer,
    colorTreatment, teammatesTab, composerTab, setComposerDock, teamAttention, activeProvider,
    selectedModelValue, commitClaudeModelSelection, modelOptions, effortOptions, selectedEffort,
    setSelectedEffort, selectedCopilotContextTier, setSelectedCopilotContextTier,
    selectedModelInfo, composerAgentOptions, selectedAgent, setSelectedAgent, composerModeOptions,
    selectedCopilotMode, commitCopilotModeSelection, selectedPermissionMode,
    commitClaudePermissionSelection, selectedCodexApproval, setSelectedCodexApproval,
    taskBudgetTokens, setTaskBudgetTokens, enableWorkflow, setEnableWorkflow, sessionCapabilities,
    rewindCandidates, rewindTargetId, setRewindTargetId, handleRewind, previewingRewind,
    applyingRewind, rollbackCandidates, rollbackTurns, setRollbackTurns, handleRollbackPreview,
    resumeFromMessageId, setResumeFromMessageId, pendingPermissions, sessionActionLoading,
    respondToQuestion, respondToPermission, respondToPlan, attachmentPanelOpen, attachments,
    attachmentType, setAttachmentType, attachmentPath, setAttachmentPath, addAttachment, inputText,
    removeAttachment, activeQueuedSends, composerQueueDurability, editQueuedSend, removeQueuedSend,
    mentionQuery, mentionResults, composerConfig, mentionActiveIndex, mentionItemRefs,
    insertMention, setMentionActiveIndex, slashOpen, slashCommands, slashActiveIndex,
    slashItemRefs, insertSlashCommand, setSlashActiveIndex, composerDraftKey,
    loadedComposerDraftKey, setAttachments, prewarmComposer, historyIndex, sentHistory,
    setHistoryIndex, draftBeforeHistoryRef, setSendError, setSendState, updateComposerHints,
    setMentionQuery, setSlashOpen, isComposingRef, handleKeyDown, handleComposerPaste,
    composerPlaceholder, canUseChannelBridge, channelBridge, composerQueueTargetKey,
    setAttachmentPanelOpen, setPromptLibraryOpen, promptLibraryOpen, insertPromptText,
    setChannelBridgeOpen, channelBridgeOpen, canUseIdeBridge, setIdeBridgeOpen, ideBridge,
    ideBridgeOpen, handleDiffCommentToComposer, contextUsage, reattachedRunning, sendMessage,
    canSubmitMessage, activeToolCount, backgroundClaudeTasks, backgroundingTasks, cancelSend,
    awaitingPersistedTurn, composerStatusColor, composerRuntime, composerStatusDetail,
    composerStatus, composerGitBranch, setBranchSwitcherOpen, composerWorkingDirectory,
    branchSwitcherOpen, onOpenGit, composerGitTitle, composerGitSummary, composerGitHasDetails,
    handleComposerBranchSwitched, teammatesServices, returnToChat, rewindPreview,
    handleApplyRewind, setRewindPreview, rollbackPreview, handleApplyRollback, setRollbackPreview,
  } = props
  return (
    !isProject && !composerCollapsed && <div
        className="av-web-composer-shell"
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
        style={{
          // The composer is part of the same column as the transcript, so it
          // tracks the width mode: a readable measure when centered, the whole
          // window when full.
          ['--av-composer-measure' as string]: timelineWidth === 'centered'
            ? (viewMode === 'stream' ? '900px' : '1040px')
            : '100%',
          padding: '12px clamp(16px, 4vw, 48px) 14px',
          borderTop: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
          background: composerDropActive ? 'rgba(56,217,245,0.06)' : 'color-mix(in srgb, var(--bg) 78%, var(--surface))',
          flexShrink: 0,
          position: 'relative',
          transition: 'background 120ms ease',
          outline: composerDropActive ? '1px dashed rgba(56,217,245,0.45)' : 'none',
          outlineOffset: composerDropActive ? -4 : 0,
        }}
      >
        <button
          type="button"
          className="av-hover-control"
          onClick={() => setComposerCollapsed(true)}
          title="Collapse composer"
          style={{
            position: 'absolute',
            top: 2,
            right: 18,
            zIndex: 5,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            color: 'var(--text-3)',
            padding: '1px 6px',
            borderRadius: 5,
            lineHeight: 1,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.08em',
          }}
        >
          ▼
        </button>
        {(modelsPending || sendError || sessionActionError || sessionActionNotice || (session?.provider === 'codex' && codexExternalWriter)) && (
          <div className="av-web-composer-banner-stack">
            {modelsPending && !sendError ? (
              <ComposerStatusBanner tone="info" icon={<LoaderCircle className="av-spin" size={14} />}>
                Loading available models…
              </ComposerStatusBanner>
            ) : null}
            {sendError ? (
              <ComposerStatusBanner
                tone="error"
                icon={<CircleAlert size={14} />}
                action={failedSend ? (
                  <Button
                    type="button"
                    onClick={restoreFailedSend}
                    disabled={sendBusy}
                    variant="outline"
                    size="sm"
                    className="av-web-composer-banner-retry"
                  >
                    <RotateCcw data-icon="inline-start" />
                    RETRY
                  </Button>
                ) : undefined}
              >
                {sendError}
              </ComposerStatusBanner>
            ) : null}
            {sessionActionError || sessionActionNotice ? (
              <ComposerStatusBanner
                tone={sessionActionError ? 'error' : sessionActionNotice?.toLowerCase().includes('queued') ? 'info' : 'success'}
                icon={sessionActionError
                  ? <TriangleAlert size={14} />
                  : sessionActionNotice?.toLowerCase().includes('queued')
                  ? <Clock3 size={14} />
                  : <CircleCheck size={14} />}
              >
                {sessionActionError ?? sessionActionNotice}
              </ComposerStatusBanner>
            ) : null}
            {session?.provider === 'codex' && codexExternalWriter ? (
              <ComposerStatusBanner tone="warning" icon={<MonitorUp size={14} />}>
                <strong>Another Codex client owns this session.</strong>{' '}
                Prompts queue there; the transcript updates when its turn finishes.
              </ComposerStatusBanner>
            ) : null}
          </div>
        )}
        {livePromptSuggestion && sendState !== 'sending' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'var(--text-3)',
              letterSpacing: '0.08em',
            }}>
              SUGGESTED
            </span>
            <button
              type="button"
              className="av-hover-control"
              onClick={() => {
                setInputText(livePromptSuggestion)
                inputTextRef.current = livePromptSuggestion
                setLivePromptSuggestion(null)
                window.requestAnimationFrame(() => {
                  textareaRef.current?.focus()
                  resizeComposer()
                })
              }}
              title={livePromptSuggestion}
              style={{
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontSize: 12,
                color: 'var(--text)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                padding: '3px 10px',
                cursor: 'pointer',
                textAlign: 'left',
                maxWidth: '60ch',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {livePromptSuggestion}
            </button>
            <button
              type="button"
              className="av-hover-control"
              onClick={() => setLivePromptSuggestion(null)}
              title="Dismiss suggestion"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: 'var(--text-3)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0 4px',
              }}
            >
              ✕
            </button>
          </div>
        )}
        <Card
          className="av-web-composer-card"
          style={{
            borderRadius: 16,
            border: '1px solid color-mix(in srgb, var(--border-2) 82%, transparent)',
            background: colorTreatment === 'flat' ? 'var(--surface)' : 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, white 1%) 0%, var(--surface) 100%)',
            boxShadow: '0 8px 24px var(--shadow, rgba(0,0,0,0.16))',
          }}
        >
          <CardHeader className="sr-only">
            <CardTitle>Message composer</CardTitle>
          </CardHeader>
          <Tabs value={teammatesTab ? composerTab : 'chat'} onValueChange={tab => setComposerDock({ sessionId: session?.sessionId ?? '', tab })} className="av-composer-dock">
            {session && teammatesTab ? <TabsList variant="line" aria-label="Composer" className="av-composer-dock-tabs">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="teammates">Teammates{teamAttention.sessionId === session.sessionId && teamAttention.count > 0 ? <span aria-label={`${teamAttention.count} need attention`} style={{ color: 'var(--amber)' }}> · {teamAttention.count}</span> : null}</TabsTrigger>
            </TabsList> : null}
            <TabsContent value="chat" forceMount className="av-composer-dock-pane">
          <CardContent className="av-web-composer-content" style={{ padding: '14px 16px 10px' }}>
            <div className="av-web-composer-controls" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 220px', minWidth: 0 }}>
                <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Model</Label>
                <ProviderIcon provider={activeProvider} size={18} className="av-web-composer-provider-icon" />
                <NativeSelect
                  value={selectedModelValue ?? ''}
                  onChange={(event) => commitClaudeModelSelection(event.target.value)}
                  className={cn(compactNativeSelectClassName, 'flex-1')}
                >
                  {modelOptions.length === 0 ? (
                    <NativeSelectOption value="" disabled>
                      No models
                    </NativeSelectOption>
                  ) : (
                    modelOptions.map((model) => (
                      <NativeSelectOption key={model.value} value={model.value}>
                        {model.displayName}
                      </NativeSelectOption>
                    ))
                  )}
                </NativeSelect>
              </label>
              {effortOptions.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 150px', minWidth: 128 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Effort</Label>
                  <NativeSelect
                    value={selectedEffort}
                    onChange={(event) => setSelectedEffort(event.target.value as 'auto' | ReasoningEffortLevel)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                  >
                    <NativeSelectOption value="auto">Auto</NativeSelectOption>
                    {effortOptions.map((level) => (
                      <NativeSelectOption key={level} value={level}>
                        {effortLabel(level)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              {activeProvider === 'copilot' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 148px', minWidth: 128 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Context</Label>
                  <NativeSelect
                    value={selectedCopilotContextTier ?? 'default'}
                    onChange={(event) => setSelectedCopilotContextTier(event.target.value as CopilotContextTier)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="GitHub Copilot context tier"
                  >
                    <NativeSelectOption value="default">Default</NativeSelectOption>
                    <NativeSelectOption
                      value="long_context"
                      disabled={!selectedModelInfo?.supportsLongContext}
                    >
                      Long context
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              {activeProvider === 'opencode' && composerAgentOptions.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 160px', minWidth: 136 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Agent</Label>
                  <NativeSelect
                    value={selectedAgent}
                    onChange={(event) => setSelectedAgent(event.target.value)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="OpenCode primary agent — mirrors the native agent selector"
                  >
                    {composerAgentOptions.map((agent) => (
                      <NativeSelectOption key={agent.value} value={agent.value}>
                        {agent.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              {activeProvider === 'copilot' && composerModeOptions.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 160px', minWidth: 138 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Mode</Label>
                  <NativeSelect
                    value={selectedCopilotMode}
                    onChange={(event) => commitCopilotModeSelection(event.target.value)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="GitHub Copilot interaction mode"
                  >
                    {composerModeOptions.map((mode) => (
                      <NativeSelectOption key={mode.value} value={mode.value}>
                        {mode.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              {session?.provider === 'claude' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 160px', minWidth: 140 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Mode</Label>
                  <NativeSelect
                    value={selectedPermissionMode}
                    onChange={(event) => commitClaudePermissionSelection(event.target.value as typeof selectedPermissionMode)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="Claude permission mode — mirrors the CLI's /permissions"
                  >
                    <NativeSelectOption value="default">Default</NativeSelectOption>
                    <NativeSelectOption value="acceptEdits">Accept edits</NativeSelectOption>
                    <NativeSelectOption value="auto">Auto</NativeSelectOption>
                    <NativeSelectOption value="plan">Plan</NativeSelectOption>
                    <NativeSelectOption value="bypassPermissions">Bypass permissions</NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              {session?.provider === 'codex' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 180px', minWidth: 150 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Approvals</Label>
                  <NativeSelect
                    value={selectedCodexApproval}
                    onChange={(event) => setSelectedCodexApproval(event.target.value as typeof selectedCodexApproval)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="Codex approval policy — mirrors the CLI's /approvals (AskForApproval)"
                  >
                    <NativeSelectOption value="auto">From config</NativeSelectOption>
                    <NativeSelectOption value="untrusted">Untrusted</NativeSelectOption>
                    <NativeSelectOption value="on-request">On request</NativeSelectOption>
                    <NativeSelectOption value="never">Never</NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              {session?.provider === 'claude' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 140px', minWidth: 120 }}>
                  <Label style={{ fontSize: 11, color: 'var(--text-3)' }}>Token budget</Label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1000}
                    placeholder="—"
                    title="Task token budget (tokens). The model paces itself toward this cap. Leave blank for no budget."
                    value={taskBudgetTokens ?? ''}
                    onChange={(event) => {
                      const next = event.target.value.trim()
                      if (!next) { setTaskBudgetTokens(null); return }
                      const parsed = Number(next)
                      setTaskBudgetTokens(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null)
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 26,
                      padding: '0 6px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: 'var(--text)',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 5,
                      letterSpacing: '0.04em',
                    }}
                  />
                </label>
              )}
              {session?.provider === 'claude' && (
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto', cursor: 'pointer' }}
                  title="Opt this turn into the Workflow tool (settings.enableWorkflows) — Claude can orchestrate multiple subagents via a generated script. Requires plan support."
                >
                  <input
                    type="checkbox"
                    checked={enableWorkflow}
                    onChange={(event) => setEnableWorkflow(event.target.checked)}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Workflow</span>
                </label>
              )}
              {sessionCapabilities?.fileRewind && rewindCandidates.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 300px', minWidth: 220 }}>
                  <NativeSelect
                    value={rewindTargetId}
                    onChange={(event) => setRewindTargetId(event.target.value)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                  >
                    <NativeSelectOption value="" disabled>
                      Rewind target
                    </NativeSelectOption>
                    {rewindCandidates.slice().reverse().map((candidate) => (
                      <NativeSelectOption key={candidate.uuid} value={candidate.uuid}>
                        {candidate.content.replace(/\s+/g, ' ').trim().slice(0, 72) || candidate.uuid}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    onClick={handleRewind}
                    disabled={previewingRewind || applyingRewind || !rewindTargetId}
                    variant="outline"
                    size="sm"
                    style={{
                      flexShrink: 0,
                      height: 26,
                      padding: '0 10px',
                      background: 'rgba(251,191,36,0.08)',
                      border: '1px solid rgba(251,191,36,0.22)',
                      borderRadius: 5,
                      color: 'var(--yellow, #fbbf24)',
                      fontSize: 12,
                      cursor: previewingRewind || applyingRewind || !rewindTargetId ? 'not-allowed' : 'pointer',
                      opacity: previewingRewind || applyingRewind || !rewindTargetId ? 0.5 : 1,
                    }}
                  >
                    {previewingRewind ? 'Previewing…' : 'Rewind'}
                  </Button>
                </div>
              )}
              {sessionCapabilities?.rollback && rollbackCandidates.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 170px', minWidth: 146 }}>
                  <NativeSelect
                    value={String(rollbackTurns)}
                    onChange={(event) => setRollbackTurns(Number(event.target.value))}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                  >
                    {Array.from({ length: Math.min(10, rollbackCandidates.length) }, (_, index) => index + 1).map((value) => (
                      <NativeSelectOption key={value} value={String(value)}>
                        {value} turn{value === 1 ? '' : 's'}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Button
                    onClick={handleRollbackPreview}
                    disabled={previewingRewind || applyingRewind}
                    variant="outline"
                    size="sm"
                    style={{
                      flexShrink: 0,
                      height: 26,
                      padding: '0 8px',
                      background: 'rgba(251,191,36,0.08)',
                      border: '1px solid rgba(251,191,36,0.22)',
                      borderRadius: 5,
                      color: 'var(--yellow, #fbbf24)',
                      fontSize: 12,
                      cursor: previewingRewind || applyingRewind ? 'not-allowed' : 'pointer',
                      opacity: previewingRewind || applyingRewind ? 0.5 : 1,
                    }}
                  >
                    {previewingRewind ? 'Previewing…' : 'Roll back'}
                  </Button>
                </div>
              )}
            </div>
            {sessionCapabilities?.resumeAtMessage && resumeFromMessageId && (
              <div style={{
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: 'var(--cyan)',
                letterSpacing: '0.03em',
              }}>
                <span>Safe resume armed — next send forks at the selected timeline point and guards the discarded turn.</span>
                <Button
                  onClick={() => setResumeFromMessageId(null)}
                  variant="outline"
                  size="sm"
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(56,217,245,0.22)',
                    background: 'rgba(56,217,245,0.08)',
                    color: 'var(--cyan)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                  }}
                >
                  CLEAR
                </Button>
              </div>
            )}
            {pendingPermissions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {pendingPermissions.map((permission) => (
                  permission.questions && permission.questions.length > 0 ? (
                    <AskUserQuestionPicker
                      key={permission.id}
                      permission={permission}
                      busy={sessionActionLoading === `permission:${permission.id}`}
                      onSubmit={(answers) => respondToQuestion(permission, answers)}
                      onCancel={() => respondToPermission(permission, 'reject')}
                    />
                  ) : permission.toolName === 'ExitPlanMode' ? (
                    <PlanApprovalCard
                      key={permission.id}
                      permission={permission}
                      busy={sessionActionLoading === `permission:${permission.id}`}
                      onApprove={(mode) => respondToPlan(permission, mode)}
                      onReject={() => respondToPlan(permission, 'reject')}
                    />
                  ) : (
                  <div
                    key={permission.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '8px 9px',
                      borderRadius: 6,
                      border: '1px solid rgba(234,170,64,0.24)',
                      background: 'rgba(234,170,64,0.07)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.06em' }}>
                          {permission.title}
                        </div>
                        {permissionMcpServerLabel(permission) ? (
                          <div style={{ marginTop: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: permission.mcpServer?.source === 'sdk' ? 'var(--text-3)' : 'var(--cyan)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {permissionMcpServerLabel(permission)}
                          </div>
                        ) : null}
                        {permission.reason ? (
                          <div style={{ marginTop: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {permission.reason}
                          </div>
                        ) : permission.detail ? (
                          <div style={{ marginTop: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {permission.detail}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {/* `defaultToDeny` asks must not put approve where a
                            reflex click lands, so Reject leads the row instead
                            of trailing it. Every option is still offered — the
                            constraint is on emphasis, not on the decision. */}
                        {(permission.defaultToDeny
                          ? (['reject', 'once', 'always'] as const)
                          : (['once', 'always', 'reject'] as const))
                          .filter((response) => response !== 'always' || permission.canApproveAlways !== false)
                          .map((response) => (
                          <Button
                            key={response}
                            onClick={() => respondToPermission(permission, response)}
                            disabled={sessionActionLoading === `permission:${permission.id}`}
                            variant="outline"
                            size="sm"
                            style={{
                              height: 24,
                              padding: '0 8px',
                              borderRadius: 4,
                              border: response === 'reject' ? '1px solid rgba(248,113,113,0.24)' : '1px solid rgba(45,212,160,0.24)',
                              background: response === 'reject' ? 'rgba(248,113,113,0.08)' : 'rgba(45,212,160,0.08)',
                              color: response === 'reject' ? 'var(--red, #f87171)' : 'var(--green)',
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: 11,
                              letterSpacing: '0.06em',
                              cursor: sessionActionLoading === `permission:${permission.id}` ? 'not-allowed' : 'pointer',
                              opacity: sessionActionLoading === `permission:${permission.id}` ? 0.55 : 1,
                            }}
                          >
                            {response === 'once' && permission.elicitation?.mode === 'url'
                              ? 'OPEN & CONTINUE'
                              : response === 'once' ? 'Allow' : response}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {permission.command && (
                      <pre style={{ margin: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-2)', background: 'rgba(0,0,0,0.18)', padding: '5px 7px', borderRadius: 4, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {`$ ${permission.command}`}
                      </pre>
                    )}
                    {permission.url && (
                      <a
                        href={permission.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--cyan)', wordBreak: 'break-all' }}
                      >
                        {permission.url}
                      </a>
                    )}
                    {permission.paths && permission.paths.length > 0 && (
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', wordBreak: 'break-all' }}>
                        {permission.paths.join(', ')}
                      </div>
                    )}
                    {permission.diff && (
                      <PierrePatchDiffView patch={permission.diff} maxHeight={180} />
                    )}
                  </div>
                  )
                ))}
              </div>
            )}
            {(attachmentPanelOpen || attachments.length > 0) && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <NativeSelect
                value={attachmentType}
                onChange={(event) => setAttachmentType(event.target.value as SendAttachment['type'])}
                className={cn(compactNativeSelectClassName, 'w-[112px]')}
              >
                <NativeSelectOption value="file">FILE</NativeSelectOption>
                <NativeSelectOption value="directory">DIR</NativeSelectOption>
                <NativeSelectOption value="image">IMAGE</NativeSelectOption>
                <NativeSelectOption value="mention">MENTION</NativeSelectOption>
                <NativeSelectOption value="skill">SKILL</NativeSelectOption>
                {activeProvider === 'opencode' && (
                  <NativeSelectOption value="agent">AGENT</NativeSelectOption>
                )}
              </NativeSelect>
              <Input
                value={attachmentPath}
                onChange={(event) => setAttachmentPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addAttachment()
                  }
                }}
                disabled={sendBusy}
                placeholder={attachmentType === 'agent' ? 'Agent name' : 'Attach path or URL'}
                style={{
                  flex: '1 1 220px',
                  minWidth: 180,
                  height: 26,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  color: 'var(--text)',
                  padding: '0 8px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                }}
              />
              <Button
                onClick={addAttachment}
                disabled={!attachmentPath.trim() || sendBusy}
                variant="outline"
                size="sm"
                style={{
                  height: 26,
                  padding: '0 8px',
                  borderRadius: 5,
                  border: '1px solid rgba(56,217,245,0.22)',
                  background: 'rgba(56,217,245,0.07)',
                  color: 'var(--cyan)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  cursor: !attachmentPath.trim() || sendBusy ? 'not-allowed' : 'pointer',
                  opacity: !attachmentPath.trim() || sendBusy ? 0.5 : 1,
                }}
              >
                ADD
              </Button>
              {attachments.map((attachment, index) => {
                if (attachment.contextKind && !contextReferences(inputText).some(ref => ref.id === attachment.id)) return null
                const previewSrc = attachmentImagePreviewSrc(attachment)
                const isImage = previewSrc !== null
                return (
                  <button
                    key={attachment.id ?? `${attachment.type}-${index}`}
                    type="button"
                    className="av-hover-control"
                    onClick={() => removeAttachment(attachment.id, index)}
                    disabled={sendBusy}
                    title={`Click to remove · ${attachment.path ?? attachment.filePath ?? attachmentDisplayName(attachment)}`}
                    style={isImage ? {
                      height: 46,
                      maxWidth: 220,
                      borderRadius: 6,
                      border: '1px solid rgba(139,128,240,0.32)',
                      background: 'rgba(139,128,240,0.10)',
                      color: 'var(--violet)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      padding: '3px 8px 3px 3px',
                      cursor: sendBusy ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    } : {
                      height: 24,
                      maxWidth: 180,
                      borderRadius: 5,
                      border: '1px solid rgba(139,128,240,0.22)',
                      background: 'rgba(139,128,240,0.08)',
                      color: 'var(--violet)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      padding: '0 7px',
                      cursor: sendBusy ? 'not-allowed' : 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isImage && previewSrc ? (
                      <>
                        <img
                          src={previewSrc}
                          alt={attachmentDisplayName(attachment)}
                          style={{ height: 40, width: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                          {attachmentDisplayName(attachment)}
                        </span>
                      </>
                    ) : (
                      `${attachment.type} ${attachmentDisplayName(attachment)}`
                    )}
                  </button>
                )
              })}
            </div>
            )}
            {activeQueuedSends.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.02em',
                  textTransform: 'capitalize',
                  color: 'var(--amber, #eaaa40)',
                  opacity: 0.85,
                }}>
                  Queued ({activeQueuedSends.length})
                </span>
                <span
                  role="status"
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: composerQueueDurability === 'memory-only'
                      ? 'var(--red, #f87171)'
                      : composerQueueDurability === 'saving'
                      ? 'var(--cyan)'
                      : 'var(--text-3)',
                  }}
                  title={composerQueueDurability === 'memory-only'
                    ? 'Browser storage is unavailable. Keep this tab open or edit the queued message back into the composer.'
                    : composerQueueDurability === 'saving'
                    ? 'Saving queued messages to browser storage…'
                    : 'Queued messages are saved in browser storage.'}
                >
                  {composerQueueDurability === 'memory-only'
                    ? 'Memory only'
                    : composerQueueDurability === 'saving'
                    ? 'Saving…'
                    : 'Saved'}
                </span>
                {activeQueuedSends.map((entry, index) => {
                  const preview = entry.text.replace(/\s+/g, ' ').trim()
                  const short = preview.length > 48 ? `${preview.slice(0, 48)}…` : preview
                  const attachmentSuffix = entry.attachments.length > 0 ? ` +${entry.attachments.length}` : ''
                  return (
                    <span
                      key={entry.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        maxWidth: 280,
                        height: 22,
                        borderRadius: 5,
                        border: '1px solid rgba(234,170,64,0.30)',
                        background: 'rgba(234,170,64,0.08)',
                        padding: '0 4px 0 8px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                        color: 'var(--amber, #eaaa40)',
                      }}
                    >
                      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{index + 1}.</span>
                      <button
                        type="button"
                        className="av-hover-control"
                        onClick={() => editQueuedSend(entry.id)}
                        title="Click to edit this queued message"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 0,
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: 'inherit',
                          fontSize: 'inherit',
                        }}
                      >
                        {short || '(empty)'}{attachmentSuffix}
                      </button>
                      <button
                        type="button"
                        className="av-hover-control"
                        onClick={() => removeQueuedSend(entry.id)}
                        title="Remove from queue"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-3)',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: 12,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <div className="av-web-composer-input-row" style={{ position: 'relative' }}>
              {mentionQuery && mentionResults.length > 0 && (
                <div style={composerPopoverStyle}>
                  <div style={{ ...composerPopoverHintStyle, color: `var(${composerConfig.cssAccentVar})` }}>
                    {composerConfig.label} {activeProvider === 'opencode' ? 'files/agents' : 'files'} · ↑↓ select · ⏎ insert · esc cancel
                  </div>
                  {mentionResults.map((entry, index) => {
                    const active = index === mentionActiveIndex
                    const label = entry.kind === 'agent' ? `@${entry.name}` : entry.basename
                    const detail = entry.kind === 'agent'
                      ? [entry.mode, entry.description].filter(Boolean).join(' · ')
                      : entry.path
                    return (
                      <button
                        key={entry.kind === 'agent' ? `agent:${entry.name}` : `file:${entry.path}`}
                        type="button"
                        className="av-hover-control"
                        ref={(node) => { mentionItemRefs.current[index] = node }}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          insertMention(entry)
                        }}
                        onMouseEnter={() => setMentionActiveIndex(index)}
                        style={{
                          ...composerPopoverItemStyle,
                          background: active ? `rgba(${composerConfig.cssAccentRgb},0.18)` : 'transparent',
                          color: active ? `var(${composerConfig.cssAccentVar})` : 'var(--text-2, var(--text))',
                        }}
                      >
                        <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
                        <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: 10 }}>{detail}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {slashOpen && slashCommands.length > 0 && !mentionQuery && (
                <div style={composerPopoverStyle}>
                  <div style={{ ...composerPopoverHintStyle, color: `var(${composerConfig.cssAccentVar})` }}>
                    {composerConfig.label} commands · ↑↓ select · tab insert · esc cancel
                  </div>
                  {slashCommands.map((entry, index) => {
                    const active = index === slashActiveIndex
                    return (
                      <button
                        key={entry.command}
                        type="button"
                        className="av-hover-control"
                        ref={(node) => { slashItemRefs.current[index] = node }}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          insertSlashCommand(entry.command)
                        }}
                        onMouseEnter={() => setSlashActiveIndex(index)}
                        style={{
                          ...composerPopoverItemStyle,
                          background: active ? `rgba(${composerConfig.cssAccentRgb},0.18)` : 'transparent',
                          color: active ? `var(${composerConfig.cssAccentVar})` : 'var(--text-2, var(--text))',
                        }}
                      >
                        <span style={{ fontWeight: active ? 600 : 400 }}>{entry.command}</span>
                        {entry.argumentHint && (
                          <span style={{ marginLeft: 6, color: 'var(--text-3)', fontSize: 10, fontStyle: 'italic', opacity: 0.85 }}>
                            {entry.argumentHint}
                          </span>
                        )}
                        <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: 10 }}>{entry.description}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <ContextComposer
                key={composerDraftKey}
                attachments={loadedComposerDraftKey === composerDraftKey ? attachments : []}
                onAttachments={(incoming) => setAttachments(prev => mergeComposerAttachments(prev, incoming))}
                className="av-web-composer-textarea"
                ref={textareaRef}
                value={loadedComposerDraftKey === composerDraftKey ? inputText : ''}
                onFocus={prewarmComposer}
                onValueChange={(next, cursor) => {
                  setInputText(next)
                  inputTextRef.current = next
                  if (historyIndex !== -1 && next !== sentHistory[historyIndex]) {
                    setHistoryIndex(-1)
                    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
                  }
                  if (sendError && !failedSend) {
                    setSendError(null)
                    setSendState('idle')
                  }
                  updateComposerHints(next, cursor)
                }}
                onCaretChange={updateComposerHints}
                onBlur={() => { setMentionQuery(null); setSlashOpen(false) }}
                onCompositionStart={() => { isComposingRef.current = true }}
                onCompositionEnd={() => { isComposingRef.current = false }}
                onKeyDown={handleKeyDown}
                onPaste={handleComposerPaste}
                placeholder={composerPlaceholder}
                style={{
                  width: '100%',
                  minHeight: 66,
                  resize: 'none',
                  background: 'transparent',
                  border: `1px solid ${
                    sendState === 'error'
                      ? 'rgba(248,113,113,0.4)'
                      : canUseChannelBridge && channelBridge.routeComposer
                      ? `rgba(${composerConfig.cssAccentRgb},0.45)`
                      : 'transparent'
                  }`,
                  borderRadius: 10,
                  padding: '2px 3px 8px',
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontSize: 15,
                  color: 'var(--text)',
                  lineHeight: 1.55,
                  outline: 'none',
                  overflowX: 'hidden',
                  overflowY: 'hidden',
                  transition: 'border-color 0.15s, opacity 0.15s',
                }}
              />
              <div className="av-web-composer-actions">
              <VoiceInput key={composerQueueTargetKey} onTranscript={(text) => setInputText((current) => current ? `${current} ${text}` : text)} />
              <Button
                type="button"
                onClick={() => setAttachmentPanelOpen((open) => !open)}
                variant="outline"
                aria-label="Add attachment"
                aria-expanded={attachmentPanelOpen}
                title="Attach a file, folder, image, skill, or mention"
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  padding: 0,
                  background: attachmentPanelOpen ? `rgba(${composerConfig.cssAccentRgb},0.18)` : 'transparent',
                  border: `1px solid ${attachmentPanelOpen ? `rgba(${composerConfig.cssAccentRgb},0.4)` : 'transparent'}`,
                  borderRadius: 999,
                  color: attachmentPanelOpen ? `var(${composerConfig.cssAccentVar})` : 'var(--text-2)',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
              >
                <Paperclip size={16} />
              </Button>
              <Button
                type="button"
                data-prompt-library-trigger="true"
                onClick={() => setPromptLibraryOpen((open) => !open)}
                variant="outline"
                aria-label="Prompt library"
                title="Prompt library — saved prompts you can insert into the composer"
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  padding: 0,
                  background: promptLibraryOpen ? `rgba(${composerConfig.cssAccentRgb},0.18)` : 'var(--surface-2)',
                  border: `1px solid ${promptLibraryOpen ? `rgba(${composerConfig.cssAccentRgb},0.4)` : 'var(--border-2)'}`,
                  borderRadius: 6,
                  color: promptLibraryOpen ? `var(${composerConfig.cssAccentVar})` : 'var(--text-2)',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                }}
              >
                <BookOpen size={15} />
              </Button>
              {promptLibraryOpen && (
                <PromptLibrary
                  accent={{ cssVar: composerConfig.cssAccentVar, cssRgb: composerConfig.cssAccentRgb, label: composerConfig.label }}
                  activeProvider={session?.provider}
                  onInsert={insertPromptText}
                  onClose={() => setPromptLibraryOpen(false)}
                />
              )}
              {canUseChannelBridge ? (
                <Button
                  type="button"
                  data-channel-bridge-trigger="true"
                  onClick={() => setChannelBridgeOpen((open) => !open)}
                  variant="outline"
                  aria-label="Live CLI bridge"
                  aria-pressed={channelBridge.routeComposer}
                  title={channelBridge.routeComposer
                    ? 'Live CLI bridge — composer is routing to the live `claude` CLI session (click to open)'
                    : 'Live CLI bridge — push messages into a `claude` CLI session running alongside agentViewer'}
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    padding: 0,
                    background: channelBridgeOpen || channelBridge.routeComposer ? `rgba(${composerConfig.cssAccentRgb},0.18)` : 'var(--surface-2)',
                    border: `1px solid ${channelBridgeOpen || channelBridge.routeComposer ? `rgba(${composerConfig.cssAccentRgb},0.4)` : 'var(--border-2)'}`,
                    borderRadius: 6,
                    color: channelBridgeOpen || channelBridge.routeComposer ? `var(${composerConfig.cssAccentVar})` : 'var(--text-2)',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                  }}
                >
                  <Radio size={15} />
                  {channelBridge.unread > 0 && !channelBridgeOpen && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
                        minWidth: 13,
                        height: 13,
                        padding: '0 3px',
                        borderRadius: 999,
                        background: `var(${composerConfig.cssAccentVar})`,
                        color: 'var(--surface)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: '13px',
                        textAlign: 'center',
                      }}
                    >
                      {channelBridge.unread > 9 ? '9+' : channelBridge.unread}
                    </span>
                  )}
                </Button>
              ) : null}
              {canUseChannelBridge && channelBridgeOpen && (
                <ChannelBridgePanel
                  accent={{ cssVar: composerConfig.cssAccentVar, cssRgb: composerConfig.cssAccentRgb, label: composerConfig.label }}
                  bridge={channelBridge}
                  onClose={() => setChannelBridgeOpen(false)}
                />
              )}
              {canUseIdeBridge ? (
                <Button
                  type="button"
                  data-ide-bridge-trigger="true"
                  onClick={() => setIdeBridgeOpen((open) => !open)}
                  variant="outline"
                  aria-label="IDE bridge"
                  aria-pressed={ideBridge.routeComposer}
                  title={ideBridge.routeComposer
                    ? 'IDE bridge — composer is pushing @mentions to the connected `claude` session (click to open)'
                    : 'IDE bridge — host a Claude Code IDE endpoint a `claude` CLI session connects to'}
                  style={{
                    position: 'relative',
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    padding: 0,
                    background: ideBridgeOpen || ideBridge.routeComposer ? `rgba(${composerConfig.cssAccentRgb},0.18)` : 'var(--surface-2)',
                    border: `1px solid ${ideBridgeOpen || ideBridge.routeComposer ? `rgba(${composerConfig.cssAccentRgb},0.4)` : 'var(--border-2)'}`,
                    borderRadius: 6,
                    color: ideBridgeOpen || ideBridge.routeComposer ? `var(${composerConfig.cssAccentVar})` : 'var(--text-2)',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                  }}
                >
                  <Plug size={15} />
                  {ideBridge.unread > 0 && !ideBridgeOpen && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
                        minWidth: 13,
                        height: 13,
                        padding: '0 3px',
                        borderRadius: 999,
                        background: `var(${composerConfig.cssAccentVar})`,
                        color: 'var(--surface)',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: '13px',
                        textAlign: 'center',
                      }}
                    >
                      {ideBridge.unread > 9 ? '9+' : ideBridge.unread}
                    </span>
                  )}
                </Button>
              ) : null}
              {canUseIdeBridge && ideBridgeOpen && (
                <IdeBridgePanel
                  accent={{ cssVar: composerConfig.cssAccentVar, cssRgb: composerConfig.cssAccentRgb, label: composerConfig.label }}
                  bridge={ideBridge}
                  onClose={() => setIdeBridgeOpen(false)}
                  onSendComment={handleDiffCommentToComposer}
                />
              )}
              <ComposerContextUsageRing usage={contextUsage} />
              {sendState === 'sending' || reattachedRunning ? (
                <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Button
                    className="av-web-composer-send"
                    type="button"
                    onClick={() => { void sendMessage() }}
                    disabled={!canSubmitMessage}
                    variant="outline"
                    aria-label="Queue message after current turn"
                    title="Queue message after current turn"
                    style={{
                      width: 34,
                      height: 34,
                      padding: 0,
                      background: canSubmitMessage ? `var(${composerConfig.cssAccentVar})` : `rgba(${composerConfig.cssAccentRgb},0.18)`,
                      border: `1px solid rgba(${composerConfig.cssAccentRgb},${canSubmitMessage ? '0.75' : '0.3'})`,
                      borderRadius: 999,
                      color: `var(${composerConfig.cssAccentVar})`,
                      fontFamily: "'Oxanium', monospace",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      cursor: !canSubmitMessage ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s, color 0.15s',
                      whiteSpace: 'nowrap',
                      opacity: !canSubmitMessage ? 0.55 : 1,
                    }}
                  >
                    <ArrowUp data-icon="inline-start" />
                  </Button>
                  {session?.provider === 'claude' && activeToolCount > 0 ? (
                    <Button
                      type="button"
                      onClick={() => { void backgroundClaudeTasks() }}
                      disabled={backgroundingTasks}
                      variant="outline"
                      aria-label="Move Claude task to background"
                      title="Move Claude task to background (Ctrl+B)"
                      style={{
                        width: 34,
                        height: 34,
                        padding: 0,
                        background: 'rgba(56,189,248,0.1)',
                        border: '1px solid rgba(56,189,248,0.3)',
                        borderRadius: 6,
                        color: 'var(--cyan)',
                        fontFamily: "'Oxanium', monospace",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.1em',
                        cursor: backgroundingTasks ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s',
                        whiteSpace: 'nowrap',
                        opacity: backgroundingTasks ? 0.55 : 1,
                      }}
                    >
                      <Minimize2 data-icon="inline-start" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={cancelSend}
                    variant="outline"
                    aria-label="Cancel send"
                    title="Cancel send"
                    style={{
                      width: 34,
                      height: 34,
                      padding: 0,
                      background: 'rgba(248,113,113,0.1)',
                      border: '1px solid rgba(248,113,113,0.3)',
                      borderRadius: 6,
                      color: 'var(--red, #f87171)',
                      fontFamily: "'Oxanium', monospace",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Square data-icon="inline-start" />
                  </Button>
                </div>
              ) : (
                <Button
                  className="av-web-composer-send"
                  type="button"
                  onClick={() => { void sendMessage() }}
                  disabled={!canSubmitMessage}
                  aria-label={awaitingPersistedTurn ? 'Queue message after current turn' : `${composerConfig.sendVerb} to ${composerConfig.label}`}
                  title={awaitingPersistedTurn ? 'Queue message after current turn' : `${composerConfig.sendVerb} to ${composerConfig.label}`}
                  style={{
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    padding: 0,
                    background: canSubmitMessage ? `var(${composerConfig.cssAccentVar})` : `rgba(${composerConfig.cssAccentRgb},0.18)`,
                    border: `1px solid rgba(${composerConfig.cssAccentRgb},${canSubmitMessage ? '0.75' : '0.3'})`,
                    borderRadius: 999,
                    color: canSubmitMessage ? 'var(--surface)' : `var(${composerConfig.cssAccentVar})`,
                    fontFamily: "'Oxanium', monospace",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    cursor: !canSubmitMessage ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                    opacity: !canSubmitMessage ? 0.55 : 1,
                  }}
                >
                  <ArrowUp data-icon="inline-start" />
                </Button>
              )}
              </div>
            </div>
            <div
              className="av-web-composer-status"
              aria-live="polite"
              style={{
                marginTop: 6,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                color: composerStatusColor,
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                justifyContent: 'space-between',
                flexWrap: 'wrap',
              }}
            >
              <span
                role="status"
                data-composer-runtime-phase={composerRuntime.phase}
                data-composer-transport-state={composerRuntime.transport}
                data-composer-transcript-state={composerRuntime.transcript}
                data-composer-queue-state={composerRuntime.queue}
                title={composerStatusDetail}
                aria-label={`${composerStatus}. ${composerStatusDetail}`}
              >
                <span style={{ color: `var(${composerConfig.cssAccentVar})`, marginRight: 6, fontWeight: 600 }}>{composerConfig.glyph}</span>
                {composerStatus}
              </span>
              <span className="av-web-composer-meta">
                <span className="av-web-composer-hint">
                  {sendBusy ? composerConfig.footerHintSending : composerConfig.footerHintIdle}
                  {!sendBusy && sentHistory.length > 0 ? ` (${sentHistory.length})` : ''}
                </span>
                {composerGitBranch ? (
                  <span className="av-web-composer-git-cluster">
                    <button
                      type="button"
                      className="av-web-composer-git-branch"
                      data-branch-switcher-trigger="true"
                      onClick={() => setBranchSwitcherOpen((current) => !current)}
                      disabled={!composerWorkingDirectory}
                      aria-haspopup="listbox"
                      aria-expanded={branchSwitcherOpen}
                      title={`Switch branch from ${composerGitBranch}`}
                    >
                      <GitBranch aria-hidden size={13} />
                      <span>{composerGitBranch}</span>
                      <ChevronDown aria-hidden size={11} />
                    </button>
                    <button
                      type="button"
                      className="av-web-composer-git-counts"
                      onClick={onOpenGit}
                      disabled={!onOpenGit}
                      title={composerGitTitle ? `${composerGitTitle} · Open Git status` : 'Open Git status'}
                      aria-label={composerGitTitle ? `Open Git status. ${composerGitTitle}` : 'Open Git status'}
                    >
                      {composerGitSummary?.modified ? <span className="av-web-composer-git-dirty">~{composerGitSummary.modified}</span> : null}
                      {composerGitSummary?.untracked ? <span>?{composerGitSummary.untracked}</span> : null}
                      {composerGitSummary?.stashes ? <span className="av-web-composer-git-dirty">*{composerGitSummary.stashes}</span> : null}
                      {!composerGitHasDetails ? <span>{composerGitSummary ? 'clean' : 'status'}</span> : null}
                    </button>
                    {composerWorkingDirectory ? (
                      <BranchSwitcher
                        cwd={composerWorkingDirectory}
                        currentBranch={composerGitBranch}
                        open={branchSwitcherOpen}
                        onOpenChange={setBranchSwitcherOpen}
                        onSwitched={handleComposerBranchSwitched}
                      />
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
          </CardContent>
            </TabsContent>
            {session && teammatesTab ? <TabsContent value="teammates" forceMount className="av-composer-dock-pane">
              <PluginSurfaceHost surfaceId="teammates" placement="panel" sessionKey={sessionIdentityKey(session)} services={teammatesServices} onClose={returnToChat} />
            </TabsContent> : null}
          </Tabs>
        </Card>
        {rewindPreview && (
          <Card
            style={{
              marginTop: 10,
              borderRadius: 8,
              border: '1px solid rgba(251,191,36,0.22)',
              background: 'rgba(251,191,36,0.06)',
            }}
          >
            <CardHeader style={{ padding: '12px 14px 0' }}>
              <CardTitle style={{ fontFamily: "'Oxanium', monospace", fontSize: 12, fontWeight: 600, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.08em' }}>
                Rewind Preview
              </CardTitle>
            </CardHeader>
            <CardContent style={{ padding: '6px 14px 0' }}>
              <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                {rewindPreview.contentPreview || 'Selected prompt'}
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {rewindPreview.filesChanged.length > 0 ? rewindPreview.filesChanged.map((file) => (
                  <div
                    key={file}
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: 'var(--text-2)',
                      padding: '5px 8px',
                      borderRadius: 5,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {file}
                  </div>
                )) : (
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                    No tracked files would change.
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter style={{ padding: '10px 14px 12px', display: 'flex', gap: 8 }}>
                <Button
                  onClick={handleApplyRewind}
                  disabled={applyingRewind}
                  variant="outline"
                  size="sm"
                  style={{
                    height: 28,
                    padding: '0 12px',
                    background: 'rgba(251,191,36,0.12)',
                    border: '1px solid rgba(251,191,36,0.28)',
                    borderRadius: 5,
                    color: 'var(--yellow, #fbbf24)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    cursor: applyingRewind ? 'not-allowed' : 'pointer',
                    opacity: applyingRewind ? 0.5 : 1,
                  }}
                >
                  {applyingRewind ? 'Applying…' : 'Apply rewind'}
                </Button>
                <Button
                  onClick={() => setRewindPreview(null)}
                  variant="outline"
                  size="sm"
                  style={{
                    height: 28,
                    padding: '0 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 5,
                    color: 'var(--text-3)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                  }}
                >
                  CANCEL
                </Button>
            </CardFooter>
          </Card>
        )}
        {rollbackPreview && (
          <Card
            style={{
              marginTop: 10,
              borderRadius: 8,
              border: '1px solid rgba(251,191,36,0.22)',
              background: 'rgba(251,191,36,0.06)',
            }}
          >
            <CardHeader style={{ padding: '12px 14px 0' }}>
              <CardTitle style={{ fontFamily: "'Oxanium', monospace", fontSize: 12, fontWeight: 600, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.08em' }}>
                Rollback Preview
              </CardTitle>
            </CardHeader>
            <CardContent style={{ padding: '6px 14px 0' }}>
              <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                This removes the last {rollbackPreview.numTurns} turn{rollbackPreview.numTurns === 1 ? '' : 's'} from the Codex thread history. It does not revert files in the workspace.
              </div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {rollbackPreview.turnsRemoved.map((turn) => (
                  <div
                    key={turn.turnId}
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: 'var(--text-2)',
                      padding: '5px 8px',
                      borderRadius: 5,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {turn.preview || turn.turnId}
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter style={{ padding: '10px 14px 12px', display: 'flex', gap: 8 }}>
                <Button
                  onClick={handleApplyRollback}
                  disabled={applyingRewind}
                  variant="outline"
                  size="sm"
                  style={{
                    height: 28,
                    padding: '0 12px',
                    background: 'rgba(251,191,36,0.12)',
                    border: '1px solid rgba(251,191,36,0.28)',
                    borderRadius: 5,
                    color: 'var(--yellow, #fbbf24)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    cursor: applyingRewind ? 'not-allowed' : 'pointer',
                    opacity: applyingRewind ? 0.5 : 1,
                  }}
                >
                  {applyingRewind ? 'APPLYING…' : 'APPLY ROLLBACK'}
                </Button>
                <Button
                  onClick={() => setRollbackPreview(null)}
                  variant="outline"
                  size="sm"
                  style={{
                    height: 28,
                    padding: '0 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 5,
                    color: 'var(--text-3)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                  }}
                >
                  CANCEL
                </Button>
            </CardFooter>
          </Card>
        )}
      </div>
  )
}
