import type { SelectOption } from '@opentui/core'
import type { ClaudeCommandLifecycleState } from '../../../lib/claudeCommandLifecycle'
import type { SendAttachment, Session, SubagentSummary, ReasoningEffortLevel, SessionModelInfo } from '../../../lib/types'
import type { TuiTranscriptCardLine, TuiTranscriptCard } from '../../format'
import type { TuiPierreDiffView } from '../pierreDiffView'

export type SteeredComposerSend = {
  text: string
  messageUuid: string
  liveMessageUuid: string
  state?: Extract<ClaudeCommandLifecycleState, 'queued' | 'started' | 'completed'>
}
export type PaneFocus = 'sessions' | 'messages'
export type CardLandmark = {
  // 'break' is a turn boundary with nothing to say: a blank row, not a rule.
  kind: 'resume' | 'unread' | 'day' | 'gap' | 'turn' | 'break'
  text: string
  /** A turn rule's prompt card: clicking the rule opens that turn's checkpoint. */
  promptKey?: string
}
// Stable per-card data: expensive to compute, independent of landmark indices and search.
export type StableCardData = {
  bodyLines: TuiTranscriptCardLine[]
  diffView: TuiPierreDiffView | null
  codeBlockLineCounts: number[]
}
export type CardDisplayData = {
  landmarks: CardLandmark[]
  bodyLines: TuiTranscriptCardLine[]
  diffView: TuiPierreDiffView | null
  codeBlockLineCounts: number[]
  // Query-independent header metadata. The match-tag is folded in at render
  // time inside TranscriptCard so search-query changes don't invalidate
  // this whole array (proposal 4).
  headerMeta: string
  accent: string
  isThinkingCard: boolean
  categoryEmoji: string
  isInsight: boolean
  markdownFallbackLines: string[] | null
}
export type AgentToolGroupCard = TuiTranscriptCard & {
  agentToolCards?: TuiTranscriptCard[]
}
export type NoticeTone = 'info' | 'error'
export type ClipboardImage = { data: string; mimeType: string; displayName: string} 
export type ComposerPromptPart = { id: string; kind: 'text'; marker: string; text: string}  |
{ id: string; kind: 'attachment'; marker: string; attachment: SendAttachment} 
export type ComposerDraftSnapshot = {
  text: string
  attachments: SendAttachment[]
  promptParts: ComposerPromptPart[]
  cursorOffset?: number
}
export type ComposerPromptPartRange = ComposerPromptPart & { start: number; end: number} 
export type QueuedComposerSend = {
  id: string
  targetKey: string
  text: string
  attachments: SendAttachment[]
  promptParts: ComposerPromptPart[]
}
export type ComposerSubmission = {
  visibleText: string
  messageText: string
  attachments: SendAttachment[]
  promptParts: ComposerPromptPart[]
}
export type SseFrame = {
  event: string
  data: string
}
export type TuiLiveToolActivity = {
  key: string
  label: string
  status: 'running' | 'done'
}
export type TuiMentionResult = { kind: 'file'; path: string; basename: string}  |
{ kind: 'agent'; name: string; description?: string; mode?: string} 
// Stable content-equality check for the sessions list. The sidebar refresh
// fires every 5s and the running-session poll every 1.5s — returning the
// same array reference when nothing materially changed avoids invalidating
// the entire downstream memo chain (sidebarEntries, projectCount, tabs, …)
// and, more importantly, avoids rebuilding callbacks/intervals that list
// `sessions` or `runningSessions` in their deps.
// A settle the rail has shown but a listing may not yet: a poll that started
// before the write landed would otherwise put the row back for a cycle.
export type PendingInboxEdit = { settledAt: number | undefined; until: number} 
/** A nested sidebar row under a parent session: either a provider-native child
 * session keyed by parentSessionId or a synthesized summary for providers
 * whose subagents live only inside the parent transcript. */
export type SidebarSubagentEntry = { kind: 'session'; session: Session}  |
{ kind: 'summary'; summary: SubagentSummary} 
export type SidebarEntry = { type: 'project'; key: string; projectName: string; count: number}  |
{ type: 'session'; key: string; session: Session; absoluteIndex: number}  |
{ type: 'subagent'; key: string; parentSession: Session; entry: SidebarSubagentEntry; depth: number} 
export type TuiEffort = 'auto' | ReasoningEffortLevel
export type TuiCodexApproval = 'auto' | 'untrusted' | 'on-request' | 'never'
export type TuiCopilotPermissionMode = 'off' | 'auto' | 'on'
export type TuiCopilotContextTier = 'default' | 'long_context'
export type ModelPickerFocus = 'model' | 'effort' | 'permissions'
export type ModelPickerOption = SelectOption & Pick<SessionModelInfo, 'supportsEffort' | 'supportedEffortLevels' | 'supportsLongContext'>
export const CLAUDE_PERMISSION_MODE_ORDER = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions'] as const
export type TuiPermissionMode = (typeof CLAUDE_PERMISSION_MODE_ORDER)[number]
export type PaletteCommand = { id: string; label: string; key: string; category: string} 
export type PaletteRow = { kind: 'header'; label: string}  |
{ kind: 'cmd'; cmd: PaletteCommand; cmdIndex: number} 
export type DensityState = { bodyLines: number; bodyIndent: number; cardGap: number; bodyPad: number; streamGap: number; streamUserGap: number} 
