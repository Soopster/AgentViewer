import type { Session } from '../../../lib/types'
import type { ChannelBridge } from '../../useChannelBridge'
import type { MutableRefObject } from 'react'
import type { SessionMessage } from '../../../lib/types'
import { referencedComposerAttachments } from '@/lib/composerContext'
import { useMemo } from 'react'
import { type SendState, type SessionInfo, type SendAttachment } from '@/lib/types'
import { type ThreadedMessage } from '@/lib/threading'
import { getProviderComposer } from '@/lib/providerComposer'
import { type WebComposerQueueDurability } from '@/lib/webComposerQueue'
import { deriveComposerRuntimeState } from '@/lib/composerRuntimeState'
import { type GitSummary } from '@/lib/gitProvider'
import { type QueuedWebSend, type PendingMessageBaseline, type LiveToolActivity } from '../types'

export type UseActiveToolCountGroupContext = {
  liveToolActivities: LiveToolActivity[]
  modelsLoading: boolean
  selectedModel: string
  sendState: SendState
  awaitingPersistedTurn: boolean
  reattachedRunning: boolean
  session: Session | null
  inputText: string
  attachments: SendAttachment[]
  canUseChannelBridge: boolean
  channelBridge: ChannelBridge
  interrupting: boolean
  liveStatus: 'requesting' | 'compacting' | 'retrying' | null
  liveAssistantText: string
  liveThreadedMessages: ThreadedMessage[]
  activeQueuedSends: QueuedWebSend[]
  composerQueueDurability: WebComposerQueueDurability
  steeredNotice: string | null
  sendError: string | null
  composerGitSummary: GitSummary | null
  sessionInfo: SessionInfo | null
  isProject: boolean
  pendingMessageBaselineRef: MutableRefObject<PendingMessageBaseline | null>
  messages: SessionMessage[]
}

export function useActiveToolCountGroup(ctx: UseActiveToolCountGroupContext) {
  const {
    liveToolActivities, modelsLoading, selectedModel, sendState, awaitingPersistedTurn,
    reattachedRunning, session, inputText, attachments, canUseChannelBridge, channelBridge,
    interrupting, liveStatus, liveAssistantText, liveThreadedMessages, activeQueuedSends,
    composerQueueDurability, steeredNotice, sendError, composerGitSummary, sessionInfo, isProject,
    pendingMessageBaselineRef, messages,
  } = ctx

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

  return {
    activeToolCount, modelsPending, sendBusy, canSubmitMessage, composerConfig,
    composerPlaceholder, composerRuntime, composerStatus, composerStatusDetail,
    composerStatusColor, composerGitBranch, composerGitTitle, composerGitHasDetails, liveTurnTone,
    liveTurnBadge, liveTurnActivityDetail, showLiveTimelineOverlay, visiblePersistedMessageKeys,
  }
}
