import type { MarkdownBlock } from './markdownBlocks'
import type { MarkdownCodeChunk } from './markdownStructure'
import type { SimpleHighlight } from '@opentui/core'
import { tuiWorkerUrl } from './workerUrl'
type Result = { blocks?: MarkdownBlock[]; chunks?: MarkdownCodeChunk[] }
type Consumer = { resolve: (result: Result) => void; reject: (error: Error) => void; cleanup: () => void }
type Job = { id: number; key: string; content: string; kind?: 'code'; highlights?: SimpleHighlight[]; consumers: Set<Consumer> }
let worker: Worker | undefined
let counter = 0
let active: Job | undefined
const queue: Job[] = []
const flights = new Map<string, Job>()
function finish(job: Job, result?: Result, error?: Error) {
  if (flights.get(job.key) === job) flights.delete(job.key)
  for (const consumer of job.consumers) {
    consumer.cleanup()
    if (result && !error) consumer.resolve(result)
    else consumer.reject(error ?? new Error('Markdown worker returned no blocks'))
  }
  job.consumers.clear()
}
function dispatch() {
  if (active) return
  while (queue.length && !active) {
    const job = queue.shift()!
    if (!job.consumers.size) continue
    active = job
    try {
      if (!worker) {
        worker = new Worker(tuiWorkerUrl('tui/opentui/markdownBlocksWorker'), { type: 'module' })
        ;(worker as unknown as { unref(): void }).unref()
        worker.onmessage = ({ data }: MessageEvent<Result & { id: number; error?: string }>) => {
          if (!active || active.id !== data.id) return
          const current = active
          active = undefined
          finish(current, data, data.error ? new Error(data.error) : undefined)
          dispatch()
        }
        worker.onerror = event => {
          const failed = worker
          worker = undefined
          failed?.terminate()
          if (active) finish(active, undefined, new Error(event.message))
          active = undefined
          for (const queued of queue.splice(0)) finish(queued, undefined, new Error(event.message))
        }
      }
      worker.postMessage({ id: job.id, content: job.content, kind: job.kind, highlights: job.highlights })
    } catch (error) {
      active = undefined
      finish(job, undefined, error instanceof Error ? error : new Error(String(error)))
    }
  }
}
/** One worker job at a time. Concurrent views share a parse, and the last
 * consumer's abort removes queued work instead of parsing discarded versions.
 * Finished blocks belong to views; there is no second completed-source cache. */
export function parseMarkdownBlocksAsync(content: string, signal?: AbortSignal): Promise<MarkdownBlock[]> {
  return enqueue(content, `markdown:${content}`, signal).then(result => result.blocks ?? [])
}

/** Partition work reuses the same bounded worker queue. Its capture array is
 * owned by a whole-code syntax request, so distinct parses never share jobs. */
export function partitionMarkdownCodeAsync(content: string, highlights: SimpleHighlight[], signal?: AbortSignal): Promise<MarkdownCodeChunk[]> {
  return enqueue(content, `code:${++counter}`, signal, highlights).then(result => result.chunks ?? [])
}

function enqueue(content: string, key: string, signal?: AbortSignal, highlights?: SimpleHighlight[]): Promise<Result> {
  if (signal?.aborted) return Promise.reject(new Error('Markdown parse aborted'))
  let job = flights.get(key)
  if (!job) {
    job = { id: ++counter, key, content, kind: highlights ? 'code' : undefined, highlights, consumers: new Set() }
    flights.set(key, job)
    queue.push(job)
  }
  const current = job
  const promise = new Promise<Result>((resolve, reject) => {
    const abort = () => {
      current.consumers.delete(consumer)
      consumer.cleanup()
      reject(new Error('Markdown parse aborted'))
      if (!current.consumers.size) {
        if (flights.get(key) === current) flights.delete(key)
        const position = queue.indexOf(current)
        if (position >= 0) queue.splice(position, 1)
      }
    }
    const consumer: Consumer = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) }
    current.consumers.add(consumer)
    signal?.addEventListener('abort', abort, { once: true })
  })
  dispatch()
  return promise
}
