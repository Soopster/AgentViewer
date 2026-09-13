import type { Analytics, AnalyticsInput } from '../../lib/analytics'
import { tuiWorkerUrl } from './workerUrl'

type Pending = {
  resolve: (analytics: Analytics) => void
  reject: (error: Error) => void
}

type WorkerResponse =
  | { id: number; ok: true; analytics: Analytics }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(tuiWorkerUrl('analyticsWorker', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) entry.resolve(data.analytics)
    else entry.reject(new Error(data.error))
  }
  w.onerror = (event) => {
    const message = typeof event === 'object' && event && 'message' in event
      ? String((event as { message?: unknown }).message ?? 'analytics worker error')
      : 'analytics worker error'
    const err = new Error(message)
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

export function computeAnalyticsAsync(detail: AnalyticsInput | null): Promise<Analytics> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, detail })
  })
}
