import type { ComposerSessions } from '../../../lib/composerSessions'
import { useState, useRef, useCallback } from 'react'
import { type SendState, type ContextUsage, type SessionInfo, type SessionModelInfo, type SessionComposerOptions, type ReasoningEffortLevel } from '@/lib/types'
import { useComposerSessionState } from '@/lib/composerSessions'
import { type WebComposerQueueDurability } from '@/lib/webComposerQueue'
import { type GitSummary } from '@/lib/gitProvider'
import { type QueuedWebSend, type CopilotContextTier } from '../types'
import { getWebComposerQueueStore } from '../composerStorage'

export type UseInputTextGroupContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function useInputTextGroup(ctx: UseInputTextGroupContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

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

  return {
    inputText, setInputText, sendState, setSendState, sendError, setSendError,
    livePromptSuggestion, setLivePromptSuggestion, liveStatus, setLiveStatus, taskBudgetTokens,
    setTaskBudgetTokens, enableWorkflow, setEnableWorkflow, liveSubagentText, setLiveSubagentText,
    contextUsage, setContextUsage, sessionInfo, setSessionInfo, composerGitSummary,
    setComposerGitSummary, branchSwitcherOpen, setBranchSwitcherOpen, availableModels,
    setAvailableModels, modelsLoading, setModelsLoading, selectedModel, setSelectedModel,
    selectedEffort, setSelectedEffort, selectedCopilotContextTier, setSelectedCopilotContextTier,
    composerOptions, setComposerOptions, selectedAgent, setSelectedAgent, selectedCopilotMode,
    setSelectedCopilotMode, selectedPermissionMode, setSelectedPermissionMode,
    selectedCodexApproval, setSelectedCodexApproval, queuedSends, setQueuedSends, queuedSendsRef,
    composerQueueStorageReady, setComposerQueueStorageReady, composerQueueDurability,
    setComposerQueueDurability, composerQueueCommitCounterRef, composerQueueClaimInFlightRef,
    composerQueueMountedRef, commitQueuedSends,
  }
}
