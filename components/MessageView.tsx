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
import { exportSessionToHtml, downloadHtml } from '@/lib/export'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import { extractClaudeStreamToolUse, normalizeClaudeStreamThreadedMessage } from '@/lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '@/lib/codexMapper'
import { getSlashCommandSuggestions, filterSlashCommands, type SlashCommandSuggestion } from '@/lib/slashCommands'
import { getProviderComposer, pickProviderExample } from '@/lib/providerComposer'
import { extractClaudeReadFileSummary } from '@/lib/claudeSdkFeatures'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption, nativeSelectBaseClassName } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { ChartNetwork, Filter, RotateCcw, Search, SendHorizontal, Square, X } from 'lucide-react'
import MessageItem, { MessageDensityProvider, type MessageDensity } from './MessageItem'
import { LiveSubagentTextContext, TaskActiveFormsContext, buildTaskActiveFormsForWeb } from './messageItemShared'
import { TaskRail } from './TaskRail'
import { buildTaskRegistry, buildTaskRegistryFromCodexPlan, buildTaskRegistryFromTodos, type CodexPlanStep } from '@/lib/taskRegistry'
import MessageSessionVisualizer, { type MessageVisualizerRow } from './MessageSessionVisualizer'
import { getContinueInCliCommand } from '@/lib/cliContinue'
import CodeThemeToggle from './CodeThemeToggle'
import TabBar from './TabBar'
import { compactStableFingerprint } from '@/lib/compactFingerprint'
import {
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
  openCodeTodos?: OpenCodeTodo[]
  codexPlan?: { plan: CodexPlanStep[]; explanation: string | null }
}

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

type PendingPermission = {
  id: string
  title: string
  detail?: string
  canApproveAlways?: boolean
}

type FailedSend = {
  text: string
  attachments: SendAttachment[]
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
  highlighted?: boolean
  forkingMessageId?: string | null
  resumeFromMessageId?: string | null
}

type TranscriptFilter = 'all' | 'user' | 'assistant' | 'system' | 'tools' | 'errors' | 'thinking' | 'media'
type ActiveTranscriptFilter = Exclude<TranscriptFilter, 'all'>

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
// again. Anchor compensation is helpful while reading (a row above the
// viewport gets measured and we keep the user's content visually stable);
// during active scroll it fights the user's input and is the main source of
// the perceived jumpiness on long transcripts with tool cards.
const SCROLL_IDLE_MS = 140
const PROGRAMMATIC_SCROLL_SUPPRESSION_MS = 120
const ESTIMATED_CHARS_PER_LINE = 92
const TIMELINE_BOTTOM_GUTTER_PX = 72
const TIMELINE_TARGET_TOP_GUTTER_PX = 72
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
const COMPOSER_DRAFT_STORAGE_PREFIX = 'agentViewer:composerDraft:v1:'
const SEND_ATTACHMENT_TYPES = new Set<SendAttachment['type']>(['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob', 'agent'])
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function copilotPermissionSummary(permission: Record<string, unknown>): { title: string; detail?: string; canApproveAlways?: boolean } {
  const kind = stringField(permission, 'kind') ?? 'permission'
  const canApproveAlways = permission.canOfferSessionApproval === true
  const intention = stringField(permission, 'intention')
  switch (kind) {
    case 'commands':
    case 'shell':
      return {
        title: 'Copilot wants to run a command',
        detail: stringField(permission, 'fullCommandText') ?? intention,
        canApproveAlways,
      }
    case 'write':
      return {
        title: 'Copilot wants to write a file',
        detail: [stringField(permission, 'fileName'), intention].filter(Boolean).join(' - ') || undefined,
        canApproveAlways,
      }
    case 'read':
    case 'path': {
      const paths = Array.isArray(permission.paths)
        ? permission.paths.filter((path): path is string => typeof path === 'string')
        : []
      return {
        title: 'Copilot wants to read files',
        detail: stringField(permission, 'path') ?? (paths.length > 0 ? paths.join(', ') : intention),
        canApproveAlways,
      }
    }
    case 'url':
      return {
        title: 'Copilot wants to access a URL',
        detail: stringField(permission, 'url') ?? intention,
        canApproveAlways,
      }
    case 'mcp':
      return {
        title: 'Copilot wants to use an MCP tool',
        detail: [stringField(permission, 'serverName'), stringField(permission, 'toolTitle') ?? stringField(permission, 'toolName')].filter(Boolean).join(' / ') || undefined,
        canApproveAlways,
      }
    case 'custom-tool':
      return {
        title: 'Copilot wants to use a tool',
        detail: [stringField(permission, 'toolName'), stringField(permission, 'toolDescription')].filter(Boolean).join(' - ') || undefined,
        canApproveAlways,
      }
    case 'memory':
      return {
        title: 'Copilot wants to update memory',
        detail: stringField(permission, 'fact') ?? stringField(permission, 'subject'),
        canApproveAlways,
      }
    case 'hook':
      return {
        title: 'Copilot wants approval',
        detail: stringField(permission, 'hookMessage') ?? stringField(permission, 'toolName'),
        canApproveAlways,
      }
    case 'extension-management':
      return {
        title: 'Copilot wants to manage an extension',
        detail: [stringField(permission, 'operation'), stringField(permission, 'extensionName')].filter(Boolean).join(' - ') || undefined,
        canApproveAlways,
      }
    case 'extension-permission-access':
      return {
        title: 'Copilot wants extension permission access',
        detail: stringField(permission, 'extensionName'),
        canApproveAlways,
      }
    default:
      return {
        title: `Copilot requests ${kind} permission`,
        detail: intention,
        canApproveAlways,
      }
  }
}

function extractOpenCodePermission(payload: unknown): PendingPermission | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'opencode_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'permission.updated') return null
  const permission = eventRecord.properties
  if (!permission || typeof permission !== 'object') return null
  const permissionRecord = permission as Record<string, unknown>
  const id = typeof permissionRecord.id === 'string' ? permissionRecord.id : null
  if (!id) return null
  const pattern = permissionRecord.pattern
  const detail = Array.isArray(pattern)
    ? pattern.join(', ')
    : typeof pattern === 'string'
    ? pattern
    : undefined
  return {
    id,
    title: typeof permissionRecord.title === 'string' ? permissionRecord.title : 'Permission requested',
    detail,
  }
}

