import type { ComposerMentionFileEntry } from './composerMentionWorker'
import { tuiWorkerUrl } from './workerUrl'

type Pending = {
  resolve: (matches: ComposerMentionFileEntry[]) => void
  reject: (error: Error) => void
}

type WorkerResponse =
  | { id: number; ok: true; matches: ComposerMentionFileEntry[] }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(tuiWorkerUrl('composerMentionWorker', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const data = event.data
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.ok) entry.resolve(data.matches)
    else entry.reject(new Error(data.error))
  }
  w.onerror = (event) => {
    const message = typeof event === 'object' && event && 'message' in event
      ? String((event as { message?: unknown }).message ?? 'composer mention worker error')
      : 'composer mention worker error'
    const err = new Error(message)
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  worker = w
  return w
}

export function filterComposerMentionFilesAsync(
  entries: ComposerMentionFileEntry[],
  query: string,
  limit: number,
): Promise<ComposerMentionFileEntry[]> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, entries, query, limit })
  })
}
