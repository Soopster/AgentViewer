'use client'

import { memo, useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import type {
  SessionMessage,
  Session,
  SendState,
  ContextUsage,
  SessionInfo,
  SessionModelInfo,
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption, nativeSelectBaseClassName } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import dynamic from 'next/dynamic'
import { RotateCcw, SendHorizontal, Square } from 'lucide-react'
import MessageItem, { MessageDensityProvider, type MessageDensity } from './MessageItem'
import { getContinueInCliCommand } from '@/lib/cliContinue'
import CodeThemeToggle from './CodeThemeToggle'
import TabBar from './TabBar'

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
}

type FailedSend = {
  text: string
  attachments: SendAttachment[]
}

type ComposerDraft = {
  text: string
  attachments: SendAttachment[]
}

type TimelineRow = {
  key: string
  message: ThreadedMessage
  showSession: boolean
  dimmed?: boolean
  previewBadge?: string
  liveToolActivities?: LiveToolActivity[]
  showForkControls?: boolean
  allowFork?: boolean
  allowResume?: boolean
  highlighted?: boolean
  forkingMessageId?: string | null
  resumeFromMessageId?: string | null
}

const ESTIMATED_TIMELINE_ROW_HEIGHT = 220
const TIMELINE_OVERSCAN_PX = 1200
const ESTIMATED_CHARS_PER_LINE = 92
const TIMELINE_BOTTOM_GUTTER_PX = 72
const TIMELINE_TARGET_TOP_GUTTER_PX = 72
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
const COMPOSER_DRAFT_STORAGE_PREFIX = 'agentViewer:composerDraft:v1:'
const SEND_ATTACHMENT_TYPES = new Set<SendAttachment['type']>(['file', 'directory', 'selection', 'image', 'mention', 'skill', 'blob'])

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

function sessionMessageFingerprint(message: SessionMessage | undefined): string | null {
  if (!message) return null
  let payload = ''
  try {
    payload = JSON.stringify(message.message)
  } catch {
    payload = String(message.message)
  }
  return [
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    payload,
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
  if (block.type === 'image') return 220
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
    return 84
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
  const previewHeight = row.previewBadge ? 28 : 0
  const liveToolsHeight = row.liveToolActivities && row.liveToolActivities.length > 0
    ? 34 * Math.ceil(row.liveToolActivities.length / 3) + 10
    : 0
  const blockGap = Math.max(message.blocks.length - 1, 0) * 8
  const blockHeight = message.blocks.reduce((total: number, block: ThreadedBlock) => total + estimateThreadedBlockHeight(block), 0)
  const estimated = headerHeight + previewHeight + liveToolsHeight + blockGap + blockHeight
  return Math.max(estimated, message.role === 'system' ? 120 : ESTIMATED_TIMELINE_ROW_HEIGHT)
}

type TimelineRowLayout = {
  tops: Float64Array
  heights: Float64Array
  totalHeight: number
  indexByKey: Map<string, number>
}

function buildTimelineRowLayout(timelineRows: TimelineRow[], measuredHeights: Map<string, number>): TimelineRowLayout {
  const n = timelineRows.length
  const tops = new Float64Array(n)
  const heights = new Float64Array(n)
  const indexByKey = new Map<string, number>()
  let totalHeight = 0
  for (let i = 0; i < n; i++) {
    const row = timelineRows[i]
    tops[i] = totalHeight
    heights[i] = measuredHeights.get(row.key) ?? estimateTimelineRowHeight(row)
    indexByKey.set(row.key, i)
    totalHeight += heights[i]
  }
  return { tops, heights, totalHeight, indexByKey }
}

function upperBound(values: Float64Array, length: number, target: number): number {
  let low = 0
  let high = length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (values[mid] <= target) low = mid + 1
    else high = mid
  }
  return low
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

const TimelineMessageRow = memo(function TimelineMessageRow({
  row,
  onForkFromMessage,
  onToggleResume,
}: {
  row: TimelineRow
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
}) {
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 0 8px 0' }}>
          <span style={{
            height: 20,
            padding: '0 8px',
            borderRadius: 999,
            border: '1px solid rgba(45,212,160,0.22)',
            background: 'rgba(45,212,160,0.08)',
            color: 'var(--green)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.06em',
            display: 'inline-flex',
            alignItems: 'center',
          }}>
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
      {row.showForkControls && (row.allowFork || row.allowResume) && (
        <div className="timeline-row-actions">
          {row.allowFork && (
            <button
              type="button"
              className="timeline-row-action timeline-row-action--fork"
              onClick={() => onForkFromMessage(row.message.uuid)}
              disabled={row.forkingMessageId === row.message.uuid}
            >
              {row.forkingMessageId === row.message.uuid ? 'FORKING…' : 'FORK HERE'}
            </button>
          )}
          {row.allowResume && (
            <button
              type="button"
              className={`timeline-row-action timeline-row-action--resume${row.resumeFromMessageId === row.message.uuid ? ' timeline-row-action--resume-active' : ''}`}
              onClick={() => onToggleResume(row.message.uuid)}
            >
              {row.resumeFromMessageId === row.message.uuid ? 'RESUME TARGET' : 'RESUME HERE'}
            </button>
          )}
        </div>
      )}
      <MessageItem message={row.message} showSession={row.showSession} />
    </div>
  )
})

