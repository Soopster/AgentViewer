export const DIFF_WORKER_POOL_OPTIONS = {
  poolSize: 2,
  workerFactory: () =>
    new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
}
