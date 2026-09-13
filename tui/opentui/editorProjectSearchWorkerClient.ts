import type { EditorProjectSearchBuffer, EditorProjectSearchOptions, EditorProjectSearchResult } from './editorProjectSearch'
import { tuiWorkerUrl } from './workerUrl'

type Pending = {
  resolve: (results: EditorProjectSearchResult[]) => void
  reject: (error: Error) => void
  cleanup: () => void
}

type WorkerResponse =
  | { id: number; ok: true; results: EditorProjectSearchResult[] }
  | { id: number; ok: false; error: string; aborted?: boolean }

let worker: Worker | null = null
let requestCounter = 0
const pending = new Map<number, Pending>()

function abortError(): Error {
  const error = new Error('Project search cancelled')
  error.name = 'AbortError'
  return error
}

function ensureWorker(): Worker {
  if (worker) return worker
  const instance = new Worker(tuiWorkerUrl('editorProjectSearchWorker', import.meta.url), { type: 'module' })
  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    entry.cleanup()
    if (response.ok) entry.resolve(response.results)
    else entry.reject(response.aborted ? abortError() : new Error(response.error))
  }
  instance.onerror = (event) => {
    const message = typeof event === 'object' && event && 'message' in event
      ? String((event as { message?: unknown }).message ?? 'project search worker error')
      : 'project search worker error'
    for (const entry of pending.values()) {
      entry.cleanup()
      entry.reject(new Error(message))
    }
    pending.clear()
    instance.terminate()
    worker = null
  }
  worker = instance
  return instance
}

export function searchEditorProjectAsync(
  cwd: string,
  query: string,
  options: EditorProjectSearchOptions,
  buffers: readonly EditorProjectSearchBuffer[] = [],
): Promise<EditorProjectSearchResult[]> {
  if (options.signal?.aborted) return Promise.reject(abortError())
  const id = ++requestCounter
  const instance = ensureWorker()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (!pending.delete(id)) return
      instance.postMessage({ kind: 'cancel', id })
      reject(abortError())
    }
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, { resolve, reject, cleanup })
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    const { signal: _signal, ...serializableOptions } = options
    instance.postMessage({ kind: 'search', id, cwd, query, options: serializableOptions, buffers })
  })
}

export function disposeEditorProjectSearchWorker(): void {
  worker?.terminate()
  worker = null
  const error = abortError()
  for (const entry of pending.values()) {
    entry.cleanup()
    entry.reject(error)
  }
  pending.clear()
}
