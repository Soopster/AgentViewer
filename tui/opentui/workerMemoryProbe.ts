// Test-only wrapper: measure the real worker VM after each completed request.
import './threadingWorker'
// @ts-expect-error -- Bun-only diagnostic API
import { heapStats } from 'bun:jsc'

const scope = globalThis as unknown as {
  postMessage: (value: Record<string, unknown>) => void
  Bun: { gc: (sync: boolean) => void }
}
const post = scope.postMessage.bind(scope)
scope.postMessage = (value) => {
  scope.Bun.gc(true)
  const { heapSize, objectCount } = heapStats()
  post({ ...value, workerHeap: { heapSize, objectCount } })
}
