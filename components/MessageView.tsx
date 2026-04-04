'use client'

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import type {
  SessionMessage,
  Session,
  SendState,
  ContextUsage,
  SessionInfo,
  SessionModelInfo,
  SessionDiagnosticSection,
  ToolUseBlock,
  ContentBlock,
} from '@/lib/types'
import { buildThreadedMessages, buildThreadedMessagesIncremental, type IncrementalThreadingCache, type ThreadedMessage, type ThreadedBlock } from '@/lib/threading'
import { exportSessionToHtml, downloadHtml } from '@/lib/export'
import { pathBasename } from '@/lib/projectPaths'
import { getPrimarySessionTag } from '@/lib/sessionTags'
import { extractClaudeStreamToolUse, normalizeClaudeStreamThreadedMessage } from '@/lib/claudeMapper'
import { normalizeCodexStreamThreadedMessage } from '@/lib/codexMapper'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import MessageItem from './MessageItem'
import CodeThemeToggle from './CodeThemeToggle'

type Props = {
  messages: SessionMessage[]
  loading: boolean
  session: Session | null
  projectView?: { key: string; sessionCount: number; providerMode: 'current' | 'all' }
  onFork?: (newSessionId: string) => void
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
  forkingMessageId?: string | null
  resumeFromMessageId?: string | null
}

const ESTIMATED_TIMELINE_ROW_HEIGHT = 220
const TIMELINE_OVERSCAN_PX = 1200
const ESTIMATED_CHARS_PER_LINE = 92
const TIMELINE_BOTTOM_GUTTER_PX = 72

function normalizeSelectValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
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

function TimelineMessageRow({
  row,
  onForkFromMessage,
  onToggleResume,
}: {
  row: TimelineRow
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
}) {
  return (
    <div style={{ opacity: row.dimmed ? 0.92 : 1 }}>
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
      {row.showForkControls && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '0 0 8px 0' }}>
          {row.allowFork && (
            <Button
              onClick={() => onForkFromMessage(row.message.uuid)}
              disabled={row.forkingMessageId === row.message.uuid}
              variant="outline"
              size="sm"
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 4,
                border: '1px solid rgba(139,128,240,0.18)',
                background: 'rgba(139,128,240,0.07)',
                color: 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.06em',
                cursor: row.forkingMessageId === row.message.uuid ? 'not-allowed' : 'pointer',
                opacity: row.forkingMessageId === row.message.uuid ? 0.5 : 1,
              }}
            >
              {row.forkingMessageId === row.message.uuid ? 'FORKING…' : 'FORK HERE'}
            </Button>
          )}
          {row.allowResume && (
            <Button
              onClick={() => onToggleResume(row.message.uuid)}
              variant="outline"
              size="sm"
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 4,
                border: `1px solid ${row.resumeFromMessageId === row.message.uuid ? 'rgba(56,217,245,0.35)' : 'rgba(56,217,245,0.18)'}`,
                background: row.resumeFromMessageId === row.message.uuid ? 'rgba(56,217,245,0.14)' : 'rgba(56,217,245,0.07)',
                color: row.resumeFromMessageId === row.message.uuid ? 'var(--cyan)' : 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.06em',
                cursor: 'pointer',
              }}
            >
              {row.resumeFromMessageId === row.message.uuid ? 'RESUME TARGET' : 'RESUME HERE'}
            </Button>
          )}
        </div>
      )}
      <MessageItem message={row.message} showSession={row.showSession} />
    </div>
  )
}

function VirtualTimelineRow({
  row,
  top,
  onMeasure,
  onRowRef,
  onForkFromMessage,
  onToggleResume,
}: {
  row: TimelineRow
  top: number
  onMeasure: (key: string, height: number) => void
  onRowRef?: (node: HTMLDivElement | null) => void
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
    onRowRef?.(rowRef.current)
    return () => onRowRef?.(null)
  }, [onRowRef, row.key])

  return (
    <div
      ref={rowRef}
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
}

