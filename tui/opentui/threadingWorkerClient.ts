import type { ThreadedMessage } from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'

type ThreadingClientCache = {
  messages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
}

type Pending = {
  resolve: (threadedMessages: ThreadedMessage[]) => void
  reject: (error: Error) => void
}

type WorkerResponse =
  | { id: number; ok: true; threadedMessages: ThreadedMessage[] }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()
const THREADING_CACHE_LIMIT = 8
const threadingCacheByKey = new Map<string, ThreadingClientCache>()

function threadingCacheKey(session: Session): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function touchThreadingCache(key: string, cache: ThreadingClientCache): void {
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

function ensureWorker(): Worker {
  if (worker) return worker
  const url = new URL('./threadingWorker.ts', import.meta.url)
  const w = new Worker(url.href, { type: 'module' })
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) entry.resolve(data.threadedMessages)
    else entry.reject(new Error(data.error))
  }
  w.onerror = (event) => {
    const message = typeof event === 'object' && event && 'message' in event
      ? String((event as { message?: unknown }).message ?? 'threading worker error')
      : 'threading worker error'
    const err = new Error(message)
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

export function buildThreadedMessagesAsync(session: Session, messages: SessionMessage[]): Promise<ThreadedMessage[]> {
  const key = threadingCacheKey(session)
  const cached = threadingCacheByKey.get(key)
  if (cached && sameMessageSequence(messages, cached.messages)) {
    touchThreadingCache(key, cached)
    return Promise.resolve(cached.threadedMessages)
  }

  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (threadedMessages) => {
        touchThreadingCache(key, { messages, threadedMessages })
        resolve(threadedMessages)
      },
      reject,
    })
    w.postMessage({ id, session, messages })
  })
}
