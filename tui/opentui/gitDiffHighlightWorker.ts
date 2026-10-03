import type { FileDiffMetadata } from '@pierre/diffs'
import { highlightDiffFileSpans, type DiffFileSpanHighlights } from './pierreDiffView'
import { estimateHighlightBytes } from './diffHighlightCache'

export type DiffHighlightRequest = { key: string; file: FileDiffMetadata; appearance: 'dark' | 'light' }
export type DiffHighlightResponse = { key: string; value: DiffFileSpanHighlights | null; bytes: number }
declare const self: {
  onmessage: ((event: MessageEvent<DiffHighlightRequest>) => void) | null
  postMessage: (message: DiffHighlightResponse) => void
}
self.onmessage = async ({ data }) => {
  try {
    const value = await highlightDiffFileSpans(data.file, data.appearance)
    self.postMessage({ key: data.key, value, bytes: estimateHighlightBytes(value) })
  } catch {
    self.postMessage({ key: data.key, value: null, bytes: 8 })
  }
}
