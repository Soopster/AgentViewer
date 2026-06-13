'use client'

import Link from 'next/link'
import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, useDeferredValue } from 'react'
import type {
  SessionMessage,
  Session,
  SendState,
  ContextUsage,
  SessionInfo,
  SessionModelInfo,
  SessionComposerOptions,
  SessionDiagnosticSection,
  ToolUseBlock,
  ToolResultBlock,
  ContentBlock,
  SendAttachment,
  ReasoningEffortLevel,
} from '@/lib/types'
import { buildThreadedMessages, buildThreadedMessagesIncremental, stripToolCallBlocks, type IncrementalThreadingCache, type ThreadedMessage, type ThreadedBlock } from '@/lib/threading'
import { measureSync } from '@/lib/clientPerf'
import { exportSessionToHtml, downloadHtml } from '@/lib/export'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import {
  extractClaudeStreamToolInputDelta,
  extractClaudeStreamToolUse,
  normalizeClaudeStreamThreadedMessage,
  parseClaudeStreamToolInput,
} from '@/lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '@/lib/codexMapper'
import { getSlashCommandSuggestions, filterSlashCommands, normalizeSlashCommandSuggestions, type SlashCommandSuggestion } from '@/lib/slashCommands'
import { getProviderComposer, pickProviderExample } from '@/lib/providerComposer'
import { extractCopilotPushedAttachments, extractPendingPermission, extractPermissionReply, type PendingPermission } from '@/lib/permissions'
import { extractClaudeReadFileSummary } from '@/lib/claudeSdkFeatures'
import { isTransientSendError, MAX_TRANSIENT_SEND_RETRIES, transientRetryBackoffMs } from '@/lib/transientError'
import { respondToChannelPermission, readBridgeConfigFromEnv, type ChannelPermissionRequestEvent } from '@/lib/channelBridge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption, nativeSelectBaseClassName } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { BookOpen, ChartNetwork, Filter, Minimize2, Radio, RotateCcw, Search, SendHorizontal, Square, X } from 'lucide-react'
import MessageItem, { MessageDensityProvider, ViewModeProvider, DiffStyleProvider, DiffOptionsProvider, DiffCommentComposerContext, DEFAULT_DIFF_OPTIONS, type MessageDensity, type WebViewMode, type DiffOptions } from './MessageItem'
import { useChannelBridge } from './useChannelBridge'
import type { PierreDiffStyle } from './PierreDiffView'
import { LiveSubagentTextContext, TaskActiveFormsContext, buildTaskActiveFormsForWeb } from './messageItemShared'
import { TaskRail } from './TaskRail'
import { buildTaskRegistry, buildTaskRegistryFromCodexPlan, buildTaskRegistryFromTodos, type CodexPlanStep } from '@/lib/taskRegistry'
import MessageSessionVisualizer, { type MessageVisualizerRow } from './MessageSessionVisualizer'
import { getContinueInCliCommand } from '@/lib/cliContinue'
import CodeThemeToggle from './CodeThemeToggle'
import TabBar from './TabBar'
import { compactStableFingerprint } from '@/lib/compactFingerprint'
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

const AnalyticsPopover = dynamic(() => import('./AnalyticsPopover'), { ssr: false })
const PromptLibrary = dynamic(() => import('./PromptLibrary'), { ssr: false })
const ChannelBridgePanel = dynamic(() => import('./ChannelBridgePanel'), { ssr: false })
const PierrePatchDiffView = dynamic(() => import('./PierreDiffView').then((mod) => mod.PierrePatchDiffView), {
  ssr: false,
  loading: () => (
    <pre style={{ margin: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, background: 'rgba(0,0,0,0.18)', padding: '5px 7px', borderRadius: 4, maxHeight: 180, overflow: 'auto' }}>
      Loading diff…
    </pre>
  ),
})

const compactNativeSelectClassName = cn(
  nativeSelectBaseClassName,
  'h-[30px] min-w-0 rounded-[5px] border-[var(--border)] bg-[var(--surface-2)] px-[10px] text-[11px] text-[var(--text)]'
)

type Props = {
  messages: SessionMessage[]
  loading: boolean
  session: Session | null
  targetMessageId?: string | null
  targetMessageRequestId?: number
  projectView?: { key: string; sessionCount: number; providerMode: 'current' | 'all' }
  onFork?: (newSessionId: string) => void
  onDelete?: (sessionId: string, provider?: Session['provider']) => void
  openTabs?: Session[]
  selectedTabId?: string | null
  onSelectTab?: (session: Session) => void
  onCloseTab?: (sessionKey: string) => void
  taskPanelOpenRequest?: number
  promptLibraryOpenRequest?: number
  channelBridgeOpenRequest?: number
  channelBridgeRouteToggleRequest?: number
  onChannelBridgeRoutingChange?: (routing: boolean) => void
  openCodeTodos?: OpenCodeTodo[]
  codexPlan?: { plan: CodexPlanStep[]; explanation: string | null }
}

type CopilotContextTier = 'default' | 'long_context'

type OpenCodeTodo = {
  id: string
  content: string
  status: string
  priority: string
}

type SseFrame = {
  event: string
  data: string
}

type LiveToolActivity = {
  key: string
  label: string
  detail?: string
  status: 'running' | 'done'
  toolUse?: ToolUseBlock
}

type RewindPreview = {
  userMessageId: string
  contentPreview: string
  filesChanged: string[]
}

type RollbackPreview = {
  numTurns: number
  turnsRemoved: Array<{ turnId: string; preview: string }>
}

type FailedSend = {
  text: string
  attachments: SendAttachment[]
}

type PendingMessageBaseline = {
  count: number
  lastUuid: string | null
  lastFingerprint: string | null
  sessionId: string
  keys: Set<string>
  fingerprintsByKey: Map<string, string | null>
}

type ComposerDraft = {
  text: string
  attachments: SendAttachment[]
}

type MentionResult =
  | { kind: 'file'; path: string; basename: string }
  | { kind: 'agent'; name: string; description?: string; mode?: string }

type TimelineRow = {
  key: string
  message: ThreadedMessage
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
}

type TranscriptFilter = 'all' | 'user' | 'assistant' | 'system' | 'tools' | 'errors' | 'thinking' | 'media'
type ActiveTranscriptFilter = Exclude<TranscriptFilter, 'all'>
type TimelineEstimateBucket = 'text' | 'tool' | 'media' | 'system' | 'stream'

type TimelineEstimateCalibration = {
  estimatedTotal: number
  measuredTotal: number
  sampleCount: number
}

type TimelineEstimateSample = {
  bucket: TimelineEstimateBucket
  estimatedHeight: number
  measuredHeight: number
}

function useLazyRef<T>(create: () => T): { current: T } {
  const ref = useRef<T | null>(null)
  if (ref.current === null) ref.current = create()
  return ref as { current: T }
}

const SENT_HISTORY_MAX = 200
const SENT_HISTORY_STORAGE_KEY = 'agent-viewer:composer-sent-history'

function readPersistedSentHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SENT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is string => typeof e === 'string').slice(-SENT_HISTORY_MAX)
  } catch {
    return []
  }
}

function writePersistedSentHistory(entries: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SENT_HISTORY_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // best-effort; quota or privacy mode
  }
}

const TRANSCRIPT_FILTERS: Array<{ key: TranscriptFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'user', label: 'User' },
  { key: 'assistant', label: 'Agent' },
  { key: 'tools', label: 'Tools' },
  { key: 'errors', label: 'Errors' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'media', label: 'Media' },
  { key: 'system', label: 'System' },
]

const TRANSCRIPT_FILTER_LABELS = new Map(TRANSCRIPT_FILTERS.map((filter) => [filter.key, filter.label]))

const ESTIMATED_TIMELINE_ROW_HEIGHT = 220
// Bumped from 1200 → 2400 so more rows are mounted ahead of the visible
// window when the user scrubs the scrollbar quickly. With variable-height
// tool cards, this gives ResizeObserver more time to settle each row before
// it enters view, which keeps the visible layout stable during fast scrolls.
const TIMELINE_OVERSCAN_PX = 2400
// Milliseconds of inactivity after the last scroll event before we consider
// the user "done scrolling" and start applying scrollTop anchor adjustments
// again for direct scrollbar/touch scrubbing.
const SCROLL_IDLE_MS = 140
// Wheel and trackpad scrolling benefits from keeping the visible row anchored
// while overscanned rows settle. The window outlives the wheel event long
// enough to cover ResizeObserver delivery and the following animation frame.
const WHEEL_SCROLL_COMPENSATION_MS = 180
const TIMELINE_CALIBRATION_MIN_SAMPLES = 3
const TIMELINE_CALIBRATION_BUCKET_CONFIDENCE = 6
const TIMELINE_CALIBRATION_MIN_RATIO = 0.22
const TIMELINE_CALIBRATION_MAX_RATIO = 2
// Safety net: how long the composer will wait for a turn's persisted rows to
// land before force-revealing the polled timeline. The 2s message poll means
// the durable rows are normally present within a poll or two; this only fires
// when a write is lost/delayed so "Syncing transcript…" can never stick forever.
const AWAITING_PERSISTED_TURN_TIMEOUT_MS = 15000
const REATTACH_POLL_MS = 2500
const PROGRAMMATIC_SCROLL_SUPPRESSION_MS = 120
const ESTIMATED_CHARS_PER_LINE = 92
const TIMELINE_BOTTOM_GUTTER_PX = 72
const TIMELINE_TARGET_TOP_GUTTER_PX = 72
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
const COMPOSER_DRAFT_STORAGE_PREFIX = 'agentViewer:composerDraft:v1:'
const SEND_ATTACHMENT_TYPES = new Set<SendAttachment['type']>(['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob', 'agent', 'extension_context'])
function detectMentionAtCursor(text: string, cursor: number): { start: number; query: string } | null {
  if (cursor === 0) return null
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') break
    if (!ch || /\s/.test(ch)) return null
    i -= 1
  }
  if (i < 0 || text[i] !== '@') return null
  if (i > 0 && !/\s/.test(text[i - 1] ?? '')) return null
  const query = text.slice(i + 1, cursor)
  if (query.length > 60) return null
  return { start: i, query }
}


const composerPopoverStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  right: 60,
  maxHeight: 240,
  overflowY: 'auto',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 18px 40px rgba(0,0,0,0.34)',
  zIndex: 30,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
}
const composerPopoverHintStyle: React.CSSProperties = {
  padding: '4px 8px 6px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 9,
  color: 'var(--text-3)',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border)',
  marginBottom: 4,
}
const composerPopoverItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  padding: '5px 8px',
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontSize: 12,
  color: 'var(--text)',
  cursor: 'pointer',
}

function normalizeSelectValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function effortLabel(level: ReasoningEffortLevel): string {
  if (level === 'xhigh') return 'XHIGH'
  return level.toUpperCase()
}

function LiveSpinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER_FRAMES.length)
    }, 80)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'var(--text-3)',
      }}
    >
      <span aria-hidden="true" style={{ color: 'var(--cyan)' }}>
        {SPINNER_FRAMES[frame]}
      </span>
      <span>{label}</span>
    </span>
  )
}

function attachmentImagePreviewSrc(attachment: SendAttachment): string | null {
  if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/')) {
    return `data:${attachment.mimeType};base64,${attachment.data}`
  }
  if (attachment.type === 'image') {
    const path = attachment.path ?? attachment.filePath ?? ''
    if (/^https?:\/\//i.test(path)) return path
    if (path.startsWith('data:')) return path
  }
  return null
}

