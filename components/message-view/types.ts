'use client'
import type { ProtocolAgent } from '../../lib/agentProtocol'
import type { ClaudeCommandLifecycleState } from '../../lib/claudeCommandLifecycle'
import type { CodexPlanStep } from '../../lib/taskRegistry'
import type { ThreadedMessage } from '../../lib/threading'
import type { SessionMessage, Session, ToolUseBlock, SendAttachment } from '../../lib/types'

export type Props = {
  hideCoordinator?: boolean
  onInspectTeammate?: (agent: ProtocolAgent) => void
  messages: SessionMessage[]
  loading: boolean
  session: Session | null
  targetMessageId?: string | null
  targetMessageRequestId?: number
  projectView?: { key: string; sessionCount: number; providerMode: 'current' | 'all'} 
  onFork?: (newSessionId: string, sourceSession?: Session) => void
  onDelete?: (sessionId: string, provider?: Session['provider']) => void
  openTabs?: Session[]
  selectedTabId?: string | null
  onSelectTab?: (session: Session) => void
  onCloseTab?: (sessionKey: string) => void
  /** Opens a session that isn't necessarily in the current sidebar/tab list — e.g. an OpenCode subagent's own real child session, deep-linked from an inline AgentCard's "Open session" action. */
  onOpenSession?: (session: Session) => void
  taskPanelOpenRequest?: number
  promptLibraryOpenRequest?: number
  channelBridgeOpenRequest?: number
  channelBridgeRouteToggleRequest?: number
  onChannelBridgeRoutingChange?: (routing: boolean) => void
  ideBridgeOpenRequest?: number
  ideBridgeRouteToggleRequest?: number
  onIdeBridgeRoutingChange?: (routing: boolean) => void
  composerInsertRequest?: { requestId: number; text: string}  | null
  onComposerInsertConsumed?: (requestId: number) => void
  openCodeTodos?: OpenCodeTodo[]
  codexPlan?: { plan: CodexPlanStep[]; explanation: string | null} 
  // Another Codex client currently owns this session's rollout writer lock —
  // the transcript is a stale cached snapshot until that client's turn ends.
  codexExternalWriter?: boolean
  onOpenGit?: () => void
  maximized?: boolean
  onToggleMaximized?: () => void
  onEnterFullscreen?: () => void
  /** Right-hand surface panel (browser/terminal/files/diff/PR/agents). */
  rightPanelOpen?: boolean
  onToggleRightPanel?: () => void
}
export type CopilotContextTier = 'default' | 'long_context'
export type OpenCodeTodo = {
  id: string
  content: string
  status: string
  priority: string
}
export type SseFrame = {
  event: string
  data: string
}
export type LiveToolActivity = {
  key: string
  label: string
  detail?: string
  status: 'running' | 'done'
  toolUse?: ToolUseBlock
}
export type RewindPreview = {
  userMessageId: string
  contentPreview: string
  filesChanged: string[]
}
export type RollbackPreview = {
  numTurns: number
  turnsRemoved: Array<{ turnId: string; preview: string} >
}
export type FailedSend = {
  text: string
  attachments: SendAttachment[]
}
export type QueuedWebSend = {
  id: string
  targetKey: string
  text: string
  attachments: SendAttachment[]
}
export type PendingMessageBaseline = {
  count: number
  lastUuid: string | null
  lastFingerprint: string | null
  sessionId: string
  keys: Set<string>
  fingerprintsByKey: Map<string, string | null>
}
export type ComposerDraft = {
  text: string
  attachments: SendAttachment[]
}
export type MentionResult = { kind: 'file'; path: string; basename: string}  |
{ kind: 'agent'; name: string; description?: string; mode?: string} 
export type TimelineRow = {
  key: string
  message: ThreadedMessage
  groupedMessageIds?: string[]
  showSession: boolean
  dimmed?: boolean
  previewBadge?: string
  activityDetail?: string
  activityTone?: 'running' | 'syncing'
  liveToolActivities?: LiveToolActivity[]
  showForkControls?: boolean
  allowFork?: boolean
  allowResume?: boolean
  allowEdit?: boolean
  streamTurnHint?: string
  streamTurnFooterHint?: string
}
export type TranscriptFilter = 'all' | 'user' | 'assistant' | 'system' | 'tools' | 'errors' | 'thinking' | 'media'
export type SteeredSendEntry = {
  text: string
  messageUuid?: string
  state?: Extract<ClaudeCommandLifecycleState, 'queued' | 'started' | 'completed'>
}
export type ActiveTranscriptFilter = Exclude<TranscriptFilter, 'all'>
export type TimelineEstimateBucket = 'text' | 'tool' | 'media' | 'system' | 'stream'
export type TimelineEstimateCalibration = {
  estimatedTotal: number
  measuredTotal: number
  sampleCount: number
}
export type TimelineEstimateSample = {
  bucket: TimelineEstimateBucket
  estimatedHeight: number
  measuredHeight: number
}
