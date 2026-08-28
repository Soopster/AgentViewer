import type {
  ApiMessage,
  ContentBlock,
  SessionMessage,
  SystemMessagePayload,
  ToolResultBlock,
  ToolUseBlock,
} from './types'
import type { ThreadedMessage } from './threading'
import { recordRawFrame } from './rawFrames'

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

function toolResultBlock(value: unknown, toolResultMeta?: unknown): ToolResultBlock | null {
  const record = asObject(value)
  if (typeof record.tool_use_id !== 'string') return null

  const content = record.content
  const meta = {
    ...asObject(toolResultMeta),
    ...(record.background === true ? { background: true } : {}),
  }
  return {
    type: 'tool_result',
    tool_use_id: record.tool_use_id,
    content: typeof content === 'string' || Array.isArray(content)
      ? content as string | ContentBlock[]
      : stringify(content),
    is_error: record.is_error === true || record.isError === true || undefined,
    tool_result_meta: Object.keys(meta).length > 0 ? meta : undefined,
  }
}

function toolResultBlocks(value: unknown, toolResultMeta?: unknown): ToolResultBlock[] {
  if (Array.isArray(value)) {
    return value
      .map((block) => toolResultBlock(block, toolResultMeta))
      .filter((block): block is ToolResultBlock => Boolean(block))
  }

  const single = toolResultBlock(value, toolResultMeta)
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

function normalizeApiMessage(
  type: 'user' | 'assistant',
  value: unknown,
  toolUseResult?: unknown,
  toolResultMeta?: unknown,
  envelope?: Record<string, unknown>,
): ApiMessage {
  const record = asObject(value)
  const content = appendToolResults(messageContent(record.content), toolResultBlocks(toolUseResult, toolResultMeta))
  const message: ApiMessage = {
    role: type,
    content,
    usage: type === 'assistant' ? messageUsage(record.usage) : undefined,
  }
  if (envelope?.aborted === true) message.aborted = true
  if (typeof envelope?.subagent_type === 'string') message.subagent_type = envelope.subagent_type
  if (envelope?.subagent_retry && typeof envelope.subagent_retry === 'object' && !Array.isArray(envelope.subagent_retry)) {
    message.subagent_retry = envelope.subagent_retry as Record<string, unknown>
  }
  return message
}

function normalizeSystemMessage(value: unknown, fallbackSubtype: string): SystemMessagePayload {
  const record = asObject(value)
  const subtype = typeof record.subtype === 'string' ? record.subtype : fallbackSubtype
  const payload: SystemMessagePayload = {
    type: 'system',
    subtype,
    ...record,
  }

  // A refusal with no fallback model configured ends the turn outright — the
  // sibling of model_refusal_fallback, which agent-viewer already renders. Left
  // unenriched it arrives as a bare untyped system row and the turn reads as
  // having gone quiet for no reason.
  if (subtype === 'model_refusal_no_fallback' && !payload.content) {
    const model = typeof record.original_model === 'string' ? record.original_model : 'the model'
    const category = typeof record.api_refusal_category === 'string' ? record.api_refusal_category : ''
    const explanation = typeof record.api_refusal_explanation === 'string' ? record.api_refusal_explanation.trim() : ''
    payload.content = explanation
      || `${model} refused this request${category ? ` (${category})` : ''} and no fallback model is configured.`
    payload.level = 'warning'
  }

  // The CLI is tearing its worker down (host exit, remote control disabled).
  // The pool acts on this too (lib/claudePool.ts); surfacing it in the
  // transcript explains why a live session suddenly stops responding.
  if (subtype === 'worker_shutting_down' && !payload.content) {
    const reason = typeof record.reason === 'string' && record.reason ? record.reason : 'unknown'
    payload.content = `Claude worker shutting down (${reason.replace(/_/g, ' ')})`
    payload.level = 'notice'
  }

  return payload
}

function normalizeClaudeEventAsSystem(record: Record<string, unknown>): SystemMessagePayload | null {
  if (record.type === 'result' && (
    record.subtype !== 'success'
    || record.api_error_status != null
    || record.is_error === true
    || record.terminal_reason === 'api_error'
  )) {
    const errors = Array.isArray(record.errors)
      ? record.errors.filter((entry): entry is string => typeof entry === 'string').join('\n')
      : ''
    return {
      type: 'system',
      ...record,
      subtype: 'result',
      result_subtype: record.subtype,
      content: errors || (record.api_error_status != null ? `Claude API error (HTTP ${record.api_error_status})` : 'Claude run ended with an error'),
      level: 'warning',
    }
  }

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

  // The CLI started a fresh conversation id underneath this session (e.g. an
  // auto-reset after an unrecoverable context state). Consumers that keep
  // polling the old id silently stop seeing new messages, so surface the new
  // id in the transcript rather than dropping the event on the floor.
  if (record.type === 'conversation_reset') {
    const next = typeof record.new_conversation_id === 'string' ? record.new_conversation_id : ''
    return {
      type: 'system',
      subtype: 'conversation_reset',
      ...record,
      content: next
        ? `Conversation was reset — continuing as ${next}`
        : 'Conversation was reset',
      level: 'notice',
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

function asOrigin(value: unknown): { kind: string; subkind?: string } | undefined {
  const record = asObject(value)
  if (typeof record.kind !== 'string') return undefined
  // subkind discriminates within a kind — currently 'scheduled-trigger' and
  // 'peer-send-message' (a message pushed in by another session's SendMessage
  // tool, held for approval when the recipient runs with bypassed permissions).
  return typeof record.subkind === 'string' ? { kind: record.kind, subkind: record.subkind } : { kind: record.kind }
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
      : normalizeApiMessage(type, record.message, record.tool_use_result, record.tool_result_meta, record),
  }
}

export function normalizeClaudeHistoryMessages(messages: unknown[]): SessionMessage[] {
  return messages
    .map((raw) => {
      const message = normalizeClaudeHistoryMessage(raw)
      // Keep the SDK's own record beside what we made of it. See lib/rawFrames.ts.
      if (message) {
        recordRawFrame(message.session_id, message.uuid, {
          source: 'claude.sdk.message',
          messageType: typeof (raw as { type?: unknown })?.type === 'string'
            ? (raw as { type: string }).type
            : undefined,
          payload: raw,
        })
      }
      return message
    })
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

  if (record.type === 'result' && (
    record.subtype !== 'success'
    || record.api_error_status != null
    || record.is_error === true
    || record.terminal_reason === 'api_error'
  )) {
    return {
      type: 'system',
      uuid: record.uuid,
      session_id: record.session_id,
      parent_tool_use_id: null,
      provider: 'claude',
      timestamp: new Date().toISOString(),
      message: {
        type: 'system',
        ...record,
        subtype: 'result',
        result_subtype: record.subtype,
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

/**
 * Tool results the SDK reports mid-turn, as `user` messages carrying
 * `tool_result` blocks. Live renderers pair these with the `tool_use` blocks
 * from `extractClaudeStreamToolUse` so a streaming card shows the real
 * outcome (exit code, output, error) instead of waiting for the transcript
 * to sync. Sub-agent results (`parent_tool_use_id`) are skipped — they belong
 * to a nested transcript, not the top-level cards.
 */
export function extractClaudeStreamToolResults(value: unknown): ToolResultBlock[] {
  const record = asObject(value)
  if (record.type !== 'user' || record.parent_tool_use_id) return []

  const content = asObject(record.message).content
  const contentResults = Array.isArray(content)
    ? content
        .map((entry) => toolResultBlock(entry, record.tool_result_meta))
        .filter((result): result is ToolResultBlock => Boolean(result))
    : []
  if (contentResults.length > 0) return contentResults

  // Some SDK messages expose the result only through the structured sidecar.
  return toolResultBlocks(record.tool_use_result, record.tool_result_meta)
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
