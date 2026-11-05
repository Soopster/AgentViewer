import type { Session, SessionInfo, SessionMessage } from './types'
import { LMSTUDIO_CAPABILITIES } from './provider'
import type { LmstudioSessionRecord } from './lmstudioClient'
import { recordRawFrame } from './rawFrames'

export function mapLmstudioSessionToSession(record: LmstudioSessionRecord): Session {
  return {
    sessionId: record.id,
    summary: record.title ?? firstLmstudioPrompt(record),
    customTitle: record.title,
    firstPrompt: firstLmstudioPrompt(record),
    lastModified: Date.parse(record.lastModified) || undefined,
    createdAt: record.createdAt,
    cwd: record.cwd,
    tag: record.tag ?? null,
    provider: 'lmstudio',
    capabilities: LMSTUDIO_CAPABILITIES,
  }
}

export function mapLmstudioSessionToInfo(record: LmstudioSessionRecord): SessionInfo {
  return {
    sessionId: record.id,
    summary: record.title ?? firstLmstudioPrompt(record) ?? 'LM Studio session',
    lastModified: Date.parse(record.lastModified) || Date.now(),
    customTitle: record.title,
    firstPrompt: firstLmstudioPrompt(record),
    cwd: record.cwd,
    tag: record.tag,
    createdAt: Date.parse(record.createdAt) || undefined,
    provider: 'lmstudio',
    capabilities: LMSTUDIO_CAPABILITIES,
    currentModel: record.model,
  }
}

function firstLmstudioPrompt(record: LmstudioSessionRecord): string | undefined {
  return record.messages.find((m) => m.role === 'user')?.content
}

export function mapLmstudioSessionToMessages(record: LmstudioSessionRecord): SessionMessage[] {
  for (const message of record.messages) {
    recordRawFrame(record.id, message.id, { source: 'lmstudio.record', messageType: message.role, payload: message })
  }
  return record.messages.map((message) => ({
    type: message.role,
    uuid: message.id,
    session_id: record.id,
    message: {
      role: message.role,
      content: message.content,
      ...(message.role === 'assistant' && message.usage
        ? {
          usage: {
            input_tokens: message.usage.promptTokens ?? 0,
            output_tokens: message.usage.completionTokens ?? 0,
          },
        }
        : {}),
    },
    parent_tool_use_id: null,
    timestamp: message.createdAt,
    provider: 'lmstudio',
  }))
}
