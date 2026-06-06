import type {
  ApiMessage,
  ContentBlock,
  SessionMessage,
  SystemMessagePayload,
  ToolResultBlock,
  ToolUseBlock,
} from './types'
import type { ThreadedMessage } from './threading'

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

function normalizeClaudeEventAsSystem(record: Record<string, unknown>): SystemMessagePayload | null {
  if (record.type === 'rate_limit_event') {
    const info = asObject(record.rate_limit_info)
    const status = typeof info.status === 'string' ? info.status : 'unknown'
    const utilization = typeof info.utilization === 'number'
      ? ` · ${Math.round(info.utilization * 100)}%`
      : ''
    return {
      type: 'system',
      subtype: 'rate_limit_event',
      ...record,
      content: `Rate limit ${status}${utilization}`,
      level: status === 'rejected' ? 'warning' : undefined,
    }
  }

  if (record.type === 'prompt_suggestion') {
    return {
      type: 'system',
      subtype: 'prompt_suggestion',
      ...record,
      content: typeof record.suggestion === 'string' ? record.suggestion : 'Prompt suggestion',
    }
  }

  if (record.type === 'auth_status') {
    const output = Array.isArray(record.output)
      ? record.output.filter((entry): entry is string => typeof entry === 'string').join('\n')
      : ''
    return {
      type: 'system',
      subtype: 'auth_status',
      ...record,
      content: typeof record.error === 'string' ? record.error : output,
      level: typeof record.error === 'string' ? 'warning' : undefined,
    }
  }

  return null
}

function normalizeTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asOrigin(value: unknown): { kind: string } | undefined {
  const record = asObject(value)
  return typeof record.kind === 'string' ? { kind: record.kind } : undefined
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function normalizeClaudeHistoryMessage(value: unknown): SessionMessage | null {
  const record = asObject(value)
  const type = record.type
  if (typeof record.uuid !== 'string' || typeof record.session_id !== 'string') return null
  const eventPayload = normalizeClaudeEventAsSystem(record)
  if (eventPayload) {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: normalizeTimestamp(record.timestamp),
      origin: asOrigin(record.origin),
      message: eventPayload,
    }
  }
  if (type !== 'user' && type !== 'assistant' && type !== 'system') return null
  const payload = asObject(record.message)

  const taskDescription = type === 'user' ? readString(record, 'task_description', 'taskDescription') : undefined
  const requestId = type === 'assistant' ? readString(record, 'request_id', 'requestId') : undefined

  return {
    type,
    uuid: record.uuid,
    session_id: record.session_id,
    parent_tool_use_id: null,
    provider: 'claude',
    timestamp: normalizeTimestamp(record.timestamp),
    origin: asOrigin(record.origin),
    taskDescription,
    requestId,
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

function normalizeClaudeStreamMessage(value: unknown): SessionMessage | null {
  const record = asObject(value)
  if (typeof record.uuid !== 'string' || typeof record.session_id !== 'string') return null

  const eventPayload = normalizeClaudeEventAsSystem(record)
  if (eventPayload) {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: new Date().toISOString(),
      message: eventPayload,
    }
  }

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

export function normalizeClaudeStreamThreadedMessage(value: unknown): ThreadedMessage | null {
  const normalized = normalizeClaudeStreamMessage(value)
  if (!normalized || normalized.type !== 'system') return null
  const payload = normalized.message as SystemMessagePayload

  return {
    role: 'system',
    uuid: normalized.uuid,
    sessionId: normalized.session_id,
    timestamp: normalized.timestamp,
    origin: normalized.origin,
    provider: normalized.provider,
    blocks: [{
      type: 'claude_system',
      subtype: payload.subtype,
      payload,
    }],
  }
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

export function extractClaudeStreamToolInputDelta(value: unknown): { index: number; partialJson: string } | null {
  const record = asObject(value)
  if (record.type !== 'stream_event') return null

  const event = asObject(record.event)
  if (event.type !== 'content_block_delta' || typeof event.index !== 'number') return null
  const delta = asObject(event.delta)
  if (delta.type !== 'input_json_delta' || typeof delta.partial_json !== 'string') return null

  return {
    index: event.index,
    partialJson: delta.partial_json,
  }
}

function closePartialJson(raw: string): string | null {
  const stack: Array<'}' | ']'> = []
  let inString = false
  let escaped = false
  let unicodeDigitsRemaining = 0

  for (const char of raw) {
    if (inString) {
      if (unicodeDigitsRemaining > 0) {
        if (/^[0-9a-f]$/i.test(char)) {
          unicodeDigitsRemaining -= 1
          continue
        }
        unicodeDigitsRemaining = 0
      }
      if (escaped) {
        escaped = false
        if (char === 'u') unicodeDigitsRemaining = 4
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      stack.push('}')
    } else if (char === '[') {
      stack.push(']')
    } else if (char === '}' || char === ']') {
      if (stack.at(-1) !== char) return null
      stack.pop()
    }
  }

  let repaired = raw.trimEnd()
  if (inString) {
    if (escaped) repaired = repaired.slice(0, -1)
    if (unicodeDigitsRemaining > 0) {
      const unicodeStart = repaired.lastIndexOf('\\u')
      if (unicodeStart >= 0) repaired = repaired.slice(0, unicodeStart)
    }
    repaired += '"'
  }
  return repaired + [...stack].reverse().join('')
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/**
 * Parse the accumulated `input_json_delta` buffer into the best available tool
 * input snapshot. The raw stream is always retained by the caller; this helper
 * only repairs a copy, so a later delta or the final assistant message remains
 * authoritative.
 */
export function parseClaudeStreamToolInput(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return {}

  const exact = parseObject(trimmed)
  if (exact) return exact

  const closed = closePartialJson(trimmed)
  if (!closed) return null

  const direct = parseObject(closed)
  if (direct) return direct

  // Deltas can end immediately after a key separator or comma. Complete or
  // remove only that dangling token, then close the surrounding containers.
  const withoutClosers = closed.replace(/[}\]]+$/g, '')
  const withNullValue = parseObject(`${withoutClosers.replace(/:\s*$/, ': null')}${closed.slice(withoutClosers.length)}`)
  if (withNullValue) return withNullValue

  const withoutComma = withoutClosers.replace(/,\s*$/, '')
  return parseObject(`${withoutComma}${closed.slice(withoutClosers.length)}`)
}
