import { extractFileEditsFromMessage, plainUserPromptText } from '../provenanceExtract'
import type { AgentProvider, ApiMessage, ContentBlock, SessionMessage, SystemMessagePayload } from '../types'
import type { PersistedSessionRecord, PersistedMessageRecord, PersistedFileEdit } from './types'
import { persistedSessionKey } from './identity'
import { timestampMs } from './rows'

const MAX_INDEX_TEXT_CHARS = 32_000
const MAX_FIELD_TEXT_CHARS = 2_000
const MAX_EDIT_PROMPT_CHARS = 300

type MessageAggregate = Pick<
  PersistedSessionRecord,
  | 'messageCount'
  | 'userMessages'
  | 'assistantMessages'
  | 'systemMessages'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'firstMessageAt'
  | 'lastMessageAt'
  | 'indexedAt'
>

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function looksLikeLargeEncodedBlob(value: string): boolean {
  if (value.length < 512) return false
  return /^[A-Za-z0-9+/=_-]+$/.test(value) && value.length % 4 === 0
}

function collectToolInputText(input: unknown, depth = 0): string[] {
  if (depth > 2 || input == null) return []
  if (typeof input === 'string') {
    if (looksLikeLargeEncodedBlob(input)) return []
    return [truncateText(input, MAX_FIELD_TEXT_CHARS)]
  }
  if (typeof input === 'number' || typeof input === 'boolean') return [String(input)]
  if (Array.isArray(input)) return input.flatMap((item) => collectToolInputText(item, depth + 1))
  if (typeof input !== 'object') return []

  const parts: string[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes('base64') || lowerKey.includes('image') || lowerKey === 'data') continue
    const child = collectToolInputText(value, depth + 1)
    if (child.length > 0) parts.push(`${key}: ${child.join(' ')}`)
  }
  return parts
}

type MessageDetails = {
  text: string
  toolNames: string[]
  // Per-message: tool_use_id -> name (only tool_use blocks emitted in this message).
  toolUseIds: Map<string, string>
  // Per-message: tool_use_id -> is_error (from tool_result blocks emitted in this message).
  toolResultErrors: Map<string, boolean>
}

function collectBlockDetails(
  blocks: ContentBlock[],
  parts: string[],
  toolNames: Set<string>,
  toolUseIds: Map<string, string>,
  toolResultErrors: Map<string, boolean>,
): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(block.thinking)
      continue
    }
    if (block.type === 'tool_result') {
      const id = (block as { tool_use_id?: unknown }).tool_use_id
      if (typeof id === 'string' && id) {
        const isError = (block as { is_error?: unknown }).is_error === true
        const existing = toolResultErrors.get(id) === true
        toolResultErrors.set(id, isError || existing)
      }
      if (typeof block.content === 'string') parts.push(block.content)
      else if (Array.isArray(block.content)) {
        collectBlockDetails(block.content, parts, toolNames, toolUseIds, toolResultErrors)
      }
      continue
    }
    if (block.type === 'tool_use') {
      if (typeof block.name === 'string' && block.name) {
        toolNames.add(block.name)
        parts.push(block.name)
        if (typeof block.id === 'string' && block.id) toolUseIds.set(block.id, block.name)
      }
      parts.push(...collectToolInputText(block.input))
      continue
    }
    if (block.type !== 'image') {
      parts.push(...collectToolInputText(block))
    }
  }
}

function extractMessageDetails(message: SessionMessage): MessageDetails {
  const toolNames = new Set<string>()
  const toolUseIds = new Map<string, string>()
  const toolResultErrors = new Map<string, boolean>()
  const payload = message.message
  const parts: string[] = []

  if ((payload as SystemMessagePayload).type === 'system') {
    const system = payload as SystemMessagePayload
    parts.push(system.subtype)
    if (typeof system.content === 'string') parts.push(system.content)
  } else {
    const api = payload as ApiMessage
    if (typeof api.content === 'string') {
      parts.push(api.content)
    } else if (Array.isArray(api.content)) {
      collectBlockDetails(api.content, parts, toolNames, toolUseIds, toolResultErrors)
    }
  }

  return {
    text: truncateText(parts.filter(Boolean).join('\n'), MAX_INDEX_TEXT_CHARS),
    toolNames: [...toolNames].sort((a, b) => a.localeCompare(b)),
    toolUseIds,
    toolResultErrors,
  }
}

function usageFromMessage(message: SessionMessage): {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
} {
  const payload = message.message as Partial<ApiMessage>
  const usage = payload.usage
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  }
}

export function messageSignature(provider: AgentProvider, messages: SessionMessage[]): string {
  const last = messages.at(-1)
  if (!last) return `${provider}:0`
  return [
    provider,
    messages.length,
    last.uuid,
    last.type,
    last.timestamp ?? '',
    last.turnId ?? '',
  ].join(':')
}

