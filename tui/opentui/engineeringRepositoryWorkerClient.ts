import type { EngineeringRepository } from './engineering/repository'
import type { EngineeringRepositoryRequest, EngineeringRepositoryResponse } from './engineeringRepositoryWorker'
import { tuiWorkerUrl } from './workerUrl'

/** Owned by the visible Engineering frame. Disposing never touches user processes. */
export function createEngineeringRepositoryClient() {
  let worker: Worker | null = null
  let nextId = 0
  const pending = new Map<number, { resolve: (value: EngineeringRepository) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const dispose = () => {
    worker?.terminate(); worker = null
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Engineering repository observer closed')) }
    pending.clear()
  }
  return {
    read(cwd: string): Promise<EngineeringRepository> {
      return new Promise((resolve, reject) => {
        try {
          if (!worker) {
            worker = new Worker(tuiWorkerUrl('tui/opentui/engineeringRepositoryWorker'), { type: 'module' })
            worker.onmessage = ({ data }: MessageEvent<EngineeringRepositoryResponse>) => {
              const request = pending.get(data.id)
              if (!request) return
              clearTimeout(request.timer); pending.delete(data.id)
              if (data.value) request.resolve(data.value)
              else request.reject(new Error(data.error ?? 'Repository read failed'))
            }
            worker.onerror = event => { event.preventDefault(); dispose() }
          }
          const id = ++nextId
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('Repository read timed out')); if (!pending.size) { worker?.terminate(); worker = null } }, 20_000)
          pending.set(id, { resolve, reject, timer })
          worker.postMessage({ id, cwd } satisfies EngineeringRepositoryRequest)
        } catch (cause) { dispose(); reject(cause) }
      })
    },
    dispose,
  }
}
