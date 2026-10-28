import type { ThreadedMessage } from '../../lib/threading'
import { sessionIdentityKey } from './sessionIdentity'

export function liveMessageSessionKey(message: ThreadedMessage): string | null {
  return message.sessionId ? sessionIdentityKey({ ...message, sessionId: message.sessionId }) : null
}

/** UUIDs are native-provider IDs, not global IDs. A sibling connection may
 * emit the same live-user/tool UUID without replacing this window's content. */
export { upsertComposerMessage as upsertThreadedMessage } from '../../lib/composerTranscript'