function attachmentDisplayName(attachment: SendAttachment): string {
  if (attachment.displayName) return attachment.displayName
  const path = attachment.path ?? attachment.filePath ?? attachment.type
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function permissionDenialReason(permission: PendingPermission): string {
  const target = permission.command
    ? `command "${permission.command}"`
    : permission.url
    ? `URL ${permission.url}`
    : permission.paths && permission.paths.length > 0
    ? `path ${permission.paths.join(', ')}`
    : permission.detail
    ? permission.detail
    : permission.title
  return `User rejected ${target} in Agent Viewer.`
}

function mergeAttachmentsById(existing: SendAttachment[], incoming: SendAttachment[]): SendAttachment[] {
  const ids = new Set(existing.map((attachment) => attachment.id).filter(Boolean))
  const next = incoming.filter((attachment) => !attachment.id || !ids.has(attachment.id))
  return next.length > 0 ? [...existing, ...next].slice(-12) : existing
}

function composerDraftStorageKey(session: Session | null): string | null {
  if (!session) return null
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${session.provider ?? 'claude'}:${session.sessionId}`
}

function normalizeDraftAttachments(value: unknown): SendAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object') return []
    const record = attachment as Partial<SendAttachment>
    if (!record.type || typeof record.type !== 'string' || !SEND_ATTACHMENT_TYPES.has(record.type as SendAttachment['type'])) return []
    return [{
      ...record,
      id: typeof record.id === 'string' ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: record.type as SendAttachment['type'],
    } as SendAttachment]
  })
}

function readComposerDraft(storageKey: string | null): ComposerDraft {
  if (!storageKey || typeof window === 'undefined') return { text: '', attachments: [] }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { text: '', attachments: [] }
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      attachments: normalizeDraftAttachments(parsed.attachments),
    }
  } catch {
    return { text: '', attachments: [] }
  }
}

function writeComposerDraft(storageKey: string | null, draft: ComposerDraft) {
  if (!storageKey || typeof window === 'undefined') return
  try {
    if (!draft.text.trim() && draft.attachments.length === 0) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    /* localStorage may be unavailable or full */
  }
}

function extractSseFrames(buffer: string): { frames: SseFrame[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: SseFrame[] = []
  let cursor = 0

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor)
    if (boundary === -1) break

    const rawFrame = normalized.slice(cursor, boundary)
    cursor = boundary + 2

    let event = 'message'
    const dataLines: string[] = []

    for (const line of rawFrame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }

    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join('\n') })
    }
  }

  return {
    frames,
    remaining: normalized.slice(cursor),
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : []
    })
    .join('\n\n')
    .trim()
}

function extractStreamingAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  // Reasoning deltas (codex_reasoning_delta / _summary_delta) are handled by
  // extractStreamingReasoningText and rendered on their own channel — only the
  // plan delta stays in the answer stream here.
  if (record.type === 'codex_plan_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_realtime_transcript') {
    return record.role === 'assistant' && typeof record.text === 'string'
      ? record.text
      : null
  }

  if (record.type === 'codex_realtime_item_added') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    if ((itemRecord.type === 'agentMessage' || itemRecord.type === 'plan') && typeof itemRecord.text === 'string') {
      return itemRecord.text
    }
    return null
  }

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    return itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string'
      ? itemRecord.text
      : itemRecord.type === 'plan' && typeof itemRecord.text === 'string'
      ? itemRecord.text
      : null
  }

  if (record.type === 'stream_event') {
    if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id) return null
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'content_block_delta') return null

    const delta = eventRecord.delta
    if (!delta || typeof delta !== 'object') return null
    const deltaRecord = delta as Record<string, unknown>
    return deltaRecord.type === 'text_delta' && typeof deltaRecord.text === 'string'
      ? deltaRecord.text
      : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    if (eventRecord.type === 'message.part.delta') {
      const field = typeof propertiesRecord.field === 'string' ? propertiesRecord.field : ''
      return field === 'text' && typeof propertiesRecord.delta === 'string'
        ? propertiesRecord.delta
        : null
    }

    if (eventRecord.type !== 'message.part.updated') return null

    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>

    return partRecord.type === 'text' && typeof partRecord.text === 'string'
      ? partRecord.text
      : null
  }

  if (record.type === 'copilot_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>

    if (eventRecord.type === 'assistant.message_delta') {
      const data = eventRecord.data
      if (!data || typeof data !== 'object') return null
      const dataRecord = data as Record<string, unknown>
      return typeof dataRecord.deltaContent === 'string' ? dataRecord.deltaContent : null
    }

    if (eventRecord.type === 'assistant.message') {
      const data = eventRecord.data
      if (!data || typeof data !== 'object') return null
      const dataRecord = data as Record<string, unknown>
      return typeof dataRecord.content === 'string' ? dataRecord.content : null
    }

    return null
  }

  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>

    if (eventRecord.type === 'message_update') {
      const assistantMessageEvent = eventRecord.assistantMessageEvent
      if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return null
      const updateRecord = assistantMessageEvent as Record<string, unknown>

      if (updateRecord.type === 'text_delta' && typeof updateRecord.delta === 'string') {
        return updateRecord.delta
      }

      if ((updateRecord.type === 'done' || updateRecord.type === 'error')) {
        const finalMessage = updateRecord.type === 'done'
          ? updateRecord.message
          : updateRecord.error
        if (!finalMessage || typeof finalMessage !== 'object') return null
        const finalRecord = finalMessage as Record<string, unknown>
        return extractTextContent(finalRecord.content)
          || (typeof finalRecord.errorMessage === 'string' ? finalRecord.errorMessage : null)
      }
    }

    if (eventRecord.type === 'message_end') {
      const message = eventRecord.message
      if (!message || typeof message !== 'object') return null
      const messageRecord = message as Record<string, unknown>
      return messageRecord.role === 'assistant'
        ? extractTextContent(messageRecord.content)
          || (typeof messageRecord.errorMessage === 'string' ? messageRecord.errorMessage : null)
        : null
    }

    return null
  }

  if (record.type === 'pi_bash_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'assistant') {
    const message = record.message
    if (!message || typeof message !== 'object') return null
    const text = extractTextContent((message as Record<string, unknown>).content)
    return text || null
  }

  return null
}

// Append-only reasoning/thinking deltas, kept separate from the answer so the UI
// can stream them as a distinct dim "thinking" block (matching the native CLIs).
function extractStreamingReasoningText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if ((record.type === 'codex_reasoning_delta' || record.type === 'codex_reasoning_summary_delta')
    && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'stream_event') {
    if (typeof record.parent_tool_use_id === 'string' && record.parent_tool_use_id) return null
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'content_block_delta') return null
    const delta = eventRecord.delta
    if (!delta || typeof delta !== 'object') return null
    const deltaRecord = delta as Record<string, unknown>
    return deltaRecord.type === 'thinking_delta' && typeof deltaRecord.thinking === 'string'
      ? deltaRecord.thinking
      : null
  }

  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message_update') return null
    const assistantMessageEvent = eventRecord.assistantMessageEvent
    if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return null
    const updateRecord = assistantMessageEvent as Record<string, unknown>
    return updateRecord.type === 'thinking_delta' && typeof updateRecord.delta === 'string'
      ? updateRecord.delta
      : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.delta') return null
    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const field = typeof propertiesRecord.field === 'string' ? propertiesRecord.field : ''
    return field === 'reasoning' && typeof propertiesRecord.delta === 'string'
      ? propertiesRecord.delta
      : null
  }

  if (record.type === 'copilot_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'assistant.reasoning_delta') return null
    const data = eventRecord.data
    if (!data || typeof data !== 'object') return null
    const dataRecord = data as Record<string, unknown>
    return typeof dataRecord.deltaContent === 'string'
      ? dataRecord.deltaContent
      : typeof dataRecord.delta === 'string'
      ? dataRecord.delta
      : null
  }

  return null
}

function upsertThreadedMessage(
  messages: ThreadedMessage[],
  nextMessage: ThreadedMessage,
): ThreadedMessage[] {
  const existingIndex = messages.findIndex((message) => message.uuid === nextMessage.uuid)
  if (existingIndex === -1) return [...messages, nextMessage]
  return messages.map((message, index) => index === existingIndex ? nextMessage : message)
}

function completeLiveToolThread(messages: ThreadedMessage[], key: string): ThreadedMessage[] {
  const targetUuid = `live-tool:${key}`
  return messages.map((message) => {
    if (message.uuid !== targetUuid) return message
    return {
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.type !== 'tool_thread') return block
        if (block.result) return block
        return {
          ...block,
          result: {
            type: 'tool_result',
            tool_use_id: block.toolUse.id,
            content: 'Tool call emitted in live preview. Final output will appear when the transcript syncs.',
          },
        }
      }),
    }
  })
}

function updateLiveToolThreadInput(
  messages: ThreadedMessage[],
  key: string,
  input: Record<string, unknown>,
): ThreadedMessage[] {
  const targetUuid = `live-tool:${key}`
  return messages.map((message) => {
    if (message.uuid !== targetUuid) return message
    return {
      ...message,
      blocks: message.blocks.map((block) => block.type === 'tool_thread'
        ? { ...block, toolUse: { ...block.toolUse, input } }
        : block),
    }
  })
}

function formatToolLabel(name: string): string {
  return name
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function codexItemToolLabel(item: Record<string, unknown>): { label: string; detail?: string } | null {
  const type = typeof item.type === 'string' ? item.type : ''
  switch (type) {
    case 'commandExecution':
      return { label: 'Bash', detail: typeof item.command === 'string' ? item.command : undefined }
    case 'fileChange':
      return { label: 'File Change' }
    case 'mcpToolCall':
      return {
        label: typeof item.tool === 'string' ? formatToolLabel(item.tool) : 'MCP',
        detail: typeof item.server === 'string' ? item.server : undefined,
      }
    case 'dynamicToolCall':
      return { label: typeof item.tool === 'string' ? formatToolLabel(item.tool) : 'Dynamic Tool' }
    case 'webSearch':
      return { label: 'Web Search', detail: typeof item.query === 'string' ? item.query : undefined }
    case 'collabAgentToolCall':
      return { label: 'Agent', detail: typeof item.tool === 'string' ? item.tool : undefined }
    default:
      return null
  }
}

function opencodeToolLabel(item: Record<string, unknown>): { label: string; detail?: string } | null {
  if (item.type !== 'tool' || typeof item.tool !== 'string') return null

  const state = item.state
  const detail = state && typeof state === 'object' && typeof (state as Record<string, unknown>).title === 'string'
    ? (state as Record<string, unknown>).title as string
    : undefined

  return {
    label: formatToolLabel(item.tool),
    detail,
  }
}

function copilotToolLabel(event: Record<string, unknown>): { label: string; detail?: string } | null {
  if (event.type !== 'tool.execution_start' && event.type !== 'tool.execution_complete') return null

  const data = event.data
  if (!data || typeof data !== 'object') return null
  const dataRecord = data as Record<string, unknown>
  const toolName = typeof dataRecord.toolName === 'string'
    ? dataRecord.toolName
    : typeof dataRecord.mcpToolName === 'string'
    ? dataRecord.mcpToolName
    : null
  if (!toolName) return null

  return {
    label: formatToolLabel(toolName),
    detail: typeof dataRecord.mcpServerName === 'string' ? dataRecord.mcpServerName : undefined,
  }
}

function extractLiveToolStart(payload: unknown): { index: number; key: string; label: string; detail?: string; toolUse?: ToolUseBlock } | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_item_started') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    const tool = codexItemToolLabel(itemRecord)
    const itemId = typeof itemRecord.id === 'string' ? itemRecord.id : null
    if (!tool || !itemId) return null
    return {
      index: 0,
      key: itemId,
      label: tool.label,
      detail: tool.detail,
    }
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return null

    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>
    const tool = opencodeToolLabel(partRecord)
    if (!tool) return null

    const state = partRecord.state
    if (!state || typeof state !== 'object') return null
    const status = typeof (state as Record<string, unknown>).status === 'string'
      ? ((state as Record<string, unknown>).status as string)
      : ''
    if (!['pending', 'running', 'completed', 'error'].includes(status)) return null

    return {
      index: -1,
      key: typeof partRecord.callID === 'string' ? partRecord.callID : String(partRecord.id ?? 'tool'),
      label: tool.label,
      detail: tool.detail,
    }
  }

  if (record.type === 'copilot_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    const tool = copilotToolLabel(eventRecord)
    if (!tool || eventRecord.type !== 'tool.execution_start') return null

    const data = eventRecord.data
    if (!data || typeof data !== 'object') return null
    const dataRecord = data as Record<string, unknown>
    const toolCallId = typeof dataRecord.toolCallId === 'string' ? dataRecord.toolCallId : null
    if (!toolCallId) return null

    return {
      index: -1,
      key: toolCallId,
      label: tool.label,
      detail: tool.detail,
    }
  }

  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'tool_execution_start') return null

    const toolCallId = typeof eventRecord.toolCallId === 'string' ? eventRecord.toolCallId : null
    const toolName = typeof eventRecord.toolName === 'string' ? eventRecord.toolName : null
    if (!toolCallId || !toolName) return null

    return {
      index: -1,
      key: toolCallId,
      label: formatToolLabel(toolName),
    }
  }

  if (record.type !== 'stream_event') return null

  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'content_block_start' || typeof eventRecord.index !== 'number') return null

  const block = eventRecord.content_block
  if (!block || typeof block !== 'object') return null
  const blockRecord = block as Record<string, unknown>
  const blockType = typeof blockRecord.type === 'string' ? blockRecord.type : ''
  if (!['tool_use', 'server_tool_use', 'mcp_tool_use'].includes(blockType)) return null

  const name = typeof blockRecord.name === 'string' ? blockRecord.name : 'tool'
  const serverName = typeof blockRecord.server_name === 'string' ? blockRecord.server_name : null
  const toolUse = extractClaudeStreamToolUse(payload)

  return {
    index: eventRecord.index,
    key: typeof blockRecord.id === 'string' ? blockRecord.id : `${blockType}-${eventRecord.index}`,
    label: formatToolLabel(name),
    detail: serverName ?? undefined,
    ...(toolUse ? { toolUse } : {}),
  }
}

function extractLiveToolStopIndex(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    return typeof itemRecord.id === 'string' ? 0 : null
  }

  if (record.type !== 'stream_event') return null

  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>

  return eventRecord.type === 'content_block_stop' && typeof eventRecord.index === 'number'
    ? eventRecord.index
    : null
}

function extractCompletedToolKey(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    const tool = codexItemToolLabel(itemRecord)
    return tool && typeof itemRecord.id === 'string' ? itemRecord.id : null
  }

  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return null

    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return null
    const propertiesRecord = properties as Record<string, unknown>
    const part = propertiesRecord.part
    if (!part || typeof part !== 'object') return null
    const partRecord = part as Record<string, unknown>
    const tool = opencodeToolLabel(partRecord)
    if (!tool) return null

    const state = partRecord.state
    if (!state || typeof state !== 'object') return null
    const status = typeof (state as Record<string, unknown>).status === 'string'
      ? ((state as Record<string, unknown>).status as string)
      : ''

    return status === 'completed' || status === 'error'
      ? (typeof partRecord.callID === 'string' ? partRecord.callID : String(partRecord.id ?? 'tool'))
      : null
  }

  if (record.type === 'copilot_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'tool.execution_complete') return null

    const data = eventRecord.data
    if (!data || typeof data !== 'object') return null
    const dataRecord = data as Record<string, unknown>
    return typeof dataRecord.toolCallId === 'string' ? dataRecord.toolCallId : null
  }

  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return null
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'tool_execution_end') return null
    return typeof eventRecord.toolCallId === 'string' ? eventRecord.toolCallId : null
  }

  return null
}

function assistantDisplayName(provider: Session['provider'] | SessionInfo['provider'] | undefined): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'opencode') return 'OpenCode'
  if (provider === 'copilot') return 'Copilot'
  if (provider === 'pi') return 'Pi'
  return 'Claude'
}

function shouldReplaceLiveAssistantText(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (record.type === 'assistant') return true
  if (record.type === 'codex_realtime_transcript') return true
  if (record.type === 'codex_realtime_item_added') return true
  if (record.type === 'codex_item_completed') {
    const item = record.item
    return !!item && typeof item === 'object' && (
      (item as Record<string, unknown>).type === 'agentMessage'
      || (item as Record<string, unknown>).type === 'plan'
    )
  }
  if (record.type === 'opencode_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return false
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type !== 'message.part.updated') return false
    const properties = eventRecord.properties
    if (!properties || typeof properties !== 'object') return false
    const part = (properties as Record<string, unknown>).part
    if (!part || typeof part !== 'object') return false
    return (part as Record<string, unknown>).type === 'text'
  }
  if (record.type === 'pi_event') {
    const event = record.event
    if (!event || typeof event !== 'object') return false
    const eventRecord = event as Record<string, unknown>
    if (eventRecord.type === 'message_end') {
      const message = eventRecord.message
      return !!message && typeof message === 'object' && (message as Record<string, unknown>).role === 'assistant'
    }
    if (eventRecord.type !== 'message_update') return false
    const assistantMessageEvent = eventRecord.assistantMessageEvent
    if (!assistantMessageEvent || typeof assistantMessageEvent !== 'object') return false
    const updateRecord = assistantMessageEvent as Record<string, unknown>
    return updateRecord.type === 'done' || updateRecord.type === 'error'
  }
  if (record.type !== 'copilot_event') return false
  const event = record.event
  if (!event || typeof event !== 'object') return false
  return (event as Record<string, unknown>).type === 'assistant.message'
}

function withProviderQuery(path: string, provider?: Session['provider']): string {
  if (!provider) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}provider=${provider}`
}

function usageEqual(a: ThreadedMessage['usage'], b: ThreadedMessage['usage']): boolean {
  return a?.input_tokens === b?.input_tokens
    && a?.output_tokens === b?.output_tokens
    && a?.cache_read_input_tokens === b?.cache_read_input_tokens
    && a?.cache_creation_input_tokens === b?.cache_creation_input_tokens
}

function threadedBlockEqual(a: ThreadedMessage['blocks'][number], b: ThreadedMessage['blocks'][number]): boolean {
  if (a.type !== b.type) return false

  switch (a.type) {
    case 'text':
      return a.text === (b.type === 'text' ? b.text : '')
    case 'thinking':
      return a.thinking === (b.type === 'thinking' ? b.thinking : '')
        && a.signature === (b.type === 'thinking' ? b.signature : undefined)
    case 'image':
      return a === b
    case 'system_reminder':
      return a.content === (b.type === 'system_reminder' ? b.content : '')
    case 'slash_command':
      return a.command === (b.type === 'slash_command' ? b.command : '')
        && a.message === (b.type === 'slash_command' ? b.message : '')
        && a.args === (b.type === 'slash_command' ? b.args : '')
    case 'local_command_stdout':
      return a.stdout === (b.type === 'local_command_stdout' ? b.stdout : '')
    case 'task_notification':
      return b.type === 'task_notification'
        && a.taskId === b.taskId
        && a.toolUseId === b.toolUseId
        && a.outputFile === b.outputFile
        && a.status === b.status
        && a.summary === b.summary
        && a.result === b.result
        && a.usage.totalTokens === b.usage.totalTokens
        && a.usage.toolUses === b.usage.toolUses
        && a.usage.durationMs === b.usage.durationMs
    case 'claude_system':
      return b.type === 'claude_system'
        && a.subtype === b.subtype
        && a.payload === b.payload
    case 'tool_thread':
      return b.type === 'tool_thread'
        && a.toolUse === b.toolUse
        && a.result === b.result
  }
}

function threadedMessageEqual(a: ThreadedMessage, b: ThreadedMessage): boolean {
  if (a === b) return true
  if (
    a.uuid !== b.uuid
    || a.role !== b.role
    || a.sessionId !== b.sessionId
    || a.timestamp !== b.timestamp
    || a.provider !== b.provider
    || a.origin?.kind !== b.origin?.kind
    || !usageEqual(a.usage, b.usage)
    || a.blocks.length !== b.blocks.length
  ) {
    return false
  }

  for (let index = 0; index < a.blocks.length; index += 1) {
    if (!threadedBlockEqual(a.blocks[index], b.blocks[index])) return false
  }
  return true
}

function threadedMessageKey(message: ThreadedMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}

function sessionMessageThreadedKey(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}

function sessionMessageFingerprint(message: SessionMessage | undefined): string | null {
  if (!message) return null
  return [
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    compactStableFingerprint(message.message),
  ].join('|')
}

function isDurableSessionMessage(message: SessionMessage): boolean {
  return message.ephemeral !== true
}

function buildPendingMessageBaseline(messages: SessionMessage[], sessionId: string): PendingMessageBaseline {
  const durableMessages = messages.filter(isDurableSessionMessage)
  const keys = new Set<string>()
  const fingerprintsByKey = new Map<string, string | null>()
  for (const message of durableMessages) {
    const key = sessionMessageThreadedKey(message)
    keys.add(key)
    fingerprintsByKey.set(key, sessionMessageFingerprint(message))
  }
  return {
    count: durableMessages.length,
    lastUuid: durableMessages.at(-1)?.uuid ?? null,
    lastFingerprint: sessionMessageFingerprint(durableMessages.at(-1)),
    sessionId,
    keys,
    fingerprintsByKey,
  }
}

function retargetPendingMessageBaseline(
  baseline: PendingMessageBaseline,
  sessionId: string,
  resetKnownMessages = false,
): PendingMessageBaseline {
  if (resetKnownMessages) {
    return {
      count: 0,
      lastUuid: null,
      lastFingerprint: null,
      sessionId,
      keys: new Set(),
      fingerprintsByKey: new Map(),
    }
  }
  return { ...baseline, sessionId }
}

function messagesChangedSinceBaseline(messages: SessionMessage[], baseline: PendingMessageBaseline): SessionMessage[] {
  return messages.filter((message) => {
    const key = sessionMessageThreadedKey(message)
    const previousFingerprint = baseline.fingerprintsByKey.get(key)
    return previousFingerprint === undefined || previousFingerprint !== sessionMessageFingerprint(message)
  })
}

function estimateWrappedLines(text: string, charsPerLine = ESTIMATED_CHARS_PER_LINE): number {
  if (!text) return 1

  let lines = 0
  for (const rawLine of text.replace(/\t/g, '    ').split('\n')) {
    if (!rawLine) {
      lines += 1
      continue
    }
    lines += Math.max(1, Math.ceil(rawLine.length / charsPerLine))
  }
  return Math.max(lines, 1)
}

function estimateTextSectionHeight(
  text: string,
  { lineHeight = 24, padding = 26, min = 56, max }: { lineHeight?: number; padding?: number; min?: number; max?: number } = {},
): number {
  const estimated = padding + estimateWrappedLines(text) * lineHeight
  const bounded = max != null ? Math.min(estimated, max) : estimated
  return Math.max(min, bounded)
}

const STANDALONE_DATA_IMAGE_ESTIMATE_RE =
  /^(?:\[image\]\s*)?data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+\s*$/

function hasStandaloneDataImage(text: string): boolean {
  return text.split('\n').some((line) => STANDALONE_DATA_IMAGE_ESTIMATE_RE.test(line.trim()))
}

function estimateRenderedTextHeight(text: string): number {
  if (!hasStandaloneDataImage(text)) return estimateTextSectionHeight(text)

  let estimated = 0
  const textLines: string[] = []
  const flushText = () => {
    const chunk = textLines.join('\n').trimEnd()
    if (chunk) estimated += estimateTextSectionHeight(chunk)
    textLines.length = 0
  }

  for (const line of text.split('\n')) {
    if (!STANDALONE_DATA_IMAGE_ESTIMATE_RE.test(line.trim())) {
      textLines.push(line)
      continue
    }
    flushText()
    estimated += 520
  }
  flushText()
  return Math.max(estimated, 56)
}

function estimateContentBlockHeight(block: ContentBlock): number {
  if (block.type === 'text') return estimateTextSectionHeight(typeof block.text === 'string' ? block.text : '')
  if (block.type === 'thinking') return 70
  if (block.type === 'image') return 520
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') {
      return estimateTextSectionHeight(block.content, { lineHeight: 18, padding: 18, min: 60, max: 260 })
    }
    if (Array.isArray(block.content)) {
      return 60 + block.content.reduce((total: number, child: ContentBlock) => total + estimateContentBlockHeight(child), 0)
    }
    return 60
  }
  return 68
}

function toolResultContentToText(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const record = block as Record<string, unknown>
        if (record.type !== 'text') return JSON.stringify(block)
        if (typeof record.text === 'string') return record.text
        const file = record.file
        if (file && typeof file === 'object' && typeof (file as Record<string, unknown>).content === 'string') {
          return (file as { content: string }).content
        }
        return JSON.stringify(block)
      })
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
}

function toolResultHasImage(content: ToolResultBlock['content']): boolean {
  return Array.isArray(content) && content.some((block) => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'image')
}

function estimateLimitedPreHeight(text: string, limit: number): { lineHeight: number; hidden: boolean } {
  const lineCount = Math.max(1, text.split('\n').length)
  const visibleLines = Math.min(lineCount, limit)
  return {
    lineHeight: 16 + visibleLines * 21,
    hidden: lineCount > limit,
  }
}

function estimateGenericToolResultHeight(result: ToolResultBlock): number {
  const raw = toolResultContentToText(result.content)
  const nonEmpty = raw.split('\n').filter((line) => line.trim())
  if (!result.is_error && nonEmpty.length === 1 && raw.length < 140) return 30

  const persistedMatch = raw.match(/<persisted-output>[\s\S]*?Preview[^\n]*:\n([\s\S]*)/)
  const displayText = persistedMatch ? persistedMatch[1].trim() : raw
  const { lineHeight, hidden } = estimateLimitedPreHeight(displayText, 20)
  return 28 + lineHeight + (hidden ? 31 : 0)
}

function estimateReadToolResultHeight(result: ToolResultBlock, filePath?: string): number {
  const summary = extractClaudeReadFileSummary(result, filePath)
  if (summary && summary.kind !== 'text') {
    return estimateGenericToolResultHeight({
      ...result,
      content: summary.content,
    })
  }

  const raw = summary?.content ?? toolResultContentToText(result.content)
  const lineCount = Math.max(1, raw.split('\n').length)
  const visibleLines = Math.min(lineCount, 25)
  const metadataHeight = summary ? 30 : 0
  const codeHeight = Math.min(500, Math.max(44, 38 + visibleLines * 20))
  const expandHeight = lineCount > 25 ? 31 : 0
  return 1 + metadataHeight + codeHeight + expandHeight
}

function estimateToolResultHeight(result: ToolResultBlock | null | undefined, toolName: string, filePath?: string): number {
  if (!result) return 0
  if (toolResultHasImage(result.content)) return 540
  if (toolName === 'Read') return estimateReadToolResultHeight(result, filePath)
  return estimateGenericToolResultHeight(result)
}

function estimateSimpleToolHeaderHeight(toolName: string, input: Record<string, unknown>): number {
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''
    return estimateTextSectionHeight(command, { lineHeight: 20, padding: 18, min: 38, max: 180 })
  }
  return 38
}

function estimateToolThreadHeight(block: Extract<ThreadedBlock, { type: 'tool_thread' }>): number {
  const { toolUse, result } = block
  const input = toolUse.input as Record<string, unknown>

  if (toolUse.name === 'FileChange') {
    const changes = Array.isArray(input.changes) ? input.changes : []
    const bodyHeight = changes.length === 0
      ? 56
      : changes.reduce((total, change) => {
          const record = change && typeof change === 'object' ? change as Record<string, unknown> : {}
          const diff = typeof record.diff === 'string' ? record.diff : ''
          return total + 84 + estimateTextSectionHeight(diff, { lineHeight: 17, padding: 20, min: 96, max: 420 })
        }, 0)
    return 72 + bodyHeight
  }

  if (toolUse.name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    const bodyHeight = edits.reduce((total, edit) => {
      const record = edit && typeof edit === 'object' ? edit as Record<string, unknown> : {}
      const oldString = typeof record.old_string === 'string' ? record.old_string : ''
      const newString = typeof record.new_string === 'string' ? record.new_string : ''
      const diffText = `${oldString}\n${newString}`.trim()
      return total + 54 + estimateTextSectionHeight(diffText, { lineHeight: 17, padding: 20, min: 88, max: 260 })
    }, 28)
    return 78 + bodyHeight
  }

  if (toolUse.name === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos : []
    return 88 + Math.max(42, todos.length * 28)
  }

  if (toolUse.name === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : []
    return 92 + questions.length * 92
  }

  if (toolUse.name === 'Read' || toolUse.name === 'Glob' || toolUse.name === 'Grep' || toolUse.name === 'Bash') {
    const filePath = typeof input.file_path === 'string' ? input.file_path : undefined
    const bodyHeight = toolUse.name === 'Bash' && typeof input.description === 'string' && input.description
      ? 24
      : 0
    return 8 + estimateSimpleToolHeaderHeight(toolUse.name, input) + bodyHeight + estimateToolResultHeight(result, toolUse.name, filePath)
  }

  if (toolUse.name === 'Agent') {
    const description = typeof input.description === 'string' ? input.description : ''
    return 86 + (result ? estimateTextSectionHeight(description, { lineHeight: 16, padding: 10, min: 0, max: 80 }) : 0)
  }

  if (result?.content) {
    if (typeof result.content === 'string') {
      return 86 + estimateTextSectionHeight(result.content, { lineHeight: 18, padding: 16, min: 40, max: 220 })
    }
    return 92 + result.content.reduce((total, child) => total + estimateContentBlockHeight(child), 0)
  }

  return 84
}

function estimateThreadedBlockHeight(block: ThreadedBlock): number {
  if (block.type === 'text') return estimateRenderedTextHeight(block.text)
  if (block.type === 'thinking') return 72
  if (block.type === 'image') return 220
  if (block.type === 'tool_thread') return estimateToolThreadHeight(block)
  if (block.type === 'task_notification') return 96
  if (block.type === 'system_reminder') return 72
  if (block.type === 'slash_command') return 64
  if (block.type === 'local_command_stdout') {
    return 60 + estimateTextSectionHeight(block.stdout, { lineHeight: 17, padding: 8, min: 20, max: 80 })
  }
  if (block.type === 'claude_system') return 72
  return 68
}

function timelineEstimateBucket(row: TimelineRow, viewMode: WebViewMode): TimelineEstimateBucket {
  if (viewMode === 'stream') return 'stream'
  if (row.message.role === 'system') return 'system'
  if (row.message.blocks.some((block) => (
    block.type === 'image' ||
    (block.type === 'text' && hasStandaloneDataImage(block.text))
  ))) return 'media'
  if (row.message.blocks.some((block) => block.type === 'tool_thread')) return 'tool'
  return 'text'
}

function estimateTimelineRowHeight(
  row: TimelineRow,
  density: MessageDensity = 'balanced',
  viewMode: WebViewMode = 'conversation',
): number {
  const { message } = row
  if (viewMode === 'stream') {
    const textHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => (
      block.type === 'text' ? total + estimateRenderedTextHeight(block.text) : total
    ), 0)
    return Math.max(56, 45 + textHeight)
  }

  const headerHeight = 82
  const previewHeight = row.previewBadge ? (row.activityDetail ? 42 : 28) : 0
  const liveToolsHeight = row.liveToolActivities && row.liveToolActivities.length > 0
    ? 34 * Math.ceil(row.liveToolActivities.length / 3) + 10
    : 0
  const blockGap = Math.max(message.blocks.length - 1, 0) * 8
  const blockHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => total + estimateThreadedBlockHeight(block), 0)
  const densityAdjustment = density === 'comfortable' ? 16 : density === 'dense' ? -24 : 0
  const estimated = headerHeight + previewHeight + liveToolsHeight + blockGap + blockHeight + densityAdjustment
  return Math.max(estimated, message.role === 'system' ? 120 : ESTIMATED_TIMELINE_ROW_HEIGHT)
}

function calibratedTimelineRowHeight(
  row: TimelineRow,
  rawEstimate: number,
  viewMode: WebViewMode,
  calibration: ReadonlyMap<TimelineEstimateBucket | 'all', TimelineEstimateCalibration>,
): number {
  const global = calibration.get('all')
  if (!global || global.sampleCount < TIMELINE_CALIBRATION_MIN_SAMPLES || global.estimatedTotal <= 0) {
    return rawEstimate
  }

  const globalRatio = global.measuredTotal / global.estimatedTotal
  const bucket = calibration.get(timelineEstimateBucket(row, viewMode))
  const bucketRatio = bucket && bucket.estimatedTotal > 0
    ? bucket.measuredTotal / bucket.estimatedTotal
    : globalRatio
  const bucketConfidence = bucket
    ? Math.min(bucket.sampleCount / TIMELINE_CALIBRATION_BUCKET_CONFIDENCE, 1)
    : 0
  const ratio = Math.max(
    TIMELINE_CALIBRATION_MIN_RATIO,
    Math.min(
      TIMELINE_CALIBRATION_MAX_RATIO,
      globalRatio + (bucketRatio - globalRatio) * bucketConfidence,
    ),
  )
  return Math.max(48, Math.round(rawEstimate * ratio))
}

function readResizeObserverHeight(entry: ResizeObserverEntry, fallbackNode: HTMLElement): number {
  const borderBoxSize = entry.borderBoxSize
  const firstBorderBox = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize
  if (firstBorderBox?.blockSize) return firstBorderBox.blockSize
  if (entry.contentRect.height) return entry.contentRect.height
  return fallbackNode.getBoundingClientRect().height
}

function messageContentBlocksForTarget(message: SessionMessage): ContentBlock[] {
  if (message.type === 'system') return []
  const content = message.message.content
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return (content ?? []) as ContentBlock[]
}

function isToolResultBlock(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result' && typeof (block as ToolResultBlock).tool_use_id === 'string'
}

