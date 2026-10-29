import type { ThreadedMessage } from './threading'
import { sessionIdentityKey, type SessionIdentity } from './sessionIdentity'

export function messageOwner(message: ThreadedMessage): string | null {
  return message.sessionId ? sessionIdentityKey({ ...message, sessionId: message.sessionId }) : null
}
export function userMessageText(message: ThreadedMessage): string {
  return message.blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
}
export function sameUserMessage(a: ThreadedMessage, b: ThreadedMessage): boolean {
  return a.role === 'user' && b.role === 'user' && messageOwner(a) === messageOwner(b) && userMessageText(a) !== '' && userMessageText(a) === userMessageText(b)
}
/** Replace a pending echo when its provider acknowledgement arrives. Never deduplicate two durable prompts by text. */
export function upsertComposerMessage(messages: ThreadedMessage[], next: ThreadedMessage): ThreadedMessage[] {
  const owner = messageOwner(next)
  const index = messages.findIndex(message => message.uuid === next.uuid && messageOwner(message) === owner)
  if (index >= 0) return messages.map((message, at) => at === index ? next : message)
  const echo = next.uuid !== 'live-user' ? messages.findIndex(message => message.uuid === 'live-user' && sameUserMessage(message, next)) : -1
  if (echo >= 0) return messages.map((message, at) => at === echo ? next : message)
  return [...messages, next]
}

/** Bind an optimistic row to its SDK message ID before persisted content lands.
 * Provider-added context can change the prompt text, so receipts use identity. */
export function acknowledgeComposerMessage(messages: ThreadedMessage[], owner: SessionIdentity, messageUuid: string, echoUuid = 'live-user'): ThreadedMessage[] {
  const key = sessionIdentityKey(owner)
  const echo = messages.findIndex(message => message.role === 'user' && message.uuid === echoUuid && messageOwner(message) === key)
  if (echo < 0 || echoUuid === messageUuid) return messages
  if (messages.some(message => message.uuid === messageUuid && messageOwner(message) === key)) {
    return messages.filter((_, index) => index !== echo)
  }
  return messages.map((message, index) => index === echo ? { ...message, uuid: messageUuid } : message)
}
/** Persisted rows replace their live counterparts synchronously in the render snapshot. */
export function indexComposerMessages(persisted: readonly ThreadedMessage[], recentUserIds: ReadonlySet<string> = new Set()) {
  const ids = new Set(persisted.map(message => `${messageOwner(message)}\u0000${message.uuid}`))
  const recentUsers = persisted.filter(message => recentUserIds.has(message.uuid) && message.role === 'user')
  return { ids, recentUsers }
}
export function visibleComposerMessages(live: ThreadedMessage[], index: ReturnType<typeof indexComposerMessages>): ThreadedMessage[] {
  const { ids, recentUsers } = index
  return live.filter(message => !ids.has(`${messageOwner(message)}\u0000${message.uuid}`)
    && !(message.uuid === 'live-user' && recentUsers.some(saved => sameUserMessage(message, saved))))
}