export default function MessageView({ messages, loading, session, projectView, onFork }: Props) {
  const [inputText, setInputText] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [availableModels, setAvailableModels] = useState<SessionModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('')
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
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticSections, setDiagnosticSections] = useState<SessionDiagnosticSection[]>([])
  const [exporting, setExporting] = useState(false)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionActionNotice, setSessionActionNotice] = useState<string | null>(null)
  const [optimisticUserText, setOptimisticUserText] = useState<string | null>(null)
  const [liveAssistantText, setLiveAssistantText] = useState('')
  const [liveToolActivities, setLiveToolActivities] = useState<LiveToolActivity[]>([])
  const [liveThreadedMessages, setLiveThreadedMessages] = useState<ThreadedMessage[]>([])
  const [awaitingPersistedTurn, setAwaitingPersistedTurn] = useState(false)
  const [autoFollow, setAutoFollow] = useState(false)
  const [timelineScrollTop, setTimelineScrollTop] = useState(0)
  const [timelineViewportHeight, setTimelineViewportHeight] = useState(0)
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const lastTimelineRowRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingMessageBaselineRef = useRef<{ count: number; lastUuid: string | null; lastFingerprint: string | null; sessionId: string } | null>(null)
  const liveToolIndexesRef = useRef<Map<number, string>>(new Map())
  const rowHeightsRef = useRef<Map<string, number>>(new Map())
  const threadedCacheRef = useRef<Map<string, ThreadedMessage>>(new Map())
  const prevThreadingRef = useRef<IncrementalThreadingCache | null>(null)
  const pendingRowMeasurementsRef = useRef<Map<string, number>>(new Map())
  const measurementFrameRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const timelineRowsRef = useRef<TimelineRow[]>([])
  const initialScrollDoneRef = useRef(false)
  const sessionCapabilities = sessionInfo?.capabilities ?? session?.capabilities
  const assistantName = assistantDisplayName(sessionInfo?.provider ?? session?.provider)
  const modelOptions = useMemo(() => {
    const filtered = availableModels.filter((model) => normalizeSelectValue(model.value))
    if (filtered.length > 0) return filtered

    const fallbackValue = normalizeSelectValue(selectedModel)
    return fallbackValue ? [{ value: fallbackValue, displayName: fallbackValue, description: '' }] : []
  }, [availableModels, selectedModel])
  const selectedModelValue = normalizeSelectValue(selectedModel)

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

  // Reset context usage when switching sessions
  useEffect(() => {
    setContextUsage(null)
    setSessionActionError(null)
    setSessionActionNotice(null)
    setResumeFromMessageId(null)
    setRewindPreview(null)
    setRollbackPreview(null)
    setShowDiagnostics(false)
    setDiagnosticSections([])
    setOptimisticUserText(null)
    setLiveAssistantText('')
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setAwaitingPersistedTurn(false)
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
    node.scrollTo({ top: targetTop, behavior })
  }, [])

  const alignLastTimelineRowToViewportBottom = useCallback(() => {
    const node = timelineRef.current
    const lastRow = lastTimelineRowRef.current
    if (!node || !lastRow) return
    const nodeRect = node.getBoundingClientRect()
    const rowRect = lastRow.getBoundingClientRect()
    const targetTop = Math.max(node.scrollTop + (rowRect.bottom - nodeRect.bottom), 0)
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
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setAutoFollow(distanceFromBottom < 72)
    })
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
    if (!session || !inputText.trim() || sendState === 'sending') return

    const text = inputText.trim()
    setInputText('')
    setSendState('sending')
    setSendError(null)
    setOptimisticUserText(text)
    setLiveAssistantText('')
    setLiveToolActivities([])
    setLiveThreadedMessages([])
    setAwaitingPersistedTurn(false)
    setAutoFollow(true)
    pendingMessageBaselineRef.current = {
      count: messages.length,
      lastUuid: messages.at(-1)?.uuid ?? null,
      lastFingerprint: sessionMessageFingerprint(messages.at(-1)),
      sessionId: session.sessionId,
    }
    liveToolIndexesRef.current.clear()

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          model: selectedModel,
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

      const reader = res.body!.getReader()
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
      setInputText(text)
      setOptimisticUserText(null)
      setLiveAssistantText('')
      setLiveToolActivities([])
      setLiveThreadedMessages([])
      setAwaitingPersistedTurn(false)
      pendingMessageBaselineRef.current = null
      liveToolIndexesRef.current.clear()
    } finally {
      abortControllerRef.current = null
    }
  }, [inputText, messages, onFork, resumeFromMessageId, selectedModel, sendState, session])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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

  const threaded = useMemo(() => {
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
  const isProject = !!projectView
  const dirName  = projectView?.key ?? (pathBasename(session?.cwd) || session?.sessionId) ?? ''
  const activeToolCount = liveToolActivities.filter((activity) => activity.status === 'running').length
  const liveUserMessage: ThreadedMessage | null = !isProject && optimisticUserText
    ? {
        role: 'user',
        uuid: 'live-user',
        sessionId: session?.sessionId,
        provider: session?.provider,
        blocks: [{ type: 'text', text: optimisticUserText }],
      }
    : null
  const liveAssistantMessage: ThreadedMessage | null = !isProject && session?.provider !== 'claude' && (sendState === 'sending' || awaitingPersistedTurn)
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
    : null
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
  const timelineRows = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = threaded.map((msg) => ({
      key: `persisted:${threadedMessageKey(msg)}`,
      message: msg,
      showSession: isProject,
      showForkControls: !isProject && (sessionCapabilities?.messageFork || (msg.role === 'assistant' && sessionCapabilities?.resumeAtMessage)),
      allowFork: !!sessionCapabilities?.messageFork,
      allowResume: msg.role === 'assistant' && !!sessionCapabilities?.resumeAtMessage,
      forkingMessageId,
      resumeFromMessageId,
    }))

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

    liveThreadedMessages.forEach((msg, index) => {
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
    forkingMessageId,
    isProject,
    liveAssistantMessage,
    liveThreadedMessages,
    liveToolActivities,
    liveUserMessage,
    resumeFromMessageId,
    session?.provider,
    sessionCapabilities?.messageFork,
    sessionCapabilities?.resumeAtMessage,
    threaded,
  ])
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

    initialScrollDoneRef.current = true
    setAutoFollow(true)

    const node = timelineRef.current
    if (node) {
      const targetTop = Math.max(node.scrollHeight - node.clientHeight - TIMELINE_BOTTOM_GUTTER_PX, 0)
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
  }, [alignLastTimelineRowToViewportBottom, hasLiveTimeline, loading, messages.length, scrollTimelineToBottom, session?.sessionId])

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

  const handleTimelineRowMeasure = useCallback((key: string, height: number) => {
    const nextHeight = Math.max(1, Math.ceil(height))
    pendingRowMeasurementsRef.current.set(key, nextHeight)
    if (measurementFrameRef.current != null) return

    measurementFrameRef.current = window.requestAnimationFrame(() => {
      measurementFrameRef.current = null
      const pending = pendingRowMeasurementsRef.current
      if (pending.size === 0) return

      const node = timelineRef.current
      let offset = 0
      let scrollDelta = 0
      let changed = false

      for (const row of timelineRowsRef.current) {
        const previousHeight = rowHeightsRef.current.get(row.key) ?? estimateTimelineRowHeight(row)
        const nextMeasuredHeight = pending.get(row.key)
        const nextHeightForLayout = nextMeasuredHeight ?? previousHeight

        if (nextMeasuredHeight != null && nextMeasuredHeight !== previousHeight) {
          rowHeightsRef.current.set(row.key, nextMeasuredHeight)
          changed = true
          if (node && offset < node.scrollTop) {
            scrollDelta += nextMeasuredHeight - previousHeight
          }
        }

        offset += nextHeightForLayout
      }

      pending.clear()

      if (node && scrollDelta !== 0) {
        node.scrollTop += scrollDelta
        setTimelineScrollTop(node.scrollTop)
      }

      if (changed) {
        setRowMeasurementVersion((version) => version + 1)
      }
    })
  }, [])

  const virtualTimeline = useMemo(() => {
    let offset = 0
    const measuredRows = timelineRows.map((row) => {
      const height = rowHeightsRef.current.get(row.key) ?? estimateTimelineRowHeight(row)
      const top = offset
      offset += height
      return { row, top, height }
    })

    const viewportHeight = timelineViewportHeight || 800
    const rangeStart = Math.max(0, timelineScrollTop - TIMELINE_OVERSCAN_PX)
    const rangeEnd = timelineScrollTop + viewportHeight + TIMELINE_OVERSCAN_PX

    let startIndex = 0
    while (startIndex < measuredRows.length && measuredRows[startIndex].top + measuredRows[startIndex].height < rangeStart) {
      startIndex += 1
    }

    let endIndex = startIndex
    while (endIndex < measuredRows.length && measuredRows[endIndex].top < rangeEnd) {
      endIndex += 1
    }

    return {
      totalHeight: offset,
      visibleRows: measuredRows.slice(startIndex, Math.max(endIndex, startIndex + 1)),
    }
  }, [timelineRows, timelineScrollTop, timelineViewportHeight, rowMeasurementVersion])

  useEffect(() => {
    if (!autoFollow) return
    const frame = window.requestAnimationFrame(() => scrollTimelineToBottom())
    return () => window.cancelAnimationFrame(frame)
  }, [
    autoFollow,
    loading,
    virtualTimeline.totalHeight,
    scrollTimelineToBottom,
  ])

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

        {/* Export button (single session only) */}
        {!isProject && (
          <Button
            onClick={handleExport}
            disabled={exporting}
            title="Export session to HTML"
            variant="outline"
            size="sm"
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

        {!isProject && (
          <Button
            onClick={toggleDiagnostics}
            title="Show session diagnostics"
            variant="outline"
            size="sm"
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
      </div>

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
                width: 1,
                background: 'linear-gradient(to bottom, var(--border-2) 0%, var(--border) 60%, transparent 100%)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ position: 'relative', minHeight: virtualTimeline.totalHeight, height: virtualTimeline.totalHeight }}>
              {virtualTimeline.visibleRows.map(({ row, top }) => (
                <VirtualTimelineRow
                  key={row.key}
                  row={row}
                  top={top}
                  onMeasure={handleTimelineRowMeasure}
                  onRowRef={row.key === timelineRows.at(-1)?.key ? (node) => { lastTimelineRowRef.current = node } : undefined}
                  onForkFromMessage={handleForkFromMessage}
                  onToggleResume={toggleResumeFromMessage}
                />
              ))}
            </div>
          </div>
        )}
        {!autoFollow && hasLiveTimeline && (
          <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button
              onClick={() => {
                setAutoFollow(true)
                scrollTimelineToBottom('smooth')
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
              JUMP TO LIVE
            </Button>
          </div>
        )}
      </div>

      {/* ── Message input (single session only) ──────── */}
      {!isProject && <div
        style={{
          padding: '8px 16px 10px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        {sendError && (
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--red, #f87171)',
            marginBottom: 8,
            letterSpacing: '0.03em',
          }}>
            {sendError}
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
                <Select value={selectedModelValue ?? ''} onValueChange={setSelectedModel}>
                  <SelectTrigger
                    style={{
                      height: 26,
                      minWidth: 0,
                      flex: 1,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 5,
                      color: 'var(--text)',
                      padding: '0 6px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                    }}
                  >
                    <SelectValue placeholder="Model" />
                  </SelectTrigger>
                  <SelectContent
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                    }}
                  >
                    {modelOptions.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {sessionCapabilities?.fileRewind && rewindCandidates.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 300px', minWidth: 220 }}>
                  <Select value={rewindTargetId} onValueChange={setRewindTargetId}>
                    <SelectTrigger
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: 26,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 5,
                        color: 'var(--text)',
                        padding: '0 8px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                      }}
                    >
                      <SelectValue placeholder="Rewind target" />
                    </SelectTrigger>
                    <SelectContent
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                      }}
                    >
                      {rewindCandidates.slice().reverse().map((candidate) => (
                        <SelectItem key={candidate.uuid} value={candidate.uuid}>
                          {candidate.content.replace(/\s+/g, ' ').trim().slice(0, 72) || candidate.uuid}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Select value={String(rollbackTurns)} onValueChange={(value) => setRollbackTurns(Number(value))}>
                    <SelectTrigger
                      style={{
                        height: 26,
                        minWidth: 0,
                        flex: 1,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 5,
                        color: 'var(--text)',
                        padding: '0 6px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                      }}
                    >
                      <SelectValue placeholder="Turns" />
                    </SelectTrigger>
                    <SelectContent
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                      }}
                    >
                      {Array.from({ length: Math.min(10, rollbackCandidates.length) }, (_, index) => index + 1).map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value} turn{value === 1 ? '' : 's'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => {
                  setInputText(e.target.value)
                  if (sendError) setSendError(null)
                  // Auto-resize
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 80)}px`
                }}
                onKeyDown={handleKeyDown}
                disabled={sendState === 'sending'}
                placeholder={activeToolCount > 0 ? `${assistantName} is using ${activeToolCount} tool${activeToolCount === 1 ? '' : 's'}…` : 'Send a message… (⌘↩ to send)'}
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
                  opacity: sendState === 'sending' ? 0.5 : 1,
                  transition: 'border-color 0.15s, opacity 0.15s',
                }}
              />
              {sendState === 'sending' ? (
                <Button
                  onClick={cancelSend}
                  variant="outline"
                  style={{
                    flexShrink: 0,
                    height: 32,
                    padding: '0 12px',
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
                  CANCEL
                </Button>
              ) : (
                <Button
                  onClick={sendMessage}
                  disabled={!inputText.trim()}
                  style={{
                    flexShrink: 0,
                    height: 32,
                    padding: '0 12px',
                    background: 'rgba(139,128,240,0.18)',
                    border: '1px solid rgba(139,128,240,0.3)',
                    borderRadius: 6,
                    color: 'var(--violet)',
                    fontFamily: "'Oxanium', monospace",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    cursor: !inputText.trim() ? 'not-allowed' : 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                    opacity: !inputText.trim() ? 0.55 : 1,
                  }}
                >
                  SEND
                </Button>
              )}
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
            <CardContent style={{ padding: '12px 14px' }}>
              <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 12, fontWeight: 600, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.08em' }}>
                Rewind Preview
              </div>
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
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
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
              </div>
            </CardContent>
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
            <CardContent style={{ padding: '12px 14px' }}>
              <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 12, fontWeight: 600, color: 'var(--yellow, #fbbf24)', letterSpacing: '0.08em' }}>
                Rollback Preview
              </div>
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
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
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
              </div>
            </CardContent>
          </Card>
        )}
      </div>}
    </div>
  )
}
