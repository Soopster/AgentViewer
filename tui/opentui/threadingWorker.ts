import { buildThreadedMessages, type ThreadedMessage } from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'

type ThreadingRequest = { id: number; session: Session; messages: SessionMessage[] }
type ThreadingResponse =
  | { id: number; ok: true; threadedMessages: ThreadedMessage[] }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<ThreadingRequest>) => void) | null
  postMessage: (message: ThreadingResponse) => void
}

self.onmessage = async (event) => {
  const { id, messages } = event.data
  try {
    const threadedMessages = buildThreadedMessages(messages)
    self.postMessage({ id, ok: true, threadedMessages })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
