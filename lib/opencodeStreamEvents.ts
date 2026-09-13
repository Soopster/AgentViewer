import type { Event as OpenCodeEvent } from '@opencode-ai/sdk'

export type OpenCodeMessageRole = 'user' | 'assistant'

function eventMessageId(event: OpenCodeEvent): string | undefined {
  if (event.type === 'message.updated') return event.properties.info.id
  const properties = (event as unknown as { properties?: Record<string, unknown> }).properties
  if (!properties) return undefined
  if (typeof properties.messageID === 'string') return properties.messageID
  const part = properties.part
  return part && typeof part === 'object' && typeof (part as Record<string, unknown>).messageID === 'string'
    ? (part as Record<string, unknown>).messageID as string
    : undefined
}

export function openCodeStreamEnvelope(
  event: OpenCodeEvent,
  messageRoles?: Map<string, OpenCodeMessageRole>,
): { type: 'opencode_event'; event: OpenCodeEvent; messageRole?: OpenCodeMessageRole } {
  const messageId = eventMessageId(event)
  let messageRole = messageId ? messageRoles?.get(messageId) : undefined
  if (event.type === 'message.updated') {
    messageRole = event.properties.info.role
    messageRoles?.set(event.properties.info.id, messageRole)
  } else if (event.type === 'message.removed' && messageId) {
    messageRoles?.delete(messageId)
  }
  return {
    type: 'opencode_event',
    event,
    ...(messageRole ? { messageRole } : {}),
  }
}

export function isOpenCodeAssistantStreamEnvelope(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return record.type === 'opencode_event' && record.messageRole === 'assistant'
}
