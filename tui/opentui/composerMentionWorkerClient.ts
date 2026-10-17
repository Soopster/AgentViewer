import type { ComposerMentionFileEntry } from './composerMentionRanking'
import { createLatestWorkerQueue } from './latestWorkerQueue'
import { tuiWorkerUrl } from './workerUrl'

type Pending = {
  resolve: (matches: ComposerMentionFileEntry[]) => void
  reject: (error: Error) => void
}

type WorkerResponse =
  | { id: number; ok: true; matches: ComposerMentionFileEntry[] }
  | { id: number; ok: false; error: string }

type MentionRequest = {
  entries: ComposerMentionFileEntry[]
  query: string
  limit: number
  frecency?: Record<string, number>
  frecencyPrefix?: string
  resolve: (matches: ComposerMentionFileEntry[]) => void
  reject: (error: Error) => void
}

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

function dispatch(request: MentionRequest): Promise<void> {
  const id = ++requestCounter
  const w = ensureWorker()
  return new Promise<void>((settle) => {
    pending.set(id, {
      resolve: (matches) => {
        request.resolve(matches)
        settle()
      },
      reject: (error) => {
        request.reject(error)
        settle()
      },
    })
    w.postMessage({
      id,
      entries: request.entries,
      query: request.query,
      limit: request.limit,
      frecency: request.frecency,
      frecencyPrefix: request.frecencyPrefix,
    })
  })
}

/**
 * One pending filter at a time: the composer asks the same question of the same
 * file list on every keystroke, and each `postMessage` structured-clones up to
 * 5 000 entries. Without superseding, typing faster than the worker answers
 * queues a clone per character and the answer the user is waiting on arrives
 * behind every answer they have already typed past.
 *
 * A superseded caller is resolved with the newer query's matches. That is wrong
 * for its query and right for the composer: the only consumer discards a result
 * whose query is no longer the one in the box.
 */
const queue = createLatestWorkerQueue<MentionRequest>({
  run: dispatch,
  supersede: (superseded, replacement) => {
    const { resolve, reject } = superseded
    const chainedResolve = replacement.resolve
    const chainedReject = replacement.reject
    replacement.resolve = (matches) => {
      chainedResolve(matches)
      resolve(matches)
    }
    replacement.reject = (error) => {
      chainedReject(error)
      reject(error)
    }
  },
})

export function filterComposerMentionFilesAsync(
  entries: ComposerMentionFileEntry[],
  query: string,
  limit: number,
  frecency?: Record<string, number>,
  frecencyPrefix?: string,
): Promise<ComposerMentionFileEntry[]> {
  return new Promise((resolve, reject) => {
    queue.push({
      // One composer, one pending filter. The prefix keys by project so two
      // panes over different repositories do not supersede each other.
      key: `mention:${frecencyPrefix ?? ''}`,
      request: { entries, query, limit, frecency, frecencyPrefix, resolve, reject },
    })
  })
}

/** Test seam: pending (not yet dispatched) filter count. */
export function composerMentionQueueSize(): number {
  return queue.size
}
