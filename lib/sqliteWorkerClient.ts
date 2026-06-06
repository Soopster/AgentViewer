// Main-thread client for the read-only SQLite worker (lib/sqliteReadWorker.mjs).
// Offloads heavy search scans off the event loop. Every call takes a synchronous
// fallback so search ALWAYS works — if the worker can't spawn, times out, or
// errors, we run the query on the caller's main-thread connection instead
// (current behavior, just back to blocking the loop). Correctness never depends
// on the worker.
//
// State lives on globalThis because Next runs route handlers and instrumentation
// in separate module instances; one worker per process is plenty.
import path from 'node:path'
import type { Worker as NodeWorker } from 'node:worker_threads'

type Row = Record<string, unknown>
type Pending = {
  resolve: (rows: Row[]) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}
type WorkerState = {
  worker: NodeWorker | null
  pending: Map<number, Pending>
  nextId: number
  spawnFailed: boolean
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerSqliteWorker: WorkerState | undefined
}

function state(): WorkerState {
  return (globalThis.__agentViewerSqliteWorker ??= {
    worker: null,
    pending: new Map(),
    nextId: 1,
    spawnFailed: false,
  })
}

const WORKER_TIMEOUT_MS = 10_000
const WORKER_DISABLED = process.env.AGENT_VIEWER_DISABLE_SQLITE_WORKER === '1'

async function ensureWorker(dbFile: string): Promise<NodeWorker | null> {
  const s = state()
  if (s.worker) return s.worker
  if (s.spawnFailed || WORKER_DISABLED) return null
  try {
    // eval-dynamic-import for the same reason as node:sqlite: avoid Turbopack
    // externalizing the node: builtin into a broken require shim inside ESM.
    const { Worker } = await (0, eval)('import("node:worker_threads")') as typeof import('node:worker_threads')
    const workerPath = path.join(process.cwd(), 'lib', 'sqliteReadWorker.mjs')
    const worker = new Worker(workerPath, { workerData: { dbFile } })

    worker.on('message', (msg: { id: number; rows?: Row[]; error?: string }) => {
      const pending = s.pending.get(msg.id)
      if (!pending) return
      s.pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) pending.reject(new Error(msg.error))
      else pending.resolve(msg.rows ?? [])
    })

    const failAll = (err: Error) => {
      for (const pending of s.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(err)
      }
      s.pending.clear()
      s.worker = null
    }
    worker.on('error', (err) => failAll(err instanceof Error ? err : new Error(String(err))))
    worker.on('exit', (code) => {
      s.worker = null
      if (code !== 0) failAll(new Error(`sqlite worker exited with code ${code}`))
    })
    // Don't keep the process alive solely for this worker.
    worker.unref()
    s.worker = worker
    return worker
  } catch {
    // Couldn't spawn (e.g. worker file not present in this deployment layout) —
    // remember and never retry; callers fall back to synchronous reads.
    s.spawnFailed = true
    return null
  }
}

/**
 * Run a read-only query off the main thread. `fallback` runs the same query
 * synchronously on the caller's connection and is used whenever the worker is
 * unavailable, times out, or errors — so behavior is identical with or without
 * the worker, only the event-loop-blocking differs.
 */
export async function runReadRows(
  dbFile: string,
  sql: string,
  params: unknown[],
  fallback: () => Row[],
): Promise<Row[]> {
  const worker = await ensureWorker(dbFile)
  if (!worker) return fallback()
  const s = state()
  const id = s.nextId++
  try {
    return await new Promise<Row[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        s.pending.delete(id)
        reject(new Error('sqlite worker timeout'))
      }, WORKER_TIMEOUT_MS)
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        (timer as { unref: () => void }).unref()
      }
      s.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ id, sql, params })
    })
  } catch {
    return fallback()
  }
}