function extractOpenCodePermissionReply(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'opencode_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'permission.replied') return null
  const properties = eventRecord.properties
  if (!properties || typeof properties !== 'object') return null
  const permissionID = (properties as Record<string, unknown>).permissionID
  return typeof permissionID === 'string' ? permissionID : null
}

function extractCopilotPermission(payload: unknown): PendingPermission | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'copilot_event') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.requested') return null
  const data = asRecord(eventRecord.data)
  if (!data || data.resolvedByHook === true) return null
  const id = stringField(data, 'requestId')
  if (!id) return null
  const permission = asRecord(data.promptRequest) ?? asRecord(data.permissionRequest)
  if (!permission) return {
    id,
    title: 'Copilot requests permission',
  }
  return {
    id,
    ...copilotPermissionSummary(permission),
  }
}

function extractCopilotPermissionCompletion(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'copilot_event') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.completed') return null
  const data = asRecord(eventRecord.data)
  return data ? stringField(data, 'requestId') ?? null : null
}

function extractClaudePermission(payload: unknown): PendingPermission | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'claude_permission') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.requested') return null
  const data = asRecord(eventRecord.data)
  if (!data) return null
  const id = stringField(data, 'requestId')
  if (!id) return null
  const input = asRecord(data.input)
  const command = input ? stringField(input, 'command') : undefined
  const path = input ? (stringField(input, 'file_path') ?? stringField(input, 'path')) : undefined
  const detail = stringField(data, 'description')
    ?? stringField(data, 'blockedPath')
    ?? command
    ?? path
    ?? stringField(data, 'decisionReason')
  const suggestions = data.suggestions
  return {
    id,
    title: stringField(data, 'title')
      ?? stringField(data, 'displayName')
      ?? `Claude requests ${stringField(data, 'toolName') ?? 'tool'} permission`,
    detail,
    canApproveAlways: Array.isArray(suggestions) && suggestions.length > 0,
  }
}

