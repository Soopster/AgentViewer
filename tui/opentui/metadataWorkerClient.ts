import type { ContextUsage } from '../../lib/types'
import type { Session } from '../../lib/types'

type Pending = {
  resolve: (metadata: { currentModel: string | null; contextUsage: ContextUsage | null }) => void
  reject: (error: Error) => void
}

type WorkerResponse =
  | { id: number; ok: true; metadata: { currentModel: string | null; contextUsage: ContextUsage | null } }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  const url = new URL('./metadataWorker.ts', import.meta.url)
  const w = new Worker(url.href, { type: 'module' })
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) entry.resolve(data.metadata)
    else entry.reject(new Error(data.error))
  }
  w.onerror = (event) => {
    const message = typeof event === 'object' && event && 'message' in event
      ? String((event as { message?: unknown }).message ?? 'metadata worker error')
      : 'metadata worker error'
    const err = new Error(message)
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

export function readTuiSessionMetadataAsync(session: Session): Promise<{ currentModel: string | null; contextUsage: ContextUsage | null }> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, session })
  })
}
