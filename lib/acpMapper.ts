// Maps ACP session/update notifications (from lib/acpClientPool.ts's
// buffered ActiveSessionMessage stream) into the canonical SessionMessage
// shape, following the same pattern as claudeMapper.ts/codexMapper.ts:
// raw event -> local helpers -> SessionMessage.
import type { ActiveSessionMessage } from '@agentclientprotocol/sdk'
import type {
  ContentBlock as AcpContentBlock,
  SessionUpdate,
  ToolCallContent,
} from '@agentclientprotocol/sdk'
import type {
  AgentProvider,
  ApiMessage,
  ContentBlock,
  SessionMessage,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from './types'
import type { AcpBufferedMessage } from './acpClientPool'

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function textFromAcpContentBlock(block: AcpContentBlock): string {
  if (block.type === 'text') return block.text
  if (block.type === 'resource_link') return block.uri ?? block.name ?? ''
  if (block.type === 'resource') {
    const resource = block.resource
    if (resource && 'text' in resource && typeof resource.text === 'string') return resource.text
    return stringify(resource)
  }
  return stringify(block)
}

function toolResultContentFromToolCallContent(content: ToolCallContent[] | undefined): string | ContentBlock[] {
  if (!content || content.length === 0) return ''
  const blocks: TextBlock[] = content.map((entry): TextBlock => {
    if (entry.type === 'content') return { type: 'text', text: textFromAcpContentBlock(entry.content) }
    if (entry.type === 'diff') {
      return { type: 'text', text: `--- ${entry.path}\n${entry.oldText ?? ''}\n+++\n${entry.newText}` }
    }
    // terminal
    return { type: 'text', text: `[terminal ${entry.terminalId}]` }
  })
  if (blocks.length === 1) return blocks[0].text
  return blocks
}

/**
 * Buffered pool index -> a stable synthetic uuid. ACP doesn't hand back a
 * per-update id, so the (sessionId, index) pair is the identity instead.
 */
function syntheticUuid(sessionId: string, index: number): string {
  return `acp-${sessionId}-${index}`
}

function apiMessage(role: 'user' | 'assistant', content: string | ContentBlock[]): ApiMessage {
  return { role, content }
}

function textBlock(text: string): TextBlock {
  return { type: 'text', text }
}

function toolUseMessage(update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>): ApiMessage {
  const block: ToolUseBlock = {
    type: 'tool_use',
    id: update.toolCallId,
    name: update.title,
    input: (update.rawInput && typeof update.rawInput === 'object' ? update.rawInput as Record<string, unknown> : {}),
  }
  return apiMessage('assistant', [block])
}

function toolResultMessage(update: Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>): ApiMessage | null {
  if (update.status !== 'completed' && update.status !== 'failed') return null
  const block: ToolResultBlock = {
    type: 'tool_result',
    tool_use_id: update.toolCallId,
    content: toolResultContentFromToolCallContent(update.content ?? undefined),
    is_error: update.status === 'failed' || undefined,
  }
  return apiMessage('user', [block])
}

/**
 * Maps one buffered ACP update to zero-or-one SessionMessage. Returns null
 * for update kinds with no direct transcript representation (plan/mode/
 * config/usage updates) — those surface elsewhere (future: session status),
 * not as chat-transcript entries.
 */
export function mapAcpBufferedMessage(
  sessionId: string,
  provider: Extract<AgentProvider, 'claude-acp' | 'codex-acp'>,
  buffered: AcpBufferedMessage,
): SessionMessage | null {
  const { message, index, receivedAt } = buffered
  const timestamp = new Date(receivedAt).toISOString()
  const uuid = syntheticUuid(sessionId, index)

  if (message.kind === 'stop') {
    return {
      type: 'system',
      uuid,
      session_id: sessionId,
      message: { type: 'system', subtype: 'acp_stop', stopReason: message.stopReason },
      parent_tool_use_id: null,
      timestamp,
      provider,
    }
  }

  const update = message.update
  let apiMsg: ApiMessage | null = null

  if (update.sessionUpdate === 'agent_message_chunk') {
    apiMsg = apiMessage('assistant', [textBlock(textFromAcpContentBlock(update.content))])
  } else if (update.sessionUpdate === 'agent_thought_chunk') {
    apiMsg = apiMessage('assistant', [{ type: 'thinking', thinking: textFromAcpContentBlock(update.content) }])
  } else if (update.sessionUpdate === 'user_message_chunk') {
    apiMsg = apiMessage('user', [textBlock(textFromAcpContentBlock(update.content))])
  } else if (update.sessionUpdate === 'tool_call') {
    apiMsg = toolUseMessage(update)
  } else if (update.sessionUpdate === 'tool_call_update') {
    apiMsg = toolResultMessage(update)
  }

  if (!apiMsg) return null

  return {
    type: apiMsg.role,
    uuid,
    session_id: sessionId,
    message: apiMsg,
    parent_tool_use_id: null,
    timestamp,
    provider,
  }
}

export function mapAcpBufferedMessages(
  sessionId: string,
  provider: Extract<AgentProvider, 'claude-acp' | 'codex-acp'>,
  buffered: AcpBufferedMessage[],
): SessionMessage[] {
  return buffered
    .map((entry) => mapAcpBufferedMessage(sessionId, provider, entry))
    .filter((msg): msg is SessionMessage => msg !== null)
}

// Re-exported for callers that only need the raw update-kind narrowing
// without going through the pool's ActiveSessionMessage wrapper.
export type { ActiveSessionMessage }
