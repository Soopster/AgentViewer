'use client'
import { compactStableFingerprint } from '../../lib/compactFingerprint'
import type { ThreadedMessage } from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'
import type { PendingMessageBaseline } from './types'

export function withProviderQuery(
  path: string,
  provider?: Session['provider'],
  providerInstanceId?: Session['providerInstanceId']): string {
  if (!provider && !providerInstanceId) return path
  const params = new URLSearchParams()
  if (provider) params.set('provider', provider)
  if (providerInstanceId) params.set('providerInstanceId', providerInstanceId)
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${params.toString()}`
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
    case 'bash_input':
      return a.command === (b.type === 'bash_input' ? b.command : '')
    case 'bash_output':
      return b.type === 'bash_output'
        && a.stdout === b.stdout
        && a.stderr === b.stderr
    case 'coordinator_brief':
      return b.type === 'coordinator_brief' && a.text === b.text
    case 'coordinator_mail':
      return b.type === 'coordinator_mail'
        && a.deliveryId === b.deliveryId
        && a.messages.length === b.messages.length
        && a.messages.every((message, index) => message.id === b.messages[index]?.id && message.body === b.messages[index]?.body)
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
export function threadedMessageEqual(a: ThreadedMessage, b: ThreadedMessage): boolean {
  if (a === b) return true
  if (a.uuid !== b.uuid
    || a.role !== b.role
    || a.sessionId !== b.sessionId
    || a.timestamp !== b.timestamp
    || a.provider !== b.provider
    || a.origin?.kind !== b.origin?.kind
    || !usageEqual(a.usage, b.usage)
    || a.blocks.length !== b.blocks.length) {
    return false
  }

  for (let index = 0; index < a.blocks.length; index += 1) {
    if (!threadedBlockEqual(a.blocks[index], b.blocks[index])) return false
  }
  return true
}
export function threadedMessageKey(message: ThreadedMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}
function sessionMessageThreadedKey(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}
export function sessionMessageFingerprint(message: SessionMessage | undefined): string | null {
  if (!message) return null
  return [
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    compactStableFingerprint(message.message),
  ].join('|')
}
export function isDurableSessionMessage(message: SessionMessage): boolean {
  return message.ephemeral !== true
}
export function buildPendingMessageBaseline(messages: SessionMessage[], sessionId: string): PendingMessageBaseline {
  const durableMessages = messages.filter(isDurableSessionMessage)
  const keys = new Set<string>()
  const fingerprintsByKey = new Map<string, string | null>()
  for (const message of durableMessages) {
    const key = sessionMessageThreadedKey(message)
    keys.add(key)
    fingerprintsByKey.set(key, sessionMessageFingerprint(message))
  }
  return {
    count: durableMessages.length,
    lastUuid: durableMessages.at(-1)?.uuid ?? null,
    lastFingerprint: sessionMessageFingerprint(durableMessages.at(-1)),
    sessionId,
    keys,
    fingerprintsByKey,
  }
}
export function retargetPendingMessageBaseline(
  baseline: PendingMessageBaseline,
  sessionId: string,
  resetKnownMessages = false): PendingMessageBaseline {
  if (resetKnownMessages) {
    return {
      count: 0,
      lastUuid: null,
      lastFingerprint: null,
      sessionId,
      keys: new Set(),
      fingerprintsByKey: new Map(),
    }
  }
  return { ...baseline, sessionId }
}
export function messagesChangedSinceBaseline(messages: SessionMessage[], baseline: PendingMessageBaseline): SessionMessage[] {
  return messages.filter((message) => {
    const key = sessionMessageThreadedKey(message)
    const previousFingerprint = baseline.fingerprintsByKey.get(key)
    return previousFingerprint === undefined || previousFingerprint !== sessionMessageFingerprint(message)
  })
}
