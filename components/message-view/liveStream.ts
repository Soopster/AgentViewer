'use client'
import { extractClaudeStreamToolUse } from '../../lib/claudeMapper'
import { upsertComposerMessage } from '../../lib/composerTranscript'
import { isOpenCodeAssistantStreamEnvelope } from '../../lib/opencodeStreamEvents'
import type { ThreadedMessage } from '../../lib/threading'
import type { ToolUseBlock, Session, SessionInfo } from '../../lib/types'
import type { SseFrame } from './types'

export function extractSseFrames(buffer: string): { frames: SseFrame[]; remaining: string}  {
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
export function extractTextContent(content: unknown): string {
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
export function extractStreamingAssistantText(payload: unknown): string | null {
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

  if (record.type === 'lmstudio_delta') {
    return typeof record.delta === 'string' ? record.delta : null
  }

  if (record.type === 'opencode_event') {
    if (!isOpenCodeAssistantStreamEnvelope(record)) return null
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
export function extractStreamingReasoningText(payload: unknown): string | null {
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
    if (!isOpenCodeAssistantStreamEnvelope(record)) return null
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
export const upsertThreadedMessage = upsertComposerMessage
export function completeLiveToolThread(messages: ThreadedMessage[], key: string): ThreadedMessage[] {
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
export function updateLiveToolThreadInput(
  messages: ThreadedMessage[],
  key: string,
  input: Record<string, unknown>): ThreadedMessage[] {
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
function codexItemToolLabel(item: Record<string, unknown>): { label: string; detail?: string}  | null {
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
function opencodeToolLabel(item: Record<string, unknown>): { label: string; detail?: string}  | null {
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
function copilotToolLabel(event: Record<string, unknown>): { label: string; detail?: string}  | null {
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
export function extractLiveToolStart(payload: unknown): { index: number; key: string; label: string; detail?: string; toolUse?: ToolUseBlock}  | null {
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
    if (!isOpenCodeAssistantStreamEnvelope(record)) return null
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
export function extractLiveToolStopIndex(payload: unknown): number | null {
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
export function extractCompletedToolKey(payload: unknown): string | null {
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
    if (!isOpenCodeAssistantStreamEnvelope(record)) return null
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
export function assistantDisplayName(provider: Session['provider'] | SessionInfo['provider'] | undefined): string {
  if (provider === 'codex') return 'Codex'
  if (provider === 'opencode') return 'OpenCode'
  if (provider === 'copilot') return 'Copilot'
  if (provider === 'pi') return 'Pi'
  return 'Claude'
}
export function shouldReplaceLiveAssistantText(payload: unknown): boolean {
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
    if (!isOpenCodeAssistantStreamEnvelope(record)) return false
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
