import { isAgentProvider } from '../provider'
import { optionalString, toFiniteNumber, toNullableTimestamp } from './rows'
import type { Row, PersistedSessionRecord } from './types'

function decodeCreatedAt(value: unknown): string | number | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'string' || typeof parsed === 'number' ? parsed : undefined
  } catch {
    return undefined
  }
}

function decodeTag(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'string' ? parsed : parsed === null ? null : undefined
  } catch {
    return undefined
  }
}

export function rowToSessionRecord(row: Row | undefined): PersistedSessionRecord | null {
  if (!row) return null
  const provider = isAgentProvider(row.provider) ? row.provider : null
  const sessionId = optionalString(row.session_id)
  const key = optionalString(row.key)
  if (!provider || !sessionId || !key) return null
  return {
    key,
    provider,
    sessionId,
    title: optionalString(row.title) ?? sessionId,
    summary: optionalString(row.summary),
    customTitle: optionalString(row.custom_title),
    firstPrompt: optionalString(row.first_prompt),
    cwd: optionalString(row.cwd),
    tag: decodeTag(row.tag_json),
    createdAt: decodeCreatedAt(row.created_at_json),
    lastModified: typeof row.last_modified === 'number' ? row.last_modified : undefined,
    messageCount: toFiniteNumber(row.message_count),
    userMessages: toFiniteNumber(row.user_messages),
    assistantMessages: toFiniteNumber(row.assistant_messages),
    systemMessages: toFiniteNumber(row.system_messages),
    inputTokens: toFiniteNumber(row.input_tokens),
    outputTokens: toFiniteNumber(row.output_tokens),
    cacheReadTokens: toFiniteNumber(row.cache_read_tokens),
    cacheWriteTokens: toFiniteNumber(row.cache_write_tokens),
    firstMessageAt: toNullableTimestamp(row.first_message_at),
    lastMessageAt: toNullableTimestamp(row.last_message_at),
    indexedAt: toFiniteNumber(row.indexed_at),
  }
}
