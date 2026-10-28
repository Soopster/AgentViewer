import type { SimpleHighlight } from '@opentui/core'
import type { MarkdownCodeChunk } from './markdownStructure'

type Job = {
  key: string; content: string; language: string; abort: AbortController; consumers: number; started: boolean
  promise: Promise<MarkdownCodeChunk[]>; resolve: (chunks: MarkdownCodeChunk[]) => void; reject: (error: unknown) => void
}
type Highlight = (content: string, language: string) => Promise<SimpleHighlight[]>
type Partition = (content: string, highlights: SimpleHighlight[], signal: AbortSignal) => Promise<MarkdownCodeChunk[]>

/** One whole-source syntax request at a time. Live replacements that lose their
 * last consumer leave the queue before reaching the parser. An already active
 * parse may finish, but its aborted result never reaches partitioning or a view. */
export class MarkdownCodeQueue {
  private jobs = new Map<string, Job>()
  private queue: Job[] = []
  private running = false
  constructor(private highlight: Highlight, private partition: Partition) {}
  read(content: string, language: string, signal: AbortSignal): Promise<MarkdownCodeChunk[]> {
    if (signal.aborted) return Promise.reject(new Error('Markdown code aborted'))
    const key = JSON.stringify([language, content])
    let job = this.jobs.get(key)
    if (!job) {
      let resolve!: Job['resolve'], reject!: Job['reject']
      const promise = new Promise<MarkdownCodeChunk[]>((accept, fail) => { resolve = accept; reject = fail })
      job = { key, content, language, promise, resolve, reject, abort: new AbortController(), consumers: 0, started: false }
      this.jobs.set(key, job); this.queue.push(job)
    }
    const current = job
    current.consumers++
    const promise = new Promise<MarkdownCodeChunk[]>((resolve, reject) => {
      let finished = false
      const release = () => {
        if (finished) return false
        finished = true
        signal.removeEventListener('abort', cancel)
        if (--current.consumers === 0) {
          current.abort.abort()
          this.forget(current)
          if (!current.started) {
            const index = this.queue.indexOf(current)
            if (index >= 0) this.queue.splice(index, 1)
            current.reject(new Error('Markdown code aborted'))
          }
        }
        return true
      }
      const cancel = () => { if (release()) reject(new Error('Markdown code aborted')) }
      signal.addEventListener('abort', cancel, { once: true })
      void current.promise.then(chunks => { if (release()) resolve(chunks) }, error => { if (release()) reject(error) })
    })
    this.dispatch()
    return promise
  }
  private forget(job: Job) { if (this.jobs.get(job.key) === job) this.jobs.delete(job.key) }
  private dispatch() {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    this.running = true; job.started = true
    void Promise.resolve().then(() => this.highlight(job.content, job.language)).then(highlights => {
      if (job.abort.signal.aborted) throw new Error('Markdown code aborted')
      return this.partition(job.content, highlights, job.abort.signal)
    }).then(job.resolve, job.reject).finally(() => {
      this.forget(job); this.running = false; this.dispatch()
    })
  }
}
