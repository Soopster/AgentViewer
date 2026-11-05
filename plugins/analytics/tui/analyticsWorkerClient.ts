import type { Analytics, AnalyticsInput } from '../../../lib/analytics'
import { createPluginResourceScope, tuiWorkerUrl } from '../../../tui/opentui/shell/sdk'

type Pending = {
  resolve: (analytics: Analytics) => void
  reject: (error: Error) => void
}

type WorkerResponse =
  | { id: number; ok: true; analytics: Analytics }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let resources: ReturnType<typeof createPluginResourceScope> | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  resources = createPluginResourceScope('analytics')
  if (resources.signal.aborted) { resources = null; throw cancellationError() }
  let w: Worker
  try { w = new Worker(tuiWorkerUrl('plugins/analytics/tui/analyticsWorker'), { type: 'module' }) }
  catch (error) { resources.dispose(); resources = null; throw error }
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (worker !== w) return
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
    if (worker === w) disposeAnalyticsWorker(new Error(message))
  }
  worker = w
  resources.defer(() => { if (worker === w) disposeAnalyticsWorker() })
  return w
}

export async function computeAnalyticsAsync(detail: AnalyticsInput | null): Promise<Analytics> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try { w.postMessage({ id, detail }) }
    catch (error) { pending.delete(id); reject(error) }
  })
}

function cancellationError(): Error {
  const error = new Error('Analytics cancelled: plugin deactivated')
  error.name = 'AbortError'
  return error
}

export function disposeAnalyticsWorker(error: Error = cancellationError()): void {
  const previous = worker
  worker = null
  const scope = resources
  resources = null
  scope?.dispose()
  if (previous) {
    previous.onmessage = null
    previous.onerror = null
    previous.terminate()
  }
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
}
