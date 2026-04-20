import type { ThreadedMessage } from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'

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
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, session, messages })
  })
}