function extractClaudePermissionCompletion(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record || record.type !== 'claude_permission') return null
  const eventRecord = asRecord(record.event)
  if (!eventRecord || eventRecord.type !== 'permission.completed') return null
  const data = asRecord(eventRecord.data)
  return data ? stringField(data, 'requestId') ?? null : null
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

  if ((record.type === 'codex_plan_delta' || record.type === 'codex_reasoning_delta' || record.type === 'codex_reasoning_summary_delta')
    && typeof record.delta === 'string') {
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

  if (record.type === 'assistant') {
    const message = record.message
    if (!message || typeof message !== 'object') return null
    const text = extractTextContent((message as Record<string, unknown>).content)
    return text || null
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
  if (block.type === 'text') return estimateTextSectionHeight(block.text)
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

function estimateTimelineRowHeight(row: TimelineRow): number {
  const { message } = row
  const headerHeight = 82
  const previewHeight = row.previewBadge ? (row.activityDetail ? 42 : 28) : 0
  const liveToolsHeight = row.liveToolActivities && row.liveToolActivities.length > 0
    ? 34 * Math.ceil(row.liveToolActivities.length / 3) + 10
    : 0
  const blockGap = Math.max(message.blocks.length - 1, 0) * 8
  const blockHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => total + estimateThreadedBlockHeight(block), 0)
  const estimated = headerHeight + previewHeight + liveToolsHeight + blockGap + blockHeight
  return Math.max(estimated, message.role === 'system' ? 120 : ESTIMATED_TIMELINE_ROW_HEIGHT)
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
  onForkFromMessage,
  onToggleResume,
  onReusePrompt,
  onQuoteMessage,
  onEditFromMessage,
}: {
  row: TimelineRow
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
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
  const showActions = canCopy || canReuse || canQuote || canEdit || (row.showForkControls && (row.allowFork || row.allowResume))
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
        opacity: row.dimmed ? 0.92 : 1,
        borderRadius: 10,
        boxShadow: row.highlighted
          ? '0 0 0 2px rgba(56,217,245,0.55), 0 0 36px rgba(56,217,245,0.18)'
          : 'none',
        background: row.highlighted ? 'rgba(56,217,245,0.06)' : 'transparent',
        transition: 'box-shadow 180ms ease, background 180ms ease',
      }}
    >
      {row.previewBadge && (
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
      {row.liveToolActivities && row.liveToolActivities.length > 0 && (
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
      {showActions && (
        <div className="timeline-row-actions">
          {row.showForkControls && row.allowFork && (
            <button
              type="button"
              className="timeline-row-action timeline-row-action--fork"
              onClick={() => onForkFromMessage(row.message.uuid)}
              disabled={row.forkingMessageId === row.message.uuid}
            >
              {row.forkingMessageId === row.message.uuid ? 'FORKING…' : 'FORK HERE'}
            </button>
          )}
          {row.showForkControls && row.allowResume && (
            <button
              type="button"
              className={`timeline-row-action timeline-row-action--resume${row.resumeFromMessageId === row.message.uuid ? ' timeline-row-action--resume-active' : ''}`}
              onClick={() => onToggleResume(row.message.uuid)}
            >
              {row.resumeFromMessageId === row.message.uuid ? 'RESUME TARGET' : 'RESUME HERE'}
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
  onMeasure,
  onLastRowRef,
  onForkFromMessage,
  onToggleResume,
  onReusePrompt,
  onQuoteMessage,
  onEditFromMessage,
}: {
  row: TimelineRow
  top: number
  isLast: boolean
  onMeasure: (key: string, height: number) => void
  onLastRowRef: (node: HTMLDivElement | null) => void
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
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
        onForkFromMessage={onForkFromMessage}
        onToggleResume={onToggleResume}
        onReusePrompt={onReusePrompt}
        onQuoteMessage={onQuoteMessage}
        onEditFromMessage={onEditFromMessage}
      />
    </div>
  )
})

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
  openCodeTodos,
  codexPlan,
}: Props) {
  const [inputText, setInputText] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [livePromptSuggestion, setLivePromptSuggestion] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<'requesting' | 'compacting' | null>(null)
  const [taskBudgetTokens, setTaskBudgetTokens] = useState<number | null>(null)
  const [liveSubagentText, setLiveSubagentText] = useState<Record<string, string>>({})
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<SessionModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState<'auto' | ReasoningEffortLevel>('auto')
  const [composerOptions, setComposerOptions] = useState<SessionComposerOptions>({})
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedCopilotMode, setSelectedCopilotMode] = useState('interactive')
  // Claude `/permissions` modes — passed through to body.permissionMode on send.
  const [selectedPermissionMode, setSelectedPermissionMode] = useState<'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'>('default')
  // Mirrors the CLI "queue next prompt while streaming" behavior. When a send
  // fires while one is in flight, the draft is captured here and flushed by an
  // effect once the active turn finishes.
  const [queuedSend, setQueuedSend] = useState<{ text: string; attachments: SendAttachment[] } | null>(null)
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
  const [showTools, setShowTools] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('agentViewer:showTools') !== 'false'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:showTools', showTools ? 'true' : 'false')
  }, [showTools])
  const [density, setDensity] = useState<MessageDensity>(() => {
    if (typeof window === 'undefined') return 'balanced'
    const stored = window.localStorage.getItem('agentViewer:density')
    return (stored === 'comfortable' || stored === 'dense') ? stored : 'balanced'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agentViewer:density', density)
    rowHeightsRef.current.clear()
    setRowMeasurementVersion((version) => version + 1)
  }, [density])
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
  const [sessionActionLoading, setSessionActionLoading] = useState<string | null>(null)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionActionNotice, setSessionActionNotice] = useState<string | null>(null)
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(null)
  const [liveAssistantText, setLiveAssistantText] = useState('')
  const [liveToolActivities, setLiveToolActivities] = useState<LiveToolActivity[]>([])
  const [liveThreadedMessages, setLiveThreadedMessages] = useState<ThreadedMessage[]>([])
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useState(false)
  const [autoFollow, setAutoFollow] = useState(false)
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0)
  const [timelineHeightOverride, setTimelineHeightOverride] = useState<number | null>(null)
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [sentHistory, setSentHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef('')
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null)
  const [mentionResults, setMentionResults] = useState<MentionResult[]>([])
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const mentionAbortRef = useRef<AbortController | null>(null)
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [liveSlashCommands, setLiveSlashCommands] = useState<SlashCommandSuggestion[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement | null>(null)
  const lastTimelineRowRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const inputTextRef = useRef(inputText)
  const suppressDraftSaveRef = useRef(false)
  const sendInFlightRef = useRef(false)
  const awaitingPersistedTurnRef = useRef(false)
  const pendingMessageBaselineRef = useRef<{ count: number; lastUuid: string | null; lastFingerprint: string | null; sessionId: string } | null>(null)
  const liveAssistantTextRef = useRef('')
  const pendingLiveAssistantTextRef = useRef<string | null>(null)
  const liveAssistantFlushFrameRef = useRef<number | null>(null)
  const liveToolIndexesRef = useRef<Map<number, string>>(new Map())
  const rowHeightsRef = useRef<Map<string, number>>(new Map())
  const rowLayoutRef = useRef<TimelineRowLayout>(buildTimelineRowLayout([], new Map(), estimateTimelineRowHeight))
  const threadedCacheRef = useRef<Map<string, ThreadedMessage>>(new Map())
  const prevThreadingRef = useRef<IncrementalThreadingCache | null>(null)
  const pendingRowMeasurementsRef = useRef<Map<string, number>>(new Map())
  const measurementFrameRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef<number>(0)
  const timelineHeightOverrideRef = useRef<number | null>(null)
  const activeTimelineScrollAnchorRef = useRef<TimelineScrollAnchor | null>(null)
  const pendingTimelineAnchorRestoreRef = useRef(false)
  // Set true on each scroll event, cleared SCROLL_IDLE_MS after the last
  // event. While true, we skip the scrollTop anchor adjustment in
  // handleTimelineRowMeasure — measurements still flow into the layout, but
  // they don't yank the scrollbar against the user's drag.
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
    if (nextText == null) return
    pendingLiveAssistantTextRef.current = null
    setLiveAssistantText(nextText)
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
  }, [])

  const queueLiveAssistantText = useCallback((deltaText: string, replace: boolean) => {
    const nextText = replace ? deltaText : `${liveAssistantTextRef.current}${deltaText}`
    liveAssistantTextRef.current = nextText
    pendingLiveAssistantTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText])

  useEffect(() => {
    if (!cliPopoverOpen) return
    function onDown(e: MouseEvent) {
      if (cliPopoverRef.current && !cliPopoverRef.current.contains(e.target as Node))
        setCliPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [cliPopoverOpen])

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
    if (activeProvider !== 'opencode' && attachmentType === 'agent') {
      setAttachmentType('file')
    }
  }, [activeProvider, attachmentType])

  // Reset context usage when switching sessions
  useEffect(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
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
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setAwaitingPersistedTurn(false)
    setSendState('idle')
    setSendError(null)
    setFailedSend(null)
    setAutoFollow(false)
    setTimelineScrollTop(0)
    setTimelineViewportHeight(0)
    rowHeightsRef.current.clear()
    threadedCacheRef.current.clear()
    prevThreadingRef.current = null
    pendingRowMeasurementsRef.current.clear()
    if (measurementFrameRef.current != null) {
      window.cancelAnimationFrame(measurementFrameRef.current)
      measurementFrameRef.current = null
    }
    timelineHeightOverrideRef.current = null
    activeTimelineScrollAnchorRef.current = null
    pendingTimelineAnchorRestoreRef.current = false
    setTimelineHeightOverride(null)
    setRowMeasurementVersion(0)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
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
    if (userScrollingTimerRef.current != null) {
      window.clearTimeout(userScrollingTimerRef.current)
    }
    timelineHeightOverrideRef.current = null
    activeTimelineScrollAnchorRef.current = null
    pendingTimelineAnchorRestoreRef.current = false
  }, [])

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
    return () => observer.disconnect()
  }, [showDiagnostics, showVisualizer, session?.sessionId])

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
      if (timelineHeightOverrideRef.current == null) {
        const stableHeight = rowLayoutRef.current.totalHeight
        timelineHeightOverrideRef.current = stableHeight
        activeTimelineScrollAnchorRef.current = findTimelineScrollAnchor(timelineRowsRef.current, rowLayoutRef.current, timelineRef.current?.scrollTop ?? 0)
        setTimelineHeightOverride(stableHeight)
      }
      userScrollingRef.current = true
      if (userScrollingTimerRef.current != null) {
        window.clearTimeout(userScrollingTimerRef.current)
      }
      userScrollingTimerRef.current = window.setTimeout(() => {
        userScrollingRef.current = false
        userScrollingTimerRef.current = null
        timelineHeightOverrideRef.current = null
        pendingTimelineAnchorRestoreRef.current = true
        setTimelineHeightOverride(null)
      }, SCROLL_IDLE_MS)
    }
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      const node = timelineRef.current
      if (!node) return
      if (!isProgrammaticScroll) {
        activeTimelineScrollAnchorRef.current = findTimelineScrollAnchor(timelineRowsRef.current, rowLayoutRef.current, node.scrollTop)
      }
      setTimelineScrollTop(node.scrollTop)
      if (performance.now() < suppressFollowEvalUntilRef.current) return
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setAutoFollow(distanceFromBottom <= TIMELINE_BOTTOM_GUTTER_PX + 16)
    })
  }, [restoreTimelineScrollAnchor])

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

    const currentLastMessage = messages.at(-1)
    const currentLastUuid = currentLastMessage?.uuid ?? null
    const currentLastFingerprint = sessionMessageFingerprint(currentLastMessage)
    const persistedTurnArrived =
      messages.length > baseline.count
      || currentLastUuid !== baseline.lastUuid
      || currentLastFingerprint !== baseline.lastFingerprint
    const persistedAssistantArrived = messages
      .slice(Math.min(baseline.count, messages.length))
      .some((message) => message.type === 'assistant')
    const liveAssistantVisible = liveAssistantTextRef.current.trim().length > 0 || liveThreadedMessages.length > 0

    if (persistedTurnArrived && (persistedAssistantArrived || !liveAssistantVisible)) {
      setOptimisticUserText(null)
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      awaitingPersistedTurnRef.current = false
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
      if (autoFollow) {
        window.requestAnimationFrame(() => scrollTimelineToBottom())
      }
    }
  }, [autoFollow, awaitingPersistedTurn, clearLiveAssistantText, liveAssistantText, liveThreadedMessages.length, messages, scrollTimelineToBottom, session])

  const cancelSend = useCallback(() => {
    if (session) {
      fetch(`/api/sessions/${session.sessionId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: session.provider }),
      }).catch(() => {})
    }
    if (optimisticUserText) {
      setInputText((prev) => prev || optimisticUserText)
    }
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    sendInFlightRef.current = false
    awaitingPersistedTurnRef.current = false
    setSendState('idle')
    setSendError(null)
    setOptimisticUserText(null)
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    textareaRef.current?.focus()
  }, [clearLiveAssistantText, optimisticUserText, session])

  const sendMessage = useCallback(async () => {
    if (!session) return
    // Native CLIs (Claude, Codex) accept a follow-up prompt while the current
    // turn is still streaming — they queue it. Mirror that: if a send fires
    // while one is in flight, stash the draft and have the post-stream effect
    // flush it once the current turn lands.
    if (sendInFlightRef.current || awaitingPersistedTurnRef.current) {
      const queueText = (textareaRef.current?.value ?? inputTextRef.current).trim()
      if (!queueText) return
      setQueuedSend({ text: queueText, attachments })
      setInputText('')
      inputTextRef.current = ''
      textareaRef.current?.value !== undefined && (textareaRef.current!.value = '')
      setAttachments([])
      window.requestAnimationFrame(resizeComposer)
      return
    }

    const text = (textareaRef.current?.value ?? inputTextRef.current).trim()
    if (!text) return

    sendInFlightRef.current = true
    const sendAttachments = attachments
    const effort = selectedEffort === 'auto' ? undefined : selectedEffort
    setSentHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === text) return prev
      const next = [...prev, text]
      return next.length > 50 ? next.slice(next.length - 50) : next
    })
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = ''
    setInputText('')
    inputTextRef.current = ''
    setSendState('sending')
    setSendError(null)
    setFailedSend(null)
    setOptimisticUserText(text)
    clearLiveAssistantText()
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setLivePromptSuggestion(null)
    setLiveStatus(null)
    setLiveSubagentText({})
    awaitingPersistedTurnRef.current = false
    setAwaitingPersistedTurn(false)
    setAutoFollow(true)
    pendingMessageBaselineRef.current = {
      count: messages.length,
      lastUuid: messages.at(-1)?.uuid ?? null,
      lastFingerprint: sessionMessageFingerprint(messages.at(-1)),
      sessionId: session.sessionId,
    }
    liveToolIndexesRef.current.clear()

    window.requestAnimationFrame(resizeComposer)

    const controller = new AbortController()
    abortControllerRef.current = controller

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
          manualPermissions: session.provider === 'copilot' || session.provider === 'claude' ? true : undefined,
          nativeCommands: session.provider === 'copilot' ? true : undefined,
          taskBudgetTokens: taskBudgetTokens ?? undefined,
          isPendingSession: session.isPending === true ? true : undefined,
          cwd: session.cwd ?? undefined,
          permissionMode: session.provider === 'claude' && selectedPermissionMode !== 'default'
            ? selectedPermissionMode
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
                onFork?.(parsed.sessionId)
                setSessionActionNotice('Forked a continuation from the selected point.')
              } else if (session.isPending && parsed.sessionId) {
                // Swap to the real SDK session id silently. Real CLI shows no
                // "new session created" banner — the streaming reply itself
                // signals that the session is live.
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
            clearLiveAssistantText()
            setLiveToolActivities([])
            setLiveThreadedMessages([])
            continue
          }

          try {
            const parsed = JSON.parse(frame.data)
            if (parsed?.type === 'prompt_suggestion' && typeof parsed.suggestion === 'string') {
              setLivePromptSuggestion(parsed.suggestion)
            }
            if (parsed?.type === 'system' && parsed.subtype === 'status') {
              const next = parsed.status === 'requesting' || parsed.status === 'compacting' ? parsed.status : null
              setLiveStatus(next)
            }
            if (parsed?.type === 'stream_event' && typeof parsed.parent_tool_use_id === 'string' && parsed.parent_tool_use_id) {
              const event = parsed.event
              if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
                const parentId = parsed.parent_tool_use_id
                const delta = event.delta.text
                setLiveSubagentText((prev) => ({ ...prev, [parentId]: (prev[parentId] ?? '') + delta }))
              }
            }
            if (parsed?.type === 'user' && typeof parsed.parent_tool_use_id === 'string' && parsed.parent_tool_use_id) {
              const parentId = parsed.parent_tool_use_id
              setLiveSubagentText((prev) => {
                if (!(parentId in prev)) return prev
                const { [parentId]: _, ...rest } = prev
                return rest
              })
            }
            const pendingPermission = extractOpenCodePermission(parsed) ?? extractCopilotPermission(parsed) ?? extractClaudePermission(parsed)
            if (pendingPermission) {
              setPendingPermissions((prev) => [
                ...prev.filter((permission) => permission.id !== pendingPermission.id),
                pendingPermission,
              ])
            }
            const repliedPermissionId = extractOpenCodePermissionReply(parsed) ?? extractCopilotPermissionCompletion(parsed) ?? extractClaudePermissionCompletion(parsed)
            if (repliedPermissionId) {
              setPendingPermissions((prev) => prev.filter((permission) => permission.id !== repliedPermissionId))
            }
            const toolStart = extractLiveToolStart(parsed)
            if (toolStart) {
              if (parsed.type === 'stream_event') {
                liveToolIndexesRef.current.set(toolStart.index, toolStart.key)
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
                setLiveToolActivities((prev) => prev.map((activity) =>
                  activity.key === activityKey
                    ? { ...activity, status: 'done' }
                    : activity
                ))
                if (session.provider === 'claude') {
                  setLiveThreadedMessages((prev) => completeLiveToolThread(prev, activityKey))
                }
              }
            }

            const deltaText = extractStreamingAssistantText(parsed)
            if (deltaText) {
              setLiveStatus(null)
              queueLiveAssistantText(deltaText, shouldReplaceLiveAssistantText(parsed))
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
      setAttachments([])
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
      setSendState('error')
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
      setFailedSend({ text, attachments: sendAttachments })
      setInputText((current) => {
        if (current.trim()) return current
        inputTextRef.current = text
        return text
      })
      setOptimisticUserText(null)
      clearLiveAssistantText()
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      awaitingPersistedTurnRef.current = false
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
      textareaRef.current?.focus()
    } finally {
      abortControllerRef.current = null
      sendInFlightRef.current = false
    }
  }, [attachments, clearLiveAssistantText, flushLiveAssistantTextNow, messages, onFork, queueLiveAssistantText, refreshSessionModels, resizeComposer, resumeFromMessageId, selectedAgent, selectedCopilotMode, selectedEffort, selectedModel, selectedPermissionMode, session, taskBudgetTokens])

  // Flush queued sends once the active turn finishes. Restores the queued
  // text into the composer so sendMessage picks it up and fires naturally.
  useEffect(() => {
    if (!queuedSend) return
    if (sendInFlightRef.current || awaitingPersistedTurnRef.current) return
    if (sendState === 'sending' || awaitingPersistedTurn) return
    const next = queuedSend
    setQueuedSend(null)
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
  }, [awaitingPersistedTurn, queuedSend, resizeComposer, sendMessage, sendState])

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
    if (e.nativeEvent.isComposing) return
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
        draftBeforeHistoryRef.current = draftValue
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
        const restored = draftBeforeHistoryRef.current
        setInputText(restored)
        inputTextRef.current = restored
        e.preventDefault()
        window.requestAnimationFrame(() => {
          const ta = textareaRef.current
          if (!ta) return
          ta.setSelectionRange(restored.length, restored.length)
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

  const respondToPermission = useCallback(async (permissionId: string, response: 'once' | 'always' | 'reject') => {
    if (!session || sessionActionLoading) return
    setSessionActionLoading(`permission:${permissionId}`)
    setSessionActionError(null)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respondPermission',
          permissionId,
          response,
          provider: session.provider,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setPendingPermissions((prev) => prev.filter((permission) => permission.id !== permissionId))
    } catch (err) {
      setSessionActionError(err instanceof Error ? err.message : 'Failed to respond to permission')
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
    draftBeforeHistoryRef.current = ''
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
    draftBeforeHistoryRef.current = ''
    focusComposer()
  }, [focusComposer])

  const handleEditFromMessage = useCallback((messageId: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setInputText(trimmed)
    inputTextRef.current = trimmed
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = ''
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

  const threadedFull = useMemo(() => {
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
  }, [messages])
  const threaded = useMemo(
    () => (showTools ? threadedFull : stripToolCallBlocks(threadedFull)),
    [threadedFull, showTools],
  )
  const taskActiveForms = useMemo(() => buildTaskActiveFormsForWeb(threaded), [threaded])
  const taskRegistry = useMemo(() => {
    const registry = buildTaskRegistry(threaded)
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
  }, [threaded, openCodeTodos, codexPlan])
  const [taskRailOpen, setTaskRailOpen] = useState(true)
  const isProject = !!projectView
  const dirName  = projectView?.key ?? (pathBasename(session?.cwd) || session?.sessionId) ?? ''

  useEffect(() => {
    if (taskPanelOpenRequest <= 0) return
    setTaskRailOpen(true)
  }, [taskPanelOpenRequest])

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
  const composerPlaceholder = sendBusy
    ? composerConfig.placeholderStreaming
    : activeToolCount > 0
    ? `${composerConfig.label} is using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
    : composerExample
  const composerStatus = sendState === 'error'
    ? 'Failed'
    : queuedSend && (sendState === 'sending' || awaitingPersistedTurn)
    ? 'Queued · sends after current turn'
    : sendState === 'sending'
    ? 'Sending...'
    : awaitingPersistedTurn
    ? 'Waiting for saved response...'
    : 'Ready'
  const composerStatusColor = sendState === 'error'
    ? 'var(--red, #f87171)'
    : queuedSend
    ? 'var(--amber, #eaaa40)'
    : sendState === 'sending' || awaitingPersistedTurn
    ? 'var(--cyan)'
    : 'var(--text-3)'
  const liveTurnTone: 'running' | 'syncing' = awaitingPersistedTurn ? 'syncing' : 'running'
  const liveTurnBadge = awaitingPersistedTurn ? 'SYNCING' : 'RUNNING'
  const liveTurnActivityDetail = awaitingPersistedTurn
    ? queuedSend
      ? 'Turn complete; syncing transcript. Next message queued.'
      : 'Turn complete; syncing transcript.'
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
    const keys = new Set<string>()
    const limit = Math.min(baseline.count, messages.length)
    for (let i = 0; i < limit; i += 1) keys.add(sessionMessageThreadedKey(messages[i]))
    return keys
  }, [messages, session?.sessionId, showLiveTimelineOverlay])
  const visibleThreaded = useMemo(() => {
    if (!visiblePersistedMessageKeys) return threaded
    return threaded.filter((msg) => visiblePersistedMessageKeys.has(threadedMessageKey(msg)))
  }, [threaded, visiblePersistedMessageKeys])
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
        blocks: [{
          type: 'text',
          text: liveAssistantText.trim()
            || (activeToolCount > 0
              ? `Using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
              : sendState === 'sending'
              ? 'Working…'
              : 'Waiting for saved response…'),
        }],
      }
    : null), [
      activeToolCount,
      awaitingPersistedTurn,
      liveAssistantText,
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
      highlighted: highlightedMessageId === msg.uuid,
      forkingMessageId,
      resumeFromMessageId,
    }))
  , [
    forkingMessageId,
    highlightedMessageId,
    isProject,
    lastUserMessageUuid,
    resumeFromMessageId,
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
    showLiveTimelineOverlay,
  ])
  const timelineRows = useMemo<TimelineRow[]>(() => {
    if (persistedTimelineRows.length === 0) return liveTimelineRows
    if (liveTimelineRows.length === 0) return persistedTimelineRows
    return [...persistedTimelineRows, ...liveTimelineRows]
  }, [liveTimelineRows, persistedTimelineRows])
  const normalizedTranscriptSearch = deferredTranscriptSearch.trim().toLowerCase()
  const transcriptTimelineRows = useMemo<TimelineRow[]>(() => {
    if (transcriptFilters.length === 0 && normalizedTranscriptSearch === '') return timelineRows
    return timelineRows.filter((row) => {
      if (!timelineRowMatchesTranscriptFilters(row, transcriptFilters)) return false
      if (!normalizedTranscriptSearch) return true
      return timelineRowSearchText(row).includes(normalizedTranscriptSearch)
    })
  }, [normalizedTranscriptSearch, timelineRows, transcriptFilters])
  const hasTranscriptFocus = transcriptFilters.length > 0 || transcriptSearch.trim().length > 0
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
    for (const key of rowHeightsRef.current.keys()) {
      if (activeKeys.has(key)) continue
      rowHeightsRef.current.delete(key)
      changed = true
    }
    if (changed) setRowMeasurementVersion((version) => version + 1)
  }, [transcriptTimelineRows])

  const setLastTimelineRow = useCallback((node: HTMLDivElement | null) => {
    lastTimelineRowRef.current = node
  }, [])

  const handleTimelineRowMeasure = useCallback((key: string, height: number) => {
    const nextHeight = Math.max(1, Math.ceil(height))
    pendingRowMeasurementsRef.current.set(key, nextHeight)
    if (measurementFrameRef.current != null) return

    measurementFrameRef.current = window.requestAnimationFrame(() => {
      measurementFrameRef.current = null
      const pending = pendingRowMeasurementsRef.current
      if (pending.size === 0) return

      const node = timelineRef.current
      const layout = rowLayoutRef.current
      const rows = timelineRowsRef.current
      const isFollowing = autoFollowRef.current
      // While the user is actively dragging the scrollbar, refuse to apply
      // anchor compensation — it adds to scrollTop on the same frame the
      // user is updating it, which the browser perceives as a fight and
      // produces the visible jumpiness on fast scrubs over tool-heavy
      // transcripts. Layout still updates so positions remain correct;
      // only the scrollTop nudge is suppressed.
      const allowScrollAdjust = !userScrollingRef.current
      const anchor = node ? findTimelineScrollAnchor(rows, layout, node.scrollTop) : null
      const measurementChanges: TimelineMeasurementChange[] = []
      let changed = false

      for (const [key, nextMeasuredHeight] of pending) {
        const index = layout.indexByKey.get(key)
        if (index == null) continue
        const row = rows[index]
        if (!row) continue
        const previousHeight = rowHeightsRef.current.get(key) ?? estimateTimelineRowHeight(row)
        if (nextMeasuredHeight === previousHeight) continue

        rowHeightsRef.current.set(key, nextMeasuredHeight)
        changed = true
        measurementChanges.push({ index, previousHeight, nextHeight: nextMeasuredHeight })
      }

      pending.clear()

      const scrollDelta = allowScrollAdjust && !isFollowing
        ? computeTimelineScrollCompensation(measurementChanges, anchor)
        : 0
      if (node && allowScrollAdjust && !isFollowing && scrollDelta !== 0) {
        suppressFollowEvalUntilRef.current = performance.now() + 200
        markProgrammaticTimelineScroll()
        node.scrollTop += scrollDelta
        setTimelineScrollTop(node.scrollTop)
      }

      if (changed) {
        setRowMeasurementVersion((version) => version + 1)
      }
    })
  }, [markProgrammaticTimelineScroll])

  useLayoutEffect(() => {
    if (!autoFollow || !hasTranscriptTimeline || loading) return
    scrollTimelineToBottom()
    alignLastTimelineRowToViewportBottom()
  }, [alignLastTimelineRowToViewportBottom, autoFollow, hasTranscriptTimeline, loading, rowMeasurementVersion, scrollTimelineToBottom, transcriptTimelineRows.length])

  // Separate the expensive O(n) height accumulation from the scroll-reactive
  // visibility window. rowLayout only recomputes when rows or measurements
  // change; virtualTimeline re-runs on every scroll but only does a scan of
  // the visible window — no new objects for off-screen rows.
  const rowLayout = useMemo(() => {
    return buildTimelineRowLayout(transcriptTimelineRows, rowHeightsRef.current, estimateTimelineRowHeight)
  }, [rowMeasurementVersion, transcriptTimelineRows])
  rowLayoutRef.current = rowLayout

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

        {/* Tasks panel */}
        {!isProject && taskRegistry.size > 0 && (
          <Button
            onClick={() => setTaskRailOpen((value) => !value)}
            title={taskRailOpen ? 'Hide task panel' : 'Show task panel'}
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: taskRailOpen ? 'rgba(245,158,11,0.14)' : 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 5,
              color: taskRailOpen ? 'var(--amber)' : 'var(--text-2)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            ☐ TASKS · {taskRegistry.size}
          </Button>
        )}

        <Button
          onClick={() => setShowVisualizer((value) => !value)}
          title={showVisualizer ? 'Show transcript view' : 'Show session visualiser'}
          variant="outline"
          size="sm"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            height: 26,
            padding: '0 10px',
            background: showVisualizer ? 'rgba(56,217,245,0.14)' : 'rgba(56,217,245,0.06)',
            border: '1px solid rgba(56,217,245,0.22)',
            borderRadius: 5,
            color: showVisualizer ? 'var(--cyan)' : 'var(--text-3)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            cursor: 'pointer',
          }}
        >
          <ChartNetwork data-icon="inline-start" />
          {showVisualizer ? 'TRANSCRIPT' : 'VISUALISER'}
        </Button>

        {/* Code theme picker */}
        <CodeThemeToggle />

        {/* Stats */}
        {!loading && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              flexShrink: 0,
            }}
          >
            {isProject
              ? `${projectView!.sessionCount} sessions · ${threaded.length} turns`
              : `${threaded.length} turns · ${messages.length} events`}
          </span>
        )}

        {/* Fork button (single session only) */}
        {!isProject && session?.provider !== 'copilot' && (
          <Button
            onClick={handleFork}
            disabled={forking}
            title="Fork this session into a new branch"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'rgba(139,128,240,0.07)',
              border: '1px solid rgba(139,128,240,0.18)',
              borderRadius: 5,
              cursor: forking ? 'not-allowed' : 'pointer',
              color: 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              opacity: forking ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (!forking) {
                e.currentTarget.style.background    = 'rgba(139,128,240,0.14)'
                e.currentTarget.style.color         = 'var(--violet)'
                e.currentTarget.style.borderColor   = 'rgba(139,128,240,0.35)'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'rgba(139,128,240,0.07)'
              e.currentTarget.style.color         = 'var(--text-3)'
              e.currentTarget.style.borderColor   = 'rgba(139,128,240,0.18)'
            }}
          >
            {forking ? 'FORKING…' : 'FORK'}
          </Button>
        )}

        {/* CLI continue button */}
        {!isProject && cliCommand && (
          <div ref={cliPopoverRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setCliPopoverOpen(v => !v)}
              title="Get CLI command to resume this session"
              className="av-hover-control"
              style={{
                height: 26,
                padding: '0 10px',
                background: cliPopoverOpen ? 'rgba(56,217,245,0.13)' : 'rgba(56,217,245,0.07)',
                border: '1px solid rgba(56,217,245,0.18)',
                borderRadius: 5,
                cursor: 'pointer',
                color: cliPopoverOpen ? 'var(--cyan)' : 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.08em',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => {
                if (!cliPopoverOpen) {
                  e.currentTarget.style.background = 'rgba(56,217,245,0.13)'
                  e.currentTarget.style.color = 'var(--cyan)'
                  e.currentTarget.style.borderColor = 'rgba(56,217,245,0.35)'
                }
              }}
              onMouseLeave={e => {
                if (!cliPopoverOpen) {
                  e.currentTarget.style.background = 'rgba(56,217,245,0.07)'
                  e.currentTarget.style.color = 'var(--text-3)'
                  e.currentTarget.style.borderColor = 'rgba(56,217,245,0.18)'
                }
              }}
            >CLI</button>
            {cliPopoverOpen && (
              <div style={{
                position: 'absolute',
                top: 32,
                right: 0,
                zIndex: 50,
                background: 'var(--surface-2, #1e1e2e)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minWidth: 320,
                boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
              }}>
                <code style={{
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: 'var(--cyan)',
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}>
                  {cliCommand}
                </code>
                <button
                  type="button"
                  style={{
                    alignSelf: 'flex-end',
                    height: 24,
                    fontSize: 11,
                    padding: '0 10px',
                    cursor: 'pointer',
                    background: 'rgba(56,217,245,0.07)',
                    border: '1px solid rgba(56,217,245,0.25)',
                    borderRadius: 4,
                    color: 'var(--cyan)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: '0.08em',
                  }}
                  onClick={() => {
                    void navigator.clipboard.writeText(cliCommand)
                    setCliPopoverOpen(false)
                  }}
                >COPY</button>
              </div>
            )}
          </div>
        )}

        {!isProject && activeProvider === 'opencode' && (
          <>
            {sessionCapabilities?.shareSession && (
              <Button
                onClick={() => runSessionAction('share')}
                disabled={!!sessionActionLoading}
                title="Share OpenCode session"
                variant="outline"
                size="sm"
                className="av-hover-control"
                style={{
                  flexShrink: 0,
                  height: 26,
                  padding: '0 8px',
                  background: 'rgba(45,212,160,0.07)',
                  border: '1px solid rgba(45,212,160,0.18)',
                  borderRadius: 5,
                  color: 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  cursor: sessionActionLoading ? 'not-allowed' : 'pointer',
                  opacity: sessionActionLoading ? 0.55 : 1,
                }}
              >
                SHARE
              </Button>
            )}
            {sessionCapabilities?.unshareSession && (
              <Button
                onClick={() => runSessionAction('unshare')}
                disabled={!!sessionActionLoading}
                title="Unshare OpenCode session"
                variant="outline"
                size="sm"
                className="av-hover-control"
                style={{
                  flexShrink: 0,
                  height: 26,
                  padding: '0 8px',
                  background: 'rgba(45,212,160,0.07)',
                  border: '1px solid rgba(45,212,160,0.18)',
                  borderRadius: 5,
                  color: 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  cursor: sessionActionLoading ? 'not-allowed' : 'pointer',
                  opacity: sessionActionLoading ? 0.55 : 1,
                }}
              >
                UNSHARE
              </Button>
            )}
            {sessionCapabilities?.summarizeSession && (
              <Button
                onClick={() => runSessionAction('summarize')}
                disabled={!!sessionActionLoading}
                title="Summarize OpenCode session"
                variant="outline"
                size="sm"
                className="av-hover-control"
                style={{
                  flexShrink: 0,
                  height: 26,
                  padding: '0 8px',
                  background: 'rgba(234,170,64,0.07)',
                  border: '1px solid rgba(234,170,64,0.18)',
                  borderRadius: 5,
                  color: 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  cursor: sessionActionLoading ? 'not-allowed' : 'pointer',
                  opacity: sessionActionLoading ? 0.55 : 1,
                }}
              >
                SUMMARY
              </Button>
            )}
            {sessionCapabilities?.unrevertSession && (
              <Button
                onClick={() => runSessionAction('unrevert')}
                disabled={!!sessionActionLoading}
                title="Restore reverted OpenCode changes"
                variant="outline"
                size="sm"
                className="av-hover-control"
                style={{
                  flexShrink: 0,
                  height: 26,
                  padding: '0 8px',
                  background: 'rgba(234,170,64,0.07)',
                  border: '1px solid rgba(234,170,64,0.18)',
                  borderRadius: 5,
                  color: 'var(--text-3)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  cursor: sessionActionLoading ? 'not-allowed' : 'pointer',
                  opacity: sessionActionLoading ? 0.55 : 1,
                }}
              >
                UNREVERT
              </Button>
            )}
          </>
        )}

        {/* Export button (single session only) */}
        {!isProject && (
          <Button
            onClick={handleExport}
            disabled={exporting}
            title="Export session to HTML"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'rgba(56,217,245,0.07)',
              border: '1px solid rgba(56,217,245,0.18)',
              borderRadius: 5,
              cursor: exporting ? 'not-allowed' : 'pointer',
              color: 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              opacity: exporting ? 0.6 : 1,
            }}
            onMouseEnter={e => {
              if (!exporting) {
                e.currentTarget.style.background    = 'rgba(56,217,245,0.13)'
                e.currentTarget.style.color         = 'var(--cyan)'
                e.currentTarget.style.borderColor   = 'rgba(56,217,245,0.35)'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'rgba(56,217,245,0.07)'
              e.currentTarget.style.color         = 'var(--text-3)'
              e.currentTarget.style.borderColor   = 'rgba(56,217,245,0.18)'
            }}
          >
            {exporting ? 'EXPORTING…' : 'EXPORT'}
          </Button>
        )}

        {!isProject && sessionCapabilities?.deleteSession && (
          <Button
            onClick={handleDeleteSession}
            disabled={deleting}
            title="Delete session"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: 'rgba(248,113,113,0.07)',
              border: '1px solid rgba(248,113,113,0.18)',
              borderRadius: 5,
              cursor: deleting ? 'not-allowed' : 'pointer',
              color: deleting ? 'var(--red, #f87171)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
              opacity: deleting ? 0.55 : 1,
            }}
          >
            {deleting ? 'DELETING…' : 'DELETE'}
          </Button>
        )}

        {!isProject && (
          <Button
            onClick={toggleDiagnostics}
            title="Show session diagnostics"
            variant="outline"
            size="sm"
            className="av-hover-control"
            style={{
              flexShrink: 0,
              height: 26,
              padding: '0 10px',
              background: showDiagnostics ? 'rgba(234,170,64,0.14)' : 'rgba(234,170,64,0.07)',
              border: '1px solid rgba(234,170,64,0.18)',
              borderRadius: 5,
              cursor: 'pointer',
              color: showDiagnostics ? 'var(--yellow, #fbbf24)' : 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              letterSpacing: '0.08em',
            }}
          >
            DIAG
          </Button>
        )}

        <Button
          onClick={() => setShowTools((v) => !v)}
          title={showTools ? 'Hide tool calls' : 'Show tool calls'}
          variant="outline"
          size="sm"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            height: 26,
            padding: '0 10px',
            background: showTools ? 'rgba(139,92,246,0.14)' : 'rgba(139,92,246,0.05)',
            border: '1px solid rgba(139,92,246,0.22)',
            borderRadius: 5,
            cursor: 'pointer',
            color: showTools ? 'var(--violet)' : 'var(--text-3)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
          }}
        >
          {showTools ? 'TOOLS ON' : 'TOOLS OFF'}
        </Button>

        <Button
          onClick={() => setDensity((d) => d === 'comfortable' ? 'balanced' : d === 'balanced' ? 'dense' : 'comfortable')}
          title={`Density: ${density} — click to cycle`}
          variant="outline"
          size="sm"
          className="av-hover-control"
          style={{
            flexShrink: 0,
            height: 26,
            padding: '0 10px',
            background: density === 'comfortable' ? 'rgba(56,217,245,0.08)' : density === 'dense' ? 'rgba(251,191,36,0.08)' : 'rgba(56,217,245,0.04)',
            border: density === 'comfortable' ? '1px solid rgba(56,217,245,0.28)' : density === 'dense' ? '1px solid rgba(251,191,36,0.28)' : '1px solid rgba(56,217,245,0.16)',
            borderRadius: 5,
            cursor: 'pointer',
            color: density === 'comfortable' ? 'var(--cyan)' : density === 'dense' ? 'var(--amber)' : 'var(--text-3)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
          }}
        >
          {density === 'comfortable' ? 'COMFY' : density === 'dense' ? 'DENSE' : 'BALANCED'}
        </Button>

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
                    <button
                      type="button"
                      className="av-session-viz-clear-focus"
                      onClick={() => {
                        setTranscriptFilters([])
                        setTranscriptSearch('')
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
            <div
              ref={timelineContentRef}
              style={{ position: 'relative', minHeight: timelineRenderedHeight, height: timelineRenderedHeight }}
            >
              <MessageDensityProvider density={density}>
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
                          onMeasure={handleTimelineRowMeasure}
                          onLastRowRef={setLastTimelineRow}
                          onForkFromMessage={handleForkFromMessage}
                          onToggleResume={toggleResumeFromMessage}
                          onReusePrompt={handleReusePrompt}
                          onQuoteMessage={handleQuoteMessage}
                          onEditFromMessage={handleEditFromMessage}
                        />
                      ))
                    })()}
                  </TaskActiveFormsContext.Provider>
                </LiveSubagentTextContext.Provider>
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
                  <div
                    key={permission.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      padding: '7px 8px',
                      borderRadius: 6,
                      border: '1px solid rgba(234,170,64,0.24)',
                      background: 'rgba(234,170,64,0.07)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.06em' }}>
                        {permission.title}
                      </div>
                      {permission.detail && (
                        <div style={{ marginTop: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {permission.detail}
                        </div>
                      )}
                    </div>
                    {(['once', 'always', 'reject'] as const)
                      .filter((response) => response !== 'always' || permission.canApproveAlways !== false)
                      .map((response) => (
                      <Button
                        key={response}
                        onClick={() => respondToPermission(permission.id, response)}
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
                        {response.toUpperCase()}
                      </Button>
                    ))}
                  </div>
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
                    draftBeforeHistoryRef.current = ''
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
                onKeyDown={handleKeyDown}
                onPaste={handleComposerPaste}
                placeholder={composerPlaceholder}
                rows={1}
                style={{
                  flex: 1,
                  resize: 'none',
                  background: 'var(--surface-2)',
                  border: `1px solid ${sendState === 'error' ? 'rgba(248,113,113,0.4)' : 'var(--border-2)'}`,
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
              {sendState === 'sending' ? (
                <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Button
                    type="button"
                    onClick={sendMessage}
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
                  onClick={sendMessage}
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