function resolveTimelineTargetMessageId(
  targetMessageId: string | null | undefined,
  messages: SessionMessage[],
  timelineRows: TimelineRow[],
): string | null {
  if (!targetMessageId) return null
  if (timelineRows.some((row) => row.message.uuid === targetMessageId)) return targetMessageId

  const rawTarget = messages.find((message) => message.uuid === targetMessageId)
  if (!rawTarget) return targetMessageId

  const targetToolUseIds = messageContentBlocksForTarget(rawTarget)
    .filter(isToolResultBlock)
    .map((block) => block.tool_use_id)
    .filter(Boolean)

  if (targetToolUseIds.length === 0) return targetMessageId
  const targetToolUseIdSet = new Set(targetToolUseIds)
  const owningRow = timelineRows.find((row) => row.message.blocks.some((block) => (
    block.type === 'tool_thread' &&
    (targetToolUseIdSet.has(block.toolUse.id) || (block.result?.tool_use_id ? targetToolUseIdSet.has(block.result.tool_use_id) : false))
  )))
  return owningRow?.message.uuid ?? targetMessageId
}

function toolResultToText(result: ToolResultBlock | null): string {
  if (!result) return ''
  if (typeof result.content === 'string') return result.content
  return result.content
    .map((b) => (b.type === 'text' && typeof (b as { text?: unknown }).text === 'string'
      ? (b as { text: string }).text
      : ''))
    .filter(Boolean)
    .join('\n')
}

function toolInputToText(input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command
  if (typeof input.file_path === 'string') {
    if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
      return `${input.file_path}\n\n--- old\n${input.old_string}\n+++ new\n${input.new_string}`
    }
    if (typeof input.content === 'string') return `${input.file_path}\n\n${input.content}`
    return input.file_path
  }
  if (typeof input.pattern === 'string') return input.pattern
  if (typeof input.query === 'string') return input.query
  if (typeof input.url === 'string') return input.url
  if (typeof input.prompt === 'string') return input.prompt
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return ''
  }
}

function messageToCopyText(message: ThreadedMessage): string {
  const parts: string[] = []
  for (const block of message.blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text)
    } else if (block.type === 'thinking' && block.thinking) {
      parts.push(block.thinking)
    } else if (block.type === 'tool_thread') {
      const sections = [`[${block.toolUse.name}]`]
      const inputText = toolInputToText(block.toolUse.input)
      if (inputText) sections.push(inputText)
      const resultText = toolResultToText(block.result)
      if (resultText) sections.push(resultText)
      parts.push(sections.join('\n\n'))
    } else if (block.type === 'task_notification') {
      const sections = [`[Task: ${block.taskId}]`]
      if (block.summary) sections.push(block.summary)
      if (block.result) sections.push(block.result)
      parts.push(sections.join('\n\n'))
    } else if (block.type === 'local_command_stdout' && block.stdout) {
      parts.push(block.stdout)
    }
  }
  return parts.join('\n\n').trim()
}

function timelineRowSearchText(row: TimelineRow): string {
  return [
    row.message.role,
    row.message.provider,
    row.message.sessionId,
    row.previewBadge,
    row.activityDetail,
    messageToCopyText(row.message),
  ].filter(Boolean).join(' ').toLowerCase()
}

function timelineRowMatchesTranscriptFilter(row: TimelineRow, filter: ActiveTranscriptFilter): boolean {
  switch (filter) {
    case 'user':
    case 'assistant':
    case 'system':
      return row.message.role === filter
    case 'tools':
      return row.message.blocks.some((block) => block.type === 'tool_thread')
    case 'errors':
      return row.message.blocks.some((block) => block.type === 'tool_thread' && (block.result?.is_error || !block.result))
    case 'thinking':
      return row.message.blocks.some((block) => block.type === 'thinking')
    case 'media':
      return row.message.blocks.some((block) => block.type === 'image')
  }
}

function timelineRowMatchesTranscriptFilters(row: TimelineRow, filters: ActiveTranscriptFilter[]): boolean {
  return filters.length === 0 || filters.some((filter) => timelineRowMatchesTranscriptFilter(row, filter))
}