const VirtualTimelineRow = memo(function VirtualTimelineRow({
  row,
  top,
  isLast,
  onMeasure,
  onLastRowRef,
  onForkFromMessage,
  onToggleResume,
}: {
  row: TimelineRow
  top: number
  isLast: boolean
  onMeasure: (key: string, height: number) => void
  onLastRowRef: (node: HTMLDivElement | null) => void
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = rowRef.current
    if (!node) return

    const measure = () => onMeasure(row.key, node.offsetHeight)
    measure()

    const observer = new ResizeObserver(() => measure())
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
        top,
        left: 0,
        right: 0,
      }}
    >
      <TimelineMessageRow row={row} onForkFromMessage={onForkFromMessage} onToggleResume={onToggleResume} />
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
}: Props) {
  const [inputText, setInputText] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<SessionModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffort] = useState<'auto' | ReasoningEffortLevel>('auto')
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
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
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
  const liveToolIndexesRef = useRef<Map<number, string>>(new Map())
  const rowHeightsRef = useRef<Map<string, number>>(new Map())
  const rowLayoutRef = useRef<TimelineRowLayout>(buildTimelineRowLayout([], new Map()))
  const threadedCacheRef = useRef<Map<string, ThreadedMessage>>(new Map())
  const prevThreadingRef = useRef<IncrementalThreadingCache | null>(null)
  const pendingRowMeasurementsRef = useRef<Map<string, number>>(new Map())
  const measurementFrameRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
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
  const effortOptions = useMemo<ReasoningEffortLevel[]>(() => {
    if (!selectedModelInfo?.supportsEffort) return []
    if (activeProvider === 'codex' || activeProvider === 'opencode') return []
    const levels = selectedModelInfo.supportedEffortLevels?.filter((level) => {
      if (activeProvider === 'copilot') return level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh'
      if (activeProvider === 'claude') return level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh' || level === 'max'
      if (activeProvider === 'pi') return level === 'off' || level === 'minimal' || level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh'
      return false
    }) ?? []
    if (levels.length > 0) return levels
    if (activeProvider === 'pi') return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    return ['low', 'medium', 'high']
  }, [activeProvider, selectedModelInfo])
  const composerDraftKey = useMemo(() => composerDraftStorageKey(session), [session])

  useEffect(() => {
    inputTextRef.current = inputText
  }, [inputText])

  useEffect(() => {
    awaitingPersistedTurnRef.current = awaitingPersistedTurn
  }, [awaitingPersistedTurn])

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
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`
  }, [])

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

  useEffect(() => {
    if (!session) {
      setAvailableModels([])
      setSelectedModel('')
      setSelectedEffort('auto')
      return
    }

    fetch(withProviderQuery(`/api/sessions/${session.sessionId}/models`, session.provider))
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        const nextModels = Array.isArray(data.models) ? data.models.filter((model: SessionModelInfo) => normalizeSelectValue(model.value)) : []
        setAvailableModels(nextModels)
        setSelectedModel(
          normalizeSelectValue(data.currentModel)
          ?? normalizeSelectValue(nextModels[0]?.value)
          ?? ''
        )
      })
      .catch(() => {})
  }, [session?.provider, session?.sessionId])

  useEffect(() => {
    if (selectedEffort === 'auto') return
    if (!effortOptions.includes(selectedEffort)) {
      setSelectedEffort('auto')
    }
  }, [effortOptions, selectedEffort])

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
    setPendingPermissions([])
    setOptimisticUserText(null)
    setLiveAssistantText('')
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
    setRowMeasurementVersion(0)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    initialScrollDoneRef.current = false
  }, [session?.sessionId])

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
  }, [showDiagnostics, session?.sessionId])

  useEffect(() => {
    if (!rewindPreview || rewindPreview.userMessageId === rewindTargetId) return
    setRewindPreview(null)
  }, [rewindPreview, rewindTargetId])

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = timelineRef.current
    if (!node) return
    const targetTop = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
    setTimelineScrollTop(targetTop)
    suppressFollowEvalUntilRef.current = performance.now() + 200
    node.scrollTo({ top: targetTop, behavior })
  }, [])

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
    node.scrollTop = targetTop
    setTimelineScrollTop(targetTop)
  }, [])

  const handleTimelineScroll = useCallback(() => {
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      const node = timelineRef.current
      if (!node) return
      setTimelineScrollTop(node.scrollTop)
      if (performance.now() < suppressFollowEvalUntilRef.current) return
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setAutoFollow(distanceFromBottom <= TIMELINE_BOTTOM_GUTTER_PX + 16)
    })
  }, [])

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
      node.scrollTop = targetTop
      setTimelineScrollTop(targetTop)
    }
    return true
  }, [])

  useEffect(() => {
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

    if (persistedTurnArrived) {
      setOptimisticUserText(null)
      setLiveAssistantText('')
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
  }, [autoFollow, awaitingPersistedTurn, messages, scrollTimelineToBottom, session])

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
    setLiveAssistantText('')
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setAwaitingPersistedTurn(false)
    pendingMessageBaselineRef.current = null
    liveToolIndexesRef.current.clear()
    textareaRef.current?.focus()
  }, [optimisticUserText, session])

  const sendMessage = useCallback(async () => {
    if (!session || sendInFlightRef.current || awaitingPersistedTurnRef.current) return

    const text = (textareaRef.current?.value ?? inputTextRef.current).trim()
    if (!text) return

    sendInFlightRef.current = true
    const sendAttachments = attachments
    const effort = selectedEffort === 'auto' ? undefined : selectedEffort
    setInputText('')
    inputTextRef.current = ''
    setSendState('sending')
    setSendError(null)
    setFailedSend(null)
    setOptimisticUserText(text)
    setLiveAssistantText('')
    setLiveToolActivities([])
    setLiveThreadedMessages([])
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
          model: selectedModel,
          effort,
          attachments: sendAttachments,
          resumeSessionAt: resumeFromMessageId ?? undefined,
          forkSession: Boolean(resumeFromMessageId),
          provider: session.provider,
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

          try {
            const parsed = JSON.parse(frame.data)
            const pendingPermission = extractOpenCodePermission(parsed)
            if (pendingPermission) {
              setPendingPermissions((prev) => [
                ...prev.filter((permission) => permission.id !== pendingPermission.id),
                pendingPermission,
              ])
            }
            const repliedPermissionId = extractOpenCodePermissionReply(parsed)
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
              if (session.provider === 'claude') {
                setLiveAssistantText((prev) => {
                  const nextText = shouldReplaceLiveAssistantText(parsed)
                    ? deltaText
                    : `${prev}${deltaText}`
                  setLiveThreadedMessages((prevMessages) => upsertThreadedMessage(prevMessages, {
                    role: 'assistant',
                    uuid: 'live-assistant',
                    sessionId: session.sessionId,
                    provider: session.provider,
                    blocks: [{ type: 'text', text: nextText }],
                  }))
                  return nextText
                })
              } else {
                setLiveAssistantText((prev) =>
                  shouldReplaceLiveAssistantText(parsed)
                    ? deltaText
                    : `${prev}${deltaText}`
                )
              }
            }

            if (session.provider === 'claude') {
              const threaded = normalizeClaudeStreamThreadedMessage(parsed)
              if (threaded) {
                setLiveThreadedMessages((prev) => upsertThreadedMessage(prev, threaded))
              }
            } else if (session.provider === 'codex') {
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

      setSendState('idle')
      setAttachments([])
      if (session.provider === 'claude') {
        setLiveThreadedMessages((prev) => prev.length > 0
          ? prev
          : [{
              role: 'assistant',
              uuid: 'live-assistant',
              sessionId: session.sessionId,
              provider: session.provider,
              blocks: [{ type: 'text', text: 'Waiting for saved response…' }],
            }])
      }
      awaitingPersistedTurnRef.current = true
      setAwaitingPersistedTurn(true)
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
      setLiveAssistantText('')
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
  }, [attachments, messages, onFork, resizeComposer, resumeFromMessageId, selectedEffort, selectedModel, session])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (e.metaKey || e.ctrlKey || !e.altKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

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
      },
    ])
    setAttachmentPath('')
  }, [attachmentPath, attachmentType])

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
    threadedCacheRef.current = new Map(stabilized.map((message) => [threadedMessageKey(message), message]))
    prevThreadingRef.current = { messages, threaded: stabilized }
    return stabilized
  }, [messages])
  const threaded = useMemo(
    () => (showTools ? threadedFull : stripToolCallBlocks(threadedFull)),
    [threadedFull, showTools],
  )
  const isProject = !!projectView
  const dirName  = projectView?.key ?? (pathBasename(session?.cwd) || session?.sessionId) ?? ''
  const activeToolCount = liveToolActivities.filter((activity) => activity.status === 'running').length
  const sendBusy = sendState === 'sending' || awaitingPersistedTurn
  const canSubmitMessage = Boolean(session && inputText.trim() && !sendBusy)
  const composerStatus = sendState === 'error'
    ? 'Failed'
    : sendState === 'sending'
    ? 'Sending...'
    : awaitingPersistedTurn
    ? 'Waiting for saved response...'
    : 'Ready'
  const composerStatusColor = sendState === 'error'
    ? 'var(--red, #f87171)'
    : sendState === 'sending' || awaitingPersistedTurn
    ? 'var(--cyan)'
    : 'var(--text-3)'
  const liveUserMessage = useMemo<ThreadedMessage | null>(() => (!isProject && optimisticUserText
    ? {
        role: 'user',
        uuid: 'live-user',
        sessionId: session?.sessionId,
        provider: session?.provider,
        blocks: [{ type: 'text', text: optimisticUserText }],
      }
    : null), [isProject, optimisticUserText, session?.provider, session?.sessionId])
  const liveAssistantMessage = useMemo<ThreadedMessage | null>(() => (!isProject && session?.provider !== 'claude' && (sendState === 'sending' || awaitingPersistedTurn)
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
      isProject,
      liveAssistantText,
      sendState,
      session?.provider,
      session?.sessionId,
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
  const persistedTimelineRows = useMemo<TimelineRow[]>(() =>
    threaded.map((msg) => ({
      key: `persisted:${threadedMessageKey(msg)}`,
      message: msg,
      showSession: isProject,
      showForkControls: !isProject && (sessionCapabilities?.messageFork || (msg.role === 'assistant' && sessionCapabilities?.resumeAtMessage)),
      allowFork: !!sessionCapabilities?.messageFork,
      allowResume: msg.role === 'assistant' && !!sessionCapabilities?.resumeAtMessage,
      highlighted: highlightedMessageId === msg.uuid,
      forkingMessageId,
      resumeFromMessageId,
    }))
  , [
    forkingMessageId,
    highlightedMessageId,
    isProject,
    resumeFromMessageId,
    sessionCapabilities?.messageFork,
    sessionCapabilities?.resumeAtMessage,
    threaded,
  ])

  const liveThreadedVisible = useMemo(
    () => (showTools ? liveThreadedMessages : stripToolCallBlocks(liveThreadedMessages)),
    [liveThreadedMessages, showTools],
  )
  const liveTimelineRows = useMemo<TimelineRow[]>(() => {
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
        previewBadge: awaitingPersistedTurn ? 'SYNCING TO LOG' : 'LIVE PREVIEW',
        liveToolActivities: session?.provider !== 'claude' ? liveToolActivities : undefined,
      })
    }

    liveThreadedVisible.forEach((msg, index) => {
      rows.push({
        key: `live:threaded:${msg.provider ?? 'claude'}:${msg.uuid}`,
        message: msg,
        showSession: false,
        dimmed: true,
        previewBadge: index === 0 ? (awaitingPersistedTurn ? 'SYNCING TO LOG' : 'LIVE PREVIEW') : undefined,
      })
    })

    return rows
  }, [
    awaitingPersistedTurn,
    liveAssistantMessage,
    liveToolActivities,
    liveThreadedVisible,
    liveUserMessage,
    session?.provider,
  ])
  const timelineRows = useMemo<TimelineRow[]>(() => {
    if (persistedTimelineRows.length === 0) return liveTimelineRows
    if (liveTimelineRows.length === 0) return persistedTimelineRows
    return [...persistedTimelineRows, ...liveTimelineRows]
  }, [liveTimelineRows, persistedTimelineRows])
  const timelineTargetMessageId = useMemo(
    () => resolveTimelineTargetMessageId(targetMessageId, messages, timelineRows),
    [messages, targetMessageId, timelineRows],
  )
  const hasLiveTimeline = timelineRows.length > 0

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
  }, [alignLastTimelineRowToViewportBottom, hasLiveTimeline, loading, messages.length, scrollTimelineToBottom, session?.sessionId, targetMessageId])

  useEffect(() => {
    timelineRowsRef.current = timelineRows
  }, [timelineRows])

  useEffect(() => {
    const activeKeys = new Set(timelineRows.map((row) => row.key))
    let changed = false
    for (const key of rowHeightsRef.current.keys()) {
      if (activeKeys.has(key)) continue
      rowHeightsRef.current.delete(key)
      changed = true
    }
    if (changed) setRowMeasurementVersion((version) => version + 1)
  }, [timelineRows])

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
      const isFollowing = autoFollowRef.current
      let scrollDelta = 0
      let changed = false

      for (const [key, nextMeasuredHeight] of pending) {
        const index = layout.indexByKey.get(key)
        if (index == null) continue
        const row = timelineRowsRef.current[index]
        if (!row) continue
        const previousHeight = rowHeightsRef.current.get(key) ?? estimateTimelineRowHeight(row)
        if (nextMeasuredHeight === previousHeight) continue

        rowHeightsRef.current.set(key, nextMeasuredHeight)
        changed = true
        if (!isFollowing && node && layout.tops[index] < node.scrollTop) {
          scrollDelta += nextMeasuredHeight - previousHeight
        }
      }

      pending.clear()

      if (node && !isFollowing && scrollDelta !== 0) {
        suppressFollowEvalUntilRef.current = performance.now() + 200
        node.scrollTop += scrollDelta
        setTimelineScrollTop(node.scrollTop)
      }

      if (changed) {
        setRowMeasurementVersion((version) => version + 1)
      }
    })
  }, [])

  useLayoutEffect(() => {
    if (!autoFollow || !hasLiveTimeline || loading) return
    scrollTimelineToBottom()
    alignLastTimelineRowToViewportBottom()
  }, [alignLastTimelineRowToViewportBottom, autoFollow, hasLiveTimeline, loading, rowMeasurementVersion, scrollTimelineToBottom, timelineRows.length])

  // Separate the expensive O(n) height accumulation from the scroll-reactive
  // visibility window. rowLayout only recomputes when rows or measurements
  // change; virtualTimeline re-runs on every scroll but only does a scan of
  // the visible window — no new objects for off-screen rows.
  const rowLayout = useMemo(() => {
    return buildTimelineRowLayout(timelineRows, rowHeightsRef.current)
  }, [timelineRows, rowMeasurementVersion])
  rowLayoutRef.current = rowLayout

  useLayoutEffect(() => {
    if (!timelineTargetMessageId || loading) return
    if (targetMessageRequestId && handledTargetMessageRequestRef.current === targetMessageRequestId) return
    const node = timelineRef.current
    if (!node) return

    const rowIndex = timelineRows.findIndex((row) => row.message.uuid === timelineTargetMessageId)
    if (rowIndex < 0) return

    handledTargetMessageRequestRef.current = targetMessageRequestId
    const targetTop = Math.max(rowLayout.tops[rowIndex] - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
    suppressFollowEvalUntilRef.current = performance.now() + 300
    autoFollowRef.current = false
    setAutoFollow(false)
    setTimelineScrollTop(targetTop)
    node.scrollTop = targetTop
    setHighlightedMessageId(timelineTargetMessageId)
  }, [loading, rowLayout, targetMessageRequestId, timelineRows, timelineTargetMessageId])

  useEffect(() => {
    if (!highlightedMessageId) return
    const timeout = window.setTimeout(() => {
      setHighlightedMessageId((current) => current === highlightedMessageId ? null : current)
    }, 3500)
    return () => window.clearTimeout(timeout)
  }, [highlightedMessageId])

  const virtualTimeline = useMemo(() => {
    const { tops, heights, totalHeight } = rowLayout
    const n = timelineRows.length
    const viewportHeight = timelineViewportHeight || 800
    const rangeStart = Math.max(0, timelineScrollTop - TIMELINE_OVERSCAN_PX)
    const rangeEnd = timelineScrollTop + viewportHeight + TIMELINE_OVERSCAN_PX

    let startIndex = Math.max(0, upperBound(tops, n, rangeStart) - 1)
    while (startIndex > 0 && tops[startIndex - 1] + heights[startIndex - 1] >= rangeStart) {
      startIndex -= 1
    }
    let endIndex = upperBound(tops, n, rangeEnd)
    endIndex = Math.max(endIndex, startIndex + 1)

    const visibleRows: Array<{ row: TimelineRow; top: number; height: number }> = []
    for (let i = startIndex; i < Math.min(endIndex, n); i++) {
      visibleRows.push({ row: timelineRows[i], top: tops[i], height: heights[i] })
    }

    return { totalHeight, visibleRows }
  }, [rowLayout, timelineRows, timelineScrollTop, timelineViewportHeight])

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
    const node = timelineRef.current
    const content = timelineContentRef.current
    if (!node || !content) return
    const pin = () => {
      if (!autoFollowRef.current) return
      const target = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
      if (Math.abs(node.scrollTop - target) < 1) return
      suppressFollowEvalUntilRef.current = performance.now() + 200
      node.scrollTop = target
      setTimelineScrollTop(target)
    }
    const observer = new ResizeObserver(() => pin())
    observer.observe(content)
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasLiveTimeline, session?.sessionId])

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

      {/* ── Timeline feed ────────────────────────────── */}
      <div
        ref={timelineRef}
        onScroll={handleTimelineScroll}
        style={{
          flex: 1,
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
            <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
              Session Diagnostics
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
                      {section.items.map((item, index) => (
                        <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)' }}>
                          {item}
                        </div>
                      ))}
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
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No messages.</div>
        )}
        {!loading && hasLiveTimeline && (
          <div style={{ position: 'relative' }}>
            <div
              className="timeline-line"
              style={{
                position: 'absolute',
                left: 9,
                top: 10,
                height: Math.max(virtualTimeline.totalHeight - 10, 0),
                width: 2,
                borderRadius: 999,
                background: 'linear-gradient(to bottom, color-mix(in srgb, var(--border-2) 92%, var(--text-2)) 0%, var(--border-2) 70%, transparent 100%)',
                boxShadow: '0 0 0 1px color-mix(in srgb, var(--bg) 72%, transparent), 0 0 10px color-mix(in srgb, var(--border-2) 38%, transparent)',
                pointerEvents: 'none',
              }}
            />
            <div
              ref={timelineContentRef}
              style={{ position: 'relative', minHeight: virtualTimeline.totalHeight, height: virtualTimeline.totalHeight }}
            >
              <MessageDensityProvider density={density}>
                {(() => {
                  const lastRowKey = timelineRows.at(-1)?.key
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
                    />
                  ))
                })()}
              </MessageDensityProvider>
            </div>
          </div>
        )}
        {hasLiveTimeline && (
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
        style={{
          padding: '8px 16px 10px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <button
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
                  onChange={(event) => setSelectedModel(event.target.value)}
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
                    {(['once', 'always', 'reject'] as const).map((response) => (
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
                placeholder="Attach path or URL"
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
              {attachments.map((attachment, index) => (
                <button
                  key={attachment.id ?? `${attachment.type}-${index}`}
                  type="button"
                  onClick={() => removeAttachment(attachment.id, index)}
                  disabled={sendBusy}
                  title={attachment.path ?? attachment.filePath ?? attachmentDisplayName(attachment)}
                  style={{
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
                  {attachment.type.toUpperCase()} {attachmentDisplayName(attachment)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => {
                  setInputText(e.target.value)
                  if (sendError && !failedSend) {
                    setSendError(null)
                    setSendState('idle')
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder={sendBusy
                  ? 'Draft your next message…'
                  : activeToolCount > 0
                  ? `${assistantName} is using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…`
                  : `Message ${assistantName}…`}
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
                  overflow: 'hidden',
                  transition: 'border-color 0.15s, opacity 0.15s',
                }}
              />
              {sendState === 'sending' ? (
                <Button
                  type="button"
                  onClick={cancelSend}
                  variant="outline"
                  aria-label="Cancel send"
                  title="Cancel send"
                  style={{
                    flexShrink: 0,
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
              ) : (
                <Button
                  type="button"
                  onClick={sendMessage}
                  disabled={!canSubmitMessage}
                  aria-label={awaitingPersistedTurn ? 'Waiting for turn to finish' : 'Send message'}
                  title={awaitingPersistedTurn ? 'Waiting for turn to finish' : 'Send message'}
                  style={{
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    padding: 0,
                    background: 'rgba(139,128,240,0.18)',
                    border: '1px solid rgba(139,128,240,0.3)',
                    borderRadius: 6,
                    color: 'var(--violet)',
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
              }}
            >
              {composerStatus}
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
      <AnalyticsPopover
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        input={{ info: sessionInfo, threadedMessages: threadedFull, rawMessages: messages }}
      />
    </div>
  )
}
