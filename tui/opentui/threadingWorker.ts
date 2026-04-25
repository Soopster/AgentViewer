import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'

type ThreadingRequest = { id: number; session: Session; messages: SessionMessage[] }
type ThreadingResponse =
  | { id: number; ok: true; threadedMessages: ThreadedMessage[] }
  | { id: number; ok: false; error: string }

declare const self: {
  onmessage: ((event: MessageEvent<ThreadingRequest>) => void) | null
  postMessage: (message: ThreadingResponse) => void
}

const THREADING_CACHE_LIMIT = 8
const threadingCacheByKey = new Map<string, IncrementalThreadingCache>()

function threadingCacheKey(session: Session): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function touchThreadingCache(key: string, cache: IncrementalThreadingCache): void {
  if (threadingCacheByKey.has(key)) threadingCacheByKey.delete(key)
  threadingCacheByKey.set(key, cache)
  while (threadingCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = threadingCacheByKey.keys().next().value
    if (oldestKey === undefined) break
    threadingCacheByKey.delete(oldestKey)
  }
}

function sameMessageSequence(messages: SessionMessage[], prevMessages: SessionMessage[]): boolean {
  if (messages.length !== prevMessages.length) return false
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.uuid !== prevMessages[i]?.uuid) return false
  }
  return true
}

function reuseCachedPrefix(
  messages: SessionMessage[],
  prevMessages: SessionMessage[],
): SessionMessage[] | null {
  if (messages.length <= prevMessages.length) return null
  for (let i = 0; i < prevMessages.length; i++) {
    if (messages[i]?.uuid !== prevMessages[i]?.uuid) return null
  }

  const aligned = messages.slice()
  for (let i = 0; i < prevMessages.length; i++) aligned[i] = prevMessages[i]
  return aligned
}

function threadMessages(session: Session, messages: SessionMessage[]): ThreadedMessage[] {
  const key = threadingCacheKey(session)
  const cached = threadingCacheByKey.get(key)

  if (cached && sameMessageSequence(messages, cached.messages)) {
    touchThreadingCache(key, cached)
    return cached.threaded
  }

  let cacheMessages = messages
  let threaded: ThreadedMessage[] | null = null

  if (cached) {
    const aligned = reuseCachedPrefix(messages, cached.messages)
    if (aligned) {
      threaded = buildThreadedMessagesIncremental(aligned, cached)
      if (threaded) cacheMessages = aligned
    }
  }

  const nextThreaded = threaded ?? buildThreadedMessages(messages)
  touchThreadingCache(key, { messages: cacheMessages, threaded: nextThreaded })
  return nextThreaded
}

self.onmessage = async (event) => {
  const { id, session, messages } = event.data
  try {
    const threadedMessages = threadMessages(session, messages)
    self.postMessage({ id, ok: true, threadedMessages })
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
