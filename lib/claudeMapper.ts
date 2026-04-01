import type {
  ApiMessage,
  ContentBlock,
  SessionMessage,
  SystemMessagePayload,
  ToolResultBlock,
  ToolUseBlock,
} from './types'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function messageContent(value: unknown): ApiMessage['content'] {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value as ContentBlock[]
  if (value == null) return ''
  return stringify(value)
}

function messageUsage(value: unknown): ApiMessage['usage'] | undefined {
  const record = asObject(value)
  if (typeof record.input_tokens !== 'number' || typeof record.output_tokens !== 'number') return undefined
  return {
    input_tokens: record.input_tokens,
    output_tokens: record.output_tokens,
    cache_read_input_tokens: typeof record.cache_read_input_tokens === 'number' ? record.cache_read_input_tokens : null,
    cache_creation_input_tokens: typeof record.cache_creation_input_tokens === 'number' ? record.cache_creation_input_tokens : null,
  }
}

function toolResultBlock(value: unknown): ToolResultBlock | null {
  const record = asObject(value)
  if (typeof record.tool_use_id !== 'string') return null

  const content = record.content
  return {
    type: 'tool_result',
    tool_use_id: record.tool_use_id,
    content: typeof content === 'string' || Array.isArray(content)
      ? content as string | ContentBlock[]
      : stringify(content),
    is_error: record.is_error === true || record.isError === true || undefined,
  }
}

function toolResultBlocks(value: unknown): ToolResultBlock[] {
  if (Array.isArray(value)) {
    return value
      .map(toolResultBlock)
      .filter((block): block is ToolResultBlock => Boolean(block))
  }

  const single = toolResultBlock(value)
  return single ? [single] : []
}

function hasToolResults(content: ApiMessage['content']): boolean {
  return Array.isArray(content) && content.some((block) => block.type === 'tool_result')
}

function appendToolResults(content: ApiMessage['content'], results: ToolResultBlock[]): ApiMessage['content'] {
  if (results.length === 0 || hasToolResults(content)) return content
  if (typeof content === 'string') {
    const blocks: ContentBlock[] = []
    if (content.trim()) blocks.push({ type: 'text', text: content })
    return [...blocks, ...results]
  }
  return [...content, ...results]
}

function normalizeApiMessage(type: 'user' | 'assistant', value: unknown, toolUseResult?: unknown): ApiMessage {
  const record = asObject(value)
  const content = appendToolResults(messageContent(record.content), toolResultBlocks(toolUseResult))
  return {
    role: type,
    content,
    usage: type === 'assistant' ? messageUsage(record.usage) : undefined,
  }
}

function normalizeSystemMessage(value: unknown, fallbackSubtype: string): SystemMessagePayload {
  const record = asObject(value)
  const subtype = typeof record.subtype === 'string' ? record.subtype : fallbackSubtype
  return {
    type: 'system',
    subtype,
    ...record,
  }
}

function normalizeTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function normalizeClaudeHistoryMessage(value: unknown): SessionMessage | null {
  const record = asObject(value)
  const type = record.type
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return null
  if (typeof record.uuid !== 'string' || typeof record.session_id !== 'string') return null
  const payload = asObject(record.message)

  return {
    type,
    uuid: record.uuid,
    session_id: record.session_id,
    parent_tool_use_id: null,
    provider: 'claude',
    timestamp: normalizeTimestamp(record.timestamp),
    message: type === 'system'
      ? normalizeSystemMessage(record.message, typeof payload.subtype === 'string' ? payload.subtype : 'system')
      : normalizeApiMessage(type, record.message, record.tool_use_result),
  }
}

export function normalizeClaudeHistoryMessages(messages: unknown[]): SessionMessage[] {
  return messages
    .map(normalizeClaudeHistoryMessage)
    .filter((message): message is SessionMessage => Boolean(message))
}

export function normalizeClaudeStreamMessage(value: unknown): SessionMessage | null {
  const record = asObject(value)
  if (typeof record.uuid !== 'string' || typeof record.session_id !== 'string') return null

  if (record.type === 'system') {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: new Date().toISOString(),
      message: normalizeSystemMessage(record, typeof record.subtype === 'string' ? record.subtype : 'system'),
    }
  }

  if (record.type === 'tool_progress') {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: new Date().toISOString(),
      message: {
        type: 'system',
        subtype: 'tool_progress',
        ...record,
        content: `Tool ${typeof record.tool_name === 'string' ? record.tool_name : 'tool'} running for ${typeof record.elapsed_time_seconds === 'number' ? record.elapsed_time_seconds : '?'}s`,
      },
    }
  }

  if (record.type === 'tool_use_summary') {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: new Date().toISOString(),
      message: {
        type: 'system',
        subtype: 'tool_use_summary',
        ...record,
        content: typeof record.summary === 'string' ? record.summary : 'Tool use summary',
      },
    }
  }

  if (record.type === 'result' && record.subtype !== 'success') {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: new Date().toISOString(),
      message: {
        type: 'system',
        subtype: 'result',
        ...record,
        content: Array.isArray(record.errors) ? record.errors.join('\n') : 'Claude run ended with an error',
        level: 'warning',
      },
    }
  }

  return null
}

export function extractClaudeStreamToolUse(value: unknown): ToolUseBlock | null {
  const record = asObject(value)
  if (record.type !== 'stream_event') return null

  const event = asObject(record.event)
  if (event.type !== 'content_block_start') return null
  const contentBlock = asObject(event.content_block)
  const blockType = typeof contentBlock.type === 'string' ? contentBlock.type : ''
  if (!['tool_use', 'server_tool_use', 'mcp_tool_use'].includes(blockType)) return null

  return {
    type: 'tool_use',
    id: typeof contentBlock.id === 'string'
      ? contentBlock.id
      : `${blockType}-${typeof event.index === 'number' ? event.index : 0}`,
    name: typeof contentBlock.name === 'string' ? contentBlock.name : 'tool',
    input: asObject(contentBlock.input),
  }
}
