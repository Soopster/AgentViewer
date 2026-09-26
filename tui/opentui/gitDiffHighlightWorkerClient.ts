import { createHash } from 'node:crypto'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { DiffFileSpanHighlights } from './pierreDiffView'
import type { DiffHighlightRequest, DiffHighlightResponse } from './gitDiffHighlightWorker'
import { DiffHighlightCache } from './diffHighlightCache'
import { tuiWorkerUrl } from './workerUrl'

export const MAX_HIGHLIGHT_LINES = 12_000
const MAX_HIGHLIGHT_CHARACTERS = 1_000_000
export type DiffHighlightTarget = DiffHighlightRequest & { path: string }
const identities = new WeakMap<FileDiffMetadata, string>()
export function diffHighlightTarget(file: FileDiffMetadata, path: string, appearance: 'dark' | 'light'): DiffHighlightTarget {
  let hash = identities.get(file)
  if (!hash) { hash = createHash('sha256').update(JSON.stringify(file)).digest('hex'); identities.set(file, hash) }
  return { file, path, appearance, key: `${appearance}:${hash}` }
}

/** One worker processes only the latest viewport's candidates, with bounded retained results. */
export function createGitDiffHighlightClient(budget?: number) {
  const cache = new DiffHighlightCache<DiffFileSpanHighlights | null>(budget)
  const listeners = new Set<() => void>()
  let wanted: DiffHighlightTarget[] = []
  let signature = ''
  let attempted = new Set<string>()
  let busy: DiffHighlightTarget | undefined
  let worker: Worker | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  let requests = 0
  const notify = () => { revision++; for (const listener of listeners) listener() }
  const stopWorker = () => { clearTimeout(timer); worker?.terminate(); worker = undefined; busy = undefined }
  const finish = ({ key, value, bytes }: DiffHighlightResponse) => {
    if (busy?.key !== key) return
    clearTimeout(timer)
    busy = undefined
    if (!cache.set(key, value, bytes)) cache.set(key, null, 8)
    notify(); pump()
  }
  const pump = () => {
    if (busy) return
    const target = wanted.find(item => cache.peek(item.key) === undefined && !attempted.has(item.key))
    if (!target) return
    attempted.add(target.key)
    const lines = target.file.deletionLines.length + target.file.additionLines.length
    const characters = target.file.deletionLines.reduce((n, line) => n + line.length, 0) + target.file.additionLines.reduce((n, line) => n + line.length, 0)
    if (lines > MAX_HIGHLIGHT_LINES || characters > MAX_HIGHLIGHT_CHARACTERS) {
      cache.set(target.key, null, 8); notify(); pump(); return
    }
    busy = target
    try {
      if (!worker) {
        worker = new Worker(tuiWorkerUrl('gitDiffHighlightWorker', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<DiffHighlightResponse>) => finish(event.data)
        worker.onerror = event => {
          event.preventDefault()
          const key = busy?.key
          stopWorker()
          if (key) cache.set(key, null, 8)
          notify(); pump()
        }
      }
      requests++
      worker.postMessage({ key: target.key, file: target.file, appearance: target.appearance } satisfies DiffHighlightRequest)
      timer = setTimeout(() => { stopWorker(); cache.set(target.key, null, 8); notify(); pump() }, 15_000)
    } catch { stopWorker(); cache.set(target.key, null, 8); notify(); pump() }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getRevision: () => revision,
    setWindow(targets: DiffHighlightTarget[]) {
      wanted = targets.slice(0, 12)
      const next = wanted.map(item => item.key).join('|')
      if (next !== signature) { signature = next; attempted = new Set() }
      for (const target of wanted) cache.get(target.key)
      pump()
    },
    peek: (key: string) => cache.peek(key),
    stats: () => ({ bytes: cache.bytes, budget: cache.budget, entries: cache.size, pending: busy ? 1 : 0, queued: wanted.filter(item => !attempted.has(item.key) && cache.peek(item.key) === undefined).length, requests }),
    dispose() { wanted = []; signature = ''; attempted.clear(); stopWorker(); cache.clear(); listeners.clear() },
  }
}
