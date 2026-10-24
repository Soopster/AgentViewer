import type { ThreadedMessage } from '../../lib/threading'
import { sessionIdentityKey } from './sessionIdentity'

export function liveMessageSessionKey(message: ThreadedMessage): string | null {
  return message.sessionId ? sessionIdentityKey({ ...message, sessionId: message.sessionId }) : null
}

/** UUIDs are native-provider IDs, not global IDs. A sibling connection may
 * emit the same live-user/tool UUID without replacing this window's content. */
export function upsertThreadedMessage(messages: ThreadedMessage[], next: ThreadedMessage): ThreadedMessage[] {
  const owner = liveMessageSessionKey(next)
  const index = messages.findIndex(message => message.uuid === next.uuid && liveMessageSessionKey(message) === owner)
  if (index < 0) return [...messages, next]
  return messages.map((message, at) => at === index ? next : message)
}