const TimelineMessageRow = memo(function TimelineMessageRow({
  row,
  highlighted,
  forking,
  resumeTarget,
  bookmarked,
  streamMode,
  onForkFromMessage,
  onToggleResume,
  onToggleBookmark,
  onReusePrompt,
  onQuoteMessage,
  onEditFromMessage,
}: {
  row: TimelineRow
  // Per-row interaction state passed as booleans (not baked into the row
  // object) so a highlight/fork/resume change re-renders only the affected
  // rows instead of rebuilding the whole rows array + virtual layout.
  highlighted: boolean
  forking: boolean
  resumeTarget: boolean
  bookmarked: boolean
  streamMode: boolean
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
  onToggleBookmark: (messageId: string) => void
  onReusePrompt: (text: string) => void
  onQuoteMessage: (text: string) => void
  onEditFromMessage: (messageId: string, text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copyText = useMemo(() => messageToCopyText(row.message), [row.message])
  const canCopy = copyText.length > 0
  const isUserMessage = row.message.role === 'user'
  const canReuse = isUserMessage && copyText.length > 0
  const canEdit = isUserMessage && copyText.length > 0 && !!row.allowEdit
  const canQuote = !isUserMessage && copyText.length > 0
  const canBookmark = !row.message.uuid.startsWith('live-')
  const showActions = canCopy || canReuse || canQuote || canEdit || canBookmark || (row.showForkControls && (row.allowFork || row.allowResume))
  const handleBookmark = useCallback(() => {
    if (!canBookmark) return
    onToggleBookmark(row.message.uuid)
  }, [canBookmark, onToggleBookmark, row.message.uuid])
  const handleCopy = useCallback(() => {
    if (!canCopy) return
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }, [canCopy, copyText])
  const handleReuse = useCallback(() => {
    if (!canReuse) return
    onReusePrompt(copyText)
  }, [canReuse, copyText, onReusePrompt])
  const handleQuote = useCallback(() => {
    if (!canQuote) return
    const selection = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : ''
    onQuoteMessage(selection && selection.length > 0 ? selection : copyText)
  }, [canQuote, copyText, onQuoteMessage])
  const handleEdit = useCallback(() => {
    if (!canEdit) return
    onEditFromMessage(row.message.uuid, copyText)
  }, [canEdit, copyText, onEditFromMessage, row.message.uuid])

  return (
    <div
      style={{
        position: 'relative',
        opacity: row.dimmed ? 0.92 : 1,
        borderRadius: streamMode ? 6 : 10,
        padding: streamMode ? '8px 12px' : undefined,
        // The cyan ring is the transient nav/target highlight; the amber ring
        // is the persistent bookmark accent. Both use theme-aware colours so
        // bookmarks read correctly on every theme. Highlight wins when both.
        boxShadow: streamMode
          ? highlighted
            ? '0 0 0 1.5px rgba(56,217,245,0.55)'
            : bookmarked
              ? '0 0 0 1.5px color-mix(in srgb, var(--t-bookmark) 60%, transparent)'
              : 'none'
          : highlighted
            ? '0 0 0 2px rgba(56,217,245,0.55), 0 0 36px rgba(56,217,245,0.18)'
            : bookmarked
              ? '0 0 0 1.5px color-mix(in srgb, var(--t-bookmark) 60%, transparent), 0 0 22px color-mix(in srgb, var(--t-bookmark) 14%, transparent)'
              : 'none',
        background: streamMode ? 'transparent' : highlighted
          ? 'rgba(56,217,245,0.06)'
          : bookmarked
            ? 'color-mix(in srgb, var(--t-bookmark) 7%, transparent)'
            : 'transparent',
        // Only transition compositor-friendly properties (box-shadow, background).
        // Animating padding would be layout-affecting and re-trigger the per-row
        // ResizeObserver the virtual scroll relies on for measurement — let
        // padding changes (streamMode toggles) apply instantly instead.
        transition: 'box-shadow 180ms ease, background 180ms ease',
      }}
    >
      {bookmarked && !streamMode && (
        <span
          className="timeline-row-bookmark-flag"
          aria-hidden
          title="Bookmarked"
        >
          ★
        </span>
      )}
      {row.previewBadge && !streamMode && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          margin: '0 0 8px 0',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.05em',
        }}>
          {row.activityDetail && (
            <span style={{
              color: 'var(--text-3)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {row.activityDetail}
            </span>
          )}
          <span style={{
            height: 20,
            padding: '0 8px',
            borderRadius: 999,
            border: row.activityTone === 'syncing' ? '1px solid rgba(234,170,64,0.28)' : '1px solid rgba(56,217,245,0.25)',
            background: row.activityTone === 'syncing' ? 'rgba(234,170,64,0.09)' : 'rgba(56,217,245,0.08)',
            color: row.activityTone === 'syncing' ? 'var(--amber, #eaaa40)' : 'var(--cyan)',
            letterSpacing: '0.06em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: row.activityTone === 'syncing' ? 'var(--amber, #eaaa40)' : 'var(--cyan)',
              boxShadow: row.activityTone === 'syncing' ? '0 0 6px rgba(234,170,64,0.45)' : '0 0 6px var(--cyan-glow)',
              animation: row.activityTone === 'syncing' ? undefined : 'pulse 1.2s ease-in-out infinite',
            }} />
            {row.previewBadge}
          </span>
        </div>
      )}
      {row.liveToolActivities && row.liveToolActivities.length > 0 && !streamMode && (
        <div style={{ margin: '0 0 10px 38px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {row.liveToolActivities.map((activity) => (
            <span
              key={activity.key}
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 999,
                border: `1px solid ${activity.status === 'running' ? 'rgba(56,217,245,0.25)' : 'rgba(45,212,160,0.22)'}`,
                background: activity.status === 'running' ? 'rgba(56,217,245,0.08)' : 'rgba(45,212,160,0.08)',
                color: activity.status === 'running' ? 'var(--cyan)' : 'var(--green)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.05em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              title={activity.detail ?? activity.label}
            >
              <span>{activity.label}</span>
              <span style={{ color: activity.status === 'running' ? 'var(--cyan)' : 'var(--green)' }}>
                {activity.status === 'running' ? 'RUNNING' : 'DONE'}
              </span>
            </span>
          ))}
        </div>
      )}
      {showActions && !streamMode && (
        <div className="timeline-row-actions">
          {canBookmark && (
            <button
              type="button"
              className={`timeline-row-action timeline-row-action--bookmark${bookmarked ? ' timeline-row-action--bookmark-active' : ''}`}
              onClick={handleBookmark}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark this message'}
            >
              {bookmarked ? '★ SAVED' : '☆ BOOKMARK'}
            </button>
          )}
          {row.showForkControls && row.allowFork && (
            <button
              type="button"
              className="timeline-row-action timeline-row-action--fork"
              onClick={() => onForkFromMessage(row.message.uuid)}
              disabled={forking}
            >
              {forking ? 'FORKING…' : 'FORK HERE'}
            </button>
          )}
          {row.showForkControls && row.allowResume && (
            <button
              type="button"
              className={`timeline-row-action timeline-row-action--resume${resumeTarget ? ' timeline-row-action--resume-active' : ''}`}
              onClick={() => onToggleResume(row.message.uuid)}
            >
              {resumeTarget ? 'RESUME TARGET' : 'RESUME HERE'}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="timeline-row-action timeline-row-action--resume"
              onClick={handleEdit}
              title="Edit this prompt and resend — replaces from this point"
            >
              EDIT
            </button>
          )}
          {canReuse && (
            <button
              type="button"
              className="timeline-row-action timeline-row-action--copy"
              onClick={handleReuse}
              title="Load this prompt into the composer"
            >
              REUSE
            </button>
          )}
          {canQuote && (
            <button
              type="button"
              className="timeline-row-action timeline-row-action--copy"
              onClick={handleQuote}
              title="Quote selection (or this message) in the composer"
            >
              QUOTE
            </button>
          )}
          {canCopy && (
            <button
              type="button"
              className={`timeline-row-action timeline-row-action--copy${copied ? ' timeline-row-action--copy-active' : ''}`}
              onClick={handleCopy}
              title="Copy message text"
            >
              {copied ? 'COPIED' : 'COPY'}
            </button>
          )}
        </div>
      )}
      <MessageItem message={row.message} showSession={row.showSession} />
    </div>
  )
})

// Pinned todo list — mirrors opencode-web's session-level todos widget.
// Renders status icons and counts inline so users see live progress as
// the agent flips each item from `pending` → `in_progress` → `completed`.
const OpenCodeTodosBanner = memo(function OpenCodeTodosBanner({ todos }: { todos: OpenCodeTodo[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const completedCount = todos.filter((todo) => todo.status === 'completed').length
  const inProgress = todos.find((todo) => todo.status === 'in_progress')

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(56,217,245,0.04)',
        padding: '8px 28px',
        flexShrink: 0,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'transparent',
          border: 0,
          padding: 0,
          color: 'var(--text-2)',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 4,
            background: 'rgba(56,217,245,0.12)',
            color: 'var(--cyan)',
            fontSize: 10,
            letterSpacing: '0.06em',
          }}
          aria-hidden="true"
        >
          {collapsed ? '+' : '−'}
        </span>
        <span style={{ fontWeight: 600, letterSpacing: '0.08em', color: 'var(--cyan)' }}>TODOS</span>
        <span style={{ color: 'var(--text-3)' }}>
          {completedCount}/{todos.length}
          {inProgress ? ` · ${inProgress.content}` : ''}
        </span>
      </button>
      {!collapsed && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0 28px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {todos.map((todo) => (
            <li
              key={todo.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                color: todo.status === 'completed' ? 'var(--text-3)' : 'var(--text)',
                textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
                opacity: todo.status === 'cancelled' ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 12,
                  marginTop: 1,
                  color: todoStatusColor(todo.status),
                }}
              >
                {todoStatusGlyph(todo.status)}
              </span>
              <span style={{ flex: 1 }}>{todo.content}</span>
              {todo.priority && todo.priority !== 'medium' && (
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.08em',
                    color: 'var(--text-3)',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {todo.priority}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

function todoStatusGlyph(status: string): string {
  if (status === 'completed') return '✓'
  if (status === 'in_progress') return '●'
  if (status === 'cancelled') return '✗'
  return '○'
}

function todoStatusColor(status: string): string {
  if (status === 'completed') return 'var(--green)'
  if (status === 'in_progress') return 'var(--cyan)'
  if (status === 'cancelled') return 'var(--text-3)'
  return 'var(--text-3)'
}

const VirtualTimelineRow = memo(function VirtualTimelineRow({
  row,
  top,
  isLast,
  highlighted,
  forking,
  resumeTarget,
  bookmarked,
  streamMode,
  onMeasure,
  onLastRowRef,
  onForkFromMessage,
  onToggleResume,
  onToggleBookmark,
  onReusePrompt,
  onQuoteMessage,
  onEditFromMessage,
}: {
  row: TimelineRow
  top: number
  isLast: boolean
  highlighted: boolean
  forking: boolean
  resumeTarget: boolean
  bookmarked: boolean
  streamMode: boolean
  onMeasure: (key: string, height: number) => void
  onLastRowRef: (node: HTMLDivElement | null) => void
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
  onToggleBookmark: (messageId: string) => void
  onReusePrompt: (text: string) => void
  onQuoteMessage: (text: string) => void
  onEditFromMessage: (messageId: string, text: string) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = rowRef.current
    if (!node) return

    onMeasure(row.key, node.getBoundingClientRect().height)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      onMeasure(row.key, readResizeObserverHeight(entry, node))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [onMeasure, row.key])

  useEffect(() => {
    if (!isLast) return
    onLastRowRef(rowRef.current)
    return () => onLastRowRef(null)
  }, [isLast, onLastRowRef, row.key])

  return (
    <div
      className="timeline-row"
      ref={rowRef}
      data-message-id={row.message.uuid}
      data-timeline-key={row.key}
      style={{
        position: 'absolute',
        top: 0,
        transform: `translateY(${top}px)`,
        left: 0,
        right: 0,
      }}
    >
      <TimelineMessageRow
        row={row}
        highlighted={highlighted}
        forking={forking}
        resumeTarget={resumeTarget}
        bookmarked={bookmarked}
        streamMode={streamMode}
        onForkFromMessage={onForkFromMessage}
        onToggleResume={onToggleResume}
        onToggleBookmark={onToggleBookmark}
        onReusePrompt={onReusePrompt}
        onQuoteMessage={onQuoteMessage}
        onEditFromMessage={onEditFromMessage}
      />
    </div>
  )
})

// Interactive answer surface for a Claude AskUserQuestion prompt. Collects a
// selection per question (single or multi) and submits the answers map back to
// the running turn. Lives in the composer's pending-approval area.
function AskUserQuestionPicker({
  permission,
  busy,
  onSubmit,
  onCancel,
}: {
  permission: PendingPermission
  busy: boolean
  onSubmit: (answers: Record<string, string>) => void
  onCancel: () => void
}) {
  const questions = permission.questions ?? []
  const [selections, setSelections] = useState<Record<number, string[]>>({})
  const [openPreview, setOpenPreview] = useState<string | null>(null)

  const toggle = (qi: number, multiSelect: boolean, label: string) => {
    setSelections((prev) => {
      const current = prev[qi] ?? []
      let next: string[]
      if (multiSelect) {
        next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label]
      } else {
        next = current.length === 1 && current[0] === label ? current : [label]
      }
      return { ...prev, [qi]: next }
    })
  }

  const allAnswered = questions.every((_, qi) => (selections[qi]?.length ?? 0) > 0)

  const submit = () => {
    if (!allAnswered || busy) return
    const answers: Record<string, string> = {}
    questions.forEach((q, qi) => {
      const sel = selections[qi]
      if (sel && sel.length > 0) answers[q.question] = sel.join(', ')
    })
    onSubmit(answers)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '10px 11px',
        borderRadius: 6,
        border: '1px solid rgba(139,128,240,0.30)',
        background: 'rgba(139,128,240,0.06)',
      }}
    >
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--violet)', letterSpacing: '0.06em' }}>
        {questions.length === 1 ? 'CLAUDE ASKS' : `CLAUDE ASKS · ${questions.length} QUESTIONS`}
      </div>
      {questions.map((q, qi) => {
        const selected = selections[qi] ?? []
        return (
          <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {q.header && (
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                  color: 'var(--text-3)',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  flexShrink: 0,
                }}>
                  {q.header.toUpperCase()}
                </span>
              )}
              <span>{q.question}{q.multiSelect ? <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>(select all that apply)</span> : null}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {q.options.map((opt, oi) => {
                const isSelected = selected.includes(opt.label)
                const previewKey = `${qi}:${oi}`
                const previewOpen = openPreview === previewKey
                return (
                  <div key={oi}>
                    <button
                      type="button"
                      onClick={() => toggle(qi, q.multiSelect === true, opt.label)}
                      disabled={busy}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '6px 10px',
                        borderRadius: 4,
                        border: `1px solid ${isSelected ? 'rgba(139,128,240,0.55)' : 'var(--border)'}`,
                        background: isSelected
                          ? 'linear-gradient(to right, rgba(139,128,240,0.16), rgba(139,128,240,0.05))'
                          : 'var(--surface)',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        transition: 'border-color 0.14s ease, background 0.14s ease',
                      }}
                    >
                      <span style={{
                        width: 14, height: 14,
                        borderRadius: q.multiSelect ? 3 : '50%',
                        border: `1.5px solid ${isSelected ? 'var(--violet)' : 'var(--border-2)'}`,
                        background: isSelected ? 'var(--violet)' : 'transparent',
                        flexShrink: 0,
                        marginTop: 2,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isSelected && <span style={{ fontSize: 8, color: 'var(--bg)', lineHeight: 1, fontWeight: 700 }}>✓</span>}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontFamily: "'IBM Plex Sans', sans-serif",
                          fontSize: 13, fontWeight: isSelected ? 600 : 400,
                          color: isSelected ? 'var(--text)' : 'var(--text-2)',
                        }}>
                          {opt.label}
                          {opt.preview && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setOpenPreview(previewOpen ? null : previewKey) }}
                              style={{
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 10, color: 'var(--text-3)',
                                border: '1px solid var(--border)',
                                borderRadius: 3,
                                padding: '0 4px',
                                cursor: 'pointer',
                              }}
                            >
                              {previewOpen ? '▲ preview' : '▼ preview'}
                            </span>
                          )}
                        </span>
                        {opt.description && (
                          <span style={{
                            display: 'block',
                            fontFamily: "'IBM Plex Sans', sans-serif",
                            fontSize: 11, color: 'var(--text-3)',
                            marginTop: 2, lineHeight: 1.5,
                          }}>
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </button>
                    {opt.preview && previewOpen && (
                      <pre style={{
                        margin: '2px 0 0',
                        padding: '8px 12px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11, lineHeight: 1.6,
                        color: 'var(--text-2)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderTop: 'none',
                        borderRadius: '0 0 4px 4px',
                        overflowX: 'auto',
                        whiteSpace: 'pre',
                      }}>
                        {opt.preview}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <Button
          type="button"
          onClick={onCancel}
          disabled={busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            border: '1px solid rgba(248,113,113,0.24)',
            background: 'rgba(248,113,113,0.08)',
            color: 'var(--red, #f87171)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.06em',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          SKIP
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={!allAnswered || busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 12px', borderRadius: 4,
            border: '1px solid rgba(139,128,240,0.40)',
            background: 'rgba(139,128,240,0.14)',
            color: 'var(--violet)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.06em',
            cursor: (!allAnswered || busy) ? 'not-allowed' : 'pointer',
            opacity: (!allAnswered || busy) ? 0.55 : 1,
          }}
        >
          {busy ? 'SENDING…' : 'SUBMIT'}
        </Button>
      </div>
    </div>
  )
}

export default function MessageView({
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
  taskPanelOpenRequest = 0,
  promptLibraryOpenRequest = 0,
  channelBridgeOpenRequest = 0,
  channelBridgeRouteToggleRequest = 0,
  onChannelBridgeRoutingChange,
  openCodeTodos,
  codexPlan,
}: Props) {
  const [inputText, setInputText] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [livePromptSuggestion, setLivePromptSuggestion] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<'requesting' | 'compacting' | 'retrying' | null>(null)
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  const [liveSubagentText, setLiveSubagentText] = useState<Record<string, string>>({})
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<SessionModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState<'auto' | ReasoningEffortLevel>('auto')
  const [selectedCopilotContextTier, setSelectedCopilotContextTier] = useState<CopilotContextTier>('default')
  const [composerOptions, setComposerOptions] = useState<SessionComposerOptions>({})
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedCopilotMode, setSelectedCopilotMode] = useState('interactive')
  // Claude `/permissions` modes — passed through to body.permissionMode on send.
  const [selectedPermissionMode, setSelectedPermissionMode] = useState<'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'>('default')
  // Codex `/approvals` policy — passed through to body.approvalPolicy on send.
  // 'auto' leaves the app-server's configured default untouched.
  const [selectedCodexApproval, setSelectedCodexApproval] = useState<'auto' | 'untrusted' | 'on-request' | 'on-failure' | 'never'>('auto')
  // Mirrors the CLI "queue next prompt while streaming" behavior. When a send
  // fires while one is in flight, the draft is captured here and flushed by an
  // effect once the active turn finishes.
  // FIFO backlog of follow-up prompts typed while a turn is in flight. Native
  // CLIs queue an arbitrary number of follow-ups; a single overwritten slot
  // silently dropped all but the most recent draft.
  const [queuedSends, setQueuedSends] = useState<Array<{ text: string; attachments: SendAttachment[] }>>([])
  const queuedSendsRef = useRef<Array<{ text: string; attachments: SendAttachment[] }>>([])
  useEffect(() => { queuedSendsRef.current = queuedSends }, [queuedSends])
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredNotice, setSteeredNotice] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<SendAttachment[]>([])
  const [attachmentType, setAttachmentType] = useState<SendAttachment['type']>('file')
  const [attachmentPath, setAttachmentPath] = useState('')
  const [failedSend, setFailedSend] = useState<FailedSend | null>(null)
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
  const [showVisualizer, setShowVisualizer] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('agentViewer:messageVisualizer') === 'true'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:messageVisualizer', showVisualizer ? 'true' : 'false')
  }, [showVisualizer])
  const [transcriptFilters, setTranscriptFilters] = useState<ActiveTranscriptFilter[]>([])
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const deferredTranscriptSearch = useDeferredValue(transcriptSearch)
  // Bookmarked message uuids for the active session (local-only, mirrored via
  // /api/sessions/[id]/bookmarks). bookmarkIdsRef keeps the toggle callback
  // stable without re-creating it on every bookmark change.
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(() => new Set())
  const bookmarkIdsRef = useRef<Set<string>>(bookmarkIds)
  bookmarkIdsRef.current = bookmarkIds
  const [bookmarksOnly, setBookmarksOnly] = useState(false)
  const [viewMode, setViewMode] = useState<WebViewMode>(() => {
    if (typeof window === 'undefined') return 'conversation'
    const stored = window.localStorage.getItem('agentViewer:viewMode')
    if (stored === 'full' || stored === 'continue' || stored === 'stream') return stored
    // Migrate legacy showTools=false → continue
    if (window.localStorage.getItem('agentViewer:showTools') === 'false') return 'continue'
    return 'conversation'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:viewMode', viewMode)
    rowHeightsRef.current.clear()
    timelineEstimateCalibrationRef.current.clear()
    timelineEstimateSamplesRef.current.clear()
    timelineEstimateCalibrationFrozenRef.current = false
    setRowMeasurementVersion((version) => version + 1)
    setPersistedMeasurementVersion((version) => version + 1)
  }, [viewMode])
  const showTools = viewMode === 'conversation' || viewMode === 'full'
  const [density, setDensity] = useState<MessageDensity>(() => {
    if (typeof window === 'undefined') return 'balanced'
    const stored = window.localStorage.getItem('agentViewer:density')
    return (stored === 'comfortable' || stored === 'dense') ? stored : 'balanced'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:density', density)
    rowHeightsRef.current.clear()
    timelineEstimateCalibrationRef.current.clear()
    timelineEstimateSamplesRef.current.clear()
    timelineEstimateCalibrationFrozenRef.current = false
    setRowMeasurementVersion((version) => version + 1)
    setPersistedMeasurementVersion((version) => version + 1)
  }, [density])
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>(() => {
    if (typeof window === 'undefined') return 'stacked'
    const stored = window.localStorage.getItem('agentViewer:diffStyle')
    return stored === 'split' ? 'split' : 'stacked'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:diffStyle', diffStyle)
  }, [diffStyle])
  const [diffOptions, setDiffOptions] = useState<DiffOptions>(() => {
    if (typeof window === 'undefined') return DEFAULT_DIFF_OPTIONS
    const changeStyle = window.localStorage.getItem('agentViewer:diffChangeStyle')
    const inlineDiffStyle = window.localStorage.getItem('agentViewer:diffInlineStyle')
    const showBackgrounds = window.localStorage.getItem('agentViewer:diffShowBackgrounds')
    const wrap = window.localStorage.getItem('agentViewer:diffWrap')
    const showLineNumbers = window.localStorage.getItem('agentViewer:diffShowLineNumbers')
    const showHunkHeaders = window.localStorage.getItem('agentViewer:diffShowHunkHeaders')
    return {
      changeStyle: changeStyle === 'bars' || changeStyle === 'classic' || changeStyle === 'none' ? changeStyle : DEFAULT_DIFF_OPTIONS.changeStyle,
      inlineDiffStyle: inlineDiffStyle === 'word-alt' || inlineDiffStyle === 'word' || inlineDiffStyle === 'char' || inlineDiffStyle === 'none' ? inlineDiffStyle : DEFAULT_DIFF_OPTIONS.inlineDiffStyle,
      showBackgrounds: showBackgrounds === null ? DEFAULT_DIFF_OPTIONS.showBackgrounds : showBackgrounds === 'true',
      wrap: wrap === null ? DEFAULT_DIFF_OPTIONS.wrap : wrap === 'true',
      showLineNumbers: showLineNumbers === null ? DEFAULT_DIFF_OPTIONS.showLineNumbers : showLineNumbers === 'true',
      showHunkHeaders: showHunkHeaders === null ? DEFAULT_DIFF_OPTIONS.showHunkHeaders : showHunkHeaders === 'true',
    }
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:diffChangeStyle', diffOptions.changeStyle)
    window.localStorage.setItem('agentViewer:diffInlineStyle', diffOptions.inlineDiffStyle)
    window.localStorage.setItem('agentViewer:diffShowBackgrounds', String(diffOptions.showBackgrounds))
    window.localStorage.setItem('agentViewer:diffWrap', String(diffOptions.wrap))
    window.localStorage.setItem('agentViewer:diffShowLineNumbers', String(diffOptions.showLineNumbers))
    window.localStorage.setItem('agentViewer:diffShowHunkHeaders', String(diffOptions.showHunkHeaders))
  }, [diffOptions])
  const [composerCollapsed, setComposerCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('agentViewer:composerCollapsed') === 'true'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:composerCollapsed', composerCollapsed ? 'true' : 'false')
  }, [composerCollapsed])
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
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
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(null)
  // Messages steered INTO the running turn — echoed in the live overlay until
  // the persisted transcript reconciles (same lifecycle as optimisticUserText).
  const [steeredUserTexts, setSteeredUserTexts] = useState<string[]>([])
  const [backgroundingTasks, setBackgroundingTasks] = useState(false)
  // True from when the user hits stop until the interrupted turn's partial
  // output reconciles (or the awaitingPersistedTurn escape hatch fires). Lets
  // the composer show a definite "Interrupting…" instead of snapping to idle
  // while the agent is still wrapping up server-side.
  const [interrupting, setInterrupting] = useState(false)
  // Reattach: a turn is running server-side that this client does NOT own (it
  // was started before a navigation/reload — turns keep running via
  // detachOnClientAbort). Detected by polling /running while we're otherwise
  // idle. When set, the composer reflects the live turn (stop button, steer on
  // send) and the persisted poll surfaces output until the turn finishes.
  const [reattachedRunning, setReattachedRunning] = useState(false)
  const reattachedRunningRef = useRef(false)
  useEffect(() => { reattachedRunningRef.current = reattachedRunning }, [reattachedRunning])
  const [liveAssistantText, setLiveAssistantText] = useState('')
  // Reasoning/thinking streams on its own channel so it renders as a distinct
  // dim block above the answer (like the native CLIs) instead of being folded
  // into the reply text.
  const [liveReasoningText, setLiveReasoningText] = useState('')
  const [liveToolActivities, setLiveToolActivities] = useState<LiveToolActivity[]>([])
  const [liveThreadedMessages, setLiveThreadedMessages] = useState<ThreadedMessage[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useState(false)
  const [autoFollow, setAutoFollow] = useState(false)
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0)
  const [timelineHeightOverride, setTimelineHeightOverride] = useState<number | null>(null)
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  // Bumps only when a PERSISTED row's measured height changes (or rows reset),
  // never on live-row height growth. Keys the persisted base layout so a
  // streaming turn doesn't rebuild the whole transcript layout each frame.
  const [persistedMeasurementVersion, setPersistedMeasurementVersion] = useState(0)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<string[]>(readPersistedSentHistory)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef<{ text: string; cursorPos: number }>({ text: '', cursorPos: 0 })
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([])
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const mentionAbortRef = useRef<AbortController | null>(null)
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const [channelBridgeOpen, setChannelBridgeOpen] = useState(false)
  const channelBridge = useChannelBridge({ open: channelBridgeOpen })
  // Read the latest bridge controller from inside sendMessage without widening
  // its (already large) dependency array.
  const channelBridgeRef = useRef(channelBridge)
  channelBridgeRef.current = channelBridge
  // Track bridge entries (sent + replies) with timestamps for inline transcript display
  const [bridgeTranscriptEntries, setBridgeTranscriptEntries] = useState<
    Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }>
  >([])
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [liveSlashCommands, setLiveSlashCommands] = useState<SlashCommandSuggestion[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const lastTimelineRowRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeTurnRequestIdRef = useRef<string | null>(null)
  const inputTextRef = useRef(inputText)
  const suppressDraftSaveRef = useRef(false)
  const sendInFlightRef = useRef(false)
  const awaitingPersistedTurnRef = useRef(false)
  const pushedCopilotAttachmentsRef = useRef<SendAttachment[]>([])
  // Transient auto-retry bookkeeping. turnProducedOutputRef gates retries to
  // turns that streamed nothing yet (so a retry can't duplicate work);
  // transientRetryCountRef counts attempts within one logical send;
  // transientRetryTimerRef holds the pending backoff so cancel can clear it.
  const turnProducedOutputRef = useRef(false)
  const transientRetryCountRef = useRef(0)
  const transientRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingMessageBaselineRef = useRef<PendingMessageBaseline | null>(null)
  const liveTurnSessionHandoffRef = useRef<string | null>(null)
  const liveAssistantTextRef = useRef('')
  const pendingLiveAssistantTextRef = useRef<string | null>(null)
  const liveAssistantFlushFrameRef = useRef<number | null>(null)
  // Reasoning shares the assistant flush frame (one RAF flushes both buffers).
  const liveReasoningTextRef = useRef('')
  const pendingLiveReasoningTextRef = useRef<string | null>(null)
  // Ref-backed source of truth for per-subagent streamed text. Deltas mutate
  // this ref and a single RAF flushes a fresh snapshot into state, so a burst
  // of subagent tokens collapses to one re-render per frame instead of one per
  // token re-rendering every mounted AgentCard via LiveSubagentTextContext.
  const liveSubagentTextRef = useRef<Record<string, string>>({})
  const liveSubagentFlushFrameRef = useRef<number | null>(null)
  const liveToolIndexesRef = useRef<Map<number, string>>(new Map())
  const liveToolInputJsonRef = useRef<Map<number, string>>(new Map())
  const rowHeightsRef = useRef<Map<string, number>>(new Map())
  const timelineEstimateCalibrationRef = useLazyRef(
    () => new Map<TimelineEstimateBucket | 'all', TimelineEstimateCalibration>(),
  )
  const timelineEstimateSamplesRef = useLazyRef(() => new Map<string, TimelineEstimateSample>())
  // Recalibrate during initial settling, then keep estimates stable once the
  // user starts manipulating the scrollbar.
  const timelineEstimateCalibrationFrozenRef = useRef(false)
  const rowLayoutRef = useRef<TimelineRowLayout>(buildTimelineRowLayout([], new Map(), estimateTimelineRowHeight))
  const threadedCacheRef = useRef<Map<string, ThreadedMessage>>(new Map())
  const prevThreadingRef = useRef<IncrementalThreadingCache | null>(null)
  // Last taskActiveForms Map, reused when contents are unchanged so the context
  // value identity stays stable across idle polls.
  const taskActiveFormsRef = useRef<Map<string, string>>(new Map())
  const pendingRowMeasurementsRef = useRef<Map<string, number>>(new Map())
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
      if (activeProvider === 'pi') return level === 'off' || level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh'
      return false
    }) ?? []
    if (levels.length > 0) return levels
    if (activeProvider === 'pi') return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    if (activeProvider === 'codex') return ['low', 'medium', 'high']
    return ['low', 'medium', 'high']
  }, [activeProvider, selectedModelInfo])
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
  }, [])

  const flushLiveAssistantTextNow = useCallback(() => {
    if (liveAssistantFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveAssistantFlushFrameRef.current)
      liveAssistantFlushFrameRef.current = null
    }
    flushLiveAssistantText()
  }, [flushLiveAssistantText])

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
  }, [])

  const queueLiveAssistantText = useCallback((deltaText: string, replace: boolean) => {
    const nextText = replace ? deltaText : `${liveAssistantTextRef.current}${deltaText}`
    liveAssistantTextRef.current = nextText
    pendingLiveAssistantTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText])

  // Reasoning is always append-only (no replace semantics like the codex
  // realtime answer transcript), and piggybacks on the assistant flush frame.
  const queueLiveReasoningText = useCallback((deltaText: string) => {
    const nextText = `${liveReasoningTextRef.current}${deltaText}`
    liveReasoningTextRef.current = nextText
    pendingLiveReasoningTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText])

  const flushLiveSubagentText = useCallback(() => {
    liveSubagentFlushFrameRef.current = null
    // Snapshot the ref into a fresh object so context consumers see one new
    // identity per frame; the ref keeps mutating in place between flushes.
    setLiveSubagentText({ ...liveSubagentTextRef.current })
  }, [])

  const scheduleLiveSubagentFlush = useCallback(() => {
    if (liveSubagentFlushFrameRef.current == null) {
      liveSubagentFlushFrameRef.current = window.requestAnimationFrame(flushLiveSubagentText)
    }
  }, [flushLiveSubagentText])

  const queueLiveSubagentDelta = useCallback((parentId: string, delta: string) => {
    const map = liveSubagentTextRef.current
    map[parentId] = (map[parentId] ?? '') + delta
    scheduleLiveSubagentFlush()
  }, [scheduleLiveSubagentFlush])

  const removeLiveSubagentEntry = useCallback((parentId: string) => {
    const map = liveSubagentTextRef.current
    if (!(parentId in map)) return
    delete map[parentId]
    scheduleLiveSubagentFlush()
  }, [scheduleLiveSubagentFlush])

  const clearLiveSubagentText = useCallback(() => {
    if (liveSubagentFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveSubagentFlushFrameRef.current)
      liveSubagentFlushFrameRef.current = null
    }
    liveSubagentTextRef.current = {}
    setLiveSubagentText({})
  }, [])

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
  }, [])

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
  }, [session, selectedModel])

  const commitClaudePermissionSelection = useCallback((nextMode: typeof selectedPermissionMode) => {
    setSelectedPermissionMode(nextMode)
    if (!session || session.provider !== 'claude' || session.isPending) return
    if (nextMode === selectedPermissionMode) return
    void fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', action: 'setPermissionMode', permissionMode: nextMode }),
    }).catch(() => { /* swallow; next send carries body.permissionMode */ })
  }, [session, selectedPermissionMode])

  const commitCopilotModeSelection = useCallback((nextMode: string) => {
    setSelectedCopilotMode(nextMode)
    if (!session || session.provider !== 'copilot' || session.isPending) return
    if (nextMode === selectedCopilotMode) return
    void fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'copilot', action: 'setMode', mode: nextMode }),
    }).catch(() => { /* swallow; next send carries body.mode */ })
  }, [session, selectedCopilotMode])

  useLayoutEffect(() => {
    resizeComposer()
  }, [inputText, resizeComposer])

  // Load session info (git branch, summary, etc.) when session changes
  useEffect(() => {
    if (!session) { setSessionInfo(null); return }
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}`, session.provider))
      .then(r => r.json())
      .then(data => { if (!data.error) setSessionInfo(data.info) })
      .catch(() => {})
  }, [session?.provider, session?.sessionId])

  // Load message bookmarks for the active session. Reset the "bookmarks only"
  // filter on every session switch so a stale focus doesn't carry over.
  useEffect(() => {
    setBookmarksOnly(false)
    if (!session || session.isPending) { setBookmarkIds(new Set()); return }
    let cancelled = false
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}/bookmarks`, session.provider))
      .then(r => r.json())
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
      body: JSON.stringify({ provider: session.provider, uuid, bookmarked: next, meta }),
    })
      .then((r) => r.json())
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
  const refreshSessionModels = useCallback(({ preserveSelection }: { preserveSelection: boolean }) => {
    if (!modelSessionId) return
    fetch(withProviderQuery(`/api/sessions/${modelSessionId}/models`, modelSessionProvider))
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        const nextModels = Array.isArray(data.models) ? data.models.filter((model: SessionModelInfo) => normalizeSelectValue(model.value)) : []
        setAvailableModels(nextModels)
        const live = normalizeSelectValue(data.currentModel)
        const liveContextTier = data.currentContextTier === 'long_context' ? 'long_context' : 'default'
        setSelectedCopilotContextTier(liveContextTier)
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
  }, [modelSessionId, modelSessionProvider])

  useEffect(() => {
    if (!session) {
      setAvailableModels([])
      setSelectedModel('')
      setSelectedEffort('auto')
      setSelectedCopilotContextTier('default')
      return
    }
    refreshSessionModels({ preserveSelection: false })
  }, [session?.provider, session?.sessionId, refreshSessionModels])

  useEffect(() => {
    if (!session) {
      setComposerOptions({})
      setSelectedAgent('')
      setSelectedCopilotMode('interactive')
      return
    }

    const controller = new AbortController()
    fetch(withProviderQuery(`/api/sessions/${session.sessionId}/composer`, session.provider), { signal: controller.signal })
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
      if (selectedCopilotContextTier !== 'default') setSelectedCopilotContextTier('default')
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
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    activeTurnRequestIdRef.current = null
    sendInFlightRef.current = false
    awaitingPersistedTurnRef.current = false
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
    setAutoFollow(false)
    setTimelineScrollTop(0)
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
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()
    initialScrollDoneRef.current = false
  }, [clearLiveAssistantText, session?.sessionId])

  useEffect(() => {
    suppressDraftSaveRef.current = true
    const draft = readComposerDraft(composerDraftKey)
    setInputText(draft.text)
    inputTextRef.current = draft.text
    setAttachments(draft.attachments)

    window.requestAnimationFrame(() => {
      suppressDraftSaveRef.current = false
      resizeComposer()
    })
  }, [composerDraftKey, resizeComposer])

  const autoFocusedSessionsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (suppressDraftSaveRef.current) return
    writeComposerDraft(composerDraftKey, {
      text: inputText,
      attachments,
    })
  }, [attachments, composerDraftKey, inputText])

  useEffect(() => () => {
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
      activeTimelineScrollAnchorRef.current ??= captureTimelineScrollAnchor()
      timelineHeightOverrideRef.current = null
      pendingTimelineAnchorRestoreRef.current = true
      setTimelineHeightOverride(null)
      scheduleTimelineMeasurementFlushRef.current()
    }, SCROLL_IDLE_MS)
  }, [captureTimelineScrollAnchor])

  useEffect(() => {
    const node = timelineRef.current
    if (!node) return

    const updateMetrics = () => {
      setTimelineViewportHeight(node.clientHeight)
      setTimelineScrollTop(node.scrollTop)
    }

    updateMetrics()
    const observer = new ResizeObserver(() => updateMetrics())
    observer.observe(node)
    const handleWheel = () => {
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
  }, [markTimelineUserScrolling, showDiagnostics, showVisualizer, session?.sessionId])

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
    setTimelineScrollTop(node.scrollTop)
  }, [markProgrammaticTimelineScroll])

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = timelineRef.current
    if (!node) return
    const targetTop = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
    setTimelineScrollTop(targetTop)
    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll(behavior === 'smooth' ? 700 : undefined)
    node.scrollTo({ top: targetTop, behavior })
  }, [markProgrammaticTimelineScroll])

  const toggleLiveFollow = useCallback(() => {
    setAutoFollow((current) => {
      const next = !current
      if (next) {
        window.requestAnimationFrame(() => scrollTimelineToBottom())
      }
      return next
    })
  }, [scrollTimelineToBottom])

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
    setTimelineScrollTop(targetTop)
  }, [markProgrammaticTimelineScroll])

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
      setTimelineScrollTop(node.scrollTop)
      if (performance.now() < suppressFollowEvalUntilRef.current) return
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setAutoFollow(distanceFromBottom <= TIMELINE_BOTTOM_GUTTER_PX + 16)
    })
  }, [markTimelineUserScrolling])

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
      setTimelineScrollTop(targetTop)
    }
    return true
  }, [markProgrammaticTimelineScroll])

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
      return
    }
    const sessionId = session.sessionId
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
          const info = (await res.json().catch(() => null)) as { running?: boolean } | null
          const running = info?.running === true
          setReattachedRunning((prev) => (prev === running ? prev : running))
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
  }, [session?.sessionId, projectView])

  const cancelSend = useCallback(() => {
    if (session) {
      fetch(`/api/sessions/${session.sessionId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: session.provider,
          turnRequestId: activeTurnRequestIdRef.current ?? undefined,
        }),
      }).catch(() => {})
    }
    // Cancel any pending transient auto-retry so it can't fire after the user
    // explicitly stopped the turn.
    if (transientRetryTimerRef.current) {
      clearTimeout(transientRetryTimerRef.current)
      transientRetryTimerRef.current = null
    }
    transientRetryCountRef.current = 0
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    activeTurnRequestIdRef.current = null
    sendInFlightRef.current = false
    setSendError(null)
    setSendState('idle')
    // The user interrupted to change course — auto-firing queued follow-ups
    // would be a surprise-send. Pop their text back into the composer instead
    // so they can edit and re-send.
    const interruptQueuedTexts = queuedSendsRef.current.map((entry) => entry.text).filter(Boolean)
    if (interruptQueuedTexts.length > 0) {
      setQueuedSends([])
      setInputText((current) => {
        const restored = [current.trim(), ...interruptQueuedTexts].filter(Boolean).join('\n\n')
        inputTextRef.current = restored
        if (textareaRef.current) textareaRef.current.value = restored
        return restored
      })
      window.requestAnimationFrame(resizeComposer)
    }
    if (pendingMessageBaselineRef.current) {
      // The turn had started: keep whatever the agent produced visible and
      // transition into the 'Interrupting…' / syncing state so the interrupted
      // turn's partial output reconciles smoothly instead of vanishing and then
      // reappearing on the next poll. The awaitingPersistedTurn timeout is the
      // escape hatch if the interrupt is a no-op and nothing ever persists.
      setInterrupting(true)
      awaitingPersistedTurnRef.current = true
      setAwaitingPersistedTurn(true)
    } else {
      // Nothing started yet — restore the draft and clear cleanly, as if unsent.
      // (Also the reattach path: we don't own a stream, so stop just fires the
      // server interrupt and drops back to idle; the /running poll reconciles.)
      setReattachedRunning(false)
      if (optimisticUserText) setInputText((prev) => prev || optimisticUserText)
      setInterrupting(false)
      awaitingPersistedTurnRef.current = false
      setAwaitingPersistedTurn(false)
      setOptimisticUserText(null)
      setSteeredUserTexts([])
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      clearLiveSubagentText()
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
      liveToolInputJsonRef.current.clear()
    }
    textareaRef.current?.focus()
  }, [clearLiveAssistantText, clearLiveSubagentText, optimisticUserText, resizeComposer, session])

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
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const backgrounded = data.result?.backgrounded === true
      setSessionActionNotice(backgrounded ? 'Claude task moved to background.' : 'No foreground Claude task to background.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to background Claude task')
    } finally {
      setBackgroundingTasks(false)
      textareaRef.current?.focus()
    }
  }, [backgroundingTasks, session])

  const sendMessage = useCallback(async (retryOverride?: { text: string; attachments: SendAttachment[] }) => {
    if (!session) return

    // Global Channel Bridge binding: when the user has toggled "route composer
    // through bridge", a normal composer send (never an auto-retry) is diverted
    // to the live `claude` CLI session instead of the active provider. The send
    // is fire-and-forget — replies/permission prompts surface in the bridge
    // panel — so we just push the text, clear the composer, and return before
    // any of the provider streaming machinery runs.
    const bridge = channelBridgeRef.current
    if (!retryOverride && bridge.routeComposer) {
      const text = (textareaRef.current?.value ?? inputTextRef.current).trim()
      if (!text) return
      try {
        await bridge.send(text)
        setInputText('')
        inputTextRef.current = ''
        if (textareaRef.current) textareaRef.current.value = ''
        setAttachments([])
        window.requestAnimationFrame(resizeComposer)
      } catch {
        // error surfaced via the bridge panel (bridge.sendError)
      }
      return
    }
    // Native CLIs (Claude, Codex) accept a follow-up prompt while the current
    // turn is still streaming — they queue it. Mirror that: if a send fires
    // while one is in flight, stash the draft and have the post-stream effect
    // flush it once the current turn lands. A transient auto-retry (retryOverride)
    // is never a queue candidate — it only fires after the failed turn settled.
    if (!retryOverride && (sendInFlightRef.current || awaitingPersistedTurnRef.current || reattachedRunningRef.current)) {
      const queueText = (textareaRef.current?.value ?? inputTextRef.current).trim()
      if (!queueText) return
      const queueAttachments = attachments
      setInputText('')
      inputTextRef.current = ''
      textareaRef.current?.value !== undefined && (textareaRef.current!.value = '')
      setAttachments([])
      window.requestAnimationFrame(resizeComposer)
      // Native steering first: deliver the message INTO the running turn
      // (Claude pushes onto the warm query's input stream, Codex turn/steer,
      // Pi steer(), opencode queues server-side). Attachments can't ride a
      // steer, and a turn in post-stream reconcile has nothing to steer —
      // those (and delivered:false / errors) fall back to the client queue.
      if ((sendInFlightRef.current || reattachedRunningRef.current) && queueAttachments.length === 0) {
        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'steer', message: queueText, provider: session.provider }),
          })
          if (res.ok) {
            const json = await res.json().catch(() => ({})) as { result?: { delivered?: unknown } }
            if (json.result?.delivered === true) {
              setSteeredNotice(queueText)
              // Echo it into the live overlay immediately — it's part of the
              // running turn now, like typing in the provider's native CLI.
              setSteeredUserTexts((prev) => [...prev, queueText])
              return
            }
          }
        } catch {
          // Steering is best-effort; the queue below is the reliable path.
        }
      }
      setQueuedSends((prev) => [...prev, { text: queueText, attachments: queueAttachments }])
      return
    }

    const text = retryOverride ? retryOverride.text : (textareaRef.current?.value ?? inputTextRef.current).trim()
    if (!text) return

    // Reset the retry counter at the start of a fresh (non-retry) send.
    if (!retryOverride) transientRetryCountRef.current = 0
    turnProducedOutputRef.current = false

    sendInFlightRef.current = true
    // We now own a live stream — drop any reattach tracking so the turn renders
    // from the stream, not the /running poll.
    reattachedRunningRef.current = false
    setReattachedRunning(false)
    pushedCopilotAttachmentsRef.current = []
    const sendAttachments = retryOverride ? retryOverride.attachments : attachments
    const effort = selectedEffort === 'auto' ? undefined : selectedEffort
    setSentHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === text) return prev
      const next = [...prev, text]
      const capped = next.length > SENT_HISTORY_MAX ? next.slice(next.length - SENT_HISTORY_MAX) : next
      writePersistedSentHistory(capped)
      return capped
    })
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    setInputText('')
    inputTextRef.current = ''
    setSendState('sending')
    setSteeredNotice(null)
    setSendError(null)
    setFailedSend(null)
    setInterrupting(false)
    setOptimisticUserText(text)
    setSteeredUserTexts([])
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setLivePromptSuggestion(null)
    setLiveStatus(null)
    clearLiveSubagentText()
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    setAutoFollow(true)
    pendingMessageBaselineRef.current = buildPendingMessageBaseline(messages, session.sessionId)
    liveToolIndexesRef.current.clear()
    liveToolInputJsonRef.current.clear()

    window.requestAnimationFrame(resizeComposer)

    const controller = new AbortController()
    const turnRequestId = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    abortControllerRef.current = controller
    activeTurnRequestIdRef.current = turnRequestId

    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          model: selectedModel || undefined,
          effort,
          attachments: sendAttachments,
          resumeSessionAt: resumeFromMessageId ?? undefined,
          forkSession: Boolean(resumeFromMessageId),
          provider: session.provider,
          agent: session.provider === 'opencode' && selectedAgent ? selectedAgent : undefined,
          mode: session.provider === 'copilot' ? selectedCopilotMode : undefined,
          contextTier: session.provider === 'copilot'
            ? selectedCopilotContextTier
            : undefined,
          manualPermissions: session.provider === 'copilot'
            || (session.provider === 'claude' && selectedPermissionMode !== 'bypassPermissions' && selectedPermissionMode !== 'plan')
            ? true : undefined,
          nativeCommands: session.provider === 'copilot' ? true : undefined,
          detachOnClientAbort: true,
          turnRequestId,
          taskBudgetTokens: taskBudgetTokens ?? undefined,
          isPendingSession: session.isPending === true ? true : undefined,
          cwd: session.cwd ?? undefined,
          permissionMode: session.provider === 'claude' && selectedPermissionMode !== 'default'
            ? selectedPermissionMode
            : undefined,
          approvalPolicy: session.provider === 'codex' && selectedCodexApproval !== 'auto'
            ? selectedCodexApproval
            : undefined,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      if (!res.body) throw new Error('No response stream returned')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const { frames, remaining } = extractSseFrames(sseBuffer)
        sseBuffer = remaining

        for (const frame of frames) {
          if (frame.event === 'context-usage') {
            try { setContextUsage(JSON.parse(frame.data)) } catch { /* ignore */ }
            continue
          }

          if (frame.event === 'session') {
            try {
              const parsed = JSON.parse(frame.data)
              if (resumeFromMessageId && parsed.sessionId && parsed.sessionId !== session.sessionId) {
                liveTurnSessionHandoffRef.current = parsed.sessionId
                if (pendingMessageBaselineRef.current) {
                  pendingMessageBaselineRef.current = retargetPendingMessageBaseline(pendingMessageBaselineRef.current, parsed.sessionId)
                }
                onFork?.(parsed.sessionId)
                setSessionActionNotice('Forked a continuation from the selected point.')
              } else if (session.isPending && parsed.sessionId) {
                // Swap to the real SDK session id silently. Real CLI shows no
                // "new session created" banner — the streaming reply itself
                // signals that the session is live.
                liveTurnSessionHandoffRef.current = parsed.sessionId
                if (pendingMessageBaselineRef.current) {
                  pendingMessageBaselineRef.current = retargetPendingMessageBaseline(pendingMessageBaselineRef.current, parsed.sessionId, true)
                }
                onFork?.(parsed.sessionId)
              }
            } catch { /* ignore */ }
            continue
          }

          if (frame.event === 'error') {
            try {
              const parsed = JSON.parse(frame.data)
              throw new Error(parsed.error ?? 'Unknown agent error')
            } catch (e) { throw e }
          }

          // OpenCode session.status frames mirror opencode-web's busy
          // indicator. Maps to our own live-status state.
          if (frame.event === 'opencode-status') {
            try {
              const parsed = JSON.parse(frame.data) as { type?: string }
              if (parsed.type === 'busy') setLiveStatus('requesting')
              else if (parsed.type === 'idle') setLiveStatus(null)
            } catch { /* ignore */ }
            continue
          }

          if (frame.event === 'opencode-todos') {
            // Todos are surfaced through the polling refresh today, but
            // catching the frame here drops it cleanly rather than letting
            // the generic JSON.parse below fail on a non-data frame.
            continue
          }

          // Non-fatal turn notice (e.g. an MCP elicitation prompt). Unlike
          // command-result, this must NOT clear the live turn state — the turn
          // is still running; we just surface a transient banner.
          if (frame.event === 'turn-notice') {
            try {
              const parsed = JSON.parse(frame.data) as { message?: unknown }
              if (typeof parsed.message === 'string' && parsed.message.trim()) {
                setSessionActionNotice(parsed.message.trim())
              }
            } catch { /* ignore malformed notice */ }
            continue
          }

          if (frame.event === 'command-result') {
            try {
              const parsed = JSON.parse(frame.data) as { message?: unknown; mode?: unknown }
              if (typeof parsed.message === 'string' && parsed.message.trim()) {
                setSessionActionNotice(parsed.message.trim())
              }
              if (typeof parsed.mode === 'string') {
                setSelectedCopilotMode(parsed.mode)
              }
            } catch { /* ignore malformed command result */ }
            pendingMessageBaselineRef.current = null
            setOptimisticUserText(null)
            setSteeredUserTexts([])
            clearLiveAssistantText()
            setLiveToolActivities([])
            setLiveThreadedMessages([])
            clearLiveSubagentText()
            continue
          }

          try {
            const parsed = JSON.parse(frame.data)
            if (parsed?.type === 'prompt_suggestion' && typeof parsed.suggestion === 'string') {
              setLivePromptSuggestion(parsed.suggestion)
            }
            if (parsed?.type === 'system' && parsed.subtype === 'commands_changed') {
              const commands = normalizeSlashCommandSuggestions(parsed.commands)
              if (commands) setLiveSlashCommands(commands)
            }
            if (parsed?.type === 'system' && parsed.subtype === 'status') {
              const next = parsed.status === 'requesting' || parsed.status === 'compacting' ? parsed.status : null
              setLiveStatus(next)
            }
            // The Claude SDK auto-retries transient API errors (overload/network)
            // and emits an api_retry system message per attempt. Surface it as the
            // live "Retrying…" status — same UX Pi gets natively — so a multi-second
            // SDK retry reads as recovery instead of a hang. It clears when the next
            // assistant delta / result arrives (those setLiveStatus(null) below).
            if (parsed?.type === 'system' && parsed.subtype === 'api_retry') {
              setLiveStatus('retrying')
            }
            // Pi surfaces auto-retry / auto-compaction as non-fatal progress so the
            // turn doesn't look hung while it recovers (mirrors native Pi).
            if (parsed?.type === 'pi_status') {
              if (parsed.status === 'retry_start') setLiveStatus('retrying')
              else if (parsed.status === 'compaction_start') setLiveStatus('compacting')
              else if (parsed.status === 'retry_end' || parsed.status === 'compaction_end') setLiveStatus(null)
            }
            if (parsed?.type === 'stream_event' && typeof parsed.parent_tool_use_id === 'string' && parsed.parent_tool_use_id) {
              const event = parsed.event
              if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
                const parentId = parsed.parent_tool_use_id
                const delta = event.delta.text
                queueLiveSubagentDelta(parentId, delta)
              }
            }
            if (parsed?.type === 'user' && typeof parsed.parent_tool_use_id === 'string' && parsed.parent_tool_use_id) {
              // Route the clear through the same ref buffer so a buffered delta
              // flushing after this removal can't resurrect the deleted text.
              removeLiveSubagentEntry(parsed.parent_tool_use_id)
            }
            const pendingPermission = extractPendingPermission(parsed)
            if (pendingPermission) {
              setPendingPermissions((prev) => [
                ...prev.filter((permission) => permission.id !== pendingPermission.id),
                pendingPermission,
              ])
            }
            const repliedPermissionId = extractPermissionReply(parsed)
            if (repliedPermissionId) {
              setPendingPermissions((prev) => prev.filter((permission) => permission.id !== repliedPermissionId))
            }
            const pushedAttachments = extractCopilotPushedAttachments(parsed)
            if (pushedAttachments.length > 0) {
              pushedCopilotAttachmentsRef.current = mergeAttachmentsById(pushedCopilotAttachmentsRef.current, pushedAttachments)
              setAttachments((prev) => mergeAttachmentsById(prev, pushedAttachments))
              setQueuedSends((prev) => prev.length === 0
                ? prev
                : prev.map((queued, index) => index === prev.length - 1
                  ? { ...queued, attachments: mergeAttachmentsById(queued.attachments, pushedAttachments) }
                  : queued))
            }
            const toolStart = extractLiveToolStart(parsed)
            if (toolStart) {
              // A tool call is a real side effect — once one starts, this turn
              // must never be silently auto-retried (it could re-run the tool).
              turnProducedOutputRef.current = true
              if (parsed.type === 'stream_event') {
                liveToolIndexesRef.current.set(toolStart.index, toolStart.key)
                liveToolInputJsonRef.current.set(toolStart.index, '')
              }
              setLiveToolActivities((prev) => {
                const existing = prev.filter((activity) => activity.key !== toolStart.key)
                return [...existing, { key: toolStart.key, label: toolStart.label, detail: toolStart.detail, status: 'running', toolUse: 'toolUse' in toolStart ? toolStart.toolUse : undefined }]
              })
              const liveToolUse = 'toolUse' in toolStart ? toolStart.toolUse : undefined
              if (liveToolUse && session.provider === 'claude') {
                setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, {
                  role: 'assistant',
                  uuid: `live-tool:${toolStart.key}`,
                  sessionId: session.sessionId,
                  provider: session.provider,
                  blocks: [{
                    type: 'tool_thread',
                    toolUse: liveToolUse,
                    result: null,
                  }],
                }))
              }
            }

            const toolInputDelta = extractClaudeStreamToolInputDelta(parsed)
            if (toolInputDelta) {
              const toolKey = liveToolIndexesRef.current.get(toolInputDelta.index)
              if (toolKey) {
                const accumulated = `${liveToolInputJsonRef.current.get(toolInputDelta.index) ?? ''}${toolInputDelta.partialJson}`
                liveToolInputJsonRef.current.set(toolInputDelta.index, accumulated)
                const input = parseClaudeStreamToolInput(accumulated)
                if (input) {
                  setLiveThreadedMessages((prev) => updateLiveToolThreadInput(prev, toolKey, input))
                }
              }
            }

            const completedToolKey = extractCompletedToolKey(parsed)
            if (completedToolKey) {
              setLiveToolActivities((prev) => prev.map((activity) =>
                activity.key === completedToolKey
                  ? { ...activity, status: 'done' }
                  : activity
              ))
              if (session.provider === 'claude') {
                setLiveThreadedMessages((prev) => completeLiveToolThread(prev, completedToolKey))
              }
            }

            const toolStopIndex = extractLiveToolStopIndex(parsed)
            if (toolStopIndex != null && parsed.type !== 'codex_item_completed') {
              const activityKey = liveToolIndexesRef.current.get(toolStopIndex)
              if (activityKey) {
                const accumulated = liveToolInputJsonRef.current.get(toolStopIndex)
                const finalInput = accumulated ? parseClaudeStreamToolInput(accumulated) : null
                if (finalInput) {
                  setLiveThreadedMessages((prev) => updateLiveToolThreadInput(prev, activityKey, finalInput))
                }
                setLiveToolActivities((prev) => prev.map((activity) =>
                  activity.key === activityKey
                    ? { ...activity, status: 'done' }
                    : activity
                ))
                if (session.provider === 'claude') {
                  setLiveThreadedMessages((prev) => completeLiveToolThread(prev, activityKey))
                }
              }
              liveToolInputJsonRef.current.delete(toolStopIndex)
              liveToolIndexesRef.current.delete(toolStopIndex)
            }

            const deltaText = extractStreamingAssistantText(parsed)
            if (deltaText) {
              // Committed assistant output — don't blind-retry past this point.
              turnProducedOutputRef.current = true
              setLiveStatus(null)
              queueLiveAssistantText(deltaText, shouldReplaceLiveAssistantText(parsed))
            }

            const reasoningDelta = extractStreamingReasoningText(parsed)
            if (reasoningDelta) {
              setLiveStatus(null)
              queueLiveReasoningText(reasoningDelta)
            }

            const codexCompletionItem = parsed?.type === 'codex_item_completed' && parsed.item && typeof parsed.item === 'object'
              ? parsed.item as Record<string, unknown>
              : null
            const codexCompletionIsText = codexCompletionItem?.type === 'agentMessage' || codexCompletionItem?.type === 'plan'

            if (session.provider === 'claude') {
              const threaded = normalizeClaudeStreamThreadedMessage(parsed)
              if (threaded) {
                setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, threaded))
              }
            } else if (session.provider === 'codex' && !codexCompletionIsText) {
              const threaded = normalizeCodexStreamThreadedMessage(parsed, session.sessionId)
              if (threaded) {
                setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, threaded))
              }
            }
          } catch {
            /* ignore malformed stream payloads */
          }
        }
      }
      sseBuffer += decoder.decode()

      if (sseBuffer.trim()) {
        const { frames } = extractSseFrames(`${sseBuffer}\n\n`)
        for (const frame of frames) {
          if (frame.event !== 'error') continue
          try {
            const parsed = JSON.parse(frame.data)
            throw new Error(parsed.error ?? 'Unknown agent error')
          } catch (e) { throw e }
        }
      }

      flushLiveAssistantTextNow()
      setSendState('idle')
      setLiveStatus(null)
      const pushedAttachments = pushedCopilotAttachmentsRef.current
      pushedCopilotAttachmentsRef.current = []
      setAttachments(pushedAttachments)
      // Pick up any model/effort the user invoked via a slash command (e.g.
      // `/model claude-sonnet-4-6`) so the composer chip mirrors the SDK.
      refreshSessionModels({ preserveSelection: true })
      if (pendingMessageBaselineRef.current) {
        awaitingPersistedTurnRef.current = true
        setAwaitingPersistedTurn(true)
      } else {
        awaitingPersistedTurnRef.current = false
        setAwaitingPersistedTurn(false)
      }
      setResumeFromMessageId(null)
      textareaRef.current?.focus()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — already reset by cancelSend()
        return
      }
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      // Visible auto-retry: native CLIs quietly ride out transient API/network
      // blips. Mirror that — but only when the error is transient AND the turn
      // streamed no output (so a retry can't duplicate a tool call or partial
      // reply) AND we're under the retry budget. Show a "Retrying…" badge so a
      // multi-second wait reads as recovery, not a hang.
      const canRetry = isTransientSendError(errorMessage)
        && !turnProducedOutputRef.current
        && transientRetryCountRef.current < MAX_TRANSIENT_SEND_RETRIES
      if (canRetry) {
        transientRetryCountRef.current += 1
        const attempt = transientRetryCountRef.current
        // Keep the turn visually "sending" with a retry status; clear only the
        // (empty) live overlay. sendState stays 'sending' across the backoff.
        setLiveStatus('retrying')
        clearLiveAssistantText()
        setLiveToolActivities([])
        setLiveThreadedMessages([])
        clearLiveSubagentText()
        liveToolIndexesRef.current.clear()
        liveToolInputJsonRef.current.clear()
        if (transientRetryTimerRef.current) clearTimeout(transientRetryTimerRef.current)
        transientRetryTimerRef.current = setTimeout(() => {
          transientRetryTimerRef.current = null
          void sendMessage({ text, attachments: sendAttachments })
        }, transientRetryBackoffMs(attempt))
        return
      }
      setSendState('error')
      setSendError(errorMessage)
      setLiveStatus(null)
      setFailedSend({ text, attachments: sendAttachments })
      // Restore the failed draft AND any queued follow-ups into the composer —
      // auto-firing the queue after a failed turn is a surprise-send, but
      // discarding it loses typed text. (Queued attachments can't be rebuilt
      // into composer state; their text still restores.)
      const queuedTexts = queuedSendsRef.current.map((entry) => entry.text).filter(Boolean)
      setQueuedSends([])
      setInputText((current) => {
        const base = current.trim() ? current : text
        const restored = [base, ...queuedTexts].filter(Boolean).join('\n\n')
        inputTextRef.current = restored
        if (textareaRef.current) textareaRef.current.value = restored
        return restored
      })
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
      textareaRef.current?.focus()
    } finally {
      abortControllerRef.current = null
      activeTurnRequestIdRef.current = null
      sendInFlightRef.current = false
    }
  }, [attachments, clearLiveAssistantText, clearLiveSubagentText, flushLiveAssistantTextNow, messages, onFork, queueLiveAssistantText, queueLiveReasoningText, refreshSessionModels, resizeComposer, resumeFromMessageId, selectedAgent, selectedCopilotContextTier, selectedCopilotMode, selectedCodexApproval, selectedEffort, selectedModel, selectedPermissionMode, session, taskBudgetTokens])

  // Flush queued sends once the active turn finishes. Restores the queued
  // text into the composer so sendMessage picks it up and fires naturally.
  useEffect(() => {
    if (queuedSends.length === 0) return
    if (sendInFlightRef.current || awaitingPersistedTurnRef.current) return
    // A turn we reattached to is still running server-side — flushing now would
    // start a second concurrent turn. Wait for the /running poll to clear.
    if (reattachedRunning) return
    // Gate on strict idle: flushing while sendState is 'error' would auto-fire
    // a queued send after a failed turn (and clobber the restored draft).
    if (sendState !== 'idle' || awaitingPersistedTurn) return
    const next = queuedSends[0]
    setQueuedSends((prev) => prev.slice(1))
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
  }, [awaitingPersistedTurn, queuedSends, reattachedRunning, resizeComposer, sendMessage, sendState])

  // Remove a single queued message (× on its chip) without firing it.
  const removeQueuedSend = useCallback((index: number) => {
    setQueuedSends((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // Pull a queued message back into the composer to edit it. Its attachments
  // are still in memory so they restore too. The current draft is preserved by
  // prepending the edited text only when the composer is empty; otherwise the
  // queued text replaces the draft (matching ↑ history-recall behaviour).
  const editQueuedSend = useCallback((index: number) => {
    const item = queuedSendsRef.current[index]
    if (!item) return
    setQueuedSends((prev) => prev.filter((_, i) => i !== index))
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
  }, [resizeComposer])

  const updateComposerHints = useCallback((text: string, cursor: number) => {
    const mention = detectMentionAtCursor(text, cursor)
    setMentionQuery((prev) => {
      if (!mention) return prev ? null : prev
      if (prev && prev.start === mention.start && prev.query === mention.query) return prev
      setMentionActiveIndex(0)
      return mention
    })
    const isSlash = text.startsWith('/') && !/\s/.test(text.split('\n')[0] ?? '')
    setSlashOpen((prev) => {
      if (isSlash === prev) return prev
      if (isSlash) setSlashActiveIndex(0)
      return isSlash
    })
  }, [])

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

  const insertMention = useCallback((entry: MentionResult) => {
    const mention = mentionQuery
    if (!mention) return
    const textarea = textareaRef.current
    const value = textarea?.value ?? inputTextRef.current
    const cursor = textarea?.selectionStart ?? value.length
    const before = value.slice(0, mention.start)
    const after = value.slice(cursor)
    const insertion = entry.kind === 'agent'
      ? `@${entry.name} `
      : `@${entry.path} `
    const next = `${before}${insertion}${after}`
    setInputText(next)
    inputTextRef.current = next
    setMentionQuery(null)
    setMentionResults([])
    setAttachments((prev) => {
      if (entry.kind === 'agent') {
        if (prev.some((attachment) => attachment.type === 'agent' && attachment.displayName === entry.name)) return prev
        return [
          ...prev,
          {
            id: `${Date.now()}-agent-${entry.name}`,
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
          id: `${Date.now()}-mention-${entry.path}`,
          type: 'mention',
          path: entry.path,
          displayName: entry.basename,
        },
      ]
    })
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const caret = before.length + insertion.length
      ta.setSelectionRange(caret, caret)
      ta.focus()
      resizeComposer()
    })
  }, [mentionQuery, resizeComposer])

  const insertPromptText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const textarea = textareaRef.current
    const value = textarea?.value ?? inputTextRef.current
    const start = textarea?.selectionStart ?? value.length
    const end = textarea?.selectionEnd ?? value.length
    const before = value.slice(0, start)
    const after = value.slice(end)
    const insertion = before.length > 0 && !before.endsWith('\n') ? `\n${trimmed}` : trimmed
    const next = `${before}${insertion}${after}`
    setInputText(next)
    inputTextRef.current = next
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const caret = before.length + insertion.length
      ta.setSelectionRange(caret, caret)
      ta.focus()
      resizeComposer()
    })
  }, [resizeComposer])

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
  }, [inputText, resizeComposer])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || isComposingRef.current) return
    if (mentionQuery && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionActiveIndex((i) => Math.min(i + 1, mentionResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionActiveIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const entry = mentionResults[mentionActiveIndex]
        if (entry) {
          e.preventDefault()
          insertMention(entry)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (slashOpen && slashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashActiveIndex((i) => Math.min(i + 1, slashCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashActiveIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        const entry = slashCommands[slashActiveIndex]
        if (entry) {
          e.preventDefault()
          insertSlashCommand(entry.command)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashOpen(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !e.altKey)) {
      e.preventDefault()
      sendMessage()
      return
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && sentHistory.length > 0) {
      const textarea = textareaRef.current
      const draftValue = textarea?.value ?? inputTextRef.current
      const cursorAtStart = textarea ? textarea.selectionStart === 0 && textarea.selectionEnd === 0 : true
      if (historyIndex === -1) {
        if (draftValue.length > 0 && !cursorAtStart) return
        draftBeforeHistoryRef.current = {
          text: draftValue,
          cursorPos: textarea?.selectionStart ?? draftValue.length,
        }
        const nextIndex = sentHistory.length - 1
        setHistoryIndex(nextIndex)
        const replacement = sentHistory[nextIndex] ?? ''
        setInputText(replacement)
        inputTextRef.current = replacement
        e.preventDefault()
        window.requestAnimationFrame(() => {
          const ta = textareaRef.current
          if (!ta) return
          ta.setSelectionRange(replacement.length, replacement.length)
          resizeComposer()
        })
        return
      }
      const nextIndex = Math.max(historyIndex - 1, 0)
      if (nextIndex === historyIndex) {
        e.preventDefault()
        return
      }
      setHistoryIndex(nextIndex)
      const replacement = sentHistory[nextIndex] ?? ''
      setInputText(replacement)
      inputTextRef.current = replacement
      e.preventDefault()
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.setSelectionRange(replacement.length, replacement.length)
        resizeComposer()
      })
      return
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && historyIndex !== -1) {
      const nextIndex = historyIndex + 1
      if (nextIndex >= sentHistory.length) {
        setHistoryIndex(-1)
        const { text: restored, cursorPos } = draftBeforeHistoryRef.current
        setInputText(restored)
        inputTextRef.current = restored
        e.preventDefault()
        window.requestAnimationFrame(() => {
          const ta = textareaRef.current
          if (!ta) return
          ta.setSelectionRange(cursorPos, cursorPos)
          resizeComposer()
        })
        return
      }
      setHistoryIndex(nextIndex)
      const replacement = sentHistory[nextIndex] ?? ''
      setInputText(replacement)
      inputTextRef.current = replacement
      e.preventDefault()
      window.requestAnimationFrame(() => {
        const ta = textareaRef.current
        if (!ta) return
        ta.setSelectionRange(replacement.length, replacement.length)
        resizeComposer()
      })
      return
    }
  }, [sendMessage, sentHistory, historyIndex, resizeComposer, mentionQuery, mentionResults, mentionActiveIndex, insertMention, slashOpen, slashCommands, slashActiveIndex, insertSlashCommand])

  const handleExport = useCallback(() => {
    if (!session) return
    const dirName  = session.customTitle ?? session.summary ?? getPrimarySessionTag(session.tag) ?? (pathBasename(session.cwd) || session.sessionId)
    const safeName = dirName.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase()
    const filename = `${safeName}_${session.sessionId.slice(0, 8)}.html`

    if (typeof Worker === 'undefined') {
      const html = exportSessionToHtml(session, messages)
      downloadHtml(html, filename)
      return
    }

    setExporting(true)
    const worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ html?: string; error?: string }>) => {
      const { html, error } = event.data ?? {}
      if (html) {
        downloadHtml(html, filename)
      } else if (error) {
        setSessionActionError(error)
      }
      setExporting(false)
      worker.terminate()
    }
    worker.onerror = () => {
      setExporting(false)
      setSessionActionError('Failed to export session')
      worker.terminate()
    }
    worker.postMessage({ session, messages })
  }, [session, messages])

  const addAttachment = useCallback(() => {
    const path = attachmentPath.trim()
    if (!path) return
    setAttachments((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        type: attachmentType,
        path,
        displayName: attachmentType === 'agent' ? path.replace(/^@/, '') : undefined,
        text: attachmentType === 'agent' ? `@${path.replace(/^@/, '')}` : undefined,
      },
    ])
    setAttachmentPath('')
  }, [attachmentPath, attachmentType])

  const ingestFileAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const next: SendAttachment[] = []
    for (const file of files) {
      const isImage = file.type.startsWith('image/')
      if (!isImage) {
        const path = (file as File & { path?: string }).path
        if (path) {
          next.push({
            id: `${Date.now()}-${next.length}-${file.name}`,
            type: 'file',
            path,
            displayName: file.name,
          })
        }
        continue
      }
      try {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
        }
        const data = typeof window === 'undefined' ? '' : window.btoa(binary)
        next.push({
          id: `${Date.now()}-${next.length}-${file.name || 'pasted-image'}`,
          type: 'blob',
          mimeType: file.type || 'image/png',
          data,
          displayName: file.name || `pasted-image.${(file.type.split('/')[1] ?? 'png')}`,
        })
      } catch {
        // skip files that fail to read
      }
    }
    if (next.length === 0) return
    setAttachments((prev) => [...prev, ...next])
  }, [])

  const handleComposerPaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
    setAttachments((prev) => prev.filter((attachment, attachmentIndex) => (
      id ? attachment.id !== id : attachmentIndex !== index
    )))
  }, [])

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
  }, [failedSend, resizeComposer])

  const handleDeleteSession = useCallback(async () => {
    if (!session || deleting || !sessionCapabilities?.deleteSession) return
    const confirmed = window.confirm('Delete this session? This cannot be undone from Agent Viewer.')
    if (!confirmed) return
    setDeleting(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}`, session.provider), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      onDelete?.(session.sessionId, session.provider)
      setSessionActionNotice('Session deleted.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to delete session')
    } finally {
      setDeleting(false)
    }
  }, [deleting, onDelete, session, sessionCapabilities?.deleteSession])

  const runSessionAction = useCallback(async (action: string) => {
    if (!session || sessionActionLoading) return
    setSessionActionLoading(action)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, provider: session.provider }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const shareUrl = data.result?.session?.share?.url
      setSessionActionNotice(
        action === 'share' && shareUrl
          ? `Shared: ${shareUrl}`
          : `${action.toUpperCase()} complete.`
      )
      setDiagnosticSections([])
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : `Failed to run ${action}`)
    } finally {
      setSessionActionLoading(null)
    }
  }, [session, sessionActionLoading])

  const respondToPermission = useCallback(async (permission: PendingPermission, response: 'once' | 'always' | 'reject') => {
    // Bridge permissions are those without a sessionId (they came from the CLI bridge)
    if (!permission.sessionId && !permission.provider) {
      setSessionActionLoading(`permission:${permission.id}`)
      setSessionActionError(null)
      try {
        const behavior = response === 'reject' ? 'deny' : 'allow'
        await respondToChannelPermission(readBridgeConfigFromEnv(), permission.id, behavior)
        setPendingPermissions((prev) => prev.filter((entry) => entry.id !== permission.id))
      } catch (err) {
        setSessionActionError(err instanceof Error ? err.message : 'Failed to respond to bridge permission')
      } finally {
        setSessionActionLoading(null)
      }
      return
    }

    if (!session || sessionActionLoading) return
    setSessionActionLoading(`permission:${permission.id}`)
    setSessionActionError(null)
    try {
      const targetSessionId = permission.sessionId ?? session.sessionId
      const res = await fetch(`/api/sessions/${targetSessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respondPermission',
          permissionId: permission.id,
          response,
          permissionDecisionReason: response === 'reject' ? permissionDenialReason(permission) : undefined,
          provider: session.provider,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setPendingPermissions((prev) => prev.filter((entry) =>
        entry.id !== permission.id || (permission.sessionId !== undefined && entry.sessionId !== permission.sessionId)
      ))
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to respond to permission')
    } finally {
      setSessionActionLoading(null)
    }
  }, [session, sessionActionLoading])

  // Submit answers to an AskUserQuestion prompt. `answers` is keyed by question
  // text; multi-select values are comma-joined per the SDK output schema.
  const respondToQuestion = useCallback(async (
    permission: PendingPermission,
    answers: Record<string, string>,
  ) => {
    if (!session || sessionActionLoading) return
    setSessionActionLoading(`permission:${permission.id}`)
    setSessionActionError(null)
    try {
      const targetSessionId = permission.sessionId ?? session.sessionId
      const res = await fetch(`/api/sessions/${targetSessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respondQuestion',
          permissionId: permission.id,
          answers,
          provider: session.provider,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setPendingPermissions((prev) => prev.filter((entry) =>
        entry.id !== permission.id || (permission.sessionId !== undefined && entry.sessionId !== permission.sessionId)
      ))
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setSessionActionLoading(null)
    }
  }, [session, sessionActionLoading])

  const handleFork = useCallback(async () => {
    if (!session || forking) return
    setForking(true)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onFork?.(data.sessionId)
    } catch (err) {
      console.error('Fork failed:', err)
    } finally {
      setForking(false)
    }
  }, [session, forking, onFork])

  const handleForkFromMessage = useCallback(async (messageId: string) => {
    if (!session || forkingMessageId || !sessionCapabilities?.messageFork) return
    setForkingMessageId(messageId)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upToMessageId: messageId, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      onFork?.(data.sessionId)
      setSessionActionNotice('Forked a new session from that point.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to fork from message')
    } finally {
      setForkingMessageId(null)
    }
  }, [forkingMessageId, onFork, session, sessionCapabilities?.messageFork])

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
  }, [resizeComposer])

  const handleReusePrompt = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer])

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
  }, [focusComposer])

  const handleDiffCommentToComposer = useCallback((prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    const existing = inputTextRef.current
    const separator = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : ''
    const next = `${existing}${separator}${trimmed}\n\n`
    setInputText(next)
    inputTextRef.current = next
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    focusComposer()
  }, [focusComposer])

  const handleEditFromMessage = useCallback((messageId: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = { text: '', cursorPos: 0 }
    if (sessionCapabilities?.resumeAtMessage) {
      setResumeFromMessageId(messageId)
      setSessionActionNotice('Editing — next send will replace from this point in a forked session.')
    }
    focusComposer()
  }, [focusComposer, sessionCapabilities?.resumeAtMessage])

  const refreshDiagnostics = useCallback(async () => {
    if (!session) return
    setDiagnosticsLoading(true)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/diagnostics`, session.provider))
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
  }, [selectedModelValue, session])

  const [claudeMcpBusy, setClaudeMcpBusy] = useState<string | null>(null)
  const runClaudeSessionAction = useCallback(async (action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) => {
    if (!session) return
    setClaudeMcpBusy(busyKey)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, provider: session.provider, ...extra }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSessionActionNotice(successNotice)
      await refreshDiagnostics()
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setClaudeMcpBusy(null)
    }
  }, [refreshDiagnostics, session])

  const toggleDiagnostics = useCallback(async () => {
    if (!session) return
    const nextOpen = !showDiagnostics
    setShowDiagnostics(nextOpen)
    if (!nextOpen || diagnosticSections.length > 0 || diagnosticsLoading) return

    setDiagnosticsLoading(true)
    try {
      const res = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/diagnostics`, session.provider))
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
  }, [diagnosticSections.length, diagnosticsLoading, selectedModelValue, session, showDiagnostics])

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
    if (channelBridgeOpenRequest <= 0) return
    setChannelBridgeOpen(true)
  }, [channelBridgeOpenRequest])

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
    if (channelBridgeRouteToggleRequest <= 0) return
    const bridge = channelBridgeRef.current
    bridge.setRouteComposer(!bridge.routeComposer)
  }, [channelBridgeRouteToggleRequest])

  // Mirror the current routing state up so the palette label can reflect it.
  useEffect(() => {
    onChannelBridgeRoutingChange?.(channelBridge.routeComposer)
  }, [channelBridge.routeComposer, onChannelBridgeRoutingChange])

  // Track which bridge entries we've already persisted
  const persistedBridgeCountRef = useRef(0)

  // Load persisted bridge messages when session changes
  useEffect(() => {
    if (!session) {
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
  }, [session?.provider, session?.sessionId])

  // Persist new bridge messages to disk when they arrive
  useEffect(() => {
    if (!session) return
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
  }, [session?.provider, session?.sessionId, bridgeTranscriptEntries.length])

  // Auto-focus the composer for a brand-new pending session — same as opening
  // a CLI and landing at the prompt. Gated on `isPending` to avoid stealing
  // focus on every navigation back to an existing session.
  useEffect(() => {
    if (!session || session.isPending !== true) return
    if (isProject) return
    const key = `${session.provider ?? 'claude'}:${session.sessionId}`
    if (autoFocusedSessionsRef.current.has(key)) return
    autoFocusedSessionsRef.current.add(key)
    window.requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }, [isProject, session])
  const activeToolCount = liveToolActivities.filter((activity) => activity.status === 'running').length
  const sendBusy = sendState === 'sending' || awaitingPersistedTurn
  // A turn is live (whether we own its stream or reattached to it) — drives the
  // stop button and the "busy" composer presentation.
  const turnRunning = sendBusy || reattachedRunning
  const canSubmitMessage = Boolean(session && inputText.trim())
  const composerConfig = useMemo(() => getProviderComposer(session?.provider), [session?.provider])
  const composerExampleSeed = useMemo(() => {
    const source = session?.sessionId ?? session?.provider ?? ''
    let hash = 0
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0
    return hash
  }, [session?.sessionId, session?.provider])
  const composerExample = useMemo(
    () => pickProviderExample(session?.provider, composerExampleSeed),
    [composerExampleSeed, session?.provider],
  )
  const composerPlaceholder = channelBridge.routeComposer
    ? 'Send to the live CLI bridge… (toggle off in the bridge panel)'
    : turnRunning
    ? composerConfig.placeholderStreaming
    : activeToolCount > 0
    ? `${composerConfig.label} is using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
    : composerExample
  const composerStatus = sendState === 'error'
    ? 'Failed'
    : channelBridge.routeComposer
    ? (channelBridge.sendError ? 'Bridge error' : 'Bridge · sends to live CLI')
    : interrupting
    ? 'Interrupting…'
    : queuedSends.length > 0 && (sendState === 'sending' || awaitingPersistedTurn)
    ? (queuedSends.length === 1
      ? 'Queued · sends after current turn'
      : `${queuedSends.length} queued · send in order after current turn`)
    : steeredNotice && (sendState === 'sending' || reattachedRunning)
    ? 'Steered · delivered to the running turn'
    : sendState === 'sending'
    ? 'Sending...'
    : awaitingPersistedTurn
    ? 'Waiting for saved response...'
    : reattachedRunning
    ? 'Turn running · reattached'
    : 'Ready'
  const composerStatusColor = sendState === 'error'
    ? 'var(--red, #f87171)'
    : channelBridge.routeComposer
    ? (channelBridge.sendError ? 'var(--red, #f87171)' : `var(${composerConfig.cssAccentVar})`)
    : queuedSends.length > 0
    ? 'var(--amber, #eaaa40)'
    : sendState === 'sending' || awaitingPersistedTurn || reattachedRunning
    ? 'var(--cyan)'
    : 'var(--text-3)'
  const liveTurnTone: 'running' | 'syncing' = awaitingPersistedTurn ? 'syncing' : 'running'
  const liveTurnBadge = interrupting ? 'STOPPING' : awaitingPersistedTurn ? 'SYNCING' : 'RUNNING'
  const liveTurnActivityDetail = interrupting
    ? 'Interrupting turn; saving what the agent produced…'
    : awaitingPersistedTurn
    ? queuedSends.length > 0
      ? 'Turn complete; syncing transcript. Next message queued.'
      : 'Turn complete; syncing transcript.'
    : liveStatus === 'retrying'
    ? 'Retrying after a transient error…'
    : liveStatus === 'compacting'
    ? 'Compacting conversation to free up context…'
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
        blocks: [{ type: 'text', text: optimisticUserText }],
      }
    : null), [optimisticUserText, session?.provider, session?.sessionId, showLiveTimelineOverlay])
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
                ? 'Thinking…'
                : sendState === 'sending'
                ? 'Working…'
                : 'Waiting for saved response…'),
          },
        ],
      }
    : null), [
      activeToolCount,
      awaitingPersistedTurn,
      liveAssistantText,
      liveReasoningText,
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
    if (liveUserMessage) {
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
    steeredUserTexts.forEach((text, index) => {
      rows.push({
        key: `live:steered:${index}`,
        message: {
          role: 'user',
          uuid: `live-user-steer-${index}`,
          sessionId: session?.sessionId,
          provider: session?.provider,
          blocks: [{ type: 'text', text }],
        },
        showSession: false,
        dimmed: true,
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
    // Preserve referential identity with timelineRows when nothing is focused —
    // the scroll-anchor logic below relies on this equality.
    if (transcriptFilters.length === 0 && normalizedTranscriptSearch === '' && !bookmarksOnly) return timelineRows
    return timelineRows.filter((row) => {
      if (bookmarksOnly && !bookmarkIds.has(row.message.uuid)) return false
      if (!timelineRowMatchesTranscriptFilters(row, transcriptFilters)) return false
      if (!normalizedTranscriptSearch) return true
      return timelineRowSearchText(row).includes(normalizedTranscriptSearch)
    })
  }, [normalizedTranscriptSearch, timelineRows, transcriptFilters, bookmarksOnly, bookmarkIds])
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
  const hasTranscriptTimeline = transcriptTimelineRows.length > 0
  timelineRowsRef.current = transcriptTimelineRows

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
      setTimelineScrollTop(targetTop)
    }
    alignLastTimelineRowToViewportBottom()

    let cancelled = false
    let frameId: number | null = null
    const runInitialScrollPass = (pass: number) => {
      if (cancelled) return
      scrollTimelineToBottom()
      alignLastTimelineRowToViewportBottom()
      if (pass >= 6) return
      frameId = window.requestAnimationFrame(() => runInitialScrollPass(pass + 1))
    }

    frameId = window.requestAnimationFrame(() => runInitialScrollPass(1))

    return () => {
      cancelled = true
      if (frameId != null) window.cancelAnimationFrame(frameId)
    }
  }, [alignLastTimelineRowToViewportBottom, hasLiveTimeline, loading, markProgrammaticTimelineScroll, messages.length, scrollTimelineToBottom, session?.sessionId, targetMessageId])

  useEffect(() => {
    const activeKeys = new Set(transcriptTimelineRows.map((row) => row.key))
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
  }, [transcriptTimelineRows])

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
  scheduleTimelineMeasurementFlushRef.current = scheduleTimelineMeasurementFlush

  const handleTimelineRowMeasure = useCallback((key: string, height: number) => {
    pendingRowMeasurementsRef.current.set(key, Math.max(1, Math.ceil(height)))
    scheduleTimelineMeasurementFlush()
  }, [scheduleTimelineMeasurementFlush])

  useLayoutEffect(() => {
    if (!autoFollow || !hasTranscriptTimeline || loading) return
    scrollTimelineToBottom()
    alignLastTimelineRowToViewportBottom()
  }, [alignLastTimelineRowToViewportBottom, autoFollow, hasTranscriptTimeline, loading, rowMeasurementVersion, scrollTimelineToBottom, transcriptTimelineRows.length])

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
    if (transcriptTimelineRows !== timelineRows) {
      return measureSync('timeline.fullLayout', () =>
        buildTimelineRowLayout(transcriptTimelineRows, rowHeightsRef.current, estimateTimelineRowHeightForLayout))
    }
    // Otherwise reuse baseLayout for the persisted prefix and append only the
    // live suffix.
    return measureSync('timeline.appendLayout', () =>
      appendTimelineRowLayout(baseLayout, liveTimelineRows, rowHeightsRef.current, estimateTimelineRowHeightForLayout))
  }, [baseLayout, estimateTimelineRowHeightForLayout, liveTimelineRows, rowMeasurementVersion, timelineRows, transcriptTimelineRows])
  rowLayoutRef.current = rowLayout

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
    setTimelineScrollTop(node.scrollTop)
  }, [markProgrammaticTimelineScroll, rowLayout])

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

      const rowIndex = rows.findIndex((row) => row.message.uuid === messageId)
      if (rowIndex < 0) return

      const targetTop = Math.max(layout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
      suppressFollowEvalUntilRef.current = performance.now() + 300
      markProgrammaticTimelineScroll()
      node.scrollTop = targetTop
      setTimelineScrollTop(targetTop)
    }

    window.requestAnimationFrame(() => {
      scrollToMessage()
      window.requestAnimationFrame(() => {
        if (!scrollMountedTimelineRowIntoView(messageId)) {
          scrollToMessage()
        }
      })
    })
  }, [markProgrammaticTimelineScroll, scrollMountedTimelineRowIntoView])

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
      setTimelineScrollTop(targetTop)
    }

    window.requestAnimationFrame(() => {
      scrollToMessage()
      window.requestAnimationFrame(() => {
        if (!scrollMountedTimelineRowIntoView(messageId)) scrollToMessage()
      })
    })
  }, [markProgrammaticTimelineScroll, scrollMountedTimelineRowIntoView])

  useLayoutEffect(() => {
    if (!timelineTargetMessageId || loading) return
    if (targetMessageRequestId && handledTargetMessageRequestRef.current === targetMessageRequestId) return
    const node = timelineRef.current
    if (!node) return

    const rowIndex = transcriptTimelineRows.findIndex((row) => row.message.uuid === timelineTargetMessageId)
    if (rowIndex < 0) return

    handledTargetMessageRequestRef.current = targetMessageRequestId
    const targetTop = Math.max(rowLayout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
    suppressFollowEvalUntilRef.current = performance.now() + 300
    autoFollowRef.current = false
    setAutoFollow(false)
    setTimelineScrollTop(targetTop)
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    setHighlightedMessageId(timelineTargetMessageId)
  }, [loading, markProgrammaticTimelineScroll, rowLayout, targetMessageRequestId, transcriptTimelineRows, timelineTargetMessageId])

  useEffect(() => {
    if (!highlightedMessageId) return
    const timeout = window.setTimeout(() => {
      setHighlightedMessageId((current) => current === highlightedMessageId ? null : current)
    }, 3500)
    return () => window.clearTimeout(timeout)
  }, [highlightedMessageId])

  const virtualTimeline = useMemo(() => {
    const { tops, heights } = rowLayout
    const n = transcriptTimelineRows.length
    const window = getVirtualTimelineWindow({
      layout: rowLayout,
      rowCount: n,
      scrollTop: timelineScrollTop,
      viewportHeight: timelineViewportHeight || 800,
      overscanPx: TIMELINE_OVERSCAN_PX,
    })

    const visibleRows: Array<{ row: TimelineRow; top: number; height: number }> = []
    for (let i = window.startIndex; i < window.endIndex; i++) {
      visibleRows.push({ row: transcriptTimelineRows[i], top: tops[i], height: heights[i] })
    }

    return { totalHeight: window.totalHeight, visibleRows }
  }, [rowLayout, transcriptTimelineRows, timelineScrollTop, timelineViewportHeight])

  useLayoutEffect(() => {
    if (!pendingMountedAnchorCaptureRef.current) return
    pendingMountedAnchorCaptureRef.current = false
    activeTimelineScrollAnchorRef.current = captureTimelineScrollAnchor()
  }, [captureTimelineScrollAnchor, timelineScrollTop, virtualTimeline.visibleRows])

  const timelineRenderedHeight = useMemo(() => {
    const lastVisibleRow = virtualTimeline.visibleRows.at(-1)
    const visibleBottom = lastVisibleRow
      ? lastVisibleRow.top + lastVisibleRow.height + TIMELINE_BOTTOM_GUTTER_PX
      : 0
    return resolveTimelineRenderedHeight({
      measuredTotalHeight: virtualTimeline.totalHeight,
      activeScrollHeight: timelineHeightOverride,
      visibleBottom,
    })
  }, [timelineHeightOverride, virtualTimeline.totalHeight, virtualTimeline.visibleRows])

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
    virtualTimeline.visibleRows.length,
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
      setTimelineScrollTop(target)
    }
    const observer = new ResizeObserver(() => pin())
    observer.observe(content)
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasLiveTimeline, markProgrammaticTimelineScroll, session?.sessionId, showVisualizer])

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

  const handleRewind = useCallback(async () => {
    if (!session || !selectedRewindTarget || previewingRewind || applyingRewind) return

    setPreviewingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId: selectedRewindTarget.uuid, model: selectedModel, dryRun: true, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

      const filesChanged = Array.isArray(data.filesChanged)
        ? data.filesChanged.filter((file: unknown): file is string => typeof file === 'string')
        : []

      setRewindPreview({
        userMessageId: selectedRewindTarget.uuid,
        contentPreview: selectedRewindTarget.content.replace(/\s+/g, ' ').trim().slice(0, 160),
        filesChanged,
      })
      setSessionActionNotice(filesChanged.length > 0
        ? `Previewed ${filesChanged.length} file change${filesChanged.length === 1 ? '' : 's'}.`
        : 'No tracked file changes at that prompt.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
    } finally {
      setPreviewingRewind(false)
    }
  }, [applyingRewind, previewingRewind, selectedModel, selectedRewindTarget, session])

  const handleApplyRewind = useCallback(async () => {
    if (!session || !rewindPreview || applyingRewind) return

    setApplyingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId: rewindPreview.userMessageId, model: selectedModel, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.canRewind) throw new Error(data.error ?? 'Rewind unavailable for this session state')

      const fileCount = Array.isArray(data.filesChanged) ? data.filesChanged.length : rewindPreview.filesChanged.length
      setRewindPreview(null)
      setSessionActionNotice(fileCount > 0 ? `Rewound ${fileCount} file${fileCount === 1 ? '' : 's'}.` : 'Rewind complete.')
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to rewind files')
    } finally {
      setApplyingRewind(false)
    }
  }, [applyingRewind, rewindPreview, selectedModel, session])

  const handleRollbackPreview = useCallback(async () => {
    if (!session || previewingRewind || applyingRewind || rollbackTurns < 1) return

    setPreviewingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numTurns: rollbackTurns, dryRun: true, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const turnsRemoved = Array.isArray(data.turnsRemoved)
        ? data.turnsRemoved.filter((turn: unknown): turn is { turnId: string; preview: string } =>
            Boolean(turn)
            && typeof turn === 'object'
            && typeof (turn as { turnId?: unknown }).turnId === 'string'
            && typeof (turn as { preview?: unknown }).preview === 'string'
          )
        : []
      setRollbackPreview({ numTurns: rollbackTurns, turnsRemoved })
      setSessionActionNotice(`Previewed rollback of ${rollbackTurns} turn${rollbackTurns === 1 ? '' : 's'}.`)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to preview rollback')
    } finally {
      setPreviewingRewind(false)
    }
  }, [applyingRewind, previewingRewind, rollbackTurns, session])

  const handleApplyRollback = useCallback(async () => {
    if (!session || !rollbackPreview || applyingRewind) return

    setApplyingRewind(true)
    setSessionActionError(null)
    setSessionActionNotice(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/rewind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numTurns: rollbackPreview.numTurns, provider: session.provider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRollbackPreview(null)
      setSessionActionNotice(`Rolled back ${rollbackPreview.numTurns} turn${rollbackPreview.numTurns === 1 ? '' : 's'}.`)
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to roll back thread')
    } finally {
      setApplyingRewind(false)
    }
  }, [applyingRewind, rollbackPreview, session])

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
            background: 'linear-gradient(135deg, var(--surface-2), var(--surface))',
            boxShadow: '0 0 40px 8px rgba(139,128,240,0.04) inset',
          }}>
            <div style={{
              width: 18, height: 18,
              borderRadius: '50%',
              background: 'var(--surface-3)',
              border: '1px solid var(--border-2)',
              boxShadow: '0 0 8px 2px rgba(139,128,240,0.06)',
            }} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
            marginBottom: 8,
          }}>
            No session selected
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.03em',
          }}>
            ← Choose a session from the sidebar
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
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* ── Top bar ──────────────────────────────────── */}
      <div
        style={{
          padding: '0 28px',
          height: 52,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'linear-gradient(to right, rgba(139,128,240,0.05) 0%, var(--surface) 40%)',
        }}
      >
        {/* Project / session name */}
        <span
          style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--text)',
            textTransform: 'uppercase',
          }}
        >
          {dirName}
        </span>

        {/* Project view badge */}
        {isProject && (
          <>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: 'var(--violet)',
                background: 'rgba(139,128,240,0.1)',
                border: '1px solid rgba(139,128,240,0.25)',
                borderRadius: 3,
                padding: '2px 7px',
                flexShrink: 0,
              }}
            >
              ALL SESSIONS
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.1em',
                color: projectView.providerMode === 'all' ? 'var(--green)' : 'var(--text-3)',
                background: projectView.providerMode === 'all' ? 'rgba(45,212,160,0.1)' : 'var(--surface-2)',
                border: `1px solid ${projectView.providerMode === 'all' ? 'rgba(45,212,160,0.25)' : 'var(--border)'}`,
                borderRadius: 3,
                padding: '2px 7px',
                flexShrink: 0,
              }}
            >
              {projectView.providerMode === 'all' ? 'ALL PROVIDERS' : 'CURRENT PROVIDER'}
            </span>
          </>
        )}

        {/* Single-session path + git branch */}
        {!isProject && session?.cwd && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {session.cwd}
            {sessionInfo?.gitBranch && (
              <span style={{ color: 'var(--violet)', marginLeft: 8 }}>
                ⎇ {sessionInfo.gitBranch}
              </span>
            )}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Context usage bar */}
        {!isProject && contextUsage && (
          <div
            title={`${contextUsage.totalTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(contextUsage.percentage)}%)`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: contextUsage.percentage > 80 ? 'var(--red, #f87171)' : 'var(--text-3)',
              letterSpacing: '0.03em',
            }}>
              {Math.round(contextUsage.percentage)}%
            </span>
            <div style={{
              width: 56,
              height: 4,
              borderRadius: 2,
              background: 'var(--border-2)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(contextUsage.percentage, 100)}%`,
                borderRadius: 2,
                background: contextUsage.percentage > 80
                  ? 'var(--red, #f87171)'
                  : contextUsage.percentage > 60
                  ? 'var(--yellow, #fbbf24)'
                  : 'var(--violet)',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        )}

        {/* All-session analytics */}
        <Link
          href="/analytics"
          transitionTypes={['route']}
          title="Cross-session analytics"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            height: 26,
            padding: '0 10px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 5,
            color: 'var(--text-2)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            textDecoration: 'none',
          }}
        >
          📈 ALL SESSIONS
        </Link>

        {/* Analytics */}
        {!isProject && (
          <Button
            onClick={() => setAnalyticsOpen(true)}
            title="Session analytics"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: 'var(--text-2)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            📊 ANALYTICS
          </Button>
        )}

        {/* Stats */}
        {!loading && (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
            {isProject
              ? `${projectView!.sessionCount} sessions · ${threaded.length} turns`
              : `${threaded.length} turns · ${messages.length} events`}
          </span>
        )}

        {/* VIEW dropdown — display settings */}
        <div ref={viewDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { setViewDropdownOpen(v => !v); setActionsDropdownOpen(false) }}
            className="av-hover-control"
            style={{
              height: 26, padding: '0 10px', borderRadius: 5, cursor: 'pointer',
              background: viewDropdownOpen ? 'rgba(139,92,246,0.18)' : 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.22)',
              color: 'var(--violet)',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.08em',
            }}
          >
            VIEW ▾
          </button>
          {viewDropdownOpen && (
            <div style={{
              position: 'absolute', top: 32, right: 0, zIndex: 60,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 0', minWidth: 200,
              boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
              display: 'flex', flexDirection: 'column', gap: 0,
            }}>
              {/* Visualiser toggle */}
              <button type="button" onClick={() => { setShowVisualizer(v => !v); setViewDropdownOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: showVisualizer ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left' }}>
                <ChartNetwork style={{ width: 13, height: 13, flexShrink: 0 }} />
                {showVisualizer ? 'TRANSCRIPT' : 'VISUALISER'}
              </button>
              {/* Tasks toggle */}
              {!isProject && taskRegistry.size > 0 && (
                <button type="button" onClick={() => { setTaskRailOpen(v => !v); setViewDropdownOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: taskRailOpen ? 'var(--amber)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left' }}>
                  ☐ TASKS · {taskRegistry.size}
                </button>
              )}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* View mode */}
              <div style={{ padding: '4px 14px 2px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>MESSAGES</div>
              {(['conversation', 'continue', 'stream'] as const).map((mode) => (
                <button key={mode} type="button"
                  onClick={() => { setViewMode(mode); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: viewMode === mode || (mode === 'conversation' && viewMode === 'full') ? 'rgba(139,92,246,0.1)' : 'transparent', border: 0, cursor: 'pointer', color: viewMode === mode || (mode === 'conversation' && viewMode === 'full') ? 'var(--violet)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left' }}>
                  {mode === 'conversation' ? 'FULL' : mode === 'continue' ? 'CONT' : 'STREAM'}
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 10 }}>
                    {mode === 'conversation' ? 'all cards' : mode === 'continue' ? 'no tools' : 'plain text'}
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Density */}
              <div style={{ padding: '4px 14px 2px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>DENSITY</div>
              {(['comfortable', 'balanced', 'dense'] as const).map((d) => (
                <button key={d} type="button"
                  onClick={() => { setDensity(d); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: density === d ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: density === d ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left' }}>
                  {d === 'comfortable' ? 'COMFY' : d.toUpperCase()}
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Diff style */}
              <div style={{ padding: '4px 14px 2px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>DIFF STYLE</div>
              {(['stacked', 'split'] as const).map((style) => (
                <button key={style} type="button"
                  onClick={() => { setDiffStyle(style); setViewDropdownOpen(false) }}
                  style={{ padding: '6px 14px', background: diffStyle === style ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: diffStyle === style ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {style.toUpperCase()}
                  <span style={{ color: 'var(--text-3)', marginLeft: 8, fontSize: 10 }}>
                    {style === 'stacked' ? 'one column' : 'side by side'}
                  </span>
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Change indicators */}
              <div style={{ padding: '4px 14px 2px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>CHANGE INDICATORS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 14px 3px' }}>
                {(['classic', 'bars', 'none'] as const).map((style) => (
                  <button key={style} type="button"
                    onClick={() => { setDiffOptions((prev) => ({ ...prev, changeStyle: style })); setViewDropdownOpen(false) }}
                    style={{ padding: '4px 8px', borderRadius: 4, background: diffOptions.changeStyle === style ? 'rgba(56,217,245,0.12)' : 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: diffOptions.changeStyle === style ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em' }}>
                    {style.toUpperCase()}
                  </button>
                ))}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Inline diff highlighting */}
              <div style={{ padding: '4px 14px 2px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>INLINE DIFF</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 14px 3px' }}>
                {(['word-alt', 'word', 'char', 'none'] as const).map((style) => (
                  <button key={style} type="button"
                    onClick={() => { setDiffOptions((prev) => ({ ...prev, inlineDiffStyle: style })); setViewDropdownOpen(false) }}
                    style={{ padding: '4px 8px', borderRadius: 4, background: diffOptions.inlineDiffStyle === style ? 'rgba(56,217,245,0.12)' : 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: diffOptions.inlineDiffStyle === style ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em' }}>
                    {style === 'word-alt' ? 'WORD-ALT' : style.toUpperCase()}
                  </button>
                ))}
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              {/* Display toggles */}
              <div style={{ padding: '4px 14px 2px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>DISPLAY</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, padding: '0 6px' }}>
                {([
                  { key: 'backgrounds', label: 'BG', active: diffOptions.showBackgrounds, toggle: () => setDiffOptions((prev) => ({ ...prev, showBackgrounds: !prev.showBackgrounds })) },
                  { key: 'wrap', label: 'WRAP', active: diffOptions.wrap, toggle: () => setDiffOptions((prev) => ({ ...prev, wrap: !prev.wrap })) },
                  { key: 'lineNumbers', label: 'LINE #S', active: diffOptions.showLineNumbers, toggle: () => setDiffOptions((prev) => ({ ...prev, showLineNumbers: !prev.showLineNumbers })) },
                  { key: 'hunkHeaders', label: 'HUNKS', active: diffOptions.showHunkHeaders, toggle: () => setDiffOptions((prev) => ({ ...prev, showHunkHeaders: !prev.showHunkHeaders })) },
                ] as const).map((opt) => (
                  <button key={opt.key} type="button"
                    onClick={opt.toggle}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'transparent', border: 0, cursor: 'pointer', color: opt.active ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: '0.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {opt.active ? '☑' : '☐'} {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Code theme — standalone so its sub-popover isn't clipped by the VIEW dropdown */}
        <CodeThemeToggle />

        {/* ··· actions dropdown — session actions */}
        {!isProject && (
          <div ref={actionsDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => { setActionsDropdownOpen(v => !v); setViewDropdownOpen(false) }}
              className="av-hover-control"
              style={{
                height: 26, padding: '0 10px', borderRadius: 5, cursor: 'pointer',
                background: actionsDropdownOpen ? 'var(--surface-3)' : 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, letterSpacing: '0.05em',
              }}
            >
              ···
            </button>
            {actionsDropdownOpen && (
              <div style={{
                position: 'absolute', top: 32, right: 0, zIndex: 60,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 0', minWidth: 160,
                boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
                display: 'flex', flexDirection: 'column', gap: 0,
              }}>
                {session?.provider !== 'copilot' && (
                  <button type="button" onClick={() => { handleFork(); setActionsDropdownOpen(false) }} disabled={forking}
                    style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: forking ? 'not-allowed' : 'pointer', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: forking ? 0.5 : 1 }}>
                    {forking ? 'FORKING…' : 'FORK'}
                  </button>
                )}
                {cliCommand && (
                  <div ref={cliPopoverRef} style={{ position: 'relative' }}>
                    <button type="button" onClick={() => setCliPopoverOpen(v => !v)}
                      style={{ width: '100%', padding: '7px 14px', background: cliPopoverOpen ? 'rgba(56,217,245,0.08)' : 'transparent', border: 0, cursor: 'pointer', color: cliPopoverOpen ? 'var(--cyan)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left' }}>
                      CLI
                    </button>
                    {cliPopoverOpen && (
                      <div style={{ position: 'absolute', top: 0, right: 170, zIndex: 70, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320, boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}>
                        <code style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--cyan)', wordBreak: 'break-all', userSelect: 'all' }}>{cliCommand}</code>
                        <button type="button" style={{ alignSelf: 'flex-end', height: 24, fontSize: 11, padding: '0 10px', cursor: 'pointer', background: 'rgba(56,217,245,0.07)', border: '1px solid rgba(56,217,245,0.25)', borderRadius: 4, color: 'var(--cyan)', fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.08em' }}
                          onClick={() => { void navigator.clipboard.writeText(cliCommand); setCliPopoverOpen(false); setActionsDropdownOpen(false) }}>COPY</button>
                      </div>
                    )}
                  </div>
                )}
                <button type="button" onClick={() => { handleExport(); setActionsDropdownOpen(false) }} disabled={exporting}
                  style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: exporting ? 'not-allowed' : 'pointer', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: exporting ? 0.6 : 1 }}>
                  {exporting ? 'EXPORTING…' : 'EXPORT'}
                </button>
                <button type="button" onClick={() => { toggleDiagnostics(); setActionsDropdownOpen(false) }}
                  style={{ padding: '7px 14px', background: showDiagnostics ? 'rgba(234,170,64,0.1)' : 'transparent', border: 0, cursor: 'pointer', color: showDiagnostics ? 'var(--amber)' : 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left' }}>
                  DIAG
                </button>
                {activeProvider === 'opencode' && (
                  <>
                    {sessionCapabilities?.shareSession && <button type="button" onClick={() => { runSessionAction('share'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>SHARE</button>}
                    {sessionCapabilities?.unshareSession && <button type="button" onClick={() => { runSessionAction('unshare'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>UNSHARE</button>}
                    {sessionCapabilities?.summarizeSession && <button type="button" onClick={() => { runSessionAction('summarize'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>SUMMARY</button>}
                    {sessionCapabilities?.unrevertSession && <button type="button" onClick={() => { runSessionAction('unrevert'); setActionsDropdownOpen(false) }} disabled={!!sessionActionLoading} style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: sessionActionLoading ? 0.55 : 1 }}>UNREVERT</button>}
                  </>
                )}
                {sessionCapabilities?.deleteSession && (
                  <>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button type="button" onClick={() => { handleDeleteSession(); setActionsDropdownOpen(false) }} disabled={deleting}
                      style={{ padding: '7px 14px', background: 'transparent', border: 0, cursor: deleting ? 'not-allowed' : 'pointer', color: deleting ? 'var(--red, #f87171)' : 'rgba(248,113,113,0.8)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.07em', textAlign: 'left', opacity: deleting ? 0.55 : 1 }}>
                      {deleting ? 'DELETING…' : 'DELETE'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(45, 212, 160, 0.08)',
            border: '1px solid rgba(45, 212, 160, 0.2)',
            borderRadius: 20,
            padding: '2px 8px 2px 6px',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--green)',
              display: 'inline-block',
              animation: 'live-pulse 2.5s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--green)',
              letterSpacing: '0.08em',
            }}
          >
              LIVE
            </span>
          </div>

          <Button
            onClick={toggleLiveFollow}
            title={autoFollow ? 'Pause live follow' : 'Follow new messages live'}
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              borderRadius: 999,
              border: autoFollow ? '1px solid rgba(45,212,160,0.26)' : '1px solid rgba(56,217,245,0.22)',
              background: autoFollow ? 'rgba(45,212,160,0.12)' : 'rgba(56,217,245,0.08)',
              color: autoFollow ? 'var(--green)' : 'var(--cyan)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.07em',
              cursor: 'pointer',
            }}
          >
            {autoFollow ? 'FOLLOWING LIVE' : 'FOLLOW LIVE'}
          </Button>
        </div>

      {/* ── Tab bar ──────────────────────────────────── */}
      {openTabs && openTabs.length > 0 && (
        <TabBar
          tabs={openTabs}
          activeId={selectedTabId ?? null}
          onSelect={onSelectTab ?? (() => {})}
          onClose={onCloseTab ?? (() => {})}
        />
      )}

      {/* ── OpenCode todos (mirrors opencode-web's pinned task list) ──── */}
      {!isProject && session?.provider === 'opencode' && openCodeTodos && openCodeTodos.length > 0 && (
        <OpenCodeTodosBanner todos={openCodeTodos} />
      )}

      {/* ── Timeline feed + optional right-rail task panel ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {showVisualizer ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: '18px 24px',
            }}
          >
            <MessageSessionVisualizer
              rows={visualizerRows}
              rawEventCount={messages.length}
              loading={loading}
              showSession={isProject}
              onSelectMessage={handleVisualizerSelectMessage}
            />
          </div>
        ) : (
          <>
            {!loading && hasLiveTimeline && (
              <div className="av-transcript-filter-panel">
                <label className="av-session-viz-search">
                  <Search aria-hidden="true" />
                  <input
                    value={transcriptSearch}
                    onChange={(event) => setTranscriptSearch(event.target.value)}
                    placeholder="Search turns, tools, paths, commands..."
                  />
                </label>
                <div className="av-session-viz-filterbar" aria-label="Transcript filters">
                  <Filter aria-hidden="true" />
                  {TRANSCRIPT_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      aria-pressed={filter.key === 'all' ? transcriptFilters.length === 0 : transcriptFilters.includes(filter.key)}
                      className={cn((filter.key === 'all' ? transcriptFilters.length === 0 : transcriptFilters.includes(filter.key)) && 'av-active')}
                      onClick={() => {
                        if (filter.key === 'all') {
                          setTranscriptFilters([])
                          return
                        }
                        const selectedFilter = filter.key
                        setTranscriptFilters((current) => (
                          current.includes(selectedFilter)
                            ? current.filter((activeFilter) => activeFilter !== selectedFilter)
                            : [...current, selectedFilter]
                        ))
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={bookmarksOnly}
                    disabled={bookmarkIds.size === 0 && !bookmarksOnly}
                    className={cn('av-session-viz-bookmark-filter', bookmarksOnly && 'av-active')}
                    title={bookmarkIds.size === 0 ? 'No bookmarks in this session yet' : 'Show only bookmarked messages'}
                    onClick={() => setBookmarksOnly((value) => !value)}
                  >
                    {bookmarksOnly ? '★' : '☆'} Bookmarks{bookmarkIds.size > 0 ? ` (${bookmarkIds.size})` : ''}
                  </button>
                </div>
                <div className="av-session-viz-result-count">
                  {transcriptTimelineRows.length} shown
                </div>
                {hasTranscriptFocus && (
                  <div className="av-session-viz-focusbar">
                    <span className="av-session-viz-focus-count">
                      {transcriptTimelineRows.length} of {timelineRows.length} turns
                    </span>
                    {transcriptFilters.map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className="av-session-viz-focus-chip"
                        onClick={() => {
                          setTranscriptFilters((current) => current.filter((activeFilter) => activeFilter !== filter))
                        }}
                      >
                        Filter: {TRANSCRIPT_FILTER_LABELS.get(filter) ?? filter}
                        <X aria-hidden="true" />
                      </button>
                    ))}
                    {transcriptSearch.trim() && (
                      <button
                        type="button"
                        className="av-session-viz-focus-chip"
                        onClick={() => setTranscriptSearch('')}
                      >
                        Search: {transcriptSearch.trim()}
                        <X aria-hidden="true" />
                      </button>
                    )}
                    {bookmarksOnly && (
                      <button
                        type="button"
                        className="av-session-viz-focus-chip"
                        onClick={() => setBookmarksOnly(false)}
                      >
                        ★ Bookmarks only
                        <X aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="av-session-viz-clear-focus"
                      onClick={() => {
                        setTranscriptFilters([])
                        setTranscriptSearch('')
                        setBookmarksOnly(false)
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            )}
            <div
              ref={timelineRef}
              onScroll={handleTimelineScroll}
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                overflowAnchor: 'none',
                padding: '28px 32px 72px',
              }}
            >
        {showDiagnostics && !isProject && (
          <div
            style={{
              marginBottom: 18,
              padding: '14px 16px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Session Diagnostics
              </div>
              {session?.provider === 'claude' && (
                <button
                  type="button"
                  onClick={() => runClaudeSessionAction('reloadPlugins', {}, 'reload-plugins', 'Plugins reloaded.')}
                  disabled={claudeMcpBusy === 'reload-plugins'}
                  title="Reload plugins from disk"
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--cyan)',
                    background: 'var(--surface)',
                    border: '1px solid rgba(56,217,245,0.3)',
                    borderRadius: 5,
                    padding: '3px 9px',
                    cursor: claudeMcpBusy === 'reload-plugins' ? 'not-allowed' : 'pointer',
                    letterSpacing: '0.08em',
                    opacity: claudeMcpBusy === 'reload-plugins' ? 0.6 : 1,
                  }}
                >
                  {claudeMcpBusy === 'reload-plugins' ? 'RELOADING…' : 'RELOAD PLUGINS'}
                </button>
              )}
            </div>
            {diagnosticsLoading ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                Loading diagnostics…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {diagnosticSections.map((section) => (
                  <div key={section.id}>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em', marginBottom: 6 }}>
                      {section.title}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {section.id === 'mcp' && session?.provider === 'claude' ? (
                        section.items.map((item, index) => {
                          if (item === 'None') {
                            return <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>None</div>
                          }
                          const [rawName, rawStatus] = item.split(' · ')
                          const name = rawName?.trim() ?? ''
                          const status = rawStatus?.trim() ?? ''
                          const enabled = status !== 'disabled'
                          const busyKey = `mcp:${name}`
                          const busy = claudeMcpBusy === busyKey || claudeMcpBusy === `mcp:toggle:${name}`
                          return (
                            <div
                              key={`${section.id}-${index}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 11,
                                color: 'var(--text-2)',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={item}>
                                {name} <span style={{ color: enabled ? 'var(--green)' : 'var(--text-3)' }}>· {status}</span>
                              </span>
                              <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => runClaudeSessionAction('reconnectMcpServer', { serverName: name }, busyKey, `Reconnected ${name}.`)}
                                  disabled={busy}
                                  title={`Reconnect ${name}`}
                                  style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 9,
                                    color: 'var(--cyan)',
                                    background: 'transparent',
                                    border: '1px solid rgba(56,217,245,0.3)',
                                    borderRadius: 4,
                                    padding: '0 5px',
                                    height: 18,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    letterSpacing: '0.06em',
                                    opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  RECONN
                                </button>
                                <button
                                  type="button"
                                  onClick={() => runClaudeSessionAction('toggleMcpServer', { serverName: name, enabled: !enabled }, `mcp:toggle:${name}`, `${enabled ? 'Disabled' : 'Enabled'} ${name}.`)}
                                  disabled={busy}
                                  title={`${enabled ? 'Disable' : 'Enable'} ${name}`}
                                  style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 9,
                                    color: enabled ? 'var(--yellow)' : 'var(--green)',
                                    background: 'transparent',
                                    border: enabled ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(74,222,128,0.3)',
                                    borderRadius: 4,
                                    padding: '0 5px',
                                    height: 18,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    letterSpacing: '0.06em',
                                    opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  {enabled ? 'DISABLE' : 'ENABLE'}
                                </button>
                              </span>
                            </div>
                          )
                        })
                      ) : (
                        section.items.map((item, index) => (
                          <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)' }}>
                            {item}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {loading && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-3)',
              letterSpacing: '0.04em',
            }}
          >
            Loading…
          </div>
        )}
        {!loading && !hasLiveTimeline && (
          session ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                maxWidth: 640,
                padding: '20px 18px',
                borderRadius: 10,
                border: `1px solid rgba(${composerConfig.cssAccentRgb},0.28)`,
                background: `linear-gradient(180deg, rgba(${composerConfig.cssAccentRgb},0.08), transparent 70%)`,
              }}
            >
              <div style={{
                fontFamily: "'Oxanium', monospace",
                fontSize: 16,
                fontWeight: 600,
                color: `var(${composerConfig.cssAccentVar})`,
                letterSpacing: '0.04em',
              }}>
                {composerConfig.welcomeTitle}
              </div>
              <div style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.04em',
              }}>
                {composerConfig.welcomeSubtitle}
              </div>
              {session.cwd && (
                <div style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: 'var(--text-3)',
                  letterSpacing: '0.02em',
                }}>
                  cwd <span style={{ color: 'var(--text-2)' }}>{session.cwd}</span>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {composerConfig.welcomeBullets.map((bullet) => (
                  <button
                    key={bullet}
                    type="button"
                    onClick={() => handleReusePrompt(bullet)}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      textAlign: 'left',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: 13,
                      color: 'var(--text)',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = `rgba(${composerConfig.cssAccentRgb},0.10)`
                      event.currentTarget.style.borderColor = `rgba(${composerConfig.cssAccentRgb},0.45)`
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = 'transparent'
                      event.currentTarget.style.borderColor = 'var(--border)'
                    }}
                  >
                    <span style={{ color: `var(${composerConfig.cssAccentVar})`, fontWeight: 600 }}>{composerConfig.glyph}</span>
                    <span>{bullet}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No messages.</div>
          )
        )}
        {!loading && hasLiveTimeline && !hasTranscriptTimeline && (
          <div className="av-transcript-no-results">
            No messages match the current filter.
          </div>
        )}
        {!loading && hasTranscriptTimeline && (
          <div style={{ position: 'relative' }}>
            {viewMode !== 'stream' && (
            <div
              className="timeline-line"
              style={{
                position: 'absolute',
                left: 9,
                top: 10,
                height: Math.max(timelineRenderedHeight - 10, 0),
                width: 2,
                borderRadius: 999,
                background: 'linear-gradient(to bottom, color-mix(in srgb, var(--border-2) 92%, var(--text-2)) 0%, var(--border-2) 70%, transparent 100%)',
                boxShadow: '0 0 0 1px color-mix(in srgb, var(--bg) 72%, transparent), 0 0 10px color-mix(in srgb, var(--border-2) 38%, transparent)',
                pointerEvents: 'none',
              }}
            />
            )}
            <div
              ref={timelineContentRef}
              style={{ position: 'relative', minHeight: timelineRenderedHeight, height: timelineRenderedHeight }}
            >
              <MessageDensityProvider density={density}>
              <ViewModeProvider mode={viewMode}>
              <DiffStyleProvider diffStyle={diffStyle}>
              <DiffOptionsProvider options={diffOptions}>
              <DiffCommentComposerContext.Provider value={handleDiffCommentToComposer}>
                <LiveSubagentTextContext.Provider value={liveSubagentText}>
                  <TaskActiveFormsContext.Provider value={taskActiveForms}>
                    {(() => {
                      const lastRowKey = transcriptTimelineRows.at(-1)?.key
                      return virtualTimeline.visibleRows.map(({ row, top }) => (
                        <VirtualTimelineRow
                          key={row.key}
                          row={row}
                          top={top}
                          isLast={row.key === lastRowKey}
                          highlighted={highlightedMessageId === row.message.uuid}
                          forking={forkingMessageId === row.message.uuid}
                          resumeTarget={resumeFromMessageId === row.message.uuid}
                          bookmarked={bookmarkIds.has(row.message.uuid)}
                          streamMode={viewMode === 'stream'}
                          onMeasure={handleTimelineRowMeasure}
                          onLastRowRef={setLastTimelineRow}
                          onForkFromMessage={handleForkFromMessage}
                          onToggleResume={toggleResumeFromMessage}
                          onToggleBookmark={toggleBookmark}
                          onReusePrompt={handleReusePrompt}
                          onQuoteMessage={handleQuoteMessage}
                          onEditFromMessage={handleEditFromMessage}
                        />
                      ))
                    })()}
                  </TaskActiveFormsContext.Provider>
                </LiveSubagentTextContext.Provider>
              </DiffCommentComposerContext.Provider>
              </DiffOptionsProvider>
              </DiffStyleProvider>
              </ViewModeProvider>
              </MessageDensityProvider>
            </div>
          </div>
        )}
        {hasTranscriptTimeline && (
          <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            {autoFollow ? (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(56,217,245,0.22)',
                  background: 'var(--surface)',
                  boxShadow: '0 10px 30px rgba(56,217,245,0.08)',
                }}
              >
                <LiveSpinner label="waiting for new messages" />
              </div>
            ) : (
              <Button
                onClick={() => {
                  setAutoFollow(true)
                  scrollTimelineToBottom()
                }}
                size="sm"
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(56,217,245,0.24)',
                  background: 'var(--surface)',
                  color: 'var(--cyan)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  boxShadow: '0 10px 30px var(--cyan-glow)',
                }}
              >
                FOLLOW LIVE
              </Button>
            )}
          </div>
        )}
            </div>
          </>
        )}
      </div>
      {taskRailOpen && taskRegistry.size > 0 && (
        <TaskRail
          registry={taskRegistry}
          onJumpToEvent={handleJumpToMessage}
          onClose={() => setTaskRailOpen(false)}
        />
      )}
      </div>

      {/* ── Message input (single session only) ──────── */}
      {!isProject && composerCollapsed && (
        <div
          style={{
            padding: '4px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={() => setComposerCollapsed(false)}
            title="Expand composer"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--text-3)',
              padding: '2px 8px',
              borderRadius: 6,
              lineHeight: 1,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            ▲ COMPOSER
          </button>
        </div>
      )}
      {!isProject && !composerCollapsed && <div
        onDragEnter={handleComposerDragEnter}
        onDragOver={handleComposerDragOver}
        onDragLeave={handleComposerDragLeave}
        onDrop={handleComposerDrop}
        style={{
          padding: '8px 16px 10px',
          borderTop: '1px solid var(--border)',
          background: composerDropActive ? 'rgba(56,217,245,0.06)' : 'var(--surface)',
          flexShrink: 0,
          position: 'relative',
          transition: 'background 120ms ease',
          outline: composerDropActive ? '1px dashed rgba(56,217,245,0.45)' : 'none',
          outlineOffset: composerDropActive ? -4 : 0,
        }}
      >
        <button
          type="button"
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
        {sendError && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--red, #f87171)',
            marginBottom: 8,
            letterSpacing: '0.03em',
          }}>
            <span>{sendError}</span>
            {failedSend && (
              <Button
                type="button"
                onClick={restoreFailedSend}
                disabled={sendBusy}
                variant="outline"
                size="sm"
                style={{
                  height: 24,
                  padding: '0 8px',
                  borderRadius: 5,
                  border: '1px solid rgba(248,113,113,0.28)',
                  background: 'rgba(248,113,113,0.08)',
                  color: 'var(--red, #f87171)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.06em',
                }}
              >
                <RotateCcw data-icon="inline-start" />
                RETRY
              </Button>
            )}
          </div>
        )}
        {(sessionActionError || sessionActionNotice) && (
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: sessionActionError ? 'var(--red, #f87171)' : 'var(--green)',
            marginBottom: 8,
            letterSpacing: '0.03em',
          }}>
            {sessionActionError ?? sessionActionNotice}
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
          style={{
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%)',
            boxShadow: '0 10px 24px var(--violet-glow)',
          }}
        >
          <CardHeader className="sr-only">
            <CardTitle>Message composer</CardTitle>
          </CardHeader>
          <CardContent style={{ padding: '10px 12px' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 176px', minWidth: 0 }}>
                <Label style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: 'var(--text-3)',
                  letterSpacing: '0.05em',
                }}>
                  MODEL
                </Label>
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
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    EFFORT
                  </Label>
                  <NativeSelect
                    value={selectedEffort}
                    onChange={(event) => setSelectedEffort(event.target.value as 'auto' | ReasoningEffortLevel)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                  >
                    <NativeSelectOption value="auto">AUTO</NativeSelectOption>
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
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    CONTEXT
                  </Label>
                  <NativeSelect
                    value={selectedCopilotContextTier}
                    onChange={(event) => setSelectedCopilotContextTier(event.target.value as CopilotContextTier)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="GitHub Copilot context tier"
                  >
                    <NativeSelectOption value="default">DEFAULT</NativeSelectOption>
                    <NativeSelectOption
                      value="long_context"
                      disabled={!selectedModelInfo?.supportsLongContext}
                    >
                      LONG
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              {activeProvider === 'opencode' && composerAgentOptions.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 160px', minWidth: 136 }}>
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    AGENT
                  </Label>
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
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    MODE
                  </Label>
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
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    MODE
                  </Label>
                  <NativeSelect
                    value={selectedPermissionMode}
                    onChange={(event) => commitClaudePermissionSelection(event.target.value as typeof selectedPermissionMode)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="Claude permission mode — mirrors the CLI's /permissions"
                  >
                    <NativeSelectOption value="default">DEFAULT</NativeSelectOption>
                    <NativeSelectOption value="acceptEdits">ACCEPT EDITS</NativeSelectOption>
                    <NativeSelectOption value="plan">PLAN</NativeSelectOption>
                    <NativeSelectOption value="bypassPermissions">BYPASS</NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              {session?.provider === 'codex' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 180px', minWidth: 150 }}>
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    APPROVALS
                  </Label>
                  <NativeSelect
                    value={selectedCodexApproval}
                    onChange={(event) => setSelectedCodexApproval(event.target.value as typeof selectedCodexApproval)}
                    className={cn(compactNativeSelectClassName, 'flex-1')}
                    title="Codex approval policy — mirrors the CLI's /approvals (AskForApproval)"
                  >
                    <NativeSelectOption value="auto">CONFIG</NativeSelectOption>
                    <NativeSelectOption value="untrusted">UNTRUSTED</NativeSelectOption>
                    <NativeSelectOption value="on-request">ON REQUEST</NativeSelectOption>
                    <NativeSelectOption value="on-failure">ON FAILURE</NativeSelectOption>
                    <NativeSelectOption value="never">NEVER</NativeSelectOption>
                  </NativeSelect>
                </label>
              )}
              {session?.provider === 'claude' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 140px', minWidth: 120 }}>
                  <Label style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: 'var(--text-3)',
                    letterSpacing: '0.05em',
                  }}>
                    BUDGET
                  </Label>
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
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      cursor: previewingRewind || applyingRewind || !rewindTargetId ? 'not-allowed' : 'pointer',
                      opacity: previewingRewind || applyingRewind || !rewindTargetId ? 0.5 : 1,
                    }}
                  >
                    {previewingRewind ? 'PREVIEWING…' : 'REWIND'}
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
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      cursor: previewingRewind || applyingRewind ? 'not-allowed' : 'pointer',
                      opacity: previewingRewind || applyingRewind ? 0.5 : 1,
                    }}
                  >
                    {previewingRewind ? 'PREVIEWING…' : 'ROLLBACK'}
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
                <span>Next send will resume from the selected timeline point in a forked session.</span>
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
                    fontSize: 9,
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
                        {(['once', 'always', 'reject'] as const)
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
                              fontSize: 9,
                              letterSpacing: '0.06em',
                              cursor: sessionActionLoading === `permission:${permission.id}` ? 'not-allowed' : 'pointer',
                              opacity: sessionActionLoading === `permission:${permission.id}` ? 0.55 : 1,
                            }}
                          >
                            {response === 'once' ? 'ALLOW' : response.toUpperCase()}
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
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', wordBreak: 'break-all' }}>
                        {`URL: ${permission.url}`}
                      </div>
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
                const previewSrc = attachmentImagePreviewSrc(attachment)
                const isImage = previewSrc !== null
                return (
                  <button
                    key={attachment.id ?? `${attachment.type}-${index}`}
                    type="button"
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
                      `${attachment.type.toUpperCase()} ${attachmentDisplayName(attachment)}`
                    )}
                  </button>
                )
              })}
            </div>
            {queuedSends.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--amber, #eaaa40)',
                  opacity: 0.85,
                }}>
                  Queued ({queuedSends.length})
                </span>
                {queuedSends.map((entry, index) => {
                  const preview = entry.text.replace(/\s+/g, ' ').trim()
                  const short = preview.length > 48 ? `${preview.slice(0, 48)}…` : preview
                  const attachmentSuffix = entry.attachments.length > 0 ? ` +${entry.attachments.length}` : ''
                  return (
                    <span
                      key={`queued-${index}`}
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
                      <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{index + 1}.</span>
                      <button
                        type="button"
                        onClick={() => editQueuedSend(index)}
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
                        onClick={() => removeQueuedSend(index)}
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', position: 'relative' }}>
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
              <Textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => {
                  const next = e.target.value
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
                  updateComposerHints(next, e.target.selectionStart ?? next.length)
                }}
                onKeyUp={(event) => updateComposerHints(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                onClick={(event) => updateComposerHints(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                onBlur={() => { setMentionQuery(null); setSlashOpen(false) }}
                onCompositionStart={() => { isComposingRef.current = true }}
                onCompositionEnd={() => { isComposingRef.current = false }}
                onKeyDown={handleKeyDown}
                onPaste={handleComposerPaste}
                placeholder={composerPlaceholder}
                rows={1}
                style={{
                  flex: 1,
                  resize: 'none',
                  background: 'var(--surface-2)',
                  border: `1px solid ${
                    sendState === 'error'
                      ? 'rgba(248,113,113,0.4)'
                      : channelBridge.routeComposer
                      ? `rgba(${composerConfig.cssAccentRgb},0.45)`
                      : 'var(--border-2)'
                  }`,
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontSize: 12,
                  color: 'var(--text)',
                  lineHeight: 1.4,
                  outline: 'none',
                  overflowX: 'hidden',
                  overflowY: 'hidden',
                  transition: 'border-color 0.15s, opacity 0.15s',
                }}
              />
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
                      fontSize: 8,
                      fontWeight: 700,
                      lineHeight: '13px',
                      textAlign: 'center',
                    }}
                  >
                    {channelBridge.unread > 9 ? '9+' : channelBridge.unread}
                  </span>
                )}
              </Button>
              {channelBridgeOpen && (
                <ChannelBridgePanel
                  accent={{ cssVar: composerConfig.cssAccentVar, cssRgb: composerConfig.cssAccentRgb, label: composerConfig.label }}
                  bridge={channelBridge}
                  onClose={() => setChannelBridgeOpen(false)}
                />
              )}
              {sendState === 'sending' || reattachedRunning ? (
                <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Button
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
                      background: `rgba(${composerConfig.cssAccentRgb},0.18)`,
                      border: `1px solid rgba(${composerConfig.cssAccentRgb},0.3)`,
                      borderRadius: 6,
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
                    <SendHorizontal data-icon="inline-start" />
                  </Button>
                  {session?.provider === 'claude' && activeToolCount > 0 ? (
                    <Button
                      type="button"
                      onClick={() => { void backgroundClaudeTasks() }}
                      disabled={backgroundingTasks}
                      variant="outline"
                      aria-label="Move Claude task to background"
                      title="Move Claude task to background"
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
                    background: `rgba(${composerConfig.cssAccentRgb},0.18)`,
                    border: `1px solid rgba(${composerConfig.cssAccentRgb},0.3)`,
                    borderRadius: 6,
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
                  <SendHorizontal data-icon="inline-start" />
                </Button>
              )}
            </div>
            <div
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
              <span>
                <span style={{ color: `var(${composerConfig.cssAccentVar})`, marginRight: 6, fontWeight: 600 }}>{composerConfig.glyph}</span>
                {composerStatus}
              </span>
              <span style={{ color: 'var(--text-3)', opacity: 0.7 }}>
                {sendBusy ? composerConfig.footerHintSending : composerConfig.footerHintIdle}
                {!sendBusy && sentHistory.length > 0 ? ` (${sentHistory.length})` : ''}
              </span>
            </div>
          </CardContent>
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
                  {applyingRewind ? 'APPLYING…' : 'APPLY REWIND'}
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
      </div>}
      {analyticsOpen ? (
        <AnalyticsPopover
          open={analyticsOpen}
          onClose={() => setAnalyticsOpen(false)}
          input={{ info: sessionInfo, threadedMessages: threadedFull, rawMessages: messages }}
        />
      ) : null}
    </div>
  )
}
