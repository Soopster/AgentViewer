import type { MarkdownBlock } from './markdownBlocks'
import { tuiWorkerUrl } from './workerUrl'
type Consumer = { resolve: (blocks: MarkdownBlock[]) => void; reject: (error: Error) => void; cleanup: () => void }
type Job = { id: number; content: string; consumers: Set<Consumer> }
let worker: Worker | undefined
let counter = 0
let active: Job | undefined
const queue: Job[] = []
const flights = new Map<string, Job>()
function finish(job: Job, blocks?: MarkdownBlock[], error?: Error) {
  if (flights.get(job.content) === job) flights.delete(job.content)
  for (const consumer of job.consumers) {
    consumer.cleanup()
    if (blocks) consumer.resolve(blocks)
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
        worker = new Worker(tuiWorkerUrl('markdownBlocksWorker', import.meta.url), { type: 'module' })
        ;(worker as unknown as { unref(): void }).unref()
        worker.onmessage = ({ data }: MessageEvent<{ id: number; blocks?: MarkdownBlock[]; error?: string }>) => {
          if (!active || active.id !== data.id) return
          const current = active
          active = undefined
          finish(current, data.blocks, data.error ? new Error(data.error) : undefined)
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
      worker.postMessage({ id: job.id, content: job.content })
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
  if (signal?.aborted) return Promise.reject(new Error('Markdown parse aborted'))
  let job = flights.get(content)
  if (!job) {
    job = { id: ++counter, content, consumers: new Set() }
    flights.set(content, job)
    queue.push(job)
  }
  const current = job
  const promise = new Promise<MarkdownBlock[]>((resolve, reject) => {
    const abort = () => {
      current.consumers.delete(consumer)
      consumer.cleanup()
      reject(new Error('Markdown parse aborted'))
      if (!current.consumers.size) {
        if (flights.get(content) === current) flights.delete(content)
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
