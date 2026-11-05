import { preferredDiffHighlighter } from '@/lib/diffHighlighter'

export const DIFF_HIGHLIGHTER_OPTIONS = { preferredHighlighter: preferredDiffHighlighter() }
export const EDITABLE_DIFF_HIGHLIGHTER_OPTIONS = { ...DIFF_HIGHLIGHTER_OPTIONS, useTokenTransformer: true }

export const DIFF_WORKER_POOL_OPTIONS = {
  poolSize: 2,
  workerFactory: () =>
    new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' }),
}
