import { withOpenCodeAttachments } from '../../../lib/opencodeAttachments'
import { isOpenCodeAssistantStreamEnvelope } from '../../../lib/opencodeStreamEvents'
import type { PendingPermission, PendingQuestionAnswers } from '../../../lib/permissions'
import type { ThreadedMessage } from '../../../lib/threading'
import type { ToolResultBlock, Session, ProviderSelection } from '../../../lib/types'
import type { SseFrame, TuiLiveToolActivity } from './types'
import { liveMessageSessionKey } from '../liveTranscriptState'
import { summarizeDurableSessionMessages } from '../messageFingerprint'

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
function extractCodexTurnPlanText(payload: Record<string, unknown>): string | null {
  const plan = Array.isArray(payload.plan) ? payload.plan : []
  const steps = plan
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const record = entry as Record<string, unknown>
      const step = typeof record.step === 'string' ? record.step.trim() : ''
      if (!step) return []
      const status = typeof record.status === 'string' ? record.status : ''
      const marker = status === 'completed'
        ? '[x]'
        : status === 'inProgress'
          ? '[~]'
          : '[ ]'
      return [`${marker} ${step}`]
    })
  const explanation = typeof payload.explanation === 'string' ? payload.explanation.trim() : ''
  if (steps.length === 0) return explanation || null
  return `${explanation ? `${explanation}\n\n` : ''}## Plan\n\n${steps.join('\n')}`
}
// Append-only reasoning/thinking deltas, kept separate from the answer so the
// composer can stream them as a distinct dim channel (matching the native CLIs).
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
export function extractStreamingAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  // Reasoning deltas are handled by extractStreamingReasoningText and rendered
  // on a separate dim channel; only the plan delta stays in the answer here.
  if (record.type === 'codex_plan_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_turn_plan_updated') {
    return extractCodexTurnPlanText(record)
  }

  if (record.type === 'codex_error') {
    const error = record.error
    if (!error || typeof error !== 'object') return null
    const errorRecord = error as Record<string, unknown>
    const message = typeof errorRecord.message === 'string' ? errorRecord.message : ''
    const details = typeof errorRecord.additionalDetails === 'string' ? errorRecord.additionalDetails : ''
    return [message, details].filter(Boolean).join('\n\n') || null
  }

  if (record.type === 'codex_realtime_transcript_delta') {
    return record.role === 'assistant' && typeof record.delta === 'string'
      ? record.delta
      : null
  }

  if (record.type === 'codex_realtime_transcript_done') {
    return record.role === 'assistant' && typeof record.text === 'string'
      ? record.text
      : null
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
export function shouldReplaceLiveAssistantText(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (record.type === 'assistant') return true
  if (record.type === 'codex_error') return true
  if (record.type === 'codex_turn_plan_updated') return true
  if (record.type === 'codex_realtime_transcript') return true
  if (record.type === 'codex_realtime_transcript_done') return true
  if (record.type === 'codex_realtime_item_added') return true
  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return false
    return !!((item as Record<string, unknown>).type === 'agentMessage' || (item as Record<string, unknown>).type === 'plan')
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
export function extractCodexVisibleAssistantText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  if (record.type === 'codex_agent_message_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_plan_delta' && typeof record.delta === 'string') {
    return record.delta
  }

  if (record.type === 'codex_turn_plan_updated') {
    return extractCodexTurnPlanText(record)
  }

  if (record.type === 'codex_realtime_transcript_delta') {
    return record.role === 'assistant' && typeof record.delta === 'string'
      ? record.delta
      : null
  }

  if (record.type === 'codex_realtime_transcript_done') {
    return record.role === 'assistant' && typeof record.text === 'string'
      ? record.text
      : null
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
    if (itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string') return itemRecord.text
    if (itemRecord.type === 'plan' && typeof itemRecord.text === 'string') return `## Plan\n\n${itemRecord.text}`
    return null
  }

  if (record.type === 'codex_item_completed') {
    const item = record.item
    if (!item || typeof item !== 'object') return null
    const itemRecord = item as Record<string, unknown>
    if (itemRecord.type === 'agentMessage' && typeof itemRecord.text === 'string') return itemRecord.text
    if (itemRecord.type === 'plan' && typeof itemRecord.text === 'string') return `## Plan\n\n${itemRecord.text}`
  }

  return null
}
export function shouldReplaceCodexVisibleAssistantText(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  if (record.type === 'codex_turn_plan_updated') return true
  if (record.type === 'codex_realtime_transcript') return true
  if (record.type === 'codex_realtime_transcript_done') return true
  if (record.type === 'codex_realtime_item_added') return true
  return record.type === 'codex_item_completed'
}
function stringifyLiveValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
// Attach a tool's real result to its live card. Until this lands the card
// keeps `result: null`, which the formatters render as a compact running
// state — a streaming tool is genuinely still running once its input has
// finished streaming, so it must not be dressed up as complete.
export function applyLiveToolResult(messages: ThreadedMessage[], result: ToolResultBlock): ThreadedMessage[] {
  const targetUuid = `live-tool:${result.tool_use_id}`
  return messages.map((message) => {
    if (message.uuid !== targetUuid) return message
    return {
      ...message,
      blocks: message.blocks.map((block) => block.type === 'tool_thread' && !block.result
        ? { ...block, result }
        : block),
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
function codexLiveToolLabel(item: Record<string, unknown>): string | null {
  switch (item.type) {
    case 'commandExecution':
      return 'Bash'
    case 'fileChange':
      return 'FileChange'
    case 'mcpToolCall':
      return typeof item.tool === 'string' && item.tool.trim()
        ? item.tool
        : 'MCP'
    case 'dynamicToolCall':
      return typeof item.tool === 'string' && item.tool.trim()
        ? item.tool
        : 'DynamicTool'
    case 'collabAgentToolCall':
      return 'Agent'
    case 'webSearch':
      return 'WebSearch'
    case 'imageView':
      return 'ImageView'
    case 'imageGeneration':
      return 'ImageGeneration'
    case 'contextCompaction':
      return 'ContextCompaction'
    case 'hookPrompt':
      return 'Hook'
    default:
      return null
  }
}
export function extractCodexLiveToolActivity(payload: Record<string, unknown>): TuiLiveToolActivity | null {
  if (payload.type !== 'codex_item_started' && payload.type !== 'codex_item_completed') return null
  const item = payload.item
  if (!item || typeof item !== 'object') return null
  const itemRecord = item as Record<string, unknown>
  const label = codexLiveToolLabel(itemRecord)
  if (!label) return null
  const itemId = typeof itemRecord.id === 'string' && itemRecord.id
    ? itemRecord.id
    : typeof payload.itemId === 'string' && payload.itemId
      ? payload.itemId
      : label
  return {
    key: itemId,
    label,
    status: payload.type === 'codex_item_completed' ? 'done' : 'running',
  }
}
export function applyLiveToolActivity(prev: TuiLiveToolActivity[], activity: TuiLiveToolActivity): TuiLiveToolActivity[] {
  const existingIndex = prev.findIndex((entry) => entry.key === activity.key)
  if (existingIndex === -1) return [...prev, activity]
  return prev.map((entry, index) => index === existingIndex ? activity : entry)
}
function codexToolNameForDelta(type: unknown): string {
  if (type === 'codex_file_change_output_delta' || type === 'codex_file_change_patch_updated') return 'FileChange'
  if (type === 'codex_mcp_tool_progress') return 'MCP'
  return 'Bash'
}
function codexLiveDeltaText(record: Record<string, unknown>): string | null {
  if (record.type === 'codex_mcp_tool_progress') {
    return typeof record.message === 'string' && record.message ? `${record.message}\n` : null
  }
  if (record.type === 'codex_file_change_patch_updated') {
    const changes = Array.isArray(record.changes) ? record.changes.length : 0
    return `Patch updated (${changes} change${changes === 1 ? '' : 's'}).\n`
  }
  if (record.type === 'codex_command_output_delta' || record.type === 'codex_file_change_output_delta') {
    return typeof record.delta === 'string' ? record.delta : null
  }
  return null
}
export function appendCodexLiveToolOutput(
  messages: ThreadedMessage[],
  payload: Record<string, unknown>,
  targetSession: Session): ThreadedMessage[] {
  const deltaText = codexLiveDeltaText(payload)
  if (!deltaText) return messages

  const turnId = typeof payload.turnId === 'string' && payload.turnId ? payload.turnId : null
  const itemId = typeof payload.itemId === 'string' && payload.itemId ? payload.itemId : null
  if (!turnId || !itemId) return messages

  const messageUuid = `${turnId}:${itemId}`
  const toolUseId = `${messageUuid}:tool`
  let matched = false
  const nextMessages = messages.map((message) => {
    if (message.uuid !== messageUuid) return message
    matched = true
    return {
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.type !== 'tool_thread' || block.toolUse.id !== toolUseId) return block
        const existing = typeof block.result?.content === 'string' ? block.result.content : ''
        const result: ToolResultBlock = {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `${existing}${deltaText}`,
          is_error: block.result?.is_error,
        }
        return { ...block, result }
      }),
    }
  })

  if (matched) return nextMessages

  const sessionId = typeof payload.threadId === 'string' && payload.threadId
    ? payload.threadId
    : targetSession.sessionId
  const toolName = codexToolNameForDelta(payload.type)
  return [
    ...nextMessages,
    {
      role: 'assistant',
      uuid: messageUuid,
      sessionId,
      provider: targetSession.provider ?? 'codex',
      blocks: [{
        type: 'tool_thread',
        toolUse: {
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input: { status: 'running', itemId },
        },
        result: {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: deltaText,
        },
      }],
    },
  ]
}
function codexQuestionMessageUuid(permissionId: string): string {
  return `live-tool:codex-question:${permissionId}`
}
export function codexQuestionLiveMessage(
  permission: PendingPermission,
  targetSession: Session): ThreadedMessage | null {
  const questions = permission.questions ?? []
  if (permission.provider !== 'codex'
    || permission.toolName !== 'item/tool/requestUserInput'
    || questions.length === 0) return null

  const toolUseId = `${codexQuestionMessageUuid(permission.id)}:tool`
  return {
    role: 'assistant',
    uuid: codexQuestionMessageUuid(permission.id),
    sessionId: permission.sessionId ?? targetSession.sessionId,
    provider: 'codex',
    blocks: [{
      type: 'tool_thread',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: 'AskUserQuestion',
        input: {
          questions: questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            multiSelect: question.multiSelect,
            options: question.options,
          })),
        },
      },
      result: null,
    }],
  }
}
export function completeCodexQuestionLiveMessage(
  messages: ThreadedMessage[],
  permission: PendingPermission,
  answers: PendingQuestionAnswers | null): ThreadedMessage[] {
  if (permission.provider !== 'codex' || permission.toolName !== 'item/tool/requestUserInput') return messages
  const messageUuid = codexQuestionMessageUuid(permission.id)
  const toolUseId = `${messageUuid}:tool`
  const displayAnswers = Object.fromEntries((permission.questions ?? []).flatMap((question) => {
    const values = answers?.[question.id ?? question.question]
    return values && values.length > 0 ? [[question.question, values.join(', ')]] : []
  }))
  return messages.map((message) => message.uuid !== messageUuid ? message : {
    ...message,
    blocks: message.blocks.map((block) => block.type !== 'tool_thread' || block.toolUse.id !== toolUseId ? block : {
      ...block,
      result: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: answers ? JSON.stringify({ answers: displayAnswers }) : 'Question skipped by user.',
        is_error: answers ? undefined : true,
      },
    }),
  })
}
export function hasLiveAssistantMessage(messages: ThreadedMessage[], key: string): boolean {
  return messages.some((message) => liveMessageSessionKey(message) === key && message.role === 'assistant')
}
export function isLiveAssistantTextMessage(message: ThreadedMessage): boolean {
  return message.role === 'assistant'
    && message.blocks.some((block) => block.type === 'text' && block.text.length > 0)
}
export function hasPersistedAssistantAfterBaseline(rawMessages: import('../../../lib/types').SessionMessage[], baselineCount: number): boolean {
  const durableCount = summarizeDurableSessionMessages(rawMessages).count
  const start = durableCount > baselineCount
    ? baselineCount
    : Math.max(baselineCount - 1, 0)
  let durableIndex = 0
  for (const message of rawMessages) {
    if (!isDurableSessionMessage(message)) continue
    if (durableIndex >= start && message.type === 'assistant') return true
    durableIndex++
  }
  return false
}
/**
 * Whether the persisted rows hold the whole of a turn whose stream has ended.
 * A reply is the usual sign; a user `!command` (Codex, OpenCode) has none —
 * its input and output rows are both user rows — so two or more new rows count
 * too. A lone new row is still only the prompt, and waits for its reply.
 */