function modelFromMessage(message: SessionMessage): string | null {
  if (message.type !== 'assistant') return null
  const payload = message.message as Partial<ApiMessage> & { model?: unknown }
  return typeof payload.model === 'string' && payload.model.length > 0 ? payload.model : null
}

export function mapPersistedMessages(provider: AgentProvider, sessionId: string, messages: SessionMessage[]): PersistedMessageRecord[] {
  const sessionKey = persistedSessionKey(provider, sessionId, messages[0]?.providerInstanceId)
  const usedKeys = new Map<string, number>()
  const details = messages.map((message) => extractMessageDetails(message))

  // Tool_result blocks usually arrive in a later (user) message than the originating tool_use.
  // Build a session-wide tool_use_id -> isError map so we can attribute errors back to the
  // assistant message that issued the tool call.
  const errorById = new Map<string, boolean>()
  for (const d of details) {
    for (const [id, isError] of d.toolResultErrors) {
      if (isError || errorById.get(id) === true) errorById.set(id, true)
      else if (!errorById.has(id)) errorById.set(id, false)
    }
  }

  // The prompt that started the current turn, threaded onto every file edit
  // recorded for it ("what was the agent asked when it wrote this line").
  let lastPrompt: string | null = null

  return messages.map((message, i) => {
    const d = details[i]
    const usage = usageFromMessage(message)
    const uuid = message.uuid || `${message.type}:${message.timestamp ?? ''}`
    const baseKey = `${sessionKey}:${uuid}`
    const used = usedKeys.get(baseKey) ?? 0
    usedKeys.set(baseKey, used + 1)
    const key = used === 0 ? baseKey : `${baseKey}:${used + 1}`

    const errorTools = new Set<string>()
    for (const [id, name] of d.toolUseIds) {
      if (errorById.get(id) === true) errorTools.add(name)
    }

    const promptText = plainUserPromptText(message)
    if (promptText) lastPrompt = truncateText(promptText, MAX_EDIT_PROMPT_CHARS)

    // Edits whose tool_result reported an error never landed on disk — skip
    // them so failed patches don't claim lines they didn't write.
    const fileEdits: PersistedFileEdit[] = extractFileEditsFromMessage(message)
      .filter((edit) => !(edit.toolUseId && errorById.get(edit.toolUseId) === true))
      .map((edit) => ({
        tool: edit.tool,
        kind: edit.kind,
        filePath: edit.filePath,
        addedLines: edit.addedLines,
        prompt: lastPrompt,
      }))

    return {
      key,
      sessionKey,
      provider,
      sessionId,
      uuid,
      type: message.type,
      timestamp: message.timestamp,
      timestampMs: timestampMs(message.timestamp),
      turnId: message.turnId,
      originKind: message.origin?.kind,
      isPrompt: Boolean(promptText) && !isDelegatedOrigin(message.origin?.kind),
      text: d.text,
      toolNames: d.toolNames,
      errorTools: [...errorTools].sort((a, b) => a.localeCompare(b)),
      model: modelFromMessage(message),
      fileEdits,
      ...usage,
    }
  })
}

// A subagent's brief and a task notification are user-role rows nobody typed.
function isDelegatedOrigin(kind: string | undefined): boolean {
  return Boolean(kind && (kind.startsWith('subagent') || kind === 'task-notification'))
}

export function aggregateMessages(messages: PersistedMessageRecord[], indexedAt: number): MessageAggregate {
  let firstMessageAt: number | null = null
  let lastMessageAt: number | null = null
  const aggregate: MessageAggregate = {
    messageCount: messages.length,
    userMessages: 0,
    assistantMessages: 0,
    systemMessages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    firstMessageAt,
    lastMessageAt,
    indexedAt,
  }

  for (const message of messages) {
    if (message.type === 'user') aggregate.userMessages += 1
    else if (message.type === 'assistant') aggregate.assistantMessages += 1
    else aggregate.systemMessages += 1

    aggregate.inputTokens += message.inputTokens
    aggregate.outputTokens += message.outputTokens
    aggregate.cacheReadTokens += message.cacheReadTokens
    aggregate.cacheWriteTokens += message.cacheWriteTokens

    if (message.timestampMs !== null) {
      firstMessageAt = firstMessageAt === null ? message.timestampMs : Math.min(firstMessageAt, message.timestampMs)
      lastMessageAt = lastMessageAt === null ? message.timestampMs : Math.max(lastMessageAt, message.timestampMs)
    }
  }

  aggregate.firstMessageAt = firstMessageAt
  aggregate.lastMessageAt = lastMessageAt
  return aggregate
}