export function persistedTurnSettled(rawMessages: import('../../../lib/types').SessionMessage[], baselineCount: number): boolean {
  return hasPersistedAssistantAfterBaseline(rawMessages, baselineCount)
    || summarizeDurableSessionMessages(rawMessages).count - baselineCount >= 2
}
export function hasPersistedUserAfterBaseline(rawMessages: import('../../../lib/types').SessionMessage[], baselineCount: number): boolean {
  if (summarizeDurableSessionMessages(rawMessages).count <= baselineCount) return false
  let durableIndex = 0
  for (const message of rawMessages) {
    if (!isDurableSessionMessage(message)) continue
    if (durableIndex >= baselineCount && message.type === 'user') return true
    durableIndex++
  }
  return false
}
export function makeLiveUserMessage(session: Session, text: string, uuid = 'live-user'): ThreadedMessage {
  return {
    role: 'user',
    uuid,
    sessionId: session.sessionId,
    providerInstanceId: session.providerInstanceId,
    provider: session.provider ?? 'claude',
    blocks: [{ type: 'text', text }],
  }
}
export function makeLiveAssistantTextMessage(session: Session, text: string, uuid: string, timestamp?: string): ThreadedMessage {
  return {
    role: 'assistant',
    uuid,
    sessionId: session.sessionId,
    providerInstanceId: session.providerInstanceId,
    provider: session.provider ?? 'claude',
    timestamp,
    blocks: [{ type: 'text', text }],
  }
}
export function liveAssistantTextKey(payload: Record<string, unknown>, provider: ProviderSelection | undefined): string {
  if (provider === 'opencode') {
    const event = payload.event && typeof payload.event === 'object'
      ? payload.event as Record<string, unknown>
      : {}
    const properties = event.properties && typeof event.properties === 'object'
      ? event.properties as Record<string, unknown>
      : {}
    const part = properties.part && typeof properties.part === 'object'
      ? properties.part as Record<string, unknown>
      : {}
    const id = typeof properties.partID === 'string' && properties.partID
      ? properties.partID
      : typeof part.id === 'string' && part.id
        ? part.id
        : typeof properties.messageID === 'string' && properties.messageID
          ? properties.messageID
          : 'assistant'
    return `live-opencode:${id}`
  }

  if (provider === 'copilot') {
    const event = payload.event && typeof payload.event === 'object'
      ? payload.event as Record<string, unknown>
      : {}
    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : {}
    const id = typeof data.messageId === 'string' && data.messageId
      ? data.messageId
      : typeof event.id === 'string' && event.id
        ? event.id
        : 'assistant'
    return `live-copilot:${id}`
  }

  if (provider === 'pi') {
    return 'live-pi:assistant'
  }

  return `live-${provider ?? 'assistant'}-assistant`
}
export function extractCopilotFinalAssistantMessage(payload: unknown, session: Session): ThreadedMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'copilot_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'assistant.message') return null
  const data = eventRecord.data
  if (!data || typeof data !== 'object') return null
  const dataRecord = data as Record<string, unknown>
  const content = typeof dataRecord.content === 'string' ? dataRecord.content : ''
  if (!content.trim()) return null
  const messageId = typeof dataRecord.messageId === 'string' && dataRecord.messageId
    ? dataRecord.messageId
    : typeof eventRecord.id === 'string' && eventRecord.id
      ? eventRecord.id
      : `fallback:${Date.now()}`
  const timestamp = typeof eventRecord.timestamp === 'string' ? eventRecord.timestamp : undefined
  return makeLiveAssistantTextMessage(session, content, `live-copilot:${messageId}`, timestamp)
}
type OpenCodeLiveSubagentInfo = {
  agentId: string
  name: string
  type: 'agent' | 'subtask'
}
export function extractOpenCodeLiveSubagent(payload: unknown): OpenCodeLiveSubagentInfo | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'opencode_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'message.part.updated') return null
  const properties = eventRecord.properties
  if (!properties || typeof properties !== 'object') return null
  const part = (properties as Record<string, unknown>).part
  if (!part || typeof part !== 'object') return null
  const partRecord = part as Record<string, unknown>
  const partType = partRecord.type
  if (partType !== 'agent' && partType !== 'subtask') return null
  const agentId = typeof partRecord.id === 'string' ? partRecord.id : null
  if (!agentId) return null
  if (partType === 'agent') {
    const name = typeof partRecord.name === 'string' ? partRecord.name : 'agent'
    return { agentId, name, type: 'agent' }
  }
  const description = typeof partRecord.description === 'string' ? partRecord.description : ''
  const agent = typeof partRecord.agent === 'string' ? partRecord.agent : ''
  return { agentId, name: description || agent || 'subtask', type: 'subtask' }
}
export function extractOpenCodeLiveToolThread(payload: unknown, session: Session): ThreadedMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'opencode_event') return null

  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  if (eventRecord.type !== 'message.part.updated') return null

  const properties = eventRecord.properties
  if (!properties || typeof properties !== 'object') return null
  const part = (properties as Record<string, unknown>).part
  if (!part || typeof part !== 'object') return null
  const partRecord = part as Record<string, unknown>
  if (partRecord.type !== 'tool' || typeof partRecord.tool !== 'string') return null

  const state = partRecord.state
  const stateRecord = state && typeof state === 'object' ? state as Record<string, unknown> : {}
  const status = typeof stateRecord.status === 'string' ? stateRecord.status : ''
  const toolUseId = typeof partRecord.callID === 'string'
    ? partRecord.callID
    : typeof partRecord.id === 'string'
      ? partRecord.id
      : `${partRecord.tool}:live`
  const input = stateRecord.input && typeof stateRecord.input === 'object'
    ? stateRecord.input as Record<string, unknown>
    : {}

  let result: ToolResultBlock | null = null
  if (status === 'completed' || status === 'error') {
    const raw = status === 'error'
      ? (stateRecord.error ?? stateRecord.output)
      : stateRecord.output
    result = withOpenCodeAttachments({
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: stringifyLiveValue(raw) || status,
      is_error: status === 'error' ? true : undefined,
    }, stateRecord.attachments)
  }

  return {
    role: 'assistant',
    uuid: `live-tool:${toolUseId}`,
    sessionId: session.sessionId,
    providerInstanceId: session.providerInstanceId,
    provider: session.provider ?? 'opencode',
    blocks: [{
      type: 'tool_thread',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: partRecord.tool,
        input,
      },
      result,
    }],
  }
}
export function streamEventIndex(payload: unknown, eventType: string): number | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'stream_event') return null
  const event = record.event
  if (!event || typeof event !== 'object') return null
  const eventRecord = event as Record<string, unknown>
  return eventRecord.type === eventType && typeof eventRecord.index === 'number'
    ? eventRecord.index
    : null
}
export function formatTimeGap(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs < 30 * 60 * 1000) return null
  const minutes = Math.round(deltaMs / 60000)
  if (minutes < 90) return `${minutes}m later`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h later`
  return `${Math.round(hours / 24)}d later`
}
export function isDurableSessionMessage(message: import('../../../lib/types').SessionMessage): boolean {
  return message.ephemeral !== true
}
